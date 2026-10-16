// Sons sintetizados (sem arquivos), porte das receitas de Source/Garrafao/HoopsAudioSynth.cpp para a WebAudio API.
// Cada som é gerado uma vez num AudioBuffer (algumas variações) e tocado com volume pela intensidade.
//  - Quique: corpo grave 106–145 Hz com queda de afinação (como um bumbo), 2º modo da madeira (2,63x), estalo da
//    borracha (ruído em banda ~650 Hz), clique agudo e o "ping" oco da câmara de ar (~1 kHz).
//  - Rede: ruído em banda descendo de ~5 kHz para ~2,4 kHz. Aro: parciais de anel de aço. Ding do green: Mi + Si.

const Rate = 44100;

function makeNoise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/** Biquad (RBJ) para gerar os buffers offline. */
class Biquad {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type: 'lowpass' | 'highpass' | 'bandpass', freq: number, q: number) {
    const w = (2 * Math.PI * freq) / Rate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    let b0: number, b1: number, b2: number;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else if (type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const decay = (t: number, tau: number): number => (t < 0 ? 0 : Math.exp(-t / tau));
const rise = (t: number, s: number): number => (t <= 0 ? 0 : t >= s ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * t) / s));

function normalize(data: Float32Array, peak: number): Float32Array {
  let max = 1e-9;
  for (const v of data) max = Math.max(max, Math.abs(v));
  for (let i = 0; i < data.length; i++) data[i] *= peak / max;
  return data;
}

const BounceRecipes = [
  { body: 118, tau: 0.034, slap: 650, ring: 960, seed: 11 },
  { body: 132, tau: 0.029, slap: 720, ring: 1010, seed: 23 },
  { body: 106, tau: 0.038, slap: 600, ring: 925, seed: 37 },
  { body: 145, tau: 0.027, slap: 780, ring: 1065, seed: 51 },
];

function renderBounce(r: (typeof BounceRecipes)[number]): Float32Array {
  const n = Math.round(0.16 * Rate);
  const out = new Float32Array(n);
  const noise = makeNoise(r.seed);
  const roomNoise = makeNoise(r.seed * 5 + 7);
  const click = new Biquad('highpass', 2500, 0.7);
  const slap = new Biquad('bandpass', r.slap, 1.0);
  const room = new Biquad('lowpass', 900, 0.7);
  let bodyPhase = 0;
  let woodPhase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / Rate;
    bodyPhase += (2 * Math.PI * r.body * (1 + 0.7 * decay(t, 0.01))) / Rate;
    woodPhase += (2 * Math.PI * r.body * 2.63 * (1 + 0.35 * decay(t, 0.008))) / Rate;
    const body = Math.sin(bodyPhase) * decay(t, r.tau) + 0.6 * Math.sin(woodPhase) * decay(t, r.tau * 0.5);
    const white = noise();
    const c = click.process(white) * decay(t, 0.0012);
    const s = slap.process(white) * decay(t, 0.012);
    const ring = Math.sin(2 * Math.PI * r.ring * t) * decay(t, 0.045) * (1 - decay(t, 0.002));
    const rm = room.process(roomNoise()) * rise(t - 0.008, 0.01) * decay(t - 0.008, 0.05);
    out[i] = rise(t, 0.0015) * body + 0.6 * c + 4 * s + 0.22 * ring + 0.12 * rm;
  }
  return normalize(out, 0.88);
}

function renderSwish(seed: number): Float32Array {
  const n = Math.round(0.55 * Rate);
  const out = new Float32Array(n);
  const noise = makeNoise(seed);
  let filter = new Biquad('bandpass', 5000, 0.9);
  const tail = new Biquad('lowpass', 1700, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / Rate;
    if (i % 256 === 0) filter = new Biquad('bandpass', 2400 + 2600 * decay(t, 0.07), 0.9);
    const w = noise();
    out[i] = filter.process(w) * rise(t, 0.01) * decay(t, 0.09) + 0.5 * tail.process(w) * decay(t, 0.25) * rise(t, 0.03);
  }
  return normalize(out, 0.6);
}

