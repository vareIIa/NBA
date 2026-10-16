import { describe, expect, it } from 'vitest';
import {
  Gravity,
  PullUpFullSpeed,
  PullUpMinSpeed,
  ballAt,
  driftAt,
  pullUpForm,
  pullUpMomentum,
  softLift,
  ShotSignatureIds,
  ShotSignatures,
  airShape,
  ballKeys,
  blendRelease,
  pelvisLift,
  shotFormOf,
  shotSchedule,
} from './ShotForms';

const H = 1.86;

describe('cronograma do arremesso', () => {
  it('a soltura cai no tempo pedido e as fases ficam em ordem, em todas as formas', () => {
    for (const id of ShotSignatureIds) {
      for (const R of [0.3, 0.417, 0.56, 0.7]) {
        const s = shotSchedule(shotFormOf(id, id, id, 0), R);
        expect(s.releaseAt).toBeCloseTo(R, 12);
        expect(s.dipAt).toBeGreaterThan(0);
        expect(s.dipAt).toBeLessThan(s.takeoffAt);
        expect(s.takeoffAt).toBeLessThan(s.releaseAt + 1e-9);
        expect(s.setAt).toBeLessThan(s.releaseAt);
        expect(s.setEnd).toBeGreaterThanOrEqual(s.setAt);
        expect(s.apexAt).toBeGreaterThan(s.takeoffAt);
        expect(s.landAt).toBeGreaterThan(s.apexAt);
        expect(s.endAt).toBeGreaterThan(s.landAt);
      }
    }
  });

  it('a soltura fica no ponto do salto da base (Curry perto do ápice, subindo; Ray Allen no ápice)', () => {
    const curry = shotSchedule(shotFormOf('Curry', 'Curry', 'Curry', 0), 0.56);
    const ray = shotSchedule(shotFormOf('RayAllen', 'RayAllen', 'RayAllen', 0), 0.56);
    expect(curry.releaseAt).toBeLessThan(curry.apexAt);
    expect(curry.apexAt - curry.releaseAt).toBeLessThan(0.05);
    expect(ray.releaseAt).toBeCloseTo(ray.apexAt, 9);
  });

  it('soltura rápida demais para o salto inteiro: o salto encolhe e a decolagem não vem antes de 45% do tempo', () => {
    const s = shotSchedule(shotFormOf('Kobe', 'Kobe', 'Kobe', 0), 0.25);
    expect(s.takeoffAt).toBeGreaterThanOrEqual(0.45 * 0.25 - 1e-9);
    expect(s.jump).toBeLessThan(ShotSignatures.Kobe.base.jump);
    expect(s.jump).toBeCloseTo((Gravity * s.rise * s.rise) / 2, 9);
  });
});

