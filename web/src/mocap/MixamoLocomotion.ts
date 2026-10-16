// Locomoção por direção e velocidade com os clipes do Mixamo (Fase 2 da fluidez).
//
// Em vez de um clipe por vez trocando em limites de velocidade (o PlayerAnimator de hoje), todos os loops tocam juntos
// com pesos: a direção (ângulo da velocidade no referencial do corpo) escolhe os dois trotes vizinhos das 8 direções, e a
// velocidade mistura parado, andar, trotar, correr e disparar. Todos andam na MESMA fase da passada (0 = pé esquerdo
// pousando), e a fase avança pela distância percorrida dividida pela passada misturada: o pé não patina e a troca de
// direção não pula de perna. O tronco e os braços do "Dribble" do Mixamo entram por cima (camada do drible).
import * as THREE from 'three';
import { type MixamoFile, mirrorMixamoClip, retargetMixamo } from './Retarget';

interface LoopClip {
  name: string;
  action: THREE.AnimationAction;
  duration: number;
  /** Velocidade nativa (m/s, referencial do corpo) e a passada (m por ciclo de 2 passos). */
  velocity: { right: number; forward: number };
  stride: number;
  /** Fase (0..1) em que o pé esquerdo pousa: todos os loops ficam alinhados por ela. */
  offset: number;
  weight: number;
}

/** Ossos do tronco para cima (camada do drible): a pelve e a spine_01 ficam com as pernas. */
const UpperBones = ['spine_02', 'spine_03', 'neck_01', 'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r'];
/** Peso da camada do drible contra a soma 1 da locomoção nos ossos de cima (o mixer faz a média ponderada): ~95%. */
const DribbleLayerWeight = 19;
/** Filtro binomial das juntas (quadros a 60 Hz): o Soccer Game Pack veio a 30 Hz e interpolado tem quinas a cada 2 quadros. */
const MixamoSmooth = 2;

export class MixamoLocomotion {
  readonly mixer: THREE.AnimationMixer;
  private readonly loops: LoopClip[] = [];
  private readonly idle: THREE.AnimationAction;
  private readonly dribble: THREE.AnimationAction | null;
  private phase = 0;
  private dirWeights = new Map<string, number>();

  constructor(model: THREE.Object3D, file: MixamoFile, opts: { dribbleLayer: boolean }) {
    this.mixer = new THREE.AnimationMixer(model);
    // Trote para a direita: o espelho do da esquerda (o original do pacote é mais lento e anda torto).
    mirrorMixamoClip(file, 'JogL', 'JogR');
    const make = (name: string): LoopClip | null => {
      if (!file.clipes[name]) return null;
      const { clip, velocity } = retargetMixamo(model, file, name, { loop: true, smooth: MixamoSmooth });
      const action = this.mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(0);
      const speed = Math.hypot(velocity.right, velocity.forward);
      return { name, action, duration: clip.duration, velocity, stride: speed * clip.duration, offset: leftPlantPhase(file, name), weight: 0 };
    };
    for (const n of ['JogF', 'JogB', 'JogL', 'JogR', 'JogFD1', 'JogFD2', 'JogBD1', 'JogBD2', 'Walk', 'WalkL', 'WalkR', 'Run', 'Sprint']) {
      const c = make(n);
      if (c) this.loops.push(c);
    }
    const idle = retargetMixamo(model, file, 'Idle', { loop: true }).clip;
    this.idle = this.mixer.clipAction(idle);
    this.idle.play();
    if (opts.dribbleLayer && file.clipes.Dribble) {
      const d = retargetMixamo(model, file, 'Dribble', { loop: true }).clip;
      d.tracks = d.tracks.filter((t) => UpperBones.some((b) => t.name.startsWith(`${b}.`)));
      this.dribble = this.mixer.clipAction(d);
      this.dribble.play();
      this.dribble.setEffectiveWeight(DribbleLayerWeight);
    } else {
      this.dribble = null;
    }
  }

  /** Nomes e velocidades nativas (para conferir). */
  describe(): { name: string; right: number; forward: number; stride: number; offset: number }[] {
    return this.loops.map((c) => ({ name: c.name, ...c.velocity, stride: c.stride, offset: c.offset }));
  }

