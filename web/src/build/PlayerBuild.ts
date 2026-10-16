// Build do jogador (MyPlayer do 2K): identidade, corpo e os 22 atributos do builder do 2K24/2K25 (mesma lista e mesma
// ordem das telas de referência). As regras (faixas de corpo, caps, custo, overall, arquétipo, Shades Of) ficam em
// BuildRules.ts; o que a build muda no Freestyle, em BuildRatings.ts; salvar e carregar, em BuildSave.ts.
// Doc: docs/23-myplayer-builder.md.

export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export type Hand = 'r' | 'l';
/** Tipos de corpo do builder (2K: Slender, Built, Muscular, Heavy…): só muda o visual e o peso inicial. */
export type BodyShape = 'magro' | 'atletico' | 'forte' | 'pesado';

export interface Body {
  heightCm: number;
  weightKg: number;
  wingspanCm: number;
  shape: BodyShape;
}

export type AttributeGroupId = 'finishing' | 'shooting' | 'playmaking' | 'defense' | 'physicals';

// prettier-ignore
export const AttributeIds = [
  'closeShot', 'drivingLayup', 'drivingDunk', 'standingDunk', 'postControl',
  'midRange', 'threePoint', 'freeThrow',
  'passAccuracy', 'ballHandle', 'speedWithBall',
  'interiorDefense', 'perimeterDefense', 'steal', 'block', 'offensiveRebound', 'defensiveRebound',
  'speed', 'acceleration', 'strength', 'vertical', 'stamina',
] as const;
export type AttributeId = (typeof AttributeIds)[number];
export type Attributes = Record<AttributeId, number>;

export interface AttributeInfo {
  id: AttributeId;
  group: AttributeGroupId;
  /** Nome na tela (português, com o nome do 2K entre parênteses no doc). */
  label: string;
  /** Nome curto (tabelas estreitas). */
  short: string;
  /** O que o atributo faz no nosso jogo (o 2K não explica; nós explicamos: docs/09 §2). */
  desc: string;
}

// prettier-ignore
export const AttributeInfos: Readonly<Record<AttributeId, AttributeInfo>> = {
  closeShot: { id: 'closeShot', group: 'finishing', label: 'Arremesso de perto', short: 'Perto', desc: 'Floater, gancho e arremessos a menos de 3 m da cesta.' },
  drivingLayup: { id: 'drivingLayup', group: 'finishing', label: 'Bandeja em infiltração', short: 'Bandeja', desc: 'Chance e janela das bandejas em movimento (euro, hop, reversa).' },
  drivingDunk: { id: 'drivingDunk', group: 'finishing', label: 'Enterrada em infiltração', short: 'Enterrada', desc: 'Enterrar correndo para a cesta; com 85+ destrava as enterradas de contato.' },
  standingDunk: { id: 'standingDunk', group: 'finishing', label: 'Enterrada parado', short: 'Ent. parado', desc: 'Enterrar sem embalo, perto do aro (pivôs e putbacks).' },
  postControl: { id: 'postControl', group: 'finishing', label: 'Controle no poste', short: 'Poste', desc: 'Jogo de costas: giros, ganchos e fadeaway no poste.' },
  midRange: { id: 'midRange', group: 'shooting', label: 'Meia distância', short: 'Meia', desc: 'Janela do green e acerto dos arremessos dentro da linha de 3.' },
  threePoint: { id: 'threePoint', group: 'shooting', label: 'Bola de 3', short: '3 pontos', desc: 'Janela do green e acerto atrás da linha de 3.' },
  freeThrow: { id: 'freeThrow', group: 'shooting', label: 'Lance livre', short: 'L. livre', desc: 'Lances livres.' },
  passAccuracy: { id: 'passAccuracy', group: 'playmaking', label: 'Precisão de passe', short: 'Passe', desc: 'Passes chegam no peito e mais rápido; menos passes desviados.' },
  ballHandle: { id: 'ballHandle', group: 'playmaking', label: 'Controle de bola', short: 'Drible', desc: 'Dribles mais rápidos e mais encadeados, com menos perda de energia.' },
  speedWithBall: { id: 'speedWithBall', group: 'playmaking', label: 'Velocidade com bola', short: 'Vel. c/ bola', desc: 'Velocidade máxima driblando.' },
  interiorDefense: { id: 'interiorDefense', group: 'defense', label: 'Defesa interior', short: 'Def. int.', desc: 'Contestação e contato no garrafão.' },
  perimeterDefense: { id: 'perimeterDefense', group: 'defense', label: 'Defesa de perímetro', short: 'Def. per.', desc: 'Contestação e cutoff longe da cesta.' },
  steal: { id: 'steal', group: 'defense', label: 'Roubo', short: 'Roubo', desc: 'Chance de roubar o drible e o passe.' },
  block: { id: 'block', group: 'defense', label: 'Toco', short: 'Toco', desc: 'Chance e alcance do toco.' },
  offensiveRebound: { id: 'offensiveRebound', group: 'defense', label: 'Rebote ofensivo', short: 'Reb. of.', desc: 'Ganhar o rebote no ataque.' },
  defensiveRebound: { id: 'defensiveRebound', group: 'defense', label: 'Rebote defensivo', short: 'Reb. def.', desc: 'Ganhar o rebote na defesa.' },
  speed: { id: 'speed', group: 'physicals', label: 'Velocidade', short: 'Velocidade', desc: 'Velocidade máxima sem a bola.' },
  acceleration: { id: 'acceleration', group: 'physicals', label: 'Aceleração', short: 'Aceleração', desc: 'Quanto tempo leva para chegar à velocidade máxima.' },
  strength: { id: 'strength', group: 'physicals', label: 'Força', short: 'Força', desc: 'Ganhar o contato (bump, poste, bandeja com contato).' },
  vertical: { id: 'vertical', group: 'physicals', label: 'Impulsão', short: 'Impulsão', desc: 'Altura do salto: tocos, rebotes e enterradas.' },
  stamina: { id: 'stamina', group: 'physicals', label: 'Resistência', short: 'Resistência', desc: 'Tamanho da barra de energia (sprint e dribles gastam).' },
};

