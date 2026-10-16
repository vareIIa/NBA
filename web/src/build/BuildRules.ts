// Regras do MyPlayer Builder (engenharia reversa do 2K24/2K25; números e fontes em docs/23-myplayer-builder.md):
//  - corpo: faixa de altura por posição, peso e envergadura pela altura;
//  - caps: o máximo de cada atributo sai da altura (tabela por âncoras), da envergadura em relação à altura e do peso
//    em relação ao típico da altura. Baixo e de braço curto arremessa 99 de 3; mais envergadura troca arremesso e drible
//    por roubo, toco, rebote e enterrada; mais peso troca velocidade e impulsão por força;
//  - pontos: todo atributo começa em 25 e cada ponto custa mais perto do teto, com um total fixo por build (não dá para
//    maximizar tudo, como no 2K);
//  - overall por posição, pontos de badge por categoria, nome do arquétipo e Shades Of.
import { type BadgeCategory, type CategoryBudget, DirectorBudget } from '../sim';
import {
  AttrCeil,
  AttrFloor,
  type AttributeGroupId,
  AttributeGroups,
  AttributeIds,
  type AttributeId,
  type Attributes,
  type Body,
  type PlayerBuild,
  type Position,
  attrsFilled,
  newBuildId,
} from './PlayerBuild';

const In = 2.54;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ------------------------------------------------------------------ corpo

/**
 * Altura mínima e máxima por posição, em polegadas. Máximos do 2K25 (PG 6'7", SG 6'8", SF 6'10", PF 7'0", C 7'3") e o
 * 7'4" do 2K26 para o pivô; o mínimo geral é 5'9". Os mínimos por posição não foram publicados: são nossos.
 */
export const HeightRangeIn: Readonly<Record<Position, readonly [number, number]>> = {
  PG: [69, 79], // 5'9" – 6'7"
  SG: [70, 80], // 5'10" – 6'8"
  SF: [74, 82], // 6'2" – 6'10"
  PF: [77, 84], // 6'5" – 7'0"
  C: [79, 88], // 6'7" – 7'4"
};

export const heightRange = (p: Position): readonly [number, number] => [HeightRangeIn[p][0] * In, HeightRangeIn[p][1] * In];

/** Peso típico (kg) pela altura: ~82 kg em 1,75 m, ~93 kg em 1,91 m, ~109 kg em 2,13 m. */
export const typicalWeightKg = (heightCm: number): number => 82 + (heightCm - 175) * 0.72;

/** Peso: típico −14% … +12% (builds do 2K26: PG 175–225 lb, C 230–259 lb). */
export function weightRange(heightCm: number): readonly [number, number] {
  const t = typicalWeightKg(heightCm);
  return [Math.round(t * 0.86), Math.round(t * 1.12)];
}

/** Envergadura: ±6" da altura (guia do 2K26; as builds Pro-Tuned ficam entre 0 e +6"). */
export const WingspanDeltaIn = [-6, 6] as const;
export const wingspanRange = (heightCm: number): readonly [number, number] => [
  heightCm + WingspanDeltaIn[0] * In,
  heightCm + WingspanDeltaIn[1] * In,
];
/** Envergadura "neutra" (igual à altura): é a da tabela de caps; acima ou abaixo dela os caps mudam. */
export const NeutralWingspanIn = 0;

const DefaultHeightIn: Readonly<Record<Position, number>> = { PG: 75, SG: 77, SF: 79, PF: 81, C: 84 };

export function defaultBody(p: Position): Body {
  const heightCm = DefaultHeightIn[p] * In;
  return {
    heightCm,
    weightKg: Math.round(typicalWeightKg(heightCm)),
    wingspanCm: heightCm + NeutralWingspanIn * In,
    shape: 'atletico',
  };
}

// ------------------------------------------------------------------ caps

/** Âncoras de altura (polegadas) da tabela de caps: 5'9", 6'1", 6'5", 6'8", 6'11", 7'1", 7'4". */
const CapHeightsIn = [69, 73, 77, 80, 83, 85, 88] as const;

