// Liga a jogada ao HUD de gameplay: badges (HoopsBadges), takeover (HoopsTakeover), nota de teammate, box score e
// relógio de posse. O Freestyle só avisa (soltura, resultado, drible) e chama modifyShot na soltura; tudo o que é
// "regra de partida" mora aqui, fora do código de movimento.
import {
  type BadgeId,
  BadgeEngine,
  type BadgeLoadout,
  BadgeTier,
  Badges,
  GradeEvent,
  type GradeChange,
  ShotModel,
  ShotType,
  type ShotContext,
  type ShotEvaluation,
  TakeoverEvent,
  TakeoverMeter,
  Takeovers,
  type TakeoverChange,
  type TakeoverId,
  TeammateGrade,
  TimingGrade,
  type Vec3,
  DribbleMove,
  badgeTierName,
  distance2D,
  makeShotSituation,
  ppToLogit,
} from '../sim';
import type { GameHud, HudNotice, TimingTone } from '../hud/GameHud';
import type { Freestyle, ShotRecord } from './Freestyle';
import { GameStats } from './GameStats';
import type { PlayerRing } from './PlayerRing';

/** Build do diretor (cardoso2k): os badges que aparecem no vídeo de referência e o resto de um armador arremessador. */
export const DirectorLoadout: BadgeLoadout = {
  Agent3: BadgeTier.Gold,
  VolumeShooter: BadgeTier.Gold,
  GreenMachine: BadgeTier.Gold,
  QuickFirstStep: BadgeTier.HallOfFame,
  HandlesForDays: BadgeTier.Gold,
  LimitlessRange: BadgeTier.Gold,
  CatchAndShoot: BadgeTier.Silver,
  Blinders: BadgeTier.Gold,
  Deadeye: BadgeTier.Silver,
  SpaceCreator: BadgeTier.Silver,
  MiddyMagician: BadgeTier.Bronze,
  Amped: BadgeTier.Bronze,
  Hyperdrive: BadgeTier.Gold,
  BailOut: BadgeTier.Bronze,
  AnkleBreaker: BadgeTier.Silver,
  ClampBreaker: BadgeTier.HallOfFame,
  Unpluckable: BadgeTier.Gold,
  Slithery: BadgeTier.Silver,
  FearlessFinisher: BadgeTier.Gold,
  ProTouch: BadgeTier.Bronze,
  GiantSlayer: BadgeTier.Gold,
  Acrobat: BadgeTier.Silver,
};

export interface MatchOptions {
  playerName: string;
  opponentName: string;
  loadout: BadgeLoadout;
  primary: TakeoverId;
  secondary: TakeoverId;
  team: TakeoverId;
}

const ShotClockSeconds = 24;
const DribbleBadgeCooldown = 3.5; // s entre dois avisos do mesmo badge de drible
const SizeUpMaxSpeed = 1.2; // m/s: abaixo disso o drible começou parado (size-up / triple threat)
const OffDribbleSeconds = 1.0; // arremesso até 1 s depois de um drible conta como "saindo do drible"
const CornerFromBaseline = 4.27; // trecho reto da linha de 3 (14 pés)

/** 2K23: Excellent = green; o nosso "Bom" fica entre o green e o "levemente". */
function timingText(timing: TimingGrade, offsetMs: number): { text: string; tone: TimingTone } {
  const early = offsetMs < 0;
  switch (timing) {
    case TimingGrade.Green:
      return { text: 'EXCELLENT', tone: 'excellent' };
    case TimingGrade.Good:
      return { text: early ? 'SLIGHTLY EARLY' : 'SLIGHTLY LATE', tone: 'good' };
    case TimingGrade.SlightlyEarly:
      return { text: 'EARLY', tone: 'slight' };
    case TimingGrade.SlightlyLate:
      return { text: 'LATE', tone: 'slight' };
    case TimingGrade.VeryEarly:
      return { text: 'VERY EARLY', tone: 'bad' };
    default:
      return { text: 'VERY LATE', tone: 'bad' };
  }
}

/** Rótulos de cobertura do 2K (pela contestação 0..1). */
export function coverageText(contest: number): string {
  if (contest < 0.05) return 'WIDE OPEN';
  if (contest < 0.2) return 'OPEN';
  if (contest < 0.65) return 'LIGHTLY CONTESTED';
  if (contest < 0.9) return 'HEAVILY CONTESTED';
  return 'SMOTHERED';
}

