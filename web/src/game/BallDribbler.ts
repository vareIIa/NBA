// Bola no drible, presa à mão ANIMADA:
//  - "held": o centro da bola fica logo abaixo da palma (a mão empurra por cima), entre as mãos no arremesso, ou no
//    caminho que um drible procedural define (behind the back).
//  - "air": o animador avisou a soltura. O quique é o arco do núcleo (DribbleArc: mão -> chão -> mão) no REFERENCIAL
//    DO JOGADOR (a bola nunca fica para trás quando ele anda), com a divisão descida/subida tirada da física: a bola
//    sai do chão com ~78% da velocidade de chegada (restituição da madeira). A descida começa com a velocidade da mão
//    (a bola é EMPURRADA para fora da mão, sem salto de velocidade) e acelera até o chão. O fim do arco é a recepção
//    prevista; na subida o desvio até a palma real é corrigido aos poucos, e na recepção a mão "cede" com a bola (a
//    velocidade da bola chega à da mão em ~0,1 s): nada salta de um quadro para o outro.
import * as THREE from 'three';
import { type DribbleArc, Vec3, makeDribbleArc } from '../sim';
import type { BallRelease, PlayerAnimator } from '../anim/PlayerAnimator';
import type { Hand } from '../anim/ClipLibrary';
import { fromThree, toThree } from '../units';

export type GripMode = 'dribble' | 'shot';

const Restitution = 0.78; // saída / chegada no chão (madeira; regra da FIBA dá 0,73–0,80)
/** Recepção: a diferença de velocidade entre a bola e a mão some em d(t) = Δv·t·e^(-t/τ) (a mão cede com a bola). */
const AbsorbTau = 0.035;
/** m: o máximo que a bola presa se afasta da palma para não atravessar a perna. */
const HeldClearanceMax = 0.04;
/** 1/s: rapidez com que o desvio da bola no ar (para não atravessar a perna) entra e sai. */
const AirClearanceRate = 30;
const Gravity = 9.81;
/** Peso do casamento da velocidade de chegada da bola com a da mão na recepção, contra o erro da restituição. */
const CatchMatchWeight = 0.35;
/**
 * Quique no referencial da QUADRA (experimental, `?quique=quadra`): o arco é planejado no referencial do jogador no
 * instante da soltura e depois segue no mundo, herdando a velocidade do jogador (a bola sai da mão com ela); girar o
 * corpo no meio do quique não varre a bola no ar. Laboratório (2026-10-16, 9 cenários em movimento): saltos da bola
 * 163 -> 154 quadros e o spin correndo sem bola no corpo, mas bola no corpo 16 -> 20 quadros no total e o pior salto do
 * zigue-zague maior (a mão vai para onde o jogador foi e a bola corrige no caminho). Desligado até resolver isso.
 */
const CourtFrameBounce = typeof location !== 'undefined' && new URLSearchParams(location.search).get('quique') === 'quadra';
/** s: constante do filtro da velocidade do jogador (a da soltura não pode ser a de um quadro com tranco). */
const RootVelocityTau = 0.06;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const offset = new THREE.Vector3(); // só para os deslocamentos da pegada (nunca é o vetor de saída)
const otherPalm = new THREE.Vector3();
const tmpDrift = new THREE.Vector3();
const inv = new THREE.Matrix4();

/**
 * Fração da descida no tempo total do quique para a bola sair do chão com `restitution` da velocidade de chegada.
 * Busca simples (o arco é monotônico na fração); limitada a 25–55%.
 */
export function downFractionFor(arc: DribbleArc, total: number, restitution = Restitution): number {
  let best = 0.4;
  let bestErr = Infinity;
  for (let f = 0.25; f <= 0.551; f += 0.01) {
    arc.downSeconds = total * f;
    arc.upSeconds = total - arc.downSeconds;
    const entry = arc.floorEntrySpeed();
    const exit = arc.floorExitSpeed();
    if (entry <= 0) continue;
    const err = Math.abs(exit / entry - restitution);
    if (err < bestErr) {
      bestErr = err;
      best = f;
    }
  }
  arc.downSeconds = total * best;
  arc.upSeconds = total - arc.downSeconds;
  return best;
}

