// Formas de arremesso (puro, sem three.js): cada jogador de referência tem uma BASE (corpo de baixo: dip, salto, deriva,
// pernas, giro do corpo) e uma RELEASE (corpo de cima: caminho da bola, set point, soltura, cotovelo, mão de apoio,
// follow-through), como no Jump Shot Creator do 2K. O animador (src/anim/JumpShotMotion.ts) desenha o corpo a partir
// delas; o criador mistura duas releases (blend) sobre uma base.
//
// Referencial do corpo: x = para o lado da mão do arremesso (m), y = altura a partir do chão em fração da altura do
// jogador (de pé, sem o salto), z = à frente (m). Os números vêm da análise de vídeo (Curry, docs/22-arremessos.md) e da
// pesquisa de forma de cada jogador; os de quem não tem vídeo medido são estimativas, marcadas lá.

export type V3 = [number, number, number];

/** Corpo de baixo (Base do 2K). */
export interface ShotBase {
  /** Quanto a pelve desce no dip (fração da altura). */
  dip: number;
  /** Onde fica o fundo do dip, em fração do tempo até a decolagem. */
  dipAt: number;
  /** Altura do salto (m, subida da pelve no ápice). */
  jump: number;
  /** Soltura no salto: 0 = na decolagem, 1 = no ápice, > 1 = já descendo. */
  releaseInJump: number;
  /** Deslocamento à frente no pouso (m); negativo = fade para trás. */
  drift: number;
  /** Chute das pernas no ar (0..1): pés para trás e abertos. */
  kick: number;
  /** Joelho da perna de fora sobe à frente no ar (0..1; o fadeaway de uma perna do Dirk = 1). */
  oneLeg: number;
  /** Distância entre os pés (m). */
  stance: number;
  /** Pé do lado da mão à frente do outro (m). */
  stagger: number;
  /** Corpo girado para o lado da mão de apoio (graus): o ombro da mão do arremesso vai à frente. */
  turn: number;
  /** Inclinação do tronco (graus, + = à frente) no dip e na soltura (negativo = para trás, fade). */
  leanDip: number;
  leanRelease: number;
  /** Tronco tomba para o lado da mão de apoio na soltura (graus): o ombro do arremesso sobe (Dirk, Kobe). */
  sway: number;
  /** Parada no pull-up: 0 = passada 1-2 (um pé e depois o outro), 1 = hop (os dois pés juntos). */
  pullHop: number;
}

/** Corpo de cima (Release 1/2 do 2K). */
export interface ShotRelease {
  /** Bola no fundo do dip (o "bolso"). */
  pocket: V3;
  /** Set point: onde a bola passa (ou para, no arremesso em dois tempos) antes do empurrão. */
  setPoint: V3;
  /** Bola na soltura (de pé; o salto soma por cima). */
  release: V3;
  /** Quando a bola chega ao set point, em fração do tempo até a soltura. */
  setAt: number;
  /** Quanto ela fica parada no set point, em fração do tempo até a soltura (0 = um tempo só). */
  setHold: number;
  /** Cotovelo aberto para fora (0 = embaixo da bola, 1 = bem aberto). */
  elbowFlare: number;
  /** s antes da soltura em que a mão de apoio sai da bola. */
  guideOff: number;
  /** Punho dobrado para trás no set point (graus). */
  wristCock: number;
  /** s que o follow-through fica parado no alto. */
  followHold: number;
  /** Altura do braço no follow-through (1 = esticado no alto; 0 = desce logo). */
  followHigh: number;
  /** Mão de apoio depois da soltura: 1 = fica no alto, aberta, até o pouso (Curry); 0 = desce logo para o lado. */
  guideFollow: number;
}

export interface ShotSignature {
  label: string;
  /** Uma linha do que torna o arremesso reconhecível (aparece no criador). */
  traits: string;
  base: ShotBase;
  release: ShotRelease;
}

