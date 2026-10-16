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
  type StickGesture,
  ShotModel,
  ShotType,
  shotTypeLabel,
  type TimingWindows,
  Vec3,
  clamp,
  cloneBallState,
  computeGatherCarry,
  coverageGradeLabel,
  defaultBallSimConfig,
  defaultGatherCarryTuning,
  defaultProStickConfig,
  distance2D,
  dribbleMoveLabel,
  DunkDropMps,
  DunkRimHeightM,
  exitBurstKindLabel,
  FinishLaunchAngleDeg,
  finishHoldMs,
  finishKindFor,
  finishLiftM,
  finishRampMps,
  finishSchedule,
  FinishLandingSeconds,
  FinishRampMps2,
  FinishSpecs,
  finishUsesLeftHand,
  type FinishType,
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
import type { JumpShotSetup } from '../shot/JumpShotSetup';
import { pullUpMomentum } from '../shot/ShotForms';
import type { PlayerAnimator } from '../anim/PlayerAnimator';
import { angularToThree, fromThree, toThree } from '../units';
import { BallDribbler } from './BallDribbler';
import { buildBall } from './BallMesh';
import { type CourtLayout, makeCourtLayout } from './Court';
import type { InputState } from './Input';
import { approachVelocity, turnFacing } from './Movement';
import { LayupDriver, TapMaxSeconds } from './LayupDriver';
import { DunkRating, DunkTuning, HopStopTuning, LayupFinish, LayupGather, type LayupRequest, chooseDunk, type LayupPlan, type LayupSituation, type Side as LayupSide, chooseLayup, layupShotType, planHopStop, planStandingLayup } from '../sim/HoopsLayup';
import { HoldMove, HoldMoveLabels, HoldState, holdFinishFor } from '../sim/HoopsHold';
import { realizeLayupShot } from '../sim/HoopsLayupShot';
import { DefaultPlayRatings, type PlayRatings, jumpShotRating } from '../build/BuildRatings';

/** loose = a bola solta depois do arremesso (quica e assenta; volta para a mão só quando o jogador pede com A). */
export type Phase = 'dribble' | 'gather' | 'flight' | 'loose' | 'return';

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
  /** finish = bandeja ou enterrada: sem green, então o HUD não colore o medidor. */
  onRelease?: (evaluation: ShotEvaluation, windows: TimingWindows, finish?: boolean) => void;
  onResult?: (record: ShotRecord) => void;
  onMove?: (label: string, detail: string) => void;
  onFloorBounce?: (speed: number) => void;
  onRim?: () => void;
  onScore?: () => void;
  onBoard?: () => void;
  /**
   * Na soltura, antes da avaliação: badges e takeover mexem no contexto (badgeBonus, badgeContestScale). O timing já
   * é conhecido (Agent 3 e Pro Touch dependem dele); contest = contestação desta soltura.
   */
  modifyShot?: (context: ShotContext, timing: TimingGrade, contest: number) => void;
  /** A cada tick da física da bola em voo (1/120 s): a rede (HoopsNet) colide com a bola e a corrige no lugar. */
  onFlightTick?: (ball: BallState, dt: number) => void;
}

export { PlayerHeightMeters as PlayerHeight } from '../anim/ProceduralMoves';
const JogSpeed = 3.9; // m/s com bola, sem RT
const SprintSpeed = 6.2; // com RT
const RetreatSpeed = 1.4; // m/s: recuo driblando (passada do loop de costas)
// Arrancada e freada humanas: de parado a 3,9 m/s em ~0,6 s, como no 2K23 do diretor e no real (~6–7 m/s² no primeiro
// passo). Com 14 m/s² o corpo chegava à velocidade em 0,28 s, as pernas não acompanhavam e o pé de trás ficava 50 cm
// para trás (a perna "chutava" para trás ao sair do lugar); freando a 18 m/s² o pé patinava na parada.
const Acceleration = 6.5; // m/s²
const Deceleration = 14;
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
/**
 * Comando de drible esperando a bola voltar para a mão (s). Um drible só começa com a bola na mão: começar com ela no ar
 * fazia o braço cruzar sem bola e a bola mudar de rumo no meio do quique. Num combo, o próximo entra na recepção do
 * anterior (a conexão que dá a fluidez do 2K); um comando mais velho que isso é descartado.
 */
const PendingMoveSeconds = 0.45;
/** Dribles de corte: correndo, o corpo vira para a direção nova durante o drible (CutTurnRate, 1/s). */
const CutMoves = new Set<DribbleMove>([
  DribbleMove.Crossover,
  DribbleMove.AttackingCrossover,
  DribbleMove.BetweenLegs,
  DribbleMove.BehindBack,
  DribbleMove.DoubleCross,
  DribbleMove.HesiCross,
]);
const CutTurnRate = 7;
/** Voo: depois desse tempo a bola é solta mesmo sem tocar o chão (presa na rede). */
const FlightCapSeconds = 8;
/** Buffer do X: um aperto que cai com o drible ainda em commit vale por este tempo (s). */
const ShotBufferSeconds = 0.12;
/** Folga (s) para a bola sair: a mão a menos disto da soltura do desenho já conta como lá (meio quadro a 60 Hz). */
const ShotLaunchSlackS = 0.008;
/** Tolerância do RT: RT segurado até este tempo antes ou depois do X conta para a enterrada (s). */
const SprintGraceSeconds = 0.1;

const sideOf = (hand: 'Right' | 'Left' | number): Hand => (hand === 0 || hand === 'Right' ? 'r' : 'l');
const legacyStick = typeof location !== 'undefined' && new URLSearchParams(location.search).get('flick') === 'volta';

export class Freestyle {
  readonly layout: CourtLayout = makeCourtLayout();
  readonly hoop: HoopSpec;
  readonly sim: BallSim;
  readonly model = new ShotModel();
  readonly dribble = new DribbleController();
  // Flick lido na borda e giro no meio do gesto (?flick=volta lê os dois só na volta ao centro, como antes, para comparar
  // a latência).
  readonly proStick = new ProStickRecognizer({
    ...defaultProStickConfig(),
    earlyFlick: !legacyStick,
    earlyRotation: !legacyStick,
  });
  /** O drible pode começar com a bola ainda subindo para a mão (?bola=mao espera ela na mão, como antes). */
  moveBeforeCatch = typeof location === 'undefined' || new URLSearchParams(location.search).get('bola') !== 'mao';
  /** O impulso do drible espera junto com o clipe que espera a bola (`?impulso=relogio` volta ao relógio do núcleo). */
  syncImpulseToBall = typeof location === 'undefined' || new URLSearchParams(location.search).get('impulso') !== 'relogio';
  /** s que o drible atual ficou parado esperando a bola (a rampa do impulso desconta). */
  private moveBallHeld = 0;
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
  private lastWish = 0; // LS deste quadro (size-up: drible parado com o LS solto fica no lugar)
  private lastSprint = false; // RT deste quadro (com RT o mesmo comando vira escape e sai do lugar)
  private secondCrossAt = -1; // double cross: o segundo crossover
  private autoSwitchSince = -1;
  /** Comando de drible (gesto do Pro Stick ou drible de transição do LS) esperando a bola na mão. */
  private pendingMove: { gesture: StickGesture | null; move: DribbleMove; sprint: boolean; at: number } | null = null;
  private retreatArmed = true;
  /** Achatamento da bola no quique (s restantes). */
  private squash = 0;

