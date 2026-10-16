// Bandejas: catálogo, escolha (comando + contexto) e o PLANO de cada bandeja — passadas presas ao chão, decolagem,
// voo balístico, soltura e aterrissagem. Puro (sem three.js nem DOM): o Freestyle move o jogador pelo plano e o
// animador desenha o corpo em cima dele (src/anim/LayupMotion.ts). Desenho e fontes em docs/21-bandejas.md.
//
// Como a bandeja de verdade funciona (o que este arquivo reproduz):
//  - Gather: o jogador pega a bola com as duas mãos. O pé que está no chão nessa hora é o "zero step" (regra 10, seção
//    XIII da NBA, esclarecida em 2019: depois do gather valem DOIS passos). Passo 1 = o próximo pé que pisa; passo 2 = o
//    outro, que é o da decolagem.
//  - Penúltimo passo mais longo e mais baixo, último mais curto e plantado à frente do corpo: o centro de massa desce no
//    penúltimo e o último converte velocidade horizontal em vertical (padrão medido no salto em distância, relatório
//    biomecânico do Mundial de Londres 2017; no salto de uma perna do basquete a corrida no ritmo preferido converte
//    melhor do que a corrida rápida, Applied Sciences 10(1):309, 2020).
//  - Bandeja natural: decola com o pé OPOSTO à mão (direita = pé esquerdo, joelho direito sobe com a bola). "Wrong foot"
//    (mesmo pé e mesma mão) é a do Kyrie/Ja: um tempo mais cedo, tira o ritmo do protetor de aro.
//  - Voo balístico: a velocidade horizontal da decolagem continua até a aterrissagem (o corpo não para no ar).
// Coordenadas do núcleo: SI, Z para cima, eixos da Unreal (direita = up × frente). Tempos do plano em segundos desde o
// gather (t = 0).
import { DefaultGravity, Vec3, clamp, upVector } from './HoopsMath';
import type { Rng } from './HoopsRandom';
import { ShotType } from './HoopsShotModel';

export type Side = 'l' | 'r';
export const otherSideOf = (s: Side): Side => (s === 'l' ? 'r' : 'l');

/** Como o jogador junta a bola e dá os passos (desacoplado da finalização, como no motor de bandejas do 2K). */
export enum LayupGather {
  /** 1-2: zero step no gather, passo 1, passo 2 (decolagem). */
  Normal,
  /** Um passo só depois do gather: decola no primeiro pé que pisa (mais rápida e mais curta). */
  OneStep,
  /** Euro step: passo 1 para um lado, passo 2 cruzando para o outro. */
  Euro,
  /** Hop step: um pé empurra, os dois pousam juntos (jump stop) e o jogador sobe com os dois. */
  Hop,
  /** Pro hop: o hop vai para o lado (troca de faixa), pousa nos dois pés e sobe. */
  ProHop,
  /** Cradle: a bola é embalada baixa no braço, protegida do lado oposto ao defensor; passadas normais. */
  Cradle,
}

/** Como a bola sai da mão. */
export enum LayupFinish {
  /** Por cima, palma para a tabela, no alto do vidro (a bandeja "de manual"). */
  Overhand,
  /** Por baixo, palma para cima, braço esticado: a bola rola dos dedos. */
  FingerRoll,
  /** Por baixo, saindo baixa, rápida (o "quick scoop" do 2K23). */
  Scoop,
  /** Jelly: finger roll exagerado, braço aberto longe do corpo, punho virando no fim; alto no vidro. */
  Jelly,
  /** Reversa: passa por baixo do aro e solta do outro lado (o aro protege). */
  Reverse,
  /** Floater: sobe cedo e solta subindo, arco alto, de longe do aro (2–3,5 m). */
  Floater,
  /** De força: duas mãos, depois do hop (dois pés). */
  Power,
  // Enterradas (docs/21-bandejas.md §9): as mesmas passadas, a bola é empurrada por cima do aro.
  /** Enterrada de uma mão, braço esticado por cima do aro. */
  DunkOneHand,
  /** Enterrada de duas mãos, a bola acima da cabeça. */
  DunkTwoHand,
  /** Tomahawk: uma mão, a bola vai para trás da cabeça no alto e desce como um machado. */
  Tomahawk,
  /** Cock-back de duas mãos: a bola atrás da cabeça com as duas e desce forte. */
  CockBack,
  /** Moinho (windmill): a bola desce pelo quadril, passa por trás e volta por cima num círculo. */
  Windmill,
}

/** Finalizações que são enterrada. */
export const isDunkFinish = (f: LayupFinish): boolean => f >= LayupFinish.DunkOneHand;
/** Enterrada com as duas mãos na bola até a soltura (e no aro, pendurado). */
export const isTwoHandDunk = (f: LayupFinish): boolean => f === LayupFinish.DunkTwoHand || f === LayupFinish.CockBack;

export const LayupGatherLabels: Record<LayupGather, string> = {
  [LayupGather.Normal]: 'Bandeja',
  [LayupGather.OneStep]: 'Bandeja de um passo',
  [LayupGather.Euro]: 'Euro step',
  [LayupGather.Hop]: 'Hop step',
  [LayupGather.ProHop]: 'Pro hop',
  [LayupGather.Cradle]: 'Cradle',
};

export const LayupFinishLabels: Record<LayupFinish, string> = {
  [LayupFinish.Overhand]: 'por cima',
  [LayupFinish.FingerRoll]: 'finger roll',
  [LayupFinish.Scoop]: 'scoop',
  [LayupFinish.Jelly]: 'jelly',
  [LayupFinish.Reverse]: 'reversa',
  [LayupFinish.Floater]: 'floater',
  [LayupFinish.Power]: 'de força',
  [LayupFinish.DunkOneHand]: 'enterrada de uma mão',
  [LayupFinish.DunkTwoHand]: 'enterrada de duas mãos',
  [LayupFinish.Tomahawk]: 'tomahawk',
  [LayupFinish.CockBack]: 'cock-back de duas mãos',
  [LayupFinish.Windmill]: 'moinho',
};

export interface LayupChoice {
  gather: LayupGather;
  finish: LayupFinish;
  /** Mão da soltura. */
  hand: Side;
  /** Tabela (true) ou direto no aro. */
  glass: boolean;
}

/** O comando do jogador (docs/02-controles.md §1, igual ao 2K23). */
export type LayupCommand =
  | 'auto' // X segurado ou RS para cima: o contexto escolhe
  | 'hop' // toque no X dirigindo / RS mesma direção 2x
  | 'proHop' // hop para o lado (side)
  | 'euro' // X 2x com LS para a mão livre / RS switchback da mão da bola para a livre
  | 'cradle' // X 2x com LS para a mão da bola / RS switchback ao contrário / LT
  | 'floater' // RS segurado para baixo
  | 'scoop' // RS segurado para o lado (side = a mão)
  | 'reverse' // RS segurado para a mão do lado da linha de fundo
  | 'dunk'; // RT + X perto do aro: o contexto (velocidade, pés, sorteio) escolhe a enterrada

export interface LayupRequest {
  command: LayupCommand;
  /** scoop: a mão; proHop: o lado do hop; euro: o lado em que o segundo passo termina; dunk: a mão (uma mão). */
  side?: Side;
  sprint: boolean;
  /** dunk: a enterrada pedida pelo RS (a habilidade pode trocar por uma mais simples). */
  finish?: LayupFinish;
}

/**
 * O que a build deixa enterrar (2K: requisitos de Driving Dunk, Standing Dunk e Vertical). Com a build padrão (DD 80,
 * SD 45, Vert 70) vale tudo e a subida máxima é a de sempre.
 */
export interface DunkAbility {
  /** Enterra correndo (senão é bandeja). */
  driving: boolean;
  /** Enterra parado, de dois pés. */
  standing: boolean;
  /** Tomahawk e cock-back; moinho. */
  flashy: boolean;
  windmill: boolean;
  /** Fica pendurado no aro (2K: "Hangs Off One"). */
  hang: boolean;
  /** Subida máxima do centro de massa (m): a impulsão. */
  riseMax: number;
}

export const DunkRequirements = {
  /** Enterrar correndo e pendurar: o pacote mais simples do 2K26, "Hangs Off One" (o mesmo do BuildRatings.DunkMinimum). */
  driving: { dunk: 55, vertical: 35 },
  standing: 40,
  flashy: 70,
  windmill: { dunk: 78, vertical: 65 },
  hang: { dunk: 55, vertical: 35 },
  /** Impulsão de referência (a da build padrão): com ela a subida máxima é DunkTuning.riseMax. */
  verticalRef: 70,
};

/** Habilidade de enterrar a partir dos atributos (0–99). */
export function dunkAbility(drivingDunk: number, standingDunk: number, vertical: number): DunkAbility {
  const R = DunkRequirements;
  const jump = (v: number) => 0.85 + (0.3 * (clamp(v, 25, 99) - 25)) / 74;
  return {
    driving: drivingDunk >= R.driving.dunk && vertical >= R.driving.vertical,
    standing: standingDunk >= R.standing,
    flashy: drivingDunk >= R.flashy,
    windmill: drivingDunk >= R.windmill.dunk && vertical >= R.windmill.vertical,
    hang: drivingDunk >= R.hang.dunk && vertical >= R.hang.vertical,
    riseMax: (DunkTuning.riseMax * jump(vertical)) / jump(R.verticalRef),
  };
}

/** Troca a enterrada pela mais simples que a habilidade permite (moinho -> tomahawk -> uma mão; cock-back -> duas mãos). */
export function allowedDunk(finish: LayupFinish, ability: DunkAbility | undefined): LayupFinish {
  if (!ability) return finish;
  let f = finish;
  if (f === LayupFinish.Windmill && !ability.windmill) f = LayupFinish.Tomahawk;
  if ((f === LayupFinish.Tomahawk || f === LayupFinish.CockBack) && !ability.flashy) {
    f = f === LayupFinish.CockBack ? LayupFinish.DunkTwoHand : LayupFinish.DunkOneHand;
  }
  return f;
}

/** Pacote de bandejas (estilo): pesos da finalização escolhida pelo contexto no comando 'auto'. */
export interface LayupStyle {
  name: string;
  /** Pesos [por cima, finger roll, jelly] numa bandeja de lado (com tabela). */
  angled: [number, number, number];
  /** Pesos [finger roll, jelly, por cima] de frente para o aro. */
  straight: [number, number, number];
  /** Aceita decolar com o pé da mão (wrong foot) quando o passo cai assim, em vez de trocar o pé. */
  wrongFootOk: boolean;
}

