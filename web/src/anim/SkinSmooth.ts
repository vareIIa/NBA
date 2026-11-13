// Juntas sem quina (docs/28-render.md, Fase 2). O corpo do HY chegou com os pesos dos ossos em degrau: no cotovelo, no
// ombro e no joelho a pele troca de osso em 1 ou 2 cm, e a dobra sai em ponta. Aqui os pesos são difundidos pela
// superfície da malha (média com os vizinhos, algumas voltas), o que abre a transição para ~5 cm e arredonda a dobra.
// Roda uma vez por geometria, no carregamento; os clipes e o esqueleto não mudam.
import * as THREE from 'three';

/** Ossos que ficam como vieram: a cabeça (a costura com a malha do rosto não pode abrir), os dedos e o pé. */
const Pinned = /^(head|neck|palm|fingers|thumb|foot|ball)/;
const Iterations = 10;
const Blend = 0.5;

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
export const SkinSmoothOn = params.get('juntas') !== '0';

export function smoothSkinWeights(mesh: THREE.SkinnedMesh): void {
  const geometry = mesh.geometry;
  if (!SkinSmoothOn || geometry.userData.skinSmooth) return;
  geometry.userData.skinSmooth = true;
  const position = geometry.getAttribute('position');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const index = geometry.getIndex();
  if (!position || !skinIndex || !skinWeight || !index) return;
  const bones = mesh.skeleton.bones;
  const nb = bones.length;
  const n = position.count;

  // A costura da UV duplica vértices: quem está no mesmo lugar é o mesmo ponto da superfície.
  const point = new Int32Array(n);
  const seen = new Map<string, number>();
  let np = 0;
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(position.getX(i) * 1e5)},${Math.round(position.getY(i) * 1e5)},${Math.round(position.getZ(i) * 1e5)}`;
    let p = seen.get(key);
    if (p === undefined) seen.set(key, (p = np++));
    point[i] = p;
  }

  let weights = new Float32Array(np * nb);
  for (let i = 0; i < n; i++) {
    const row = point[i]! * nb;
    for (let c = 0; c < 4; c++) weights[row + skinIndex.getComponent(i, c)] = Math.max(weights[row + skinIndex.getComponent(i, c)]!, skinWeight.getComponent(i, c));
  }
  const pinnedBone = bones.map((b) => Pinned.test(b.name));
  const free = new Uint8Array(np);
  for (let p = 0; p < np; p++) {
    let pinned = 0;
    let total = 0;
    for (let b = 0; b < nb; b++) {
      const w = weights[p * nb + b]!;
      total += w;
      if (pinnedBone[b]) pinned += w;
    }
    free[p] = total > 0 && pinned < 0.25 * total ? 1 : 0;
  }

  const neighbours: Set<number>[] = Array.from({ length: np }, () => new Set<number>());
  for (let t = 0; t < index.count; t += 3) {
    const a = point[index.getX(t)]!;
    const b = point[index.getX(t + 1)]!;
    const c = point[index.getX(t + 2)]!;
    neighbours[a]!.add(b).add(c);
    neighbours[b]!.add(a).add(c);
    neighbours[c]!.add(a).add(b);
  }

  // Tornozelo e canela baixa ficam exatos: tudo o que a difusão alcançaria a partir de um vértice com peso do pé. A
  // meia e o tênis seguem os pesos originais, e com a perna suavizada ali ela furava a meia.
  const foot = bones.map((b) => /^(foot|ball)/.test(b.name));
  let ring: number[] = [];
  for (let p = 0; p < np; p++) {
    let w = 0;
    for (let b = 0; b < nb; b++) if (foot[b]) w += weights[p * nb + b]!;
    if (w > 0.02) ring.push(p);
  }
  const reached = new Uint8Array(np);
  for (const p of ring) reached[p] = 1;
  for (let depth = 0; depth < Iterations + 2; depth++) {
    const outer: number[] = [];
    for (const p of ring) {
      free[p] = 0;
      for (const q of neighbours[p]!) {
        if (reached[q]) continue;
        reached[q] = 1;
        outer.push(q);
      }
    }
    ring = outer;
  }
  for (const p of ring) free[p] = 0;

  let next = new Float32Array(weights.length);
  for (let it = 0; it < Iterations; it++) {
    next.set(weights);
    for (let p = 0; p < np; p++) {
      const around = neighbours[p]!;
      if (!free[p] || around.size === 0) continue;
      const row = p * nb;
      const k = Blend / around.size;
      for (let b = 0; b < nb; b++) next[row + b] = weights[row + b]! * (1 - Blend);
      for (const q of around) {
        const other = q * nb;
        for (let b = 0; b < nb; b++) next[row + b] += weights[other + b]! * k;
      }
    }
    [weights, next] = [next, weights];
  }

  // De volta aos 4 ossos mais fortes por vértice, somando 1.
  const top = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const p = point[i]!;
    if (!free[p]) continue;
    const row = p * nb;
    top.fill(-1);
    for (let b = 0; b < nb; b++) {
      const w = weights[row + b]!;
      if (w <= 1e-4) continue;
      for (let s = 0; s < 4; s++) {
        if (top[s] === -1 || w > weights[row + top[s]!]!) {
          for (let m = 3; m > s; m--) top[m] = top[m - 1]!;
          top[s] = b;
          break;
        }
      }
    }
    let sum = 0;
    for (let s = 0; s < 4; s++) if (top[s] !== -1) sum += weights[row + top[s]!]!;
    if (sum <= 0) continue;
    for (let s = 0; s < 4; s++) {
      const b = top[s]!;
      skinIndex.setComponent(i, s, b === -1 ? 0 : b);
      skinWeight.setComponent(i, s, b === -1 ? 0 : weights[row + b]! / sum);
    }
  }
  skinIndex.needsUpdate = true;
  skinWeight.needsUpdate = true;
}
