// Defesa sem bola (online 1x1, docs/24 §6, e o 1x1 contra a CPU, docs/25): mãos para cima (RS para cima), o pulo de
// contestação/toco (Y) com os dois braços esticados, o tapa do roubo (X), a postura de defesa (agachado, mãos abertas) e
// o tapa do toco (a mão vai até a bola no instante do contato). Por procedimento, como os gestos do IdleLife: as mãos vão
// por IK (o reachPalm do animador) para alvos no referencial do corpo e o pulo sobe a pelve (o esqueleto inteiro vai
// junto) depois dos IKs; o agachamento da postura entra no applyStance do animador (stanceCrouch).
// Os tempos são funções puras (contestJumpAt, stealReachAt): o boneco remoto repete o mesmo comando e chega à mesma pose,
// e a contestação do arremessador lê a mesma altura de pulo e o mesmo quanto das mãos está em cima.
import * as THREE from 'three';

type Side = 'l' | 'r';

export interface DefenseRig {
  bone(name: string): THREE.Bone;
  reachPalm(hand: Side, target: THREE.Vector3, weight: number, pole: THREE.Vector3): void;
  readonly root: THREE.Object3D;
}

const G = 9.81;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** Pulo de contestação: agacha (load), sobe, fica no ar o tempo do pulo, pousa; os braços sobem já no agachamento. */
export const ContestTiming = {
  /** Do aperto à decolagem (s). */
  load: 0.1,
  /** Braços chegam em cima (s desde o aperto). */
  armsIn: 0.14,
  /** Braços ficam em cima depois do pouso e descem em armsOut s. */
  landHold: 0.06,
  armsOut: 0.3,
};

/** Tempo no ar (s) de um pulo de `heightM`: 2·√(2h/g). */
export const airTime = (heightM: number): number => 2 * Math.sqrt((2 * Math.max(0, heightM)) / G);

/** Pulo de contestação a `t` s do aperto: altura (m), braços em cima (0..1), no ar e terminado. */
export function contestJumpAt(t: number, heightM: number): { lift: number; arms: number; airborne: boolean; done: boolean } {
  const T = ContestTiming;
  const air = airTime(heightM);
  const land = T.load + air;
  const u = (t - T.load) / Math.max(1e-3, air);
  const airborne = u > 0 && u < 1;
  const lift = airborne ? 4 * heightM * u * (1 - u) : 0; // parábola: sobe e desce como um corpo em queda livre
  const arms = smooth(t / T.armsIn) * (1 - smooth((t - land - T.landHold) / T.armsOut));
  return { lift, arms, airborne, done: t >= land + T.landHold + T.armsOut };
}

/** Tapa do roubo: a mão vai em `out` s, fica `hold` s e volta em `back` s. */
export const StealTiming = { out: 0.11, hold: 0.06, back: 0.24 };

/**
 * Toco (swat): a mão chega ao ponto do contato no instante dele (em pelo menos `minReach` s), segue o tapa por `follow` s
 * na direção da batida (`followM` m) e volta em `back` s.
 */
export const SwatTiming = { minReach: 0.07, follow: 0.12, followM: 0.32, back: 0.3 };

/** Quanto (0..1) da mão do toco está no alvo a `t` s do comando, com o contato em `at` s; e quanto do tapa já seguiu. */
export function swatAt(t: number, at: number): { w: number; follow: number; done: boolean } {
  const S = SwatTiming;
  const reach = Math.max(S.minReach, at);
  if (t < 0) return { w: 0, follow: 0, done: false };
  if (t < reach) return { w: smooth(t / reach), follow: 0, done: false };
  const u = t - reach;
  if (u < S.follow) return { w: 1, follow: smooth(u / S.follow), done: false };
  const back = (u - S.follow) / S.back;
  return { w: 1 - smooth(back), follow: 1, done: back >= 1 };
}

/** Postura de defesa: quanto (m) o quadril desce com a postura toda (o agachamento sem bola é 0,03 m). */
export const StanceCrouchM = 0.13;

/** Quanto (0..1) da mão do tapa está estendida a `t` s do aperto. */
export function stealReachAt(t: number): number {
  const S = StealTiming;
  if (t < 0 || t >= S.out + S.hold + S.back) return 0;
  return smooth(t / S.out) * (1 - smooth((t - S.out - S.hold) / S.back));
}

/**
 * Alvos das mãos no referencial do corpo (boneco de 1,86 m; a altura da build escala com o root): x = para fora (lado da
 * mão), y = altura, z = frente. Mãos para cima: acima do alcance (o IK estica o braço todo, um pouco à frente da cabeça).
 * Tapa: baixo e à frente, na altura do drible do atacante.
 */
