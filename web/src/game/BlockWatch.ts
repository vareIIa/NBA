// Vigia do toco (docs/25-1x1-cpu-e-defesa.md §3), do lado de quem arremessa: a cada quadro do voo, a bola de agora
// projetada pela própria física (BallSim, com aro e tabela) contra a mão do defensor ao longo do pulo dele
// (sim/HoopsBlock). Quando o contato está para acontecer, decide UMA vez por pulo: pegou (tapa em cheio ou raspão) ou
// passou raspando; descendo acima do aro, é interferência. Quem chama aplica o desvio na hora do contato e faz a mão do
// defensor ir até a bola (PlayerAnimator.playBlock).
// Serve ao Online 1x1 (o defensor é o boneco remoto: a fase do pulo chega pela rede) e ao 1x1 contra a CPU.
import type * as THREE from 'three';
import {
  type BlockContact,
  type BlockKind,
  BallRadiusM,
  ChaseDownScale,
  FinishResist,
  JumperBlockScale,
  blockDeflection,
  blockKindFor,
  blockSuccess,
  findBlockContact,
  findHandContact,
  samplePath,
} from '../sim/HoopsBlock';
import { type BallSim, type BallState, Vec3 } from '../sim';
import { toThree } from '../units';

/** O contato precisa estar a no máximo isto (s) para a decisão sair (a mão ainda tem tempo de chegar). */
export const BlockCommitS = 0.16;
/** Quanto (s) do caminho é projetado a cada quadro. */
const LookaheadS = 0.9;
/** Dois inícios de pulo a menos que isto (s) são o mesmo pulo (a fase que chega pela rede oscila um pouco). */
const SameJumpS = 0.25;

export interface BlockDefenderNow {
  /** Chão sob o defensor e a frente dele (núcleo). */
  feet: Vec3;
  facing: Vec3;
  heightM: number;
  wingspanM: number;
  block?: number;
  /** Pulo em andamento (s desde o aperto, altura), ou null. */
  jump: { t: number; h: number } | null;
  handsUp: number;
}

export interface BlockDecision {
  /** Relógio do jogo (s) em que a mão encontra a bola. */
  at: number;
  /** swat/tip = pegou; miss = a mão passa raspando (só o visual). */
  kind: BlockKind | 'miss';
  goaltend: boolean;
  contact: BlockContact;
  chance: number;
  /** Nova velocidade e giro da bola no contato (núcleo); null no miss. */
  velocity: Vec3 | null;
  spin: Vec3 | null;
  /** Mão do defensor, alvo da palma e para onde o tapa segue (mundo three.js). */
  hand: 'l' | 'r';
  target: THREE.Vector3;
  follow: THREE.Vector3;
}

export class BlockWatch {
  private seq = -1;
  private jumpStarts: number[] = [];
  private groundTried = false;

  /** Arremesso novo (seq da posse ou contagem local): esquece as tentativas do anterior. */
  reset(seq: number): void {
    if (seq === this.seq) return;
    this.seq = seq;
    this.jumpStarts = [];
    this.groundTried = false;
  }

  /** Marca a decisão deste pulo (ou a do chão). false = este pulo já foi decidido. */
  claim(nowS: number, d: BlockDefenderNow): boolean {
    const start = d.jump ? nowS - d.jump.t : 0;
    if (d.jump ? this.jumpStarts.some((s) => Math.abs(s - start) < SameJumpS) : this.groundTried) return false;
    if (d.jump) this.jumpStarts.push(start);
    else this.groundTried = true;
    return true;
  }

