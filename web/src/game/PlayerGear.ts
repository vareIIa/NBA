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
import { bindBonePosition, hideCoveredTriangles } from './BodyCover';
import { LimbPush, type PushMode } from './LimbPush';
import { loadZoneMask, paintZones } from './GearColors';

/** Peças baixadas por PlayerGear.fetch, prontas para vestir. */
export type GearScenes = readonly (readonly [keyof GearSet, THREE.Object3D])[];

export interface GearSet {
  shoes?: string; // GLB com tenis_r e tenis_l
  jersey?: string; // regata
  shorts?: string; // bermuda
}

/** Cor de cada zona por peça (docs/26 fase 2; '' = a original). Ausente = as cores originais. */
export type GearColors = Partial<Record<keyof GearSet, readonly string[]>>;

/** Materiais do boneco: o tênis some sob o calçado novo; camiseta e calção justos viram pele sob a roupa solta. */
const BodyShoeMaterials = ['Tenis', 'Sola'];
/** Pele que fica funda sob a roupa (osso dominante), longe das aberturas: sai até mais longe do tecido (coverBody). */
const DeepUnderGear = /^(pelvis|spine_01|hip_[lr])$/;
const BodyUnderMaterials: Partial<Record<keyof GearSet, string>> = { jersey: 'Uniforme', shorts: 'Calcao' };

export interface ClothParams {
  stiffness: number; // 1/s²: puxa a ponta do pano de volta para a pose de repouso
  damping: number; // fração da velocidade mantida por passo (60 Hz)
  gravity: number; // m/s²
  maxAngle: number; // limite de abertura em relação ao repouso (rad)
  maxStep: number; // m: teleporte (reset, replay) não vira chicotada
}

/**
 * Regata: barra solta, balança (até 35°: no agachamento fundo o pano das costas pende para o chão, e com 55° as costas
 * abriam como tampa). Bermuda: a perna segue a coxa; o pano só tremula por cima.
 */
export const ClothTuning: Record<'jersey' | 'shorts', ClothParams> = {
  jersey: { stiffness: 55, damping: 0.9, gravity: 9.8, maxAngle: THREE.MathUtils.degToRad(35), maxStep: 0.25 },
  shorts: { stiffness: 140, damping: 0.85, gravity: 6, maxAngle: THREE.MathUtils.degToRad(28), maxStep: 0.25 },
};

interface ClothBone {
  bone: THREE.Bone;
  tune: ClothParams;
  restLocal: THREE.Quaternion;
  tailLocal: THREE.Vector3; // ponta do pano no espaço do osso, em repouso
  core: [THREE.Bone, THREE.Bone]; // eixo do que o pano veste (tronco ou coxa): a ponta não chega mais perto dele que em repouso
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

/**
 * Avesso do tecido: o verso das faces (visto pela cava e pela boca da bermuda) usa a cor média da textura, mais escura,
 * em vez da própria textura. A textura do HY põe faixas e debruns no verso também (vermelho dentro da cava do kit branco).
 */
function insideColor(m: THREE.MeshStandardMaterial): void {
  const inside = { value: new THREE.Color(m.color).multiplyScalar(0.55) };
  const img = m.map?.image as CanvasImageSource | undefined;
  if (img && typeof document !== 'undefined') {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, 16, 16);
      const px = g.getImageData(0, 0, 16, 16).data;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0) (r += px[i]), (gg += px[i + 1]), (b += px[i + 2]), n++;
      // Média em sRGB -> linear (a cor do material é linear), escurecida como sombra de dentro da peça.
      if (n > 0) inside.value.setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace).multiply(m.color).multiplyScalar(0.55);
    } catch {
      // textura sem pixels legíveis: fica a cor do material escurecida
    }
  }
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uInside = inside;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uInside;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb = uInside;');
  };
  m.needsUpdate = true;
}

