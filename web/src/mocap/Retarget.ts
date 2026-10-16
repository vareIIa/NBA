// Retarget: juntas 3D de outra fonte -> clipe do nosso esqueleto (Fases 1 e 2 da fluidez).
//
// Fontes:
//  - pose extraída de vídeo (MediaPipe Pose, 33 pontos; Tools/Animacao/video_para_pose.py);
//  - clipes do Mixamo (juntas do esqueleto mixamorig por quadro; tools/mixamo-bake.mjs).
//
// Método: só direções, nunca comprimentos. Cada osso dos membros gira o mínimo (swing) para apontar do ponto dele para
// o ponto do filho; a pelve e o tronco pegam a orientação inteira pelos quadris e pelos ombros. Assim as proporções
// continuam as do nosso jogador. Altura da pelve: na fonte com esqueleto (Mixamo) é a do quadril de origem escalada pela
// razão das pernas (o voo da corrida aparece); no vídeo é a do pé mais baixo no chão. O deslocamento horizontal sai do
// clipe (em loop, a tendência linear vira a velocidade nativa; a oscilação do quadril fica).
import * as THREE from 'three';

/** Um quadro do arquivo exportado por Tools/Animacao/video_para_pose.py (w: 33 pontos no mundo do MediaPipe, m). */
export interface PoseFrame {
  t: number;
  w: number[][] | null;
  v?: number[] | null;
}

export interface PoseFile {
  fonte: string;
  t0: number;
  t1: number;
  quadros: PoseFrame[];
}

/** Arquivo do tools/mixamo-bake.mjs: juntas (nomes em `juntas`) por quadro, a 60 Hz, em cm e Y para cima. */
export interface MixamoFile {
  fps: number;
  juntas: string[];
  clipes: Record<string, { duracao: number; perna: number; quadros: number[][][] }>;
}

export interface RetargetOptions {
  /** Fator de tempo da fonte para o jogo (vídeo em câmera lenta: < 1). */
  speed: number;
  /** Raio do filtro binomial nos pontos (quadros da fonte). */
  smooth: number;
  name: string;
}

/** Papéis das juntas (os nomes do mixamo-bake.mjs). */
type Role =
  | 'hips' | 'spine' | 'spine1' | 'spine2' | 'neck' | 'head' | 'headTop'
  | 'shL' | 'elL' | 'wrL' | 'handL' | 'shR' | 'elR' | 'wrR' | 'handR'
  | 'hipL' | 'kneeL' | 'ankL' | 'ballL' | 'toeL' | 'heelL'
  | 'hipR' | 'kneeR' | 'ankR' | 'ballR' | 'toeR' | 'heelR';

interface JointFrame {
  t: number;
  j: Partial<Record<Role, THREE.Vector3>>;
}

/** Clipe gerado + a velocidade nativa (m/s no referencial do jogador: +forward = frente, +right = direita). */
export interface RetargetedClip {
  clip: THREE.AnimationClip;
  velocity: { right: number; forward: number };
}

/** Membros: osso -> filho no esqueleto, e de qual junta para qual ele aponta. */
const Limbs: { bone: string; child: string; from: Role; to: Role }[] = [
  { bone: 'thigh_l', child: 'calf_l', from: 'hipL', to: 'kneeL' },
  { bone: 'calf_l', child: 'foot_l', from: 'kneeL', to: 'ankL' },
  { bone: 'thigh_r', child: 'calf_r', from: 'hipR', to: 'kneeR' },
  { bone: 'calf_r', child: 'foot_r', from: 'kneeR', to: 'ankR' },
  { bone: 'upperarm_l', child: 'lowerarm_l', from: 'shL', to: 'elL' },
  { bone: 'lowerarm_l', child: 'hand_l', from: 'elL', to: 'wrL' },
  { bone: 'hand_l', child: 'fingers_l', from: 'wrL', to: 'handL' },
  { bone: 'upperarm_r', child: 'lowerarm_r', from: 'shR', to: 'elR' },
  { bone: 'lowerarm_r', child: 'hand_r', from: 'elR', to: 'wrR' },
  { bone: 'hand_r', child: 'fingers_r', from: 'wrR', to: 'handR' },
];