/**
 * Bola de 3 máxima por altura, polegada a polegada (2K25, guia pré-lançamento: 99 até 6'5", 94 em 6'6", 89 em 6'7",
 * 88 em 6'8", 87 em 6'9", 86 de 6'10" a 7'2", 85 em 7'3"; 7'4" é extrapolado). Os outros atributos não têm tabela
 * publicada: a CapTable abaixo é nossa, no mesmo espírito (o que combina com o tamanho sobe, o resto desce).
 */
// prettier-ignore
export const ThreePointCapByHeightIn: ReadonlyArray<readonly [number, number]> = [
  [69, 99], [77, 99], [78, 94], [79, 89], [80, 88], [81, 87], [82, 86], [86, 86], [87, 85], [88, 84],
];

/** Máximo de cada atributo na envergadura neutra e no peso típico, por âncora de altura. */
// prettier-ignore
export const CapTable: Readonly<Record<AttributeId, readonly number[]>> = {
  //                 5'9  6'1  6'5  6'8  6'11 7'1  7'4
  closeShot:        [ 88,  92,  96,  99,  99,  99,  99],
  drivingLayup:     [ 99,  99,  99,  96,  89,  82,  75],
  drivingDunk:      [ 60,  80,  95,  99,  95,  88,  80],
  standingDunk:     [ 35,  50,  68,  85,  95,  99,  99],
  postControl:      [ 55,  65,  78,  90,  96,  99,  99],
  midRange:         [ 99,  99,  99,  97,  92,  88,  83],
  threePoint:       [ 99,  99,  99,  94,  88,  83,  77],
  freeThrow:        [ 99,  99,  99,  99,  95,  92,  88],
  passAccuracy:     [ 99,  99,  97,  92,  85,  80,  74],
  ballHandle:       [ 99,  99,  96,  90,  81,  73,  64],
  speedWithBall:    [ 99,  97,  92,  85,  76,  67,  57],
  interiorDefense:  [ 50,  60,  75,  88,  96,  99,  99],
  perimeterDefense: [ 92,  95,  99,  96,  89,  81,  72],
  steal:            [ 95,  96,  97,  94,  88,  80,  70],
  block:            [ 45,  58,  74,  88,  96,  99,  99],
  offensiveRebound: [ 55,  65,  78,  90,  97,  99,  99],
  defensiveRebound: [ 55,  66,  80,  92,  98,  99,  99],
  speed:            [ 99,  97,  93,  87,  80,  72,  64],
  acceleration:     [ 99,  97,  92,  86,  78,  70,  62],
  strength:         [ 60,  68,  77,  85,  91,  96,  99],
  vertical:         [ 95,  93,  90,  86,  80,  72,  63],
  stamina:          [ 99,  99,  99,  99,  99,  99,  99],
};

/** Ajuste do cap por polegada de envergadura acima da neutra (negativo abaixo dela). */
// prettier-ignore
export const WingspanPerInch: Readonly<Partial<Record<AttributeId, number>>> = {
  threePoint: -1.6, midRange: -1.1, freeThrow: -0.6, ballHandle: -1.3, speedWithBall: -0.5, passAccuracy: -0.4,
  steal: 0.9, block: 1.6, interiorDefense: 0.9, perimeterDefense: 0.6, offensiveRebound: 1.1, defensiveRebound: 1.2,
  drivingDunk: 0.7, standingDunk: 1.1, closeShot: 0.3,
};

/** Ajuste do cap por 10 kg acima do peso típico da altura (negativo abaixo dele). */
// prettier-ignore
export const WeightPer10Kg: Readonly<Partial<Record<AttributeId, number>>> = {
  strength: 9, postControl: 2, standingDunk: 2, interiorDefense: 2, offensiveRebound: 1, defensiveRebound: 1,
  speed: -4, acceleration: -5, vertical: -5, speedWithBall: -3, stamina: -2, drivingDunk: -2, perimeterDefense: -2,
};

function interpolatePairs(pairs: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= pairs[0]![0]) return pairs[0]![1];
  for (let i = 1; i < pairs.length; i++) {
    const [x1, y1] = pairs[i]!;
    const [x0, y0] = pairs[i - 1]!;
    if (x <= x1) return lerp(y0, y1, (x - x0) / (x1 - x0));
  }
  return pairs[pairs.length - 1]![1];
}