/** Jogadores de referência, na ordem do criador. */
export const ShotSignatureIds = ['Curry', 'Klay', 'RayAllen', 'Durant', 'Kobe', 'Booker', 'Dirk', 'Oscar', 'Bird'] as const;
export type ShotSignatureId = (typeof ShotSignatureIds)[number];

// Cada jogador tem 2 ou 3 traços que se veem de longe (o resto é parecido em todo arremesso bom). Os números exageram
// esses traços de propósito: com todos perto da média, os arremessos ficavam iguais na tela.
export const ShotSignatures: Record<ShotSignatureId, ShotSignature> = {
  // Curry (medido quadro a quadro em duas tomadas em câmera lenta, docs/22-arremessos.md): um tempo só. Bolso no peito
  // com os cotovelos fechados; a bola sobe cruzando a frente do rosto e passa pela testa já na decolagem; o braço estica
  // quase reto para cima e à frente e solta perto do ápice. Canelas dobram para trás no ar, pouso um pouco à frente; no
  // follow-through as duas mãos ficam no alto e o punho estalado.
  Curry: {
    label: 'Stephen Curry',
    traits: 'Um tempo só, bola cruzando a frente do rosto, soltura alta perto do ápice, as duas mãos no alto no fim',
    base: { dip: 0.05, dipAt: 0.5, jump: 0.13, releaseInJump: 0.9, drift: 0.14, kick: 0.4, oneLeg: 0, stance: 0.34, stagger: 0.07, turn: 15, leanDip: 12, leanRelease: 0, sway: 3, pullHop: 0 },
    release: {
      pocket: [0.07, 0.65, 0.25],
      setPoint: [0.1, 1.0, 0.2],
      release: [0.1, 1.22, 0.3],
      setAt: 0.6,
      setHold: 0,
      elbowFlare: 0.15,
      guideOff: 0.04,
      wristCock: 75,
      followHold: 0.45,
      followHigh: 0.9,
      guideFollow: 1,
    },
  },
  // Klay: catch-and-shoot compacto e rápido, set point no queixo/testa sem parar, cotovelo colado, salto baixo e quase sem
  // deriva; chega na bola com um hop curto. A mão de apoio sai limpa e desce logo.
  Klay: {
    label: 'Klay Thompson',
    traits: 'Compacto e reto, cotovelo colado, salto baixo, quase sem deriva',
    base: { dip: 0.05, dipAt: 0.5, jump: 0.09, releaseInJump: 0.85, drift: 0.03, kick: 0.05, oneLeg: 0, stance: 0.37, stagger: 0.04, turn: 6, leanDip: 10, leanRelease: 1, sway: 0, pullHop: 0.7 },
    release: {
      pocket: [0.06, 0.62, 0.24],
      setPoint: [0.08, 0.95, 0.2],
      release: [0.08, 1.15, 0.28],
      setAt: 0.76,
      setHold: 0,
      elbowFlare: 0,
      guideOff: 0.03,
      wristCock: 80,
      followHold: 0.6,
      followHigh: 1,
      guideFollow: 0.35,
    },
  },
  // Ray Allen: pernas quase retas (dip raso), set point alto acima do olho com uma pausa curta, soltura no ápice,
  // follow-through longo e parado.
  RayAllen: {
    label: 'Ray Allen',
    traits: 'Pernas quase retas, set point alto, soltura no ápice, follow-through longo e parado',
    base: { dip: 0.035, dipAt: 0.5, jump: 0.15, releaseInJump: 1, drift: 0.02, kick: 0, oneLeg: 0, stance: 0.32, stagger: 0.04, turn: 5, leanDip: 7, leanRelease: 0, sway: 0, pullHop: 0 },
    release: {
      pocket: [0.06, 0.66, 0.24],
      setPoint: [0.09, 1.08, 0.12],
      release: [0.08, 1.22, 0.24],
      setAt: 0.66,
      setHold: 0.06,
      elbowFlare: 0.02,
      guideOff: 0.03,
      wristCock: 80,
      followHold: 0.75,
      followHigh: 1,
      guideFollow: 0.7,
    },
  },
  // Durant: braços longos, soltura muito alta no ápice, cotovelo aberto, salto alto.
  Durant: {
    label: 'Kevin Durant',
    traits: 'Soltura altíssima no ápice, cotovelo aberto, salto alto',
    base: { dip: 0.06, dipAt: 0.5, jump: 0.2, releaseInJump: 1, drift: 0.08, kick: 0.25, oneLeg: 0, stance: 0.36, stagger: 0.06, turn: 10, leanDip: 14, leanRelease: -2, sway: 2, pullHop: 0.3 },
    release: {
      pocket: [0.08, 0.64, 0.27],
      setPoint: [0.13, 1.1, 0.14],
      release: [0.12, 1.27, 0.26],
      setAt: 0.68,
      setHold: 0.03,
      elbowFlare: 0.35,
      guideOff: 0.05,
      wristCock: 70,
      followHold: 0.4,
      followHigh: 0.95,
      guideFollow: 0.6,
    },
  },
  // Kobe: dip fundo e cedo, salto muito alto e fade para trás com as pernas chutando e o tronco tombando; parada seca de
  // 1-2 no pull-up. A mão de apoio sai e desce logo.
  Kobe: {
    label: 'Kobe Bryant',
    traits: 'Dip fundo, salto muito alto e fade para trás com as pernas chutando',
    base: { dip: 0.08, dipAt: 0.42, jump: 0.26, releaseInJump: 1, drift: -0.32, kick: 0.7, oneLeg: 0, stance: 0.38, stagger: 0.06, turn: 18, leanDip: 17, leanRelease: -11, sway: 6, pullHop: 0.2 },
    release: {
      pocket: [0.07, 0.6, 0.27],
      setPoint: [0.1, 1.03, 0.1],
      release: [0.09, 1.19, 0.22],
      setAt: 0.72,
      setHold: 0.03,
      elbowFlare: 0.12,
      guideOff: 0.02,
      wristCock: 75,
      followHold: 0.55,
      followHigh: 1,
      guideFollow: 0.25,
    },
  },
  // Devin Booker: pull-up de meia distância. Para com um hop (os dois pés juntos), sobe reto e alto, solta no ápice com
  // um fade curto e pousa quase no lugar.
  Booker: {
    label: 'Devin Booker',
    traits: 'Para com um hop, sobe reto e alto e solta no ápice com um fade curto',
    base: { dip: 0.065, dipAt: 0.5, jump: 0.21, releaseInJump: 1, drift: -0.07, kick: 0.3, oneLeg: 0, stance: 0.35, stagger: 0.05, turn: 12, leanDip: 13, leanRelease: -4, sway: 2, pullHop: 1 },
    release: {
      pocket: [0.06, 0.63, 0.26],
      setPoint: [0.09, 1.05, 0.15],
      release: [0.08, 1.21, 0.26],
      setAt: 0.64,
      setHold: 0.02,
      elbowFlare: 0.08,
      guideOff: 0.03,
      wristCock: 80,
      followHold: 0.5,
      followHigh: 1,
      guideFollow: 0.5,
    },
  },
  // Dirk: fadeaway de uma perna, joelho da perna de fora à frente, tronco tombando para longe, bola alta na frente do rosto.
  Dirk: {
    label: 'Dirk Nowitzki',
    traits: 'Fadeaway de uma perna, joelho à frente, bola alta e difícil de tocar',
    base: { dip: 0.05, dipAt: 0.5, jump: 0.14, releaseInJump: 1.05, drift: -0.32, kick: 0, oneLeg: 1, stance: 0.34, stagger: 0.1, turn: 22, leanDip: 10, leanRelease: -14, sway: 10, pullHop: 0 },
    release: {
      pocket: [0.05, 0.66, 0.25],
      setPoint: [0.07, 1.08, 0.12],
      release: [0.06, 1.22, 0.22],
      setAt: 0.68,
      setHold: 0.06,
      elbowFlare: 0.1,
      guideOff: 0.03,
      wristCock: 70,
      followHold: 0.5,
      followHigh: 1,
      guideFollow: 0.8,
    },
  },
  // Oscar Robertson (como a release dele no 2K): bola acima e atrás da testa, soltura bem alta, em dois tempos.
  Oscar: {
    label: 'Oscar Robertson',
    traits: 'Bola acima da cabeça, soltura bem alta, em dois tempos (difícil de tocar)',
    base: { dip: 0.065, dipAt: 0.45, jump: 0.15, releaseInJump: 1, drift: 0, kick: 0.15, oneLeg: 0, stance: 0.35, stagger: 0.05, turn: 6, leanDip: 12, leanRelease: 0, sway: 0, pullHop: 0.5 },
    release: {
      pocket: [0.06, 0.64, 0.25],
      setPoint: [0.12, 1.14, 0.06],
      release: [0.1, 1.25, 0.22],
      setAt: 0.56,
      setHold: 0.16,
      elbowFlare: 0.2,
      guideOff: 0.06,
      wristCock: 85,
      followHold: 0.5,
      followHigh: 1,
      guideFollow: 0.5,
    },
  },
  // Larry Bird: set point baixo e lento, quase sem salto, cotovelo bem aberto, braço desce cedo (estimativa, sem vídeo).
  Bird: {
    label: 'Larry Bird',
    traits: 'Set point baixo e lento, quase sem salto, cotovelo aberto',
    base: { dip: 0.06, dipAt: 0.5, jump: 0.04, releaseInJump: 1, drift: 0.02, kick: 0, oneLeg: 0, stance: 0.36, stagger: 0.04, turn: 6, leanDip: 13, leanRelease: 3, sway: 0, pullHop: 0 },
    release: {
      pocket: [0.05, 0.62, 0.25],
      setPoint: [0.13, 0.86, 0.24],
      release: [0.13, 1.1, 0.32],
      setAt: 0.6,
      setHold: 0.14,
      elbowFlare: 0.55,
      guideOff: 0.03,
      wristCock: 65,
      followHold: 0.4,
      followHigh: 0.75,
      guideFollow: 0.2,
    },
  },
};

