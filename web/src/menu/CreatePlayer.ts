// Criação do jogador, 1ª tela (como o "First name / Last name / Position / Handed / Jersey number" do 2K, com o país do
// EA FC): identidade. A posição define a faixa de altura da próxima tela; trocar de posição põe o corpo no padrão dela.
import { type MenuHint, type MenuScreen, type NavAction, el } from './MenuScreen';
import { FormList } from './FormList';
import { type PlayerBuild, PositionOrder, Positions } from '../build/PlayerBuild';
import { defaultBody, fitToBody } from '../build/BuildRules';

export interface CreatePlayerOptions {
  onBack: () => void;
  onNext: (build: PlayerBuild) => void;
}

/** Países do cartão (código → nome). */
export const Countries: ReadonlyArray<readonly [string, string]> = [
  ['BR', 'Brasil'],
  ['US', 'Estados Unidos'],
  ['AR', 'Argentina'],
  ['PT', 'Portugal'],
  ['AO', 'Angola'],
  ['CV', 'Cabo Verde'],
  ['ES', 'Espanha'],
  ['FR', 'França'],
  ['RS', 'Sérvia'],
  ['SI', 'Eslovênia'],
  ['GR', 'Grécia'],
  ['DE', 'Alemanha'],
  ['CA', 'Canadá'],
  ['AU', 'Austrália'],
  ['NG', 'Nigéria'],
  ['CM', 'Camarões'],
];

const cycle = <T>(list: readonly T[], current: T, dir: -1 | 1): T =>
  list[(list.indexOf(current) + dir + list.length) % list.length]!;

export class CreatePlayer implements MenuScreen {
  readonly root: HTMLElement;
  readonly crumb = 'MyPlayer Builder · Jogador';
  private readonly form: FormList;
  private readonly preview: HTMLElement;

  constructor(
    private draft: PlayerBuild,
    private readonly options: CreatePlayerOptions,
  ) {
    this.root = el('div', 'mn-screen');
    const grid = el('div', 'cp', this.root);
    const left = el('section', 'cp-col', grid);
    el('h1', 'mn-h1', left, 'Seu jogador');
    el('p', 'mn-sub', left, 'Nome, posição e número. O corpo vem a seguir.');
    this.form = new FormList(
      left,
      [
        { kind: 'text', key: 'first', label: 'Nome', get: () => this.draft.firstName, set: (v) => (this.draft.firstName = v) },
        { kind: 'text', key: 'last', label: 'Sobrenome', get: () => this.draft.lastName, set: (v) => (this.draft.lastName = v) },
        {
          kind: 'step',
          key: 'pos',
          label: 'Posição',
          get: () => Positions[this.draft.position].full,
          sub: () => Positions[this.draft.position].label,
          step: (dir) => {
            const position = cycle(PositionOrder, this.draft.position, dir);
            // Posição nova: corpo padrão dela (a faixa de altura muda) e atributos dentro dos novos limites.
            this.draft = fitToBody({ ...this.draft, position, body: defaultBody(position) });
          },
          note: () => 'Define a faixa de altura e os limites de cada atributo',
        },
        {
          kind: 'step',
          key: 'hand',
          label: 'Mão',
          get: () => (this.draft.hand === 'r' ? 'Destro' : 'Canhoto'),
          step: () => (this.draft.hand = this.draft.hand === 'r' ? 'l' : 'r'),
        },
        {
          kind: 'step',
          key: 'jersey',
          label: 'Número da camisa',
          get: () => String(this.draft.jersey),
          step: (dir) => (this.draft.jersey = (this.draft.jersey + dir + 100) % 100),
        },
        {
          kind: 'step',
          key: 'country',
          label: 'País',
          get: () => Countries.find(([c]) => c === this.draft.country)?.[1] ?? this.draft.country,
          step: (dir) => {
            const codes = Countries.map(([c]) => c);
            this.draft.country = cycle(codes, codes.includes(this.draft.country) ? this.draft.country : 'BR', dir);
          },
        },
        { kind: 'cta', key: 'next', label: 'Continuar', run: () => this.next() },
      ],
      () => this.renderPreview(),
    );
    el('div', '', grid);
    const right = el('aside', 'cp-col', grid);
    right.style.justifyContent = 'center';
    this.preview = el('div', 'mm-card', right);
  }

  hints(): readonly MenuHint[] {
    return [
      { key: 'dpad', label: 'Navegar / trocar' },
      { key: 'a', label: 'Editar / continuar' },
      { key: 'b', label: 'Voltar' },
    ];
  }

  enter(): void {
    this.form.refresh();
    this.renderPreview();
  }

  leave(): void {}

  body(): PlayerBuild['body'] {
    return this.draft.body;
  }

  look(): PlayerBuild['look'] {
    return this.draft.look;
  }

  nav(action: NavAction): void {
    if (action === 'back') return this.options.onBack();
    this.form.nav(action);
  }

  private next(): void {
    if (!this.draft.firstName.trim() && !this.draft.lastName.trim()) this.draft.lastName = 'Jogador';
    this.options.onNext(this.draft);
  }

  private renderPreview(): void {
    const d = this.draft;
    this.preview.replaceChildren();
    el('h3', '', this.preview, 'CARTÃO DO JOGADOR');
    el('div', 'name', this.preview, `${d.firstName} ${d.lastName}`.trim() || 'Sem nome');
    el('div', 'arch', this.preview, `${Positions[d.position].full} · #${d.jersey}`);
    const facts = el('div', 'facts', this.preview);
    for (const [k, v] of [
      ['POS', Positions[d.position].label],
      ['MÃO', d.hand === 'r' ? 'DIR' : 'ESQ'],
      ['PAÍS', d.country],
    ] as const) {
      const f = el('div', '', facts);
      el('span', '', f, k);
      el('b', '', f, v);
    }
  }
}
