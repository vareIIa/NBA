// Tela de atributos do MyPlayer Builder, no estilo das telas do 2K (docs/23-myplayer-builder.md):
//  - à esquerda, no topo, o medidor "Potencial restante" (o "Remaining Attribute Potential" do 2K26); embaixo, a
//    tabela ATRIBUTO | ATUAL | barra | MÁX com as faixas coloridas por grupo, a descrição do atributo escolhido e o
//    botão "Terminar build";
//  - no meio, o jogador 3D (o showroom; a tela deixa o meio livre);
//  - à direita, no topo, OVR e arquétipo ao vivo; embaixo, FÍSICO (medidores em semicírculo), BADGE UPGRADES (um
//    escudo por categoria) e o botão de presets.
// ←→ mudam ±1 (com o cap do corpo e o orçamento de BuildRules) e, segurados, aceleram (2, 4, 8 por repetição); ↑↓
// andam, LB/RB pulam de grupo, Y abre os presets (com a prévia na tabela: deltas verdes e vermelhos, como no MP
// Builder), A no botão termina. Mouse: ◀ ▶ (segurar acelera igual), arrastar a barra até o valor, clique nos botões.
// A lógica sem DOM está em BuilderModel.ts; os presets, em BuilderPresets.ts.
import './builder.css';
import { type MenuHint, type MenuScreen, type NavAction, el } from '../MenuScreen';
import {
  AttrCeil,
  type AttributeGroupId,
  AttributeGroups,
  AttributeInfos,
  type AttributeId,
  type Attributes,
  type PlayerBuild,
  Positions,
  formatFeet,
  formatWeight,
} from '../../build/PlayerBuild';
import {
  AttrStart,
  archetypeName,
  attributeCaps,
  badgePoints,
  buildPoints,
  groupScores,
  overall,
  pointsLeft,
} from '../../build/BuildRules';
import type { BadgeCategory } from '../../sim';
import { BuildPresets, presetAttrs } from './BuilderPresets';
import {
  FinishRow,
  GroupStarts,
  RowAttrs,
  type StepResult,
  attrDeltas,
  copyBuild,
  holdSteps,
  moveRow,
  nextCost,
  raiseBlock,
  remainingShare,
  setAttributeTo,
  stepAttributeBy,
} from './BuilderModel';

export interface BuilderOptions {
  /** Rascunho com identidade e corpo já definidos. A tela devolve uma cópia alterada (não muda o objeto recebido). */
  build: PlayerBuild;
  /** Voltar à tela de corpo (com os atributos como estão). */
  onBack: (build: PlayerBuild) => void;
  /** Terminou: vai para o Shades Of. */
  onDone: (build: PlayerBuild) => void;
  /** A cada mudança de atributo (opcional: overall ao vivo fora da tela). */
  onChange?: (build: PlayerBuild) => void;
}

const SvgNs = 'http://www.w3.org/2000/svg';
/** Segurar ◀ ▶ com o mouse: espera antes de repetir e intervalo da repetição (ms, relógio de verdade: o dt do fluxo
 *  é limitado a 0,1 s por quadro e atrasaria a repetição com a tela lenta). */
const HoldDelay = 380;
const HoldEvery = 55;
/** ←→ do teclado ou do controle: repetições com menos que isto entre si são o mesmo "segurar" (o controle espera
 *  0,4 s antes de repetir; soltar a tecla ou o direcional encerra antes). */