const lerp = (a: number, b: number, w: number): number => a + (b - a) * w;
const lerp3 = (a: V3, b: V3, w: number): V3 => [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)];

/** Mistura de duas releases (blend do criador: w = peso da segunda). */
export function blendRelease(a: ShotRelease, b: ShotRelease, w: number): ShotRelease {
  const k = Math.min(1, Math.max(0, w));
  const out = {} as ShotRelease;
  for (const key of Object.keys(a) as (keyof ShotRelease)[]) {
    const va = a[key];
    const vb = b[key];
    (out as unknown as Record<string, unknown>)[key] = Array.isArray(va) ? lerp3(va as V3, vb as V3, k) : lerp(va as number, vb as number, k);
  }
  return out;
}

/** Forma pronta para tocar: a base e a release já misturada. */
export interface ShotForm {
  base: ShotBase;
  release: ShotRelease;
  /** Embalo do pull-up (0 = parado/spot-up, 1 = vindo em sprint): passada de parada, freio do tronco, subida mais alta. */
  momentum?: number;
}

export function shotFormOf(base: ShotSignatureId, release1: ShotSignatureId, release2: ShotSignatureId, blend2: number): ShotForm {
  return {
    base: ShotSignatures[base].base,
    release: blendRelease(ShotSignatures[release1].release, ShotSignatures[release2].release, blend2),
  };
}

