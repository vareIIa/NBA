// Online 1x1 (docs/24-multiplayer-online.md): liga o Freestyle do jogador local ao servidor de salas.
//   - O meu jogador é simulado aqui, sem atraso no controle; o estado dele vai ~20 vezes por segundo ('st').
//   - O oponente é o boneco remoto (src/online: RemotePlayer), desenhado a partir do estado que chega.
//   - A bola é de quem tem a posse (state.offense): o cliente dele simula drible, voo e bola solta; o outro só vê.
//   - O servidor é o juiz (Referee): check-ball, placar, rebote, limpar a bola, relógio de posse e fim.
// Aqui ficam o que o juiz não vê: onde cada um fica no check, a defesa (sem bola, de frente para o atacante), o corpo a
// corpo, a pegada da bola solta, a contestação no arremesso e o HUD da partida.
import * as THREE from 'three';
import type { Freestyle, ShotRecord } from './Freestyle';
import type { InputState } from './Input';
import type { GameHud } from '../hud/GameHud';
import { OnlineHud } from '../hud/OnlineHud';
import type { PlayerAnimator } from '../anim/PlayerAnimator';
import type { NetClient } from '../net/NetClient';
import {
  type MatchEvent,
  type MatchState,
  type PlayerCard,
  type RoomInfo,
  type ServerMsg,
  type Side,
  otherSide,
  shotClockLeft,
} from '../net/protocol';
import { Vec3, clamp, computeContest, distance2D, makeBallState, makeDefenderPose } from '../sim';
import { fromThree } from '../units';
import { AnimRecorder, RemotePlayer } from '../online';

type StartMsg = Extract<ServerMsg, { t: 'match.start' }>;

/** Envio do estado do jogador (Hz). */
const SendHz = 20;
/** Raio do corpo (m): os dois centros não chegam a menos de 2× isto. */
const BodyRadius = 0.32;
/** Passando a esta distância (m, no chão) da bola solta, o jogador pega. */
const PickupRadius = 0.85;
/** Bola solta acima disto (m, centro) ainda está alta demais para pegar correndo. */
const PickupHeight = 1.25;
/** Check-ball: o atacante fica este tanto além da linha de 3 e o defensor este tanto à frente dele (m). */
const CheckBeyondArc = 1.0;
const CheckGap = 1.7;
/** Contestação automática pela posição: mãos todo em cima até esta distância, nada além de ContestFarM. */
const ContestNearM = 1.4;
const ContestFarM = 2.6;
/** Bola estacionada do Freestyle de quem defende (debaixo do chão, parada: a física nem roda). */
const parkedBall = (): Vec3 => new Vec3(0, 0, -3);

export interface OnlineMatchDeps {
  scene: THREE.Scene;
  game: Freestyle;
  animator: PlayerAnimator;
  net: NetClient;
  start: StartMsg;
  gameHud: GameHud;
  /** Mão da bola da build (o check entrega a bola nela). */
  hand: 'r' | 'l';
  myName: string;
  /** Núcleo → pixels da tela. */
  project: (p: Vec3) => { x: number; y: number; visible: boolean };
  /** Saiu do online (o jogo volta ao menu principal). */
  onExit: () => void;
  sfx?: { swish(): void; ding(): void; bounce(speed: number): void };
}

export class OnlineMatch {
  private state: MatchState;
  private you: Side;
  private room: RoomInfo;
  private readonly hud: OnlineHud;
  private readonly rec: AnimRecorder;
  private readonly offs: (() => void)[] = [];
  private sendAcc = 0;
  /** seq do último check montado aqui (cada check monta uma vez). */
  private placedSeq = -1;
  private releaseSent = -1;
  private claimSent = -1;
  private clearedSent = -1;
  /** Pegada da bola solta liberada pelo juiz: 'call' = a bola é minha (rebote ofensivo); 'grab' = vem da bola do oponente. */
  private pickup: { kind: 'call' | 'grab'; from: THREE.Vector3; frames: number } | null = null;
  private prevPause = false;
  private wantRematch = false;
  private opponentGone = false;
  private opponentGraceEndsAt = 0;
  private countdownShown = -1;
  private exited = false;
  private readonly tmp = new THREE.Vector3();
  private readonly ballTmp = new THREE.Vector3();
  /** Posição do oponente no núcleo (chão), atualizada a cada quadro. */
  private remotePos = new Vec3();
  /** Cartão do oponente (fica depois que ele sai da sala: placar e tela de fim seguem com o nome dele). */
  private oppCard: PlayerCard;