/** Cap da altura para um atributo (na envergadura neutra e no peso típico). */
export function heightCap(id: AttributeId, heightIn: number): number {
  if (id === 'threePoint') return interpolatePairs(ThreePointCapByHeightIn, heightIn);
  return interpolatePairs(CapHeightsIn.map((h, i) => [h, CapTable[id][i]!] as const), heightIn);
}

/** Máximo de cada atributo para esta posição e este corpo. */
export function attributeCaps(_position: Position, body: Body): Attributes {
  const heightIn = body.heightCm / In;
  const wing = (body.wingspanCm - body.heightCm) / In - NeutralWingspanIn;
  const weight = (body.weightKg - typicalWeightKg(body.heightCm)) / 10;
  const caps = attrsFilled(AttrCeil);
  for (const id of AttributeIds) {
    // Braço curto devolve só metade do que o braço longo tira (não transforma um 6'8" em arremessador 99).
    const wingK = WingspanPerInch[id] ?? 0;
    const wingEffect = wing * wingK * (wing < 0 && wingK < 0 ? 0.5 : 1);
    const raw = heightCap(id, Math.round(heightIn)) + wingEffect + weight * (WeightPer10Kg[id] ?? 0);
    caps[id] = Math.round(clamp(raw, 40, AttrCeil));
  }
  return caps;
}

// ------------------------------------------------------------------ pontos

/** Custo de subir 1 ponto a partir de `value` (25–59: 1 · 60–69: 2 · 70–79: 3 · 80–89: 4 · 90–98: 5). */
export const stepCost = (value: number): number => (value < 60 ? 1 : value < 70 ? 2 : value < 80 ? 3 : value < 90 ? 4 : 5);

/** Valor inicial de cada atributo: 25, menos a Resistência, que começa em 85 de graça (como no 2K25). */
export const AttrStart: Readonly<Attributes> = { ...attrsFilled(AttrFloor), stamina: 85 };

/** Custo total de um atributo do valor inicial até `value`. */
export function attrCost(value: number, id?: AttributeId): number {
  let c = 0;
  for (let v = id ? AttrStart[id] : AttrFloor; v < value; v++) c += stepCost(v);
  return c;
}

/** Pontos totais de uma build (iguais para todas; o corpo muda os tetos, não o orçamento). */
export const BuildPointsTotal = 1500;
export const buildPoints = (_b: PlayerBuild): number => BuildPointsTotal;

export const pointsSpent = (attrs: Attributes): number => AttributeIds.reduce((s, id) => s + attrCost(attrs[id], id), 0);
export const pointsLeft = (b: PlayerBuild): number => buildPoints(b) - pointsSpent(b.attrs);

/** Dá para subir +1 neste atributo (abaixo do cap e com pontos)? */
export function canRaise(b: PlayerBuild, id: AttributeId): boolean {
  const caps = attributeCaps(b.position, b.body);
  return b.attrs[id] < caps[id] && pointsLeft(b) >= stepCost(b.attrs[id]);
}

/** Corpo mudou: atributos acima do novo cap descem até ele (os pontos voltam). */
export function fitToBody(b: PlayerBuild): PlayerBuild {
  const caps = attributeCaps(b.position, b.body);
  const attrs = { ...b.attrs };
  for (const id of AttributeIds) attrs[id] = clamp(Math.round(attrs[id]), AttrStart[id], Math.max(caps[id], AttrStart[id]));
  return { ...b, attrs };
}

// ------------------------------------------------------------------ overall

