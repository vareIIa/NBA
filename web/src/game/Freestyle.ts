// Freestyle: jogador animado (GLB com os 38 clipes), drible com a bola na mão animada, dribles do Pro Stick pelo
// núcleo (DribbleController: commit, buffer, combo, misdirection, energia, arranque de saída), arremesso com a
// janela travada no gather e a decisão do ShotModel realizada pela física (realizeShot + BallSim a 120 Hz).
// Posições do jogador em coordenadas do núcleo; o three.js só desenha.
import * as THREE from 'three';
import {
  BallSim,
  type BallState,
  DribbleController,
  DribbleMove,
  type GatherCarry,
  HoopSpec,
  ProStickRecognizer,
  ReleaseSpeed,
  Rng,
  type ShotContext,
  type ShotDecision,
  type ShotEvaluation,
  ShotModel,
  ShotType,
  type TimingWindows,
  Vec3,
  clamp,
  cloneBallState,
  computeGatherCarry,
  coverageGradeLabel,
  defaultBallSimConfig,
  defaultGatherCarryTuning,
  distance2D,
  dribbleMoveLabel,
  exitBurstKindLabel,
  getDribbleMoveSpec,
  launchAngleForTiming,
  makeBallState,
  makeDribbleContext,
  makeShotContext,
  makeShotRealizeParams,
  realizeShot,
  timingGradeLabel,
  TimingGrade,
  upVector,
} from '../sim';
import type { Hand, MoveKind } from '../anim/ClipLibrary';
import type { PlayerAnimator } from '../anim/PlayerAnimator';
import { angularToThree, fromThree, toThree } from '../units';
import { BallDribbler } from './BallDribbler';
import { buildBall } from './BallMesh';
import { type CourtLayout, makeCourtLayout } from './Court';
import type { InputState } from './Input';

export type Phase = 'dribble' | 'gather' | 'flight' | 'return';

export interface ShotRecord {
  holdMs: number;
  timing: string;
  coverage: string;
  probability: number;
  make: boolean;
  scored: boolean;
  isThree: boolean;
  distance: number;
  type: string;
}

/** Eventos para HUD e som. */
export interface FreestyleEvents {
  onRelease?: (evaluation: ShotEvaluation, windows: TimingWindows) => void;
  onResult?: (record: ShotRecord) => void;
  onMove?: (label: string, detail: string) => void;
  onFloorBounce?: (speed: number) => void;
  onRim?: () => void;
  onScore?: () => void;
  onBoard?: () => void;
}

export const PlayerHeight = 1.96;
const JogSpeed = 3.9; // m/s com bola, sem RT
const SprintSpeed = 6.2; // com RT
const RetreatSpeed = 1.4; // m/s: recuo driblando (passada do loop de costas)
const Acceleration = 14; // m/s²
const Deceleration = 18;
const MoveAcceleration = 30; // durante um drible o impulso do movimento manda
const FixedStep = 1 / 120;

/** Drible do núcleo -> animação (clipe de mocap ou procedural). Double cross = dois crossovers. */
function moveKindFor(move: DribbleMove): MoveKind | null {
  switch (move) {
    case DribbleMove.Crossover:
    case DribbleMove.HesiCross:
    case DribbleMove.DoubleCross:
      return 'Cross';
    case DribbleMove.BehindBack:
      return 'BehindBack';
    case DribbleMove.AttackingCrossover:
      return 'EscapeCross';
    case DribbleMove.BetweenLegs:
      return 'BetweenLegs';
    case DribbleMove.Spin:
      return 'Spin';
    case DribbleMove.HalfSpin:
      return 'HalfSpin';
    case DribbleMove.Hesitation:
    case DribbleMove.EscapeHesitation:
    case DribbleMove.InAndOut:
      return 'Hesitation';
    case DribbleMove.StepBack:
    case DribbleMove.EscapeStepBack:
      return 'StepBack';
    // Retreat (LS para trás): o diretor recua andando alguns passos para trás driblando (2K, vídeo 19.46.14 7,4–9,8 s),
    // não com o saltinho do step-back de arremesso. Sem animação de drible: as pernas são as do loop de costas.
    case DribbleMove.Retreat:
      return null;
    default:
      return null;
  }
}

