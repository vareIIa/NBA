// Corpo do jump shot, desenhado pela forma do arremesso (src/shot/ShotForms.ts) em cima do cronograma da soltura:
//  - pelve: dip, extensão até a ponta do pé, voo balístico, absorção no pouso; deriva à frente (ou fade para trás);
//  - pés: saem de onde estavam para a base do arremesso (pés na largura da base, pé da mão um pouco à frente), sobem
//    com o salto (ponta para baixo, chute das pernas, joelho à frente no fadeaway de uma perna) e pousam com a deriva;
//  - tronco: inclina no dip e endireita (ou vai para trás) na soltura; o corpo gira para pôr o ombro da mão à frente;
//    a cabeça desfaz a inclinação (olhos no aro);
//  - bola e mãos: a bola segue o caminho da release (bolso -> set point -> soltura); a palma da mão do arremesso fica
//    embaixo/atrás dela com o punho dobrado no set point, a mão de apoio do lado e sai antes da soltura; depois o punho
//    estala (gooseneck), o braço segura no alto e desce.
// Tudo no mundo do three.js (Y para cima). Mesmo esquema da bandeja (LayupMotion): o animador chama applyBody depois
// do applyStance e applyArms por último entre os IKs dos braços.
import * as THREE from 'three';
import { type ShotForm, type ShotSchedule, type V3, airShape, ballAt, ballKeys, driftAt, pelvisLift, shotSchedule, softLift } from '../shot/ShotForms';
import { applyPole, solveTwoBoneIK } from './TwoBoneIK';

type Side = 'l' | 'r';

/** O que o animador empresta para o arremesso (ossos e IKs dele; o mesmo objeto da bandeja serve). */
export interface ShotRig {
  bone(name: string): THREE.Bone;
  reachPalm(hand: Side, target: THREE.Vector3, weight: number, pole: THREE.Vector3): void;
  soleHeight(side: Side): number;
  palmWorld(hand: Side, out?: THREE.Vector3): THREE.Vector3;
  readonly root: THREE.Object3D;
  readonly model: THREE.Object3D;
  restFootLocal(side: Side): THREE.Quaternion;
}

const LegSoft = 0.03;
const BallR = 0.119;
/** Palma até o centro da bola (raio + a espessura da mão). */
const PalmToBall = BallR + 0.025;
/** s de entrada (da pose do drible para o desenho do arremesso). */
const EnterS = 0.12;

/**
 * Embalo do jogador no arremesso (pull-up): sentido (mundo, no chão) e velocidade (m/s) t s depois do começo. O jogo move
 * a raiz com ele; o desenho só precisa saber para onde ela vai para plantar os pés à frente.
 */
export interface ShotCarry {
  dir: THREE.Vector3;
  speedAt(t: number): number;
}

/** s do follow-through em que a palma ainda segue a velocidade da bola na soltura (o empurrão continua, sem parar seco). */
const FollowCarryS = 0.045;
const FollowCarryMax = 0.16;

const sideSign = (s: Side): number => (s === 'l' ? 1 : -1); // +x do jogador = esquerda
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
};
const deg = THREE.MathUtils.degToRad;

interface BodyFrame {
  origin: THREE.Vector3;
  left: THREE.Vector3;
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  /** Para o lado da mão do arremesso. */
  side: THREE.Vector3;
}

export class JumpShotMotion {
  form: ShotForm | null = null;
  schedule: ShotSchedule | null = null;
  /** s desde o começo do arremesso. */
  t = 0;
  /** Instante (t) em que a bola saiu da mão; null = ainda na mão. */
  releasedAt: number | null = null;
  /** Solta sozinho no tempo da soltura (prévia do criador); no jogo quem solta é o Freestyle. */
  autoRelease = true;
  private hand: Side = 'r';
  private heightM = 1.86;
  private keys: [number, V3][] = [];
  private dims = { thigh: 0.43, shank: 0.5, hipHalf: 0.1, pelvisAboveHip: 0.11 };
  private ankleFlat = 0.07;
  /** ankleFlat medido no corpo do modelo (escala 1), para a escala da build. */
  private ankleFlat0 = 0.07;
  private readonly start = {
    ankle: { l: new THREE.Vector3(), r: new THREE.Vector3() },
    /** Tornozelos no mundo no começo (o passo de parada sai daqui, inclusive do pé no ar da corrida). */
    ankleWorld: { l: new THREE.Vector3(), r: new THREE.Vector3() },
    palm: { l: new THREE.Vector3(), r: new THREE.Vector3() },
    pelvisOffset: new THREE.Vector3(),
  };
  /** Pés na base do arremesso (referencial do corpo: x = esquerda, z = frente). */
  private readonly stanceFoot = { l: new THREE.Vector3(), r: new THREE.Vector3() };
  /**
   * Pé preso no chão (mundo): depois do passinho de ajuste até a decolagem, e do pouso em diante. O jogador ainda anda
   * com o embalo do pull-up (a raiz se move ~0,5 m/s): preso ao corpo, o pé patinava junto.
   */
  private readonly footLock = {
    l: { plant: new THREE.Vector3(), planted: false, land: new THREE.Vector3(), landed: false },
    r: { plant: new THREE.Vector3(), planted: false, land: new THREE.Vector3(), landed: false },
  };
  /** Palma da mão do arremesso desenhada no último quadro com a bola (corpo): o follow-through parte dela. */
  private readonly releasePalm = new THREE.Vector3();
  private clampDeficit = 0;
  private lastT = 0;
  /**
   * Deriva (m, à frente do corpo) que o jogo já passou para a posição do jogador (takeDrift). O corpo desenhado só
   * carrega o resto: deslocar só o corpo fazia o jogador "voltar" ao ponto do arremesso no fim (fade do Dirk, 30 cm).
   */
  private driftTaken = 0;
  private carry: ShotCarry | null = null;
  /** Velocidade da bola na soltura (corpo, x para o lado da mão; m/s): o follow-through continua nela. */
  private readonly releaseVel: V3 = [0, 0, 0];
  /** Deriva ainda no corpo no último quadro com a bola (o follow-through parte dela). */
  private releaseDrift = 0;