/** Peso de cada atributo no overall por posição (o que a posição precisa pesa mais). */
// prettier-ignore
const OverallWeights: Readonly<Record<Position, Partial<Record<AttributeId, number>>>> = {
  PG: { threePoint: 3, midRange: 2, ballHandle: 3, passAccuracy: 3, speedWithBall: 2, drivingLayup: 2, perimeterDefense: 1.5, steal: 1, speed: 1.5, acceleration: 1.5, closeShot: 1, freeThrow: 1 },
  SG: { threePoint: 3, midRange: 3, ballHandle: 2, drivingLayup: 2, perimeterDefense: 2, steal: 1, speed: 1.5, acceleration: 1.5, passAccuracy: 1, closeShot: 1, freeThrow: 1, drivingDunk: 1 },
  SF: { threePoint: 2, midRange: 2, drivingLayup: 2, drivingDunk: 2, perimeterDefense: 2, closeShot: 1.5, ballHandle: 1, steal: 1, defensiveRebound: 1, speed: 1, vertical: 1, strength: 1 },
  PF: { closeShot: 2, standingDunk: 2, drivingDunk: 1.5, postControl: 1.5, interiorDefense: 2, block: 1.5, defensiveRebound: 2, offensiveRebound: 1.5, strength: 1.5, midRange: 1, perimeterDefense: 1, vertical: 1 },
  C: { closeShot: 2, standingDunk: 2.5, postControl: 1.5, interiorDefense: 3, block: 3, defensiveRebound: 2.5, offensiveRebound: 2, strength: 2, vertical: 1 },
};

/** Overall (40–99): média ponderada pela posição, esticada como a do 2K (as builds focadas chegam a 90+). */
export function overall(b: PlayerBuild): number {
  const w = OverallWeights[b.position];
  let sum = 0;
  let total = 0;
  for (const id of AttributeIds) {
    const k = w[id] ?? 0.25;
    sum += k * b.attrs[id];
    total += k;
  }
  const avg = sum / total;
  return Math.round(clamp(40 + (avg - 40) * 1.25, 40, 99));
}

// ------------------------------------------------------------------ grupos, badges e arquétipo

/** Nota de cada grupo de atributos (média do grupo). */
export function groupScores(b: PlayerBuild): Record<AttributeGroupId, number> {
  const out = {} as Record<AttributeGroupId, number>;
  for (const g of AttributeGroups) out[g.id] = Math.round(g.attrs.reduce((s, id) => s + b.attrs[id], 0) / g.attrs.length);
  return out;
}

/** Atributos de cada categoria de badge (o 2K tira os pontos de badge dos atributos da categoria). */
const BadgeAttrs: Readonly<Record<BadgeCategory, readonly AttributeId[]>> = {
  Finishing: ['closeShot', 'drivingLayup', 'drivingDunk', 'standingDunk', 'postControl'],
  Shooting: ['midRange', 'threePoint', 'freeThrow'],
  Playmaking: ['passAccuracy', 'ballHandle', 'speedWithBall'],
  Defense: ['interiorDefense', 'perimeterDefense', 'steal', 'block', 'offensiveRebound', 'defensiveRebound'],
};

/** Pontos que contam para badge: só o que passa de 50 (o 2K não dá badge para atributo baixo). */
const badgeRaw = (b: PlayerBuild, c: BadgeCategory): number =>
  BadgeAttrs[c].reduce((s, id) => s + Math.max(0, b.attrs[id] - 50), 0) / BadgeAttrs[c].length;

/** Custo de todas as badges de uma categoria no HOF (8 Tier 1 × 4 + 4 Tier 2 × 6 + 4 Tier 3 × 8): o teto de pontos. */
export const BadgeCategoryMax = 88;
/** Pontos de badge por ponto médio de atributo acima de 50. */
const BadgePerRaw = 1.6;

/**
 * Pontos de badge por categoria ("BADGE UPGRADES" do 2K). Partem do orçamento de antes do builder (DirectorBudget, que
 * é o da build padrão) e sobem ou descem 1,6 por ponto médio de atributo da categoria acima de 50, entre 0 e 88.
 */
export function badgePoints(b: PlayerBuild): CategoryBudget {
  const out = {} as CategoryBudget;
  for (const c of Object.keys(BadgeAttrs) as BadgeCategory[]) {
    const delta = badgeRaw(b, c) - badgeRaw(DefaultBuild, c);
    out[c] = Math.round(clamp(DirectorBudget[c] + BadgePerRaw * delta, 0, BadgeCategoryMax));
  }
  return out;
}

type Skill = 'finish' | 'post' | 'shoot' | 'play' | 'perim' | 'paint' | 'board';
const SkillAttrs: Readonly<Record<Skill, readonly AttributeId[]>> = {
  finish: ['drivingLayup', 'drivingDunk', 'closeShot'],
  post: ['postControl', 'standingDunk', 'strength'],
  shoot: ['threePoint', 'midRange'],
  play: ['ballHandle', 'passAccuracy', 'speedWithBall'],
  perim: ['perimeterDefense', 'steal'],
  paint: ['interiorDefense', 'block'],
  board: ['offensiveRebound', 'defensiveRebound'],
};

