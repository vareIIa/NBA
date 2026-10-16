// Soltura da bandeja: a bola sai da mão no ponto em que a animação a deixou e o núcleo acha uma trajetória crível que
// cumpra a decisão do ShotModel (cesta ou erro). Com tabela, mira um ponto do vidro (o "canto de cima do quadrado" das
// escolinhas) e confere na física da bola (BallSim) que o rebote entra; direto no aro, usa o realizeShot com o arco da
// finalização. O efeito (giro) é visual: a física de contato ainda não usa a velocidade angular.
import { Vec3, degToRad, upVector } from './HoopsMath';
import { type BallSim, type BallState, makeBallState, simulateFlight } from './HoopsBallSim';
import { LayupFinish, type LayupChoice } from './HoopsLayup';
import { type ShotDecision } from './HoopsShotModel';
import { makeShotRealizeParams, realizeShot, solveLaunch } from './HoopsShotSolver';
import type { Rng } from './HoopsRandom';

/** Arco (graus acima da horizontal) de cada finalização. */
export const LayupArcDeg: Record<LayupFinish, number> = {
  [LayupFinish.Overhand]: 58,
  [LayupFinish.FingerRoll]: 60,
  [LayupFinish.Scoop]: 62,
  [LayupFinish.Jelly]: 64,
  [LayupFinish.Reverse]: 62,
  [LayupFinish.Floater]: 64,
  [LayupFinish.Power]: 56,
  // Enterrada que erra: a bola sai da mão quase sem arco (bate no aro e sobe).
  [LayupFinish.DunkOneHand]: 45,
  [LayupFinish.DunkTwoHand]: 45,
  [LayupFinish.Tomahawk]: 45,
  [LayupFinish.CockBack]: 45,
  [LayupFinish.Windmill]: 45,
};

/** Giro (rot/s) e eixo: backspin no por cima, finger roll e floater; efeito lateral no jelly e na reversa. */
function spinFor(choice: LayupChoice, dir: Vec3): Vec3 {
  const lateral = dir.cross(upVector()).normalized();
  const twoPi = 2 * Math.PI;
  switch (choice.finish) {
    case LayupFinish.Jelly:
    case LayupFinish.Reverse: {
      // English: a bola gira em torno do eixo vertical (mão direita = horário visto de cima) e um pouco para trás.
      const s = choice.hand === 'r' ? -1 : 1;
      return upVector().scale(s * 2.2 * twoPi).add(lateral.scale(1.2 * twoPi));
    }
    case LayupFinish.FingerRoll:
    case LayupFinish.Scoop:
      return lateral.scale(2.5 * twoPi);
    case LayupFinish.Floater:
      return lateral.scale(2 * twoPi);
    default:
      return lateral.scale(1.5 * twoPi);
  }
}

export interface LayupShotResult {
  initial: BallState;
  scored: boolean;
  matchesDecision: boolean;
  glassAim: Vec3 | null;
  attempts: number;
}

/**
 * Trajetória da bandeja. `glass`: mira no vidro e confere o rebote; senão direto no aro. Se nenhuma mira no vidro cumprir
 * a decisão, cai para a trajetória direta (que sempre tem uma).
 */
export function realizeLayupShot(sim: BallSim, decision: ShotDecision, release: Vec3, choice: LayupChoice, glass: boolean, rng: Rng): LayupShotResult {
  const hoop = sim.getHoop();
  const rim = hoop.rimCenter();
  const toRim = rim.sub(release).flat().normalized(hoop.forward.neg());
  const spin = spinFor(choice, toRim);
  const arc = LayupArcDeg[choice.finish];
  if (glass) {
    const found = searchGlass(sim, decision, release, arc, spin, rng);
    if (found) return found;
  }
  const realized = realizeShot(sim, decision, makeShotRealizeParams({ releasePosition: release, launchAngleDeg: arc, backspinRevPerSec: 2 }), rng);
  const initial = makeBallState(realized.initial.position, realized.initial.velocity, spin);
  return { initial, scored: realized.scored, matchesDecision: realized.matchesDecision, glassAim: null, attempts: realized.attempts };
}

function searchGlass(sim: BallSim, decision: ShotDecision, release: Vec3, arc: number, spin: Vec3, rng: Rng): LayupShotResult | null {
  const hoop = sim.getHoop();
  const f = hoop.forward.flat().normalized();
  const r = hoop.right();
  const face = hoop.backboardFaceCenter;
  const rim = hoop.rimCenter();
  const rimZ = hoop.rimPlaneZ();
  // Mira ideal: a reta da soltura até o aro espelhado atrás do vidro cruza o vidro na altura certa para cair no aro.
  const mirrored = rim.sub(f.scale(2 * rim.sub(face).dot(f)));
  const d0 = release.sub(face).dot(f);
  const d1 = mirrored.sub(face).dot(f);
  const k = d0 / Math.max(1e-6, d0 - d1);
  const cross = release.add(mirrored.sub(release).scale(k));
  const u0 = cross.sub(face).dot(r);
  const h0 = Math.max(rimZ + 0.25, cross.z + 0.28);
  const jitter = rng.range(-1, 1) * 0.03;
  type Cand = { u: number; h: number; a: number; cost: number };
  const cands: Cand[] = [];
  for (let du = -0.32; du <= 0.32 + 1e-9; du += 0.04) {
    for (let dh = -0.24; dh <= 0.36 + 1e-9; dh += 0.04) {
      for (const da of [0, -6, 6]) {
        cands.push({ u: u0 + du + jitter, h: h0 + dh, a: arc + da, cost: Math.abs(du) + 0.7 * Math.abs(dh) + 0.01 * Math.abs(da) });
      }
    }
  }
  cands.sort((a, b) => a.cost - b.cost);
  let attempts = 0;
  let fallbackMiss: LayupShotResult | null = null;
  for (const c of cands) {
    if (attempts > 160) break;
    const aim = face.add(r.scale(c.u)).withZ(c.h);
    const launch = solveLaunch(release, aim, degToRad(c.a), sim.getConfig().gravity);
    if (!launch.valid) continue;
    attempts++;
    const initial = makeBallState(release, launch.velocity, spin);
    const flight = simulateFlight(sim, initial, 3.5);
    if (flight.boardHits === 0) continue;
    if (decision.make && flight.scored) return { initial, scored: true, matchesDecision: true, glassAim: aim, attempts };
    if (!decision.make && !flight.scored) {
      // Erro crível: bate no aro depois do vidro (não uma bola que passa longe).
      const result = { initial, scored: false, matchesDecision: true, glassAim: aim, attempts };
      if (flight.rimHits > 0) return result;
      fallbackMiss ??= result;
    }
  }
  return fallbackMiss;
}
