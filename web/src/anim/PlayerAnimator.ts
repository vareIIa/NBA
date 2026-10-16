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
  LoopNativeVelocity,
  type MoveKind,
  type MoveTiming,
  MoveTimings,
  contactFrames,
  crossedFrames,
  dribbleHandShape,
  handDwellFor,
  dribblePhase,
  frameAtPhase,
  framesToNext,
  loopClip,
  moveClipFor,
  otherSide,
  spinTurnAlpha,
} from './ClipLibrary';
import { type JumpShotSetup, defaultSetup, formOf } from '../shot/JumpShotSetup';
import { JumpShotMotion, type ShotCarry } from './JumpShotMotion';
import { pullUpForm } from '../shot/ShotForms';
import { IdleLife } from './IdleLife';
import { ArmClearance } from './ArmClearance';
import {
  BallRadius,
  BehindBack,
  PlayerHeightMeters,
  ProceduralScale,
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
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MixamoLocomotion } from '../mocap/MixamoLocomotion';
import { type MixamoFile, retargetMixamo } from '../mocap/Retarget';
import { smoothClip } from './ClipFilter';
import {
  type MovePhase,
  SplitStance,
  WeightShift,
  WeightShiftTuning,
  scissorSeconds,
  scissorStep,
  splitFoot,
  splitFrontFoot,
  weightTarget,
} from './DribbleFootwork';
import { Inertializer } from './Inertialization';
import { applyPole, solveTwoBoneIK } from './TwoBoneIK';
import { LayupMotion } from './LayupMotion';
import type { LayupPlan } from '../sim/HoopsLayup';
import type { HoldPose } from '../sim/HoopsHold';

export { PlayerHeightMeters };

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
  /** Velocidade vertical da mão na recepção (m/s, + = subindo), se conhecida: o quique casa a chegada da bola com ela. */
  catchSpeedY?: number;
}

interface BaseState {
  name: string; // clipe
  base: string; // "Dribble_Walk" etc.
}

type ActionKind = MoveKind | 'Shot' | 'Celebrate';

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
}

// Transições por inertialization (dead blending): o clipe novo entra com peso total e só a diferença de pose some.
const BaseBlend = 0.22; // troca de loop
const ActionInBlend = 0.12; // entrada de um drible (resposta imediata ao comando)
const FinishInBlend = 0.3; // entrada da bandeja e da enterrada: o pulo parte de quem vinha correndo, sem salto de perna
const ActionOutBlend = 0.24; // volta para a base
const MinStateTime = 0.16; // histerese: o loop não troca de novo antes disso
const ClipGroundOffset = 0.028;
/**
 * Contato mão-bola nos loops (contactFrames): a bola sai da mão na metade da descida da palma (a mão ainda empurrando) e é
 * recebida a 65% da subida (a mão indo ao encontro dela e subindo junto até o alto, onde vira e empurra de novo).
 */
const DribbleContact = { release: 0.5, catch: 0.65 };
/**
 * Correndo o quique é rápido (~3/s): com o contato do parado a bola ficava 0,17 s no ar para ir ao chão e voltar 60 cm,
 * subia a ~9 m/s e a mão a recebia a 2 m/s (salto de 13 cm). A mão solta mais cedo (alto na descida) e recebe mais tarde.
 */
const DribbleContactRun = { release: 0.8, catch: 0.9 };
/**
 * Ida e volta da mão para a frente (m) num quique, por loop: a mão desce indo um pouco para a frente (empurra a bola
 * adiante) e volta subindo. A mão do mocap da CMU andava 22–44 cm para a frente e para trás (drible alto e solto); com o
 * IK acertando o alvo, isso virava estalo no antebraço.
 */