export const LayupStyles: Record<'padrao' | 'kyrie', LayupStyle> = {
  padrao: { name: 'Padrão', angled: [0.65, 0.35, 0], straight: [0.7, 0, 0.3], wrongFootOk: false },
  // Kyrie: finger roll e jelly altos no vidro, mão de dentro, decolagem com o pé "errado" (Attention to Detail, 9:18–12:42).
  kyrie: { name: 'Kyrie', angled: [0.25, 0.4, 0.35], straight: [0.45, 0.45, 0.1], wrongFootOk: true },
};

export interface LayupFoot {
  /** Tornozelo projetado no chão (z ignorado). */
  pos: Vec3;
  /** Está apoiado agora. */
  planted: boolean;
}

export interface LayupSituation {
  /** Jogador (raiz, no chão). */
  position: Vec3;
  /** Velocidade horizontal. */
  velocity: Vec3;
  facing: Vec3;
  /** Aro projetado no chão e a frente da cesta (da tabela para a quadra). */
  rimFloor: Vec3;
  hoopForward: Vec3;
  ballHand: Side;
  feet: { l: LayupFoot; r: LayupFoot };
  /** Altura do jogador (m). */
  heightM: number;
  /** Linha de fundo (x do núcleo); o voo não termina fora da quadra. */
  baselineX: number;
  /** Topo do aro (m); 3,05 se não vier. A enterrada sobe o quanto precisa para a bola passar por cima dele. */
  rimHeightM?: number;
  /** O que a build deixa enterrar (sem isto: tudo, com a subida máxima de DunkTuning). */
  dunk?: DunkAbility;
}

/**
 * Pendurado no aro depois da enterrada (X segurado, como no 2K): as mãos agarram a frente do aro, o corpo fica embaixo
 * delas balançando e cai quando o X é solto (ou no tempo máximo). Tempos em s desde o gather.
 */
export interface LayupHang {
  /** As mãos chegam ao aro; o corpo para de voar e assenta embaixo delas. */
  grabAt: number;
  /** Solta o aro (o X foi solto ou passou o máximo): queda livre até o pouso. */
  dropAt: number;
  /** Centro de massa no chão e altura (relativa a de pé) com o corpo pendurado. */
  pos: Vec3;
  z: number;
  /** Para onde o corpo olha pendurado (para a tabela) e o balanço do corpo nessa direção. */
  facing: Vec3;
  /** Pontos do aro em que as palmas agarram (núcleo, 3D): um ou dois. */
  grips: Vec3[];
  twoHands: boolean;
}

/** Contato de um pé com o chão: pé parado em `pos` de `on` a `off` (s desde o gather). */
export interface LayupContact {
  foot: Side;
  on: number;
  off: number;
  pos: Vec3;
  /** Para onde a ponta do pé aponta (horizontal). */
  dir: Vec3;
  role: 'zero' | 'step1' | 'step2' | 'hop' | 'land';
}

export interface LayupPlan {
  choice: LayupChoice;
  /** Pé da decolagem, ou 'both' (hop, pro hop). */
  takeoffFoot: Side | 'both';
  /** Joelho que sobe no voo (o do lado da mão na bandeja natural); null nos dois pés. */
  driveKnee: Side | null;
  /** Decolou com o pé da mesma mão (mesmo pé, mesma mão). */
  wrongFoot: boolean;
  /** Quantos passos depois do gather (1 ou 2; o hop conta como 1). */
  steps: number;
  /** Um passo a mais antes do gather para trocar o pé da decolagem (o gather cai no passo seguinte). */
  extraStep: boolean;
  contacts: LayupContact[];
  /** Escala do tempo das passadas (1 = ritmo da corrida; >1 passos mais longos). */
  stride: number;
  /** s: decolagem, ápice, soltura, aterrissagem e fim (de pé, pronto). */
  takeoffAt: number;
  apexAt: number;
  releaseAt: number;
  landAt: number;
  endAt: number;
  /** Centro de massa na decolagem (no chão) e velocidades. */
  takeoffPos: Vec3;
  takeoffDir: Vec3;
  takeoffSpeed: number;
  vz0: number;
  /** Subida do centro de massa (m) acima da altura da decolagem. */
  rise: number;
  /** Centro da bola na soltura (3D) e quanto a bola fica à frente do corpo nessa hora. */
  release: Vec3;
  reach: number;
  landPos: Vec3;
  /** Distância ao aro (centro, no chão) na soltura. */
  releaseDistance: number;
  /** Curva do centro de massa até a decolagem (Bézier cúbica por trechos no chão: 3n + 1 pontos) e o comprimento. */
  path: Vec3[];
  pathLength: number;
  /** Comprimentos acumulados da curva (para andar nela por distância). */
  arc: number[];
  /** Velocidade (m/s) ao longo da curva: [t, v] lineares por partes até a decolagem. */
  speedKeys: [number, number][];
  /** Altura do centro de massa em relação a de pé: [t, z, vz] (Hermite) até a decolagem e depois da aterrissagem. */
  heightKeys: [number, number, number][];
  /** Hop step do toque (planHopStop): instante em que o jogador parou nos dois pés e a bola presa assume. */
  stopAt?: number;
  /** Aro (no chão) e frente da cesta, para a orientação do corpo. */
  rimFloor: Vec3;
  /** Rating final (com a dificuldade da variação) e se conta como acrobática (badge Acrobat). */
  rating: number;
  acrobatic: boolean;
  /** Enterrada: centro do aro (3D, para a bola e as mãos) e o pendurado, se o X ficou segurado na soltura. */
  rim?: Vec3;
  hang?: LayupHang;
}

/** Números da bandeja (docs/21-bandejas.md §3). Ajustáveis no laboratório. */
export const LayupTuning = {
  gravity: DefaultGravity,
  /** Tempo de contato do passo 1 por velocidade: a + b·v (s), entre min e max. */
  contact1: { a: 0.24, b: -0.017, min: 0.13, max: 0.22 },
  /** Contato do passo da decolagem (um pé) e do pouso do hop (dois pés). */
  contactTakeoff: 0.17,
  contactHop: 0.24,
  /** Voo entre dois passos de corrida (s). */
  flightBetween: 0.07,
  /**
   * O passo 1 é o passo LONGO (o gather alonga a passada: s a mais no ar até ele tocar) e o último é curto e rápido (voo
   * curto até o plant): no "1-2" o pé 1 vai longe e o pé da decolagem pisa logo, à frente do corpo.
   */
  gatherStretch: 0.07,
  flightLast: 0.03,
  /** Voo do hop (pé empurra -> dois pés pousam): ~0,2 s e ~1 m correndo; cresce com a escala das passadas. */
  hopFlight: 0.2,
  /** Pé à frente do centro de massa no toque: passo 1 e o passo da decolagem (o plant freia). */
  footAhead1: 0.32,
  footAheadTakeoff: 0.3,
  /** Meia largura da passada (m). */
  footHalfWidth: 0.09,
  hopHalfWidth: 0.28,
  /** Velocidade ao chegar no passo da decolagem = esta fração da de entrada. */
  keepToPlant: 0.95,
  /** No hop o pouso dos dois pés é um jump stop: segura ~25% da velocidade. */
  keepToHop: 0.75,
  /** Escala do tempo das passadas aceita (passos mais curtos ou mais longos que o ritmo da corrida). */
  strideMin: 0.72,
  strideMax: 1.35,
  takeoffSpeedMin: 0.5,
  takeoffSpeedMinHop: 0.1,
  takeoffSpeedMax: 4.2,
  /** Altura do centro de massa (m, relativa a de pé): correndo, penúltimo passo, fundo do plant, decolagem, pouso. */
  zRun: -0.03,
  zPenultimate: -0.1,
  zPlantLow: -0.14,
  zTakeoff: 0.02,
  zTouchdown: -0.02,
  zAbsorb: -0.17,
  /** Depois do pouso: fundo da absorção e de pé de novo (s). */
  absorbAt: 0.13,
  recover: 0.42,
  /** Freio horizontal depois do pouso (s). */
  landBrake: 0.3,
};

/** Por finalização: subida (m), soltura (fração do tempo até o ápice), bola à frente do corpo (m), altura da bola na
 * soltura de pé (fração da altura do jogador, braço esticado), distância da soltura ao aro e dificuldade (rating). */
interface FinishShape {
  rise: number;
  releaseFrac: number;
  reach: number;
  ballHeight: number;
  releaseFromRim: number;
  /** Velocidade horizontal na decolagem = a·v + b. */
  takeoff: [number, number];
  difficulty: number;
}

const FinishShapes: Record<LayupFinish, FinishShape> = {
  [LayupFinish.Overhand]: { rise: 0.5, releaseFrac: 0.9, reach: 0.32, ballHeight: 1.27, releaseFromRim: 0.55, takeoff: [0.55, 0.5], difficulty: 0 },
  [LayupFinish.FingerRoll]: { rise: 0.5, releaseFrac: 1.0, reach: 0.45, ballHeight: 1.22, releaseFromRim: 0.6, takeoff: [0.55, 0.5], difficulty: -1 },
  [LayupFinish.Scoop]: { rise: 0.42, releaseFrac: 0.85, reach: 0.4, ballHeight: 1.12, releaseFromRim: 0.58, takeoff: [0.55, 0.5], difficulty: -3 },
  [LayupFinish.Jelly]: { rise: 0.5, releaseFrac: 1.06, reach: 0.42, ballHeight: 1.2, releaseFromRim: 0.66, takeoff: [0.55, 0.5], difficulty: -4 },
  [LayupFinish.Reverse]: { rise: 0.5, releaseFrac: 1.1, reach: -0.05, ballHeight: 1.25, releaseFromRim: 0.35, takeoff: [0.55, 0.5], difficulty: -4 },
  [LayupFinish.Floater]: { rise: 0.32, releaseFrac: 0.5, reach: 0.22, ballHeight: 1.24, releaseFromRim: 2.4, takeoff: [0.45, 0.3], difficulty: 0 },
  [LayupFinish.Power]: { rise: 0.48, releaseFrac: 0.95, reach: 0.22, ballHeight: 1.2, releaseFromRim: 0.48, takeoff: [0.25, 0.4], difficulty: 2 },
  // Enterradas: a subida sai da altura do aro (dunkRise); `rise` é só o piso. A bola solta logo à frente do centro do aro.
  // ballHeight = alcance do braço do boneco acima da cabeça com a bola (medido: ombro -> punho 0,52 m).
  [LayupFinish.DunkOneHand]: { rise: 0.6, releaseFrac: 1.0, reach: 0.26, ballHeight: 1.12, releaseFromRim: 0.07, takeoff: [0.5, 0.45], difficulty: 0 },
  [LayupFinish.DunkTwoHand]: { rise: 0.6, releaseFrac: 1.0, reach: 0.24, ballHeight: 1.1, releaseFromRim: 0.07, takeoff: [0.45, 0.45], difficulty: 2 },
  [LayupFinish.Tomahawk]: { rise: 0.6, releaseFrac: 1.04, reach: 0.26, ballHeight: 1.12, releaseFromRim: 0.07, takeoff: [0.5, 0.45], difficulty: -2 },
  [LayupFinish.CockBack]: { rise: 0.6, releaseFrac: 1.04, reach: 0.24, ballHeight: 1.1, releaseFromRim: 0.07, takeoff: [0.45, 0.45], difficulty: -3 },
  [LayupFinish.Windmill]: { rise: 0.6, releaseFrac: 1.06, reach: 0.26, ballHeight: 1.12, releaseFromRim: 0.07, takeoff: [0.5, 0.45], difficulty: -5 },
};

