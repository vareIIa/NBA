// O que a build muda no Freestyle hoje. Os números são relativos à build padrão (DefaultBuild): com ela, tudo dá
// exatamente o que estava fixo no código antes do builder (arremesso 85, bandeja 85, enterrada 80, velocidade 1×).
// Ainda não entram: aceleração, controle de bola no drible, impulsão, resistência na barra de energia e as badges que
// exigem atributo mínimo (docs/23 §6).
import { DefaultBuild } from './BuildRules';
import type { PlayerBuild } from './PlayerBuild';

export interface PlayRatings {
  /** Rating do ShotModel por tipo de arremesso (de 3, de meia, de perto). */
  threePoint: number;
  midRange: number;
  closeShot: number;
  freeThrow: number;
  /** Somado ao rating da bandeja (o plano da bandeja já mexe nele pela dificuldade). 0 na build padrão. */
  layupOffset: number;
  /** Somado ao rating da enterrada. 0 na build padrão. */
  dunkOffset: number;
  /** Multiplica a velocidade máxima driblando (Velocidade com bola). 1 na build padrão. */
  speedScale: number;
}

/** Velocidade com bola → fator de velocidade (25 → 0,85 · 99 → 1,15), antes de normalizar pela padrão. */
const rawSpeed = (v: number): number => 0.85 + (0.3 * (v - 25)) / 74;

/** Ratings que o Freestyle usa para esta build. */
export function playRatings(b: PlayerBuild): PlayRatings {
  const a = b.attrs;
  const d = DefaultBuild.attrs;
  return {
    threePoint: a.threePoint,
    midRange: a.midRange,
    closeShot: a.closeShot,
    freeThrow: a.freeThrow,
    layupOffset: a.drivingLayup - d.drivingLayup,
    dunkOffset: a.drivingDunk - d.drivingDunk,
    speedScale: rawSpeed(a.speedWithBall) / rawSpeed(d.speedWithBall),
  };
}

/** Distância (m) abaixo da qual o arremesso de meia vira "de perto" (Close Shot). */
export const CloseShotMeters = 3.05;

/** Rating do arremesso: de 3, de perto (até ~3 m) ou de meia. */
export const jumpShotRating = (r: PlayRatings, isThree: boolean, distanceMeters: number): number =>
  isThree ? r.threePoint : distanceMeters < CloseShotMeters ? r.closeShot : r.midRange;

/** Ratings da build padrão (os números de antes do builder). */
export const DefaultPlayRatings: PlayRatings = playRatings(DefaultBuild);
