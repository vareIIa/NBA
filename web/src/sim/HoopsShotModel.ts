// Porte de HoopsShotModel.h/.cpp. Modelo de arremesso (docs/03-arremessos.md):
//  - A janela de timing é calculada UMA vez, no gather, e fica travada (não muda no ar).
//  - Green (Perfeito) livre = cesta garantida. Contestação age só no log-odds L.
//  - Tudo é tunável via ShotTuning.
import { clamp, lerp, logitOf, sigmoid } from './HoopsMath';
import type { Rng } from './HoopsRandom';

export enum ShotType {
  SpotUp, // catch & shoot / parado com os pés posicionados
  PullUp, // pull-up saindo do drible (inclui dribble pull-up em movimento)
  StepBack,
  Fadeaway,
  Floater,
  Hook,
  Heave,
  FreeThrow,
  Layup,
  Dunk,
}

export enum ReleaseSpeed {
  Quick,
  Normal,
  Slow,
}

export enum TimingGrade {
  Green, // Perfeito
  Good,
  SlightlyEarly,
  SlightlyLate,
  VeryEarly,
  VeryLate,
}

export enum CoverageGrade {
  WideOpen, // < 0.15
  Light, // 0.15–0.40
  Contested, // 0.40–0.70
  Smothered, // > 0.70
}

export enum MissType {
  None,
  Short, // aro da frente
  Long, // aro de trás / tabela
  Left,
  Right,
  Airball,
}

export interface ShotTuning {
  // Faixas de timing em relação à janela Perfeito (meia-largura).
  goodWindowScale: number;
  slightWindowScale: number;
  minPerfectHalfWindowMs: number; // piso rígido: 3 frames a 60 Hz
  perfectWindowScale: number; // multiplicador geral (ajustável pelo jogador/designer)

  // Efeito em log-odds (relativo ao "Bom", que é a referência da tabela base).
  greenBonus: number;
  goodBonus: number;
  slightPenalty: number;
  veryPenalty: number;

  contestWeight: number; // K_c
  fatigueWeight: number; // K_f
  balanceWeight: number; // K_b
  maxTraitBonus: number; // soma dos Estilos limitada a ±0.4
  guaranteedMaxContest: number; // green abaixo disso = cesta garantida

  minProbability: number;
  maxProbability: number; // teto quando NÃO é garantida

  deepPenaltyPerMeter: number; // além da linha de 3
  meterOffWindowScale: number;

  // Tempo do gather até o ponto ideal de soltura (ms), por velocidade de soltura.
  idealReleaseMsQuick: number;
  idealReleaseMsNormal: number;
  idealReleaseMsSlow: number;
  /** Segurar o botão até aqui depois do ideal => soltura automática (muito tarde). */
  autoReleaseAfterIdealMs: number;
  /** Toque mais curto que isso = pump fake. */
  pumpFakeMaxHoldMs: number;
}

export const defaultShotTuning = (overrides: Partial<ShotTuning> = {}): ShotTuning => ({
  goodWindowScale: 2.3,
  slightWindowScale: 4.0,
  minPerfectHalfWindowMs: 25.0,
  perfectWindowScale: 1.0,
  greenBonus: 2.5,
  goodBonus: 0.0,
  slightPenalty: -0.3,
  veryPenalty: -1.5,
  contestWeight: 1.8,
  fatigueWeight: 0.8,
  balanceWeight: 0.7,
  maxTraitBonus: 0.4,
  guaranteedMaxContest: 0.3,
  minProbability: 0.01,
  maxProbability: 0.97,
  deepPenaltyPerMeter: 0.35,
  meterOffWindowScale: 1.1,
  idealReleaseMsQuick: 480.0,
  idealReleaseMsNormal: 560.0,
  idealReleaseMsSlow: 640.0,
  autoReleaseAfterIdealMs: 250.0,
  pumpFakeMaxHoldMs: 120.0,
  ...overrides,
});

/** Tudo o que é conhecido no GATHER (antes de sair do chão). */
export interface ShotContext {
  rating: number; // atributo relevante (3PT, Mid-Range, Close, Free Throw)
  distanceMeters: number; // distância horizontal até o centro do aro
  isThree: boolean;
  threePointDistance: number; // para a penalidade de arremesso muito longo
  type: ShotType;
  speed: ReleaseSpeed;
  fatigue: number; // 0 = descansado, 1 = exausto
  balance: number; // 1 = pés posicionados, 0 = totalmente desequilibrado
  traitBonus: number; // soma dos Estilos (limitada por maxTraitBonus)
  meterOff: boolean;
}