/**
 * Enterrada e pendurado no aro. A bola solta `ballOverRim` acima do topo do aro; depois da soltura a mão no aro freia o
 * corpo (o embalo cai a `brakeKeep` em ~`brakeTau`) e o jogador cai na frente do aro, sem atravessar a tabela.
 */
export const DunkTuning = {
  ballOverRim: 0.06,
  /** Subida do centro de massa aceita (m): abaixo disso o jogador nem chega; acima, não alcança e vira bandeja. */
  riseMin: 0.55,
  riseMax: 1.08,
  brakeKeep: 0.08,
  brakeTau: 0.08,
  /** As mãos chegam ao aro isto depois da soltura (s) e o corpo assenta pendurado em `settle`. */
  grabAfter: 0.07,
  settle: 0.32,
  /** Palma até o centro de massa com o corpo pendurado (fração da altura): braços esticados pelo peso. */
  hangPalmToCom: 0.41,
  /** Centro de massa de pé (fração da altura). */
  standCom: 0.535,
  /** Corpo pendurado à frente do centro do aro (m): o peito fica na frente da borda. */
  hangAhead: 0.3,
  /** Pendurado de uma mão: o ombro dela fica embaixo da mão, o corpo desloca isto para o outro lado (m). */
  shoulderHalf: 0.17,
  /** Balanço do corpo pendurado: amplitude (m), período (s) e quanto dura (s). */
  swing: { amp: 0.11, period: 1.25, decay: 1.1 },
  /** Pendurado: mínimo e máximo (s). */
  hangMin: 0.3,
  hangMax: 2.6,
  /** Ao soltar o aro o corpo cai com esta velocidade para a quadra (m/s): empurra o aro ao sair. */
  dropPush: 0.45,
  /** Bola da enterrada de uma mão para o lado da mão em relação ao centro do corpo (m): ombro + braço. */
  oneHandLateral: 0.2,
  /** Enterrada parada (dois pés): velocidade máxima do salto para a frente (m/s) e distância máxima ao aro (m). */
  standLeapMax: 3.0,
  standMaxM: 2.1,
  /** Pulinho de ajuste da enterrada parada: os pés saem do chão e pousam embaixo da decolagem (s desde o começo). */
  standHop: [0.05, 0.14] as [number, number],
  /** Meia distância entre as mãos no aro (m), enterrada de duas mãos. */
  gripHalf: 0.13,
};

/** Altura da bola acima do chão com o jogador de pé e o braço da enterrada esticado (m), para a conta da subida. */
const dunkRise = (shape: FinishShape, sit: LayupSituation): number => {
  const target = (sit.rimHeightM ?? 3.05) + DunkTuning.ballOverRim;
  const f = shape.releaseFrac;
  return (target - shape.ballHeight * sit.heightM - LayupTuning.zTakeoff) / (2 * f - f * f);
};

const GatherDifficulty: Record<LayupGather, number> = {
  [LayupGather.Normal]: 0,
  [LayupGather.OneStep]: -2,
  [LayupGather.Euro]: -2,
  [LayupGather.Hop]: -1,
  [LayupGather.ProHop]: -2,
  [LayupGather.Cradle]: -3,
};

/** Rating de enterrada (UE: DunkRating). */
export const DunkRating = 80;

/** Acrobat (docs/19-badges-2k23.md): spin, hop, euro, cradle, reversa ou troca de mão no ar. */
const AcrobaticGathers = new Set([LayupGather.Euro, LayupGather.Hop, LayupGather.ProHop, LayupGather.Cradle]);

// ------------------------------------------------------------------------------------------- geometria

const right = (d: Vec3): Vec3 => upVector().cross(d).normalized(new Vec3(0, 1, 0));
const left = (d: Vec3): Vec3 => right(d).neg();
const flatDir = (v: Vec3, fallback: Vec3): Vec3 => v.flat().normalized(fallback.flat().normalized(new Vec3(1, 0, 0)));
const sideVec = (d: Vec3, s: Side): Vec3 => (s === 'r' ? right(d) : left(d));

/** Trecho e parâmetro local de u em [0, 1] numa curva de n trechos (3n + 1 pontos). */
function segmentOf(p: Vec3[], u: number): { i: number; t: number } {
  const n = Math.max(1, (p.length - 1) / 3);
  const x = clamp(u, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(x));
  return { i: i * 3, t: x - i };
}

function bezier(p: Vec3[], u: number): Vec3 {
  const { i, t } = segmentOf(p, u);
  const a = 1 - t;
  return p[i]
    .scale(a * a * a)
    .add(p[i + 1].scale(3 * a * a * t))
    .add(p[i + 2].scale(3 * a * t * t))
    .add(p[i + 3].scale(t * t * t));
}

function bezierTangent(p: Vec3[], u: number): Vec3 {
  const { i, t } = segmentOf(p, u);
  const a = 1 - t;
  return p[i + 1]
    .sub(p[i])
    .scale(3 * a * a)
    .add(p[i + 2].sub(p[i + 1]).scale(6 * a * t))
    .add(p[i + 3].sub(p[i + 2]).scale(3 * t * t));
}

const ArcSamples = 48;

/** Comprimentos acumulados da curva (ArcSamples + 1 pontos). */
function arcTable(p: Vec3[]): number[] {
  const out = [0];
  let prev = p[0];
  for (let i = 1; i <= ArcSamples; i++) {
    const q = bezier(p, i / ArcSamples);
    out.push(out[i - 1] + q.sub(prev).length2D());
    prev = q;
  }
  return out;
}

/** Parâmetro u da curva no comprimento s. */
function uAtLength(table: number[], s: number): number {
  const total = table[table.length - 1];
  if (s <= 0) return 0;
  if (s >= total) return 1;
  let i = 1;
  while (i < table.length - 1 && table[i] < s) i++;
  const f = (s - table[i - 1]) / Math.max(1e-9, table[i] - table[i - 1]);
  return (i - 1 + f) / ArcSamples;
}

/** Hermite cúbica entre (t0, z0, v0) e (t1, z1, v1). */
function hermite(t: number, k0: [number, number, number], k1: [number, number, number]): { z: number; v: number } {
  const h = Math.max(1e-6, k1[0] - k0[0]);
  const s = clamp((t - k0[0]) / h, 0, 1);
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const z = h00 * k0[1] + h10 * h * k0[2] + h01 * k1[1] + h11 * h * k1[2];
  const dz = ((6 * s2 - 6 * s) * k0[1] + (3 * s2 - 4 * s + 1) * h * k0[2] + (-6 * s2 + 6 * s) * k1[1] + (3 * s2 - 2 * s) * h * k1[2]) / h;
  return { z, v: dz };
}

// ------------------------------------------------------------------------------------------- escolha

/** Ângulo (graus) entre a linha aro -> jogador e a frente da cesta: 0 = de frente, 90 = da linha de fundo. */
export function approachAngleDeg(position: Vec3, rimFloor: Vec3, hoopForward: Vec3): number {
  const a = position.sub(rimFloor).flat().normalized(hoopForward);
  return (Math.acos(clamp(a.dot(hoopForward.flat().normalized()), -1, 1)) * 180) / Math.PI;
}

/** Lado do aro em que o jogador está: + = à direita de quem olha da quadra para a cesta. */
export function rimSide(position: Vec3, rimFloor: Vec3, hoopForward: Vec3): number {
  // De frente para a cesta (olhando para -forward), a direita do jogador é right(-forward).
  return position.sub(rimFloor).flat().dot(right(hoopForward.neg()));
}

/** Mão pelo lado do aro: à direita do aro, direita; à esquerda, esquerda; no meio (40 cm), a mão da bola. */
export function layupHandFor(position: Vec3, rimFloor: Vec3, hoopForward: Vec3, ballHand: Side): Side {
  const side = rimSide(position, rimFloor, hoopForward);
  if (side > 0.4) return 'r';
  if (side < -0.4) return 'l';
  return ballHand;
}

const pick3 = (w: [number, number, number], r: number): 0 | 1 | 2 => {
  const total = w[0] + w[1] + w[2];
  const x = r * total;
  return x < w[0] ? 0 : x < w[0] + w[1] ? 1 : 2;
};

/**
 * Escolhe a bandeja: o comando dá o gather (e às vezes a finalização); no 'auto' a finalização sai do ângulo, da
 * distância e do estilo (o "motor dinâmico" do 2K). `r` = número aleatório em [0, 1) para a variedade do estilo.
 */
