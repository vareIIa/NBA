// Dados dos clipes do jogador: o que o Blender mediu (public/assets/hoops_player.clips.json, gerado por
// Tools/Animacao/exportar_glb.py) + os quadros-chave calibrados na sessão da Unreal (Source/Garrafao/HoopsDummyRig.h).
// Puro (sem three.js): testável no vitest.

export const ClipFps = 60;

export type Hand = 'r' | 'l';
export const otherSide = (hand: Hand): Hand => (hand === 'r' ? 'l' : 'r');

/** Posição [x, y, z] no espaço do modelo (glTF: Y para cima, frente +Z, mão direita em -X), antes da escala. */
export type ModelPoint = [number, number, number];

export interface ClipInfo {
  frames: number;
  duration: number;
  palm_r: ModelPoint[];
  palm_l: ModelPoint[];
  ball_r: ModelPoint[];
  ball_l: ModelPoint[];
  pelvis: ModelPoint[];
  valleys_r: number[];
  peaks_r: number[];
  valleys_l: number[];
  peaks_l: number[];
}

export interface ClipsFile {
  fps: number;
  source: string;
  clips: Record<string, ClipInfo>;
}

/** Loops de drible: velocidade nativa no referencial do jogador (m/s; x = direita, y = frente), no sujeito da CMU. */
export const LoopNativeVelocity: Record<string, { right: number; forward: number }> = {
  Dribble_Idle: { right: 0, forward: 0 },
  Dribble_Low: { right: 0, forward: 0 },
  Dribble_Walk: { right: 0, forward: 1.37 },
  Dribble_Run: { right: 0, forward: 4.14 },
  Dribble_Back: { right: 0, forward: -1.19 },
  // Dribble_Side_R anda para a ESQUERDA do jogador; o _L (espelho) para a direita.
  Dribble_Side_R: { right: -1.23, forward: 0 },
  Dribble_Side_L: { right: 1.23, forward: 0 },
};

/**
 * Quadros-chave (s) de uma ação de drible: a mão de origem solta em release e a outra (ou a mesma) recebe em catch.
 * Nos procedurais (behind the back, step-back), release e catch são frações (0..1) da duração do movimento e o clipe
 * só dá o tronco; mãos, pés e bola vêm de src/anim/ProceduralMoves.ts.
 */
export interface MoveTiming {
  clip: string; // nome com a mão de origem (R2L / _R); o espelho troca R<->L
  start: number;
  release: number;
  catch: number;
  end: number;
  switchesHand: boolean;
  procedural?: 'BehindBack' | 'StepBack';
  /** Giro da malha em volta do eixo vertical (graus): spin = 360, half spin = vai e volta até ~150. */
  turnDeg?: number;
  turnBack?: boolean;
}

const f = (frame: number): number => frame / ClipFps;

/** Ações de drible (HoopsDummyRig.h + procedurais). Os nomes estão na versão "bola na direita". */
export const MoveTimings = {
  Cross: { clip: 'Cross_R2L', start: f(7), release: f(9), catch: f(30), end: f(50), switchesHand: true },
  EscapeCross: { clip: 'EscapeCross_R2L', start: f(6), release: f(16), catch: f(30), end: f(42), switchesHand: true },
  Spin: { clip: 'Spin_R2L', start: f(6), release: f(16), catch: f(43), end: f(68), switchesHand: true, turnDeg: 360 },
  // Half spin: começa o spin, fica de costas e volta (o giro vai a ~150° e retorna); a bola troca de mão.
  HalfSpin: {
    clip: 'Spin_R2L',
    start: f(6),
    release: f(16),
    catch: f(43),
    end: f(60),
    switchesHand: true,
    turnDeg: 150,
    turnBack: true,
  },
  BetweenLegs: { clip: 'BetweenLegs_R2L', start: f(12), release: f(23), catch: f(40), end: f(48), switchesHand: true },
  // Hesitação: empurrão ~26 com a mesma mão; a recepção cai já no loop seguinte.
  Hesitation: { clip: 'Hesitation_R', start: f(5), release: f(26), catch: f(40), end: f(34), switchesHand: false },
  // Procedurais: o tronco vem do clipe (esticado na duração), o resto do ProceduralMoves.
  // Behind the back: no jogo real o corpo planta baixo e sai num passo largo para o lado novo enquanto a bola enrola
  // por trás (referências: Coach Frikki, "Behind The Back Dribble SECRETS"); o tronco do escape crossover (102_14) tem
  // essa mecânica. A bola e as mãos vêm do ProceduralMoves.
  BehindBack: {
    clip: 'EscapeCross_R2L',
    start: f(4),
    release: 0.5,
    catch: 0.92,
    end: f(42),
    switchesHand: true,
    procedural: 'BehindBack',
  },
  // Tronco do step-back: o começo do jump shot (pegada e dip atléticos), que já deixa o corpo pronto para o arremesso.
  StepBack: {
    clip: 'JumpShot2_R',
    start: f(0),
    release: 0.14,
    catch: 0.9,
    end: f(18),
    switchesHand: false,
    procedural: 'StepBack',
  },
} as const satisfies Record<string, MoveTiming>;

export type MoveKind = keyof typeof MoveTimings;

