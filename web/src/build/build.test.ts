import { describe, expect, it } from 'vitest';
import { AttributeIds, type Body, type PlayerBuild } from './PlayerBuild';
import {
  AttrStart,
  BuildPointsTotal,
  DefaultBuild,
  archetypeName,
  attributeCaps,
  badgePoints,
  canRaise,
  defaultBody,
  fitToBody,
  heightRange,
  newDraft,
  overall,
  pointsLeft,
  pointsSpent,
  sanitizeBuild,
  shadesOf,
  typicalWeightKg,
} from './BuildRules';
import { DefaultPlayRatings, applyDribbleRatings, bodyScaleOf, jumpShotRating, playRatings } from './BuildRatings';
import { fitLoadout } from './BuildBadges';
import { DirectorBudget, neutralDribbleModifiers, validateBuild } from '../sim';
import { DirectorLoadout } from '../game/MatchDirector';

const inch = 2.54;
const body = (heightIn: number, wingDeltaIn = 0, weightDeltaKg = 0): Body => {
  const heightCm = heightIn * inch;
  return { heightCm, wingspanCm: heightCm + wingDeltaIn * inch, weightKg: typicalWeightKg(heightCm) + weightDeltaKg, shape: 'atletico' };
};

describe('caps pelo corpo (2K25)', () => {
  it("bola de 3 segue a tabela do 2K25: 99 até 6'5\", 89 em 6'7\", 86 em 7'0\"", () => {
    expect(attributeCaps('PG', body(75)).threePoint).toBe(99); // 6'3"
    expect(attributeCaps('PG', body(77)).threePoint).toBe(99); // 6'5"
    expect(attributeCaps('PG', body(78)).threePoint).toBe(94); // 6'6"
    expect(attributeCaps('PG', body(79)).threePoint).toBe(89); // 6'7"
    expect(attributeCaps('C', body(84)).threePoint).toBe(86); // 7'0"
  });

  it('mais envergadura: menos 3 e drible, mais roubo, toco, rebote e enterrada', () => {
    const short = attributeCaps('SF', body(80, -2));
    const long = attributeCaps('SF', body(80, 6));
    expect(long.threePoint).toBeLessThan(short.threePoint);
    expect(long.ballHandle).toBeLessThan(short.ballHandle);
    for (const id of ['steal', 'block', 'defensiveRebound', 'drivingDunk'] as const) expect(long[id]).toBeGreaterThan(short[id]);
  });

  it('baixo e de braço curto arremessa 99; pivô alto e longo protege o aro 99', () => {
    const guard = attributeCaps('PG', body(73, -4));
    expect(guard.threePoint).toBe(99);
    expect(guard.block).toBeLessThan(70);
    const big = attributeCaps('C', body(86, 6));
    expect(big.block).toBe(99);
    expect(big.threePoint).toBeLessThan(80);
  });

  it('mais peso: mais força, menos velocidade e impulsão', () => {
    const light = attributeCaps('PF', body(81, 0, -10));
    const heavy = attributeCaps('PF', body(81, 0, 10));
    expect(heavy.strength).toBeGreaterThan(light.strength);
    expect(heavy.speed).toBeLessThan(light.speed);
    expect(heavy.vertical).toBeLessThan(light.vertical);
  });

  it('o corpo padrão de cada posição fica dentro da faixa de altura', () => {
    for (const p of ['PG', 'SG', 'SF', 'PF', 'C'] as const) {
      const [lo, hi] = heightRange(p);
      const h = defaultBody(p).heightCm;
      expect(h).toBeGreaterThanOrEqual(lo);
      expect(h).toBeLessThanOrEqual(hi);
    }
  });
});

