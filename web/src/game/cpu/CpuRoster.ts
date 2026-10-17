// Adversários da CPU no 1x1 (docs/25-1x1-cpu-e-defesa.md §2): cada um é uma build de verdade (os mesmos atributos,
// tetos e pontos do MyPlayer Builder, montada pelos presets do builder) mais o estilo de jogo da IA. O nível de
// dificuldade mexe só na cabeça (reação, timing do arremesso, apetite pelo roubo, disciplina no pump fake), nunca nos
// atributos: um Calouro e um Hall da Fama com a mesma build correm e arremessam igual, um decide melhor que o outro.
import type { PlayerCard } from '../../net/protocol';
import { type Position, type PlayerBuild, displayName } from '../../build/PlayerBuild';
import { archetypeName, newDraft, overall, typicalWeightKg } from '../../build/BuildRules';
import { wingspanOverModelM } from '../../build/BuildRatings';
import { randomLook, seededRandom } from '../../build/PlayerLook';
import { BuildPresets, presetAttrs } from '../../menu/builder/BuilderPresets';

/** Estilo de jogo da IA (0..1 cada): quanto prefere arremessar, infiltrar, driblar para criar e arriscar o roubo. */
export interface CpuStyle {
  shoot: number;
  drive: number;
  moves: number;
  gamble: number;
  /** Gosta de enterrar (com a enterrada liberada) em vez da bandeja. */
  dunk: number;
  /** Fica perto do aro na defesa (protege o aro) em vez de colar no perímetro. */
  rimProtect: number;
}

export interface CpuRosterEntry {
  id: string;
  firstName: string;
  lastName: string;
  position: Position;
  heightCm: number;
  /** Envergadura além da altura (cm, 0 a 15). */
  wingOverCm: number;
  hand: 'r' | 'l';
  jersey: number;
  /** Preset do builder que distribui os atributos (menu/builder/BuilderPresets). */
  preset: string;
  /** Uma linha para a tela de escolha. */
  blurb: string;
  style: CpuStyle;
  /** Badges de roubo no cartão (0–4): Glove de quem defende, Unpluckable de quem ataca. */
  glove: number;
  unpluckable: number;
}

// prettier-ignore
export const CpuRoster: readonly CpuRosterEntry[] = [
  {
    id: 'flash', firstName: 'Rafa', lastName: 'Flash', position: 'SF', heightCm: 198, wingOverCm: 8, hand: 'r', jersey: 23,
    preset: 'slasher', blurb: 'Infiltrador: ataca o aro, enterra e pune o defensor que pula.',
    style: { shoot: 0.35, drive: 0.9, moves: 0.6, gamble: 0.45, dunk: 0.85, rimProtect: 0.3 }, glove: 0, unpluckable: 1,
  },
  {
    id: 'bala', firstName: 'Zé', lastName: 'Bala', position: 'SG', heightCm: 191, wingOverCm: 5, hand: 'r', jersey: 30,
    preset: 'sniper', blurb: 'Arremessador: step-back e bola de 3 com espaço. Feche nele.',
    style: { shoot: 0.95, drive: 0.35, moves: 0.7, gamble: 0.3, dunk: 0.2, rimProtect: 0.1 }, glove: 0, unpluckable: 0,
  },
  {
    id: 'maestro', firstName: 'Dudu', lastName: 'Maestro', position: 'PG', heightCm: 185, wingOverCm: 4, hand: 'l', jersey: 3,
    preset: 'playmaker', blurb: 'Armador canhoto: muito drible, rouba bola e não se apressa.',
    style: { shoot: 0.55, drive: 0.6, moves: 1, gamble: 0.75, dunk: 0.1, rimProtect: 0.05 }, glove: 2, unpluckable: 2,
  },
  {
    id: 'muralha', firstName: 'Tiago', lastName: 'Muralha', position: 'C', heightCm: 211, wingOverCm: 14, hand: 'r', jersey: 44,
    preset: 'rim', blurb: 'Pivô protetor de aro: espera você no garrafão para dar o toco.',
    style: { shoot: 0.2, drive: 0.7, moves: 0.15, gamble: 0.15, dunk: 1, rimProtect: 1 }, glove: 0, unpluckable: 0,
  },
  {
    id: 'cadeado', firstName: 'Caio', lastName: 'Cadeado', position: 'SF', heightCm: 201, wingOverCm: 10, hand: 'r', jersey: 8,
    preset: '3d', blurb: '3&D: marca colado no perímetro e mata a bola de 3.',
    style: { shoot: 0.75, drive: 0.45, moves: 0.4, gamble: 0.55, dunk: 0.5, rimProtect: 0.35 }, glove: 2, unpluckable: 0,
  },
];