export const makeShotContext = (overrides: Partial<ShotContext> = {}): ShotContext => ({
  rating: 75,
  distanceMeters: 7.3,
  isThree: true,
  threePointDistance: 7.24,
  type: ShotType.SpotUp,
  speed: ReleaseSpeed.Normal,
  fatigue: 0,
  balance: 1,
  traitBonus: 0,
  meterOff: false,
  ...overrides,
});

/** Janela travada no gather (meias-larguras em ms). */
export interface TimingWindows {
  idealReleaseMs: number; // tempo do gather até o ponto ideal
  perfectHalfMs: number;
  goodHalfMs: number;
  slightHalfMs: number;
}

export interface ShotEvaluation {
  timing: TimingGrade;
  coverage: CoverageGrade;
  timingOffsetMs: number; // negativo = cedo, positivo = tarde
  contest: number;
  logit: number;
  probability: number;
  guaranteed: boolean;
}

export const makeShotEvaluation = (overrides: Partial<ShotEvaluation> = {}): ShotEvaluation => ({
  timing: TimingGrade.Good,
  coverage: CoverageGrade.WideOpen,
  timingOffsetMs: 0,
  contest: 0,
  logit: 0,
  probability: 0,
  guaranteed: false,
  ...overrides,
});

export interface ShotDecision {
  make: boolean;
  miss: MissType;
}

type RatingTable = ReadonlyArray<readonly [rating: number, value: number]>;

function interpolateTable(table: RatingTable, rating: number): number {
  if (rating <= table[0][0]) {
    return table[0][1];
  }
  for (let index = 1; index < table.length; ++index) {
    if (rating <= table[index][0]) {
      const [aRating, aValue] = table[index - 1];
      const [bRating, bValue] = table[index];
      return lerp(aValue, bValue, (rating - aRating) / (bRating - aRating));
    }
  }
  return table[table.length - 1][1];
}

// Chance com soltura "Boa", livre (docs/03 §3.1).
const ThreePointTable: RatingTable = [[40, 0.18], [60, 0.28], [75, 0.36], [85, 0.42], [99, 0.5]];
const MidRangeTable: RatingTable = [[40, 0.28], [60, 0.38], [75, 0.45], [85, 0.5], [99, 0.56]];
const CloseTable: RatingTable = [[40, 0.4], [60, 0.48], [75, 0.55], [85, 0.6], [99, 0.66]];
const FreeThrowTable: RatingTable = [[40, 0.5], [60, 0.62], [75, 0.72], [85, 0.8], [99, 0.88]];
// Bandeja/enterrada livres (sem contato): quase sempre entram, como no jogo de referência.
const LayupTable: RatingTable = [[40, 0.7], [60, 0.8], [75, 0.87], [85, 0.91], [99, 0.96]];
const DunkTable: RatingTable = [[40, 0.88], [60, 0.93], [75, 0.96], [85, 0.97], [99, 0.99]];
// Decisão D12 (playtest do diretor): janela green ~1,65x maior que a proposta original.
const PerfectWindowTable: RatingTable = [[50, 30], [70, 40], [85, 50], [99, 70]];

const TypeDifficulty: Record<ShotType, number> = {
  [ShotType.SpotUp]: 1.0,
  [ShotType.PullUp]: 0.875,
  [ShotType.StepBack]: 0.8,
  [ShotType.Fadeaway]: 0.75,
  [ShotType.Floater]: 0.8,
  [ShotType.Hook]: 0.85,
  [ShotType.Heave]: 0.25,
  [ShotType.FreeThrow]: 1.0,
  [ShotType.Layup]: 1.0,
  [ShotType.Dunk]: 1.0,
};

const TypeWindowScale: Record<ShotType, number> = {
  [ShotType.SpotUp]: 1.0,
  [ShotType.PullUp]: 0.85,
  [ShotType.StepBack]: 0.8,
  [ShotType.Fadeaway]: 0.75,
  [ShotType.Floater]: 0.85,
  [ShotType.Hook]: 0.85,
  [ShotType.Heave]: 0.3,
  [ShotType.FreeThrow]: 1.3,
  [ShotType.Layup]: 1.6,
  [ShotType.Dunk]: 1.8,
};

const SpeedWindowScale: Record<ReleaseSpeed, number> = {
  [ReleaseSpeed.Quick]: 0.85,
  [ReleaseSpeed.Normal]: 1.0,
  [ReleaseSpeed.Slow]: 1.15,
};

