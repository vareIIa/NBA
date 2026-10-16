import { describe, expect, test } from 'vitest';
import {
  FinishRampMps2,
  FinishSpecs,
  finishForwardMps,
  finishHoldMs,
  finishKindFor,
  finishLiftM,
  finishRampMps,
  finishSchedule,
  finishUsesLeftHand,
} from './HoopsFinish';
import { ShotType } from './HoopsShotModel';

describe('bandeja e enterrada: gatilho do X perto do aro', () => {
  test('sem RT e sem ir para a cesta, o X é arremesso normal', () => {
    expect(finishKindFor(1.5, 0, false)).toBeNull();
    expect(finishKindFor(1.5, 1.5, false)).toBeNull(); // o limiar é estrito
  });

  test('indo para a cesta acima de 1,5 m/s, o X é bandeja', () => {
    expect(finishKindFor(2.0, 2.0, false)).toBe(ShotType.Layup);
  });

  test('com RT, até 2,4 m é enterrada; de 2,4 a 3 m, bandeja', () => {
    expect(finishKindFor(2.0, 0, true)).toBe(ShotType.Dunk);
    expect(finishKindFor(2.4, 0, true)).toBe(ShotType.Dunk);
    expect(finishKindFor(2.5, 0, true)).toBe(ShotType.Layup);
    expect(finishKindFor(2.9, 0, true)).toBe(ShotType.Layup);
  });

  test('até 3 m do aro, o X dispara; acima disso, não', () => {
    expect(finishKindFor(3, 2, false)).toBe(ShotType.Layup);
    expect(finishKindFor(3.1, 4, true)).toBeNull();
  });
});

describe('bandeja e enterrada: lado e mão', () => {
  test('à esquerda do aro, a bandeja é com a mão esquerda; à direita, com a direita', () => {
    expect(finishUsesLeftHand(-0.5, false)).toBe(true);
    expect(finishUsesLeftHand(0.5, true)).toBe(false);
  });

  test('no meio do aro (até 40 cm), vale a mão da bola', () => {
    expect(finishUsesLeftHand(0.1, true)).toBe(true);
    expect(finishUsesLeftHand(0.1, false)).toBe(false);
  });
});

describe('bandeja e enterrada: movimento', () => {
  test('a bandeja chega a 60 cm do aro na soltura', () => {
    expect(finishForwardMps(2, ShotType.Layup)).toBeCloseTo(1.4 / 0.42, 9);
  });

  test('a enterrada chega a 35 cm do aro em 0,48 s', () => {
    expect(finishForwardMps(1, ShotType.Dunk)).toBeCloseTo(0.65 / 0.48, 9);
  });

  test('com a rampa, a velocidade cobre a distância: v·T − v²/(2a) = D', () => {
    const v = finishRampMps(2, ShotType.Layup);
    const T = FinishSpecs[ShotType.Layup].releaseSeconds;
    expect(v * T - (v * v) / (2 * FinishRampMps2)).toBeCloseTo(2 - 0.6, 6);
  });

  test('a rampa pede um pouco mais de velocidade que a conta sem rampa', () => {
    expect(finishRampMps(2, ShotType.Layup)).toBeGreaterThan(finishForwardMps(2, ShotType.Layup));
    expect(finishRampMps(0.3, ShotType.Layup)).toBe(0);
    expect(finishRampMps(10, ShotType.Layup)).toBe(4.5);
  });

  test('com menos tempo até a soltura (X bufferizado), o clipe e a rampa acompanham', () => {
    const s = finishSchedule(ShotType.Layup, 0.3);
    expect(s.takeoffS + s.apexDelayS).toBeCloseTo(0.3, 9);
    expect(finishRampMps(2, ShotType.Layup, 0.3)).toBeGreaterThan(finishRampMps(2, ShotType.Layup));
  });

  test('já colado no aro, não anda; muito longe, o teto é 4,5 m/s', () => {
    expect(finishForwardMps(0.3, ShotType.Layup)).toBe(0);
    expect(finishForwardMps(10, ShotType.Layup)).toBe(4.5);
  });
});

describe('bandeja e enterrada: salto visual e soltura', () => {
  test('bandeja: a decolagem mais o ápice caem exatamente na soltura', () => {
    const s = finishSchedule(ShotType.Layup);
    expect(s.takeoffS + s.apexDelayS).toBeCloseTo(FinishSpecs[ShotType.Layup].releaseSeconds, 9);
  });

  test('enterrada: a soltura vem um pouco depois do ápice', () => {
    const s = finishSchedule(ShotType.Dunk);
    expect(s.takeoffS + s.apexDelayS).toBeLessThan(FinishSpecs[ShotType.Dunk].releaseSeconds);
  });

  test('o salto sobe até o ápice e volta ao chão', () => {
    const { apexDelayS } = finishSchedule(ShotType.Layup);
    expect(finishLiftM(0, apexDelayS)).toBe(0);
    expect(finishLiftM(2 * apexDelayS, apexDelayS)).toBe(0);
    const peak = finishLiftM(apexDelayS, apexDelayS);
    expect(peak).toBeCloseTo(0.5 * 9.8 * apexDelayS * apexDelayS, 9);
    expect(finishLiftM(apexDelayS - 0.05, apexDelayS)).toBeCloseTo(finishLiftM(apexDelayS + 0.05, apexDelayS), 9);
  });

  test('sem tranco: a velocidade vertical é zero na decolagem e na aterrissagem', () => {
    const { apexDelayS } = finishSchedule(ShotType.Layup);
    const eps = 1e-4;
    const startSlope = (finishLiftM(eps, apexDelayS) - finishLiftM(0, apexDelayS)) / eps;
    const landSlope = (finishLiftM(2 * apexDelayS, apexDelayS) - finishLiftM(2 * apexDelayS - eps, apexDelayS)) / eps;
    expect(Math.abs(startSlope)).toBeLessThan(0.01);
    expect(Math.abs(landSlope)).toBeLessThan(0.01);
  });

  test('a soltura: a enterrada sai no ideal; a bandeja, um pouco fora do perfeito', () => {
    expect(finishHoldMs(ShotType.Layup, 500, 40)).toBe(541);
    expect(finishHoldMs(ShotType.Dunk, 500, 40)).toBe(500);
  });

  test('ratings da UE: bandeja 85, enterrada 80', () => {
    expect(FinishSpecs[ShotType.Layup].rating).toBe(85);
    expect(FinishSpecs[ShotType.Dunk].rating).toBe(80);
  });
});
