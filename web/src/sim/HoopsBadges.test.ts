// Badges do 2K23, takeover e nota de teammate (docs/19-badges-2k23.md).
import { describe, expect, test } from 'vitest';
import {
  AllBadgeIds,
  BadgeEngine,
  BadgeTier,
  Badges,
  GradeEvent,
  ShotModel,
  ShotType,
  TakeoverEvent,
  TakeoverMeter,
  TeammateGrade,
  TimingGrade,
  defaultShotTuning,
  gradeLetterFor,
  makeShotContext,
  makeShotSituation,
  ppToLogit,
} from './index';

const weights = { fatigueWeight: 0.8, contestWeight: 1.8, deepPenaltyPerMeter: 0.35 };

describe('catálogo', () => {
  test('64 badges, 16 por categoria', () => {
    expect(AllBadgeIds).toHaveLength(64);
    for (const category of ['Finishing', 'Shooting', 'Playmaking', 'Defense'] as const) {
      expect(AllBadgeIds.filter((id) => Badges[id].category === category)).toHaveLength(16);
    }
  });

  test('todo badge que não ativa no Freestyle diz o que falta', () => {
    for (const id of AllBadgeIds) {
      const def = Badges[id];
      if (def.status !== 'live') expect(def.needs, id).toBeTruthy();
      expect(def.values).toHaveLength(4);
    }
  });
});