/** Velocidades de entrada (m/s) em que o pull-up começa e fica inteiro (trote 3,9, sprint 6,2 no Freestyle). */
export const PullUpMinSpeed = 1.5;
export const PullUpFullSpeed = 5;

/** Embalo do pull-up (0..1) pela velocidade com que o jogador chega ao arremesso. */
export function pullUpMomentum(entrySpeed: number): number {
  return Math.min(1, Math.max(0, (entrySpeed - PullUpMinSpeed) / (PullUpFullSpeed - PullUpMinSpeed)));
}

/**
 * Pull-up jump shot (Kobe, Booker): o jogador vem correndo, freia em 1-2 passos (ou num hop) e "se joga" para cima. Sobre
 * a base do criador: o dip vem mais tarde (na segunda passada, que freia) e mais fundo, o embalo vira altura (salto mais
 * alto, soltura no ápice), as pernas chutam mais e o fade da base encolhe (o corpo ainda vai à frente).
 */
export function pullUpForm(form: ShotForm, momentum: number): ShotForm {
  const m = Math.min(1, Math.max(0, momentum));
  if (m <= 0) return form;
  const b = form.base;
  return {
    release: form.release,
    momentum: m,
    base: {
      ...b,
      dip: b.dip * (1 + 0.45 * m),
      dipAt: lerp(b.dipAt, 0.7, m),
      jump: Math.min(0.32, b.jump * (1 + 0.4 * m) + 0.03 * m),
      releaseInJump: lerp(b.releaseInJump, Math.max(1, b.releaseInJump), m),
      drift: b.drift * (1 - 0.4 * m),
      kick: Math.min(1, b.kick + 0.3 * m),
      leanDip: b.leanDip + 3 * m,
    },
  };
}

