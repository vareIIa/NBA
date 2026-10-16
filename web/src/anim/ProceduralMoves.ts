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

/** Altura do jogador (m). Era 1,96; o diretor pediu 1,86 (2026-10-15: alto demais, drible "quebrado"). */
export const PlayerHeightMeters = 1.86;
/** Os pontos-chave dos procedurais (abaixo) foram medidos num jogador de 1,96 m: escala para a altura atual. */
export const ProceduralScale = PlayerHeightMeters / 1.96;

/** Alturas (m) do centro da bola no drible de jogador bom, proporcionais à altura (Hirata et al., 2011). */
export const SkilledDribble = {
  catchHeight: 0.403 * PlayerHeightMeters, // 0,75 m
  releaseHeight: 0.325 * PlayerHeightMeters, // 0,60 m
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
   * puxa a bola para trás por fora da coxa, enrola em volta do quadril na altura da cintura e solta atrás do bolso do
   * lado da bola, empurrando para baixo e para o outro lado: a bola cruza as costas no ar até o quique.
   * Antes a mão levava a bola até o meio das costas (x −0,04) na altura da coxa: com a bermuda larga (≈41 cm de fundo)
   * e o braço de ~0,6 m a palma não alcançava por fora e passava até 15 cm por dentro do quadril. Mais baixo (centro a
   * ~0,55 m) a bola presa ficava dentro da cápsula da coxa do laboratório; na cintura ela passa acima da coxa.
   */
  heldKeys: [
    [0.0, [0.34, 0.62, 0.16]],
    [0.14, [0.38, 0.62, -0.04]],
    [0.28, [0.34, 0.68, -0.2]],
    [0.4, [0.29, 0.74, -0.3]],
    [0.5, [0.26, 0.76, -0.35]],
  ] as ReadonlyArray<readonly [number, V3]>,
  /** Quique atrás do calcanhar do outro pé (bem atrás: o pé de lá fica embaixo do corpo no por trás). */
  floor: [-0.18, BallRadius, -0.26] as V3,
  /** Recepção na outra mão, à frente e do lado novo. */
  catchPoint: [-0.38, 0.66, 0.24] as V3,
  /**
   * Braço livre vem para a frente e baixo (afasta o defensor, ajuda a frear), na altura do joelho como no vídeo do
   * ginásio (MUvJacHl12g 89,0–89,3 s). À frente do peito (1,05 m) a mão ficava na altura do rosto com o corpo agachado.
   */
  offArmForward: [-0.28, 0.75, 0.4] as V3,
  /** Saída do IK da mão da bola depois da soltura: começa `after` (u) depois dela e dura `len`. */
  fromFade: { after: 0.04, len: 0.4 },
  /**
   * Tronco no por trás (graus no pico; ver behindBackTrunk): o ombro da mão da bola abre para trás e desce, como no
   * jogo real. Com o tronco inclinado do size-up o ombro ficava ~45 cm à frente do caminho da bola e o braço não
   * alcançava: a mão parava dentro da bermuda (até 15 cm).
   * yaw: gira os ombros para o lado da bola (o ombro dela vai para trás); side: inclina para o lado da bola (o ombro
   * desce); lift: desfaz parte da inclinação para a frente (o peito sobe e o ombro recua). inEnd/outStart/outEnd: u em
   * que o giro chega ao pico, começa a voltar e termina de voltar.
   */
  trunk: { yawDeg: 30, sideDeg: 10, liftDeg: 12, headKeep: 0.7, inEnd: 0.3, outStart: 0.65, outEnd: 1.05 },
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
  const F = BehindBack.fromFade;
  const from = u <= BehindBack.release + F.after ? smooth(u / 0.22) : 1 - smooth((u - BehindBack.release - F.after) / F.len);
  const to = smooth((u - 0.48) / 0.4);
  // Braço livre: vai para a frente logo no começo e fica até a recepção assumir (o alvo desliza de um para o outro);
  // antes ele cedia antes de a recepção entrar e voltava para o clipe no meio (subia até a cabeça).
  const offArm = smooth(u / 0.22);
  return { from, to, offArm };
}

/**
 * Quanto (0..1) do giro do tronco vale no progresso u: entra junto com a mão da bola, fica até depois da soltura (a mão
 * ainda acompanha a bola para baixo) e sai antes da recepção, para a outra mão receber de frente.
 */
export function behindBackTrunk(u: number): number {
  const T = BehindBack.trunk;
  return smooth(u / T.inEnd) * (1 - smooth((u - T.outStart) / (T.outEnd - T.outStart)));
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
