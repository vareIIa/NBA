import { describe, expect, it } from 'vitest';
import { BuildPresets, presetAttrs } from './BuilderPresets';
import { AttributeIds, type Body, type PlayerBuild, type Position, PositionOrder } from '../../build/PlayerBuild';
import {
  AttrStart,
  attributeCaps,
  buildPoints,
  canRaise,
  heightRange,
  newDraft,
  pointsLeft,
  pointsSpent,
  stepCost,
  typicalWeightKg,
  weightRange,
  wingspanRange,
} from '../../build/BuildRules';

/** Corpo padrão de cada posição e os extremos (baixo/alto × leve de braço curto, pesado de braço longo, típico). */
function bodies(p: Position): Body[] {
  const [hLo, hHi] = heightRange(p);
  const out: Body[] = [newDraft(p).body];
  for (const heightCm of [hLo, hHi]) {
    const [wLo, wHi] = weightRange(heightCm);
    const [sLo, sHi] = wingspanRange(heightCm);
    out.push({ heightCm, weightKg: wLo, wingspanCm: sLo, shape: 'magro' });
    out.push({ heightCm, weightKg: wHi, wingspanCm: sHi, shape: 'pesado' });
    out.push({ heightCm, weightKg: typicalWeightKg(heightCm), wingspanCm: heightCm, shape: 'atletico' });
  }
  return out;
}

const cases: Array<{ build: PlayerBuild; label: string }> = PositionOrder.flatMap((p) =>
  bodies(p).map((body, i) => ({ build: { ...newDraft(p), body }, label: `${p} corpo ${i}` })),
);

describe('presets do builder', () => {
  it('pelo menos 5 presets, com os do pedido (arremessador, infiltrador, armador, 3&D, protetor de aro)', () => {
    expect(BuildPresets.length).toBeGreaterThanOrEqual(5);
    for (const id of ['sniper', 'slasher', 'playmaker', '3d', 'rim']) expect(BuildPresets.some((p) => p.id === id)).toBe(true);
    for (const p of BuildPresets) {
      expect(p.name.length).toBeGreaterThan(2);
      expect(p.desc.length).toBeGreaterThan(10);
      for (const [id, w] of p.weights) {
        expect(AttributeIds).toContain(id);
        expect(w).toBeGreaterThan(0);
        expect(w).toBeLessThanOrEqual(1);
      }
      expect(new Set(p.weights.map(([id]) => id)).size).toBe(p.weights.length);
    }
  });

  it('nunca passa do cap nem do orçamento, nunca fica abaixo do começo, e gasta quase tudo', () => {
    for (const { build, label } of cases) {
      const caps = attributeCaps(build.position, build.body);
      for (const preset of BuildPresets) {
        const attrs = presetAttrs(build, preset);
        const b = { ...build, attrs };
        const where = `${label} · ${preset.name}`;
        for (const id of AttributeIds) {
          expect(attrs[id], `${where} · ${id}`).toBeGreaterThanOrEqual(AttrStart[id]);
          expect(attrs[id], `${where} · ${id}`).toBeLessThanOrEqual(Math.max(caps[id], AttrStart[id]));
          expect(Number.isInteger(attrs[id])).toBe(true);
        }
        expect(pointsSpent(attrs), where).toBeLessThanOrEqual(buildPoints(b));
        // Gasta quase tudo: sobra menos que o degrau mais caro, e nenhum atributo ainda pode subir.
        expect(pointsLeft(b), where).toBeLessThan(stepCost(98));
        expect(AttributeIds.some((id) => canRaise(b, id)), where).toBe(false);
      }
    }
  });

  it('o atributo principal do preset chega ao teto no corpo da posição dele', () => {
    const natural: Record<string, Position> = { sniper: 'SG', slasher: 'SG', playmaker: 'PG', '3d': 'SF', rim: 'C', threelevel: 'SG', post: 'C' };
    for (const preset of BuildPresets) {
      const build = newDraft(natural[preset.id] ?? 'SF');
      const caps = attributeCaps(build.position, build.body);
      const attrs = presetAttrs(build, preset);
      const [main] = preset.weights[0]!;
      expect(attrs[main], `${preset.name} · ${main}`).toBe(caps[main]);
      // E fica acima de qualquer atributo fora do preset.
      const listed = new Set(preset.weights.map(([id]) => id));
      for (const id of AttributeIds) if (!listed.has(id) && id !== 'stamina') expect(attrs[id]).toBeLessThanOrEqual(attrs[main]);
    }
  });

  it('presets diferentes dão builds diferentes, e o resultado não depende do que a build já tinha', () => {
    const draft = newDraft('SF');
    const seen = new Set(BuildPresets.map((p) => JSON.stringify(presetAttrs(draft, p))));
    expect(seen.size).toBe(BuildPresets.length);
    const spent = { ...draft, attrs: { ...draft.attrs, threePoint: 80, block: 70 } };
    for (const p of BuildPresets) expect(presetAttrs(spent, p)).toEqual(presetAttrs(draft, p));
  });

  it('não altera a build recebida', () => {
    const draft = newDraft('PG');
    const before = JSON.stringify(draft);
    for (const p of BuildPresets) presetAttrs(draft, p);
    expect(JSON.stringify(draft)).toBe(before);
  });
});
