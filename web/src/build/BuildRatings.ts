// O que a build muda no Freestyle. Os números são relativos à build padrão (DefaultBuild): com ela, tudo dá exatamente
// o que estava fixo no código antes do builder (arremesso 85, bandeja 85, enterrada 80, velocidades, aceleração e
// energia 1×, enterrada liberada, subida da enterrada de sempre). Ainda não entram: os atributos de defesa e rebote (o
// Freestyle não tem defesa) e os requisitos de atributo das badges (docs/23 §3).
import type { DribbleModifiers } from '../sim';
import { PlayerHeightMeters } from '../anim/ProceduralMoves';
import { type DunkAbility, dunkAbility } from '../sim/HoopsLayup';
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
  /** Multiplica a velocidade máxima sem a bola (Velocidade). 1 na build padrão. */
  runSpeedScale: number;
  /** Multiplica a aceleração do movimento (Aceleração). 1 na build padrão. */
  accelScale: number;
  /** Multiplica o custo de energia dos dribles e do arranque (Controle de bola: mais controle, menos custo). */
  handleEnergyScale: number;
  /** Multiplica a velocidade dos dribles (Controle de bola). 1 na build padrão. */
  handlePlayRate: number;
  /** Multiplica o gasto de energia do sprint (Resistência). 1 na build padrão. */
  staminaDrainScale: number;
  /** Pode enterrar: Enterrada em infiltração ≥ 55 e Impulsão ≥ 35. Abaixo disso, o RT perto do aro vira bandeja. */
  canDunk: boolean;
  /** Que enterradas (estilos, parada, pendurar) e quanto sobe (Impulsão): sessão das enterradas, HoopsLayup.dunkAbility. */
  dunk: DunkAbility;
}

/** Faixa linear de um atributo (25 → `at25`, 99 → `at99`). */
const span = (v: number, at25: number, at99: number): number => at25 + ((at99 - at25) * (v - 25)) / 74;

/**
 * Mínimos para enterrar (regra nossa, no número do pacote mais simples do 2K26, "Hangs Off One": Driving Dunk 55 +
 * Vertical 35; fonte fraca, trecho de busca; ver docs/23 §2).
 */
export const DunkMinimum = { drivingDunk: 55, vertical: 35 } as const;

function raw(b: PlayerBuild) {
  const a = b.attrs;
  return {
    speed: span(a.speedWithBall, 0.85, 1.15),
    run: span(a.speed, 0.85, 1.15),
    accel: span(a.acceleration, 0.8, 1.15),
    handleEnergy: span(a.ballHandle, 1.35, 0.65),
    handleRate: span(a.ballHandle, 0.9, 1.05),
    // A Resistência começa em 85 (2K25) e só sobe: 85 → 1, 99 → 0,82.
    stamina: 1 - (0.18 * (Math.max(85, a.stamina) - 85)) / 14,
  };
}

/** Ratings que o Freestyle usa para esta build. */
export function playRatings(b: PlayerBuild): PlayRatings {
  const a = b.attrs;
  const d = DefaultBuild.attrs;
  const r = raw(b);
  const r0 = raw(DefaultBuild);
  return {
    threePoint: a.threePoint,
    midRange: a.midRange,
    closeShot: a.closeShot,
    freeThrow: a.freeThrow,
    layupOffset: a.drivingLayup - d.drivingLayup,
    dunkOffset: a.drivingDunk - d.drivingDunk,
    speedScale: r.speed / r0.speed,
    runSpeedScale: r.run / r0.run,
    accelScale: r.accel / r0.accel,
    handleEnergyScale: r.handleEnergy / r0.handleEnergy,
    handlePlayRate: r.handleRate / r0.handleRate,
    staminaDrainScale: r.stamina / r0.stamina,
    canDunk: a.drivingDunk >= DunkMinimum.drivingDunk && a.vertical >= DunkMinimum.vertical,
    dunk: dunkAbility(a.drivingDunk, a.standingDunk, a.vertical),
  };
}

/** Distância (m) abaixo da qual o arremesso de meia vira "de perto" (Close Shot). */
export const CloseShotMeters = 3.05;

/** Rating do arremesso: de 3, de perto (até ~3 m) ou de meia. */
export const jumpShotRating = (r: PlayRatings, isThree: boolean, distanceMeters: number): number =>
  isThree ? r.threePoint : distanceMeters < CloseShotMeters ? r.closeShot : r.midRange;

/**
 * Aplica a build nos multiplicadores do drible que as badges e o takeover montam a cada quadro (MatchDirector): os da
 * build multiplicam os deles. Chame depois do MatchDirector.update (ele troca o objeto a cada quadro).
 */
export function applyDribbleRatings(mods: DribbleModifiers, r: PlayRatings): void {
  mods.moveEnergyScale *= r.handleEnergyScale;
  mods.burstEnergyScale *= r.handleEnergyScale;
  mods.movePlayRate *= r.handlePlayRate;
  mods.sprintDrainScale *= r.staminaDrainScale;
}

/**
 * Escala do corpo no jogo: altura da build / altura do boneco (PlayerHeightMeters). A build padrão tem a altura do boneco
 * (escala 1); 5'9" ≈ 0,94 e 7'4" ≈ 1,20. A envergadura não muda o tamanho do boneco (só os atributos e o alcance).
 */
export const bodyScaleOf = (heightCm: number): number => heightCm / (PlayerHeightMeters * 100);

/**
 * Quanto a envergadura passa da do boneco (m): o braço do boneco é o da build padrão (+3" da altura). Cada braço do
 * PlayerAnimator alonga metade disso (setBodyScale). 0 na build padrão.
 */
export const wingspanOverModelM = (body: { heightCm: number; wingspanCm: number }): number =>
  (body.wingspanCm - body.heightCm - (DefaultBuild.body.wingspanCm - DefaultBuild.body.heightCm)) / 100;

/** Ratings da build padrão (os números de antes do builder). */
export const DefaultPlayRatings: PlayRatings = playRatings(DefaultBuild);