export function skillScores(b: PlayerBuild): Record<Skill, number> {
  const out = {} as Record<Skill, number>;
  for (const s of Object.keys(SkillAttrs) as Skill[]) {
    out[s] = SkillAttrs[s].reduce((sum, id) => sum + b.attrs[id], 0) / SkillAttrs[s].length;
  }
  return out;
}

/** Núcleo do nome pelas duas maiores habilidades (par sem ordem). */
// prettier-ignore
const CoreNames: Readonly<Record<string, string>> = {
  'finish+shoot': 'Pontuador Dentro e Fora', 'finish+play': 'Armador Infiltrador', 'play+shoot': 'Criador de Arremessos',
  'finish+post': 'Finalizador de Garrafão', 'post+shoot': 'Criador de Meia no Poste', 'play+post': 'Armador de Poste',
  'finish+perim': 'Infiltrador Defensor', 'perim+shoot': 'Arremessador Defensor', 'perim+play': 'Armador Defensor',
  'finish+paint': 'Finalizador Protetor de Aro', 'paint+shoot': 'Pivô Aberto Protetor de Aro', 'paint+play': 'Pivô Armador',
  'board+finish': 'Monstro do Garrafão', 'board+shoot': 'Ala-pivô Aberto', 'board+play': 'Armador Caça-Rebotes',
  'board+post': 'Pivô Dominante', 'paint+post': 'Pivô Defensor de Poste', 'perim+post': 'Pivô Versátil',
  'board+paint': 'Protetor de Aro', 'board+perim': 'Defensor Caça-Rebotes', 'paint+perim': 'Defensor Completo',
};

const pairKey = (a: Skill, b: Skill): string => [a, b].sort().join('+');

/**
 * Nome do arquétipo no estilo do 2K26 (qualificadores + papel: "2-Way 3-Level Scorer" → "Pontuador de 3 Níveis de 2
 * Lados"). O 2K não publica a regra; a nossa: papel pelas duas maiores habilidades, qualificadores pela terceira e
 * pela defesa. Todos os núcleos são masculinos para os qualificadores concordarem.
 */
export function archetypeName(b: PlayerBuild): string {
  const s = skillScores(b);
  const ranked = (Object.keys(s) as Skill[]).sort((x, y) => s[y] - s[x]);
  const [first, second, third] = ranked as [Skill, Skill, Skill];
  // 3 níveis: perto, meia e três altos (como o "3-Level Threat").
  const threeLevel = b.attrs.threePoint >= 78 && b.attrs.midRange >= 78 && (b.attrs.drivingLayup >= 78 || b.attrs.drivingDunk >= 78);
  let core = threeLevel ? 'Pontuador de 3 Níveis' : CoreNames[pairKey(first, second)] ?? 'Jogador Completo';
  if (!threeLevel && s[first] < 60) core = 'Jogador em Formação';
  const mods: string[] = [];
  const strong = (k: Skill): boolean => s[k] >= 72 && (k === third || (threeLevel && (k === first || k === second)));
  if (strong('play') && !core.includes('Armador')) mods.push('Passador');
  if (strong('board') && !core.includes('Rebote') && !core.includes('Garrafão')) mods.push('Caça-Rebotes');
  const defense = Math.max(s.perim, s.paint);
  if (defense >= 75 && !core.includes('Defens') && !core.includes('Protetor')) mods.push('de 2 Lados');
  return [core, ...mods].join(' ');
}

// ------------------------------------------------------------------ Shades Of

export interface Shade {
  name: string;
  tag: string;
  color: string;
  /** 0–100: quanto o perfil da build lembra o do jogador. */
  match: number;
}

/** Perfil de referência: altura (pol.) e as notas das 7 habilidades (aproximadas, de 0 a 99). */
interface ShadeRef {
  name: string;
  tag: string;
  pos: Position;
  h: number;
  skills: Record<Skill, number>;
  color: string;
}

