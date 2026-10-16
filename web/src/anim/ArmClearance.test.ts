import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ArmClearance } from './ArmClearance';

/** Esqueleto mínimo no mundo (m), +X = esquerda, +Z = frente. Braço esquerdo pendurado com o cotovelo em `elbowX`. */
function rig(elbowX: number, opts: { wristX?: number; wristZ?: number; scale?: number } = {}) {
  const root = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  const world = new Map<string, THREE.Vector3>();
  const add = (name: string, parent: THREE.Object3D, at: [number, number, number]) => {
    const b = new THREE.Bone();
    b.name = name;
    const p = new THREE.Vector3(...at);
    const parentWorld = world.get(parent.name) ?? new THREE.Vector3();
    b.position.copy(p.clone().sub(parentWorld));
    parent.add(b);
    bones.set(name, b);
    world.set(name, p);
    return b;
  };
  root.name = 'root';
  const pelvis = add('pelvis', root, [0, 1.05, 0]);
  const spine = add('spine_03', pelvis, [0, 1.29, 0]);
  add('neck_01', spine, [0, 1.42, 0]);
  for (const s of ['l', 'r'] as const) {
    const x = s === 'l' ? 1 : -1;
    const sh = add(`upperarm_${s}`, spine, [x * 0.2, 1.5, 0]);
    const el = add(`lowerarm_${s}`, sh, s === 'l' ? [elbowX, 1.2, 0] : [-0.45, 1.2, 0]);
    const wr = add(`hand_${s}`, el, s === 'l' ? [opts.wristX ?? elbowX, 0.95, opts.wristZ ?? 0.05] : [-0.45, 0.95, 0.05]);
    add(`fingers_${s}`, wr, s === 'l' ? [opts.wristX ?? elbowX, 0.85, (opts.wristZ ?? 0.05) + 0.02] : [-0.45, 0.85, 0.07]);
    const th = add(`thigh_${s}`, pelvis, [x * 0.1, 0.95, 0]);
    add(`calf_${s}`, th, [x * 0.1, 0.5, 0]);
  }
  const scale = opts.scale ?? 1;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const clearance = new ArmClearance({ bone: (n) => bones.get(n)!, scale: () => root.scale.y });
  const pos = (n: string) => bones.get(n)!.getWorldPosition(new THREE.Vector3());
  return { root, bones, clearance, pos };
}

describe('ArmClearance', () => {
  it('cotovelo dentro do tronco sai para fora; ombro e comprimentos ficam', () => {
    // Tronco padrão: semieixo lateral 0,17 + raio do cotovelo 0,05. Cotovelo a 0,12 do eixo: 10 cm dentro.
    const { clearance, pos } = rig(0.12);
    const sh0 = pos('upperarm_l');
    const upperLen = pos('lowerarm_l').distanceTo(sh0);
    const foreLen = pos('hand_l').distanceTo(pos('lowerarm_l'));
    expect(clearance.penetration(false).depth).toBeGreaterThan(0.05);
    clearance.apply(false, 1); // dt grande: a suavização chega ao alvo no quadro
    expect(pos('upperarm_l').distanceTo(sh0)).toBeLessThan(1e-6);
    expect(pos('lowerarm_l').x).toBeGreaterThan(0.2);
    expect(pos('lowerarm_l').distanceTo(pos('upperarm_l'))).toBeCloseTo(upperLen, 5);
    expect(pos('hand_l').distanceTo(pos('lowerarm_l'))).toBeCloseTo(foreLen, 5);
    expect(clearance.penetration(false).depth).toBeLessThan(0.005);
  });

  it('braço por fora do corpo não muda', () => {
    const { clearance, bones } = rig(0.45, { wristX: 0.45 });
    const before = ['upperarm_l', 'lowerarm_l'].map((n) => bones.get(n)!.quaternion.clone());
    clearance.apply(false, 1);
    ['upperarm_l', 'lowerarm_l'].forEach((n, i) => expect(bones.get(n)!.quaternion.angleTo(before[i])).toBeLessThan(1e-6));
    expect(clearance.pushed.l).toBe(0);
  });

  it('o empurrão é contínuo ao cruzar a borda do volume (sem degrau)', () => {
    const { clearance } = rig(0.45);
    const d = new THREE.Vector3();
    let prev: number | null = null;
    for (let x = 0.05; x <= 0.35; x += 0.002) {
      clearance.push(new THREE.Vector3(x, 1.15, 0), 0.05, false, d);
      const len = d.length();
      if (prev !== null) expect(Math.abs(len - prev)).toBeLessThan(0.004);
      prev = len;
    }
    expect(prev).toBe(0); // longe o bastante, nada
  });

  it('a correção entra suave no tempo', () => {
    const { clearance, pos } = rig(0.12);
    clearance.apply(false, 1 / 60);
    const first = pos('lowerarm_l').x;
    expect(first).toBeGreaterThan(0.12);
    expect(clearance.penetration(false).depth).toBeGreaterThan(0.01); // ainda não chegou
  });

  it('as coxas só contam sem bola', () => {
    // Mão encostada na coxa esquerda (eixo em x = 0,1; semieixo padrão 0,1), abaixo do quadril.
    const { clearance } = rig(0.45);
    const d = new THREE.Vector3();
    const hand = new THREE.Vector3(0.15, 0.75, 0.02);
    expect(clearance.push(hand, 0.03, false, d)).toBeGreaterThan(0.01);
    expect(clearance.push(hand, 0.03, true, d)).toBe(0);
  });

  it('as medidas acompanham a escala do jogador', () => {
    const a = rig(0.12);
    const b = rig(0.12, { scale: 1.2 });
    const pa = a.clearance.penetration(false).depth;
    const pb = b.clearance.penetration(false).depth;
    expect(pb).toBeCloseTo(pa * 1.2, 3);
  });

  it('mede a seção do tronco na malha', () => {
    // "Regata": tubo elíptico (0,22 de lado, 0,13 de frente) em volta da pelve -> spine_03, com pele na spine_03.
    const { clearance, bones, root } = rig(0.45);
    const geo = new THREE.CylinderGeometry(1, 1, 0.3, 48, 6, true).scale(0.22, 1, 0.13).translate(0, 1.17, 0);
    const n = geo.getAttribute('position').count;
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
    root.add(mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([bones.get('spine_03')!]), mesh.matrixWorld.clone());
    clearance.fit([mesh]);
    const t = clearance.sizes().tronco;
    expect(t.rx).toBeCloseTo(0.22, 1);
    expect(t.rz).toBeCloseTo(0.13, 1);
    expect(Math.abs(t.rx - 0.22)).toBeLessThan(0.015);
    expect(Math.abs(t.rz - 0.13)).toBeLessThan(0.015);
  });
});
