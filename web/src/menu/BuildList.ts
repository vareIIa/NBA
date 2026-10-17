// "Meu Jogador": "Criar nova build" no topo e as builds de todo mundo (como a lista de builds do MyPlayer Builder do
// 2K, docs/23 §6): primeiro as suas, depois a padrão (Cardoso 2K, que nunca sai da lista) e as dos outros jogadores,
// que chegam do catálogo online. Escolher uma build abre as ações dela: jogar o Freestyle com ela, editar (as dos outros
// e a padrão viram uma cópia sua) e excluir (só as suas). Sem servidor, a lista mostra o que está salvo neste navegador.
import { type MenuHint, type MenuScreen, type NavAction, el } from './MenuScreen';
import { type PlayerBuild, Positions, displayName, formatFeet, newBuildId } from '../build/PlayerBuild';
import { archetypeName, newDraft, overall } from '../build/BuildRules';
import { type BuildOrigin, BuildSave, type SyncResult } from '../build/BuildSave';

export interface BuildListOptions {
  onBack: () => void;
  onPlay: (build: PlayerBuild) => void;
  onCreate: (draft: PlayerBuild) => void;
  onEdit: (build: PlayerBuild) => void;
  /** A build ativa mudou (o chip do topo atualiza). */
  onChanged: () => void;
}

type Action = 'play' | 'edit' | 'copy' | 'delete';
const ActionLabels: Record<Action, string> = {
  play: 'Jogar Freestyle',
  edit: 'Editar build',
  copy: 'Copiar e editar',
  delete: 'Excluir build',
};
const SectionLabels: Record<BuildOrigin, string> = { mine: 'Suas builds', default: 'Build padrão', shared: 'Da galera' };
const OriginNotes: Record<BuildOrigin, string> = {
  mine: 'Criada por você: aparece para todos os jogadores.',
  default: 'A build padrão do jogo. Editar cria uma cópia sua.',
  shared: 'Criada por outro jogador. Editar cria uma cópia sua.',
};

export class BuildList implements MenuScreen {
  readonly root: HTMLElement;
  readonly crumb = 'Meu Jogador';
  private readonly listEl: HTMLElement;
  private readonly status: HTMLElement;
  private readonly detail: HTMLElement;
  private builds: PlayerBuild[] = [];
  private origins: BuildOrigin[] = [];
  private items: HTMLElement[] = [];
  /** 0 = "Criar nova build"; 1… = as builds. */
  private index = 0;
  /** Foco nas ações da build escolhida (null = foco na lista). */
  private actionIndex: number | null = null;
  private confirmDelete = false;
  private open = false;
  private sync: SyncResult | null = null;

  constructor(private readonly options: BuildListOptions) {
    this.root = el('div', 'mn-screen');
    const grid = el('div', 'bl', this.root);
    const left = el('section', 'cp-col', grid);
    el('h1', 'mn-h1', left, 'Meu Jogador');
    el('p', 'mn-sub', left, 'Escolha a build do Freestyle ou crie uma nova. As builds são de todos: a sua aparece para os outros jogadores.');
    this.status = el('div', 'bl-status', left);
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
    this.open = true;
    this.load(BuildSave.active().id);
    this.actionIndex = null;
    this.confirmDelete = false;
    this.sync = null;
    this.render();
    // As builds dos outros chegam depois (nunca trava o menu); a escolha fica na mesma build.
    void BuildSave.sync().then((result) => {
      if (!this.open) return;
      this.sync = result;
      this.load(this.selected()?.id ?? null);
      this.render();
    });
  }

  leave(): void {
    this.open = false;
  }

  body(): PlayerBuild['body'] | null {
    return this.selected()?.body ?? null;
  }

  look(): PlayerBuild['look'] | null {
    return this.selected()?.look ?? null;
  }

  nav(action: NavAction): void {
    const count = this.builds.length + 1; // + "Criar nova build"
    if (this.actionIndex === null) {
      if (action === 'up') this.index = (this.index - 1 + count) % count;
      else if (action === 'down') this.index = (this.index + 1) % count;
      else if (action === 'back') return this.options.onBack();
      else if (action === 'confirm' || action === 'right') {
        if (this.index === 0) return this.options.onCreate(newDraft('PG'));
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

  /** Recarrega a lista e põe a seleção na build `id` (ou no topo). */
  private load(id: string | null): void {
    this.builds = BuildSave.list();
    this.origins = this.builds.map((b) => BuildSave.origin(b.id));
    const i = id ? this.builds.findIndex((b) => b.id === id) : -1;
    this.index = i >= 0 ? i + 1 : 0;
  }

  private selected(): PlayerBuild | undefined {
    return this.index > 0 ? this.builds[this.index - 1] : undefined;
  }

  private selectedOrigin(): BuildOrigin | undefined {
    return this.index > 0 ? this.origins[this.index - 1] : undefined;
  }

  private actions(): Action[] {
    return this.selectedOrigin() === 'mine' ? ['play', 'edit', 'delete'] : ['play', 'copy'];
  }

  private run(action: Action): void {
    const b = this.selected();
    if (!b) return;
    if (action === 'play') return this.options.onPlay(b);
    if (action === 'edit') return this.options.onEdit(b);
    if (action === 'copy') return this.options.onEdit({ ...b, id: newBuildId(), createdAt: Date.now() });
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
    this.renderStatus();
    this.listEl.replaceChildren();
    this.items = [];
    const add = el('button', `bl-item new${this.index === 0 ? ' on' : ''}`, this.listEl);
    el('div', 'ovr', add, '+');
    const t = el('div', 't', add);
    el('b', '', t, 'Criar nova build');
    el('span', '', t, 'Jogador, corpo, atributos e Shades Of');
    el('span', 'act', add, '');
    add.addEventListener('click', () => this.options.onCreate(newDraft('PG')));
    this.items.push(add);

    const active = BuildSave.active().id;
    let section: BuildOrigin | null = null;
    this.builds.forEach((b, i) => {
      const origin = this.origins[i]!;
      if (origin !== section) {
        section = origin;
        const count = this.origins.filter((o) => o === origin).length;
        el('div', 'bl-head', this.listEl, origin === 'default' ? SectionLabels[origin] : `${SectionLabels[origin]} · ${count}`);
      }
      const item = el('button', `bl-item${i + 1 === this.index ? ' on' : ''}`, this.listEl);
      el('div', 'ovr', item, String(overall(b)));
      const t = el('div', 't', item);
      el('b', '', t, displayName(b));
      el('span', '', t, `${Positions[b.position].label} · ${formatFeet(b.body.heightCm)} · ${archetypeName(b)}`);
      el('span', 'act', item, b.id === active ? 'ATIVA' : '');
      item.addEventListener('click', () => {
        this.index = i + 1;
        this.actionIndex = 0;
        this.confirmDelete = false;
        this.render();
      });
      this.items.push(item);
    });
    this.items[this.index]?.scrollIntoView({ block: 'nearest' });
    this.renderDetail();
  }

  private renderStatus(): void {
    const s = this.sync;
    this.status.className = `bl-status${s ? (s.online ? ' online' : ' offline') : ''}`;
    this.status.textContent = !s
      ? 'Buscando as builds da galera…'
      : s.online
        ? `Online · ${s.others} ${s.others === 1 ? 'build' : 'builds'} da galera`
        : 'Sem conexão com o servidor: mostrando as builds deste navegador';
  }

  private renderDetail(): void {
    this.detail.replaceChildren();
    const b = this.selected();
    const origin = this.selectedOrigin();
    if (!b || !origin) return;
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
    el('p', `bl-origin ${origin}`, card, OriginNotes[origin]);
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
