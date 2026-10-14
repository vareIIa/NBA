// Bola no drible, presa à mão ANIMADA:
//  - "held": o centro da bola fica logo abaixo da palma (a mão empurra por cima), ou entre as mãos no arremesso.
//  - "air": o animador avisou a soltura (vale da palma / quadro de soltura do drible). O quique é o arco do núcleo
//    (DribbleArc: mão -> chão -> mão) no REFERENCIAL DO JOGADOR, então a bola nunca fica para trás quando ele anda.
//    O fim do arco é a palma prevista no quadro da recepção; no último trecho a bola é puxada para a palma real
//    (as camadas podem ter mudado no meio do quique), e a recepção acontece sem salto.
import * as THREE from 'three';
import { type DribbleArc, Vec3, makeDribbleArc } from '../sim';
import type { BallRelease, PlayerAnimator } from '../anim/PlayerAnimator';
import type { Hand } from '../anim/ClipLibrary';
import { fromThree, toThree } from '../units';

export type GripMode = 'dribble' | 'shot';

const MagnetFraction = 0.3; // último trecho do arco puxado para a palma real
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const offset = new THREE.Vector3(); // só para os deslocamentos da pegada (nunca é o vetor de saída)
const otherPalm = new THREE.Vector3();
const inv = new THREE.Matrix4();

export class BallDribbler {
  mode: 'held' | 'air' = 'held';
  hand: Hand = 'r';
  grip: GripMode = 'dribble';
  /** Posição da bola (mundo, three). */
  readonly position = new THREE.Vector3();
  /** Quiques no chão neste quadro (velocidade de chegada, m/s), para o som. */
  bounces: number[] = [];

  private arc: DribbleArc | null = null;
  private arcTime = 0;
  private gripBlend = 1; // 0..1: suaviza a troca de pegada (drible <-> arremesso)
  private readonly gripFrom = new THREE.Vector3();

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

  /** Troca a pegada (o centro desliza para o novo ponto em ~0,12 s). */
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

    if (this.mode === 'held') {
      this.gripPoint(animator, this.hand, this.grip, tmp);
      if (this.gripBlend < 1) {
        this.gripBlend = Math.min(1, this.gripBlend + dt / 0.12);
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
    }
  }

  private launch(release: BallRelease, animator: PlayerAnimator): void {
    // Começo: onde a bola está agora; fim: a palma da mão que recebe, prevista no quadro da recepção.
    inv.copy(animator.root.matrixWorld).invert();
    const startLocal = tmp.copy(this.position).applyMatrix4(inv);
    // catchModel está no espaço do modelo escalado; o modelo fica no root com o deslocamento vertical do bind pose.
    const endLocal = tmp2
      .copy(release.catchModel)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), animator.model.rotation.y)
      .add(new THREE.Vector3(0, animator.model.position.y - this.radius * 1.02, 0));
    const period = Math.min(0.75, Math.max(0.16, release.catchIn));
    const arc = makeDribbleArc(fromThree(startLocal), fromThree(endLocal), new Vec3(), period, this.radius);
    // O quique cai um pouco à frente do corpo (no crossover, no meio do caminho entre as mãos).
    if (!release.move) arc.floorPos = arc.floorPos.add(new Vec3(0, 0.06, 0)); // núcleo: y = frente local (z do three)
    // Quique mais rápido para baixo no drible normal (a mão empurra forte).
    arc.downSeconds = period * (release.move ? 0.45 : 0.4);
    arc.upSeconds = period - arc.downSeconds;
    this.arc = arc;
    this.arcTime = 0;
    this.mode = 'air';
    this.hand = release.toHand;
  }
}
