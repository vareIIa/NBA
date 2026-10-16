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

/** Giro horizontal pelo menor ângulo. Interpolar vetores e normalizar trava na inversão de 180°. */
export function turnFacing(current: Vec3, desired: Vec3, response: number, dt: number): Vec3 {
  if (dt <= 0) return current;
  const from = Math.atan2(current.y, current.x);
  const to = Math.atan2(desired.y, desired.x);
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const angle = from + difference * (1 - Math.exp(-response * dt));
  return new Vec3(Math.cos(angle), Math.sin(angle), 0);
}