// ------------------------------------------------------------------------------------------------- cronograma

export const Gravity = 9.81;
/** Quanto a pelve sobe com o pé na ponta, na decolagem (m). */
export const ToePush = 0.03;

/** Instantes (s desde o começo do arremesso) de cada fase. */
export interface ShotSchedule {
  dipAt: number;
  takeoffAt: number;
  setAt: number;
  setEnd: number;
  releaseAt: number;
  apexAt: number;
  landAt: number;
  followEnd: number;
  endAt: number;
  /** s da decolagem ao ápice. */
  rise: number;
  /** Altura do salto usada (m): pode encolher quando a soltura é muito rápida para o salto inteiro. */
  jump: number;
}

/**
 * Cronograma para uma soltura em `releaseS` (tempo ideal do modelo, o centro do green). A soltura cai no ponto do salto
 * da base (subindo, no ápice ou descendo); o dip e o set point se ajustam em volta dela.
 */
export function shotSchedule(form: ShotForm, releaseS: number): ShotSchedule {
  const { base, release } = form;
  const R = Math.max(0.2, releaseS);
  let jump = Math.max(0.02, base.jump);
  let rise = Math.sqrt((2 * jump) / Gravity);
  // A decolagem não pode vir antes de ~45% do tempo (sem tempo para o dip): o salto encolhe para caber.
  const minTakeoff = 0.45 * R;
  if (R - base.releaseInJump * rise < minTakeoff) {
    rise = (R - minTakeoff) / Math.max(0.3, base.releaseInJump);
    jump = (Gravity * rise * rise) / 2;
  }
  const takeoffAt = R - base.releaseInJump * rise;
  const setAt = Math.min(R - 0.05, release.setAt * R);
  const setEnd = Math.min(R - 0.04, setAt + release.setHold * R);
  const apexAt = takeoffAt + rise;
  const landAt = takeoffAt + 2 * rise;
  const followEnd = R + release.followHold;
  return {
    dipAt: takeoffAt * base.dipAt,
    takeoffAt,
    setAt,
    setEnd,
    releaseAt: R,
    apexAt,
    landAt,
    followEnd,
    endAt: Math.max(landAt + 0.32, followEnd + 0.3),
    rise,
    jump,
  };
}

const smooth01 = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const span = (a: number, b: number, t: number): number => smooth01((t - a) / Math.max(1e-6, b - a));

/** Velocidade vertical da pelve na decolagem (m/s): a do voo balístico até o ápice. */
export const takeoffSpeed = (s: ShotSchedule): number => Gravity * s.rise;

/**
 * Altura da pelve em relação a de pé (m) no instante t: desce no dip, estica até a ponta do pé na decolagem, voo
 * balístico, absorve no pouso e volta. `heightM` = altura do jogador.
 *
 * Sem trancos de velocidade: a extensão chega à decolagem já subindo na velocidade do voo (antes ela parava na ponta do
 * pé e saía a ~1,6 m/s no quadro seguinte) e o pouso entra numa mola criticamente amortecida com a velocidade da queda
 * (antes a pelve parava seco no chão e só depois afundava).
 */
