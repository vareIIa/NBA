// "Meu Jogador": as builds salvas (como a lista de builds do MyPlayer Builder do 2K), mais "Criar nova build".
// Escolher uma build abre as ações dela (jogar o Freestyle com ela, editar, excluir). Sem nenhuma salva, a lista mostra
// a build padrão (não dá para excluir; editar cria uma cópia).
import { type MenuHint, type MenuScreen, type NavAction, el } from './MenuScreen';
import { type PlayerBuild, Positions, displayName, formatFeet, newBuildId } from '../build/PlayerBuild';
import { DefaultBuild, archetypeName, newDraft, overall } from '../build/BuildRules';
import { BuildSave } from '../build/BuildSave';

export interface BuildListOptions {
  onBack: () => void;
  onPlay: (build: PlayerBuild) => void;
  onCreate: (draft: PlayerBuild) => void;
  onEdit: (build: PlayerBuild) => void;
  /** A build ativa mudou (o chip do topo atualiza). */
  onChanged: () => void;
}

type Action = 'play' | 'edit' | 'delete';
const ActionLabels: Record<Action, string> = { play: 'Jogar Freestyle', edit: 'Editar build', delete: 'Excluir build' };

export class BuildList implements MenuScreen {
  readonly root: HTMLElement;
  readonly crumb = 'Meu Jogador';
  private readonly listEl: HTMLElement;
  private readonly detail: HTMLElement;
  private builds: PlayerBuild[] = [];
  private index = 0;
  /** Foco nas ações da build escolhida (null = foco na lista). */
  private actionIndex: number | null = null;
  private confirmDelete = false;

  constructor(private readonly options: BuildListOptions) {
    this.root = el('div', 'mn-screen');
    const grid = el('div', 'bl', this.root);
    const left = el('section', 'cp-col', grid);
    el('h1', 'mn-h1', left, 'Meu Jogador');
    el('p', 'mn-sub', left, 'Escolha a build do Freestyle ou crie uma nova.');
    this.listEl = el('div', 'bl-list', left);
    el('div', '', grid);
    this.detail = el('aside', 'cp-col', grid);
  }

  hints(): readonly MenuHint[] {
    return [
      { key: 'dpad', label: 'Navegar' },
      { key: 'a', label: 'Selecionar' },
      { key: 'b', label: 'Voltar' },
    ];
  }

  enter(): void {
    const saved = BuildSave.list();
    this.builds = saved.length ? saved : [DefaultBuild];
    const active = BuildSave.active().id;
    this.index = Math.max(0, this.builds.findIndex((b) => b.id === active));
    this.actionIndex = null;
    this.render();
  }

  leave(): void {}

  body(): PlayerBuild['body'] | null {
    return this.builds[this.index]?.body ?? null;
  }

  nav(action: NavAction): void {
    const count = this.builds.length + 1; // + "Criar nova build"
    if (this.actionIndex === null) {
      if (action === 'up') this.index = (this.index - 1 + count) % count;
      else if (action === 'down') this.index = (this.index + 1) % count;
      else if (action === 'back') return this.options.onBack();
      else if (action === 'confirm' || action === 'right') {
        if (this.index === this.builds.length) return this.options.onCreate(newDraft('PG'));
        this.actionIndex = 0;
      } else return;
    } else {
      const actions = this.actions();
      if (action === 'up') this.actionIndex = (this.actionIndex - 1 + actions.length) % actions.length;
      else if (action === 'down') this.actionIndex = (this.actionIndex + 1) % actions.length;
      else if (action === 'back' || action === 'left') this.actionIndex = null;
      else if (action === 'confirm') return this.run(actions[this.actionIndex]!);
      else return;
      this.confirmDelete = false;
    }
    this.render();
  }

  private actions(): Action[] {
    const b = this.builds[this.index];
    return b && b.id !== DefaultBuild.id ? ['play', 'edit', 'delete'] : ['play', 'edit'];
  }

  private run(action: Action): void {
    const b = this.builds[this.index]!;
    if (action === 'play') return this.options.onPlay(b);
    if (action === 'edit') return this.options.onEdit(b.id === DefaultBuild.id ? { ...b, id: newBuildId(), createdAt: Date.now() } : b);
    if (!this.confirmDelete) {
      this.confirmDelete = true; // 1º A: pede confirmação; 2º A: exclui
      this.render();
      return;
    }
    BuildSave.remove(b.id);
    this.options.onChanged();
    this.enter();
  }

  private render(): void {
    this.listEl.replaceChildren();
    const active = BuildSave.active().id;
    this.builds.forEach((b, i) => {
      const item = el('button', `bl-item${i === this.index ? ' on' : ''}`, this.listEl);
      el('div', 'ovr', item, String(overall(b)));
      const t = el('div', 't', item);
      el('b', '', t, displayName(b));
      el('span', '', t, `${Positions[b.position].label} · ${formatFeet(b.body.heightCm)} · ${archetypeName(b)}`);
      el('span', 'act', item, b.id === active ? 'ATIVA' : '');
      item.addEventListener('click', () => {
        this.index = i;
        this.actionIndex = 0;
        this.render();
      });
    });
    const add = el('button', `bl-item new${this.index === this.builds.length ? ' on' : ''}`, this.listEl);
    el('div', 'ovr', add, '+');
    const t = el('div', 't', add);
    el('b', '', t, 'Criar nova build');
    el('span', '', t, 'Jogador, corpo, atributos e Shades Of');
    el('span', 'act', add, '');
    add.addEventListener('click', () => this.options.onCreate(newDraft('PG')));
    this.listEl.children[this.index]?.scrollIntoView({ block: 'nearest' });
    this.renderDetail();
  }

  private renderDetail(): void {
    this.detail.replaceChildren();
    const b = this.builds[this.index];
    if (!b) return;
    const card = el('div', 'mm-card', this.detail);
    el('h3', '', card, `${Positions[b.position].full.toUpperCase()} · #${b.jersey}`);
    el('div', 'name', card, displayName(b));
    el('div', 'arch', card, archetypeName(b));
    const facts = el('div', 'facts', card);
    for (const [k, v] of [
      ['OVR', String(overall(b))],
      ['ALTURA', formatFeet(b.body.heightCm)],
      ['ENVERG.', formatFeet(b.body.wingspanCm)],
    ] as const) {
      const d = el('div', '', facts);
      el('span', '', d, k);
      el('b', '', d, v);
    }
    const actions = el('div', 'bl-actions', this.detail);
    this.actions().forEach((a, i) => {
      const label = a === 'delete' && this.confirmDelete ? 'Confirmar exclusão' : ActionLabels[a];
      const btn = el('button', `bl-act${a === 'delete' ? ' danger' : ''}${i === this.actionIndex ? ' on' : ''}`, actions, label);
      btn.addEventListener('click', () => {
        this.actionIndex = i;
        this.run(a);
      });
    });
  }
}