  /** Velocidade (m/s) no referencial do corpo. */
  update(dt: number, right: number, forward: number): void {
    const speed = Math.hypot(right, forward);
    const angle = Math.atan2(right, forward); // 0 = frente, +pi/2 = direita
    // Pesos de direção entre os trotes das 8 direções (os dois vizinhos pelo ângulo da velocidade nativa de cada um).
    const jogs = this.loops.filter((c) => c.name.startsWith('Jog'));
    this.dirWeights = angularWeights(jogs, angle);
    const walks = this.loops.filter((c) => c.name.startsWith('Walk'));
    const walkW = forward > -0.3 * speed ? angularWeights(walks, angle) : new Map<string, number>();
    // Faixas de velocidade: parado < 0,4 < andar ~1,6 < trotar ~2,8 < correr ~4,5 < disparar ~6.
    const idleW = 1 - THREE.MathUtils.smoothstep(speed, 0.05, 0.5);
    const walkK = walkW.size ? 1 - THREE.MathUtils.smoothstep(speed, 1.3, 2.2) : 0;
    const forwardness = Math.max(0, forward) / Math.max(1e-3, speed);
    const runK = THREE.MathUtils.smoothstep(speed, 3.4, 4.6) * forwardness;
    const sprintK = THREE.MathUtils.smoothstep(speed, 5.0, 6.0) * forwardness;
    const moving = 1 - idleW;
    for (const c of this.loops) c.weight = 0;
    const set = (name: string, w: number) => {
      const c = this.loops.find((x) => x.name === name);
      if (c) c.weight += w;
    };
    const jogK = (1 - walkK) * (1 - runK);
    for (const [n, w] of this.dirWeights) set(n, moving * jogK * w);
    for (const [n, w] of walkW) set(n, moving * walkK * w);
    set('Run', moving * (1 - walkK) * runK * (1 - sprintK));
    set('Sprint', moving * (1 - walkK) * runK * sprintK);
    // Fase: distância / passada misturada (só entre os loops com peso).
    let stride = 0;
    let total = 0;
    for (const c of this.loops) {
      stride += c.weight * c.stride;
      total += c.weight;
    }
    if (total > 1e-4 && stride > 1e-4) this.phase = (this.phase + (speed * dt) / (stride / total)) % 1;
    for (const c of this.loops) {
      c.action.setEffectiveWeight(c.weight);
      c.action.time = (((this.phase + c.offset) % 1) + 1) % 1 * c.duration;
    }
    this.idle.setEffectiveWeight(idleW);
    this.idle.time = (this.idle.time + dt) % this.idle.getClip().duration;
    if (this.dribble) {
      // Quique a ~2/s, preso à passada quando anda (dois quiques por ciclo de 2 passos).
      const d = this.dribble.getClip().duration;
      this.dribble.time = (this.dribble.time + dt) % d;
    }
    this.mixer.update(0);
  }
}

/** Pesos entre os clipes pelo ângulo da velocidade nativa de cada um (interpolação entre os dois vizinhos). */
function angularWeights(clips: LoopClip[], angle: number): Map<string, number> {
  const withAngle = clips
    .map((c) => ({ c, a: Math.atan2(c.velocity.right, c.velocity.forward) }))
    .filter((x) => Math.hypot(x.c.velocity.right, x.c.velocity.forward) > 0.2)
    .sort((x, y) => x.a - y.a);
  const out = new Map<string, number>();
  if (withAngle.length === 0) return out;
  if (withAngle.length === 1) {
    out.set(withAngle[0].c.name, 1);
    return out;
  }
  const wrap = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  for (let i = 0; i < withAngle.length; i++) {
    const a = withAngle[i];
    const b = withAngle[(i + 1) % withAngle.length];
    const span = wrap(b.a - a.a) || 2 * Math.PI;
    const t = wrap(angle - a.a);
    if (t <= span) {
      // Só entre vizinhos próximos (até 100°); mais longe (andar só tem frente e lados), fica no mais perto.
      if (span > THREE.MathUtils.degToRad(100)) {
        out.set(t < span / 2 ? a.c.name : b.c.name, 1);
      } else {
        out.set(a.c.name, 1 - t / span);
        out.set(b.c.name, (out.get(b.c.name) ?? 0) + t / span);
      }
      return out;
    }
  }
  out.set(withAngle[0].c.name, 1);
  return out;
}

/**
 * Fase (0..1) do clipe alinhada à do trote para a frente (referência, fase 0 = pé esquerdo pousando). A detecção pelo
 * pouso do pé errava em alguns clipes (diagonais, laterais) e, misturados fora de fase, as pernas se anulavam: o pé
 * ficava parado em relação ao corpo e a perna de trás "ajoelhava". Aqui o alinhamento é pela curva inteira da diferença
 * de altura entre os tornozelos (esquerdo no ar = positivo), por correlação circular com a da referência.
 */
const PhaseSamples = 64;
function footCurve(file: MixamoFile, name: string): number[] {
  const c = file.clipes[name];
  const kl = file.juntas.indexOf('ankL');
  const kr = file.juntas.indexOf('ankR');
  const n = c.quadros.length - 1; // o último quadro do loop repete o primeiro
  const d = c.quadros.slice(0, n).map((q) => q[kl][1] - q[kr][1]);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  return Array.from({ length: PhaseSamples }, (_, i) => {
    const x = (i / PhaseSamples) * n;
    const i0 = Math.floor(x) % n;
    const i1 = (i0 + 1) % n;
    return d[i0] + (d[i1] - d[i0]) * (x - Math.floor(x)) - mean;
  });
}

function leftPlantPhase(file: MixamoFile, name: string): number {
  const ref = 'JogF';
  const plant = (nm: string) => {
    const c = file.clipes[nm];
    const k = file.juntas.indexOf('ankL');
    const ys = c.quadros.map((q) => q[k][1]);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const thr = lo + 0.2 * (hi - lo);
    for (let i = 1; i < ys.length; i++) if (ys[i - 1] > thr && ys[i] <= thr) return i / (ys.length - 1);
    return ys.indexOf(lo) / (ys.length - 1);
  };
  if (!file.clipes[ref] || name === ref) return plant(name);
  const a = footCurve(file, ref);
  const b = footCurve(file, name);
  let best = 0;
  let bestScore = -Infinity;
  for (let s = 0; s < PhaseSamples; s++) {
    let score = 0;
    for (let i = 0; i < PhaseSamples; i++) score += a[i] * b[(i + s) % PhaseSamples];
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return (plant(ref) + best / PhaseSamples) % 1;
}