const DribbleSwing: Record<string, number> = { Dribble_Run: 0.18, Dribble_Walk: 0.12, Dribble_Back: 0.08, Dribble_Side: 0.05, Dribble_Low: 0.05 };
const DribbleSwingDefault = 0.06;
/** s para o alvo da mão da bola passar de um loop para o outro (sem salto na troca de andando para correndo). */
const DribbleRetarget = 0.2;
/** s para a mão da bola ir da pose do fim de um drible (crossover, entre as pernas...) para o caminho do loop. */
const DribbleMoveExit = 0.25;
/** Parado sem bola: clipe do Mixamo retargetado no carregamento (ver o construtor). */
const FreeIdleClip = 'Idle_Free';
const NoBallLoops = new Set(['Hold_Idle', FreeIdleClip, 'Walk', 'Run']);
// Drible em movimento (referência real: Kyrie em câmera lenta, LZSlFyyCkhk 9,0–10,9 s): as pernas não param; a cada
// quique um pé apoia e o outro passa, e só o tronco e os braços fazem o drible. Os clipes de drible da CMU foram
// gravados parados, então em movimento as pernas e a pelve vêm do loop de locomoção (camada por osso).
const LegLayerBones = ['pelvis', 'hip_l', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'hip_r', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'];
/** Ossos que a locomoção do Mixamo escreve (a pelve também na posição). */
const MixamoLegBones = ['pelvis', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];
/** m/s: abaixo, as pernas do loop parado (base plantada do size-up); acima, as do Mixamo. */
const MixamoLegSpeed = [0.15, 0.6];
const MixamoLegRate = 8; // 1/s
/**
 * Fração do sobe-e-desce do quadril da corrida do Mixamo que fica. O clipe oscila 10–12 cm (0,95–1,08 m no sprint): o
 * jogador quicava como uma gazela (diretor, 2026-10-16). Corredor oscila ~5–8 cm e o jogador de basquete corre mais baixo
 * e liso. Medido no laboratório (sprint, oscilação sem a tendência): 13,6 cm com 1; 9,1 com 0,55; ~8,5 com 0,4. O resto
 * vem da pose depois (agachamento e IK das pernas). Os tornozelos ficam onde o clipe os pôs (as pernas dobram mais).
 */
const MixamoBounceKeep = 0.4;
/** Constante de tempo (s) da altura média do quadril, em volta da qual a oscilação é reduzida. */
const MixamoBounceTau = 0.45;
/** |frente| / velocidade: abaixo do primeiro (de lado) só CMU; acima do segundo (frente/trás) só Mixamo. */
const MixamoAlong = [0.45, 0.75];
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
const BallLegHandRate = 25; // 1/s (com 12 a mão ficava para trás e a bola se soltava dela para sair da perna)
// Entre as pernas (Kyrie, LZSlFyyCkhk 164,0–165,2 s, de costas): a mão empurra a bola por fora do joelho, ela quica UMA
// vez no chão entre os pés (164,7–164,8 s) e a outra mão recebe baixo, por fora do joelho do outro lado (165,1 s). O
// clipe da CMU quicava 66 cm à frente dos pés e recebia na frente do corpo (era um crossover baixo).
// A recepção é a do caminho do drible da mão nova (crossCatch), à frente da ponta do pé.
/**
 * Dribles em que a mão que recebe vai buscar a bola por IK num ponto desenhado (não o da mão do clipe da CMU): entre as
 * pernas e os crossovers. No crossover a recepção é a do loop da mão nova e o quique cai à frente dos joelhos (o do
 * clipe caía entre os pés e a bola subia batendo no joelho de dentro).
 */
const TweenMoves = new Set<string>(['BetweenLegs', 'Cross', 'EscapeCross']);
const CrossFloorAhead = 0.16; // m à frente da mão mais adiantada (soltura ou recepção)
const BetweenLegsFloorAhead = 0.08; // m à frente do meio dos pés: o quique do entre as pernas/** Velocidade máxima do loop de corrida da CMU quando as pernas são do Mixamo (o ritmo do drible no sprint). */
const DribbleRunMaxRate = 1.1;
const HandHoldRate = 18;
/** Fração de smoothstep na curva de giro do spin (o resto é a curva medida no mocap). */
const SpinYawSmooth = 0.6; // 1/s: a mão que sai de um IK no começo de um drible passa para o clipe (~0,15 s)
/** s (do clipe, na velocidade 1) depois da recepção em que o crossover e o entre as pernas acabam. */
const MoveExitAfterCatch = 0.06;
const smoothMax = (x: number, min: number, soft: number) => (x + min + Math.sqrt((x - min) * (x - min) + soft * soft)) / 2;
// Escape (RT + o mesmo comando do size-up; GIF de "escape moves" do 2K24 no game8): o corpo sai uns 0,5–1 m para o lado
// da mão nova e os pés acompanham em passos (o da frente abre, o de trás vem atrás), sem deslizar.
const EscapeMoves = new Set<string>([...SizeUpMoves, 'EscapeCross']);
// lead: quanto à frente (s) o passo mira; o corpo segue andando enquanto o outro pé vem, então o pé da frente abre mais.
const SpinFreeHand = { outside: 0.3, forward: 0.35, height: 0.22 }; // m: palma do braço livre no spin (corpo)
const HalfSpinBall = { release: 0.3, catch: 0.85 }; // frações do half spin (o giro vira em 0,5)
const EscapeStep = { threshold: 0.12, seconds: 0.14, lead: 0.18 };
// Comemorações depois da cesta, em ciclo.
/** Soft IK do braço: freia nos últimos 8% do alcance (mão baixa no drible estica o braço quase todo). */
const ArmSoftReach = 0.08;
/** Soft IK da perna: só os últimos 3% (o pé pode ficar alguns mm aquém do alvo com a perna quase esticada). */
const LegSoftReach = 0.03;
/** Joelho para fora (proporção da esquerda do corpo somada à frente) e peso andando (na base plantada é 1). */
const KneeOut = { outward: 0.45, moving: 0.3 };
/** Size-up: distância (m) entre o pé pregado e onde ele deveria estar a partir da qual ele dá um passo. */
const HoldStepLimit = 0.38;
/** m: meia base (do centro do corpo ao tornozelo) permitida nos passos do size-up. */
const SizeUpHalfBase = [0.15, 0.42];
/** Braço de guarda (palma em relação à pelve, no referencial do corpo, m) e quanto ele manda sobre o clipe. */
const GuardArm = { outside: 0.2, up: 0.08, forward: 0.3, loopWeight: 0.55, moveWeight: 0.85, rate: 9 };
/** Distância lateral mínima entre os tornozelos (m): andando, os pés passam um pelo outro a ~10 cm, sem cruzar. */
const FeetMinGap = 0.1;
/**
 * Pé plano no apoio (flattenFoot): sola até FlatSoleMax (x escala) do chão conta como apoio. O calcanhar que sobe mais de
 * FlatPushOffRate (m/s) no fim do passo (saída da corrida) não é corrigido: ali a ponta fica e o calcanhar sobe.
 * O peso entra/sai em FlatInRate/FlatOutRate (1/s).
 */
const FlatSoleMax = 0.03;
const FlatInRate = 10;
const FlatOutRate = 8;
const FlatSlipOutRate = 30; // 1/s: saída quando o pé desliza
const FlatPushOffRate = 0.6;
const FlatMaxSpeed = 2.5; // m/s: o tornozelo do clipe mais devagar que isso (no chão) para o pé ser apoio
const FlatPivotBand = 0.06; // m: altura da ponta (ball_*) em que o pivô passa do tornozelo para a própria ponta
const FlatLateralMin = 0.4; // m/s: abaixo disso o pé não tem direção (parado)
const FlatLateralRatio = 1.5; // pé que anda de lado (velocidade lateral > 1,5x a da frente) não vira apoio plano
const FlatReach = 0.99; // fração do alcance da perna que o tornozelo pode usar
const FlatDropMax = 0.08; // m: o quadril desce no máximo isso para o pé plano alcançar o chão
const FlatDropRate = 25; // 1/s: a descida do quadril acompanha a perna que chega no limite (sem degrau)

const CelebrateClips = ['Celebrate_ArmsUp', 'Celebrate_Bow', 'Celebrate_Flex', 'Celebrate_HighFive'];
/** Comemorações que mantêm as pernas do próprio clipe (vazio: todas usam pernas livres da locomoção). */
const CelebrateKeepsLegs = new Set<string>();
/**
 * Jump shot: o corpo é desenhado pela forma do arremesso (JumpShotMotion); o clipe só segura os dedos na bola, parado
 * neste tempo (s) do JumpShot2 até o fim, quando vai para ShotClipEnd e a ação fecha.
 */
const ShotClipHold = 0.5;
const ShotClipEnd = 0.51;
/** Depois do pouso, andando acima disto (m/s), o jump shot acaba e a locomoção assume. */
const ShotMoveExitSpeed = 0.6;
const ShotMoveExitAfterLand = 0.05;
/** Saída desenhada do jump shot (s): no fim normal e quando outra ação corta o arremesso (pump fake). */
const ShotExitSeconds = 0.28;
const ShotInterruptExitSeconds = 0.16;

/** Velocidade do clipe de um drible: o miolo (start..end) cabe na duração do núcleo. */
const moveRate = (t: MoveTiming, duration: number): number => Math.min(2.4, Math.max(0.6, (t.end - t.start) / Math.max(0.05, duration)));
/**
 * Drible que começou com a bola ainda subindo para a mão (o corpo responde ao comando na hora): o clipe para logo antes
 * da soltura e espera a bola chegar, no máximo isto (s). O empurrão nunca sai de uma mão vazia.
 */
const MoveBallWaitMax = 0.15;
/** s de folga: o spin e os procedurais não esperam (o giro congelaria; a bola pularia para o caminho desenhado). */
const MoveBallMargin = 0.03;
const ProceduralBallLead = 0.04;
/** 1/s: a mão da bola entra no IK que vai buscar a bola ainda no ar (drible que começou antes da recepção). */
const BallReachRate = 20;

const v = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q = new THREE.Quaternion();
const axis = new THREE.Vector3();
// Pontos-chave dos procedurais: medidos a 1,96 m, escalados para a altura atual.
const toV = (p: V3, out = new THREE.Vector3()): THREE.Vector3 => out.set(p[0], p[1], p[2]).multiplyScalar(ProceduralScale);

export class PlayerAnimator {
  readonly root = new THREE.Group(); // posição/yaw do jogador (o jogo controla)
  readonly model: THREE.Object3D;
  readonly scale: number;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly clips: Record<string, ClipInfo>;
  private readonly bones = new Map<string, THREE.Bone>();
  /** Alvo da mão da bola no quadro anterior e o desvio que some depois de uma troca de loop. */
  private readonly dribbleTarget = { clip: '', last: new THREE.Vector3(), offset: new THREE.Vector3(), t: Infinity, duration: DribbleRetarget };
  /** Havia um drible no quadro anterior (para a mão da bola sair dele para o loop sem salto). */
  private hadMove = false;
  /** Palma de cada mão como foi desenhada no fim do quadro anterior (referencial do jogador). */
  private readonly lastPalmLocal = { l: new THREE.Vector3(), r: new THREE.Vector3() };
  /** O mesmo no referencial da malha (gira com o spin): a mão segurada pelo handHold gira junto com o corpo. */
  private readonly lastPalmModel = { l: new THREE.Vector3(), r: new THREE.Vector3() };
  private dribbleExit = false;
  /** Ponto médio da palma da mão da bola em cada loop de drible (referencial do jogador, sem o pós-processo). */
  private readonly loopPalmMean = new Map<string, THREE.Vector3>();
  /** Soltura e recepção (quadros) de cada loop de drible, na mão da bola do loop (contactFrames). */
  private readonly loopContact = new Map<string, { release: number[]; catch: number[] }>();
  /** O mesmo com a curva simétrica da mão (handDwellEnabled = false, A/B do laboratório). */
  private readonly loopContactSym = new Map<string, { release: number[]; catch: number[] }>();
  /** Dwell da mão no alto do quique (ClipLibrary.HandDwell). Chave de A/B do laboratório. */
  handDwellEnabled = true;

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
  /** Corpo do jump shot pela forma do criador de arremesso. */
  private jumpShot!: JumpShotMotion;
  /** Vida do parado sem bola (braços soltos, respiração e gestos). */
  private idleLife!: IdleLife;
  /** Braços fora do tronco e da roupa (último passo dos braços). */
  private armClearance!: ArmClearance;
  armClearanceEnabled = true;

  private crouch = 0;
  private hinge = 0;
  private widen = 0;
  /** Trava de pé: enquanto o pé está apoiado na animação, ele fica preso no chão (mundo) e não patina. */
  private readonly footLock = {
    l: { locked: false, pos: new THREE.Vector3(), prevAnim: new THREE.Vector3(), release: new THREE.Vector3(), releaseT: 1, land: new THREE.Vector3(), prevToe: 1 },
    r: { locked: false, pos: new THREE.Vector3(), prevAnim: new THREE.Vector3(), release: new THREE.Vector3(), releaseT: 1, land: new THREE.Vector3(), prevToe: 1 },
  };
  footLockEnabled = true;
  /**
   * Pé de apoio plano (flattenFoot). Chave de A/B do laboratório (LAB_ANIM='{"flatFootEnabled":false}') e do jogo
   * (?pe=clipe volta o pé para a orientação do clipe, como antes).
   */
  flatFootEnabled = typeof location === 'undefined' || new URLSearchParams(location.search).get('pe') !== 'clipe';
  legLayerEnabled = true;
  /**
   * Dribles que, em movimento, ficam com as pernas da locomoção (camada por osso; o tronco e os braços são do drible). O
   * por trás usa o tronco do escape crossover, que dá um passo lateral: correndo, as pernas paravam e iam para o lado
   * (corre_por_tras: SALTOS 46 -> 35, bola no corpo 13 -> 5 quadros). A hesitação ficou de fora: com as pernas da corrida
   * no escape (corre_hesi_arranca) as pernas cruzavam 40 quadros (13 com as do clipe).
   * Lista (não Set) para o laboratório trocar por LAB_ANIM.
   */
  legLayerMoves: string[] = ['Cross', 'EscapeCross', 'BetweenLegs', 'BehindBack'];
  ballClearanceEnabled = true;
  lowDribbleEnabled = true;
  guardArmEnabled = true;
  kneeOutEnabled = true;
  /**
   * Base plantada do size-up (parado com a bola, drible normal ou baixo): os dois pés pregados no chão, abertos e retos;
   * o ritmo fica no joelho e no quadril. Se o corpo gira ou anda além da base, o pé dá um passinho para a nova posição.
   */
  private readonly plant = {
    active: false,
    // dur/lift: passo da tesoura (DribbleFootwork), com duração e altura próprias; 0 = passinho de ajuste normal.
    l: { pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 0, lift: 0 },
    r: { pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 0, lift: 0 },
  };
  /**
   * Footwork do drible (DribbleFootwork): base escalonada do entre as pernas, tesoura nos combos e transferência de
   * peso. Chave de A/B do laboratório (LAB_ANIM='{"footworkEnabled":false}').
   */
  footworkEnabled = true;
  /** Pé da frente da base escalonada (null = pés lado a lado). Vale enquanto a base plantada vale. */
  private readonly stagger = { front: null as Hand | null };
  /** Drible que já disparou a tesoura (uma vez por entre as pernas). */
  private scissorAction: ActiveAction | null = null;
  private readonly weight = new WeightShift();
  /** Ajustes do footwork (os mesmos objetos do DribbleFootwork), para o laboratório e a sonda mexerem ao vivo. */
  readonly footworkTuning = { split: SplitStance, weight: WeightShiftTuning };
  private restFootLocal = { l: new THREE.Quaternion(), r: new THREE.Quaternion() };
  private restAnkleY = 0.1;
  /** Pontos da sola do tênis (vértices mais baixos da malha no bind pose), no espaço do osso do pé ou da ponta. */
  private readonly solePoints: Record<Hand, { bone: THREE.Bone; local: THREE.Vector3 }[]> = { l: [], r: [] };
  /** Todos os pontos da sola (sem amostragem), para a altura do pé plano (lowestSole): a amostra esparsa perdia a ponta mais baixa (2,5 cm). */
  private readonly soleDense: Record<Hand, { bone: THREE.Bone; local: THREE.Vector3 }[]> = { l: [], r: [] };
  private leanForward = 0;
  private leanRight = 0;
  /** Peso do IK do drible baixo por mão: cada braço entra e sai sozinho (a mão da bola troca no meio do crossover). */
  private readonly dribbleArmWeight = { l: 0, r: 0 };
  private restArmWeight = 0;
  /** Comemoração pedida (cesta) que espera o arremesso acabar, para não cortar o follow-through. */
  private celebrationQueued = false;
  private celebrateIndex = 0;
  /** Giro extra da malha (rad) além do yaw do jogador: spin / half spin. */
  yawOffset = 0;
  /** Soltura que aconteceu neste quadro (o jogo consome). */
  readonly releases: BallRelease[] = [];
  /** O jogo diz a cada quadro se a bola está presa à mão (BallDribbler 'held') ou no ar, e onde ela está (mundo). */
  ballInHand = true;
  readonly ballWorld = new THREE.Vector3();
  /** Mão da bola indo buscar a bola que ainda sobe (applyReachForBall). */
  private readonly ballReach = { hand: 'r' as Hand, w: 0 };
  /** s que o drible ativo já esperou a bola parado antes da soltura (holdMoveForBall). */
  private moveBallWait = 0;
  /** Centro da bola (referencial do jogador) quando um drible procedural a carrega; null = presa à palma. */
  ballHeldLocal: THREE.Vector3 | null = null;

  // Ajustes de postura (tunáveis no laboratório). Metros no mundo (jogador de 1,96 m) e graus.
  stance = {
    // Quanto o quadril desce parado. Era 0,34 com a base a 0,24: o diretor viu um agachamento de sumô (2026-10-15). A base
    // atlética do drible é pouco agachamento + quadril para trás + tronco inclinado (hinge*, abaixo).
    crouchIdle: 0.17,
    crouchWalk: 0.1,
    crouchRun: 0.12, // Kyrie infiltrando: joelhos bem dobrados (NSiPz8Kvuqw 14,8–16,4 s; GHJRCzlht7k 9–12 s)
    crouchLow: 0.08, // o clipe baixo já é baixo
    crouchProcedural: 0.14, // behind the back / step-back (o tronco vem de um clipe mais alto)
    // Spin baixo (Kyrie x Spurs, NSiPz8Kvuqw 15,0–16,2 s): quadril a ~40% da altura, tronco quase horizontal (~70° da
    // vertical), cabeça na altura do quadril e bola abaixo do joelho. O clipe da CMU gira quase em pé.
    // m ABAIXO da base parada (a altura média do clipe do spin é descontada, como nos outros dribles): com 0,22 em cima
    // do clipe, que já é 10 cm mais baixo, o jogador sentava de cócoras no começo do giro.
    crouchSpin: 0.08,
    leanSpinDeg: 28,
    // m que cada pé abre para o lado parado: tornozelos a ~0,62 m (1,5x a largura dos ombros; Harden no 2K23 a 47,7 s,
    // Kyrie a 44,3 s com ~0,8 m). O clipe deixa os tornozelos a 0,34 m.
    widenIdle: 0.17,
    widenWalk: 0.03,
    leanBaseDeg: 8, // inclinação da coluna no drible (dividida entre spine_01 e spine_02), além da dobra do quadril
    // Dobra do quadril (pelve gira para a frente e vai para trás): peito por cima dos joelhos, canela mais vertical.
    // Parado com a bola ~28° (Harden no 2K23 a 47,7 s; Kyrie GHJRCzlht7k 0–5 s), andando/driblando menos.
    hingeIdleDeg: 28,
    hingeMoveDeg: 14,
    hingeBack: 0.09, // m que o quadril vai para trás com a dobra inteira de parado
    // +2,5° por m/s, até 30°: o clipe de corrida já inclina o tronco. Com 5°/m/s e 44° (mais a dobra do quadril e a
    // aceleração) o tronco chegava a ~60° no sprint, o ombro descia a 1,1 m e a bola na cintura ficava na altura do peito.
    leanPerSpeedDeg: 2.5,
    leanPerAccelDeg: 1.4, // por m/s²
    leanMaxDeg: 30,
    headUpShare: 0.65, // o pescoço e a cabeça desfazem esta fração da inclinação: olhos na quadra, não na bola
    // Faixa da palma da mão da bola nos loops (m, do ponto mais baixo ao mais alto do ciclo). Com a soltura na metade da
    // descida e a recepção a 65% da subida (DribbleContact), a bola sai a ~36% e é recebida a ~38% da altura: o drible
    // baixo de jogador bom (Hirata et al., 2011: 32,5% e 40,3%). A mão anda ~20 cm: empurra a bola de verdade (com 4 cm a
    // bola "caía" de uma mão parada). Correndo a bola sobe mais (cintura); no LT (proteção) fica no joelho.
    // Embaixo o braço não chega a esticar (com 0,355 ia a 97% do alcance e o cotovelo tremia no fim do empurrão).
    palmBottom: 0.37 * PlayerHeightMeters,
    palmTop: 0.48 * PlayerHeightMeters,
    palmBottomRun: 0.42 * PlayerHeightMeters,
    palmTopRun: 0.54 * PlayerHeightMeters,
    palmBottomLow: 0.25 * PlayerHeightMeters,
    palmTopLow: 0.36 * PlayerHeightMeters,
    // Bola à frente da ponta do pé da mão da bola (Kyrie, GHJRCzlht7k 0–5 s; Harden no 2K23 47,7 s), não ao lado do
    // quadril: com 7 cm à frente a mão ficava perto do ombro e o cotovelo subia "em asa".
    dribbleOutward: 0.05, // m
    dribbleForward: 0.2, // m
    /** s para a mão da bola ir da pose do fim de um drible (crossover, entre as pernas...) para o caminho do loop. */
    moveExit: DribbleMoveExit,
  };

  private constructor(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, clipsFile: ClipsFile, mixamoFile: MixamoFile | null = null) {
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
    if (mixamoFile) this.setupMixamo(mixamoFile);
    this.root.name = 'jogador';

    this.mixer = new THREE.AnimationMixer(this.model);
    // Tira o tremor do mocap antes de tocar (?filtro=0 desliga, para comparar no laboratório).
    const filter = typeof location === 'undefined' || new URLSearchParams(location.search).get('filtro') !== '0';
    for (const clip of gltf.animations) {
      const loop = clip.name.startsWith('Dribble_') || NoBallLoops.has(clip.name);
      if (filter) smoothClip(clip, loop, 2, (t) => /^(pelvis|thigh|calf)_?/.test(t) || t.endsWith('.position'));
      const action = this.mixer.clipAction(clip);
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = true;
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      this.actions.set(clip.name, action);
      this.baseWeights.set(clip.name, 0);
    }
    // Parado sem bola: o IdleStand do Mixamo (corpo inteiro, ~8 s, respiração e troca de peso; ?idle=Idle compara com o
    // outro). O Hold_Idle da CMU é alguém segurando uma bola num loop de 0,8 s: repetido, o corpo "girava", o braço direito
    // ficava erguido e os pés na ponta. Sem o arquivo do Mixamo (?loco=cmu) continua o Hold_Idle.
    const idleName = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('idle')) || 'IdleStand';
    if (mixamoFile?.clipes[idleName]) {
      const clone = cloneSkinned(this.model);
      new THREE.Group().add(clone).updateMatrixWorld(true);
      const clip = retargetMixamo(clone, mixamoFile, idleName, { name: FreeIdleClip, loop: true, smooth: 2 }).clip;
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      this.actions.set(FreeIdleClip, action);
      this.baseWeights.set(FreeIdleClip, 0);
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
    this.measureClipPitch();
    this.layupMotion = new LayupMotion({
      bone: (n) => this.bone(n),
      reachPalm: (h, target, w, pole) => this.reachPalm(h, target, w, pole),
      soleHeight: (s) => this.soleHeight(s),
      palmWorld: (h, out) => this.palmWorld(h, out),
      root: this.root,
      model: this.model,
      restFootLocal: (s) => this.restFootLocal[s],
      restAnkleY: this.restAnkleY,
    });
    this.jumpShot = new JumpShotMotion({
      bone: (n) => this.bone(n),
      reachPalm: (h, target, w, pole) => this.reachPalm(h, target, w, pole),
      soleHeight: (s) => this.soleHeight(s),
      palmWorld: (h, out) => this.palmWorld(h, out),
      root: this.root,
      model: this.model,
      restFootLocal: (s) => this.restFootLocal[s],
    });
    this.idleLife = new IdleLife({
      bone: (n) => this.bone(n),
      reachPalm: (h, target, w, pole) => this.reachPalm(h, target, w, pole),
      aimHand: (h, dir, w) => this.aimHand(h, dir, w),
      root: this.root,
    });
    this.armClearance = new ArmClearance({ bone: (n) => this.bone(n), scale: () => this.root.scale.y });
    this.fitArmClearance();

    // Soltura e recepção de cada loop de drible, na curva desenhada da mão da bola.
    for (const [name, info] of Object.entries(this.clips)) {
      if (!name.startsWith('Dribble_')) continue;
      const hand: Hand = name.endsWith('_L') ? 'l' : 'r';
      const peaks = hand === 'r' ? info.peaks_r : info.peaks_l;
      const valleys = hand === 'r' ? info.valleys_r : info.valleys_l;
      if (peaks.length === 0 || valleys.length === 0) continue;
      const C = name.startsWith('Dribble_Run') ? DribbleContactRun : DribbleContact;
      this.loopContact.set(name, contactFrames(info, hand, C.release, C.catch, handDwellFor(name)));
      this.loopContactSym.set(name, contactFrames(info, hand, C.release, C.catch));
      const mean = new THREE.Vector3();
      for (let f = 0; f < info.frames - 1; f++) mean.add(this.palmLocal(info, hand, f, v));
      this.loopPalmMean.set(name, mean.divideScalar(Math.max(1, info.frames - 1)));
    }
  }

  /**
   * `mixamo`: pernas da locomoção pelos clipes do Mixamo misturados por direção e velocidade (padrão; `?loco=cmu` na URL
   * ou `mixamo: false` volta para os loops da CMU).
   */
  static async load(glbUrl: string, clipsUrl: string, opts: { mixamo?: boolean } = {}): Promise<PlayerAnimator> {
    const wantMixamo = opts.mixamo ?? (typeof location === 'undefined' || new URLSearchParams(location.search).get('loco') !== 'cmu');
    const mixamoUrl = glbUrl.replace(/hoops_player\.glb$/, 'mocap/mixamo_loco.json');
    const [gltf, clipsFile, mixamoFile] = await Promise.all([
      new GLTFLoader().loadAsync(glbUrl),
      fetch(clipsUrl).then((r) => r.json() as Promise<ClipsFile>),
      wantMixamo
        ? fetch(mixamoUrl)
            .then((r) => (r.ok ? (r.json() as Promise<MixamoFile>) : null))
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    return new PlayerAnimator(gltf, clipsFile, mixamoFile);
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
    const rate = moveRate(t, duration);
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

  /**
   * Jump shot pela forma do arremesso (`setup`, do criador; sem setup, o padrão): o corpo inteiro é desenhado pelo
   * JumpShotMotion e a soltura do desenho cai em `idealSeconds` (o centro do green). Com `waitForRelease`, a bola só sai
   * quando o jogo chamar releaseShot() (o X solto tarde segura a bola no alto); sem ele, sai sozinha no tempo (prévia).
   * `pullUp`: o jogador chegou correndo (embalo 0..1 e o carry do jogo): parada em 1-2 ou hop, freio e subida alta.
   */
  playShot(hand: Hand, idealSeconds: number, setup?: JumpShotSetup, waitForRelease = false, pullUp?: { momentum: number; carry: ShotCarry }): void {
    const form = pullUpForm(formOf(setup ?? defaultSetup()), pullUp?.momentum ?? 0);
    this.startAction({
      kind: 'Shot',
      timing: null,
      clip: hand === 'r' ? 'JumpShot2_R' : 'JumpShot2_L',
      start: ShotClipHold,
      end: ShotClipEnd,
      release: Infinity,
      catch: Infinity,
      fromHand: hand,
      toHand: hand,
      rate: 0,
      startClock: this.clock,
      duration: idealSeconds,
      turnSign: 0,
      feetStart: null,
    });
    // Os braços são do desenho do arremesso desde o primeiro quadro: nenhuma mão segura a pose do drible.
    this.handHold.l = null;
    this.handHold.r = null;
    this.jumpShot.autoRelease = !waitForRelease;
    this.jumpShot.begin(form, hand, Math.max(0.2, idealSeconds), this.ballWorld, PlayerHeightMeters, pullUp?.carry ?? null);
  }

  /** s até a bola chegar à soltura no desenho do arremesso (0 = chegou, ou não há jump shot tocando). */
  shotReleaseIn(): number {
    return this.jumpShotLive() ? this.jumpShot.releaseIn() : 0;
  }

  /** A bola saiu da mão (o jogo soltou): o desenho passa para o follow-through. */
  releaseShot(): void {
    if (this.jumpShotLive() && this.jumpShot.releasedAt === null) this.jumpShot.releasedAt = this.jumpShot.t;
  }

  /**
   * Deriva do arremesso (fade para trás, pouso à frente) que o jogo soma à posição do jogador (mundo, no chão); zera o
   * que foi entregue. Sem isto o corpo andava sozinho e o jogador "voltava" ao ponto do arremesso no fim.
   */
  takeShotDrift(): THREE.Vector3 {
    if (!this.jumpShotLive()) return new THREE.Vector3();
    const d = this.jumpShot.takeDrift();
    return new THREE.Vector3(0, 0, d).applyQuaternion(this.root.quaternion);
  }

  /** O jogador está no ar num jump shot (da decolagem ao pouso): o jogo não deixa o analógico mover até pousar. */
  shotAirborne(): boolean {
    if (!this.jumpShotLive()) return false;
    const s = this.jumpShot.schedule!;
    return this.jumpShot.t >= s.takeoffAt && this.jumpShot.t < s.landAt;
  }

  /** Arremesso em andamento (o desenho), para o laboratório e a prévia. */
  jumpShotState(): { t: number; releaseAt: number; endAt: number; released: boolean } | null {
    if (!this.jumpShotLive()) return null;
    const s = this.jumpShot.schedule!;
    return { t: this.jumpShot.t, releaseAt: s.releaseAt, endAt: s.endAt, released: this.jumpShot.releasedAt !== null };
  }

  private jumpShotLive(): boolean {
    const a = this.active;
    const live =
      this.jumpShot.active && !this.jumpShot.exiting && !!a && !a.fadingOut && a.kind === 'Shot' && (a.clip === 'JumpShot2_R' || a.clip === 'JumpShot2_L');
    // A ação acabou (fim, jogador andou, pump fake, outra ação): o desenho sai suave por cima da animação seguinte.
    if (!live && this.jumpShot.active && !this.jumpShot.exiting) {
      const finished = this.jumpShot.t >= this.jumpShot.schedule!.endAt - 1e-3;
      this.jumpShot.startExit(finished ? ShotExitSeconds : ShotInterruptExitSeconds);
    }
    return live;
  }

  /** Antes do updateAction: o relógio do desenho anda; o clipe fica parado e vai para o fim quando o desenho acaba. */
  private driveJumpShot(dt: number, speed: number): void {
    if (!this.jumpShotLive()) {
      this.jumpShot.advanceExit(dt);
      return;
    }
    const a = this.active!;
    this.jumpShot.t += dt;
    // Já pousou e o jogador voltou a andar: o arremesso entrega o corpo à locomoção (como no 2K). Com os pés presos no
    // chão, as pernas esticavam e arrastavam atrás do corpo que corria.
    // O relógio do desenho NÃO pula para o fim: a saída parte da pose em que ele está (pulando, ela partia da pose de pé
    // e a pelve subia 3 cm num quadro, no meio da absorção do pouso).
    const s = this.jumpShot.schedule!;
    const moving = this.jumpShot.t > s.landAt + ShotMoveExitAfterLand && speed > ShotMoveExitSpeed;
    a.action.timeScale = 0;
    a.action.time = moving || this.jumpShot.t >= s.endAt ? ShotClipEnd : ShotClipHold;
  }

  /** Parado sem bola (base do IdleStand, sem ação): braços soltos, respiração e um gesto de vez em quando. */
  private applyIdleLife(dt: number, input: AnimInput): void {
    const active = !this.hasBall && !this.active && this.base.name === FreeIdleClip && this.speedOf(input) < 0.35;
    this.idleLife.update(dt, active);
    this.idleLife.apply();
  }

  /**
   * Mede o tronco, o quadril e as coxas para a colisão dos braços. Sem argumento, no corpo do boneco; o PlayerGear chama de
   * novo com a roupa vestida (a regata e a bermuda são mais largas que o corpo).
   */
  fitArmClearance(meshes?: THREE.SkinnedMesh[]): void {
    if (!meshes) {
      meshes = [];
      this.model.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes!.push(o as THREE.SkinnedMesh);
      });
    }
    this.root.updateMatrixWorld(true);
    this.armClearance.fit(meshes);
  }

  /** Medidas da colisão dos braços e quanto cada braço foi empurrado no último quadro (laboratório). */
  armClearanceState(): { sizes: ReturnType<ArmClearance['sizes']>; pushed: { l: number; r: number } } {
    return { sizes: this.armClearance.sizes(), pushed: { ...this.armClearance.pushed } };
  }

  /** Gesto do parado sem bola em andamento (laboratório). */
  idleGesture(): string {
    return this.idleLife.current;
  }

  private applyJumpShotBody(): void {
    if (this.jumpShotLive() || this.jumpShot.exiting) this.jumpShot.applyBody();
  }

  private applyJumpShotArms(): void {
    if (!this.jumpShotLive()) {
      if (this.jumpShot.exiting) this.jumpShot.applyArms();
      return;
    }
    const held = this.jumpShot.applyArms();
    if (held) this.ballHeldLocal = held;
  }

  /**
   * Bandeja (Layup_R ou Layup_L) ou enterrada (Dunk), do gather à soltura. O rate é o de finishSchedule (HoopsFinish): o
   * clipe chega à soltura no tempo do núcleo, e o salto visual vem do Freestyle, não do clipe.
   */
  playFinish(
    dunk: boolean,
    hand: Hand,
    timing: { gather: number; release: number; end: number },
    airtimeSeconds: number,
  ): void {
    const clip = dunk ? 'Dunk' : hand === 'r' ? 'Layup_R' : 'Layup_L';
    const rate = (timing.release - timing.gather) / Math.max(0.2, airtimeSeconds);
    this.startAction({
      kind: 'Shot',
      timing: null,
      clip,
      start: timing.gather,
      end: timing.end,
      release: timing.release,
      catch: Infinity,
      fromHand: hand,
      toHand: hand,
      rate,
      startClock: this.clock,
      duration: (timing.end - timing.gather) / rate,
      turnSign: 0,
      feetStart: null,
    });
    // Mesma pose de origem do startAction (o último quadro), com a transição mais longa da bandeja e da enterrada.
    this.blend(FinishInBlend);
  }

  // ------------------------------------------------------------------------------------- bandeja pelo plano (nba-24)

  /** s desde o gather da bandeja: o Freestyle dá a cada quadro, antes do update (o relógio é o do jogo). */
  layupTime = 0;
  private layupMotion!: LayupMotion;

  /**
   * Bandeja pelo plano do núcleo (src/sim/HoopsLayup.ts, docs/21-bandejas.md). Tronco, ombros e cabeça vêm do clipe
   * Layup_R/L no tempo mapeado das fases do plano; pelve, pernas, mãos e bola vêm do plano (LayupMotion). `ballWorld` é
   * onde a bola está agora: a pega parte dali.
   */
  playLayup(plan: LayupPlan, ballWorld: THREE.Vector3): void {
    const hand = plan.choice.hand;
    this.startAction({
      kind: 'Shot',
      timing: null,
      clip: hand === 'r' ? 'Layup_R' : 'Layup_L',
      start: LayupMotion.clipStart,
      end: LayupMotion.clipEnd,
      release: 45 / ClipFps,
      catch: Infinity,
      fromHand: hand,
      toHand: hand,
      rate: 0,
      startClock: this.clock,
      duration: plan.endAt,
      turnSign: 0,
      feetStart: null,
    });
    // Os braços são do desenho da bandeja desde o primeiro quadro: nenhuma mão segura a pose do drible.
    this.handHold.l = null;
    this.handHold.r = null;
    this.layupTime = 0;
    this.layupMotion.begin(plan, ballWorld, PlayerHeightMeters);
    this.blend(FinishInBlend);
  }

  /** A bandeja pelo plano está tocando (a ação ativa é o clipe dela). */
  private layupLive(): boolean {
    const a = this.active;
    const live = this.layupMotion.active && !!a && !a.fadingOut && a.kind === 'Shot' && (a.clip === 'Layup_R' || a.clip === 'Layup_L');
    if (!live && this.layupMotion.active) this.layupMotion.end();
    return live;
  }

  /** Antes do updateAction: o clipe anda no tempo do plano (o fim do plano fecha a ação). */
  private driveLayupClip(): void {
    if (!this.layupLive()) return;
    const a = this.active!;
    // Proteção: se o jogo parar de dar o tempo (reposicionou o jogador, trocou de fase), a bandeja fecha em 0,25 s em
    // vez de congelar o corpo na última pose.
    if (this.layupTime !== this.layupTimeSeen) {
      this.layupTimeSeen = this.layupTime;
      this.layupTimeAt = this.clock;
    } else if (this.clock - this.layupTimeAt > 0.25) {
      if (this.layupMotion.holding) {
        // Bola presa sem pose nova: fecha a ação (o clipe vai para o fim e o updateAction encerra).
        this.layupMotion.end();
        a.action.time = a.end;
        return;
      }
      this.layupTime = this.layupMotion.plan!.endAt;
    }
    this.layupMotion.t = this.layupTime;
    a.action.timeScale = 0;
    a.action.time = this.layupMotion.holding ? LayupMotion.clipStart : this.layupMotion.clipTime(this.layupTime);
  }
  private layupTimeSeen = -1;
  private layupTimeAt = 0;

  /** Bola presa (fim do hop step): o corpo segue a pose do núcleo (HoopsHold). Só a partir de uma bandeja em andamento. */
  holdLayup(pose: HoldPose, ballWorld: THREE.Vector3): void {
    if (!this.layupLive()) return;
    this.layupTime = 0;
    this.layupMotion.beginHold(pose, ballWorld);
  }

  /** Pose da bola presa deste quadro e o tempo desde que ela começou (o Freestyle dá antes do update). */
  setHoldPose(pose: HoldPose, t: number): void {
    this.layupMotion.setHoldPose(pose);
    this.layupTime = t;
  }

  private applyLayupBody(): void {
    if (this.layupLive()) this.layupMotion.applyBody();
  }

  private applyLayupArms(): void {
    if (!this.layupLive()) return;
    const plan = this.layupMotion.plan;
    const held = this.layupMotion.applyArms(!!plan && this.layupTime >= plan.releaseAt);
    if (held) this.ballHeldLocal = held;
    // A pose desenhada pela bandeja (por cima do mixer) é a origem da transição de saída: sem isso o fim da bandeja
    // partia da pose crua do clipe (cabeça e pés pulavam ~30 cm num quadro).
    this.inertial.capture();
  }

  /** Pés agora (mundo): tornozelo e se está apoiado (ponta a < 4,5 cm do chão e calcanhar < 13 cm), para o plano. */
  feetState(): Record<Hand, { ankle: THREE.Vector3; planted: boolean }> {
    const out = {} as Record<Hand, { ankle: THREE.Vector3; planted: boolean }>;
    for (const side of ['l', 'r'] as const) {
      const ankle = this.bone(`foot_${side}`).getWorldPosition(new THREE.Vector3());
      const toe = this.bone(`ball_${side}`).getWorldPosition(new THREE.Vector3());
      out[side] = { ankle, planted: toe.y < 0.045 && ankle.y < 0.13 };
    }
    return out;
  }

  /**
   * A bola já voltou de um drible em andamento (ou não há drible)? Antes da soltura ela ainda é do drible atual: um
   * drible novo só começa depois da recepção (Freestyle.flushPendingMove).
   */
  moveBallReturned(): boolean {
    const a = this.active;
    return !a || a.fadingOut || a.kind === 'Shot' || a.kind === 'Celebrate' || a.released;
  }

  /** A bola já saiu da mão no drible em andamento (o corte começou)? */
  moveBallReleased(): boolean {
    const a = this.active;
    return !!a && !a.fadingOut && a.kind !== 'Shot' && a.kind !== 'Celebrate' && a.released;
  }

  /** Tempo (s) do clipe da ação ativa, ou null. */
  actionTime(): number | null {
    return this.active ? this.active.action.time : null;
  }

  /**
   * Com quantos segundos de bola ainda no ar (subindo para a mão) o drible `kind` já pode começar (Freestyle). Os de
   * mocap esperam a bola parados antes da soltura (holdMoveForBall); o spin só começa se ela chegar antes da soltura
   * dele (parar congelaria o giro); os procedurais levam a bola por um caminho desenhado desde o começo e quase não
   * esperam (a bola pularia do ar para o caminho).
   */
  moveBallLead(kind: MoveKind, duration: number): number {
    const t: MoveTiming = MoveTimings[kind];
    if (t.procedural) return ProceduralBallLead;
    if (t.turnBack) return Math.max(0, HalfSpinBall.release * duration - MoveBallMargin);
    const toRelease = (t.release - t.start) / moveRate(t, duration);
    return t.turnDeg ? Math.max(0, toRelease - MoveBallMargin) : toRelease + MoveBallWaitMax - MoveBallMargin;
  }

  /**
   * O drible ativo está parado esperando a bola chegar à mão neste quadro (holdMoveForBall). O jogo segura o impulso do
   * drible junto: sem isso o corpo saía para o corte enquanto o braço ainda esperava a bola (até 0,15 s).
   */
  waitingForBall(): boolean {
    const a = this.active;
    return !!a && !a.fadingOut && !a.released && a.action.timeScale === 0 && this.moveBallWait > 0 && a.kind !== 'Shot';
  }

  /** Drible de mocap que começou com a bola no ar: o clipe para logo antes da soltura até ela chegar à mão. */
  private holdMoveForBall(dt: number): void {
    const a = this.active;
    if (!a || a.fadingOut || a.released || !a.timing || a.timing.procedural || a.timing.turnDeg) {
      this.moveBallWait = 0;
      return;
    }
    if (this.ballInHand || this.moveBallWait >= MoveBallWaitMax) {
      a.action.timeScale = a.rate;
      return;
    }
    if (a.action.time + dt * a.rate < a.release - 1e-3) return;
    // O mixer não avança este clipe neste quadro (restoreMixerPose reescreve a pose crua parada).
    this.moveBallWait += dt;
    a.action.timeScale = 0;
  }

  private startAction(spec: Omit<ActiveAction, 'action' | 'released' | 'fadingOut'>): void {
    this.celebrationQueued = false; // qualquer ação nova cancela a comemoração que estava na fila
    const action = this.actions.get(spec.clip);
    if (!action) return;
    if (this.active && this.active.action !== action) {
      // Encadeado: o anterior some rápido sob o novo.
      this.active.action.setEffectiveWeight(0);
    }
    // A mão que segurava a recepção do drible anterior por IK não cai de uma vez na pose do clipe novo (saltava 20–30 cm
    // no size-up encadeado): fica onde estava e passa para o clipe em ~0,15 s.
    // O IK do drible do loop também vira uma mão segurada (no referencial da malha) no começo do drible: apagando devagar
    // (10/s), ele ainda puxava a mão no meio do drible e trocava de alvo na soltura (salto de ~20 cm no spin).
    if (spec.kind !== 'Shot' && spec.kind !== 'Celebrate') {
      for (const hand of ['l', 'r'] as const) {
        if (this.dribbleArmWeight[hand] > 0.01) {
          this.handHold[hand] = { local: this.lastPalmModel[hand].clone(), w: this.dribbleArmWeight[hand] };
          this.dribbleArmWeight[hand] = 0;
        }
      }
    }
    const t = this.tweenCatch;
    if (t && this.tweenArmWeight > 0.05) {
      this.handHold[t.hand] = { local: this.lastPalmModel[t.hand].clone(), w: this.tweenArmWeight };
      this.tweenCatch = null;
      this.tweenArmWeight = 0;
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
    this.driveLayupClip();
    this.driveJumpShot(dt, this.speedOf(input));
    this.updateAction();
    this.holdMoveForBall(dt);
    this.updateWeights();

    // Avança o mixer guardando os tempos anteriores para detectar eventos.
    for (const [name, action] of this.actions) {
      if (action.getEffectiveWeight() > 0 || name === this.base.name || this.active?.clip === name) {
        this.prevTimes.set(name, action.time);
      }
    }
    // O mixer do three só reescreve um osso quando o valor do clipe MUDA de um quadro para o outro (PropertyMixer.apply).
    // O pós-processo (agachamento, dobra do quadril, IK) escreve por cima dos ossos: se o clipe repetia o valor (a 144 Hz,
    // antes da primeira chave do loop; um clipe parado no fim), o osso ficava com a pose pós-processada do quadro
    // anterior e o pós-processo entrava DUAS vezes (o quadril caía 16 cm e girava 28° num quadro). A pose crua do mixer
    // volta para os ossos antes de cada atualização.
    this.restoreMixerPose();
    this.mixer.update(dt);
    this.saveMixerPose();
    this.applyLegLayer(dt, input);
    this.applyMixamoLegs(dt, input);
    this.inertial.apply(dt);
    this.model.rotation.y = this.yawOffset;
    this.root.updateMatrixWorld(true);
    this.applySpinPivot();
    this.detectEvents();

    this.applyStance(dt, input);
    this.applyLayupBody();
    this.applyJumpShotBody();
    this.applyArms(dt);
    this.applyBetweenLegsArm(dt);
    this.applySpinFreeArm(dt);
    this.applyGuardArm(dt);
    this.applyReachForBall(dt);
    // Por último entre os IKs dos braços: uma mão que acabou de sair de um IK (neste quadro, inclusive) fica onde estava.
    this.applyHandHold(dt);
    this.applyLayupArms();
    this.applyJumpShotArms();
    this.applyIdleLife(dt, input);
    if (this.armClearanceEnabled) {
      // Behind the back: a mão da bola segue o caminho desenhado por trás do quadril (ProceduralMoves), por dentro do
      // volume da bermuda larga; a colisão brigava com ele (estalos no antebraço). Só essa mão fica livre.
      const a = this.active && !this.active.fadingOut ? this.active : null;
      this.armClearance.apply(this.hasBall, dt, a?.timing?.procedural === 'BehindBack' ? a.fromHand : null);
    }
    this.applyBallClearance(dt, input);
    const inv = this.root.matrixWorld.clone().invert();
    for (const hand of ['l', 'r'] as const) this.palmWorld(hand, this.lastPalmLocal[hand]).applyMatrix4(inv);
    const invModel = this.model.matrixWorld.clone().invert();
    for (const hand of ['l', 'r'] as const) this.palmWorld(hand, this.lastPalmModel[hand]).applyMatrix4(invModel);
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
      base = speed < 0.35 ? (this.actions.has(FreeIdleClip) ? FreeIdleClip : 'Hold_Idle') : speed < 2.4 ? 'Walk' : 'Run';
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
      // Com as pernas do Mixamo (correndo para a frente) o loop da CMU só dá o tronco e o ritmo do drible: acelerado a 1,5x
      // no sprint, a mão subia e descia ~4,3 vezes por segundo. Até ~3,2 quiques/s, como no drible de velocidade real.
      if (base === 'Dribble_Run') rate = Math.min(rate, THREE.MathUtils.lerp(1.7, DribbleRunMaxRate, this.mixamoWeight));
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
    // Na comemoração e num drible em movimento a ação tem peso 1, mas a camada das pernas troca de loop: a inercialização
    // suaviza a pelve e o pé (sem ela, no crossover acelerando de lado a base ia de parado a de lado a correndo em dois
    // quadros e um pé saltava 31 cm).
    if (this.actionWeight < 0.5 || this.active?.kind === 'Celebrate' || (this.blendLegSwitch && L.weight > 0.01)) this.blend(BaseBlend);
  }

  /** Comemoração depois da cesta: se o arremesso ainda está no ar, espera ele acabar; senão, começa já. */
  celebrate(): void {
    if (this.active?.kind === 'Shot' && !this.active.fadingOut) this.celebrationQueued = true;
    else this.startCelebration();
  }

  /** A bola voltou para a mão: a comemoração para (a base de drible retoma com a bola). */
  endCelebration(): void {
    this.celebrationQueued = false;
    if (this.active?.kind === 'Celebrate' && !this.active.fadingOut) this.active.fadingOut = true;
  }

  private startCelebration(): void {
    const clip = CelebrateClips[this.celebrateIndex];
    this.celebrateIndex = (this.celebrateIndex + 1) % CelebrateClips.length;
    const action = this.actions.get(clip);
    if (!action) return;
    const duration = action.getClip().duration;
    this.startAction({
      kind: 'Celebrate',
      timing: null,
      clip,
      start: 0,
      end: duration,
      release: Infinity,
      catch: Infinity,
      fromHand: 'r',
      toHand: 'r',
      rate: 1,
      startClock: this.clock,
      duration,
      turnSign: 0,
      feetStart: null,
    });
  }

  private updateAction(): void {
    const a = this.active;
    if (!a) return;
    const u = this.progress(a);
    // Crossover e entre as pernas acabam logo depois da recepção: o resto do clipe da CMU segurava a bola parada na mão
    // ~0,3 s (o ritmo morria). O loop da mão nova segue dali, da recepção.
    const caught = TweenMoves.has(a.kind) && a.released && a.action.time >= a.catch + MoveExitAfterCatch * a.rate;
    if (!a.fadingOut && (caught || a.action.time >= a.end - 1e-3 || (a.timing?.procedural && u >= 1))) {
      a.fadingOut = true;
      if (caught && this.hasBall) this.restartLoopAtCatch(a.toHand);
    }
    const turnDeg = a.timing?.turnDeg ?? 0;
    if (turnDeg) {
      const alpha = Math.min(1, Math.max(0, u));
      // Spin: a curva medida no mocap começa a 1080°/s já no primeiro quadro e tem quinas a cada 1/8 (o quadril saltava
      // 8 cm e a mão 27 cm num quadro). Misturada com um smoothstep, o giro acelera e freia sem quinas e o pico cai
      // para ~800°/s; o corpo do clipe continua quase em fase com ele.
      const shape = a.timing?.turnBack
        ? halfSpinTurn(alpha)
        : THREE.MathUtils.lerp(spinTurnAlpha(alpha), alpha * alpha * (3 - 2 * alpha), SpinYawSmooth);
      this.yawOffset = a.turnSign * THREE.MathUtils.degToRad(turnDeg) * shape;
    }
    if (a.fadingOut) {
      // Fim do drible: a base volta na hora, com a pose suavizada pela inertialization.
      a.action.setEffectiveWeight(0);
      this.active = null;
      this.actionWeight = 0;
      this.yawOffset = 0;
      this.blend(ActionOutBlend);
      if (a.kind === 'Shot' && this.celebrationQueued) this.startCelebration();
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
  private spinPivot: { action: ActiveAction; side: Hand; world: THREE.Vector3; rel: THREE.Vector3; yaw0: number } | null = null;

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
      // O corpo gira em arco em volta da ponta do pé de pivô, no mesmo ângulo do giro da malha. Prender a ponta do pé do
      // clipe quadro a quadro fazia o quadril chicotear (até 9 m/s, saltos de 15 cm por quadro): o pé do clipe escorrega.
      const origin = this.model.getWorldPosition(new THREE.Vector3());
      if (!this.spinPivot || this.spinPivot.action !== a || this.spinPivot.side !== side) {
        const world = this.bone(`ball_${side}`).getWorldPosition(new THREE.Vector3()).setY(0);
        this.spinPivot = { action: a, side, world, rel: origin.clone().setY(0).sub(world), yaw0: this.yawOffset };
      }
      const P = this.spinPivot;
      const desired = P.rel.clone().applyAxisAngle(axis.set(0, 1, 0), this.yawOffset - P.yaw0).add(P.world);
      const delta = desired.sub(origin).setY(0);
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
  // ------------------------------------------------------------------------------------- pernas do Mixamo

  /**
   * Locomoção do Mixamo (Fase 2 da fluidez): um esqueleto-clone escondido toca os loops do Mixamo misturados por direção
   * e velocidade, na mesma fase da passada (MixamoLocomotion). A pelve e as pernas dele substituem as do loop da CMU
   * andando e correndo; o tronco, os braços, o drible e a bola continuam do loop da CMU, e todo o pós-processo
   * (agachamento, base, trava de pé, IK, inclinação, braço da bola) roda por cima, como antes.
   */
  private mixamo: { loco: MixamoLocomotion; pairs: [THREE.Bone, THREE.Object3D][]; pelvis: [THREE.Bone, THREE.Object3D] } | null = null;
  private mixamoWeight = 0;
  /** Altura média do quadril da passada (mundo), para reduzir o quique (MixamoBounceKeep). */
  private mixamoBounceMean: number | null = null;
  /** MixamoBounceKeep (1 = quique inteiro do clipe; laboratório). */
  mixamoBounceKeep = MixamoBounceKeep;
  mixamoLegsEnabled = true;
  /** A pelve do Mixamo fica com a inclinação para a frente do clipe (desligar no laboratório para comparar). */
  mixamoPelvisPitchFix = true;

  private setupMixamo(file: MixamoFile): void {
    const clone = cloneSkinned(this.model);
    const holder = new THREE.Group();
    holder.add(clone);
    holder.updateMatrixWorld(true);
    const src = new Map<string, THREE.Object3D>();
    clone.traverse((o) => {
      if ((o as THREE.Bone).isBone) src.set(o.name, o);
    });
    const loco = new MixamoLocomotion(clone, file, { dribbleLayer: false });
    const pairs = MixamoLegBones.map((n) => [this.bone(n), src.get(n)!] as [THREE.Bone, THREE.Object3D]);
    this.mixamo = { loco, pairs, pelvis: [this.bone('pelvis'), src.get('pelvis')!] };
  }

  private applyMixamoLegs(dt: number, input: AnimInput): void {
    const M = this.mixamo;
    if (!M) return;
    // A fase da passada anda sempre (a troca de peso não faz a perna pular).
    M.loco.update(dt, input.right, input.forward);
    const a = this.active && !this.active.fadingOut ? this.active : null;
    const speed = this.speedOf(input);
    let target = 0;
    if (!this.mixamoLegsEnabled) target = 0;
    else if (!a) target = THREE.MathUtils.smoothstep(speed, MixamoLegSpeed[0], MixamoLegSpeed[1]);
    // Drible em movimento (a camada das pernas já manda): as pernas seguem a passada do Mixamo.
    else if (this.legLayerMoves.includes(a.kind) && this.hasBall && !this.moveStartedStanding) target = THREE.MathUtils.smoothstep(speed, LegLayerSpeed[0], LegLayerSpeed[1]);
    // Arremesso, bandeja, comemoração e os dribles parados (size-up, base plantada): pernas do clipe, como antes.
    // De lado, o trote do Mixamo (futebol) cruza os pés na frente; o deslize lateral fica com o loop de drible da CMU.
    const along = speed > 1e-3 ? Math.abs(input.forward) / speed : 1;
    target *= THREE.MathUtils.smoothstep(along, MixamoAlong[0], MixamoAlong[1]);
    this.mixamoWeight += (target - this.mixamoWeight) * (1 - Math.exp(-MixamoLegRate * dt));
    const w = this.mixamoWeight;
    if (w < 1e-3) return;
    // O tronco fica orientado como no loop do drible: a pelve do Mixamo gira no ritmo da passada dele e levava junto o
    // tronco e o braço da bola da CMU (estalos no braço correndo). A spine_01 desfaz a rotação nova da pelve.
    const spine = this.bone('spine_01');
    this.root.updateMatrixWorld(true);
    const spineWorld = spine.getWorldQuaternion(new THREE.Quaternion());
    const pelvis = M.pelvis[0];
    const pelvisClip = pelvis.getWorldQuaternion(new THREE.Quaternion());
    for (const [dst, s] of M.pairs) dst.quaternion.slerp(s.quaternion, w);
    M.pelvis[0].position.lerp(M.pelvis[1].position, w);
    pelvis.updateWorldMatrix(true, false);
    // O retarget dá à pelve a orientação do TRONCO da fonte (quadris + ombros): na corrida do Mixamo o tronco deita 10–22°
    // e a pelve ia junto, 9–20° mais inclinada para a frente que a do clipe da CMU, com o tronco em pé por cima: a bunda
    // empinava ("gazela", diretor 2026-10-16). A pelve fica com o giro e o balanço laterais do Mixamo e a inclinação
    // para a frente do clipe; as coxas mantêm a direção no mundo (a passada não muda).
    if (this.mixamoPelvisPitchFix) this.keepClipPelvisPitch(pelvis, pelvisClip, M.pairs);
    this.damperBounce(pelvis, w, dt);
    const pelvisWorld = pelvis.getWorldQuaternion(new THREE.Quaternion());
    spine.quaternion.copy(pelvisWorld.invert().multiply(spineWorld));
    pelvis.updateWorldMatrix(false, true);
  }

  /** Reduz o sobe-e-desce do quadril em volta da altura média da passada; os tornozelos ficam onde estavam. */
  private damperBounce(pelvis: THREE.Bone, w: number, dt: number): void {
    const y = pelvis.getWorldPosition(new THREE.Vector3()).y;
    if (this.mixamoBounceMean === null || w < 0.05) {
      this.mixamoBounceMean = y;
      return;
    }
    this.mixamoBounceMean += (y - this.mixamoBounceMean) * (1 - Math.exp(-dt / MixamoBounceTau));
    const dy = (this.mixamoBounceMean - y) * (1 - this.mixamoBounceKeep) * w;
    if (Math.abs(dy) < 1e-4) return;
    const ankles = (['l', 'r'] as const).map((side) => this.bone(`foot_${side}`).getWorldPosition(new THREE.Vector3()));
    const parent = pelvis.parent!;
    const delta = new THREE.Vector3(0, dy, 0)
      .applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()).invert())
      .divide(parent.getWorldScale(new THREE.Vector3()));
    pelvis.position.add(delta);
    pelvis.updateWorldMatrix(true, true);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    (['l', 'r'] as const).forEach((side, i) =>
      solveTwoBoneIK(this.bone(`thigh_${side}`), this.bone(`calf_${side}`), this.bone(`foot_${side}`), ankles[i], forward, LegSoftReach),
    );
  }

  /** Tira da pelve a inclinação para a frente a mais que ela tem em relação a `pelvisClip`; as coxas não mudam no mundo. */
  private keepClipPelvisPitch(pelvis: THREE.Bone, pelvisClip: THREE.Quaternion, pairs: [THREE.Bone, THREE.Object3D][]): void {
    const thighWorld = pairs.filter(([b]) => b.name.startsWith('thigh_')).map(([b]) => [b, b.getWorldQuaternion(new THREE.Quaternion())] as const);
    const pitchAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.model.getWorldQuaternion(new THREE.Quaternion()));
    const rel = pelvis.getWorldQuaternion(new THREE.Quaternion()).multiply(pelvisClip.clone().invert());
    const pitchPart = pitchAxis.dot(new THREE.Vector3(rel.x, rel.y, rel.z));
    const pitch = new THREE.Quaternion(pitchAxis.x * pitchPart, pitchAxis.y * pitchPart, pitchAxis.z * pitchPart, rel.w).normalize();
    const keep = rel.multiply(pitch.invert()); // rel = swing · pitch: fica o swing
    const pelvisParent = pelvis.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    pelvis.quaternion.copy(pelvisParent.multiply(keep.multiply(pelvisClip)));
    pelvis.updateWorldMatrix(false, false);
    for (const [thigh, world] of thighWorld) {
      thigh.quaternion.copy(thigh.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    }
    pelvis.updateWorldMatrix(false, true);
  }

  private applyLegLayer(dt: number, input: AnimInput): void {
    const a = this.active;
    const L = this.legLayer;
    // Comemoração: o clipe manda só no tronco, na cabeça e nos braços; as pernas e a pelve seguem a locomoção, livres.
    const celebrating = !!a && !a.fadingOut && a.kind === 'Celebrate' && !CelebrateKeepsLegs.has(a.clip);
    const layered = this.legLayerEnabled && !!a && !a.fadingOut && ((this.legLayerMoves.includes(a.kind) && this.hasBall) || celebrating);
    if (!layered) {
      L.clip = '';
      L.weight = 0;
      return;
    }
    if (!celebrating && this.moveStartedStanding) {
      L.clip = '';
      L.weight = 0;
      return;
    }
    const speed = this.speedOf(input);
    const target = celebrating ? 1 : THREE.MathUtils.smoothstep(speed, LegLayerSpeed[0], LegLayerSpeed[1]);
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
   * Drible baixo: leva uma palma (referencial do jogador) para a altura de jogador bom no ponto `h` da curva desenhada da
   * mão (0 = embaixo, 1 = no alto; null = mantém a altura); a bola vai um pouco por fora e à frente do pé.
   */
  private lowDribblePalm(clip: string, hand: Hand, local: THREE.Vector3, h: number | null): THREE.Vector3 {
    const s = this.stance;
    const [bottom, top] = this.palmBand(clip);
    const mean = this.loopPalmMean.get(clip);
    if (h !== null && mean) {
      // Caminho desenhado: sobe e desce num ponto fixo ao lado do pé, indo um pouco para a frente na descida.
      const swing = DribbleSwing[clip.replace(/_[LR]$/, '')] ?? DribbleSwingDefault;
      local.y = bottom + (top - bottom) * h;
      local.x = mean.x;
      local.z = mean.z + swing * (0.5 - h);
    }
    local.x += sideSign(hand) * s.dribbleOutward;
    local.z += s.dribbleForward + this.footAhead(hand);
    return local;
  }

  /** Faixa (m) da palma da mão da bola no loop: do ponto mais baixo ao mais alto do ciclo. */
  private palmBand(clip: string): [number, number] {
    const s = this.stance;
    return clip.startsWith('Dribble_Low')
      ? [s.palmBottomLow, s.palmTopLow]
      : clip.startsWith('Dribble_Run')
        ? [s.palmBottomRun, s.palmTopRun]
        : [s.palmBottom, s.palmTop];
  }

  /**
   * Quanto o pé do lado da mão está à frente do meio dos dois pés na base plantada (m, só para a frente): na base
   * escalonada a bola vai à frente da ponta do pé da frente, não para dentro do joelho dele.
   */
  private footAhead(hand: Hand): number {
    if (!this.footworkEnabled || this.plantBlend < 0.02) return 0;
    const inv = this.root.matrixWorld.clone().invert();
    const tmp = new THREE.Vector3();
    const z = (side: Hand) => tmp.copy(this.plant[side].pos).applyMatrix4(inv).z;
    const mine = z(hand);
    return Math.max(0, mine - (mine + z(otherSide(hand))) / 2) * this.plantWeight() * SplitStance.handAhead;
  }

  /** Ponto (0..1) da curva desenhada da mão da bola no clipe, no tempo atual dele (dribbleHandShape). */
  private handShapeNow(clip: string, hand: Hand): number | null {
    const info = this.clips[clip];
    const action = this.actions.get(clip);
    if (!info || !action) return null;
    return dribbleHandShape(info, hand, action.time * ClipFps, this.handDwellEnabled ? handDwellFor(clip) : undefined);
  }

  /** Soltura e recepção do loop (quadros), com ou sem o dwell da mão. */
  private contactOf(clip: string): { release: number[]; catch: number[] } | undefined {
    return (this.handDwellEnabled ? this.loopContact : this.loopContactSym).get(clip);
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
        if (a.kind === 'Cross' || a.kind === 'EscapeCross') {
          const catchLocal = this.tweenCatch?.action === a ? this.tweenCatch.local.clone() : this.crossCatch(a.toHand);
          if (this.tweenCatch?.action !== a) this.tweenCatch = { action: a, hand: a.toHand, local: catchLocal.clone() };
          // Quique em V à frente do corpo: no meio entre a soltura e a recepção, à frente das duas.
          const from = this.palmWorld(a.fromHand, new THREE.Vector3()).applyMatrix4(this.root.matrixWorld.clone().invert());
          const floorLocal = new THREE.Vector3((from.x + catchLocal.x) / 2, 0, Math.max(from.z, catchLocal.z) + CrossFloorAhead);
          this.release({ fromHand: a.fromHand, toHand: a.toHand, catchIn: (a.catch - a.release) / a.rate, catchLocal, floorLocal, move: true });
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
    const contact = this.contactOf(this.base.name);
    if (!contact) return;
    for (const frame of crossedFrames(contact.release, prev, now, n)) {
      const toCatch = framesToNext(contact.catch, frame, n);
      if (toCatch === null) continue;
      const catchFrame = (frame + toCatch) % n;
      const palm = this.palmLocal(info, hand, catchFrame);
      this.lowDribblePalm(this.base.name, hand, palm, (this.base.name.startsWith('Dribble_Run') ? DribbleContactRun : DribbleContact).catch);
      palm.y -= BallRadius * 1.02;
      // Velocidade vertical da mão na recepção (pela curva desenhada): o quique é escolhido para a bola chegar perto dela
      // (a mão encontra a bola subindo junto, sem pancada).
      const rate = Math.max(0.3, action.timeScale);
      const dwell = this.handDwellEnabled ? handDwellFor(this.base.name) : undefined;
      const [bottom, top] = this.palmBand(this.base.name);
      const hA = dribbleHandShape(info, hand, catchFrame - 0.25, dwell);
      const hB = dribbleHandShape(info, hand, catchFrame + 0.25, dwell);
      const catchSpeedY = hA !== null && hB !== null ? ((hB - hA) / 0.5) * ClipFps * rate * (top - bottom) : undefined;
      this.release({
        fromHand: hand,
        toHand: hand,
        catchIn: toCatch / ClipFps / rate,
        catchLocal: palm,
        move: false,
        catchSpeedY,
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
    else if (a?.timing?.turnDeg && a) {
      const drop = this.pelvisAvg('Dribble_Idle_R', 0, Infinity) - this.pelvisAvg(a.clip, a.start * ClipFps, a.end * ClipFps);
      crouchTarget = THREE.MathUtils.clamp(s.crouchIdle + s.crouchSpin - drop, 0, 0.35);
    }
    else if (stepBack) crouchTarget = s.crouchProcedural + stepBack.crouch;
    else if (kind && a) {
      // Cada clipe da CMU tem a pelve numa altura (o entre as pernas e a hesitação 17 cm abaixo do drible parado, o
      // crossover na mesma): somar o mesmo agachamento a todos fazia o jogador agachar em sumô num drible e se levantar
      // no outro. O drible fica na altura média da base em que ele começou; só o sobe-e-desce do próprio clipe fica.
      const baseCrouch = standingMove ? s.crouchIdle : this.base.base === 'Dribble_Run' ? s.crouchRun : s.crouchWalk;
      const drop = this.pelvisAvg('Dribble_Idle_R', 0, Infinity) - this.pelvisAvg(a.clip, a.start * ClipFps, a.end * ClipFps);
      crouchTarget = THREE.MathUtils.clamp(baseCrouch - drop, -0.02, 0.3);
    }
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
    // Dobra do quadril: com a bola, fora do arremesso e da comemoração (e do spin, que tem a inclinação dele).
    // Correndo a dobra some (a inclinação da corrida já põe o peito à frente).
    const hingeStance =
      !input.hasBall || kind === 'Shot' || kind === 'Celebrate' || a?.timing?.turnDeg
        ? 0
        : (!kind && speed < 0.35) || sizeUpMove
          ? s.hingeIdleDeg
          : s.hingeMoveDeg * (1 - THREE.MathUtils.smoothstep(speed, 1.5, 4));
    // Cada clipe da CMU dobra o tronco de um jeito (o drible parado 13°, o crossover 35°, o entre as pernas 62°): somar a
    // dobra e a inclinação da base em cima deixava o tronco quase deitado no entre as pernas. O excesso do clipe em
    // relação ao loop em que o drible começou sai da dobra e, se sobrar, da inclinação.
    let pitchFix = 0;
    if (a?.timing && kind !== 'Shot' && kind !== 'Celebrate' && !spinning && a.timing.procedural !== 'StepBack') {
      const ref = this.clipPitch.get(`${this.base.base}_R`) ?? this.clipPitch.get('Dribble_Idle_R') ?? 0;
      pitchFix = Math.max(0, (this.clipPitch.get(a.timing.clip) ?? ref) - ref);
    }
    const leanFix = Math.max(0, pitchFix - hingeStance);
    const leanF = shooting
      ? 0
      : spinning
        ? s.leanSpinDeg
        : Math.min(s.leanMaxDeg, Math.max(-s.leanMaxDeg, base + input.accelForward * s.leanPerAccelDeg + (stepBack?.leanDeg ?? 0) - leanFix));
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
    const hingeTarget = Math.max(0, hingeStance - pitchFix);
    this.hinge += (hingeTarget - this.hinge) * k;
    const bodyQ0 = this.model.getWorldQuaternion(new THREE.Quaternion());
    const worldDown = new THREE.Vector3(0, -this.crouch, 0).addScaledVector(
      new THREE.Vector3(0, 0, -1).applyQuaternion(bodyQ0),
      s.hingeBack * (this.hinge / s.hingeIdleDeg),
    );
    const parentQ = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const parentS = parent.getWorldScale(new THREE.Vector3());
    worldDown.applyQuaternion(parentQ).divide(parentS);
    pelvis.position.add(worldDown);
    if (this.hinge > 0.01) {
      const hingeQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0).applyQuaternion(bodyQ0), THREE.MathUtils.degToRad(this.hinge));
      const pelvisWorld = pelvis.getWorldQuaternion(new THREE.Quaternion());
      pelvis.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hingeQ).multiply(pelvisWorld));
    }
    this.applyWeightShift(dt, input, a, u);
    pelvis.updateWorldMatrix(true, true);
    // Pés na pose do clipe (já com a dobra do quadril): ponto mais baixo da sola e altura do calcanhar, base do pé plano.
    const soleL = this.lowestSole('l', footL);
    const soleR = this.lowestSole('r', footR);
    const riseL = this.footHeelRise('l');
    const riseR = this.footHeelRise('r');

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
    // Parado sem bola também: o pé seguia a orientação do clipe (ponta para baixo, calcanhar no ar) e a correção da sola
    // erguia o tornozelo, com os joelhos dobrados para compensar.
    const freeIdle = !input.hasBall && !kind && speed < 0.35 && this.base.name === FreeIdleClip;
    const planted =
      freeIdle ||
      (input.hasBall &&
        ((!kind && speed < 0.35 && (this.base.base === 'Dribble_Idle' || this.base.base === 'Dribble_Low')) || standingMove || settling));
    // Nos dribles do size-up os pés não seguem o clipe (a hesitação da CMU anda até 1 m com os pés): ficam pregados.
    // No escape os pés dão passos para onde o corpo vai estar (velocidade x duração do passo).
    const velocity = forward.clone().multiplyScalar(input.forward).addScaledVector(leftDir, -input.right);
    const feetMode = sizeUpMove ? 'hold' : standingMove || (settling && speed > 0.35) ? 'escape' : 'free';
    const flatFeet = this.applyPlantedStance(planted, ankleL, ankleR, dt, feetMode, velocity);
    const lockable = this.footLockEnabled && !a?.feetStart && kind !== 'Shot' && !flatFeet;
    this.applyFootLock('l', ankleL, toeY.l, lockable, dt);
    this.applyFootLock('r', ankleR, toeY.r, lockable, dt);
    // Pé de apoio com a sola no chão fica plano (não na ponta). Fora do arremesso, do spin e do passo procedural.
    const flatOk = this.flatFootEnabled && kind !== 'Shot' && !spinning && !a?.feetStart;
    this.flattenFoot('l', ankleL, footQL, soleL, riseL, dt, flatOk);
    this.flattenFoot('r', ankleR, footQR, soleR, riseR, dt, flatOk);
    this.keepFlatLegsInReach(ankleL, ankleR, dt);
    this.keepFeetApart(ankleL, ankleR);
    solveTwoBoneIK(this.bone('thigh_l'), this.bone('calf_l'), footL, ankleL, forward, LegSoftReach);
    solveTwoBoneIK(this.bone('thigh_r'), this.bone('calf_r'), footR, ankleR, forward, LegSoftReach);
    // Joelhos para a frente e para fora, sobre a ponta dos pés: com a base aberta e o quadril baixo os joelhos caíam para
    // dentro (pernas em X). Na base plantada manda inteiro; andando/correndo só corrige (o clipe já tem o joelho à frente).
    // Nos loops e nos dribles parados (size-up): sem isso, no começo do drible os joelhos viravam para a frente e a dobra
    // do quadril caía, e de frente o jogador parecia se levantar para driblar. (A bola presa não se afasta mais da mão
    // por causa do joelho: quem sai é a mão, applyBallClearance.)
    const kneeTarget = this.kneeOutEnabled && input.hasBall && (!kind || sizeUpMove) ? 1 : 0;
    this.kneeOutW += (kneeTarget - this.kneeOutW) * (1 - Math.exp(-10 * dt));
    if (this.kneeOutW > 1e-3) {
      const kneeW = (KneeOut.moving + (1 - KneeOut.moving) * this.plantWeight()) * this.kneeOutW;
      for (const side of ['l', 'r'] as const) {
        const ankle = side === 'l' ? ankleL : ankleR;
        const pole = forward.clone().addScaledVector(leftDir, sideSign(side) * KneeOut.outward).normalize();
        applyPole(this.bone(`thigh_${side}`), this.bone(`calf_${side}`), ankle, pole, kneeW);
      }
    }
    // Pé com a mesma orientação do clipe (sola no chão); na base plantada, reto no chão e apontado para a frente.
    // Pelo peso da base (não pelo flatFeet, que vira em 0,5): o pé saía de meio reto para a pose do clipe num quadro.
    // (O pé reto é calculado à parte: `footQL.copy(reto).slerp(footQL, ...)` misturava o reto com ele mesmo, o pé ficava
    // 100% reto até o peso cair a 2% e girava 40–95° num quadro ao começar a andar.)
    if (this.plantBlend > 0.02) {
      const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
      const w = this.plantWeight();
      footQL.copy(rootQ.clone().multiply(this.restFootLocal.l).slerp(footQL, 1 - w));
      footQR.copy(rootQ.clone().multiply(this.restFootLocal.r).slerp(footQR, 1 - w));
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
      solveTwoBoneIK(this.bone(`thigh_${side}`), this.bone(`calf_${side}`), foot, ankle, forward, LegSoftReach);
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
    // Cabeça erguida: o tronco deita, mas o jogador bom olha para a frente (Kyrie com o tronco a 60° e o rosto na cesta).
    const headUp = new THREE.Quaternion().setFromAxisAngle(left, THREE.MathUtils.degToRad(-(this.leanForward + this.hinge) * s.headUpShare * 0.5));
    for (const name of ['neck_01', 'head']) {
      const b = this.bone(name);
      const bw = b.getWorldQuaternion(new THREE.Quaternion());
      b.quaternion.multiply(bw.clone().invert().multiply(headUp).multiply(bw));
      b.updateWorldMatrix(false, true);
    }
    // A pelve e os ossos voltam para a pose do clipe no próximo quadro (o mixer sobrescreve): nada acumula.
  }

  /**
   * Transferência de peso (DribbleFootwork.weightTarget, por uma mola): na base plantada o quadril vai para cima do pé de
   * apoio (o da frente na base escalonada, o lado da mão nova no crossover), gira com a base e sobe/desce com a tesoura e
   * o pouso. Os pés estão pregados (alvos do IK já decididos no mundo), então quem dobra são os joelhos e o quadril. O
   * tronco desfaz parte do giro do quadril (os ombros ficam de frente para a defesa). Antes do IK das pernas.
   */
  private applyWeightShift(dt: number, input: AnimInput, a: ActiveAction | null, u: number): void {
    const enabled = this.footworkEnabled && input.hasBall && a?.kind !== 'Shot' && a?.kind !== 'Celebrate';
    const scale = enabled ? this.plantWeight() : 0;
    const front = this.stagger.front;
    let move: MovePhase;
    if (a?.timing) {
      const span = Math.max(1e-3, a.end - a.start);
      const frac = (t: number) => (a.timing!.procedural ? t : (t - a.start) / span);
      move = { kind: a.kind, u, release: frac(a.release), catch: frac(a.catch), fromHand: a.fromHand, toHand: a.toHand };
    } else {
      move = { kind: null, u: 0, release: 0, catch: 0, fromHand: input.ballHand, toHand: input.ballHand };
    }
    const target = weightTarget(move, front, input.ballHand);
    // Tesoura: os dois pés no ar por um instante, o quadril sobe um pouco (o pouso o traz de volta pelo impulso).
    if (front && this.plant[front].dur && this.plant[front].t < 1) target.y += SplitStance.hop * Math.sin(Math.PI * this.plant[front].t);
    const S = ProceduralScale * scale;
    target.x *= S;
    target.y *= S;
    target.z *= S;
    target.yaw *= scale;
    const P = this.weight.update(target, dt);
    if (Math.abs(P.x) + Math.abs(P.y) + Math.abs(P.z) + Math.abs(P.yaw) < 1e-5) return;
    const pelvis = this.bone('pelvis');
    const parent = pelvis.parent!;
    const parentInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const offset = new THREE.Vector3(P.x, P.y, P.z).applyQuaternion(this.root.quaternion);
    pelvis.position.add(offset.applyQuaternion(parentInv).divide(parent.getWorldScale(new THREE.Vector3())));
    if (Math.abs(P.yaw) < 1e-4) return;
    const up = new THREE.Vector3(0, 1, 0);
    const spine = this.bone('spine_01');
    const spineWorld = spine.getWorldQuaternion(new THREE.Quaternion());
    const pelvisWorld = pelvis.getWorldQuaternion(new THREE.Quaternion());
    pelvis.quaternion.copy(parentInv.clone().multiply(new THREE.Quaternion().setFromAxisAngle(up, P.yaw)).multiply(pelvisWorld));
    pelvis.updateWorldMatrix(true, false);
    // O tronco fica com 40% do giro do quadril (dissociação quadril-ombros).
    const spineTarget = new THREE.Quaternion().setFromAxisAngle(up, P.yaw * 0.4).multiply(spineWorld);
    spine.quaternion.copy(pelvis.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(spineTarget));
  }

  /**
   * Pernas nunca cruzam: no referencial do CORPO (no spin a malha gira em relação à raiz), o tornozelo esquerdo fica pelo
   * menos FeetMinGap à esquerda do direito. Quem anda é o pé que não está preso no chão (o preso escorregaria); com os
   * dois livres (ou os dois presos), metade cada um.
   */
  private keepFeetApart(ankleL: THREE.Vector3, ankleR: THREE.Vector3): void {
    const bodyQ = this.model.getWorldQuaternion(new THREE.Quaternion());
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(bodyQ).setY(0).normalize();
    const gap = ankleL.dot(left) - ankleR.dot(left);
    if (gap >= FeetMinGap) return;
    const need = FeetMinGap - gap;
    const lockL = this.footLock.l.locked || this.plantWeight() > 0.5;
    const lockR = this.footLock.r.locked || this.plantWeight() > 0.5;
    const shareL = lockL === lockR ? 0.5 : lockL ? 0 : 1;
    ankleL.addScaledVector(left, need * shareL);
    ankleR.addScaledVector(left, -need * (1 - shareL));
  }

  private plantBlend = 0;
  private kneeOutW = 0;
  /** Pé plano no apoio (flattenFoot): peso 0 a 1 por pé e a altura do calcanhar no quadro anterior (para ver se ele sobe). */
  private readonly flatFoot = { l: { w: 0, rise: 0, x: 0, z: 0 }, r: { w: 0, rise: 0, x: 0, z: 0 } };
  /** Quanto o quadril desce (m) para o pé plano alcançar o chão (keepFlatLegsInReach). */
  private flatDrop = 0;
  /** Peso da base plantada que chega a zero junto com o corte em 0,02 (cortar 2% de um pé deixado 5 m para trás dava 10 cm de salto). */
  private plantWeight(): number {
    return Math.max(0, (this.plantBlend - 0.02) / 0.98);
  }

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
      this.soleDense[side] = sole.map((f) => ({ bone: f.bone, local: f.bone.worldToLocal(f.world.clone()) }));
    }
  }

  /** Altura do ponto mais baixo da sola (mundo); os ossos do pé precisam estar com a matriz do mundo atualizada. */
  private soleHeight(side: Hand): number {
    let min = Infinity;
    for (const pt of this.solePoints[side]) min = Math.min(min, v.copy(pt.local).applyMatrix4(pt.bone.matrixWorld).y);
    return min;
  }

  /**
   * Quanto o calcanhar (osso foot_*) está acima do que seria com a sola plana, com a ponta (ball_*) no chão (m; positivo =
   * o pé está na ponta). Só leitura: a métrica "pé na ponta" do laboratório usa.
   */
  footHeelRise(side: Hand): number {
    const foot = this.bone(`foot_${side}`);
    const toe = this.bone(`ball_${side}`);
    const heel = foot.getWorldPosition(new THREE.Vector3());
    const tip = toe.getWorldPosition(new THREE.Vector3());
    const scale = foot.getWorldScale(new THREE.Vector3());
    // Pé plano no referencial do corpo: raiz x repouso (o yaw não muda a altura, então não importa o do clipe).
    const flat = toe.position.clone().multiply(scale).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()).multiply(this.restFootLocal[side]));
    return flat.y - (tip.y - heel.y);
  }

  /**
   * Sola na pose atual: altura do ponto mais baixo (mundo) e os pontos da sola no referencial do osso do pé (sem escala).
   * Com o pé plano o calcanhar pode ser o ponto mais baixo (não a ponta da pose de repouso), então a altura usa todos.
   */
  private lowestSole(side: Hand, foot: THREE.Bone): { h: number; pts: THREE.Vector3[] } {
    const inv = foot.matrixWorld.clone().invert();
    let h = Infinity;
    const pts: THREE.Vector3[] = [];
    for (const pt of this.soleDense[side]) {
      const p = pt.local.clone().applyMatrix4(pt.bone.matrixWorld);
      h = Math.min(h, p.y);
      pts.push(p.applyMatrix4(inv));
    }
    return { h, pts };
  }

  /**
   * Com o pé plano o tornozelo desce até o chão: se a perna chega esticada no limite, o quadril desce o que falta (até
   * FlatDropMax), suave (FlatDropRate). Só conta o pé com peso de correção; a descida é recalculada a cada quadro (o
   * mixer devolve a pelve do clipe), então não acumula.
   */
  private keepFlatLegsInReach(ankleL: THREE.Vector3, ankleR: THREE.Vector3, dt: number): void {
    let need = 0;
    for (const [side, ankle] of [
      ['l', ankleL],
      ['r', ankleR],
    ] as const) {
      if (this.flatFoot[side].w < 0.05) continue;
      const hip = this.bone(`thigh_${side}`).getWorldPosition(new THREE.Vector3());
      const knee = this.bone(`calf_${side}`).getWorldPosition(new THREE.Vector3());
      const foot = this.bone(`foot_${side}`).getWorldPosition(new THREE.Vector3());
      const reach = hip.distanceTo(knee) + knee.distanceTo(foot);
      need = Math.max(need, hip.distanceTo(ankle) - reach * FlatReach);
    }
    const target = THREE.MathUtils.clamp(need, 0, FlatDropMax);
    this.flatDrop += (target - this.flatDrop) * (1 - Math.exp(-FlatDropRate * dt));
    if (this.flatDrop < 1e-4) return;
    const pelvis = this.bone('pelvis');
    const parent = pelvis.parent!;
    const parentQ = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const parentS = parent.getWorldScale(new THREE.Vector3());
    pelvis.position.add(new THREE.Vector3(0, -this.flatDrop, 0).applyQuaternion(parentQ).divide(parentS));
    pelvis.updateWorldMatrix(true, true);
  }

  /**
   * Pé de apoio plano. Com a sola no chão (o ponto mais baixo até FlatSoleMax) o pé gira para ficar plano, com a direção
   * da ponta do clipe (o yaw do clipe). O pivô é o ponto mais baixo da sola: ele fica onde o clipe o pôs e o tornozelo
   * desce até o pé plano. Quando o calcanhar sobe no fim do passo (saída da corrida) não corrige: a ponta fica e o calcanhar
   * sobe, que é o certo. Entrada e saída suaves (peso 0 a 1); o pé no ar segue o clipe.
   */
  private flattenFoot(
    side: Hand,
    ankle: THREE.Vector3,
    footQ: THREE.Quaternion,
    sole: { h: number; pts: THREE.Vector3[] },
    rise: number,
    dt: number,
    enabled: boolean,
  ): void {
    const f = this.flatFoot[side];
    const dr = dt > 0 ? (rise - f.rise) / dt : 0;
    f.rise = rise;
    // Velocidade horizontal do tornozelo (chão): a perna que ainda varre para a frente não é apoio; a sola só conta
    // quando o pé já está quase parado no chão (senão o pé "pousa" a 10 m/s e desliza).
    const vx = dt > 0 ? (ankle.x - f.x) / dt : 0;
    const vz = dt > 0 ? (ankle.z - f.z) / dt : 0;
    const speed = Math.hypot(vx, vz);
    f.x = ankle.x;
    f.z = ankle.z;
    if (!Number.isFinite(sole.h)) return;
    const pushOff = dr > FlatPushOffRate && rise > 0.01;
    // Pé que anda de lado (o apoio do passo lateral do clipe escorrega no chão): não é corrigido.
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    const along = Math.abs(vx * fwd.x + vz * fwd.z);
    const across = Math.abs(vx * left.x + vz * left.z);
    const lateral = speed > FlatLateralMin && across > FlatLateralRatio * along;
    const want = enabled && !pushOff && !lateral && speed < FlatMaxSpeed && sole.h < FlatSoleMax * ProceduralScale ? 1 : 0;
    // Saída rápida quando o pé escorrega (de lado ou andando forte): a correção não pode seguir o pé deslizando.
    const outRate = speed > FlatMaxSpeed || lateral ? FlatSlipOutRate : FlatOutRate;
    f.w += (want - f.w) * (1 - Math.exp(-(want ? FlatInRate : outRate) * dt));
    const w = f.w * (1 - this.plantWeight());
    if (w < 1e-3) return;
    const scale = this.bone(`foot_${side}`).getWorldScale(new THREE.Vector3());
    // Pé plano no referencial do corpo (raiz x repouso). O yaw vem do eixo lateral do pé (o eixo em torno do qual ele
    // inclina na ponta): fica horizontal mesmo com o pé inclinado. (A direção horizontal da ponta virava 180° quando o
    // pé apontava para baixo, e o pé dava saltos de 56° num quadro.)
    const flatQ = this.root.getWorldQuaternion(new THREE.Quaternion()).multiply(this.restFootLocal[side]);
    const upL = new THREE.Vector3(0, 1, 0).applyQuaternion(this.restFootLocal[side].clone().invert());
    const fwdL = this.bone(`ball_${side}`).position.clone().normalize();
    const latL = fwdL.clone().cross(upL).normalize();
    const latFlat = latL.clone().applyQuaternion(flatQ).setY(0);
    const latClip = latL.clone().applyQuaternion(footQ).setY(0);
    if (latFlat.lengthSq() > 1e-6 && latClip.lengthSq() > 1e-6) {
      flatQ.premultiply(new THREE.Quaternion().setFromUnitVectors(latFlat.normalize(), latClip.normalize()));
    }
    // O pé gira em torno de um ponto fixo no chão: a articulação da ponta (ball_*, que o laboratório mede) quando a ponta
    // é o apoio, o tornozelo quando o calcanhar é (o peso vem da altura relativa, então a troca é contínua). Girar em torno
    // do tornozelo andava a ponta 4–5 cm em cada rotação (deslize nas laterais e no giro).
    const ballLocal = this.bone(`ball_${side}`).position.clone();
    const ballY = this.bone(`ball_${side}`).getWorldPosition(new THREE.Vector3()).y;
    // Ponta no chão (ball_* baixo) -> pivô na ponta; ponta no ar (calcanhar apoiado) -> pivô no tornozelo.
    const alpha = THREE.MathUtils.clamp((FlatPivotBand - ballY) / FlatPivotBand, 0, 1);
    const anchor = ballLocal.multiply(scale).multiplyScalar(alpha);
    const clipShift = anchor.clone().applyQuaternion(footQ);
    const flatShift = anchor.clone().applyQuaternion(flatQ);
    // Altura: o ponto mais baixo da sola plana fica na altura do mais baixo agora (no pé plano o calcanhar pode ser ele).
    let flatLow = Infinity;
    for (const p of sole.pts) flatLow = Math.min(flatLow, p.clone().multiply(scale).applyQuaternion(flatQ).y);
    // (A sola do clipe pode estar abaixo do chão: a ponta inclinada para baixo põe o bico 15 cm abaixo. O contato é no chão.)
    const flatAnkle = new THREE.Vector3(
      ankle.x + clipShift.x - flatShift.x,
      Math.max(sole.h, 0) - flatLow,
      ankle.z + clipShift.z - flatShift.z,
    );
    ankle.lerp(flatAnkle, w);
    footQ.slerp(flatQ, w);
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
    if (mode === 'hold') {
      // Size-up: o passo que o clipe pede fica dentro de uma base atlética (meia base de 15 a 42 cm, até 35 cm à frente
      // ou atrás). O entre as pernas e o behind the back da CMU abrem o pé a ~55 cm do centro, e em combo a base chegava a
      // 1,2 m (espacate).
      const inv = this.root.matrixWorld.clone().invert();
      for (const side of ['l', 'r'] as const) {
        const local = ideals[side].applyMatrix4(inv);
        const s = sideSign(side) > 0 ? 1 : -1;
        local.x = s * THREE.MathUtils.clamp(s * local.x, SizeUpHalfBase[0], SizeUpHalfBase[1]);
        local.z = THREE.MathUtils.clamp(local.z, -0.35, 0.35);
        ideals[side].copy(local).applyMatrix4(this.root.matrixWorld).setY(this.restAnkleY);
      }
    }
    // Base escalonada (DribbleFootwork): o entre as pernas parado põe o pé da mão que recebe à frente e o outro atrás,
    // os dois trocando de lugar ao mesmo tempo (tesoura) e pousando antes do quique. Em combo a base inverte a cada troca.
    // A base fica escalonada depois do drible (o size-up segue dela); some quando o jogador sai andando ou no escape.
    const cur = this.active && !this.active.fadingOut ? this.active : null;
    const btl = this.footworkEnabled && active && mode === 'hold' && cur?.kind === 'BetweenLegs';
    if (!this.footworkEnabled || !active || escape) this.stagger.front = null;
    const S = ProceduralScale;
    const splitWorld = (side: Hand, front: Hand, x: number | null, out: THREE.Vector3) => {
      const sp = splitFoot(side, front);
      return out
        .set(x ?? sp.x * S, 0, sp.z * S)
        .applyMatrix4(this.root.matrixWorld)
        .setY(this.restAnkleY);
    };
    if (btl && cur && this.scissorAction !== cur) {
      this.scissorAction = cur;
      const front = splitFrontFoot(cur.toHand);
      this.stagger.front = front;
      // Tempo até o quique (s): soltura do clipe + ~40% do caminho até a recepção (a descida da bola é mais curta).
      const toBounce = Math.max(0, cur.release - cur.action.time + 0.4 * (cur.catch - cur.release)) / Math.max(0.3, cur.rate);
      const seconds = scissorSeconds(toBounce);
      for (const side of ['l', 'r'] as const) {
        const f = p[side];
        f.from.copy(f.pos);
        splitWorld(side, front, null, f.to);
        f.t = 0;
        f.dur = seconds;
        f.lift = (side === front ? SplitStance.liftFront : SplitStance.liftRear) * S;
      }
      stepping = true;
    }
    if (this.stagger.front) {
      // Os pés ficam na base escalonada (largura também): sem isto o passinho de ajuste os levava de volta para o lado a
      // lado, e na saída do drible o pé ia até onde o clipe da CMU o abria (66 cm) e voltava.
      for (const side of ['l', 'r'] as const) splitWorld(side, this.stagger.front, null, ideals[side]);
    }
    if (!active && !(this.active && !this.active.fadingOut)) {
      // Saindo da base (o jogador começou a andar): o pé não fica pregado onde estava enquanto o peso cai, ele vem junto
      // com a passada. Antes ficava para trás e a perna chutava para trás com o calcanhar para cima por ~10 quadros.
      const k = 1 - Math.exp(-16 * dt);
      for (const [side, ankle] of [
        ['l', ankleL],
        ['r', ankleR],
      ] as const) {
        p[side].pos.lerp(ideals[side], k);
        p[side].pos.y = this.restAnkleY;
        p[side].t = 1;
        ankle.lerp(p[side].pos, this.plantWeight());
      }
      return this.plantBlend > 0.5;
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
      // No size-up os pés ficam pregados, mas se o corpo levou o quadril longe (a hesitação da CMU anda) o pé dá o passo:
      // antes a perna de trás esticava num avanço enorme.
      const limit = mode === 'hold' ? HoldStepLimit : threshold;
      if (f.t >= 1 && !stepping && gap(side) > limit) {
        f.from.copy(f.pos);
        f.to.copy(ideal);
        f.t = 0;
        stepping = true;
      }
      if (f.t < 1) {
        f.t = Math.min(1, f.t + dt / (f.dur || stepSeconds));
        if (f.dur) {
          // Tesoura: smootherstep (pousa sem tranco) e altura própria de cada pé.
          const st = scissorStep(f.t, f.lift);
          f.pos.lerpVectors(f.from, f.to, st.travel);
          f.pos.y = this.restAnkleY + st.height;
        } else {
          const s = f.t * f.t * (3 - 2 * f.t);
          f.pos.lerpVectors(f.from, f.to, s);
          f.pos.y = this.restAnkleY + 0.09 * Math.sin(Math.PI * f.t); // passo de verdade: a ponta sai do chão
        }
        if (f.t >= 1) {
          f.pos.y = this.restAnkleY;
          // O pé da frente pousou: os joelhos absorvem o peso (a mola do quadril recebe um impulso para baixo).
          if (f.dur && side === this.stagger.front) this.weight.kick(-SplitStance.landingKick * S);
          f.dur = 0;
        }
      }
      ankle.lerp(f.pos, this.plantWeight());
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
    // Alturas da ponta do pé calibradas no jogador de 1,96 m: escalam com a altura (o tênis e a passada encolhem junto).
    const S = ProceduralScale;
    const brake = descending && alongStride ? 1 - THREE.MathUtils.smoothstep(toeY, 0.04 * S, 0.085 * S) : 0;
    const planted = toeY < 0.055 * S && (animSpeed < 1.2 || brake > 0.5);
    if (!enabled) {
      f.locked = false;
      f.releaseT = 1;
      f.land.set(0, 0, 0);
      return;
    }
    if (f.locked) {
      const stretch = Math.hypot(ankle.x - f.pos.x, ankle.z - f.pos.z);
      if (!planted || toeY > 0.075 * S || stretch > 0.32 * S) {
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
      if (toeY < 0.05 * S && animSpeed > 1.5) ankle.y += Math.min(0.05 * S, (animSpeed - 1.5) * 0.02) * (1 - toeY / (0.05 * S));
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
    const want = palm.clone().lerp(palmTarget, weight);
    const goal = want.clone().sub(palm).add(wristPos); // mesmo deslocamento no punho
    solveTwoBoneIK(upper, lower, wrist, goal, pole, ArmSoftReach);
    applyPole(upper, lower, goal, pole, weight);
    // A palma fica ~10 cm à frente do punho e gira junto com o antebraço (no IK e no giro do cotovelo pelo pole): a
    // primeira passada errava o alvo em até 16 cm. A segunda corrige com o deslocamento já girado; o plano do cotovelo
    // fica o que o pole escolheu (com o pole depois dela, o giro tirava a palma 12–15 cm do alvo de novo).
    const palm2 = new THREE.Vector3();
    // Número fixo de passadas: parar quando o erro fica abaixo de 1 cm fazia um quadro rodar 1 passada e o seguinte 2, e o
    // braço tremia ~1 cm (estalos no drible parado).
    for (let i = 0; i < 3; i++) {
      this.palmWorld(hand, palm2);
      wrist.getWorldPosition(wristPos);
      goal.copy(want).sub(palm2).add(wristPos);
      solveTwoBoneIK(upper, lower, wrist, goal, pole, ArmSoftReach);
    }
  }

  /** Gira a mão no punho para a direção punho -> dedos virar `dir` (mundo), com peso. */
  private aimHand(hand: Hand, dir: THREE.Vector3, weight: number): void {
    if (weight <= 1e-3) return;
    const wrist = this.bone(`hand_${hand}`);
    const cur = this.bone(`fingers_${hand}`).getWorldPosition(new THREE.Vector3()).sub(wrist.getWorldPosition(new THREE.Vector3()));
    if (cur.lengthSq() < 1e-8) return;
    const swing = new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(cur.normalize(), dir.clone().normalize()), Math.min(1, weight));
    const world = wrist.getWorldQuaternion(new THREE.Quaternion());
    wrist.quaternion.copy(wrist.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(swing.multiply(world)));
    wrist.updateWorldMatrix(false, true);
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
    // Pé no meio de um passo (a tesoura): onde ele vai pousar, que é onde ele está quando a bola passa.
    const foot = (side: Hand) => {
      const f = this.plant[side];
      return (planted ? (f.t < 1 ? f.to : f.pos).clone() : this.bone(`foot_${side}`).getWorldPosition(new THREE.Vector3())).applyMatrix4(inv);
    };
    const l = foot('l');
    const r = foot('r');
    const split = planted && this.stagger.front === toHand;
    const floorLocal = l.clone().add(r).multiplyScalar(0.5).setY(0);
    floorLocal.z += split ? SplitStance.floorAhead * ProceduralScale : BetweenLegsFloorAhead;
    // Recepção no caminho do drible da mão nova (à frente da ponta do pé): ao lado do joelho, como antes, a bola entrava
    // na perna e o desvio jogava a bola 30 cm de um quadro para o outro e a mão 14 cm no fim do drible.
    const catchLocal = this.crossCatch(toHand);
    if (split) {
      // Base escalonada: o pé da mão nova está à frente, e a bola subindo para a frente da ponta dele cruzaria a canela. A
      // mão recebe por fora do joelho da frente (Kyrie, LZSlFyyCkhk 165,1 s) e leva a bola à frente depois, pelo loop.
      const frontFoot = toHand === 'l' ? l : r;
      catchLocal.x = frontFoot.x + sideSign(toHand) * SplitStance.catchOutside * ProceduralScale;
      catchLocal.z = frontFoot.z + SplitStance.catchAhead * ProceduralScale;
    }
    return { floorLocal, catchLocal };
  }

  private tweenCatch: { action: ActiveAction; hand: Hand; local: THREE.Vector3 } | null = null;

  /** Pose crua que o mixer deixou nos ossos (antes do pós-processo), por osso: posição, rotação e escala. */
  private mixerPose: { bone: THREE.Bone; p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] | null = null;
  private saveMixerPose(): void {
    if (!this.mixerPose) {
      this.mixerPose = [...this.bones.values()].map((bone) => ({ bone, p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() }));
    }
    for (const m of this.mixerPose) {
      m.p.copy(m.bone.position);
      m.q.copy(m.bone.quaternion);
      m.s.copy(m.bone.scale);
    }
  }
  /** Laboratório: desliga a inertialization na troca de loop com a camada das pernas (para comparar). */
  blendLegSwitch = true;
  /** Laboratório: desliga a volta da pose crua do mixer (para comparar). */
  restoreMixerEnabled = true;
  private restoreMixerPose(): void {
    if (!this.mixerPose || !this.restoreMixerEnabled) return;
    for (const m of this.mixerPose) {
      m.bone.position.copy(m.p);
      m.bone.quaternion.copy(m.q);
      m.bone.scale.copy(m.s);
    }
  }

  /**
   * Drible que começou com a bola ainda subindo (Freestyle.ballReadyForMove): a mão da bola vai buscá-la, palma por cima,
   * em vez de pular para a pose do clipe e deixar a bola correr atrás dela. Quando a bola chega, a mão segura onde a
   * pegou (handHold) e passa para o clipe devagar. Fora: os procedurais (a bola vai direto para o caminho deles) e o spin
   * (o corpo gira enquanto a mão busca a bola; a mão saltava 23 cm na recepção).
   */
  private applyReachForBall(dt: number): void {
    const a = this.active && !this.active.fadingOut ? this.active : null;
    const R = this.ballReach;
    const waiting =
      !!a &&
      a.kind !== 'Shot' &&
      a.kind !== 'Celebrate' &&
      !a.released &&
      !a.timing?.procedural &&
      !a.timing?.turnDeg &&
      this.hasBall &&
      !this.ballInHand;
    if (waiting) {
      R.hand = a.fromHand;
      R.w += (1 - R.w) * (1 - Math.exp(-BallReachRate * dt));
    } else {
      if (R.w > 0.02) this.handHold[R.hand] = { local: this.lastPalmModel[R.hand].clone(), w: R.w };
      R.w = 0;
      return;
    }
    const palm = this.ballWorld.clone().add(v.set(0, BallRadius * 1.02, 0));
    const pole = new THREE.Vector3(sideSign(R.hand), -0.3, -0.8).transformDirection(this.root.matrixWorld);
    this.reachPalm(R.hand, palm, R.w, pole);
  }

  /** Mão que saiu de um IK quando um drible novo começou: segura a última posição (referencial da malha) e solta devagar. */
  private readonly handHold: Record<Hand, { local: THREE.Vector3; w: number } | null> = { l: null, r: null };
  private applyHandHold(dt: number): void {
    for (const hand of ['l', 'r'] as const) {
      const h = this.handHold[hand];
      if (!h) continue;
      h.w *= Math.exp(-HandHoldRate * dt);
      if (h.w < 0.01) {
        this.handHold[hand] = null;
        continue;
      }
      const pole = new THREE.Vector3(sideSign(hand), -0.3, -0.8).transformDirection(this.root.matrixWorld);
      this.reachPalm(hand, h.local.clone().applyMatrix4(this.model.matrixWorld), h.w, pole);
    }
  }

  /** Inclinação média do tronco para a frente (graus, pelve -> pescoço) de cada clipe de drible, medida no carregamento. */
  readonly clipPitch = new Map<string, number>();
  private measureClipPitch(): void {
    const probe = cloneSkinned(this.model);
    const holder = new THREE.Group();
    holder.add(probe);
    const find = (name: string) => {
      let found: THREE.Object3D | undefined;
      probe.traverse((o) => {
        if (!found && o.name === name) found = o;
      });
      return found;
    };
    const pelvis = find('pelvis');
    const neck = find('neck_01');
    if (!pelvis || !neck) return;
    const mixer = new THREE.AnimationMixer(probe);
    const ranges: [string, number, number][] = [['Dribble_Idle_R', 0, (this.clips['Dribble_Idle_R']?.frames ?? 2) - 1]];
    for (const t of Object.values(MoveTimings)) ranges.push([t.clip, t.start * ClipFps, t.end * ClipFps]);
    for (const loop of ['Dribble_Walk_R', 'Dribble_Run_R', 'Dribble_Low_R', 'Dribble_Side_R', 'Dribble_Back_R']) {
      ranges.push([loop, 0, (this.clips[loop]?.frames ?? 2) - 1]);
    }
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const [name, f0, f1] of ranges) {
      const action = this.actions.get(name);
      if (!action || this.clipPitch.has(name)) continue;
      const sampler = mixer.clipAction(action.getClip());
      sampler.play();
      let sum = 0;
      const n = 12;
      for (let i = 0; i < n; i++) {
        sampler.time = (f0 + ((f1 - f0) * (i + 0.5)) / n) / ClipFps;
        mixer.update(0);
        holder.updateMatrixWorld(true);
        pelvis.getWorldPosition(a);
        neck.getWorldPosition(b).sub(a);
        sum += THREE.MathUtils.radToDeg(Math.atan2(b.z, b.y));
      }
      sampler.stop();
      this.clipPitch.set(name, sum / n);
    }
  }

  private readonly pelvisCache = new Map<string, number>();
  /** Altura média da pelve (referencial do jogador, m) de um clipe entre dois quadros (sem o pós-processo). */
  private pelvisAvg(clip: string, f0: number, f1: number): number {
    const key = `${clip}:${f0.toFixed(1)}:${f1}`;
    const cached = this.pelvisCache.get(key);
    if (cached !== undefined) return cached;
    const info = this.clips[clip];
    if (!info) return 0;
    const a = Math.max(0, Math.floor(f0));
    const b = Math.min(info.frames - 1, Math.ceil(f1));
    let sum = 0;
    for (let f = a; f <= b; f++) sum += info.pelvis[f][1];
    const y = (sum / Math.max(1, b - a + 1)) * this.scale + this.model.position.y;
    this.pelvisCache.set(key, y);
    return y;
  }

  /** Põe o loop da base na recepção da mão (a bola acabou de chegar nela): o próximo empurrão vem no ritmo. */
  private restartLoopAtCatch(hand: Hand): void {
    if (!this.base.name.startsWith('Dribble_') || !this.base.name.endsWith(hand.toUpperCase())) return;
    const action = this.actions.get(this.base.name);
    const contact = this.contactOf(this.base.name);
    if (!action || !contact?.catch.length) return;
    action.time = contact.catch[0] / ClipFps;
    this.prevTimes.set(this.base.name, action.time);
    if (this.legLayer.clip === this.base.name) this.legLayer.time = action.time;
  }

  /** Centro da bola na recepção do crossover: a recepção do loop da mão nova (o mesmo caminho em que ela vai driblar). */
  private crossCatch(toHand: Hand): THREE.Vector3 {
    const base = this.base.base.startsWith('Dribble_') && this.base.base !== 'Dribble_Side' ? this.base.base : 'Dribble_Idle';
    const clip = loopClip(base, toHand);
    const info = this.clips[clip] ?? this.clips[loopClip('Dribble_Idle', toHand)];
    const palm = this.palmLocal(info, toHand, 0);
    this.lowDribblePalm(this.clips[clip] ? clip : loopClip('Dribble_Idle', toHand), toHand, palm, DribbleContact.catch);
    palm.y -= BallRadius * 1.02;
    return palm;
  }

  /** Centro da bola na recepção do drible parado de uma mão (referencial do jogador, alturas de jogador bom). */
  private receivingDribblePalm(hand: Hand): THREE.Vector3 {
    const clip = loopClip('Dribble_Idle', hand);
    const info = this.clips[clip];
    const peaks = hand === 'r' ? info.peaks_r : info.peaks_l;
    const palm = this.palmLocal(info, hand, peaks[0] ?? 0).applyAxisAngle(axis.set(0, 1, 0), -this.model.rotation.y);
    this.lowDribblePalm(clip, hand, palm, DribbleContact.catch);
    palm.y -= BallRadius * 1.02;
    return palm;
  }
  private tweenArmWeight = 0;

  /** Entre as pernas: depois da soltura, a mão que recebe desce para o ponto de recepção (por fora do joelho, baixo). */
  private applyBetweenLegsArm(dt: number): void {
    const cur = this.active;
    if (cur && TweenMoves.has(cur.kind) && !cur.fadingOut && this.hasBall && this.tweenCatch?.action !== cur) {
      // Começo do drible: o ponto de recepção já é conhecido (a soltura usa o mesmo).
      const local = cur.kind === 'BetweenLegs' ? this.betweenLegsPath(cur.toHand).catchLocal : this.crossCatch(cur.toHand);
      this.tweenCatch = { action: cur, hand: cur.toHand, local };
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
  /** Laboratório: o desvio da perna da mão da bola vale já no 1º quadro de um drible (false = como antes, ~70 ms depois). */
  clearanceAtMoveStart = true;

  /** A mão da bola contorna as pernas: se a bola presa sob a palma entraria numa perna, a palma vai para fora dela. */
  private applyBallClearance(dt: number, input: AnimInput): void {
    const a = this.active && !this.active.fadingOut ? this.active : null;
    for (const hand of ['l', 'r'] as const) {
      // A mão num caminho desenhado (drible do loop, recepção do crossover/entre as pernas) já passa fora das pernas: o
      // desvio por cima dela só brigava com o IK (e saltava quando o braço passava a alcançar).
      // Com um drible começando, o peso do IK do loop ainda cai (~70 ms acima de 0,5) mas a mão já é a do clipe: ali o
      // desvio vale (com o dwell da mão mais dribles começam com a bola na mão, e ela entrava 2–5 cm na coxa).
      const designed =
        (this.dribbleArmWeight[hand] > 0.5 && (!a || !this.clearanceAtMoveStart)) ||
        (this.tweenCatch?.hand === hand && this.tweenArmWeight > 0.5);
      const holding =
        this.ballClearanceEnabled &&
        !designed &&
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
      if (hand !== A.hand) {
        // A mão livre virou a da bola (recepção): ela não sai do IK de uma vez (saltava 23 cm com a bola).
        if (A.w > 0.02) this.handHold[A.hand] = { local: this.lastPalmModel[A.hand].clone(), w: A.w };
        A.w = 0;
      }
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

  /**
   * Braço livre de guarda: no drible, a mão sem bola fica à frente do quadril, cotovelo dobrado (protege a bola do
   * defensor), como no 2K23 e no Kyrie. Os clipes da CMU deixavam esse braço solto e, na hesitação, jogado reto para trás.
   * Fica de fora: a mão que vai receber a bola (até a recepção), o spin (braço baixo próprio) e o behind the back.
   */
  private readonly guardArm = { l: 0, r: 0 };
  private applyGuardArm(dt: number): void {
    const a = this.active && !this.active.fadingOut ? this.active : null;
    let free: Hand | null = null;
    let target = 0;
    if (!this.guardArmEnabled) {
      free = null;
    } else if (this.hasBall && !a && this.base.name.startsWith('Dribble_')) {
      free = this.base.name.endsWith('_L') ? 'r' : 'l';
      target = GuardArm.loopWeight;
    } else if (this.hasBall && a && a.kind !== 'Shot' && a.kind !== 'Celebrate' && !a.timing?.turnDeg && a.timing?.procedural !== 'BehindBack') {
      if (a.fromHand === a.toHand) {
        free = otherSide(a.fromHand);
        target = GuardArm.moveWeight;
      } else {
        const caught = a.released && (a.timing?.procedural ? this.progress(a) >= a.catch : a.action.time >= a.catch);
        if (caught) {
          free = a.fromHand;
          target = GuardArm.moveWeight;
        }
      }
    }
    const k = 1 - Math.exp(-GuardArm.rate * dt);
    const pelvis = this.bone('pelvis').getWorldPosition(new THREE.Vector3());
    const bodyQ = this.model.getWorldQuaternion(new THREE.Quaternion());
    for (const hand of ['l', 'r'] as const) {
      this.guardArm[hand] += ((hand === free ? target : 0) - this.guardArm[hand]) * k;
      const w = this.guardArm[hand];
      if (w < 1e-3) continue;
      const side = sideSign(hand);
      const palm = new THREE.Vector3(side * GuardArm.outside, GuardArm.up, GuardArm.forward).applyQuaternion(bodyQ).add(pelvis);
      const pole = new THREE.Vector3(side, -0.2, -0.7).applyQuaternion(bodyQ);
      this.reachPalm(hand, palm, w, pole);
    }
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
    const dribbling = this.lowDribbleEnabled && this.hasBall && this.base.name.startsWith('Dribble_') && !a;
    const kw = 1 - Math.exp(-10 * dt);
    const baseHand: Hand = this.base.name.endsWith('_L') ? 'l' : 'r';
    // Fim de um drible: a mão da bola entra no caminho do loop já com peso total, partindo de onde está (o desvio some em
    // DribbleMoveExit). Com o peso subindo de 0, a mão ficava ~0,3 s na pose do fim do clipe (no crossover, entre os
    // joelhos) e a bola se soltava dela para sair da perna.
    const moveEnded = this.hadMove && dribbling;
    this.hadMove = !!a && a.kind !== 'Shot' && a.kind !== 'Celebrate';
    if (moveEnded) {
      this.dribbleArmWeight[baseHand] = 1;
      this.dribbleTarget.clip = '';
      this.dribbleExit = true;
      // A mão da bola é do loop agora: os IKs do fim do drible (recepção, behind the back) não puxam mais por ela.
      if (this.tweenCatch?.hand === baseHand) this.tweenCatch = null;
      if (this.btbFade) for (const arm of [this.btbFade.from, this.btbFade.other]) if (arm.hand === baseHand) arm.w = 0;
    }
    for (const hand of ['l', 'r'] as const) {
      if (hand !== baseHand && this.dribbleArmWeight[hand] > 0.01) {
        // A bola mudou de mão: a mão que driblava segura onde estava e solta devagar (com o alvo do drible recalculado em
        // cima da pose do clipe novo ela saltava 15 cm num quadro).
        this.handHold[hand] = { local: this.lastPalmModel[hand].clone(), w: this.dribbleArmWeight[hand] };
        this.dribbleArmWeight[hand] = 0;
        continue;
      }
      const target = dribbling && hand === baseHand ? 1 - this.actionWeight : 0;
      this.dribbleArmWeight[hand] += (target - this.dribbleArmWeight[hand]) * kw;
      const w = this.dribbleArmWeight[hand];
      if (w <= 1e-3) continue;
      const inv = toWorld.clone().invert();
      const local = this.palmWorld(hand, new THREE.Vector3()).applyMatrix4(inv);
      // Altura pela curva desenhada da mão no ritmo do loop (a da pose atual vinha abaixada pelo agachamento e pela dobra
      // do quadril, e a faixa da mão encolhia de 25 para 4 cm). A mão que acabou de entregar a bola (depois de um
      // crossover) só sai do IK: mantém a altura atual.
      const h = hand === baseHand ? this.handShapeNow(this.base.name, hand) : null;
      this.lowDribblePalm(this.base.name, hand, local, h);
      if (h !== null) {
        // Troca de loop (andando -> correndo...): a faixa e o ponto da mão mudam; a diferença some em ~0,2 s.
        const D = this.dribbleTarget;
        if (this.dribbleExit) {
          // Saindo de um drible: parte da palma atual.
          this.dribbleExit = false;
          D.offset.copy(this.lastPalmLocal[hand]).sub(local);
          D.t = 0;
          D.duration = this.stance.moveExit;
        } else if (D.clip && D.clip !== this.base.name) {
          D.offset.copy(D.last).sub(local);
          D.t = 0;
          D.duration = DribbleRetarget;
        }
        D.clip = this.base.name;
        D.t += dt;
        if (D.t < D.duration) {
          const u = D.t / D.duration;
          local.addScaledVector(D.offset, 1 - u * u * (3 - 2 * u));
        }
        D.last.copy(local);
      }
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