export class BallDribbler {
  mode: 'held' | 'air' = 'held';
  hand: Hand = 'r';
  grip: GripMode = 'dribble';
  /** Posição da bola (mundo, three). */
  readonly position = new THREE.Vector3();
  /** Quiques no chão neste quadro (velocidade de chegada, m/s), para o som e o achatamento. */
  bounces: number[] = [];

  private arc: DribbleArc | null = null;
  private arcTime = 0;
  /** Descida empurrada (referencial do jogador, three): p(t) = p0 + v0·t + a·t²/2 até o chão em td. */
  private readonly push = { p0: new THREE.Vector3(), v0: new THREE.Vector3(), acc: new THREE.Vector3(), td: 0 };
  /** Recepção prevista (fim do arco, referencial do jogador). */
  private readonly catchLocal = new THREE.Vector3();
  /** Velocidade da bola (mundo) e no referencial do jogador, do último quadro. */
  private readonly velocity = new THREE.Vector3();
  private readonly localVelocity = new THREE.Vector3();
  private readonly prevWorld = new THREE.Vector3();
  private readonly prevLocal = new THREE.Vector3();
  private tracked = false;
  /** Ponto de pegada de cada mão no quadro anterior e a velocidade dele (para a recepção sem salto). */
  private readonly prevGrip = { l: new THREE.Vector3(), r: new THREE.Vector3() };
  private readonly gripVelocity = { l: new THREE.Vector3(), r: new THREE.Vector3() };
  private gripTracked = false;
  private readonly absorb = { t: Infinity, dv: new THREE.Vector3() };
  private readonly airClearance = new THREE.Vector3();
  private gripBlend = 1; // 0..1: suaviza a troca de pegada (drible <-> arremesso <-> procedural)
  private readonly gripFrom = new THREE.Vector3();
  private procedural = false;
  /** Quique na quadra: pose do jogador na soltura e a velocidade dele (mundo) herdada pela bola. */
  private readonly releaseMatrix = new THREE.Matrix4();
  private readonly releaseVelocity = new THREE.Vector3();
  private readonly releaseRoot = new THREE.Vector3();
  private readonly rootVelocity = new THREE.Vector3();
  private readonly prevRoot = new THREE.Vector3();
  private rootTracked = false;

  constructor(private readonly radius: number) {}

  /**
   * Arco (referencial do jogador na soltura) -> mundo no tempo t do quique. `follow` (0..1): quanto do desvio entre onde
   * o jogador está e onde a extrapolação da soltura o punha a bola acompanha. Cresce ao longo do arco inteiro (não só na
   * subida): com a correção toda na subida, no zigue-zague a bola dava o salto concentrado ali.
   */
  private arcToWorld(local: THREE.Vector3, t: number, animator: PlayerAnimator, follow: number): THREE.Vector3 {
    if (!CourtFrameBounce) return local.applyMatrix4(animator.root.matrixWorld);
    local.applyMatrix4(this.releaseMatrix).addScaledVector(this.releaseVelocity, t);
    const drift = tmpDrift.copy(animator.root.position).sub(this.releaseRoot).addScaledVector(this.releaseVelocity, -t).setY(0);
    return local.addScaledVector(drift, follow);
  }

  /** Onde o centro da bola fica preso à mão agora (mundo). */
  gripPoint(animator: PlayerAnimator, hand: Hand, mode: GripMode, out = new THREE.Vector3()): THREE.Vector3 {
    const palm = animator.palmWorld(hand, out);
    if (mode === 'shot') {
      // Arremesso: entre as duas palmas quando estão juntas; senão logo acima da palma que arremessa.
      const other = animator.palmWorld(hand === 'r' ? 'l' : 'r', otherPalm);
      const gap = palm.distanceTo(other);
      if (gap < 0.34) return palm.lerp(other, 0.4).add(offset.set(0, 0.05, 0));
      return palm.add(offset.set(0, this.radius * 0.85, 0));
    }
    return palm.add(offset.set(0, -this.radius * 1.02, 0));
  }

