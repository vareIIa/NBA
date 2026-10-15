// Animação do jogador: camadas sobre o AnimationMixer do three.js + pós-processo procedural.
//  - Base: loops de drible (parado, baixo, andando, correndo, de costas, de lado) escolhidos pela velocidade no
//    referencial do jogador, com crossfade e FASE CASADA (o empurrão do clipe novo cai onde estava o do antigo). Sem a
//    bola: parado/andando/correndo sem drible. A velocidade de reprodução acompanha a velocidade real.
//  - Ação: dribles de mocap (crossover, escape, spin, half spin, entre as pernas, hesitação), dribles procedurais
//    (behind the back, step-back; ver ProceduralMoves.ts) e arremesso, por cima da base.
//  - Pós-processo: postura atlética (quadril baixo com IK das pernas, pés presos onde o clipe os pôs, base larga),
//    inclinação do tronco que cresce com a velocidade e a aceleração, DRIBLE BAIXO (IK do braço da bola levando a mão
//    para as alturas de jogador bom medidas em Hirata et al., 2011), pés e mãos dos dribles procedurais e o giro da
//    malha no spin.
// Os eventos de bola (soltura e recepção) saem das curvas medidas das palmas ou das trajetórias procedurais.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  type ClipInfo,
  type ClipsFile,
  ClipFps,
  type Hand,
  JumpShotTiming,
  LoopNativeVelocity,
  type MoveKind,
  type MoveTiming,
  MoveTimings,
  crossedFrames,
  dribblePhase,
  frameAtPhase,
  framesToNextPeak,
  loopClip,
  moveClipFor,
  otherSide,
  spinTurnAlpha,
} from './ClipLibrary';
import {
  BallRadius,
  BehindBack,
  SkilledDribble,
  StepBack,
  type V3,
  behindBackArmWeights,
  behindBackBall,
  behindBackCatch,
  behindBackFloor,
  behindBackOffArm,
  footStep,
  halfSpinTurn,
  sideSign,
  stepBackBody,
  stepBackCatch,
  stepBackFloor,
} from './ProceduralMoves';
import { Inertializer } from './Inertialization';
import { applyPole, solveTwoBoneIK } from './TwoBoneIK';

export const PlayerHeightMeters = 1.96;

/** O que o jogo informa ao animador a cada quadro. */
export interface AnimInput {
  /** Velocidade (m/s) no referencial do jogador: right = direita, forward = frente. */
  right: number;
  forward: number;
  /** Mão da bola para os loops (a mão que tem ou vai receber a bola). */
  ballHand: Hand;
  /** Está com a bola (sem ela, os loops são sem drible). */
  hasBall: boolean;
  /** LT: drible baixo de proteção. */
  low: boolean;
  /** Aceleração (m/s²) no referencial do jogador, para a inclinação do tronco. */
  accelRight: number;
  accelForward: number;
}

/** Bola saindo da mão: o animador diz quando e por onde ela volta. Posições no referencial do jogador (three). */
export interface BallRelease {
  fromHand: Hand;
  toHand: Hand;
  /** Segundos até a recepção. */
  catchIn: number;
  /** Centro da bola na recepção. */
  catchLocal: THREE.Vector3;
  /** Ponto do quique (centro da bola no chão), se o movimento define um. */
  floorLocal: THREE.Vector3 | null;
  /** Quique de movimento (crossover etc.). */
  move: boolean;
}

interface BaseState {
  name: string; // clipe
  base: string; // "Dribble_Walk" etc.
}

type ActionKind = MoveKind | 'Shot';

interface ActiveAction {
  kind: ActionKind;
  timing: MoveTiming | null;
  clip: string;
  action: THREE.AnimationAction;
  start: number;
  end: number;
  release: number;
  catch: number;
  fromHand: Hand;
  toHand: Hand;
  rate: number;
  released: boolean;
  fadingOut: boolean;
  /** Relógio do animador no início e duração (s): os procedurais andam por aqui. */
  startClock: number;
  duration: number;
  /** Giro da malha: sentido (+1 anti-horário visto de cima, -1 horário). */
  turnSign: number;
  /** Step-back: tornozelos (mundo) no início e qual pé é o de trás. */
  feetStart: { l: THREE.Vector3; r: THREE.Vector3; rear: Hand } | null;
  /** Arremesso: segurar o quadro de follow-through até esta hora (s do relógio do animador). */
  holdUntil: number;
}