describe('arremesso', () => {
  test('pontos percentuais viram log-odds na chance base', () => {
    const p0 = 0.42;
    const bonus = ppToLogit(p0, 10);
    expect(1 / (1 + Math.exp(-(Math.log(p0 / (1 - p0)) + bonus)))).toBeCloseTo(0.52, 6);
  });

  test('Agent 3: só no 3 saindo do drible, nunca no step-back; Ouro sobe nas bordas', () => {
    const engine = new BadgeEngine({ Agent3: BadgeTier.Gold });
    const pullUp = makeShotSituation({ type: ShotType.PullUp, isThree: true, offDribble: true, distanceMeters: 7.4 });
    expect(engine.shotModifiers(pullUp, weights).activated).toEqual(['Agent3']);
    const center = engine.shotModifiers(pullUp, weights).contributions[0].pp;
    const edge = engine.shotModifiers({ ...pullUp, timing: TimingGrade.SlightlyLate }, weights).contributions[0].pp;
    expect(edge).toBeGreaterThan(center);
    expect(engine.shotModifiers({ ...pullUp, stepBack: true }, weights).activated).toEqual([]);
    expect(engine.shotModifiers({ ...pullUp, offDribble: false }, weights).activated).toEqual([]);
  });

  test('Volume Shooter cresce do 1º ao 5º arremesso', () => {
    const engine = new BadgeEngine({ VolumeShooter: BadgeTier.HallOfFame });
    const s = makeShotSituation({ isThree: true, distanceMeters: 7.4 });
    expect(engine.shotModifiers(s, weights).activated).toEqual([]);
    engine.onRelease(false);
    const after1 = engine.shotModifiers(s, weights).contributions[0].pp;
    for (let i = 0; i < 6; i++) engine.onRelease(false);
    const peak = engine.shotModifiers(s, weights).contributions[0].pp;
    expect(after1).toBeCloseTo(2, 6);
    expect(peak).toBeCloseTo(10, 6);
  });

  test('Green Machine: 2 greens seguidos armam; vale até errar', () => {
    const engine = new BadgeEngine({ GreenMachine: BadgeTier.Gold });
    const s = makeShotSituation();
    engine.onRelease(true);
    expect(engine.greenMachineActive()).toBe(false);
    engine.onRelease(true);
    expect(engine.greenMachineActive()).toBe(true);
    expect(engine.shotModifiers(s, weights).contributions.find((c) => c.id === 'GreenMachine')?.pp).toBe(15);
    engine.onRelease(false); // soltura ruim que ainda caiu: continua
    engine.onShotResult(true);
    expect(engine.greenMachineActive()).toBe(true);
    engine.onShotResult(false);
    expect(engine.greenMachineActive()).toBe(false);
  });

  test('bandeja e enterrada não contam para Volume Shooter nem quebram o Green Machine', () => {
    const engine = new BadgeEngine({ GreenMachine: BadgeTier.Gold, VolumeShooter: BadgeTier.Gold });
    engine.onRelease(true);
    engine.onRelease(false, false); // bandeja sem green no meio
    engine.onShotResult(false, false); // e errada
    engine.onRelease(true);
    expect(engine.jumpers()).toBe(2);
    expect(engine.greenMachineActive()).toBe(true);
  });

  test('Catch and Shoot até 1,5 s da recepção e sem juntar com o Limitless Range', () => {
    const engine = new BadgeEngine({ CatchAndShoot: BadgeTier.Silver, LimitlessRange: BadgeTier.Gold });
    const near = makeShotSituation({ isThree: true, distanceMeters: 7.4, secondsSinceCatch: 0.8 });
    expect(engine.shotModifiers(near, weights).activated).toContain('CatchAndShoot');
    expect(engine.shotModifiers({ ...near, secondsSinceCatch: 2 }, weights).activated).not.toContain('CatchAndShoot');
    const deep = { ...near, distanceMeters: 8.8 };
    const result = engine.shotModifiers(deep, weights);
    expect(result.activated).toContain('LimitlessRange');
    expect(result.activated).not.toContain('CatchAndShoot');
  });

  test('Limitless Range devolve a fração certa da penalidade de distância', () => {
    const engine = new BadgeEngine({ LimitlessRange: BadgeTier.Gold });
    const s = makeShotSituation({ isThree: true, distanceMeters: 9.84, threePointDistance: 7.24 });
    const beyond = 9.84 - (7.24 + 0.6);
    expect(engine.shotModifiers(s, weights).badgeBonus).toBeCloseTo(weights.deepPenaltyPerMeter * beyond * 0.75, 6);
  });

  test('Challenger do defensor tira chance; Deadeye reduz o peso da contestação', () => {
    const shooter = new BadgeEngine({ Deadeye: BadgeTier.Gold });
    const s = makeShotSituation({ isThree: true, contest: 0.5, defender: { Challenger: BadgeTier.HallOfFame } });
    const result = shooter.shotModifiers(s, weights);
    expect(result.contestScale).toBeCloseTo(0.55, 6);
    expect(result.contributions.find((c) => c.id === 'Challenger')).toMatchObject({ owner: 'defender', pp: -9 });
    expect(result.activated).toEqual(['Deadeye']);
  });

  test('Perimeter Badge Drop e Team Badge Boost mudam o nível', () => {
    const engine = new BadgeEngine({ CornerSpecialist: BadgeTier.Gold });
    const corner = makeShotSituation({ isThree: true, isCorner: true });
    expect(engine.shotModifiers(corner, weights).contributions[0].pp).toBe(6);
    expect(engine.shotModifiers({ ...corner, defenderPerimeterBadgeDrop: true }, weights).contributions[0].pp).toBe(4);
    engine.tierBoost = 1;
    expect(engine.shotModifiers(corner, weights).contributions[0].pp).toBe(8);
  });

  test('badgeBonus entra no ShotModel e muda a chance (green livre continua garantido)', () => {
    const model = new ShotModel(defaultShotTuning());
    const context = makeShotContext({ rating: 85, distanceMeters: 7.4, isThree: true });
    const windows = model.computeWindows(context);
    const good = windows.idealReleaseMs + windows.perfectHalfMs * 1.5;
    const base = model.evaluate(context, windows, good, 0).probability;
    const boosted = model.evaluate({ ...context, badgeBonus: ppToLogit(model.baseProbability(context), 10) }, windows, good, 0).probability;
    expect(boosted).toBeGreaterThan(base + 0.05);
    expect(model.evaluate({ ...context, badgeBonus: -1 }, windows, windows.idealReleaseMs, 0).guaranteed).toBe(true);
  });
});

describe('drible', () => {
  test('Handles for Days: HOF dobra os dribles até cansar; Quick First Step só saindo do size-up', () => {
    const engine = new BadgeEngine({ HandlesForDays: BadgeTier.HallOfFame, QuickFirstStep: BadgeTier.HallOfFame });
    const still = engine.dribbleModifiers({ sprinting: false, moving: false, sizeUp: true });
    expect(still.moveEnergyScale).toBeCloseTo(0.5, 6);
    expect(still.burstScale).toBeCloseTo(1 / 0.88, 6);
    expect(engine.dribbleModifiers({ sprinting: true, moving: true, sizeUp: false }).burstScale).toBe(1);
    expect(engine.onExitBurst(true)).toEqual(['QuickFirstStep']);
    expect(engine.onExitBurst(false)).toEqual([]);
  });
});

