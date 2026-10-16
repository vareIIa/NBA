// Defesa do 1x1 online (docs/24 §6): roubo de bola e toco, os números que o cliente e o juiz dividem. Como o
// protocol.ts, não importa nada que rode (o servidor de desenvolvimento só apaga os tipos do TypeScript).
//
//  - Roubo: o defensor aperta X (Espaço/J); o cliente dele mede a exposição da bola que vê (longe do corpo, do lado
//    dele, quicando) e manda g.steal; o JUIZ sorteia com stealChance (rating de roubo, Glove do defensor, controle de
//    bola e Unpluckable do atacante, todos do cartão) e, se roubou, a posse troca como num rebote defensivo.
//  - Toco: o defensor pula (Y/K) com os braços esticados; o cliente do ARREMESSADOR, na soltura, mede a mão do defensor
//    (o estado que chegou pela rede) contra a subida da bola e sorteia com blockChance. Toco = bola desviada e solta já
//    (g.block), sem esperar o primeiro quique.
import type { PlayerCard } from './protocol.ts';

/** Um tapa a cada tanto (ms) por jogador: apertar sem parar não vira metralhadora de sorteios. */
export const StealCooldownMs = 900;
/** Teto da chance de um tapa, com tudo a favor. */
export const StealMaxChance = 0.6;
/** Alcance do tapa além da metade da envergadura (m): o passo do bote. */
export const StealLungeM = 0.3;

/** Pulo abaixo disto (m) não é toco: só a contestação com os braços. */
export const BlockMinJumpM = 0.12;

/** Valores por nível [Bronze, Prata, Ouro, HOF] (os mesmos de src/sim/HoopsBadges.ts; o teste confere). */
export const GloveValues = [1.1, 1.3, 1.6, 1.65] as const;
export const UnpluckableValues = [0.85, 0.7, 0.5, 0.4] as const;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth01 = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** Rating (25–99) → 0..1. Sem o campo (cartão antigo), 60. */
export const rating01 = (r: number | undefined): number => clamp01(((r ?? 60) - 25) / 74);

/** Multiplicador de um badge pelo nível (0 = sem o badge: 1). */
export function tierFactor(values: readonly number[], tier: number | undefined): number {
  const t = Math.round(tier ?? 0);
  return t >= 1 && t <= values.length ? values[t - 1] : 1;
}

/** O que o defensor via no instante do tapa (núcleo: x, y no chão, z para cima; m). */
export interface StealView {
  ball: readonly [number, number, number];
  attacker: readonly [number, number];
  defender: readonly [number, number];
  /** A bola está fora da mão (no quique do drible). */
  bouncing: boolean;
  /** Drible baixo de proteção (LT). */
  protect: boolean;
}

/**
 * Exposição da bola (0..1): longe do corpo do atacante (crossover na frente) e do lado do defensor expõe; colada ao
 * corpo, do outro lado, presa na mão ou no drible baixo protege. Acima da cabeça (arremesso) quase nada.
 */
export function ballExposure(v: StealView): number {
  const ax = v.ball[0] - v.attacker[0];
  const ay = v.ball[1] - v.attacker[1];
  const off = Math.hypot(ax, ay);
  const far = smooth01((off - 0.2) / 0.45);
  const dx = v.defender[0] - v.attacker[0];
  const dy = v.defender[1] - v.attacker[1];
  const dl = Math.hypot(dx, dy);
  const side = off > 1e-3 && dl > 1e-3 ? (ax * dx + ay * dy) / (off * dl) : 0; // +1 = do lado do defensor
  const sideF = 0.25 + 0.75 * (side + 1) * 0.5;
  const heightF = v.ball[2] > 1.7 ? 0.3 : 1;
  return clamp01((0.3 + 0.7 * far) * sideF * (v.bouncing ? 1 : 0.75) * (v.protect ? 0.6 : 1) * heightF);
}

/**
 * Chance de um tapa virar roubo (0..StealMaxChance). base pelo roubo do defensor (25 → 6%, 99 → 40%), vezes a
 * exposição, a segurança do drible do atacante (controle de bola 25 → ×1,15, 99 → ×0,85) e os badges.
 */
export function stealChance(defender: PlayerCard, attacker: PlayerCard, exposure: number): number {
  const base = 0.06 + 0.34 * rating01(defender.steal);
  const security = 1.15 - 0.3 * rating01(attacker.ballHandle);
  const chance =
    base * clamp01(exposure) * security * tierFactor(GloveValues, defender.glove) * tierFactor(UnpluckableValues, attacker.unpluckable);
  return Math.min(StealMaxChance, Math.max(0, chance));
}

/** Altura do pulo de contestação/toco (m) pela impulsão: 25 → 0,40; 99 → 0,75. */
export const contestJumpM = (vertical: number | undefined): number => 0.4 + 0.35 * rating01(vertical);

/** Distância da mão à bola (m) até onde o toco ainda acontece: 0,3 + até 0,15 pelo rating de toco. */
export const blockReachM = (block: number | undefined): number => 0.3 + 0.15 * rating01(block);

/** Chance do toco com a mão a `handToBall` m da subida da bola (0 fora do alcance). */
export function blockChance(block: number | undefined, handToBall: number): number {
  const reach = blockReachM(block);
  if (!(handToBall < reach)) return 0;
  const close = 1 - handToBall / reach;
  return clamp01((0.25 + 0.45 * rating01(block)) * (0.4 + 0.6 * close));
}
