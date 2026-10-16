// Linha do tempo do boneco remoto (docs/24 §5): em que instante do relógio do outro jogador o boneco está, e o estado
// dele nesse instante, interpolado entre as amostras que chegaram pela rede.
//
// Relógio: cada amostra traz `t` (relógio de quem mandou). recv − t = diferença dos relógios + atraso da rede; o menor
// valor recente é a diferença + o atraso mínimo. O boneco toca em `agora − diferença − buffer`, e o buffer cresce com a
// variação do atraso (jitter): uma amostra atrasada ainda chega antes da hora de ser usada.
import type { Json } from './Wire';
import type { AnimCommand, BallTransform, PoseSample, Q4, V3 } from './Payload';

export const ClockTuning = {
  /** s de amostras que entram no mínimo (a rota pode melhorar ou piorar; a janela acompanha). */
  window: 3,
  minDelay: 0.06,
  maxDelay: 0.35,
  /** Quanto o relógio do boneco pode adiantar ou atrasar por segundo para acompanhar (5% mais rápido/lento). */
  slew: 0.05,
  /** Diferença acima disto não é acompanhada aos poucos: o relógio pula. */
  jump: 0.25,
  /** Amostras do começo em que o buffer vai direto para o valor calculado (sem acompanhar aos poucos). */
  warmup: 10,
};

/** Relógio do boneco no tempo de quem mandou. */
export class RemoteClock {
  private readonly diffs: { recv: number; diff: number }[] = [];
  private offset = Number.NaN;
  private delayS = 0.1;
  private jitter = 0;
  private interval = 0.05;
  private lastSenderT = Number.NaN;
  private lastRecv = Number.NaN;
  private lastRender = -Infinity;
  private count = 0;

  get ready(): boolean {
    return Number.isFinite(this.offset);
  }

  /** Buffer atual (s). */
  get delay(): number {
    return this.delayS;
  }

  reset(): void {
    this.diffs.length = 0;
    this.offset = Number.NaN;
    this.delayS = 0.1;
    this.jitter = 0;
    this.interval = 0.05;
    this.lastSenderT = Number.NaN;
    this.lastRecv = Number.NaN;
    this.lastRender = -Infinity;
    this.count = 0;
  }

  observe(senderT: number, recvT: number): void {
    const T = ClockTuning;
    const diff = recvT - senderT;
    this.diffs.push({ recv: recvT, diff });
    while (this.diffs.length > 1 && this.diffs[0].recv < recvT - T.window) this.diffs.shift();
    const target = Math.min(...this.diffs.map((d) => d.diff));
    const elapsed = Number.isFinite(this.lastRecv) ? Math.max(0, recvT - this.lastRecv) : 0;
    // Rede mais rápida (mínimo caiu): acompanha na hora (o boneco adianta uns ms, invisível). Mais lenta: atrasa aos
    // poucos (o boneco anda a 95%), para nunca voltar no tempo; uma mudança enorme pula.
    if (!this.ready || target < this.offset || target - this.offset > T.jump) this.offset = target;
    else this.offset += Math.min(target - this.offset, T.slew * elapsed);
    // Jitter: quanto esta amostra chegou depois da mais rápida (EWMA). Intervalo: espaçamento entre envios.
    this.jitter += (Math.max(0, diff - target) - this.jitter) * 0.1;
    if (Number.isFinite(this.lastSenderT) && senderT > this.lastSenderT) {
      this.interval += (clamp(senderT - this.lastSenderT, 0.005, 0.5) - this.interval) * 0.1;
    }
    const wanted = clamp(this.interval + 2.5 * this.jitter + 0.02, T.minDelay, T.maxDelay);
    if (++this.count <= T.warmup) this.delayS = wanted;
    else this.delayS += clamp(wanted - this.delayS, -T.slew * elapsed, T.slew * elapsed);
    this.lastSenderT = Math.max(senderT, Number.isFinite(this.lastSenderT) ? this.lastSenderT : senderT);
    this.lastRecv = recvT;
  }

  /** Instante (relógio de quem mandou) que o boneco mostra agora. Nunca volta para trás. */
  renderTime(now: number): number {
    if (!this.ready) return -Infinity;
    this.lastRender = Math.max(this.lastRender, now - this.offset - this.delayS);
    return this.lastRender;
  }
}

/** Estado do boneco num instante. */
export interface PoseState {
  p: V3;
  w: V3;
  y: number;
  a: Q4;
  h: PoseSample['h'];
  b: 0 | 1;
  l: 0 | 1;
  i: 0 | 1;
  lt?: number;
  hp?: { pose: Json; t: number };
  ball: BallTransform | null;
  /** O instante caiu num salto (teletransporte): o estado é o da amostra seguinte, sem interpolar. */
  snapped: boolean;
  /** Passou da última amostra: posição extrapolada pela velocidade (no máximo `MaxExtrapolate`). */
  extrapolated: boolean;
}

export const MaxExtrapolate = 0.2;
/** Raiz: salto maior que isto entre amostras (fora o que a velocidade máxima explica) é teletransporte. */
const RootSnapM = 1.5;
const RootMaxSpeed = 9;
const BallMaxSpeed = 20;
const MaxSamples = 40;

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const lerp3 = (a: V3, b: V3, u: number): V3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Menor caminho entre dois ângulos. */
export function lerpAngle(a: number, b: number, u: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * u;
}

