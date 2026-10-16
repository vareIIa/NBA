/**
 * Veste o jogador com as peças geradas no HY 3D Studio e encaixadas pelo Blender (Tools/Animacao/vestir.py).
 *
 * Cada GLB de peça traz uma malha com pele no mesmo esqueleto do hoops_player (mesmos nomes e matrizes de bind) mais,
 * na regata e na bermuda, "ossos de pano" (`pano_*`). Aqui a malha é religada aos ossos do PlayerAnimator pelo nome, e
 * os ossos de pano viram pêndulos com mola (verlet): a barra da regata e as pernas da bermuda atrasam e balançam
 * com a corrida, o drible e o pulo, em vez de grudarem no corpo.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PlayerAnimator } from '../anim/PlayerAnimator';
import { hideCoveredTriangles } from './BodyCover';

export interface GearSet {
  shoes?: string; // GLB com tenis_r e tenis_l
  jersey?: string; // regata
  shorts?: string; // bermuda
}

/** Materiais do boneco: o tênis some sob o calçado novo; camiseta e calção justos viram pele sob a roupa solta. */
const BodyShoeMaterials = ['Tenis', 'Sola'];
const BodyUnderMaterials: Partial<Record<keyof GearSet, string>> = { jersey: 'Uniforme', shorts: 'Calcao' };

export interface ClothParams {
  stiffness: number; // 1/s²: puxa a ponta do pano de volta para a pose de repouso
  damping: number; // fração da velocidade mantida por passo (60 Hz)
  gravity: number; // m/s²
  maxAngle: number; // limite de abertura em relação ao repouso (rad)
  maxStep: number; // m: teleporte (reset, replay) não vira chicotada
}

/** Regata: barra solta, balança bastante. Bermuda: a perna segue a coxa; o pano só tremula por cima. */
export const ClothTuning: Record<'jersey' | 'shorts', ClothParams> = {
  jersey: { stiffness: 55, damping: 0.9, gravity: 9.8, maxAngle: THREE.MathUtils.degToRad(55), maxStep: 0.25 },
  shorts: { stiffness: 140, damping: 0.85, gravity: 6, maxAngle: THREE.MathUtils.degToRad(28), maxStep: 0.25 },
};

interface ClothBone {
  bone: THREE.Bone;
  tune: ClothParams;
  restLocal: THREE.Quaternion;
  tailLocal: THREE.Vector3; // ponta do pano no espaço do osso, em repouso
  p: THREE.Vector3; // ponta simulada (mundo)
  prev: THREE.Vector3;
  primed: boolean;
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const cA = new THREE.Vector3();
const cB = new THREE.Vector3();
const cN = new THREE.Vector3();
const capSeg = new THREE.Line3();

export class PlayerGear {
  private readonly cloth: ClothBone[] = [];
  private readonly capsules: { a: THREE.Bone; b: THREE.Bone; r: number }[] = [];
  private acc = 0;
  /** Triângulos do corpo tirados por estarem sob a roupa (diagnóstico). */
  coveredTriangles = 0;

  private constructor(private readonly animator: PlayerAnimator) {}

  static async load(animator: PlayerAnimator, set: GearSet): Promise<PlayerGear> {
    const gear = new PlayerGear(animator);
    const loader = new GLTFLoader();
    const entries = Object.entries(set).filter(([, url]) => url) as [keyof GearSet, string][];
    const loaded = await Promise.all(entries.map(([kind, url]) => loader.loadAsync(url).then((g) => [kind, g] as const)));
    for (const [kind, gltf] of loaded) gear.wear(kind, gltf.scene);
    gear.coverBody();
    gear.buildCapsules();
    return gear;
  }

  private bodyMesh(): THREE.SkinnedMesh {
    let body: THREE.SkinnedMesh | null = null;
    this.animator.root.traverse((o) => {
      if (!body && (o as THREE.SkinnedMesh).isSkinnedMesh && !o.userData.gear) body = o as THREE.SkinnedMesh;
    });
    if (!body) throw new Error('jogador sem malha com pele');
    return body;
  }

