// Rebote com as duas mãos: onde e quando as mãos encontram a bola (X parado, Y no pulo).
import { describe, expect, it } from 'vitest';
import { Vec3 } from '../sim';
import { CatchTiming, ContestTiming, airTime } from '../anim/DefenseMotion';
import { type CatchBody, defaultReachM, planCatch } from './ReboundCatch';
import { missDecided } from './OnlineMatch';
import { makeBallState } from '../sim';

const body: CatchBody = { pos: new Vec3(6, 0, 0), facing: new Vec3(-1, 0, 0), heightM: 1.96, wingspanM: 2.05 };
const reach = defaultReachM(body.wingspanM);
const shoulders = (lift = 0) => new Vec3(5.95, 0, 1.96 * 0.82 + lift);

describe('planCatch', () => {
  it('X: bola caindo à frente do peito é pega parado, ao alcance do braço', () => {
    const plan = planCatch(new Vec3(5.6, 0, 2.6), new Vec3(0, 0, -1), body, 0);
    expect(plan.reachable).toBe(true);
    expect(plan.at).toBeGreaterThanOrEqual(CatchTiming.minReach);
    expect(plan.target.sub(shoulders()).length()).toBeLessThanOrEqual(reach + 1e-6);
    expect(plan.target.z).toBeGreaterThan(1.96 * 0.5);
  });

  it('bola alta demais para X; com Y (pulo) as mãos chegam nela no ar', () => {
    const p = new Vec3(5.7, 0, 3.4);
    const v = new Vec3(0, 0, 1.5); // ainda subindo do aro
    expect(planCatch(p, v, body, 0).reachable).toBe(false);
    const y = planCatch(p, v, body, 0.6);
    expect(y.reachable).toBe(true);
    expect(y.at).toBeGreaterThan(ContestTiming.load);
    expect(y.at).toBeLessThan(ContestTiming.load + airTime(0.6));
    expect(y.target.z).toBeGreaterThan(2.6);
  });

  it('bola longe: as mãos vão até o alcance, na direção dela, e voltam vazias', () => {
    const plan = planCatch(new Vec3(2, 0, 2), new Vec3(0, 0, 0), body, 0);
    expect(plan.reachable).toBe(false);
    expect(plan.target.sub(shoulders()).length()).toBeLessThanOrEqual(reach + 1e-6);
    expect(plan.target.x).toBeLessThan(5.95); // foi para o lado da bola
  });

  it('o alcance é o do braço a partir dos ombros: bola a 0,85 m à frente na altura do ombro não é pegada', () => {
    expect(reach).toBeGreaterThan(0.6);
    expect(reach).toBeLessThan(0.8);
    expect(planCatch(new Vec3(5.1, 0, 1.75), new Vec3(0, 0, 0), body, 0).reachable).toBe(false);
    // Com o braço medido no esqueleto (mais longo), passa a ser.
    expect(planCatch(new Vec3(5.1, 0, 1.75), new Vec3(0, 0, 0), { ...body, reachM: 0.95 }, 0).reachable).toBe(true);
  });

  it('bola na altura do joelho não é pegada de mãos (é a de passar por cima)', () => {
    expect(planCatch(new Vec3(5.6, 0, 0.6), new Vec3(0, 0, 0), body, 0).reachable).toBe(false);
  });
});

describe('missDecided (erro antes do quique)', () => {
  const rim = new Vec3(0, 0, 3.05);
  it('descendo abaixo do aro: erro; subindo: ainda não', () => {
    expect(missDecided(makeBallState(new Vec3(0.5, 0, 2.6), new Vec3(0, 0, -2)), rim)).toBe(true);
    expect(missDecided(makeBallState(new Vec3(0.5, 0, 2.6), new Vec3(0, 0, 2)), rim)).toBe(false);
  });
  it('rebote longo: descendo longe do aro e indo embora já não entra; vindo para o aro ainda pode', () => {
    expect(missDecided(makeBallState(new Vec3(2, 0, 3.6), new Vec3(1, 0, -1)), rim)).toBe(true);
    expect(missDecided(makeBallState(new Vec3(2, 0, 3.6), new Vec3(-3, 0, -1)), rim)).toBe(false);
    expect(missDecided(makeBallState(new Vec3(0.6, 0, 3.6), new Vec3(1, 0, -1)), rim)).toBe(false);
  });
});
