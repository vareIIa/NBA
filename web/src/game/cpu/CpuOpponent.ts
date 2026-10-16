// O jogador da CPU no 1x1 (docs/25-1x1-cpu-e-defesa.md): um Freestyle próprio (o MESMO jogo do jogador: drible pelo Pro
// Stick, arremesso com timing, bandeja/enterrada pelo plano, física da bola a 120 Hz) com um animador e o uniforme
// branco, comandado pela CpuBrain em vez do controle. Faz do lado da CPU o que o OnlineMatch faz do lado do jogador:
// check-ball, defesa sem bola (de frente para o atacante, postura), corpo a corpo, rebote, limpar a bola, contestação e
// toco no arremesso dela (o defensor é o jogador) e os relatos ao juiz (LocalHub). Para o OnlineMatch do jogador ele é
// o oponente (MatchOpponent), no lugar do boneco remoto.
import * as THREE from 'three';
import { PlayerAnimator } from '../../anim/PlayerAnimator';
import { Freestyle, type ShotRecord } from '../Freestyle';
import { PlayerGear } from '../PlayerGear';
import type { InputState } from '../Input';
import {
  AirMissBelowRimM,
  BlockNoClaimS,
  BodyRadius,
  CheckBeyondArc,
  CheckGap,
  ContestFarM,
  ContestNearM,
  type MatchOpponent,
  type OnlineMatch,
  type OnlineMatchDeps,
  PassiveHands,
  PickupHeight,
  PickupRadius,
  ReachPerHeight,
  parkedBall,
} from '../OnlineMatch';
import { type BlockDefenderNow, BlockWatch, finishBlock } from '../BlockWatch';
import { type MatchEvent, type MatchState, type PlayerCard, type ServerMsg, shotClockLeft } from '../../net/protocol';
import { StealCooldownMs, StealLungeM, ballExposure, contestJumpM, slideFor, stanceFor } from '../../net/defense';
import { Vec3, clamp, computeContest, distance2D, makeBallState, makeDefenderPose } from '../../sim';
import { bodyScaleOf, playRatings, type PlayRatings, wingspanOverModelM } from '../../build/BuildRatings';
import type { PlayerBuild } from '../../build/PlayerBuild';
import { fromThree } from '../../units';
import { CpuBrain, type CpuRatings, type CpuView } from './CpuBrain';
import { cpuSight, predictRebound } from './CpuSight';
import { type AutoPilot, makeAutoPilot } from './AutoPilot';
import { type CpuLevel, CpuLevels, type CpuRosterEntry } from './CpuRoster';
import { CpuSide, type LocalHub } from './LocalHub';

export interface CpuSetup {
  hub: LocalHub;
  entry: CpuRosterEntry;
  build: PlayerBuild;
  card: PlayerCard;
  level: CpuLevel;
  /** O jogador: ratings (a marcação respeita o arremesso dele) e o cartão (toco, envergadura, defesa). */
  humanRatings: PlayRatings;
  humanCard: PlayerCard;
  /** [0, 1): os sorteios da CPU (decisões e timing). */
  random?: () => number;
  /** [0, 1): o sorteio do toco do jogador no arremesso da CPU (?sorte=1 nos testes: todo toco possível sai). */
  blockRandom?: () => number;
  /** A build do jogador (o piloto automático joga com ela). */
  humanBuild: PlayerBuild;
  /** ?autoplay=<nível>: o jogador vira CPU também (testes e "assistir"). */
  autoplay?: CpuLevel;
}

type BallMode = 'none' | 'hand' | 'net';

