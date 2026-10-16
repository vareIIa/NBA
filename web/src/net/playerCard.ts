// Cartão do jogador para o multiplayer, a partir da build ativa (o oponente vê no lobby e monta o boneco com ele).
import type { PlayerCard } from './protocol.ts';
import type { PlayerBuild } from '../build/PlayerBuild';
import { displayName } from '../build/PlayerBuild';
import { archetypeName, overall } from '../build/BuildRules';
import { wingspanOverModelM } from '../build/BuildRatings';

export function cardFromBuild(build: PlayerBuild, nameOverride?: string | null): PlayerCard {
  return {
    name: (nameOverride || displayName(build)).slice(0, 18),
    heightCm: build.body.heightCm,
    wingspanOverM: wingspanOverModelM(build.body),
    wingspanCm: build.body.wingspanCm,
    overall: overall(build),
    archetype: archetypeName(build),
    position: build.position,
    perimeterDefense: build.attrs.perimeterDefense,
  };
}
