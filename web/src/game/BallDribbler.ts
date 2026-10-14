// Bola no drible, presa à mão ANIMADA:
//  - "held": o centro da bola fica logo abaixo da palma (a mão empurra por cima), entre as mãos no arremesso, ou no
//    caminho que um drible procedural define (behind the back).
//  - "air": o animador avisou a soltura. O quique é o arco do núcleo (DribbleArc: mão -> chão -> mão) no REFERENCIAL
//    DO JOGADOR (a bola nunca fica para trás quando ele anda), com a divisão descida/subida tirada da física: a bola
//    sai do chão com ~78% da velocidade de chegada (restituição da madeira). O fim do arco é a recepção prevista; no
//    último trecho a bola é puxada para a palma real, e a recepção acontece sem salto.
import * as THREE from 'three';
import { type DribbleArc, Vec3, makeDribbleArc } from '../sim';
import type { BallRelease, PlayerAnimator } from '../anim/PlayerAnimator';
import type { Hand } from '../anim/ClipLibrary';
import { fromThree, toThree } from '../units';

export type GripMode = 'dribble' | 'shot';

const MagnetFraction = 0.25; // último trecho do arco puxado para a palma real
const Restitution = 0.78; // saída / chegada no chão (madeira; regra da FIBA dá 0,73–0,80)
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const offset = new THREE.Vector3(); // só para os deslocamentos da pegada (nunca é o vetor de saída)
const otherPalm = new THREE.Vector3();
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
  private gripBlend = 1; // 0..1: suaviza a troca de pegada (drible <-> arremesso <-> procedural)
  private readonly gripFrom = new THREE.Vector3();
  private procedural = false;

  constructor(private readonly radius: number) {}

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

  update(dt: number, animator: PlayerAnimator): void {
    this.bounces = [];
    for (const release of animator.releases) {
      if (this.mode === 'held' && release.fromHand !== this.hand && !release.move) continue; // não é a mão da bola
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
      }
      if (this.gripBlend < 1) {
        this.gripBlend = Math.min(1, this.gripBlend + dt / 0.1);
        const s = this.gripBlend * this.gripBlend * (3 - 2 * this.gripBlend);
        this.position.copy(this.gripFrom).lerp(tmp, s);
      } else {
        this.position.copy(tmp);
      }
      return;
    }

    // No ar: arco no referencial do jogador.
    const arc = this.arc!;
    const before = this.arcTime;
    this.arcTime += dt;
    if (before < arc.downSeconds && this.arcTime >= arc.downSeconds) this.bounces.push(arc.floorEntrySpeed());
    const local = toThree(arc.evaluate(this.arcTime), tmp);
    const world = local.applyMatrix4(animator.root.matrixWorld);
    const total = arc.totalSeconds();
    const magnetStart = total * (1 - MagnetFraction);
    if (this.arcTime > magnetStart) {
      const real = this.gripPoint(animator, this.hand, 'dribble', tmp2);
      const a = Math.min(1, (this.arcTime - magnetStart) / (total - magnetStart));
      world.lerp(real, a * a);
    }
    this.position.copy(world);
    if (this.arcTime >= total) {
      this.mode = 'held';
      this.arc = null;
      this.gripBlend = 1;
      this.procedural = false;
    }
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
    downFractionFor(arc, total);
    this.arc = arc;
    this.arcTime = 0;
    this.mode = 'air';
    this.hand = release.toHand;
    this.procedural = false;
  }
}