  // Bandeja e enterrada (HoopsFinish): o gather vai até a soltura no tempo do clipe, sem janela de green.
  private finish: { kind: FinishType; releaseAt: number; forwardMps: number } | null = null;
  /** Bandeja pelo plano do núcleo (HoopsLayup): passadas, decolagem, voo e soltura (nba-24). A enterrada segue em `finish`. */
  readonly layup = new LayupDriver();
  /** Bandeja/enterrada pedida pelo RS, esperando o drible deixar (layupFromStick). */
  private stickFinish: { at: number; request: LayupRequest } | null = null;
  // Salto visual do boneco: parábola da decolagem até a aterrissagem (a física da bola segue no chão).
  private jump: { takeoffAt: number; apexDelayS: number } | null = null;
  private finishLift = 0; // m
  // Freio suave depois da soltura (HoopsFinish): a velocidade da soltura cai a zero em cosseno, sem seguir com o embalo.
  private landing: { startAt: number; v0: Vec3 } | null = null;

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
  private returnDuration = 0.6;
  private returnArc = 1.1;
  private accumulator = 0;
  private wasShooting = false;
  private wasCalling = false;
  // Último instante em que o RT estava segurado, e o aperto do X que ainda espera o drible sair do commit (-1 = nenhum).
  private sprintSeenAt = -Infinity;
  private shotQueuedAt = -1;
  private callQueued = false;
  /** Arremesso equipado no criador (undefined = o arremesso padrão do jogo). */
  private shotSetup: JumpShotSetup | undefined;
  /** O X já foi solto (nota decidida), mas a mão ainda não chegou à soltura do desenho: a bola sai quando chegar. */
  private shotLaunchPending = false;
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

  /** Laboratório: coloca o jogador parado num ponto, de frente para a cesta, com a bola na mão dada. */
  placeForLab(x: number, y: number, hand: Hand): void {
    this.position = new Vec3(x, y, 0);
    this.velocity = new Vec3();
    this.facing = this.rimCenter().sub(this.position).flat().normalized(new Vec3(-1, 0, 0));
    this.phase = 'dribble';
    this.dribble.resetPossession();
    this.dribble.setHand(hand === 'r' ? 0 : 1);
    this.syncRoot();
    this.dribbler.take(hand, true);
  }

  /** Arremesso equipado (criador do menu de pausa): vale a partir do próximo arremesso. */
  setShotSetup(setup: JumpShotSetup | undefined): void {
    this.shotSetup = setup;
  }