function binomial(radius: number): number[] {
  const n = radius * 2;
  const w: number[] = [1];
  for (let i = 0; i < n; i++) w.push((w[i] * (n - i)) / (i + 1));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

/** Base ortonormal com +X = esquerda do corpo e +Y = cima (o nosso jogador olha para +Z = esquerda x cima). */
function frameQuat(left: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const y = up.clone().normalize();
  const x = left.clone().addScaledVector(y, -left.dot(y)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Filtra o tremor e gira em torno de Y para o corpo começar olhando para +Z (esquerda dos quadris em +X). */
function prepare(raw: JointFrame[], smooth: number): JointFrame[] {
  const w = binomial(smooth);
  const roles = Object.keys(raw[0].j) as Role[];
  const out: JointFrame[] = raw.map((f, i) => {
    const j: Partial<Record<Role, THREE.Vector3>> = {};
    for (const r of roles) {
      const acc = new THREE.Vector3();
      for (let k = -smooth; k <= smooth; k++) acc.addScaledVector(raw[Math.min(raw.length - 1, Math.max(0, i + k))].j[r]!, w[k + smooth]);
      j[r] = acc;
    }
    return { t: f.t, j };
  });
  const left = new THREE.Vector3();
  for (const f of out.slice(0, 5)) left.add(f.j.hipL!.clone().sub(f.j.hipR!));
  left.y = 0;
  const yaw = new THREE.Quaternion().setFromUnitVectors(left.normalize(), new THREE.Vector3(1, 0, 0));
  for (const f of out) for (const v of Object.values(f.j)) v!.applyQuaternion(yaw);
  return out;
}

const mid = (a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 => a.clone().add(b).multiplyScalar(0.5);

/** Escreve uma rotação do mundo no osso (local = mundo do pai^-1 * mundo). */
function setWorldQuat(bone: THREE.Object3D, world: THREE.Quaternion): void {
  const parentQ = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentQ.invert().multiply(world));
  bone.updateWorldMatrix(false, true);
}

/** Gira o osso o mínimo para a direção osso->filho (mundo) virar `dir`. */
function aim(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3): void {
  const a = bone.getWorldPosition(new THREE.Vector3());
  const b = child.getWorldPosition(new THREE.Vector3());
  const cur = b.sub(a).normalize();
  const swing = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize());
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  setWorldQuat(bone, swing.multiply(world));
}

interface CoreOptions {
  name: string;
  speed: number;
  smooth: number;
  /** 'source': altura do quadril de origem escalada (fonte com esqueleto); 'floor': o pé mais baixo no chão (vídeo). */
  height: 'source' | 'floor';
  /** Loop: a tendência linear do quadril vira velocidade nativa e sai do clipe. Senão o clipe fica sem deslocamento. */
  loop: boolean;
  /**
   * Graus que a direção pescoço -> cabeça da fonte inclina para a frente (em relação ao tronco) com o corpo em pé olhando
   * à frente. A junta Head do mixamorig fica à frente da Neck no repouso (22° no IdleStand; o nosso esqueleto, 4°): sem
   * descontar a diferença, a cabeça do jogador ficava ~18° baixa em todo clipe ("corcunda" no parado, diretor 2026-10-16).
   */
  neckPitchRest?: number;
  /**
   * Graus que o osso do pé da fonte (tornozelo -> metatarso) desce em relação ao chão com o pé plano. No mixamorig o
   * metatarso fica 39° abaixo do tornozelo (IdleStand), no nosso esqueleto 13–17°: copiada crua, a direção deixava o pé
   * ~25° apontado para baixo em todo clipe, o calcanhar no ar (o jogador andava e corria na ponta do pé, diretor
   * 2026-10-16). A diferença é descontada no declive; o rumo do pé continua o da fonte.
   */
  footSlopeRest?: number;
}

/**
 * Núcleo do retarget. `model` precisa estar no bind pose (recém-carregado ou clonado, sem mixer tocando) e já na escala
 * do jogo; os ossos voltam para o bind pose no fim.
 */
function retargetJoints(model: THREE.Object3D, rawFrames: JointFrame[], opts: CoreOptions): RetargetedClip {
  const bones = new Map<string, THREE.Object3D>();
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o);
  });
  const bone = (n: string): THREE.Object3D => {
    const b = bones.get(n);
    if (!b) throw new Error(`osso ${n} não existe`);
    return b;
  };
  const resetBind = () => {
    for (const [n, b] of bones) {
      const r = bindLocal.get(n)!;
      b.quaternion.copy(r.q);
      b.position.copy(r.p);
    }
    model.updateMatrixWorld(true);
  };
  model.updateMatrixWorld(true);
  const bindLocal = new Map<string, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  for (const [n, b] of bones) bindLocal.set(n, { q: b.quaternion.clone(), p: b.position.clone() });
  const bindWorld = new Map<string, THREE.Quaternion>();
  for (const [n, b] of bones) bindWorld.set(n, b.getWorldQuaternion(new THREE.Quaternion()));
  const wp = (n: string) => bone(n).getWorldPosition(new THREE.Vector3());

  // Referenciais do bind pose: quadris (coxas) e ombros (braços), com "cima" da pelve até o meio dos ombros.
  const bindUp = mid(wp('upperarm_l'), wp('upperarm_r')).sub(mid(wp('thigh_l'), wp('thigh_r')));
  const pelvis0 = frameQuat(wp('thigh_l').sub(wp('thigh_r')), bindUp).invert();
  const torso0 = frameQuat(wp('upperarm_l').sub(wp('upperarm_r')), bindUp).invert();
  const restAnkleY = Math.min(wp('foot_l').y, wp('foot_r').y);
  const ourLeg = wp('thigh_l').distanceTo(wp('calf_l')) + wp('calf_l').distanceTo(wp('foot_l'));
  const bindHip = mid(wp('thigh_l'), wp('thigh_r'));
  // Inclinação pescoço -> cabeça do nosso bind pose, para descontar só a diferença para a da fonte.
  const neckFix = opts.neckPitchRest === undefined ? 0 : THREE.MathUtils.degToRad(opts.neckPitchRest) - neckPitch(wp('neck_01'), wp('head'), wp('upperarm_l').sub(wp('upperarm_r')), bindUp);
  // Quanto o osso do pé (tornozelo -> metatarso) desce em relação ao chão no bind pose (pé apoiado).
  const footSlope = { l: 0, r: 0 };
  for (const side of ['l', 'r'] as const) {
    const d = wp(`ball_${side}`).sub(wp(`foot_${side}`)).normalize();
    footSlope[side] = -Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  }
  // Quanto o pé da fonte com esqueleto sobe (rad) para o declive de repouso dela virar o nosso.
  const footLift = (side: 'l' | 'r') => (opts.footSlopeRest === undefined ? 0 : THREE.MathUtils.degToRad(opts.footSlopeRest) - footSlope[side]);

  const frames = prepare(rawFrames, opts.smooth);
  const first = frames[0].j;
  const srcLeg = first.hipL!.distanceTo(first.kneeL!) + first.kneeL!.distanceTo(first.ankL!);
  const k = ourLeg / srcLeg;
  // Tendência linear do quadril (loop): sai do clipe e vira a velocidade nativa.
  const n = frames.length;
  const hip0 = mid(frames[0].j.hipL!, frames[0].j.hipR!);
  const hip1 = mid(frames[n - 1].j.hipL!, frames[n - 1].j.hipR!);
  const travel = hip1.clone().sub(hip0).setY(0);
  const duration = (frames[n - 1].t - frames[0].t) * opts.speed;
  const velocity = {
    forward: duration > 0 ? (travel.z * k) / duration : 0,
    right: duration > 0 ? (-travel.x * k) / duration : 0,
  };

  const animated = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'foot_l', 'foot_r', ...Limbs.map((l) => l.bone)];
  const qTracks = new Map<string, number[]>(animated.map((b) => [b, []]));
  const pelvisPos: number[] = [];
  const times: number[] = [];
  const t0 = frames[0].t;

  frames.forEach((f, i) => {
    resetBind();
    const p = f.j;
    const hipMid = mid(p.hipL!, p.hipR!);
    const shMid = mid(p.shL!, p.shR!);
    const up = shMid.clone().sub(hipMid);
    const dPelvis = frameQuat(p.hipL!.clone().sub(p.hipR!), up).multiply(pelvis0);
    const dTorso = frameQuat(p.shL!.clone().sub(p.shR!), up).multiply(torso0);
    setWorldQuat(bone('pelvis'), dPelvis.clone().multiply(bindWorld.get('pelvis')!));
    // Coluna: a rotação vai da pelve aos ombros em três partes (as costas curvam, não dobram num ponto).
    for (const [b, w] of [['spine_01', 1 / 3], ['spine_02', 2 / 3], ['spine_03', 1]] as const) {
      setWorldQuat(bone(b), dPelvis.clone().slerp(dTorso, w).multiply(bindWorld.get(b)!));
    }
    // Pescoço -> cabeça, quando a fonte tem esqueleto (no vídeo as orelhas ficam atrás do pescoço e derrubavam a cabeça).
    if (p.neck && p.head) {
      const dir = p.head.clone().sub(p.neck);
      // Desconta o repouso da fonte: gira para trás em torno da esquerda do tronco.
      if (neckFix) dir.applyAxisAngle(p.shL!.clone().sub(p.shR!).normalize(), -neckFix);
      aim(bone('neck_01'), bone('head'), dir);
    }
    for (const l of Limbs) aim(bone(l.bone), bone(l.child), p[l.to]!.clone().sub(p[l.from]!));
    for (const side of ['l', 'r'] as const) {
      const S = side === 'l' ? 'L' : 'R';
      const ank = p[`ank${S}` as Role]!;
      const ball = p[`ball${S}` as Role];
      if (ball) {
        // Esqueleto: o osso do pé é o mesmo (tornozelo -> metatarso), com o declive de repouso descontado (footSlopeRest).
        const dir = ball.clone().sub(ank).normalize();
        const lift = footLift(side);
        if (lift !== 0) {
          // Sobe a ponta girando em torno do eixo lateral (a direita do quadril, perpendicular ao pé). Pelo rumo horizontal
          // do pé o eixo virava quando o pé da fonte passava perto da vertical (fim do impulso): o pé girava 40–50° num quadro.
          const axis = p.hipR!.clone().sub(p.hipL!);
          axis.addScaledVector(dir, -axis.dot(dir)).normalize();
          dir.applyAxisAngle(axis, lift);
        }
        aim(bone(`foot_${side}`), bone(`ball_${side}`), dir);
      } else {
        // Vídeo: rumo e inclinação do calcanhar -> ponta (a ponta sozinha treme), descontando o declive do osso.
        const sole = p[`toe${S}` as Role]!.clone().sub(p[`heel${S}` as Role]!).normalize();
        const heading = new THREE.Vector3(sole.x, 0, sole.z).normalize();
        const pitch = Math.asin(THREE.MathUtils.clamp(sole.y, -1, 1)) - footSlope[side];
        aim(bone(`foot_${side}`), bone(`ball_${side}`), heading.multiplyScalar(Math.cos(pitch)).add(new THREE.Vector3(0, Math.sin(pitch), 0)));
      }
    }
    const pel = bone('pelvis');
    const world = pel.getWorldPosition(new THREE.Vector3());
    if (opts.height === 'source') {
      // Quadril de origem (sem a tendência da caminhada) escalado pela razão das pernas.
      // O chão da fonte é y = 0, como o nosso (o modelo já está na escala e na altura do jogo).
      const u = n > 1 ? i / (n - 1) : 0;
      const sway = hipMid.clone().sub(hip0).addScaledVector(opts.loop ? travel : new THREE.Vector3(), -u);
      const ourHip = mid(wp('thigh_l'), wp('thigh_r'));
      world.x += bindHip.x + sway.x * k - ourHip.x;
      world.z += bindHip.z + sway.z * k - ourHip.z;
      world.y += hipMid.y * k - ourHip.y;
    }
    // Nunca com o tornozelo abaixo do de pé no chão; no vídeo, o mais baixo sempre no chão.
    pel.position.copy(pel.parent!.worldToLocal(world));
    pel.updateWorldMatrix(false, true);
    const low = Math.min(wp('foot_l').y, wp('foot_r').y);
    if (opts.height === 'floor' || low < restAnkleY) {
      world.y += restAnkleY - low;
      pel.position.copy(pel.parent!.worldToLocal(world));
      pel.updateWorldMatrix(false, true);
    }

    times.push((f.t - t0) * opts.speed);
    for (const b of animated) {
      const q = bone(b).quaternion;
      qTracks.get(b)!.push(q.x, q.y, q.z, q.w);
    }
    pelvisPos.push(pel.position.x, pel.position.y, pel.position.z);
  });
  resetBind();

  const tracks: THREE.KeyframeTrack[] = animated.map((b) => new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, qTracks.get(b)!));
  tracks.push(new THREE.VectorKeyframeTrack('pelvis.position', times, pelvisPos));
  return { clip: new THREE.AnimationClip(opts.name, -1, tracks), velocity };
}

