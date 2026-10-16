// Bandeja e enterrada (porte de HoopsPlayerCharacter.cpp: BeginShot, BeginFinish, UpdateFinish e ReleaseFinish). Regras e
// tempos puros: o boneco e a bola ficam no Freestyle. Clipes: Layup_R, Layup_L e Dunk (HoopsDummyRig.h, 60 quadros/s).
import { clamp } from './HoopsMath';
import { ShotType } from './HoopsShotModel';

export type FinishType = ShotType.Layup | ShotType.Dunk;

/** Gatilho do X perto do aro (UE: BeginShot). Sem RT, a bola precisa estar indo para a cesta; a enterrada exige RT. */
export const FinishTrigger = {
  maxDistanceM: 3, // a Unreal usa 2,6 m
  approachMps: 1.5,
  dunkMaxDistanceM: 2.4,
};

/** Quadros do clipe em segundos (UE: FFinishTiming). A soltura da enterrada vem depois do ápice, descendo as mãos. */
export interface FinishClipTiming {
  gather: number;
  takeoff: number;
  apex: number;
  release: number;
  end: number;
}

export interface FinishSpec {
  rating: number; // bandeja 85, enterrada 80 (UE: LayupRating e DunkRating)
  releaseSeconds: number; // do gather à soltura, em tempo real (UE: LayupReleaseSeconds e DunkReleaseSeconds)
  stopShortM: number; // na soltura, o boneco chega a esta distância do aro (UE: LayupStopShortCm e DunkStopShortCm)
  timing: FinishClipTiming;
}

const clipSeconds = (gather: number, takeoff: number, apex: number, release: number, end: number): FinishClipTiming => ({
  gather: gather / 60,
  takeoff: takeoff / 60,
  apex: apex / 60,
  release: release / 60,
  end: end / 60,
});

export const FinishSpecs: Record<FinishType, FinishSpec> = {
  [ShotType.Layup]: { rating: 85, releaseSeconds: 0.42, stopShortM: 0.6, timing: clipSeconds(18, 25, 45, 45, 82) },
  [ShotType.Dunk]: { rating: 80, releaseSeconds: 0.48, stopShortM: 0.35, timing: clipSeconds(22, 25, 45, 49, 82) },
};

const Gravity = 9.8; // m/s²: o salto visual é o da UE (JumpZ = g × tempo de subida)
const MaxForwardMps = 4.5; // 450 cm/s, o teto da UE
/** Ângulo da bola quando a bandeja ou a enterrada erra (UE: LaunchAngleDeg 62). */
export const FinishLaunchAngleDeg = 62;
/** Enterrada que entra: a bola começa 22 cm acima do centro do aro e cai reta (UE: ReleaseFinish). */
export const DunkRimHeightM = 0.22;
export const DunkDropMps = 4;

/** O que o X dispara perto do aro, ou null (arremesso normal). Espelha BeginShot. */
export function finishKindFor(distanceM: number, approachMps: number, sprint: boolean): FinishType | null {
  if (distanceM > FinishTrigger.maxDistanceM) return null;
  if (!sprint && approachMps <= FinishTrigger.approachMps) return null;
  return sprint && distanceM <= FinishTrigger.dunkMaxDistanceM ? ShotType.Dunk : ShotType.Layup;
}

/** Bandeja com a mão esquerda: o jogador está do lado esquerdo do aro (40 cm do meio) ou no meio, com a bola na esquerda. */
export function finishUsesLeftHand(sideM: number, ballHandLeft: boolean): boolean {
  return sideM < -0.4 || (sideM <= 0.4 && ballHandLeft);
}

/** Velocidade rumo à cesta até a soltura: o boneco chega ao ponto de parada na hora em que a bola sai (UE: FinishForwardCm). */
export function finishForwardMps(distanceM: number, kind: FinishType): number {
  const spec = FinishSpecs[kind];
  return clamp((distanceM - spec.stopShortM) / spec.releaseSeconds, 0, MaxForwardMps);
}

/** Aceleração (m/s²) da rampa até a velocidade de entrada: a mesma do impulso de um drible (Freestyle.MoveAcceleration). */
export const FinishRampMps2 = 30;

/**
 * Velocidade rumo à cesta com a rampa de FinishRampMps2 a partir do parado: a distância percorrida é v·T − v²/(2a), e ela
 * tem de dar D. Sem a rampa, a conta de finishForwardMps deixaria o boneco atrasado no aro.
 */
export function finishRampMps(distanceM: number, kind: FinishType, seconds = FinishSpecs[kind].releaseSeconds): number {
  const spec = FinishSpecs[kind];
  const d = distanceM - spec.stopShortM;
  if (d <= 0) return 0;
  const a = FinishRampMps2;
  const T = seconds;
  const disc = T * T - (2 * d) / a;
  if (disc <= 0) return MaxForwardMps;
  return clamp(a * (T - Math.sqrt(disc)), 0, MaxForwardMps);
}

/** Freio depois da soltura: a velocidade cai a zero em cosseno, em tanto tempo (sem o tranco de um corte seco). */
export const FinishLandingSeconds = 0.1;

/**
 * Relógio real do clipe: velocidade de reprodução, e decolagem e ápice em segundos desde o começo do clipe (UE:
 * BeginFinish). `seconds` é o tempo até a soltura; menor que o da UE quando o X foi bufferizado.
 */
export function finishSchedule(
  kind: FinishType,
  seconds = FinishSpecs[kind].releaseSeconds,
): { rate: number; takeoffS: number; apexDelayS: number } {
  const t = FinishSpecs[kind].timing;
  const rate = (t.release - t.gather) / seconds;
  return { rate, takeoffS: (t.takeoff - t.gather) / rate, apexDelayS: (t.apex - t.takeoff) / rate };
}

/**
 * Altura (m) t segundos depois da decolagem: sobe até o ápice e volta ao chão em 2 × apexDelayS. É um cosseno, então a
 * velocidade vertical é zero na decolagem e na aterrissagem (a parábola dava um tranco nas duas pontas).
 */
export function finishLiftM(t: number, apexDelayS: number): number {
  if (t <= 0 || t >= 2 * apexDelayS) return 0;
  const peak = 0.5 * Gravity * apexDelayS * apexDelayS;
  return (peak * (1 - Math.cos((Math.PI * t) / apexDelayS))) / 2;
}

/** Soltura da bandeja ou da enterrada, em ms: a enterrada conta como ideal; a bandeja sai um pouco fora do perfeito (UE). */
export function finishHoldMs(kind: FinishType, idealReleaseMs: number, perfectHalfMs: number): number {
  return kind === ShotType.Dunk ? idealReleaseMs : idealReleaseMs + perfectHalfMs + 1;
}