  static async create(deps: OnlineMatchDeps): Promise<OnlineMatch> {
    const opp = opponentCard(deps.start.room, deps.start.you);
    const remote = await RemotePlayer.load(deps.scene, {
      heightCm: opp.heightCm,
      wingspanOverM: opp.wingspanOverM,
      kit: 'branca',
      onFloorBounce: (speed) => deps.sfx?.bounce(speed),
    });
    return new OnlineMatch(deps, remote);
  }

  private constructor(
    private readonly deps: OnlineMatchDeps,
    private readonly remote: RemotePlayer,
  ) {
    this.you = deps.start.you;
    this.room = deps.start.room;
    this.state = deps.start.state;
    this.oppCard = opponentCard(this.room, this.you);
    this.rec = AnimRecorder.attach(deps.animator);
    this.hud = new OnlineHud({ rematch: () => this.requestRematch(), leave: () => this.leave() });
    const net = deps.net;
    this.offs.push(
      net.on('st', (m) => this.remote.push(m.d, performance.now() / 1000)),
      net.on('match.state', (m) => this.apply(m.state, m.event)),
      net.on('match.start', (m) => this.begin(m)),
      net.on('room', (m) => {
        this.room = m.room;
        this.you = m.you;
        const opp = m.room.players.find((p) => p.side !== m.you);
        if (opp) this.oppCard = opp.card;
        else this.opponentGone = true;
        if (this.state.phase === 'over') this.showOver();
      }),
      net.on('room.left', () => {
        // A sala da partida rápida fecha quando o oponente sai: quem ficou volta para o menu.
        this.opponentGone = true;
        if (this.state.phase === 'over') this.showOver();
        else this.exit();
      }),
      net.on('opponent', (m) => {
        this.opponentGraceEndsAt = m.connected ? 0 : m.graceEndsAt;
        if (m.connected) this.hud.clear();
      }),
    );
    this.begin(deps.start);
    // O que chegou enquanto o boneco do oponente carregava (o check pode ter virado bola viva nesse meio-tempo).
    const latest = net.lastMatchState;
    if (latest && latest !== deps.start.state) this.apply(latest, null);
  }

  get opponentName(): string {
    return this.oppCard.name;
  }

  // ---------------------------------------------------------------- ganchos do main.ts

  /** Antes do game.update: congela no check/dead/pausa/fim, tira o A (pedir a bola) e injeta a pegada da bola solta. */
  filterInput(input: InputState): InputState {
    const pausePressed = !!input.pause && !this.prevPause;
    this.prevPause = !!input.pause;
    if (pausePressed) this.hud.toggleLeave();
    const phase = this.state.phase;
    const frozen = phase !== 'live' || this.deps.net.status !== 'open';
    let out: InputState = { ...input, call: false, pause: false };
    if (frozen) out = { ...out, moveX: 0, moveY: 0, proX: 0, proY: 0, shoot: false, sprint: false, protect: false };
    const p = this.pickup;
    if (p) {
      const game = this.deps.game;
      if (p.frames === 0) {
        if (p.kind === 'grab') {
          // A bola vem de onde eu a via (na mão/no chão do boneco do oponente) e voa para a minha mão (fase 'return').
          game.ball = makeBallState(fromThree(p.from));
          game.ballMesh.position.copy(p.from);
        }
        game.ballMesh.visible = true;
        game.faceTarget = null;
        out.call = true;
      }
      // Um quadro com o A apertado e um solto (o Freestyle lê a borda).
      if (++p.frames > 1) this.pickup = null;
    }
    return out;
  }

  /** Contestação do oponente na minha soltura (Freestyle events.contest). Automática pela posição, sem botão por ora. */
  contest(): number {
    const game = this.deps.game;
    const opp = this.oppCard;
    const d = distance2D(this.remotePos, game.position);
    const pose = makeDefenderPose({
      feetPosition: this.remotePos.withZ(0),
      height: opp.heightCm / 100,
      wingspan: opp.wingspanCm / 100,
      handsUpAmount: clamp((ContestFarM - d) / (ContestFarM - ContestNearM), 0, 1),
      jumpHeight: 0,
      perimeterDefense: opp.perimeterDefense,
    });
    const release = game.position.withZ(this.deps.animator.heightMeters + 0.25);
    return computeContest(pose, game.position.flat(), release, game.rimCenter()).contest;
  }

  /** Freestyle soltou o arremesso (ou a bandeja/enterrada). */
  onRelease(): void {
    const s = this.state;
    if (s.phase !== 'live' || s.offense !== this.you || this.releaseSent === s.seq) return;
    this.releaseSent = s.seq;
    this.deps.net.send({ t: 'g.release', seq: s.seq });
  }

