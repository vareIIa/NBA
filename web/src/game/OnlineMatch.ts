// Online 1x1 (docs/24-multiplayer-online.md): liga o Freestyle do jogador local ao servidor de salas.
//   - O meu jogador é simulado aqui, sem atraso no controle; o estado dele vai ~20 vezes por segundo ('st').
//   - O oponente é o boneco remoto (src/online: RemotePlayer), desenhado a partir do estado que chega.
//   - A bola é de quem tem a posse (state.offense): o cliente dele simula drible, voo e bola solta; o outro só vê.
//   - O servidor é o juiz (Referee): check-ball, placar, rebote, limpar a bola, relógio de posse e fim.
// Aqui ficam o que o juiz não vê: onde cada um fica no check, a defesa (sem bola, de frente para o atacante), o corpo a
// corpo, a pegada da bola solta, a contestação no arremesso e o HUD da partida.
// Defesa (docs/24 §6): Y/K pula com os braços esticados (contestação, toco e rebote no ar), RS para cima levanta as
// mãos e X (Espaço/J) dá o tapa do roubo. O meu animador faz a pose e o gravador leva para o boneco do outro lado; o
// arremessador lê o estado do defensor na soltura (contestação e toco) e o juiz sorteia o roubo (src/net/defense.ts).
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
import { StealCooldownMs, StealLungeM, ballExposure, contestJumpM, slideFor, stanceFor } from '../net/defense';
import { type BallState, Vec3, clamp, computeContest, distance2D, makeBallState, makeDefenderPose } from '../sim';
import { fromThree } from '../units';
import { AnimRecorder, RemotePlayer } from '../online';
import { type BlockDefenderNow, BlockWatch, finishBlock } from './BlockWatch';

type StartMsg = Extract<ServerMsg, { t: 'match.start' }>;

/** O que a partida usa da sala: o NetClient (online) ou a sala local do 1x1 contra a CPU (game/cpu/LocalHub). */
export type MatchNet = Pick<NetClient, 'on' | 'send' | 'status' | 'rtt' | 'serverNow' | 'lastMatchState' | 'close' | 'linkStats' | 'stateHz'>;

/** O oponente na tela: o boneco remoto (online) ou o jogador da CPU (game/cpu/CpuOpponent). */
export type MatchOpponent = Pick<
  RemotePlayer,
  | 'push'
  | 'update'
  | 'rootPosition'
  | 'facingYaw'
  | 'heightMeters'
  | 'defenseLatest'
  | 'defenseShown'
  | 'defenseJump'
  | 'dribbleState'
  | 'ballWorld'
  | 'stats'
  | 'dispose'
  | 'animator'
> & {
  /** Recebe a partida montada (o 1x1 contra a CPU usa para os avisos dela no HUD). */
  attach?(match: OnlineMatch): void;
  /** A bola dele está em voo na física deste navegador (a da CPU balança a rede pelo netTick). */
  inFlight?(): boolean;
  /** Estado para o e2e (a cabeça da CPU). */
  debug?(): Record<string, unknown>;
};

/** Envio do estado do jogador (Hz). */
const SendHz = 20;
/** Raio do corpo (m): os dois centros não chegam a menos de 2× isto. */
export const BodyRadius = 0.32;
/** Passando a esta distância (m, no chão) da bola solta, o jogador pega. */
export const PickupRadius = 0.85;
/** Bola solta acima disto (m, centro) ainda está alta demais para pegar correndo. */
export const PickupHeight = 1.25;
/** Check-ball: o atacante fica este tanto além da linha de 3 e o defensor este tanto à frente dele (m). */
export const CheckBeyondArc = 1.0;
export const CheckGap = 1.7;
/** Contestação automática pela posição: mãos todo em cima até esta distância, nada além de ContestFarM. */
export const ContestNearM = 1.4;
export const ContestFarM = 2.6;
/** Sem levantar as mãos, a posição sozinha conta até esta fração das mãos em cima (o resto é do botão). */
export const PassiveHands = 0.4;
/** Rebote no ar: sem cesta, a bola descendo este tanto (m) abaixo do aro já não entra: o erro vai para o juiz. */
export const AirMissBelowRimM = 0.3;
/** Alcance em pé ≈ altura × isto (HoopsContest); no pulo soma a altura do pulo (pegar o rebote no ar). */
export const ReachPerHeight = 1.33;
/** Bola estacionada do Freestyle de quem defende (debaixo do chão, parada: a física nem roda). */
export const parkedBall = (): Vec3 => new Vec3(0, 0, -3);
/** Depois de um toco ninguém pega a bola por este tempo (s): ela voa para longe, não cai na mão de quem bateu nela. */
export const BlockNoClaimS = 0.45;

