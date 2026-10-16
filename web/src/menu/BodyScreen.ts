// Criação do jogador, 2ª tela ("Body Settings" do 2K): altura, peso, envergadura e tipo de corpo. À direita, a tabela
// ao vivo dos atributos: começo 25 → máximo possível com este corpo, e o delta da última mudança (verde sobe, vermelho
// desce), como nas telas do MP Builder. O jogador 3D cresce/encolhe com a altura.
import { type MenuHint, type MenuScreen, type NavAction, el } from './MenuScreen';
import { FormList } from './FormList';
import {
  AttrFloor,
  AttributeGroups,
  AttributeInfos,
  type Attributes,
  BodyShapeOrder,
  BodyShapes,
  type PlayerBuild,
  Positions,
  formatFeet,
  formatLbs,
  formatMeters,
} from '../build/PlayerBuild';
import { attributeCaps, fitToBody, heightRange, typicalWeightKg, weightRange, wingspanRange } from '../build/BuildRules';

export interface BodyScreenOptions {
  onBack: (build: PlayerBuild) => void;
  onNext: (build: PlayerBuild) => void;
}

const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, v));

export class BodyScreen implements MenuScreen {
  readonly root: HTMLElement;
  readonly crumb = 'MyPlayer Builder · Corpo';
  private readonly form: FormList;
  private readonly table: HTMLElement;
  private caps: Attributes;
  private deltas: Partial<Record<keyof Attributes, number>> = {};

  constructor(
    private draft: PlayerBuild,
    private readonly options: BodyScreenOptions,
  ) {
    this.caps = attributeCaps(draft.position, draft.body);
    this.root = el('div', 'mn-screen');
    const grid = el('div', 'cp', this.root);
    const left = el('section', 'cp-col', grid);
    el('h1', 'mn-h1', left, 'Corpo');
    el('p', 'mn-sub', left, `${Positions[draft.position].full}: altura, peso e envergadura mudam o máximo de cada atributo.`);
    const body = (): PlayerBuild['body'] => this.draft.body;
    this.form = new FormList(
      left,
      [
        {
          kind: 'step',
          key: 'height',
          label: 'Altura',
          get: () => formatFeet(body().heightCm),
          sub: () => formatMeters(body().heightCm),
          step: (dir) => this.setBody({ heightCm: clamp(body().heightCm + dir * 2.54, heightRange(this.draft.position)) }),
          note: () => {
            const [lo, hi] = heightRange(this.draft.position);
            return `${Positions[this.draft.position].label}: ${formatFeet(lo)} a ${formatFeet(hi)}`;
          },
        },
        {
          kind: 'step',
          key: 'weight',
          label: 'Peso',
          get: () => `${Math.round(body().weightKg)} kg`,
          sub: () => formatLbs(body().weightKg),
          step: (dir) => this.setBody({ weightKg: clamp(body().weightKg + dir * 2.268, weightRange(body().heightCm)) }),
          note: () => 'Mais peso: + força · − velocidade, aceleração e impulsão',
        },
        {
          kind: 'step',
          key: 'wingspan',
          label: 'Envergadura',
          get: () => formatFeet(body().wingspanCm),
          sub: () => {
            const d = Math.round((body().wingspanCm - body().heightCm) / 2.54);
            return `${d >= 0 ? '+' : ''}${d}" da altura`;
          },
          step: (dir) => this.setBody({ wingspanCm: clamp(body().wingspanCm + dir * 2.54, wingspanRange(body().heightCm)) }),
          note: () => 'Mais envergadura: + roubo, toco, rebote e enterrada · − bola de 3 e drible',
        },
        {
          kind: 'step',
          key: 'shape',
          label: 'Tipo de corpo',
          get: () => BodyShapes[body().shape],
          step: (dir) => {
            const order = BodyShapeOrder;
            const shape = order[(order.indexOf(body().shape) + dir + order.length) % order.length]!;
            // O tipo de corpo leva o peso para a faixa dele (magro abaixo do típico, pesado acima).
            const typical = typicalWeightKg(body().heightCm);
            const factor = { magro: 0.92, atletico: 1, forte: 1.07, pesado: 1.15 }[shape];
            this.setBody({ shape, weightKg: clamp(Math.round(typical * factor), weightRange(body().heightCm)) });
          },
        },
        { kind: 'cta', key: 'next', label: 'Continuar', run: () => this.options.onNext(this.draft) },
      ],
      () => this.renderTable(),
    );
    el('div', '', grid);
    const right = el('aside', 'cp-col', grid);
    this.table = el('div', 'cap', right);
  }

  hints(): readonly MenuHint[] {
    return [
      { key: 'dpad', label: 'Ajustar' },
      { key: 'a', label: 'Continuar' },
      { key: 'b', label: 'Voltar' },
    ];
  }

  enter(): void {
    this.form.refresh();
    this.renderTable();
  }

  leave(): void {}

  body(): PlayerBuild['body'] {
    return this.draft.body;
  }

  nav(action: NavAction): void {
    if (action === 'back') return this.options.onBack(this.draft);
    this.form.nav(action);
  }

  private setBody(patch: Partial<PlayerBuild['body']>): void {
    const old = this.draft.body;
    const body = { ...old, ...patch };
    // Altura nova: a envergadura mantém a diferença para a altura e o peso, a diferença para o típico (como no 2K, o
    // corpo inteiro acompanha); depois, os dois ficam dentro das faixas da altura nova.
    if (patch.heightCm !== undefined && patch.heightCm !== old.heightCm) {
      body.wingspanCm = body.heightCm + (old.wingspanCm - old.heightCm);
      body.weightKg = Math.round(typicalWeightKg(body.heightCm) + (old.weightKg - typicalWeightKg(old.heightCm)));
    }
    body.wingspanCm = clamp(body.wingspanCm, wingspanRange(body.heightCm));
    body.weightKg = clamp(body.weightKg, weightRange(body.heightCm));
    const before = this.caps;
    this.draft = fitToBody({ ...this.draft, body });
    this.caps = attributeCaps(this.draft.position, body);
    this.deltas = {};
    for (const id of Object.keys(before) as (keyof Attributes)[]) {
      const d = this.caps[id] - before[id];
      if (d) this.deltas[id] = d;
    }
  }

  private renderTable(): void {
    this.table.replaceChildren();
    const head = el('div', 'cap-head', this.table);
    for (const t of ['ATRIBUTO', 'COMEÇO', '', 'MÁX', '']) el('span', '', head, t);
    for (const group of AttributeGroups) {
      const g = el('div', 'cap-group', this.table, group.label);
      g.style.setProperty('--g', group.color);
      for (const id of group.attrs) {
        const row = el('div', 'cap-row', this.table);
        row.style.setProperty('--g', group.color);
        el('span', 'n', row, AttributeInfos[id].label);
        el('span', 's', row, String(AttrFloor));
        const bar = el('div', 'cap-bar', row);
        const max = el('i', '', bar);
        max.style.width = `${this.caps[id]}%`;
        const start = el('u', '', bar);
        start.style.width = `${AttrFloor}%`;
        el('span', 'm', row, String(this.caps[id]));
        const d = this.deltas[id] ?? 0;
        el('span', `d${d > 0 ? ' up' : d < 0 ? ' down' : ''}`, row, d ? `${d > 0 ? '+' : ''}${d}` : '');
      }
    }
  }
}