const HandsUp: [number, number, number] = [0.17, 2.5, 0.16];
const StealPalm: [number, number, number] = [0.1, 0.92, 0.78];
/** Postura: mãos abertas para fora dos ombros, na altura da cintura (sem o agachamento), um pouco à frente. */
const StancePalm: [number, number, number] = [0.52, 1.06, 0.3];

export class DefenseMotion {
  private holdTarget = false;
  /** Mãos para cima do RS (suavizado). */
  private holdW = 0;
  /** Postura de defesa pedida (0..1) e a suavizada. */
  private stanceTarget = 0;
  private stanceW = 0;
  /** O pulo tira a postura (as pernas esticam no ar); volta suave depois do pouso. */
  private jumpFade = 0;
  /** Toco em andamento: a mão vai até o contato e segue o tapa. */
  private swat: { hand: Side; t: number; at: number; target: THREE.Vector3; dir: THREE.Vector3 } | null = null;
  private swatW = 0;
  private swatFollow = 0;
  private jumpT = Infinity;
  private jumpH = 0;
  private stealT = Infinity;
  private stealHand: Side = 'r';
  /** Some com a bola na mão (pegou o rebote no ar): os braços largam a pose da defesa. */
  private freeW = 1;
  private lift = 0;
  private arms = 0;
  private reach = 0;

  setHandsUp(up: boolean): void {
    this.holdTarget = up;
  }

  /** Começa o pulo de `heightM`. false se ainda está no ar (um pulo de cada vez). */
  jump(heightM: number): boolean {
    if (this.airborne) return false;
    this.jumpT = 0;
    this.jumpH = THREE.MathUtils.clamp(heightM, 0, 1.2);
    return true;
  }

  steal(hand: Side): void {
    this.stealT = 0;
    this.stealHand = hand;
  }

  /** Postura de defesa (0..1): agachado com as mãos abertas. Quem defende liga perto do atacante. */
  setStance(w: number): void {
    this.stanceTarget = THREE.MathUtils.clamp(w, 0, 1);
  }

  /** Quanto (m) o quadril desce pela postura agora (o applyStance do animador soma no agachamento sem bola). */
  stanceCrouch(): number {
    return StanceCrouchM * this.stanceW * this.freeW * (1 - this.jumpFade);
  }

  /** Postura agora (0..1), para o debug e o boneco. */
  stance(): number {
    return this.stanceW * this.freeW;
  }

  /**
   * Toco: a mão `hand` chega a `target` (mundo, onde a bola vai estar) em `inS` s e segue o tapa na direção `dir` (mundo;
   * sem ela, para a frente e para baixo do corpo). Sem pulo também vale (o tapa na bola da bandeja de quem está colado).
   */
  block(hand: Side, target: THREE.Vector3, inS: number, dir?: THREE.Vector3): void {
    this.swat = { hand, t: 0, at: Math.max(0, inS), target: target.clone(), dir: dir ? dir.clone().normalize() : new THREE.Vector3() };
  }

  /** Pulo em andamento: s desde o aperto e a altura (m); null fora dele. O toco físico (sim/HoopsBlock) projeta daqui. */
  jumpPhase(): { t: number; h: number } | null {
    return Number.isFinite(this.jumpT) ? { t: this.jumpT, h: this.jumpH } : null;
  }

  get airborne(): boolean {
    return Number.isFinite(this.jumpT) && contestJumpAt(this.jumpT, this.jumpH).airborne;
  }

  /** Mãos para cima (0..1) e altura do pulo (m) agora. */
  state(): { handsUp: number; jump: number } {
    return { handsUp: Math.max(this.holdW, this.arms) * this.freeW, jump: this.lift };
  }

