// Linha do tempo da defesa (DefenseMotion): pulo de contestação e tapa do roubo.
import { describe, expect, it } from 'vitest';
import { CatchTiming, ContestTiming, DefenseMotion, StealTiming, airTime, catchAt, contestJumpAt, stealReachAt } from './DefenseMotion';
import * as THREE from 'three';

describe('DefenseMotion', () => {
  it('pulo: agacha, sobe até a altura pedida no meio do voo, pousa; os braços sobem antes da decolagem', () => {
    const h = 0.6;
    const air = airTime(h);
    expect(air).toBeCloseTo(2 * Math.sqrt((2 * h) / 9.81), 6);
    expect(contestJumpAt(0.05, h).lift).toBe(0);
    expect(contestJumpAt(ContestTiming.armsIn, h).arms).toBeCloseTo(1, 6);
    const apex = contestJumpAt(ContestTiming.load + air / 2, h);
    expect(apex.lift).toBeCloseTo(h, 6);
    expect(apex.airborne).toBe(true);
    const landed = contestJumpAt(ContestTiming.load + air + 0.01, h);
    expect(landed.lift).toBe(0);
    expect(landed.arms).toBeGreaterThan(0.9); // braços ainda em cima logo depois do pouso
    expect(contestJumpAt(ContestTiming.load + air + ContestTiming.landHold + ContestTiming.armsOut, h).done).toBe(true);
  });

  it('um pulo por vez; o estado diz mãos e altura; com a bola na mão os braços largam a defesa', () => {
    const d = new DefenseMotion();
    expect(d.jump(0.5)).toBe(true);
    for (let i = 0; i < 20; i++) d.update(1 / 60, false);
    expect(d.airborne).toBe(true);
    expect(d.jump(0.5)).toBe(false);
    const s = d.state();
    expect(s.handsUp).toBeGreaterThan(0.95);
    expect(s.jump).toBeGreaterThan(0.2);
    for (let i = 0; i < 30; i++) d.update(1 / 60, true);
    expect(d.state().handsUp).toBeLessThan(0.05);
    for (let i = 0; i < 120; i++) d.update(1 / 60, false);
    expect(d.state()).toEqual({ handsUp: 0, jump: 0 });
  });

  it('mãos para cima segurando o RS; tapa vai e volta', () => {
    const d = new DefenseMotion();
    d.setHandsUp(true);
    for (let i = 0; i < 30; i++) d.update(1 / 60, false);
    expect(d.state().handsUp).toBeGreaterThan(0.95);
    expect(d.state().jump).toBe(0);
    d.setHandsUp(false);
    for (let i = 0; i < 60; i++) d.update(1 / 60, false);
    expect(d.state().handsUp).toBeLessThan(0.01);
    expect(stealReachAt(StealTiming.out + StealTiming.hold / 2)).toBeCloseTo(1, 6);
    expect(stealReachAt(StealTiming.out + StealTiming.hold + StealTiming.back)).toBe(0);
    expect(stealReachAt(-0.01)).toBe(0);
  });
});

describe('DefenseMotion: rebote com as duas mãos', () => {
  it('as mãos chegam no contato, seguram, levam ao peito, protegem e largam', () => {
    const C = CatchTiming;
    expect(catchAt(0.05, 0.3).phase).toBe('reach');
    expect(catchAt(0.3 + C.grip / 2, 0.3).phase).toBe('grip');
    expect(catchAt(0.3 + C.grip + C.pull / 2, 0.3).phase).toBe('pull');
    expect(catchAt(0.3 + C.grip + C.pull + C.hold / 2, 0.3).phase).toBe('hold');
    const out = catchAt(0.3 + C.grip + C.pull + C.hold + C.out / 2, 0.3);
    expect(out.phase).toBe('out');
    expect(out.w).toBeGreaterThan(0);
    expect(out.w).toBeLessThan(1);
    expect(catchAt(0.3 + C.grip + C.pull + C.hold + C.out + 1e-6, 0.3).done).toBe(true);
    // Contato cedo demais: as mãos levam pelo menos minReach.
    expect(catchAt(C.minReach - 0.01, 0).phase).toBe('reach');
  });

  it('Y pula junto; cancelada, a pegada larga e acaba', () => {
    const d = new DefenseMotion();
    d.catchBall(new THREE.Vector3(0, 2.8, 0.5), 0.4, 0.55);
    for (let i = 0; i < 15; i++) d.update(1 / 60, false);
    expect(d.state().jump).toBeGreaterThan(0.1);
    expect(d.catchPhase()?.phase).toBe('reach');
    d.cancelCatch();
    d.update(1 / 60, false);
    expect(d.catchPhase()?.phase).toBe('out');
    for (let i = 0; i < 30; i++) d.update(1 / 60, false);
    expect(d.catchPhase()).toBeNull();
  });
});
