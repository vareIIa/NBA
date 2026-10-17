/**
 * Corpo nunca atravessa a roupa: os triângulos do corpo que ficam por baixo de uma peça deixam de ser desenhados.
 *
 * Cada vértice do corpo lança um raio para fora (normal da pele na pose de ligação). Se o raio bate numa peça a menos de
 * `maxDist`, o vértice está coberto. Triângulo com 2 ou 3 vértices cobertos sai do índice. O que sobra do corpo (braços,
 * pescoço, canela) fica fora da roupa, e nenhuma animação consegue empurrar pele através do tecido onde não há pele.
 */
import * as THREE from 'three';

const tmp = new THREE.Vector3();

/**
 * Posições dos vértices no mundo, com a pele aplicada na pose atual. `bind`: na pose de ligação (a posição crua pela
 * bindMatrix; as peças vestidas usam a do corpo, então corpo e roupa ficam no mesmo espaço).
 */
export function skinnedWorldPositions(mesh: THREE.SkinnedMesh | THREE.Mesh, bind = false): Float32Array {
  const pos = mesh.geometry.getAttribute('position');
  const out = new Float32Array(pos.count * 3);
  const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh;
  for (let i = 0; i < pos.count; i++) {
    tmp.fromBufferAttribute(pos, i);
    if (skinned && bind) tmp.applyMatrix4((mesh as THREE.SkinnedMesh).bindMatrix);
    else {
      if (skinned) (mesh as THREE.SkinnedMesh).applyBoneTransform(i, tmp);
      tmp.applyMatrix4(mesh.matrixWorld);
    }
    tmp.toArray(out, i * 3);
  }
  return out;
}

/** Posição de um osso da malha na pose de ligação (no espaço de `skinnedWorldPositions(malha, true)`). */
export function bindBonePosition(mesh: THREE.SkinnedMesh, name: string, out = new THREE.Vector3()): THREE.Vector3 {
  const i = mesh.skeleton.bones.findIndex((b) => b.name === name);
  // Na ligação a pele é a identidade (bone.matrixWorld · boneInverse = I): o osso fica no inverso do boneInverse.
  return out.setFromMatrixPosition(new THREE.Matrix4().copy(mesh.skeleton.boneInverses[i]!).invert());
}

function triIndex(geo: THREE.BufferGeometry): ArrayLike<number> {
  const idx = geo.getIndex();
  if (idx) return idx.array;
  return Array.from({ length: geo.getAttribute('position').count }, (_, i) => i);
}

/** Triângulos (9 floats cada) de todas as peças, no mundo (`bind`: na pose de ligação). */
export function triangleSoup(meshes: (THREE.SkinnedMesh | THREE.Mesh)[], bind = false): Float32Array {
  const chunks: number[] = [];
  for (const m of meshes) {
    const p = skinnedWorldPositions(m, bind);
    const idx = triIndex(m.geometry);
    for (let t = 0; t + 2 < idx.length; t += 3) for (let k = 0; k < 3; k++) chunks.push(p[idx[t + k] * 3], p[idx[t + k] * 3 + 1], p[idx[t + k] * 3 + 2]);
  }
  return new Float32Array(chunks);
}

/**
 * Ossos de cada triângulo da sopa (mesma ordem de `triangleSoup`): os que pesam mais de 10% em algum dos 3 vértices,
 * com os ossos de pano (`pano_*`) contados como o osso pai. `null` = peça sem pele (vale para qualquer osso).
 */
export function triangleBones(meshes: (THREE.SkinnedMesh | THREE.Mesh)[]): (Set<string> | null)[] {
  const out: (Set<string> | null)[] = [];
  for (const m of meshes) {
    const idx = triIndex(m.geometry);
    const sk = m as THREE.SkinnedMesh;
    const si = sk.isSkinnedMesh ? m.geometry.getAttribute('skinIndex') : null;
    const sw = sk.isSkinnedMesh ? m.geometry.getAttribute('skinWeight') : null;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      if (!si || !sw) {
        out.push(null);
        continue;
      }
      const set = new Set<string>();
      for (let k = 0; k < 3; k++)
        for (let c = 0; c < 4; c++) {
          if (sw.getComponent(idx[t + k], c) <= 0.1) continue;
          let bone: THREE.Object3D | null = sk.skeleton.bones[si.getComponent(idx[t + k], c)];
          while (bone && bone.name.startsWith('pano_')) bone = bone.parent;
          if (bone) set.add(bone.name);
        }
      out.push(set);
    }
  }
  return out;
}

