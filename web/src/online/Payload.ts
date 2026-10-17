// O que o jogador manda ~20 vezes por segundo para o boneco do outro lado (docs/24 §5): o estado do último quadro e os
// comandos de animação desde o envio anterior, cada um com o relógio de quem mandou. É o `d` da mensagem 'st' do
// protocolo da sala (web/src/net), que só o carrega. Coordenadas do mundo three.js.
import { type Hand, MoveTimings, type MoveKind } from '../anim/ClipLibrary';
import { type JumpShotSetup, parseSetup } from '../shot/JumpShotSetup';
import type { Json } from './Wire';

/**
 * 2: defesa (mãos para cima, pulo de contestação, tapa do roubo) e o estado dela na amostra (df).
 * 3: rebote com as duas mãos (catch: alvo no mundo, contato em `at` s, pulo de h m; uncatch: a bola não veio).
 */
export const PayloadVersion = 3;
export const MaxCommands = 32;

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

/** Bola de quem tem a posse, como foi desenhada neste quadro (posição, rotação e o achatamento do quique). */
export interface BallTransform {
  p: V3;
  q: Q4;
  s: V3;
}

/** Estado do jogador num quadro. */
export interface PoseSample {
  /** Relógio de quem mandou (s, performance.now). */
  t: number;
  /** Raiz do animador (com a subida da enterrada). */
  p: V3;
  /** Velocidade da raiz (m/s). */
  w: V3;
  /** Yaw da raiz (rad). */
  y: number;
  /** AnimInput: right, forward, accelRight, accelForward. */
  a: Q4;
  /** Mão da bola, com a bola (1/0) e drible baixo (1/0). */
  h: Hand;
  b: 0 | 1;
  l: 0 | 1;
  /** animator.ballInHand de quem mandou (a bola presa na mão, para o animador). */
  i?: 0 | 1;
  /** Tempo da bandeja pelo plano (animator.layupTime), só durante a bandeja. */
  lt?: number;
  /** Pose da bola presa (setHoldPose) deste quadro. */
  hp?: { pose: Json; t: number };
  /** Defesa (animator.defenseState): mãos para cima (0..1) e altura do pulo (m); só quando há alguma. */
  df?: [number, number];
  ball: BallTransform | null;
}

export type AnimCommand =
  | { op: 'move'; t: number; kind: MoveKind; hand: Hand; dur: number }
  | {
      op: 'shot';
      t: number;
      hand: Hand;
      ideal: number;
      setup?: JumpShotSetup;
      wait: 0 | 1;
      /** Pull-up: embalo, direção e a velocidade do carry amostrada a cada `dt` s desde o início do arremesso. */
      pull?: { m: number; dir: V3; dt: number; sp: number[] };
    }
  | { op: 'release'; t: number }
  | { op: 'celebrate'; t: number }
  | { op: 'endCelebration'; t: number }
  | { op: 'finish'; t: number; dunk: 0 | 1; hand: Hand; timing: V3; air: number }
  | { op: 'layup'; t: number; plan: Json; ball: V3 }
  | { op: 'hold'; t: number; pose: Json; ball: V3 }
  | { op: 'gesture'; t: number; name: string }
  /** Defesa: mãos para cima (RS) liga/desliga, pulo de contestação de h m (Y) e tapa do roubo (X). */
  | { op: 'hands'; t: number; up: 0 | 1 }
  | { op: 'contest'; t: number; h: number }
  | { op: 'steal'; t: number; hand: Hand }
  | { op: 'catch'; t: number; p: V3; at: number; h: number }
  | { op: 'uncatch'; t: number };

export interface Payload {
  v: number;
  s: PoseSample;
  c?: AnimCommand[];
}

// ------------------------------------------------------------------------------------------- validação

class Invalid extends Error {}

function num(x: unknown, limit = 1e4): number {
  if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > limit) throw new Invalid();
  return x;
}

function vec<N extends 3 | 4>(x: unknown, n: N, limit = 1e3): N extends 3 ? V3 : Q4 {
  if (!Array.isArray(x) || x.length !== n) throw new Invalid();
  return x.map((v) => num(v, limit)) as N extends 3 ? V3 : Q4;
}

function hand(x: unknown): Hand {
  if (x !== 'r' && x !== 'l') throw new Invalid();
  return x;
}

function flag(x: unknown): 0 | 1 {
  return x === 1 || x === true ? 1 : 0;
}