function renderRim(seed: number): Float32Array {
  const n = Math.round(0.5 * Rate);
  const out = new Float32Array(n);
  const noise = makeNoise(seed);
  const partials = [
    [520, 0.3],
    [1370, 0.18],
    [2230, 0.12],
    [3150, 0.09],
    [4480, 0.065],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / Rate;
    let v = 0;
    for (const [f, tau] of partials) v += (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 1.004 * t)) * decay(t, tau);
    v += 2 * noise() * decay(t, 0.004) + 1.5 * Math.sin(2 * Math.PI * 165 * t) * decay(t, 0.04);
    out[i] = v * rise(t, 0.001);
  }
  return normalize(out, 0.5);
}

/**
 * Tapa da mão na bola (toco e roubo): estalo de pele (ruído em banda ~1,6–2,4 kHz, ~10 ms) mais o baque oco da bola
 * (corpo grave ~150 Hz e o "ping" da câmara de ar), mais curto que o quique. `heavy` = o toco (mais corpo e mais forte).
 */
function renderSlap(seed: number, heavy: boolean): Float32Array {
  const n = Math.round(0.22 * Rate);
  const out = new Float32Array(n);
  const noise = makeNoise(seed);
  const skin = new Biquad('bandpass', heavy ? 1600 : 2300, 1.1);
  const crack = new Biquad('highpass', 3200, 0.7);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / Rate;
    phase += (2 * Math.PI * (heavy ? 150 : 175) * (1 + 0.6 * decay(t, 0.006))) / Rate;
    const w = noise();
    const slap = skin.process(w) * decay(t, heavy ? 0.011 : 0.007);
    const c = crack.process(w) * decay(t, 0.0015);
    const body = Math.sin(phase) * decay(t, heavy ? 0.03 : 0.018) * rise(t - 0.002, 0.002);
    const ping = Math.sin(2 * Math.PI * 990 * t) * decay(t, 0.03) * (1 - decay(t, 0.003));
    out[i] = 5 * slap + 0.8 * c + (heavy ? 0.9 : 0.5) * body + 0.15 * ping;
  }
  return normalize(out, heavy ? 0.95 : 0.7);
}

function renderDing(): Float32Array {
  const n = Math.round(0.7 * Rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / Rate;
    out[i] = (Math.sin(2 * Math.PI * 1318.5 * t) + 0.7 * Math.sin(2 * Math.PI * 1975.5 * t)) * decay(t, 0.22) * rise(t, 0.004);
  }
  return normalize(out, 0.45);
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private buffers: Record<string, AudioBuffer[]> = {};
  volume = 0.8;

  /** O navegador só libera o áudio depois de um gesto do jogador (tecla, clique ou botão do controle). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const make = (data: Float32Array): AudioBuffer => {
      const buffer = this.ctx!.createBuffer(1, data.length, Rate);
      buffer.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      return buffer;
    };
    this.buffers.bounce = BounceRecipes.map((r) => make(renderBounce(r)));
    this.buffers.swish = [make(renderSwish(101)), make(renderSwish(211))];
    this.buffers.rim = [make(renderRim(5)), make(renderRim(9))];
    this.buffers.ding = [make(renderDing())];
    this.buffers.block = [make(renderSlap(301, true)), make(renderSlap(457, true))];
    this.buffers.slap = [make(renderSlap(613, false)), make(renderSlap(829, false))];
  }

  private play(name: string, gain: number, rate = 1): void {
    const ctx = this.ctx;
    const list = this.buffers[name];
    if (!ctx || !list || ctx.state !== 'running') return;
    const source = ctx.createBufferSource();
    source.buffer = list[Math.floor(Math.random() * list.length)];
    source.playbackRate.value = rate * (0.97 + Math.random() * 0.06);
    const g = ctx.createGain();
    g.gain.value = gain * this.volume;
    source.connect(g).connect(ctx.destination);
    source.start();
  }

  /** speed = velocidade de chegada no chão (m/s). */
  bounce(speed: number): void {
    this.play('bounce', Math.min(1, 0.25 + speed / 9));
  }
  swish(): void {
    this.play('swish', 0.9);
  }
  rim(): void {
    this.play('rim', 0.6);
  }
  ding(): void {
    this.play('ding', 0.8);
  }
  /** Toco: a mão bate na bola. */
  block(): void {
    this.play('block', 1);
  }
  /** Tapa do roubo que pega na bola. */
  slap(): void {
    this.play('slap', 0.8);
  }
}