export class ShotModel {
  private readonly tuning: ShotTuning;

  constructor(tuning: ShotTuning = defaultShotTuning()) {
    this.tuning = tuning;
  }

  getTuning(): ShotTuning {
    return this.tuning;
  }

  /** Meia-largura base da janela Perfeito para um rating (99 → 70 ms, 85 → 50, 70 → 40, 50 → 30). */
  static basePerfectHalfWindowMs(rating: number): number {
    return interpolateTable(PerfectWindowTable, rating);
  }

  /** Chance base (soltura "Boa", livre) pela tabela de rating, distância e tipo. */
  baseProbability(context: ShotContext): number {
    let base: number;
    if (context.type === ShotType.FreeThrow) {
      base = interpolateTable(FreeThrowTable, context.rating);
    } else if (context.type === ShotType.Layup) {
      base = interpolateTable(LayupTable, context.rating);
    } else if (context.type === ShotType.Dunk) {
      base = interpolateTable(DunkTable, context.rating);
    } else if (context.isThree) {
      base = interpolateTable(ThreePointTable, context.rating);
    } else if (context.distanceMeters < 3.0) {
      base = interpolateTable(CloseTable, context.rating);
    } else {
      base = interpolateTable(MidRangeTable, context.rating);
    }
    return base * TypeDifficulty[context.type];
  }

  computeWindows(context: ShotContext): TimingWindows {
    const t = this.tuning;
    const idealReleaseMs =
      context.speed === ReleaseSpeed.Quick
        ? t.idealReleaseMsQuick
        : context.speed === ReleaseSpeed.Slow
          ? t.idealReleaseMsSlow
          : t.idealReleaseMsNormal;

    let half = ShotModel.basePerfectHalfWindowMs(context.rating);
    half *= TypeWindowScale[context.type];
    half *= SpeedWindowScale[context.speed];
    half *= 1.0 - 0.3 * clamp(context.fatigue, 0, 1);
    if (context.meterOff) {
      half *= t.meterOffWindowScale;
    }
    half *= t.perfectWindowScale;
    if (half < t.minPerfectHalfWindowMs) {
      half = t.minPerfectHalfWindowMs;
    }

    return {
      idealReleaseMs,
      perfectHalfMs: half,
      goodHalfMs: half * t.goodWindowScale,
      slightHalfMs: half * t.slightWindowScale,
    };
  }

  gradeTiming(timingOffsetMs: number, windows: TimingWindows): TimingGrade {
    const abs = Math.abs(timingOffsetMs);
    const early = timingOffsetMs < 0;
    if (abs <= windows.perfectHalfMs) {
      return TimingGrade.Green;
    }
    if (abs <= windows.goodHalfMs) {
      return TimingGrade.Good;
    }
    if (abs <= windows.slightHalfMs) {
      return early ? TimingGrade.SlightlyEarly : TimingGrade.SlightlyLate;
    }
    return early ? TimingGrade.VeryEarly : TimingGrade.VeryLate;
  }

  static gradeCoverage(contest: number): CoverageGrade {
    if (contest < 0.15) {
      return CoverageGrade.WideOpen;
    }
    if (contest < 0.4) {
      return CoverageGrade.Light;
    }
    if (contest < 0.7) {
      return CoverageGrade.Contested;
    }
    return CoverageGrade.Smothered;
  }

