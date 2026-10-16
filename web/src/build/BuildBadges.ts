// Badges equipadas × pontos de badge da build. A build nova pode ter menos pontos numa categoria do que as badges
// salvas usam (um pivô com o loadout do armador arremessador): aí as badges mais caras da categoria descem de nível,
// uma de cada vez, até caber. Nada é desequipado sem necessidade.
import {
  AllBadgeIds,
  BadgeCostTier,
  type BadgeLoadout,
  BadgeTier,
  Badges,
  type CategoryBudget,
  Tier3UnlockPoints,
  badgeCost,
  categorySpend,
  validateBuild,
} from '../sim';

const Categories = ['Finishing', 'Shooting', 'Playmaking', 'Defense'] as const;

/** Loadout que cabe no orçamento (cópia; o original não muda). */
export function fitLoadout(loadout: BadgeLoadout, budget: CategoryBudget): BadgeLoadout {
  const out: BadgeLoadout = { ...loadout };
  for (let guard = 0; guard < 400 && !validateBuild(out, budget).ok; guard++) {
    for (const category of Categories) {
      const spend = categorySpend(out, category);
      const equipped = AllBadgeIds.filter((id) => Badges[id].category === category && (out[id] ?? 0) > 0);
      const tier3 = equipped.filter((id) => BadgeCostTier[id] === 3);
      let victim: (typeof equipped)[number] | undefined;
      if (spend.spent > budget[category]) {
        // Sem pontos: desce o badge que custa mais agora.
        victim = equipped.sort((a, b) => badgeCost(b, out[b]!) - badgeCost(a, out[a]!))[0];
      } else if (tier3.length && spend.lowerTiers < Tier3UnlockPoints) {
        // Tier 3 sem os 10 pontos de Tier 1/2: o Tier 3 sai primeiro.
        victim = tier3[0];
      }
      if (!victim) continue;
      const tier = (out[victim] ?? 0) - 1;
      if (tier <= BadgeTier.None) delete out[victim];
      else out[victim] = tier as BadgeTier;
      break;
    }
  }
  return out;
}