export class PlayerGear {
  private readonly cloth: ClothBone[] = [];
  private readonly capsules: { a: THREE.Bone; b: THREE.Bone; r: number }[] = [];
  private readonly pushers: LimbPush[] = [];
  private acc = 0;
  /** Triângulos do corpo tirados por estarem sob a roupa (diagnóstico). */
  coveredTriangles = 0;
  /** O que vestir mudou no corpo, para o dispose desfazer (trocar de roupa no menu, docs/26). */
  private readonly undo: (() => void)[] = [];
  private readonly worn: THREE.SkinnedMesh[] = [];

  private constructor(private readonly animator: PlayerAnimator) {}

  static async load(animator: PlayerAnimator, set: GearSet): Promise<PlayerGear> {
    return PlayerGear.dress(animator, await PlayerGear.fetch(set));
  }

  /** Baixa as peças (sem vestir): a troca de roupa no menu baixa antes e veste no mesmo quadro em que tira a velha. */
  static async fetch(set: GearSet): Promise<GearScenes> {
    const loader = new GLTFLoader();
    const entries = Object.entries(set).filter(([, url]) => url) as [keyof GearSet, string][];
    // A máscara de zonas (GearColors) baixa junto: a peça só veste quando já dá para pintar as cores escolhidas.
    return Promise.all(
      entries.map(async ([kind, url]) => {
        const piece = url.slice(url.lastIndexOf('/') + 1).replace(/\.glb$/, '');
        const [g] = await Promise.all([loader.loadAsync(url), loadZoneMask(piece, url.slice(0, url.lastIndexOf('gear/')))]);
        g.scene.userData.piece = piece;
        return [kind, g.scene] as const;
      }),
    );
  }

  /** Veste as peças baixadas (cada cena só pode ser vestida uma vez: a malha muda de pai). `colors`: cor de cada zona. */
  static dress(animator: PlayerAnimator, scenes: GearScenes, colors?: GearColors): PlayerGear {
    const gear = new PlayerGear(animator);
    for (const [kind, scene] of scenes) gear.wear(kind, scene, colors?.[kind]);
    gear.coverBody();
    gear.buildCapsules();
    // Colisão dos braços com a roupa vestida (regata e bermuda são mais largas que o corpo).
    animator.fitArmClearance([...gear.bodyMeshes(), ...gear.gearMeshes()]);
    return gear;
  }

  /**
   * Tira a roupa: as peças e os ossos de pano saem do jogador e o corpo volta como era antes de vestir (triângulos sob
   * a roupa, partes escondidas, cores). Depois disso este objeto não serve mais; vestir de novo é outro PlayerGear.
   */
  dispose(): void {
    for (const mesh of this.worn) {
      mesh.removeFromParent();
      mesh.skeleton.dispose();
    }
    this.worn.length = 0;
    for (const c of this.cloth) c.bone.removeFromParent();
    this.cloth.length = 0;
    this.pushers.length = 0;
    this.capsules.length = 0;
    while (this.undo.length > 0) this.undo.pop()!();
    this.animator.fitArmClearance(this.bodyMeshes());
  }

  private bodyMesh(): THREE.SkinnedMesh {
    let body: THREE.SkinnedMesh | null = null;
    this.animator.root.traverse((o) => {
      if (!body && (o as THREE.SkinnedMesh).isSkinnedMesh && !o.userData.gear) body = o as THREE.SkinnedMesh;
    });
    if (!body) throw new Error('jogador sem malha com pele');
    return body;
  }

  /**
   * Troca a cor das zonas da roupa vestida (sem revestir: o menu pinta na hora). Peça sem cor escolhida volta à original.
   */
  paint(colors: GearColors): void {
    for (const mesh of this.worn) {
      const kind = mesh.userData.gear as keyof GearSet;
      if (mesh.userData.piece) paintZones(mesh, mesh.userData.piece, colors[kind]);
    }
  }