describe('pontos da build', () => {
  it('rascunho novo começa em 25 (resistência 85) sem gastar nada', () => {
    const d = newDraft('SG');
    expect(pointsSpent(d.attrs)).toBe(0);
    expect(d.attrs.stamina).toBe(85);
    expect(d.attrs.threePoint).toBe(25);
  });

  it('não dá para maximizar tudo: subir até acabar respeita cap e orçamento', () => {
    const b = newDraft('PG');
    let raised = true;
    while (raised) {
      raised = false;
      for (const id of AttributeIds) if (canRaise(b, id)) (b.attrs[id]++, (raised = true));
    }
    const caps = attributeCaps(b.position, b.body);
    for (const id of AttributeIds) expect(b.attrs[id]).toBeLessThanOrEqual(caps[id]);
    expect(pointsSpent(b.attrs)).toBeLessThanOrEqual(BuildPointsTotal);
    expect(pointsLeft(b)).toBeLessThan(5);
    expect(AttributeIds.some((id) => b.attrs[id] < caps[id])).toBe(true);
  });

  it('mudar o corpo prende os atributos nos caps novos', () => {
    const b: PlayerBuild = { ...newDraft('C'), body: body(84) };
    b.attrs.threePoint = 99;
    expect(fitToBody(b).attrs.threePoint).toBe(attributeCaps('C', body(84)).threePoint);
  });
});

describe('build padrão = Freestyle de antes do builder', () => {
  it('cabe nos caps e no orçamento', () => {
    const caps = attributeCaps(DefaultBuild.position, DefaultBuild.body);
    for (const id of AttributeIds) {
      expect(DefaultBuild.attrs[id]).toBeLessThanOrEqual(caps[id]);
      expect(DefaultBuild.attrs[id]).toBeGreaterThanOrEqual(AttrStart[id]);
    }
    expect(pointsLeft(DefaultBuild)).toBeGreaterThanOrEqual(0);
  });

  it('dá os ratings que estavam fixos (85, bandeja +0, enterrada +0, velocidade 1×)', () => {
    expect(jumpShotRating(DefaultPlayRatings, true, 7.5)).toBe(85);
    expect(jumpShotRating(DefaultPlayRatings, false, 5)).toBe(85);
    expect(jumpShotRating(DefaultPlayRatings, false, 2)).toBe(85);
    expect(DefaultPlayRatings.layupOffset).toBe(0);
    expect(DefaultPlayRatings.dunkOffset).toBe(0);
    expect(DefaultPlayRatings.speedScale).toBeCloseTo(1, 10);
  });

  it('dá o orçamento de badges de antes (DirectorBudget) e o loadout do diretor cabe nele', () => {
    expect(badgePoints(DefaultBuild)).toEqual(DirectorBudget);
    expect(fitLoadout(DirectorLoadout, badgePoints(DefaultBuild))).toEqual(DirectorLoadout);
  });

  it('tem a altura do boneco (escala do corpo 1); 5\'9" e 7\'4" ficam em ~0,94 e ~1,20', () => {
    expect(bodyScaleOf(DefaultBuild.body.heightCm)).toBe(1);
    expect(bodyScaleOf(69 * inch)).toBeCloseTo(0.942, 3);
    expect(bodyScaleOf(88 * inch)).toBeCloseTo(1.202, 3);
  });

  it('dá velocidade, aceleração, drible e resistência em 1× e enterrada liberada', () => {
    const r = DefaultPlayRatings;
    for (const k of ['runSpeedScale', 'accelScale', 'handleEnergyScale', 'handlePlayRate', 'staminaDrainScale'] as const) {
      expect(r[k]).toBeCloseTo(1, 10);
    }
    expect(r.canDunk).toBe(true);
    const mods = neutralDribbleModifiers();
    applyDribbleRatings(mods, r);
    expect(mods).toEqual(neutralDribbleModifiers());
  });

  it('controle de bola, resistência, aceleração e velocidade mudam o drible e o movimento no sentido do 2K', () => {
    const slow = playRatings({ ...DefaultBuild, attrs: { ...DefaultBuild.attrs, ballHandle: 40, acceleration: 50, speed: 50 } });
    expect(slow.handleEnergyScale).toBeGreaterThan(1); // drible mais caro
    expect(slow.handlePlayRate).toBeLessThan(1); // drible mais lento
    expect(slow.accelScale).toBeLessThan(1);
    expect(slow.runSpeedScale).toBeLessThan(1);
    const elite = playRatings({ ...DefaultBuild, attrs: { ...DefaultBuild.attrs, ballHandle: 99, stamina: 99 } });
    expect(elite.handleEnergyScale).toBeLessThan(1);
    expect(elite.staminaDrainScale).toBeLessThan(1);
  });

  it('sem enterrada abaixo de Enterrada 55 ou Impulsão 35 (rascunho cru não enterra)', () => {
    expect(playRatings(newDraft('PG')).canDunk).toBe(false);
    expect(playRatings({ ...DefaultBuild, attrs: { ...DefaultBuild.attrs, drivingDunk: 54 } }).canDunk).toBe(false);
    expect(playRatings({ ...DefaultBuild, attrs: { ...DefaultBuild.attrs, vertical: 34 } }).canDunk).toBe(false);
    expect(playRatings({ ...DefaultBuild, attrs: { ...DefaultBuild.attrs, drivingDunk: 55, vertical: 35 } }).canDunk).toBe(true);
  });

  it('build de arremesso mais forte arremessa com rating maior e build lenta corre menos', () => {
    const shooter = { ...DefaultBuild, attrs: { ...DefaultBuild.attrs, threePoint: 97, speedWithBall: 60 } };
    const r = playRatings(shooter);
    expect(jumpShotRating(r, true, 7.5)).toBe(97);
    expect(r.speedScale).toBeLessThan(1);
  });
});