/** Osso com maior peso em cada vértice (nome), ou '' sem pele. */
export function dominantBones(mesh: THREE.SkinnedMesh | THREE.Mesh): string[] {
  const n = mesh.geometry.getAttribute('position').count;
  const sk = mesh as THREE.SkinnedMesh;
  const si = sk.isSkinnedMesh ? mesh.geometry.getAttribute('skinIndex') : null;
  const sw = sk.isSkinnedMesh ? mesh.geometry.getAttribute('skinWeight') : null;
  const out: string[] = new Array(n).fill('');
  if (!si || !sw) return out;
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (let c = 1; c < 4; c++) if (sw.getComponent(i, c) > sw.getComponent(i, best)) best = c;
    out[i] = sk.skeleton.bones[si.getComponent(i, best)]?.name ?? '';
  }
  return out;
}

/** Pele de braço: só some sob uma peça que também segue aquele osso (a alça da regata segue o tronco). */
export const ArmBones = /^(upperarm|lowerarm|hand|palm|fingers|thumb)_/;

/** Möller–Trumbore: distância ao longo do raio até o triângulo, ou -1. */
export function rayTriangle(o: ArrayLike<number>, d: ArrayLike<number>, tri: Float32Array, i: number): number {
  const ax = tri[i], ay = tri[i + 1], az = tri[i + 2];
  const e1x = tri[i + 3] - ax, e1y = tri[i + 4] - ay, e1z = tri[i + 5] - az;
  const e2x = tri[i + 6] - ax, e2y = tri[i + 7] - ay, e2z = tri[i + 8] - az;
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const sx = o[0] - ax, sy = o[1] - ay, sz = o[2] - az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 0 ? t : -1;
}

/** Normais por vértice a partir das faces na pose atual (soma das normais das faces, ponderada pela área). */
function vertexNormals(p: Float32Array, idx: ArrayLike<number>): Float32Array {
  const n = new Float32Array(p.length);
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      n[v] += fx;
      n[v + 1] += fy;
      n[v + 2] += fz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

/** As 14 direções do teste "em volta" (eixos e diagonais do cubo). */
const AroundDirs: number[][] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ...[-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z].map((c) => c / Math.sqrt(3))))),
];

/** Grade uniforme dos triângulos da sopa (cada um entra em todas as células que a caixa dele toca). */
class TriangleGrid {
  private readonly cells = new Map<string, number[]>();
  private readonly stamp: Int32Array;
  private query = 0;

  constructor(
    private readonly tri: Float32Array,
    private readonly cell: number,
  ) {
    this.stamp = new Int32Array(tri.length / 9);
    for (let t = 0; t < tri.length; t += 9) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < 9; v += 3) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], tri[t + v + k])), (hi[k] = Math.max(hi[k], tri[t + v + k]));
      this.forCells(lo, hi, (key) => (this.cells.get(key) ?? this.cells.set(key, []).get(key)!).push(t));
    }
  }

  private forCells(lo: number[], hi: number[], fn: (key: string) => void): void {
    const c = this.cell;
    for (let x = Math.floor(lo[0] / c); x <= Math.floor(hi[0] / c); x++)
      for (let y = Math.floor(lo[1] / c); y <= Math.floor(hi[1] / c); y++)
        for (let z = Math.floor(lo[2] / c); z <= Math.floor(hi[2] / c); z++) fn(`${x},${y},${z}`);
  }

  /** O raio o + s·d (0 < s < len) bate em algum triângulo (aceito por `accept`, que recebe o índice do triângulo)? */
  hits(o: number[], d: number[], len: number, accept?: (tri: number) => boolean): boolean {
    const id = ++this.query;
    const lo = [0, 0, 0], hi = [0, 0, 0];
    for (let k = 0; k < 3; k++) (lo[k] = Math.min(o[k], o[k] + d[k] * len)), (hi[k] = Math.max(o[k], o[k] + d[k] * len));
    let found = false;
    this.forCells(lo, hi, (key) => {
      if (found) return;
      for (const t of this.cells.get(key) ?? []) {
        if (this.stamp[t / 9] === id) continue;
        this.stamp[t / 9] = id;
        const hit = rayTriangle(o, d, this.tri, t);
        if (hit > 0 && hit < len && (!accept || accept(t / 9))) {
          found = true;
          return;
        }
      }
    });
    return found;
  }
}