export interface OnlineMatchDeps {
  scene: THREE.Scene;
  game: Freestyle;
  animator: PlayerAnimator;
  net: MatchNet;
  start: StartMsg;
  /** Monta o oponente no lugar do boneco remoto (o 1x1 contra a CPU). Sem ele, o RemotePlayer da rede. */
  opponent?: (deps: OnlineMatchDeps) => Promise<MatchOpponent>;
  /** Partida local (contra a CPU): sem o ping da sala no HUD. */
  offline?: boolean;
  /** Tick da física da rede da cesta com uma bola em voo (a bola da CPU também balança a rede). */
  netTick?: (ball: BallState, dt: number) => void;
  /** Frente da câmera do jogo (núcleo): o piloto automático (?autoplay) põe o LS nela. */
  cameraForward?: () => Vec3;
  /** Impacto na tela (toco): o tranco da câmera, em metros. */
  impact?: (strength: number) => void;
  gameHud: GameHud;
  /** Mão da bola da build (o check entrega a bola nela). */
  hand: 'r' | 'l';
  myName: string;
  /** Núcleo → pixels da tela. */
  project: (p: Vec3) => { x: number; y: number; visible: boolean };
  /** Saiu do online (o jogo volta ao menu principal). */
  onExit: () => void;
  /** [0, 1): o sorteio do toco (feito por quem arremessa). ?sorte=1 nos testes: todo toco possível sai. */
  random?: () => number;
  sfx?: { swish(): void; ding(): void; bounce(speed: number): void; rim?(): void; block?(): void; slap?(): void };
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
  private resultSent = -1;
  /** seq em que a minha bola entrou (onScore): depois disso não há erro antecipado nem toco. */
  private scoredSeq = -1;
  /** Toco decidido no voo: a bola desvia quando chega à mão do defensor (relógio do jogo, s); interferência = cesta. */
  private pendingBlock: { seq: number; at: number; vel: Vec3; spin: Vec3; goaltend: boolean } | null = null;
  private readonly blockWatch = new BlockWatch();
  /** Relógio do jogo (s) até quando a bola do toco ainda voa sem dono (BlockNoClaimS). */
  private noClaimUntil = -Infinity;
  /** O meu último arremesso saiu de fora da linha de 3 (a interferência dá os pontos dele). */
  private releaseIsThree = false;
  /** O meu último arremesso foi de longe (não bandeja/enterrada): o toco nele pega menos. */
  private releaseJumper = true;
  private clockS = 0;
  private prevContest = false;
  /** Controle ligado (a dica dos botões da defesa no HUD). */
  private gamepad = false;
  private prevSteal = false;
  private handsUp = false;
  private lastStealTry = -Infinity;
  /** Para o debug e o e2e: a última contestação e o último toco calculados, o último evento e as contagens. */
  private lastContest: { value: number; handsUp: number; jump: number; dist: number } | null = null;
  private lastBlock: { dist: number; chance: number; blocked: boolean } | null = null;
  private lastEvent: MatchEvent | null = null;
  private readonly recentEvents: string[] = [];
  private readonly counts = { jumps: 0, stealTries: 0, stealSent: 0, blocks: 0, blockJumper: 0, blockFinish: 0, blockRim: 0 };
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
  /** Velocidade do oponente na tela (m/s, suavizada): correndo, o boneco dele não fica na postura de defesa. */
  private remoteSpeed = 0;
  /** Cartão do oponente (fica depois que ele sai da sala: placar e tela de fim seguem com o nome dele). */
  private oppCard: PlayerCard;