describe('pelve e voo', () => {
  it('a altura da pelve é contínua (sem salto de um quadro para o outro) e sobe o salto no ápice', () => {
    for (const id of ShotSignatureIds) {
      const form = shotFormOf(id, id, id, 0);
      const s = shotSchedule(form, 0.5);
      let prev = pelvisLift(form, s, 0, H);
      for (let t = 1 / 240; t < s.endAt; t += 1 / 240) {
        const y = pelvisLift(form, s, t, H);
        expect(Math.abs(y - prev)).toBeLessThan(0.02);
        prev = y;
      }
      expect(pelvisLift(form, s, s.apexAt, H)).toBeCloseTo(s.jump + 0.03, 6);
      expect(pelvisLift(form, s, s.dipAt, H)).toBeCloseTo(-form.base.dip * H, 6);
      expect(pelvisLift(form, s, s.endAt + 1, H)).toBeCloseTo(0, 4);
    }
  });

  it('sem tranco de velocidade: a extensão decola na velocidade do voo e o pouso entra na velocidade da queda', () => {
    const e = 1e-4;
    const vel = (f: (t: number) => number, t: number) => (f(t + e) - f(t - e)) / (2 * e);
    for (const id of ShotSignatureIds) {
      const form = shotFormOf(id, id, id, 0);
      const s = shotSchedule(form, 0.56);
      const y = (t: number) => pelvisLift(form, s, t, H);
      const before = (y(s.takeoffAt - e) - y(s.takeoffAt - 2 * e)) / e;
      const after = (y(s.takeoffAt + 2 * e) - y(s.takeoffAt + e)) / e;
      // A tangente é limitada a 3x a corda (a curva não desce antes de subir): fica perto, sem o salto inteiro de antes.
      expect(Math.abs(after - before)).toBeLessThan(0.45 * Gravity * s.rise);
      const landIn = (y(s.landAt - e) - y(s.landAt - 2 * e)) / e;
      const landOut = (y(s.landAt + 2 * e) - y(s.landAt + e)) / e;
      expect(Math.abs(landOut - landIn)).toBeLessThan(0.05);
      // O pouso afunda (absorve) e volta.
      let low = 0;
      for (let t = s.landAt; t < s.landAt + 0.5; t += 0.005) low = Math.min(low, y(t));
      expect(low).toBeLessThan(-0.01);
      expect(vel(y, s.dipAt)).toBeCloseTo(0, 2);
    }
  });

  it('a deriva anda em velocidade constante no ar e para depois do pouso', () => {
    const form = shotFormOf('Dirk', 'Dirk', 'Dirk', 0);
    const s = shotSchedule(form, 0.56);
    const a = s.takeoffAt + 0.3 * (s.landAt - s.takeoffAt);
    const b = s.takeoffAt + 0.7 * (s.landAt - s.takeoffAt);
    const v1 = (driftAt(form, s, a + 1e-3) - driftAt(form, s, a)) / 1e-3;
    const v2 = (driftAt(form, s, b + 1e-3) - driftAt(form, s, b)) / 1e-3;
    expect(v1).toBeCloseTo(v2, 6);
    expect(driftAt(form, s, s.landAt + 1)).toBeCloseTo(form.base.drift, 9);
    expect(driftAt(form, s, 0)).toBe(0);
  });

  it('o voo só existe entre a decolagem e o pouso', () => {
    const s = shotSchedule(shotFormOf('Curry', 'Curry', 'Curry', 0), 0.5);
    expect(airShape(s, s.takeoffAt - 0.01)).toBe(0);
    expect(airShape(s, (s.takeoffAt + s.landAt) / 2)).toBeCloseTo(1, 9);
    expect(airShape(s, s.landAt + 0.01)).toBe(0);
  });
});

describe('mistura e caminho da bola', () => {
  it('a mistura das releases é linear e fica entre as duas', () => {
    const a = ShotSignatures.Curry.release;
    const b = ShotSignatures.Oscar.release;
    expect(blendRelease(a, b, 0)).toEqual(a);
    expect(blendRelease(a, b, 1)).toEqual(b);
    const half = blendRelease(a, b, 0.5);
    expect(half.setPoint[1]).toBeCloseTo((a.setPoint[1] + b.setPoint[1]) / 2, 12);
    expect(half.followHold).toBeCloseTo((a.followHold + b.followHold) / 2, 12);
    expect(blendRelease(a, b, 3)).toEqual(b);
  });

  it('a bola parte de onde estava, passa pelo bolso e pelo set point e termina na soltura (alturas em metros)', () => {
    const form = shotFormOf('Oscar', 'Oscar', 'Oscar', 0);
    const s = shotSchedule(form, 0.5);
    const keys = ballKeys(form, s, [0.2, 0.5, 0.3], H);
    expect(keys[0]).toEqual([0, [0.2, 0.5, 0.3]]);
    expect(keys[keys.length - 1][0]).toBeCloseTo(s.releaseAt, 12);
    expect(keys[keys.length - 1][1][1]).toBeCloseTo(form.release.release[1] * H, 12);
    for (let i = 1; i < keys.length; i++) expect(keys[i][0]).toBeGreaterThan(keys[i - 1][0]);
    // Oscar segura no set point (dois tempos): há uma chave a mais.
    expect(keys.length).toBe(5);
  });

  it('a bola anda sem tranco: velocidade contínua nas chaves e acelerando até a soltura', () => {
    for (const id of ShotSignatureIds) {
      const form = shotFormOf(id, id, id, 0);
      const s = shotSchedule(form, 0.56);
      const keys = ballKeys(form, s, [0.15, 0.95, 0.3], H);
      for (let i = 1; i < keys.length - 1; i++) {
        const tk = keys[i][0];
        const a: [number, number, number] = [0, 0, 0];
        const b: [number, number, number] = [0, 0, 0];
        ballAt(keys, tk - 1e-6, a);
        ballAt(keys, tk + 1e-6, b);
        for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - b[k])).toBeLessThan(1e-3);
      }
      // Na soltura a bola sobe mais rápido que a média do último trecho (o empurrão não freia).
      const v: [number, number, number] = [0, 0, 0];
      ballAt(keys, s.releaseAt - 1e-4, v);
      const [t0, p0] = keys[keys.length - 2];
      const [t1, p1] = keys[keys.length - 1];
      expect(v[1]).toBeGreaterThan((p1[1] - p0[1]) / (t1 - t0));
      expect(ballAt(keys, s.releaseAt)[1]).toBeCloseTo(form.release.release[1] * H, 9);
    }
  });

  it('a bola sobe com o salto sem quina (softLift)', () => {
    expect(softLift(-1)).toBe(0);
    expect(softLift(0.5)).toBe(0.5);
    let prev = softLift(-0.1);
    for (let x = -0.1; x < 0.1; x += 0.001) {
      const y = softLift(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = y;
    }
  });

  it('todos os jogadores têm a soltura acima do set point e o set point acima do bolso', () => {
    for (const id of ShotSignatureIds) {
      const r = ShotSignatures[id].release;
      expect(r.release[1]).toBeGreaterThan(r.setPoint[1]);
      expect(r.setPoint[1]).toBeGreaterThan(r.pocket[1]);
    }
  });
});