  /** Troca a pegada (o centro desliza para o novo ponto em ~0,1 s). */
  setGrip(mode: GripMode): void {
    if (mode === this.grip) return;
    this.grip = mode;
    this.gripFrom.copy(this.position);
    this.gripBlend = 0;
  }

  /** Força a bola na mão (posse nova). snap = gruda na hora (início do jogo); senão desliza da posição atual. */
  take(hand: Hand, snap = false): void {
    this.mode = 'held';
    this.hand = hand;
    this.arc = null;
    this.gripFrom.copy(this.position);
    this.gripBlend = snap ? 1 : 0;
  }

  /** Mão que tem (ou vai receber) a bola: os loops da base usam esta. */
  ballHand(): Hand {
    return this.hand;
  }

  /** s até a bola no ar chegar à mão (0 se ela já está na mão). */
  timeToCatch(): number {
    return this.mode === 'held' || !this.arc ? 0 : Math.max(0, this.arc.totalSeconds() - this.arcTime);
  }

  /** A bola no ar já quicou e está subindo para a mão. */
  ascending(): boolean {
    return this.mode === 'air' && this.arcTime >= this.push.td;
  }

  update(dt: number, animator: PlayerAnimator): void {
    this.bounces = [];
    this.trackGrips(dt, animator);
    const root = animator.root.position;
    if (this.rootTracked && dt > 1e-6) {
      tmp.copy(root).sub(this.prevRoot).divideScalar(dt);
      this.rootVelocity.lerp(tmp, 1 - Math.exp(-dt / RootVelocityTau));
    }
    this.prevRoot.copy(root);
    this.rootTracked = true;
    for (const release of animator.releases) {
      if (this.mode === 'held' && release.fromHand !== this.hand && !release.move) continue; // não é a mão da bola
      // Soltura do loop com a bola ainda no ar (o loop trocou no meio do quique): a bola não está na mão, não sai de novo.
      if (this.mode === 'air' && !release.move) continue;
      this.launch(release, animator);
    }

    // Drible procedural começou com a bola no ar: ela vem para a mão na hora (o comando responde já).
    if (this.mode === 'air' && animator.ballHeldLocal) {
      this.mode = 'held';
      this.arc = null;
    }

    if (this.mode === 'held') {
      const held = animator.ballHeldLocal;
      if (held) {
        tmp.copy(held).applyMatrix4(animator.root.matrixWorld);
        if (!this.procedural) {
          this.procedural = true;
          this.gripFrom.copy(this.position);
          this.gripBlend = 0;
        }
      } else {
        if (this.procedural) {
          this.procedural = false;
          this.gripFrom.copy(this.position);
          this.gripBlend = 0;
        }
        this.gripPoint(animator, this.hand, this.grip, tmp);
        // Garantia final: quando o braço não alcança (esticado, quadril baixo), a bola sai da perna mesmo longe 1–2 cm
        // da palma; atravessar a coxa é pior que um vão pequeno.
        // Mesma regra de direção da mão (por fora do joelho do mesmo lado, pela frente da outra perna): a bola não se
        // separa da palma para um lado diferente do que a mão foi.
        // A bola presa não se solta da mão para sair da perna além de HeldClearanceMax: quem sai é a mão (applyBallClearance
        // no animador). Com a mão entre os joelhos no fim do crossover a bola ia 46 cm para longe dela.
        if (this.grip === 'dribble') tmp.add(animator.legClearance(tmp, this.radius, tmp2, this.hand).clampLength(0, HeldClearanceMax));
        // Recepção: a mão cede com a bola (a velocidade dela vira a da mão em ~0,1 s, sem salto).
        if (this.absorb.t < AbsorbTau * 8) {
          this.absorb.t += dt;
          tmp.addScaledVector(this.absorb.dv, this.absorb.t * Math.exp(-this.absorb.t / AbsorbTau));
        }
        // Nunca abaixo do chão: no spin baixo a palma chega a ~20 cm e a bola presa embaixo dela entrava no piso.
        tmp.y = Math.max(tmp.y, this.radius);
      }
      if (this.gripBlend < 1) {
        this.gripBlend = Math.min(1, this.gripBlend + dt / 0.1);
        const s = this.gripBlend * this.gripBlend * (3 - 2 * this.gripBlend);
        this.position.copy(this.gripFrom).lerp(tmp, s);
      } else {
        this.position.copy(tmp);
      }
      this.trackBall(dt, animator);
      return;
    }

    // No ar: arco no referencial do jogador.
    const arc = this.arc!;
    const before = this.arcTime;
    this.arcTime += dt;
    const P = this.push;
    if (before < P.td && this.arcTime >= P.td) {
      this.bounces.push(Math.abs(P.v0.y + P.acc.y * P.td));
    }
    const total = arc.totalSeconds();
    const t = Math.min(this.arcTime, total);
    // Descida empurrada (sai com a velocidade da mão); subida balística do núcleo.
    const local = t <= P.td ? tmp.copy(P.p0).addScaledVector(P.v0, t).addScaledVector(P.acc, 0.5 * t * t) : toThree(arc.evaluate(t), tmp);
    const u = THREE.MathUtils.clamp(t / Math.max(1e-3, total), 0, 1);
    const world = this.arcToWorld(local, t, animator, u * u * (3 - 2 * u));
    // Na subida, o desvio entre a recepção prevista e a palma real entra aos poucos (smoothstep): no fim do arco a bola
    // está na palma, sem o puxão de ímã dos últimos quadros.
    const s = THREE.MathUtils.clamp((t - P.td) / Math.max(1e-3, total - P.td), 0, 1);
    if (s > 0) {
      const real = this.gripPoint(animator, this.hand, 'dribble', tmp2);
      const predicted = this.arcToWorld(otherPalm.copy(this.catchLocal), total, animator, 1);
      world.addScaledVector(real.sub(predicted), s * s * (3 - 2 * s));
    }
    // O arco é cinemático: se passaria por dentro de uma perna, contorna por fora dela (a bola não atravessa o corpo).
    // Mesma regra da bola presa (por fora do joelho do lado da mão): trocar de regra na soltura empurrava a bola 3 cm.
    // O desvio entra e sai suave (AirClearanceRate): aplicado inteiro num quadro, a bola saltava até 30 cm.
    this.airClearance.lerp(animator.legClearance(world, this.radius, tmp2, this.hand), 1 - Math.exp(-AirClearanceRate * dt));
    // Some no fim da subida: na recepção a bola tem de estar na palma (aplicado até o fim, ela chegava 14 cm fora e saltava
    // para a mão no quadro seguinte, no entre as pernas).
    const near = THREE.MathUtils.smoothstep(t / total, 0.85, 1);
    world.addScaledVector(this.airClearance, 1 - near);
    world.y = Math.max(world.y, this.radius);
    this.position.copy(world);
    if (this.arcTime >= total) {
      this.mode = 'held';
      this.arc = null;
      this.gripBlend = 1;
      this.procedural = false;
      // A bola chega subindo mais rápido que a mão: a diferença some na mão que cede (absorb).
      if (dt > 1e-6 && this.tracked) {
        const arrival = tmp2.copy(this.position).sub(this.prevWorld).divideScalar(dt);
        this.absorb.dv.copy(arrival).sub(this.gripVelocity[this.hand]);
        if (this.absorb.dv.length() > 6) this.absorb.dv.setLength(6);
        this.absorb.t = 0;
      }
    }
    this.trackBall(dt, animator);
  }