const ref = (name: string, tag: string, pos: Position, h: number, sk: [number, number, number, number, number, number, number], color: string): ShadeRef => ({
  name,
  tag,
  pos,
  h,
  skills: { finish: sk[0], post: sk[1], shoot: sk[2], play: sk[3], perim: sk[4], paint: sk[5], board: sk[6] },
  color,
});

// Perfis de referência (notas aproximadas, nossas, por habilidade: finish, post, shoot, play, perim, paint, board).
// prettier-ignore
export const ShadeRefs: readonly ShadeRef[] = [
  ref('Stephen Curry', 'Armador · arremessador histórico', 'PG', 74, [82, 40, 99, 90, 70, 35, 50], '#1d4fa8'),
  ref('Damian Lillard', 'Armador · bola de 3 do logo', 'PG', 74, [84, 40, 94, 88, 62, 35, 45], '#c8102e'),
  ref('Allen Iverson', 'Armador · infiltração e crossover', 'PG', 72, [92, 35, 78, 92, 78, 30, 40], '#1d428a'),
  ref('Chris Paul', 'Armador · controle e passe', 'PG', 72, [76, 40, 84, 97, 85, 35, 50], '#e56020'),
  ref('Steve Nash', 'Armador · passe e arremesso', 'PG', 75, [78, 35, 93, 97, 50, 30, 40], '#e56020'),
  ref('Kyrie Irving', 'Armador · drible e finalização', 'PG', 74, [95, 40, 89, 92, 65, 35, 45], '#007a33'),
  ref('Fred VanVleet', 'Armador · 3 e defesa', 'PG', 72, [68, 35, 86, 84, 82, 35, 45], '#ce1141'),
  ref('Ja Morant', 'Armador · explosão no aro', 'PG', 74, [96, 40, 70, 88, 62, 40, 55], '#5d76a9'),
  ref('Magic Johnson', 'Armador alto · passe', 'PG', 81, [85, 60, 70, 99, 70, 55, 80], '#552583'),
  ref('Shai Gilgeous-Alexander', 'Armador · meia e infiltração', 'PG', 78, [93, 45, 86, 88, 80, 50, 55], '#007ac1'),
  ref('Luka Doncic', 'Armador · criador de 3 níveis', 'PG', 79, [86, 55, 88, 96, 55, 40, 75], '#00538c'),
  ref('Devin Booker', 'Ala-armador · 3 níveis', 'SG', 77, [86, 45, 92, 82, 60, 35, 50], '#e56020'),
  ref('Klay Thompson', 'Ala-armador · 3 e defesa', 'SG', 78, [72, 40, 96, 65, 84, 40, 50], '#1d4fa8'),
  ref('Dwyane Wade', 'Ala-armador · infiltração', 'SG', 76, [96, 50, 68, 85, 82, 60, 60], '#98002e'),
  ref('Kobe Bryant', 'Ala-armador · meia distância', 'SG', 78, [92, 60, 88, 82, 86, 45, 60], '#552583'),
  ref('Michael Jordan', 'Ala-armador · completo', 'SG', 78, [97, 65, 85, 84, 94, 50, 62], '#ce1141'),
  ref('Vince Carter', 'Ala · enterradas', 'SG', 78, [97, 45, 84, 76, 64, 45, 55], '#753bbd'),
  ref('Anthony Edwards', 'Ala-armador · atleta', 'SG', 76, [94, 50, 84, 78, 78, 45, 55], '#0c2340'),
  ref('LeBron James', 'Ala · armador de força', 'SF', 81, [96, 70, 80, 95, 78, 65, 78], '#552583'),
  ref('Kevin Durant', 'Ala · pontuador alto', 'SF', 83, [90, 65, 95, 78, 70, 70, 68], '#1d4fa8'),
  ref('Kawhi Leonard', 'Ala · 2 lados', 'SF', 79, [86, 65, 88, 74, 97, 60, 65], '#c4ced4'),
  ref('Paul George', 'Ala · 3 e defesa', 'SF', 80, [84, 50, 89, 78, 88, 50, 62], '#1d428a'),
  ref('Jimmy Butler', 'Ala · força e defesa', 'SF', 79, [88, 65, 72, 80, 88, 55, 62], '#98002e'),
  ref('Jayson Tatum', 'Ala · pontuador', 'SF', 80, [88, 55, 88, 78, 78, 55, 70], '#007a33'),
  ref('Scottie Pippen', 'Ala · defensor completo', 'SF', 80, [84, 55, 70, 85, 95, 65, 68], '#ce1141'),
  ref('Giannis Antetokounmpo', 'Ala-pivô · fera do garrafão', 'PF', 83, [98, 80, 55, 80, 78, 85, 90], '#00471b'),
  ref('Dirk Nowitzki', 'Ala-pivô · arremessador alto', 'PF', 84, [72, 80, 94, 65, 45, 55, 72], '#00538c'),
  ref('Tim Duncan', 'Ala-pivô · poste e defesa', 'PF', 83, [78, 94, 60, 65, 55, 94, 92], '#c4ced4'),
  ref('Kevin Garnett', 'Ala-pivô · 2 lados', 'PF', 83, [80, 82, 70, 68, 75, 92, 92], '#007a33'),
  ref('Draymond Green', 'Ala-pivô · defesa e passe', 'PF', 78, [65, 55, 60, 88, 88, 85, 78], '#1d4fa8'),
  ref('Anthony Davis', 'Ala-pivô · pivô moderno', 'PF', 82, [90, 80, 70, 60, 70, 97, 92], '#552583'),
  ref('Chris Webber', 'Ala-pivô · poste e passe', 'PF', 82, [82, 85, 68, 85, 55, 72, 85], '#5a2d81'),
  ref('Shareef Abdur-Rahim', 'Ala-pivô · meia no poste', 'PF', 81, [80, 82, 74, 60, 50, 60, 80], '#5d76a9'),
  ref('Shaquille O\'Neal', 'Pivô · dominante', 'C', 85, [92, 99, 30, 55, 40, 90, 95], '#552583'),
  ref('Hakeem Olajuwon', 'Pivô · Dream Shake', 'C', 84, [86, 99, 55, 60, 70, 99, 92], '#ce1141'),
  ref('Nikola Jokic', 'Pivô · armador', 'C', 83, [82, 90, 82, 99, 55, 70, 95], '#0e2240'),
  ref('Joel Embiid', 'Pivô · meia no poste', 'C', 84, [84, 95, 82, 65, 50, 92, 90], '#006bb6'),
  ref('Rudy Gobert', 'Pivô · protetor de aro', 'C', 85, [80, 70, 25, 40, 45, 99, 97], '#002b5c'),
  ref('Dikembe Mutombo', 'Pivô · tocos', 'C', 86, [70, 65, 20, 35, 40, 99, 95], '#0c2340'),
  ref('Victor Wembanyama', 'Pivô · unicórnio', 'C', 88, [86, 70, 80, 70, 70, 99, 90], '#c4ced4'),
  ref('Ben Wallace', 'Pivô · defesa e rebote', 'C', 81, [60, 55, 20, 45, 75, 97, 97], '#c8102e'),
  ref('Mark Price', 'Armador · arremesso puro', 'PG', 72, [70, 30, 95, 88, 55, 25, 35], '#860038'),
  ref('Steve Francis', 'Armador · explosão e 3', 'PG', 75, [92, 40, 80, 84, 70, 35, 55], '#ce1141'),
  ref('Baron Davis', 'Armador · força e passe', 'PG', 75, [90, 45, 80, 90, 76, 40, 50], '#1d428a'),
  ref('Kristaps Porzingis', 'Pivô · aberto e toco', 'C', 87, [78, 70, 86, 50, 50, 92, 82], '#007a33'),
  ref('Marc Gasol', 'Pivô · passe e defesa', 'C', 83, [70, 82, 78, 85, 50, 90, 85], '#5d76a9'),
];