export class MatchDirector {
  readonly stats = new GameStats();
  readonly badges: BadgeEngine;
  readonly takeover: TakeoverMeter;
  readonly grade = new TeammateGrade();
  shotClock = ShotClockSeconds;
  readonly activations: BadgeId[] = [];

  private readonly options: MatchOptions;
  private lastMoveSizeUp = false;
  private lastNotice = new Map<BadgeId, number>();
  private clock = 0;
  private stillSeconds = 0;
  private catchTime = -Infinity;
  private prevPhase = '';
  private lastContest = 0;
  private lastSelection: GradeEvent | null = null;
  /** O último arremesso foi de média/longa (não bandeja/enterrada): Volume Shooter e Green Machine só contam esses. */
  private lastJumper = true;
  /** Bandeja/enterrada não têm timing (soltura sempre "Boa"): a faixa mostra o tipo da finalização no lugar. */
  private lastFinish: 'LAYUP' | 'DUNK' | null = null;

  constructor(
    private readonly game: Freestyle,
    private readonly hud: GameHud,
    private readonly ring: PlayerRing | null,
    options: Partial<MatchOptions> = {},
  ) {
    this.options = {
      playerName: 'cardoso2k',
      opponentName: 'CPU',
      loadout: DirectorLoadout,
      primary: 'EasyBlowbys',
      secondary: 'LimitlessRange',
      team: 'TeamBadgeBoost',
      ...options,
    };
    this.badges = new BadgeEngine(this.options.loadout);
    this.takeover = new TakeoverMeter(this.options.primary, this.options.secondary, this.options.team);
  }

  // ---------------------------------------------------------------- ganchos do Freestyle

  /** Na soltura (antes do ShotModel.evaluate): badges e takeover entram no contexto. */
  modifyShot(context: ShotContext, timing: TimingGrade, contest: number): void {
    const game = this.game;
    const tuning = game.model.getTuning();
    const gatherAt = game.now - game.holdMs / 1000;
    const lastMove = game.dribble.getLastMove();
    const sinceMove = gatherAt - game.dribble.getLastMoveEndTime();
    const offDribble = context.type === ShotType.PullUp || sinceMove < OffDribbleSeconds;
    const stepBack =
      context.type === ShotType.StepBack ||
      (sinceMove < OffDribbleSeconds && (lastMove === DribbleMove.StepBack || lastMove === DribbleMove.EscapeStepBack));
    const fromBaseline = game.position.x - game.layout.baselineX;
    const situation = makeShotSituation({
      type: context.type,
      timing,
      isThree: context.isThree,
      isCorner: context.isThree && fromBaseline < CornerFromBaseline,
      distanceMeters: context.distanceMeters,
      threePointDistance: context.threePointDistance,
      baseProbability: game.model.baseProbability(context),
      energy: game.dribble.getEnergy(),
      fatigue: context.fatigue,
      offDribble,
      stepBack,
      secondsSinceCatch: gatherAt - this.catchTime,
      stillSeconds: this.stillSeconds,
      contest,
    });
    const weights = { fatigueWeight: tuning.fatigueWeight, contestWeight: tuning.contestWeight, deepPenaltyPerMeter: tuning.deepPenaltyPerMeter };
    const result = this.badges.shotModifiers(situation, weights);
    let bonus = result.badgeBonus;

    // Takeover: Limitless Range (até o logo) e Pull-Up / Spot-Up Precision.
    const beyond = context.distanceMeters - (context.threePointDistance + 0.6);
    if (context.isThree && beyond > 0 && this.takeover.removesDeepPenalty()) {
      const already = result.contributions.find((c) => c.id === 'LimitlessRange')?.logit ?? 0;
      bonus += tuning.deepPenaltyPerMeter * beyond - already;
    }
    const wellTimed = timing === TimingGrade.Green || timing === TimingGrade.Good;
    const precision = this.takeover.precisionBonusPp(offDribble, wellTimed);
    if (precision > 0) bonus += ppToLogit(situation.baseProbability, precision);

    context.badgeBonus = bonus;
    context.badgeContestScale = result.contestScale;
    this.lastContest = contest;
    this.lastJumper = context.type !== ShotType.Layup && context.type !== ShotType.Dunk;
    this.lastFinish = context.type === ShotType.Layup ? 'LAYUP' : context.type === ShotType.Dunk ? 'DUNK' : null;

    // Seleção de arremesso (nota do teammate): livre e dentro do alcance = boa; forçado = ruim.
    const range = context.threePointDistance + (this.badges.has('LimitlessRange') || this.takeover.removesDeepPenalty() ? 3.0 : 1.5);
    const forced = contest >= 0.65 || context.distanceMeters > range + 1.0 || (this.shotClock > 20 && contest >= 0.4);
    this.lastSelection = forced ? GradeEvent.BadShotSelection : contest < 0.2 && context.distanceMeters <= range ? GradeEvent.GoodShotSelection : null;

    // Avisos: no máximo dois badges por arremesso (os que mais pesaram).
    for (const id of result.activated.slice(0, 2)) this.noticeBadge(id, 0);
  }