const StreakGap = 600;
const HorizontalKeys = new Set(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD']);

/** Medidores do FÍSICO, na ordem do print (Speed, Strength / Acceleration, Vertical), com a cor de cada arco. */
const Gauges: ReadonlyArray<readonly [AttributeId, string]> = [
  ['speed', '#8a4bdc'],
  ['strength', '#3d6fe0'],
  ['acceleration', '#a65cf0'],
  ['vertical', '#d946c8'],
];

/** BADGE UPGRADES: categoria de badge → faixa de atributos com a mesma cor. */
const BadgeRows: ReadonlyArray<readonly [BadgeCategory, AttributeGroupId]> = [
  ['Finishing', 'finishing'],
  ['Shooting', 'shooting'],
  ['Playmaking', 'playmaking'],
  ['Defense', 'defense'],
];

const groupOf = (id: AttributeGroupId) => AttributeGroups.find((g) => g.id === id)!;
const pct = (v: number): string => `${(Math.max(0, v) / AttrCeil) * 100}%`;
const fmtInt = (n: number): string => Math.round(n).toLocaleString('pt-BR');

/** Reinicia uma animação de CSS (a classe sai e volta no mesmo quadro). */
function pulse(node: Element, cls: string): void {
  node.classList.remove(cls);
  void (node as HTMLElement).offsetWidth;
  node.classList.add(cls);
}

/** Número que corre até o valor novo ("número subindo"); diferenças de 1 trocam na hora. */
class Counter {
  private shown: number;
  private target: number;

  constructor(
    private readonly node: HTMLElement,
    start: number,
    private readonly fmt: (n: number) => string = (n) => String(Math.round(n)),
  ) {
    this.shown = this.target = start;
    node.textContent = fmt(start);
  }

  set(value: number): void {
    this.target = value;
    if (Math.abs(value - this.shown) <= 1) this.snap();
  }

  /** Mostra o valor final já (sem quadros: aba escondida, tela lenta). */
  snap(): void {
    if (this.shown === this.target) return;
    this.shown = this.target;
    this.node.textContent = this.fmt(this.target);
  }

  tick(dt: number): void {
    if (this.shown === this.target) return;
    const next = this.shown + (this.target - this.shown) * (1 - Math.exp(-dt * 11));
    this.shown = Math.abs(this.target - next) < 0.5 ? this.target : next;
    this.node.textContent = this.fmt(this.shown);
  }
}

interface RowView {
  id: AttributeId;
  root: HTMLElement;
  num: Counter;
  cap: HTMLElement;
  fill: HTMLElement;
  max: HTMLElement;
  delta: HTMLElement;
}

interface GaugeView {
  id: AttributeId;
  root: HTMLElement;
  cap: SVGPathElement;
  value: SVGPathElement;
  num: Counter;
}

export class BuilderView implements MenuScreen {
  readonly root: HTMLElement;
  readonly crumb = 'MyPlayer Builder · Atributos';
  readonly showroomOffset = 0;
  private build: PlayerBuild;
  private readonly caps: Attributes;
  private readonly total: number;
  private row = 0;
  /** Último "não dá" (teto ou pontos) na linha escolhida: aparece em vermelho na descrição. */
  private notice: { row: number; reason: 'cap' | 'points' } | null = null;
  /** Segurando ◀ ▶ com o mouse. */
  private hold: { dir: -1 | 1; start: number; next: number } | null = null;
  /** Segurando ←→ no teclado ou no controle (as repetições vêm do fluxo; aqui só se mede há quanto tempo). */
  private streak: { dir: -1 | 1; row: number; start: number; last: number } | null = null;
  private readonly keysHeld = new Set<string>();
  /** Arrastando a barra de uma linha com o mouse. */
  private drag: { index: number; track: HTMLElement } | null = null;
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (HorizontalKeys.has(e.code)) this.keysHeld.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (!HorizontalKeys.has(e.code)) return;
    this.keysHeld.delete(e.code);
    if (!this.keysHeld.size) this.streak = null;
  };
  private readonly onBlur = (): void => {
    this.keysHeld.clear();
    this.streak = null;
  };
  private presetOpen = false;
  private presetIndex = 0;
  private readonly presetCache = new Map<number, Attributes>();
  private readonly counters: Counter[] = [];
  /** Garante os números finais mesmo sem update() (o fluxo roda no requestAnimationFrame, que para com a aba oculta). */
  private settle = 0;
  private lastOvr = -1;
  private lastBadges: Partial<Record<BadgeCategory, number>> = {};

  private readonly table: HTMLElement;
  private readonly rows: RowView[] = [];
  private readonly bands: Array<{ id: AttributeGroupId; score: Counter }> = [];
  private readonly ovrBox: HTMLElement;
  private readonly ovr: Counter;
  private readonly arch: HTMLElement;
  private readonly pot: HTMLElement;
  private readonly potLeft: Counter;
  private readonly potFill: HTMLElement;
  private readonly descTitle: HTMLElement;
  private readonly descText: HTMLElement;
  private readonly descRange: HTMLElement;
  private readonly descCost: HTMLElement;
  private readonly finish: HTMLButtonElement;
  private readonly gauges: GaugeView[] = [];
  private readonly badges: Array<{ cat: BadgeCategory; group: AttributeGroupId; root: HTMLElement; num: Counter }> = [];
  private readonly presetLayer: HTMLElement;
  private readonly presetItems: Array<{ root: HTMLElement; ovr: HTMLElement }> = [];

  constructor(private readonly options: BuilderOptions) {
    this.build = copyBuild(options.build);
    this.caps = attributeCaps(this.build.position, this.build.body);
    this.total = buildPoints(this.build);

    this.root = el('div', 'mn-screen bd');
    const grid = el('div', 'bd-grid', this.root);

    // ---------------------------------------------------------------- esquerda: potencial, tabela, descrição, terminar
    const left = el('section', 'bd-left', grid);
    this.pot = el('header', 'bd-pot', left);
    el('h1', 'bd-title', this.pot, 'Atributos');
    const potVal = el('div', 'v', this.pot);
    el('span', 'k', potVal, 'Potencial restante');
    this.potLeft = this.counter(el('b', '', potVal), this.total, fmtInt);
    el('small', '', potVal, ` / ${fmtInt(this.total)}`);
    this.potFill = el('i', '', el('div', 'bd-pot-bar', this.pot));

    this.table = el('div', 'bd-table', left);
    const thead = el('div', 'bd-thead', this.table);
    for (const t of ['Atributo', 'Atual', '', 'Máx', '']) el('span', '', thead, t);
    let i = 0;
    for (const group of AttributeGroups) {
      const band = el('button', 'bd-band', this.table);
      band.style.setProperty('--g', group.color);
      el('span', 'l', band, group.label);
      const score = this.counter(el('span', 's', band), Math.round(group.attrs.reduce((s, a) => s + AttrStart[a], 0) / group.attrs.length));
      this.bands.push({ id: group.id, score });
      const start = RowAttrs.indexOf(group.attrs[0]!);
      band.addEventListener('click', () => !this.presetOpen && this.select(start));
      for (const attr of group.attrs) this.rows.push(this.makeRow(attr, group.color, i++));
    }

    const desc = el('div', 'bd-desc', left);
    this.descTitle = el('b', '', desc);
    this.descText = el('p', '', desc);
    const foot = el('div', 'f', desc);
    this.descRange = el('span', '', foot);
    this.descCost = el('span', 'c', foot);

    const actions = el('div', 'bd-actions', left);
    this.finish = el('button', 'bd-finish', actions);
    el('span', '', this.finish, 'Terminar build');
    el('small', '', this.finish, 'Shades Of ▸');
    this.finish.addEventListener('pointermove', () => !this.presetOpen && this.select(FinishRow));
    this.finish.addEventListener('click', () => !this.presetOpen && this.done());

    // ---------------------------------------------------------------- meio livre (jogador 3D)
    el('div', 'bd-mid', grid);

    // ---------------------------------------------------------------- direita: físico, badges, presets
    const right = el('aside', 'bd-right', grid);
    const top = el('section', 'bd-card bd-top', right);
    this.ovrBox = el('div', 'bd-ovr', top);
    el('span', 'k', this.ovrBox, 'OVR');
    this.ovr = this.counter(el('b', '', this.ovrBox), 40);
    const id = el('div', 'bd-id', top);
    el('span', 'k', id, 'Arquétipo');
    this.arch = el('div', 'bd-arch', id);
    const b = this.build;
    el('div', 'bd-who', id, `${Positions[b.position].full} · ${formatFeet(b.body.heightCm)} · ${formatWeight(b.body.weightKg)}`);

    const phys = el('section', 'bd-card', right);
    el('h3', '', phys, 'Físico');
    const gaugeGrid = el('div', 'bd-gauges', phys);
    for (const [attr, color] of Gauges) this.gauges.push(this.makeGauge(gaugeGrid, attr, color));

    const badgeCard = el('section', 'bd-card', right);
    el('h3', '', badgeCard, 'Badge upgrades');
    for (const [cat, groupId] of BadgeRows) {
      const g = groupOf(groupId);
      const row = el('div', 'bd-badge', badgeCard);
      row.style.setProperty('--g', g.color);
      const shield = el('div', 'bd-shield', row);
      const num = this.counter(el('b', '', el('div', 'in', shield)), 0);
      el('span', 'l', row, g.label);
      this.badges.push({ cat, group: groupId, root: row, num });
    }

    const presetBtn = el('button', 'bd-preset-btn', right);
    el('span', 'mn-btn y', presetBtn, 'Y');
    el('span', '', presetBtn, 'Presets');
    el('small', '', presetBtn, 'Tab');
    presetBtn.addEventListener('click', () => this.openPresets());

    // ---------------------------------------------------------------- presets (por cima do meio)
    this.presetLayer = el('div', 'bd-pre', this.root);
    this.presetLayer.addEventListener('click', (e) => {
      if (e.target === this.presetLayer) this.closePresets();
    });
    const panel = el('div', 'bd-pre-panel', this.presetLayer);
    const ph = el('header', '', panel);
    el('h2', '', ph, 'Presets');
    el('p', '', ph, 'Builds prontas, distribuídas no teto do seu corpo. Dá para ajustar depois.');
    const list = el('div', 'bd-pre-list', panel);
    const items = [...BuildPresets.map((p) => ({ name: p.name, desc: p.desc })), { name: 'Zerar atributos', desc: 'Volta tudo ao começo (25; a resistência fica em 85).' }];
    items.forEach((item, k) => {
      const node = el('button', `bd-pre-item${k === BuildPresets.length ? ' reset' : ''}`, list);
      const t = el('span', 't', node);
      el('b', '', t, item.name);
      el('span', '', t, item.desc);
      const ovr = el('em', '', node);
      node.addEventListener('pointermove', () => this.previewPreset(k));
      node.addEventListener('click', () => {
        this.previewPreset(k);
        this.applyPreset();
      });
      this.presetItems.push({ root: node, ovr });
    });
    const pf = el('footer', '', panel);
    for (const [key, cls, label] of [
      ['A', 'a', 'Aplicar'],
      ['B', 'b', 'Fechar'],
    ] as const) {
      const h = el('span', 'mn-hint', pf);
      el('span', `mn-btn ${cls}`, h, key);
      el('span', '', h, label);
    }
  }

  hints(): readonly MenuHint[] {
    return [
      { key: 'dpad', label: 'Ajustar' },
      { key: 'lb', label: 'Grupo anterior' },
      { key: 'rb', label: 'Próximo grupo' },
      { key: 'y', label: 'Presets' },
      { key: 'a', label: 'Terminar build' },
      { key: 'b', label: 'Voltar' },
    ];
  }

  enter(): void {
    // Captura, como o fluxo (que para a propagação na janela): soltar ←→ encerra a aceleração.
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    this.refresh();
  }

  leave(): void {
    this.hold = null;
    this.streak = null;
    this.drag = null;
    this.keysHeld.clear();
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    clearTimeout(this.settle);
  }

  body(): PlayerBuild['body'] {
    return this.build.body;
  }

  look(): PlayerBuild['look'] {
    return this.build.look;
  }

  update(dt: number): void {
    for (const c of this.counters) c.tick(dt);
    if (this.streak && !this.horizontalHeld()) this.streak = null;
    if (!this.hold) return;
    const now = performance.now();
    while (this.hold && now >= this.hold.next) {
      this.hold.next += HoldEvery;
      if (!this.step(this.hold.dir, holdSteps(now - this.hold.start))) this.hold = null;
    }
  }

  nav(action: NavAction): void {
    if (this.presetOpen) return this.navPresets(action);
    switch (action) {
      case 'up':
      case 'down':
      case 'prevTab':
      case 'nextTab':
        return this.select(moveRow(this.row, action));
      case 'left':
      case 'right': {
        if (this.row >= FinishRow) return;
        const dir = action === 'left' ? -1 : 1;
        const now = performance.now();
        let s = this.streak;
        if (!s || s.dir !== dir || s.row !== this.row || now - s.last > StreakGap) s = this.streak = { dir, row: this.row, start: now, last: now };
        s.last = now;
        this.step(dir, holdSteps(now - s.start));
        return;
      }
      case 'confirm':
        // A num atributo leva ao botão; A no botão termina.
        return this.row === FinishRow ? this.done() : this.select(FinishRow);
      case 'alt':
        return this.openPresets();
      case 'back':
        return this.options.onBack(this.build);
    }
  }

  // ------------------------------------------------------------------ ações

  private select(row: number): void {
    if (row === this.row) return;
    this.row = row;
    this.notice = null;
    this.refresh();
    this.scrollToRow();
  }

  /** `n` pontos (±) no atributo da linha escolhida. Devolve se mudou algo. */
  private step(dir: -1 | 1, n = 1): boolean {
    const id = RowAttrs[this.row];
    return id ? this.apply(stepAttributeBy(this.build, id, dir, n)) : false;
  }

  /** Aplica um passo (setas, mouse, arrastar). Bater no teto ou nos pontos avisa na descrição (e treme uma vez). */
  private apply(r: StepResult): boolean {
    const blocked = r.blocked === 'cap' || r.blocked === 'points' ? r.blocked : null;
    const repeated = blocked !== null && this.notice?.row === this.row && this.notice.reason === blocked;
    this.notice = blocked ? { row: this.row, reason: blocked } : null;
    if (blocked && !repeated && !this.drag) {
      pulse(this.rows[this.row]!.root, 'deny');
      if (blocked === 'points') pulse(this.pot, 'deny');
    }
    if (r.changed) {
      this.build = r.build;
      this.options.onChange?.(this.build);
    }
    if (r.changed || blocked) this.refresh();
    // Mexendo direto (setas, arrastar), o número da linha e o potencial acompanham na hora; a contagem animada fica
    // para os presets e para o OVR, os medidores e os escudos.
    this.rows[this.row]?.num.snap();
    this.potLeft.snap();
    return r.changed;
  }

  /** Arrastando a barra: o valor segue o mouse (0–99 na largura da barra), até onde o cap e os pontos deixam. */
  private dragTo(clientX: number): void {
    const d = this.drag;
    const id = d ? RowAttrs[d.index] : undefined;
    if (!d || !id) return;
    const rect = d.track.getBoundingClientRect();
    const t = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    this.apply(setAttributeTo(this.build, id, t * AttrCeil));
  }

  /** ←→ ainda apertado (tecla ou direcional/analógico do controle, com os mesmos limites do fluxo). */
  private horizontalHeld(): boolean {
    if (this.keysHeld.size) return true;
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
    if (!pad) return false;
    return !!pad.buttons[14]?.pressed || !!pad.buttons[15]?.pressed || Math.abs(pad.axes[0] ?? 0) > 0.5;
  }

  private done(): void {
    this.hold = null;
    this.drag = null;
    this.options.onDone(this.build);
  }

  private openPresets(): void {
    if (this.presetOpen) return;
    this.presetOpen = true;
    this.hold = null;
    this.drag = null;
    this.presetLayer.classList.add('open');
    this.root.classList.add('previewing');
    this.presetItems.forEach((item, k) => (item.ovr.textContent = `OVR ${overall({ ...this.build, attrs: this.presetResult(k) })}`));
    this.refresh();
  }

  private closePresets(): void {
    if (!this.presetOpen) return;
    this.presetOpen = false;
    this.presetLayer.classList.remove('open');
    this.root.classList.remove('previewing');
    this.refresh();
  }

  private navPresets(action: NavAction): void {
    const n = this.presetItems.length;
    if (action === 'up') this.previewPreset((this.presetIndex - 1 + n) % n);
    else if (action === 'down') this.previewPreset((this.presetIndex + 1) % n);
    else if (action === 'confirm') this.applyPreset();
    else if (action === 'back' || action === 'alt') this.closePresets();
  }

  private previewPreset(k: number): void {
    if (k === this.presetIndex) return;
    this.presetIndex = k;
    this.refresh();
  }

  private applyPreset(): void {
    this.build = { ...copyBuild(this.build), attrs: { ...this.presetResult(this.presetIndex) } };
    this.notice = null;
    this.closePresets();
    pulse(this.table, 'applied');
    this.options.onChange?.(this.build);
  }

  /** Atributos do preset k (o último item zera). O corpo não muda nesta tela, então o resultado fica guardado. */
  private presetResult(k: number): Attributes {
    let attrs = this.presetCache.get(k);
    if (!attrs) {
      const preset = BuildPresets[k];
      attrs = preset ? presetAttrs(this.build, preset) : { ...AttrStart };
      this.presetCache.set(k, attrs);
    }
    return attrs;
  }

  // ------------------------------------------------------------------ desenho

  /** A build que a tela mostra: a de verdade, ou a prévia do preset escolhido. */
  private shown(): PlayerBuild {
    return this.presetOpen ? { ...this.build, attrs: this.presetResult(this.presetIndex) } : this.build;
  }

  private refresh(): void {
    const shown = this.shown();
    const deltas = this.presetOpen ? attrDeltas(this.build.attrs, shown.attrs) : {};

    this.rows.forEach((r, i) => {
      const v = shown.attrs[r.id];
      r.num.set(v);
      r.fill.style.width = pct(v);
      r.root.classList.toggle('on', i === this.row);
      r.root.classList.toggle('full', v >= this.caps[r.id]);
      const d = deltas[r.id] ?? 0;
      r.delta.textContent = d ? `${d > 0 ? '+' : ''}${d}` : '';
      r.delta.className = `d${d > 0 ? ' up' : d < 0 ? ' down' : ''}`;
    });
    const scores = groupScores(shown);
    for (const band of this.bands) band.score.set(scores[band.id]);

    const ovr = overall(shown);
    this.ovr.set(ovr);
    if (this.lastOvr >= 0 && ovr !== this.lastOvr) pulse(this.ovrBox, 'bump');
    this.lastOvr = ovr;
    this.arch.textContent = archetypeName(shown);
    const left = pointsLeft(shown);
    this.potLeft.set(left);
    this.potFill.style.width = `${remainingShare(shown, this.total) * 100}%`;
    this.pot.classList.toggle('empty', left < 5);

    const selected = RowAttrs[this.row];
    for (const g of this.gauges) {
      const v = shown.attrs[g.id];
      g.num.set(v);
      g.value.style.strokeDasharray = `${(v / AttrCeil) * 100} 100`;
      g.root.classList.toggle('on', g.id === selected);
    }
    const badges = badgePoints(shown);
    const selGroup = selected ? AttributeInfos[selected].group : null;
    for (const badge of this.badges) {
      const v = badges[badge.cat];
      badge.num.set(v);
      if (this.lastBadges[badge.cat] !== undefined && this.lastBadges[badge.cat] !== v) pulse(badge.root, 'bump');
      this.lastBadges[badge.cat] = v;
      badge.root.classList.toggle('on', badge.group === selGroup);
    }

    clearTimeout(this.settle);
    this.settle = window.setTimeout(() => this.counters.forEach((c) => c.snap()), 900);

    this.finish.classList.toggle('on', this.row === FinishRow);
    this.presetItems.forEach((item, k) => item.root.classList.toggle('on', k === this.presetIndex));
    this.renderDesc(shown);
  }

  private renderDesc(shown: PlayerBuild): void {
    const id = RowAttrs[this.row];
    const desc = this.descTitle.parentElement!;
    if (!id) {
      desc.style.setProperty('--g', 'var(--mn-gold)');
      this.descTitle.textContent = 'Terminar build';
      this.descText.textContent = 'Vai para o Shades Of: o nome do arquétipo e os 3 jogadores com o perfil mais parecido.';
      const left = pointsLeft(shown);
      this.descRange.textContent = `OVR ${overall(shown)}`;
      this.descCost.textContent = left > 0 ? `Ainda sobram ${fmtInt(left)} de potencial` : 'Todo o potencial foi usado';
      this.descCost.className = 'c';
      return;
    }
    const info = AttributeInfos[id];
    desc.style.setProperty('--g', groupOf(info.group).color);
    this.descTitle.textContent = info.label;
    this.descText.textContent = info.desc;
    this.descRange.textContent = `Começo ${AttrStart[id]} · Teto ${this.caps[id]}`;
    const notice = this.notice?.row === this.row ? this.notice.reason : null;
    const cost = nextCost(shown, id);
    const blocked = notice ?? (this.presetOpen ? null : raiseBlock(shown, id));
    if (blocked === 'cap' || cost === null) {
      this.descCost.textContent = 'No teto deste corpo';
      this.descCost.className = `c${notice ? ' bad' : ' max'}`;
    } else if (blocked === 'points') {
      this.descCost.textContent = `Falta potencial: o próximo ponto custa ${cost}`;
      this.descCost.className = 'c bad';
    } else {
      this.descCost.textContent = `Próximo ponto custa ${cost}`;
      this.descCost.className = 'c';
    }
  }

  /** Mantém a linha escolhida visível quando a tabela rola (telas baixas). */
  private scrollToRow(): void {
    const node = this.row === FinishRow ? null : this.rows[this.row]?.root;
    if (!node) return;
    const t = this.table;
    // A faixa do grupo acima da 1ª linha também aparece.
    const top = GroupStarts.includes(this.row) ? node.offsetTop - 30 : node.offsetTop - 4;
    const bottom = node.offsetTop + node.offsetHeight + 4;
    if (top < t.scrollTop) t.scrollTop = top;
    else if (bottom > t.scrollTop + t.clientHeight) t.scrollTop = bottom - t.clientHeight;
  }

  // ------------------------------------------------------------------ construção

  private counter(node: HTMLElement, start: number, fmt?: (n: number) => string): Counter {
    const c = new Counter(node, start, fmt);
    this.counters.push(c);
    return c;
  }

  private makeRow(id: AttributeId, color: string, index: number): RowView {
    const root = el('div', 'bd-row', this.table);
    root.dataset['attr'] = id;
    root.style.setProperty('--g', color);
    root.style.setProperty('--i', String(index));
    el('span', 'n', root, AttributeInfos[id].label);
    const val = el('span', 'v', root);
    const minus = el('button', 'arr', val, '◀');
    const num = this.counter(el('b', '', val), AttrStart[id]);
    const plus = el('button', 'arr', val, '▶');
    // A barra é a área de arrastar (a linha inteira de altura); o desenho fica na trilha dentro dela.
    const bar = el('div', 'bd-bar', root);
    const track = el('div', 'bd-track', bar);
    const cap = el('s', '', track);
    cap.style.width = pct(this.caps[id]);
    const fill = el('i', '', track);
    const max = el('span', 'm', root, String(this.caps[id]));
    const delta = el('span', 'd', root);
    root.addEventListener('pointermove', (e) => {
      if (!this.presetOpen && (e.movementX || e.movementY)) this.select(index);
    });
    root.addEventListener('click', () => !this.presetOpen && this.select(index));
    for (const [btn, dir] of [
      [minus, -1],
      [plus, 1],
    ] as const) {
      btn.addEventListener('pointerdown', (e) => {
        if (this.presetOpen || e.button !== 0) return;
        e.preventDefault();
        this.select(index);
        const now = performance.now();
        this.hold = this.step(dir) ? { dir, start: now, next: now + HoldDelay } : null;
        btn.setPointerCapture?.(e.pointerId);
      });
      const stop = (): void => {
        this.hold = null;
      };
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointercancel', stop);
      btn.addEventListener('lostpointercapture', stop);
    }
    bar.addEventListener('pointerdown', (e) => {
      if (this.presetOpen || e.button !== 0) return;
      e.preventDefault();
      this.select(index);
      this.drag = { index, track };
      root.classList.add('drag');
      bar.setPointerCapture?.(e.pointerId);
      this.dragTo(e.clientX);
    });
    bar.addEventListener('pointermove', (e) => {
      if (this.drag?.index === index) this.dragTo(e.clientX);
    });
    const endDrag = (): void => {
      if (this.drag?.index !== index) return;
      this.drag = null;
      root.classList.remove('drag');
    };
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);
    bar.addEventListener('lostpointercapture', endDrag);
    return { id, root, num, cap, fill, max, delta };
  }

  private makeGauge(parent: HTMLElement, id: AttributeId, color: string): GaugeView {
    const root = el('div', 'bd-gauge', parent);
    root.style.setProperty('--c', color);
    const svg = document.createElementNS(SvgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 100 56');
    const arc = (cls: string): SVGPathElement => {
      const p = document.createElementNS(SvgNs, 'path');
      p.setAttribute('d', 'M 9 50 A 41 41 0 0 1 91 50');
      p.setAttribute('pathLength', '100');
      p.setAttribute('class', cls);
      svg.appendChild(p);
      return p;
    };
    arc('track');
    const cap = arc('cap');
    cap.style.strokeDasharray = `${(this.caps[id] / AttrCeil) * 100} 100`;
    const value = arc('val');
    root.appendChild(svg);
    const num = this.counter(el('b', '', root), AttrStart[id]);
    el('span', 'l', root, AttributeInfos[id].label);
    el('span', 'm', root, `máx ${this.caps[id]}`);
    return { id, root, cap, value, num };
  }
}
