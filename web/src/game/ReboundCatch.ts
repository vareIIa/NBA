// Rebote com as duas mãos (online 1x1 e 1x1 contra a CPU; diretor, 2026-10-16): X pega parado, Y pula e pega. Antes a
// bola alta era pega sozinha ao passar perto e voava para a mão do drible; agora o jogador vai nela com as duas mãos
// (DefenseMotion.catchBall), segura, traz para o peito e só então dribla. Bola baixa (rolando, depois do quique) ainda
// é pega passando por cima.
//
// Quem usa (OnlineMatch e CpuOpponent, cada um com o próprio Freestyle e animador):
//   const c = new ReboundCatch(animator, game);
//   c.start(bola, corpo, pulo)          // X/Y com a bola solta: planeja o contato e toca a pegada
//   if (c.touching(bola)) pedir ao juiz // as mãos chegaram na bola
//   c.grant(onde a bola estava)         // o juiz deu a bola: ela fica presa às mãos
//   c.update()                          // a cada quadro (depois do game.update): bola nas mãos; no fim, para o drible
//   c.cancel()                          // o outro pegou
import * as THREE from 'three';
import type { PlayerAnimator } from '../anim/PlayerAnimator';
import { CatchTiming, ContestTiming, airTime, contestJumpAt } from '../anim/DefenseMotion';
import { Vec3, makeBallState } from '../sim';
import { fromThree, toThree } from '../units';
import type { Freestyle } from './Freestyle';

/** Bola abaixo disto (centro, m): passar por cima pega sozinho (rolando, quicando baixo). Acima: X ou Y. */
export const LowPickupZ = 0.95;
/** As mãos (o meio das palmas) a até isto do centro da bola: a pegada vale e o pedido vai para o juiz (m). */
export const CatchRadius = 0.42;
/**
 * Alcance da palma (m) a partir do meio dos ombros, sem medir o esqueleto: meia envergadura sem os ombros (0,42 m de um
 * ombro ao outro), menos a mão até a palma. 42% da envergadura a partir de um ponto à frente do peito prometia bola
 * que o braço não alcançava (a bola ficava longe das mãos na pegada).
 */
export const defaultReachM = (wingspanM: number): number => Math.max(0.5, (wingspanM - 0.42) / 2 - 0.09);
/** X sem pulo: as mãos procuram a bola por até este tempo (s) depois do aperto. */
export const StandingCatchS = 0.45;
/** Abaixo disto (fração da altura) a pegada de mãos não vale: a bola está baixa demais (é a pegada de passar por cima). */
const WaistFrac = 0.5;
/** Raio da bola (m). */
const BallR = 0.119;

export interface CatchBody {
  /** Pés (núcleo, no chão) e a frente do corpo. */
  pos: Vec3;
  facing: Vec3;
  heightM: number;
  wingspanM: number;
  /** Altura (m) do meio dos ombros em pé e o alcance da palma a partir dele, medidos no esqueleto (ReboundCatch.start). */
  shoulderZ?: number;
  reachM?: number;
}

export interface CatchPlan {
  /** Centro da bola no contato (núcleo). */
  target: Vec3;
  /** s do aperto até o contato. */
  at: number;
  /** A bola passa ao alcance das mãos (senão as mãos vão até onde dá e voltam vazias). */
  reachable: boolean;
}

/** Meio dos ombros `t` s depois do aperto (com o pulo de `jumpM`): de onde os braços alcançam a bola. */
function handsCenter(body: CatchBody, t: number, jumpM: number): Vec3 {
  const lift = jumpM > 0 ? contestJumpAt(t, jumpM).lift : 0;
  return body.pos.flat().add(body.facing.flat().normalized().scale(0.05)).withZ((body.shoulderZ ?? body.heightM * 0.82) + lift);
}

