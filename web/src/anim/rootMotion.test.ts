import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { extractRootMotion, rootDelta, sampleHeight, sampleRoot } from './RootMotion';

/** Esqueleto mínimo como o do jogador: grupo parado > modelo (escala) > armação > pelve > coxa. */
function rig(): { holder: THREE.Group; model: THREE.Object3D; pelvis: THREE.Bone } {
  const holder = new THREE.Group();
  const model = new THREE.Object3D();
  model.scale.setScalar(2);
  const armature = new THREE.Object3D();
  armature.position.y = 0.1;
  const pelvis = new THREE.Bone();
  pelvis.name = 'pelvis';
  pelvis.position.set(0, 0.45, 0);
  const thigh = new THREE.Bone();
  thigh.name = 'thigh_l';
  thigh.position.set(0.1, -0.05, 0);
  pelvis.add(thigh);
  armature.add(pelvis);
  model.add(armature);
  holder.add(model);
  holder.updateMatrixWorld(true);
  return { holder, model, pelvis };
}

/** Clipe: a pelve anda 2 m para +Z (mundo) em 1 s girando 90° para a esquerda (+Y) e balança 5 cm de lado. */
function walkTurnClip(): THREE.AnimationClip {
  const times: number[] = [];
  const pos: number[] = [];
  const quat: number[] = [];
  const n = 61;
  for (let i = 0; i < n; i++) {
    const t = i / 60;
    times.push(t);
    // No referencial da armação: o modelo tem escala 2, então 1 unidade local = 2 m no mundo.
    pos.push(0.025 * Math.sin(t * 20), 0.45, t);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.PI / 2) * t);
    quat.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.AnimationClip('anda_e_vira', 1, [
    new THREE.VectorKeyframeTrack('pelvis.position', times, pos),
    new THREE.QuaternionKeyframeTrack('pelvis.quaternion', times, quat),
  ]);
}

describe('extractRootMotion', () => {
  it('a raiz leva o deslocamento e o giro, e a pelve fica no lugar e de frente', () => {
    const { model, pelvis } = rig();
    const { clip, root } = extractRootMotion(model, walkTurnClip(), 4);
    // A raiz anda ~2 m em +Z e gira 90°.
    const end = sampleRoot(root, 1);
    const start = sampleRoot(root, 0);
    expect(end.z - start.z).toBeCloseTo(2, 1);
    expect(end.yaw - start.yaw).toBeCloseTo(Math.PI / 2, 1);
    expect(sampleHeight(root, 0.5)).toBeCloseTo(2 * (0.1 + 0.45), 3);

    // O clipe novo, tocado no esqueleto, deixa a pelve perto da origem (só o balanço) e sem o giro da raiz.
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(clip);
    action.play();
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      action.time = t;
      mixer.update(0);
      model.parent!.updateMatrixWorld(true);
      const p = pelvis.getWorldPosition(new THREE.Vector3());
      expect(Math.hypot(p.x, p.z)).toBeLessThan(0.08);
      const f = new THREE.Vector3(0, 0, 1).applyQuaternion(pelvis.getWorldQuaternion(new THREE.Quaternion()));
      // De frente para +Z, a menos do que o filtro tirou da curva (o giro é linear, o filtro quase não mexe).
      expect(Math.atan2(f.x, f.z)).toBeCloseTo(0, 1);
    }
  });

  it('rootDelta dá o passo no referencial da raiz (com yaw +90° a frente é o +X do mundo)', () => {
    const track = { times: [0, 1], x: [0, -1], z: [0, 0], yaw: [Math.PI / 2, Math.PI / 2], height: [1, 1] };
    const d = rootDelta(track, 0, 1);
    // Olhando para +X (yaw +90° leva o +Z para +X), andar 1 m para -X é andar 1 m para trás.
    expect(d.z).toBeCloseTo(-1, 6);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.yaw).toBeCloseTo(0, 6);
  });
});
