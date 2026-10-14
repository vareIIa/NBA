// Freestyle (esqueleto): jogador provisório, drible em loop com o arco do núcleo, arremesso com a janela travada no
// gather, decisão do ShotModel realizada pela física (realizeShot + BallSim a 120 Hz). Tudo em coordenadas do núcleo;
// o three.js só desenha.
import * as THREE from 'three';
import {
  BallSim,
  type BallState,
  DribbleController,
  type DribbleArc,
  type GatherCarry,
  HoopSpec,
  type RealizedShot,
  ReleaseSpeed,
  Rng,
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
  launchAngleForTiming,
  makeBallState,
  makeDribbleArc,
  makeShotContext,
  makeShotRealizeParams,
  realizeShot,
  timingGradeLabel,
  upVector,
  type ShotContext,
} from '../sim';
import { angularToThree, toThree } from '../units';
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
  onFloorBounce?: (speed: number) => void;
  onRim?: () => void;
  onBoard?: () => void;
}

const PlayerHeight = 1.96;
const JogSpeed = 4.4; // m/s com bola
const SprintSpeed = 6.7;
const Acceleration = 16; // m/s²
const DribblePeriod = 0.46; // s por quique (~2,2 quiques/s)
const ReleaseHeight = 2.5; // m acima do chão no topo do salto (sem o salto)
const JumpHeight = 0.42;
const FixedStep = 1 / 120;

export class Freestyle {
  readonly layout: CourtLayout = makeCourtLayout();
  readonly hoop: HoopSpec;
  readonly sim: BallSim;
  readonly model = new ShotModel();
  readonly dribble = new DribbleController();
  readonly rng = new Rng(2026);

  // Jogador (núcleo).
  position = new Vec3(7.6, -1.2, 0);
  velocity = new Vec3();
  facing = new Vec3(-1, 0, 0);
  jumpZ = 0;

  // Bola.
  phase: Phase = 'dribble';
  ball: BallState = makeBallState();
  private arc: DribbleArc | null = null;
  private arcTime = 0;

  // Arremesso em andamento.
  private gatherTime = 0;
  private gatherOffset = new Vec3(); // bola no gather, relativa ao jogador
  private context: ShotContext | null = null;
  windows: TimingWindows | null = null;
  holdMs = 0;
  private carry: GatherCarry | null = null;
  private carryDir = new Vec3();
  realized: RealizedShot | null = null;
  private decision: ShotDecision | null = null;
  private evaluation: ShotEvaluation | null = null;
  private flightTime = 0;
  private scoredThisShot = false;
  private returnFrom = new Vec3();
  private returnTime = 0;
  private accumulator = 0;
  private wasShooting = false;
  now = performance.now() / 1000;