/** Bola em queda livre `t` s adiante (sem quicar: o chão segura a altura). */
function ballAt(p: Vec3, v: Vec3, t: number): Vec3 {
  const q = p.add(v.scale(t)).add(new Vec3(0, 0, -4.905 * t * t));
  return q.z < BallR ? q.withZ(BallR) : q;
}

/**
 * Onde e quando as mãos encontram a bola: o primeiro instante (a partir do tempo mínimo de levar as mãos) em que a bola,
 * na trajetória dela, passa ao alcance do braço (no pulo, o alcance sobe com o corpo) e acima da cintura. Fora do
 * alcance: as mãos vão até onde dá, na direção da bola no instante em que ela passa mais perto.
 */
export function planCatch(ballP: Vec3, ballV: Vec3, body: CatchBody, jumpM: number): CatchPlan {
  const reach = body.reachM ?? defaultReachM(body.wingspanM);
  const t0 = CatchTiming.minReach;
  const t1 = jumpM > 0 ? ContestTiming.load + airTime(jumpM) : StandingCatchS;
  let best = { d: Infinity, t: t0, ball: ballP };
  for (let t = t0; t <= t1 + 1e-9; t += 1 / 60) {
    const b = ballAt(ballP, ballV, t);
    const c = handsCenter(body, t, jumpM);
    const d = b.sub(c).length();
    if (d <= reach && b.z >= body.heightM * WaistFrac) return { target: b, at: t, reachable: true };
    if (d < best.d) best = { d, t, ball: b };
  }
  const c = handsCenter(body, best.t, jumpM);
  const dir = best.ball.sub(c);
  const len = dir.length();
  let target = len > 1e-6 ? c.add(dir.scale(Math.min(reach, len) / len)) : c;
  if (target.z < body.heightM * WaistFrac) target = target.withZ(body.heightM * WaistFrac);
  return { target, at: best.t, reachable: false };
}

export class ReboundCatch {
  private attempt: { granted: boolean; plan: CatchPlan } | null = null;
  /** Meio das palmas no quadro anterior, com a bola dada (a bola anda junto com elas). */
  private prevMid: THREE.Vector3 | null = null;
  private readonly mid = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  /** Para o debug e o e2e: tentativas, pegadas dadas pelo juiz e o último plano. */
  readonly counts = { tries: 0, caught: 0 };
  lastPlan: CatchPlan | null = null;

  constructor(
    private readonly animator: PlayerAnimator,
    private readonly game: Freestyle,
  ) {}

  /** Uma pegada em andamento que o juiz ainda não deu. */
  get trying(): boolean {
    return !!this.attempt && !this.attempt.granted;
  }

  /** A bola está presa às mãos (o juiz deu). */
  get holding(): boolean {
    return !!this.attempt?.granted;
  }

  /**
   * X (`jumpM` = 0) ou Y (`jumpM` > 0, a altura do pulo) com a bola solta: planeja onde as mãos encontram a bola e toca
   * a pegada (o pulo vem junto). Sem bola à vista, as mãos vão à frente do peito.
   */
  start(ball: { p: Vec3; v: Vec3 } | null, body: CatchBody, jumpM: number): CatchPlan {
    body = { ...this.measureArms(), ...body };
    const plan = ball
      ? planCatch(ball.p, ball.v, body, jumpM)
      : { target: handsCenter(body, 0.2, 0).add(body.facing.flat().normalized().scale(0.3)), at: 0.2, reachable: false };
    this.animator.playCatch(toThree(plan.target), plan.at, jumpM);
    this.attempt = { granted: false, plan };
    this.lastPlan = plan;
    this.counts.tries++;
    return plan;
  }

  /** As mãos chegaram na bola (o meio das palmas a até CatchRadius dela), no fim do caminho delas: pode pedir ao juiz. */
  touching(ball: Vec3 | null): boolean {
    if (!this.attempt || this.attempt.granted || !ball) return false;
    const phase = this.animator.catchPhase();
    if (!phase || phase.phase === 'out' || (phase.phase === 'reach' && phase.u < 0.55)) return false;
    return fromThree(this.palmsMid()).sub(ball).length() <= CatchRadius;
  }

