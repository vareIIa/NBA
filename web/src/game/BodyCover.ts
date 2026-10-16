/**
 * Corpo nunca atravessa a roupa: os triângulos do corpo que ficam por baixo de uma peça deixam de ser desenhados.
 *
 * Cada vértice do corpo lança um raio para fora (normal da pele na pose atual). Se o raio bate numa peça a menos de
 * `maxDist`, o vértice está coberto. Triângulo com 2 ou 3 vértices cobertos sai do índice. O que sobra do corpo (braços,
 * pescoço, canela) fica fora da roupa, e nenhuma animação consegue empurrar pele através do tecido onde não há pele.
 */
import * as THREE from 'three';

const tmp = new THREE.Vector3();

/** Posições dos vértices no mundo, com a pele aplicada na pose atual. */
export function skinnedWorldPositions(mesh: THREE.SkinnedMesh | THREE.Mesh): Float32Array {
  const pos = mesh.geometry.getAttribute('position');
  const out = new Float32Array(pos.count * 3);
  const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh;
  for (let i = 0; i < pos.count; i++) {
    tmp.fromBufferAttribute(pos, i);
    if (skinned) (mesh as THREE.SkinnedMesh).applyBoneTransform(i, tmp);
    tmp.applyMatrix4(mesh.matrixWorld);
    tmp.toArray(out, i * 3);
  }
  return out;
}

function triIndex(geo: THREE.BufferGeometry): ArrayLike<number> {
  const idx = geo.getIndex();
  if (idx) return idx.array;
  return Array.from({ length: geo.getAttribute('position').count }, (_, i) => i);
}

/** Triângulos (9 floats cada) de todas as peças, no mundo. */
export function triangleSoup(meshes: (THREE.SkinnedMesh | THREE.Mesh)[]): Float32Array {
  const chunks: number[] = [];
  for (const m of meshes) {
    const p = skinnedWorldPositions(m);
    const idx = triIndex(m.geometry);
    for (let t = 0; t + 2 < idx.length; t += 3) for (let k = 0; k < 3; k++) chunks.push(p[idx[t + k] * 3], p[idx[t + k] * 3 + 1], p[idx[t + k] * 3 + 2]);
  }
  return new Float32Array(chunks);
}

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

/**
 * Vértices do corpo cobertos pela sopa de triângulos `cover`. Vértices de costura (mesma posição, índices diferentes)
 * herdam a normal média, para o corte não abrir fresta entre ilhas.
 */
export function coveredVertices(p: Float32Array, idx: ArrayLike<number>, cover: Float32Array, maxDist: number): Uint8Array {
  const n = vertexNormals(p, idx);
  const welded = new Map<string, number[]>();
  for (let i = 0; i < p.length / 3; i++) {
    const key = `${p[i * 3].toFixed(4)},${p[i * 3 + 1].toFixed(4)},${p[i * 3 + 2].toFixed(4)}`;
    (welded.get(key) ?? welded.set(key, []).get(key)!).push(i);
  }
  for (const group of welded.values()) {
    if (group.length < 2) continue;
    let x = 0, y = 0, z = 0;
    for (const i of group) (x += n[i * 3]), (y += n[i * 3 + 1]), (z += n[i * 3 + 2]);
    const l = Math.hypot(x, y, z) || 1;
    for (const i of group) (n[i * 3] = x / l), (n[i * 3 + 1] = y / l), (n[i * 3 + 2] = z / l);
  }
  // Caixa da roupa (com folga) para não testar a cabeça contra a bermuda.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < cover.length; i += 3) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], cover[i + k])), (hi[k] = Math.max(hi[k], cover[i + k]));
  const out = new Uint8Array(p.length / 3);
  const o = [0, 0, 0], d = [0, 0, 0];
  for (let i = 0; i < out.length; i++) {
    let inside = true;
    for (let k = 0; k < 3; k++) if (p[i * 3 + k] < lo[k] - maxDist || p[i * 3 + k] > hi[k] + maxDist) inside = false;
    if (!inside) continue;
    for (let k = 0; k < 3; k++) (d[k] = n[i * 3 + k]), (o[k] = p[i * 3 + k] - d[k] * 0.002);
    for (let t = 0; t < cover.length; t += 9) {
      const hit = rayTriangle(o, d, cover, t);
      if (hit > 0 && hit < maxDist) {
        out[i] = 1;
        break;
      }
    }
  }
  return out;
}

/** Tira do índice de cada malha do corpo os triângulos com 2+ vértices cobertos. Devolve quantos saíram. */
export function hideCoveredTriangles(body: THREE.SkinnedMesh[], garments: (THREE.SkinnedMesh | THREE.Mesh)[], maxDist = 0.12): number {
  const cover = triangleSoup(garments);
  let removed = 0;
  for (const mesh of body) {
    const p = skinnedWorldPositions(mesh);
    const idx = triIndex(mesh.geometry);
    const covered = coveredVertices(p, idx, cover, maxDist);
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
