// Animação do jogador sem state machine pronta: duas camadas sobre o AnimationMixer do three.js.
//  - Base: loops de drible (parado, baixo, andando, correndo, de costas, de lado), escolhidos pela velocidade no
//    referencial do jogador. Trocas com crossfade e FASE CASADA (o empurrão do clipe novo cai onde estava o do antigo),
//    então o ritmo da bola nunca pula. A velocidade de reprodução acompanha a velocidade real (sem pé deslizando).
//  - Ação: dribles (crossover, escape, spin, entre as pernas, hesitação) e arremesso, por cima da base.
//  - Pós-processo: postura atlética (quadril baixo com IK das duas pernas, pés presos onde o clipe os pôs) e inclinação
//    do tronco na aceleração; giro da malha no spin (o clipe foi "des-girado").
// Os eventos de bola (soltura e recepção) saem das curvas medidas das palmas, não de tempos fixos.
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
import { solveTwoBoneIK } from './TwoBoneIK';

export const PlayerHeightMeters = 1.96;

/** O que o jogo informa ao animador a cada quadro. */
export interface AnimInput {
  /** Velocidade (m/s) no referencial do jogador: right = direita, forward = frente. */
  right: number;
  forward: number;
  /** Mão da bola para os loops (a mão que tem ou vai receber a bola). */
  ballHand: Hand;
  /** LT: drible baixo de proteção. */
  low: boolean;
  /** Aceleração (m/s²) no referencial do jogador, para a inclinação do tronco. */
  accelRight: number;
  accelForward: number;
}

/** Bola saindo da mão: o animador diz quando e para onde ela volta. */
export interface BallRelease {
  fromHand: Hand;
  toHand: Hand;
  /** Segundos até a recepção. */
  catchIn: number;
  /** Palma da mão que recebe, no instante da recepção, no espaço do modelo JÁ escalado (m). */
  catchModel: THREE.Vector3;
  /** Quique de movimento (crossover etc.): a bola corta mais rápido e mais baixo. */
  move: boolean;
}

interface BaseState {
  name: string; // clipe
  base: string; // "Dribble_Walk" etc.
}

type ActionKind = MoveKind | 'Shot';

interface ActiveAction {
  kind: ActionKind;
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
  /** Spin: sentido do giro da malha (+1 anti-horário visto de cima, -1 horário). */
  spinSign: number;
  /** Arremesso: segurar o quadro de follow-through até esta hora (s do relógio do animador). */
  holdUntil: number;
}

const BaseFade = 0.22; // s de crossfade entre loops
const ActionFadeIn = 0.09;
const ActionFadeOut = 0.2;
const MinStateTime = 0.18; // histerese: o loop não troca de novo antes disso

const v = new THREE.Vector3();
const q = new THREE.Quaternion();
const axis = new THREE.Vector3();

export class PlayerAnimator {
  readonly root = new THREE.Group(); // posição/yaw do jogador (o jogo controla)
  readonly model: THREE.Object3D;
  readonly scale: number;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly clips: Record<string, ClipInfo>;
  private readonly bones = new Map<string, THREE.Bone>();

  private base: BaseState = { name: 'Dribble_Idle_R', base: 'Dribble_Idle' };
  private baseSince = 0;
  private readonly baseWeights = new Map<string, number>();
  private active: ActiveAction | null = null;
  private actionWeight = 0;
  private clock = 0;
  private prevTimes = new Map<string, number>();

  private crouch = 0;
  private widen = 0;
  private leanForward = 0;
  private leanRight = 0;
  /** Giro extra da malha (rad) além do yaw do jogador: o spin. */
  yawOffset = 0;
  /** Soltura que aconteceu neste quadro (o jogo consome). */
  readonly releases: BallRelease[] = [];