  onRelease(evaluation: ShotEvaluation): void {
    const coverage = coverageText(this.lastContest);
    if (this.lastFinish) {
      // Finalização: sem timing, sem green (bLastShotGreen = false na Unreal); só a seleção de arremesso conta.
      this.hud.notify({ kind: 'timing', label: 'SHOT', timing: this.lastFinish, coverage, tone: 'good' });
      if (this.lastSelection !== null) this.applyGrade(this.lastSelection);
      this.shotClock = ShotClockSeconds;
      return;
    }
    const green = evaluation.timing === TimingGrade.Green;
    const timing = timingText(evaluation.timing, evaluation.timingOffsetMs);
    this.hud.notify({ kind: 'timing', timing: timing.text, coverage, tone: timing.tone });
    this.badges.onRelease(green, this.lastJumper);
    this.stats.recordRelease(green);
    if (green) {
      this.applyTakeover(TakeoverEvent.Green);
      this.applyGrade(GradeEvent.ExcellentShotRelease);
    } else if (evaluation.timing === TimingGrade.VeryLate || evaluation.timing === TimingGrade.VeryEarly) {
      this.applyGrade(GradeEvent.VeryLateRelease);
    }
    if (this.lastSelection !== null) this.applyGrade(this.lastSelection);
    if (this.lastSelection === GradeEvent.BadShotSelection) this.applyTakeover(TakeoverEvent.BadShot);
    // A bola saiu da mão: o relógio de posse para até o rebote/volta.
    this.shotClock = ShotClockSeconds;
  }

  onResult(record: ShotRecord): void {
    this.stats.recordShot({ scored: record.scored, isThree: record.isThree, green: record.timing === 'GREEN' });
    this.badges.onShotResult(record.scored, this.lastJumper);
    if (record.scored) {
      this.applyTakeover(record.isThree ? TakeoverEvent.MakeThree : TakeoverEvent.Make);
      this.applyGrade(record.isThree ? GradeEvent.MadeThree : GradeEvent.MadeShot);
    } else {
      this.applyTakeover(TakeoverEvent.Miss);
    }
  }

  /** onMove do Freestyle: começo de um drible ou o arranque de saída ('Arranque'). */
  onMove(label: string): void {
    const game = this.game;
    if (label === 'Arranque') {
      this.applyTakeover(TakeoverEvent.ExitBurst);
      for (const id of this.badges.onExitBurst(this.lastMoveSizeUp)) this.noticeBadge(id, DribbleBadgeCooldown);
      return;
    }
    const speed = game.velocity.length2D();
    this.lastMoveSizeUp = speed < SizeUpMaxSpeed;
    const comboCount = game.dribble.getComboCount();
    const ids = this.badges.onDribbleMove({ sprinting: speed > 4.5, moving: speed > 1, sizeUp: this.lastMoveSizeUp, comboCount });
    for (const id of ids) this.noticeBadge(id, DribbleBadgeCooldown);
    if (comboCount >= 2) this.applyTakeover(TakeoverEvent.DribbleCombo);
  }

  // ---------------------------------------------------------------- quadro a quadro

