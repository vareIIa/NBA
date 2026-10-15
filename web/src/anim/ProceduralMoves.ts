// Movimentos de drible que o mocap aberto (CMU) não tem, feitos por procedimento sobre o tronco de um clipe:
// trajetória da bola + IK dos braços (behind the back) e trajetória dos pés + quadril (step-back / retreat).
// Coordenadas no referencial do jogador (three, em metros, jogador de 1,96 m): x = ESQUERDA do jogador, y = cima,
// z = frente. Puro (sem three.js): testável no vitest.
//
// Referências de execução (basquete real):
//  - Behind the back: a mão da bola leva a bola por fora do quadril e por trás das costas, empurra para baixo e para o
//    outro lado; a bola quica atrás do calcanhar do outro pé e sobe para a outra mão, enquanto o corpo já sai para o
//    lado novo. A bola fica colada ao corpo (proteção).
//  - Step-back: um drible forte puxado para trás; o pé da frente planta e empurra, o corpo salta ~1 m para trás e cai
//    equilibrado sobre os dois pés, com a bola voltando para a mão na aterrissagem (pronto para o arremesso).
//  - Half spin: começa o giro de costas para o defensor e volta pelo mesmo lado.
// Números de drible real (Hirata et al., ISBS 2011, 10 m de drible em velocidade, jogadores de universidade): recepção
// a 40,3% da altura, soltura a 32,5%, contato da mão 0,39 s (amadores: 56%, 42% e 0,28 s).

export type V3 = [number, number, number];

export const BallRadius = 0.119;

/** Alturas (m) do centro da bola no drible de jogador bom, para um jogador de 1,96 m (Hirata et al., 2011). */
export const SkilledDribble = {
  catchHeight: 0.403 * 1.96, // 0,79 m
  releaseHeight: 0.325 * 1.96, // 0,64 m
  contactSeconds: 0.39,
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
export const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Catmull-Rom uniforme por pontos-chave (u, posição), u crescente. */
export function catmull(keys: ReadonlyArray<readonly [number, V3]>, u: number): V3 {
  if (u <= keys[0][0]) return [...keys[0][1]];
  const last = keys[keys.length - 1];
  if (u >= last[0]) return [...last[1]];
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
  const [u1, p1] = keys[i];
  const [u2, p2] = keys[i + 1];
  const p0 = i > 0 ? keys[i - 1][1] : p1;
  const p3 = i + 2 < keys.length ? keys[i + 2][1] : p2;
  const t = (u - u1) / (u2 - u1);
  const t2 = t * t;
  const t3 = t2 * t;
  const out: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] =
      0.5 *
      (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  }
  return out;
}

/** Lado da mão da bola no eixo x (x = esquerda): direita = -1, esquerda = +1. */
export const sideSign = (hand: 'r' | 'l'): number => (hand === 'r' ? -1 : 1);

// ------------------------------------------------------------------------------------------- behind the back

export const BehindBack = {
  release: 0.5,
  catch: 0.92,
  /**
   * Centro da bola (com a mão) até a soltura; x positivo = lado da mão de origem (ver onSide). Como no jogo real: a mão
   * puxa a bola para trás por fora da coxa, enrola atrás das pernas na altura do joelho/coxa e empurra para baixo e
   * para o outro lado.
   */
  heldKeys: [
    [0.0, [0.34, 0.62, 0.16]],
    [0.14, [0.38, 0.56, -0.06]],
    [0.28, [0.28, 0.52, -0.26]],
    [0.4, [0.1, 0.5, -0.32]],
    [0.5, [-0.04, 0.46, -0.3]],
  ] as ReadonlyArray<readonly [number, V3]>,
  /** Quique atrás do calcanhar do outro pé. */
  floor: [-0.2, BallRadius, -0.12] as V3,
  /** Recepção na outra mão, à frente e do lado novo. */
  catchPoint: [-0.38, 0.66, 0.24] as V3,
  /**
   * Braço livre vem para a frente e baixo (afasta o defensor, ajuda a frear), na altura do joelho como no vídeo do
   * ginásio (MUvJacHl12g 89,0–89,3 s). À frente do peito (1,05 m) a mão ficava na altura do rosto com o corpo agachado.
   */
  offArmForward: [-0.28, 0.75, 0.4] as V3,
};

