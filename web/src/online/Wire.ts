// Dados do núcleo (plano da bandeja, pose da bola presa) em JSON e de volta, para o boneco remoto (docs/24 §5).
// Vec3 é classe (tem métodos): vira {$v:[x,y,z]} na ida e uma Vec3 de novo na volta. Na volta, TUDO é validado: o JSON
// veio de outro jogador, e um número infinito ou uma árvore gigante não pode chegar ao animador.
import { Vec3 } from '../sim';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class WireError extends Error {}

const Limits = { depth: 8, array: 512, keys: 64, string: 64, magnitude: 1e4 };

/** Arredonda para `digits` casas (o JSON fica curto; 4 casas = 0,1 mm, abaixo do que se vê). */
export function round(x: number, digits = 4): number {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
}

/** Valor do núcleo para JSON: Vec3 marcada, números arredondados, funções e undefined fora. */
export function toWire(value: unknown, digits = 4, depth = 0): Json {
  if (depth > Limits.depth) throw new WireError('profundo demais');
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? round(value, digits) : null;
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (value instanceof Vec3) return { $v: [round(value.x, digits), round(value.y, digits), round(value.z, digits)] };
  if (Array.isArray(value)) return value.map((v) => toWire(v, digits, depth + 1));
  if (typeof value === 'object') {
    const out: { [key: string]: Json } = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined || typeof v === 'function') continue;
      out[key] = toWire(v, digits, depth + 1);
    }
    return out;
  }
  return null;
}

function finite(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > Limits.magnitude) throw new WireError('número inválido');
  return n;
}

/** JSON de outro jogador de volta para o formato do núcleo (Vec3 reconstruídas). Lança WireError se algo não presta. */
export function fromWire(value: unknown, depth = 0): unknown {
  if (depth > Limits.depth) throw new WireError('profundo demais');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return finite(value);
  if (typeof value === 'string') {
    if (value.length > Limits.string) throw new WireError('texto longo demais');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > Limits.array) throw new WireError('lista longa demais');
    return value.map((v) => fromWire(v, depth + 1));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length > Limits.keys) throw new WireError('objeto grande demais');
    const v = (value as { $v?: unknown }).$v;
    if (entries.length === 1 && Array.isArray(v)) {
      if (v.length !== 3) throw new WireError('vetor inválido');
      return new Vec3(finite(v[0]), finite(v[1]), finite(v[2]));
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new WireError('chave proibida');
      out[key] = fromWire(item, depth + 1);
    }
    return out;
  }
  throw new WireError('tipo inválido');
}
