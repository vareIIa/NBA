// Regras de build dos badges do 2K23 next gen (docs/19-badges-2k23.md §2 e §8):
//  - cada categoria tem 8 badges Tier 1, 4 Tier 2 e 4 Tier 3; o custo depende do tier e do nível;
//  - para equipar um Tier 3 numa categoria é preciso ter 10 pontos equipados em Tier 1/2 dessa categoria;
//  - os pontos de cada categoria vêm da build (no 2K, dos atributos).
// No 2K o tier de um badge muda com a altura (o que combina com o seu tamanho custa mais). Esta tabela é a de um
// armador de ~1,96 m (6'5"); os tiers confirmados pelo 2KLab estão marcados no doc.
import { type BadgeCategory, type BadgeId, type BadgeLoadout, BadgeTier, Badges, AllBadgeIds } from './HoopsBadges';

export type CostTier = 1 | 2 | 3;

// prettier-ignore
export const BadgeCostTier: Readonly<Record<BadgeId, CostTier>> = {
  // Finishing
  Slithery: 3, FearlessFinisher: 3, LimitlessTakeoff: 3, Posterizer: 3,
  Acrobat: 2, Bully: 2, ProTouch: 2, FastTwitch: 2,
  AerialWizard: 1, BackdownPunisher: 1, DreamShake: 1, Dropstepper: 1, GiantSlayer: 1, Masher: 1, PostSpinTechnician: 1, RiseUp: 1,
  // Shooting
  Agent3: 3, LimitlessRange: 3, Blinders: 3, GreenMachine: 3,
  CatchAndShoot: 2, Amped: 2, Deadeye: 2, SpaceCreator: 2,
  Claymore: 1, ClutchShooter: 1, ComebackKid: 1, CornerSpecialist: 1, GuardUp: 1, MiddyMagician: 1, SlipperyOffBall: 1, VolumeShooter: 1,
  // Playmaking
  QuickFirstStep: 3, HandlesForDays: 3, ClampBreaker: 3, Unpluckable: 3,
  BailOut: 2, Hyperdrive: 2, KillerCombos: 2, BreakStarter: 2,
  AnkleBreaker: 1, Dimer: 1, FloorGeneral: 1, MismatchExpert: 1, NeedleThreader: 1, PostPlaymaker: 1, SpecialDelivery: 1, ViceGrip: 1,
  // Defense
  Clamps: 3, Glove: 3, Challenger: 3, PickDodger: 3,
  AnkleBraces: 2, Interceptor: 2, ReboundChaser: 2, Menace: 2,
  Anchor: 1, BoxoutBeast: 1, BrickWall: 1, ChaseDownArtist: 1, OffBallPest: 1, PogoStick: 1, PostLockdown: 1, WorkHorse: 1,
};

/** Custo [Bronze, Prata, Ouro, HOF] por tier (2K23 next gen). */
export const TierCost: Readonly<Record<CostTier, readonly [number, number, number, number]>> = {
  1: [1, 2, 3, 4],
  2: [3, 4, 5, 6],
  3: [5, 6, 7, 8],
};

export const Tier3UnlockPoints = 10;

export type CategoryBudget = Record<BadgeCategory, number>;

/** Pontos da build do diretor (armador arremessador): sobra um pouco em cada categoria para trocar. */
export const DirectorBudget: CategoryBudget = { Finishing: 30, Shooting: 52, Playmaking: 44, Defense: 30 };

export const badgeCost = (id: BadgeId, tier: BadgeTier): number =>
  tier === BadgeTier.None ? 0 : TierCost[BadgeCostTier[id]][Math.min(tier, BadgeTier.HallOfFame) - 1];

export interface CategorySpend {
  spent: number; // pontos usados na categoria
  lowerTiers: number; // pontos em Tier 1/2 (destrava o Tier 3)
  equipped: number;
}

export function categorySpend(loadout: BadgeLoadout, category: BadgeCategory): CategorySpend {
  const out: CategorySpend = { spent: 0, lowerTiers: 0, equipped: 0 };
  for (const id of AllBadgeIds) {
    if (Badges[id].category !== category) continue;
    const tier = loadout[id] ?? BadgeTier.None;
    if (tier === BadgeTier.None) continue;
    const cost = badgeCost(id, tier);
    out.spent += cost;
    out.equipped++;
    if (BadgeCostTier[id] < 3) out.lowerTiers += cost;
  }
  return out;
}

export type BuildCheck = { ok: true } | { ok: false; reason: string };

/** Dá para colocar este badge neste nível (BadgeTier.None = desequipar)? */
export function checkBadgeChange(loadout: BadgeLoadout, budget: CategoryBudget, id: BadgeId, tier: BadgeTier): BuildCheck {
  const category = Badges[id].category;
  const next: BadgeLoadout = { ...loadout, [id]: tier };
  if (tier === BadgeTier.None) delete next[id];
  const spend = categorySpend(next, category);
  if (spend.spent > budget[category]) {
    return { ok: false, reason: `Sem pontos: ${spend.spent}/${budget[category]} em ${category}` };
  }
  const hasTier3 = AllBadgeIds.some((b) => Badges[b].category === category && BadgeCostTier[b] === 3 && (next[b] ?? 0) > 0);
  if (hasTier3 && spend.lowerTiers < Tier3UnlockPoints) {
    return BadgeCostTier[id] === 3 && tier !== BadgeTier.None
      ? { ok: false, reason: `Tier 3 trancado: precisa de ${Tier3UnlockPoints} pontos em Tier 1/2 (${spend.lowerTiers}/${Tier3UnlockPoints})` }
      : { ok: false, reason: `Os Tier 3 equipados precisam desses pontos em Tier 1/2 (${spend.lowerTiers}/${Tier3UnlockPoints})` };
  }
  return { ok: true };
}

/** A build inteira é válida? (pontos e destrave do Tier 3 em todas as categorias) */
export function validateBuild(loadout: BadgeLoadout, budget: CategoryBudget): BuildCheck {
  for (const category of ['Finishing', 'Shooting', 'Playmaking', 'Defense'] as const) {
    const spend = categorySpend(loadout, category);
    if (spend.spent > budget[category]) return { ok: false, reason: `${category}: ${spend.spent}/${budget[category]} pontos` };
    const hasTier3 = AllBadgeIds.some((b) => Badges[b].category === category && BadgeCostTier[b] === 3 && (loadout[b] ?? 0) > 0);
    if (hasTier3 && spend.lowerTiers < Tier3UnlockPoints) return { ok: false, reason: `${category}: Tier 3 sem os 10 pontos de Tier 1/2` };
  }
  return { ok: true };
}