describe('takeover', () => {
  test('enche com cesta, acende cheio, acaba depois de 2 jogadas ruins', () => {
    const meter = new TakeoverMeter('PullUpPrecision', 'LimitlessRange', 'TeamBadgeBoost');
    let activated = null;
    for (let i = 0; i < 8 && !activated; i++) activated = meter.apply(TakeoverEvent.MakeThree).activated;
    expect(activated).toBe('primary');
    expect(meter.isActive('PullUpPrecision')).toBe(true);
    expect(meter.precisionBonusPp(true, true)).toBe(6);
    meter.apply(TakeoverEvent.Miss);
    expect(meter.primary.active).toBe(true);
    meter.apply(TakeoverEvent.Turnover);
    expect(meter.primary.active).toBe(false);
    expect(meter.primary.fill).toBe(0);
  });

  test('ativo dura 30 s; erro antes de acender só esvazia', () => {
    const meter = new TakeoverMeter();
    meter.apply(TakeoverEvent.Make);
    meter.apply(TakeoverEvent.Miss);
    expect(meter.primary.fill).toBeCloseTo(0.06, 6);
    while (!meter.primary.active) meter.apply(TakeoverEvent.AndOne);
    for (let t = 0; t < 29; t++) meter.update(1);
    expect(meter.primary.active).toBe(true);
    meter.update(1.1);
    expect(meter.primary.active).toBe(false);
  });

  test('Team Badge Boost sobe um nível dos badges', () => {
    const meter = new TakeoverMeter();
    while (!meter.team.active) meter.apply(TakeoverEvent.MakeThree);
    expect(meter.badgeTierBoost()).toBe(1);
  });
});

describe('nota de teammate', () => {
  test('letras e eventos', () => {
    expect(gradeLetterFor(62)).toBe('C');
    expect(gradeLetterFor(70)).toBe('B-');
    expect(gradeLetterFor(96)).toBe('A+');
    expect(gradeLetterFor(10)).toBe('F');
    const grade = new TeammateGrade();
    const change = grade.apply(GradeEvent.ExcellentShotRelease);
    expect(change.text).toBe('Excellent Shot Release');
    expect(grade.score).toBeGreaterThan(62);
    expect(grade.apply(GradeEvent.Turnover).delta).toBe(-2);
  });
});

describe('build', () => {
  test('8 Tier 1, 4 Tier 2 e 4 Tier 3 por categoria', async () => {
    const { BadgeCostTier } = await import('./HoopsBadgeBuild');
    for (const category of ['Finishing', 'Shooting', 'Playmaking', 'Defense'] as const) {
      const ids = AllBadgeIds.filter((id) => Badges[id].category === category);
      expect(ids.filter((id) => BadgeCostTier[id] === 1)).toHaveLength(8);
      expect(ids.filter((id) => BadgeCostTier[id] === 2)).toHaveLength(4);
      expect(ids.filter((id) => BadgeCostTier[id] === 3)).toHaveLength(4);
    }
  });

  test('a build do diretor é válida', async () => {
    const { validateBuild, DirectorBudget } = await import('./HoopsBadgeBuild');
    const { DirectorLoadout } = await import('../game/MatchDirector');
    expect(validateBuild(DirectorLoadout, DirectorBudget)).toEqual({ ok: true });
  });

  test('Tier 3 só com 10 pontos em Tier 1/2; sem pontos não equipa; não dá para tirar o que destrava o Tier 3', async () => {
    const { checkBadgeChange, badgeCost } = await import('./HoopsBadgeBuild');
    const budget = { Finishing: 30, Shooting: 30, Playmaking: 30, Defense: 30 };
    expect(badgeCost('Agent3', BadgeTier.HallOfFame)).toBe(8);
    expect(badgeCost('VolumeShooter', BadgeTier.Bronze)).toBe(1);
    expect(checkBadgeChange({}, budget, 'Agent3', BadgeTier.Bronze).ok).toBe(false);
    const lower = { VolumeShooter: BadgeTier.HallOfFame, CatchAndShoot: BadgeTier.HallOfFame }; // 4 + 6 = 10
    expect(checkBadgeChange(lower, budget, 'Agent3', BadgeTier.Gold).ok).toBe(true);
    const withA3 = { ...lower, Agent3: BadgeTier.Gold };
    expect(checkBadgeChange(withA3, budget, 'VolumeShooter', BadgeTier.None).ok).toBe(false);
    expect(checkBadgeChange(withA3, { ...budget, Shooting: 20 }, 'Blinders', BadgeTier.Gold).ok).toBe(false);
  });
});
