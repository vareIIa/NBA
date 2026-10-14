// Porte de HoopsBallSim.h/.cpp: simulação determinística da bola livre (arremesso, passe, rebote, bola solta).
// Colisores analíticos: chão (plano), tabela (caixa), aro (toro). Rede é cosmética (fora do núcleo).
import { Vec3, DefaultGravity, clamp, distance2D, upVector } from './HoopsMath';
import { type BallSpec, type SurfaceSpec, HoopSpec, Surfaces, defaultBallSpec } from './HoopsCourt';

export interface BallState {
  position: Vec3;
  velocity: Vec3;
  /** Velocidade angular (rad/s). Hoje é usada para o visual (giro da bola); o contato usa só restituição e atrito. */
  angularVelocity: Vec3;
}

export const makeBallState = (position = new Vec3(), velocity = new Vec3(), angularVelocity = new Vec3()): BallState => ({
  position,
  velocity,
  angularVelocity,
});

export const cloneBallState = (s: BallState): BallState => ({ ...s });

export interface BallSimConfig {
  gravity: number;
  tickRate: number; // ticks por segundo (fixo)
  subSteps: number; // sub-passos por tick (evita atravessar aro/tabela)
  ball: BallSpec;
  floor: SurfaceSpec;
  rim: SurfaceSpec;
  board: SurfaceSpec;
  floorZ: number;
  restSpeed: number; // abaixo disso, quiques no chão param (evita "tremer")
  rollingDamping: number; // 1/s: bola rolando no chão perde velocidade
}

export const defaultBallSimConfig = (): BallSimConfig => ({
  gravity: DefaultGravity,
  tickRate: 120,
  subSteps: 4,
  ball: defaultBallSpec(),
  floor: Surfaces.Hardwood,
  rim: Surfaces.Rim,
  board: Surfaces.Backboard,
  floorZ: 0,
  restSpeed: 0.15,
  rollingDamping: 0.9,
});

/** O que aconteceu durante um tick. */
export interface BallTickEvents {
  hitFloor: boolean;
  floorImpactSpeed: number; // m/s na batida mais forte do tick (para som/efeitos)
  hitRim: boolean;
  hitBackboard: boolean;
  scored: boolean; // centro da bola cruzou o plano do aro para baixo, por dentro do aro
}

/** Resolve contato esfera-superfície: tira a penetração, aplica restituição normal e atrito de Coulomb. */
function resolveContact(state: BallState, normal: Vec3, penetration: number, surface: SurfaceSpec): void {
  state.position = state.position.add(normal.scale(penetration));

  const normalSpeed = state.velocity.dot(normal);
  if (normalSpeed >= 0) {
    return; // já se afastando
  }

  const normalVel = normal.scale(normalSpeed);
  const tangentVel = state.velocity.sub(normalVel);
  const normalImpulse = -(1 + surface.restitution) * normalSpeed;

  const tangentSpeed = tangentVel.length();
  let newTangent = tangentVel;
  if (tangentSpeed > 1e-9) {
    const frictionDelta = surface.friction * normalImpulse;
    const reduced = tangentSpeed > frictionDelta ? tangentSpeed - frictionDelta : 0;
    newTangent = tangentVel.scale(reduced / tangentSpeed);
  }

  state.velocity = newTangent.add(normal.scale(-normalSpeed * surface.restitution));
}

export class BallSim {
  private readonly config: BallSimConfig;
  private readonly hoop: HoopSpec;

  constructor(config: BallSimConfig, hoop: HoopSpec) {
    this.config = config;
    this.hoop = hoop;
  }

  /** Avança exatamente 1 tick (1 / tickRate segundos). */
  tick(state: BallState): BallTickEvents {
    const events: BallTickEvents = { hitFloor: false, floorImpactSpeed: 0, hitRim: false, hitBackboard: false, scored: false };
    const steps = this.config.subSteps > 0 ? this.config.subSteps : 1;
    const dt = this.tickSeconds() / steps;
    for (let index = 0; index < steps; ++index) {
      this.subStep(state, dt, events);
    }
    return events;
  }

  tickSeconds(): number {
    return 1 / this.config.tickRate;
  }
  getConfig(): BallSimConfig {
    return this.config;
  }
  getHoop(): HoopSpec {
    return this.hoop;
  }

  private subStep(state: BallState, dt: number, events: BallTickEvents): void {
    const prevZ = state.position.z;

    // Euler semi-implícito: estável e determinístico.
    state.velocity = state.velocity.withZ(state.velocity.z - this.config.gravity * dt);
    state.position = state.position.add(state.velocity.scale(dt));

    if (this.collideBackboard(state)) {
      events.hitBackboard = true;
    }
    if (this.collideRim(state)) {
      events.hitRim = true;
    }
    const floorImpact = this.collideFloor(state);
    // Rolando no chão: resistência ao rolamento.
    if (state.velocity.z === 0 && state.position.z <= this.config.floorZ + this.config.ball.radius + 1e-6) {
      const keep = 1 - this.config.rollingDamping * dt;
      const factor = keep > 0 ? keep : 0;
      state.velocity = new Vec3(state.velocity.x * factor, state.velocity.y * factor, state.velocity.z);
    }
    if (floorImpact > 0) {
      events.hitFloor = true;
      events.floorImpactSpeed = Math.max(floorImpact, events.floorImpactSpeed);
    }

    // Cesta: o centro cruzou o plano do aro descendo, por dentro do aro.
    const planeZ = this.hoop.rimPlaneZ();
    if (prevZ >= planeZ && state.position.z < planeZ && state.velocity.z < 0) {
      const radial = distance2D(state.position, this.hoop.rimCenter());
      if (radial < this.hoop.rimInnerRadius) {
        events.scored = true;
      }
    }
  }