  /** Ratings da build ativa (MyPlayer Builder, docs/23). A build padrão dá os números de antes do builder. */
  private ratings: PlayRatings = DefaultPlayRatings;
  setRatings(ratings: PlayRatings): void {
    this.ratings = ratings;
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

  /** Bandeja ou enterrada em andamento: o HUD não mostra o medidor de timing. */
  get finishing(): boolean {
    return this.finish !== null || this.layup.busy;
  }

  isMoving(): boolean {
    return this.velocity.length2D() > 0.4;
  }

  /** now = relógio real (s, performance.now): o timing do arremesso não pode depender do FPS. */
  update(now: number, dt: number, input: InputState, cameraForward: Vec3): void {
    this.now = now;
    // syncMoveStart roda antes do movimento: LS e RT precisam ser do mesmo quadro do gesto.
    this.lastWish = Math.hypot(input.moveX, input.moveY);
    this.lastSprint = input.sprint;
    const shootPressed = input.shoot && !this.wasShooting;
    const shootReleased = !input.shoot && this.wasShooting;
    this.wasShooting = input.shoot;
    const callPressed = !!input.call && !this.wasCalling;
    this.wasCalling = !!input.call;

    // Referencial do ataque para o núcleo: cima = para onde a câmera olha (a cesta), x = direita da tela.
    const camForward = cameraForward.flat().normalized(new Vec3(-1, 0, 0));
    const camRight = upVector().cross(camForward).normalized();

    // Fora do drible o Pro Stick não é lido: zera o reconhecedor para o primeiro RS depois do arremesso não sair como
    // continuação de um gesto antigo (um meio giro fantasma).
    if (this.phase !== 'dribble') this.proStick.reset();
    // Buffer do X: o aperto vale por ShotBufferSeconds, mesmo que o drible ainda esteja no commit. O RT também é
    // lido aqui, para a tolerância de SprintGraceSeconds antes e depois do X.
    if (input.sprint) this.sprintSeenAt = now;
    if (shootPressed) this.shotQueuedAt = input.shootEdgeTime;
    if (this.shotQueuedAt >= 0 && now - this.shotQueuedAt > ShotBufferSeconds) this.shotQueuedAt = -1;
    if (this.phase !== 'dribble') {
      this.pendingMove = null;
      this.stickFinish = null;
    }
    if (this.phase === 'dribble') {
      this.updateProStick(input);
      this.updateTransitionDribbles(input);
      this.flushPendingMove();
      if (this.shotQueuedAt >= 0 && this.dribble.canCancel(now)) {
        const press = this.shotQueuedAt;
        this.shotQueuedAt = -1;
        const finish = this.finishFor(press);
        // Perto do aro: enterrada (RT) ou bandeja pelo plano; o caminho antigo (clipe) só se o plano não couber; senão
        // arremesso.
        const dunk = this.ratings.canDunk && this.sprintSeenAt >= press - SprintGraceSeconds;
        if (!this.tryLayup(press, input, dunk)) {
          if (finish !== null) this.beginFinish(finish, press);
          else this.beginGather(press);
        }
      } else if (this.stickFinish && this.dribble.canCancel(now)) {
        // RS dirigindo para a cesta (layupFromStick): bandeja/enterrada pedida, quando o drible deixar.
        const { at, request } = this.stickFinish;
        this.stickFinish = null;
        if (now - at <= ShotBufferSeconds) this.tryLayup(at, input, request.command === 'dunk', request);
      } else if (this.layup.pendingAlive(now)) {
        this.updatePendingLayup(input);
      }
    } else if (this.phase === 'gather' && this.layup.busy) {
      this.updateLayup(input, shootPressed);
    } else if (this.phase === 'gather') {
      // Tolerância do RT: RT logo depois do X vira enterrada, enquanto a bandeja ainda não soltou.
      const upgraded = !this.finish && !shootReleased && input.sprint && this.upgradeToDunk();
      if (this.finish) this.updateFinish();
      else if (!upgraded) this.updateGather(shootReleased, input.shootEdgeTime);
    }
    // Pendurado no aro depois da enterrada: soltar o X solta o aro (o corpo segue o plano até pousar).
    if (this.layup.hanging) this.layup.updateHang(now, this.holdingRim(input));
    // A na subida fica na fila: a bola vem para a mão assim que assentar (e, pendurado no aro, quando ele pousar).
    const hangPlan = this.layup.plan?.hang ? this.layup.plan : null;
    const airborneFinish = hangPlan !== null && this.layup.time(now) < hangPlan.landAt;
    if (callPressed && (this.phase === 'flight' || airborneFinish)) this.callQueued = true;
    if (this.phase === 'loose' && !airborneFinish && (callPressed || this.callQueued)) {
      this.callQueued = false;
      this.callBall();
    }
    this.dribble.update(now, dt, input.sprint && this.isMoving(), this.isMoving());
    this.syncMoveStart();

    this.updateMovement(dt, input, camForward, camRight);

    // Bola solta: a física avança antes do voo, para que o quadro em que o voo assenta não conte o dt duas vezes.
    if (this.phase === 'loose') this.settleBall(dt);
    if (this.phase === 'flight') this.updateFlight(dt);

    // Animação.
    this.updateJump();
    this.syncRoot();
    const local = this.localVelocity();
    const accel = {
      right: (local.right - this.prevVelocityLocal.right) / Math.max(dt, 1e-3),
      forward: (local.forward - this.prevVelocityLocal.forward) / Math.max(dt, 1e-3),
    };
    this.prevVelocityLocal = local;
    this.animator.ballInHand = this.dribbler.mode === 'held';
    this.animator.ballWorld.copy(this.dribbler.position);
    if (this.layup.plan) this.animator.layupTime = this.layup.time(now);
    this.animator.update(dt, {
      ...local,
      ballHand: this.dribbler.ballHand(),
      hasBall: this.phase === 'dribble' || this.phase === 'gather',
      low: input.protect,
      accelRight: clamp(accel.right, -12, 12),
      accelForward: clamp(accel.forward, -12, 12),
    });
    // Fim da bandeja: só depois que o animador rodou com o tempo no fim do plano (é ali que ele fecha a ação; parar de
    // dar o tempo antes congelava o corpo na última pose).
    if (this.layup.plan && this.layup.time(now) >= this.layup.plan.endAt) this.layup.end();

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
    this.animator.root.position.y += this.finishLift;
    this.animator.root.rotation.y = Math.atan2(this.facing.x, this.facing.y);
    this.animator.root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ Pro Stick e dribles

  private updateProStick(input: InputState): void {
    // O núcleo espera o stick no referencial absoluto (cima = para a cesta, x = direita do jogador atacando).
    const gestures = this.proStick.update(this.now, input.proX, input.proY);
    for (const gesture of gestures) {
      if (this.layupFromStick(gesture, input)) continue; // RS dirigindo para a cesta = bandeja/enterrada (sessão das enterradas)
      const context = makeDribbleContext({ sprint: input.sprint, moving: this.isMoving() });
      const intent = this.dribble.resolveGesture(gesture, context, this.now);
      if (intent.move === DribbleMove.None) continue;
      // O gesto é guardado (o mais novo vale) e lido de novo quando a bola estiver na mão: a mão da bola pode mudar até lá.
      this.pendingMove = { gesture, move: intent.move, sprint: input.sprint, at: this.now };
    }
  }

  /**
   * A bola está pronta para o drible `move`? Na mão (e não levada por um drible procedural ainda sem soltar) ou já
   * subindo para ela, perto o bastante para chegar antes da soltura do drible (animator.moveBallLead): o corpo entra no
   * drible na hora e o empurrão espera a bola. Correndo a bola fica pouco tempo na mão, e esperar por ela inteira
   * atrasava o drible até ~270 ms.
   */
  private ballReadyForMove(move: DribbleMove): boolean {
    if (this.animator.ballHeldLocal || !this.animator.moveBallReturned()) return false;
    if (this.dribbler.mode === 'held') return true;
    if (!this.moveBeforeCatch) return false;
    const kind = moveKindFor(move);
    if (!kind || !this.dribbler.ascending()) return false;
    const duration = getDribbleMoveSpec(move).duration / this.dribble.movePlayRateScale();
    return this.dribbler.timeToCatch() <= this.animator.moveBallLead(kind, duration);
  }

  /** Começa o comando que esperava a bola voltar para a mão. */
  private flushPendingMove(): void {
    const P = this.pendingMove;
    if (!P) return;
    if (this.now - P.at > PendingMoveSeconds) {
      this.pendingMove = null;
      return;
    }
    // O gesto é relido agora (a mão da bola pode ter mudado desde o comando).
    let move = P.move;
    let redirect = false;
    if (P.gesture) {
      const context = makeDribbleContext({ sprint: P.sprint, moving: this.isMoving() });
      const intent = this.dribble.resolveGesture(P.gesture, context, this.now);
      move = intent.move;
      redirect = intent.redirect;
    }
    if (move !== DribbleMove.None && !this.ballReadyForMove(move)) return;
    this.pendingMove = null;
    if (move !== DribbleMove.None) this.dribble.request(move, this.now, redirect);
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
        if (!this.pendingMove) this.pendingMove = { gesture: null, move, sprint: input.sprint, at: now };
        this.autoSwitchSince = -1;
      }
    } else {
      this.autoSwitchSince = -1;
    }
    // Retreat: LS puxado para trás (uma vez por puxada).
    if (input.moveY < -0.6 && this.retreatArmed && sinceLast > 0.3) {
      if (!this.pendingMove) this.pendingMove = { gesture: null, move: DribbleMove.Retreat, sprint: input.sprint, at: now };
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
    this.moveBallHeld = 0;
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
    // O retreat tem seu próprio impulso de recuo e fica fora das regras do size-up parado.
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
    // Bandeja: o corpo é do plano do gather até ficar de pé depois do pouso (sem input no meio).
    // O jogador voltou a driblar (laboratório reposicionou, bola devolvida): a bandeja/bola presa acabou.
    if (this.phase === 'dribble' && this.layup.busy) this.layup.end();
    if (this.layup.controls(this.now)) {
      this.moveByLayup(dt);
      return;
    }
    const now = this.now;
    const active = this.dribble.getActive();
    const inMove = this.phase === 'dribble' && this.dribble.isMoveActive(now);

    if (this.phase === 'dribble' || this.ballFree()) {
      // Velocidade pela direção em relação ao corpo: de frente corre, de lado desliza (size-up) e para trás recua mais
      // devagar, como no jogo real (e a passada da animação acompanha, sem patinar).
      const wishDir = wish.length2D() > 1e-3 ? wish.normalized() : this.facing;
      const along = wishDir.dot(this.facing);
      // Para trás: ~1,4 m/s, a passada do loop de costas (Dribble_Back anda 1,36 m/s); o diretor recua devagar, alguns
      // passos (vídeo 19.46.14 7,4–9,8 s: ~1,5 m em 2,2 s). Mais rápido, o clipe não acompanhava e o pé escorregava.
      const directional = along >= 0 ? 0.55 + 0.45 * along * along : 0.55 - 0.2 * -along;
      const buildSpeed = this.ballFree() ? this.ratings.runSpeedScale : this.ratings.speedScale; // Velocidade / com bola
      const maxSpeed = (input.sprint ? SprintSpeed : JogSpeed) * this.dribble.speedScale() * directional * buildSpeed;
      let target = wish.scale(maxSpeed);
      let accel = Acceleration * this.ratings.accelScale;
      if (inMove) {
        // O drible dá a direção. Lateral/frente: o impulso cresce rápido e se mantém até o fim (acelera no corte, não
        // freia). Step-back/retreat: o salto para trás acontece no meio (empurrão, voo, aterrissagem).
        // Enquanto o clipe espera a bola chegar à mão (animator.waitingForBall), a rampa do impulso também espera; depois
        // ela cabe no que sobra até o fim do núcleo (as janelas de combo continuam as do núcleo).
        if (this.syncImpulseToBall && this.animator.waitingForBall()) this.moveBallHeld += dt;
        const span = Math.max(0.05, active.endTime() - active.startTime - this.moveBallHeld);
        const alpha = clamp((now - active.startTime - this.moveBallHeld) / span, 0, 1);
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

      // No ar depois da soltura do jump shot: sem controle até pousar (como no 2K); o embalo do salto continua. Correndo
      // no ar, o corpo do arremesso deslizava e os pés pousavam longe do corpo.
      if (this.ballFree() && this.animator.shotAirborne()) target = this.velocity;
      this.velocity = approachVelocity(this.velocity, target, dt, accel, inMove ? MoveAcceleration : Deceleration);
    } else if (this.phase === 'gather' && this.finish) {
      // Bandeja/enterrada (UE: UpdateFinish): rumo à cesta na velocidade combinada, com rampa a partir da velocidade atual
      // (sem o salto de zero para a velocidade de entrada num quadro só). Sem input até a soltura.
      const rim = this.layout.rimFloorPoint;
      const target = rim.sub(this.position).flat().normalized(this.facing).scale(this.finish.forwardMps);
      const delta = target.sub(this.velocity);
      const step = FinishRampMps2 * dt;
      this.velocity = delta.length() <= step ? target : this.velocity.add(delta.normalized().scale(step));
    } else if (this.phase === 'gather' && this.carry) {
      // Pull-up sem frear (núcleo): o embalo do drible vira o gather e cai no plant.
      this.velocity = this.carryDir.scale(this.carry.speedAt(now - this.gatherTime));
    }

    // Depois da soltura da bandeja: freio em cosseno até zero (FinishLandingSeconds), sem o embalo seco.
    if (this.landing) {
      const t = (now - this.landing.startAt) / FinishLandingSeconds;
      if (t >= 1) {
        this.landing = null;
        this.velocity = new Vec3();
      } else {
        this.velocity = this.landing.v0.scale(0.5 * (1 + Math.cos(Math.PI * t)));
      }
    }
    this.position = this.position.add(this.velocity.scale(dt));
    // Root motion do spin: o corpo girou em volta do pé de pivô; o jogador vai junto (zero fora do giro).
    this.position = this.position.add(fromThree(this.animator.takeRootMotion()).withZ(0));
    // Deriva do jump shot (fade para trás do Dirk, pouso à frente do Curry): o jogador vai junto com o corpo.
    this.position = this.position.add(fromThree(this.animator.takeShotDrift()).withZ(0));
    const { baselineX, halfCourtX, halfWidth } = this.layout;
    const bounded = new Vec3(
      clamp(this.position.x, baselineX + 0.3, halfCourtX - 0.3),
      clamp(this.position.y, -halfWidth + 0.3, halfWidth - 0.3),
      0,
    );
    // Na linha da quadra a velocidade para dentro dela some: presa só a posição, as pernas seguiam correndo a 4 m/s no
    // lugar e os pés saltavam ~12 cm por quadro.
    if (bounded.x !== this.position.x) this.velocity = new Vec3(0, this.velocity.y, 0);
    if (bounded.y !== this.position.y) this.velocity = new Vec3(this.velocity.x, 0, 0);
    this.position = bounded;

    this.updateFacing(dt, input, inMove);
  }

  /**
   * Orientação (docs/02 e o vídeo de referência): de frente para a cesta no size-up, no recuo e no deslize lateral para o
   * lado da mão livre; virado para onde corre no sprint, atacando a cesta ou indo para o lado da bola. Durante o
   * drible o corpo não gira (o spin gira só a malha).
   */
  private updateFacing(dt: number, input: InputState, inMove: boolean): void {
    if (inMove) {
      // Corte correndo (crossover, entre as pernas, por trás): depois que a bola sai da mão o corpo vira para o lado novo,
      // como no 2K. Travado até o fim do drible, o jogador corria na diagonal ainda de frente para a cesta (~0,4 s de
      // passo lateral a 4,6 m/s).
      const move = this.dribble.getActive().move;
      const speed = this.velocity.length2D();
      if (!CutMoves.has(move) || speed < 2 || !this.animator.moveBallReleased()) return;
      const dir = this.velocity.flat().normalized(this.facing);
      if (dir.dot(this.facing) < -0.2) return;
      this.facing = turnFacing(this.facing, dir, CutTurnRate, dt);
      return;
    }
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
    } else if (this.ballFree()) {
      // Sem a bola na mão o boneco é livre: vira para onde corre e, parado, mantém a frente (não volta para a cesta).
      desired = speed > 0.8 ? this.velocity.flat().normalized(this.facing) : this.facing;
    }
    const rate = this.phase === 'gather' ? 14 : speed > 3 ? 9 : 7;
    this.facing = turnFacing(this.facing, desired, rate, dt);
  }

  // ------------------------------------------------------------------ arremesso

  private beginGather(pressTime: number): void {
    const toRim = distance2D(this.position, this.layout.rimFloorPoint);
    const isThree = this.layout.spec.isThreePointer(this.position, this.layout.rimFloorPoint, this.hoop.forward);
    const entrySpeed = this.velocity.length2D();
    const type = entrySpeed > 1.5 ? ShotType.PullUp : ShotType.SpotUp;
    this.context = makeShotContext({
      rating: jumpShotRating(this.ratings, isThree, toRim),
      distanceMeters: toRim,
      isThree,
      type,
      speed: this.shotSetup?.releaseSpeed ?? ReleaseSpeed.Normal,
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
    // O clipe chega à soltura no tempo do aperto, mesmo quando o X foi bufferizado.
    const idealS = this.windows.idealReleaseMs / 1000 - Math.max(0, this.now - pressTime);
    // Pull-up: o desenho recebe o embalo (planta os pés à frente, freia e sobe alto); o carry anda a raiz até a decolagem.
    const carry = this.carry;
    const lag = Math.max(0, this.now - this.gatherTime);
    const pullUp =
      type === ShotType.PullUp
        ? { momentum: pullUpMomentum(entrySpeed), carry: { dir: toThree(this.carryDir).normalize(), speedAt: (t: number) => carry.speedAt(t + lag) } }
        : undefined;
    this.animator.playShot(this.dribbler.ballHand(), Math.max(0.2, idealS), this.shotSetup, true, pullUp);
    this.shotLaunchPending = false;
    this.dribbler.take(this.dribbler.ballHand());
  }

  private updateGather(released: boolean, releaseTime: number): void {
    // Soltou o X antes de a mão chegar à soltura (como no 2K): a nota já está decidida e a bola sai quando ela chegar.
    if (this.shotLaunchPending) {
      if (this.animator.shotReleaseIn() <= ShotLaunchSlackS) this.release();
      return;
    }
    const windows = this.windows!;
    // Soltou: o tempo de segurar é o do evento, não o do quadro em que ele foi lido.
    this.holdMs = ((released ? Math.min(releaseTime, this.now) : this.now) - this.gatherTime) * 1000;
    const tuning = this.model.getTuning();
    const autoReleaseMs = windows.idealReleaseMs + tuning.autoReleaseAfterIdealMs;
    const autoRelease = !released && this.holdMs >= autoReleaseMs;
    if (autoRelease) this.holdMs = autoReleaseMs;
    if (released && this.holdMs < tuning.pumpFakeMaxHoldMs) {
      // Toque curto = pump fake: volta ao drible. Dirigindo para a cesta, o toque é hop step (bandejas, nba-9f).
      if (this.hopFromShotTap()) return;
      this.phase = 'dribble';
      this.animator.playMove('Hesitation', this.dribbler.ballHand(), 0.4);
      return;
    }
    if (released || autoRelease) {
      if (this.animator.shotReleaseIn() > ShotLaunchSlackS) this.shotLaunchPending = true;
      else this.release();
    }
  }

  // ------------------------------------------------------------------ bandeja e enterrada

  /**
   * O X perto do aro dispara bandeja ou enterrada (regra da UE, BeginShot); fora disso, arremesso normal. O RT vale se
   * foi segurado até SprintGraceSeconds antes do X.
   */
  private finishFor(pressTime: number, sprint = this.sprintSeenAt >= pressTime - SprintGraceSeconds): FinishType | null {
    const rim = this.layout.rimFloorPoint;
    const toRim = rim.sub(this.position).flat().normalized(this.facing);
    // Build sem enterrada (Enterrada/Impulsão abaixo do mínimo): o RT perto do aro vira bandeja.
    return finishKindFor(distance2D(this.position, rim), this.velocity.flat().dot(toRim), sprint && this.ratings.canDunk);
  }

  /** Arremesso parado que ainda não soltou: se o RT entrar até SprintGraceSeconds depois do X e der enterrada, vira enterrada. */
  private upgradeToDunk(): boolean {
    if (this.now - this.gatherTime > SprintGraceSeconds) return false;
    const kind = this.finishFor(this.gatherTime, true);
    if (kind !== ShotType.Dunk) return false;
    if (!this.tryStandingDunk()) this.beginFinish(kind, this.gatherTime);
    return true;
  }

  /** Parado perto do aro com RT: enterrada de dois pés pelo plano (duas mãos ou cock-back), se alcança o aro. */
  private tryStandingDunk(): boolean {
    if (!this.ratings.canDunk || !this.ratings.dunk.standing) return false;
    const sit = this.layupSituation();
    if (sit.position.sub(sit.rimFloor).length2D() > DunkTuning.standMaxM) return false;
    const choice = chooseDunk({ ...sit, velocity: new Vec3() }, { command: 'dunk', sprint: false }, this.rng.nextDouble());
    if (this.layup.forceDunk !== null) choice.finish = this.layup.forceDunk;
    const plan = planStandingLayup(choice, { ...sit, velocity: new Vec3(), feet: { l: { ...sit.feet.l, planted: true }, r: { ...sit.feet.r, planted: true } } }, DunkRating);
    if (plan.rise >= this.ratings.dunk.riseMax - 1e-6) return false;
    this.layup.shotPress = null;
    this.beginLayup(plan, this.now);
    return true;
  }

  /**
   * Bandeja ou enterrada (UE: BeginFinish). O clipe vai do gather à soltura e o boneco decola no quadro da decolagem.
   * Não tem green: a soltura cai no tempo do clipe, e o acerto vem do ShotModel com a janela travada no gather.
   */
  private beginFinish(kind: FinishType, pressTime: number): void {
    const rim = this.layout.rimFloorPoint;
    const dist = distance2D(this.position, rim);
    const toRim = rim.sub(this.position).flat().normalized(this.facing);
    // + = à direita de quem olha a cesta
    const side = this.position.sub(rim).flat().dot(upVector().cross(toRim).normalized());
    const dunk = kind === ShotType.Dunk;
    // Bandeja pela mão do lado do aro por onde entra; a enterrada fica com a mão da bola.
    let hand: Hand = this.dribbler.ballHand();
    if (!dunk) hand = finishUsesLeftHand(side, hand === 'l') ? 'l' : 'r';
    const gatherAt = Math.min(pressTime, this.now);
    const airtime = FinishSpecs[kind].releaseSeconds;
    // O clipe começa agora, mas a soltura conta do aperto: o tempo que já passou (buffer do X) sai do clipe.
    const remaining = Math.max(0.1, airtime - (this.now - gatherAt));
    const schedule = finishSchedule(kind, remaining);
    this.gatherTime = gatherAt;
    this.context = makeShotContext({
      rating: clamp(FinishSpecs[kind].rating + (dunk ? this.ratings.dunkOffset : this.ratings.layupOffset), 25, 99),
      distanceMeters: dist,
      isThree: false,
      type: kind,
      speed: ReleaseSpeed.Normal,
      fatigue: ShotModel.fatigueFromEnergy(this.dribble.getEnergy()),
      balance: 1,
    });
    this.windows = this.model.computeWindows(this.context);
    this.carry = null;
    this.holdMs = 0;
    this.landing = null;
    this.finish = { kind, releaseAt: gatherAt + airtime, forwardMps: finishRampMps(dist, kind, remaining) };
    this.jump = { takeoffAt: this.now + schedule.takeoffS, apexDelayS: schedule.apexDelayS };
    this.phase = 'gather';
    this.dribble.resetPossession();
    if (hand !== this.dribbler.ballHand()) this.dribble.setHand(hand === 'r' ? 0 : 1);
    this.secondCrossAt = -1;
    this.dribbler.take(hand);
    this.animator.playFinish(dunk, hand, FinishSpecs[kind].timing, remaining);
  }

  /** Bandeja/enterrada: sem janela de soltura; a bola sai quando o clipe chega à soltura. */
  private updateFinish(): void {
    if (this.now >= this.finish!.releaseAt) this.releaseFinish();
  }

  // ------------------------------------------------------------------ bandeja pelo plano (nba-24, docs/21-bandejas.md)

  /** Situação da bandeja agora, no núcleo: jogador, pés (do animador) e cesta. */
  private layupSituation(): LayupSituation {
    const feet = this.animator.feetState();
    return {
      position: this.position.flat(),
      velocity: this.velocity.flat(),
      facing: this.facing,
      rimFloor: this.layout.rimFloorPoint,
      hoopForward: this.hoop.forward,
      ballHand: this.dribbler.ballHand(),
      feet: {
        l: { pos: fromThree(feet.l.ankle).flat(), planted: feet.l.planted },
        r: { pos: fromThree(feet.r.ankle).flat(), planted: feet.r.planted },
      },
      heightM: this.animator.heightMeters, // altura da build (o boneco escala com ela)
      dunk: this.ratings.dunk,
      baselineX: this.layout.baselineX,
    };
  }

  /** X perto do aro: bandeja pelo plano, ou espera se o X veio cedo. false = não é bandeja (enterrada antiga ou arremesso). */
  private tryLayup(press: number, input: InputState, dunk = false, forced?: LayupRequest): boolean {
    const sit = this.layupSituation();
    // Se o X for para o arremesso, o toque dirigindo vira hop step (hopFromShotTap): guarda a corrida de agora.
    if (!forced) this.layup.shotPress = { at: press, velocity: sit.velocity, lateral: this.hopLateral(input) };
    let request = forced ?? this.layup.requestFor(sit, input.sprint, input.protect, dunk);
    // Parado (ou quase) perto do aro com RT: enterrada de dois pés.
    if (dunk && !forced && !input.protect && sit.velocity.length2D() < 1.0 && this.tryStandingDunk()) return true;
    if (!request) return false;
    let plan = this.layup.plan_(request, sit, this.rng.nextDouble());
    // Não dá para enterrar daqui (perto demais ou não alcança o aro): bandeja.
    if (plan === null && request.command === 'dunk') {
      request = this.layup.requestFor(sit, input.sprint, input.protect);
      plan = request ? this.layup.plan_(request, sit, this.rng.nextDouble()) : null;
    }
    if (plan === null || !request) return false;
    if (plan === 'wait') {
      this.layup.pending = { at: press, request, fromStick: !!forced };
      return true;
    }
    this.beginLayup(plan, press, false, !!forced);
    return true;
  }

  /**
   * RS no drible dirigindo para a cesta, dentro da zona: vira a bandeja/enterrada que ele pede (LayupDriver.stickRequest)
   * em vez de um drible. Fica na fila até o drible deixar (como o X).
   */
  private layupFromStick(gesture: StickGesture, input: InputState): boolean {
    if (this.layup.busy || this.phase !== 'dribble') return false;
    const request = this.layup.stickRequest(gesture, this.layupSituation(), input.sprint, this.ratings.canDunk && this.ratings.dunk.driving);
    if (!request) return false;
    this.stickFinish = { at: this.now, request };
    return true;
  }

  /** Segura o aro: X segurado ou RS segurado para baixo (2K: RT + RS baixo segurado). */
  private holdingRim(input: InputState): boolean {
    return input.shoot || input.proY < -0.6;
  }

  /** X que veio cedo: a cada quadro tenta de novo; começa quando os dois passos alcançam o aro. */
  private updatePendingLayup(input: InputState): void {
    if (!this.dribble.canCancel(this.now)) return;
    const pending = this.layup.pending!;
    // Toque no X que esperava o aro chegar: é hop step, já (não precisa alcançar o aro). O pedido do RS não tem toque.
    if (!pending.fromStick && !input.shoot && input.shootEdgeTime - pending.at < TapMaxSeconds) {
      this.layup.pending = null;
      this.beginLayup(planHopStop(this.layupSituation(), this.hopLateral(input)), pending.at, true);
      return;
    }
    const plan = this.layup.plan_(pending.request, this.layupSituation(), this.rng.nextDouble());
    if (plan && plan !== 'wait') this.beginLayup(plan, pending.at, false, !!pending.fromStick);
  }

  private beginLayup(plan: LayupPlan, pressAt: number, hopStop = false, fromStick = false): void {
    const hand = plan.choice.hand;
    if (hopStop) this.layup.beginHopStop(plan, this.now, pressAt);
    else this.layup.begin(plan, this.now, pressAt, fromStick);
    this.gatherTime = this.now;
    this.setLayupContext(plan);
    this.carry = null;
    this.holdMs = 0;
    this.landing = null;
    this.finish = null;
    this.jump = null;
    this.finishLift = 0;
    this.phase = 'gather';
    this.dribble.resetPossession();
    if (hand !== this.dribbler.ballHand()) this.dribble.setHand(hand === 'r' ? 0 : 1);
    this.secondCrossAt = -1;
    this.pendingMove = null;
    this.dribbler.take(hand);
    this.animator.playLayup(plan, this.dribbler.position);
    this.events.onMove?.(this.layup.label, plan.rim ? 'enterrada' : 'bandeja');
  }

  /** Contexto do ShotModel da bandeja: a dificuldade da variação entra no rating; o floater é arremesso de perto. */
  private setLayupContext(plan: LayupPlan): void {
    const type = layupShotType(plan);
    this.context = makeShotContext({
      rating:
        type === ShotType.Layup
          ? clamp(plan.rating + this.ratings.layupOffset, 25, 99)
          : type === ShotType.Floater
            ? this.ratings.closeShot
            : // Enterrada: o plano já traz DunkRating (80) mais a dificuldade da variação (moinho −5, duas mãos +2…).
              clamp(plan.rating + this.ratings.dunkOffset, 25, 99),
      distanceMeters: plan.releaseDistance,
      isThree: false,
      type,
      speed: ReleaseSpeed.Normal,
      fatigue: ShotModel.fatigueFromEnergy(this.dribble.getEnergy()),
      balance: 1,
    });
    this.windows = this.model.computeWindows(this.context);
  }

  /** Durante o gather: toque/toque duplo do X trocam a bandeja (hop, euro, cradle); a bola sai no tempo do plano. */
  private updateLayup(input: InputState, shootPressed: boolean): void {
    const L = this.layup;
    if (L.hold) {
      this.updateHold(input, shootPressed);
      return;
    }
    const lsSide: LayupSide | null = input.moveX > 0.3 ? 'r' : input.moveX < -0.3 ? 'l' : null;
    const request =
      L.readX(this.now, input.shoot, shootPressed, input.shootEdgeTime, lsSide, this.dribbler.ballHand()) ??
      L.readStick(this.now, input.proX, input.proY);
    if (request) {
      const feet = this.animator.feetState();
      const ankles = { l: fromThree(feet.l.ankle), r: fromThree(feet.r.ankle) };
      const sit = L.situationNow(this.now, this.layupSituation(), ankles);
      // Toque = hop step com parada (plano próprio, não precisa alcançar o aro); toque duplo = euro/cradle.
      const next = L.hopStop ? planHopStop(sit, this.hopLateral(input)) : L.plan_(request, sit, this.rng.nextDouble());
      if (next && next !== 'wait') {
        L.replan(next, this.now);
        this.setLayupContext(next);
        if (next.choice.hand !== this.dribbler.ballHand()) this.dribble.setHand(next.choice.hand === 'r' ? 0 : 1);
        this.dribbler.take(next.choice.hand);
        this.animator.playLayup(next, this.dribbler.position);
        this.events.onMove?.(L.label, 'bandeja');
      } else {
        // A troca não coube: segue o plano de agora (o hop com parada continua parando).
        L.hopStop = L.plan!.stopAt !== undefined;
      }
    }
    // Hop step do toque: parou nos dois pés -> bola presa (o X apertado de novo no hop e segurado sobe dali).
    if (L.hopStop && L.plan && L.time(this.now) >= (L.plan.stopAt ?? L.plan.speedKeys[1][0] + 0.1)) {
      this.enterHold(input);
      return;
    }
    if (!L.released && L.time(this.now) >= L.plan!.releaseAt) this.releaseLayup(this.holdingRim(input));
  }

  // ------------------------------------------------------------------ bola presa (hop step em fases, nba-24)

  /** Pousou do hop step: os pés do pouso viram a base e o pivô fica livre (Hakeem: escolhe o lado depois). */
  private enterHold(input: InputState): void {
    const L = this.layup;
    const again = L.pressAfterTap();
    const plan = L.plan!;
    const feet = this.animator.feetState();
    const hop = (side: LayupSide) => plan.contacts.find((c) => c.role === 'hop' && c.foot === side)?.pos ?? fromThree(feet[side].ankle).flat();
    L.hold = new HoldState({ feet: { l: hop('l'), r: hop('r') }, facing: this.facing }, this.dribbler.ballHand(), this.now);
    L.plan = null;
    L.hopStop = false;
    // X apertado de novo no ar e ainda segurado: conta desde aquele aperto (segurado = sobe já, como no 2K24).
    L.holdX = again !== null && input.shoot ? { pressAt: again, done: false } : null;
    L.stick.reset();
    L.label = 'Hop step · bola presa';
    this.velocity = new Vec3();
    this.animator.holdLayup(L.hold.pose(this.now), this.dribbler.position);
    this.events.onMove?.(L.label, 'bola presa');
  }

  /** Bola presa: RS = fundamentos com pé de pivô; X toque = pump fake; X segurado = finaliza (ou step-through). */
  private updateHold(input: InputState, shootPressed: boolean): void {
    const L = this.layup;
    const H = L.hold!;
    const read = L.readHold(this.now, input.proX, input.proY, input.shoot, shootPressed, input.shootEdgeTime);
    if (read.start !== undefined && H.start(read.start, this.now)) this.events.onMove?.(HoldMoveLabels[read.start], 'bola presa');
    const ended = H.update(this.now);
    if (read.finish || ended === HoldMove.StepThrough) {
      this.finishFromHold(ended === HoldMove.StepThrough);
      return;
    }
    const pose = H.pose(this.now);
    this.position = pose.com;
    this.velocity = new Vec3();
    this.facing = pose.facing;
    this.animator.setHoldPose(pose, this.now - H.since);
  }

  /** Da bola presa: perto do aro, bandeja parada (de força, ou por cima depois do step-through); longe, arremesso. */
  private finishFromHold(stepThrough: boolean): void {
    const L = this.layup;
    const H = L.hold!;
    const pose = H.pose(this.now);
    const base = this.layupSituation();
    const sit: LayupSituation = {
      ...base,
      position: pose.com,
      velocity: new Vec3(),
      facing: pose.facing,
      feet: { l: { pos: pose.feet.l.pos, planted: true }, r: { pos: pose.feet.r.pos, planted: true } },
    };
    const dist = sit.position.sub(sit.rimFloor).length2D();
    L.hold = null;
    const kind = holdFinishFor(dist);
    if (kind === 'shot') {
      L.end();
      this.beginGather(this.now);
      return;
    }
    // Meia distância: floater de dois pés (o "hop floater"); perto: bandeja de força (ou por cima no step-through).
    const choice =
      kind === 'floater' && !stepThrough
        ? { gather: LayupGather.Hop, finish: LayupFinish.Floater, hand: this.dribbler.ballHand(), glass: false }
        : chooseLayup({ command: stepThrough ? 'auto' : 'hop', sprint: false }, sit, L.style, this.rng.nextDouble());
    // RT segurado perto do aro: enterrada de dois pés parada (duas mãos ou cock-back), se alcança.
    if (this.ratings.canDunk && this.ratings.dunk.standing && this.now - this.sprintSeenAt < SprintGraceSeconds && kind !== 'floater' && !stepThrough) {
      const dunkChoice = chooseDunk(sit, { command: 'dunk', sprint: false }, this.rng.nextDouble());
      const dunk = planStandingLayup(dunkChoice, sit, DunkRating);
      if (dunk.rise < this.ratings.dunk.riseMax - 1e-6) {
        this.beginLayup(dunk, this.now);
        return;
      }
    }
    const plan = planStandingLayup(choice, sit, 85);
    this.beginLayup(plan, this.now);
  }

  /** LS para um lado no toque do hop: hop para aquele lado. Só quando o LS está claramente de lado (não na diagonal). */
  private hopLateral(input: InputState): LayupSide | null {
    if (Math.abs(input.moveX) < 0.55 || Math.abs(input.moveX) < Math.abs(input.moveY) * 0.8) return null;
    return input.moveX > 0 ? 'r' : 'l';
  }

  /**
   * Toque no X dirigindo para a cesta quando o X tinha ido para o arremesso (fora da zona da bandeja): hop step em vez de
   * pump fake (2K27, "Hop Step Finish": toque no X dirigindo). Parado, de lado ou longe continua pump fake.
   */
  private hopFromShotTap(): boolean {
    const press = this.layup.shotPress;
    if (!press || this.layup.busy || this.now - press.at > 0.4) return false;
    const sit = { ...this.layupSituation(), velocity: press.velocity };
    const toRim = sit.rimFloor.sub(sit.position).flat();
    const approach = press.velocity.flat().dot(toRim.normalized(sit.facing));
    if (toRim.length2D() > HopStopTuning.maxDistance || approach < HopStopTuning.minApproach) return false;
    this.layup.shotPress = null;
    this.beginLayup(planHopStop(sit, press.lateral), press.at, true);
    return true;
  }

  /** O jogador anda pelo plano; o corpo vira suave para onde o plano olha. */
  private moveByLayup(dt: number): void {
    if (this.layup.hold) return; // a bola presa já pôs o corpo (updateHold)
    const body = this.layup.body(this.now);
    this.position = body.position;
    this.velocity = body.velocity;
    const turn = 1 - Math.exp(-14 * dt);
    this.facing = this.facing.add(body.facing.sub(this.facing).scale(turn)).flat().normalized(body.facing);
  }

  /** Soltura da bandeja: sem green (conta como Boa); o ShotModel decide e a trajetória sai da mão (com tabela ou direto). */
  private releaseLayup(xHeld = false): void {
    const L = this.layup;
    const plan = L.plan!;
    L.released = true;
    // Enterrada com o X ainda segurado: fica pendurado no aro até soltar o X (2K).
    if (L.hangOnRelease(xHeld && this.ratings.dunk.hang, this.animator.heightMeters)) this.events.onMove?.(L.label, 'enterrada');
    const context = this.context!;
    const windows = this.windows!;
    this.holdMs = finishHoldMs(ShotType.Layup, windows.idealReleaseMs, windows.perfectHalfMs);
    // Sem defensor no Freestyle por enquanto: contestação zero.
    const contest = 0;
    this.events.modifyShot?.(context, TimingGrade.Good, contest);
    const evaluation = this.model.evaluate(context, windows, this.holdMs, contest);
    const reported: ShotEvaluation = { ...evaluation, timing: TimingGrade.Good };
    const decision = this.model.decide(evaluation, this.rng);
    const from = fromThree(this.dribbler.position);
    let initial: BallState;
    if (plan.rim && decision.make) {
      // Enterrada que entra: a bola é socada da mão para baixo pelo meio do aro, quase na vertical.
      const through = this.hoop.rimCenter().add(new Vec3(0, 0, -0.6));
      initial = makeBallState(from, through.sub(from).scale(1 / 0.13));
    } else if (plan.rim) {
      // Enterrada que erra: a bola é socada no aro de trás e espirra.
      const backRim = this.hoop.rimCenter().add(this.hoop.forward.flat().normalized().scale(-0.2)).add(new Vec3(0, 0, -0.02));
      initial = makeBallState(from, backRim.sub(from).scale(1 / 0.1));
    } else {
      initial = realizeLayupShot(this.sim, decision, from, plan.choice, plan.choice.glass, this.rng).initial;
    }
    this.evaluation = reported;
    this.decision = decision;
    this.ball = cloneBallState(initial);
    this.flightTime = 0;
    this.scoredThisShot = false;
    this.accumulator = 0;
    this.phase = 'flight';
    this.events.onRelease?.(reported, windows, true);
  }

  /** Salto visual: sobe no quadro da decolagem e volta ao chão, mesmo depois da soltura (UE: JumpZ do capsule). */
  private updateJump(): void {
    if (!this.jump) return;
    const t = this.now - this.jump.takeoffAt;
    if (t >= 2 * this.jump.apexDelayS) {
      this.jump = null;
      this.finishLift = 0;
    } else {
      this.finishLift = finishLiftM(t, this.jump.apexDelayS);
    }
  }

  /** Soltura da bandeja ou da enterrada (UE: ReleaseFinish), sem green: o acerto vem do ShotModel. */
  private releaseFinish(): void {
    const { kind } = this.finish!;
    const context = this.context!;
    const windows = this.windows!;
    this.finish = null;
    // Depois da soltura, a velocidade vira o freio em cosseno (ver updateMovement), em vez de seguir com o embalo.
    this.landing = { startAt: this.now, v0: this.velocity.flat() };
    this.holdMs = finishHoldMs(kind, windows.idealReleaseMs, windows.perfectHalfMs);
    // Sem defensor no Freestyle por enquanto: contestação zero. Os badges leem a soltura antes da avaliação,
    // como no arremesso.
    const contest = 0;
    // Bandeja e enterrada não têm green (UE: bLastShotGreen = false): a soltura conta como Boa para o HUD e os badges.
    this.events.modifyShot?.(context, TimingGrade.Good, contest);
    const evaluation = this.model.evaluate(context, windows, this.holdMs, contest);
    const reported: ShotEvaluation = { ...evaluation, timing: TimingGrade.Good };
    const decision = this.model.decide(evaluation, this.rng);
    let initial: BallState;
    if (kind === ShotType.Dunk && decision.make) {
      // Enterrada que entra: a bola cai reta pelo centro do aro.
      initial = makeBallState(this.hoop.rimCenter().add(new Vec3(0, 0, DunkRimHeightM)), new Vec3(0, 0, -DunkDropMps));
    } else {
      const params = makeShotRealizeParams({
        releasePosition: fromThree(this.dribbler.position),
        launchAngleDeg: FinishLaunchAngleDeg,
      });
      initial = realizeShot(this.sim, decision, params, this.rng).initial;
    }
    this.evaluation = reported;
    this.decision = decision;
    this.ball = cloneBallState(initial);
    this.flightTime = 0;
    this.scoredThisShot = false;
    this.accumulator = 0;
    this.phase = 'flight';
    this.events.onRelease?.(reported, windows, true);
  }

  private release(): void {
    this.shotLaunchPending = false;
    this.animator.releaseShot();
    const context = this.context!;
    const windows = this.windows!;
    // Sem defensor no Freestyle por enquanto: contestação zero.
    const contest = 0;
    this.events.modifyShot?.(context, this.model.gradeTiming(this.holdMs - windows.idealReleaseMs, windows), contest);
    const evaluation = this.model.evaluate(context, windows, this.holdMs, contest);
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
    this.events.onRelease?.(evaluation, windows);
  }

  private updateFlight(dt: number): void {
    this.flightTime += dt;
    this.accumulator += dt;
    while (this.accumulator >= FixedStep) {
      this.accumulator -= FixedStep;
      const ev = this.sim.tick(this.ball);
      if (ev.scored && !this.scoredThisShot) {
        this.events.onScore?.();
        this.animator.celebrate();
      }
      if (ev.scored) this.scoredThisShot = true;
      if (ev.hitRim) this.events.onRim?.();
      if (ev.hitBackboard) this.events.onBoard?.();
      if (ev.hitFloor) this.events.onFloorBounce?.(ev.floorImpactSpeed);
      this.events.onFlightTick?.(this.ball, FixedStep);
    }
    // Resolve no primeiro toque no chão: a bola já passou pela cesta (depois disso ela não pontua mais) e pode ser pedida.
    // O tempo máximo solta a bola mesmo se ela ficar presa na rede.
    const touchedFloor = this.ballOnFloor();
    if (touchedFloor || this.flightTime > FlightCapSeconds) {
      this.recordShot();
      this.phase = 'loose';
    }
  }

  /** Fases em que a bola não está na mão: o boneco corre livre. */
  private ballFree(): boolean {
    return this.phase === 'flight' || this.phase === 'loose' || this.phase === 'return';
  }

  /** Bola solta: a física segue (quica e assenta no chão) até parar; depois fica parada esperando o A. */
  private settleBall(dt: number): void {
    if (this.ballAtRest()) {
      this.ball.angularVelocity = new Vec3(); // parada no chão: sem giro (senão a malha roda para sempre)
      return;
    }
    this.accumulator += dt;
    while (this.accumulator >= FixedStep) {
      this.accumulator -= FixedStep;
      const ev = this.sim.tick(this.ball);
      if (ev.hitRim) this.events.onRim?.();
      if (ev.hitBackboard) this.events.onBoard?.();
      if (ev.hitFloor) this.events.onFloorBounce?.(ev.floorImpactSpeed);
      if (this.ballAtRest()) {
        this.ball.angularVelocity = new Vec3();
        break;
      }
    }
  }

  private ballOnFloor(): boolean {
    const config = this.sim.getConfig();
    return this.ball.position.z <= config.floorZ + config.ball.radius + 1e-3;
  }

  private ballAtRest(): boolean {
    return this.ballOnFloor() && this.ball.velocity.length() < 0.05;
  }

  /** Botão A (pedir a bola): a bola solta voa até a mão; quanto mais longe, mais tempo e mais alto o arco. */
  private callBall(): void {
    const hand = this.dribbler.gripPoint(this.animator, this.dribbler.ballHand(), 'dribble', new THREE.Vector3());
    const dist = this.ballMesh.position.distanceTo(hand);
    this.returnFrom.copy(this.ballMesh.position);
    this.returnTime = 0;
    this.returnDuration = clamp(dist / 7, 0.35, 1);
    this.returnArc = clamp(dist * 0.5, 0.25, 1.1);
    this.animator.endCelebration(); // a comemoração para: a bola vai para a mão
    this.phase = 'return';
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
      type: shotTypeLabel(context.type),
    };
    this.history.push(record);
    this.events.onResult?.(record);
  }

  /** Freestyle: a bola volta sozinha para a mão (passe do rebote). */
  private updateReturn(dt: number): void {
    this.returnTime += dt;
    const t = clamp(this.returnTime / this.returnDuration, 0, 1);
    const hand = this.dribbler.gripPoint(this.animator, this.dribbler.ballHand(), 'dribble', new THREE.Vector3());
    const p = this.returnFrom.clone().lerp(hand, t);
    p.y += Math.sin(t * Math.PI) * this.returnArc;
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
    return this.position.withZ(this.animator.heightMeters + 0.45);
  }
}
