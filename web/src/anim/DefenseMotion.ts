// Defesa sem bola (online 1x1, docs/24 §6, e o 1x1 contra a CPU, docs/25): mãos para cima (RS para cima), o pulo de
// contestação/toco (Y) com os dois braços esticados, o tapa do roubo (X), a postura de defesa (agachado, mãos abertas),
// o tapa do toco (a mão vai até a bola no instante do contato) e a pegada do rebote com as duas mãos (X parado, Y no
// pulo). Por procedimento, como os gestos do IdleLife: as mãos vão por IK (o reachPalm do animador) para alvos no
// referencial do corpo e o pulo sobe a pelve (o esqueleto inteiro vai junto) depois dos IKs; o agachamento da postura
// entra no applyStance do animador (stanceCrouch).
// Os tempos são funções puras (contestJumpAt, stealReachAt, catchAt): o boneco remoto repete o mesmo comando e chega à
// mesma pose, e a contestação do arremessador lê a mesma altura de pulo e o mesmo quanto das mãos está em cima.
//
// Braços (diretor, 2026-10-16: "gira os dois lados meio estranho"): a mão ia em linha reta da coxa para cima da cabeça,
// passava pelo ombro e o cotovelo abria para trás (asa de galinha, mãos atrás da cabeça). Agora a mão sobe num arco pela
// frente do corpo (como quem levanta os braços de verdade), o cotovelo aponta para baixo no começo e para fora e um pouco
// à frente no alto, e a mão é orientada (dedos para cima, palma para a frente); no toco, a palma vira para a batida.
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
 * Pegada do rebote com as duas mãos: as mãos vão até a bola e chegam no instante do contato (`at`, pelo menos
 * `minReach` s), fecham nela (`grip`), trazem a bola para o peito (`pull`), protegem (`hold`) e largam a pose (`out`)
 * enquanto a bola desce para o drible.
 */
export const CatchTiming = { minReach: 0.12, grip: 0.08, pull: 0.22, hold: 0.14, out: 0.22 };

export type CatchPhase = 'reach' | 'grip' | 'pull' | 'hold' | 'out';

/** Fase da pegada a `t` s do comando, com o contato em `at` s: a fase, o quanto dela andou (0..1) e o peso dos braços. */
export function catchAt(t: number, at: number): { phase: CatchPhase; u: number; w: number; done: boolean } {
  const C = CatchTiming;
  const reach = Math.max(C.minReach, at);
  if (t < reach) return { phase: 'reach', u: clamp01(t / reach), w: smooth(t / Math.min(reach, 0.16)), done: false };
  let s = t - reach;
  if (s < C.grip) return { phase: 'grip', u: s / C.grip, w: 1, done: false };
  s -= C.grip;
  if (s < C.pull) return { phase: 'pull', u: s / C.pull, w: 1, done: false };
  s -= C.pull;
  if (s < C.hold) return { phase: 'hold', u: s / C.hold, w: 1, done: false };
  s -= C.hold;
  return { phase: 'out', u: clamp01(s / C.out), w: 1 - smooth(s / C.out), done: s >= C.out };
}

/** Centro da bola nas mãos (raio + a espessura da palma, m). */
const BallGrip = 0.119 + 0.025;

/**
 * Alvos das mãos no referencial do corpo (boneco de 1,86 m; a altura da build escala com o root): x = para fora (lado da
 * mão), y = altura, z = frente. Mãos para cima: acima do alcance (o IK estica o braço todo, um pouco à frente da cabeça);
 * a subida passa por RaiseFrom (perto da coxa, à frente) e RaiseVia (na frente do rosto). Tapa: baixo e à frente, na
 * altura do drible do atacante. Peito: onde a bola fica protegida depois do rebote.
 */
const HandsUp: [number, number, number] = [0.16, 2.48, 0.26];
const RaiseFrom: [number, number, number] = [0.25, 0.95, 0.2];
/** Controle do arco, bem à frente: no meio da subida o braço fica quase esticado na frente do rosto (perto do peito o
 *  cotovelo dobrava e abria para o lado na altura do ombro). */
const RaiseVia: [number, number, number] = [0.22, 1.6, 1.0];
const StealPalm: [number, number, number] = [0.1, 0.92, 0.78];
/** Postura: mãos abertas para fora dos ombros, na altura da cintura (sem o agachamento), um pouco à frente. */
const StancePalm: [number, number, number] = [0.52, 1.06, 0.3];
/** Peito: a bola protegida à frente do esterno (colada ao corpo, a colisão dos braços abria as mãos e a bola ficava solta). */
const Chest: [number, number, number] = [0, 1.46, 0.42];