describe('badges, arquétipo e Shades Of', () => {
  it('um pivô sem arremesso tem poucos pontos de Shooting e o loadout do armador é ajustado até caber', () => {
    const big = fitToBody({ ...newDraft('C'), attrs: { ...AttrStart, block: 90, interiorDefense: 90, defensiveRebound: 90, standingDunk: 85 } });
    const budget = badgePoints(big);
    expect(budget.Shooting).toBeLessThan(DirectorBudget.Shooting);
    const fitted = fitLoadout(DirectorLoadout, budget);
    expect(validateBuild(fitted, budget).ok).toBe(true);
  });

  it('pontos de badge ficam entre 0 e 88 (tudo no HOF) mesmo nas builds extremas', () => {
    const maxed = { ...DefaultBuild, attrs: Object.fromEntries(AttributeIds.map((id) => [id, 99])) as PlayerBuild['attrs'] };
    for (const b of [maxed, newDraft('C')]) {
      for (const v of Object.values(badgePoints(b))) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(88);
      }
    }
  });

  it('nome do arquétipo: 3 níveis, protetor de aro e rascunho cru', () => {
    const scorer = { ...DefaultBuild, attrs: { ...DefaultBuild.attrs, threePoint: 90, midRange: 90, drivingLayup: 90 } };
    expect(archetypeName(scorer)).toContain('3 Níveis');
    const big = { ...newDraft('C'), attrs: { ...AttrStart, block: 95, interiorDefense: 95, defensiveRebound: 92, offensiveRebound: 90 } };
    expect(archetypeName(big)).toMatch(/Protetor de Aro/);
    expect(archetypeName(newDraft('PG'))).toBe('Jogador em Formação');
  });

  it('Shades Of: 3 nomes diferentes, perto da altura e do perfil', () => {
    const big = { ...newDraft('C'), body: body(85, 5), attrs: { ...AttrStart, block: 97, interiorDefense: 95, defensiveRebound: 95, offensiveRebound: 92 } };
    const shades = shadesOf(big);
    expect(shades).toHaveLength(3);
    expect(new Set(shades.map((s) => s.name)).size).toBe(3);
    expect(shades.map((s) => s.name)).toContain('Rudy Gobert');
  });

  it('overall: build focada passa de 85, rascunho cru fica baixo', () => {
    expect(overall(DefaultBuild)).toBeGreaterThan(85);
    expect(overall(newDraft('PG'))).toBeLessThan(45);
  });

  it('build salva estragada volta válida (faixas, caps, campos)', () => {
    const bad = { ...DefaultBuild, id: 'x', body: { ...DefaultBuild.body, heightCm: 300, weightKg: -5 }, attrs: { ...DefaultBuild.attrs, threePoint: 150 } } as PlayerBuild;
    const fixed = sanitizeBuild(bad);
    expect(fixed.body.heightCm).toBeLessThanOrEqual(heightRange('PG')[1]);
    expect(fixed.attrs.threePoint).toBeLessThanOrEqual(99);
  });
});