// Índices do MediaPipe Pose.
const MP: Partial<Record<Role, number | number[]>> = {
  shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16, handL: [17, 19], handR: [18, 20],
  hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankL: 27, ankR: 28, heelL: 29, heelR: 30, toeL: 31, toeR: 32,
};

/** Pose do vídeo (MediaPipe) -> clipe. */
export function retargetPose(model: THREE.Object3D, file: PoseFile, opts: RetargetOptions): THREE.AnimationClip {
  // MediaPipe: x para a direita da imagem, y para baixo, z para longe da câmera -> (x, -y, -z), mantém a mão do sistema.
  const frames: JointFrame[] = file.quadros
    .filter((f) => f.w)
    .map((f) => {
      const pt = (i: number) => new THREE.Vector3(f.w![i][0], -f.w![i][1], -f.w![i][2]);
      const j: Partial<Record<Role, THREE.Vector3>> = {};
      for (const [r, idx] of Object.entries(MP) as [Role, number | number[]][]) {
        j[r] = Array.isArray(idx) ? idx.reduce((a, x) => a.add(pt(x)), new THREE.Vector3()).multiplyScalar(1 / idx.length) : pt(idx);
      }
      return { t: f.t, j };
    });
  return retargetJoints(model, frames, { ...opts, height: 'floor', loop: false }).clip;
}

