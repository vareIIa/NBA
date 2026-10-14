// Porte de HoopsContest.h/.cpp.
// Contestação geométrica (docs/03-arremessos.md §3.3): o que o defensor PARECE fazer é o que conta.
// contest = proximidade(mão → linha da bola) × cobertura angular × fator de altura × fator de rating, em [0, 1].
// A camada do jogo amostra isso numa janela em torno da soltura e usa o maior valor.
import { Vec3, clamp, distance, lerp, upVector } from './HoopsMath';

export interface DefenderPose {
  feetPosition: Vec3; // chão sob o defensor (m)
  height: number; // m
  wingspan: number; // m
  handsUpAmount: number; // 0 = mãos baixas, 1 = braço todo esticado para cima
  jumpHeight: number; // m acima do chão neste instante
  perimeterDefense: number; // rating (25–99)
}

export const makeDefenderPose = (overrides: Partial<DefenderPose> = {}): DefenderPose => ({
  feetPosition: new Vec3(),
  height: 2.0,
  wingspan: 2.08,
  handsUpAmount: 0,
  jumpHeight: 0,
  perimeterDefense: 75,
  ...overrides,
});

export interface ContestBreakdown {
  contest: number;
  proximity: number;
  angular: number;
  heightFactor: number;
  ratingFactor: number;
  handToPathMeters: number;
  handPosition: Vec3; // mão mais alta do defensor (para o debug do laboratório)
  closestPathPoint: Vec3; // ponto da trajetória mais perto da mão
}

export interface ContestConfig {
  fullContestDistance: number; // mão a até 25 cm da trajetória = contestação máxima
  zeroContestDistance: number; // além disso, não contesta
  pathLength: number; // trecho inicial da trajetória considerado (m)
  armReachForward: number; // mão vai até 30 cm à frente do corpo na direção do arremessador
}

export const defaultContestConfig = (): ContestConfig => ({
  fullContestDistance: 0.25,
  zeroContestDistance: 1.5,
  pathLength: 1.4,
  armReachForward: 0.3,
});

// Alcance em pé (chão até a ponta dos dedos com o braço esticado). Calibrado com medidas de combine:
// 2,01 m de altura e 2,11 m de envergadura => ~2,66 m.
const standingReach = (defender: DefenderPose): number => defender.height * 0.8 + defender.wingspan * 0.5;

function smoothStep01(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function closestPointOnSegment(point: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = b.sub(a);
  const lenSq = ab.lengthSquared();
  if (lenSq < 1e-12) {
    return a;
  }
  const t = clamp(point.sub(a).dot(ab) / lenSq, 0, 1);
  return a.add(ab.scale(t));
}

/** Ponto mais alto que a mão do defensor alcança agora (m). */
export function defenderHandPosition(
  defender: DefenderPose,
  shooterPosition: Vec3,
  config: ContestConfig = defaultContestConfig(),
): Vec3 {
  const reach = standingReach(defender);
  // Mãos baixas ~ altura do ombro; mãos para cima = alcance em pé.
  const shoulderHeight = defender.height * 0.82;
  const handZ = lerp(shoulderHeight, reach, clamp(defender.handsUpAmount, 0, 1)) + defender.jumpHeight;
  const toShooter = shooterPosition.sub(defender.feetPosition).flat().normalized();
  const horizontal = defender.feetPosition.flat().add(toShooter.scale(config.armReachForward));
  return horizontal.withZ(defender.feetPosition.z + handZ);
}

/** Contestação para uma soltura em releasePosition em direção a rimCenter, com o arremessador em shooterFeet. */
export function computeContest(
  defender: DefenderPose,
  shooterFeet: Vec3,
  releasePosition: Vec3,
  rimCenter: Vec3,
  config: ContestConfig = defaultContestConfig(),
): ContestBreakdown {
  const handPosition = defenderHandPosition(defender, shooterFeet, config);

  // Trecho inicial da trajetória (subida da bola): reta da soltura em direção ao aro, inclinada para cima.
  const toRim = rimCenter.sub(releasePosition);
  const flatDir = toRim.flat().normalized();
  const pathDir = flatDir.add(upVector().scale(1.0)).normalized(); // ~45° de subida no início
  const pathEnd = releasePosition.add(pathDir.scale(config.pathLength));
  const closestPathPoint = closestPointOnSegment(handPosition, releasePosition, pathEnd);
  const handToPathMeters = distance(handPosition, closestPathPoint);

  const span = config.zeroContestDistance - config.fullContestDistance;
  const proximity = 1 - smoothStep01((handToPathMeters - config.fullContestDistance) / (span > 1e-6 ? span : 1e-6));

  // Cobertura angular: defensor entre o arremessador e o aro cobre mais que vindo de lado ou de trás.
  const shotDir = rimCenter.sub(shooterFeet).flat().normalized();
  const toDefender = defender.feetPosition.sub(shooterFeet).flat().normalized();
  const facing = shotDir.dot(toDefender); // 1 = de frente, 0 = lado, -1 = atrás
  const angular = facing >= 0 ? lerp(0.6, 1.0, facing) : lerp(0.6, 0.3, -facing);

  // Altura: mão acima do ponto de soltura cobre bem; bem abaixo, pouco.
  const handAboveRelease = handPosition.z - releasePosition.z;
  const heightFactor = lerp(0.3, 1.0, clamp((handAboveRelease + 0.5) / 0.7, 0, 1));

  const ratingFactor = 0.85 + 0.3 * clamp((defender.perimeterDefense - 25) / 74, 0, 1);

  return {
    contest: clamp(proximity * angular * heightFactor * ratingFactor, 0, 1),
    proximity,
    angular,
    heightFactor,
    ratingFactor,
    handToPathMeters,
    handPosition,
    closestPathPoint,
  };
}
