// Presets da tela de atributos (os "Pro-Tuned"/templates do builder do 2K): cada um diz o que importa para o estilo de
// jogo, com um peso de 0 a 1 por atributo. A distribuição sai sempre do começo (AttrStart) e gasta o orçamento ponto a
// ponto, com canRaise (cap do corpo e pontos): o próximo ponto vai para o atributo que está mais atrás em relação ao
// peso dele, então os de peso 1 chegam perto do teto e os de peso baixo ficam no meio. Os pesos são nossos (o 2K não
// publica os dele); os tetos e o custo são os de BuildRules.
import { AttributeIds, type AttributeId, type Attributes, type PlayerBuild } from '../../build/PlayerBuild';
import { AttrStart, attributeCaps, canRaise, pointsLeft, stepCost } from '../../build/BuildRules';

export interface BuildPreset {
  id: string;
  name: string;
  /** Uma linha: o que a build faz. */
  desc: string;
  /** Atributos do estilo, do mais importante ao menos, com o peso (0–1). Os que não estão aqui ficam no começo. */
  weights: ReadonlyArray<readonly [AttributeId, number]>;
}

// prettier-ignore
export const BuildPresets: readonly BuildPreset[] = [
  {
    id: 'sniper', name: 'Arremessador', desc: 'Bola de 3 e meia distância no teto; drible e velocidade para criar espaço.',
    weights: [
      ['threePoint', 1], ['midRange', 0.95], ['freeThrow', 0.8], ['ballHandle', 0.5], ['speedWithBall', 0.4],
      ['speed', 0.45], ['acceleration', 0.45], ['passAccuracy', 0.35], ['closeShot', 0.35], ['drivingLayup', 0.35],
      ['perimeterDefense', 0.3], ['steal', 0.25], ['vertical', 0.15], ['defensiveRebound', 0.1],
    ],
  },
  {
    id: 'slasher', name: 'Infiltrador', desc: 'Bandeja e enterrada em infiltração, velocidade e impulsão para atacar o aro.',
    weights: [
      ['drivingLayup', 1], ['drivingDunk', 1], ['closeShot', 0.75], ['speed', 0.75], ['acceleration', 0.75],
      ['vertical', 0.7], ['speedWithBall', 0.55], ['ballHandle', 0.5], ['strength', 0.45], ['freeThrow', 0.35],
      ['midRange', 0.25], ['perimeterDefense', 0.25], ['steal', 0.25], ['threePoint', 0.2], ['passAccuracy', 0.2],
      ['offensiveRebound', 0.15],
    ],
  },
  {
    id: 'playmaker', name: 'Armador', desc: 'Passe e drible no teto, velocidade com bola; arremessa o suficiente para punir.',
    weights: [
      ['passAccuracy', 1], ['ballHandle', 1], ['speedWithBall', 0.9], ['speed', 0.6], ['acceleration', 0.6],
      ['threePoint', 0.5], ['midRange', 0.5], ['drivingLayup', 0.5], ['freeThrow', 0.4], ['closeShot', 0.35],
      ['steal', 0.35], ['perimeterDefense', 0.35],
    ],
  },
  {
    id: '3d', name: '3&D', desc: 'Bola de 3 e defesa de perímetro: abre a quadra no ataque e marca o melhor da defesa.',
    weights: [
      ['threePoint', 1], ['perimeterDefense', 1], ['steal', 0.75], ['midRange', 0.6], ['freeThrow', 0.5],
      ['speed', 0.5], ['acceleration', 0.5], ['vertical', 0.35], ['defensiveRebound', 0.35], ['interiorDefense', 0.3],
      ['block', 0.25], ['strength', 0.25], ['closeShot', 0.25], ['drivingLayup', 0.25], ['ballHandle', 0.2],
    ],
  },
  {
    id: 'rim', name: 'Pivô protetor de aro', desc: 'Toco, defesa interior e rebote no teto; força para segurar o garrafão.',
    weights: [
      ['block', 1], ['interiorDefense', 1], ['defensiveRebound', 0.9], ['offensiveRebound', 0.7], ['strength', 0.7],
      ['standingDunk', 0.65], ['vertical', 0.55], ['closeShot', 0.5], ['postControl', 0.35], ['drivingDunk', 0.3],
      ['perimeterDefense', 0.25], ['freeThrow', 0.2],
    ],
  },
  {
    id: 'threelevel', name: 'Pontuador de 3 níveis', desc: 'Perto, meia e três: pontua de qualquer lugar, com drible para criar.',
    weights: [
      ['threePoint', 0.9], ['midRange', 0.9], ['drivingLayup', 0.9], ['closeShot', 0.75], ['drivingDunk', 0.55],
      ['ballHandle', 0.55], ['freeThrow', 0.55], ['speedWithBall', 0.45], ['speed', 0.45], ['acceleration', 0.45],
      ['passAccuracy', 0.3], ['perimeterDefense', 0.25], ['vertical', 0.2],
    ],
  },
  {
    id: 'post', name: 'Pivô de poste', desc: 'Jogo de costas e arremesso de perto, com força e rebote ofensivo.',
    weights: [
      ['postControl', 1], ['closeShot', 1], ['strength', 0.85], ['standingDunk', 0.8], ['offensiveRebound', 0.75],
      ['defensiveRebound', 0.65], ['interiorDefense', 0.55], ['block', 0.4], ['midRange', 0.4], ['passAccuracy', 0.35],
      ['freeThrow', 0.35], ['vertical', 0.3],
    ],
  },
];

