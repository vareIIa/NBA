// Movimento de raiz de um clipe que anda e gira (a virada de 180° correndo do Mixamo, ChangeDir).
//
// O clipe retargetado (Retarget.retargetMixamo, sem loop) leva o deslocamento e o giro do corpo na pelve. Aqui eles saem
// do clipe e viram uma trilha de raiz (posição no chão e rumo, suavizados): a pose fica "no lugar", sobre a raiz e de
// frente para +Z, e o jogo anda e gira a raiz pela trilha (o Freestyle, como no root motion do spin). O balanço do
// quadril e o giro curto da passada ficam na pose.
import * as THREE from 'three';

/** Trilha da raiz (referencial do jogador, m e rad): amostras nos tempos do clipe. */
export interface RootTrack {
  times: number[];
  x: number[];
  z: number[];
  /** Rumo (rad, giro em torno de +Y; 0 = olhando para +Z), desenrolado (sem saltos de 2π). */
  yaw: number[];
  /** Altura da pelve (m) em cada amostra: continua na pose, fica aqui para quem quiser medir a descida. */
  height: number[];
}

export interface RootSample {
  x: number;
  z: number;
  yaw: number;
}

function binomial(radius: number): number[] {
  const w: number[] = [1];
  for (let i = 0; i < radius * 2; i++) w.push((w[i] * (radius * 2 - i)) / (i + 1));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

function smooth(values: number[], radius: number): number[] {
  if (radius < 1) return values.slice();
  const w = binomial(radius);
  return values.map((_, i) => {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += values[Math.min(values.length - 1, Math.max(0, i + k))] * w[k + radius];
    return acc;
  });
}

/**
 * Tira o movimento de raiz do clipe. `model` é um clone do jogador no bind pose, dentro de um grupo parado (o mesmo jeito
 * do retarget). `smoothFrames`: raio do filtro (quadros) da trilha: o que o filtro tira (balanço da passada) fica na pose.
 * Devolve o clipe no lugar (só a trilha da pelve muda) e a trilha da raiz.
 */
export function extractRootMotion(model: THREE.Object3D, clip: THREE.AnimationClip, smoothFrames = 8): { clip: THREE.AnimationClip; root: RootTrack } {
  const pelvis = model.getObjectByName('pelvis')!;
  const parent = pelvis.parent!;
  const posTrack = clip.tracks.find((t) => t.name === 'pelvis.position')!;
  const quatTrack = clip.tracks.find((t) => t.name === 'pelvis.quaternion')!;
  const holder = model.parent ?? model;
  holder.updateMatrixWorld(true);
  const bindQ = pelvis.getWorldQuaternion(new THREE.Quaternion());
  const bindQInv = bindQ.clone().invert();
  const parentM = parent.matrixWorld.clone();
  const parentMInv = parentM.clone().invert();
  const parentQ = parent.getWorldQuaternion(new THREE.Quaternion());
  const parentQInv = parentQ.clone().invert();
  const pos = posTrack.values;
  const quat = quatTrack.values;
  const n = posTrack.times.length;
  // Pelve no referencial do grupo (= do jogador) em cada amostra.
  const P: THREE.Vector3[] = [];
  const Q: THREE.Quaternion[] = [];
  const rawYaw: number[] = [];
  for (let i = 0; i < n; i++) {
    P.push(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(parentM));
    const qi = new THREE.Quaternion(quat[i * 4], quat[i * 4 + 1], quat[i * 4 + 2], quat[i * 4 + 3]);
    const qw = parentQ.clone().multiply(qi);
    Q.push(qw);
    // Rumo: a frente do bind (+Z) girada pela rotação da pelve em relação ao bind, projetada no chão.
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(qw.clone().multiply(bindQInv));
    let a = Math.atan2(f.x, f.z);
    if (i > 0) {
      const prev = rawYaw[i - 1];
      while (a - prev > Math.PI) a -= 2 * Math.PI;
      while (a - prev < -Math.PI) a += 2 * Math.PI;
    }
    rawYaw.push(a);
  }
  const root: RootTrack = {
    times: Array.from(posTrack.times),
    x: smooth(P.map((p) => p.x), smoothFrames),
    z: smooth(P.map((p) => p.z), smoothFrames),
    yaw: smooth(rawYaw, smoothFrames),
    height: P.map((p) => p.y),
  };
  // Pelve no lugar: sem a posição da raiz no chão e sem o rumo dela.
  const newPos = new Float32Array(n * 3);
  const newQuat = new Float32Array(n * 4);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const unYaw = new THREE.Quaternion().setFromAxisAngle(up, -root.yaw[i]);
    const local = P[i].clone().sub(new THREE.Vector3(root.x[i], 0, root.z[i])).applyQuaternion(unYaw).applyMatrix4(parentMInv);
    newPos.set([local.x, local.y, local.z], i * 3);
    const q = parentQInv.clone().multiply(unYaw.multiply(Q[i])).normalize();
    newQuat.set([q.x, q.y, q.z, q.w], i * 4);
  }
  const tracks = clip.tracks.map((t) => {
    if (t === posTrack) return new THREE.VectorKeyframeTrack('pelvis.position', Array.from(posTrack.times), Array.from(newPos));
    if (t === quatTrack) return new THREE.QuaternionKeyframeTrack('pelvis.quaternion', Array.from(quatTrack.times), Array.from(newQuat));
    return t;
  });
  return { clip: new THREE.AnimationClip(clip.name, clip.duration, tracks), root };
}

/** Altura da pelve no tempo t (interpolação linear). */
export function sampleHeight(track: RootTrack, t: number): number {
  const T = track.times;
  const last = T.length - 1;
  if (t <= T[0]) return track.height[0];
  if (t >= T[last]) return track.height[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (T[mid] <= t) lo = mid;
    else hi = mid;
  }
  return track.height[lo] + ((track.height[hi] - track.height[lo]) * (t - T[lo])) / (T[hi] - T[lo]);
}

/** Raiz no tempo t (interpolação linear entre as amostras; fora delas, a ponta). */
export function sampleRoot(track: RootTrack, t: number, out: RootSample = { x: 0, z: 0, yaw: 0 }): RootSample {
  const T = track.times;
  if (t <= T[0]) {
    out.x = track.x[0];
    out.z = track.z[0];
    out.yaw = track.yaw[0];
    return out;
  }
  const last = T.length - 1;
  if (t >= T[last]) {
    out.x = track.x[last];
    out.z = track.z[last];
    out.yaw = track.yaw[last];
    return out;
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (T[mid] <= t) lo = mid;
    else hi = mid;
  }
  const u = (t - T[lo]) / (T[hi] - T[lo]);
  out.x = track.x[lo] + (track.x[hi] - track.x[lo]) * u;
  out.z = track.z[lo] + (track.z[hi] - track.z[lo]) * u;
  out.yaw = track.yaw[lo] + (track.yaw[hi] - track.yaw[lo]) * u;
  return out;
}

/**
 * Deslocamento da raiz de t0 a t1 no referencial da raiz em t0 (o do jogador antes do passo) e o giro (rad).
 * +x = esquerda, +z = frente (o referencial do jogador no three).
 */
export function rootDelta(track: RootTrack, t0: number, t1: number): { x: number; z: number; yaw: number } {
  const a = sampleRoot(track, t0);
  const b = sampleRoot(track, t1);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const c = Math.cos(-a.yaw);
  const s = Math.sin(-a.yaw);
  // Giro de -yaw em torno de +Y: x' = x cos + z sen, z' = -x sen + z cos.
  return { x: dx * c + dz * s, z: -dx * s + dz * c, yaw: b.yaw - a.yaw };
}
