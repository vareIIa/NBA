import { describe, expect, test } from 'vitest';
import { BallSim, defaultBallSimConfig, simulateFlight } from './HoopsBallSim';
import { HoopSpec } from './HoopsCourt';
import { LayupFinish, LayupGather } from './HoopsLayup';
import { realizeLayupShot } from './HoopsLayupShot';
import { Vec3 } from './HoopsMath';
import { Rng } from './HoopsRandom';
import { MissType } from './HoopsShotModel';

const hoop = HoopSpec.fromRimFloorPoint(new Vec3(0, 0, 0), new Vec3(1, 0, 0));
const sim = new BallSim(defaultBallSimConfig(), hoop);
const make = { make: true, miss: MissType.None, probability: 0.9, roll: 0.1 } as never;
const miss = { make: false, miss: MissType.Long, probability: 0.9, roll: 0.95 } as never;
const choice = { gather: LayupGather.Normal, finish: LayupFinish.Overhand, hand: 'r' as const, glass: true };

describe('bandeja: soltura com tabela', () => {
  // Soltura a ~0,55 m do aro, de lado (45°), na altura do plano (~2,9 m).
  const releases: [string, Vec3][] = [
    ['45° direita', new Vec3(0.39, -0.39, 2.9)],
    ['45° esquerda', new Vec3(0.39, 0.39, 2.9)],
    ['quase da linha de fundo', new Vec3(0.22, -0.5, 2.95)],
  ];
  for (const [name, release] of releases) {
    test(`${name}: acha uma mira no vidro que entra`, () => {
      const r = realizeLayupShot(sim, make, release, choice, true, new Rng(7));
      expect(r.glassAim).not.toBeNull();
      expect(r.scored).toBe(true);
      const flight = simulateFlight(sim, r.initial, 3.5);
      expect(flight.boardHits).toBeGreaterThan(0);
      expect(flight.scored).toBe(true);
      // Bandeja é suave: a bola sai devagar (bem menos que um arremesso de média distância).
      expect(r.initial.velocity.length()).toBeLessThan(5.5);
    });
  }

  test('erro com tabela: bate no vidro e não entra', () => {
    const r = realizeLayupShot(sim, miss, new Vec3(0.39, -0.39, 2.9), choice, true, new Rng(3));
    expect(r.matchesDecision).toBe(true);
    expect(simulateFlight(sim, r.initial, 3.5).scored).toBe(false);
  });

  test('finger roll de frente, direto no aro: entra', () => {
    const fr = { ...choice, finish: LayupFinish.FingerRoll, glass: false };
    const r = realizeLayupShot(sim, make, new Vec3(0.62, -0.05, 2.85), fr, false, new Rng(11));
    expect(r.scored).toBe(true);
    expect(r.glassAim).toBeNull();
  });
});