export function chooseLayup(request: LayupRequest, sit: LayupSituation, style: LayupStyle = LayupStyles.padrao, r = 0.5): LayupChoice {
  const angle = approachAngleDeg(sit.position, sit.rimFloor, sit.hoopForward);
  let hand = layupHandFor(sit.position, sit.rimFloor, sit.hoopForward, sit.ballHand);
  const angled = angle >= 20 && angle <= 80;
  const behindRim = sit.position.sub(sit.rimFloor).dot(sit.hoopForward.flat().normalized()) < 0.15;
  const dir = flatDir(sit.velocity, sit.facing);

  switch (request.command) {
    case 'hop':
      return { gather: LayupGather.Hop, finish: LayupFinish.Power, hand, glass: angled };
    case 'proHop':
      return { gather: LayupGather.ProHop, finish: LayupFinish.Power, hand: request.side ?? hand, glass: angled };
    case 'euro': {
      // Euro: o segundo passo cruza para o lado pedido (o do LS; sem LS, o da mão livre); a mão da soltura é a desse lado.
      const to = request.side ?? otherSideOf(sit.ballHand);
      return { gather: LayupGather.Euro, finish: angled ? LayupFinish.Overhand : LayupFinish.FingerRoll, hand: to, glass: true };
    }
    case 'cradle':
      return { gather: LayupGather.Cradle, finish: LayupFinish.Overhand, hand, glass: true };
    case 'floater':
      return { gather: LayupGather.OneStep, finish: LayupFinish.Floater, hand: sit.ballHand, glass: false };
    case 'scoop':
      return { gather: LayupGather.Normal, finish: LayupFinish.Scoop, hand: request.side ?? hand, glass: angled };
    case 'reverse': {
      // A mão do lado da linha de fundo (a de fora, longe do defensor que vem do meio).
      const towardBaseline = sit.hoopForward.flat().normalized().neg();
      hand = towardBaseline.dot(right(dir)) >= 0 ? 'r' : 'l';
      return { gather: LayupGather.Normal, finish: LayupFinish.Reverse, hand, glass: true };
    }
    case 'dunk':
      return chooseDunk(sit, request, r);
    default:
      break;
  }
  // 'auto': atrás da linha do aro, cruzando por baixo dele = reversa.
  const crossing = Math.abs(dir.dot(right(sit.hoopForward))) > 0.75;
  if (behindRim && crossing) {
    const towardBaseline = sit.hoopForward.flat().normalized().neg();
    hand = towardBaseline.dot(right(dir)) >= 0 ? 'r' : 'l';
    return { gather: LayupGather.Normal, finish: LayupFinish.Reverse, hand, glass: true };
  }
  if (angled) {
    const k = pick3(style.angled, r);
    const finish = k === 0 ? LayupFinish.Overhand : k === 1 ? LayupFinish.FingerRoll : LayupFinish.Jelly;
    return { gather: LayupGather.Normal, finish, hand, glass: true };
  }
  if (angle > 80) return { gather: LayupGather.Normal, finish: LayupFinish.Overhand, hand, glass: true };
  const k = pick3(style.straight, r);
  const finish = k === 0 ? LayupFinish.FingerRoll : k === 1 ? LayupFinish.Jelly : LayupFinish.Overhand;
  return { gather: LayupGather.Normal, finish, hand, glass: finish === LayupFinish.Overhand };
}

/**
 * Enterrada pelo contexto: devagar (ou parado perto do aro) sobe dos dois pés com as duas mãos; correndo, uma mão é a
 * mais comum, e em velocidade entram o tomahawk e o moinho (os "flashy" do 2K pedem embalo). A mão é a do lado do aro
 * por onde ele chega (como na bandeja); na de duas mãos fica a da bola.
 */
export function chooseDunk(sit: LayupSituation, request: LayupRequest, r = 0.5): LayupChoice {
  const speed = sit.velocity.length2D();
  const hand = request.side ?? layupHandFor(sit.position, sit.rimFloor, sit.hoopForward, sit.ballHand);
  const F = LayupFinish;
  const slow = speed < 2.2;
  // Pedida pelo RS: a enterrada dele (ou a mais simples que a build permite).
  if (request.finish !== undefined && isDunkFinish(request.finish)) {
    const finish = allowedDunk(request.finish, sit.dunk);
    return { gather: slow ? LayupGather.Hop : LayupGather.Normal, finish, hand: isTwoHandDunk(finish) ? sit.ballHand : hand, glass: false };
  }
  if (slow) {
    const finish = allowedDunk(r < 0.7 ? F.DunkTwoHand : F.CockBack, sit.dunk);
    return { gather: LayupGather.Hop, finish, hand: sit.ballHand, glass: false };
  }
  const options: [LayupFinish, number][] =
    speed > 4
      ? [[F.DunkOneHand, 0.3], [F.DunkTwoHand, 0.15], [F.Tomahawk, 0.25], [F.CockBack, 0.12], [F.Windmill, 0.18]]
      : [[F.DunkOneHand, 0.45], [F.DunkTwoHand, 0.3], [F.Tomahawk, 0.15], [F.CockBack, 0.1]];
  const total = options.reduce((a, [, w]) => a + w, 0);
  let x = r * total;
  let finish = options[options.length - 1][0];
  for (const [f, w] of options) {
    if (x < w) {
      finish = f;
      break;
    }
    x -= w;
  }
  finish = allowedDunk(finish, sit.dunk);
  return { gather: LayupGather.Normal, finish, hand: isTwoHandDunk(finish) ? sit.ballHand : hand, glass: false };
}

// ------------------------------------------------------------------------------------------- plano

/** Pontos da soltura (centro da bola, no chão) por finalização e lado de chegada. */
export function releasePointFor(choice: LayupChoice, sit: LayupSituation): Vec3 {
  const f = sit.hoopForward.flat().normalized();
  const rim = sit.rimFloor.flat();
  const shape = FinishShapes[choice.finish];
  let a = sit.position.sub(rim).flat().normalized(f);
  if (choice.finish === LayupFinish.Floater) {
    const d = clamp(sit.position.sub(rim).length2D() - 1.7, 1.7, 3.4);
    return rim.add(a.scale(d));
  }
  if (choice.finish === LayupFinish.Reverse) {
    // Do outro lado do aro: o lado oposto ao de chegada, um pouco à frente da tabela.
    const r = right(f);
    const sideSign = a.dot(r) >= 0 ? 1 : -1;
    return rim.sub(r.scale(sideSign * shape.releaseFromRim)).add(f.scale(0.24));
  }
  // Sempre na frente da tabela (no mínimo ~25° fora do plano dela).
  if (a.dot(f) < 0.42) {
    const r = right(f);
    const lateral = a.dot(r) >= 0 ? 1 : -1;
    a = f.scale(0.42).add(r.scale(lateral * Math.sqrt(1 - 0.42 * 0.42)));
  }
  const point = rim.add(a.scale(shape.releaseFromRim));
  // Euro e pro hop terminam do lado da mão da soltura (o passo/hop lateral troca de faixa).
  if (choice.gather === LayupGather.Euro || choice.gather === LayupGather.ProHop) {
    return point.add(sideVec(a.neg(), choice.hand).scale(0.3));
  }
  return point;
}

/** Passada: tempos (s) do ritmo da corrida nesta velocidade. */
function gait(speed: number) {
  const T = LayupTuning;
  return {
    c1: clamp(T.contact1.a + T.contact1.b * speed, T.contact1.min, T.contact1.max),
    f: T.flightBetween,
  };
}

/**
 * Pé que pisa a seguir e quanto falta (s) para ele tocar o chão. O pé no ar (ou o mais alto/atrás) é o próximo; o
 * tempo sai de quanto ele ainda precisa andar até ficar à frente do corpo.
 */
function nextFoot(sit: LayupSituation, dir: Vec3, speed: number): { swing: Side; planted: Side | null; toContact: number } {
  const { l, r } = sit.feet;
  let swing: Side;
  if (l.planted !== r.planted) swing = l.planted ? 'r' : 'l';
  else {
    // Os dois no chão (parado) ou os dois no ar: o que está mais atrás é o que vai andar.
    swing = l.pos.sub(sit.position).dot(dir) < r.pos.sub(sit.position).dot(dir) ? 'l' : 'r';
  }
  const planted = sit.feet[otherSideOf(swing)].planted ? otherSideOf(swing) : null;
  const ahead = sit.feet[swing].pos.sub(sit.position).dot(dir);
  // O pé no ar anda ~2x a velocidade do corpo até tocar ~footAhead1 à frente.
  const rel = Math.max(1.6, speed);
  const toContact = clamp((LayupTuning.footAhead1 - ahead) / rel, 0.05, 0.24);
  return { swing, planted, toContact };
}

interface Sequence {
  kind: '1-2' | 'zero-1-2' | 'one' | 'hop';
  /** Pés na ordem dos contatos depois do gather (sem o pé que já está no chão). */
  order: Side[];
  takeoff: Side | 'both';
}

/** Distância coberta pelo centro de massa até a decolagem, com a escala k das passadas e a velocidade v da decolagem. */
interface Timeline {
  /** Instantes (s) de toque e saída de cada contato da sequência, e da decolagem. */
  contacts: { foot: Side | 'both'; on: number; off: number; role: LayupContact['role'] }[];
  plantOn: number;
  takeoffAt: number;
  /** Quando o pé que estava no chão no gather sai (null se não havia). */
  plantedOff: number | null;
}

function timeline(seq: Sequence, k: number, toContact: number, c1: number, f: number, hadPlanted: boolean): Timeline {
  const T = LayupTuning;
  const contacts: Timeline['contacts'] = [];
  let t = k * toContact;
  const plantedOff = hadPlanted ? Math.max(0.02, t - k * f) : null;
  if (seq.kind === 'hop') {
    // Pé que estava no chão empurra o hop; sem pé no chão, o primeiro que pisa é o zero e ele empurra.
    let pushOff = plantedOff ?? 0.02;
    if (!hadPlanted) {
      contacts.push({ foot: seq.order[0], on: t, off: t + k * c1 * 0.8, role: 'zero' });
      pushOff = t + k * c1 * 0.8;
    }
    const on = pushOff + T.hopFlight * k;
    const off = on + T.contactHop;
    contacts.push({ foot: 'both', on, off, role: 'hop' });
    return { contacts, plantOn: on, takeoffAt: off, plantedOff: hadPlanted ? pushOff : null };
  }
  const roles: LayupContact['role'][] =
    seq.kind === 'zero-1-2' ? ['zero', 'step1', 'step2'] : seq.kind === '1-2' ? ['step1', 'step2'] : ['step2'];
  for (let i = 0; i < seq.order.length; i++) {
    const last = i === seq.order.length - 1;
    // Passo 1 (o longo do gather): chega mais tarde; o passo da decolagem vem logo depois dele.
    if (roles[i] === 'step1') t += k * T.gatherStretch;
    const dur = last ? T.contactTakeoff : k * c1;
    contacts.push({ foot: seq.order[i], on: t, off: t + dur, role: roles[i] });
    t += dur + (last ? 0 : k * (roles[i + 1] === 'step2' ? T.flightLast : f));
  }
  const lastC = contacts[contacts.length - 1];
  return { contacts, plantOn: lastC.on, takeoffAt: lastC.off, plantedOff };
}