/** Bézier quadrática a, b, c em u. */
function bezier(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, u: number): THREE.Vector3 {
  const k = 1 - u;
  return a.clone().multiplyScalar(k * k).addScaledVector(b, 2 * k * u).addScaledVector(c, u * u);
}

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
  /**
   * Pegada do rebote: alvo (mundo, onde a bola vai estar no contato), instante do contato, e depois do contato a bola no
   * referencial do corpo (sem a subida do pulo), que vai para o peito.
   */
  private grab: { t: number; at: number; target: THREE.Vector3; gripLocal: THREE.Vector3 | null; cancelAt: number } | null = null;
  private grabState: ReturnType<typeof catchAt> | null = null;
  /** Bola nas mãos (mundo, com o pulo) no último apply; null fora da pegada. */
  private held: THREE.Vector3 | null = null;
  private jumpT = Infinity;
  private jumpH = 0;
  private stealT = Infinity;
  private stealHand: Side = 'r';
  /** Some com a bola na mão (pegou o rebote no ar): os braços largam a pose da defesa. */
  private freeW = 1;
  private lift = 0;
  private arms = 0;
  private reach = 0;
  /** Eixos de cada mão no referencial do osso (dedos e palma), medidos na pose de ligação (fit). */
  private handAxes: Record<Side, { fingers: THREE.Vector3; palm: THREE.Vector3 }> | null = null;

  /**
   * Mede os eixos das mãos na pose de ligação (braços abertos: dedos para fora, palmas para baixo), como o IdleLife. Sem
   * isto as mãos não são orientadas (só o IK do braço).
   */
  fit(rig: DefenseRig): void {
    rig.root.updateMatrixWorld(true);
    const rootQ = rig.root.getWorldQuaternion(new THREE.Quaternion());
    const axes = (side: Side) => {
      const inv = rig.bone(`hand_${side}`).getWorldQuaternion(new THREE.Quaternion()).invert();
      const out = new THREE.Vector3(side === 'l' ? 1 : -1, 0, 0).applyQuaternion(rootQ); // +x do jogador = esquerda
      return { fingers: out.applyQuaternion(inv).normalize(), palm: new THREE.Vector3(0, -1, 0).applyQuaternion(inv).normalize() };
    };
    this.handAxes = { l: axes('l'), r: axes('r') };
  }

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

  /**
   * Rebote com as duas mãos: as mãos chegam a `target` (mundo, o centro da bola no contato) em `inS` s, seguram, trazem
   * a bola para o peito e soltam para o drible. `jumpM` > 0 pula junto (Y); 0 pega parado (X).
   */
  catchBall(target: THREE.Vector3, inS: number, jumpM = 0): void {
    if (jumpM > 0) this.jump(jumpM);
    this.grab = { t: 0, at: Math.max(0, inS), target: target.clone(), gripLocal: null, cancelAt: Infinity };
    this.grabState = catchAt(0, this.grab.at);
    this.held = null;
  }

  /** A bola não veio (o outro pegou, ou passou longe): as mãos largam a pose daqui. */
  cancelCatch(): void {
    if (this.grab && !Number.isFinite(this.grab.cancelAt)) this.grab.cancelAt = this.grab.t;
  }

  /** Pegada em andamento: a fase e quanto dela andou; null fora dela. */
  catchPhase(): { phase: CatchPhase; u: number } | null {
    return this.grabState && this.grab ? { phase: this.grabState.phase, u: this.grabState.u } : null;
  }

  /** Centro da bola entre as palmas (mundo) do contato até soltar para o drible; null fora disso. */
  catchHold(): THREE.Vector3 | null {
    return this.held;
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
    // A bola da pegada vai para a mão (drible) com os braços ainda saindo da pose: a pegada solta sozinha (out).
    const catching = this.grab !== null && this.grabState?.phase !== 'out';
    this.freeW += ((hasBall && !catching ? 0 : 1) - this.freeW) * (1 - Math.exp(-14 * dt));
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
    this.grabState = null;
    if (this.grab) {
      const g = this.grab;
      g.t += dt;
      if (Number.isFinite(g.cancelAt)) {
        // Cancelada: as mãos largam daqui (mesma saída do fim da pegada), sem a bola.
        const s = (g.t - g.cancelAt) / CatchTiming.out;
        const from = catchAt(g.cancelAt, g.at);
        this.grabState = { phase: 'out', u: clamp01(s), w: from.w * (1 - smooth(s)), done: s >= 1 };
      } else {
        this.grabState = catchAt(g.t, g.at);
      }
      if (this.grabState.done) {
        this.grab = null;
        this.grabState = null;
      }
    }
  }

  /** Braços (por último entre os IKs dos braços) e o pulo (sobe a pelve, o corpo inteiro vai junto). */
  apply(rig: DefenseRig): void {
    this.held = null;
    const grab = this.grab && this.grabState && this.grabState.w > 1e-3 ? this.grab : null;
    const grabW = grab ? this.grabState!.w : 0;
    // A pegada manda nos dois braços: o resto (mãos para cima, postura, tapas) sai enquanto ela dura.
    const free = this.freeW * (1 - grabW);
    const up = Math.max(this.holdW, this.arms) * free;
    const reach = this.reach * free;
    const swat = this.swat && this.swatW > 1e-3 && grabW < 0.5 ? this.swat : null;
    // Postura: as mãos abertas saem quando sobem (RS, pulo) ou dão o tapa do toco.
    const stance = this.stanceW * free * (1 - up) * (1 - this.swatW);
    if (up < 1e-3 && reach < 1e-3 && stance < 1e-3 && !swat && !grab && this.lift < 1e-4) return;
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
        // A mão sobe num arco pela frente do corpo (coxa → frente do rosto → acima da cabeça), com o IK entrando no começo
        // do arco. O cotovelo aponta para baixo no começo e para fora e um pouco à frente no alto (para trás, o braço ia
        // para trás da cabeça). Dedos para cima e palma para a frente (para o arremessador).
        const u = smooth(up);
        const target = bezier(at(RaiseFrom, out), at(RaiseVia, out), at(HandsUp, out), u);
        const k = u * u;
        const pole = side3
          .clone()
          .multiplyScalar(0.25 + 0.65 * k)
          .addScaledVector(vUp, -0.9 * (1 - k))
          .addScaledVector(fwd, 0.35 * k)
          .normalize();
        rig.reachPalm(side, target, smooth(up / 0.35), pole);
        const fingers = vUp.clone().multiplyScalar(0.9).addScaledVector(fwd, 0.15).addScaledVector(side3, 0.08);
        const palm = fwd.clone().addScaledVector(side3, -0.25);
        this.orientHand(rig, side, fingers, palm, smooth((up - 0.35) / 0.45));
      }
      if (side === this.stealHand && reach > 1e-3) {
        const pole = side3.clone().multiplyScalar(0.7).addScaledVector(vUp, -0.6).addScaledVector(fwd, -0.3).normalize();
        rig.reachPalm(side, at(StealPalm, out), reach, pole);
      }
      if (swat && side === swat.hand) {
        // Toco: a palma no ponto do contato (o pulo sobe o esqueleto depois dos IKs: o alvo desconta a subida de agora) e
        // depois segue a batida. Cotovelo para fora (para baixo e para trás o antebraço torcia); a palma vira para onde a
        // bola vai, com os dedos para cima.
        const dir = swat.dir.lengthSq() > 1e-6 ? swat.dir : fwd.clone().addScaledVector(vUp, -0.6).normalize();
        const target = swat.target.clone().addScaledVector(dir, SwatTiming.followM * this.swatFollow).addScaledVector(vUp, -this.lift);
        const pole = side3.clone().multiplyScalar(0.85).addScaledVector(fwd, 0.25).addScaledVector(vUp, -0.15).normalize();
        rig.reachPalm(side, target, this.swatW, pole);
        const fingers = vUp.clone().addScaledVector(dir, -vUp.dot(dir));
        this.orientHand(rig, side, fingers.lengthSq() > 1e-4 ? fingers : fwd, dir, this.swatW);
      }
    }
    if (grab) this.applyCatch(rig, grab, grabW, left, fwd, vUp, scale);
    if (this.lift > 1e-4) {
      const pelvis = rig.bone('pelvis');
      const parent = pelvis.parent!;
      parent.updateWorldMatrix(true, false);
      const world = pelvis.getWorldPosition(new THREE.Vector3()).addScaledVector(vUp, this.lift);
      pelvis.position.copy(world.applyMatrix4(parent.matrixWorld.clone().invert()));
      pelvis.updateWorldMatrix(false, true);
    }
  }

  /**
   * As duas mãos na bola: até o contato vão (num arco pela frente) para os lados de onde a bola vai estar, abertas e
   * fechando nela; depois a bola fica presa ao corpo (desce junto no pulo) e vai para o peito. Palmas viradas para a bola,
   * dedos para cima (no alto) ou para a frente (no peito), cotovelos para fora.
   */
  private applyCatch(
    rig: DefenseRig,
    grab: NonNullable<DefenseMotion['grab']>,
    w: number,
    left: THREE.Vector3,
    fwd: THREE.Vector3,
    vUp: THREE.Vector3,
    scale: number,
  ): void {
    const st = this.grabState!;
    const root = rig.root;
    root.updateMatrixWorld(true);
    const toWorld = root.matrixWorld;
    // Centro da bola SEM a subida do pulo (o IK roda antes de a pelve subir): no contato vira o referencial do corpo.
    let ball: THREE.Vector3;
    let open = 0;
    if (st.phase === 'reach') {
      ball = grab.target.clone().addScaledVector(vUp, -this.lift);
      open = 1 - smooth(st.u);
    } else {
      if (!grab.gripLocal) grab.gripLocal = grab.target.clone().addScaledVector(vUp, -this.lift).applyMatrix4(toWorld.clone().invert());
      const chest = new THREE.Vector3(...Chest);
      const k = st.phase === 'grip' ? 0 : st.phase === 'pull' ? smooth(st.u) : 1;
      ball = grab.gripLocal.clone().lerp(chest, k).applyMatrix4(toWorld);
      if (st.phase !== 'out' && !Number.isFinite(grab.cancelAt)) this.held = ball.clone().addScaledVector(vUp, this.lift);
    }
    const shoulderY = root.position.y + 1.52 * scale;
    const high = clamp01((ball.y - shoulderY) / 0.6);
    for (const side of ['l', 'r'] as const) {
      const out = side === 'l' ? 1 : -1;
      const side3 = left.clone().multiplyScalar(out);
      const palmAt = ball.clone().addScaledVector(side3, BallGrip + 0.12 * open).addScaledVector(fwd, -0.02);
      let target = palmAt;
      if (st.phase === 'reach') {
        // Arco pela frente: da coxa, passando à frente do peito, até o lado da bola (sem cruzar o ombro por trás).
        const from = rig.root.position.clone().addScaledVector(side3, RaiseFrom[0] * scale).addScaledVector(vUp, RaiseFrom[1] * scale).addScaledVector(fwd, RaiseFrom[2] * scale);
        const via = from.clone().lerp(palmAt, 0.5).addScaledVector(fwd, 0.45 * scale);
        target = bezier(from, via, palmAt, smooth(st.u));
      }
      // Cotovelo para baixo enquanto o braço sobe pela frente; no contato, para fora (e um pouco à frente na bola alta).
      const k = high * (st.phase === 'reach' ? smooth(st.u) : 1);
      const pole = side3
        .clone()
        .multiplyScalar(0.35 + 0.5 * k)
        .addScaledVector(vUp, -0.85 * (1 - k))
        .addScaledVector(fwd, 0.25 * k)
        .normalize();
      rig.reachPalm(side, target, w, pole);
      const fingers = vUp.clone().multiplyScalar(0.45 + 0.4 * high).addScaledVector(fwd, 0.75 - 0.4 * high);
      this.orientHand(rig, side, fingers, side3.clone().negate(), w * (st.phase === 'reach' ? smooth(st.u * 1.6) : 1));
    }
  }

  /**
   * Orienta a mão inteira: dedos para `fingersDir` e palma para `palmDir` (mundo), com peso (o orientHand do IdleLife).
   * Sem os eixos medidos (fit), não faz nada.
   */
  private orientHand(rig: DefenseRig, side: Side, fingersDir: THREE.Vector3, palmDir: THREE.Vector3, weight: number): void {
    if (weight <= 1e-3 || !this.handAxes) return;
    const hand = rig.bone(`hand_${side}`);
    const ax = this.handAxes[side];
    const basis = (f: THREE.Vector3, t: THREE.Vector3) => {
      const x = f.clone().normalize();
      const y = t.clone().addScaledVector(x, -t.dot(x)).normalize();
      return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y));
    };
    const local = basis(ax.fingers, ax.palm);
    const world = basis(fingersDir, palmDir);
    const want = new THREE.Quaternion().setFromRotationMatrix(world.multiply(local.transpose()));
    const cur = hand.getWorldQuaternion(new THREE.Quaternion());
    cur.slerp(want, Math.min(1, weight));
    hand.quaternion.copy(hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(cur));
    hand.updateWorldMatrix(false, true);
  }
}
