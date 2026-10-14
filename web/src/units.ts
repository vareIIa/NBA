// Única camada de conversão entre o núcleo (src/sim: SI, Z para cima, eixos da Unreal) e o three.js (Y para cima).
// Núcleo (x, y, z) → three (x, z, y). A troca y↔z é um espelhamento: posições e velocidades passam direto,
// mas vetores axiais (velocidade angular) trocam de sinal.
import { Vector3 } from 'three';
import { Vec3 } from './sim';

export function toThree(v: Vec3, out = new Vector3()): Vector3 {
  return out.set(v.x, v.z, v.y);
}

export function fromThree(v: Vector3): Vec3 {
  return new Vec3(v.x, v.z, v.y);
}

/** Velocidade angular do núcleo (rad/s) → three. Vetor axial: o espelhamento inverte o sentido. */
export function angularToThree(w: Vec3, out = new Vector3()): Vector3 {
  return out.set(-w.x, -w.z, -w.y);
}