/** Troca de mão automática pelo LS (o "drible de transição" do jogo de referência): limiar, tempo e intervalo. */
const AutoSwitch = { stick: 0.55, holdSeconds: 0.1, cooldown: 0.55, walkMoveSpeed: 1.6 };

const sideOf = (hand: 'Right' | 'Left' | number): Hand => (hand === 0 || hand === 'Right' ? 'r' : 'l');

export class Freestyle {
  readonly layout: CourtLayout = makeCourtLayout();
  readonly hoop: HoopSpec;
  readonly sim: BallSim;
  readonly model = new ShotModel();
  readonly dribble = new DribbleController();
  readonly proStick = new ProStickRecognizer();
  readonly rng = new Rng(2026);
  readonly dribbler: BallDribbler;

  // Jogador (núcleo).
  position = new Vec3(7.6, -1.2, 0);
  velocity = new Vec3();
  facing = new Vec3(-1, 0, 0);
  private prevVelocityLocal = { right: 0, forward: 0 };

  phase: Phase = 'dribble';
  ball: BallState = makeBallState(); // só no voo (núcleo)

  // Drible em andamento (núcleo).
  private moveStart = -1;
  private moveDir = new Vec3(); // direção do impulso do movimento (núcleo, horizontal)
  private moveSpeed = 0;
  private moveCarry = new Vec3(); // embalo para a frente que o drible mantém (o bom jogador acelera no corte)
  private moveIsStepBack = false;
  private lastWish = 0; // tamanho do LS no último quadro (size-up: drible parado com o LS solto fica no lugar)
  private lastSprint = false; // RT no último quadro (com RT o mesmo comando vira escape e sai do lugar)
  private secondCrossAt = -1; // double cross: o segundo crossover
  private autoSwitchSince = -1;
  private retreatArmed = true;
  /** Achatamento da bola no quique (s restantes). */
  private squash = 0;

  // Arremesso.
  private gatherTime = 0;
  private context: ShotContext | null = null;
  windows: TimingWindows | null = null;
  holdMs = 0;
  private carry: GatherCarry | null = null;
  private carryDir = new Vec3();
  private decision: ShotDecision | null = null;
  private evaluation: ShotEvaluation | null = null;
  private flightTime = 0;
  private scoredThisShot = false;
  private returnFrom = new THREE.Vector3();
  private returnTime = 0;
  private accumulator = 0;
  private wasShooting = false;
  now = performance.now() / 1000;