  /** Velocidade das pegadas das duas mãos (mundo), para a recepção casar a velocidade da bola com a da mão. */
  private trackGrips(dt: number, animator: PlayerAnimator): void {
    for (const hand of ['l', 'r'] as const) {
      const grip = this.gripPoint(animator, hand, 'dribble', tmp);
      if (this.gripTracked && dt > 1e-6) this.gripVelocity[hand].copy(grip).sub(this.prevGrip[hand]).divideScalar(dt);
      this.prevGrip[hand].copy(grip);
    }
    this.gripTracked = true;
  }

  /** Velocidade da bola no quadro (mundo e referencial do jogador): a soltura parte dela. */
  private trackBall(dt: number, animator: PlayerAnimator): void {
    inv.copy(animator.root.matrixWorld).invert();
    const local = tmp.copy(this.position).applyMatrix4(inv);
    if (this.tracked && dt > 1e-6) {
      this.velocity.copy(this.position).sub(this.prevWorld).divideScalar(dt);
      this.localVelocity.copy(local).sub(this.prevLocal).divideScalar(dt);
    }
    this.prevWorld.copy(this.position);
    this.prevLocal.copy(local);
    this.tracked = true;
  }

  private launch(release: BallRelease, animator: PlayerAnimator): void {
    // Começo: onde a bola está agora; fim: a recepção prevista (referencial do jogador).
    inv.copy(animator.root.matrixWorld).invert();
    const startLocal = tmp.copy(this.position).applyMatrix4(inv);
    const total = Math.min(0.75, Math.max(0.16, release.catchIn));
    const arc = makeDribbleArc(fromThree(startLocal), fromThree(release.catchLocal), new Vec3(), total, this.radius);
    if (release.floorLocal) {
      arc.floorPos = fromThree(release.floorLocal).withZ(this.radius);
    } else if (!release.move) {
      arc.floorPos = arc.floorPos.add(new Vec3(0, 0.05, 0)); // núcleo: y = frente local (z do three)
    }
    // Descida empurrada: parte da velocidade que a bola tinha na mão (nunca para cima) e acelera até o chão. O tempo de
    // descida é o que deixa a bola sair do chão com a restituição da madeira.
    const v0 = this.localVelocity.clone();
    if (v0.y > 0) v0.y = 0;
    if (v0.length() > 8) v0.setLength(8);
    const floor = toThree(arc.floorPos, new THREE.Vector3());
    const drop = floor.y - startLocal.y; // negativo
    let best = 0.4;
    let bestErr = Infinity;
    for (let f = 0.25; f <= 0.551; f += 0.01) {
      const td = total * f;
      const ay = (2 * (drop - v0.y * td)) / (td * td);
      if (ay > -0.8 * Gravity) continue; // a bola não freia saindo da mão
      arc.downSeconds = td;
      arc.upSeconds = total - td;
      const entry = -(v0.y + ay * td);
      let err = entry > 0 ? Math.abs(arc.floorExitSpeed() / entry - Restitution) : Infinity;
      // Recepção: a bola chega com a velocidade da mão que sobe para pegá-la (o quique termina no "topo" do contato, não
      // numa pancada contra a palma). Pesa menos que a restituição: ela continua entre ~0,7 e 0,85.
      if (release.catchSpeedY !== undefined && entry > 0) {
        const arrive = arc.floorExitSpeed() - arc.gravity * arc.upSeconds;
        err += CatchMatchWeight * (Math.abs(arrive - release.catchSpeedY) / Math.max(1, entry));
      }
      if (err < bestErr) {
        bestErr = err;
        best = f;
      }
    }
    if (bestErr === Infinity) downFractionFor(arc, total);
    else {
      arc.downSeconds = total * best;
      arc.upSeconds = total - arc.downSeconds;
    }
    const td = arc.downSeconds;
    this.push.td = td;
    this.push.p0.copy(startLocal);
    this.push.v0.copy(v0);
    this.push.acc.copy(floor).sub(startLocal).addScaledVector(v0, -td).multiplyScalar(2 / (td * td));
    this.catchLocal.copy(release.catchLocal);
    this.releaseMatrix.copy(animator.root.matrixWorld);
    this.releaseVelocity.copy(this.rootVelocity).setY(0);
    this.releaseRoot.copy(animator.root.position);
    this.arc = arc;
    this.arcTime = 0;
    this.absorb.t = Infinity;
    this.mode = 'air';
    this.hand = release.toHand;
    this.procedural = false;
  }
}