/** Os 3 jogadores com o perfil mais parecido (habilidades + altura; mesma posição ganha um bônus pequeno). */
export function shadesOf(b: PlayerBuild, count = 3): Shade[] {
  const s = skillScores(b);
  const heightIn = b.body.heightCm / In;
  const skills = Object.keys(s) as Skill[];
  const scored = ShadeRefs.map((r) => {
    let d2 = 0;
    for (const k of skills) d2 += (s[k] - r.skills[k]) ** 2;
    const skillDist = Math.sqrt(d2 / skills.length); // erro médio por habilidade
    const heightDist = Math.abs(heightIn - r.h) * 2.2;
    const dist = skillDist + heightDist - (r.pos === b.position ? 3 : 0);
    return { r, dist };
  }).sort((x, y) => x.dist - y.dist);
  return scored.slice(0, count).map(({ r, dist }) => ({
    name: r.name,
    tag: r.tag,
    color: r.color,
    match: Math.round(clamp(100 - dist * 1.6, 35, 98)),
  }));
}

// ------------------------------------------------------------------ build padrão e rascunho

/**
 * Build padrão (sem nenhuma salva): o armador arremessador que o Freestyle sempre usou, na altura do boneco (1,86 m,
 * 6'1": PlayerHeightMeters, escolhida pelo diretor em 2026-10-15), então a escala do corpo dela é 1. Os atributos que o
 * jogo lê (3PT/meia/perto 85, bandeja 85, enterrada 80) são os números que estavam fixos no código: com ela, o
 * Freestyle joga igual a antes do builder.
 */