  /**
   * Um quadro do voo. null = nada a decidir agora. `nowS` = relógio do jogo; `ball` = a bola agora (núcleo); `rand` =
   * [0, 1) (o sorteio de quem arremessa; ?sorte=1 nos testes: todo toco possível sai); `jumper` = arremesso de longe (o
   * contato pega menos, JumperBlockScale), não bandeja/enterrada.
   */
  update(nowS: number, sim: BallSim, ball: BallState, rim: Vec3, d: BlockDefenderNow, rand: () => number, jumper = false): BlockDecision | null {
    // Defensor no chão com as mãos baixas não dá toco (o braço não chega a tempo).
    if (!d.jump && d.handsUp < 0.5) return null;
    // Uma decisão por pulo (pelo instante do aperto) e uma no chão por arremesso.
    const start = d.jump ? nowS - d.jump.t : 0;
    if (d.jump ? this.jumpStarts.some((s) => Math.abs(s - start) < SameJumpS) : this.groundTried) return null;
    const path = samplePath(sim, ball, LookaheadS);
    const contact = findBlockContact(d, path, rim, LookaheadS);
    if (!contact || contact.t > BlockCommitS) return null;
    if (d.jump) this.jumpStarts.push(start);
    else this.groundTried = true;
    const chance = blockSuccess(d.block, contact.clean) * (jumper ? JumperBlockScale : 1);
    const hit = rand() < chance;
    const right = new Vec3(0, 0, 1).cross(d.facing).normalized(new Vec3(0, 1, 0)); // eixos da Unreal: direita = cima × frente
    const hand: 'l' | 'r' = contact.ball.sub(d.feet).dot(right) >= 0 ? 'r' : 'l';
    const at = nowS + contact.t;
    // A palma encosta na bola pelo lado do ombro, não no centro dela.
    const toBall = contact.ball.sub(contact.shoulder).normalized(new Vec3(0, 0, 1));
    const palm = contact.ball.sub(toBall.scale(BallRadiusM * 0.9));
    if (!hit) {
      // Passou raspando: a mão chega um palmo atrasada, por baixo da bola.
      const target = toThree(palm.add(new Vec3(0, 0, -0.22)));
      const follow = toThree(d.facing.flat().normalized().add(new Vec3(0, 0, -0.6))).normalize();
      return { at, kind: 'miss', goaltend: false, contact, chance, velocity: null, spin: null, hand, target, follow };
    }
    const kind = blockKindFor(contact.clean);
    const out = blockDeflection(kind, contact, ballVelocityAt(path, contact.t), rim, d.feet, d.block, rand);
    return {
      at,
      kind,
      goaltend: contact.goaltend,
      contact,
      chance,
      velocity: out.velocity,
      spin: out.spin,
      hand,
      target: toThree(palm),
      follow: toThree(out.velocity).normalize(),
    };
  }
}

export interface FinishBlockOptions {
  /** A bola na mão de quem finaliza (núcleo) e se é enterrada. */
  ball: Vec3;
  dunk: boolean;
}

/**
 * Toco no aro, ANTES da soltura (bandeja ou enterrada subindo): a mão do defensor no ar alcança a bola que está na mão
 * de quem finaliza. Uma decisão por pulo (como no voo). Pegou: a bola é arrancada (Freestyle.stripBall) com o tapa.
 */
export function finishBlock(
  watch: BlockWatch,
  nowS: number,
  rim: Vec3,
  d: BlockDefenderNow,
  f: FinishBlockOptions,
  rand: () => number,
): BlockDecision | null {
  // Enterrada só com o defensor no ar; bandeja também com ele em pé e as mãos em cima (o alto que espera no aro).
  if (!d.jump && (f.dunk || d.handsUp < 0.5)) return null;
  const contact = findHandContact(d, f.ball);
  if (!contact || !watch.claim(nowS, d)) return null;
  // De trás (o defensor mais longe do aro que a bola): chase-down, pega menos.
  const behind = d.feet.sub(rim).length2D() > f.ball.sub(rim).length2D() + 0.25;
  const chance = blockSuccess(d.block, contact.clean) * (f.dunk ? FinishResist.dunk : FinishResist.layup) * (behind ? ChaseDownScale : 1);
  const right = new Vec3(0, 0, 1).cross(d.facing).normalized(new Vec3(0, 1, 0));
  const hand: 'l' | 'r' = contact.ball.sub(d.feet).dot(right) >= 0 ? 'r' : 'l';
  const toBall = contact.ball.sub(contact.shoulder).normalized(new Vec3(0, 0, 1));
  const palm = contact.ball.sub(toBall.scale(BallRadiusM * 0.9));
  const full: BlockContact = { ...contact, t: 0, goaltend: false };
  if (!(rand() < chance)) {
    const target = toThree(palm.add(new Vec3(0, 0, -0.2)));
    const follow = toThree(d.facing.flat().normalized().add(new Vec3(0, 0, -0.6))).normalize();
    return { at: nowS, kind: 'miss', goaltend: false, contact: full, chance, velocity: null, spin: null, hand, target, follow };
  }
  // Arrancada no aro: para longe da cesta e para baixo (a bola ia subindo para o aro).
  const out = blockDeflection('swat', full, new Vec3(0, 0, 2), rim, d.feet, d.block, rand);
  return { at: nowS, kind: 'swat', goaltend: false, contact: full, chance, velocity: out.velocity, spin: out.spin, hand, target: toThree(palm), follow: toThree(out.velocity).normalize() };
}

function ballVelocityAt(path: readonly { t: number; v: Vec3 }[], t: number): Vec3 {
  for (const s of path) if (s.t >= t - 1e-9) return s.v;
  return path[path.length - 1]?.v ?? new Vec3();
}