  readonly history: ShotRecord[] = [];
  readonly moves: string[] = [];
  readonly ballMesh: THREE.Mesh;
  private readonly spinAxis = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    readonly animator: PlayerAnimator,
    private readonly events: FreestyleEvents = {},
  ) {
    this.hoop = HoopSpec.fromRimFloorPoint(this.layout.rimFloorPoint, new Vec3(1, 0, 0));
    this.sim = new BallSim(defaultBallSimConfig(), this.hoop);
    const radius = this.sim.getConfig().ball.radius;
    this.ballMesh = buildBall(radius);
    scene.add(this.ballMesh);
    scene.add(animator.root);
    this.dribbler = new BallDribbler(radius);
    this.syncRoot();
    animator.update(0, { right: 0, forward: 0, ballHand: 'r', hasBall: true, low: false, accelRight: 0, accelForward: 0 });
    this.dribbler.take('r', true);
    this.dribbler.update(0, animator);
    this.ballMesh.position.copy(this.dribbler.position);
  }

  rimCenter(): Vec3 {
    return this.hoop.rimCenter();
  }

  /** Direita do jogador. Eixos da Unreal (mão esquerda): direita = up × frente, como em HoopSpec.right(). */
  right(): Vec3 {
    return upVector().cross(this.facing).normalized(new Vec3(0, 1, 0));
  }

  /** Mão da bola no núcleo (Right/Left) -> mão da animação. */
  private coreHand(): Hand {
    return sideOf(this.dribble.getHand());
  }

  isMoving(): boolean {
    return this.velocity.length2D() > 0.4;
  }

  /** now = relógio real (s, performance.now): o timing do arremesso não pode depender do FPS. */
  update(now: number, dt: number, input: InputState, cameraForward: Vec3): void {
    this.now = now;
    const shootPressed = input.shoot && !this.wasShooting;
    const shootReleased = !input.shoot && this.wasShooting;
    this.wasShooting = input.shoot;

    // Referencial do ataque para o núcleo: cima = para onde a câmera olha (a cesta), x = direita da tela.
    const camForward = cameraForward.flat().normalized(new Vec3(-1, 0, 0));
    const camRight = upVector().cross(camForward).normalized();

    // Fora do drible o Pro Stick não é lido: zera o reconhecedor para o primeiro RS depois do arremesso não sair como
    // continuação de um gesto antigo (um meio giro fantasma).
    if (this.phase !== 'dribble') this.proStick.reset();
    if (this.phase === 'dribble') {
      this.updateProStick(input);
      this.updateTransitionDribbles(input);
      if (shootPressed && this.dribble.canCancel(now)) this.beginGather(input.shootEdgeTime);
    } else if (this.phase === 'gather') {
      this.updateGather(shootReleased, input.shootEdgeTime);
    }
    this.dribble.update(now, dt, input.sprint && this.isMoving(), this.isMoving());
    this.syncMoveStart();

    this.updateMovement(dt, input, camForward, camRight);

    if (this.phase === 'flight') this.updateFlight(dt);

    // Animação.
    this.syncRoot();
    const local = this.localVelocity();
    const accel = {
      right: (local.right - this.prevVelocityLocal.right) / Math.max(dt, 1e-3),
      forward: (local.forward - this.prevVelocityLocal.forward) / Math.max(dt, 1e-3),
    };
    this.prevVelocityLocal = local;
    this.animator.update(dt, {
      ...local,
      ballHand: this.dribbler.ballHand(),
      hasBall: this.phase === 'dribble' || this.phase === 'gather',
      low: input.protect,
      accelRight: clamp(accel.right, -12, 12),
      accelForward: clamp(accel.forward, -12, 12),
    });

    // Bola.
    if (this.phase === 'dribble' || this.phase === 'gather') {
      this.dribbler.setGrip(this.phase === 'gather' ? 'shot' : 'dribble');
      this.dribbler.update(dt, this.animator);
      for (const speed of this.dribbler.bounces) {
        this.events.onFloorBounce?.(speed);
        this.squash = 0.07;
      }
      this.ballMesh.position.copy(this.dribbler.position);
      this.ballMesh.rotation.x += dt * 9;
      // Achatamento no impacto: a bola "esmaga" ~15% no chão e volta (lê como um quique forte).
      this.squash = Math.max(0, this.squash - dt);
      const sq = this.squash > 0 ? Math.sin((Math.PI * this.squash) / 0.07) * 0.15 : 0;
      this.ballMesh.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
      if (sq > 0) this.ballMesh.position.y -= sq * this.sim.getConfig().ball.radius;
    } else if (this.phase === 'return') {
      this.updateReturn(dt);
    } else {
      this.syncFlightMesh(dt);
    }
  }

  private localVelocity(): { right: number; forward: number } {
    return { right: this.velocity.dot(this.right()), forward: this.velocity.dot(this.facing) };
  }

  private syncRoot(): void {
    toThree(this.position, this.animator.root.position);
    this.animator.root.rotation.y = Math.atan2(this.facing.x, this.facing.y);
    this.animator.root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ Pro Stick e dribles

  private updateProStick(input: InputState): void {
    // O núcleo espera o stick no referencial absoluto (cima = para a cesta, x = direita do jogador atacando).
    const gestures = this.proStick.update(this.now, input.proX, input.proY);
    for (const gesture of gestures) {
      const context = makeDribbleContext({ sprint: input.sprint, moving: this.isMoving() });
      const intent = this.dribble.resolveGesture(gesture, context, this.now);
      if (intent.move === DribbleMove.None) continue;
      this.dribble.request(intent.move, this.now, intent.redirect);
    }
  }

  /**
   * Dribles de transição pelo LS, como no jogo de referência: correndo para o lado da mão livre, o jogador troca a bola
   * de mão sozinho (crossover; entre as pernas devagar); puxando o LS para trás, sai num retreat dribble. Passam pelo
   * núcleo como qualquer drible (energia, commit, combo).
   */
  private updateTransitionDribbles(input: InputState): void {
    const now = this.now;
    if (this.dribble.isMoveActive(now) || !this.dribble.canCancel(now)) {
      this.autoSwitchSince = -1;
      return;
    }
    const hand = this.dribbler.ballHand();
    const towardFreeHand = (input.moveX > AutoSwitch.stick && hand === 'l') || (input.moveX < -AutoSwitch.stick && hand === 'r');
    const sinceLast = now - this.dribble.getLastMoveEndTime();
    if (towardFreeHand && this.dribbler.mode === 'held' && sinceLast > AutoSwitch.cooldown) {
      if (this.autoSwitchSince < 0) this.autoSwitchSince = now;
      if (now - this.autoSwitchSince >= AutoSwitch.holdSeconds) {
        const move = this.velocity.length2D() < AutoSwitch.walkMoveSpeed ? DribbleMove.BetweenLegs : DribbleMove.Crossover;
        this.dribble.request(move, now);
        this.autoSwitchSince = -1;
      }
    } else {
      this.autoSwitchSince = -1;
    }
    // Retreat: LS puxado para trás (uma vez por puxada).
    if (input.moveY < -0.6 && this.retreatArmed && sinceLast > 0.3) {
      this.dribble.request(DribbleMove.Retreat, now);
      this.retreatArmed = false;
    } else if (input.moveY > -0.3) {
      this.retreatArmed = true;
    }
  }

  /** Quando o núcleo começa um movimento (na hora, do buffer ou por misdirection), toca o clipe e dá o impulso. */
  private syncMoveStart(): void {
    const active = this.dribble.getActive();
    if (active.move === DribbleMove.None || active.startTime === this.moveStart) {
      if (this.secondCrossAt > 0 && this.now >= this.secondCrossAt && this.dribble.isMoveActive(this.now)) {
        this.secondCrossAt = -1;
        this.animator.playMove('Cross', this.dribbler.ballHand(), 0.38);
      }
      return;
    }
    this.moveStart = active.startTime;
    const spec = getDribbleMoveSpec(active.move);
    const duration = spec.duration / active.playRate;
    const kind = moveKindFor(active.move);
    const fromHand = sideOf(active.handAtStart);
    if (kind) {
      const first = active.move === DribbleMove.DoubleCross ? duration * 0.5 : duration;
      this.animator.playMove(kind, fromHand, first);
      this.secondCrossAt = active.move === DribbleMove.DoubleCross ? this.now + first : -1;
    }
    // Impulso do movimento: lateral para o lado da NOVA mão, frente/trás pelo núcleo.
    const newHandRight = this.coreHand() === 'r';
    const lateral = spec.lateralSpeed * (newHandRight ? 1 : -1);
    const dir = this.right().scale(lateral).add(this.facing.scale(spec.forwardSpeed));
    this.moveSpeed = dir.length2D();
    this.moveDir = dir.normalized(this.facing);
    // O bom jogador acelera durante o corte (Hashizume et al., ISBS 2014): o drible lateral mantém o embalo para a frente.
    const forwardNow = Math.max(0, this.velocity.dot(this.facing));
    this.moveIsStepBack = kind === 'StepBack';
    this.moveCarry = spec.forwardSpeed < 0 ? new Vec3() : this.facing.scale(forwardNow * 0.9);
    // Retreat: recua na velocidade da passada de costas (sem o arranque de 2 m/s, que virava um escorregão).
    if (active.move === DribbleMove.Retreat) this.moveSpeed = Math.min(this.moveSpeed, RetreatSpeed);
    // Spin / half spin: o deslocamento vem do pé de pivô (root motion do animador), não de um impulso.
    if (kind === 'Spin' || kind === 'HalfSpin') {
      this.moveSpeed = 0;
      this.moveCarry = new Vec3();
    }
    // Size-up (2K23 e jogo real): parado, com o LS solto e sem RT, o drible é no lugar; quem tira da base é o LS ou o
    // RT (escape: o mesmo comando segurando RT sai para o lado).
    // (O retreat vem do próprio LS, que ainda não aparece em lastWish no quadro em que ele começa: fica de fora.)
    const retreat = active.move === DribbleMove.Retreat;
    if (!retreat && !this.moveIsStepBack && !this.lastSprint && this.velocity.length2D() < 0.6 && this.lastWish < 0.2) {
      this.moveSpeed = 0;
      this.moveCarry = new Vec3();
    } else if (!retreat && !this.moveIsStepBack && this.lastSprint && this.velocity.length2D() < 0.6 && this.lastWish < 0.2) {
      // Escape parado (GIF de escape moves do 2K24): reposiciona para o lado da mão nova, sem atacar para a frente.
      this.moveSpeed = Math.abs(lateral);
      this.moveDir = this.right().scale(lateral).normalized(this.facing);
      this.moveCarry = new Vec3();
    }
    const label = dribbleMoveLabel(active.move);
    this.moves.push(label);
    this.events.onMove?.(label, active.redirected ? 'misdirection' : active.inRhythm ? `combo x${this.dribble.getComboCount()}` : '');
  }

  // ------------------------------------------------------------------ movimento

  private updateMovement(dt: number, input: InputState, camForward: Vec3, camRight: Vec3): void {
    const wish = camForward.scale(input.moveY).add(camRight.scale(input.moveX));
    this.lastWish = Math.hypot(input.moveX, input.moveY);
    this.lastSprint = input.sprint;
    const now = this.now;
    const active = this.dribble.getActive();
    const inMove = this.phase === 'dribble' && this.dribble.isMoveActive(now);

    if (this.phase === 'dribble' || this.phase === 'return' || this.phase === 'flight') {
      const maxSpeed = (input.sprint ? SprintSpeed : JogSpeed) * this.dribble.speedScale();
      let target = wish.scale(maxSpeed);
      let accel = wish.length2D() > 0.1 ? Acceleration : Deceleration;
      if (inMove) {
        // O drible dá a direção. Lateral/frente: o impulso cresce rápido e se mantém até o fim (acelera no corte, não
        // freia). Step-back/retreat: o salto para trás acontece no meio (empurrão, voo, aterrissagem).
        const alpha = clamp((now - active.startTime) / Math.max(0.05, active.endTime() - active.startTime), 0, 1);
        const profile = this.moveIsStepBack
          ? Math.sin(Math.PI * clamp((alpha - 0.06) / 0.62, 0, 1)) * 1.35
          : clamp(alpha / 0.3, 0, 1) ** 0.7;
        target = this.moveDir
          .scale(this.moveSpeed * profile)
          .add(this.moveCarry)
          .add(wish.scale(maxSpeed * (this.moveIsStepBack ? 0.1 : 0.3)));
        accel = MoveAcceleration;
      }
      // Arranque de saída (speedboost / cross launch): LS no referencial do ataque.
      const burst = this.dribble.tryExitBurst(now, input.moveX, input.moveY);
      if (burst.isValid()) {
        this.events.onMove?.('Arranque', exitBurstKindLabel(burst.kind));
      }
      const extra = this.dribble.exitBurstSpeed(now);
      if (extra > 0 && wish.length2D() > 0.1) target = target.add(wish.normalized().scale(extra));

      const delta = target.sub(this.velocity);
      const step = accel * dt;
      this.velocity = delta.length() <= step ? target : this.velocity.add(delta.normalized().scale(step));
    } else if (this.phase === 'gather' && this.carry) {
      // Pull-up sem frear (núcleo): o embalo do drible vira o gather e cai no plant.
      this.velocity = this.carryDir.scale(this.carry.speedAt(now - this.gatherTime));
    }

    this.position = this.position.add(this.velocity.scale(dt));
    // Root motion do spin: o corpo girou em volta do pé de pivô; o jogador vai junto (zero fora do giro).
    this.position = this.position.add(fromThree(this.animator.takeRootMotion()).withZ(0));
    const { baselineX, halfCourtX, halfWidth } = this.layout;
    this.position = new Vec3(
      clamp(this.position.x, baselineX + 0.3, halfCourtX - 0.3),
      clamp(this.position.y, -halfWidth + 0.3, halfWidth - 0.3),
      0,
    );

    this.updateFacing(dt, input, inMove);
  }

  /**
   * Orientação (docs/02 e o vídeo de referência): de frente para a cesta no size-up, no recuo e no deslize lateral para o
   * lado da mão livre; virado para onde corre no sprint, atacando a cesta ou indo para o lado da bola. Durante o
   * drible o corpo não gira (o spin gira só a malha).
   */
  private updateFacing(dt: number, input: InputState, inMove: boolean): void {
    if (inMove) return;
    const toRim = this.rimCenter().sub(this.position).flat().normalized(this.facing);
    const speed = this.velocity.length2D();
    let desired = toRim;
    if (this.phase === 'dribble' && speed > 1.0) {
      const dir = this.velocity.flat().normalized();
      const along = dir.dot(toRim);
      const rimRight = upVector().cross(toRim).normalized();
      const lateral = dir.dot(rimRight); // + = para a direita de quem olha a cesta
      const towardBallSide = (lateral > 0) === (this.dribbler.ballHand() === 'r');
      const strafe = !input.sprint && along < 0.55 && (along < -0.3 || !towardBallSide || speed < 2.2);
      desired = strafe ? toRim : dir;
    }
    const rate = this.phase === 'gather' ? 14 : speed > 3 ? 9 : 7;
    const turn = 1 - Math.exp(-rate * dt);
    this.facing = this.facing.add(desired.sub(this.facing).scale(turn)).flat().normalized(desired);
  }

  // ------------------------------------------------------------------ arremesso

  private beginGather(pressTime: number): void {
    const toRim = distance2D(this.position, this.layout.rimFloorPoint);
    const isThree = this.layout.spec.isThreePointer(this.position, this.layout.rimFloorPoint, this.hoop.forward);
    const entrySpeed = this.velocity.length2D();
    const type = entrySpeed > 1.5 ? ShotType.PullUp : ShotType.SpotUp;
    this.context = makeShotContext({
      rating: 85,
      distanceMeters: toRim,
      isThree,
      type,
      speed: ReleaseSpeed.Normal,
      fatigue: ShotModel.fatigueFromEnergy(this.dribble.getEnergy()),
      balance: 1,
    });
    // Janela travada no gather (docs/03): não muda mais até a soltura.
    this.windows = this.model.computeWindows(this.context);
    this.carry = computeGatherCarry(defaultGatherCarryTuning(), type, entrySpeed);
    this.carryDir = this.velocity.flat().normalized(this.facing);
    this.gatherTime = Math.min(pressTime, this.now);
    this.holdMs = 0;
    this.phase = 'gather';
    this.dribble.resetPossession();
    this.secondCrossAt = -1;
    // Arremessa com a mão da bola; o clipe acerta a soltura no centro do green.
    this.animator.playShot(this.dribbler.ballHand(), this.windows.idealReleaseMs / 1000);
    this.dribbler.take(this.dribbler.ballHand());
  }

  private updateGather(released: boolean, releaseTime: number): void {
    const windows = this.windows!;
    // Soltou: o tempo de segurar é o do evento, não o do quadro em que ele foi lido.
    this.holdMs = ((released ? Math.min(releaseTime, this.now) : this.now) - this.gatherTime) * 1000;
    const tuning = this.model.getTuning();
    const autoReleaseMs = windows.idealReleaseMs + tuning.autoReleaseAfterIdealMs;
    const autoRelease = !released && this.holdMs >= autoReleaseMs;
    if (autoRelease) this.holdMs = autoReleaseMs;
    if (released && this.holdMs < tuning.pumpFakeMaxHoldMs) {
      // Toque curto = pump fake: volta ao drible.
      this.phase = 'dribble';
      this.animator.playMove('Hesitation', this.dribbler.ballHand(), 0.4);
      return;
    }
    if (released || autoRelease) this.release();
  }

  private release(): void {
    const context = this.context!;
    const windows = this.windows!;
    // Sem defensor no Freestyle por enquanto: contestação zero.
    const evaluation = this.model.evaluate(context, windows, this.holdMs, 0);
    const decision = this.model.decide(evaluation, this.rng);
    const baseAngle = context.distanceMeters < 4 ? 55 : 50;
    // A bola sai de onde a mão animada está.
    const releasePosition = fromThree(this.dribbler.position);
    const params = makeShotRealizeParams({
      releasePosition,
      launchAngleDeg: launchAngleForTiming(baseAngle, evaluation.timing),
    });
    const realized = realizeShot(this.sim, decision, params, this.rng);
    this.evaluation = evaluation;
    this.decision = decision;
    this.ball = cloneBallState(realized.initial);
    this.flightTime = 0;
    this.scoredThisShot = false;
    this.accumulator = 0;
    this.phase = 'flight';
    if (evaluation.timing === TimingGrade.Green) this.animator.holdFollowThrough(0.9);
    this.events.onRelease?.(evaluation, windows);
  }

  private updateFlight(dt: number): void {
    this.flightTime += dt;
    this.accumulator += dt;
    while (this.accumulator >= FixedStep) {
      this.accumulator -= FixedStep;
      const ev = this.sim.tick(this.ball);
      if (ev.scored && !this.scoredThisShot) this.events.onScore?.();
      if (ev.scored) this.scoredThisShot = true;
      if (ev.hitRim) this.events.onRim?.();
      if (ev.hitBackboard) this.events.onBoard?.();
      if (ev.hitFloor) this.events.onFloorBounce?.(ev.floorImpactSpeed);
    }
    const resolved = this.scoredThisShot ? this.flightTime > 2.2 : this.flightTime > 2.8;
    if (resolved) {
      this.recordShot();
      this.returnFrom.copy(this.ballMesh.position);
      this.returnTime = 0;
      this.phase = 'return';
    }
  }

  private recordShot(): void {
    const evaluation = this.evaluation!;
    const context = this.context!;
    const record: ShotRecord = {
      holdMs: Math.round(this.holdMs),
      timing: timingGradeLabel(evaluation.timing),
      coverage: coverageGradeLabel(evaluation.coverage),
      probability: evaluation.probability,
      make: this.decision!.make,
      scored: this.scoredThisShot,
      isThree: context.isThree,
      distance: context.distanceMeters,
      type: context.type === ShotType.PullUp ? 'Pull-up' : 'Spot-up',
    };
    this.history.push(record);
    this.events.onResult?.(record);
  }

  /** Freestyle: a bola volta sozinha para a mão (passe do rebote). */
  private updateReturn(dt: number): void {
    this.returnTime += dt;
    const t = clamp(this.returnTime / 0.6, 0, 1);
    const hand = this.dribbler.gripPoint(this.animator, this.dribbler.ballHand(), 'dribble', new THREE.Vector3());
    const p = this.returnFrom.clone().lerp(hand, t);
    p.y += Math.sin(t * Math.PI) * 1.1;
    this.ballMesh.position.copy(p);
    this.dribbler.position.copy(p);
    if (t >= 1) {
      this.phase = 'dribble';
      this.dribbler.take(this.dribbler.ballHand());
    }
  }

  private syncFlightMesh(dt: number): void {
    toThree(this.ball.position, this.ballMesh.position);
    const w = angularToThree(this.ball.angularVelocity, this.spinAxis);
    const speed = w.length();
    if (speed > 1e-6) this.ballMesh.rotateOnWorldAxis(w.normalize(), speed * dt);
  }

  /** Para o HUD: ponto acima da cabeça (núcleo). */
  headPoint(): Vec3 {
    return this.position.withZ(PlayerHeight + 0.45);
  }
}
