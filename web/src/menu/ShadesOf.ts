// Fim do builder ("Shades Of" do 2K): os 3 jogadores com o perfil mais parecido com a build, o nome do arquétipo
// ("VOCÊ CRIOU UM: …") e as ações: salvar e jogar o Freestyle, testar sem salvar, editar ou voltar às builds.
import { type MenuHint, type MenuScreen, type NavAction, el } from './MenuScreen';
import { AttributeGroups, type PlayerBuild, displayName } from '../build/PlayerBuild';
import { archetypeName, groupScores, overall, shadesOf } from '../build/BuildRules';

export interface ShadesOfOptions {
  onPlay: (build: PlayerBuild) => void;
  onTest: (build: PlayerBuild) => void;
  onEdit: (build: PlayerBuild) => void;
  onBuilds: (build: PlayerBuild) => void;
}

const Actions = [
  { id: 'play', label: 'Salvar e jogar' },
  { id: 'test', label: 'Testar build' },
  { id: 'edit', label: 'Editar build' },
  { id: 'builds', label: 'Voltar às builds' },
] as const;

export class ShadesOf implements MenuScreen {
  readonly root: HTMLElement;
  readonly crumb = 'MyPlayer Builder · Shades Of';
  private readonly buttons: HTMLButtonElement[] = [];
  private index = 0;

  constructor(
    private readonly build: PlayerBuild,
    private readonly options: ShadesOfOptions,
  ) {
    this.root = el('div', 'mn-screen');
    const grid = el('div', 'so', this.root);
    const left = el('section', 'so-left', grid);
    const title = el('h1', 'so-title', left);
    title.append('Shades ', Object.assign(document.createElement('i'), { textContent: 'of:' }));
    const list = el('div', '', left);
    for (const shade of shadesOf(build)) {
      const row = el('div', 'so-shade', list);
      const mono = el('div', 'so-mono', row, shade.name.split(' ').map((w) => w[0]).join('').slice(0, 2));
      mono.style.setProperty('--c', shade.color);
      const t = el('div', '', row);
      el('b', '', t, shade.name);
      const tag = el('span', '', t, shade.tag);
      el('em', '', tag, `${shade.match}% parecido`);
    }
    el('div', 'so-built', left, 'VOCÊ CRIOU UM:');
    el('div', 'so-arch', left, archetypeName(build));
    const actions = el('div', 'so-actions', left);
    Actions.forEach((a, i) => {
      const b = el('button', 'so-act', actions, a.label);
      b.addEventListener('mouseenter', () => this.select(i));
      b.addEventListener('click', () => this.run(i));
      this.buttons.push(b);
    });
    el('div', '', grid);
    const right = el('aside', 'so-right', grid);
    const card = el('div', 'mm-card', right);
    el('h3', '', card, 'OVERALL');
    el('div', 'name', card, `${overall(build)} · ${displayName(build)}`);
    const scores = groupScores(build);
    for (const g of AttributeGroups) {
      const s = el('div', 'so-stat', right);
      s.style.setProperty('--g', g.color);
      el('span', '', s, g.label);
      el('b', '', s, String(scores[g.id]));
    }
  }

  hints(): readonly MenuHint[] {
    return [
      { key: 'dpad', label: 'Navegar' },
      { key: 'a', label: 'Selecionar' },
      { key: 'b', label: 'Editar build' },
    ];
  }

  enter(): void {
    this.select(0);
  }

  leave(): void {}

  body(): PlayerBuild['body'] {
    return this.build.body;
  }

  look(): PlayerBuild['look'] {
    return this.build.look;
  }

  nav(action: NavAction): void {
    const n = this.buttons.length;
    if (action === 'left' || action === 'up') this.select((this.index - 1 + n) % n);
    else if (action === 'right' || action === 'down') this.select((this.index + 1) % n);
    else if (action === 'confirm') this.run(this.index);
    else if (action === 'back') this.options.onEdit(this.build);
  }

  private select(i: number): void {
    this.index = i;
    this.buttons.forEach((b, k) => b.classList.toggle('on', k === i));
  }

  private run(i: number): void {
    const id = Actions[i]!.id;
    if (id === 'play') this.options.onPlay(this.build);
    else if (id === 'test') this.options.onTest(this.build);
    else if (id === 'edit') this.options.onEdit(this.build);
    else this.options.onBuilds(this.build);
  }
}