  private static readonly TrunkBones = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'neck_02', 'head', 'clavicle_l', 'clavicle_r'];
  private readonly rest = new Map<string, THREE.Quaternion>();
  private readonly restPelvisInModel = new THREE.Quaternion();
  private readonly startLocal = new Map<string, THREE.Quaternion>();

  /** Construir com o esqueleto ainda na pose de repouso (antes do primeiro update do mixer). */
  constructor(private readonly rig: ShotRig) {
    for (const name of JumpShotMotion.TrunkBones) this.rest.set(name, rig.bone(name).quaternion.clone());
    rig.model.updateMatrixWorld(true);
    const modelQ = rig.model.getWorldQuaternion(new THREE.Quaternion());
    this.restPelvisInModel.copy(modelQ.invert().multiply(rig.bone('pelvis').getWorldQuaternion(new THREE.Quaternion())));
    this.ankleFlat = Infinity;
    this.measureAnkleFlat();
    if (!Number.isFinite(this.ankleFlat)) this.ankleFlat = 0.07;
    this.ankleFlat0 = this.ankleFlat;
  }

  /** Escala do corpo pela altura da build (PlayerAnimator.setBodyScale): o tornozelo do pé apoiado sobe junto. */
  setBodyScale(k: number): void {
    this.ankleFlat = this.ankleFlat0 * k;
  }

  private measureAnkleFlat(): void {
    const rig = this.rig;
    const y = (s: Side) => rig.bone(`foot_${s}`).getWorldPosition(new THREE.Vector3()).y - rig.soleHeight(s);
    const measured = Math.min(y('l'), y('r'));
    if (measured > 0.03 && measured < 0.14) this.ankleFlat = Math.min(this.ankleFlat, measured);
  }

  get active(): boolean {
    return this.form !== null;
  }

  /** s até a bola sair da mão pelo desenho (0 = já chegou à soltura). */
  releaseIn(): number {
    return this.schedule ? Math.max(0, this.schedule.releaseAt - this.t) : 0;
  }

  /** Começa: guarda de onde os pés, as mãos, a bola e a pelve partem (continuidade sem salto). */
  begin(form: ShotForm, hand: Side, releaseS: number, ballWorld: THREE.Vector3, heightM: number, carry: ShotCarry | null = null): void {
    const rig = this.rig;
    this.form = form;
    this.carry = carry;
    this.hand = hand;
    this.heightM = heightM;
    this.schedule = shotSchedule(form, releaseS);
    this.t = 0;
    this.lastT = 0;
    this.clampDeficit = 0;
    this.releasedAt = null;
    this.exiting = false;
    this.driftTaken = 0;
    this.releaseDrift = 0;
    for (const s of ['l', 'r'] as const) {
      this.footLock[s].planted = false;
      this.footLock[s].landed = false;
    }
    const P = (n: string) => rig.bone(n).getWorldPosition(new THREE.Vector3());
    this.dims.thigh = P('thigh_l').distanceTo(P('calf_l'));
    this.dims.shank = P('calf_l').distanceTo(P('foot_l'));
    this.dims.hipHalf = P('thigh_l').distanceTo(P('thigh_r')) / 2;
    const hipMid = P('thigh_l').add(P('thigh_r')).multiplyScalar(0.5);
    this.dims.pelvisAboveHip = P('pelvis').y - hipMid.y;
    // Tornozelo acima da sola com o pé apoiado: medido na pose de repouso (construtor) e só diminui. Saindo do sprint
    // nenhum pé está plano, e medir ali deixava os pés ~3 cm acima do chão no pull-up.
    this.measureAnkleFlat();
    for (const s of ['l', 'r'] as const) {
      this.toBody(P(`foot_${s}`), this.start.ankle[s]);
      this.start.ankleWorld[s].copy(P(`foot_${s}`));
      this.toBody(rig.palmWorld(s, new THREE.Vector3()), this.start.palm[s]);
    }
    for (const name of JumpShotMotion.TrunkBones) this.startLocal.set(name, rig.bone(name).quaternion.clone());
    const planned = this.pelvisPlanned(0);
    this.toBodyDir(P('pelvis').sub(planned), this.start.pelvisOffset);
    // Base dos pés: largura da base, pé da mão à frente, os dois girados com o corpo.
    const b = form.base;
    const yaw = this.yaw();
    for (const s of ['l', 'r'] as const) {
      const x = sideSign(s) * b.stance * 0.5;
      const z = (s === hand ? 0.5 : -0.5) * b.stagger;
      this.stanceFoot[s].set(x, 0, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    }
    // Bola: de onde está (corpo, com x para o lado da mão). Longe do corpo (prévia sem bola na mão) parte do bolso.
    const ball = this.toBody(ballWorld, new THREE.Vector3());
    const pocket = form.release.pocket;
    const near = Math.hypot(ball.x, ball.z) < 0.9 && ball.y > 0.1 && ball.y < 2.2;
    const startBall: V3 = near ? [ball.x * sideSign(hand), ball.y, ball.z] : [pocket[0], pocket[1] * heightM, pocket[2]];
    this.keys = ballKeys(form, this.schedule, startBall, heightM);
    ballAt(this.keys, this.schedule.releaseAt, this.releaseVel);
  }

  /** Embalo do pull-up (0..1). */
  private momentum(): number {
    return this.form?.momentum ?? 0;
  }

  /** Quanto a raiz ainda anda com o embalo de t0 a t1 (m). */
  private carryTravel(t0: number, t1: number): number {
    if (!this.carry || t1 <= t0) return 0;
    const n = 8;
    const h = (t1 - t0) / n;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.carry.speedAt(t0 + (i + 0.5) * h);
    return sum * h;
  }

  /** Deriva que ainda está só no corpo (m, à frente): a total do cronograma menos a que o jogador já andou. */
  private driftLeft(t: number): number {
    return driftAt(this.form!, this.schedule!, t) - this.driftTaken;
  }

  /** Entrega ao jogo a deriva nova desde a última chamada (m, à frente do corpo) e tira ela do corpo desenhado. */
  takeDrift(): number {
    if (!this.form) return 0;
    const d = this.driftLeft(this.t);
    this.driftTaken += d;
    return d;
  }

  /**
   * Saída: a ação do arremesso acabou (fim, jogador voltou a andar, pump fake) e a animação seguinte já toca embaixo
   * (locomoção, comemoração, hesitação). O desenho continua por cima com peso caindo a zero em `duration` s, parado na
   * última pose. Sem isto a troca partia da pose crua do clipe parado (a inertialization não vê o desenho) e a pelve caía
   * ~15 cm num quadro.
   */
  startExit(duration: number): void {
    if (!this.form || this.exiting) return;
    this.exiting = true;
    this.exitT = 0;
    this.exitS = Math.max(0.05, duration);
  }

  /** Peso do desenho (1 = inteiro; cai a 0 na saída). */
  private exitWeight(): number {
    return this.exiting ? 1 - smooth(0, this.exitS, this.exitT) : 1;
  }

  /** Avança a saída; acaba o desenho quando o peso chega a zero. */
  advanceExit(dt: number): void {
    if (!this.exiting) return;
    this.exitT += dt;
    if (this.exitT >= this.exitS) this.end();
  }

  exiting = false;
  private exitT = 0;
  private exitS = 0.3;

  end(): void {
    this.exiting = false;
    this.form = null;
    this.schedule = null;
  }

  // ----------------------------------------------------------------------------------------- referencial do corpo

  private frame(): BodyFrame {
    const q = this.rig.root.quaternion;
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    return {
      origin: this.rig.root.position,
      left,
      up: new THREE.Vector3(0, 1, 0),
      fwd: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
      side: left.clone().multiplyScalar(sideSign(this.hand)),
    };
  }

  private toBody(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const f = this.frame();
    const d = world.clone().sub(f.origin);
    return out.set(d.dot(f.left), d.y, d.dot(f.fwd));
  }

  private toBodyDir(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const f = this.frame();
    return out.set(world.dot(f.left), world.y, world.dot(f.fwd));
  }

  private fromBody(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const f = this.frame();
    return out.copy(f.origin).addScaledVector(f.left, x).addScaledVector(f.up, y).addScaledVector(f.fwd, z);
  }

  /** Giro do corpo (rad, +Y): o ombro da mão do arremesso vai à frente. */
  private yaw(): number {
    return deg(this.form!.base.turn) * (this.hand === 'r' ? 1 : -1);
  }

  // ----------------------------------------------------------------------------------------- corpo

  private standHip(): number {
    return this.ankleFlat + 0.97 * (this.dims.thigh + this.dims.shank);
  }

  private pelvisPlanned(t: number): THREE.Vector3 {
    const lift = pelvisLift(this.form!, this.schedule!, t, this.heightM);
    return this.fromBody(0, this.standHip() + this.dims.pelvisAboveHip + lift, this.driftLeft(t));
  }

  /** Inclinação do tronco (graus, + = à frente) no instante t. */
  private lean(t: number): number {
    const s = this.schedule!;
    const b = this.form!.base;
    // Pull-up: o tronco vai para trás na parada (freia o embalo) e volta à frente no dip.
    const brake = -11 * this.momentum() * Math.sin(Math.PI * Math.min(1, Math.max(0, t / Math.max(0.05, s.dipAt * 1.15))));
    if (t < s.dipAt) return b.leanDip * smooth(0, s.dipAt, t) + brake;
    if (t < s.releaseAt) return THREE.MathUtils.lerp(b.leanDip, b.leanRelease, smooth(s.dipAt, s.releaseAt, t)) + brake;
    // Depois da soltura: segura a inclinação da soltura no ar e volta para ~5° à frente depois do pouso.
    return THREE.MathUtils.lerp(b.leanRelease, 5, smooth(s.landAt, s.landAt + 0.3, t));
  }

  /** Pelve, tronco, pernas e pés. Chamar depois do applyStance. */
  applyBody(): void {
    if (!this.form) return;
    const rig = this.rig;
    const t = this.t;
    const s = this.schedule!;
    const f = this.frame();
    const enter = smooth(0, EnterS, t);
    const exit = this.exitWeight();
    const w = Math.min(enter, exit);

    // 1) Pelve.
    const pelvis = rig.bone('pelvis');
    const mixerPelvisQ = pelvis.quaternion.clone();
    const want = this.pelvisPlanned(t);
    const fade = Math.exp(-t / 0.1);
    const off = this.start.pelvisOffset;
    want.addScaledVector(f.left, off.x * fade).addScaledVector(f.up, off.y * fade).addScaledVector(f.fwd, off.z * fade);

    // 2) Tornozelos e pés.
    const ankles = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    const footQ = { l: new THREE.Quaternion(), r: new THREE.Quaternion() };
    const planted = { l: false, r: false };
    for (const side of ['l', 'r'] as const) planted[side] = this.footTarget(side, t, f, ankles[side], footQ[side]);

    // 3) Pelve nunca além do que a perna apoiada alcança.
    const legMax = (this.dims.thigh + this.dims.shank) * 0.995;
    let limit = Infinity;
    for (const side of ['l', 'r'] as const) {
      if (!planted[side]) continue;
      const hip = want.clone().addScaledVector(f.left, sideSign(side) * this.dims.hipHalf);
      const dx = Math.hypot(ankles[side].x - hip.x, ankles[side].z - hip.z);
      const reach = Math.sqrt(Math.max(0.01, legMax * legMax - dx * dx));
      limit = Math.min(limit, ankles[side].y + reach + this.dims.pelvisAboveHip);
    }
    const deficit = Math.max(0, want.y - limit);
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    this.clampDeficit = deficit >= this.clampDeficit ? deficit : deficit + (this.clampDeficit - deficit) * Math.exp(-dt / 0.07);
    want.y -= this.clampDeficit;
    const parent = pelvis.parent!;
    const current = pelvis.getWorldPosition(new THREE.Vector3());
    pelvis.position.copy(current.lerp(want, exit).applyMatrix4(parent.matrixWorld.clone().invert()));

    // 4) Pelve e tronco a partir da pose de repouso, com a inclinação e o giro do corpo.
    const lean = this.lean(t);
    const yaw = this.yaw();
    const modelQ = rig.model.getWorldQuaternion(new THREE.Quaternion());
    const pelvisPitch = lean * 0.35;
    const qExtra = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg(pelvisPitch)));
    const pelvisWorld = modelQ.clone().multiply(qExtra).multiply(this.restPelvisInModel);
    const pelvisLocal = parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(pelvisWorld);
    const fromQ = this.startLocal.get('pelvis')!;
    pelvis.quaternion.copy(enter < 1 ? fromQ.clone().slerp(pelvisLocal, enter) : pelvisLocal);
    if (exit < 1) pelvis.quaternion.copy(mixerPelvisQ.slerp(pelvis.quaternion, exit));
    pelvis.updateWorldMatrix(true, true);
    // Eixos girados com o corpo: a coluna inclina para a frente DO CORPO.
    const qYaw = new THREE.Quaternion().setFromAxisAngle(f.up, yaw);
    const bodyLeft = f.left.clone().applyQuaternion(qYaw);
    const bodyFwd = f.fwd.clone().applyQuaternion(qYaw);
    const spinePitch = (lean - pelvisPitch) / 3;
    // O peito volta um pouco para o aro (o giro do quadril é maior que o dos ombros).
    // Tronco tomba para o lado da mão de apoio na soltura (o ombro do arremesso sobe) e volta depois do pouso.
    const sway = this.form.base.sway * sideSign(this.hand) * smooth(s.setAt - 0.1, s.releaseAt, t) * (1 - smooth(s.landAt, s.landAt + 0.35, t));
    const qSpine = new THREE.Quaternion()
      .setFromAxisAngle(bodyLeft, deg(spinePitch))
      .multiply(new THREE.Quaternion().setFromAxisAngle(bodyFwd, deg(sway / 3)))
      .multiply(new THREE.Quaternion().setFromAxisAngle(f.up, -yaw * 0.12));
    // Cabeça: desfaz a inclinação (olhos no aro) e sobe um pouco com a bola.
    const lookUp = 6 * smooth(s.setAt - 0.1, s.releaseAt, t) * (1 - smooth(s.followEnd, s.endAt, t));
    const qHead = new THREE.Quaternion()
      .setFromAxisAngle(bodyLeft, deg((-lean * 0.75 - lookUp) / 3))
      .multiply(new THREE.Quaternion().setFromAxisAngle(bodyFwd, deg((-sway * 0.7) / 3)))
      .multiply(new THREE.Quaternion().setFromAxisAngle(f.up, -yaw * 0.45 / 3));
    // Ombro da mão do arremesso sobe com o braço esticando para a soltura.
    const shoulderUp = 14 * smooth(s.setAt - 0.05, s.releaseAt, t) * (1 - smooth(s.followEnd, s.endAt, t));
    for (const name of JumpShotMotion.TrunkBones) {
      if (name === 'pelvis') continue;
      const bone = rig.bone(name);
      const mixerQ = bone.quaternion.clone();
      bone.quaternion.copy(this.rest.get(name)!);
      bone.updateWorldMatrix(false, true);
      let q: THREE.Quaternion | null = null;
      if (name.startsWith('spine_')) q = qSpine;
      else if (name.startsWith('neck_') || name === 'head') q = qHead;
      else if (name === `clavicle_${this.hand}`) q = new THREE.Quaternion().setFromAxisAngle(bodyFwd, deg(-sideSign(this.hand) * shoulderUp));
      if (q) {
        const bw = bone.getWorldQuaternion(new THREE.Quaternion());
        bone.quaternion.multiply(bw.clone().invert().multiply(q).multiply(bw));
      }
      if (enter < 1) bone.quaternion.copy(this.startLocal.get(name)!.clone().slerp(bone.quaternion, enter));
      if (exit < 1) bone.quaternion.copy(mixerQ.slerp(bone.quaternion, exit));
      bone.updateWorldMatrix(false, true);
    }

    // 5) Pernas: IK até os alvos, joelho para a frente (e um pouco para fora), pé orientado, sola nunca abaixo do chão.
    for (const side of ['l', 'r'] as const) {
      const thigh = rig.bone(`thigh_${side}`);
      const calf = rig.bone(`calf_${side}`);
      const foot = rig.bone(`foot_${side}`);
      const legFrom = this.exiting ? [thigh, calf, foot].map((b) => b.quaternion.clone()) : null;
      // Saída: o pé vai de onde estava preso até onde a animação de baixo o põe (correndo, ele já está à frente).
      if (legFrom) ankles[side].lerp(foot.getWorldPosition(new THREE.Vector3()), 1 - exit);
      const pole = bodyFwd.clone().addScaledVector(f.left, sideSign(side) * 0.25).normalize();
      solveTwoBoneIK(thigh, calf, foot, ankles[side], pole, LegSoft);
      applyPole(thigh, calf, ankles[side], pole, 1);
      this.orientFoot(foot, footQ[side], w);
      const below = -rig.soleHeight(side);
      if (below > 0) {
        ankles[side].y += below;
        solveTwoBoneIK(thigh, calf, foot, ankles[side], pole, LegSoft);
        this.orientFoot(foot, footQ[side], w);
      }
      // Saída: a perna desenhada se mistura com a da animação de baixo pelas rotações (sem tranco no joelho no fim).
      // Misturar as rotações desde o começo da saída levava o pé para dentro do chão (pernas muito diferentes); com o pé
      // já no lugar, elas só convergem no final.
      if (legFrom) this.blendFrom([thigh, calf, foot], legFrom, smooth(0, 0.35, exit));
    }
  }

  /** Rotações locais de `bones` = de `from` (a animação de baixo) para as atuais (o desenho) com peso `w`. */
  private blendFrom(bones: THREE.Bone[], from: THREE.Quaternion[], w: number): void {
    bones.forEach((b, i) => {
      b.quaternion.copy(from[i].slerp(b.quaternion, w));
      b.updateWorldMatrix(false, true);
    });
  }

  /**
   * Alvo do tornozelo e orientação do pé. Retorna se o pé está apoiado. No chão: dá o passo de onde estava (mundo) até
   * onde planta na base do arremesso, calcanhar sobe na decolagem. No ar: sobe com o salto, ponta para baixo, chute;
   * pousa com a deriva.
   *
   * Pull-up: o jogador ainda anda com o embalo até a decolagem, então o pé planta onde o corpo VAI estar (à frente) e o
   * corpo passa por cima dele freando; parada em 1-2 (pé de fora e depois o da mão, que freia no dip) ou num hop (os dois
   * juntos, `pullHop`). Antes o passo era no referencial do corpo e o pé patinava junto com o embalo.
   */
  private footTarget(side: Side, t: number, f: BodyFrame, out: THREE.Vector3, q: THREE.Quaternion): boolean {
    const s = this.schedule!;
    const b = this.form!.base;
    const m = this.momentum();
    const pull = m > 0.05;
    const stance = this.stanceFoot[side];
    const first = side !== this.hand;
    let t0: number;
    let t1: number;
    if (pull) {
      const P = Math.max(0.12, Math.min(s.takeoffAt - 0.06, s.dipAt * 0.9));
      t0 = THREE.MathUtils.lerp(first ? 0 : 0.3 * P, 0.08 * P, b.pullHop);
      t1 = THREE.MathUtils.lerp(first ? 0.55 * P : P, 0.85 * P, b.pullHop);
    } else {
      // Ajuste dos pés: o pé de trás primeiro, o outro logo depois (1-2 no lugar).
      t0 = first ? 0 : 0.05;
      t1 = Math.min(s.takeoffAt * 0.75, t0 + 0.18);
    }
    const k = smooth(t0, t1, t);
    const lock = this.footLock[side];
    // Onde o pé planta (mundo): na base do arremesso, em volta de onde a raiz vai estar na decolagem.
    const plant = lock.planted ? lock.plant.clone() : this.fromBody(stance.x, 0, stance.z);
    if (!lock.planted && this.carry) plant.addScaledVector(this.carry.dir, this.carryTravel(t, s.takeoffAt));
    const startW = this.start.ankleWorld[side];
    const moved = Math.hypot(startW.x - plant.x, startW.z - plant.z);
    const stepLift = moved > 0.04 ? Math.sin(Math.PI * k) * Math.min(0.08 + 0.05 * m, moved * 0.6) : 0;
    const drift = this.driftLeft(t);
    const air = airShape(s, t);
    const lift = pelvisLift(this.form!, s, t, this.heightM);
    // Calcanhar sobe na extensão (últimos ~0,1 s antes da decolagem) e o tornozelo vai junto.
    const heel = smooth(s.takeoffAt - 0.1, s.takeoffAt, t) * (1 - smooth(s.landAt - 0.04, s.landAt + 0.04, t));
    let x = stance.x;
    let y = this.ankleFlat + heel * 0.07;
    let z = stance.z + drift;
    let pitch = 30 * heel;
    // Calcanhar subindo gira o pé na ponta: o tornozelo volta um pouco para a ponta ficar no lugar.
    z -= 0.13 * (1 - Math.cos(deg(pitch)));
    if (t > s.takeoffAt && t < s.landAt) {
      // No ar: o pé acompanha a pelve (sem as pernas esticarem demais) e chuta para trás e para fora.
      y += Math.max(0, lift - 0.03) * 0.95;
      z -= b.kick * 0.12 * air;
      y += b.kick * 0.08 * air;
      x += sideSign(side) * b.kick * 0.05 * air;
      pitch = 30 + 15 * air;
      if (side !== this.hand && b.oneLeg > 0) {
        // Fadeaway de uma perna: o joelho de fora sobe à frente (o pé sobe e vai à frente).
        y += b.oneLeg * 0.28 * air;
        z += b.oneLeg * 0.16 * air;
        pitch += 10 * b.oneLeg * air;
      }
    }
    // Pouso: a ponta toca primeiro e o pé abaixa em ~0,08 s.
    if (t >= s.landAt) pitch = 30 * (1 - smooth(s.landAt, s.landAt + 0.08, t));
    const worldPos = this.fromBody(x, y, z, out);
    if (t < s.takeoffAt) {
      if (t < t1) {
        // O passo: de onde o pé estava (até no ar, na passada da corrida) até o plantio. Na horizontal ele chega antes e
        // o fim do passo só desce (pousando enquanto andava, o pé arrastava ~5 cm no chão).
        const kh = smooth(t0, t0 + 0.8 * (t1 - t0), t);
        worldPos.x = THREE.MathUtils.lerp(startW.x, plant.x, kh);
        worldPos.z = THREE.MathUtils.lerp(startW.z, plant.z, kh);
        worldPos.y = THREE.MathUtils.lerp(startW.y, worldPos.y, k) + stepLift;
      } else {
        if (!lock.planted) {
          lock.plant.copy(plant);
          lock.planted = true;
        }
        worldPos.x = lock.plant.x;
        worldPos.z = lock.plant.z;
      }
    } else if (t < s.landAt) {
      // No ar: sai de onde estava preso e chega no pouso já no lugar do corpo (com a deriva).
      if (lock.planted) {
        const w = smooth(s.takeoffAt, s.landAt, t);
        worldPos.x = THREE.MathUtils.lerp(lock.plant.x, worldPos.x, w);
        worldPos.z = THREE.MathUtils.lerp(lock.plant.z, worldPos.z, w);
      }
    } else {
      if (!lock.landed) {
        lock.land.copy(worldPos);
        lock.landed = true;
      }
      worldPos.x = lock.land.x;
      worldPos.z = lock.land.z;
    }
    const yaw = this.yaw() + sideSign(side) * deg(8); // pontas um pouco para fora
    const dir = f.fwd.clone().applyAxisAngle(f.up, yaw);
    this.footOrientation(side, dir, pitch, q);
    worldPos.y = Math.max(worldPos.y, this.ankleFlat * 0.9);
    // No passo do pull-up o pé está no ar: não segura a pelve.
    if (pull && t < t1) return false;
    return t < s.takeoffAt - 0.02 || t > s.landAt + 0.02;
  }

  private orientFoot(foot: THREE.Bone, worldQ: THREE.Quaternion, w: number): void {
    const parentWorld = foot.parent!.getWorldQuaternion(new THREE.Quaternion());
    const want = parentWorld.invert().multiply(worldQ);
    foot.quaternion.slerp(want, w);
    foot.updateWorldMatrix(false, true);
  }

  private footOrientation(side: Side, dir: THREE.Vector3, pitchDeg: number, out: THREE.Quaternion): THREE.Quaternion {
    const yaw = Math.atan2(dir.x, dir.z);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const lateral = new THREE.Vector3(1, 0, 0).applyQuaternion(qYaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(lateral, deg(pitchDeg));
    return out.copy(qPitch).multiply(qYaw).multiply(this.rig.restFootLocal(side));
  }

  // ----------------------------------------------------------------------------------------- bola e mãos

  /** Centro da bola (mundo) no instante t, enquanto está na mão. */
  ballWorld(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const s = this.schedule!;
    const k = ballAt(this.keys, Math.min(t, s.releaseAt));
    // A bola sobe com o salto (o dip já está no bolso).
    const lift = softLift(pelvisLift(this.form!, s, t, this.heightM));
    const x = k[0] * sideSign(this.hand);
    return this.fromBody(x, k[1] + lift, k[2] + this.driftLeft(t), out);
  }

  /** Normal da palma da mão do arremesso (para onde ela olha: para a bola) e direção dos dedos, antes da soltura. */
  private shootingHand(t: number, f: BodyFrame): { n: THREE.Vector3; fingers: THREE.Vector3 } {
    const s = this.schedule!;
    const r = this.form!.release;
    const toward = (a: THREE.Vector3, b: THREE.Vector3, w: number) => a.clone().lerp(b, w).normalize();
    // Bolso: mão atrás/ao lado da bola, dedos para cima.
    const nPocket = f.fwd.clone().multiplyScalar(0.7).addScaledVector(f.up, 0.45).addScaledVector(f.side, -0.55).normalize();
    const fPocket = f.up.clone().addScaledVector(f.fwd, 0.2).normalize();
    // Set point: palma para cima embaixo da bola, punho dobrado para trás (dedos apontam para trás/cima).
    const cock = deg(r.wristCock);
    const nSet = f.up.clone().multiplyScalar(0.93).addScaledVector(f.fwd, 0.37).normalize();
    const fSet = f.up.clone().multiplyScalar(Math.cos(cock)).addScaledVector(f.fwd, -Math.sin(cock)).normalize();
    // Soltura: empurra para o aro (~55° acima da horizontal), dedos para cima/à frente.
    const nRel = f.fwd.clone().multiplyScalar(0.57).addScaledVector(f.up, 0.82).normalize();
    const fRel = f.up.clone().multiplyScalar(0.88).addScaledVector(f.fwd, 0.47).normalize();
    const a = smooth(0, s.setAt, t);
    const c = smooth(s.setEnd, s.releaseAt, t);
    const n = toward(toward(nPocket, nSet, a), nRel, c);
    const fingers = toward(toward(fPocket, fSet, a), fRel, c);
    return { n, fingers };
  }

  /**
   * Mãos e bola. Retorna o centro da bola no referencial da raiz enquanto ela está na mão (o BallDribbler segue esse
   * ponto), ou null depois da soltura.
   */
  applyArms(): THREE.Vector3 | null {
    if (!this.form) return null;
    const rig = this.rig;
    const t = this.t;
    const s = this.schedule!;
    const r = this.form.release;
    const f = this.frame();
    const H = this.heightM;
    const shoot = this.hand;
    const other: Side = shoot === 'r' ? 'l' : 'r';
    if (this.releasedAt === null && this.autoRelease && t >= s.releaseAt) this.releasedAt = s.releaseAt;
    const released = this.releasedAt !== null;
    const enter = smooth(0, EnterS, t);
    const exit = this.exitWeight();
    const ball = this.ballWorld(t);

    // Mão do arremesso.
    const { n, fingers } = this.shootingHand(t, f);
    let palmShoot = ball.clone().addScaledVector(n, -PalmToBall);
    let nShoot = n;
    let fingersShoot = fingers;
    // Mão de apoio: do lado da bola (palma olhando para o lado da mão do arremesso), sai antes da soltura e abre.
    const nGuideOn = f.side.clone().multiplyScalar(0.92).addScaledVector(f.fwd, -0.15).addScaledVector(f.up, 0.1).normalize();
    const guideOn = ball.clone().addScaledVector(nGuideOn, -PalmToBall);
    const offAt = s.releaseAt - r.guideOff;
    const off = smooth(offAt, offAt + 0.08, t);
    const guideOpen = guideOn.clone().addScaledVector(f.side, -0.1).addScaledVector(f.fwd, 0.02);
    let palmGuide = guideOn.clone().lerp(guideOpen, off);
    let nGuide = nGuideOn.clone().lerp(f.fwd, off * 0.6).normalize();
    let fingersGuide = f.up.clone().addScaledVector(f.fwd, 0.25).normalize();

    if (released) {
      const since = t - this.releasedAt!;
      // Follow-through: a palma continua na velocidade da bola na soltura e para em ~0,1 s (o empurrão não para seco),
      // o punho estala (dedos para a frente/baixo) e o braço assenta.
      const settle = smooth(0.06, 0.3, since);
      const rv = this.releaseVel;
      const rvLen = Math.hypot(rv[0], rv[1], rv[2]);
      const carry = Math.min(FollowCarryMax, rvLen * FollowCarryS * (1 - Math.exp(-since / FollowCarryS))) / Math.max(1e-6, rvLen);
      const rp = this.releasePalm;
      const lift = softLift(pelvisLift(this.form, s, t, H)) - softLift(pelvisLift(this.form, s, this.releasedAt!, H));
      const drift = this.driftLeft(t) - this.releaseDrift;
      // O braço assenta um pouco mais baixo e à frente (de ~70° na soltura para ~55°), como no Curry.
      palmShoot = this.fromBody(
        rp.x + rv[0] * sideSign(shoot) * carry,
        rp.y + lift + rv[1] * carry - 0.05 * settle,
        rp.z + drift + rv[2] * carry + 0.03 * settle,
      );
      const snap = smooth(0, 0.09, since);
      nShoot = n.clone().lerp(f.fwd.clone().multiplyScalar(0.55).addScaledVector(f.up, -0.83), snap).normalize();
      fingersShoot = fingers.clone().lerp(f.fwd.clone().multiplyScalar(0.8).addScaledVector(f.up, -0.6), snap).normalize();
      // Segura no alto e desce para o lado do corpo.
      const down = smooth(s.followEnd, s.followEnd + 0.35, t);
      const lowShoot = this.fromBody(sideSign(shoot) * 0.24, 0.5 * H, 0.16);
      const lowGuide = this.fromBody(sideSign(other) * 0.24, 0.5 * H, 0.16);
      const earlyDrop = (1 - r.followHigh) * smooth(this.releasedAt!, this.releasedAt! + 0.25, t);
      palmShoot.lerp(lowShoot, Math.max(down, earlyDrop * 0.5));
      // A mão de apoio fica no alto e aberta, na altura da cabeça, e desce depois do pouso.
      palmGuide.addScaledVector(f.up, -0.14 * smooth(0, 0.15, since));
      // guideFollow baixo: a mão de apoio sai e desce logo (Kobe, Bird); alto: fica aberta no alto até o pouso (Curry).
      const guideDrop = (1 - r.guideFollow) * smooth(0.06, 0.32, since);
      palmGuide.lerp(lowGuide, Math.max(guideDrop, smooth(s.landAt + 0.05, s.landAt + 0.4, t)));
      nGuide = nGuide.lerp(f.up.clone().negate(), down).normalize();
      fingersGuide = fingersGuide.lerp(f.fwd, down).normalize();
    } else {
      this.toBody(palmShoot, this.releasePalm);
      this.releaseDrift = this.driftLeft(t);
    }

    // Entrada: das palmas de onde estavam.
    if (enter < 1) {
      for (const [hand, target] of [
        [shoot, palmShoot],
        [other, palmGuide],
      ] as const) {
        const p = this.start.palm[hand];
        target.lerpVectors(this.fromBody(p.x, p.y, p.z), target.clone(), enter);
      }
    }

    // Cotovelos: o da mão do arremesso embaixo da bola (para o aro e um pouco para fora, conforme a release); o de apoio
    // para fora.
    const high = smooth(0, s.setAt, t);
    const poleLow = f.up.clone().multiplyScalar(-0.7).addScaledVector(f.side, 0.55).addScaledVector(f.fwd, -0.2).normalize();
    const poleHigh = f.up.clone().multiplyScalar(-0.45).addScaledVector(f.fwd, 0.25).addScaledVector(f.side, 0.12 + 0.6 * r.elbowFlare).normalize();
    const poleShoot = poleLow.lerp(poleHigh, high).normalize();
    const poleGuide = f.up.clone().multiplyScalar(-0.55).addScaledVector(f.side, -0.8).normalize();
    // Na saída os braços são resolvidos inteiros e depois misturados com a animação de baixo pelas rotações.
    const armBones = this.exiting
      ? (['l', 'r'] as const).flatMap((h) => [rig.bone(`upperarm_${h}`), rig.bone(`lowerarm_${h}`), rig.bone(`hand_${h}`)])
      : [];
    const armFrom = armBones.map((b) => b.quaternion.clone());
    const wShoot = enter;
    const wGuide = enter;
    this.orientHand(shoot, nShoot, fingersShoot, wShoot);
    rig.reachPalm(shoot, palmShoot, 1, poleShoot);
    this.orientHand(shoot, nShoot, fingersShoot, wShoot);
    this.orientHand(other, nGuide, fingersGuide, wGuide);
    rig.reachPalm(other, palmGuide, 1, poleGuide);
    this.orientHand(other, nGuide, fingersGuide, wGuide);
    if (this.exiting) this.blendFrom(armBones, armFrom, exit);

    if (released || this.exiting) return null;
    // A bola fica na palma, do lado para onde ela olha (sem vão quando o IK não alcança).
    const palmNow = rig.palmWorld(shoot, new THREE.Vector3());
    const ballOnHand = palmNow.addScaledVector(nShoot, PalmToBall);
    const held = ball.lerp(ballOnHand, 0.85);
    return held.applyMatrix4(rig.root.matrixWorld.clone().invert());
  }

  /**
   * Orienta a mão: dedos = +Y local do osso, polegar = +Z, palma olhando para -X (direita) ou +X (esquerda), medido na
   * pose de repouso (o mesmo da bandeja).
   */
  private orientHand(hand: Side, normal: THREE.Vector3, fingers: THREE.Vector3, weight: number): void {
    if (weight <= 1e-3) return;
    const bone = this.rig.bone(`hand_${hand}`);
    const n = normal.clone().normalize();
    const y = fingers.clone().addScaledVector(n, -fingers.dot(n)).normalize();
    const x = hand === 'r' ? n.clone().negate() : n.clone();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    const m = new THREE.Matrix4().makeBasis(x, y, z);
    const want = new THREE.Quaternion().setFromRotationMatrix(m);
    const parentWorld = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    const cur = bone.getWorldQuaternion(new THREE.Quaternion());
    const world = cur.slerp(want, weight);
    bone.quaternion.copy(parentWorld.invert().multiply(world));
    bone.updateWorldMatrix(false, true);
  }
}
