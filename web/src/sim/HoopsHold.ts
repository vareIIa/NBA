// Bola presa (drible morto): o que o jogador faz parado com a bola depois do hop step / jump stop. Puro (sem three.js).
//
// Fundamentos de referência (referencias/real/):
//  - Hakeem (3w9KLLE0r68, "Reverse Pivot Split Jump"): pousa nos DOIS pés, base larga e quadril baixo, SEM fixar o pé de
//    pivô — escolhe o lado depois de sentir o defensor. Aqui: depois do pouso o pivô é livre; o primeiro movimento com um
//    pé fixa o outro como pivô (regra do jump stop).
//  - Jordan (iekqeoHB0Co, 194–223 s) e Kobe (ruGQRHgQJjw): ameaça tripla com joelhos bem dobrados, tronco ~35° à frente,
//    cabeça erguida, bola no quadril do lado da mão, protegida pelo corpo; jab curto e rápido do pé livre em direção ao
//    defensor, com o peso ficando no pé de pivô; pump fake leva a bola acima da testa com as pernas ainda dobradas.
//  - Jump stop com pivôs (uZsO61OL0Bk): "quedinha rápida, os dois pés juntos"; pivôs de frente e de costas baixo e
//    equilibrado; a bola vai ao ombro/queixo depois de cada pivô.
//
// Comandos (docs/02-controles.md §2, ameaça tripla do 2K24; bola na direita, na esquerda tudo espelha):
//  toque direita = jab lateral; cima-direita = jab grande; cima = stepover (passo cruzado à frente); esquerda = jab
//  cruzado; baixo-esquerda = stepover de costas (pivô reverso); baixo = pump fake; giro = spin-out. X: toque = pump fake,
//  segurado = finaliza; X segurado durante (ou logo depois de) um pump fake = step-through.
import { Vec3, clamp, upVector } from './HoopsMath';
import { StickDir, type StickGesture, StickGestureKind, mirrorDir } from './HoopsProStick';
import { type Side, otherSideOf } from './HoopsLayup';

export enum HoldMove {
  Jab,
  JabBig,
  JabCross,
  StepOver,
  StepOverBack,
  PumpFake,
  SpinOut,
  StepThrough,
}

export const HoldMoveLabels: Record<HoldMove, string> = {
  [HoldMove.Jab]: 'Jab',
  [HoldMove.JabBig]: 'Jab grande',
  [HoldMove.JabCross]: 'Jab cruzado',
  [HoldMove.StepOver]: 'Stepover',
  [HoldMove.StepOverBack]: 'Pivô reverso',
  [HoldMove.PumpFake]: 'Pump fake',
  [HoldMove.SpinOut]: 'Spin-out',
  [HoldMove.StepThrough]: 'Step-through',
};

/** Onde a bola fica no pico do movimento. */
export type HoldBall = 'pocket' | 'low' | 'chin' | 'forehead';

export interface HoldMoveSpec {
  /** s. */
  duration: number;
  /**
   * Pé livre no pico: deslocamento a partir de onde ele estava (m), no referencial do corpo no começo do movimento:
   * `side` para o lado da mão da bola (+), `forward` para a frente. null = o pé não sai do lugar.
   */
  step: { side: number; forward: number } | null;
  /** O pé volta para a base (jab) ou fica onde pisou (passo novo). */
  returns: boolean;
  /** Fração do tempo em que o pé chega ao pico. */
  peak: number;
  /** Fração do peso que vai para o pé livre no pico (0 = tudo no pivô). */
  weight: number;
  /** m a mais de agachamento no pico. */
  crouch: number;
  /** Giro do corpo em volta do pé de pivô (graus; + = pivô reverso: o lado do pé livre vai para trás). */
  turnDeg: number;
  ball: HoldBall;
}

/** Números dos movimentos (ajustáveis no laboratório). */
export const HoldMoveSpecs: Record<HoldMove, HoldMoveSpec> = {
  // Jab do Jordan: ~35 cm à frente e um pouco para fora, ida rápida, volta para a base; o peso fica atrás.
  [HoldMove.Jab]: { duration: 0.42, step: { side: 0.1, forward: 0.36 }, returns: true, peak: 0.32, weight: 0.3, crouch: 0.04, turnDeg: 0, ball: 'pocket' },
  [HoldMove.JabBig]: { duration: 0.56, step: { side: 0.14, forward: 0.56 }, returns: true, peak: 0.38, weight: 0.42, crouch: 0.08, turnDeg: 0, ball: 'low' },
  // Jab cruzado: o pé livre cruza na frente para o outro lado (a bola vai junto, protegida no queixo).
  [HoldMove.JabCross]: { duration: 0.5, step: { side: -0.5, forward: 0.32 }, returns: true, peak: 0.36, weight: 0.35, crouch: 0.05, turnDeg: 0, ball: 'chin' },
  // Stepover: passo cruzado que fica (base nova à frente).
  [HoldMove.StepOver]: { duration: 0.5, step: { side: -0.5, forward: 0.45 }, returns: false, peak: 0.6, weight: 0.5, crouch: 0.05, turnDeg: 0, ball: 'chin' },
  // Pivô reverso: o pé livre vai para trás em volta do pivô (de costas para o defensor), bola no queixo.
  [HoldMove.StepOverBack]: { duration: 0.55, step: null, returns: false, peak: 0.7, weight: 0.45, crouch: 0.06, turnDeg: 110, ball: 'chin' },
  // Pump fake: bola acima da testa, pernas dobradas (o calcanhar não sai do chão).
  [HoldMove.PumpFake]: { duration: 0.46, step: null, returns: true, peak: 0.42, weight: 0, crouch: -0.03, turnDeg: 0, ball: 'forehead' },
  // Spin-out: giro inteiro em volta do pivô, terminando de frente para a cesta e um passo à frente.
  [HoldMove.SpinOut]: { duration: 0.62, step: null, returns: false, peak: 0.8, weight: 0.4, crouch: 0.06, turnDeg: 360, ball: 'chin' },
  // Step-through: depois do fake, o pé livre passa longe por fora do defensor, baixo; a bola vai para fora.
  [HoldMove.StepThrough]: { duration: 0.4, step: { side: -0.3, forward: 0.72 }, returns: false, peak: 0.85, weight: 0.6, crouch: 0.1, turnDeg: 0, ball: 'low' },
};