export class CpuOpponent implements MatchOpponent {
  readonly game: Freestyle;
  private readonly brain: CpuBrain;
  private readonly hub: LocalHub;
  private readonly card: PlayerCard;
  private readonly humanCard: PlayerCard;
  private readonly rand: () => number;
  private readonly blockRand: () => number;
  /** Mão da bola da build (o check entrega a bola nela). */
  private readonly hand: 'r' | 'l';
  private readonly offHub: () => void;
  private state: MatchState;
  private match: OnlineMatch | null = null;
  private camForward = new Vec3(-1, 0, 0);
  private clockS = 0;
  private disposed = false;
  // Controle (bordas).
  private prevShoot = false;
  private edgeTime = 0;
  private prevContest = false;
  private prevSteal = false;
  private lastStealTry = -Infinity;
  // Posse.
  private placedSeq = -1;
  private releaseSent = -1;
  private resultSent = -1;
  private claimSent = -1;
  private clearedSent = -1;
  private scoredSeq = -1;
  private releaseIsThree = false;
  private releaseJumper = true;
  private pickup: { kind: 'call' | 'grab'; from: THREE.Vector3; frames: number } | null = null;
  private pendingBlock: { seq: number; at: number; vel: Vec3; spin: Vec3; goaltend: boolean } | null = null;
  private readonly blockWatch = new BlockWatch();
  private noClaimUntil = -Infinity;
  private rebound: CpuView['rebound'] = null;
  private reboundFrame = 0;
  /** Para o debug e o e2e. */
  private readonly counts = { shots: 0, makes: 0, jumps: 0, stealTries: 0, stealSent: 0, blocks: 0, blockJumper: 0, blockFinish: 0, blockRim: 0, moves: 0 };
  private lastContest: { value: number; handsUp: number; jump: number; dist: number } | null = null;

  static async load(deps: OnlineMatchDeps, setup: CpuSetup): Promise<CpuOpponent> {
    const animator = await PlayerAnimator.load('assets/hoops_player.glb', 'assets/hoops_player.clips.json');
    const gear = await PlayerGear.load(animator, {
      shoes: 'assets/gear/tenis_retro_alto_1.glb',
      jersey: 'assets/gear/regata_branca.glb',
      shorts: 'assets/gear/bermuda_branca.glb',
    }).catch((e: unknown) => (console.warn('roupa da CPU não carregou', e), null));
    return new CpuOpponent(deps, setup, animator, gear);
  }

  private constructor(
    private readonly deps: OnlineMatchDeps,
    setup: CpuSetup,
    readonly animator: PlayerAnimator,
    private readonly gear: PlayerGear | null,
  ) {
    this.hub = setup.hub;
    this.card = setup.card;
    this.humanCard = setup.humanCard;
    this.rand = setup.random ?? Math.random;
    this.blockRand = setup.blockRandom ?? this.rand;
    this.hand = setup.build.hand;
    animator.setBodyScale(bodyScaleOf(setup.build.body.heightCm), wingspanOverModelM(setup.build.body));
    animator.root.name = 'cpu';
    const ratings = playRatings(setup.build);
    this.game = new Freestyle(deps.scene, animator, {
      contest: () => this.contestOnMyShot(),
      onFlightTick: (ball, step) => deps.netTick?.(ball, step),
      onRelease: (_e, _w, finish) => this.onRelease(!!finish),
      onScore: () => {
        this.scoredSeq = this.state.seq;
        this.counts.makes++;
        deps.sfx?.swish();
      },
      onResult: (record) => this.onResult(record),
      onFloorBounce: (speed) => deps.sfx?.bounce(speed),
      onRim: () => deps.sfx?.rim?.(),
      onBoard: () => deps.sfx?.rim?.(),
      onMove: () => this.counts.moves++,
    });
    this.game.setRatings(ratings);
    this.game.ballMesh.name = 'bola da CPU';
    const a = setup.build.attrs;
    const brainRatings: CpuRatings = {
      three: ratings.threePoint,
      mid: ratings.midRange,
      close: ratings.closeShot,
      layup: a.drivingLayup,
      dunk: a.drivingDunk,
      canDunk: ratings.canDunk,
      perimeterDefense: a.perimeterDefense,
      steal: a.steal,
      block: a.block,
      jumpM: contestJumpM(a.vertical),
      heightM: setup.build.body.heightCm / 100,
    };
    this.brain = new CpuBrain(brainRatings, setup.entry.style, CpuLevels[setup.level], this.rand);
    this.humanThree = setup.humanRatings.threePoint;
    this.humanMid = setup.humanRatings.midRange;
    this.humanBuild = setup.humanBuild;
    this.autoplay = setup.autoplay;
    this.ratingsThree = ratings.threePoint;
    this.ratingsMid = ratings.midRange;
    const start = this.hub.startMsg(CpuSide);
    this.state = start.state;
    this.offHub = this.hub.onCpu((m) => this.onServer(m));
    this.begin(start.state);
    // Gancho de depuração (como o __debug do main.ts): os testes forçam jogadas da CPU por aqui.
    (window as unknown as { __cpu: unknown }).__cpu = this;
  }