export function pelvisLift(form: ShotForm, s: ShotSchedule, t: number, heightM: number): number {
  const dip = form.base.dip * heightM;
  const v = takeoffSpeed(s);
  if (t < s.takeoffAt) {
    if (t < s.dipAt) return -dip * span(0, s.dipAt, t);
    // Hermite do fundo do dip (parado) até a ponta do pé (na velocidade do voo). Tangente limitada a 3x a corda: acima
    // disso a curva desceria antes de subir.
    const T = Math.max(1e-6, s.takeoffAt - s.dipAt);
    const rise = ToePush + dip;
    const u = Math.min(1, Math.max(0, (t - s.dipAt) / T));
    const m1 = Math.min(v * T, 3 * rise);
    return -dip + rise * (3 * u * u - 2 * u * u * u) + m1 * (u * u * u - u * u);
  }
  if (t < s.landAt) {
    const tau = t - s.takeoffAt;
    return ToePush + v * tau - (Gravity * tau * tau) / 2;
  }
  return landingSpring(ToePush, -v, landingOmega(dip, v), t - s.landAt);
}

/** Rigidez da absorção do pouso: afunda ~60% do dip (mais salto, mais fundo, até o limite da mola). */
function landingOmega(dip: number, v: number): number {
  const depth = Math.max(0.02, 0.6 * dip);
  return Math.min(26, Math.max(8, v / (Math.E * depth)));
}

/** Mola criticamente amortecida de y0 (velocidade v0) até 0. */
function landingSpring(y0: number, v0: number, w: number, tau: number): number {
  return (y0 + (v0 + w * y0) * tau) * Math.exp(-w * tau);
}

/** Fração do voo (0 no chão, 1 no ápice), para os pés e o chute. */
export function airShape(s: ShotSchedule, t: number): number {
  if (t <= s.takeoffAt || t >= s.landAt) return 0;
  const u = (t - s.takeoffAt) / (s.landAt - s.takeoffAt);
  return Math.sin(Math.PI * u);
}

/** s do empurrão (antes da decolagem) e da freada (depois do pouso) da deriva. */
const DriftPushS = 0.1;
const DriftBrakeS = 0.14;

/**
 * Deslocamento à frente (m) da deriva. No ar a velocidade é constante (balística: antes ela acelerava e freava no meio do
 * voo); ela entra no empurrão antes da decolagem e sai na freada depois do pouso.
 */
export function driftAt(form: ShotForm, s: ShotSchedule, t: number): number {
  const D = form.base.drift;
  if (D === 0) return 0;
  const P = Math.min(DriftPushS, s.takeoffAt);
  const F = s.landAt - s.takeoffAt;
  const L = DriftBrakeS;
  const V = D / (P / 2 + F + L / 2);
  const t0 = s.takeoffAt - P;
  if (t <= t0) return 0;
  if (t < s.takeoffAt) {
    const tau = t - t0;
    return (V * tau * tau) / (2 * Math.max(1e-6, P));
  }
  if (t < s.landAt) return V * (P / 2 + (t - s.takeoffAt));
  const tau = Math.min(L, t - s.landAt);
  return V * (P / 2 + F + tau - (tau * tau) / (2 * L));
}

/** Caminho da bola (referencial do corpo, sem o salto): chaves [t, ponto] a partir de onde ela estava. */
export function ballKeys(form: ShotForm, s: ShotSchedule, start: V3, heightM: number): [number, V3][] {
  const r = form.release;
  const H = (p: V3): V3 => [p[0], p[1] * heightM, p[2]];
  const set = H(r.setPoint);
  const keys: [number, V3][] = [[0, start], [Math.max(0.06, s.dipAt), H(r.pocket)], [s.setAt, set]];
  if (s.setEnd > s.setAt + 0.02) keys.push([s.setEnd, [set[0], set[1] + 0.02, set[2] - 0.01]]);
  keys.push([s.releaseAt, H(r.release)]);
  return keys;
}