// Transições por inertialization (dead blending): o clipe novo entra com peso total e só a diferença de pose some.
const BaseBlend = 0.22; // troca de loop
const ActionInBlend = 0.12; // entrada de um drible (resposta imediata ao comando)
const ActionOutBlend = 0.24; // volta para a base
const MinStateTime = 0.16; // histerese: o loop não troca de novo antes disso
const ClipGroundOffset = 0.028;
const NoBallLoops = new Set(['Hold_Idle', 'Walk', 'Run']);
// Drible em movimento (referência real: Kyrie em câmera lenta, LZSlFyyCkhk 9,0–10,9 s): as pernas não param; a cada
// quique um pé apoia e o outro passa, e só o tronco e os braços fazem o drible. Os clipes de drible da CMU foram
// gravados parados, então em movimento as pernas e a pelve vêm do loop de locomoção (camada por osso).
const LegLayerBones = ['pelvis', 'hip_l', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'hip_r', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'];
const LegLayerMoves = new Set<string>(['Cross', 'EscapeCross', 'BetweenLegs']);
const LegLayerSpeed = [0.5, 1.2]; // m/s: abaixo, as pernas do drible parado; acima, as da locomoção
// Size-up parado (referências: Harden no 2K23, u8jYUDS2eoo 47,7–51,0 s; Kyrie x Bulls, LZSlFyyCkhk 43,1–48,3 s): os
// dribles no lugar não tiram o jogador da base. Pés abertos e pregados, quadril baixo; só o quadril balança sobre eles.
const SizeUpMoves = new Set<string>(['Cross', 'BetweenLegs', 'Hesitation', 'BehindBack']);
const SizeUpMaxSpeed = 0.6; // m/s
// Pernas como cápsulas (raios medidos na malha pelo laboratório, Lab.capsuleRadii): a bola não entra nelas. No real a
// mão recebe a bola por fora do joelho e o crossover passa baixo, na frente (Dre Baldwin, fvXFeCAS3ds 7–12 s; Kyrie,
// LZSlFyyCkhk 44,1–44,7 s). `from`: a coxa começa a 30% (junto ao quadril a bola nunca passa).
const LegCapsules = [
  { a: 'thigh_l', b: 'calf_l', r: 0.086, from: 0.3 },
  { a: 'calf_l', b: 'foot_l', r: 0.056, from: 0 },
  { a: 'thigh_r', b: 'calf_r', r: 0.086, from: 0.3 },
  { a: 'calf_r', b: 'foot_r', r: 0.056, from: 0 },
];
const BallLegMargin = 0.01; // m de folga entre a bola e a perna
// Barreira macia: a bola começa a ser desviada ~5 cm antes de encostar (máximo suave entre a distância e o mínimo), em vez
// de um empurrão que liga de repente no contato e dá tranco no braço.
const BallLegSoft = 0.05;
const BallLegHandMax = 0.25; // m: além disso a mão não vai (braço esticado); a garantia final fica na bola (BallDribbler)
// A mão segue o desvio suave (sem tranco); a bola, que tem a garantia final, nunca entra na perna. Pode abrir um vão curto
// entre a palma e a bola no meio de um drible rápido.
const BallLegHandRate = 12; // 1/s
// Entre as pernas (Kyrie, LZSlFyyCkhk 164,0–165,2 s, de costas): a mão empurra a bola por fora do joelho, ela quica UMA
// vez no chão entre os pés (164,7–164,8 s) e a outra mão recebe baixo, por fora do joelho do outro lado (165,1 s). O
// clipe da CMU quicava 66 cm à frente dos pés e recebia na frente do corpo (era um crossover baixo).
// Recepção ao lado do JOELHO (no nosso agachamento o joelho fica ~0,4 m à frente do pé; ao lado do pé o braço esticava
// até o limite e dava tranco).
const TweenCatch = { outside: 0.12, height: 0.42, forward: 0.3 }; // m: centro da bola na recepção, a partir do pé
const smoothMax = (x: number, min: number, soft: number) => (x + min + Math.sqrt((x - min) * (x - min) + soft * soft)) / 2;
// Escape (RT + o mesmo comando do size-up; GIF de "escape moves" do 2K24 no game8): o corpo sai uns 0,5–1 m para o lado
// da mão nova e os pés acompanham em passos (o da frente abre, o de trás vem atrás), sem deslizar.
const EscapeMoves = new Set<string>([...SizeUpMoves, 'EscapeCross']);
// lead: quanto à frente (s) o passo mira; o corpo segue andando enquanto o outro pé vem, então o pé da frente abre mais.
const SpinFreeHand = { outside: 0.3, forward: 0.35, height: 0.22 }; // m: palma do braço livre no spin (corpo)
const HalfSpinBall = { release: 0.3, catch: 0.85 }; // frações do half spin (o giro vira em 0,5)
const EscapeStep = { threshold: 0.12, seconds: 0.14, lead: 0.18 };

const v = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q = new THREE.Quaternion();
const axis = new THREE.Vector3();
const toV = (p: V3, out = new THREE.Vector3()): THREE.Vector3 => out.set(p[0], p[1], p[2]);

export class PlayerAnimator {
  readonly root = new THREE.Group(); // posição/yaw do jogador (o jogo controla)
  readonly model: THREE.Object3D;
  readonly scale: number;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly clips: Record<string, ClipInfo>;
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly palmRange = new Map<string, { catch: number; release: number }>();

  private base: BaseState = { name: 'Dribble_Idle_R', base: 'Dribble_Idle' };
  private baseSince = 0;
  private readonly baseWeights = new Map<string, number>();
  private active: ActiveAction | null = null;
  private actionWeight = 0; // 0 ou 1 (sem crossfade)
  private inertial!: Inertializer;
  /** Contagem de transições (para o laboratório). */
  transitions = 0;
  private clock = 0;
  private prevTimes = new Map<string, number>();
  private hasBall = true;
  /** Camada das pernas: loop de locomoção que segue tocando nas pernas durante um drible em movimento. */
  private readonly legLayer = { clip: '', time: 0, weight: 0 };
  /** O drible atual começou parado (size-up ou escape): pernas pela base plantada, não pela locomoção. */
  private moveStartedStanding = false;
  /** Até quando (relógio) os pés continuam na base plantada depois de um drible que começou parado (o corpo freia). */
  private standingSettleUntil = 0;
  /** Base do escape: onde cada pé fica em relação ao corpo (tirado da base plantada no começo do drible). */
  private readonly escapeStance = { l: new THREE.Vector3(), r: new THREE.Vector3(), action: null as ActiveAction | null };
  private lastSpeed = 0;
  private readonly legTracks = new Map<string, { bone: THREE.Bone; q?: THREE.Interpolant; p?: THREE.Interpolant }[]>();

  private crouch = 0;
  private widen = 0;
  /** Trava de pé: enquanto o pé está apoiado na animação, ele fica preso no chão (mundo) e não patina. */
  private readonly footLock = {
    l: { locked: false, pos: new THREE.Vector3(), prevAnim: new THREE.Vector3(), release: new THREE.Vector3(), releaseT: 1, land: new THREE.Vector3(), prevToe: 1 },
    r: { locked: false, pos: new THREE.Vector3(), prevAnim: new THREE.Vector3(), release: new THREE.Vector3(), releaseT: 1, land: new THREE.Vector3(), prevToe: 1 },
  };
  footLockEnabled = true;
  legLayerEnabled = true;
  ballClearanceEnabled = true;
  /**
   * Base plantada do size-up (parado com a bola, drible normal ou baixo): os dois pés pregados no chão, abertos e retos;
   * o ritmo fica no joelho e no quadril. Se o corpo gira ou anda além da base, o pé dá um passinho para a nova posição.
   */
  private readonly plant = {
    active: false,
    l: { pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1 },
    r: { pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1 },
  };
  private restFootLocal = { l: new THREE.Quaternion(), r: new THREE.Quaternion() };
  private restAnkleY = 0.1;
  /** Pontos da sola do tênis (vértices mais baixos da malha no bind pose), no espaço do osso do pé ou da ponta. */
  private readonly solePoints: Record<Hand, { bone: THREE.Bone; local: THREE.Vector3 }[]> = { l: [], r: [] };
  private leanForward = 0;
  private leanRight = 0;
  /** Peso do IK do drible baixo por mão: cada braço entra e sai sozinho (a mão da bola troca no meio do crossover). */
  private readonly dribbleArmWeight = { l: 0, r: 0 };
  private restArmWeight = 0;
  /** Giro extra da malha (rad) além do yaw do jogador: spin / half spin. */
  yawOffset = 0;
  /** Soltura que aconteceu neste quadro (o jogo consome). */
  readonly releases: BallRelease[] = [];
  /** Centro da bola (referencial do jogador) quando um drible procedural a carrega; null = presa à palma. */
  ballHeldLocal: THREE.Vector3 | null = null;

  // Ajustes de postura (tunáveis no laboratório). Metros no mundo (jogador de 1,96 m) e graus.
  stance = {
    crouchIdle: 0.27, // quanto o quadril desce parado (size-up: base baixa e larga, como nas referências reais)
    crouchWalk: 0.15,
    crouchRun: 0.12,
    crouchLow: 0.08, // o clipe baixo já é baixo
    crouchMove: 0.07, // dribles de mocap (os clipes já abaixam)
    crouchProcedural: 0.14, // behind the back / step-back (o tronco vem de um clipe mais alto)
    // Spin baixo (Kyrie x Spurs, NSiPz8Kvuqw 15,0–16,2 s): quadril a ~40% da altura, tronco quase horizontal (~70° da
    // vertical), cabeça na altura do quadril e bola abaixo do joelho. O clipe da CMU gira quase em pé.
    crouchSpin: 0.34,
    leanSpinDeg: 28,
    // m que cada pé abre para o lado parado: tornozelos a ~0,62 m (1,5x a largura dos ombros; Harden no 2K23 a 47,7 s,
    // Kyrie a 44,3 s com ~0,8 m). O clipe deixa os tornozelos a 0,34 m.
    widenIdle: 0.24,
    widenWalk: 0.03,
    leanBaseDeg: 20, // inclinação do tronco para frente no drible (dividida entre spine_01 e spine_02)
    leanPerSpeedDeg: 3.0, // +3° por m/s (correndo a 4 m/s: ~28°)
    leanPerAccelDeg: 1.4, // por m/s²
    leanMaxDeg: 32,
    // Drible baixo de jogador bom (palma = centro da bola + raio): recepção 0,91 m, soltura 0,76 m.
    palmCatch: SkilledDribble.catchHeight + BallRadius,
    palmRelease: SkilledDribble.releaseHeight + BallRadius,
    dribbleOutward: 0.05, // m: bola por fora do pé
    dribbleForward: 0.07, // m: bola um pouco à frente
  };

  private constructor(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, clipsFile: ClipsFile) {
    this.model = gltf.scene;
    this.clips = clipsFile.clips;
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // a caixa do bind pose não acompanha a animação
      }
    });

    // Escala: altura do bind pose -> 1,96 m.
    const box = new THREE.Box3().setFromObject(this.model);
    const height = box.max.y - box.min.y;
    this.scale = PlayerHeightMeters / height;
    this.model.scale.setScalar(this.scale);
    // Os clipes da CMU deixam a ponta do pé ~3 cm acima do chão (menor altura medida: 2,3–4,2 cm): desce o modelo.
    this.model.position.y = -box.min.y * this.scale - ClipGroundOffset;
    this.root.add(this.model);
    this.root.name = 'jogador';

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      const loop = clip.name.startsWith('Dribble_') || NoBallLoops.has(clip.name);
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = true;
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      this.actions.set(clip.name, action);
      this.baseWeights.set(clip.name, 0);
    }
    this.baseWeights.set(this.base.name, 1);
    this.inertial = new Inertializer([...this.bones.values()]);
    // Pé reto no chão (bind pose) relativo ao jogador, e altura do tornozelo com o pé apoiado.
    this.model.updateMatrixWorld(true);
    const rootInv = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const side of ['l', 'r'] as const) {
      this.restFootLocal[side] = rootInv.clone().multiply(this.bone(`foot_${side}`).getWorldQuaternion(new THREE.Quaternion()));
    }
    this.restAnkleY = this.bone('foot_l').getWorldPosition(new THREE.Vector3()).y;
    this.collectSolePoints();

    // Altura nativa da palma da mão da bola na recepção (picos) e na soltura (vales) de cada loop de drible.
    for (const [name, info] of Object.entries(this.clips)) {
      if (!name.startsWith('Dribble_')) continue;
      const hand: Hand = name.endsWith('_L') ? 'l' : 'r';
      const palm = hand === 'r' ? info.palm_r : info.palm_l;
      const peaks = hand === 'r' ? info.peaks_r : info.peaks_l;
      const valleys = hand === 'r' ? info.valleys_r : info.valleys_l;
      if (peaks.length === 0 || valleys.length === 0) continue;
      const avg = (idx: number[]) => idx.reduce((sum, i) => sum + palm[i][1], 0) / idx.length;
      this.palmRange.set(name, {
        catch: avg(peaks) * this.scale + this.model.position.y,
        release: avg(valleys) * this.scale + this.model.position.y,
      });
    }
  }

  static async load(glbUrl: string, clipsUrl: string): Promise<PlayerAnimator> {
    const [gltf, clipsFile] = await Promise.all([
      new GLTFLoader().loadAsync(glbUrl),
      fetch(clipsUrl).then((r) => r.json() as Promise<ClipsFile>),
    ]);
    return new PlayerAnimator(gltf, clipsFile);
  }

  bone(name: string): THREE.Bone {
    const b = this.bones.get(name);
    if (!b) throw new Error(`osso ${name} não existe no GLB`);
    return b;
  }

  clipNames(): string[] {
    return [...this.actions.keys()];
  }

  /** Palma (centro) no mundo. */
  palmWorld(hand: Hand, out = new THREE.Vector3()): THREE.Vector3 {
    this.bone(`palm_${hand}`).getWorldPosition(out);
    return out.lerp(this.bone(`fingers_${hand}`).getWorldPosition(v), 0.5);
  }

  /** Ação ativa (para o jogo saber se há drible/arremesso em andamento). */
  actionKind(): ActionKind | null {
    return this.active && !this.active.fadingOut ? this.active.kind : null;
  }

  baseClip(): string {
    return this.base.name;
  }

  // ------------------------------------------------------------------------------------------- comandos

  /**
   * Toca um drible. duration = duração do movimento no núcleo (s), já com o playrate do combo/energia: o miolo do clipe
   * (start..end) é esticado para caber nela, então o ritmo do núcleo manda.
   */
  playMove(kind: MoveKind, fromHand: Hand, duration: number): void {
    const t: MoveTiming = MoveTimings[kind];
    const clip = moveClipFor(kind, fromHand);
    const rate = Math.min(2.4, Math.max(0.6, (t.end - t.start) / Math.max(0.05, duration)));
    // Spin_R2L gira no sentido horário visto de cima (HoopsDummyRig.h); no three, horário = yaw diminuindo.
    const turnSign = t.turnDeg ? (fromHand === 'r' ? -1 : 1) : 0;
    this.startAction({
      kind,
      timing: t,
      clip,
      start: t.start,
      end: t.end,
      release: t.release,
      catch: t.catch,
      fromHand,
      toHand: t.switchesHand ? otherSide(fromHand) : fromHand,
      rate,
      startClock: this.clock,
      duration,
      turnSign,
      feetStart: null,
      holdUntil: 0,
    });
    this.moveStartedStanding = this.lastSpeed < SizeUpMaxSpeed;
    if (t.procedural === 'StepBack' && this.active) {
      const l = this.bone('foot_l').getWorldPosition(new THREE.Vector3());
      const r = this.bone('foot_r').getWorldPosition(new THREE.Vector3());
      const inv = this.root.matrixWorld.clone().invert();
      const rear: Hand = l.clone().applyMatrix4(inv).z < r.clone().applyMatrix4(inv).z ? 'l' : 'r';
      this.active.feetStart = { l, r, rear };
    }
  }

  /** Arremesso: começa no dip e acerta a soltura do clipe no tempo ideal (centro do green). */
  playShot(hand: Hand, idealSeconds: number): void {
    const t = JumpShotTiming;
    const clip = hand === 'r' ? t.clip : t.clip.replace(/_R$/, '_L');
    const rate = (t.release - t.dip) / Math.max(0.2, idealSeconds);
    this.startAction({
      kind: 'Shot',
      timing: null,
      clip,
      start: t.dip,
      end: t.end,
      release: t.release,
      catch: Infinity,
      fromHand: hand,
      toHand: hand,
      rate,
      startClock: this.clock,
      duration: (t.end - t.dip) / rate,
      turnSign: 0,
      feetStart: null,
      holdUntil: 0,
    });
  }

  /** Tempo (s) do clipe da ação ativa, ou null. */
  actionTime(): number | null {
    return this.active ? this.active.action.time : null;
  }

  private startAction(spec: Omit<ActiveAction, 'action' | 'released' | 'fadingOut'>): void {
    const action = this.actions.get(spec.clip);
    if (!action) return;
    if (this.active && this.active.action !== action) {
      // Encadeado: o anterior some rápido sob o novo.
      this.active.action.setEffectiveWeight(0);
    }
    action.reset();
    action.time = spec.start;
    action.timeScale = spec.rate;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    this.prevTimes.set(spec.clip, spec.start);
    this.active = { ...spec, action, released: false, fadingOut: false };
    this.actionWeight = 1;
    this.blend(ActionInBlend);
  }

  /** Progresso (0..1) do drible ativo pelo relógio (procedurais) ou pelo tempo do clipe. */
  private progress(a: ActiveAction): number {
    // Half spin: o clipe vai e volta (driveHalfSpinClip), então o progresso vem do relógio.
    if (a.timing?.procedural || a.timing?.turnBack) return (this.clock - a.startClock) / Math.max(0.05, a.duration);
    return (a.action.time - a.start) / Math.max(1e-3, a.end - a.start);
  }

  // ------------------------------------------------------------------------------------------- quadro

  update(dt: number, input: AnimInput): void {
    this.clock += dt;
    this.releases.length = 0;
    this.ballHeldLocal = null;
    this.hasBall = input.hasBall;
    this.chooseBase(input);
    // Antes do updateAction: no quadro em que o half spin acaba, o clipe vai para o fim e o drible já fecha nesse quadro
    // (sem um quadro da pose do fim do spin inteiro).
    this.driveHalfSpinClip();
    this.updateAction();
    this.updateWeights();

    // Avança o mixer guardando os tempos anteriores para detectar eventos.
    for (const [name, action] of this.actions) {
      if (action.getEffectiveWeight() > 0 || name === this.base.name || this.active?.clip === name) {
        this.prevTimes.set(name, action.time);
      }
    }
    this.mixer.update(dt);
    this.applyLegLayer(dt, input);
    this.inertial.apply(dt);
    this.model.rotation.y = this.yawOffset;
    this.root.updateMatrixWorld(true);
    this.applySpinPivot();
    this.detectEvents();

    this.applyStance(dt, input);
    this.applyArms(dt);
    this.applyBetweenLegsArm(dt);
    this.applySpinFreeArm(dt);
    this.applyBallClearance(dt, input);
  }

  private speedOf(input: AnimInput): number {
    return Math.hypot(input.right, input.forward);
  }

  /** Escolhe o loop da base pela velocidade e casa a fase quando troca. */
  private chooseBase(input: AnimInput): void {
    const speed = this.speedOf(input);
    const hand = input.ballHand;
    let base: string;
    let clipName: string;
    const fwd = input.forward;
    const side = input.right;
    if (!input.hasBall) {
      base = speed < 0.35 ? 'Hold_Idle' : speed < 2.4 ? 'Walk' : 'Run';
      clipName = base;
    } else if (speed < 0.35) {
      base = input.low ? 'Dribble_Low' : 'Dribble_Idle';
      clipName = loopClip(base, hand);
    } else if (fwd < -0.25 && Math.abs(fwd) >= Math.abs(side) * 0.8) {
      // Recuando, mesmo devagar: o loop de costas (o de andar para a frente dava passos ao contrário do corpo).
      base = 'Dribble_Back';
      clipName = loopClip(base, hand);
    } else if (Math.abs(side) > Math.abs(fwd) * 1.2 && speed < 3.2) {
      // Deslize lateral (size-up): Side_R anda para a esquerda com a bola na direita; o espelho para a direita.
      base = 'Dribble_Side';
      clipName = side < 0 ? 'Dribble_Side_R' : 'Dribble_Side_L';
    } else if (input.low && speed < 1.2) {
      base = 'Dribble_Low';
      clipName = loopClip(base, hand);
    } else if (speed < 2.4) {
      base = 'Dribble_Walk';
      clipName = loopClip(base, hand);
    } else {
      base = 'Dribble_Run';
      clipName = loopClip(base, hand);
    }

    const handChanged =
      input.hasBall && this.base.name.startsWith('Dribble_') && !this.base.name.endsWith(hand.toUpperCase()) && base !== 'Dribble_Side';
    const ballChanged = NoBallLoops.has(this.base.name) === input.hasBall;
    if (clipName !== this.base.name && (this.clock - this.baseSince >= MinStateTime || handChanged || ballChanged)) {
      this.switchBase({ name: clipName, base }, hand);
    }

    // Velocidade de reprodução acompanha a velocidade real (a escala do modelo muda a passada).
    const action = this.actions.get(this.base.name);
    if (action) {
      const native = LoopNativeVelocity[this.base.name] ?? LoopNativeVelocity[this.base.base];
      const nativeSpeed = native
        ? Math.hypot(native.right, native.forward) * this.scale
        : this.base.base === 'Walk'
          ? 1.05 * this.scale
          : this.base.base === 'Run'
            ? 4.14 * this.scale
            : 0;
      let rate = 1;
      if (nativeSpeed > 0.1) rate = Math.min(1.7, Math.max(0.7, speed / nativeSpeed));
      if (base === 'Dribble_Low') rate = 1.15; // ~3 quiques/s (README da animação)
      action.timeScale = rate;
    }
  }

  private switchBase(next: BaseState, hand: Hand): void {
    const from = this.actions.get(this.base.name);
    const to = this.actions.get(next.name);
    if (!to) return;
    const fromInfo = this.clips[this.base.name];
    const toInfo = this.clips[next.name];
    let time = to.time;
    if (from && fromInfo && toInfo && this.base.name.startsWith('Dribble_') && next.name.startsWith('Dribble_')) {
      const fromHand: Hand = this.base.name.endsWith('_L') ? 'l' : 'r';
      const phase = dribblePhase(fromInfo, fromHand, from.time * ClipFps);
      const sameHand = fromHand === hand;
      if (phase !== null && sameHand) {
        const frame = frameAtPhase(toInfo, hand, phase, to.time * ClipFps);
        if (frame !== null) time = frame / ClipFps;
      } else {
        // Mão nova (depois de um crossover): o loop começa na recepção (pico da palma), com a bola chegando.
        const peaks = hand === 'r' ? toInfo.peaks_r : toInfo.peaks_l;
        if (peaks.length > 0) time = peaks[0] / ClipFps;
      }
    }
    // Drible em movimento: a camada das pernas manda; o loop novo entra na mesma fase da passada (senão a perna pula).
    const L = this.legLayer;
    if (L.clip && L.weight > 0.5 && L.clip !== next.name) {
      time = this.matchLegPhase(L.clip, L.time, next.name);
      L.clip = next.name;
      L.time = time;
    } else if (L.clip && L.clip !== next.name) {
      // Camada fraca (devagar): as pernas quase não aparecem; segue o loop novo na fase do drible.
      L.clip = next.name;
      L.time = time;
    }
    to.time = time;
    this.prevTimes.set(next.name, time);
    this.base = next;
    this.baseSince = this.clock;
    if (this.actionWeight < 0.5) this.blend(BaseBlend);
  }

  /** Green: segura o follow-through por alguns segundos antes de terminar o arremesso (como no 2K Park). */
  holdFollowThrough(seconds: number): void {
    if (this.active?.kind === 'Shot') this.active.holdUntil = this.clock + seconds;
  }

  private updateAction(): void {
    const a = this.active;
    if (!a) return;
    if (a.kind === 'Shot' && a.holdUntil > this.clock && a.action.time >= JumpShotTiming.followThrough) {
      a.action.timeScale = 0; // segura o follow-through
    } else if (a.kind === 'Shot' && a.action.timeScale === 0) {
      a.action.timeScale = a.rate;
    }
    const u = this.progress(a);
    if (!a.fadingOut && (a.action.time >= a.end - 1e-3 || (a.timing?.procedural && u >= 1))) {
      a.fadingOut = true;
    }
    const turnDeg = a.timing?.turnDeg ?? 0;
    if (turnDeg) {
      const alpha = Math.min(1, Math.max(0, u));
      const shape = a.timing?.turnBack ? halfSpinTurn(alpha) : spinTurnAlpha(alpha);
      this.yawOffset = a.turnSign * THREE.MathUtils.degToRad(turnDeg) * shape;
    }
    if (a.fadingOut) {
      // Fim do drible: a base volta na hora, com a pose suavizada pela inertialization.
      a.action.setEffectiveWeight(0);
      this.active = null;
      this.actionWeight = 0;
      this.yawOffset = 0;
      this.blend(ActionOutBlend);
    }
  }

  // ------------------------------------------------------------------------------------- spin: pé de pivô

  /**
   * Half spin: o clipe do spin vai e volta junto com o giro. Tocá-lo para a frente até o fim fazia os pés continuarem o
   * spin inteiro enquanto o corpo voltava (o pé de apoio era arrastado ao contrário). O quadro do clipe é o do spin com o
   * mesmo ângulo de giro (curva medida no mocap, spinTurnAlpha), indo até ~150° e voltando.
   */
  private driveHalfSpinClip(): void {
    const a = this.active;
    if (!a || a.fadingOut || !a.timing?.turnBack || !a.timing.turnDeg) return;
    const u = this.progress(a);
    a.action.timeScale = 0;
    if (u >= 1) {
      a.action.time = a.end; // fim: updateAction encerra o drible
      return;
    }
    const fraction = (a.timing.turnDeg * halfSpinTurn(Math.max(0, u))) / 360;
    // Inverso de spinTurnAlpha (monotônica): busca binária.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (spinTurnAlpha(mid) < fraction) lo = mid;
      else hi = mid;
    }
    const spin = MoveTimings.Spin;
    let time = spin.start + lo * (spin.end - spin.start);
    // O mixer do three só reescreve um osso quando o valor muda: com o mesmo tempo dois quadros seguidos (no pico do giro)
    // o agachamento e o IK do quadro anterior ficavam nos ossos e eram aplicados de novo (a pelve descia 9 cm num quadro).
    if (time === a.action.time) time += 1e-4;
    a.action.time = time;
  }

  /** Deslocamento do corpo (referencial do jogador) que ainda não foi passado para o jogo. */
  private readonly pivotOffset = new THREE.Vector3();
  private spinPivot: { action: ActiveAction; side: Hand; world: THREE.Vector3 } | null = null;

  /**
   * Spin e half spin giram em volta do pé de pivô, não do centro do corpo (girar no centro arrastava os dois pés em
   * círculo). O clipe da CMU (Spin_R2L) apoia o pé esquerdo na primeira metade e o direito na segunda; o half spin fica
   * no primeiro. O pé de pivô é pregado no chão deslocando a malha; o deslocamento vira root motion (takeRootMotion).
   */
  private applySpinPivot(): void {
    // A malha começa no deslocamento que ainda não foi entregue (o jogo já somou o resto à posição da raiz).
    this.model.position.x = this.pivotOffset.x;
    this.model.position.z = this.pivotOffset.z;
    this.root.updateMatrixWorld(true);
    const a = this.active;
    const turning = !!a && !a.fadingOut && !!a.timing?.turnDeg && this.hasBall;
    if (!turning) {
      this.spinPivot = null;
    } else {
      const u = this.progress(a);
      const first: Hand = a.fromHand === 'r' ? 'l' : 'r';
      const side: Hand = a.timing?.turnBack || u < 0.5 ? first : otherSide(first);
      if (!this.spinPivot || this.spinPivot.action !== a || this.spinPivot.side !== side) {
        this.spinPivot = { action: a, side, world: this.bone(`ball_${side}`).getWorldPosition(new THREE.Vector3()) };
      }
      const now = this.bone(`ball_${side}`).getWorldPosition(new THREE.Vector3());
      const delta = this.spinPivot.world.clone().sub(now).setY(0);
      // Mundo -> referencial do jogador (a malha é filha da raiz).
      delta.applyQuaternion(this.root.quaternion.clone().invert());
      this.pivotOffset.add(delta);
    }
    this.model.position.x = this.pivotOffset.x;
    this.model.position.z = this.pivotOffset.z;
    this.root.updateMatrixWorld(true);
  }

  /** Root motion: o deslocamento (mundo) que o jogo deve somar à posição do jogador; zera o que foi entregue. */
  takeRootMotion(): THREE.Vector3 {
    const world = this.pivotOffset.clone().applyQuaternion(this.root.quaternion);
    this.pivotOffset.set(0, 0, 0);
    return world;
  }

  /** Interpolantes das pernas e da pelve de um loop (criados uma vez por clipe). */
  private legTracksOf(clipName: string): { bone: THREE.Bone; q?: THREE.Interpolant; p?: THREE.Interpolant }[] {
    let tracks = this.legTracks.get(clipName);
    if (tracks) return tracks;
    const clip = this.actions.get(clipName)?.getClip();
    tracks = LegLayerBones.map((name) => {
      // createInterpolant existe no KeyframeTrack (escolhe linear/slerp pelo tipo), mas não está nos tipos do three.
      const find = (prop: string) =>
        (clip?.tracks.find((t) => t.name === `${name}.${prop}`) as { createInterpolant(): THREE.Interpolant } | undefined)?.createInterpolant();
      return { bone: this.bone(name), q: find('quaternion'), p: name === 'pelvis' ? find('position') : undefined };
    });
    this.legTracks.set(clipName, tracks);
    return tracks;
  }

  /** Tempo do clipe `to` cuja pose das pernas (coxas e canelas, rotação local) é a mais próxima da de `from` em tFrom. */
  private matchLegPhase(from: string, tFrom: number, to: string): number {
    const a = this.legTracksOf(from);
    const b = this.legTracksOf(to);
    const clipA = this.actions.get(from)!.getClip();
    const clipB = this.actions.get(to)!.getClip();
    const ta = ((tFrom % clipA.duration) + clipA.duration) % clipA.duration;
    const legs = [2, 3, 7, 8]; // thigh_l, calf_l, thigh_r, calf_r em LegLayerBones
    const qa = legs.map((i) => {
      const r = a[i].q?.evaluate(ta);
      return r ? new THREE.Quaternion(r[0], r[1], r[2], r[3]) : new THREE.Quaternion();
    });
    let best = 0;
    let bestCost = Infinity;
    const qb = new THREE.Quaternion();
    for (let f = 0; f * (1 / ClipFps) < clipB.duration; f++) {
      const t = f / ClipFps;
      let cost = 0;
      legs.forEach((i, k) => {
        const r = b[i].q?.evaluate(t);
        if (r) cost += qa[k].angleTo(qb.set(r[0], r[1], r[2], r[3]));
      });
      if (cost < bestCost) {
        bestCost = cost;
        best = t;
      }
    }
    return best;
  }

  /**
   * Pernas da locomoção sob o drible em movimento. No começo do drible guarda o loop da base e segue o relógio dele
   * (a base pode trocar de mão no meio do crossover, e o clipe da outra mão tem outra fase de passada).
   */
  private applyLegLayer(dt: number, input: AnimInput): void {
    const a = this.active;
    const L = this.legLayer;
    const layered = this.legLayerEnabled && !!a && !a.fadingOut && LegLayerMoves.has(a.kind) && this.hasBall;
    if (!layered) {
      L.clip = '';
      L.weight = 0;
      return;
    }
    if (this.moveStartedStanding) {
      L.clip = '';
      L.weight = 0;
      return;
    }
    const speed = this.speedOf(input);
    const target = THREE.MathUtils.smoothstep(speed, LegLayerSpeed[0], LegLayerSpeed[1]);
    if (!L.clip) {
      // Começo do drible: a inertialization já suaviza a entrada, então o peso entra direto.
      L.clip = this.base.name;
      L.time = this.actions.get(L.clip)?.time ?? 0;
      L.weight = target;
    } else {
      const baseAction = this.actions.get(this.base.name);
      L.time += dt * (baseAction?.timeScale ?? 1);
      L.weight += (target - L.weight) * (1 - Math.exp(-10 * dt));
    }
    const clip = this.actions.get(L.clip)?.getClip();
    if (!clip || L.weight < 1e-3) return;
    const t = ((L.time % clip.duration) + clip.duration) % clip.duration;
    for (const tr of this.legTracksOf(L.clip)) {
      if (tr.q) {
        const r = tr.q.evaluate(t);
        tr.bone.quaternion.slerp(q.set(r[0], r[1], r[2], r[3]), L.weight);
      }
      if (tr.p) {
        const r = tr.p.evaluate(t);
        tr.bone.position.lerp(v.set(r[0], r[1], r[2]), L.weight);
      }
    }
  }

  /** Começa uma transição suave (inertialization) a partir da pose do quadro anterior. */
  private blend(duration: number): void {
    this.inertial.trigger(duration);
    this.transitions++;
  }

  /** Pesos binários: só o loop da base OU o drible ativo tocam (a suavidade vem da inertialization). */
  private updateWeights(): void {
    const a = this.active;
    for (const [name, action] of this.actions) {
      if (a && name === a.clip) continue;
      const w = !a && name === this.base.name ? 1 : 0;
      action.setEffectiveWeight(w);
      this.baseWeights.set(name, w);
    }
    if (a) a.action.setEffectiveWeight(1);
  }

  // ------------------------------------------------------------------------------------------- bola

  /** Palma de um quadro do clipe -> referencial do jogador (m). */
  private palmLocal(info: ClipInfo, hand: Hand, frame: number, out = new THREE.Vector3()): THREE.Vector3 {
    const p = (hand === 'r' ? info.palm_r : info.palm_l)[Math.min(info.frames - 1, Math.max(0, Math.round(frame)))];
    out.set(p[0], p[1], p[2]).multiplyScalar(this.scale).applyAxisAngle(axis.set(0, 1, 0), this.model.rotation.y);
    out.y += this.model.position.y;
    return out;
  }

  /**
   * Drible baixo: leva uma palma (referencial do jogador, altura "nativa" do clipe, sem o agachamento) para as alturas
   * de jogador bom, mantendo o ritmo do clipe; a bola vai um pouco por fora e à frente do pé.
   */
  private lowDribblePalm(clip: string, hand: Hand, local: THREE.Vector3, nativeY: number): THREE.Vector3 {
    const range = this.palmRange.get(clip);
    if (!range) return local;
    const s = this.stance;
    const k = (s.palmCatch - s.palmRelease) / Math.max(0.05, range.catch - range.release);
    local.y = s.palmRelease + (nativeY - range.release) * k;
    local.x += sideSign(hand) * s.dribbleOutward;
    local.z += s.dribbleForward;
    return local;
  }

  private release(r: Omit<BallRelease, 'catchLocal' | 'floorLocal'> & { catchLocal: THREE.Vector3; floorLocal?: THREE.Vector3 }): void {
    this.releases.push({ ...r, floorLocal: r.floorLocal ?? null });
  }

  /** Soltura da bola: vale da palma no loop dominante, o quadro de soltura da ação ou o tempo do procedural. */
  private detectEvents(): void {
    if (!this.hasBall) return;
    const a = this.active;
    if (a && !a.fadingOut && a.kind !== 'Shot') {
      if (a.released) return;
      const proc = a.timing?.procedural;
      if (proc) {
        if (this.progress(a) < a.release) return;
        a.released = true;
        const catchLocal = toV(proc === 'BehindBack' ? behindBackCatch(a.fromHand) : stepBackCatch(a.fromHand));
        if (proc === 'BehindBack') catchLocal.y -= this.behindBackDrop();
        const floorLocal = toV(proc === 'BehindBack' ? behindBackFloor(a.fromHand) : stepBackFloor(a.fromHand));
        this.release({
          fromHand: a.fromHand,
          toHand: a.toHand,
          catchIn: (a.catch - a.release) * a.duration,
          catchLocal,
          floorLocal,
          move: true,
        });
        return;
      }
      if (a.timing?.turnBack) {
        // Half spin: o clipe vai e volta, então a soltura e a recepção seguem o progresso do giro (solta indo, recebe
        // voltando) e a mão recebe na pose do começo, para onde o clipe volta.
        if (this.progress(a) < HalfSpinBall.release) return;
        a.released = true;
        // Recepção na posição de drible da mão nova (pico da palma no loop parado dela), por fora e à frente; a mão vai
        // até lá por IK (applyBetweenLegsArm). A pose do começo do clipe deixava a mão nova solta atrás do quadril.
        const palm = this.receivingDribblePalm(a.toHand);
        this.tweenCatch = { action: a, hand: a.toHand, local: palm.clone() };
        this.release({
          fromHand: a.fromHand,
          toHand: a.toHand,
          catchIn: (HalfSpinBall.catch - HalfSpinBall.release) * a.duration,
          catchLocal: palm,
          move: true,
        });
        return;
      }
      const prev = this.prevTimes.get(a.clip) ?? a.action.time;
      if (prev < a.release && a.action.time >= a.release) {
        a.released = true;
        const info = this.clips[a.clip];
        const palm = this.palmLocal(info, a.toHand, a.catch * ClipFps);
        // No fim do giro a malha volta para a frente: a recepção é prevista sem o giro.
        if (a.timing?.turnDeg) palm.applyAxisAngle(axis.set(0, 1, 0), -this.model.rotation.y);
        palm.y -= BallRadius * 1.02;
        if (a.kind === 'BetweenLegs') {
          const path = this.betweenLegsPath(a.toHand);
          if (this.tweenCatch?.action === a) path.catchLocal.copy(this.tweenCatch.local); // o mesmo ponto para a mão e a bola
          else this.tweenCatch = { action: a, hand: a.toHand, local: path.catchLocal.clone() };
          this.release({
            fromHand: a.fromHand,
            toHand: a.toHand,
            catchIn: (a.catch - a.release) / a.rate,
            catchLocal: path.catchLocal,
            floorLocal: path.floorLocal,
            move: true,
          });
          return;
        }
        this.release({ fromHand: a.fromHand, toHand: a.toHand, catchIn: (a.catch - a.release) / a.rate, catchLocal: palm, move: true });
      }
      return; // durante a ação, a base não solta a bola
    }
    if (this.actionWeight > 0.5) return;

    const action = this.actions.get(this.base.name);
    const info = this.clips[this.base.name];
    if (!action || !info || !this.base.name.startsWith('Dribble_')) return;
    const hand: Hand = this.base.name.endsWith('_L') ? 'l' : 'r';
    const n = info.frames - 1;
    const prev = (this.prevTimes.get(this.base.name) ?? action.time) * ClipFps;
    const now = action.time * ClipFps;
    const valleys = hand === 'r' ? info.valleys_r : info.valleys_l;
    for (const frame of crossedFrames(valleys, prev, now, n)) {
      const toPeak = framesToNextPeak(info, hand, frame);
      if (toPeak === null) continue;
      const peakFrame = (frame + toPeak) % n;
      const palm = this.palmLocal(info, hand, peakFrame);
      this.lowDribblePalm(this.base.name, hand, palm, palm.y);
      palm.y -= BallRadius * 1.02;
      this.release({
        fromHand: hand,
        toHand: hand,
        catchIn: toPeak / ClipFps / Math.max(0.3, action.timeScale),
        catchLocal: palm,
        move: false,
      });
    }
  }

  // ------------------------------------------------------------------------------------------- postura

  private applyStance(dt: number, input: AnimInput): void {
    const s = this.stance;
    const speed = this.speedOf(input);
    const a = this.active && !this.active.fadingOut ? this.active : null;
    const kind = a?.kind ?? null;
    const u = a ? this.progress(a) : 0;
    const stepBack = a?.timing?.procedural === 'StepBack' ? stepBackBody(u) : null;
    this.lastSpeed = speed;
    const standingMove = !!kind && EscapeMoves.has(kind) && input.hasBall && this.moveStartedStanding;
    const sizeUpMove = standingMove && speed < SizeUpMaxSpeed;
    if (standingMove) this.standingSettleUntil = this.clock + 0.3;
    if (standingMove && this.escapeStance.action !== a) {
      // Começo do drible parado: guarda a base atual (pés abertos, nunca cruzados) no referencial do jogador.
      this.escapeStance.action = a;
      const inv = this.root.matrixWorld.clone().invert();
      const l = this.plant.l.pos.clone().applyMatrix4(inv);
      const r = this.plant.r.pos.clone().applyMatrix4(inv);
      // Meia base entre 0,25 e 0,33 m do centro do corpo (+X do jogador = esquerda), sem acumular de um escape para o
      // outro (copiar os pés do escape anterior abria a base até o espacate).
      const clamp = THREE.MathUtils.clamp;
      l.set(clamp(l.x, 0.25, 0.33), l.y, clamp(l.z, -0.25, 0.25));
      r.set(clamp(r.x, -0.33, -0.25), r.y, clamp(r.z, -0.25, 0.25));
      this.escapeStance.l.copy(l);
      this.escapeStance.r.copy(r);
    }
    // Fim do size-up/escape: o corpo ainda freia; os pés seguem em passos até assentar (sem voltar ao clipe no meio).
    const settling = !kind && input.hasBall && this.clock < this.standingSettleUntil;

    let crouchTarget: number;
    if (kind === 'Shot') crouchTarget = 0;
    else if (standingMove) crouchTarget = s.crouchIdle;
    else if (a?.timing?.turnDeg) crouchTarget = s.crouchSpin;
    else if (kind) crouchTarget = (a?.timing?.procedural ? s.crouchProcedural : s.crouchMove) + (stepBack?.crouch ?? 0);
    else if (!input.hasBall) crouchTarget = 0.03;
    else if (this.base.base === 'Dribble_Low') crouchTarget = s.crouchLow;
    else if (this.base.base === 'Dribble_Run') crouchTarget = s.crouchRun;
    else if (speed > 0.35) crouchTarget = s.crouchWalk;
    else crouchTarget = s.crouchIdle;
    const k = 1 - Math.exp(-(stepBack ? 20 : a?.timing?.turnDeg ? 12 : 8) * dt);
    this.crouch += (crouchTarget - this.crouch) * k;

    const shooting = kind === 'Shot';
    // A inclinação cresce com a velocidade PARA A FRENTE (indo para trás ou de lado o tronco não deita).
    const ahead = Math.max(0, input.forward);
    const base = input.hasBall ? s.leanBaseDeg + ahead * s.leanPerSpeedDeg : 4 + ahead * 2;
    const spinning = !!a?.timing?.turnDeg;
    const leanF = shooting
      ? 0
      : spinning
        ? s.leanSpinDeg
        : Math.min(s.leanMaxDeg, Math.max(-s.leanMaxDeg, base + input.accelForward * s.leanPerAccelDeg + (stepBack?.leanDeg ?? 0)));
    const leanR = shooting ? 0 : Math.min(s.leanMaxDeg, Math.max(-s.leanMaxDeg, input.accelRight * s.leanPerAccelDeg));
    const kl = 1 - Math.exp(-(stepBack ? 14 : spinning ? 10 : 6) * dt);
    this.leanForward += (leanF - this.leanForward) * kl;
    this.leanRight += (leanR - this.leanRight) * kl;

    // 1) Onde o clipe pôs os tornozelos, as pontas dos pés e os pés (mundo).
    const footL = this.bone('foot_l');
    const footR = this.bone('foot_r');
    const toeY = { l: this.bone('ball_l').getWorldPosition(v).y, r: this.bone('ball_r').getWorldPosition(v).y };
    const ankleL = footL.getWorldPosition(new THREE.Vector3());
    const ankleR = footR.getWorldPosition(new THREE.Vector3());
    const footQL = footL.getWorldQuaternion(new THREE.Quaternion());
    const footQR = footR.getWorldQuaternion(new THREE.Quaternion());

    // 2) Abaixa o quadril (no espaço do pai da pelve, que tem a escala do modelo).
    const pelvis = this.bone('pelvis');
    const parent = pelvis.parent!;
    const worldDown = new THREE.Vector3(0, -this.crouch, 0);
    const parentQ = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const parentS = parent.getWorldScale(new THREE.Vector3());
    worldDown.applyQuaternion(parentQ).divide(parentS);
    pelvis.position.add(worldDown);
    pelvis.updateWorldMatrix(true, true);

    // 3) Tornozelos: base larga parada; no step-back, presos no chão onde estavam e levados para trás em passos.
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    const leftDir = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    const widenTarget = kind && !standingMove
      ? 0
      : this.base.base === 'Dribble_Idle' || this.base.base === 'Dribble_Low'
        ? s.widenIdle
        : this.base.base === 'Dribble_Walk' || this.base.base === 'Dribble_Back'
          ? s.widenWalk
          : 0;
    this.widen += (widenTarget - this.widen) * k;
    ankleL.addScaledVector(leftDir, this.widen);
    ankleR.addScaledVector(leftDir, -this.widen);
    if (a?.feetStart) {
      const fs = a.feetStart;
      for (const [hand, ankle] of [
        ['l', ankleL],
        ['r', ankleR],
      ] as const) {
        const rear = fs.rear === hand;
        const step = footStep(u, rear ? StepBack.rearFoot : StepBack.frontFoot, rear ? StepBack.liftRear : StepBack.liftFront);
        const start = fs[hand];
        ankle.set(
          start.x + (ankle.x - start.x) * step.travel,
          start.y + (ankle.y - start.y) * step.travel + step.height,
          start.z + (ankle.z - start.z) * step.travel,
        );
      }
    }
    // Base plantada (size-up parado) ou trava de pé (fora do step-back, que tem os passos dele, e do arremesso).
    const planted =
      input.hasBall &&
      ((!kind && speed < 0.35 && (this.base.base === 'Dribble_Idle' || this.base.base === 'Dribble_Low')) || standingMove || settling);
    // Nos dribles do size-up os pés não seguem o clipe (a hesitação da CMU anda até 1 m com os pés): ficam pregados.
    // No escape os pés dão passos para onde o corpo vai estar (velocidade x duração do passo).
    const velocity = forward.clone().multiplyScalar(input.forward).addScaledVector(leftDir, -input.right);
    const feetMode = sizeUpMove ? 'hold' : standingMove || (settling && speed > 0.35) ? 'escape' : 'free';
    const flatFeet = this.applyPlantedStance(planted, ankleL, ankleR, dt, feetMode, velocity);
    const lockable = this.footLockEnabled && !a?.feetStart && kind !== 'Shot' && !flatFeet;
    this.applyFootLock('l', ankleL, toeY.l, lockable, dt);
    this.applyFootLock('r', ankleR, toeY.r, lockable, dt);
    solveTwoBoneIK(this.bone('thigh_l'), this.bone('calf_l'), footL, ankleL, forward);
    solveTwoBoneIK(this.bone('thigh_r'), this.bone('calf_r'), footR, ankleR, forward);
    // Pé com a mesma orientação do clipe (sola no chão); na base plantada, reto no chão e apontado para a frente.
    if (flatFeet) {
      const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
      footQL.copy(rootQ).multiply(this.restFootLocal.l).slerp(footQL, 1 - this.plantBlend);
      footQR.copy(rootQ).multiply(this.restFootLocal.r).slerp(footQR, 1 - this.plantBlend);
    }
    const orientFoot = (foot: THREE.Bone, worldQ: THREE.Quaternion) => {
      const parentWorld = foot.parent!.getWorldQuaternion(new THREE.Quaternion());
      foot.quaternion.copy(parentWorld.invert().multiply(worldQ));
      foot.updateWorldMatrix(false, true);
    };
    orientFoot(footL, footQL);
    orientFoot(footR, footQR);
    // Sola no chão: a malha do tênis é mais grossa que o pé do mocap; se o ponto mais baixo da sola ficou abaixo do
    // piso, o tornozelo sobe exatamente isso e o IK da perna é refeito (o pé mantém a orientação).
    for (const [side, foot, ankle, worldQ] of [
      ['l', footL, ankleL, footQL],
      ['r', footR, ankleR, footQR],
    ] as const) {
      const below = -this.soleHeight(side);
      if (below <= 0) continue;
      ankle.y += below;
      solveTwoBoneIK(this.bone(`thigh_${side}`), this.bone(`calf_${side}`), foot, ankle, forward);
      orientFoot(foot, worldQ);
    }

    // 4) Inclinação do tronco: metade em spine_01, metade em spine_02 (as costas curvam, não dobram num ponto só).
    // +X do modelo = esquerda: girar em torno dele leva o "cima" para a frente (+Z). Em torno da frente (+Z), o
    // "cima" vai para -X = direita do modelo.
    // Eixos do CORPO: no spin a malha gira em relação à raiz, e "para a frente" da raiz virava para trás no meio do giro.
    const bodyQ = this.model.getWorldQuaternion(new THREE.Quaternion());
    const left = axis.set(1, 0, 0).applyQuaternion(bodyQ);
    const bodyForward = new THREE.Vector3(0, 0, 1).applyQuaternion(bodyQ);
    const lean = new THREE.Quaternion()
      .setFromAxisAngle(left, THREE.MathUtils.degToRad(this.leanForward * 0.5))
      .multiply(q.setFromAxisAngle(bodyForward, THREE.MathUtils.degToRad(this.leanRight * 0.5)));
    for (const name of ['spine_01', 'spine_02']) {
      const spine = this.bone(name);
      const spineWorld = spine.getWorldQuaternion(new THREE.Quaternion());
      spine.quaternion.multiply(spineWorld.clone().invert().multiply(lean).multiply(spineWorld));
      spine.updateWorldMatrix(false, true);
    }
    // A pelve e os ossos voltam para a pose do clipe no próximo quadro (o mixer sobrescreve): nada acumula.
  }

  private plantBlend = 0;

  /** Guarda os vértices da sola (até 4,5 cm acima do mais baixo: a ponta curva entra no piso quando o pé dobra de cada pé, no bind pose) no espaço do osso. */
  private collectSolePoints(): void {
    const sides: Record<string, Hand> = { foot_l: 'l', ball_l: 'l', foot_r: 'r', ball_r: 'r' };
    const found: Record<Hand, { bone: THREE.Bone; world: THREE.Vector3 }[]> = { l: [], r: [] };
    const p = new THREE.Vector3();
    this.model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const idx = mesh.geometry.getAttribute('skinIndex');
      const wts = mesh.geometry.getAttribute('skinWeight');
      for (let i = 0; i < idx.count; i++) {
        let best = -1;
        let bestW = 0;
        for (let k = 0; k < 4; k++) {
          if (wts.getComponent(i, k) > bestW) {
            bestW = wts.getComponent(i, k);
            best = idx.getComponent(i, k);
          }
        }
        const bone = mesh.skeleton.bones[best];
        const side = bone && sides[bone.name];
        if (side) found[side].push({ bone, world: mesh.localToWorld(mesh.getVertexPosition(i, p)).clone() });
      }
    });
    for (const side of ['l', 'r'] as const) {
      const minY = Math.min(...found[side].map((f) => f.world.y));
      const sole = found[side].filter((f) => f.world.y < minY + 0.045);
      const stride = Math.max(1, Math.floor(sole.length / 120));
      this.solePoints[side] = sole
        .filter((_, i) => i % stride === 0)
        .map((f) => ({ bone: f.bone, local: f.bone.worldToLocal(f.world.clone()) }));
    }
  }

  /** Altura do ponto mais baixo da sola (mundo); os ossos do pé precisam estar com a matriz do mundo atualizada. */
  private soleHeight(side: Hand): number {
    let min = Infinity;
    for (const pt of this.solePoints[side]) min = Math.min(min, v.copy(pt.local).applyMatrix4(pt.bone.matrixWorld).y);
    return min;
  }

  /**
   * Base plantada. Retorna true se os pés estão sob controle dela (alvos já escritos em ankleL/ankleR).
   * Cada pé fica numa posição fixa do chão; se a posição ideal (a do clipe, aberta) se afasta mais de 22 cm ou o corpo
   * gira, o pé levanta e anda até ela em 0,16 s (passinho de ajuste), um pé por vez.
   */
  private applyPlantedStance(
    active: boolean,
    ankleL: THREE.Vector3,
    ankleR: THREE.Vector3,
    dt: number,
    mode: 'free' | 'hold' | 'escape' = 'free',
    velocity = new THREE.Vector3(),
  ): boolean {
    const p = this.plant;
    this.plantBlend += ((active ? 1 : 0) - this.plantBlend) * (1 - Math.exp(-10 * dt));
    if (!active) {
      p.active = false;
      if (this.plantBlend < 0.02) return false;
    }
    if (active && !p.active) {
      // Entra na base: os pés pousam onde o clipe os pôs, no chão.
      p.active = true;
      for (const [side, ankle] of [
        ['l', ankleL],
        ['r', ankleR],
      ] as const) {
        p[side].pos.set(ankle.x, this.restAnkleY, ankle.z);
        p[side].t = 1;
      }
    }
    let stepping = p.l.t < 1 || p.r.t < 1;
    const escape = mode === 'escape';
    const threshold = escape ? EscapeStep.threshold : 0.22;
    const stepSeconds = escape ? EscapeStep.seconds : 0.16;
    const ideals = {
      l: new THREE.Vector3(ankleL.x, this.restAnkleY, ankleL.z),
      r: new THREE.Vector3(ankleR.x, this.restAnkleY, ankleR.z),
    };
    if (escape) {
      // Pés na base do jogador (o clipe do escape cruza as pernas; o escape real é passo lateral, sem cruzar), para onde
      // o corpo vai estar quando o passo pousar.
      if (this.escapeStance.action) {
        ideals.l.copy(this.escapeStance.l).applyMatrix4(this.root.matrixWorld).setY(this.restAnkleY);
        ideals.r.copy(this.escapeStance.r).applyMatrix4(this.root.matrixWorld).setY(this.restAnkleY);
      }
      ideals.l.addScaledVector(velocity, EscapeStep.lead);
      ideals.r.addScaledVector(velocity, EscapeStep.lead);
    }
    const gap = (side: Hand) => Math.hypot(ideals[side].x - p[side].pos.x, ideals[side].z - p[side].pos.z);
    // Quem sai primeiro: no escape, o pé do lado para onde o corpo vai (abre) e depois o outro (vem atrás, sem cruzar);
    // no resto, o pé mais longe de onde deveria estar.
    const leftAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    const leftFirst = escape ? velocity.dot(leftAxis) >= 0 : gap('l') >= gap('r');
    const order: [Hand, THREE.Vector3][] = leftFirst ? [['l', ankleL], ['r', ankleR]] : [['r', ankleR], ['l', ankleL]];
    if (escape) {
      // O pé nunca pousa além da linha do outro (sempre um palmo de base): sem cruzar as pernas.
      const minGap = 0.3;
      const side = (v: THREE.Vector3) => v.dot(leftAxis);
      const sl = side(ideals.l);
      const sr = side(p.r.pos);
      if (sl < sr + minGap) ideals.l.addScaledVector(leftAxis, sr + minGap - sl);
      const sr2 = side(ideals.r);
      const sl2 = side(p.l.pos);
      if (sr2 > sl2 - minGap) ideals.r.addScaledVector(leftAxis, sl2 - minGap - sr2);
    }
    for (const [side, ankle] of order) {
      const f = p[side];
      const ideal = ideals[side];
      if (f.t >= 1 && !stepping && mode !== 'hold' && gap(side) > threshold) {
        f.from.copy(f.pos);
        f.to.copy(ideal);
        f.t = 0;
        stepping = true;
      }
      if (f.t < 1) {
        f.t = Math.min(1, f.t + dt / stepSeconds);
        const s = f.t * f.t * (3 - 2 * f.t);
        f.pos.lerpVectors(f.from, f.to, s);
        f.pos.y = this.restAnkleY + 0.09 * Math.sin(Math.PI * f.t); // passo de verdade: a ponta sai do chão
        if (f.t >= 1) f.pos.y = this.restAnkleY;
      }
      ankle.lerp(f.pos, this.plantBlend);
    }
    return this.plantBlend > 0.5;
  }

  /**
   * Trava de pé: a animação diz quando o pé está apoiado (ponta do pé no chão e tornozelo quase parado no mundo); aí o
   * alvo do IK fica preso onde o pé pousou. Solta quando a animação levanta o pé ou quando a perna esticaria demais
   * (o corpo andou além do passo), e o pé volta para a animação suavemente.
   */
  private applyFootLock(side: Hand, ankle: THREE.Vector3, toeY: number, enabled: boolean, dt: number): void {
    const f = this.footLock[side];
    const animVel = new THREE.Vector3(ankle.x - f.prevAnim.x, 0, ankle.z - f.prevAnim.z).divideScalar(Math.max(dt, 1e-4));
    const animSpeed = dt > 0 ? animVel.length() : 0;
    f.prevAnim.copy(ankle);
    const descending = toeY < f.prevToe - 1e-4;
    f.prevToe = toeY;
    // Freio na aterrissagem: descendo, a ponta a menos de ~8 cm do chão, o movimento horizontal do pé vai sendo anulado;
    // ele chega ao chão parado e a trava pega (antes ele pousava a 3–4 m/s e escorregava 2–3 quadros).
    // Só na passada para a frente/para trás: um pé que anda de lado (deslize, passo cruzado do crossover) preso antes da hora
    // ficava no caminho do outro e as pernas cruzavam.
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    const alongStride = animSpeed > 1e-3 && Math.abs(animVel.dot(fwd)) > 0.6 * animSpeed;
    const brake = descending && alongStride ? 1 - THREE.MathUtils.smoothstep(toeY, 0.04, 0.085) : 0;
    const planted = toeY < 0.055 && (animSpeed < 1.2 || brake > 0.5);
    if (!enabled) {
      f.locked = false;
      f.releaseT = 1;
      f.land.set(0, 0, 0);
      return;
    }
    if (f.locked) {
      const stretch = Math.hypot(ankle.x - f.pos.x, ankle.z - f.pos.z);
      if (!planted || toeY > 0.075 || stretch > 0.32) {
        f.locked = false;
        f.release.set(f.pos.x - ankle.x, 0, f.pos.z - ankle.z);
        f.releaseT = 0;
      } else {
        ankle.x = f.pos.x;
        ankle.z = f.pos.z;
        return;
      }
    } else {
      // Pé que a animação arrasta rente ao chão (o recuo da CMU arrasta o pé de trás): sobe um pouco, vira passo.
      if (toeY < 0.05 && animSpeed > 1.5) ankle.y += Math.min(0.05, (animSpeed - 1.5) * 0.02) * (1 - toeY / 0.05);
      if (brake > 0 && f.releaseT >= 0.6) f.land.addScaledVector(animVel, -brake * dt);
      else f.land.multiplyScalar(Math.exp(-12 * dt));
      ankle.add(f.land);
      if (planted && f.releaseT >= 0.6) {
        f.locked = true;
        f.pos.copy(ankle);
        f.land.set(0, 0, 0);
        return;
      }
    }
    // Soltou: o pé desliza de volta para a animação em ~0,15 s (no ar, onde não aparece).
    if (f.releaseT < 1) {
      f.releaseT = Math.min(1, f.releaseT + dt / 0.15);
      const k = 1 - f.releaseT * f.releaseT * (3 - 2 * f.releaseT);
      ankle.addScaledVector(f.release, k);
    }
  }

  // ------------------------------------------------------------------------------------------- braços

  /** Leva a palma de `hand` até `palmWorld` (IK do braço), com o cotovelo para o lado de `pole`. */
  private reachPalm(hand: Hand, palmTarget: THREE.Vector3, weight: number, pole: THREE.Vector3): void {
    if (weight <= 1e-3) return;
    const upper = this.bone(`upperarm_${hand}`);
    const lower = this.bone(`lowerarm_${hand}`);
    const wrist = this.bone(`hand_${hand}`);
    const palm = this.palmWorld(hand, v2);
    const wristPos = wrist.getWorldPosition(new THREE.Vector3());
    const goal = palm.clone().lerp(palmTarget, weight).sub(palm).add(wristPos); // mesmo deslocamento no punho
    solveTwoBoneIK(upper, lower, wrist, goal, pole);
    applyPole(upper, lower, goal, pole, weight);
  }

  /**
   * Quanto um ponto (centro de uma esfera de raio r) precisa andar na horizontal para sair das pernas. Empurra para longe
   * do eixo de cada cápsula; se o ponto está em cima do eixo, para fora do corpo.
   */
  legClearance(point: THREE.Vector3, radius: number, out = new THREE.Vector3(), hand?: Hand): THREE.Vector3 {
    out.set(0, 0, 0);
    const p = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const d = new THREE.Vector3();
    const center = this.root.position;
    // Orientação do CORPO (no spin a malha gira até 360° em relação à raiz do jogo).
    const bodyQ = this.model.getWorldQuaternion(new THREE.Quaternion());
    const leftDir = new THREE.Vector3(1, 0, 0).applyQuaternion(bodyQ);
    const fwdDir = new THREE.Vector3(0, 0, 1).applyQuaternion(bodyQ);
    for (let iter = 0; iter < 2; iter++) {
      for (const cap of LegCapsules) {
        this.bone(cap.a).getWorldPosition(a);
        this.bone(cap.b).getWorldPosition(b);
        if (cap.from > 0) a.lerp(b, cap.from);
        p.copy(point).add(out);
        const ab = b.clone().sub(a);
        const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq()), 0, 1);
        c.copy(a).addScaledVector(ab, t);
        const need = cap.r + radius + BallLegMargin;
        d.copy(p).sub(c);
        const dist = d.length();
        const wanted = smoothMax(dist, need, BallLegSoft);
        if (wanted - dist < 1e-4) continue;
        const radial = dist > 1e-6 ? d.clone().divideScalar(dist) : new THREE.Vector3();
        if (hand) {
          // Mão da bola: a perna do mesmo lado é contornada por fora do joelho; a outra, pela frente (direção fixa,
          // sem a mão pular de um lado para o outro entre as pernas). No entre as pernas, antes da soltura, a bola vai
          // descer e passar entre os pés: o joelho do mesmo lado também é contornado pela frente.
          const sameSide = cap.a.endsWith(`_${hand}`);
          const tween = this.active?.kind === 'BetweenLegs' && !this.active.released;
          d.copy(sameSide && !tween ? leftDir : fwdDir).multiplyScalar(sameSide && !tween ? sideSign(hand) : 1);
        } else {
          d.y = 0;
          if (d.lengthSq() < 1e-6) d.set(c.x - center.x, 0, c.z - center.z);
          d.normalize();
        }
        // Quanto andar na direção escolhida para a distância ao eixo crescer até `wanted` (linearizado pelo ângulo entre a
        // direção e a saída radial; limitado para a direção quase de lado não pedir um empurrão enorme).
        const k = (wanted - dist) / Math.max(0.35, d.dot(radial));
        out.addScaledVector(d, k);
      }
    }
    return out;
  }

  /** Entre as pernas: quique entre os pés e recepção por fora do joelho do outro lado (referencial do jogador). */
  private betweenLegsPath(toHand: Hand): { floorLocal: THREE.Vector3; catchLocal: THREE.Vector3 } {
    const inv = this.root.matrixWorld.clone().invert();
    const planted = this.plantBlend > 0.5;
    const foot = (side: Hand) =>
      (planted ? this.plant[side].pos.clone() : this.bone(`foot_${side}`).getWorldPosition(new THREE.Vector3())).applyMatrix4(inv);
    const l = foot('l');
    const r = foot('r');
    const floorLocal = l.clone().add(r).multiplyScalar(0.5).setY(0);
    const to = toHand === 'l' ? l : r;
    const catchLocal = new THREE.Vector3(
      to.x + sideSign(toHand) * TweenCatch.outside,
      TweenCatch.height,
      to.z + TweenCatch.forward,
    );
    return { floorLocal, catchLocal };
  }

  private tweenCatch: { action: ActiveAction; hand: Hand; local: THREE.Vector3 } | null = null;

  /** Centro da bola na recepção do drible parado de uma mão (referencial do jogador, alturas de jogador bom). */
  private receivingDribblePalm(hand: Hand): THREE.Vector3 {
    const clip = loopClip('Dribble_Idle', hand);
    const info = this.clips[clip];
    const peaks = hand === 'r' ? info.peaks_r : info.peaks_l;
    const palm = this.palmLocal(info, hand, peaks[0] ?? 0).applyAxisAngle(axis.set(0, 1, 0), -this.model.rotation.y);
    this.lowDribblePalm(clip, hand, palm, palm.y);
    palm.y -= BallRadius * 1.02;
    return palm;
  }
  private tweenArmWeight = 0;

  /** Entre as pernas: depois da soltura, a mão que recebe desce para o ponto de recepção (por fora do joelho, baixo). */
  private applyBetweenLegsArm(dt: number): void {
    const cur = this.active;
    if (cur?.kind === 'BetweenLegs' && !cur.fadingOut && this.hasBall && this.tweenCatch?.action !== cur) {
      // Começo do entre as pernas: o ponto de recepção já é conhecido (a soltura usa o mesmo).
      this.tweenCatch = { action: cur, hand: cur.toHand, local: this.betweenLegsPath(cur.toHand).catchLocal };
    }
    const t = this.tweenCatch;
    if (!t) return;
    const a = this.active;
    const running = !!a && t.action === a && !a.fadingOut;
    if (running && a.timing?.turnBack) {
      // Half spin: a mão nova vai para a recepção na volta do giro.
      this.tweenArmWeight = THREE.MathUtils.smoothstep(this.progress(a), HalfSpinBall.release, HalfSpinBall.catch);
    } else if (running) {
      // A mão que recebe já desce desde o começo do drible (no real ela espera a bola baixa) e segura lá até o fim.
      this.tweenArmWeight = THREE.MathUtils.smoothstep(a.action.time, a.start, a.release + (a.catch - a.release) * 0.7);
    } else {
      // Fim do drible: o braço volta para o loop devagar (cortar o peso de uma vez dava tranco).
      this.tweenArmWeight *= Math.exp(-8 * dt);
      if (this.tweenArmWeight < 0.01) {
        this.tweenCatch = null;
        return;
      }
    }
    const w = this.tweenArmWeight;
    if (w <= 1e-3) return;
    const palm = t.local.clone().add(new THREE.Vector3(0, BallRadius * 1.02, 0)).applyMatrix4(this.root.matrixWorld);
    const pole = new THREE.Vector3(sideSign(t.hand), -0.3, -0.8).transformDirection(this.root.matrixWorld);
    this.reachPalm(t.hand, palm, w, pole);
  }

  private readonly ballClearance = { l: new THREE.Vector3(), r: new THREE.Vector3() };

  /** A mão da bola contorna as pernas: se a bola presa sob a palma entraria numa perna, a palma vai para fora dela. */
  private applyBallClearance(dt: number, input: AnimInput): void {
    const a = this.active && !this.active.fadingOut ? this.active : null;
    for (const hand of ['l', 'r'] as const) {
      const holding =
        this.ballClearanceEnabled &&
        this.hasBall && !this.ballHeldLocal && a?.kind !== 'Shot' && hand === (a && !a.released ? a.fromHand : input.ballHand);
      const off = this.ballClearance[hand];
      const palm = this.palmWorld(hand, new THREE.Vector3());
      const target = holding
        ? this.legClearance(palm.clone().add(new THREE.Vector3(0, -BallRadius * 1.02, 0)), BallRadius, undefined, hand)
        : new THREE.Vector3();
      target.clampLength(0, BallLegHandMax);
      off.lerp(target, 1 - Math.exp(-BallLegHandRate * dt));
      if (off.lengthSq() < 1e-6) continue;
      const pole = new THREE.Vector3(sideSign(hand), -0.3, -0.8).transformDirection(this.root.matrixWorld);
      this.reachPalm(hand, palm.add(off), 1, pole);
    }
  }

  /**
   * Spin baixo: o braço livre desce até perto do chão, à frente e do lado dele (equilíbrio; Kyrie x Spurs, NSiPz8Kvuqw
   * 15,3–16,2 s, a ponta dos dedos a um palmo do chão). Livre = o que não está com a bola: o outro até a recepção.
   */
  private spinArm = { hand: 'l' as Hand, w: 0 };
  private applySpinFreeArm(dt: number): void {
    const a = this.active && !this.active.fadingOut ? this.active : null;
    const spinning = !!a?.timing?.turnDeg && this.hasBall;
    const A = this.spinArm;
    if (spinning) {
      const u = this.progress(a);
      const catchU = a.timing!.turnBack ? HalfSpinBall.catch : (a.catch - a.start) / Math.max(1e-3, a.end - a.start);
      const hand: Hand = u < catchU ? otherSide(a.fromHand) : a.fromHand;
      if (hand !== A.hand) A.w = 0;
      A.hand = hand;
      const target = THREE.MathUtils.smoothstep(u, 0, 0.25) * (1 - THREE.MathUtils.smoothstep(u, catchU - 0.15, catchU));
      A.w += (target - A.w) * (1 - Math.exp(-14 * dt));
    } else {
      A.w *= Math.exp(-10 * dt);
    }
    if (A.w < 1e-3) return;
    const bodyQ = this.model.getWorldQuaternion(new THREE.Quaternion());
    const side = sideSign(A.hand);
    const palm = new THREE.Vector3(side * SpinFreeHand.outside, 0, SpinFreeHand.forward).applyQuaternion(bodyQ).add(this.root.position);
    palm.y = SpinFreeHand.height;
    const pole = new THREE.Vector3(side, -0.3, -0.8).applyQuaternion(bodyQ);
    this.reachPalm(A.hand, palm, A.w, pole);
  }

  private btbFade: {
    action: ActiveAction;
    from: { hand: Hand; local: THREE.Vector3; w: number };
    other: { hand: Hand; local: THREE.Vector3; w: number };
  } | null = null;

  /** Quanto o corpo está mais baixo que o agachamento dos procedurais (os pontos-chave do behind the back). */
  private behindBackDrop(): number {
    return Math.max(0, this.crouch - this.stance.crouchProcedural);
  }

  private applyArms(dt: number): void {
    const a = this.active && !this.active.fadingOut ? this.active : null;
    const toWorld = this.root.matrixWorld;
    const u = a ? this.progress(a) : 0;

    // Drible baixo nos loops (braço da bola), entrando e saindo suave.
    const dribbling = this.hasBall && this.base.name.startsWith('Dribble_') && !a;
    const kw = 1 - Math.exp(-10 * dt);
    const baseHand: Hand = this.base.name.endsWith('_L') ? 'l' : 'r';
    for (const hand of ['l', 'r'] as const) {
      const target = dribbling && hand === baseHand ? 1 - this.actionWeight : 0;
      this.dribbleArmWeight[hand] += (target - this.dribbleArmWeight[hand]) * kw;
      const w = this.dribbleArmWeight[hand];
      if (w <= 1e-3) continue;
      const inv = toWorld.clone().invert();
      const local = this.palmWorld(hand, new THREE.Vector3()).applyMatrix4(inv);
      // Altura "nativa" = a atual sem o agachamento (o braço desce junto com o quadril). Alturas do loop desta mão.
      this.lowDribblePalm(this.base.name.replace(/_[LR]$/, hand === 'l' ? '_L' : '_R'), hand, local, local.y + this.crouch);
      const s = sideSign(hand);
      const pole = new THREE.Vector3(s, -0.3, -0.8).transformDirection(toWorld);
      this.reachPalm(hand, local.applyMatrix4(toWorld), w, pole);
    }

    // Sem bola, o Hold_Idle segura a bola com a direita (palma erguida na altura do peito); a esquerda já fica solta.
    // A direita desce para o espelho da esquerda, pela mesma IK do braço do drible.
    const relaxArm = !this.hasBall && this.base.name === 'Hold_Idle' && !a;
    this.restArmWeight += ((relaxArm ? 1 : 0) - this.restArmWeight) * kw;
    if (this.restArmWeight > 1e-3) {
      const inv = toWorld.clone().invert();
      // Espelho pela linha do quadril (meio entre as coxas), para não depender de a malha estar centrada na raiz.
      const hipL = this.bone('thigh_l').getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      const hipR = this.bone('thigh_r').getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      const relaxed = this.palmWorld('l', new THREE.Vector3()).applyMatrix4(inv);
      relaxed.x = hipL.x + hipR.x - relaxed.x;
      const pole = new THREE.Vector3(sideSign('r'), -0.3, -0.8).transformDirection(toWorld);
      this.reachPalm('r', relaxed.applyMatrix4(toWorld), this.restArmWeight, pole);
    }

    // Behind the back: a mão de origem carrega a bola por trás do quadril; a outra vai buscar a recepção.
    if (a?.timing?.procedural === 'BehindBack') {
      const s = sideSign(a.fromHand);
      const w = behindBackArmWeights(u);
      // Os pontos-chave foram medidos com o agachamento dos procedurais; parado (size-up) o corpo está mais baixo.
      const drop = new THREE.Vector3(0, -this.behindBackDrop(), 0);
      const ball = toV(behindBackBall(u, a.fromHand)).add(drop);
      if (u < BehindBack.release) this.ballHeldLocal = ball.clone();
      // Palma por cima e por fora da bola (empurrando para baixo e para o outro lado).
      const palm = ball.clone().add(new THREE.Vector3(s * 0.05, BallRadius * 0.95, -0.03)).applyMatrix4(toWorld);
      const poleFrom = new THREE.Vector3(s, -0.2, -0.9).transformDirection(toWorld);
      this.reachPalm(a.fromHand, palm, w.from, poleFrom);
      const other = otherSide(a.fromHand);
      const catchPalm = toV(behindBackCatch(a.fromHand)).add(drop).add(new THREE.Vector3(0, BallRadius * 1.02, 0)).applyMatrix4(toWorld);
      const offPalm = toV(behindBackOffArm(a.fromHand)).add(drop).applyMatrix4(toWorld);
      // Braço livre à frente (proteção, baixo) e depois indo receber a bola, sem voltar para o clipe no meio.
      const otherTarget = offPalm.clone().lerp(catchPalm, w.to);
      const poleOther = new THREE.Vector3(-s, -0.3, -0.8).transformDirection(toWorld);
      this.reachPalm(other, otherTarget, Math.max(w.to, w.offArm), poleOther);
      const inv = toWorld.clone().invert();
      this.btbFade = {
        action: a,
        from: { hand: a.fromHand, local: palm.clone().applyMatrix4(inv), w: w.from },
        other: { hand: other, local: otherTarget.clone().applyMatrix4(inv), w: Math.max(w.to, w.offArm) },
      };
    } else if (this.btbFade) {
      // Fim do behind the back: os braços voltam para o drible devagar (cortar o IK de uma vez dava tranco nos dois).
      const f = this.btbFade;
      const k = Math.exp(-10 * dt);
      for (const arm of [f.from, f.other]) {
        arm.w *= k;
        if (arm.w > 1e-3) {
          const pole = new THREE.Vector3(sideSign(arm.hand), -0.3, -0.8).transformDirection(toWorld);
          this.reachPalm(arm.hand, arm.local.clone().applyMatrix4(toWorld), arm.w, pole);
        }
      }
      if (f.from.w < 1e-3 && f.other.w < 1e-3) this.btbFade = null;
    }
  }
}