/**
 * Vértices do corpo cobertos pela sopa de triângulos `cover`. Vértices de costura (mesma posição, índices diferentes)
 * herdam a normal média, para o corte não abrir fresta entre ilhas.
 *
 * Coberto = o raio para fora bate na peça a menos de `maxDist` (pele por baixo do tecido) OU o raio para dentro bate na
 * peça a menos de `maxIn` (a pele furou o tecido: peito ou coxa mais largos que a peça; sem essa pele, aparece o tecido
 * que está logo abaixo) OU, com `around[v]` > 0, há peça a menos de `around[v]` em alguma de 14 direções (pele funda sob
 * a roupa, longe das aberturas: no vinco da virilha a normal passa ao lado do pano). Depois a máscara é erodida `erode`
 * anéis: perto da barra e do decote a pele continua um pouco por baixo do tecido, e o recorte (serrilhado, por
 * triângulo) não aparece pela fresta entre o pano e o corpo. A pele funda não é erodida (longe das aberturas não há
 * fresta, e a borda devolvida furava a frente da bermuda com a coxa dobrada).
 *
 * `accept(vértice, triângulo)`: só conta o triângulo da peça que se move com aquele vértice do corpo. A pele do deltoide
 * que no bind (braços em T) fica sob a alça sai de baixo dela quando o braço desce; escondida, virava buraco no ombro.
 */
export function coveredVertices(
  p: Float32Array,
  idx: ArrayLike<number>,
  cover: Float32Array,
  maxDist: number,
  maxIn = 0.04,
  erode = 1,
  accept?: (vertex: number, tri: number) => boolean,
  around?: ArrayLike<number>,
): Uint8Array {
  const n = vertexNormals(p, idx);
  const count = p.length / 3;
  let farthest = maxDist;
  if (around) for (let i = 0; i < count; i++) farthest = Math.max(farthest, around[i]!);
  // Costuras: cópias da mesma posição viram um vértice só (normal média e vizinhança comum).
  const { rep, groups } = weld(p);
  for (const group of groups) {
    if (group.length < 2) continue;
    let x = 0, y = 0, z = 0;
    for (const i of group) (x += n[i * 3]), (y += n[i * 3 + 1]), (z += n[i * 3 + 2]);
    const l = Math.hypot(x, y, z) || 1;
    for (const i of group) (n[i * 3] = x / l), (n[i * 3 + 1] = y / l), (n[i * 3 + 2] = z / l);
  }
  const grid = new TriangleGrid(cover, Math.max(farthest, maxIn, 0.05));
  let out = new Uint8Array(count);
  const o = [0, 0, 0], d = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    if (rep[i] !== i) continue;
    const ok = accept ? (tri: number) => accept(i, tri) : undefined;
    for (let k = 0; k < 3; k++) (d[k] = n[i * 3 + k]), (o[k] = p[i * 3 + k] - d[k] * 0.002);
    if (grid.hits(o, d, maxDist, ok)) {
      out[i] = 1;
      continue;
    }
    if (maxIn > 0) {
      for (let k = 0; k < 3; k++) (d[k] = -n[i * 3 + k]), (o[k] = p[i * 3 + k] - d[k] * 0.002);
      if (grid.hits(o, d, maxIn, ok)) {
        out[i] = 1;
        continue;
      }
    }
    const r = around?.[i] ?? 0;
    if (r <= 0) continue;
    for (let k = 0; k < 3; k++) o[k] = p[i * 3 + k];
    if (AroundDirs.some((dir) => grid.hits(o, dir, r, ok))) out[i] = 1;
  }
  if (erode > 0) {
    const nbr = neighbors(idx, rep, count);
    for (let r = 0; r < erode; r++) {
      const next = out.slice();
      for (let i = 0; i < count; i++) if (out[i] && !(around?.[i] ?? 0) && nbr[i].some((j) => !out[j])) next[i] = 0;
      out = next;
    }
  }
  for (let i = 0; i < count; i++) out[i] = out[rep[i]];
  return out;
}