  /** Retorna a velocidade de impacto (0 se não bateu descendo). */
  private collideFloor(state: BallState): number {
    const radius = this.config.ball.radius;
    const penetration = this.config.floorZ + radius - state.position.z;
    if (penetration <= 0) {
      return 0;
    }

    const impactSpeed = state.velocity.z < 0 ? -state.velocity.z : 0;
    resolveContact(state, upVector(), penetration, this.config.floor);
    if (state.velocity.z < this.config.restSpeed) {
      state.velocity = state.velocity.withZ(0); // assenta no chão (sem micro-quiques)
    }
    return impactSpeed;
  }

  private collideBackboard(state: BallState): boolean {
    const radius = this.config.ball.radius;
    const hoop = this.hoop;
    const center = hoop.backboardCenter();
    const axisF = hoop.forward;
    const axisR = hoop.right();
    const axisU = upVector();
    const halfF = hoop.backboardThickness * 0.5;
    const halfR = hoop.backboardWidth * 0.5;
    const halfU = hoop.backboardHeight * 0.5;

    const local = state.position.sub(center);
    const localF = local.dot(axisF);
    const localR = local.dot(axisR);
    const localU = local.dot(axisU);

    // Ponto da caixa mais próximo do centro da bola.
    const closest = center
      .add(axisF.scale(clamp(localF, -halfF, halfF)))
      .add(axisR.scale(clamp(localR, -halfR, halfR)))
      .add(axisU.scale(clamp(localU, -halfU, halfU)));

    const delta = state.position.sub(closest);
    const dist = delta.length();
    if (dist >= radius) {
      return false;
    }

    let normal: Vec3;
    let penetration: number;
    if (dist > 1e-9) {
      normal = delta.div(dist);
      penetration = radius - dist;
    } else {
      // Centro dentro da caixa: empurra pela face da quadra (ou de trás, se veio por trás).
      normal = localF >= 0 ? axisF : axisF.neg();
      penetration = radius + (halfF - Math.abs(localF));
    }

    resolveContact(state, normal, penetration, this.config.board);
    return true;
  }

  private collideRim(state: BallState): boolean {
    const radius = this.config.ball.radius;
    const rimCenter = this.hoop.rimCenter();
    const centerlineRadius = this.hoop.rimCenterlineRadius();
    const contactDist = radius + this.hoop.rimTubeRadius;

    const rel = state.position.sub(rimCenter);
    // Descarta rápido se está longe do aro.
    if (rel.z > contactDist || rel.z < -contactDist) {
      return false;
    }

    let radial = rel.flat();
    const radialLen = radial.length();
    radial = radialLen > 1e-9 ? radial.div(radialLen) : this.hoop.forward;

    // Ponto mais próximo na linha central do toro.
    const nearest = rimCenter.add(radial.scale(centerlineRadius));
    const delta = state.position.sub(nearest);
    const dist = delta.length();
    if (dist >= contactDist || dist <= 1e-9) {
      return false;
    }

    resolveContact(state, delta.div(dist), contactDist - dist, this.config.rim);
    return true;
  }
}

/** Resultado de um voo simulado até se resolver (cesta, chão ou tempo esgotado). */
export interface FlightSummary {
  scored: boolean;
  rimHits: number;
  boardHits: number;
  hitFloor: boolean;
  ticks: number;
}

/** Simula até: cesta + bola abaixo do aro, ou primeiro toque no chão, ou maxSeconds. Não altera o estado recebido. */
export function simulateFlight(sim: BallSim, initial: BallState, maxSeconds = 4.0): FlightSummary {
  const state = cloneBallState(initial);
  const summary: FlightSummary = { scored: false, rimHits: 0, boardHits: 0, hitFloor: false, ticks: 0 };
  const maxTicks = Math.trunc(maxSeconds * sim.getConfig().tickRate);
  const belowRimZ = sim.getHoop().rimPlaneZ() - 0.6;

  for (let tickIndex = 0; tickIndex < maxTicks; ++tickIndex) {
    const events = sim.tick(state);
    summary.ticks = tickIndex + 1;
    summary.rimHits += events.hitRim ? 1 : 0;
    summary.boardHits += events.hitBackboard ? 1 : 0;
    summary.scored = summary.scored || events.scored;

    if (events.hitFloor) {
      summary.hitFloor = true;
      break;
    }
    if (summary.scored && state.position.z < belowRimZ) {
      break;
    }
  }
  return summary;
}