function obj(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Invalid();
  return x as Record<string, unknown>;
}

function ball(x: unknown): BallTransform | null {
  if (x === null || x === undefined) return null;
  const o = obj(x);
  return { p: vec(o.p, 3), q: vec(o.q, 4, 2), s: vec(o.s, 3, 4) };
}

function sample(x: unknown): PoseSample {
  const o = obj(x);
  const out: PoseSample = {
    t: num(o.t, 1e9),
    p: vec(o.p, 3),
    w: vec(o.w, 3, 100),
    y: num(o.y, 100),
    a: vec(o.a, 4, 100),
    h: hand(o.h),
    b: flag(o.b),
    l: flag(o.l),
    ball: ball(o.ball),
  };
  if (o.i !== undefined) out.i = flag(o.i);
  if (o.lt !== undefined) out.lt = num(o.lt, 60);
  if (o.hp !== undefined) {
    const hp = obj(o.hp);
    out.hp = { pose: hp.pose as Json, t: num(hp.t, 60) };
  }
  if (o.df !== undefined) {
    if (!Array.isArray(o.df) || o.df.length !== 2) throw new Invalid();
    out.df = [num(o.df[0], 1), num(o.df[1], 2)];
  }
  return out;
}

function command(x: unknown): AnimCommand {
  const o = obj(x);
  const t = num(o.t, 1e9);
  switch (o.op) {
    case 'move': {
      if (typeof o.kind !== 'string' || !Object.hasOwn(MoveTimings, o.kind)) throw new Invalid();
      return { op: 'move', t, kind: o.kind as MoveKind, hand: hand(o.hand), dur: num(o.dur, 5) };
    }
    case 'shot': {
      const cmd: AnimCommand = { op: 'shot', t, hand: hand(o.hand), ideal: num(o.ideal, 5), wait: flag(o.wait) };
      if (o.setup !== undefined) {
        const setup = parseSetup(o.setup);
        if (!setup) throw new Invalid();
        cmd.setup = setup;
      }
      if (o.pull !== undefined) {
        const p = obj(o.pull);
        if (!Array.isArray(p.sp) || p.sp.length < 2 || p.sp.length > 128) throw new Invalid();
        const dt = num(p.dt, 1);
        if (dt <= 0) throw new Invalid();
        cmd.pull = { m: num(p.m, 2), dir: vec(p.dir, 3, 2), dt, sp: p.sp.map((v) => num(v, 50)) };
      }
      return cmd;
    }
    case 'release':
    case 'celebrate':
    case 'endCelebration':
      return { op: o.op, t };
    case 'finish':
      return { op: 'finish', t, dunk: flag(o.dunk), hand: hand(o.hand), timing: vec(o.timing, 3, 60), air: num(o.air, 10) };
    case 'layup':
      return { op: 'layup', t, plan: o.plan as Json, ball: vec(o.ball, 3) };
    case 'hold':
      return { op: 'hold', t, pose: o.pose as Json, ball: vec(o.ball, 3) };
    case 'gesture':
      if (typeof o.name !== 'string' || o.name.length > 32) throw new Invalid();
      return { op: 'gesture', t, name: o.name };
    case 'hands':
      return { op: 'hands', t, up: flag(o.up) };
    case 'contest':
      return { op: 'contest', t, h: num(o.h, 1.5) };
    case 'steal':
      return { op: 'steal', t, hand: hand(o.hand) };
    case 'catch':
      return { op: 'catch', t, p: vec(o.p, 3), at: num(o.at, 2), h: num(o.h, 1.5) };
    case 'uncatch':
      return { op: 'uncatch', t };
    default:
      throw new Invalid();
  }
}

/**
 * Payload de outro jogador, validado campo a campo. null se qualquer parte não presta (versão diferente, número
 * infinito, drible desconhecido…). O plano da bandeja e a pose da bola presa só passam por `fromWire` na hora de tocar.
 */
export function decodePayload(raw: unknown): Payload | null {
  try {
    const o = obj(raw);
    if (o.v !== PayloadVersion) return null;
    const out: Payload = { v: PayloadVersion, s: sample(o.s) };
    if (o.c !== undefined) {
      if (!Array.isArray(o.c) || o.c.length > MaxCommands) return null;
      out.c = o.c.map(command);
    }
    return out;
  } catch {
    return null;
  }
}