  /** project: núcleo → pixels da tela (para o nome/energia embaixo do jogador). */
  update(dt: number, sprinting: boolean, project: (p: Vec3) => { x: number; y: number; visible: boolean }): void {
    const game = this.game;
    this.clock += dt;
    const speed = game.velocity.length2D();
    this.stillSeconds = speed < 0.35 && game.phase === 'dribble' ? this.stillSeconds + dt : 0;
    // A bola voltando para a mão (o "passe do rebote" do Freestyle) é uma recepção: abre o Catch and Shoot.
    if (this.prevPhase === 'return' && game.phase === 'dribble') {
      this.catchTime = game.now;
      this.stillSeconds = 0;
    }
    this.prevPhase = game.phase;

    // Relógio de posse: corre com a bola na mão.
    if (game.phase === 'dribble' || game.phase === 'gather') {
      this.shotClock = Math.max(0, this.shotClock - dt);
      if (this.shotClock <= 0) {
        this.applyGrade(GradeEvent.ShotClockViolation);
        this.applyTakeover(TakeoverEvent.ShotClockViolation);
        this.shotClock = ShotClockSeconds;
      }
    }

    // Takeover e badges.
    if (this.takeover.update(dt)) this.hud.pulseBolt(0.4);
    this.badges.tierBoost = this.takeover.badgeTierBoost();
    const mods = this.badges.dribbleModifiers({ sprinting, moving: speed > 1, sizeUp: this.lastMoveSizeUp });
    mods.burstScale *= this.takeover.burstScale();
    mods.speedScale *= this.takeover.speedScale();
    game.dribble.modifiers = mods;

    // HUD.
    const s = this.stats;
    this.hud.setCard({ name: this.options.playerName, pts: s.points, reb: s.rebounds, ast: s.assists, threePct: s.threePct() });
    this.hud.setGrade(this.grade.letter());
    const slot = (id: TakeoverId, state: { fill: number; active: boolean }) => ({
      label: Takeovers[id].name,
      glyph: Takeovers[id].glyph,
      fill: state.fill,
      active: state.active,
    });
    this.hud.setTakeover({
      team: slot(this.options.team, this.takeover.team),
      primary: slot(this.options.primary, this.takeover.primary),
      secondary: slot(this.options.secondary, this.takeover.secondary),
    });
    this.hud.setScoreboard({
      home: this.options.playerName,
      away: this.options.opponentName,
      homeScore: s.points,
      awayScore: 0,
      shotClock: this.shotClock,
    });
    const feet = project(game.position.withZ(0));
    this.hud.setPlayerPlate(feet.x, feet.y + 14, game.dribble.getEnergy(), feet.visible);
    this.ring?.setFire(this.takeover.anyActive());
  }

  // ---------------------------------------------------------------- internos

  private noticeBadge(id: BadgeId, cooldown: number): void {
    const last = this.lastNotice.get(id) ?? -Infinity;
    if (this.clock - last < cooldown) return;
    this.lastNotice.set(id, this.clock);
    const def = Badges[id];
    this.activations.push(id);
    const notice: HudNotice = { kind: 'badge', name: def.name, category: def.category, tier: badgeTierName(this.badges.tier(id)) };
    this.hud.notify(notice);
  }

  private applyGrade(event: GradeEvent): GradeChange {
    const change = this.grade.apply(event);
    if (change.text) this.hud.notify({ kind: 'grade', text: change.text, positive: change.delta > 0 });
    return change;
  }

  private applyTakeover(event: TakeoverEvent): TakeoverChange {
    const change = this.takeover.apply(event);
    if (change.gained) this.hud.pulseBolt();
    if (change.activated) {
      this.hud.flashSweep();
      this.hud.pulseBolt(1.5);
      const id = change.activated === 'primary' ? this.options.primary : change.activated === 'secondary' ? this.options.secondary : this.options.team;
      this.hud.notify({ kind: 'grade', text: `${Takeovers[id].name} Takeover`, positive: true });
    }
    return change;
  }

  /** Para os testes/depuração. */
  snapshot(): Record<string, unknown> {
    return {
      grade: this.grade.letter(),
      gradeScore: Math.round(this.grade.score * 10) / 10,
      stats: { ...this.stats, threePct: this.stats.threePct() },
      shotClock: Math.round(this.shotClock * 10) / 10,
      takeover: {
        primary: { ...this.takeover.primary },
        secondary: { ...this.takeover.secondary },
        team: { ...this.takeover.team },
      },
      activations: [...this.activations],
      notice: this.hud.currentNoticeText(),
      distanceToRim: Math.round(distance2D(this.game.position, this.game.layout.rimFloorPoint) * 100) / 100,
      fatigue: ShotModel.fatigueFromEnergy(this.game.dribble.getEnergy()),
    };
  }
}
