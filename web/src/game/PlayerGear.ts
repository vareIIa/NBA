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
import { cutBelowCuff, hideCoveredTriangles } from './BodyCover';
import { CuffBins, CuffPull, type Cuff } from './CuffPull';
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
  /** Tênis: boca e raio do cano por pé, e a pele puxada para dentro (CuffPull). */
  private cuffs: Cuff[] = [];
  private cuff: CuffPull | null = null;

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
    // Pele dentro do cano (CuffPull): a boca e o raio de cada tênis vêm do GLB vestido.
    if (gear.cuffs.length > 0)
      gear.cuff = new CuffPull(gear.bodyMeshes(), { foot: ['foot_r', 'foot_l'].map((n) => animator.bone(n)), calf: ['calf_r', 'calf_l'].map((n) => animator.bone(n)) }, gear.cuffs);
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
    this.cuff?.off();
    this.cuff = null;
    this.cuffs = [];
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
    this.coveredTriangles = hideCoveredTriangles(body, this.gearMeshes());
    // Tênis: some a pele abaixo da boca do cano (corte pela altura, sem dentes); o CuffPull puxa o que sobra para dentro.
    this.cuffs = this.shoeCuffs();
    if (this.cuffs.length > 0) cutBelowCuff(body, this.cuffs);
    // O BodyCover troca a geometria do corpo por uma cópia sem os triângulos cobertos: o dispose devolve a original.
    this.undo.push(() =>
      body.forEach((m, i) => {
        if (m.geometry === before[i]) return;
        m.geometry.dispose();
        m.geometry = before[i]!;
      }),
    );
  }

  /**
   * Tornozelo, joelho, raio interno do cano e altura da boca de cada pé, no bind do GLB do tênis (o pé direito primeiro).
   * Boca = ponto mais alto do tênis; raio = 10º percentil da distância ao eixo da canela, nos 3 cm abaixo da boca, menos
   * 4 mm de tecido (o cano fica por fora da pele; a pele pulada até esse raio não chega à parede).
   */
  private shoeCuffs(): Cuff[] {
    // Meia (meia_r, meia_l, no GLB do tênis): a boca é o topo da meia, e a pele abaixo dela sai e fica dentro da meia.
    const shoes = this.gearMeshes().filter((m) => m.userData.gear === 'shoes' && m.name.startsWith('meia'));
    if (shoes.length === 0) return [];
    const boneBind = (mesh: THREE.SkinnedMesh, name: string): THREE.Vector3 | null => {
      const i = mesh.skeleton.bones.findIndex((b) => b.name === name);
      if (i < 0) return null;
      return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(mesh.skeleton.boneInverses[i]).invert());
    };
    let mouth = -Infinity;
    for (const mesh of shoes) {
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) mouth = Math.max(mouth, pos.getY(i));
    }
    const out: Cuff[] = [];
    for (const side of ['r', 'l'] as const) {
      const ankle = boneBind(shoes[0], `foot_${side}`);
      const knee = boneBind(shoes[0], `calf_${side}`);
      if (!ankle || !knee) return [];
      const axis = knee.clone().sub(ankle);
      const len = axis.length();
      axis.divideScalar(len);
      // Perfil do cano por altura: em cada faixa de 1 cm, o raio externo do tênis em 12 setores ao redor da canela (o
      // maior raio de cada setor, do tecido de fora) e o menor desses raios, menos 3 mm. A pele puxada até esse raio fica
      // dentro do tênis em todo o anel. (O forro de dentro, a 1,5 cm do eixo, não entra: fica dentro do tecido de fora.)
      const e1 = Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0).cross(axis).normalize() : new THREE.Vector3(0, 0, 1).cross(axis).normalize();
      const e2 = axis.clone().cross(e1);
      const SECT = 12;
      const sect: number[][] = Array.from({ length: CuffBins }, () => new Array<number>(SECT).fill(0));
      const sideX = Math.sign(ankle.x);
      for (const m of shoes) {
        const pos = m.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          if (Math.sign(pos.getX(i)) !== sideX) continue;
          const rel = new THREE.Vector3(pos.getX(i) - ankle.x, pos.getY(i) - ankle.y, pos.getZ(i) - ankle.z);
          const h = rel.dot(axis);
          const b = Math.floor(h * 100);
          if (b < 0 || b >= CuffBins) continue;
          const pa = rel.clone().addScaledVector(axis, -h);
          const perp = pa.length();
          const k = Math.floor(((Math.atan2(pa.dot(e2), pa.dot(e1)) + Math.PI) / (2 * Math.PI)) * SECT) % SECT;
          sect[b][k] = Math.max(sect[b][k], perp);
        }
      }
      const prof = sect.map((row) => {
        const vals = row.filter((x) => x > 0);
        if (vals.length === 0) return NaN;
        // 25º percentil dos setores (não o mínimo: um setor só com miolo do tecido puxava o perfil para 1 cm).
        vals.sort((a, b) => a - b);
        return Math.min(0.06, Math.max(0.012, vals[Math.floor(0.25 * (vals.length - 1))] - 0.003));
      });
      for (let b = 0; b < CuffBins; b++) if (Number.isNaN(prof[b])) prof[b] = b > 0 ? prof[b - 1] : 0.03;
      out.push({ ankle, knee, prof, mouth });
    }
    return out;
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
      // Sem a coxa: a barra da regata segue o quadril e a bermuda (vestir.py), e a cápsula da coxa a empurrava em lasca
      // quando a perna subia; quem cobre a coxa é a bermuda.
      jersey: { upperarm: 'in', lowerarm: 'out', hand: 'out' },
      shorts: { thigh: 'in', calf: 'in', knee: 'in', lowerarm: 'out', hand: 'out' },
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
    this.cuff?.update();
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