  static async create(deps: OnlineMatchDeps): Promise<OnlineMatch> {
    const opp = opponentCard(deps.start.room, deps.start.you);
    const remote = deps.opponent
      ? await deps.opponent(deps)
      : await RemotePlayer.load(deps.scene, {
          heightCm: opp.heightCm,
          wingspanOverM: opp.wingspanOverM,
          kit: 'branca',
          onFloorBounce: (speed) => deps.sfx?.bounce(speed),
        });
    return new OnlineMatch(deps, remote);
  }

  private constructor(
    private readonly deps: OnlineMatchDeps,
    private readonly remote: MatchOpponent,
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
    this.remote.attach?.(this);
    // O que chegou enquanto o boneco do oponente carregava (o check pode ter virado bola viva nesse meio-tempo).
    const latest = net.lastMatchState;
    if (latest && latest !== deps.start.state) this.apply(latest, null);
  }

  get opponentName(): string {
    return this.oppCard.name;
  }

  // ---------------------------------------------------------------- ganchos do main.ts

  /** Piloto automático do jogador (1x1 contra a CPU com ?autoplay): troca o controle pelo da cabeça da CPU. */
  autopilot: ((input: InputState) => InputState) | null = null;

  /** Antes do game.update: congela no check/dead/pausa/fim, tira o A (pedir a bola) e injeta a pegada da bola solta. */
  filterInput(input: InputState): InputState {
    if (this.autopilot) input = this.autopilot(input);
    this.gamepad = input.gamepadConnected;
    const pausePressed = !!input.pause && !this.prevPause;
    this.prevPause = !!input.pause;
    if (pausePressed) this.hud.toggleLeave();
    const phase = this.state.phase;
    const frozen = phase !== 'live' || this.deps.net.status !== 'open';
    let out: InputState = { ...input, call: false, pause: false };
    if (frozen) out = { ...out, moveX: 0, moveY: 0, proX: 0, proY: 0, shoot: false, sprint: false, protect: false };
    out = this.defend(input, out, frozen);
    const p = this.pickup;
    if (p) {
      const game = this.deps.game;
      if (p.frames === 0) {
        // Rebote ofensivo no ar: a minha bola ainda está no voo; ela sai do voo e vem para a mão daqui.
        if (p.kind === 'call' && game.phase === 'flight') game.phase = 'loose';
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

  /**
   * Contestação do oponente na minha soltura (Freestyle events.contest): a mão do defensor com o estado REAL dele (mãos
   * para cima e pulo, a amostra mais nova que chegou) e, sem botão, um pouco pela posição.
   */
  contest(): number {
    const game = this.deps.game;
    const d = distance2D(this.remotePos, game.position);
    const real = this.remote.defenseLatest();
    const handsUp = Math.max(real.handsUp, PassiveHands * clamp((ContestFarM - d) / (ContestFarM - ContestNearM), 0, 1));
    const release = game.position.withZ(this.deps.animator.heightMeters + 0.25);
    const value = computeContest(this.defenderPose(handsUp, real.jump), game.position.flat(), release, game.rimCenter()).contest;
    this.lastContest = { value: +value.toFixed(3), handsUp: +handsUp.toFixed(2), jump: +real.jump.toFixed(2), dist: +d.toFixed(2) };
    return value;
  }

  /**
   * Freestyle soltou o arremesso (ou a bandeja/enterrada, `finish`): o juiz fica sabendo; o toco é vigiado no voo
   * (watchBlock).
   */
  onRelease(finish = false): void {
    const s = this.state;
    if (s.phase !== 'live' || s.offense !== this.you || this.releaseSent === s.seq) return;
    this.releaseSent = s.seq;
    this.releaseJumper = !finish;
    this.deps.net.send({ t: 'g.release', seq: s.seq });
    const game = this.deps.game;
    this.releaseIsThree = game.layout.spec.isThreePointer(game.position, game.layout.rimFloorPoint, game.hoop.forward);
    this.blockWatch.reset(s.seq);
  }

  /** A rede da cesta está sendo simulada pela bola do oponente (main.ts não a avança sozinha nesse quadro). */
  netBusy(): boolean {
    return !!this.remote.inFlight?.();
  }

  /** Aviso no centro da tela (o 1x1 contra a CPU usa para os lances da CPU: toco dela, interferência). */
  notice(text: string, sub = '', seconds = 1.4, tone: 'info' | 'good' | 'bad' | 'gold' = 'info'): void {
    this.hud.say(text, sub, seconds, tone);
  }

  /** A minha bola entrou (Freestyle onScore). */
  onScore(): void {
    if (this.state.offense === this.you) this.scoredSeq = this.state.seq;
  }

  /** O arremesso resolveu no Freestyle (primeiro toque no chão), se o erro não foi antecipado nem houve toco. */
  onResult(record: ShotRecord): void {
    const s = this.state;
    if (this.releaseSent !== s.seq || s.offense !== this.you || this.resultSent === s.seq) return;
    this.resultSent = s.seq;
    this.deps.net.send({ t: 'g.result', seq: s.seq, scored: record.scored, isThree: record.isThree });
  }

  /** Depois do game.update e do director.update. */
  update(dt: number, nowS: number): void {
    if (this.exited) return;
    const { game, net } = this.deps;
    const s = this.state;
    const iOwn = s.offense === this.you;
    this.clockS += dt;
    this.remote.update(dt, nowS);
    const prevRemote = this.remotePos;
    this.remotePos = fromThree(this.remote.rootPosition(this.tmp)).withZ(0);
    if (dt > 0) this.remoteSpeed += (Math.min(12, distance2D(this.remotePos, prevRemote) / dt) - this.remoteSpeed) * Math.min(1, dt * 8);
    this.remoteStance();
    if (iOwn) {
      this.watchFinish();
      this.updateShotFlight();
    }

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
      cpu: this.remote.debug?.() ?? null,
      lastEvent: this.lastEvent?.kind ?? null,
      /** Últimos eventos do juiz ("steal:1", "block:0"…; o número é o lado de quem fez). */
      events: [...this.recentEvents],
      /** Defesa: a minha (animador), a do oponente na tela (boneco) e a que chegou pela rede; a mão mais alta (m) de cada um. */
      defense: {
        me: roundState(this.deps.animator.defenseState()),
        remoteShown: roundState(this.remote.defenseShown()),
        remoteNet: roundState(this.remote.defenseLatest()),
        myHandY: +this.topPalmY(this.deps.animator).toFixed(2),
        remoteHandY: +this.topPalmY(this.remote.animator).toFixed(2),
        lastContest: this.lastContest,
        lastBlock: this.lastBlock,
        ...this.counts,
      },
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
    this.pendingBlock = null;
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
    if (event) {
      this.lastEvent = event;
      this.recentEvents.push(`${event.kind}${'side' in event ? `:${event.side}` : ''}`);
      if (this.recentEvents.length > 12) this.recentEvents.shift();
    }
    // Rebote e roubo: quem pegou recebe a bola (a minha voltando, ou a do oponente voando para a minha mão); quem perdeu
    // vai para a defesa.
    if (event?.kind === 'block') {
      this.noClaimUntil = this.clockS + BlockNoClaimS;
      // Online: o toco foi decidido no navegador de quem arremessou; aqui (o defensor) o tapa e o tranco chegam com o juiz.
      if (!this.deps.offline && event.side === this.you) {
        this.deps.sfx?.block?.();
        this.deps.impact?.(0.05);
      }
    }
    if (event?.kind === 'steal') {
      // O tapa que pegou na bola: o estalo para os dois e um tranco curto para quem roubou.
      this.deps.sfx?.slap?.();
      if (event.side === this.you) this.deps.impact?.(0.03);
    }
    if (event?.kind === 'rebound' || event?.kind === 'steal') {
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
    this.pendingBlock = null;
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
    if (s.phase !== 'live' || s.ball !== 'loose' || this.claimSent === s.seq || this.clockS < this.noClaimUntil) return;
    const game = this.deps.game;
    const ball = this.ballCore();
    // No pulo (Y) a mão alcança o rebote no ar: o alcance em pé mais a altura do pulo.
    const jump = this.deps.animator.defenseState().jump;
    const reachZ = jump > 0.05 ? Math.max(PickupHeight, this.deps.animator.heightMeters * ReachPerHeight + jump - 0.15) : PickupHeight;
    if (!ball || ball.z > reachZ || distance2D(ball, game.position) > PickupRadius) return;
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

  // ---------------------------------------------------------------- defesa

  /**
   * Sem a bola: Y pula (contestação, toco, rebote no ar). Na defesa: RS para cima levanta as mãos e X dá o tapa; o
   * Freestyle (sem bola) não vê nenhum dos dois. No ar, o analógico não mexe o corpo até pousar.
   */
  private defend(input: InputState, out: InputState, frozen: boolean): InputState {
    const game = this.deps.game;
    const iOwn = this.state.offense === this.you;
    const withBall = iOwn && (game.phase === 'dribble' || game.phase === 'gather');
    const contestPressed = !!input.contest && !this.prevContest;
    this.prevContest = !!input.contest;
    const stealPressed = input.shoot && !this.prevSteal;
    this.prevSteal = input.shoot;
    if (!frozen && !withBall && contestPressed && this.deps.animator.playContest(contestJumpM(this.myCard().vertical))) this.counts.jumps++;
    const defending = !frozen && !iOwn && !this.pickup;
    this.setHandsUp(defending && input.proY > 0.5);
    if (defending) {
      if (stealPressed) this.trySteal();
      out = { ...out, shoot: false, proX: 0, proY: 0 };
    }
    // Postura de defesa: perto do atacante e sem RT, agachado com as mãos abertas e o deslize mais rápido; LT (o drible
    // baixo do ataque) vira a defesa intensa (desliza mais). Com a bola na mão do atacante só (bola solta: corre).
    const guarding = defending && this.state.ball === 'held' && !input.sprint;
    const stance = guarding ? stanceFor(distance2D(this.remotePos, game.position)) : 0;
    this.deps.animator.setDefenseStance(stance);
    game.defenseSlide = slideFor(stance, this.myCard().perimeterDefense, !!input.protect);
    if (this.deps.animator.defenseState().jump > 0.01) out = { ...out, moveX: 0, moveY: 0, sprint: false };
    return out;
  }

  /**
   * Online: a postura do boneco do oponente quando ELE defende (a mesma regra da minha, pela distância e pela velocidade
   * dele: correndo, sem postura). Contra a CPU, ela cuida da própria postura.
   */
  private remoteStance(): void {
    if (this.deps.offline) return;
    const s = this.state;
    const defending = s.phase === 'live' && s.offense === this.you && s.ball === 'held';
    const running = this.remote.stats().ball === 'none' && this.remoteSpeed > 4.2;
    this.remote.animator.setDefenseStance(defending && !running ? stanceFor(distance2D(this.remotePos, this.deps.game.position)) : 0);
  }

  private setHandsUp(up: boolean): void {
    if (up === this.handsUp) return;
    this.handsUp = up;
    this.deps.animator.setHandsUp(up);
  }

  /**
   * X na defesa: o tapa sai sempre (o boneco do outro lado vê); com a bola no drible e ao alcance (meia envergadura e o
   * passo do bote), o juiz sorteia com a exposição que eu vi.
   */
  private trySteal(): void {
    const s = this.state;
    const now = performance.now();
    if (s.phase !== 'live' || s.ball !== 'held' || now - this.lastStealTry < StealCooldownMs) return;
    this.lastStealTry = now;
    const game = this.deps.game;
    const ball = this.ballCore();
    const toBall = ball ? ball.sub(game.position).flat() : game.facing;
    const right = new Vec3(-game.facing.y, game.facing.x, 0); // direita = cima × frente (eixos da Unreal)
    this.deps.animator.playSteal(toBall.dot(right) >= 0 ? 'r' : 'l');
    this.counts.stealTries++;
    const dribble = this.remote.dribbleState();
    if (!ball || !dribble.dribbling) return;
    if (distance2D(ball, game.position) > this.myCard().wingspanCm / 200 + StealLungeM) return;
    const exp = ballExposure({
      ball: [ball.x, ball.y, ball.z],
      attacker: [this.remotePos.x, this.remotePos.y],
      defender: [game.position.x, game.position.y],
      bouncing: dribble.bouncing,
      protect: dribble.protect,
    });
    this.counts.stealSent++;
    this.deps.net.send({ t: 'g.steal', seq: s.seq, exp: +exp.toFixed(3) });
  }

  /** Pose do oponente para a contestação e o toco (HoopsContest), com as mãos e o pulo dados. */
  private defenderPose(handsUp: number, jump: number) {
    const opp = this.oppCard;
    return makeDefenderPose({
      feetPosition: this.remotePos.withZ(0),
      height: opp.heightCm / 100,
      wingspan: opp.wingspanCm / 100,
      handsUpAmount: handsUp,
      jumpHeight: jump,
      perimeterDefense: opp.perimeterDefense,
    });
  }

  /**
   * Toco físico (BlockWatch, docs/25 §3): a cada quadro do voo da MINHA bola, a mão do defensor ao longo do pulo dele
   * (a fase do pulo e as mãos do boneco) contra a bola projetada pela física. Quando o contato está para acontecer, o
   * sorteio sai aqui (o lance é meu): a mão do boneco vai até a bola e, se pegou, a bola desvia no instante do contato
   * (updateShotFlight). Enterrada (bola saindo para baixo no aro) não toma toco.
   */
  private watchBlock(): void {
    const game = this.deps.game;
    const decision = this.blockWatch.update(this.clockS, game.sim, game.ball, game.rimCenter(), this.defenderNow(), this.deps.random ?? Math.random, this.releaseJumper);
    if (!decision) return;
    // A mão do defensor (o boneco na minha tela) vai até a bola no instante do contato, junto com o desvio.
    this.remote.animator.playBlock(decision.hand, decision.target, decision.at - this.clockS, decision.follow);
    this.lastBlock = { dist: +decision.contact.dist.toFixed(2), chance: +decision.chance.toFixed(2), blocked: decision.kind !== 'miss' };
    if (decision.kind === 'miss' || !decision.velocity) return;
    this.pendingBlock = { seq: this.state.seq, at: decision.at, vel: decision.velocity, spin: decision.spin ?? new Vec3(0, 18, 0), goaltend: decision.goaltend };
  }

  /** O oponente como defensor agora (o toco lê o pulo e as mãos do boneco; a CPU dá os dela exatos). */
  private defenderNow(): BlockDefenderNow {
    const opp = this.oppCard;
    const yaw = this.remote.facingYaw();
    return {
      feet: this.remotePos,
      facing: new Vec3(Math.sin(yaw), Math.cos(yaw), 0),
      heightM: opp.heightCm / 100,
      wingspanM: opp.wingspanCm / 100,
      block: opp.block,
      jump: this.remote.defenseJump(),
      handsUp: this.remote.defenseLatest().handsUp,
    };
  }

  /**
   * Toco no aro na MINHA bandeja/enterrada, antes da soltura (BlockWatch.finishBlock): o defensor no ar alcança a bola na
   * minha mão. Pegou: a bola é arrancada (Freestyle.stripBall, que já avisa a soltura ao juiz) e fica solta (g.block).
   */
  private watchFinish(): void {
    const s = this.state;
    const game = this.deps.game;
    if (s.phase !== 'live' || s.ball !== 'held') return;
    const f = game.finishState();
    if (!f || !f.airborne) return;
    this.blockWatch.reset(s.seq);
    const decision = finishBlock(this.blockWatch, this.clockS, game.rimCenter(), this.defenderNow(), f, this.deps.random ?? Math.random);
    if (!decision) return;
    this.remote.animator.playBlock(decision.hand, decision.target, 0.06, decision.follow);
    this.lastBlock = { dist: +decision.contact.dist.toFixed(2), chance: +decision.chance.toFixed(2), blocked: decision.kind !== 'miss' };
    if (decision.kind === 'miss' || !decision.velocity) return;
    if (!game.stripBall(decision.velocity, decision.spin ?? new Vec3(0, 18, 0))) return;
    this.resultSent = s.seq;
    this.counts.blocks++;
    this.counts.blockRim++;
    this.deps.sfx?.block?.();
    this.deps.impact?.(0.08);
    this.deps.net.send({ t: 'g.block', seq: s.seq });
  }

  /** A minha bola no voo: o toco (vigiado e aplicado na hora do contato) e o erro antecipado (rebote no ar). */
  private updateShotFlight(): void {
    const s = this.state;
    const { game, net } = this.deps;
    const flying = this.releaseSent === s.seq && this.resultSent !== s.seq && this.scoredSeq !== s.seq && game.phase === 'flight';
    if (flying && !this.pendingBlock && game.ball.velocity.z > -5) this.watchBlock();
    const pb = this.pendingBlock;
    if (pb && this.clockS >= pb.at) {
      this.pendingBlock = null;
      if (pb.seq === s.seq && flying) {
        game.ball = makeBallState(game.ball.position, pb.vel, pb.spin);
        this.resultSent = s.seq;
        this.deps.sfx?.block?.();
        this.deps.impact?.(0.06);
        if (pb.goaltend) {
          // Interferência: tocou na bola descendo acima do aro. A cesta vale (relato de cesta; o protocolo não muda).
          net.send({ t: 'g.result', seq: s.seq, scored: true, isThree: this.releaseIsThree });
          this.hud.say('Interferência!', 'a cesta vale', 1.6, 'good');
        } else {
          this.counts.blocks++;
          this.counts[this.releaseJumper ? 'blockJumper' : 'blockFinish']++;
          net.send({ t: 'g.block', seq: s.seq });
        }
      }
    }
    if (this.releaseSent !== s.seq || this.resultSent === s.seq || this.scoredSeq === s.seq || game.phase !== 'flight') return;
    const b = game.ball;
    if (b.velocity.z < 0 && b.position.z < game.rimCenter().z - AirMissBelowRimM) {
      this.resultSent = s.seq;
      net.send({ t: 'g.result', seq: s.seq, scored: false, isThree: false });
    }
  }

  /** O meu cartão como o servidor tem (com os ratings de defesa). */
  private myCard(): PlayerCard {
    return this.room.players.find((p) => p.side === this.you)?.card ?? opponentCard(this.room, otherSide(this.you));
  }

  /** Altura (m) da mão mais alta de um boneco. */
  private topPalmY(animator: PlayerAnimator): number {
    return Math.max(animator.palmWorld('l', this.tmp).y, animator.palmWorld('r', this.tmp).y);
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
          // Contra a CPU a rede toca quando a bola dela passa pelo aro (CpuOpponent); o evento chega depois do quique.
          if (!this.deps.offline) this.deps.sfx?.swish();
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
      case 'steal':
        if (e.side === me) this.hud.say('Roubo!', this.state.needsClear ? 'limpe a bola: saia da linha de 3' : '', 1.6, 'good');
        else this.hud.say(`Roubo de ${them}`, '', 1.4, 'bad');
        break;
      case 'block':
        if (e.side === me) this.hud.say('Toco!', '', 1.4, 'good');
        else this.hud.say(`Toco de ${them}`, '', 1.4, 'bad');
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
    else if (s.needsClear && s.ball === 'held') this.hud.setRole('Defesa · ele precisa limpar');
    else this.hud.setRole(this.gamepad ? 'Defesa · Y pula · RS↑ mãos · X rouba' : 'Defesa · K pula · ↑ mãos · Espaço rouba');
    if (!this.deps.offline) this.hud.setNet(net.rtt, net.status);
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

function roundState(d: { handsUp: number; jump: number }): { handsUp: number; jump: number } {
  return { handsUp: +d.handsUp.toFixed(2), jump: +d.jump.toFixed(2) };
}
