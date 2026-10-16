// Lógica da tela de atributos sem DOM (testável no node): ordem das linhas, cursor (↑↓ e LB/RB por grupo), subir e
// descer um atributo com as regras de BuildRules, e o motivo quando não dá. A tela (BuilderView) só desenha.
import { AttributeGroups, type AttributeId, type Attributes, type PlayerBuild } from '../../build/PlayerBuild';
import { AttrStart, attributeCaps, canRaise, pointsLeft, stepCost } from '../../build/BuildRules';

/** Linhas da tabela, na ordem das faixas (Finalização, Arremesso, Armação, Defesa/Rebote, Físico). */
export const RowAttrs: readonly AttributeId[] = AttributeGroups.flatMap((g) => g.attrs);
/** A linha depois do último atributo é o botão "Terminar build". */
export const FinishRow = RowAttrs.length;
/** Primeira linha de cada grupo, e o botão no fim (LB/RB andam por elas). */
export const GroupStarts: readonly number[] = [
  ...AttributeGroups.map((g) => RowAttrs.indexOf(g.attrs[0]!)),
  FinishRow,
];

export type CursorAction = 'up' | 'down' | 'prevTab' | 'nextTab';

/** Índice do grupo da linha (o botão conta como o último "grupo"). */
export function groupIndexOf(row: number): number {
  let gi = 0;
  GroupStarts.forEach((start, i) => {
    if (row >= start) gi = i;
  });
  return gi;
}

/** ↑↓ andam uma linha (dando a volta); LB/RB vão para o começo do grupo anterior/seguinte. */
export function moveRow(row: number, action: CursorAction): number {
  const n = FinishRow + 1;
  if (action === 'up') return (row - 1 + n) % n;
  if (action === 'down') return (row + 1) % n;
  const g = GroupStarts.length;
  const gi = groupIndexOf(row);
  return GroupStarts[(gi + (action === 'nextTab' ? 1 : g - 1)) % g]!;
}

/** Cópia da build (o objeto que a tela recebe nunca é alterado). */
export const copyBuild = (b: PlayerBuild): PlayerBuild => ({ ...b, body: { ...b.body }, attrs: { ...b.attrs } });

/** Por que o atributo não sobe: no teto do corpo, ou sem pontos para o próximo degrau. null = sobe. */
export function raiseBlock(b: PlayerBuild, id: AttributeId): 'cap' | 'points' | null {
  if (canRaise(b, id)) return null;
  return b.attrs[id] >= attributeCaps(b.position, b.body)[id] ? 'cap' : 'points';
}

export interface StepResult {
  build: PlayerBuild;
  changed: boolean;
  /** Onde parou antes do pedido: teto do corpo, sem pontos, ou no começo (não desce abaixo de AttrStart). */
  blocked?: 'cap' | 'points' | 'floor';
}

/**
 * ←→ segurado acelera: pontos por repetição conforme o tempo segurando (ms). Um toque é sempre 1; segurando, 2, 4 e 8
 * (do 25 ao 99 em ~2,5 s no controle, que repete a cada 110 ms, e em ~1,5 s no teclado).
 */
export function holdSteps(heldMs: number): number {
  return heldMs < 600 ? 1 : heldMs < 1200 ? 2 : heldMs < 2000 ? 4 : 8;
}

/** +1 ou −1 num atributo. Sobe só com canRaise; desce até AttrStart. Devolve uma build nova quando muda. */
export function stepAttribute(b: PlayerBuild, id: AttributeId, dir: -1 | 1): StepResult {
  if (dir > 0) {
    const blocked = raiseBlock(b, id);
    if (blocked) return { build: b, changed: false, blocked };
  } else if (b.attrs[id] <= AttrStart[id]) return { build: b, changed: false, blocked: 'floor' };
  const next = copyBuild(b);
  next.attrs[id] += dir;
  return { build: next, changed: true };
}

/** Até `n` passos na mesma direção, um por vez com as regras de stepAttribute; para onde não der mais. */
export function stepAttributeBy(b: PlayerBuild, id: AttributeId, dir: -1 | 1, n: number): StepResult {
  let build = b;
  for (let i = 0; i < n; i++) {
    const r = stepAttribute(build, id, dir);
    if (!r.changed) return { build, changed: build !== b, blocked: r.blocked };
    build = r.build;
  }
  return { build, changed: build !== b };
}

/** Leva o atributo até `target` (arrastar a barra com o mouse): para no teto, nos pontos ou no começo. */
export function setAttributeTo(b: PlayerBuild, id: AttributeId, target: number): StepResult {
  const goal = Math.round(target);
  const now = b.attrs[id];
  return stepAttributeBy(b, id, goal > now ? 1 : -1, Math.abs(goal - now));
}

/** Custo do próximo ponto deste atributo (null no teto). */
export function nextCost(b: PlayerBuild, id: AttributeId): number | null {
  return b.attrs[id] >= attributeCaps(b.position, b.body)[id] ? null : stepCost(b.attrs[id]);
}

/** Diferença por atributo entre duas distribuições (só os que mudam). */
export function attrDeltas(from: Attributes, to: Attributes): Partial<Record<AttributeId, number>> {
  const out: Partial<Record<AttributeId, number>> = {};
  for (const id of RowAttrs) if (to[id] !== from[id]) out[id] = to[id] - from[id];
  return out;
}

/** Potencial restante em 0–1 (o medidor do topo). */
export function remainingShare(b: PlayerBuild, total: number): number {
  return total > 0 ? Math.min(1, Math.max(0, pointsLeft(b) / total)) : 0;
}
