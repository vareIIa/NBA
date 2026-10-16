// Toco físico (docs/25-1x1-cpu-e-defesa.md §3): a mão do defensor ao longo do pulo inteiro contra a trajetória real da
// bola, desde a soltura. Quem arremessa decide na soltura (no online o lance é dele; contra a CPU, o mesmo caminho):
//   - o caminho da bola vem da própria física (samplePath: um clone da bola avançando no BallSim, com aro e tabela);
//   - a mão: o ombro sobe com o pulo (a mesma parábola do anim/DefenseMotion) e o braço alcança uma esfera em volta dele;
//   - o primeiro instante em que a bola passa ao alcance da mão é o contato. Descendo acima do aro e perto dele, é
//     interferência (goaltending): a cesta vale.
// Puro (sem three.js): roda no jogo e no vitest.
import { Vec3, clamp } from './HoopsMath';
import { type BallSim, type BallState, cloneBallState } from './HoopsBallSim';

const G = 9.81;

/** Pulo de contestação: agacha JumpLoadS s e voa como corpo em queda livre (igual ao ContestTiming do DefenseMotion). */
export const JumpLoadS = 0.1;
export const jumpAirTime = (heightM: number): number => 2 * Math.sqrt((2 * Math.max(0, heightM)) / G);

/** Subida (m) do pulo de `heightM` a `t` s do aperto. */
export function jumpLiftAt(t: number, heightM: number): number {
  const air = jumpAirTime(heightM);
  const u = (t - JumpLoadS) / Math.max(1e-3, air);
  return u > 0 && u < 1 ? 4 * heightM * u * (1 - u) : 0;
}

/** s do aperto até a mão chegar no alto do pulo (o defensor aperta isso antes do contato). */
export const jumpPeakS = (heightM: number): number => JumpLoadS + jumpAirTime(heightM) / 2;

const rating01 = (r: number | undefined): number => clamp(((r ?? 60) - 25) / 74, 0, 1);

/** Raio da bola (m) e a folga da mão além dele (dedos abertos): 0,03 (toco 25) a 0,10 m (toco 99). */
export const BallRadiusM = 0.12;
export const handSlackM = (block: number | undefined): number => 0.03 + 0.07 * rating01(block);
/** Perto da soltura a bola ainda está na mão (e no braço) de quem arremessa: tocar ali é falta, não toco (m). */
export const ReleaseClearM = 0.45;
/**
 * Arremesso de longe sobe alto e rápido por cima da mão do defensor: o contato pega menos que na bandeja (no jogo real
 * ~1 a cada 20–30 arremessos contestados de perto; bandeja e enterrada no aro, bem mais).
 */
export const JumperBlockScale = 0.4;
/** Bola descendo acima do aro a até isto (m, no chão) do aro ainda tem chance de entrar: tocar é interferência. */
export const GoaltendRadiusM = 2.5;

export interface BlockDefender {
  /** Chão sob o defensor (núcleo). */
  feet: Vec3;
  heightM: number;
  wingspanM: number;
  /** Rating de toco (25–99). */
  block?: number;
  /** Pulo em andamento: s desde o aperto e a altura (m). null = no chão (só o braço). */
  jump: { t: number; h: number } | null;
  /** Mãos em cima agora (0..1): o braço já esticado alcança mais rápido. */
  handsUp: number;
}

export interface PathSample {
  /** s desde a soltura. */
  t: number;
  p: Vec3;
  v: Vec3;
}

/** O caminho da bola desde a soltura: um clone avançando no BallSim (aro e tabela inclusos), a cada tick. */
export function samplePath(sim: BallSim, ball: BallState, seconds: number): PathSample[] {
  const s = cloneBallState(ball);
  const dt = sim.tickSeconds();
  const out: PathSample[] = [{ t: 0, p: s.position, v: s.velocity }];
  const floorZ = sim.getConfig().floorZ + sim.getConfig().ball.radius;
  for (let t = dt; t <= seconds + 1e-9; t += dt) {
    sim.tick(s);
    out.push({ t, p: s.position, v: s.velocity });
    if (s.position.z <= floorZ + 1e-3) break;
  }
  return out;
}

export interface BlockContact {
  /** s depois da soltura. */
  t: number;
  /** Bola, ponta da mão e ombro no contato (núcleo). */
  ball: Vec3;
  hand: Vec3;
  shoulder: Vec3;
  /** Folga da ponta da mão até o centro da bola (m): quanto menor, mais em cheio. */
  dist: number;
  /** Bola descendo acima do aro, perto dele: interferência. */
  goaltend: boolean;
  /** 0..1: quão em cheio (1 = no centro da mão). */
  clean: number;
}

/** Onde está a ponta da mão mais perto do ponto `target` a `t` s da soltura (e o ombro). */
export function reachPoint(d: BlockDefender, t: number, target: Vec3): { hand: Vec3; shoulder: Vec3; arm: number } {
  const lift = d.jump ? jumpLiftAt(d.jump.t + t, d.jump.h) : 0;
  const shoulder = d.feet.withZ(d.feet.z + d.heightM * 0.82 + lift);
  // Ombro à ponta dos dedos: ~42% da envergadura (2,08 m → 0,87 m). Sem as mãos em cima e no chão o braço ainda não
  // chegou lá em cima (sobe enquanto a bola passa): um pouco menos.
  const ready = d.jump ? 1 : clamp(d.handsUp, 0, 1);
  const arm = d.wingspanM * 0.42 * (0.82 + 0.18 * ready);
  const to = target.sub(shoulder);
  const len = to.length();
  const hand = len > 1e-6 ? shoulder.add(to.scale(Math.min(arm, len) / len)) : shoulder;
  return { hand, shoulder, arm };
}