export type CpuLevel = 'rookie' | 'pro' | 'allstar' | 'hof';

/** Cabeça da CPU por nível. */
export interface CpuLevelSpec {
  label: string;
  /** s até reagir ao que o atacante faz (a defesa vê o passado). */
  reactionS: number;
  /** Erro do timing do arremesso: multiplica o σ que vem do rating. */
  timingScale: number;
  /** Erro do tempo do pulo do toco (s, σ). */
  jumpSigmaS: number;
  /**
   * Vontade de pular cedo no arremesso, além da que vem do rating de toco (o calouro pula em tudo e morde o pump fake;
   * o Hall da Fama espera).
   */
  biteChance: number;
  /** Multiplica a vontade de roubar. */
  stealAppetite: number;
  /** Ruído nas decisões do ataque (0 = sempre a melhor). */
  noise: number;
}

export const CpuLevels: Readonly<Record<CpuLevel, CpuLevelSpec>> = {
  rookie: { label: 'Calouro', reactionS: 0.34, timingScale: 1.9, jumpSigmaS: 0.14, biteChance: 0.6, stealAppetite: 0.6, noise: 0.45 },
  pro: { label: 'Profissional', reactionS: 0.25, timingScale: 1.35, jumpSigmaS: 0.09, biteChance: 0.42, stealAppetite: 0.85, noise: 0.28 },
  allstar: { label: 'All-Star', reactionS: 0.19, timingScale: 1.05, jumpSigmaS: 0.06, biteChance: 0.3, stealAppetite: 1, noise: 0.16 },
  hof: { label: 'Hall da Fama', reactionS: 0.14, timingScale: 0.82, jumpSigmaS: 0.045, biteChance: 0.2, stealAppetite: 1.15, noise: 0.08 },
};

export const CpuLevelOrder: readonly CpuLevel[] = ['rookie', 'pro', 'allstar', 'hof'];

export const cpuEntry = (id: string): CpuRosterEntry => CpuRoster.find((e) => e.id === id) ?? CpuRoster[0]!;

/** A build do adversário: corpo da entrada e atributos pelo preset do builder (os mesmos tetos e pontos de todo mundo). */
export function cpuBuild(entry: CpuRosterEntry): PlayerBuild {
  const draft = newDraft(entry.position);
  const body = { heightCm: entry.heightCm, weightKg: Math.round(typicalWeightKg(entry.heightCm)), wingspanCm: entry.heightCm + entry.wingOverCm, shape: 'atletico' as const };
  // Aparência sorteada pelo id: cada adversário tem sempre a mesma cara (o uniforme se resolve na partida, kitsFor).
  const look = randomLook(seededRandom(`cpu-${entry.id}`));
  const base: PlayerBuild = { ...draft, id: `cpu-${entry.id}`, firstName: entry.firstName, lastName: entry.lastName, hand: entry.hand, jersey: entry.jersey, body, look };
  const preset = BuildPresets.find((p) => p.id === entry.preset) ?? BuildPresets[0]!;
  return { ...base, attrs: presetAttrs(base, preset) };
}

/** Cartão do adversário (o mesmo formato do online: o juiz sorteia o roubo com ele, a contestação e o toco leem dele). */
export function cpuCard(entry: CpuRosterEntry, build: PlayerBuild = cpuBuild(entry)): PlayerCard {
  return {
    name: displayName(build).slice(0, 18),
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
    glove: entry.glove,
    unpluckable: entry.unpluckable,
    look: build.look,
  };
}