  /** Testes: a próxima jogada do ataque da CPU (ver CpuBrain.force). */
  force(kind: 'shoot' | 'drive' | 'pump' | 'idle'): void {
    this.brain.force(kind, performance.now() / 1000);
  }

  private readonly humanThree: number;
  private readonly humanMid: number;
  private readonly humanBuild: PlayerBuild;
  private readonly autoplay: CpuLevel | undefined;
  private readonly ratingsThree: number;
  private readonly ratingsMid: number;
  private pilot: AutoPilot | null = null;

  // ---------------------------------------------------------------- MatchOpponent (o que o OnlineMatch do jogador lê)

  /** A CPU não recebe estado pela rede. */
  push(): boolean {
    return false;
  }

  attach(match: OnlineMatch): void {
    this.match = match;
    const level = this.autoplay;
    if (!level) return;
    // CPU contra CPU: o jogador também é a cabeça da CPU (o mesmo jogo, pelos olhos dele).
    const pilot = makeAutoPilot({
      hub: this.hub,
      me: { game: this.deps.game, animator: this.deps.animator, build: this.humanBuild },
      opp: { game: this.game, animator: this.animator, three: this.ratingsThree, mid: this.ratingsMid },
      level,
      cameraForward: this.deps.cameraForward ?? (() => this.deps.game.rimCenter().sub(this.deps.game.position).flat().normalized()),
    });
    this.pilot = pilot;
    match.autopilot = (input) => pilot.input(input);
  }

  inFlight(): boolean {
    return this.game.phase === 'flight';
  }

  update(dt: number, nowS: number): void {
    if (this.disposed) return;
    this.hub.advance(dt);
    this.clockS += dt;
    const input = this.filterInput(this.think(dt, nowS));
    this.game.update(nowS, dt, input, this.camForward);
    this.gear?.update(dt);
    this.afterUpdate();
  }

  rootPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.animator.root.position);
  }

  facingYaw(): number {
    return this.animator.root.rotation.y;
  }

  get heightMeters(): number {
    return this.animator.heightMeters;
  }

  defenseLatest(): { handsUp: number; jump: number } {
    return this.animator.defenseState();
  }

  defenseShown(): { handsUp: number; jump: number } {
    return this.animator.defenseState();
  }

  defenseJump(): { t: number; h: number } | null {
    return this.animator.defenseJump();
  }

  dribbleState(): { dribbling: boolean; bouncing: boolean; protect: boolean } {
    const g = this.game;
    const dribbling = this.hasBall() && g.phase === 'dribble';
    return { dribbling, bouncing: dribbling && g.dribbler.mode !== 'held', protect: this.lastProtect };
  }

  ballWorld(out = new THREE.Vector3()): THREE.Vector3 | null {
    return this.game.ballMesh.visible ? out.copy(this.game.ballMesh.position) : null;
  }

  stats(): { delayMs: number; samples: number; queued: number; rejected: number; failed: number; ball: BallMode } {
    const g = this.game;
    const ball: BallMode = !g.ballMesh.visible ? 'none' : g.phase === 'dribble' || g.phase === 'gather' ? 'hand' : 'net';
    return { delayMs: 0, samples: 0, queued: 0, rejected: 0, failed: 0, ball };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.offHub();
    this.deps.scene.remove(this.animator.root);
    this.deps.scene.remove(this.game.ballMesh);
  }

  /** Para o debug do e2e (window.__garrafao.online().cpu). */
  debug(): Record<string, unknown> {
    const g = this.game;
    return {
      level: this.card.name,
      decision: this.brain.lastDecision,
      phase: g.phase,
      pos: [+g.position.x.toFixed(2), +g.position.y.toFixed(2)],
      defense: { ...this.animator.defenseState(), stance: +this.animator.defenseStance().toFixed(2) },
      lastContest: this.lastContest,
      pilot: this.pilot?.decision ?? null,
      ...this.counts,
    };
  }

  // ---------------------------------------------------------------- cabeça → controle

  private lastProtect = false;

  private think(dt: number, nowS: number): InputState {
    const c = this.brain.think(this.view(dt, nowS));
    this.camForward = c.camForward;
    if (c.shoot !== this.prevShoot) {
      this.edgeTime = c.shootEdgeTime;
      this.prevShoot = c.shoot;
    }
    this.lastProtect = c.protect;
    return {
      moveX: c.moveX,
      moveY: c.moveY,
      proX: c.proX,
      proY: c.proY,
      shoot: c.shoot,
      call: false,
      contest: c.contest,
      pause: false,
      shootEdgeTime: this.edgeTime,
      sprint: c.sprint,
      protect: c.protect,
      gamepadConnected: false,
    };
  }

  private hasBall(): boolean {
    return this.state.offense === CpuSide && this.game.ballMesh.visible;
  }

  /** O que a CPU vê neste quadro (CpuSight, pelos olhos dela). */
  private view(dt: number, nowS: number): CpuView {
    const s = this.state;
    if (++this.reboundFrame % 3 === 0 || !this.rebound) this.rebound = predictRebound(s, CpuSide, this.game, this.deps.game);
    return cpuSight({
      now: nowS,
      dt,
      state: s,
      side: CpuSide,
      shotClockS: this.hub.rules.shotClock > 0 ? shotClockLeft(s, this.hub.serverNow()) / 1000 : Infinity,
      me: { game: this.game, animator: this.animator },
      opp: { game: this.deps.game, animator: this.deps.animator },
      oppShooting: { three: this.humanThree, mid: this.humanMid },
      rebound: this.rebound,
      stealReady: this.hub.serverNow() - this.lastStealTry >= StealCooldownMs,
      stealReach: this.card.wingspanCm / 200 + StealLungeM,
    });
  }

  // ---------------------------------------------------------------- o lado da CPU (espelho do OnlineMatch)

  private onServer(msg: ServerMsg): void {
    if (this.disposed) return;
    if (msg.t === 'match.start') this.begin(msg.state);
    else if (msg.t === 'match.state') this.apply(msg.state, msg.event);
  }

  private begin(state: MatchState): void {
    this.placedSeq = -1;
    this.pickup = null;
    this.pendingBlock = null;
    this.state = state;
    this.apply(state, null);
  }

  private apply(state: MatchState, event: MatchEvent | null): void {
    const prev = this.state;
    this.state = state;
    if (state.phase === 'check' && state.seq !== this.placedSeq) {
      this.placedSeq = state.seq;
      this.placeForCheck();
    }
    if (event?.kind === 'block') this.noClaimUntil = this.clockS + BlockNoClaimS;
    if (event?.kind === 'rebound' || event?.kind === 'steal') {
      const wasMine = prev.offense === CpuSide;
      if (event.side === CpuSide) {
        const human = this.deps.game.ballMesh.position;
        this.pickup = { kind: wasMine ? 'call' : 'grab', from: (wasMine ? this.game.ballMesh.position : human).clone(), frames: 0 };
      } else if (wasMine) {
        this.toDefense();
      }
    }
  }

  private placeForCheck(): void {
    const g = this.game;
    const offX = g.layout.spec.threePointRadius + CheckBeyondArc;
    this.pickup = null;
    this.pendingBlock = null;
    if (this.state.offense === CpuSide) {
      g.faceTarget = null;
      g.ballMesh.visible = true;
      this.animator.endCelebration();
      g.placeForLab(offX, 0, this.hand);
    } else {
      this.toDefense();
      g.position = new Vec3(offX - CheckGap, 0, 0);
      g.velocity = new Vec3();
      g.facing = new Vec3(1, 0, 0);
      g.faceTarget = new Vec3(offX, 0, 0);
    }
  }

  private toDefense(): void {
    const g = this.game;
    g.phase = 'loose';
    g.ball = makeBallState(parkedBall());
    g.ballMesh.visible = false;
  }

  private filterInput(input: InputState): InputState {
    const frozen = this.state.phase !== 'live';
    let out: InputState = { ...input, call: false, pause: false };
    if (frozen) out = { ...out, moveX: 0, moveY: 0, proX: 0, proY: 0, shoot: false, sprint: false, protect: false };
    out = this.defend(input, out, frozen);
    const p = this.pickup;
    if (p) {
      const g = this.game;
      if (p.frames === 0) {
        if (p.kind === 'call' && g.phase === 'flight') g.phase = 'loose';
        if (p.kind === 'grab') {
          g.ball = makeBallState(fromThree(p.from));
          g.ballMesh.position.copy(p.from);
        }
        g.ballMesh.visible = true;
        g.faceTarget = null;
        out.call = true;
      }
      if (++p.frames > 1) this.pickup = null;
    }
    return out;
  }

  /** Y pula; na defesa, RS para cima levanta as mãos e X dá o tapa; postura e deslize perto do atacante. */
  private defend(input: InputState, out: InputState, frozen: boolean): InputState {
    const g = this.game;
    const iOwn = this.state.offense === CpuSide;
    const withBall = iOwn && (g.phase === 'dribble' || g.phase === 'gather');
    const contestPressed = !!input.contest && !this.prevContest;
    this.prevContest = !!input.contest;
    const stealPressed = input.shoot && !this.prevSteal;
    this.prevSteal = input.shoot;
    if (!frozen && !withBall && contestPressed && this.animator.playContest(contestJumpM(this.card.vertical))) this.counts.jumps++;
    const defending = !frozen && !iOwn && !this.pickup;
    this.animator.setHandsUp(defending && input.proY > 0.5);
    if (defending) {
      if (stealPressed) this.trySteal();
      out = { ...out, shoot: false, proX: 0, proY: 0 };
    }
    const guarding = defending && this.state.ball === 'held' && !input.sprint;
    const stance = guarding ? stanceFor(distance2D(this.deps.game.position, g.position)) : 0;
    this.animator.setDefenseStance(stance);
    g.defenseSlide = slideFor(stance, this.card.perimeterDefense, false);
    if (this.animator.defenseState().jump > 0.01) out = { ...out, moveX: 0, moveY: 0, sprint: false };
    return out;
  }

  /** Tapa da CPU: sai sempre; com a bola do jogador no drible e ao alcance, o juiz sorteia com a exposição. */
  private trySteal(): void {
    const s = this.state;
    const nowMs = this.hub.serverNow();
    if (s.phase !== 'live' || s.ball !== 'held' || nowMs - this.lastStealTry < StealCooldownMs) return;
    this.lastStealTry = nowMs;
    const g = this.game;
    const h = this.deps.game;
    const ball = h.ballMesh.visible && (h.phase === 'dribble' || h.phase === 'gather') ? fromThree(h.ballMesh.position) : null;
    const toBall = ball ? ball.sub(g.position).flat() : g.facing;
    const right = new Vec3(-g.facing.y, g.facing.x, 0); // direita = cima × frente (eixos da Unreal)
    this.animator.playSteal(toBall.dot(right) >= 0 ? 'r' : 'l');
    this.counts.stealTries++;
    if (!ball || h.phase !== 'dribble') return;
    if (distance2D(ball, g.position) > this.card.wingspanCm / 200 + StealLungeM) return;
    const exp = ballExposure({
      ball: [ball.x, ball.y, ball.z],
      attacker: [h.position.x, h.position.y],
      defender: [g.position.x, g.position.y],
      bouncing: h.dribbler.mode !== 'held',
      protect: this.deps.animator.baseClip().startsWith('Dribble_Low'),
    });
    this.counts.stealSent++;
    this.hub.fromCpu({ t: 'g.steal', seq: s.seq, exp: +exp.toFixed(3) });
  }

  /** Contestação do jogador no arremesso da CPU (as mãos e o pulo dele de verdade, e a posição). */
  private contestOnMyShot(): number {
    const g = this.game;
    const human = this.deps.game.position;
    const d = distance2D(human, g.position);
    const real = this.deps.animator.defenseState();
    const handsUp = Math.max(real.handsUp, PassiveHands * clamp((ContestFarM - d) / (ContestFarM - ContestNearM), 0, 1));
    const release = g.position.withZ(this.animator.heightMeters + 0.25);
    const c = this.humanCard;
    const pose = makeDefenderPose({
      feetPosition: human.withZ(0),
      height: c.heightCm / 100,
      wingspan: c.wingspanCm / 100,
      handsUpAmount: handsUp,
      jumpHeight: real.jump,
      perimeterDefense: c.perimeterDefense,
    });
    const value = computeContest(pose, g.position.flat(), release, g.rimCenter()).contest;
    this.lastContest = { value: +value.toFixed(3), handsUp: +handsUp.toFixed(2), jump: +real.jump.toFixed(2), dist: +d.toFixed(2) };
    return value;
  }

  private onRelease(finish: boolean): void {
    const s = this.state;
    if (s.phase !== 'live' || s.offense !== CpuSide || this.releaseSent === s.seq) return;
    this.releaseSent = s.seq;
    this.releaseJumper = !finish;
    // Quem defende sabe na hora como contestou (docs/06 §5.1: mesmo quando a bola entra, o jogador sabe se fez o certo).
    const c = this.lastContest?.value ?? 0;
    if (!finish && c >= 0.7) this.match?.notice('Sufocado!', 'contestação perfeita', 1.1, 'good');
    else if (!finish && c >= 0.4) this.match?.notice('Contestado', '', 0.9, 'good');
    else if (!finish && c < 0.12) this.match?.notice('Livre!', 'arremesso sem marcação', 1, 'bad');
    this.counts.shots++;
    this.hub.fromCpu({ t: 'g.release', seq: s.seq });
    const g = this.game;
    this.releaseIsThree = g.layout.spec.isThreePointer(g.position, g.layout.rimFloorPoint, g.hoop.forward);
    this.blockWatch.reset(s.seq);
  }

  private onResult(record: ShotRecord): void {
    const s = this.state;
    if (this.releaseSent !== s.seq || s.offense !== CpuSide || this.resultSent === s.seq) return;
    this.resultSent = s.seq;
    this.hub.fromCpu({ t: 'g.result', seq: s.seq, scored: record.scored, isThree: record.isThree });
  }

  /** Depois do game.update da CPU: voo do arremesso dela, defesa sem bola, corpo a corpo, rebote e limpar a bola. */
  private afterUpdate(): void {
    const s = this.state;
    const g = this.game;
    const iOwn = s.offense === CpuSide;
    if (iOwn) {
      this.watchFinish();
      this.updateShotFlight();
    }
    if (!iOwn && !this.pickup) {
      if (g.phase !== 'loose' || g.ballMesh.visible) this.toDefense();
      g.faceTarget = this.deps.game.position;
    } else if (iOwn) {
      g.faceTarget = null;
    }
    if (s.phase === 'live' || s.phase === 'check') this.separateBodies();
    this.tryPickup();
    this.tryClear();
  }

  /** Toco do jogador no arremesso da CPU: o mesmo vigia do OnlineMatch, com o jogador de defensor. */
  private updateShotFlight(): void {
    const s = this.state;
    const g = this.game;
    const flying = this.releaseSent === s.seq && this.resultSent !== s.seq && this.scoredSeq !== s.seq && g.phase === 'flight';
    if (flying && !this.pendingBlock && g.ball.velocity.z > -5) this.watchBlock();
    const pb = this.pendingBlock;
    if (pb && this.clockS >= pb.at) {
      this.pendingBlock = null;
      if (pb.seq === s.seq && flying) {
        g.ball = makeBallState(g.ball.position, pb.vel, pb.spin);
        this.resultSent = s.seq;
        this.deps.sfx?.block?.();
        this.deps.impact?.(0.06);
        if (pb.goaltend) {
          this.hub.fromCpu({ t: 'g.result', seq: s.seq, scored: true, isThree: this.releaseIsThree });
          this.match?.notice('Interferência!', 'a cesta dele vale', 1.6, 'bad');
        } else {
          this.counts.blocks++;
          this.counts[this.releaseJumper ? 'blockJumper' : 'blockFinish']++;
          this.hub.fromCpu({ t: 'g.block', seq: s.seq });
        }
      }
    }
    if (this.releaseSent !== s.seq || this.resultSent === s.seq || this.scoredSeq === s.seq || g.phase !== 'flight') return;
    const b = g.ball;
    if (b.velocity.z < 0 && b.position.z < g.rimCenter().z - AirMissBelowRimM) {
      this.resultSent = s.seq;
      this.hub.fromCpu({ t: 'g.result', seq: s.seq, scored: false, isThree: false });
    }
  }

  /** O jogador como defensor agora (pulo e mãos exatos do animador dele). */
  private humanDefender(): BlockDefenderNow {
    const h = this.deps.game;
    const ha = this.deps.animator;
    const c = this.humanCard;
    return {
      feet: h.position.withZ(0),
      facing: h.facing,
      heightM: c.heightCm / 100,
      wingspanM: c.wingspanCm / 100,
      block: c.block,
      jump: ha.defenseJump(),
      handsUp: ha.defenseState().handsUp,
    };
  }

  /** Toco do jogador no aro, na bandeja/enterrada da CPU antes da soltura (o espelho do OnlineMatch.watchFinish). */
  private watchFinish(): void {
    const s = this.state;
    const g = this.game;
    if (s.phase !== 'live' || s.ball !== 'held') return;
    const f = g.finishState();
    if (!f || !f.airborne) return;
    this.blockWatch.reset(s.seq);
    const decision = finishBlock(this.blockWatch, this.clockS, g.rimCenter(), this.humanDefender(), f, this.blockRand);
    if (!decision) return;
    this.deps.animator.playBlock(decision.hand, decision.target, 0.06, decision.follow);
    if (decision.kind === 'miss' || !decision.velocity) return;
    if (!g.stripBall(decision.velocity, decision.spin ?? new Vec3(0, 18, 0))) return;
    this.resultSent = s.seq;
    this.counts.blocks++;
    this.counts.blockRim++;
    this.deps.sfx?.block?.();
    this.deps.impact?.(0.08);
    this.hub.fromCpu({ t: 'g.block', seq: s.seq });
  }

  private watchBlock(): void {
    const g = this.game;
    const ha = this.deps.animator;
    const decision = this.blockWatch.update(this.clockS, g.sim, g.ball, g.rimCenter(), this.humanDefender(), this.blockRand, this.releaseJumper);
    if (!decision) return;
    // A mão do jogador vai até a bola no instante do contato.
    ha.playBlock(decision.hand, decision.target, decision.at - this.clockS, decision.follow);
    if (decision.kind === 'miss' || !decision.velocity) return;
    this.pendingBlock = { seq: this.state.seq, at: decision.at, vel: decision.velocity, spin: decision.spin ?? new Vec3(0, 18, 0), goaltend: decision.goaltend };
  }

  /** Cada lado empurra o próprio jogador metade da sobreposição (o OnlineMatch faz a outra metade). */
  private separateBodies(): void {
    const g = this.game;
    const other = this.deps.game.position;
    const delta = g.position.sub(other).flat();
    const dist = delta.length2D();
    const min = 2 * BodyRadius;
    if (dist >= min) return;
    const dir = dist > 1e-4 ? delta.scale(1 / dist) : g.facing.scale(-1).flat();
    g.position = g.position.add(dir.scale((min - dist) * 0.5));
    const into = g.velocity.dot(dir);
    if (into < 0) g.velocity = g.velocity.sub(dir.scale(into));
  }

  private ballCore(): Vec3 | null {
    if (this.state.offense === CpuSide) {
      const g = this.game;
      return g.phase === 'flight' || g.phase === 'loose' ? g.ball.position : fromThree(g.ballMesh.position);
    }
    const h = this.deps.game;
    if (!h.ballMesh.visible) return null;
    return h.phase === 'flight' || h.phase === 'loose' ? h.ball.position : fromThree(h.ballMesh.position);
  }

  private tryPickup(): void {
    const s = this.state;
    if (s.phase !== 'live' || s.ball !== 'loose' || this.claimSent === s.seq || this.clockS < this.noClaimUntil) return;
    const g = this.game;
    const ball = this.ballCore();
    const jump = this.animator.defenseState().jump;
    const reachZ = jump > 0.05 ? Math.max(PickupHeight, this.animator.heightMeters * ReachPerHeight + jump - 0.15) : PickupHeight;
    // Um pouco menos de alcance que o jogador: num empate, a bola é de quem joga.
    if (!ball || ball.z > reachZ || distance2D(ball, g.position) > PickupRadius * 0.9) return;
    this.claimSent = s.seq;
    this.hub.fromCpu({ t: 'g.claim', seq: s.seq, at: [ball.x, ball.y, ball.z] });
  }

  private tryClear(): void {
    const s = this.state;
    if (s.phase !== 'live' || s.offense !== CpuSide || !s.needsClear || this.clearedSent === s.seq) return;
    const g = this.game;
    if (g.phase !== 'dribble') return;
    if (!g.layout.spec.isThreePointer(g.position, g.layout.rimFloorPoint, g.hoop.forward)) return;
    this.clearedSent = s.seq;
    this.hub.fromCpu({ t: 'g.cleared', seq: s.seq });
  }
}