/** Inclinação (rad) de pescoço -> cabeça para a frente, no plano do tronco (left = esquerda, up = cima do tronco). */
function neckPitch(neck: THREE.Vector3, head: THREE.Vector3, left: THREE.Vector3, up: THREE.Vector3): number {
  const y = up.clone().normalize();
  const x = left.clone().addScaledVector(y, -left.dot(y)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  const d = head.clone().sub(neck);
  return Math.atan2(d.dot(z), d.dot(y));
}

/** Inclinação do pescoço da fonte em pé (graus): a média do IdleStand, ou nada se o arquivo não tem o clipe. */
function mixamoNeckRest(file: MixamoFile): number | undefined {
  const c = file.clipes.IdleStand;
  const J = file.juntas;
  const at = (q: number[][], r: Role) => new THREE.Vector3(...(q[J.indexOf(r)] as [number, number, number]));
  if (!c || !['neck', 'head', 'shL', 'shR', 'hipL', 'hipR'].every((r) => J.includes(r))) return undefined;
  let sum = 0;
  for (const q of c.quadros) {
    const up = mid(at(q, 'shL'), at(q, 'shR')).sub(mid(at(q, 'hipL'), at(q, 'hipR')));
    sum += neckPitch(at(q, 'neck'), at(q, 'head'), at(q, 'hipL').sub(at(q, 'hipR')), up);
  }
  return THREE.MathUtils.radToDeg(sum / c.quadros.length);
}

/** Pé do Mixamo com o declive de repouso descontado (footSlopeRest); `?pemixamo=cru` volta à direção crua (A/B). */
const MixamoFootFix = typeof location === 'undefined' || new URLSearchParams(location.search).get('pemixamo') !== 'cru';

/** Declive do pé da fonte em pé (graus, tornozelo -> metatarso para baixo): a média dos dois pés no IdleStand. */
function mixamoFootRest(file: MixamoFile): number | undefined {
  const c = file.clipes.IdleStand;
  const J = file.juntas;
  if (!c || !['ankL', 'ballL', 'ankR', 'ballR'].every((r) => J.includes(r))) return undefined;
  let sum = 0;
  for (const q of c.quadros) {
    for (const [a, b] of [['ankL', 'ballL'], ['ankR', 'ballR']]) {
      const d = new THREE.Vector3(...(q[J.indexOf(b)] as [number, number, number])).sub(new THREE.Vector3(...(q[J.indexOf(a)] as [number, number, number])));
      sum += -Math.atan2(d.y, Math.hypot(d.x, d.z));
    }
  }
  return THREE.MathUtils.radToDeg(sum / (2 * c.quadros.length));
}

/** Clipe do Mixamo (tools/mixamo-bake.mjs) -> clipe do nosso esqueleto, com a velocidade nativa. */
export function retargetMixamo(
  model: THREE.Object3D,
  file: MixamoFile,
  clipName: string,
  // footFix: false = o pé com a direção crua da fonte (como antes; A/B pela URL ?pemixamo=cru).
  opts: { name?: string; loop: boolean; smooth?: number; footFix?: boolean },
): RetargetedClip {
  const c = file.clipes[clipName];
  if (!c) throw new Error(`clipe ${clipName} não está no arquivo`);
  const roles = file.juntas as Role[];
  const frames: JointFrame[] = c.quadros.map((q, i) => {
    const j: Partial<Record<Role, THREE.Vector3>> = {};
    roles.forEach((r, k) => (j[r] = new THREE.Vector3(q[k][0], q[k][1], q[k][2])));
    return { t: i / file.fps, j };
  });
  return retargetJoints(model, frames, {
    name: opts.name ?? clipName,
    speed: 1,
    smooth: opts.smooth ?? 0,
    height: 'source',
    loop: opts.loop,
    neckPitchRest: mixamoNeckRest(file),
    footSlopeRest: (opts.footFix ?? MixamoFootFix) ? mixamoFootRest(file) : undefined,
  });
}

/**
 * Espelha um clipe do arquivo do Mixamo (troca esquerda/direita e inverte X) e grava com outro nome. O trote lateral
 * para a direita do Soccer Game Pack é mais lento e torto que o da esquerda; o espelho do da esquerda fica simétrico.
 */
export function mirrorMixamoClip(file: MixamoFile, src: string, dst: string): void {
  const c = file.clipes[src];
  if (!c) return;
  const J = file.juntas;
  const swap = J.map((name) => {
    const other = /L$/.test(name) ? name.replace(/L$/, 'R') : /R$/.test(name) ? name.replace(/R$/, 'L') : name;
    const k = J.indexOf(other);
    return k >= 0 ? k : J.indexOf(name);
  });
  file.clipes[dst] = { ...c, quadros: c.quadros.map((q) => swap.map((k) => [-q[k][0], q[k][1], q[k][2]])) };
}