export const DefaultBuild: PlayerBuild = Object.freeze({
  version: 1,
  id: 'padrao',
  firstName: 'Cardoso',
  lastName: '2K',
  position: 'PG',
  hand: 'r',
  jersey: 7,
  country: 'BR',
  body: { heightCm: 186, weightKg: 90, wingspanCm: 186 + 3 * In, shape: 'atletico' },
  // prettier-ignore
  attrs: {
    closeShot: 85, drivingLayup: 85, drivingDunk: 80, standingDunk: 45, postControl: 45,
    midRange: 85, threePoint: 85, freeThrow: 85,
    passAccuracy: 78, ballHandle: 85, speedWithBall: 80,
    interiorDefense: 40, perimeterDefense: 70, steal: 65, block: 35, offensiveRebound: 35, defensiveRebound: 50,
    speed: 82, acceleration: 82, strength: 55, vertical: 70, stamina: 85,
  },
  createdAt: 0,
  updatedAt: 0,
}) as PlayerBuild;

/** Rascunho novo: corpo padrão da posição e tudo em 25 (como o 2K começa). */
export function newDraft(position: Position): PlayerBuild {
  const now = Date.now();
  return {
    version: 1,
    id: newBuildId(),
    firstName: '',
    lastName: '',
    position,
    hand: 'r',
    jersey: 0,
    country: 'BR',
    body: defaultBody(position),
    attrs: { ...AttrStart },
    createdAt: now,
    updatedAt: now,
  };
}

/** Build lida do armazenamento: preenche o que faltar, prende o corpo nas faixas e os atributos nos caps. */
export function sanitizeBuild(raw: PlayerBuild): PlayerBuild {
  const position: Position = (['PG', 'SG', 'SF', 'PF', 'C'] as const).includes(raw.position) ? raw.position : 'PG';
  const [hLo, hHi] = heightRange(position);
  const heightCm = clamp(Number(raw.body?.heightCm) || defaultBody(position).heightCm, hLo, hHi);
  const [wLo, wHi] = weightRange(heightCm);
  const [sLo, sHi] = wingspanRange(heightCm);
  const body: Body = {
    heightCm,
    weightKg: clamp(Number(raw.body?.weightKg) || typicalWeightKg(heightCm), wLo, wHi),
    wingspanCm: clamp(Number(raw.body?.wingspanCm) || heightCm + NeutralWingspanIn * In, sLo, sHi),
    shape: raw.body?.shape ?? 'atletico',
  };
  const attrs = { ...AttrStart };
  for (const id of AttributeIds) attrs[id] = Number(raw.attrs?.[id]) || AttrStart[id];
  return fitToBody({
    version: 1,
    id: String(raw.id),
    firstName: String(raw.firstName ?? ''),
    lastName: String(raw.lastName ?? ''),
    position,
    hand: raw.hand === 'l' ? 'l' : 'r',
    jersey: clamp(Math.round(Number(raw.jersey) || 0), 0, 99),
    country: String(raw.country ?? 'BR'),
    body,
    attrs,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  });
}