/** Distância percorrida até a decolagem: v0 até o toque do plant (caindo a `keep`), depois até vt na saída. */
function distanceTo(tl: Timeline, v0: number, vt: number, keep: number): number {
  const vPlant = v0 * keep;
  return ((v0 + vPlant) / 2) * tl.plantOn + ((vPlant + vt) / 2) * (tl.takeoffAt - tl.plantOn);
}

export interface LayupPlanResult {
  plan: LayupPlan | null;
  /** O X veio cedo: falta andar isto (m) até dar para começar (o gather espera). */
  tooFarBy: number;
  /** Perto demais para esta bandeja. */
  tooClose: boolean;
}

/**
 * Monta o plano da bandeja a partir da situação (jogador correndo, pés onde estão). Tenta as sequências de pés na
 * ordem de preferência do estilo e fica com a de menor custo (passadas perto do ritmo da corrida e velocidade de
 * decolagem perto da natural).
 */
export function planLayup(choice: LayupChoice, sit: LayupSituation, style: LayupStyle = LayupStyles.padrao, rating = 85): LayupPlanResult {
  const T = LayupTuning;
  const g = T.gravity;
  const shape = FinishShapes[choice.finish];
  const speed = sit.velocity.length2D();
  const dir0 = flatDir(sit.velocity.length2D() > 0.6 ? sit.velocity : sit.facing, sit.facing);
  const v0 = speed;
  const H = sit.heightM;
  const rimFloor = sit.rimFloor.flat();
  const R = releasePointFor(choice, sit);
  const { c1, f } = gait(Math.max(speed, 2));
  const foot = nextFoot(sit, dir0, speed);

  // Sequências de pés possíveis. Natural: decola com o pé oposto à mão.
  const natural: Side = otherSideOf(choice.hand);
  const hop = choice.gather === LayupGather.Hop || choice.gather === LayupGather.ProHop;
  const seqs: Sequence[] = [];
  if (hop) {
    seqs.push({ kind: 'hop', order: [foot.swing], takeoff: 'both' });
  } else {
    const s1 = foot.swing;
    const s2 = otherSideOf(s1);
    const oneStep = choice.gather === LayupGather.OneStep;
    // 1-2 a partir do pé no ar: decola com s2. Zero-1-2: o pé no ar vira o zero e decola com ele mesmo.
    const twelve: Sequence = { kind: '1-2', order: [s1, s2], takeoff: s2 };
    const zero: Sequence = { kind: 'zero-1-2', order: [s1, s2, s1], takeoff: s1 };
    const one: Sequence = { kind: 'one', order: [s1], takeoff: s1 };
    if (oneStep) seqs.push(one, twelve);
    else if (choice.gather === LayupGather.Euro) seqs.push(twelve, zero);
    else seqs.push(twelve, zero, one);
    // Prefere a sequência que decola com o pé natural; o estilo Kyrie aceita o pé da mão. No euro o passo 2 é o pé do lado
    // em que ele termina (o da mão): mesmo pé e mesma mão é o normal dele (FIBA: o euro termina no "wrong foot").
    const preferred = choice.gather === LayupGather.Euro ? choice.hand : natural;
    const cost = (s: Sequence) => (s.takeoff === preferred || style.wrongFootOk ? 0 : 1) + (s.kind === 'one' && !oneStep ? 0.6 : 0);
    seqs.sort((a, b) => cost(a) - cost(b));
  }

  // Subida e soltura. Enterrada: sobe o que precisa para a bola passar por cima do aro (não alcança = não é enterrada).
  const dunk = isDunkFinish(choice.finish);
  let rise = shape.rise + (choice.gather === LayupGather.Hop ? -0.02 : 0) + clamp((speed - 4) * 0.02, -0.04, 0.05);
  if (dunk) {
    const need = dunkRise(shape, sit);
    if (need > (sit.dunk?.riseMax ?? DunkTuning.riseMax)) return { plan: null, tooFarBy: 0, tooClose: false };
    rise = Math.max(DunkTuning.riseMin, need);
  }
  const vz0 = Math.sqrt(2 * g * rise);
  const tApex = vz0 / g;
  const tr = shape.releaseFrac * tApex;
  const vtNom = clamp(shape.takeoff[0] * v0 + shape.takeoff[1], T.takeoffSpeedMin, T.takeoffSpeedMax);
  const keep = hop ? T.keepToHop : T.keepToPlant;

  // Enterrada de uma mão: a bola fica do lado do ombro da mão, então o corpo passa um pouco para o outro lado do ponto.
  const handLateral = dunk && !isTwoHandDunk(choice.finish) ? DunkTuning.oneHandLateral : 0;
  let best: { seq: Sequence; k: number; vt: number; cost: number; tl: Timeline; Tp: Vec3; dirT: Vec3; path: Vec3[]; table: number[] } | null = null;
  let tooFarBy = Infinity;
  let tooClose = false;
  for (const [si, seq] of seqs.entries()) {
    const prefCost = si * 0.35;
    // Direção da decolagem: a da corrida curvando para a soltura.
    const toR = R.sub(sit.position).flat().normalized(dir0);
    let dirT = dir0.scale(0.4).add(toR.scale(0.6)).normalized(toR);
    if (choice.gather === LayupGather.Euro) {
      // O segundo passo cruza para o lado da mão: o corpo ainda vai para esse lado na decolagem (~20°).
      dirT = toR.add(sideVec(toR, choice.hand).scale(0.36)).normalized(toR);
    }
    if (choice.gather === LayupGather.ProHop) dirT = toR;
    if (choice.finish === LayupFinish.Reverse) dirT = dir0.scale(0.7).add(toR.scale(0.3)).normalized(toR);
    for (let k = T.strideMin; k <= T.strideMax + 1e-9; k += 0.01) {
      const tl = timeline(seq, k, foot.toContact, c1, f, foot.planted !== null);
      // vt resolve: distância(k, vt) = |caminho até T(vt)|, com T = R - dirT·(vt·tr + reach). Duas passadas fixas.
      let vt = vtNom;
      let Tp = R;
      let path: Vec3[] = [sit.position, sit.position, sit.position, sit.position];
      let table: number[] = [0];
      for (let it = 0; it < 3; it++) {
        Tp = R.sub(dirT.scale(vt * tr + shape.reach)).sub(sideVec(dirT, choice.hand).scale(handLateral)).flat();
        path = makePath(choice, sit, dir0, dirT, Tp);
        table = arcTable(path);
        const L = table[table.length - 1];
        // distance = A + B·vt (linear em vt) e L(vt) ≈ L - (vt' - vt)·tr: resolve vt'.
        const A = distanceTo(tl, v0, 0, keep);
        const B = (tl.takeoffAt - tl.plantOn) / 2;
        vt = (L + vt * tr - A) / (B + tr);
      }
      if (vt > T.takeoffSpeedMax) {
        tooFarBy = Math.min(tooFarBy, (vt - T.takeoffSpeedMax) * (tr + (tl.takeoffAt - tl.plantOn) / 2));
        continue;
      }
      // O hop (dois pés, de força) pode subir quase na vertical.
      if (vt < (hop ? T.takeoffSpeedMinHop : T.takeoffSpeedMin)) {
        tooClose = true;
        continue;
      }
      const cost = prefCost + 4 * (k - 1) * (k - 1) + ((vt - vtNom) / Math.max(1, vtNom)) ** 2;
      if (!best || cost < best.cost) best = { seq, k, vt, cost, tl, Tp, dirT, path, table };
    }
  }
  if (!best) return { plan: null, tooFarBy: Number.isFinite(tooFarBy) ? tooFarBy : 0, tooClose: tooClose && !Number.isFinite(tooFarBy) };

  const { seq, k, vt, tl, Tp, dirT, path, table } = best;
  const L = table[table.length - 1];
  const takeoffAt = tl.takeoffAt;
  const apexAt = takeoffAt + tApex;
  const releaseAt = takeoffAt + tr;
  // Pouso: o centro de massa volta a zTouchdown descendo.
  const dz = T.zTakeoff - T.zTouchdown;
  const flight = (vz0 + Math.sqrt(vz0 * vz0 + 2 * g * dz)) / g;
  // Fora da quadra não: se o voo passaria da linha de fundo, a decolagem fica mais vertical (o real também).
  let vFlight = vt;
  const landRaw = Tp.add(dirT.scale(vt * flight));
  if (landRaw.x < sit.baselineX + 0.35 && dirT.x < -1e-3) vFlight = Math.max(0.3, (Tp.x - (sit.baselineX + 0.35)) / (-dirT.x * flight));
  const landAt = takeoffAt + flight;
  const landPos = Tp.add(dirT.scale(vFlight * flight));
  const endAt = landAt + T.recover;

  const speedKeys: [number, number][] = [
    [0, v0],
    [tl.plantOn, v0 * keep],
    [takeoffAt, vt],
  ];
  // Altura do centro de massa: corrida, penúltimo passo mais baixo, plant, decolagem; depois o pouso e a recuperação.
  const heightKeys: [number, number, number][] = [[0, T.zRun, 0]];
  for (const c of tl.contacts) {
    if (c.on >= tl.plantOn) break;
    const mid = (c.on + c.off) / 2;
    heightKeys.push([mid, c.role === 'step1' || c.role === 'zero' ? T.zPenultimate : T.zRun, 0]);
  }
  const plantDur = takeoffAt - tl.plantOn;
  heightKeys.push([tl.plantOn, T.zPenultimate + 0.03, -0.5]);
  heightKeys.push([tl.plantOn + plantDur * 0.42, T.zPlantLow, 0]);
  heightKeys.push([takeoffAt, T.zTakeoff, vz0]);
  const vLand = vz0 - g * flight;
  heightKeys.push([landAt, T.zTouchdown, vLand]);
  heightKeys.push([landAt + T.absorbAt, T.zAbsorb, 0]);
  heightKeys.push([endAt, 0, 0]);

  // Pés: posição de cada contato = centro de massa no toque + à frente + meia passada para o lado do pé.
  const draft: LayupPlan = {
    choice,
    takeoffFoot: seq.takeoff,
    driveKnee: seq.takeoff === 'both' ? null : otherSideOf(seq.takeoff),
    wrongFoot: seq.takeoff !== 'both' && seq.takeoff === choice.hand,
    steps: seq.kind === 'one' || seq.kind === 'hop' ? 1 : 2,
    extraStep: seq.kind === 'zero-1-2',
    contacts: [],
    stride: k,
    takeoffAt,
    apexAt,
    releaseAt,
    landAt,
    endAt,
    takeoffPos: Tp,
    takeoffDir: dirT,
    takeoffSpeed: vFlight,
    vz0,
    rise,
    release: R,
    reach: shape.reach,
    landPos,
    releaseDistance: 0,
    path,
    pathLength: L,
    arc: table,
    speedKeys,
    heightKeys,
    rimFloor,
    rating: rating + shape.difficulty + GatherDifficulty[choice.gather] + (seq.takeoff !== 'both' && seq.takeoff === choice.hand && !style.wrongFootOk ? -1 : 0),
    acrobatic: AcrobaticGathers.has(choice.gather) || choice.finish === LayupFinish.Reverse || choice.finish === LayupFinish.Windmill,
    rim: dunk ? rimFloor.withZ(sit.rimHeightM ?? 3.05) : undefined,
  };
  // Enterrada: a mão no aro freia o corpo depois da soltura; o pouso fica na frente do aro.
  if (dunk) draft.landPos = airborne(draft, landAt).pos;

  const contacts: LayupContact[] = [];
  if (foot.planted && tl.plantedOff !== null) {
    contacts.push({ foot: foot.planted, on: -1, off: tl.plantedOff, pos: sit.feet[foot.planted].pos.flat(), dir: dir0, role: 'zero' });
  }
  for (const c of tl.contacts) {
    const com = layupCom(draft, c.on);
    const tangent = com.dir;
    const ahead = c.role === 'step2' || c.role === 'hop' ? T.footAheadTakeoff : T.footAhead1;
    const feet: Side[] = c.foot === 'both' ? ['l', 'r'] : [c.foot];
    for (const s of feet) {
      const half = c.foot === 'both' ? T.hopHalfWidth : T.footHalfWidth;
      const pos = com.pos.add(tangent.scale(c.foot === 'both' ? 0.12 : ahead)).add(sideVec(tangent, s).scale(half)).flat();
      contacts.push({ foot: s, on: c.on, off: c.off, pos, dir: tangent, role: c.role });
    }
  }
  draft.contacts = contacts;
  pushLandContacts(draft);
  draft.releaseDistance = R.sub(rimFloor).length2D();
  // Altura da bola na soltura: de pé com o braço esticado + o centro de massa no instante.
  const zRel = layupHeight(draft, releaseAt).z;
  draft.release = R.withZ(shape.ballHeight * H + zRel);
  return { plan: draft, tooFarBy: 0, tooClose: false };
}