/** Hermite cúbica: passa por pa e pb com as velocidades va e vb (curvas e cortes sem o "bico" do linear). */
export function hermite(pa: V3, va: V3, pb: V3, vb: V3, span: number, u: number): V3 {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const out: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) out[k] = h00 * pa[k] + h10 * span * va[k] + h01 * pb[k] + h11 * span * vb[k];
  return out;
}

function nlerpQ(a: Q4, b: Q4, u: number): Q4 {
  const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const q: Q4 = [lerp(a[0], sign * b[0], u), lerp(a[1], sign * b[1], u), lerp(a[2], sign * b[2], u), lerp(a[3], sign * b[3], u)];
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Mistura duas árvores JSON com o mesmo formato (pose da bola presa): números interpolados, o resto de `a`. */
export function lerpJson(a: Json, b: Json, u: number): Json {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, u);
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v, k) => lerpJson(v, b[k], u));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(a)) out[key] = key in b ? lerpJson(a[key], b[key], u) : a[key];
    return out;
  }
  return a;
}

function stateOf(s: PoseSample, extra: Partial<PoseState> = {}): PoseState {
  return {
    p: s.p,
    w: s.w,
    y: s.y,
    a: s.a,
    h: s.h,
    b: s.b,
    l: s.l,
    i: s.i ?? s.b,
    lt: s.lt,
    hp: s.hp,
    ball: s.ball,
    snapped: false,
    extrapolated: false,
    ...extra,
  };
}

function lerpBall(a: BallTransform | null, b: BallTransform | null, gap: number, u: number): BallTransform | null {
  if (!a || !b) return a;
  if (dist(a.p, b.p) > RootSnapM + BallMaxSpeed * Math.max(0, gap - 0.05)) return a;
  return { p: lerp3(a.p, b.p, u), q: nlerpQ(a.q, b.q, u), s: lerp3(a.s, b.s, u) };
}

/** Amostras recebidas, em ordem, e o estado interpolado num instante. */
export class PoseBuffer {
  private readonly samples: PoseSample[] = [];

  get size(): number {
    return this.samples.length;
  }

  latest(): PoseSample | null {
    return this.samples[this.samples.length - 1] ?? null;
  }

  clear(): void {
    this.samples.length = 0;
  }

  /** false se veio fora de ordem ou repetida (fica a que já estava). */
  push(s: PoseSample): boolean {
    const last = this.latest();
    if (last && s.t <= last.t) return false;
    this.samples.push(s);
    if (this.samples.length > MaxSamples) this.samples.shift();
    return true;
  }

  at(t: number): PoseState | null {
    const S = this.samples;
    if (S.length === 0) return null;
    if (t <= S[0].t) return stateOf(S[0]);
    let k = S.length - 1;
    while (k > 0 && S[k].t > t) k--;
    const a = S[k];
    const b = S[k + 1];
    if (!b) {
      const dt = Math.min(t - a.t, MaxExtrapolate);
      const p: V3 = [a.p[0] + a.w[0] * dt, Math.max(Math.min(a.p[1], 0), a.p[1] + a.w[1] * dt), a.p[2] + a.w[2] * dt];
      return stateOf(a, { p, extrapolated: t > a.t });
    }
    const span = b.t - a.t;
    const u = (t - a.t) / span;
    // Teletransporte (bola de saída, reposição): segura a amostra anterior e pula na hora da seguinte.
    if (dist(a.p, b.p) > RootSnapM + RootMaxSpeed * Math.max(0, span - 0.05)) return stateOf(a, { snapped: true });
    // Tangentes limitadas pela corda: numa parada seca a velocidade filtrada ainda é alta e a curva passaria do ponto.
    const reach = 1.5 * dist(a.p, b.p) + 0.02;
    const limit = (w: V3): V3 => {
      const len = Math.hypot(...w) * span;
      return len > reach ? [(w[0] * reach) / len, (w[1] * reach) / len, (w[2] * reach) / len] : w;
    };
    const out = stateOf(a, {
      p: hermite(a.p, limit(a.w), b.p, limit(b.w), span, u),
      w: lerp3(a.w, b.w, u),
      y: lerpAngle(a.y, b.y, u),
      a: [lerp(a.a[0], b.a[0], u), lerp(a.a[1], b.a[1], u), lerp(a.a[2], b.a[2], u), lerp(a.a[3], b.a[3], u)],
      ball: lerpBall(a.ball, b.ball, span, u),
    });
    if (a.lt !== undefined && b.lt !== undefined) out.lt = lerp(a.lt, b.lt, u);
    if (a.hp && b.hp) out.hp = { pose: lerpJson(a.hp.pose, b.hp.pose, u), t: lerp(a.hp.t, b.hp.t, u) };
    return out;
  }
}

/** Comandos de animação esperando a hora deles (o relógio do boneco chegar ao `t` de cada um). */
export class CommandQueue {
  private readonly queue: AnimCommand[] = [];
  static readonly Max = 64;

  get size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue.length = 0;
  }

  push(commands: readonly AnimCommand[]): void {
    for (const c of commands) {
      let k = this.queue.length;
      while (k > 0 && this.queue[k - 1].t > c.t) k--;
      this.queue.splice(k, 0, c);
    }
    if (this.queue.length > CommandQueue.Max) this.queue.splice(0, this.queue.length - CommandQueue.Max);
  }

  /** Tira da fila e devolve, em ordem, os comandos com t <= `t`. */
  due(t: number): AnimCommand[] {
    let n = 0;
    while (n < this.queue.length && this.queue[n].t <= t) n++;
    return this.queue.splice(0, n);
  }
}
