// IK analítico de duas articulações (coxa-joelho-tornozelo), no espaço do mundo, aplicado nas rotações locais.
// Mesmo método de "Simple Two Joint IK" (D. Holden): ajusta os ângulos internos pela lei dos cossenos e depois gira
// a cadeia para apontar para o alvo. O plano de dobra é o atual da animação (o joelho continua apontando para frente).
import { Bone, Quaternion, Vector3 } from 'three';

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const ab = new Vector3();
const ac = new Vector3();
const at = new Vector3();
const ba = new Vector3();
const bc = new Vector3();
const axis0 = new Vector3();
const axis1 = new Vector3();
const qa = new Quaternion();
const qb = new Quaternion();
const qaInv = new Quaternion();
const qbInv = new Quaternion();
const r = new Quaternion();
const tmp = new Quaternion();

const clamp1 = (v: number): number => Math.min(1, Math.max(-1, v));

/** Aplica no bone.quaternion (local) uma rotação dada no espaço do mundo: local = local * (W^-1 * r * W). */
function applyWorldRotation(bone: Bone, worldRot: Quaternion, boneWorld: Quaternion, boneWorldInv: Quaternion): void {
  tmp.copy(boneWorldInv).multiply(worldRot).multiply(boneWorld);
  bone.quaternion.multiply(tmp);
}

/**
 * Resolve a cadeia upper -> lower -> end para end chegar em target (mundo). Precisa das matrizes do mundo em dia
 * (chamar updateMatrixWorld antes); atualiza as do upper para baixo no fim. Retorna a distância que sobrou.
 * poleHint: direção (mundo) para onde o joelho deve apontar se a perna estiver reta demais para dar o plano.
 * soft: fração do comprimento da cadeia em que ela "freia" antes de esticar (soft IK). Perto da extensão total o ângulo do
 * cotovelo/joelho muda muito para um deslocamento pequeno do alvo; com o freio exponencial a cadeia nunca chega reta e
 * o alvo que se afasta não vira estalo (o alvo fica a até alguns milímetros).
 */
export function solveTwoBoneIK(upper: Bone, lower: Bone, end: Bone, target: Vector3, poleHint?: Vector3, soft = 0): number {
  upper.getWorldPosition(a);
  lower.getWorldPosition(b);
  end.getWorldPosition(c);

  const lab = ab.subVectors(b, a).length();
  const lcb = bc.subVectors(c, b).length();
  const eps = 1e-4;
  const chain = lab + lcb;
  let lat = Math.max(at.subVectors(target, a).length(), eps);
  const softLen = soft * chain;
  if (softLen > 0 && lat > chain - softLen) lat = chain - softLen * Math.exp(-(lat - (chain - softLen)) / softLen);
  lat = Math.min(lat, chain - eps);

  ac.subVectors(c, a);
  const acLen = Math.max(ac.length(), eps);
  ab.subVectors(b, a).normalize();
  ba.subVectors(a, b).normalize();
  bc.subVectors(c, b).normalize();

  const acAb0 = Math.acos(clamp1(ac.clone().divideScalar(acLen).dot(ab)));
  const baBc0 = Math.acos(clamp1(ba.dot(bc)));
  const acAt0 = Math.acos(clamp1(ac.clone().normalize().dot(at.clone().normalize())));

  const acAb1 = Math.acos(clamp1((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
  const baBc1 = Math.acos(clamp1((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));

  axis0.crossVectors(ac, ab);
  if (axis0.lengthSq() < 1e-10) {
    // Perna reta: o plano vem da dica do joelho.
    axis0.crossVectors(ac, poleHint ?? new Vector3(0, 0, 1));
  }
  axis0.normalize();
  axis1.crossVectors(ac, at);
  const hasAxis1 = axis1.lengthSq() > 1e-12;
  axis1.normalize();

  upper.getWorldQuaternion(qa);
  lower.getWorldQuaternion(qb);
  qaInv.copy(qa).invert();
  qbInv.copy(qb).invert();

  // Ângulos internos (lei dos cossenos).
  r.setFromAxisAngle(axis0, acAb1 - acAb0);
  applyWorldRotation(upper, r, qa, qaInv);
  r.setFromAxisAngle(axis0, baBc1 - baBc0);
  applyWorldRotation(lower, r, qb, qbInv);
  // Aponta a cadeia para o alvo.
  if (hasAxis1) {
    upper.updateWorldMatrix(true, false);
    upper.getWorldQuaternion(qa);
    qaInv.copy(qa).invert();
    r.setFromAxisAngle(axis1, acAt0);
    applyWorldRotation(upper, r, qa, qaInv);
  }

  upper.updateWorldMatrix(false, true);
  end.getWorldPosition(c);
  return c.distanceTo(target);
}

const sh = new Vector3();
const el = new Vector3();
const dir = new Vector3();
const pe = new Vector3();
const pp = new Vector3();
const qw = new Quaternion();
const qwInv = new Quaternion();

/**
 * Gira a cadeia em torno do eixo ombro -> alvo para o cotovelo (ou joelho) ficar do lado de `pole` (direção no mundo).
 * Chamar depois de solveTwoBoneIK: o alvo continua atingido (a rotação é em torno do eixo que passa por ele).
 */
export function applyPole(upper: Bone, lower: Bone, target: Vector3, pole: Vector3, weight = 1): void {
  upper.getWorldPosition(sh);
  lower.getWorldPosition(el);
  dir.subVectors(target, sh);
  if (dir.lengthSq() < 1e-10) return;
  dir.normalize();
  pe.subVectors(el, sh).addScaledVector(dir, -el.clone().sub(sh).dot(dir));
  pp.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (pe.lengthSq() < 1e-10 || pp.lengthSq() < 1e-10) return;
  // Cadeia quase reta: o lado do cotovelo fica mal definido (pe minúsculo vira de lado entre quadros); o pole perde força.
  const bend = Math.sqrt(pe.lengthSq()) / Math.max(1e-6, el.distanceTo(sh));
  weight *= Math.min(1, Math.max(0, (bend - 0.04) / 0.16));
  if (weight <= 0) return;
  pe.normalize();
  pp.normalize();
  let angle = Math.acos(Math.min(1, Math.max(-1, pe.dot(pp))));
  if (new Vector3().crossVectors(pe, pp).dot(dir) < 0) angle = -angle;
  upper.getWorldQuaternion(qw);
  qwInv.copy(qw).invert();
  r.setFromAxisAngle(dir, angle * weight);
  tmp.copy(qwInv).multiply(r).multiply(qw);
  upper.quaternion.multiply(tmp);
  upper.updateWorldMatrix(false, true);
}