/**
 * Agachamento da bola presa (m abaixo de de pé): base larga e quadril baixo (Hakeem, Jordan na ameaça tripla; o pouso do
 * hop no 2K27 e do Wade é ainda mais fundo, ver HopStopTuning.absorb).
 */
export const HoldCrouch = -0.2;

/**
 * Bandeja parada, saindo da bola presa (depois do hop step / jump stop, ou no fim de um step-through): os dois pés ficam
 * onde estão, o jogador afunda mais (~0,1 s) e sobe com os dois. A soltura fica onde o salto leva (velocidade horizontal
 * até 1,4 m/s na direção do aro).
 */
export function planStandingLayup(choice: LayupChoice, sit: LayupSituation, rating = 85): LayupPlan {
  const T = LayupTuning;
  const g = T.gravity;
  const shape = FinishShapes[choice.finish];
  const H = sit.heightM;
  const rimFloor = sit.rimFloor.flat();
  const p0 = sit.position.flat();
  const dir = rimFloor.sub(p0).flat().normalized(sit.facing);
  const dunk = isDunkFinish(choice.finish);
  const rise = dunk ? clamp(dunkRise(shape, sit), DunkTuning.riseMin, sit.dunk?.riseMax ?? DunkTuning.riseMax) : Math.max(0.42, shape.rise - 0.04);
  const vz0 = Math.sqrt(2 * g * rise);
  const tApex = vz0 / g;
  const tr = shape.releaseFrac * tApex;
  // Enterrada parada: agacha um pouco mais e salta para a frente até o aro (de até ~2 m).
  const dip = dunk ? 0.3 : 0.26;
  const D = rimFloor.sub(p0).length2D();
  const vt = clamp((D - shape.releaseFromRim - shape.reach) / (dip / 2 + tr), 0, dunk ? DunkTuning.standLeapMax : 1.4);
  const Tp = p0.add(dir.scale((vt * dip) / 2));
  const R = Tp.add(dir.scale(vt * tr + shape.reach));
  const takeoffAt = dip;
  const dz = T.zTakeoff - T.zTouchdown;
  const flight = (vz0 + Math.sqrt(vz0 * vz0 + 2 * g * dz)) / g;
  const landAt = takeoffAt + flight;
  const landPos = Tp.add(dir.scale(vt * flight));
  const endAt = landAt + T.recover;
  const path = [p0, p0.add(dir.scale(0.01)), Tp.sub(dir.scale(0.01)), Tp.add(dir.scale(1e-3))];
  const arc = arcTable(path);
  const plan: LayupPlan = {
    choice,
    takeoffFoot: 'both',
    driveKnee: null,
    wrongFoot: false,
    steps: 0,
    extraStep: false,
    contacts: [],
    stride: 1,
    takeoffAt,
    apexAt: takeoffAt + tApex,
    releaseAt: takeoffAt + tr,
    landAt,
    endAt,
    takeoffPos: Tp,
    takeoffDir: dir,
    takeoffSpeed: vt,
    vz0,
    rise,
    release: R,
    reach: shape.reach,
    landPos,
    releaseDistance: R.sub(rimFloor).length2D(),
    path,
    pathLength: arc[arc.length - 1],
    arc,
    speedKeys: [
      [0, 0],
      [0, 0],
      [takeoffAt, vt],
    ],
    heightKeys: [
      [0, HoldCrouch, 0],
      [dip * 0.45, HoldCrouch - 0.05, 0],
      [takeoffAt, T.zTakeoff, vz0],
      [landAt, T.zTouchdown, vz0 - g * flight],
      [landAt + T.absorbAt, T.zAbsorb, 0],
      [endAt, 0, 0],
    ],
    rimFloor,
    rating: rating + shape.difficulty + GatherDifficulty[LayupGather.Hop],
    acrobatic: false,
    rim: dunk ? rimFloor.withZ(sit.rimHeightM ?? 3.05) : undefined,
  };
  if (dunk) plan.landPos = airborne(plan, landAt).pos;
  // Enterrada parada que anda até o aro: os dois pés dão um pulinho de ajuste e pousam embaixo da decolagem (com os pés
  // parados o corpo ia 0,4 m à frente deles, a perna não alcançava e a pelve soltava de uma vez na decolagem).
  const travel = Tp.sub(p0).length2D();
  const gatherHop = dunk && travel > 0.15;
  for (const s of ['l', 'r'] as Side[]) {
    if (!gatherHop) {
      plan.contacts.push({ foot: s, on: -1, off: takeoffAt, pos: sit.feet[s].pos.flat(), dir, role: 'hop' });
      continue;
    }
    plan.contacts.push({ foot: s, on: -1, off: DunkTuning.standHop[0], pos: sit.feet[s].pos.flat(), dir, role: 'zero' });
    const pos = Tp.add(dir.scale(0.06)).add(sideVec(dir, s).scale(0.17)).flat();
    plan.contacts.push({ foot: s, on: DunkTuning.standHop[1], off: takeoffAt, pos, dir, role: 'hop' });
  }
  pushLandContacts(plan);
  plan.release = R.withZ(shape.ballHeight * H + layupHeight(plan, plan.releaseAt).z);
  return plan;
}

/**
 * Hop step do toque (jump stop). Medidas: 2K27, drill "Hop Step Finish" (`OSaLcgjVmlE`, 60 qps): o pé empurra no quadro
 * 1840, os dois pousam no 1848 (voo de ~0,13 s, baixo), ~0,3 s agachado fundo com base larga e a bola nas duas mãos no
 * peito; Wade (`ogX9esDX0xc` 2905–2925) igual no jogo. O hop anda ~1 m correndo e ~0,7 m andando.
 */
export const HopStopTuning = {
  /** Voo do hop (s): do pé que empurra até os dois pés no chão. */
  flight: 0.15,
  /** Contato do pé que empurra (s), quando ele pisa depois do toque; o pé que já estava no chão empurra em pushPlanted. */
  pushContact: 0.12,
  pushPlanted: 0.07,
  /** O pé no ar pisa e empurra se faltar até isto (s) para ele tocar; senão o pé apoiado empurra já. */
  swingLandsWithin: 0.11,
  /** Velocidade horizontal no voo: a·v + b, entre min e max (m/s). Andando o hop ainda estica (impulso do pé). */
  speed: { a: 0.75, b: 1.1, min: 2.4, max: 4.8 },
  /** Freio do pouso até parar (s): o jump stop segura o corpo nos dois pés. */
  brake: 0.16,
  /** O hop curva esta fração para o aro (o resto segue a corrida). */
  toRim: 0.3,
  /** LS para um lado: o hop abre este ângulo para aquele lado (desvia do defensor). */
  lateralRad: (35 * Math.PI) / 180,
  /** O hop para a pelo menos isto do aro (m); se o corpo já está perto, o hop encurta até minLength. */
  stopFromRim: 1.5,
  minLength: 0.5,
  /** Meia base no pouso (m): mais larga que os ombros. */
  halfWidth: 0.27,
  /** Agachamento a mais no fundo da absorção (m, abaixo da base da bola presa). */
  absorb: 0.08,
  /** Até onde (m do aro) o toque no X dirigindo vira hop: um pouco além da linha de lance livre (4,2 m). */
  maxDistance: 5.2,
  /** Velocidade mínima na direção do aro (m/s) para o toque virar hop em vez de pump fake. */
  minApproach: 1.2,
};

/**
 * Hop step do toque: um pé empurra, voo curto e baixo, os dois pés pousam juntos com base larga e o corpo PARA (bola
 * presa). Não depende do aro: vale andando e longe. `lateral` = lado do LS (hop para aquele lado).
 */
