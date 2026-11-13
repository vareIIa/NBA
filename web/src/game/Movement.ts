import { Vec3 } from '../sim/HoopsMath';

/**
 * Aproxima a velocidade do alvo sem ultrapassá-lo. Enquanto a mudança reduz o embalo,
 * usa o freio; depois do ponto de menor velocidade, usa a aceleração da arrancada.
 * Divide esse instante dentro do quadro para a inversão não depender do FPS.
 */
export function approachVelocity(current: Vec3, target: Vec3, dt: number, acceleration: number, braking: number): Vec3 {
  if (dt <= 0) return current;
  const delta = target.sub(current);
  const distance = delta.length();
  if (distance < 1e-9) return target;
  const direction = delta.div(distance);
  const brakeDistance = Math.min(distance, Math.max(0, -current.dot(direction)));
  const brakeTime = brakeDistance / braking;
  const travelled = dt <= brakeTime
    ? braking * dt
    : brakeDistance + acceleration * (dt - brakeTime);
  return travelled >= distance ? target : current.add(direction.scale(travelled));
}

/**
 * Resposta da locomoção (m/s²). Sem a bola fica a arrancada "humana" de antes (as plantadas cuidam da virada e da
 * parada). Com a bola a referência é o 2K (docs/27 §2.1, régua: arranque e parada em 1–3 q de 30 fps; a linha de base
 * media 26 q e 12 q): o primeiro passo com RT chega a 90% do sprint em ~3,6 q, sem RT em ~7 q, e o corpo para em ~3,6 q.
 */
export const DriveResponse = {
  offBall: { accel: 6.5, brake: 14 },
  ball: { sprintAccel: 46, jogAccel: 16, brake: 46 },
};

/** Aceleração e freio do quadro. `legacy` = a resposta antiga com a bola (`?arranque=antigo`, para A/B). */
export function driveResponse(hasBall: boolean, sprint: boolean, legacy = false): { accel: number; brake: number } {
  if (!hasBall || legacy) return DriveResponse.offBall;
  const B = DriveResponse.ball;
  return { accel: sprint ? B.sprintAccel : B.jogAccel, brake: B.brake };
}

/**
 * Curva em disparada com a bola (docs/27): em vez de a velocidade ir em linha reta até o alvo (o corpo "derrapava" de
 * lado no meio da mudança de rumo, com a passada apontando para onde ele não ia mais), o RUMO gira até o do alvo numa
 * taxa limitada e o módulo acompanha o do alvo. O jogador faz um arco, de frente para onde corre, como quem corre de
 * verdade. Abaixo de `minSpeed` ou com o alvo a mais de `maxAngleDeg` (voltar para trás) vale o freio-e-arranque.
 */
export const ArcTurn = { minSpeed: 3.0, maxAngleDeg: 130, slowDegPerSecond: 380, fastDegPerSecond: 270, fastSpeed: 6.2 };

/** Dá para fazer a mudança de rumo em arco (steerVelocity)? */
export function canArcTurn(current: Vec3, target: Vec3): boolean {
  const speed = current.length();
  const wanted = target.length();
  if (speed < ArcTurn.minSpeed || wanted < ArcTurn.minSpeed) return false;
  const cos = current.dot(target) / (speed * wanted);
  return cos >= Math.cos((ArcTurn.maxAngleDeg * Math.PI) / 180);
}

/** Gira o rumo da velocidade até o do alvo (taxa pela velocidade) e aproxima o módulo com a aceleração/freio. */
export function steerVelocity(current: Vec3, target: Vec3, dt: number, acceleration: number, braking: number): Vec3 {
  if (dt <= 0) return current;
  const speed = current.length();
  const wanted = target.length();
  if (speed < 1e-6 || wanted < 1e-6) return approachVelocity(current, target, dt, acceleration, braking);
  const k = Math.min(1, Math.max(0, (speed - ArcTurn.minSpeed) / Math.max(1e-6, ArcTurn.fastSpeed - ArcTurn.minSpeed)));
  const rate = ((ArcTurn.slowDegPerSecond + (ArcTurn.fastDegPerSecond - ArcTurn.slowDegPerSecond) * k) * Math.PI) / 180;
  const from = Math.atan2(current.y, current.x);
  const to = Math.atan2(target.y, target.x);
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const angle = from + Math.sign(difference) * Math.min(Math.abs(difference), rate * dt);
  const step = (wanted >= speed ? acceleration : braking) * dt;
  const next = Math.abs(wanted - speed) <= step ? wanted : speed + Math.sign(wanted - speed) * step;
  return new Vec3(Math.cos(angle) * next, Math.sin(angle) * next, 0);
}

/** Giro horizontal pelo menor ângulo. Interpolar vetores e normalizar trava na inversão de 180°. */
export function turnFacing(current: Vec3, desired: Vec3, response: number, dt: number): Vec3 {
  if (dt <= 0) return current;
  const from = Math.atan2(current.y, current.x);
  const to = Math.atan2(desired.y, desired.x);
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const angle = from + difference * (1 - Math.exp(-response * dt));
  return new Vec3(Math.cos(angle), Math.sin(angle), 0);
}
