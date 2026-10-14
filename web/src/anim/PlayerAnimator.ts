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

  private crouch = 0;
  private widen = 0;
  /** Trava de pé: enquanto o pé está apoiado na animação, ele fica preso no chão (mundo) e não patina. */
  private readonly footLock = {
    l: { locked: false, pos: new THREE.Vector3(), prevAnim: new THREE.Vector3(), release: new THREE.Vector3(), releaseT: 1 },
    r: { locked: false, pos: new THREE.Vector3(), prevAnim: new THREE.Vector3(), release: new THREE.Vector3(), releaseT: 1 },
  };
  footLockEnabled = true;
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
  private leanForward = 0;
  private leanRight = 0;
  private dribbleArmWeight = 0;
  private restArmWeight = 0;
  /** Giro extra da malha (rad) além do yaw do jogador: spin / half spin. */
  yawOffset = 0;
  /** Soltura que aconteceu neste quadro (o jogo consome). */
  readonly releases: BallRelease[] = [];
  /** Centro da bola (referencial do jogador) quando um drible procedural a carrega; null = presa à palma. */
  ballHeldLocal: THREE.Vector3 | null = null;

  // Ajustes de postura (tunáveis no laboratório). Metros no mundo (jogador de 1,96 m) e graus.
  stance = {
    crouchIdle: 0.22, // quanto o quadril desce parado (size-up: base baixa e larga, como nas referências reais)
    crouchWalk: 0.15,
    crouchRun: 0.12,
    crouchLow: 0.08, // o clipe baixo já é baixo
    crouchMove: 0.07, // dribles de mocap (os clipes já abaixam)
    crouchProcedural: 0.14, // behind the back / step-back (o tronco vem de um clipe mais alto)
    widenIdle: 0.13, // m que cada pé abre para o lado parado (base larga do size-up)
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
    if (a.timing?.procedural) return (this.clock - a.startClock) / Math.max(0.05, a.duration);
    return (a.action.time - a.start) / Math.max(1e-3, a.end - a.start);
  }

  // ------------------------------------------------------------------------------------------- quadro

  update(dt: number, input: AnimInput): void {
    this.clock += dt;
    this.releases.length = 0;
    this.ballHeldLocal = null;
    this.hasBall = input.hasBall;
    this.chooseBase(input);
    this.updateAction();
    this.updateWeights();

    // Avança o mixer guardando os tempos anteriores para detectar eventos.
    for (const [name, action] of this.actions) {
      if (action.getEffectiveWeight() > 0 || name === this.base.name || this.active?.clip === name) {
        this.prevTimes.set(name, action.time);
      }
    }
    this.mixer.update(dt);
    this.inertial.apply(dt);
    this.model.rotation.y = this.yawOffset;
    this.root.updateMatrixWorld(true);
    this.detectEvents();

    this.applyStance(dt, input);
    this.applyArms(dt);
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
    } else if (fwd < -0.5 && Math.abs(fwd) >= Math.abs(side) * 0.8) {
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
      const prev = this.prevTimes.get(a.clip) ?? a.action.time;
      if (prev < a.release && a.action.time >= a.release) {
        a.released = true;
        const info = this.clips[a.clip];
        const palm = this.palmLocal(info, a.toHand, a.catch * ClipFps);
        // No fim do giro a malha volta para a frente: a recepção é prevista sem o giro.
        if (a.timing?.turnDeg) palm.applyAxisAngle(axis.set(0, 1, 0), -this.model.rotation.y);
        palm.y -= BallRadius * 1.02;
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

    let crouchTarget: number;
    if (kind === 'Shot') crouchTarget = 0;
    else if (kind) crouchTarget = (a?.timing?.procedural ? s.crouchProcedural : s.crouchMove) + (stepBack?.crouch ?? 0);
    else if (!input.hasBall) crouchTarget = 0.03;
    else if (this.base.base === 'Dribble_Low') crouchTarget = s.crouchLow;
    else if (this.base.base === 'Dribble_Run') crouchTarget = s.crouchRun;
    else if (speed > 0.35) crouchTarget = s.crouchWalk;
    else crouchTarget = s.crouchIdle;
    const k = 1 - Math.exp(-(stepBack ? 20 : 8) * dt);
    this.crouch += (crouchTarget - this.crouch) * k;

    const shooting = kind === 'Shot';
    // A inclinação cresce com a velocidade PARA A FRENTE (indo para trás ou de lado o tronco não deita).
    const ahead = Math.max(0, input.forward);
    const base = input.hasBall ? s.leanBaseDeg + ahead * s.leanPerSpeedDeg : 4 + ahead * 2;
    const leanF = shooting
      ? 0
      : Math.min(s.leanMaxDeg, Math.max(-s.leanMaxDeg, base + input.accelForward * s.leanPerAccelDeg + (stepBack?.leanDeg ?? 0)));
    const leanR = shooting ? 0 : Math.min(s.leanMaxDeg, Math.max(-s.leanMaxDeg, input.accelRight * s.leanPerAccelDeg));
    const kl = 1 - Math.exp(-(stepBack ? 14 : 6) * dt);
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
    const widenTarget = kind
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
      input.hasBall && !kind && speed < 0.35 && (this.base.base === 'Dribble_Idle' || this.base.base === 'Dribble_Low');
    const flatFeet = this.applyPlantedStance(planted, ankleL, ankleR, dt);
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
    for (const [foot, worldQ] of [
      [footL, footQL],
      [footR, footQR],
    ] as const) {
      const parentWorld = foot.parent!.getWorldQuaternion(new THREE.Quaternion());
      foot.quaternion.copy(parentWorld.invert().multiply(worldQ));
      foot.updateWorldMatrix(false, true);
    }

    // 4) Inclinação do tronco: metade em spine_01, metade em spine_02 (as costas curvam, não dobram num ponto só).
    // +X do modelo = esquerda: girar em torno dele leva o "cima" para a frente (+Z). Em torno da frente (+Z), o
    // "cima" vai para -X = direita do modelo.
    const left = axis.set(1, 0, 0).applyQuaternion(this.root.quaternion);
    const lean = new THREE.Quaternion()
      .setFromAxisAngle(left, THREE.MathUtils.degToRad(this.leanForward * 0.5))
      .multiply(q.setFromAxisAngle(forward, THREE.MathUtils.degToRad(this.leanRight * 0.5)));
    for (const name of ['spine_01', 'spine_02']) {
      const spine = this.bone(name);
      const spineWorld = spine.getWorldQuaternion(new THREE.Quaternion());
      spine.quaternion.multiply(spineWorld.clone().invert().multiply(lean).multiply(spineWorld));
      spine.updateWorldMatrix(false, true);
    }
    // A pelve e os ossos voltam para a pose do clipe no próximo quadro (o mixer sobrescreve): nada acumula.
  }

  private plantBlend = 0;

  /**
   * Base plantada. Retorna true se os pés estão sob controle dela (alvos já escritos em ankleL/ankleR).
   * Cada pé fica numa posição fixa do chão; se a posição ideal (a do clipe, aberta) se afasta mais de 22 cm ou o corpo
   * gira, o pé levanta e anda até ela em 0,16 s (passinho de ajuste), um pé por vez.
   */
  private applyPlantedStance(active: boolean, ankleL: THREE.Vector3, ankleR: THREE.Vector3, dt: number): boolean {
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
    for (const [side, ankle] of [
      ['l', ankleL],
      ['r', ankleR],
    ] as const) {
      const f = p[side];
      const ideal = new THREE.Vector3(ankle.x, this.restAnkleY, ankle.z);
      if (f.t >= 1 && !stepping && Math.hypot(ideal.x - f.pos.x, ideal.z - f.pos.z) > 0.22) {
        f.from.copy(f.pos);
        f.to.copy(ideal);
        f.t = 0;
        stepping = true;
      }
      if (f.t < 1) {
        f.t = Math.min(1, f.t + dt / 0.16);
        const s = f.t * f.t * (3 - 2 * f.t);
        f.pos.lerpVectors(f.from, f.to, s);
        f.pos.y = this.restAnkleY + 0.06 * Math.sin(Math.PI * f.t);
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
    const animSpeed = dt > 0 ? Math.hypot(ankle.x - f.prevAnim.x, ankle.z - f.prevAnim.z) / dt : 0;
    f.prevAnim.copy(ankle);
    const planted = toeY < 0.055 && animSpeed < 1.2;
    if (!enabled) {
      f.locked = false;
      f.releaseT = 1;
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
    } else if (planted && f.releaseT >= 0.6) {
      f.locked = true;
      f.pos.copy(ankle);
      return;
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

  private applyArms(dt: number): void {
    const a = this.active && !this.active.fadingOut ? this.active : null;
    const toWorld = this.root.matrixWorld;
    const u = a ? this.progress(a) : 0;

    // Drible baixo nos loops (braço da bola), entrando e saindo suave.
    const dribbling = this.hasBall && this.base.name.startsWith('Dribble_') && !a;
    const kw = 1 - Math.exp(-10 * dt);
    this.dribbleArmWeight += ((dribbling ? 1 - this.actionWeight : 0) - this.dribbleArmWeight) * kw;
    if (this.dribbleArmWeight > 1e-3) {
      const hand: Hand = this.base.name.endsWith('_L') ? 'l' : 'r';
      const inv = toWorld.clone().invert();
      const local = this.palmWorld(hand, new THREE.Vector3()).applyMatrix4(inv);
      // Altura "nativa" = a atual sem o agachamento (o braço desce junto com o quadril).
      this.lowDribblePalm(this.base.name, hand, local, local.y + this.crouch);
      const s = sideSign(hand);
      const pole = new THREE.Vector3(s, -0.3, -0.8).transformDirection(toWorld);
      this.reachPalm(hand, local.applyMatrix4(toWorld), this.dribbleArmWeight, pole);
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
      const ball = toV(behindBackBall(u, a.fromHand));
      if (u < BehindBack.release) this.ballHeldLocal = ball.clone();
      // Palma por cima e por fora da bola (empurrando para baixo e para o outro lado).
      const palm = ball.clone().add(new THREE.Vector3(s * 0.05, BallRadius * 0.95, -0.03)).applyMatrix4(toWorld);
      this.reachPalm(a.fromHand, palm, w.from, new THREE.Vector3(s, -0.2, -0.9).transformDirection(toWorld));
      const other = otherSide(a.fromHand);
      const catchPalm = toV(behindBackCatch(a.fromHand)).add(new THREE.Vector3(0, BallRadius * 1.02, 0)).applyMatrix4(toWorld);
      const offPalm = toV(behindBackOffArm(a.fromHand)).applyMatrix4(toWorld);
      // Braço livre à frente (proteção) e depois indo receber a bola.
      const otherTarget = offPalm.clone().lerp(catchPalm, w.to);
      this.reachPalm(other, otherTarget, Math.max(w.to, w.offArm), new THREE.Vector3(-s, -0.3, -0.8).transformDirection(toWorld));
    }
  }
}
