// Corpo da bandeja, desenhado por cima do plano do núcleo (src/sim/HoopsLayup.ts). O mocap aberto não tem bandejas
// (a CMU tem uma só, de dois pés e em pé), então o corpo sai do plano:
//  - pés: presos no chão em cada contato do plano (sem deslizar por construção), com o calcanhar subindo no fim do
//    contato; no ar, o pé vai de um contato ao outro num arco; no voo, o joelho de impulso sobe (coxa quase na
//    horizontal) e a perna da decolagem fica para trás, e as duas descem para o pouso;
//  - pelve: na altura do centro de massa do plano (penúltimo passo mais baixo, plant, voo balístico, absorção), nunca
//    mais alta do que a perna apoiada alcança; giro do quadril para o lado do joelho que sobe;
//  - bola e mãos: a bola segue um caminho desenhado (pega, bolso no quadril do lado da mão, sobe pelo peito, soltura) e
//    as palmas vão até ela por IK, com a orientação da palma de cada finalização (para a tabela na bandeja por cima, para
//    cima no finger roll/jelly/scoop). A outra mão sai da bola e protege (braço de proteção).
// Tronco, ombros e cabeça vêm do clipe da bandeja (Layup_R/L) no tempo mapeado do plano, com a inclinação por fase.
// Tudo no mundo do three.js (Y para cima); o plano está no núcleo e passa por toThree.
import * as THREE from 'three';
import {
  LayupFinish,
  LayupGather,
  type LayupContact,
  type LayupPlan,
  type Side,
  layupCom,
  layupFootState,
  layupHeight,
  HoldCrouch,
  DunkTuning,
  hangSwing,
  isDunkFinish,
  isTwoHandDunk,
} from '../sim/HoopsLayup';
import type { HoldBall, HoldPose } from '../sim/HoopsHold';
import { toThree } from '../units';
import { catmull, type V3 } from './ProceduralMoves';
import { applyPole, solveTwoBoneIK } from './TwoBoneIK';

/** O que o animador empresta para a bandeja (ossos e IKs dele). */
export interface LayupRig {
  bone(name: string): THREE.Bone;
  reachPalm(hand: Side, target: THREE.Vector3, weight: number, pole: THREE.Vector3): void;
  soleHeight(side: Side): number;
  palmWorld(hand: Side, out?: THREE.Vector3): THREE.Vector3;
  readonly root: THREE.Object3D;
  readonly model: THREE.Object3D;
  /** Pé reto no chão, relativo à raiz (bind pose). */
  restFootLocal(side: Side): THREE.Quaternion;
  readonly restAnkleY: number;
}

const LegSoft = 0.03;

/** Referencial do corpo no mundo: origem na raiz (no chão), esquerda, cima e frente. */
interface BodyFrame {
  origin: THREE.Vector3;
  left: THREE.Vector3;
  up: THREE.Vector3;
  fwd: THREE.Vector3;
}
const sideSign = (s: Side): number => (s === 'l' ? 1 : -1); // +x do jogador = esquerda
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
};
const BallR = 0.119;
/** Palma até o centro da bola (raio + a espessura da mão). */
const PalmToBall = BallR + 0.025;

/** Clipe da bandeja (CMU 124_06, Tools/Animacao/README.md): gather 18, decolagem 25, soltura 45, pouso ~66, fim 82. */
const ClipFrames = { gather: 12, takeoff: 25, release: 45, land: 66, end: 82 };

/**
 * Bola na soltura (referencial do corpo: x = esquerda, y = cima a partir do chão de pé, z = frente) por finalização. y é
 * proporcional à altura (a mesma `ballHeight` do núcleo); x é para o lado da mão (sinal da mão aplicado depois).
 */
const ReleaseLateral: Record<LayupFinish, number> = {
  [LayupFinish.Overhand]: 0.12,
  [LayupFinish.FingerRoll]: 0.2,
  [LayupFinish.Scoop]: 0.26,
  [LayupFinish.Jelly]: 0.34,
  [LayupFinish.Reverse]: 0.1,
  [LayupFinish.Floater]: 0.06,
  [LayupFinish.Power]: 0,
  [LayupFinish.DunkOneHand]: 0.12,
  [LayupFinish.DunkTwoHand]: 0,
  [LayupFinish.Tomahawk]: 0.1,
  [LayupFinish.CockBack]: 0,
  [LayupFinish.Windmill]: 0.12,
};

/** Pose da bola presa já no three.js (o Freestyle dá a do núcleo a cada quadro). */
interface HoldThree {
  feet: Record<Side, { pos: THREE.Vector3; lift: number; planted: boolean }>;
  crouch: number;
  ball: HoldBall;
  ballWeight: number;
}

export class LayupMotion {
  plan: LayupPlan | null = null;
  /** Bola presa (depois do hop step): pés, agachamento e bola vêm da pose do núcleo (HoopsHold), não de um plano. */
  private hold: HoldThree | null = null;
  /** s desde o gather (o Freestyle dá a cada quadro). */
  t = 0;
  private hand: Side = 'r';
  private ballHeightH = 1.27;
  private readonly start = {
    ankle: { l: new THREE.Vector3(), r: new THREE.Vector3() },
    palmBody: { l: new THREE.Vector3(), r: new THREE.Vector3() },
    /** Rotação das mãos no começo (relativa à raiz): a entrada parte dela, não da pose do clipe. */
    handQ: { l: new THREE.Quaternion(), r: new THREE.Quaternion() },
    ballBody: new THREE.Vector3(),
    pelvisOffsetBody: new THREE.Vector3(),
  };
  private ballKeys: [number, V3][] = [];
  private releasePalm = new THREE.Vector3();
  /** Palma da mão da bola no último quadro antes da soltura (referencial do corpo). */
  private lastPalmBody = new THREE.Vector3();
  private releaseDir = new THREE.Vector3();
  private releasedSeen = false;
  private dims = { thigh: 0.43, shank: 0.5, footToBall: 0.127, hipHalf: 0.1, pelvisAboveHip: 0.11, arm: 0.64, shoulderAbovePelvis: 0.5 };
  /** Tornozelo acima do chão com o pé apoiado reto (medido pela sola no começo; a pose de repouso dá ~2 cm). */
  private ankleFlat = 0.07;
  /**
   * Quanto a pelve está abaixo do plano por causa do alcance da perna apoiada. Quando o pé sai do chão a diferença some
   * em ~0,07 s (soltar de uma vez dava um salto de 17 cm na decolagem).
   */
  private clampDeficit = 0;
  /** Pendurado: distância horizontal do ombro da mão até o ponto do aro (medida no quadro anterior). */
  private hangHoriz = 0.1;
  /** Correção da pelve pendurada pelo erro vertical palma -> aro do quadro anterior (a palma na mão espalmada fica à frente do punho). */
  private hangLift = 0;
  private lastT = 0;