  /** O arremesso resolveu no Freestyle (primeiro toque no chão). */
  onResult(record: ShotRecord): void {
    const s = this.state;
    if (this.releaseSent !== s.seq || s.offense !== this.you) return;
    this.deps.net.send({ t: 'g.result', seq: s.seq, scored: record.scored, isThree: record.isThree });
  }

  /** Depois do game.update e do director.update. */
  update(dt: number, nowS: number): void {
    if (this.exited) return;
    const { game, net } = this.deps;
    const s = this.state;
    const iOwn = s.offense === this.you;
    this.remote.update(dt, nowS);
    this.remotePos = fromThree(this.remote.rootPosition(this.tmp)).withZ(0);

    // Defesa: sem bola, de frente para o atacante. Se a bola não é minha, o meu Freestyle nunca fica com ela.
    if (!iOwn && !this.pickup) {
      if (game.phase !== 'loose' || game.ballMesh.visible) this.toDefense();
      game.faceTarget = this.remotePos;
    } else if (iOwn) {
      game.faceTarget = null;
    }

    if (s.phase === 'live' || s.phase === 'check') this.separateBodies();
    this.tryPickup();
    this.tryClear();

    this.sendAcc += dt;
    const period = 1 / net.stateHz(SendHz); // mais rápido pelo canal direto (NetClient.stateHz)
    if (this.sendAcc >= period) {
      this.sendAcc %= period;
      const owner = iOwn && game.ballMesh.visible;
      const m = game.ballMesh;
      const ball = owner
        ? {
            p: [m.position.x, m.position.y, m.position.z] as [number, number, number],
            q: [m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w] as [number, number, number, number],
            s: [m.scale.x, m.scale.y, m.scale.z] as [number, number, number],
          }
        : null;
      net.send({ t: 'st', d: this.rec.drain(ball) });
    }
    this.updateHud(dt);
  }

