// Guarda a build de badges no navegador (localStorage). Se não houver build salva, ou se ela for inválida, usa a do
// diretor. Só guarda a escolha do jogador neste navegador: a "build oficial" continua no código (DirectorLoadout).
import { AllBadgeIds, type BadgeLoadout, BadgeTier, type CategoryBudget, DirectorBudget, validateBuild } from '../sim';
import { DirectorLoadout } from './MatchDirector';

const Key = 'garrafao.badges.v1';

export function loadBuild(budget: CategoryBudget = DirectorBudget): BadgeLoadout {
  try {
    const raw = localStorage.getItem(Key);
    if (!raw) return { ...DirectorLoadout };
    const parsed = JSON.parse(raw) as Record<string, number>;
    const loadout: BadgeLoadout = {};
    for (const id of AllBadgeIds) {
      const tier = parsed[id];
      if (Number.isInteger(tier) && tier >= BadgeTier.Bronze && tier <= BadgeTier.HallOfFame) loadout[id] = tier as BadgeTier;
    }
    return validateBuild(loadout, budget).ok ? loadout : { ...DirectorLoadout };
  } catch {
    return { ...DirectorLoadout };
  }
}

export function saveBuild(loadout: BadgeLoadout): void {
  try {
    localStorage.setItem(Key, JSON.stringify(loadout));
  } catch {
    // Navegador sem armazenamento (aba privada): a build vale só nesta sessão.
  }
}