/**
 * Atributos do preset para o corpo e a posição desta build. Começa em AttrStart e sobe um ponto por vez, sempre com
 * canRaise (nunca passa do cap nem do orçamento). 1º os atributos do preset, pelo atraso em relação ao peso; quando
 * nenhum deles sobe mais, o que sobrar vai para os outros, por igual. Termina quando nada mais sobe: sobram menos
 * pontos do que o próximo degrau custa. Não altera `build`.
 */
export function presetAttrs(build: PlayerBuild, preset: BuildPreset): Attributes {
  const b: PlayerBuild = { ...build, attrs: { ...AttrStart } };
  const caps = attributeCaps(b.position, b.body);
  const order = new Map(preset.weights.map(([id], i) => [id, i]));
  const weight = new Map(preset.weights.filter(([, w]) => w > 0));
  const progress = (id: AttributeId, w: number): number => {
    const range = caps[id] - AttrStart[id];
    return range <= 0 ? Infinity : (b.attrs[id] - AttrStart[id]) / range / w;
  };
  const phases: Array<ReadonlyArray<readonly [AttributeId, number]>> = [
    [...weight],
    AttributeIds.filter((id) => !weight.has(id)).map((id) => [id, 1] as const),
  ];
  let left = pointsLeft(b);
  // Filtro barato (o mesmo teste de canRaise, com os pontos contados aqui); canRaise decide antes de cada ponto.
  const fits = ([id]: readonly [AttributeId, number]): boolean => b.attrs[id] < caps[id] && left >= stepCost(b.attrs[id]);
  for (const phase of phases) {
    let open = phase.filter(fits);
    while (open.length) {
      // O mais atrasado sobe; empate: o que vem antes na lista do preset (o mais importante).
      let pick = open[0]!;
      let best = progress(pick[0], pick[1]);
      for (const cand of open) {
        const p = progress(cand[0], cand[1]);
        if (p < best || (p === best && (order.get(cand[0]) ?? 99) < (order.get(pick[0]) ?? 99))) {
          pick = cand;
          best = p;
        }
      }
      const id = pick[0];
      if (canRaise(b, id)) {
        left -= stepCost(b.attrs[id]);
        b.attrs[id]++;
        open = open.filter(fits);
      } else open = open.filter((c) => c !== pick);
    }
  }
  return b.attrs;
}