export function planHopStop(sit: LayupSituation, lateral: Side | null = null, rating = 85): LayupPlan {
  const T = LayupTuning;
  const HS = HopStopTuning;
  const speed = sit.velocity.length2D();
  const dir0 = flatDir(speed > 0.6 ? sit.velocity : sit.facing, sit.facing);
  const rimFloor = sit.rimFloor.flat();
  const p0 = sit.position.flat();
  const toRim = rimFloor.sub(p0).flat().normalized(dir0);
  let dirH = dir0.scale(1 - HS.toRim).add(toRim.scale(HS.toRim)).normalized(dir0);
  if (lateral) dirH = dirH.scale(Math.cos(HS.lateralRad)).add(sideVec(dirH, lateral).scale(Math.sin(HS.lateralRad))).normalized(dirH);
  const foot = nextFoot(sit, dir0, speed);

  // Quem empurra: o pé no ar, se está para pisar (pisa e empurra dele; o apoiado sai quando ele pisa); senão o pé apoiado
  // empurra já. Esperar o ritmo da passada deixava o jogador ~0,25 s de pé antes do hop.
  const swingFirst = !foot.planted || foot.toContact <= HS.swingLandsWithin;
  const zero = swingFirst ? { on: foot.toContact, off: foot.toContact + HS.pushContact } : null;
  const pushOff = zero ? zero.off : HS.pushPlanted;
  const pushFoot: Side = zero ? foot.swing : foot.planted!;
  const on = pushOff + HS.flight;
  const stopAt = on + HS.brake;
  // Distância até o pouso: a corrida até o empurrão e o voo na velocidade do hop. A velocidade no toque dos pés sai daí
  // (as chaves são lineares) e o freio leva a zero em `brake`.
  const vHop = clamp(HS.speed.a * speed + HS.speed.b, HS.speed.min, HS.speed.max);
  const toLand = speed * pushOff + vHop * HS.flight;
  const vLand = Math.max(0.3, (2 * toLand) / on - speed);
  // Não para embaixo do aro: o hop encurta (o corpo segue o mesmo tempo numa curva menor, mais devagar).
  const D = Math.min(toLand + (vLand * HS.brake) / 2, Math.max(HS.minLength, rimFloor.sub(p0).length2D() - HS.stopFromRim));
  const end = p0.add(dir0.add(dirH).normalized(dirH).scale(D)).flat();
  const path = [p0, p0.add(dir0.scale(D / 3)), end.sub(dirH.scale(D / 3)), end];
  const arc = arcTable(path);

  const takeoffAt = stopAt + 0.3;
  const dip = pushOff < 0.12 ? pushOff * 0.5 : pushOff - 0.06;
  const plan: LayupPlan = {
    choice: { gather: LayupGather.Hop, finish: LayupFinish.Power, hand: sit.ballHand, glass: false },
    takeoffFoot: 'both',
    driveKnee: null,
    wrongFoot: false,
    steps: 1,
    extraStep: false,
    contacts: [],
    stride: 1,
    // Sem decolagem: a bola presa assume em stopAt. Os tempos depois dele só existem para o plano ficar coerente.
    takeoffAt,
    apexAt: takeoffAt + 0.2,
    releaseAt: takeoffAt + 0.2,
    landAt: takeoffAt + 0.4,
    endAt: takeoffAt + 0.8,
    stopAt,
    takeoffPos: end,
    takeoffDir: dirH,
    takeoffSpeed: 0,
    vz0: 0,
    rise: 0,
    release: end.withZ(sit.heightM),
    reach: 0.22,
    landPos: end,
    releaseDistance: end.sub(rimFloor).length2D(),
    path,
    pathLength: arc[arc.length - 1],
    arc,
    speedKeys: [
      [0, speed],
      [on, vLand],
      [stopAt, 0],
      [takeoffAt, 0],
    ],
    // Corrida, agacha para empurrar, voo baixo (~3 cm de arco), pousa e absorve fundo, assenta na base da bola presa.
    heightKeys: [
      [0, T.zRun, 0],
      [dip, T.zPenultimate, 0],
      [pushOff, -0.07, 0.7],
      [(pushOff + on) / 2, -0.035, 0],
      [on, -0.07, -0.7],
      [on + 0.1, HoldCrouch - HS.absorb, 0],
      [stopAt + 0.15, HoldCrouch, 0],
      [takeoffAt, HoldCrouch, 0],
    ],
    rimFloor,
    rating: rating + GatherDifficulty[LayupGather.Hop],
    acrobatic: false,
  };
  const pushPos = zero ? layupCom(plan, zero.on).pos.add(dir0.scale(T.footAhead1 * 0.6)).add(sideVec(dir0, pushFoot).scale(T.footHalfWidth)).flat() : sit.feet[pushFoot].pos.flat();
  plan.contacts.push({ foot: pushFoot, on: zero ? zero.on : -1, off: pushOff, pos: pushPos, dir: dir0, role: 'zero' });
  // O pé que estava apoiado (quando o outro pisa e empurra) sai do chão logo depois que o outro pisa.
  if (zero && foot.planted) {
    plan.contacts.push({ foot: foot.planted, on: -1, off: zero.on + 0.03, pos: sit.feet[foot.planted].pos.flat(), dir: dir0, role: 'zero' });
  }
  // Pouso nos dois pés juntos (jump stop: qualquer um pode ser o pivô depois), base larga em volta de onde o corpo para.
  for (const s of ['l', 'r'] as Side[]) {
    plan.contacts.push({ foot: s, on, off: Infinity, pos: end.add(sideVec(dirH, s).scale(HS.halfWidth)).flat(), dir: dirH, role: 'hop' });
  }
  plan.contacts.sort((a, b) => a.on - b.on);
  return plan;
}

/**
 * Curva do centro de massa do gather até a decolagem. Normal: um trecho, saindo na direção da corrida e chegando na da
 * decolagem. Euro: passa por um ponto do lado oposto ao da mão (o passo 1 "vende" esse lado) e cruza para o lado da mão
 * no passo 2. Pro hop: o hop leva o corpo para o lado da mão e o jogador sobe dali para a frente.
 */
function makePath(choice: LayupChoice, sit: LayupSituation, dir0: Vec3, dirT: Vec3, Tp: Vec3): Vec3[] {
  const p0 = sit.position.flat();
  const chord = Tp.sub(p0);
  const c = Math.max(0.2, chord.length2D());
  const along = chord.normalized(dir0);
  const segment = (a: Vec3, da: Vec3, b: Vec3, db: Vec3): Vec3[] => {
    const len = Math.max(0.1, b.sub(a).length2D());
    return [a, a.add(da.scale(len / 3)), b.sub(db.scale(len / 3)), b];
  };
  if (choice.gather === LayupGather.Euro || choice.gather === LayupGather.ProHop) {
    const euro = choice.gather === LayupGather.Euro;
    const toHand = sideVec(along, choice.hand);
    // Euro: o meio do caminho fica ~0,4 m para o lado de fora (oposto à mão). Pro hop: o pouso do hop já está do lado
    // da mão, ~0,3 m antes da decolagem.
    const M = euro ? p0.add(along.scale(c * 0.5)).sub(toHand.scale(0.42)) : Tp.sub(along.scale(0.32));
    const tM = euro ? Tp.sub(M).normalized(along).add(along.scale(0.3)).normalized(along) : along;
    const first = segment(p0, dir0, M, tM);
    const second = segment(M, tM, Tp, dirT);
    return [...first, ...second.slice(1)];
  }
  return segment(p0, dir0, Tp, dirT);
}

/** Velocidade (m/s) ao longo da curva no instante t (antes da decolagem) e a distância percorrida. */
function speedAt(plan: LayupPlan, t: number): { v: number; s: number } {
  const keys = plan.speedKeys;
  let s = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (t <= t0) return { v: v0, s };
    const te = Math.min(t, t1);
    const a = (v1 - v0) / Math.max(1e-6, t1 - t0);
    const d = te - t0;
    const v = v0 + a * d;
    s += v0 * d + 0.5 * a * d * d;
    if (t <= t1) return { v, s };
  }
  return { v: keys[keys.length - 1][1], s };
}

/** Centro de massa no chão (x, y), a direção do movimento e a velocidade horizontal no instante t. */
export function layupCom(plan: LayupPlan, t: number): { pos: Vec3; dir: Vec3; vel: Vec3 } {
  if (t <= plan.takeoffAt) {
    const { v, s } = speedAt(plan, Math.max(0, t));
    const table = plan.arc;
    // A curva foi montada para terminar na decolagem: a distância andada é reescalada para caber nela.
    const total = speedAt(plan, plan.takeoffAt).s;
    const sFit = (s * plan.pathLength) / Math.max(1e-6, total);
    const u = uAtLength(table, sFit);
    const dir = bezierTangent(plan.path, u).flat().normalized(plan.takeoffDir);
    const pos = bezier(plan.path, u).flat();
    if (t < 0) return { pos: pos.add(dir.scale(v * t)), dir, vel: dir.scale(v) };
    return { pos, dir, vel: dir.scale((v * plan.pathLength) / Math.max(1e-6, total)) };
  }
  if (t <= plan.landAt) return airborne(plan, t);
  const land = airborne(plan, plan.landAt);
  const vf = land.vel.length2D();
  const dir = vf > 1e-3 ? land.vel.flat().normalized(plan.takeoffDir) : land.dir;
  const tb = Math.min(t - plan.landAt, LayupTuning.landBrake);
  const braking = vf * tb - (vf * tb * tb) / (2 * LayupTuning.landBrake);
  const v = Math.max(0, vf * (1 - tb / LayupTuning.landBrake));
  return { pos: land.pos.add(dir.scale(braking)), dir, vel: dir.scale(v) };
}

/** Distância horizontal do voo desde a decolagem: reta na velocidade da decolagem; na enterrada, freada pelo aro depois da soltura. */
function flightDistance(plan: LayupPlan, t: number): { s: number; v: number } {
  const vf = plan.takeoffSpeed;
  const dt = Math.max(0, t - plan.takeoffAt);
  if (!plan.rim || t <= plan.releaseAt) return { s: vf * dt, v: vf };
  const D = DunkTuning;
  const before = vf * (plan.releaseAt - plan.takeoffAt);
  const u = t - plan.releaseAt;
  const e = Math.exp(-u / D.brakeTau);
  return { s: before + vf * (D.brakeKeep * u + (1 - D.brakeKeep) * D.brakeTau * (1 - e)), v: vf * (D.brakeKeep + (1 - D.brakeKeep) * e) };
}