  /** Avalia o arremesso na soltura. holdMs = tempo do gather até soltar o botão. */
  evaluate(context: ShotContext, windows: TimingWindows, holdMs: number, contest: number): ShotEvaluation {
    const t = this.tuning;
    const result = makeShotEvaluation();
    result.contest = clamp(contest, 0, 1);
    result.timingOffsetMs = holdMs - windows.idealReleaseMs;
    result.timing = this.gradeTiming(result.timingOffsetMs, windows);
    result.coverage = ShotModel.gradeCoverage(result.contest);

    let logit = logitOf(this.baseProbability(context));

    // Arremesso muito além da linha de 3.
    if (context.isThree && context.type !== ShotType.Heave) {
      const beyond = context.distanceMeters - (context.threePointDistance + 0.6);
      if (beyond > 0) {
        logit -= t.deepPenaltyPerMeter * beyond;
      }
    }

    switch (result.timing) {
      case TimingGrade.Green:
        logit += t.greenBonus;
        break;
      case TimingGrade.Good:
        logit += t.goodBonus;
        break;
      case TimingGrade.SlightlyEarly:
      case TimingGrade.SlightlyLate:
        logit += t.slightPenalty;
        break;
      case TimingGrade.VeryEarly:
      case TimingGrade.VeryLate:
        logit += t.veryPenalty;
        break;
    }

    logit -= t.contestWeight * result.contest;
    logit -= t.fatigueWeight * clamp(context.fatigue, 0, 1);
    logit -= t.balanceWeight * (1 - clamp(context.balance, 0, 1));
    logit += clamp(context.traitBonus, -t.maxTraitBonus, t.maxTraitBonus);

    result.logit = logit;
    result.guaranteed =
      result.timing === TimingGrade.Green && result.contest < t.guaranteedMaxContest && context.type !== ShotType.Heave;

    if (result.guaranteed) {
      result.probability = 1;
    } else {
      const maxP = context.type === ShotType.Heave ? 0.25 : t.maxProbability;
      result.probability = clamp(sigmoid(logit), t.minProbability, maxP);
    }
    return result;
  }

  /** Decide cesta/erro (determinístico com a Rng) e o tipo de erro coerente com o feedback. */
  decide(evaluation: ShotEvaluation, random: Rng): ShotDecision {
    const decision: ShotDecision = { make: false, miss: MissType.None };
    // Sorteio sempre consumido, para a sequência da Rng não depender do resultado.
    const roll = random.nextDouble();
    const sideRoll = random.nextDouble();

    decision.make = evaluation.guaranteed || roll < evaluation.probability;
    if (decision.make) {
      return decision;
    }

    const veryBad = evaluation.timing === TimingGrade.VeryEarly || evaluation.timing === TimingGrade.VeryLate;
    if (veryBad && evaluation.contest > 0.7 && sideRoll < 0.35) {
      decision.miss = MissType.Airball;
      return decision;
    }

    switch (evaluation.timing) {
      case TimingGrade.SlightlyEarly:
      case TimingGrade.VeryEarly:
        // Cedo: arco alto, tende a sair curto.
        decision.miss = sideRoll < 0.7 ? MissType.Short : sideRoll < 0.85 ? MissType.Left : MissType.Right;
        break;
      case TimingGrade.SlightlyLate:
      case TimingGrade.VeryLate:
        // Tarde: arco achatado, tende a sair longo.
        decision.miss = sideRoll < 0.7 ? MissType.Long : sideRoll < 0.85 ? MissType.Left : MissType.Right;
        break;
      default:
        // Bom (ou green contestado) que não caiu: erro "de aro" variado.
        if (sideRoll < 0.3) decision.miss = MissType.Short;
        else if (sideRoll < 0.6) decision.miss = MissType.Long;
        else if (sideRoll < 0.8) decision.miss = MissType.Left;
        else decision.miss = MissType.Right;
        break;
    }
    return decision;
  }

  /** Fadiga a partir da energia (0..1): começa a doer abaixo de 40%. */
  static fatigueFromEnergy(energy: number): number {
    return clamp((0.4 - energy) / 0.4, 0, 1);
  }
}

// Pull-up sem frear (docs/17 §3.4, P0-9): em vez de cortar a velocidade no gather, o corpo leva o embalo do
// drible (o último quique vira o gather) e desacelera em 1–2 passos de plant até a deriva do salto.
export interface GatherCarryTuning {
  pullUpKeep: number; // fração da velocidade de entrada mantida no gather (antes: 0,35 e freio)
  stepBackKeep: number; // step-back: leva o embalo para trás do próprio movimento
  fadeawayKeep: number; // fadeaway: a deriva dele é para trás (somada fora daqui)
  spotUpKeep: number; // spot-up, heave...: pés já posicionados, planta na hora
  plantSeconds: number; // gather → decolagem: a velocidade cai em linha reta até a deriva
  plantMaxMeters: number; // o plant nunca anda mais que isso (limite de warp, docs/04 §1.2)
  pullUpDriftFraction: number; // deriva no ar do pull-up = fração da entrada...
  pullUpDriftMaxSpeed: number; // ...até 0,75 m/s (pouso 10–30 cm à frente, docs/17 §3.6)
}

export const defaultGatherCarryTuning = (): GatherCarryTuning => ({
  pullUpKeep: 0.85,
  stepBackKeep: 0.85,
  fadeawayKeep: 0.35,
  spotUpKeep: 0.1,
  plantSeconds: 0.3,
  plantMaxMeters: 0.6,
  pullUpDriftFraction: 0.12,
  pullUpDriftMaxSpeed: 0.75,
});