  private wear(kind: keyof GearSet, scene: THREE.Object3D): void {
    const body = this.bodyMesh();
    const meshes: THREE.SkinnedMesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
    });
    scene.updateMatrixWorld(true);
    for (const mesh of meshes) {
      const bones = mesh.skeleton.bones.map((b) => this.adoptBone(b));
      const skeleton = new THREE.Skeleton(bones, mesh.skeleton.boneInverses);
      mesh.userData.gear = kind;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      // O PBR do HY deixa o tecido com cara de plástico molhado: pano é fosco e não metálico.
      // Dupla face: pela cava e pela boca da bermuda aparece o avesso do tecido (o corpo por baixo foi tirado).
      if (kind !== 'shoes')
        for (const m of ([] as THREE.Material[]).concat(mesh.material) as THREE.MeshStandardMaterial[]) Object.assign(m, { metalness: 0, roughness: 0.85, metalnessMap: null, roughnessMap: null, side: THREE.DoubleSide });
      body.parent!.add(mesh);
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
      mesh.scale.copy(body.scale);
      mesh.bind(skeleton, body.bindMatrix);
      for (const b of bones) if (b.name.startsWith('pano_') && !this.cloth.some((c) => c.bone === b)) this.cloth.push(this.clothBone(b, mesh, ClothTuning[kind === 'shorts' ? 'shorts' : 'jersey']));
    }
    // Tênis novo: some o tênis do boneco (atravessaria o calçado).
    if (kind === 'shoes') this.hideBodyMaterials(BodyShoeMaterials);
    const under = BodyUnderMaterials[kind];
    if (under) this.skinBodyMaterial(under);
  }

  private bodyMeshes(): THREE.SkinnedMesh[] {
    const out: THREE.SkinnedMesh[] = [];
    this.animator.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !o.userData.gear && o.visible) out.push(o as THREE.SkinnedMesh);
    });
    return out;
  }

  private gearMeshes(): THREE.SkinnedMesh[] {
    const out: THREE.SkinnedMesh[] = [];
    this.animator.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.userData.gear) out.push(o as THREE.SkinnedMesh);
    });
    return out;
  }

  /** Some com a pele por baixo das peças (BodyCover): o corpo não tem como atravessar o tecido. */
  private coverBody(): void {
    this.animator.root.updateMatrixWorld(true);
    this.coveredTriangles = hideCoveredTriangles(this.bodyMeshes(), this.gearMeshes());
  }

  /**
   * Cápsulas do corpo (coxas, canelas, tronco) para o pano não entrar no corpo ao balançar. Raio = 85% da distância média
   * dos vértices do osso ao eixo (só a parte que de fato é carne do osso, no bind).
   */
  private buildCapsules(): void {
    if (this.cloth.length === 0) return;
    const pairs: [string, string][] = [
      ['thigh_l', 'calf_l'],
      ['thigh_r', 'calf_r'],
      ['calf_l', 'foot_l'],
      ['calf_r', 'foot_r'],
      ['spine_01', 'neck_01'],
    ];
    this.animator.root.updateMatrixWorld(true);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const seg = new THREE.Line3();
    const near = new THREE.Vector3();
    for (const [from, to] of pairs) {
      this.animator.bone(from).getWorldPosition(a);
      this.animator.bone(to).getWorldPosition(b);
      seg.set(a, b);
      let sum = 0;
      let count = 0;
      for (const mesh of this.bodyMeshes()) {
        const idx = mesh.geometry.getAttribute('skinIndex');
        const wts = mesh.geometry.getAttribute('skinWeight');
        const bi = mesh.skeleton.bones.findIndex((x) => x.name === from);
        for (let i = 0; i < idx.count; i++) {
          let best = 0;
          for (let k = 1; k < 4; k++) if (wts.getComponent(i, k) > wts.getComponent(i, best)) best = k;
          if (idx.getComponent(i, best) !== bi) continue;
          mesh.getVertexPosition(i, v1);
          mesh.applyBoneTransform(i, v1);
          v1.applyMatrix4(mesh.matrixWorld);
          seg.closestPointToPoint(v1, true, near);
          sum += near.distanceTo(v1);
          count++;
        }
      }
      if (count > 0) this.capsules.push({ a: this.animator.bone(from), b: this.animator.bone(to), r: (0.85 * sum) / count });
    }
  }

  /** Osso do jogador com o mesmo nome; osso de pano é pendurado no osso pai correspondente do jogador. */
  private adoptBone(b: THREE.Bone): THREE.Bone {
    if (!b.name.startsWith('pano_')) return this.animator.bone(b.name);
    const parent = this.animator.bone(b.parent!.name);
    parent.add(b);
    return b;
  }

  private clothBone(bone: THREE.Bone, mesh: THREE.SkinnedMesh, tune: ClothParams): ClothBone {
    // Ponta do pano = centro dos vértices que o osso move, ponderado pelo peso (espaço do osso, no bind).
    const idx = mesh.geometry.getAttribute('skinIndex');
    const wts = mesh.geometry.getAttribute('skinWeight');
    const pos = mesh.geometry.getAttribute('position');
    const bi = mesh.skeleton.bones.indexOf(bone);
    const inv = mesh.skeleton.boneInverses[bi];
    const tail = new THREE.Vector3();
    let total = 0;
    for (let i = 0; i < idx.count; i++) {
      for (let k = 0; k < 4; k++) {
        if (idx.getComponent(i, k) !== bi) continue;
        const w = wts.getComponent(i, k);
        if (w < 0.3) continue;
        v1.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(inv);
        tail.addScaledVector(v1, w * w);
        total += w * w;
      }
    }
    if (total > 0) tail.divideScalar(total);
    else tail.set(0, -0.2, 0);
    return { bone, tune, restLocal: bone.quaternion.clone(), tailLocal: tail, p: new THREE.Vector3(), prev: new THREE.Vector3(), primed: false };
  }

  /** Pinta a peça justa do boneco com a cor da pele (aparece pela cava da regata e pela boca da bermuda). */
  private skinBodyMaterial(name: string): void {
    const mats: THREE.MeshStandardMaterial[] = [];
    this.animator.root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh && !mesh.userData.gear) mats.push(...([] as THREE.Material[]).concat(mesh.material).map((m) => m as THREE.MeshStandardMaterial));
    });
    const skin = mats.find((m) => m.name === 'Pele');
    for (const m of mats) if (m.name === name && skin) m.color.copy(skin.color);
  }

  /** O GLTFLoader divide o corpo em uma SkinnedMesh por material: esconde as que usam esses materiais. */
  private hideBodyMaterials(names: string[]): void {
    this.animator.root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || mesh.userData.gear) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.some((m) => names.includes(m.name))) mesh.visible = false;
    });
  }

  /** Chamar depois do animator.update (pose final do frame). Passo fixo de 1/60 s para a mola não depender do fps. */
  update(dt: number): void {
    if (this.cloth.length === 0) return;
    const step = 1 / 60;
    this.acc = Math.min(this.acc + dt, 4 * step);
    this.animator.root.updateMatrixWorld(true);
    while (this.acc >= step) {
      this.acc -= step;
      for (const c of this.cloth) this.stepBone(c, step);
    }
  }

  /**
   * Empurra a ponta do pano para fora das cápsulas do corpo (margem de 1,5 cm). Cápsula que já contém a ponta em
   * repouso é ignorada (raio estimado grande demais ali), senão a mola e a colisão brigam e o pano treme.
   */
  private collide(p: THREE.Vector3, rest: THREE.Vector3): void {
    const margin = 0.015;
    for (const cap of this.capsules) {
      cap.a.getWorldPosition(cA);
      cap.b.getWorldPosition(cB);
      capSeg.set(cA, cB);
      const r = cap.r + margin;
      capSeg.closestPointToPoint(rest, true, cN);
      if (cN.distanceTo(rest) < r) continue;
      capSeg.closestPointToPoint(p, true, cN);
      const d = p.distanceTo(cN);
      if (d < r && d > 1e-6) p.sub(cN).multiplyScalar(r / d).add(cN);
    }
  }

  private stepBone(c: ClothBone, h: number): void {
    const T = c.tune;
    const bone = c.bone;
    bone.quaternion.copy(c.restLocal);
    bone.updateMatrixWorld(true);
    const origin = bone.getWorldPosition(v1);
    const target = v2.copy(c.tailLocal).applyMatrix4(bone.matrixWorld);
    const len = target.distanceTo(origin);
    if (!c.primed || c.p.distanceTo(target) > T.maxStep * 4) {
      c.p.copy(target);
      c.prev.copy(target);
      c.primed = true;
    }
    // Verlet: inércia + gravidade + mola para o repouso.
    const vel = v3.subVectors(c.p, c.prev).multiplyScalar(T.damping);
    if (vel.length() > T.maxStep) vel.setLength(T.maxStep);
    c.prev.copy(c.p);
    c.p.add(vel);
    c.p.y -= T.gravity * h * h;
    c.p.addScaledVector(v3.subVectors(target, c.p), Math.min(1, T.stiffness * h * h));
    // Comprimento fixo e abertura limitada em relação ao repouso.
    const rest = v3.subVectors(target, origin).normalize();
    const dir = c.p.clone().sub(origin).normalize();
    const ang = rest.angleTo(dir);
    if (ang > T.maxAngle) {
      q1.setFromUnitVectors(rest, dir);
      q2.identity().slerp(q1, T.maxAngle / ang);
      dir.copy(rest).applyQuaternion(q2);
    }
    c.p.copy(origin).addScaledVector(dir, len);
    this.collide(c.p, target);
    dir.subVectors(c.p, origin).normalize();
    c.p.copy(origin).addScaledVector(dir, len);
    // Gira o osso para a ponta simulada.
    q1.setFromUnitVectors(rest, dir);
    bone.getWorldQuaternion(q2);
    q2.premultiply(q1);
    bone.parent!.getWorldQuaternion(q1).invert();
    bone.quaternion.copy(q1.multiply(q2));
    bone.updateMatrixWorld(true);
  }
}