describe('pull-up', () => {
  it('o embalo vai de 0 (andando) a 1 (sprint)', () => {
    expect(pullUpMomentum(0)).toBe(0);
    expect(pullUpMomentum(PullUpMinSpeed)).toBe(0);
    expect(pullUpMomentum(PullUpFullSpeed)).toBe(1);
    expect(pullUpMomentum(9)).toBe(1);
    expect(pullUpMomentum(3.9)).toBeGreaterThan(0.5);
  });

  it('vindo correndo: dip mais fundo e mais tarde, salto mais alto, fade menor; sem embalo nada muda', () => {
    for (const id of ShotSignatureIds) {
      const form = shotFormOf(id, id, id, 0);
      expect(pullUpForm(form, 0)).toBe(form);
      const pu = pullUpForm(form, 1);
      expect(pu.momentum).toBe(1);
      expect(pu.base.dip).toBeGreaterThan(form.base.dip);
      expect(pu.base.dipAt).toBeGreaterThanOrEqual(Math.min(form.base.dipAt, 0.7));
      expect(pu.base.jump).toBeGreaterThan(form.base.jump);
      expect(Math.abs(pu.base.drift)).toBeLessThanOrEqual(Math.abs(form.base.drift));
      expect(pu.release).toBe(form.release);
      // O cronograma continua válido e a soltura no tempo pedido.
      const s = shotSchedule(pu, 0.56);
      expect(s.releaseAt).toBeCloseTo(0.56, 12);
      expect(s.dipAt).toBeLessThan(s.takeoffAt);
    }
  });
});

describe('assinaturas', () => {
  it('cada jogador difere dos outros em pelo menos um traço visível', () => {
    const traits = (id: (typeof ShotSignatureIds)[number]) => {
      const { base: b, release: r } = ShotSignatures[id];
      return [b.jump / 0.05, b.drift / 0.1, b.kick / 0.3, b.oneLeg, b.sway / 4, b.leanRelease / 6, r.setPoint[1] / 0.06, r.setHold / 0.06, r.elbowFlare / 0.2, r.guideFollow / 0.4, b.pullHop / 0.5];
    };
    for (const a of ShotSignatureIds) {
      for (const b of ShotSignatureIds) {
        if (a >= b) continue;
        const ta = traits(a);
        const tb = traits(b);
        expect(Math.max(...ta.map((v, i) => Math.abs(v - tb[i])))).toBeGreaterThanOrEqual(0.8);
      }
    }
  });
});
