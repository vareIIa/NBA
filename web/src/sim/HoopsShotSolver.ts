// Porte de HoopsShotSolver.h/.cpp: transforma a decisão (cesta/erro) numa trajetória física crível.
import { Vec3, DefaultGravity, Pi, degToRad, upVector } from './HoopsMath';
import type { HoopSpec } from './HoopsCourt';
import { type BallSim, type BallState, type FlightSummary, makeBallState, simulateFlight } from './HoopsBallSim';
import { MissType, type ShotDecision, TimingGrade } from './HoopsShotModel';
import type { Rng } from './HoopsRandom';

export interface LaunchSolution {
  valid: boolean;
  velocity: Vec3;
}

/**
 * Velocidade inicial para a bola sair de `from` e passar por `to` com o ângulo de lançamento dado
 * (acima da horizontal), sem arrasto. Inválida se o ângulo for baixo demais para alcançar o alvo.
 */
export function solveLaunch(from: Vec3, to: Vec3, launchAngleRad: number, gravity = DefaultGravity): LaunchSolution {
  const invalid: LaunchSolution = { valid: false, velocity: new Vec3() };
  const delta = to.sub(from);
  const horizontalDist = delta.length2D();
  if (horizontalDist < 1e-6) {
    return invalid;
  }

  const cosA = Math.cos(launchAngleRad);
  const tanA = Math.tan(launchAngleRad);
  const rise = horizontalDist * tanA - delta.z;
  if (rise <= 1e-6 || cosA <= 1e-6) {
    return invalid;
  }

  const speedSq = (gravity * horizontalDist * horizontalDist) / (2 * cosA * cosA * rise);
  const speed = Math.sqrt(speedSq);
  const dir2D = delta.flat().div(horizontalDist);

  return {
    valid: true,
    velocity: dir2D.scale(speed * cosA).add(upVector().scale(speed * Math.sin(launchAngleRad))),
  };
}

/** Ângulo de lançamento sugerido pelo timing (arco como leitura do timing, igual ao jogo de referência). */
export function launchAngleForTiming(baseAngleDeg: number, grade: TimingGrade): number {
  switch (grade) {
    case TimingGrade.SlightlyEarly:
      return baseAngleDeg + 3;
    case TimingGrade.VeryEarly:
      return baseAngleDeg + 6;
    case TimingGrade.SlightlyLate:
      return baseAngleDeg - 3;
    case TimingGrade.VeryLate:
      return baseAngleDeg - 6;
    default:
      return baseAngleDeg;
  }
}

export interface ShotRealizeParams {
  releasePosition: Vec3;
  launchAngleDeg: number; // 45–55° é a faixa realista; o timing muda o arco (cedo = alto, tarde = achatado)
  backspinRevPerSec: number;
  maxAttempts: number;
}

export const makeShotRealizeParams = (overrides: Partial<ShotRealizeParams> = {}): ShotRealizeParams => ({
  releasePosition: new Vec3(),
  launchAngleDeg: 50,
  backspinRevPerSec: 3,
  maxAttempts: 10,
  ...overrides,
});

export interface RealizedShot {
  initial: BallState; // estado da bola na soltura
  scored: boolean; // resultado verificado na simulação
  matchesDecision: boolean;
  attempts: number;
  flight: FlightSummary;
}

interface ShotFrame {
  rimCenter: Vec3;
  dir: Vec3; // horizontal, do arremessador para o aro
  lateral: Vec3; // horizontal, à direita do arremessador
  centerlineRadius: number;
}

function makeFrame(hoop: HoopSpec, release: Vec3): ShotFrame {
  const rimCenter = hoop.rimCenter();
  const dir = rimCenter.sub(release).flat().normalized(hoop.forward.neg());
  return {
    rimCenter,
    dir,
    lateral: dir.cross(upVector()).normalized(),
    centerlineRadius: hoop.rimCenterlineRadius(),
  };
}

// Profundidade ideal: um pouco atrás do centro (referência "45° / 11 polegadas").
const MakeOffsets = [0.03, 0.0, 0.045, -0.02, 0.015, 0.06, -0.035, 0.075, -0.05, 0.09] as const;

/** Alvo (no plano do aro) para cada tentativa. attempt 0 = alvo "ideal"; os seguintes variam. */
function targetFor(frame: ShotFrame, decision: ShotDecision, attempt: number, jitter: number): Vec3 {
  const rc = frame.centerlineRadius;
  if (decision.make) {
    const along = MakeOffsets[attempt % 10];
    return frame.rimCenter.add(frame.dir.scale(along)).add(frame.lateral.scale(jitter * 0.02));
  }

  // Erros: empurra para fora a cada tentativa até a simulação confirmar o erro.
  const push = 1 + 0.25 * attempt;
  switch (decision.miss) {
    case MissType.Short:
      return frame.rimCenter.sub(frame.dir.scale((rc - 0.035) * push)).add(frame.lateral.scale(jitter * 0.03));
    case MissType.Long:
      return frame.rimCenter.add(frame.dir.scale((rc - 0.025) * push)).add(frame.lateral.scale(jitter * 0.03));
    case MissType.Left:
      return frame.rimCenter.sub(frame.lateral.scale((rc - 0.03) * push)).add(frame.dir.scale(jitter * 0.03));
    case MissType.Right:
      return frame.rimCenter.add(frame.lateral.scale((rc - 0.03) * push)).add(frame.dir.scale(jitter * 0.03));
    default:
      return frame.rimCenter.sub(frame.dir.scale(0.75 * push)).add(frame.lateral.scale(jitter * 0.25));
  }
}

/**
 * Transforma a decisão (cesta/erro + tipo de erro) numa trajetória física crível,
 * verificando com a simulação determinística e ajustando o alvo se preciso.
 */
export function realizeShot(sim: BallSim, decision: ShotDecision, params: ShotRealizeParams, random: Rng): RealizedShot {
  const result: RealizedShot = {
    initial: makeBallState(),
    scored: false,
    matchesDecision: false,
    attempts: 0,
    flight: { scored: false, rimHits: 0, boardHits: 0, hitFloor: false, ticks: 0 },
  };
  const frame = makeFrame(sim.getHoop(), params.releasePosition);
  const jitter = random.range(-1, 1);
  const gravity = sim.getConfig().gravity;

  // Backspin: gira em torno do eixo lateral, com o topo da bola indo para trás (contra a direção do arremesso).
  const spin = frame.lateral.scale(params.backspinRevPerSec * 2 * Pi);

  let fallback: RealizedShot | null = null;

  const maxAttempts = params.maxAttempts > 0 ? params.maxAttempts : 1;
  for (let attempt = 0; attempt < maxAttempts; ++attempt) {
    const target = targetFor(frame, decision, attempt, jitter);
    // Se o alvo exige, sobe o arco um pouco em tentativas posteriores.
    const angleDeg = params.launchAngleDeg + (decision.make ? Math.trunc(attempt / 4) * 3 : 0);
    const launch = solveLaunch(params.releasePosition, target, degToRad(angleDeg), gravity);
    if (!launch.valid) {
      continue;
    }

    const initial = makeBallState(params.releasePosition, launch.velocity, spin);
    const flight = simulateFlight(sim, initial, 5.0);

    const candidate: RealizedShot = {
      initial,
      scored: flight.scored,
      matchesDecision: flight.scored === decision.make,
      attempts: attempt + 1,
      flight,
    };

    if (candidate.matchesDecision) {
      return candidate;
    }
    if (fallback === null) {
      fallback = candidate;
    }
  }

  if (fallback !== null) {
    fallback.attempts = maxAttempts;
    return fallback;
  }
  return result;
}