/** Balanço do corpo pendurado (m, na direção em que ele olha) `u` s depois de agarrar: pêndulo amortecido. */
export function hangSwing(u: number): number {
  const S = DunkTuning.swing;
  if (u <= 0) return 0;
  return -S.amp * Math.sin((2 * Math.PI * u) / S.period) * Math.exp(-u / S.decay);
}

/** Centro de massa no chão do voo ao pouso: voo, pendurado no aro (se houver) e queda. */
function airborne(plan: LayupPlan, t: number): { pos: Vec3; dir: Vec3; vel: Vec3 } {
  const dir = plan.takeoffDir;
  const h = plan.hang;
  const fly = (tt: number) => {
    const { s, v } = flightDistance(plan, tt);
    return { pos: plan.takeoffPos.add(dir.scale(s)), vel: dir.scale(v) };
  };
  if (!h || t <= h.grabAt) {
    const f = fly(t);
    return { pos: f.pos, dir, vel: f.vel };
  }
  const hangPos = (tt: number): Vec3 => {
    const base = h.pos.add(h.facing.scale(hangSwing(tt - h.grabAt)));
    const w = smoothstep(h.grabAt, h.grabAt + DunkTuning.settle * 0.7, tt);
    return fly(h.grabAt).pos.scale(1 - w).add(base.scale(w)).flat();
  };
  if (t <= h.dropAt) {
    const pos = hangPos(t);
    const vel = pos.sub(hangPos(t - 1e-3)).scale(1e3);
    return { pos, dir: h.facing, vel };
  }
  // Solta o aro: cai empurrando o aro para a quadra.
  const out = h.facing.neg();
  const vel = out.scale(DunkTuning.dropPush);
  return { pos: hangPos(h.dropAt).add(vel.scale(t - h.dropAt)), dir: h.facing, vel };
}

const smoothstep = (a: number, b: number, x: number): number => {
  const s = clamp((x - a) / Math.max(1e-6, b - a), 0, 1);
  return s * s * (3 - 2 * s);
};

/** Pouso nos dois pés (o do joelho que subiu primeiro, ~40 ms antes), em volta de onde o corpo chega. */
function pushLandContacts(plan: LayupPlan): void {
  plan.contacts = plan.contacts.filter((c) => c.role !== 'land');
  const dir = plan.hang ? plan.hang.facing : plan.takeoffDir;
  const first: Side = plan.driveKnee ?? 'l';
  for (const s of [first, otherSideOf(first)] as Side[]) {
    const pos = plan.landPos.add(dir.scale(0.1)).add(sideVec(dir, s).scale(0.15)).flat();
    plan.contacts.push({ foot: s, on: plan.landAt + (s === first ? 0 : 0.04), off: Infinity, pos, dir, role: 'land' });
  }
}

/** Altura do centro de massa (relativa a de pé) que leva a palma ao topo do aro com o corpo pendurado. */
export function hangCom(plan: LayupPlan, heightM: number): number {
  const D = DunkTuning;
  return plan.rim!.z - D.hangPalmToCom * heightM - D.standCom * heightM;
}

/**
 * X segurado na soltura da enterrada: o jogador fica pendurado no aro. As mãos agarram a frente do aro (o lado de onde ele
 * veio), o corpo assenta embaixo delas e solta sozinho em `hangMax` se o X não for solto antes (dropHang).
 */
export function startHang(plan: LayupPlan, heightM: number): void {
  const D = DunkTuning;
  const rim = plan.rim!;
  const rimFloor = rim.flat();
  const grabAt = plan.releaseAt + D.grabAfter;
  const at = airborne(plan, grabAt).pos;
  // Olha para o aro de onde está (a frente do aro é o lado da quadra por onde ele chegou).
  const toRim = rimFloor.sub(at).flat().normalized(plan.takeoffDir);
  const front = toRim.neg();
  const R = 0.236; // centro do aro até o meio do tubo
  const twoHands = isTwoHandDunk(plan.choice.finish);
  const sideDir = right(toRim);
  const grip = (lat: number) => {
    const a = front.scale(Math.sqrt(Math.max(0, R * R - lat * lat))).add(sideDir.scale(lat));
    return rimFloor.add(a).withZ(rim.z + 0.03);
  };
  const handLat = (plan.choice.hand === 'r' ? 1 : -1) * 0.05;
  const grips = twoHands ? [grip(-D.gripHalf), grip(D.gripHalf)] : [grip(handLat)];
  const shift = twoHands ? 0 : handLat - Math.sign(handLat) * D.shoulderHalf;
  plan.hang = {
    grabAt,
    dropAt: grabAt + D.hangMax,
    pos: rimFloor.add(front.scale(D.hangAhead)).add(sideDir.scale(shift)),
    z: hangCom(plan, heightM),
    facing: toRim,
    grips,
    twoHands,
  };
  setHangDrop(plan, plan.hang.dropAt);
}

/** O X foi solto pendurado: solta o aro agora (respeitando o mínimo). */
export function dropHang(plan: LayupPlan, t: number): void {
  const h = plan.hang;
  if (!h || t >= h.dropAt) return;
  setHangDrop(plan, Math.max(t, h.grabAt + DunkTuning.hangMin));
}

/** Refaz o fim do plano a partir da queda: queda livre do pendurado até o pouso, absorção e de pé. */
function setHangDrop(plan: LayupPlan, dropAt: number): void {
  const T = LayupTuning;
  const h = plan.hang!;
  h.dropAt = dropAt;
  const g = T.gravity;
  const fall = Math.sqrt((2 * Math.max(0.05, h.z - T.zTouchdown)) / g);
  plan.landAt = dropAt + fall;
  plan.endAt = plan.landAt + T.recover;
  plan.landPos = airborne(plan, plan.landAt).pos;
  // Altura: o voo até agarrar, assenta pendurado (desce um pouco e volta), cai e absorve o pouso.
  const grab = layupHeightFlight(plan, h.grabAt);
  const keys = plan.heightKeys.filter((k) => k[0] <= plan.takeoffAt + 1e-6);
  keys.push([h.grabAt, grab.z, grab.vz]);
  keys.push([h.grabAt + DunkTuning.settle * 0.6, h.z - 0.05, 0]);
  keys.push([h.grabAt + DunkTuning.settle, h.z, 0]);
  keys.push([dropAt, h.z, 0]);
  keys.push([plan.landAt, T.zTouchdown, -g * fall]);
  keys.push([plan.landAt + T.absorbAt, T.zAbsorb, 0]);
  keys.push([plan.endAt, 0, 0]);
  plan.heightKeys = keys;
  pushLandContacts(plan);
}

/** Altura no voo balístico (sem o pendurado). */
function layupHeightFlight(plan: LayupPlan, t: number): { z: number; vz: number } {
  const g = LayupTuning.gravity;
  const s = t - plan.takeoffAt;
  return { z: LayupTuning.zTakeoff + plan.vz0 * s - 0.5 * g * s * s, vz: plan.vz0 - g * s };
}

/** Altura do centro de massa (m) em relação a de pé, e a velocidade vertical, no instante t. */
export function layupHeight(plan: LayupPlan, t: number): { z: number; vz: number } {
  // Voo balístico (até agarrar o aro, se ficou pendurado: dali em diante as chaves de altura do pendurado e da queda).
  const flightEnd = plan.hang ? plan.hang.grabAt : plan.landAt;
  if (t > plan.takeoffAt && t < flightEnd) return layupHeightFlight(plan, t);
  if (plan.hang && t > plan.hang.dropAt && t < plan.landAt) {
    const s = t - plan.hang.dropAt;
    const g = LayupTuning.gravity;
    return { z: plan.hang.z - 0.5 * g * s * s, vz: -g * s };
  }
  const keys = plan.heightKeys;
  if (t <= keys[0][0]) return { z: keys[0][1], vz: 0 };
  for (let i = 0; i < keys.length - 1; i++) {
    if (t <= keys[i + 1][0]) {
      const r = hermite(t, keys[i], keys[i + 1]);
      return { z: r.z, vz: r.v };
    }
  }
  return { z: 0, vz: 0 };
}

/** Pé no instante t: o contato em que ele está (pé parado) ou entre quais contatos ele está no ar. */
export function layupFootState(plan: LayupPlan, side: Side, t: number): { contact: LayupContact | null; from: LayupContact | null; to: LayupContact | null } {
  const list = plan.contacts.filter((c) => c.foot === side);
  let from: LayupContact | null = null;
  for (const c of list) {
    if (t >= c.on && t <= c.off) return { contact: c, from: null, to: null };
    if (c.off < t) from = c;
    else return { contact: null, from, to: c };
  }
  return { contact: null, from, to: null };
}

/** Tipo de arremesso para o ShotModel: o floater é um arremesso de perto (tabela própria); o resto é bandeja. */
export function layupShotType(plan: LayupPlan): ShotType {
  if (isDunkFinish(plan.choice.finish)) return ShotType.Dunk;
  return plan.choice.finish === LayupFinish.Floater ? ShotType.Floater : ShotType.Layup;
}

/** Rótulo da bandeja para o HUD ("Euro step · finger roll · mão esquerda"). */
export function layupLabel(plan: LayupPlan): string {
  const { choice } = plan;
  if (isDunkFinish(choice.finish)) {
    const finish = LayupFinishLabels[choice.finish];
    const label = finish.charAt(0).toUpperCase() + finish.slice(1);
    return plan.takeoffFoot === 'both' ? `${label} · dois pés` : label;
  }
  const parts = [LayupGatherLabels[choice.gather], LayupFinishLabels[choice.finish]];
  if (plan.wrongFoot) parts.push('pé da mão');
  return parts.join(' · ');
}

/**
 * Distância máxima ao aro em que o X ainda é bandeja (o resto é arremesso): cresce com a velocidade, porque correndo o
 * gather e os dois passos cobrem mais chão (2K: ~4,5 m em velocidade; docs/03-arremessos.md §7.1).
 */
export function layupZoneM(speed: number, command: LayupCommand): number {
  if (command === 'floater') return 6;
  // Enterrada: decola mais longe que a bandeja (~1,5–2 m do aro), então o X vale um pouco mais longe.
  if (command === 'dunk') return clamp(2.8 + 0.42 * speed, 2.8, 5.2);
  return clamp(2.6 + 0.36 * speed, 2.6, 5);
}

/** Variedade do estilo: número em [0, 1) do Rng do jogo. */
export const layupRoll = (rng: Rng): number => rng.nextDouble();