export class GatherCarry {
  keepSpeed = 0; // m/s logo no gather, no sentido em que o jogador vinha
  driftSpeed = 0; // m/s depois do plant (deriva do salto, mesmo sentido)
  plantSeconds = 0; // duração do plant

  /** Velocidade (m/s) no sentido do embalo, secondsSinceGather depois do gather. */
  speedAt(secondsSinceGather: number): number {
    if (secondsSinceGather <= 0) {
      return this.keepSpeed;
    }
    if (this.plantSeconds <= 0 || secondsSinceGather >= this.plantSeconds) {
      return this.driftSpeed;
    }
    return lerp(this.keepSpeed, this.driftSpeed, secondsSinceGather / this.plantSeconds);
  }

  /** Distância andada no plant (m). */
  plantMeters(): number {
    return 0.5 * (this.keepSpeed + this.driftSpeed) * this.plantSeconds;
  }
}

/** entrySpeed = velocidade horizontal (m/s) no gather, já com o impulso do drible e o arranque de saída. */
export function computeGatherCarry(tuning: GatherCarryTuning, type: ShotType, entrySpeed: number): GatherCarry {
  const entry = entrySpeed > 0 ? entrySpeed : 0;
  let keep = tuning.spotUpKeep;
  if (type === ShotType.PullUp) keep = tuning.pullUpKeep;
  else if (type === ShotType.StepBack) keep = tuning.stepBackKeep;
  else if (type === ShotType.Fadeaway) keep = tuning.fadeawayKeep;

  const carry = new GatherCarry();
  carry.keepSpeed = entry * keep;
  // Só o pull-up deriva para frente no ar; step-back/fadeaway derivam para trás (fora daqui), o resto planta.
  if (type === ShotType.PullUp) {
    const drift = entry * tuning.pullUpDriftFraction;
    carry.driftSpeed = drift < tuning.pullUpDriftMaxSpeed ? drift : tuning.pullUpDriftMaxSpeed;
    if (carry.driftSpeed > carry.keepSpeed) {
      carry.driftSpeed = carry.keepSpeed;
    }
  }
  // Plant de 1–2 passos; em velocidade alta ele fica mais curto para não andar mais que o limite.
  carry.plantSeconds = tuning.plantSeconds;
  const average = 0.5 * (carry.keepSpeed + carry.driftSpeed);
  if (average > 1e-9 && average * carry.plantSeconds > tuning.plantMaxMeters) {
    carry.plantSeconds = tuning.plantMaxMeters / average;
  }
  return carry;
}

// Texto curto (pt-BR) para HUD e logs.
const TimingLabels: Record<TimingGrade, string> = {
  [TimingGrade.Green]: 'GREEN',
  [TimingGrade.Good]: 'BOM',
  [TimingGrade.SlightlyEarly]: 'LEVE CEDO',
  [TimingGrade.SlightlyLate]: 'LEVE TARDE',
  [TimingGrade.VeryEarly]: 'MUITO CEDO',
  [TimingGrade.VeryLate]: 'MUITO TARDE',
};
const CoverageLabels: Record<CoverageGrade, string> = {
  [CoverageGrade.WideOpen]: 'LIVRE',
  [CoverageGrade.Light]: 'LEVE',
  [CoverageGrade.Contested]: 'CONTESTADO',
  [CoverageGrade.Smothered]: 'SUFOCADO',
};
const ShotTypeLabels: Record<ShotType, string> = {
  [ShotType.SpotUp]: 'Spot-up',
  [ShotType.PullUp]: 'Pull-up',
  [ShotType.StepBack]: 'Step-back',
  [ShotType.Fadeaway]: 'Fadeaway',
  [ShotType.Floater]: 'Floater',
  [ShotType.Hook]: 'Hook',
  [ShotType.Heave]: 'Heave',
  [ShotType.FreeThrow]: 'Lance livre',
  [ShotType.Layup]: 'Bandeja',
  [ShotType.Dunk]: 'Enterrada',
};

export const timingGradeLabel = (grade: TimingGrade): string => TimingLabels[grade] ?? '?';
export const coverageGradeLabel = (grade: CoverageGrade): string => CoverageLabels[grade] ?? '?';
export const shotTypeLabel = (type: ShotType): string => ShotTypeLabels[type] ?? '?';