/**
 * Os pontos-chave são escritos com x positivo = LADO DA BOLA (mão de origem). Com a bola na direita (que fica em -x)
 * o x troca de sinal; com a esquerda fica como está.
 */
export function onSide(p: V3, hand: 'r' | 'l'): V3 {
  return [hand === 'r' ? -p[0] : p[0], p[1], p[2]];
}

/** Centro da bola no behind the back enquanto a mão de origem a carrega (u = 0..release). */
export function behindBackBall(u: number, fromHand: 'r' | 'l'): V3 {
  return onSide(catmull(BehindBack.heldKeys, Math.min(u, BehindBack.release)), fromHand);
}

export const behindBackFloor = (fromHand: 'r' | 'l'): V3 => onSide(BehindBack.floor, fromHand);
export const behindBackCatch = (fromHand: 'r' | 'l'): V3 => onSide(BehindBack.catchPoint, fromHand);
export const behindBackOffArm = (fromHand: 'r' | 'l'): V3 => onSide(BehindBack.offArmForward, fromHand);

/** Pesos do IK dos braços no behind the back: a mão de origem leva a bola; a outra vai buscar a recepção. */
export function behindBackArmWeights(u: number): { from: number; to: number; offArm: number } {
  // A mão da bola entra suave (antes pulava da pose do drible para o caminho por trás num quadro só).
  // O drible dura ~0,45 s: rampas de menos de ~0,1 s (u 0,2) davam tranco no braço.
  const from = u <= BehindBack.release + 0.04 ? smooth(u / 0.22) : 1 - smooth((u - BehindBack.release - 0.04) / 0.4);
  const to = smooth((u - 0.48) / 0.4);
  // Braço livre: vai para a frente logo no começo e fica até a recepção assumir (o alvo desliza de um para o outro);
  // antes ele cedia antes de a recepção entrar e voltava para o clipe no meio (subia até a cabeça).
  const offArm = smooth(u / 0.22);
  return { from, to, offArm };
}

// ------------------------------------------------------------------------------------------- step-back

export const StepBack = {
  release: 0.14,
  catch: 0.9,
  /** Janelas (u) em que cada pé sai do chão: o de trás sai primeiro, o da frente empurra e segue (saltinho). */
  rearFoot: [0.06, 0.5] as const,
  frontFoot: [0.2, 0.66] as const,
  liftRear: 0.11,
  liftFront: 0.13,
  /** Quique forte à frente dos pés (o corpo já foi para trás quando a bola bate). */
  floor: [0.24, BallRadius, 0.42] as V3,
  catchPoint: [0.33, 0.76, 0.16] as V3,
};

/** Fração (0..1) do deslocamento do pé e altura (m) acima do chão, numa janela [a, b] de u. */
export function footStep(u: number, window: readonly [number, number], lift: number): { travel: number; height: number } {
  const t = clamp01((u - window[0]) / (window[1] - window[0]));
  return { travel: smooth(t), height: lift * Math.sin(Math.PI * t) };
}

/**
 * Quadril no step-back (m a mais de agachamento): desce no empurrão, sobe no ar, absorve na aterrissagem.
 * E inclinação extra do tronco (graus, + = para a frente): joga para trás no empurrão, para a frente ao cair.
 */
export function stepBackBody(u: number): { crouch: number; leanDeg: number } {
  const push = Math.sin(Math.PI * clamp01(u / 0.22));
  const air = Math.sin(Math.PI * clamp01((u - 0.22) / 0.34));
  const land = Math.sin(Math.PI * clamp01((u - 0.56) / 0.4));
  return { crouch: 0.04 * push - 0.06 * air + 0.06 * land, leanDeg: -7 * push - 3 * air + 5 * land };
}

export const stepBackFloor = (hand: 'r' | 'l'): V3 => onSide(StepBack.floor, hand);
export const stepBackCatch = (hand: 'r' | 'l'): V3 => onSide(StepBack.catchPoint, hand);

// ------------------------------------------------------------------------------------------- giros

/** Half spin: vai até turnDeg e volta (seno), com o pico no meio do movimento. */
export function halfSpinTurn(alpha: number): number {
  return Math.sin(Math.PI * clamp01(alpha));
}

export { lerp };