/**
 * Primeiro contato da mão com a bola ao longo do caminho. Só conta com a mão acima do ombro (bola na altura do peito é
 * outra jogada) e só até `windowS` s da soltura. null = a bola passa longe.
 */
export function findBlockContact(d: BlockDefender, path: readonly PathSample[], rim: Vec3, windowS = 1.2): BlockContact | null {
  const slack = BallRadiusM + handSlackM(d.block);
  const release = path[0]?.p;
  for (const s of path) {
    if (s.t > windowS) break;
    // Já desceu abaixo do aro perto dele (entrou ou bateu no aro): o arremesso se resolveu, não tem mais toco.
    if (s.v.z < 0 && s.p.z < rim.z - 0.05 && s.p.sub(rim).length2D() < 0.6) break;
    if (release && s.p.sub(release).length() < ReleaseClearM) continue;
    const r = reachPoint(d, s.t, s.p);
    if (s.p.z < r.shoulder.z - 0.05) continue;
    const dist = Math.max(0, s.p.sub(r.shoulder).length() - r.arm);
    if (dist > slack) continue;
    return {
      t: s.t,
      ball: s.p,
      hand: r.hand,
      shoulder: r.shoulder,
      dist,
      goaltend: s.v.z < 0 && s.p.z > rim.z - 0.02 && s.p.sub(rim).length2D() < GoaltendRadiusM,
      clean: clamp(1 - dist / slack, 0, 1),
    };
  }
  return null;
}

/**
 * Toco no aro (antes da soltura): a mão do defensor alcança AGORA a bola que está na mão de quem finaliza (bandeja ou
 * enterrada subindo)? Só com a bola acima do ombro do defensor. null = não alcança.
 */
export function findHandContact(d: BlockDefender, ball: Vec3): Pick<BlockContact, 'ball' | 'hand' | 'shoulder' | 'dist' | 'clean'> | null {
  const slack = BallRadiusM + handSlackM(d.block);
  const r = reachPoint(d, 0, ball);
  if (ball.z < r.shoulder.z) return null;
  const dist = Math.max(0, ball.sub(r.shoulder).length() - r.arm);
  if (dist > slack) return null;
  return { ball, hand: r.hand, shoulder: r.shoulder, dist, clean: clamp(1 - dist / slack, 0, 1) };
}

/**
 * Quem finaliza protege a bola com o corpo e as duas mãos: só parte dos contatos no aro vira toco (no jogo real ~1 em 8
 * bandejas contestadas por um protetor de aro; enterrada menos ainda, a bola desce com força).
 */
export const FinishResist = { layup: 0.45, dunk: 0.3 } as const;
/** Toco no aro vindo de trás de quem finaliza (chase-down): a mão chega pelas costas e pega menos. */
export const ChaseDownScale = 0.6;

/**
 * Chance de um contato pegar na bola (o resto: a mão chega um instante atrasada e a bola passa raspando): o raspão de um
 * defensor fraco quase nunca; em cheio, com rating alto, quase sempre.
 */
export function blockSuccess(block: number | undefined, clean: number): number {
  return clamp(0.2 + 0.3 * rating01(block) + 0.5 * clamp(clean, 0, 1), 0.05, 0.95);
}

export type BlockKind = 'swat' | 'tip';

/** Pegou na bola: em cheio vira tapa (swat); de raspão, desvio (tip). */
export const blockKindFor = (clean: number): BlockKind => (clean >= 0.4 ? 'swat' : 'tip');

/**
 * Para onde a bola vai depois do toco. swat (tapa em cheio): para longe da cesta e para baixo/fora, forte; tip (raspão):
 * segue mais devagar e torta, quase sempre sem chance de cesta. `rand` = [0, 1) (o lado e a força variam).
 */
export function blockDeflection(
  kind: BlockKind,
  contact: BlockContact,
  ballV: Vec3,
  rim: Vec3,
  defenderFeet: Vec3,
  block: number | undefined,
  rand: () => number,
): { velocity: Vec3; spin: Vec3 } {
  const b = rating01(block);
  if (kind === 'tip') {
    const side = new Vec3(-ballV.y, ballV.x, 0).normalized(new Vec3(0, 1, 0)).scale((rand() - 0.5) * 2.2);
    const v = ballV.scale(0.45 + 0.2 * rand()).add(side).withZ(ballV.z * 0.3 + 0.6 * rand());
    return { velocity: v, spin: new Vec3(0, 9, 0) };
  }
  // Para longe da cesta (do aro para o ponto do contato) e um pouco no sentido do tapa (do defensor para a bola).
  const away = contact.ball.sub(rim).flat().normalized(contact.ball.sub(defenderFeet).flat().normalized());
  const hit = contact.ball.sub(defenderFeet).flat().normalized(away);
  const dir = away.scale(0.7).add(hit.scale(0.3)).normalized(away);
  const side = new Vec3(-dir.y, dir.x, 0).scale((rand() - 0.5) * 0.9);
  const speed = 5.5 + 3 * b + 1.5 * rand();
  const v = dir.add(side).normalized(dir).scale(speed).withZ(-1.2 + 3.4 * rand());
  return { velocity: v, spin: new Vec3(0, 22, 0) };
}