/** Nome do clipe para a mão da bola no início do movimento (o R2L/_R vale para a direita; o espelho para a esquerda). */
export function moveClipFor(kind: MoveKind, fromHand: Hand): string {
  const name: string = MoveTimings[kind].clip;
  if (fromHand === 'r') return name;
  return name.replace('R2L', 'L2R').replace(/_R$/, '_L');
}

/** Spin: progresso do giro (0..1) medido no mocap, em 8 trechos iguais de start a end (HoopsDummyRig.h). */
const SpinTurnProgress = [0.0, 0.23, 0.431, 0.578, 0.682, 0.779, 0.873, 0.956, 1.0];

export function spinTurnAlpha(alpha: number): number {
  const a = Math.min(1, Math.max(0, alpha)) * (SpinTurnProgress.length - 1);
  const i = Math.min(SpinTurnProgress.length - 2, Math.floor(a));
  return SpinTurnProgress[i] + (SpinTurnProgress[i + 1] - SpinTurnProgress[i]) * (a - i);
}

/** Arremesso alto (JumpShot2_R, 124_05): começa no dip e a soltura cai no tempo ideal. */
export const JumpShotTiming = { clip: 'JumpShot2_R', dip: f(18), release: f(55), followThrough: f(61), end: f(88) };

/** Tempos (s no clipe) de cada família de arremesso: dip = início, release = soltura, end = fim do follow-through. */
export interface ShotTiming {
  dip: number;
  release: number;
  end: number;
}
export const ShotFamilyTiming: Record<'JumpShot' | 'JumpShot2', ShotTiming> = {
  JumpShot2: { dip: f(18), release: f(55), end: f(88) },
  // Medido em JumpShot_R (palma no pico em 1,983 s, agachamento em 1,633 s, fim do braço em 2,600 s; convenção do animador).
  JumpShot: { dip: f(98), release: f(119), end: f(156) },
};

/** Fase do arremesso: -1 no dip, 0 na soltura, 1 no fim do follow-through (linear em cada trecho). */
export function shotPhase(t: number, timing: ShotTiming): number {
  return t <= timing.release
    ? (t - timing.release) / (timing.release - timing.dip)
    : (t - timing.release) / (timing.end - timing.release);
}

/** Inverso de shotPhase: tempo (s) no clipe de uma família para uma fase. */
export function shotTimeAt(phase: number, timing: ShotTiming): number {
  return phase <= 0
    ? timing.release + phase * (timing.release - timing.dip)
    : timing.release + phase * (timing.end - timing.release);
}

/** Clipe de loop com a mão: "Dribble_Walk" + "r" -> "Dribble_Walk_R". */
export const loopClip = (base: string, hand: Hand): string => `${base}_${hand.toUpperCase()}`;

/**
 * Fase do drible (0..1) no clipe: 0 = empurrão (vale da palma da mão da bola), e cresce até o próximo vale.
 * null se o clipe não tem empurrões dessa mão.
 */
export function dribblePhase(info: ClipInfo, hand: Hand, frame: number): number | null {
  const valleys = hand === 'r' ? info.valleys_r : info.valleys_l;
  if (valleys.length === 0) return null;
  const n = info.frames - 1; // o loop fecha no último quadro (= primeiro)
  const t = ((frame % n) + n) % n;
  // Vales em ordem; o segmento que contém t (com volta no fim do loop).
  for (let i = 0; i < valleys.length; i++) {
    const a = valleys[i];
    const b = i + 1 < valleys.length ? valleys[i + 1] : valleys[0] + n;
    const tt = t < a ? t + n : t;
    if (tt >= a && tt < b) return (tt - a) / (b - a);
  }
  return 0;
}

/** Quadro do clipe com a fase de drible dada (o segmento mais perto de nearFrame, se houver vários). */
export function frameAtPhase(info: ClipInfo, hand: Hand, phase: number, nearFrame = 0): number | null {
  const valleys = hand === 'r' ? info.valleys_r : info.valleys_l;
  if (valleys.length === 0) return null;
  const n = info.frames - 1;
  let best: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < valleys.length; i++) {
    const a = valleys[i];
    const b = i + 1 < valleys.length ? valleys[i + 1] : valleys[0] + n;
    const frame = (a + (b - a) * phase) % n;
    const d = Math.min(Math.abs(frame - nearFrame), n - Math.abs(frame - nearFrame));
    if (d < bestDist) {
      bestDist = d;
      best = frame;
    }
  }
  return best;
}

/** Quadros (eventos) cruzados entre prevFrame e frame num loop de n quadros (frame pode ter dado a volta). */
export function crossedFrames(events: number[], prevFrame: number, frame: number, loopFrames: number): number[] {
  const out: number[] = [];
  if (frame === prevFrame) return out;
  const wrapped = frame < prevFrame;
  for (const e of events) {
    if (!wrapped ? e > prevFrame && e <= frame : e > prevFrame || e <= frame) out.push(e);
  }
  if (wrapped && loopFrames <= 0) return [];
  return out;
}

/** Próximo pico (recepção) da mão depois do quadro dado, em quadros de distância (com volta no loop). */
export function framesToNextPeak(info: ClipInfo, hand: Hand, frame: number): number | null {
  const peaks = hand === 'r' ? info.peaks_r : info.peaks_l;
  if (peaks.length === 0) return null;
  const n = info.frames - 1;
  let best = Infinity;
  for (const p of peaks) {
    let d = p - frame;
    if (d <= 0) d += n;
    best = Math.min(best, d);
  }
  return best;
}
