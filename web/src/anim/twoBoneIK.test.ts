import { Bone, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { applyPole, solveTwoBoneIK } from './TwoBoneIK';

/** Cadeia ombro -> cotovelo -> punho reta ao longo de `dir` (0,3 m cada osso). */
function straightChain(dir: Vector3): { upper: Bone; lower: Bone; end: Bone } {
  const upper = new Bone();
  const lower = new Bone();
  const end = new Bone();
  upper.add(lower);
  lower.add(end);
  lower.position.copy(dir).setLength(0.3);
  end.position.copy(dir).setLength(0.3);
  upper.updateMatrixWorld(true);
  return { upper, lower, end };
}

describe('IK de duas articulações', () => {
  test('BracoRetoComPoleParaleloNaoEstica', () => {
    // O caso do e2e: braço reto apontando para o lado do pole. O eixo de dobra saía nulo e o quaternion encolhia (o
    // braço chegou a 6 m num quadro).
    const dir = new Vector3(-1, -0.3, -0.8).normalize();
    const { upper, lower, end } = straightChain(dir);
    const target = dir.clone().multiplyScalar(0.45); // mais perto: o cotovelo precisa dobrar
    solveTwoBoneIK(upper, lower, end, target, dir.clone(), 0.08);
    applyPole(upper, lower, target, dir.clone(), 1);
    for (const b of [upper, lower, end]) expect(b.quaternion.length()).toBeCloseTo(1, 6);
    // A cadeia continua com 0,6 m: o punho nunca vai além do alcance.
    const wrist = end.getWorldPosition(new Vector3());
    expect(wrist.length()).toBeLessThanOrEqual(0.6 + 1e-6);
    expect(wrist.distanceTo(target)).toBeLessThan(0.02);
  });
});