/** Gesto do RS -> movimento (bola na direita; na esquerda o stick é espelhado antes). */
export function holdMoveForGesture(g: StickGesture, ballHand: Side): HoldMove | null {
  if (g.kind === StickGestureKind.Rotation) return HoldMove.SpinOut;
  if (g.kind === StickGestureKind.QuarterCircle) return HoldMove.StepOverBack;
  if (g.kind !== StickGestureKind.Flick && g.kind !== StickGestureKind.DoubleThrow && g.kind !== StickGestureKind.Switchback) return null;
  const dir = ballHand === 'r' ? g.dir : mirrorDir(g.dir);
  switch (dir) {
    case StickDir.Right:
      return HoldMove.Jab;
    case StickDir.UpRight:
      return HoldMove.JabBig;
    case StickDir.Up:
      return HoldMove.StepOver;
    case StickDir.Left:
    case StickDir.UpLeft:
      return HoldMove.JabCross;
    case StickDir.DownLeft:
      return HoldMove.StepOverBack;
    case StickDir.Down:
      return HoldMove.PumpFake;
    default:
      return null;
  }
}

const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / Math.max(1e-6, b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const right = (d: Vec3): Vec3 => upVector().cross(d).normalized(new Vec3(0, 1, 0));
const sideVec = (d: Vec3, s: Side): Vec3 => (s === 'r' ? right(d) : right(d).neg());

/** Pés no chão (núcleo, z = 0) e para onde o corpo olha. */
export interface HoldStance {
  feet: Record<Side, Vec3>;
  facing: Vec3;
}

export interface HoldPose {
  /** Pés: posição (chão), altura do pé no ar e se está apoiado. */
  feet: Record<Side, { pos: Vec3; lift: number; planted: boolean }>;
  facing: Vec3;
  /** Centro de massa no chão (entre os pés, puxado pelo peso). */
  com: Vec3;
  /** m de agachamento a mais que a base. */
  crouch: number;
  ball: HoldBall;
  /** 0..1: quanto a bola está no ponto do movimento (o resto é o bolso da base). */
  ballWeight: number;
}

/**
 * Bola presa. Guarda a base (pés no chão, frente), o pé de pivô (null até o primeiro passo, como no jump stop) e o
 * movimento em andamento; `pose(t)` dá os pés, o centro de massa, o agachamento e a bola para o animador.
 */
export class HoldState {
  /** Pé de pivô: null = os dois pés no chão do jump stop, qualquer um pode virar o pivô. */
  pivot: Side | null = null;
  private move: { kind: HoldMove; start: number; from: HoldStance; freeFoot: Side } | null = null;
  /** Último pump fake (s): o X segurado logo depois vira step-through. */
  lastFakeAt = -Infinity;

  constructor(
    public stance: HoldStance,
    readonly ballHand: Side,
    public since: number,
  ) {}

  get moving(): boolean {
    return this.move !== null;
  }

  moveKind(): HoldMove | null {
    return this.move?.kind ?? null;
  }

  /** Começa um movimento (se não houver outro). O pé livre é o da mão da bola até o pivô ser fixado. */
  start(kind: HoldMove, now: number): boolean {
    if (this.move) return false;
    const spec = HoldMoveSpecs[kind];
    const freeFoot: Side = this.pivot ? otherSideOf(this.pivot) : this.ballHand;
    // Qualquer passo (ou giro) com um pé fixa o outro como pivô.
    if (spec.step || spec.turnDeg !== 0) this.pivot ??= otherSideOf(freeFoot);
    this.move = { kind, start: now, from: { feet: { ...this.stance.feet }, facing: this.stance.facing }, freeFoot };
    if (kind === HoldMove.PumpFake) this.lastFakeAt = now;
    return true;
  }

  /** Avança: no fim do movimento a base vira a nova (passo que fica, giro). Retorna o movimento que acabou, se acabou. */
  update(now: number): HoldMove | null {
    const m = this.move;
    if (!m) return null;
    const spec = HoldMoveSpecs[m.kind];
    if (now - m.start < spec.duration) return null;
    const end = this.poseAt(m, spec, 1);
    this.stance = { feet: { l: end.feet.l.pos, r: end.feet.r.pos }, facing: end.facing };
    this.move = null;
    return m.kind;
  }

  pose(now: number): HoldPose {
    const m = this.move;
    if (!m) return this.basePose(this.stance, 0, 'pocket', 0);
    const spec = HoldMoveSpecs[m.kind];
    return this.poseAt(m, spec, clamp((now - m.start) / spec.duration, 0, 1));
  }

  private basePose(stance: HoldStance, crouch: number, ball: HoldBall, ballWeight: number, weightFree = 0, free: Side | null = null): HoldPose {
    const { l, r } = stance.feet;
    let com = l.add(r).scale(0.5);
    if (free) {
      const pivotPos = stance.feet[otherSideOf(free)];
      com = pivotPos.add(stance.feet[free].sub(pivotPos).scale(0.5 + (weightFree - 0.5) * 0.9 + 0.05));
    }
    return {
      feet: { l: { pos: l, lift: 0, planted: true }, r: { pos: r, lift: 0, planted: true } },
      facing: stance.facing,
      com: com.flat(),
      crouch,
      ball,
      ballWeight,
    };
  }

  private poseAt(m: { kind: HoldMove; start: number; from: HoldStance; freeFoot: Side }, spec: HoldMoveSpec, u: number): HoldPose {
    const free = m.freeFoot;
    const pivotSide = otherSideOf(free);
    const pivotPos = m.from.feet[pivotSide];
    const fwd = m.from.facing.flat().normalized(new Vec3(-1, 0, 0));
    const toHand = sideVec(fwd, this.ballHand);
    // Ida até o pico, (pausa curta) e volta se o movimento volta.
    const out = smooth(0, spec.peak, u);
    const back = spec.returns ? smooth(Math.min(1, spec.peak + 0.12), 1, u) : 0;
    const reach = out * (1 - back);
    // Giro em volta do pivô (o pé livre gira junto e o corpo também).
    // No núcleo a direita é +90° da frente: o lado direito vai para trás com giro positivo (e o esquerdo com negativo).
    const turn = ((spec.turnDeg * Math.PI) / 180) * (free === 'r' ? 1 : -1) * smooth(0, spec.peak, u);
    const rot = (v: Vec3): Vec3 => new Vec3(v.x * Math.cos(turn) - v.y * Math.sin(turn), v.x * Math.sin(turn) + v.y * Math.cos(turn), 0);
    let freePos = pivotPos.add(rot(m.from.feet[free].sub(pivotPos)));
    if (spec.step) {
      const target = toHand.scale(spec.step.side).add(fwd.scale(spec.step.forward));
      freePos = freePos.add(rot(target).scale(spec.returns ? reach : out));
    }
    // Spin-out: termina um passo à frente da base.
    if (m.kind === HoldMove.SpinOut) freePos = freePos.add(fwd.scale(0.35 * out));
    const facing = rot(fwd).normalized(fwd);
    const stepping = spec.step || spec.turnDeg !== 0;
    // O pé livre sai do chão na ida (e na volta do jab), com um arco baixo.
    const swing = stepping ? Math.max(Math.sin(Math.PI * clamp(u / Math.max(1e-3, spec.peak), 0, 1)), spec.returns ? Math.sin(Math.PI * clamp((u - spec.peak - 0.12) / Math.max(1e-3, 1 - spec.peak - 0.12), 0, 1)) : 0) : 0;
    const feet: Record<Side, Vec3> = { l: pivotPos, r: pivotPos };
    feet[pivotSide] = pivotPos;
    feet[free] = freePos;
    const pose = this.basePose({ feet, facing }, spec.crouch * Math.sin(Math.PI * clamp(u, 0, 1)), spec.ball, Math.sin(Math.PI * Math.min(1, u / Math.max(spec.peak, 1e-3) * 0.5)) ** 0.5, spec.weight * (spec.returns ? reach : out), stepping ? free : null);
    pose.feet[free] = { pos: freePos, lift: swing * (spec.returns ? 0.06 : 0.09), planted: swing < 0.05 };
    if (!spec.returns) pose.ballWeight = 1 - smooth(0.85, 1, u);
    else pose.ballWeight = reach > 0 ? Math.min(1, out) * (1 - back) : 0;
    return pose;
  }
}

/**
 * Finalização a partir da bola presa: bandeja de força de dois pés perto do aro (o 2K27 sobe de dois pés do meio do
 * garrafão depois do hop), floater no meio (o "hop floater") e arremesso mais longe.
 */
export function holdFinishFor(distanceM: number): 'layup' | 'floater' | 'shot' {
  if (distanceM <= 3.0) return 'layup';
  return distanceM <= 4.6 ? 'floater' : 'shot';
}