  // Ajustes de postura (tunáveis no laboratório).
  stance = {
    crouchIdle: 0.13, // m que o quadril desce parado (no mundo, jogador de 1,96 m)
    crouchWalk: 0.11,
    crouchRun: 0.05,
    crouchLow: 0.05, // o clipe baixo já é baixo
    crouchMove: 0.1,
    widenIdle: 0.07, // m que cada pé abre para o lado parado (base larga do drible)
    widenWalk: 0.03,
    leanBaseDeg: 15, // inclinação do tronco para frente no drible (dividida entre spine_01 e spine_02)
    leanPerAccelDeg: 1.6, // por m/s²
    leanMaxDeg: 16,
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
    this.model.position.y = -box.min.y * this.scale;
    this.root.add(this.model);
    this.root.name = 'jogador';

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      const loop = clip.name.startsWith('Dribble_') || clip.name === 'Run' || clip.name === 'Walk';
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = true;
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      this.actions.set(clip.name, action);
      this.baseWeights.set(clip.name, 0);
    }
    this.baseWeights.set(this.base.name, 1);
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
    const t = MoveTimings[kind];
    const clip = moveClipFor(kind, fromHand);
    const rate = Math.min(2.2, Math.max(0.6, (t.end - t.start) / Math.max(0.05, duration)));
    // Spin_R2L gira no sentido horário visto de cima (HoopsDummyRig.h); no three, horário = yaw diminuindo.
    const spinSign = kind === 'Spin' ? (fromHand === 'r' ? -1 : 1) : 0;
    this.startAction({
      kind,
      clip,
      start: t.start,
      end: t.end,
      release: t.release,
      catch: t.catch,
      fromHand,
      toHand: t.switchesHand ? otherSide(fromHand) : fromHand,
      rate,
      spinSign,
      holdUntil: 0,
    });
  }

  /** Arremesso: começa no dip e acerta a soltura do clipe no tempo ideal (centro do green). */
  playShot(hand: Hand, idealSeconds: number): void {
    const t = JumpShotTiming;
    const clip = hand === 'r' ? t.clip : t.clip.replace(/_R$/, '_L');
    const rate = (t.release - t.dip) / Math.max(0.2, idealSeconds);
    this.startAction({
      kind: 'Shot',
      clip,
      start: t.dip,
      end: t.end,
      release: t.release,
      catch: Infinity,
      fromHand: hand,
      toHand: hand,
      rate,
      spinSign: 0,
      holdUntil: 0,
    });
  }

  /** Segura o follow-through (green) por alguns segundos antes de terminar o arremesso. */
  holdFollowThrough(seconds: number): void {
    if (this.active?.kind === 'Shot') this.active.holdUntil = this.clock + seconds;
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
    if (spec.kind !== 'Shot') this.actionWeight = Math.max(this.actionWeight, 0.35);
  }

  // ------------------------------------------------------------------------------------------- quadro

  update(dt: number, input: AnimInput): void {
    this.clock += dt;
    this.releases.length = 0;
    this.chooseBase(input);
    this.updateAction();
    this.updateWeights(dt);

    // Avança o mixer guardando os tempos anteriores para detectar eventos.
    for (const [name, action] of this.actions) {
      if (action.getEffectiveWeight() > 0 || name === this.base.name || this.active?.clip === name) {
        this.prevTimes.set(name, action.time);
      }
    }
    this.mixer.update(dt);
    this.model.rotation.y = this.yawOffset;
    this.detectEvents();

    this.root.updateMatrixWorld(true);
    this.applyStance(dt, input);
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
    if (speed < 0.35) {
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

    const handChanged = !this.base.name.endsWith(hand.toUpperCase()) && base !== 'Dribble_Side';
    if (clipName !== this.base.name && (this.clock - this.baseSince >= MinStateTime || handChanged)) {
      this.switchBase({ name: clipName, base }, hand);
    }

    // Velocidade de reprodução acompanha a velocidade real (a escala do modelo muda a passada).
    const action = this.actions.get(this.base.name);
    if (action) {
      const native = LoopNativeVelocity[this.base.name] ?? LoopNativeVelocity[this.base.base];
      const nativeSpeed = native ? Math.hypot(native.right, native.forward) * this.scale : 0;
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
    if (from && fromInfo && toInfo) {
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
    if (this.baseWeights.get(next.name)! < 0.01) {
      to.time = time;
      this.prevTimes.set(next.name, time);
    }
    this.base = next;
    this.baseSince = this.clock;
  }

  private updateAction(): void {
    const a = this.active;
    if (!a) return;
    if (a.kind === 'Shot' && a.holdUntil > this.clock && a.action.time >= JumpShotTiming.followThrough) {
      a.action.timeScale = 0; // segura o follow-through
    } else if (a.kind === 'Shot' && a.action.timeScale === 0) {
      a.action.timeScale = 1;
    }
    if (!a.fadingOut && a.action.time >= a.end - 1e-3) {
      a.fadingOut = true;
    }
    if (a.kind === 'Spin') {
      const span = a.end - a.start;
      const alpha = (a.action.time - a.start) / span;
      this.yawOffset = a.spinSign * 2 * Math.PI * spinTurnAlpha(alpha);
    }
    if (a.fadingOut && this.actionWeight <= 0.001) {
      a.action.setEffectiveWeight(0);
      this.active = null;
      this.yawOffset = 0;
    }
  }

  private updateWeights(dt: number): void {
    // Camada de ação.
    const a = this.active;
    const target = a && !a.fadingOut ? 1 : 0;
    const speed = 1 / (target > this.actionWeight ? ActionFadeIn : ActionFadeOut);
    this.actionWeight += Math.sign(target - this.actionWeight) * Math.min(Math.abs(target - this.actionWeight), speed * dt);

    // Base: o loop atual sobe, os outros descem.
    let total = 0;
    for (const [name, w] of this.baseWeights) {
      const goal = name === this.base.name ? 1 : 0;
      const nw = w + Math.sign(goal - w) * Math.min(Math.abs(goal - w), dt / BaseFade);
      this.baseWeights.set(name, nw);
      total += nw;
    }
    const baseShare = 1 - this.actionWeight;
    for (const [name, action] of this.actions) {
      if (a && name === a.clip) continue;
      const w = this.baseWeights.get(name) ?? 0;
      action.setEffectiveWeight(total > 0 ? (w / total) * baseShare : 0);
    }
    if (a) a.action.setEffectiveWeight(this.actionWeight);
  }

  /** Soltura da bola: vale da palma no loop dominante, ou o quadro de soltura da ação. */
  private detectEvents(): void {
    const a = this.active;
    if (a && !a.fadingOut) {
      const prev = this.prevTimes.get(a.clip) ?? a.action.time;
      if (!a.released && a.kind !== 'Shot' && prev < a.release && a.action.time >= a.release) {
        a.released = true;
        const info = this.clips[a.clip];
        const catchFrame = Math.min(info.frames - 1, Math.round(a.catch * ClipFps));
        const palm = (a.toHand === 'r' ? info.palm_r : info.palm_l)[catchFrame];
        this.releases.push({
          fromHand: a.fromHand,
          toHand: a.toHand,
          catchIn: (a.catch - a.release) / a.rate,
          catchModel: new THREE.Vector3(...palm).multiplyScalar(this.scale),
          move: true,
        });
      }
      return; // durante a ação, a base não solta a bola
    }
    if (this.actionWeight > 0.5) return;

    const action = this.actions.get(this.base.name);
    const info = this.clips[this.base.name];
    if (!action || !info) return;
    const hand: Hand = this.base.name.endsWith('_L') ? 'l' : 'r';
    const n = info.frames - 1;
    const prev = (this.prevTimes.get(this.base.name) ?? action.time) * ClipFps;
    const now = action.time * ClipFps;
    const valleys = hand === 'r' ? info.valleys_r : info.valleys_l;
    for (const frame of crossedFrames(valleys, prev, now, n)) {
      const toPeak = framesToNextPeak(info, hand, frame);
      if (toPeak === null) continue;
      const peakFrame = (frame + toPeak) % n;
      const palm = (hand === 'r' ? info.palm_r : info.palm_l)[Math.round(peakFrame)];
      this.releases.push({
        fromHand: hand,
        toHand: hand,
        catchIn: toPeak / ClipFps / Math.max(0.3, action.timeScale),
        catchModel: new THREE.Vector3(...palm).multiplyScalar(this.scale),
        move: false,
      });
    }
  }

  // ------------------------------------------------------------------------------------------- postura

  private applyStance(dt: number, input: AnimInput): void {
    const s = this.stance;
    const speed = this.speedOf(input);
    const kind = this.actionKind();
    let crouchTarget: number;
    if (kind === 'Shot') crouchTarget = 0;
    else if (kind) crouchTarget = s.crouchMove;
    else if (this.base.base === 'Dribble_Low') crouchTarget = s.crouchLow;
    else if (this.base.base === 'Dribble_Run') crouchTarget = s.crouchRun;
    else if (speed > 0.35) crouchTarget = s.crouchWalk;
    else crouchTarget = s.crouchIdle;
    const k = 1 - Math.exp(-8 * dt);
    this.crouch += (crouchTarget - this.crouch) * k;

    const shooting = kind === 'Shot';
    const leanF = shooting
      ? 0
      : Math.min(s.leanMaxDeg, Math.max(-s.leanMaxDeg, s.leanBaseDeg + input.accelForward * s.leanPerAccelDeg));
    const leanR = shooting ? 0 : Math.min(s.leanMaxDeg, Math.max(-s.leanMaxDeg, input.accelRight * s.leanPerAccelDeg));
    const kl = 1 - Math.exp(-6 * dt);
    this.leanForward += (leanF - this.leanForward) * kl;
    this.leanRight += (leanR - this.leanRight) * kl;

    // 1) Onde o clipe pôs os tornozelos e os pés (mundo).
    const footL = this.bone('foot_l');
    const footR = this.bone('foot_r');
    const ankleL = footL.getWorldPosition(new THREE.Vector3());
    const ankleR = footR.getWorldPosition(new THREE.Vector3());
    const footQL = footL.getWorldQuaternion(new THREE.Quaternion());
    const footQR = footR.getWorldQuaternion(new THREE.Quaternion());

    // 2) Abaixa o quadril (no espaço do pai da pelve, que tem a escala do modelo).
    const pelvis = this.bone('pelvis');
    if (this.crouch > 1e-4) {
      const parent = pelvis.parent!;
      const worldDown = new THREE.Vector3(0, -this.crouch, 0);
      const parentQ = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      const parentS = parent.getWorldScale(new THREE.Vector3());
      worldDown.applyQuaternion(parentQ).divide(parentS);
      pelvis.position.add(worldDown);
      pelvis.updateWorldMatrix(true, true);

      // 3) IK das pernas: tornozelos de volta onde estavam (abertos para os lados na base larga); joelho segue o
      // plano do clipe.
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
      const leftDir = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
      const widenTarget = kind ? 0 : this.base.base === 'Dribble_Idle' || this.base.base === 'Dribble_Low' ? s.widenIdle : this.base.base === 'Dribble_Walk' || this.base.base === 'Dribble_Back' ? s.widenWalk : 0;
      this.widen += (widenTarget - this.widen) * k;
      ankleL.addScaledVector(leftDir, this.widen);
      ankleR.addScaledVector(leftDir, -this.widen);
      solveTwoBoneIK(this.bone('thigh_l'), this.bone('calf_l'), footL, ankleL, forward);
      solveTwoBoneIK(this.bone('thigh_r'), this.bone('calf_r'), footR, ankleR, forward);
      // Pé com a mesma orientação do clipe (sola no chão).
      for (const [foot, worldQ] of [
        [footL, footQL],
        [footR, footQR],
      ] as const) {
        const parentWorld = foot.parent!.getWorldQuaternion(new THREE.Quaternion());
        foot.quaternion.copy(parentWorld.invert().multiply(worldQ));
        foot.updateWorldMatrix(false, true);
      }
    }

    // 4) Inclinação do tronco: metade em spine_01, metade em spine_02 (as costas curvam, não dobram num ponto só).
    // +X do modelo = esquerda: girar em torno dele leva o "cima" para a frente (+Z). Em torno da frente (+Z), o
    // "cima" vai para -X = direita do modelo.
    const left = axis.set(1, 0, 0).applyQuaternion(this.root.quaternion);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    const lean = new THREE.Quaternion()
      .setFromAxisAngle(left, THREE.MathUtils.degToRad(this.leanForward * 0.5))
      .multiply(q.setFromAxisAngle(fwd, THREE.MathUtils.degToRad(this.leanRight * 0.5)));
    for (const name of ['spine_01', 'spine_02']) {
      const spine = this.bone(name);
      const spineWorld = spine.getWorldQuaternion(new THREE.Quaternion());
      spine.quaternion.multiply(spineWorld.clone().invert().multiply(lean).multiply(spineWorld));
      spine.updateWorldMatrix(false, true);
    }

    // A pelve e os ossos voltam para a pose do clipe no próximo quadro (o mixer sobrescreve): nada acumula.
  }
}