  private wear(kind: keyof GearSet, scene: THREE.Object3D, colors?: readonly string[]): void {
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
      mesh.userData.piece = scene.userData.piece;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      // O PBR do HY deixa o tecido com cara de plástico molhado: pano é fosco e não metálico.
      // Dupla face: pela cava e pela boca da bermuda aparece o avesso do tecido (o corpo por baixo foi tirado).
      if (kind !== 'shoes')
        for (const m of ([] as THREE.Material[]).concat(mesh.material) as THREE.MeshStandardMaterial[]) {
          Object.assign(m, { metalness: 0, roughness: 0.85, metalnessMap: null, roughnessMap: null, side: THREE.DoubleSide });
          insideColor(m);
        }
      body.parent!.add(mesh);
      this.worn.push(mesh);
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
      mesh.scale.copy(body.scale);
      mesh.bind(skeleton, body.bindMatrix);
      // Depois do avesso (insideColor): o shader de zonas encadeia nele.
      if (mesh.userData.piece) paintZones(mesh, mesh.userData.piece, colors);
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
    const body = this.bodyMeshes();
    const before = body.map((m) => m.geometry);
    // A meia (meia_r, meia_l, no GLB do tênis) é a casca da pele do pé e da canela, com os mesmos pesos: a pele sob ela
    // sai por aqui como sob a roupa, e a borda que sobra fica sob o lábio da boca da meia (vestir.py, vestir_tenis).
    // Sai a pele a até 2,5 cm do tecido pela normal: onde a peça é solta perto de uma abertura (a barra da bermuda, a
    // cava) a pele fica, e quem olha pela abertura vê a coxa, não o recorte serrilhado da pele escondida. A pele funda sob
    // a roupa (quadril, virilha, os 40% de cima da coxa, barriga baixa e lombar) sai com peça a até 12 cm em qualquer
    // direção: a bermuda costurada (Tools/Animacao/costurar.py) pende à frente da virilha e o gancho passa longe dela, a
    // regata fica até 7 cm da lombar, e só pelo raio da normal a pele (o short esculpido no corpo do HY, branco) furava a
    // frente da bermuda quando a coxa dobrava.
    const deep = (mesh: THREE.SkinnedMesh, p: Float32Array, dom: string[]): Float32Array => {
      const femur = (['l', 'r'] as const).map((s) => [bindBonePosition(mesh, `thigh_${s}`), bindBonePosition(mesh, `calf_${s}`)] as const);
      const out = new Float32Array(dom.length);
      for (let i = 0; i < dom.length; i++) {
        let under = DeepUnderGear.test(dom[i]!);
        const thigh = /^thigh_([lr])$/.exec(dom[i]!);
        if (thigh) {
          const [a, b] = femur[thigh[1] === 'l' ? 0 : 1]!;
          v1.set(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!).sub(a);
          v2.subVectors(b, a);
          under = v1.dot(v2) / v2.lengthSq() < 0.4;
        }
        out[i] = under ? 0.12 : 0;
      }
      return out;
    };
    this.coveredTriangles = hideCoveredTriangles(body, this.gearMeshes(), 0.025, deep);
    // O BodyCover troca a geometria do corpo por uma cópia sem os triângulos cobertos: o dispose devolve a original.
    this.undo.push(() =>
      body.forEach((m, i) => {
        if (m.geometry === before[i]) return;
        m.geometry.dispose();
        m.geometry = before[i]!;
      }),
    );
  }