  readonly history: ShotRecord[] = [];
  readonly playerGroup = new THREE.Group();
  readonly ballMesh: THREE.Mesh;
  private readonly spinAxis = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly events: FreestyleEvents = {},
  ) {
    this.hoop = HoopSpec.fromRimFloorPoint(this.layout.rimFloorPoint, new Vec3(1, 0, 0));
    this.sim = new BallSim(defaultBallSimConfig(), this.hoop);
    this.ballMesh = buildBall(this.sim.getConfig().ball.radius);
    scene.add(this.ballMesh);
    this.buildPlayer();
    scene.add(this.playerGroup);
    this.ball.position = this.handPosition();
  }

  /** Placeholder até o GLB do boneco (passo 3): capsula de 1,96 m com uniforme. */
  private buildPlayer(): void {
    const jersey = new THREE.MeshStandardMaterial({ color: 0x1456c8, roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.8 });
    const shorts = new THREE.MeshStandardMaterial({ color: 0x0d2f6e, roughness: 0.7 });

    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.62, 6, 12), skin);
    legs.position.y = 0.46;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.5, 6, 16), jersey);
    torso.position.y = 1.27;
    torso.scale.set(1, 1, 0.75);
    const shortsMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.27, 0.32, 16), shorts);
    shortsMesh.position.y = 0.92;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 14), skin);
    head.position.y = PlayerHeight - 0.13;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.04), skin);
    nose.position.set(0.11, PlayerHeight - 0.14, 0);
    for (const mesh of [legs, torso, shortsMesh, head, nose]) {
      mesh.castShadow = true;
      this.playerGroup.add(mesh);
    }
    this.playerGroup.name = 'jogador';
  }

  rimCenter(): Vec3 {
    return this.hoop.rimCenter();
  }

  /** Direita do jogador. Eixos da Unreal (mão esquerda): direita = up × frente, como em HoopSpec.right(). */
  right(): Vec3 {
    return upVector().cross(this.facing).normalized(new Vec3(0, 1, 0));
  }

  /** Mão da bola (provisória: ponto fixo ao lado do quadril até o boneco animado). */
  handPosition(): Vec3 {
    return this.position.add(this.right().scale(0.34)).add(this.facing.scale(0.18)).withZ(0.95 + this.jumpZ);
  }

  private releasePoint(): Vec3 {
    return this.position.add(this.facing.scale(0.2)).withZ(ReleaseHeight + this.jumpZ);
  }

  /** now = relógio real (s, performance.now): o timing do arremesso não pode depender do FPS. */
  update(now: number, dt: number, input: InputState, cameraForward: Vec3): void {
    this.now = now;
    this.updateMovement(dt, input, cameraForward);
    this.dribble.update(this.now, dt, input.sprint && this.isMoving(), this.isMoving());

    const shootPressed = input.shoot && !this.wasShooting;
    const shootReleased = !input.shoot && this.wasShooting;
    this.wasShooting = input.shoot;

    switch (this.phase) {
      case 'dribble':
        this.updateDribble(dt);
        if (shootPressed) this.beginGather(input.shootEdgeTime);
        break;
      case 'gather':
        this.updateGather(shootReleased, input.shootEdgeTime);
        break;
      case 'flight':
        this.updateFlight(dt);
        break;
      case 'return':
        this.updateReturn(dt);
        break;
    }
    this.syncMeshes(dt);
  }

  isMoving(): boolean {
    return this.velocity.length2D() > 0.4;
  }

  private updateMovement(dt: number, input: InputState, cameraForward: Vec3): void {
    const forward = cameraForward.flat().normalized(new Vec3(-1, 0, 0));
    const right = upVector().cross(forward).normalized();
    const wish = forward.scale(input.moveY).add(right.scale(input.moveX));
    const grounded = this.phase === 'dribble' || this.phase === 'return';

    if (grounded) {
      const maxSpeed = (input.sprint ? SprintSpeed : JogSpeed) * this.dribble.speedScale();
      const target = wish.scale(maxSpeed);
      const delta = target.sub(this.velocity);
      const step = Acceleration * dt;
      this.velocity = delta.length() <= step ? target : this.velocity.add(delta.normalized().scale(step));
    } else if (this.carry && this.phase === 'gather') {
      // Pull-up sem frear (núcleo): o embalo do drible vira o gather e cai no plant.
      this.velocity = this.carryDir.scale(this.carry.speedAt(this.now - this.gatherTime));
    } else {
      this.velocity = this.velocity.scale(Math.max(0, 1 - 6 * dt));
    }

    this.position = this.position.add(this.velocity.scale(dt));
    const { baselineX, halfCourtX, halfWidth } = this.layout;
    this.position = new Vec3(
      clamp(this.position.x, baselineX + 0.3, halfCourtX - 0.3),
      clamp(this.position.y, -halfWidth + 0.3, halfWidth - 0.3),
      0,
    );

    // Orientação: segue o movimento; parado ou arremessando, encara a cesta.
    const toRim = this.rimCenter().sub(this.position).flat().normalized(this.facing);
    const desired = grounded && this.velocity.length2D() > 1.2 ? this.velocity.flat().normalized() : toRim;
    const turn = 1 - Math.exp(-10 * dt);
    this.facing = this.facing.add(desired.sub(this.facing).scale(turn)).flat().normalized(desired);
  }

  // ------------------------------------------------------------------ drible

  private updateDribble(dt: number): void {
    if (!this.arc || this.arcTime >= this.arc.totalSeconds()) {
      // Novo quique no referencial do jogador: mão → chão (um pouco à frente) → mão.
      const local = this.handPosition().sub(this.position);
      this.arc = makeDribbleArc(local, local, new Vec3(), DribblePeriod, this.sim.getConfig().ball.radius);
      this.arc.floorPos = this.arc.floorPos.add(this.facing.scale(0.12));
      this.arcTime = 0;
    }
    const before = this.arcTime;
    this.arcTime += dt;
    if (before < this.arc.downSeconds && this.arcTime >= this.arc.downSeconds) {
      this.events.onFloorBounce?.(this.arc.floorEntrySpeed());
    }
    // O arco é relativo ao jogador: a bola nunca fica para trás quando ele anda.
    this.ball.position = this.position.add(this.arc.evaluate(this.arcTime));
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
    this.gatherOffset = this.ball.position.sub(this.position);
    this.holdMs = 0;
    this.phase = 'gather';
  }

  private updateGather(released: boolean, releaseTime: number): void {
    const windows = this.windows!;
    // Soltou: o tempo de segurar é o do evento, não o do quadro em que ele foi lido.
    this.holdMs = ((released ? Math.min(releaseTime, this.now) : this.now) - this.gatherTime) * 1000;
    const t = this.holdMs / windows.idealReleaseMs;

    // Salto com o topo no ponto ideal: a mão chega lá em cima no centro do green.
    this.jumpZ = JumpHeight * Math.sin(Math.min(1, t) * (Math.PI / 2)) * (t <= 1 ? 1 : Math.max(0, 1 - (t - 1) * 1.5));
    const lift = clamp(t, 0, 1);
    const eased = lift * lift * (3 - 2 * lift);
    const from = this.position.add(this.gatherOffset);
    this.ball.position = from.add(this.releasePoint().sub(from).scale(eased));

    const tuning = this.model.getTuning();
    const autoReleaseMs = windows.idealReleaseMs + tuning.autoReleaseAfterIdealMs;
    const autoRelease = !released && this.holdMs >= autoReleaseMs;
    if (autoRelease) this.holdMs = autoReleaseMs;
    if (released && this.holdMs < tuning.pumpFakeMaxHoldMs) {
      // Toque curto = pump fake: volta ao drible.
      this.jumpZ = 0;
      this.phase = 'dribble';
      this.arc = null;
      return;
    }
    if (released || autoRelease) {
      this.release();
    }
  }

  private release(): void {
    const context = this.context!;
    const windows = this.windows!;
    // Sem defensor no Freestyle por enquanto: contestação zero.
    const evaluation = this.model.evaluate(context, windows, this.holdMs, 0);
    const decision = this.model.decide(evaluation, this.rng);
    const baseAngle = context.distanceMeters < 4 ? 55 : 50;
    const params = makeShotRealizeParams({
      releasePosition: this.ball.position,
      launchAngleDeg: launchAngleForTiming(baseAngle, evaluation.timing),
    });
    const realized = realizeShot(this.sim, decision, params, this.rng);
    this.evaluation = evaluation;
    this.decision = decision;
    this.realized = realized;
    this.ball = cloneBallState(realized.initial);
    this.flightTime = 0;
    this.scoredThisShot = false;
    this.accumulator = 0;
    this.phase = 'flight';
    this.events.onRelease?.(evaluation, windows);
  }

  private updateFlight(dt: number): void {
    this.flightTime += dt;
    // Pouso do salto.
    this.jumpZ = Math.max(0, this.jumpZ - dt * 2.2);

    this.accumulator += dt;
    while (this.accumulator >= FixedStep) {
      this.accumulator -= FixedStep;
      const ev = this.sim.tick(this.ball);
      if (ev.scored) this.scoredThisShot = true;
      if (ev.hitRim) this.events.onRim?.();
      if (ev.hitBackboard) this.events.onBoard?.();
      if (ev.hitFloor) this.events.onFloorBounce?.(ev.floorImpactSpeed);
    }

    const resolved = this.scoredThisShot ? this.flightTime > 2.2 : this.flightTime > 2.8;
    if (resolved) {
      this.recordShot();
      this.returnFrom = this.ball.position;
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

  /** Freestyle: a bola volta sozinha para a mão (rebote automático). */
  private updateReturn(dt: number): void {
    this.returnTime += dt;
    const t = clamp(this.returnTime / 0.55, 0, 1);
    const hand = this.handPosition();
    const arcLift = Math.sin(t * Math.PI) * 1.2;
    const p = this.returnFrom.add(hand.sub(this.returnFrom).scale(t));
    this.ball.position = p.withZ(p.z + arcLift);
    if (t >= 1) {
      this.phase = 'dribble';
      this.arc = null;
      this.realized = null;
    }
  }

  // ------------------------------------------------------------------ visual

  private syncMeshes(dt: number): void {
    toThree(this.position.withZ(this.jumpZ), this.playerGroup.position);
    this.playerGroup.rotation.y = Math.atan2(-this.facing.y, this.facing.x);

    toThree(this.ball.position, this.ballMesh.position);
    if (this.phase === 'flight') {
      const w = angularToThree(this.ball.angularVelocity, this.spinAxis);
      const speed = w.length();
      if (speed > 1e-6) this.ballMesh.rotateOnWorldAxis(w.normalize(), speed * dt);
    } else {
      this.ballMesh.rotation.z -= dt * 6;
    }
  }

  /** Para o HUD: ponto da cabeça (núcleo) e progresso do medidor. */
  headPoint(): Vec3 {
    return this.position.withZ(PlayerHeight + 0.35 + this.jumpZ);
  }
}