  /** Ossos do tronco que a bandeja desenha a partir da pose de repouso (de cima para baixo na hierarquia). */
  private static readonly TrunkBones = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'neck_02', 'head', 'clavicle_l', 'clavicle_r'];
  /** Rotações locais da pose de repouso (T-pose: tronco ereto) e a pelve no espaço do modelo. */
  private readonly rest = new Map<string, THREE.Quaternion>();
  private readonly restPelvisInModel = new THREE.Quaternion();
  /** Rotações locais do tronco no começo da bandeja (a entrada parte delas). */
  private readonly startLocal = new Map<string, THREE.Quaternion>();
  /** Altura do quadril do plano neste quadro (antes do limite de alcance): os pés no ar ficam em relação a ele. */
  private hipYPlanned = 1;

  /** Construir com o esqueleto ainda na pose de repouso (antes do primeiro update do mixer). */
  constructor(private readonly rig: LayupRig) {
    for (const name of LayupMotion.TrunkBones) this.rest.set(name, rig.bone(name).quaternion.clone());
    rig.model.updateMatrixWorld(true);
    const modelQ = rig.model.getWorldQuaternion(new THREE.Quaternion());
    this.restPelvisInModel.copy(modelQ.invert().multiply(rig.bone('pelvis').getWorldQuaternion(new THREE.Quaternion())));
    // Braço (ombro -> palma) e ombro acima da pelve com o tronco ereto: o pendurado no aro põe a pelve onde os braços
    // esticados alcançam o aro.
    const P = (n: string) => rig.bone(n).getWorldPosition(new THREE.Vector3());
    this.dims.arm = P('upperarm_r').distanceTo(P('lowerarm_r')) + P('lowerarm_r').distanceTo(P('hand_r')) + P('hand_r').distanceTo(rig.palmWorld('r', new THREE.Vector3()));
    this.dims.shoulderAbovePelvis = P('upperarm_r').y - P('pelvis').y;
  }

  /** Medidas do braço (para a sonda e o pendurado). */
  get armDims(): { arm: number; shoulderAbovePelvis: number } {
    return { arm: this.dims.arm, shoulderAbovePelvis: this.dims.shoulderAbovePelvis };
  }

  get active(): boolean {
    return this.plan !== null || this.hold !== null;
  }

  get holding(): boolean {
    return this.hold !== null;
  }

  /**
   * Entra na bola presa (fim do hop step): o plano acaba e o corpo passa a seguir a pose do núcleo. Guarda a pose de
   * agora para a entrada sem salto.
   */
  beginHold(pose: HoldPose, ballWorld: THREE.Vector3): void {
    const rig = this.rig;
    this.setHoldPose(pose);
    this.plan = null;
    this.t = 0;
    this.lastT = 0;
    this.clampDeficit = 0;
    const P = (n: string) => rig.bone(n).getWorldPosition(new THREE.Vector3());
    for (const sd of ['l', 'r'] as const) {
      this.start.ankle[sd].copy(P(`foot_${sd}`));
      this.toBody(rig.palmWorld(sd, new THREE.Vector3()), this.start.palmBody[sd]);
    }
    this.toBody(ballWorld, this.start.ballBody);
    for (const name of LayupMotion.TrunkBones) this.startLocal.set(name, rig.bone(name).quaternion.clone());
    this.toBodyDir(P('pelvis').sub(this.pelvisPlanned(0)), this.start.pelvisOffsetBody);
  }

  /** Pose da bola presa deste quadro (núcleo -> three). */
  setHoldPose(pose: HoldPose): void {
    const f = (sd: Side) => ({ pos: toThree(pose.feet[sd].pos).setY(0), lift: pose.feet[sd].lift, planted: pose.feet[sd].planted });
    this.hold = { feet: { l: f('l'), r: f('r') }, crouch: pose.crouch, ball: pose.ball, ballWeight: pose.ballWeight };
  }

  /** Começa a bandeja: guarda de onde os pés, as mãos, a bola e a pelve partem (continuidade sem salto). */
  begin(plan: LayupPlan, ballWorld: THREE.Vector3, heightM: number): void {
    const rig = this.rig;
    this.plan = plan;
    // Saindo da bola presa: o corpo volta a seguir o plano (sem isso a pelve ficava na pose presa e o jogador afundava).
    this.hold = null;
    this.t = 0;
    this.lastT = 0;
    this.clampDeficit = 0;
    this.hand = plan.choice.hand;
    this.releasedSeen = false;
    this.hangLift = 0;
    const P = (n: string) => rig.bone(n).getWorldPosition(new THREE.Vector3());
    this.dims.thigh = P('thigh_l').distanceTo(P('calf_l'));
    this.dims.shank = P('calf_l').distanceTo(P('foot_l'));
    this.dims.footToBall = P('foot_l').distanceTo(P('ball_l'));
    this.dims.hipHalf = P('thigh_l').distanceTo(P('thigh_r')) / 2;
    const hipMid = P('thigh_l').add(P('thigh_r')).multiplyScalar(0.5);
    this.dims.pelvisAboveHip = P('pelvis').y - hipMid.y;
    // Tornozelo acima da sola: no pé mais baixo (o apoiado), tornozelo menos o ponto mais baixo da sola.
    const low: Side = P('foot_l').y < P('foot_r').y ? 'l' : 'r';
    const measured = P(`foot_${low}`).y - rig.soleHeight(low);
    if (measured > 0.03 && measured < 0.14) this.ankleFlat = measured;
    for (const s of ['l', 'r'] as const) {
      this.start.ankle[s].copy(P(`foot_${s}`));
      this.toBody(rig.palmWorld(s, new THREE.Vector3()), this.start.palmBody[s]);
      const rootInv = rig.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.start.handQ[s].copy(rootInv.multiply(rig.bone(`hand_${s}`).getWorldQuaternion(new THREE.Quaternion())));
    }
    this.lastPalmBody.copy(this.start.palmBody[this.hand]);
    this.toBody(ballWorld, this.start.ballBody);
    for (const name of LayupMotion.TrunkBones) this.startLocal.set(name, rig.bone(name).quaternion.clone());
    // A pelve parte de onde está: a diferença para a pelve do plano some em ~0,1 s.
    const planned = this.pelvisPlanned(0);
    this.toBodyDir(P('pelvis').sub(planned), this.start.pelvisOffsetBody);
    this.ballHeightH = heightM;
    this.buildBallKeys();
  }

  end(): void {
    this.plan = null;
    this.hold = null;
  }

  // ----------------------------------------------------------------------------------------- referencial do corpo

  private frame(): BodyFrame {
    const q = this.rig.root.quaternion;
    return {
      origin: this.rig.root.position,
      left: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
      up: new THREE.Vector3(0, 1, 0),
      fwd: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
    };
  }

  /** Ponto do mundo -> corpo (x = esquerda, y = cima, z = frente; origem na raiz, no chão). */
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

  // ----------------------------------------------------------------------------------------- clipe

  /** Tempo do clipe da bandeja para o instante t do plano (o tronco e os ombros acompanham as fases do plano). */
  clipTime(t: number): number {
    const p = this.plan!;
    const F = ClipFrames;
    const seg = (t0: number, t1: number, f0: number, f1: number) => f0 + (f1 - f0) * Math.min(1, Math.max(0, (t - t0) / Math.max(1e-3, t1 - t0)));
    let f: number;
    if (t < p.takeoffAt) f = seg(0, p.takeoffAt, F.gather, F.takeoff);
    else if (t < p.releaseAt) f = seg(p.takeoffAt, p.releaseAt, F.takeoff, F.release);
    else if (t < p.landAt) f = seg(p.releaseAt, p.landAt, F.release, F.land);
    else f = seg(p.landAt, p.endAt, F.land, F.end);
    return f / 60;
  }

  static readonly clipStart = ClipFrames.gather / 60;
  static readonly clipEnd = ClipFrames.end / 60;

  // ----------------------------------------------------------------------------------------- corpo

  private standHip(): number {
    return this.ankleFlat + 0.97 * (this.dims.thigh + this.dims.shank);
  }

  /** Pelve do plano (mundo), sem a correção de continuidade nem o limite de alcance da perna. */
  private pelvisPlanned(t: number): THREE.Vector3 {
    const z = this.hold ? HoldCrouch - this.hold.crouch : layupHeight(this.plan!, t).z;
    return this.fromBody(0, this.standHip() + this.dims.pelvisAboveHip + z, 0);
  }

  /** Pelve, quadris, pernas e pés. Chamar depois do applyStance (que resolveu as pernas pelo clipe). */
  applyBody(): void {
    const plan = this.plan;
    if (!plan && !this.hold) return;
    const rig = this.rig;
    const t = this.t;
    const f = this.frame();

    // 1) Pelve do plano (com a continuidade) antes dos pés: os pés no ar ficam em relação a ela.
    const pelvis = rig.bone('pelvis');
    const want = this.pelvisPlanned(t);
    // Continuidade: na horizontal a diferença some em ~0,1 s; na altura, até o plant (a corrida com bola é mais baixa que
    // o "de pé" do plano: o corpo fica na altura da corrida nos passos e chega à altura do plano no plant, em vez de
    // subir 15–20 cm no primeiro quadro do gather).
    const fade = Math.exp(-t / 0.09);
    // Parado (bandeja/enterrada saindo de pé) não há passadas: a pelve desce para o agachamento em ~0,15 s, não num quadro.
    const plantOn = plan ? Math.max(0.15, plan.speedKeys[1][0]) : 0.2;
    const fadeY = 1 - smooth(0, plantOn, t);
    const off = this.start.pelvisOffsetBody;
    want.addScaledVector(f.left, off.x * fade).addScaledVector(f.up, off.y * fadeY).addScaledVector(f.fwd, off.z * fade);
    // Pendurado: a pelve fica onde os braços quase esticados alcançam as mãos no aro (o esqueleto manda; o núcleo dá o tempo).
    const hang = plan?.hang;
    if (hang) {
      const wH = smooth(hang.grabAt, hang.grabAt + 0.15, t) * (1 - smooth(hang.dropAt, hang.dropAt + 0.12, t));
      if (wH > 0) {
        const gripY = hang.grips.reduce((a, g) => a + g.z, 0) / hang.grips.length;
        // O braço vai do ombro ao aro: a parte vertical é o que sobra do braço depois da distância horizontal (quadro anterior).
        const reach = 0.97 * this.dims.arm;
        const vertical = Math.sqrt(Math.max(0.04, reach * reach - this.hangHoriz * this.hangHoriz));
        const y = gripY - vertical - this.dims.shoulderAbovePelvis + this.hangLift;
        want.y += (y - want.y) * wH;
      }
    }
    this.hipYPlanned = want.y - this.dims.pelvisAboveHip;

    // 2) Alvos dos tornozelos e orientação dos pés.
    const ankles = { l: new THREE.Vector3(), r: new THREE.Vector3() };
    const footQ = { l: new THREE.Quaternion(), r: new THREE.Quaternion() };
    const planted = { l: false, r: false };
    for (const s of ['l', 'r'] as const) planted[s] = this.footTarget(s, t, ankles[s], footQ[s]);

    // 3) A pelve não sobe além do que a perna apoiada alcança (a diferença some suave quando o pé sai do chão).
    const legMax = (this.dims.thigh + this.dims.shank) * 0.995;
    let limit = Infinity;
    for (const s of ['l', 'r'] as const) {
      if (!planted[s]) continue;
      const hip = want.clone().addScaledVector(f.left, sideSign(s) * this.dims.hipHalf);
      const dx = Math.hypot(ankles[s].x - hip.x, ankles[s].z - hip.z);
      const reach = Math.sqrt(Math.max(0.01, legMax * legMax - dx * dx));
      limit = Math.min(limit, ankles[s].y + reach + this.dims.pelvisAboveHip);
    }
    const deficit = Math.max(0, want.y - limit);
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    this.clampDeficit = deficit >= this.clampDeficit ? deficit : deficit + (this.clampDeficit - deficit) * Math.exp(-dt / 0.07);
    want.y -= this.clampDeficit;
    const parent = pelvis.parent!;
    pelvis.position.copy(want.clone().applyMatrix4(parent.matrixWorld.clone().invert()));

    // 4) Pelve e tronco a partir da pose de repouso (ereta), com a inclinação de cada fase. O clipe da CMU dobrava e
    // afundava o jogador no gather. Entrada de 0,15 s a partir da pose em que ele estava.
    const enter = smooth(0, 0.15, t);
    const lean = this.trunkLean(t);
    const twist = this.hipTwist(t);
    const modelQ = rig.model.getWorldQuaternion(new THREE.Quaternion());
    const pelvisPitch = lean.pitch * 0.35;
    const qExtra = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), twist)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(pelvisPitch)));
    const pelvisWorld = modelQ.clone().multiply(qExtra).multiply(this.restPelvisInModel);
    const pelvisLocal = parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(pelvisWorld);
    pelvis.quaternion.copy(this.startLocal.get('pelvis')!).slerp(pelvisLocal, enter);
    pelvis.updateWorldMatrix(true, true);
    const spinePitch = (lean.pitch - pelvisPitch) / 3;
    const qSpine = new THREE.Quaternion()
      .setFromAxisAngle(f.left, THREE.MathUtils.degToRad(spinePitch))
      .multiply(new THREE.Quaternion().setFromAxisAngle(f.fwd, THREE.MathUtils.degToRad(lean.roll / 3)))
      .multiply(new THREE.Quaternion().setFromAxisAngle(f.up, (-twist * 0.6) / 3));
    // Cabeça: desfaz ~70% da inclinação (olhos no aro) e olha para cima no voo.
    const qHead = new THREE.Quaternion().setFromAxisAngle(f.left, THREE.MathUtils.degToRad((-lean.pitch * 0.7 - lean.lookUp) / 3));
    // Ombro da mão da bola sobe quando o braço estica para cima (alcance).
    const shoulderUp = this.shoulderLift(t);
    for (const name of LayupMotion.TrunkBones) {
      if (name === 'pelvis') continue;
      const b = rig.bone(name);
      b.quaternion.copy(this.rest.get(name)!);
      b.updateWorldMatrix(false, true);
      let q: THREE.Quaternion | null = null;
      if (name.startsWith('spine_')) q = qSpine;
      else if (name.startsWith('neck_') || name === 'head') q = qHead;
      else if (name === `clavicle_${this.hand}`) {
        // Gira em torno da frente do corpo: o ombro do lado da mão sobe.
        q = new THREE.Quaternion().setFromAxisAngle(f.fwd, THREE.MathUtils.degToRad(-sideSign(this.hand) * shoulderUp));
      } else if (name.startsWith('clavicle_') && this.plan && isTwoHandDunk(this.plan.choice.finish)) {
        // Enterrada de duas mãos: os dois ombros sobem.
        const other: Side = this.hand === 'r' ? 'l' : 'r';
        q = new THREE.Quaternion().setFromAxisAngle(f.fwd, THREE.MathUtils.degToRad(-sideSign(other) * shoulderUp));
      }
      if (q) {
        const bw = b.getWorldQuaternion(new THREE.Quaternion());
        b.quaternion.multiply(bw.clone().invert().multiply(q).multiply(bw));
      }
      if (enter < 1) b.quaternion.copy(this.startLocal.get(name)!.clone().slerp(b.quaternion, enter));
      b.updateWorldMatrix(false, true);
    }

    // 4) Pernas: IK até os alvos, joelho para a frente (e para fora), pé orientado, sola nunca abaixo do chão.
    for (const s of ['l', 'r'] as const) {
      const thigh = rig.bone(`thigh_${s}`);
      const calf = rig.bone(`calf_${s}`);
      const foot = rig.bone(`foot_${s}`);
      // Joelho para a frente e um pouco para fora; na bola presa bem para fora, por cima da ponta do pé (base larga).
      const pole = f.fwd.clone().addScaledVector(f.left, sideSign(s) * (this.hold ? 0.7 : 0.25)).normalize();
      solveTwoBoneIK(thigh, calf, foot, ankles[s], pole, LegSoft);
      applyPole(thigh, calf, ankles[s], pole, 1);
      this.orientFoot(foot, footQ[s]);
      const below = -rig.soleHeight(s);
      if (below > 0) {
        ankles[s].y += below;
        solveTwoBoneIK(thigh, calf, foot, ankles[s], pole, LegSoft);
        this.orientFoot(foot, footQ[s]);
      }
    }
  }

  private orientFoot(foot: THREE.Bone, worldQ: THREE.Quaternion): void {
    const parentWorld = foot.parent!.getWorldQuaternion(new THREE.Quaternion());
    foot.quaternion.copy(parentWorld.invert().multiply(worldQ));
    foot.updateWorldMatrix(false, true);
  }

  /** Pé reto apontando para `dir` (mundo, horizontal), com a ponta inclinada `pitchDeg` para baixo. */
  private footOrientation(side: Side, dir: THREE.Vector3, pitchDeg: number, out: THREE.Quaternion): THREE.Quaternion {
    const yaw = Math.atan2(dir.x, dir.z);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    // Eixo lateral do pé (esquerda do pé): girar em torno dele com ângulo positivo leva a ponta para baixo.
    const lateral = new THREE.Vector3(1, 0, 0).applyQuaternion(qYaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(lateral, THREE.MathUtils.degToRad(pitchDeg));
    return out.copy(qPitch).multiply(qYaw).multiply(this.rig.restFootLocal(side));
  }

  /**
   * Alvo do tornozelo (mundo) e orientação do pé no instante t. Retorna true se o pé está apoiado. A raiz já está na
   * posição do plano (o Freestyle move o jogador pelo plano antes de animar).
   */
  private footTarget(side: Side, t: number, out: THREE.Vector3, q: THREE.Quaternion): boolean {
    if (this.hold) {
      // Bola presa: o pé está onde o núcleo diz (o pivô nunca sai); o pé livre sobe um pouco no passo.
      const h = this.hold.feet[side];
      const enter = smooth(0, 0.12, t);
      out.copy(this.start.ankle[side]).lerp(h.pos.clone().setY(this.ankleFlat + h.lift), enter);
      this.footOrientation(side, this.frame().fwd, h.lift > 0.01 ? 14 : 0, q);
      return h.planted;
    }
    const plan = this.plan!;
    const ankleY = this.ankleFlat;
    const st = layupFootState(plan, side, t);
    const f = this.frame();
    if (st.contact) {
      const c = st.contact;
      const dir = toThree(c.dir).setY(0).normalize();
      const pos = toThree(c.pos).setY(ankleY);
      // Calcanhar sobe no fim do contato (o pé rola sobre a ponta e empurra), menos no pouso.
      let pitch = 0;
      if (Number.isFinite(c.off) && c.role !== 'land') {
        const p = (t - c.on) / Math.max(1e-3, c.off - c.on);
        pitch = 38 * smooth(0.5, 1, p);
      } else if (c.role === 'land') {
        // Pouso: toca com a ponta e baixa o calcanhar em ~0,06 s.
        pitch = 18 * (1 - smooth(0, 0.07, t - c.on));
      }
      if (pitch > 0.01) {
        // Gira em volta da ponta do pé (presa no chão).
        const toe = pos.clone().addScaledVector(dir, this.dims.footToBall).setY(0.03);
        const lateral = new THREE.Vector3(dir.z, 0, -dir.x); // esquerda do pé
        pos.sub(toe).applyAxisAngle(lateral, -THREE.MathUtils.degToRad(pitch)).add(toe);
      }
      out.copy(pos);
      this.footOrientation(side, dir, pitch, q);
      return true;
    }
    const to = st.to;
    const from = st.from;
    // Voo: do último contato até o pouso.
    if (to && to.role === 'land') {
      this.flightFoot(side, t, from, to, out, q);
      return false;
    }
    // No ar entre dois contatos: arco do ponto de saída até o próximo toque.
    const a = from ? toThree(from.pos).setY(ankleY) : this.start.ankle[side].clone();
    const aOff = from ? from.off : 0;
    const b = to ? toThree(to.pos).setY(ankleY) : a.clone();
    const bOn = to ? to.on : aOff + 0.2;
    const s = Math.min(1, Math.max(0, (t - aOff) / Math.max(1e-3, bOn - aOff)));
    const dir = to ? toThree(to.dir).setY(0).normalize() : f.fwd.clone();
    if (to && to.role === 'hop' && plan.stopAt !== undefined) {
      // Hop com parada: o pé anda junto com o corpo (posição relativa ao centro de massa, da saída até o pouso) e os dois
      // se juntam no ar. Ir direto ao ponto do pouso deixava a perna esticada lá na frente esperando o corpo.
      const com = (tt: number) => toThree(layupCom(plan, tt).pos).setY(0);
      const rel = a.clone().sub(com(aOff)).lerp(b.clone().sub(com(bOn)), s * s * (3 - 2 * s));
      out.copy(com(t)).add(rel);
      out.y = THREE.MathUtils.lerp(a.y, ankleY, s) + 0.12 * Math.sin(Math.PI * Math.pow(s, 0.8));
      this.footOrientation(side, dir, 16 * Math.sin(Math.PI * s), q);
      return false;
    }
    if (!from) {
      // O pé já estava no ar no gather: está no fim do balanço. Vai para a frente rápido (a perna da frente estica
      // buscando o chão) e desce, sem refazer o arco por baixo do quadril (que dobrava o joelho no meio do voo).
      // Curva de saída 1,5x a média: o pé já vinha balançando, mas 2,2x fazia o tornozelo pular ~30 cm no primeiro quadro.
      const e = 1 - Math.pow(1 - s, 1.5);
      out.lerpVectors(a, b, e);
      out.y = THREE.MathUtils.lerp(a.y, ankleY, smooth(0, 1, s)) + 0.05 * Math.sin(Math.PI * s);
      this.footOrientation(side, dir, THREE.MathUtils.lerp(20, -6, s), q);
      return false;
    }
    // Balanço inteiro: o calcanhar sobe atrás, o pé passa por baixo do quadril (pico antes do meio) e a perna estica à
    // frente para pousar.
    const e = s * s * (3 - 2 * s);
    out.lerpVectors(a, b, e);
    const lift = Math.min(0.32, 0.12 + 0.35 * a.distanceTo(b) * 0.25);
    out.y += lift * Math.sin(Math.PI * Math.pow(s, 0.8));
    this.footOrientation(side, dir, 30 * Math.sin(Math.PI * s) * (1 - s * 0.5), q);
    return false;
  }

  /**
   * Pé no voo. Joelho de impulso: sobe com a coxa quase na horizontal (Coach's Clipboard: "o joelho do lado da mão sobe
   * com a bola"); perna da decolagem: fica para trás, dobrada; as duas descem para o pouso. No hop, as duas sobem juntas.
   */
  private flightFoot(side: Side, t: number, from: LayupContact | null, to: LayupContact, out: THREE.Vector3, q: THREE.Quaternion): void {
    const plan = this.plan!;
    const rig = this.rig;
    const f = this.frame();
    const ankleY = this.ankleFlat;
    const hipY = this.hipYPlanned;
    const lateral = sideSign(side) * this.dims.hipHalf;
    const drive = plan.driveKnee === side;
    const both = plan.takeoffFoot === 'both';
    // Pose no ar, relativa ao quadril (corpo).
    const L = this.dims.thigh + this.dims.shank;
    let air: THREE.Vector3;
    if (both) air = this.fromBody(lateral, 0, 0.1).setY(hipY - 0.68 * L);
    else if (drive) air = this.fromBody(lateral * 0.8, 0, 0.36).setY(hipY - 0.5 * L);
    else air = this.fromBody(lateral, 0, -0.22).setY(hipY - 0.7 * L);
    // Pendurado no aro: as duas pernas penduradas embaixo do quadril, joelhos um pouco dobrados, balançando junto com o
    // corpo (os pés andam mais que o quadril no pêndulo).
    const hang = plan.hang;
    if (hang) {
      const wHang = smooth(hang.grabAt - 0.05, hang.grabAt + 0.25, t);
      const legFwd = 0.12 + 0.8 * hangSwing(t - hang.grabAt - 0.08) + (side === plan.driveKnee ? 0.06 : 0);
      air.lerp(this.fromBody(lateral * 0.95, 0, legFwd).setY(hipY - 0.92 * L), wHang);
    }
    const t0 = from ? from.off : 0;
    const start = from ? toThree(from.pos).setY(ankleY) : this.start.ankle[side].clone();
    if (from) {
      // O ponto de saída acompanha o corpo desde a saída do chão (senão o pé ficava preso no chão e esticava a perna).
      const comOff = toThree(layupCom(plan, t0).pos).setY(layupHeight(plan, t0).z);
      const comNow = rig.root.position.clone().setY(layupHeight(plan, t).z);
      start.add(comNow.sub(comOff));
    }
    // O joelho de impulso já sobe durante o plant (a perna passa por baixo e vem para cima); a perna da decolagem sai do
    // chão na decolagem.
    const upEnd = drive ? plan.takeoffAt + 0.06 : plan.takeoffAt + 0.16;
    const wUp = smooth(t0, upEnd, t);
    const wDown = smooth(plan.landAt - 0.24, to.on, t);
    const land = toThree(to.pos).setY(ankleY);
    out.lerpVectors(start, air, wUp).lerp(land, wDown);
    // Nunca abaixo do chão no ar.
    out.y = Math.max(out.y, ankleY);
    const dir = f.fwd.clone();
    const pitch = THREE.MathUtils.lerp(drive ? 20 : 45, 6, wDown) * Math.min(1, wUp * 1.5);
    this.footOrientation(side, dir, pitch, q);
  }

  /** Giro do quadril (rad, +Y): o lado do joelho que sobe vai à frente. */
  private hipTwist(t: number): number {
    if (this.hold) return 0;
    const plan = this.plan!;
    if (!plan.driveKnee) return 0;
    const sign = plan.driveKnee === 'r' ? 1 : -1;
    const w = smooth(plan.takeoffAt - 0.15, plan.takeoffAt + 0.05, t) * (1 - smooth(plan.landAt - 0.1, plan.landAt + 0.15, t));
    return sign * THREE.MathUtils.degToRad(16) * w;
  }

  /**
   * Inclinação do tronco (graus, + = à frente): à frente na passada longa do gather e nos passos, um pouco para trás no
   * plant (converte a corrida em subida), quase ereto no voo, à frente no pouso. roll = para o lado da outra mão no voo
   * (o braço da bola estica mais alto); lookUp = a cabeça sobe para o aro no voo.
   */
  private trunkLean(t: number): { pitch: number; roll: number; lookUp: number } {
    if (this.hold) {
      // Ameaça tripla do Jordan: tronco ~30° à frente, cabeça erguida; no pump fake o tronco sobe e os olhos vão no aro.
      const fake = this.hold.ball === 'forehead' ? this.hold.ballWeight : 0;
      const low = this.hold.ball === 'low' ? this.hold.ballWeight : 0;
      return { pitch: 30 - 14 * fake + 8 * low, roll: 0, lookUp: 8 * fake };
    }
    const p = this.plan!;
    const plantOn = p.speedKeys[1][0];
    const firstOn = p.contacts.find((c) => c.on >= 0)?.on ?? 0.15;
    const floater = p.choice.finish === LayupFinish.Floater;
    // Hop step com parada: o tronco vai à frente no pouso e chega à ameaça tripla (30°) da bola presa, sem subir.
    const keys: [number, number][] = p.stopAt !== undefined ? [
      [0, 12],
      [firstOn, 18],
      [plantOn, 24],
      [p.stopAt, 32],
      [p.takeoffAt, 30],
    ] : [
      [0, 12],
      [firstOn, 22],
      [plantOn, 18],
      [p.takeoffAt, -4],
      [p.apexAt, floater ? -2 : 6],
      [p.landAt, 10],
      [p.landAt + 0.12, 18],
      [p.endAt, 6],
    ];
    let pitch = keys[keys.length - 1][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, v0] = keys[i];
      const [t1, v1] = keys[i + 1];
      if (t <= t1) {
        pitch = THREE.MathUtils.lerp(v0, v1, smooth(t0, t1, t));
        break;
      }
    }
    const h = p.hang;
    const flightEnd = h ? h.grabAt + 0.1 : p.landAt;
    const reachSide = smooth(p.takeoffAt, p.releaseAt, t) * (1 - smooth(p.releaseAt, flightEnd, t));
    let roll = -sideSign(this.hand) * 9 * reachSide;
    let lookUp = 14 * smooth(plantOn, p.releaseAt, t) * (1 - smooth(p.releaseAt + 0.1, flightEnd, t));
    if (h) {
      // Pendurado: o corpo é um pêndulo embaixo das mãos (inclina com o balanço); de uma mão, pende para o lado dela.
      const w = smooth(h.grabAt, h.grabAt + 0.2, t) * (1 - smooth(h.dropAt, h.dropAt + 0.25, t));
      const swingDeg = (hangSwing(t - h.grabAt) / 1.3) * (180 / Math.PI);
      pitch = THREE.MathUtils.lerp(pitch, -2 - swingDeg, w);
      roll = THREE.MathUtils.lerp(roll, h.twoHands ? 0 : sideSign(this.hand) * 6, w);
      lookUp = THREE.MathUtils.lerp(lookUp, -6, w);
    }
    return { pitch, roll, lookUp };
  }

  /** Graus que o ombro da mão da bola sobe: com o braço esticando para a soltura. */
  private shoulderLift(t: number): number {
    if (this.hold) return 0;
    const p = this.plan!;
    // Enterrada: o braço vai todo para cima (e fica, pendurado, até soltar o aro).
    if (isDunkFinish(p.choice.finish)) {
      const until = p.hang ? p.hang.dropAt : p.releaseAt + 0.2;
      return 24 * smooth(p.takeoffAt, p.releaseAt - 0.05, t) * (1 - smooth(until, until + 0.25, t));
    }
    return 16 * smooth(p.takeoffAt, p.releaseAt, t) * (1 - smooth(p.releaseAt + 0.1, p.landAt, t));
  }

  // ----------------------------------------------------------------------------------------- bola e mãos

  /** Caminho da bola no corpo: de onde estava -> bolso do lado da mão -> peito -> rosto -> soltura. */
  private buildBallKeys(): void {
    const p = this.plan!;
    const s = sideSign(this.hand);
    const H = this.ballHeightH;
    const fin = p.choice.finish;
    const gather = p.choice.gather;
    const firstOn = p.contacts.find((c) => c.on >= 0)?.on ?? 0.15;
    const plantOn = p.speedKeys[1][0];
    const sb = this.start.ballBody;
    const keys: [number, V3][] = [[0, [sb.x, sb.y, sb.z]]];
    const tPocket = Math.max(0.1, Math.min(0.2, firstOn));
    if (gather === LayupGather.Euro) {
      // Euro: pega do lado de fora (o passo 1 vende esse lado) e cruza a bola na frente do corpo no passo 2.
      keys.push([tPocket, [-s * 0.2, 0.55 * H, 0.2]]);
      keys.push([plantOn, [s * 0.12, 0.62 * H, 0.24]]);
    } else if (gather === LayupGather.Cradle) {
      // Cradle: bola embalada baixa no antebraço, por fora do quadril.
      keys.push([tPocket, [s * 0.27, 0.45 * H, 0.1]]);
      keys.push([plantOn, [s * 0.24, 0.5 * H, 0.16]]);
    } else if (fin === LayupFinish.Scoop) {
      keys.push([tPocket, [s * 0.2, 0.52 * H, 0.2]]);
      keys.push([plantOn, [s * 0.24, 0.5 * H, 0.26]]);
    } else if (fin === LayupFinish.Power || gather === LayupGather.Hop || gather === LayupGather.ProHop) {
      // Hop: as duas mãos com a bola no peito, firme.
      keys.push([tPocket, [s * 0.08, 0.6 * H, 0.22]]);
      keys.push([plantOn, [s * 0.04, 0.64 * H, 0.26]]);
    } else {
      keys.push([tPocket, [s * 0.17, 0.55 * H, 0.2]]);
      keys.push([plantOn, [s * 0.14, 0.64 * H, 0.24]]);
    }
    // Soltura: a mesma altura que o núcleo usou (ballHeight·H no corpo de pé) e a bola à frente do corpo (reach).
    const relY = p.release.z - layupHeight(p, p.releaseAt).z;
    const relZ = fin === LayupFinish.Reverse ? -0.05 : Math.max(0.15, p.reach);
    if (isDunkFinish(fin)) {
      this.dunkBallKeys(keys, relY, relZ);
      this.ballKeys = keys;
      return;
    }
    const takeoffY = fin === LayupFinish.Scoop ? 0.62 * H : fin === LayupFinish.Floater ? 0.92 * H : 0.82 * H;
    keys.push([p.takeoffAt, [s * (fin === LayupFinish.Scoop ? 0.24 : 0.1), takeoffY, 0.28]]);
    keys.push([p.releaseAt, [s * ReleaseLateral[fin], relY, relZ]]);
    this.ballKeys = keys;
  }

  /**
   * Caminho da bola no voo da enterrada (depois do bolso do gather). Uma mão: sobe pelo lado da mão com o braço esticando.
   * Duas mãos: sobe pelo meio acima da cabeça. Tomahawk / cock-back: vai para trás da cabeça no alto e desce como um
   * machado. Moinho: desce pelo quadril, passa por trás e volta por cima num círculo do lado da mão.
   */
  private dunkBallKeys(keys: [number, V3][], relY: number, relZ: number): void {
    const p = this.plan!;
    const s = sideSign(this.hand);
    const H = this.ballHeightH;
    const fin = p.choice.finish;
    const t0 = p.takeoffAt;
    const dur = Math.max(0.15, p.releaseAt - t0);
    const at = (f: number) => t0 + dur * f;
    const rel: V3 = [s * ReleaseLateral[fin], relY, relZ];
    switch (fin) {
      case LayupFinish.DunkTwoHand:
        keys.push([t0, [s * 0.02, 0.86 * H, 0.26]]);
        keys.push([at(0.55), [0, 1.14 * H, 0.14]]);
        break;
      case LayupFinish.Tomahawk:
        keys.push([t0, [s * 0.12, 0.9 * H, 0.22]]);
        keys.push([at(0.62), [s * 0.16, 1.24 * H, -0.2]]);
        break;
      case LayupFinish.CockBack:
        keys.push([t0, [s * 0.02, 0.88 * H, 0.22]]);
        keys.push([at(0.62), [0, 1.2 * H, -0.2]]);
        break;
      case LayupFinish.Windmill:
        keys.push([t0, [s * 0.26, 0.6 * H, 0.3]]);
        keys.push([at(0.3), [s * 0.36, 0.5 * H, -0.12]]);
        keys.push([at(0.62), [s * 0.36, 1.12 * H, -0.24]]);
        break;
      default:
        keys.push([t0, [s * 0.14, 0.88 * H, 0.26]]);
        keys.push([at(0.55), [s * 0.16, 1.12 * H, 0.2]]);
    }
    keys.push([p.releaseAt, rel]);
  }

  /**
   * Onde as palmas agarram o aro (mundo) e para onde os dedos apontam (para a tabela). Pendurado: os pontos do núcleo;
   * sem pendurar, a frente do aro do lado da mão, para o toque rápido depois da enterrada.
   */
  private dunkGrips(plan: LayupPlan): { l: THREE.Vector3; r: THREE.Vector3; dir: THREE.Vector3 } {
    const rim = plan.rim!;
    const h = plan.hang;
    const toRim = h ? h.facing : rim.flat().sub(layupCom(plan, plan.releaseAt).pos).flat().normalized(plan.takeoffDir);
    const dir = toThree(toRim).setY(0).normalize();
    if (h && h.grips.length === 2) return { l: toThree(h.grips[0]), r: toThree(h.grips[1]), dir };
    const single = h
      ? toThree(h.grips[0])
      : toThree(rim.flat().sub(toRim.scale(0.236)).withZ(rim.z + 0.03));
    // A outra mão (só usada nas de duas mãos) fica do outro lado da frente do aro.
    const lateral = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(0.26); // esquerda de quem olha o aro
    return this.hand === 'r' ? { r: single, l: single.clone().add(lateral), dir } : { l: single, r: single.clone().sub(lateral), dir };
  }

  /** Centro da bola (mundo) no instante t, enquanto está na mão. */
  ballWorld(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.plan!;
    const keys = this.ballKeys;
    const k = catmull(keys, Math.min(t, p.releaseAt));
    const z = layupHeight(p, t).z;
    return this.fromBody(k[0], k[1] + z, k[2], out);
  }

  /** Palma (normal para onde ela olha) e dedos da mão da bola, por finalização, em t perto da soltura (corpo). */
  private shootingHandAxes(fin: LayupFinish, f: BodyFrame): { n: THREE.Vector3; fingers: THREE.Vector3 } {
    const s = sideSign(this.hand);
    const out = f.left.clone().multiplyScalar(s);
    let n: THREE.Vector3;
    switch (fin) {
      case LayupFinish.FingerRoll:
      case LayupFinish.Scoop:
        n = f.up.clone().multiplyScalar(0.92).addScaledVector(f.fwd, 0.35).normalize();
        break;
      case LayupFinish.Jelly:
        n = f.up.clone().multiplyScalar(0.85).addScaledVector(out, -0.35).addScaledVector(f.fwd, 0.25).normalize();
        break;
      case LayupFinish.Reverse:
        n = f.up.clone().multiplyScalar(0.9).addScaledVector(f.fwd, -0.3).normalize();
        break;
      case LayupFinish.Floater:
        n = f.fwd.clone().multiplyScalar(0.55).addScaledVector(f.up, 0.83).normalize();
        break;
      default:
        // Por cima: palma para a tabela/aro, um pouco para cima; dedos para cima.
        n = f.fwd.clone().multiplyScalar(0.8).addScaledVector(f.up, 0.6).normalize();
    }
    const underhand = fin === LayupFinish.FingerRoll || fin === LayupFinish.Scoop || fin === LayupFinish.Jelly || fin === LayupFinish.Reverse;
    const want = underhand ? f.fwd.clone().addScaledVector(out, fin === LayupFinish.Jelly ? 0.5 : 0.15) : f.up.clone();
    const fingers = want.addScaledVector(n, -want.dot(n)).normalize();
    return { n, fingers };
  }

  /**
   * Mãos e bola. Chamar por último entre os IKs dos braços. Retorna o centro da bola no referencial da raiz enquanto ela
   * está na mão (o BallDribbler segue esse ponto), ou null depois da soltura.
   */
  applyArms(released: boolean): THREE.Vector3 | null {
    if (this.hold) return this.applyHoldArms();
    const plan = this.plan;
    if (!plan) return null;
    const rig = this.rig;
    const t = this.t;
    const f = this.frame();
    const s = sideSign(this.hand);
    const H = this.ballHeightH;
    const shoot = this.hand;
    const other: Side = shoot === 'r' ? 'l' : 'r';
    const fin = plan.choice.finish;
    const twoHands = fin === LayupFinish.Power || isTwoHandDunk(fin);
    const dunk = isDunkFinish(fin);
    const hang = plan.hang;
    const ball = this.ballWorld(t);
    const inW = smooth(0, 0.14, t); // entrada a partir de onde as mãos estavam

    // Mão da bola: no gather e nos passos as duas mãos seguram dos lados; perto da soltura, a mão da bola vai para baixo/
    // atrás dela com a palma da finalização.
    const oneHand = twoHands ? 0 : smooth(plan.takeoffAt - 0.06, plan.releaseAt - 0.08, t);
    const axes = this.shootingHandAxes(fin, f);
    const sideN = f.left.clone().multiplyScalar(-s); // palma da mão da bola olhando para a bola (de fora para dentro)
    const nShoot = sideN.clone().lerp(axes.n, oneHand).normalize();
    const fingersShoot = f.fwd.clone().addScaledVector(f.up, 0.6).lerp(axes.fingers, oneHand).normalize();
    let palmShoot = ball.clone().addScaledVector(nShoot, -PalmToBall);
    // Mão de fora: segura do outro lado e sai para o braço de proteção (antebraço na frente do rosto).
    const offOn = twoHands
      ? 1
      : dunk
        ? 1 - smooth(plan.takeoffAt + 0.02, plan.takeoffAt + 0.18, t)
        : 1 - smooth(plan.takeoffAt - 0.02, plan.takeoffAt + 0.14, t);
    const nOther = f.left.clone().multiplyScalar(s);
    const guard = this.fromBody(-s * 0.2, 0.78 * H + layupHeight(plan, t).z, 0.3);
    const palmOtherBall = ball.clone().addScaledVector(nOther, -PalmToBall);
    let palmOther = guard.clone().lerp(palmOtherBall, offOn);
    let nOtherNow = f.fwd.clone().lerp(nOther, offOn).normalize();
    let fingersOther = f.up.clone().lerp(f.fwd.clone().addScaledVector(f.up, 0.6).normalize(), offOn).normalize();

    // Depois da soltura: a mão da bola segue o arremesso (follow-through) e as duas descem para o pouso.
    let wShoot = 1;
    let wOther = 1;
    if (released) {
      if (!this.releasedSeen) {
        this.releasedSeen = true;
        // A palma desenhada no último quadro com a bola (lida agora seria a do clipe, antes do IK: a mão pulava ~40 cm).
        this.releasePalm.copy(this.lastPalmBody);
        this.releaseDir.copy(this.toBodyDir(axes.n, new THREE.Vector3()));
      }
      const since = t - plan.releaseAt;
      const follow = smooth(0, 0.12, since);
      const rp = this.releasePalm;
      const fd = this.releaseDir;
      const z = layupHeight(plan, t).z - layupHeight(plan, plan.releaseAt).z;
      palmShoot = this.fromBody(rp.x + fd.x * 0.1 * follow, rp.y + z + fd.y * 0.1 * follow, rp.z + fd.z * 0.1 * follow);
      // Punho dobra no fim (follow-through): dedos para a frente/baixo.
      const flick = smooth(0, 0.1, since);
      const fingersFlick = axes.fingers.clone().lerp(f.fwd.clone().addScaledVector(f.up, -0.3).normalize(), 0.6 * flick).normalize();
      fingersShoot.copy(fingersFlick);
      const zNow = layupHeight(plan, t).z;
      // Enterrada: a(s) mão(s) agarram a frente do aro (pendurado, até soltar; sem pendurar, um toque de ~0,15 s).
      if (dunk) {
        const grip = this.dunkGrips(plan);
        const wGrip =
          smooth(plan.releaseAt, plan.releaseAt + DunkTuning.grabAfter, t) *
          (hang ? 1 - smooth(hang.dropAt, hang.dropAt + 0.18, t) : 1 - smooth(plan.releaseAt + 0.13, plan.releaseAt + 0.24, t));
        const down = new THREE.Vector3(0, -1, 0);
        const towardRim = grip.dir;
        if (wGrip > 0) {
          palmShoot.lerp(grip[shoot], wGrip);
          nShoot.lerp(down, wGrip).normalize();
          fingersShoot.lerp(towardRim, wGrip).normalize();
          if (twoHands) {
            palmOther.lerp(grip[other], wGrip);
            nOtherNow = nOtherNow.lerp(down, wGrip).normalize();
            fingersOther = fingersOther.lerp(towardRim, wGrip).normalize();
          }
        }
        if (hang) {
          const sh = rig.bone(`upperarm_${shoot}`).getWorldPosition(new THREE.Vector3());
          this.hangHoriz = Math.hypot(sh.x - grip[shoot].x, sh.z - grip[shoot].z);
        }
        // Uma mão pendurado: a outra desce relaxada ao lado do corpo.
        if (hang && !twoHands) {
          const relax = smooth(hang.grabAt, hang.grabAt + 0.25, t) * (1 - smooth(hang.dropAt, hang.dropAt + 0.2, t));
          // Pendurada embaixo do ombro (o corpo desenhado fica mais alto que o do núcleo: a pelve vai até o aro).
          const sh = rig.bone(`upperarm_${other}`).getWorldPosition(new THREE.Vector3());
          const hangDown = this.fromBody(-s * 0.26, 0, 0.06).setY(sh.y - 0.95 * (this.dims.arm - 0.1));
          palmOther.lerp(hangDown, relax);
          nOtherNow = nOtherNow.lerp(f.left.clone().multiplyScalar(s), relax).normalize();
          // Dedos para baixo passando pela frente (de "para cima" direto a "para baixo" o vetor passa por zero e a mão girava 180°).
          fingersOther = fingersOther.lerp(f.up.clone().multiplyScalar(-0.75).addScaledVector(f.fwd, 0.66).normalize(), relax).normalize();
        }
      }
      const downFrom = hang ? hang.dropAt + 0.05 : plan.releaseAt + (dunk ? 0.24 : 0.18);
      // Os braços descem até um pouco depois do pouso (o corpo já cai junto: descer antes dava a mão a ~7 m/s).
      const down = smooth(downFrom, Math.max(downFrom + 0.25, plan.landAt + 0.22), t);
      palmShoot.lerp(this.fromBody(s * 0.3, 0.52 * H + zNow, 0.22), down);
      palmOther.lerp(this.fromBody(-s * 0.3, 0.52 * H + zNow, 0.22), down);
      nOtherNow = nOtherNow.lerp(f.up.clone().negate(), down).normalize();
      fingersOther = fingersOther.lerp(f.fwd, down).normalize();
      // De volta ao clipe/locomoção no fim.
      const fadeOut = 1 - smooth(plan.landAt + 0.1, plan.endAt, t);
      wShoot = fadeOut;
      wOther = fadeOut;
    }

    // Entrada: das palmas de onde estavam (referencial do corpo) para o desenho.
    for (const [hand, target] of [
      [shoot, palmShoot],
      [other, palmOther],
    ] as const) {
      if (inW < 1) {
        const startW = this.fromBody(this.start.palmBody[hand].x, this.start.palmBody[hand].y, this.start.palmBody[hand].z);
        target.lerpVectors(startW, target.clone(), inW);
      }
    }

    // Cotovelos: para baixo e para fora (sob a bola), nunca abertos "em asa".
    const poleShoot = f.up.clone().multiplyScalar(-0.75).addScaledVector(f.left, s * 0.55).addScaledVector(f.fwd, -0.1).normalize();
    const poleOther = f.up.clone().multiplyScalar(-0.6).addScaledVector(f.left, -s * 0.75).normalize();
    if (dunk && released) {
      // Braços acima da cabeça (e no aro): cotovelos para fora e um pouco para trás.
      const w = 1 - smooth(plan.landAt - 0.1, plan.landAt + 0.1, t);
      poleShoot.lerp(f.left.clone().multiplyScalar(s).addScaledVector(f.fwd, -0.4).addScaledVector(f.up, -0.2).normalize(), w).normalize();
      if (twoHands) poleOther.lerp(f.left.clone().multiplyScalar(-s).addScaledVector(f.fwd, -0.4).addScaledVector(f.up, -0.2).normalize(), w).normalize();
      // Uma mão pendurado: o braço livre pende com o cotovelo para trás (o pole para baixo alinhava com o alvo e o cotovelo
      // virava num quadro).
      if (hang && !twoHands) {
        const relax = smooth(hang.grabAt - 0.1, hang.grabAt + 0.1, t) * (1 - smooth(hang.dropAt + 0.1, hang.dropAt + 0.3, t));
        poleOther.lerp(f.fwd.clone().multiplyScalar(-0.75).addScaledVector(f.left, -s * 0.55).normalize(), relax).normalize();
      }
    }
    // Entrada: a mão parte da rotação que tinha (a do clipe da bandeja é outra e o punho pulava ~20 cm no 1º quadro).
    const fromQ = (hand: Side) => (inW < 1 ? rig.root.getWorldQuaternion(new THREE.Quaternion()).multiply(this.start.handQ[hand]) : undefined);
    this.orientHand(shoot, nShoot, fingersShoot, wShoot * inW, fromQ(shoot));
    rig.reachPalm(shoot, palmShoot, wShoot, poleShoot);
    this.orientHand(shoot, nShoot, fingersShoot, wShoot * inW, fromQ(shoot));
    this.orientHand(other, nOtherNow, fingersOther, wOther * inW, fromQ(other));
    rig.reachPalm(other, palmOther, wOther, poleOther);
    this.orientHand(other, nOtherNow, fingersOther, wOther * inW, fromQ(other));

    // Pendurado: a pelve sobe/desce o que faltou para a palma chegar ao aro (fecha em poucos quadros).
    if (hang && t > hang.grabAt + 0.1 && t < hang.dropAt) {
      const gripY = this.dunkGrips(plan)[shoot].y;
      const err = gripY - rig.palmWorld(shoot, new THREE.Vector3()).y;
      this.hangLift = THREE.MathUtils.clamp(this.hangLift + 0.5 * err, -0.15, 0.35);
    }

    if (released) return null;
    // A bola fica na palma da mão da bola, do lado para onde ela olha (sem vão quando o IK não alcança).
    const palmNow = rig.palmWorld(shoot, new THREE.Vector3());
    this.toBody(palmNow, this.lastPalmBody);
    const ballOnHand = palmNow.addScaledVector(nShoot, PalmToBall);
    // Enterrada: nos últimos quadros a bola chega ao ponto planejado por cima do aro (a soltura soca dali), mesmo se o braço
    // não alcança inteiro.
    const onPlan = dunk ? smooth(plan.releaseAt - 0.14, plan.releaseAt - 0.02, t) : 0;
    const held = ball.lerp(ballOnHand, 0.85 * (1 - onPlan));
    if (onPlan > 0) held.lerp(toThree(plan.release), onPlan);
    return held.applyMatrix4(rig.root.matrixWorld.clone().invert());
  }

  /** Bola presa: as duas mãos na bola, que vai do bolso do quadril (ameaça tripla) para o ponto do movimento. */
  private applyHoldArms(): THREE.Vector3 {
    const rig = this.rig;
    const h = this.hold!;
    const t = this.t;
    const f = this.frame();
    const s = sideSign(this.hand);
    const H = this.ballHeightH;
    const z = HoldCrouch - h.crouch;
    // Pontos da bola no corpo (x = lado da mão, y = altura de pé + agachamento, z = frente).
    const at = (k: HoldBall): [number, number, number] => {
      switch (k) {
        case 'forehead':
          return [s * 0.04, 1.02 * H, 0.16];
        case 'chin':
          return [s * 0.1, 0.78 * H, 0.2];
        case 'low':
          return [s * 0.3, 0.44 * H, 0.12];
        default:
          return [s * 0.22, 0.52 * H, 0.2]; // bolso: quadril do lado da mão, à frente da coxa
      }
    };
    const pocket = at('pocket');
    const key = at(h.ball);
    const w = h.ballWeight;
    const bx = pocket[0] + (key[0] - pocket[0]) * w;
    const by = pocket[1] + (key[1] - pocket[1]) * w + (h.ball === 'forehead' ? 0 : z);
    const bz = pocket[2] + (key[2] - pocket[2]) * w;
    const ball = this.fromBody(bx, by, bz);
    const enter = smooth(0, 0.15, t);
    if (enter < 1) ball.lerp(this.fromBody(this.start.ballBody.x, this.start.ballBody.y, this.start.ballBody.z), 1 - enter);
    // Mão da bola atrás/de lado da bola, a outra do outro lado (bola protegida com as duas mãos).
    const shoot = this.hand;
    const other: Side = shoot === 'r' ? 'l' : 'r';
    const nShoot = f.left.clone().multiplyScalar(-s).addScaledVector(f.fwd, 0.35).normalize();
    const nOther = f.left.clone().multiplyScalar(s).addScaledVector(f.fwd, 0.2).normalize();
    const fingers = f.fwd.clone().addScaledVector(f.up, 0.5).normalize();
    const palmShoot = ball.clone().addScaledVector(nShoot, -PalmToBall);
    const palmOther = ball.clone().addScaledVector(nOther, -PalmToBall);
    const poleShoot = f.up.clone().multiplyScalar(-0.7).addScaledVector(f.left, s * 0.6).addScaledVector(f.fwd, -0.15).normalize();
    const poleOther = f.up.clone().multiplyScalar(-0.7).addScaledVector(f.left, -s * 0.6).addScaledVector(f.fwd, -0.15).normalize();
    for (const [hand, palm, n, pole] of [
      [shoot, palmShoot, nShoot, poleShoot],
      [other, palmOther, nOther, poleOther],
    ] as const) {
      this.orientHand(hand, n, fingers, enter);
      rig.reachPalm(hand, palm, 1, pole);
      this.orientHand(hand, n, fingers, enter);
    }
    const palmNow = rig.palmWorld(shoot, new THREE.Vector3()).addScaledVector(nShoot, PalmToBall);
    return ball.lerp(palmNow, 0.5).applyMatrix4(rig.root.matrixWorld.clone().invert());
  }

  /**
   * Orienta a mão: dedos = +Y local do osso, polegar = +Z, palma olhando para -X (direita) ou +X (esquerda) — medido na
   * pose de repouso (T-pose, palmas para baixo; tools/sonda-rig.mjs).
   */
  private orientHand(hand: Side, normal: THREE.Vector3, fingers: THREE.Vector3, weight: number, from?: THREE.Quaternion): void {
    const bone = this.rig.bone(`hand_${hand}`);
    if (from && weight <= 1e-3) {
      bone.quaternion.copy(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(from));
      bone.updateWorldMatrix(false, true);
      return;
    }
    if (weight <= 1e-3) return;
    const n = normal.clone().normalize();
    const y = fingers.clone().addScaledVector(n, -fingers.dot(n)).normalize();
    const x = hand === 'r' ? n.clone().negate() : n.clone();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    const m = new THREE.Matrix4().makeBasis(x, y, z);
    const want = new THREE.Quaternion().setFromRotationMatrix(m);
    const parentWorld = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    const cur = from ? from.clone() : bone.getWorldQuaternion(new THREE.Quaternion());
    const world = cur.slerp(want, weight);
    bone.quaternion.copy(parentWorld.invert().multiply(world));
    bone.updateWorldMatrix(false, true);
  }
}