  /** Distância média dos vértices do corpo (com `from` como osso dominante) ao eixo from→to, na pose atual. */
  private meanRadius(from: string, to: string): number {
    const seg = new THREE.Line3(this.animator.bone(from).getWorldPosition(new THREE.Vector3()), this.animator.bone(to).getWorldPosition(new THREE.Vector3()));
    const near = new THREE.Vector3();
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
        mesh.getVertexPosition(i, v1); // no r186 já aplica a pele (não chamar applyBoneTransform de novo)
        v1.applyMatrix4(mesh.matrixWorld);
        seg.closestPointToPoint(v1, true, near);
        sum += near.distanceTo(v1);
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  /** Raio do joelho com a patela: 95º percentil da distância ao eixo da perna dos vértices numa fatia de ±3 cm da articulação. */
  private kneeRadius(knee: THREE.Bone, foot: THREE.Bone): number {
    const c = knee.getWorldPosition(new THREE.Vector3());
    const axis = foot.getWorldPosition(new THREE.Vector3()).sub(c).normalize();
    const ds: number[] = [];
    for (const mesh of this.bodyMeshes()) {
      const n = mesh.geometry.getAttribute('position').count;
      for (let i = 0; i < n; i++) {
        mesh.getVertexPosition(i, v1).applyMatrix4(mesh.matrixWorld).sub(c); // getVertexPosition já aplica a pele (r186)
        const along = v1.dot(axis);
        if (Math.abs(along) > 0.03) continue;
        const radial = v1.addScaledVector(axis, -along).length();
        if (radial < 0.15) ds.push(radial);
      }
    }
    ds.sort((x, y) => x - y);
    return ds[Math.floor(0.95 * (ds.length - 1))] ?? 0.06;
  }

  /**
   * Cápsulas do corpo. Pano (pontas dos ossos de pano): coxas, canelas e tronco com 85% do raio médio, para a mola não
   * brigar com a colisão. Membros (LimbPush, no shader): braços, mãos, coxas e canelas com o raio médio + 1,2 cm de folga.
   */
  private buildCapsules(): void {
    this.animator.root.updateMatrixWorld(true);
    const cap = (from: string, to: string, k: number, margin = 0) => ({ a: this.animator.bone(from), b: this.animator.bone(to), r: k * this.meanRadius(from, to) + margin });
    if (this.cloth.length > 0)
      for (const [from, to] of [
        ['thigh_l', 'calf_l'],
        ['thigh_r', 'calf_r'],
        ['calf_l', 'foot_l'],
        ['calf_r', 'foot_r'],
        ['spine_01', 'neck_01'],
      ])
        this.capsules.push(cap(from, to, 0.85));
    // Modo por peça: 'in' = o membro passa por dentro da peça (o tecido sai por cima); 'out' = cruza por fora (o tecido
    // recua para trás dele). Ausente = não empurra (canela não encosta na regata; braço não entra na bermuda).
    const modes: Record<'jersey' | 'shorts', Partial<Record<string, PushMode>>> = {
      // Regata costurada (Tools/Animacao/costurar.py): solta (1,2 cm no peito, 7 mm nas alças) e com a cava aberta, o
      // braço e a mão passam por fora dela. A ponta da cápsula do braço, na junta do ombro, alcançava a borda da cava e
      // a serrilhava no giro; a do antebraço e a da mão recuavam a barra solta em degrau.
      jersey: {},
      // Bermuda costurada (Tools/Animacao/costurar.py): a perna segue a coxa pelos pesos (a coxa entra ao longo do
      // fêmur) e a pele do alto da coxa sai sob ela (coverBody); só o joelho (a barra não dobra com ele) precisa
      // empurrar. A cápsula da coxa, com o raio médio dela, estufava a perna em vinco.
      shorts: { knee: 'in', lowerarm: 'out', hand: 'out' },
    };
    const limbs: [string, string, string][] = [];
    for (const side of ['l', 'r'])
      limbs.push(
        ['upperarm', `upperarm_${side}`, `lowerarm_${side}`],
        ['lowerarm', `lowerarm_${side}`, `hand_${side}`],
        ['hand', `hand_${side}`, `fingers_${side}`],
        ['thigh', `thigh_${side}`, `calf_${side}`],
        ['calf', `calf_${side}`, `foot_${side}`],
      );
    const limbCaps = new Map(limbs.map(([kind, from, to]) => [from, { kind, cap: cap(from, to, 1, 0.012) }]));
    // Joelho: esfera na articulação com o raio da patela (95% dos vértices a até 9 cm dela), maior que o raio médio da
    // coxa e da canela; sem ela a patela furava a barra da bermuda no crossover.
    for (const side of ['l', 'r']) {
      const knee = this.animator.bone(`calf_${side}`);
      limbCaps.set(`knee_${side}`, { kind: 'knee', cap: { a: knee, b: knee, r: this.kneeRadius(knee, this.animator.bone(`foot_${side}`)) + 0.008 } });
    }
    for (const mesh of this.gearMeshes()) {
      const kind = mesh.userData.gear as keyof GearSet;
      if (kind === 'shoes') continue;
      const m = modes[kind];
      const caps = [...limbCaps.values()].filter((c) => m[c.kind]).map((c) => ({ cap: c.cap, mode: m[c.kind]! }));
      const core: [THREE.Bone, THREE.Bone] = kind === 'jersey' ? [this.animator.bone('pelvis'), this.animator.bone('neck_01')] : [this.animator.bone('pelvis'), this.animator.bone('spine_02')];
      this.pushers.push(new LimbPush(mesh, caps, core));
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
    // Pano da perna da bermuda (pendurado na coxa): o eixo é a coxa; da regata, o tronco.
    const side = /^thigh_([lr])$/.exec(bone.parent!.name)?.[1];
    const core: [THREE.Bone, THREE.Bone] = side ? [this.animator.bone(`thigh_${side}`), this.animator.bone(`calf_${side}`)] : [this.animator.bone('pelvis'), this.animator.bone('neck_01')];
    return { bone, tune, restLocal: bone.quaternion.clone(), tailLocal: tail, core, p: new THREE.Vector3(), prev: new THREE.Vector3(), primed: false };
  }

  /** Pinta a peça justa do boneco com a cor da pele (aparece pela cava da regata e pela boca da bermuda). */
  private skinBodyMaterial(name: string): void {
    const mats: THREE.MeshStandardMaterial[] = [];
    this.animator.root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh && !mesh.userData.gear) mats.push(...([] as THREE.Material[]).concat(mesh.material).map((m) => m as THREE.MeshStandardMaterial));
    });
    const skin = mats.find((m) => m.name === 'Pele');
    // Corpo do HY (Tools/Animacao/trocar_corpo.py): a pele é textura (cor branca) e o "Uniforme" já sai cor de pele.
    if (!skin || skin.map) return;
    for (const m of mats)
      if (m.name === name) {
        const was = m.color.clone();
        this.undo.push(() => m.color.copy(was));
        m.color.copy(skin.color);
      }
  }

  /** O GLTFLoader divide o corpo em uma SkinnedMesh por material: esconde as que usam esses materiais. */
  private hideBodyMaterials(names: string[]): void {
    this.animator.root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || mesh.userData.gear) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.some((m) => names.includes(m.name)) && mesh.visible) {
        mesh.visible = false;
        this.undo.push(() => (mesh.visible = true));
      }
    });
  }

  /** Chamar depois do animator.update (pose final do frame). Passo fixo de 1/60 s para a mola não depender do fps. */
  update(dt: number): void {
    const step = 1 / 60;
    this.acc = Math.min(this.acc + Math.max(0, dt), 4 * step);
    this.animator.root.updateMatrixWorld(true);
    while (this.acc >= step) {
      this.acc -= step;
      for (const c of this.cloth) this.stepBone(c, step);
    }
    for (const p of this.pushers) p.update();
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

  /**
   * A ponta do pano não chega mais perto do eixo do que veste (tronco, coxa) do que fica em repouso: balança para fora,
   * não para dentro. No agachamento fundo as costas da regata ficam para cima e a gravidade as puxava para dentro do
   * corpo (o glúteo e a bermuda atravessavam o pano).
   */
  private keepOutOfCore(c: ClothBone, rest: THREE.Vector3): void {
    c.core[0].getWorldPosition(cA);
    c.core[1].getWorldPosition(cB);
    capSeg.set(cA, cB);
    capSeg.closestPointToPoint(rest, true, cN);
    const r = cN.distanceTo(rest);
    capSeg.closestPointToPoint(c.p, true, cN);
    const d = c.p.distanceTo(cN);
    if (d < r && d > 1e-6) c.p.sub(cN).multiplyScalar(r / d).add(cN);
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
    this.keepOutOfCore(c, target);
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
