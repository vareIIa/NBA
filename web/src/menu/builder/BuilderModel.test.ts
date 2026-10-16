import { describe, expect, it } from 'vitest';
import {
  FinishRow,
  GroupStarts,
  RowAttrs,
  attrDeltas,
  copyBuild,
  groupIndexOf,
  holdSteps,
  moveRow,
  nextCost,
  raiseBlock,
  remainingShare,
  setAttributeTo,
  stepAttribute,
  stepAttributeBy,
} from './BuilderModel';
import { AttributeGroups, AttributeIds, type PlayerBuild } from '../../build/PlayerBuild';
import { AttrStart, BuildPointsTotal, attributeCaps, newDraft, pointsLeft, stepCost } from '../../build/BuildRules';

describe('linhas e cursor', () => {
  it('as linhas seguem as faixas e têm os 22 atributos uma vez; o botão vem depois', () => {
    expect(RowAttrs).toEqual(AttributeGroups.flatMap((g) => g.attrs));
    expect(new Set(RowAttrs)).toEqual(new Set(AttributeIds));
    expect(FinishRow).toBe(22);
    expect(GroupStarts).toEqual([0, 5, 8, 11, 17, 22]);
  });

  it('↑↓ andam uma linha e dão a volta pelo botão', () => {
    expect(moveRow(0, 'down')).toBe(1);
    expect(moveRow(21, 'down')).toBe(FinishRow);
    expect(moveRow(FinishRow, 'down')).toBe(0);
    expect(moveRow(0, 'up')).toBe(FinishRow);
  });

  it('LB/RB pulam para o começo do grupo vizinho', () => {
    expect(moveRow(0, 'nextTab')).toBe(5);
    expect(moveRow(3, 'nextTab')).toBe(5);
    expect(moveRow(6, 'prevTab')).toBe(0);
    expect(moveRow(17, 'nextTab')).toBe(FinishRow);
    expect(moveRow(FinishRow, 'nextTab')).toBe(0);
    expect(moveRow(0, 'prevTab')).toBe(FinishRow);
    expect(moveRow(FinishRow, 'prevTab')).toBe(17);
    expect(groupIndexOf(10)).toBe(2);
    expect(groupIndexOf(FinishRow)).toBe(5);
  });
});