  update(dt: number, hasBall: boolean): void {
    this.holdW += ((this.holdTarget ? 1 : 0) - this.holdW) * (1 - Math.exp(-(this.holdTarget ? 16 : 9) * dt));
    this.freeW += ((hasBall ? 0 : 1) - this.freeW) * (1 - Math.exp(-14 * dt));
    this.stanceW += (this.stanceTarget - this.stanceW) * (1 - Math.exp(-(this.stanceTarget > this.stanceW ? 7 : 5) * dt));
    this.lift = 0;
    this.arms = 0;
    if (Number.isFinite(this.jumpT)) {
      this.jumpT += dt;
      const j = contestJumpAt(this.jumpT, this.jumpH);
      this.lift = j.lift;
      this.arms = j.arms;
      if (j.done) this.jumpT = Infinity;
    }
    this.jumpFade += ((Number.isFinite(this.jumpT) ? 1 : 0) - this.jumpFade) * (1 - Math.exp(-(Number.isFinite(this.jumpT) ? 20 : 6) * dt));
    this.reach = 0;
    if (Number.isFinite(this.stealT)) {
      this.stealT += dt;
      this.reach = stealReachAt(this.stealT);
      if (this.stealT >= StealTiming.out + StealTiming.hold + StealTiming.back) this.stealT = Infinity;
    }
    this.swatW = 0;
    this.swatFollow = 0;
    if (this.swat) {
      this.swat.t += dt;
      const s = swatAt(this.swat.t, this.swat.at);
      this.swatW = s.w;
      this.swatFollow = s.follow;
      if (s.done) this.swat = null;
    }
  }

  /** Braços (por último entre os IKs dos braços) e o pulo (sobe a pelve, o corpo inteiro vai junto). */
  apply(rig: DefenseRig): void {
    const up = Math.max(this.holdW, this.arms) * this.freeW;
    const reach = this.reach * this.freeW;
    const swat = this.swat && this.swatW > 1e-3 ? this.swat : null;
    // Postura: as mãos abertas saem quando sobem (RS, pulo) ou dão o tapa do toco.
    const stance = this.stanceW * this.freeW * (1 - up) * (1 - this.swatW);
    if (up < 1e-3 && reach < 1e-3 && stance < 1e-3 && !swat && this.lift < 1e-4) return;
    const q = rig.root.quaternion;
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const vUp = new THREE.Vector3(0, 1, 0);
    const scale = rig.root.scale.y;
    const at = (p: readonly number[], out: number): THREE.Vector3 =>
      rig.root.position.clone().addScaledVector(left, out * p[0] * scale).addScaledVector(vUp, p[1] * scale).addScaledVector(fwd, p[2] * scale);
    const crouch = this.stanceCrouch(); // o quadril já desceu isto (applyStance): as mãos da postura descem junto
    for (const side of ['l', 'r'] as const) {
      const out = side === 'l' ? 1 : -1; // +x do jogador = esquerda
      const side3 = left.clone().multiplyScalar(out);
      if (stance > 1e-3) {
        // Cotovelo para fora e para baixo: braço aberto do lado do corpo, mão na altura da cintura (o "active hands").
        const pole = side3.clone().multiplyScalar(0.9).addScaledVector(vUp, -0.5).addScaledVector(fwd, -0.2).normalize();
        rig.reachPalm(side, at(StancePalm, out).addScaledVector(vUp, -crouch), stance * 0.85, pole);
      }
      if (up > 1e-3) {
        // Cotovelo para fora e um pouco para trás: o braço sobe pelo lado da cabeça, sem cruzar o rosto.
        const pole = side3.clone().multiplyScalar(0.8).addScaledVector(fwd, -0.5).addScaledVector(vUp, -0.2).normalize();
        rig.reachPalm(side, at(HandsUp, out), up, pole);
      }
      if (side === this.stealHand && reach > 1e-3) {
        const pole = side3.clone().multiplyScalar(0.7).addScaledVector(vUp, -0.6).addScaledVector(fwd, -0.3).normalize();
        rig.reachPalm(side, at(StealPalm, out), reach, pole);
      }
      if (swat && side === swat.hand) {
        // Toco: a palma no ponto do contato (o pulo sobe o esqueleto depois dos IKs: o alvo desconta a subida de agora) e
        // depois segue a batida.
        const dir = swat.dir.lengthSq() > 1e-6 ? swat.dir : fwd.clone().addScaledVector(vUp, -0.6).normalize();
        const target = swat.target.clone().addScaledVector(dir, SwatTiming.followM * this.swatFollow).addScaledVector(vUp, -this.lift);
        const pole = side3.clone().multiplyScalar(0.8).addScaledVector(vUp, -0.4).addScaledVector(fwd, -0.3).normalize();
        rig.reachPalm(side, target, this.swatW, pole);
      }
    }
    if (this.lift > 1e-4) {
      const pelvis = rig.bone('pelvis');
      const parent = pelvis.parent!;
      parent.updateWorldMatrix(true, false);
      const world = pelvis.getWorldPosition(new THREE.Vector3()).addScaledVector(vUp, this.lift);
      pelvis.position.copy(world.applyMatrix4(parent.matrixWorld.clone().invert()));
      pelvis.updateWorldMatrix(false, true);
    }
  }
}
