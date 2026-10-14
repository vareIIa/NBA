// Testes da camada de animação que não precisam de WebGL: dados dos clipes, fase do drible, eventos e IK.
import { readFileSync } from 'node:fs';
import { Bone, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import {
  type ClipsFile,
  crossedFrames,
  dribblePhase,
  frameAtPhase,
  framesToNextPeak,
  moveClipFor,
  spinTurnAlpha,
} from './ClipLibrary';
import { solveTwoBoneIK } from './TwoBoneIK';

const clips = (JSON.parse(readFileSync('public/assets/hoops_player.clips.json', 'utf-8')) as ClipsFile).clips;

describe('Clipes exportados (Tools/Animacao/exportar_glb.py)', () => {
  test('ClipsExistForEveryLoopAndMove', () => {
    const needed = [
      'Dribble_Idle_R', 'Dribble_Idle_L', 'Dribble_Low_R', 'Dribble_Low_L', 'Dribble_Walk_R', 'Dribble_Walk_L',
      'Dribble_Run_R', 'Dribble_Run_L', 'Dribble_Back_R', 'Dribble_Back_L', 'Dribble_Side_R', 'Dribble_Side_L',
      'Cross_R2L', 'Cross_L2R', 'EscapeCross_R2L', 'EscapeCross_L2R', 'Spin_R2L', 'Spin_L2R',
      'BetweenLegs_R2L', 'BetweenLegs_L2R', 'Hesitation_R', 'Hesitation_L', 'JumpShot2_R', 'JumpShot2_L',
    ];
    for (const name of needed) expect(clips[name], name).toBeDefined();
    expect(Object.keys(clips)).toHaveLength(38);
  });

  test('DribbleLoopsHaveTwoBouncesPerSecondOrSo', () => {
    // Cada loop de drible tem empurrões (vales da palma) da mão da bola num ritmo de 1,5–3,5 quiques/s.
    for (const name of ['Dribble_Idle_R', 'Dribble_Idle_L', 'Dribble_Walk_R', 'Dribble_Low_R', 'Dribble_Back_R']) {
      const info = clips[name];
      const hand = name.endsWith('_L') ? 'l' : 'r';
      const valleys = hand === 'r' ? info.valleys_r : info.valleys_l;
      expect(valleys.length, name).toBeGreaterThan(0);
      const perSecond = valleys.length / ((info.frames - 1) / 60);
      expect(perSecond, name).toBeGreaterThan(1.2);
      expect(perSecond, name).toBeLessThan(3.6);
    }
  });

  test('MirroredClipsSwapHands', () => {
    // O _L é o espelho do _R: a palma esquerda do _L faz o que a direita do _R faz, com X trocado de sinal
    // (até ~3 cm: o esqueleto da CMU não é simétrico, a clavícula esquerda é mais longa).
    const r = clips['Dribble_Idle_R'];
    const l = clips['Dribble_Idle_L'];
    for (const f of [0, 10, 25, 40]) {
      expect(l.palm_l[f][0]).toBeCloseTo(-r.palm_r[f][0], 1);
      expect(l.palm_l[f][1]).toBeCloseTo(r.palm_r[f][1], 1);
    }
    expect(moveClipFor('Cross', 'l')).toBe('Cross_L2R');
    expect(moveClipFor('Hesitation', 'l')).toBe('Hesitation_L');
    expect(moveClipFor('Spin', 'r')).toBe('Spin_R2L');
  });
});

describe('Fase e eventos do drible', () => {
  const info = clips['Dribble_Idle_R'];

  test('PhaseIsZeroAtPushAndRoundTrips', () => {
    const v = info.valleys_r[0];
    expect(dribblePhase(info, 'r', v)).toBeCloseTo(0, 6);
    for (const phase of [0.1, 0.4, 0.75]) {
      const frame = frameAtPhase(info, 'r', phase)!;
      expect(dribblePhase(info, 'r', frame)).toBeCloseTo(phase, 6);
    }
    expect(dribblePhase(info, 'l', 3)).toBeNull(); // o _R não tem empurrões da esquerda
  });

  test('PhaseTransfersBetweenLoops', () => {
    // Trocar de parado para andando na metade do quique cai na metade do quique do clipe novo.
    const walk = clips['Dribble_Walk_R'];
    const frame = frameAtPhase(walk, 'r', 0.5)!;
    expect(dribblePhase(walk, 'r', frame)).toBeCloseTo(0.5, 6);
  });

  test('CrossedFramesHandlesLoopWrap', () => {
    expect(crossedFrames([2, 28], 1, 3, 50)).toEqual([2]);
    expect(crossedFrames([2, 28], 3, 20, 50)).toEqual([]);
    expect(crossedFrames([2, 28], 48, 4, 50)).toEqual([2]); // deu a volta
    expect(crossedFrames([2, 28], 27, 28, 50)).toEqual([28]);
  });

  test('CatchComesAfterReleaseInsideTheCycle', () => {
    // Do empurrão até a recepção: menos que um ciclo e mais que 0,12 s (a bola precisa ir ao chão e voltar).
    for (const v of info.valleys_r) {
      const frames = framesToNextPeak(info, 'r', v)!;
      expect(frames / 60).toBeGreaterThan(0.12);
      expect(frames).toBeLessThan(info.frames);
    }
  });

  test('SpinTurnCurveIsMonotonic', () => {
    let prev = -1;
    for (let a = 0; a <= 1.0001; a += 0.05) {
      const v = spinTurnAlpha(a);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(spinTurnAlpha(0)).toBe(0);
    expect(spinTurnAlpha(1)).toBe(1);
  });
});

describe('IK de duas articulações', () => {
  function leg(): { hip: Bone; knee: Bone; ankle: Bone } {
    const hip = new Bone();
    const knee = new Bone();
    const ankle = new Bone();
    hip.position.set(0, 1, 0);
    knee.position.set(0, -0.48, 0.02); // joelho levemente à frente: define o plano de dobra
    ankle.position.set(0, -0.46, -0.02);
    hip.add(knee);
    knee.add(ankle);
    hip.updateMatrixWorld(true);
    return { hip, knee, ankle };
  }

  test('ReachesTargetWhenCrouching', () => {
    const { hip, knee, ankle } = leg();
    const target = new Vector3(0.05, 0.15, 0.05); // quadril desceu: o tornozelo tem de ficar no chão
    const error = solveTwoBoneIK(hip, knee, ankle, target);
    expect(error).toBeLessThan(1e-4);
    // O joelho dobra para a frente (o lado que a animação já dobrava), não para trás.
    expect(knee.getWorldPosition(new Vector3()).z).toBeGreaterThan(0.05);
  });

  test('KeepsBoneLengths', () => {
    const { hip, knee, ankle } = leg();
    const lenA = knee.getWorldPosition(new Vector3()).distanceTo(hip.getWorldPosition(new Vector3()));
    solveTwoBoneIK(hip, knee, ankle, new Vector3(0.1, 0.3, 0.2));
    const h = hip.getWorldPosition(new Vector3());
    const k = knee.getWorldPosition(new Vector3());
    expect(k.distanceTo(h)).toBeCloseTo(lenA, 6);
  });

  test('OutOfReachStretchesTowardTarget', () => {
    const { hip, knee, ankle } = leg();
    solveTwoBoneIK(hip, knee, ankle, new Vector3(0, -2, 0));
    const a = ankle.getWorldPosition(new Vector3());
    expect(a.y).toBeLessThan(0.1); // esticou para baixo o máximo possível
  });
});