/** Cópias da mesma posição (costuras de UV) apontam para um representante. */
function weld(p: Float32Array): { rep: Int32Array; groups: number[][] } {
  const count = p.length / 3;
  const rep = new Int32Array(count);
  const welded = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const key = `${p[i * 3].toFixed(4)},${p[i * 3 + 1].toFixed(4)},${p[i * 3 + 2].toFixed(4)}`;
    (welded.get(key) ?? welded.set(key, []).get(key)!).push(i);
  }
  for (const group of welded.values()) for (const i of group) rep[i] = group[0];
  return { rep, groups: [...welded.values()] };
}

/** Vizinhos por aresta, entre representantes. */
function neighbors(idx: ArrayLike<number>, rep: Int32Array, count: number): number[][] {
  const nbr: number[][] = Array.from({ length: count }, () => []);
  for (let t = 0; t + 2 < idx.length; t += 3)
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b) nbr[rep[idx[t + a]]].push(rep[idx[t + b]]);
  return nbr;
}

/**
 * Devolve a pele coberta que está a até `rings` anéis de um vértice visível marcado em `seed`. No ombro (pele de braço e
 * da clavícula que fica) o recorte serrilhado do trapézio deixava uma fresta entre a pele e a alça, e por ela aparecia o
 * avesso escuro da regata. Essa faixa fica sob a alça e se move com a clavícula e o tronco, como a alça.
 */
export function uncoverNear(covered: Uint8Array, p: Float32Array, idx: ArrayLike<number>, seed: (v: number) => boolean, rings: number): Uint8Array {
  const count = covered.length;
  const { rep } = weld(p);
  const nbr = neighbors(idx, rep, count);
  const out = covered.slice();
  let front = new Set<number>();
  for (let i = 0; i < count; i++) if (!covered[i] && seed(i)) front.add(rep[i]);
  for (let r = 0; r < rings; r++) {
    const next = new Set<number>();
    for (const i of front) for (const j of nbr[i]) if (out[j]) (out[j] = 0), next.add(j);
    front = next;
  }
  for (let i = 0; i < count; i++) out[i] = out[rep[i]];
  return out;
}

/**
 * Tira do índice de cada malha do corpo os triângulos com 2+ vértices cobertos. Devolve quantos saíram. A conta é na
 * pose de ligação, a pose em que as peças foram ajustadas ao corpo (Tools/Animacao): a do primeiro quadro (os nós do GLB
 * já vêm de braços baixos) ou a de quem troca de roupa no meio do jogo deixava a coxa dobrada à frente do pano, e a
 * pele dali não saía. `around(malha, posições na pose de ligação, osso dominante)`: o alcance do teste "em volta" de cada
 * vértice (coveredVertices; 0 = só o raio da normal); os ossos na pose de ligação, por `bindBonePosition`.
 */
export function hideCoveredTriangles(
  body: THREE.SkinnedMesh[],
  garments: (THREE.SkinnedMesh | THREE.Mesh)[],
  maxDist = 0.12,
  around?: (mesh: THREE.SkinnedMesh, p: Float32Array, dom: string[]) => ArrayLike<number>,
): number {
  const cover = triangleSoup(garments, true);
  const triBones = triangleBones(garments);
  let removed = 0;
  for (const mesh of body) {
    const p = skinnedWorldPositions(mesh, true);
    const idx = triIndex(mesh.geometry);
    const dom = dominantBones(mesh);
    const accept = (v: number, tri: number): boolean => {
      const set = triBones[tri];
      return !set || !ArmBones.test(dom[v]) || set.has(dom[v]);
    };
    const shoulder = (v: number) => ArmBones.test(dom[v]) || dom[v].startsWith('clavicle_');
    const covered = uncoverNear(coveredVertices(p, idx, cover, maxDist, 0.04, 1, accept, around?.(mesh, p, dom)), p, idx, shoulder, 2);
    const keep: number[] = [];
    for (let t = 0; t + 2 < idx.length; t += 3) {
      if (covered[idx[t]] + covered[idx[t + 1]] + covered[idx[t + 2]] >= 2) removed++;
      else keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    // Geometria própria: outro jogador com o mesmo GLB (cache do loader) não perde triângulos.
    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.setIndex(keep);
  }
  return removed;
}
