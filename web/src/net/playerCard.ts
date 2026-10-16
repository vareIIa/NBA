// Cartão do jogador para o multiplayer, a partir da build ativa (o oponente vê no lobby e monta o boneco com ele).
import type { PlayerCard } from './protocol.ts';
import type { PlayerBuild } from '../build/PlayerBuild';
import { displayName } from '../build/PlayerBuild';
import { archetypeName, badgePoints, overall } from '../build/BuildRules';
import { wingspanOverModelM } from '../build/BuildRatings';
import { fitLoadout } from '../build/BuildBadges';
import { loadBuild } from '../game/BuildStore';

export function cardFromBuild(build: PlayerBuild, nameOverride?: string | null): PlayerCard {
  // Badges como o jogo monta (main.ts): as salvas, ajustadas aos pontos da build. Só as do roubo vão no cartão.
  const loadout = fitLoadout(loadBuild({ Finishing: 999, Shooting: 999, Playmaking: 999, Defense: 999 }), badgePoints(build));
  return {
    name: (nameOverride || displayName(build)).slice(0, 18),
    heightCm: build.body.heightCm,
    wingspanOverM: wingspanOverModelM(build.body),
    wingspanCm: build.body.wingspanCm,
    overall: overall(build),
    archetype: archetypeName(build),
    position: build.position,
    perimeterDefense: build.attrs.perimeterDefense,
    steal: build.attrs.steal,
    block: build.attrs.block,
    vertical: build.attrs.vertical,
    ballHandle: build.attrs.ballHandle,
    glove: loadout.Glove ?? 0,
    unpluckable: loadout.Unpluckable ?? 0,
  };
}