  /** Para o Playwright (window.__garrafao.online) e para depurar. */
  debug(): Record<string, unknown> {
    const s = this.state;
    const game = this.deps.game;
    return {
      you: this.you,
      room: this.room.code,
      phase: s.phase,
      score: [...s.score],
      offense: s.offense,
      ball: s.ball,
      needsClear: s.needsClear,
      seq: s.seq,
      winner: s.winner,
      net: this.deps.net.status,
      rtt: Math.round(this.deps.net.rtt),
      link: this.deps.net.linkStats(),
      me: { x: +game.position.x.toFixed(2), y: +game.position.y.toFixed(2), phase: game.phase, ballVisible: game.ballMesh.visible },
      remote: { x: +this.remotePos.x.toFixed(2), y: +this.remotePos.y.toFixed(2), ball: !!this.remote.ballWorld(this.ballTmp) },
      ballAt: ((b) => (b ? [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)] : null))(this.ballCore()),
      opponent: this.opponentName,
      /** Onde os nomes caem na tela (px): o meu (pés) e o do oponente (acima da cabeça). */
      screen: {
        me: this.deps.project(game.position),
        remote: this.deps.project(this.remotePos.withZ(this.remote.heightMeters + 0.2)),
        remoteFeet: this.deps.project(this.remotePos),
      },
      remoteStats: this.remote.stats(),
    };
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.rec.detach();
    this.remote.dispose();
    this.hud.dispose();
    this.deps.game.faceTarget = null;
  }

  // ---------------------------------------------------------------- estado do juiz

  private begin(start: StartMsg): void {
    this.you = start.you;
    this.room = start.room;
    this.oppCard = opponentCard(start.room, start.you);
    this.wantRematch = false;
    this.opponentGone = false;
    this.placedSeq = -1;
    this.pickup = null;
    this.hud.hideOver();
    this.apply(start.state, null);
  }

  private apply(state: MatchState, event: MatchEvent | null): void {
    const prev = this.state;
    this.state = state;
    if (state.phase === 'check' && state.seq !== this.placedSeq) {
      this.placedSeq = state.seq;
      this.placeForCheck();
    }
    if (event?.kind === 'rebound') {
      const wasMine = prev.offense === this.you;
      if (event.side === this.you) {
        const from = wasMine ? this.deps.game.ballMesh.position.clone() : this.remote.ballWorld(new THREE.Vector3());
        this.pickup = { kind: wasMine ? 'call' : 'grab', from: from ?? this.deps.game.ballMesh.position.clone(), frames: 0 };
      } else if (wasMine) {
        this.toDefense();
      }
    }
    if (event) this.announce(event);
    if (state.phase === 'over') this.showOver();
  }

  /** Check-ball: o atacante além da linha de 3 com a bola; o defensor entre ele e a cesta, de frente para ele. */
  private placeForCheck(): void {
    const { game, animator, hand } = this.deps;
    const arc = game.layout.spec.threePointRadius;
    const offX = arc + CheckBeyondArc;
    this.pickup = null;
    this.countdownShown = -1;
    if (this.state.offense === this.you) {
      game.faceTarget = null;
      game.ballMesh.visible = true;
      animator.endCelebration();
      game.placeForLab(offX, 0, hand);
    } else {
      this.toDefense();
      game.position = new Vec3(offX - CheckGap, 0, 0);
      game.velocity = new Vec3();
      game.facing = new Vec3(1, 0, 0);
      game.faceTarget = new Vec3(offX, 0, 0);
    }
  }

  /** Sem a bola: o Freestyle fica na fase da bola solta com a bola escondida e parada (corre livre, não arremessa). */
  private toDefense(): void {
    const game = this.deps.game;
    game.phase = 'loose';
    game.ball = makeBallState(parkedBall());
    game.ballMesh.visible = false;
  }

  // ---------------------------------------------------------------- jogo

  /** Corpo a corpo simples: cada cliente empurra o próprio jogador metade da sobreposição (o outro faz a outra metade). */
  private separateBodies(): void {
    const game = this.deps.game;
    const delta = game.position.sub(this.remotePos).flat();
    const dist = delta.length2D();
    const min = 2 * BodyRadius;
    if (dist >= min) return;
    const dir = dist > 1e-4 ? delta.scale(1 / dist) : game.facing.scale(-1).flat();
    game.position = game.position.add(dir.scale((min - dist) * 0.5));
    // A velocidade para dentro do outro some (sem atravessar nem "colar" nele).
    const into = game.velocity.dot(dir);
    if (into < 0) game.velocity = game.velocity.sub(dir.scale(into));
  }

  /** Bola solta perto do meu jogador: peço ao juiz (o primeiro pedido válido leva). */
  private tryPickup(): void {
    const s = this.state;
    if (s.phase !== 'live' || s.ball !== 'loose' || this.claimSent === s.seq) return;
    const game = this.deps.game;
    const ball = this.ballCore();
    if (!ball || ball.z > PickupHeight || distance2D(ball, game.position) > PickupRadius) return;
    this.claimSent = s.seq;
    this.deps.net.send({ t: 'g.claim', seq: s.seq, at: [ball.x, ball.y, ball.z] });
  }

  /** Onde a bola está agora para mim (núcleo): a minha, se a posse é minha; senão a que o boneco do oponente mostra. */
  private ballCore(): Vec3 | null {
    if (this.state.offense === this.you) {
      const game = this.deps.game;
      return game.phase === 'flight' || game.phase === 'loose' ? game.ball.position : fromThree(game.ballMesh.position);
    }
    const w = this.remote.ballWorld(this.ballTmp);
    return w ? fromThree(w) : null;
  }

  /** Rebote defensivo: a bola precisa sair da linha de 3 antes de valer cesta. */
  private tryClear(): void {
    const s = this.state;
    if (s.phase !== 'live' || s.offense !== this.you || !s.needsClear || this.clearedSent === s.seq) return;
    const game = this.deps.game;
    if (game.phase !== 'dribble') return;
    if (!game.layout.spec.isThreePointer(game.position, game.layout.rimFloorPoint, game.hoop.forward)) return;
    this.clearedSent = s.seq;
    this.deps.net.send({ t: 'g.cleared', seq: s.seq });
  }

  // ---------------------------------------------------------------- HUD

  private announce(e: MatchEvent): void {
    const me = this.you;
    const them = this.opponentName;
    switch (e.kind) {
      case 'score':
        if (e.side === me) this.hud.say(`Cesta! +${e.points}`, e.isThree ? 'de fora' : '', 1.6, 'good');
        else {
          this.hud.say(`${them} +${e.points}`, e.isThree ? 'de fora' : '', 1.6, 'bad');
          this.deps.sfx?.swish();
        }
        break;
      case 'noClear':
        if (e.side === me) this.hud.say('Não limpou', 'a cesta não vale: bola dele', 2, 'bad');
        else this.hud.say('Não valeu', 'ele não limpou a bola: bola sua', 2, 'good');
        break;
      case 'rebound':
        if (e.side === me) this.hud.say(e.offensive ? 'Rebote ofensivo' : 'Rebote', e.offensive ? '' : 'limpe a bola: saia da linha de 3', 1.6, 'good');
        else this.hud.say(`Rebote de ${them}`, '', 1.2, 'bad');
        break;
      case 'cleared':
        if (e.side === me) this.hud.say('Bola limpa', '', 0.9, 'info');
        break;
      case 'shotClock':
        this.hud.say('Estouro do relógio', e.side === me ? 'bola dele' : 'bola sua', 1.8, e.side === me ? 'bad' : 'good');
        break;
      case 'deadBall':
        this.hud.say('Bola presa', e.side === me ? 'bola sua' : 'bola dele', 1.6, 'info');
        break;
      case 'paused':
        break; // a faixa da espera é do updateHud (com a contagem)
      case 'resumed':
        this.hud.clear();
        break;
      case 'start':
      case 'miss':
      case 'over':
        break;
    }
  }

  private updateHud(dt: number): void {
    const { net, gameHud } = this.deps;
    const s = this.state;
    const now = net.serverNow();
    const other = otherSide(this.you);
    gameHud.setScoreboard({
      home: this.deps.myName,
      away: this.opponentName,
      homeScore: s.score[this.you],
      awayScore: s.score[other],
      shotClock: this.room.rules.shotClock > 0 ? shotClockLeft(s, now) / 1000 : 0,
    });
    // Contagem do check e a espera da reconexão: faixa fixa enquanto durarem.
    if (net.status !== 'open') {
      this.hud.say('Reconectando…', 'a partida espera você', 0, 'gold');
    } else if (s.phase === 'paused') {
      const left = Math.max(0, Math.ceil((this.opponentGraceEndsAt - now) / 1000));
      this.hud.say(`${this.opponentName} caiu`, this.opponentGraceEndsAt ? `esperando a volta: ${left} s` : 'esperando a volta', 0, 'gold');
    } else if (s.phase === 'check') {
      const n = Math.max(1, Math.ceil((s.phaseEndsAt - now) / 1000));
      if (n !== this.countdownShown) {
        this.countdownShown = n;
        this.hud.say(`Check ${n}`, s.offense === this.you ? 'sua bola' : `bola de ${this.opponentName}`, 0, 'info');
      }
    } else if (this.countdownShown >= 0 && s.phase === 'live') {
      this.countdownShown = -1;
      this.hud.say('Valendo!', '', 0.7, 'gold');
    }
    // Papel (ataque/defesa) e o aviso de limpar a bola.
    if (s.phase === 'over') this.hud.setRole('');
    else if (s.offense === this.you) this.hud.setRole(s.needsClear && s.ball === 'held' ? 'Ataque · limpe a bola' : 'Ataque', s.needsClear && s.ball === 'held');
    else this.hud.setRole(s.needsClear && s.ball === 'held' ? 'Defesa · ele precisa limpar' : 'Defesa');
    this.hud.setNet(net.rtt, net.status);
    const head = this.deps.project(this.remotePos.withZ(this.remote.heightMeters + 0.2));
    this.hud.setTag(head.x, head.y, head.visible, this.opponentName);
    this.hud.update(dt);
  }

  private showOver(): void {
    const s = this.state;
    this.hud.clear(); // a faixa fixa do check ou da espera não fica atrás do placar final
    const other = otherSide(this.you);
    this.hud.showOver({
      won: s.winner === this.you,
      myScore: s.score[this.you],
      theirScore: s.score[other],
      forfeit: s.score[this.you] < this.room.rules.target && s.score[other] < this.room.rules.target,
      wantRematch: this.wantRematch,
      theyWantRematch: this.room.rematch[other],
      opponentGone: this.opponentGone,
    });
  }

  private requestRematch(): void {
    if (this.state.phase !== 'over' || this.opponentGone || this.wantRematch) return;
    this.wantRematch = true;
    this.deps.net.send({ t: 'room.rematch', want: true });
    this.showOver();
  }

  private leave(): void {
    this.deps.net.send({ t: 'room.leave' });
    this.exit();
  }

  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.dispose();
    this.deps.net.close();
    this.deps.onExit();
  }
}

function opponentCard(room: RoomInfo, you: Side): PlayerCard {
  const p = room.players.find((q) => q.side !== you);
  return (
    p?.card ?? {
      name: 'Oponente',
      heightCm: 196,
      wingspanOverM: 0,
      wingspanCm: 200,
      overall: 60,
      archetype: '',
      position: '',
      perimeterDefense: 60,
    }
  );
}
