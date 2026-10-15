import { describe, expect, it } from 'vitest';
import { ShotFamilyTiming, shotPhase, shotTimeAt } from '../anim/ClipLibrary';

describe('fase do arremesso', () => {
  it('a soltura é a fase 0 nos dois clipes, e o dip é -1', () => {
    for (const family of ['JumpShot', 'JumpShot2'] as const) {
      const t = ShotFamilyTiming[family];
      expect(shotPhase(t.release, t)).toBeCloseTo(0, 12);
      expect(shotPhase(t.dip, t)).toBeCloseTo(-1, 12);
      expect(shotPhase(t.end, t)).toBeCloseTo(1, 12);
    }
  });

  it('shotTimeAt é o inverso de shotPhase em todas as fases', () => {
    for (const family of ['JumpShot', 'JumpShot2'] as const) {
      const t = ShotFamilyTiming[family];
      for (const phase of [-1, -0.5, 0, 0.3, 1]) {
        expect(shotPhase(shotTimeAt(phase, t), t)).toBeCloseTo(phase, 12);
      }
    }
  });

  it('a mistura casa as solturas: a mesma fase cai na soltura de cada família', () => {
    const a = ShotFamilyTiming.JumpShot;
    const b = ShotFamilyTiming.JumpShot2;
    expect(shotTimeAt(0, a)).toBeCloseTo(a.release, 12);
    expect(shotTimeAt(0, b)).toBeCloseTo(b.release, 12);
    // Meio caminho entre o dip e a soltura, em cada clipe.
    expect(shotTimeAt(-0.5, a)).toBeCloseTo((a.dip + a.release) / 2, 12);
  });

  it('a ordem dos tempos é dip < soltura < fim em cada família', () => {
    for (const family of ['JumpShot', 'JumpShot2'] as const) {
      const t = ShotFamilyTiming[family];
      expect(t.dip).toBeLessThan(t.release);
      expect(t.release).toBeLessThan(t.end);
    }
  });
});