describe('subir e descer', () => {
  it('sobe com pontos e abaixo do cap, numa cópia', () => {
    const draft = newDraft('PG');
    const r = stepAttribute(draft, 'threePoint', 1);
    expect(r.changed).toBe(true);
    expect(r.build.attrs.threePoint).toBe(26);
    expect(draft.attrs.threePoint).toBe(25);
    expect(r.build).not.toBe(draft);
    expect(r.build.body).not.toBe(draft.body);
  });

  it('não desce abaixo do começo (25; a resistência começa em 85)', () => {
    const draft = newDraft('PG');
    expect(stepAttribute(draft, 'block', -1)).toMatchObject({ changed: false, blocked: 'floor' });
    expect(stepAttribute(draft, 'stamina', -1)).toMatchObject({ changed: false, blocked: 'floor' });
    expect(AttrStart.stamina).toBe(85);
    const up = stepAttribute(draft, 'block', 1).build;
    expect(stepAttribute(up, 'block', -1)).toMatchObject({ changed: true });
  });

  it('para no cap do corpo', () => {
    const draft = newDraft('C');
    const cap = attributeCaps(draft.position, draft.body).threePoint;
    let b: PlayerBuild = draft;
    for (let i = 0; i < 200; i++) b = stepAttribute(b, 'threePoint', 1).build;
    expect(b.attrs.threePoint).toBe(cap);
    expect(raiseBlock(b, 'threePoint')).toBe('cap');
    expect(nextCost(b, 'threePoint')).toBeNull();
    expect(stepAttribute(b, 'threePoint', 1)).toMatchObject({ changed: false, blocked: 'cap' });
  });

  it('para quando o potencial acaba, e o motivo é falta de pontos', () => {
    let b: PlayerBuild = newDraft('PG');
    for (const id of RowAttrs) for (let i = 0; i < 100; i++) b = stepAttribute(b, id, 1).build;
    expect(pointsLeft(b)).toBeGreaterThanOrEqual(0);
    const stuck = RowAttrs.find((id) => b.attrs[id] < attributeCaps(b.position, b.body)[id])!;
    expect(stuck).toBeDefined();
    expect(raiseBlock(b, stuck)).toBe('points');
    expect(pointsLeft(b)).toBeLessThan(stepCost(b.attrs[stuck]));
    expect(remainingShare(b, BuildPointsTotal)).toBeLessThan(0.01);
  });

  it('segurar acelera: toque vale 1, depois 2, 4 e 8, sempre crescendo', () => {
    expect(holdSteps(0)).toBe(1);
    expect(holdSteps(599)).toBe(1);
    expect(holdSteps(600)).toBe(2);
    expect(holdSteps(1500)).toBe(4);
    expect(holdSteps(5000)).toBe(8);
    for (let t = 0; t < 4000; t += 50) expect(holdSteps(t + 50)).toBeGreaterThanOrEqual(holdSteps(t));
  });

  it('vários passos de uma vez param no teto, nos pontos e no começo', () => {
    const draft = newDraft('C');
    const cap = attributeCaps(draft.position, draft.body).threePoint;
    const up = stepAttributeBy(draft, 'threePoint', 1, 8);
    expect(up).toMatchObject({ changed: true });
    expect(up.build.attrs.threePoint).toBe(33);
    const top = stepAttributeBy(draft, 'threePoint', 1, 500);
    expect(top).toMatchObject({ changed: true, blocked: 'cap' });
    expect(top.build.attrs.threePoint).toBe(cap);
    const down = stepAttributeBy(up.build, 'threePoint', -1, 50);
    expect(down).toMatchObject({ changed: true, blocked: 'floor' });
    expect(down.build.attrs.threePoint).toBe(25);
    expect(stepAttributeBy(draft, 'threePoint', -1, 3)).toMatchObject({ changed: false, blocked: 'floor' });
    expect(draft.attrs.threePoint).toBe(25);
  });

  it('arrastar a barra leva ao valor pedido, ou até onde o cap e os pontos deixam', () => {
    const draft = newDraft('PG');
    const caps = attributeCaps(draft.position, draft.body);
    expect(setAttributeTo(draft, 'midRange', 80.4).build.attrs.midRange).toBe(80);
    expect(setAttributeTo(draft, 'standingDunk', 99)).toMatchObject({ blocked: 'cap' });
    expect(setAttributeTo(draft, 'standingDunk', 99).build.attrs.standingDunk).toBe(caps.standingDunk);
    expect(setAttributeTo(draft, 'block', 10)).toMatchObject({ changed: false, blocked: 'floor' });
    // Sem pontos: para no último degrau que dá para pagar.
    let b: PlayerBuild = draft;
    for (const id of ['threePoint', 'midRange', 'freeThrow', 'ballHandle', 'passAccuracy', 'speedWithBall', 'drivingLayup', 'closeShot', 'speed', 'acceleration'] as const)
      b = setAttributeTo(b, id, caps[id]).build;
    const r = setAttributeTo(b, 'perimeterDefense', 99);
    expect(r.blocked).toBe('points');
    expect(r.build.attrs.perimeterDefense).toBeLessThan(caps.perimeterDefense);
    expect(pointsLeft(r.build)).toBeGreaterThanOrEqual(0);
    expect(pointsLeft(r.build)).toBeLessThan(stepCost(r.build.attrs.perimeterDefense));
  });

  it('custo do próximo ponto e deltas', () => {
    const b = copyBuild(newDraft('SF'));
    expect(nextCost(b, 'midRange')).toBe(1);
    b.attrs.midRange = 75;
    expect(nextCost(b, 'midRange')).toBe(3);
    expect(attrDeltas(newDraft('SF').attrs, b.attrs)).toEqual({ midRange: 50 });
    expect(remainingShare(newDraft('SF'), BuildPointsTotal)).toBe(1);
  });
});