/** A bola acelera até a soltura: a velocidade nela é esta fração a mais que a média do último trecho. */
const ReleaseAccel = 1.5;
/** Trecho mais curto que isto (m) é uma parada (set point do arremesso em dois tempos): a bola quase não anda nele. */
const HoldSpan = 0.04;

/** Tangentes (m/s) de cada chave: Catmull-Rom pelo tempo, parada nas pontas de um trecho de pausa, empurrão no fim. */
function ballTangents(keys: ReadonlyArray<readonly [number, V3]>): V3[] {
  const n = keys.length;
  const secant = (i: number): V3 => {
    const [ta, pa] = keys[i];
    const [tb, pb] = keys[i + 1];
    const d = Math.max(1e-6, tb - ta);
    return [(pb[0] - pa[0]) / d, (pb[1] - pa[1]) / d, (pb[2] - pa[2]) / d];
  };
  const dist = (i: number): number => {
    const a = keys[i][1];
    const b = keys[i + 1][1];
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  };
  const m: V3[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) m.push([0, 0, 0]);
    else if (i === n - 1) {
      const sc = secant(i - 1);
      m.push([sc[0] * ReleaseAccel, sc[1] * ReleaseAccel, sc[2] * ReleaseAccel]);
    } else {
      const [ta, pa] = keys[i - 1];
      const [tb, pb] = keys[i + 1];
      const d = Math.max(1e-6, tb - ta);
      m.push([(pb[0] - pa[0]) / d, (pb[1] - pa[1]) / d, (pb[2] - pa[2]) / d]);
    }
  }
  // Pausa: as duas pontas do trecho curto andam na velocidade dele (sem passar do ponto e voltar).
  for (let i = 0; i + 1 < n; i++) {
    if (dist(i) >= HoldSpan) continue;
    const sc = secant(i);
    if (i > 0) m[i] = sc;
    if (i + 1 < n - 1) m[i + 1] = sc;
  }
  return m;
}

/**
 * Bola no caminho (referencial do corpo) no instante t, e a velocidade dela (m/s) em `vel`. Hermite com tangentes pelo
 * tempo: a velocidade é contínua nas chaves (o Catmull-Rom uniforme dava trancos com as chaves em tempos desiguais e
 * freava a bola antes da soltura).
 */
export function ballAt(keys: ReadonlyArray<readonly [number, V3]>, t: number, vel?: V3): V3 {
  const n = keys.length;
  const m = ballTangents(keys);
  if (t <= keys[0][0] || n === 1) {
    if (vel) vel.splice(0, 3, 0, 0, 0);
    return [...keys[0][1]];
  }
  if (t >= keys[n - 1][0]) {
    if (vel) vel.splice(0, 3, ...m[n - 1]);
    return [...keys[n - 1][1]];
  }
  let i = 0;
  while (i < n - 2 && t > keys[i + 1][0]) i++;
  const [ta, pa] = keys[i];
  const [tb, pb] = keys[i + 1];
  const h = Math.max(1e-6, tb - ta);
  const u = (t - ta) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const out: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] = h00 * pa[k] + h10 * h * m[i][k] + h01 * pb[k] + h11 * h * m[i + 1][k];
    if (vel) {
      const d00 = 6 * u2 - 6 * u;
      const d10 = 3 * u2 - 4 * u + 1;
      const d01 = -6 * u2 + 6 * u;
      const d11 = 3 * u2 - 2 * u;
      vel[k] = (d00 * pa[k] + d01 * pb[k]) / h + d10 * m[i][k] + d11 * m[i + 1][k];
    }
  }
  return out;
}

/** max(0, x) sem quina (a bola sobe com o salto sem tranco quando a pelve passa da altura de pé): parábola em |x| < w. */
export function softLift(x: number, w = 0.03): number {
  if (x <= -w) return 0;
  if (x >= w) return x;
  return ((x + w) * (x + w)) / (4 * w);
}