export interface AttributeGroup {
  id: AttributeGroupId;
  label: string;
  /** Cor da faixa (as mesmas do builder do 2K: azul, verde, laranja, vermelho, roxo). */
  color: string;
  attrs: readonly AttributeId[];
}

export const AttributeGroups: readonly AttributeGroup[] = [
  { id: 'finishing', label: 'Finalização', color: '#2f74d8', attrs: ['closeShot', 'drivingLayup', 'drivingDunk', 'standingDunk', 'postControl'] },
  { id: 'shooting', label: 'Arremesso', color: '#2fae55', attrs: ['midRange', 'threePoint', 'freeThrow'] },
  { id: 'playmaking', label: 'Armação', color: '#e9a227', attrs: ['passAccuracy', 'ballHandle', 'speedWithBall'] },
  { id: 'defense', label: 'Defesa / Rebote', color: '#d8343a', attrs: ['interiorDefense', 'perimeterDefense', 'steal', 'block', 'offensiveRebound', 'defensiveRebound'] },
  { id: 'physicals', label: 'Físico', color: '#8a4bdc', attrs: ['speed', 'acceleration', 'strength', 'vertical', 'stamina'] },
];

export const Positions: Readonly<Record<Position, { label: string; full: string }>> = {
  PG: { label: 'PG', full: 'Armador' },
  SG: { label: 'SG', full: 'Ala-armador' },
  SF: { label: 'SF', full: 'Ala' },
  PF: { label: 'PF', full: 'Ala-pivô' },
  C: { label: 'C', full: 'Pivô' },
};
export const PositionOrder: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

export const BodyShapes: Readonly<Record<BodyShape, string>> = {
  magro: 'Magro',
  atletico: 'Atlético',
  forte: 'Forte',
  pesado: 'Pesado',
};
export const BodyShapeOrder: readonly BodyShape[] = ['magro', 'atletico', 'forte', 'pesado'];

/** Todo atributo começa em 25 (o "STARTING" das telas do 2K). */
export const AttrFloor = 25;
export const AttrCeil = 99;

export interface PlayerBuild {
  version: 1;
  id: string;
  firstName: string;
  lastName: string;
  position: Position;
  hand: Hand;
  jersey: number;
  /** País (bandeira no cartão, estilo EA FC). Código livre (BR, US…). */
  country: string;
  body: Body;
  attrs: Attributes;
  createdAt: number;
  updatedAt: number;
}

export const attrsFilled = (value: number): Attributes =>
  Object.fromEntries(AttributeIds.map((id) => [id, value])) as Attributes;

/** "Cardoso" + "Silva" → "C. Silva" (o nome que aparece no HUD, como no 2K). */
export function displayName(b: Pick<PlayerBuild, 'firstName' | 'lastName'>): string {
  const first = b.firstName.trim();
  const last = b.lastName.trim();
  if (!last) return first || 'Jogador';
  return first ? `${first[0]!.toUpperCase()}. ${last}` : last;
}

export const fullName = (b: Pick<PlayerBuild, 'firstName' | 'lastName'>): string =>
  `${b.firstName.trim()} ${b.lastName.trim()}`.trim() || 'Jogador';

/** 196 → "1,96 m". */
export const formatMeters = (cm: number): string => `${(cm / 100).toFixed(2).replace('.', ',')} m`;

/** 196 → `6'5"` (o 2K mostra em pés e polegadas; arredonda para a polegada mais próxima). */
export function formatFeet(cm: number): string {
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/** 95 kg → "95 kg (209 lbs)". */
export const formatWeight = (kg: number): string => `${Math.round(kg)} kg`;
export const formatLbs = (kg: number): string => `${Math.round(kg * 2.20462)} lbs`;

export function newBuildId(): string {
  return `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