  /**
   * O juiz deu a bola para mim. Com as mãos nela, a bola sai de onde eu a via (`from`, mundo) e fica presa às mãos até o
   * drible (true); sem pegada em andamento, false (quem chama usa a pegada comum).
   */
  grant(from: THREE.Vector3): boolean {
    const phase = this.animator.catchPhase();
    if (!this.attempt || this.attempt.granted || !phase || phase.phase === 'out') return false;
    const g = this.game;
    g.phase = 'loose'; // a minha bola em voo (rebote ofensivo) sai do voo; a do outro passa a ser minha
    g.ball = makeBallState(fromThree(from));
    g.ballMesh.position.copy(from);
    g.ballMesh.visible = true;
    g.faceTarget = null;
    this.attempt.granted = true;
    this.prevMid = null;
    this.counts.caught++;
    return true;
  }

  /**
   * A cada quadro, depois do game.update. Com a bola dada: ela fica entre as palmas (até as mãos fecharem, vai até elas)
   * e, quando a pegada solta, desce para o drible (true nesse quadro). Sem a bola: a pegada vazia acaba sozinha.
   */
  update(): boolean {
    const a = this.attempt;
    if (!a) return false;
    const phase = this.animator.catchPhase();
    if (!a.granted) {
      if (!phase) this.attempt = null;
      return false;
    }
    const g = this.game;
    // A bola vai para o meio das palmas como elas estão (não para o ponto planejado: se o braço não chegou lá, a bola
    // ficava longe das mãos) e fica ali: anda junto com as palmas (sem atraso quando elas levam a bola ao peito) e a folga
    // da pegada (de onde a bola estava até as palmas) some em poucos quadros.
    const mid = this.palmsMid();
    const at = g.ballMesh.position.clone();
    if (this.prevMid) at.add(mid.clone().sub(this.prevMid));
    at.lerp(mid, 0.4);
    this.prevMid = mid.clone();
    g.ballMesh.position.copy(at);
    g.ball = makeBallState(fromThree(at));
    if (phase && phase.phase !== 'out') return false;
    // Solta: a bola vai das mãos para a mão do drible (o fim da volta da bola do Freestyle, sem o arco de passe).
    this.attempt = null;
    g.dribbler.position.copy(g.ballMesh.position);
    g.phase = 'dribble';
    g.dribbler.take(g.dribbler.ballHand());
    return true;
  }

  /** O outro pegou, ou a posse acabou: as mãos largam. */
  cancel(): void {
    if (!this.attempt) return;
    if (!this.attempt.granted) this.animator.cancelCatch();
    this.attempt = null;
  }

  /**
   * Ombros e braço do esqueleto agora (o boneco escalado pela altura e com o braço da envergadura): a altura do meio dos
   * ombros em pé e o alcance da palma a partir dele (95% do braço esticado: o IK alcança o alvo com folga).
   */
  private measureArms(): { shoulderZ: number; reachM: number } {
    const a = this.animator;
    const p = (name: string) => a.bone(name).getWorldPosition(new THREE.Vector3());
    const sl = p('upperarm_l');
    const sr = p('upperarm_r');
    const arm = sl.distanceTo(p('lowerarm_l')) + p('lowerarm_l').distanceTo(p('hand_l')) + p('hand_l').distanceTo(a.palmWorld('l', new THREE.Vector3()));
    const shoulderZ = (sl.y + sr.y) / 2 - a.root.position.y - a.defenseState().jump;
    return { shoulderZ, reachM: 0.95 * arm };
  }

  /** Meio das duas palmas (mundo). */
  private palmsMid(): THREE.Vector3 {
    return this.animator.palmWorld('l', this.mid).add(this.animator.palmWorld('r', this.tmp)).multiplyScalar(0.5);
  }
}
