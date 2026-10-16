// Tela de badges (MyPLAYER · BADGES), no espírito da tela do 2K23 next gen com acabamento de sim (painéis escuros,
// cantos cortados, tipografia condensada, números grandes). Mostra os 64 badges por categoria e por tier, como cada
// um ativa, o efeito em cada nível, os counters e se ele já funciona no jogo; equipa, troca o nível e desequipa
// respeitando os pontos da build e o destrave do Tier 3.
// Abre com B (teclado) ou View (controle). Navegação: Q/E ou LB/RB trocam a categoria, setas ou D-pad escolhem o
// badge, Enter/A sobe o nível, Backspace/X desequipa, 0–4 escolhem o nível direto, Esc/B (controle) fecha.
import './badgemenu.css';
import {
  AllBadgeIds,
  type BadgeCategory,
  type BadgeDef,
  type BadgeId,
  type BadgeLoadout,
  BadgeTier,
  Badges,
  BadgeCostTier,
  type CategoryBudget,
  TierCost,
  Tier3UnlockPoints,
  badgeCost,
  badgeTierName,
  categorySpend,
  checkBadgeChange,
} from '../sim';
import { type IconCategory, TierColor, badgeIconSvg } from './badgeIcons';

export interface BadgeMenuOptions {
  playerName: string;
  buildName: string;
  budget: CategoryBudget;
  getLoadout: () => BadgeLoadout;
  setLoadout: (loadout: BadgeLoadout) => void;
  resetLoadout: () => BadgeLoadout;
  /** Quantas vezes o badge ativou nesta partida. */
  activations: (id: BadgeId) => number;
}

const Categories: { id: BadgeCategory; label: string; short: string }[] = [
  { id: 'Finishing', label: 'Finalização', short: 'FIN' },
  { id: 'Shooting', label: 'Arremesso', short: 'ARR' },
  { id: 'Playmaking', label: 'Armação', short: 'ARM' },
  { id: 'Defense', label: 'Defesa / Rebote', short: 'DEF' },
];

const TierLabels = ['Nenhum', 'Bronze', 'Prata', 'Ouro', 'Hall of Fame'];
const UsageLabel = { meta: 'META', situational: 'SITUACIONAL', useless: 'POUCO USADO' } as const;
const FrequencyLabel = { high: 'Ativa muito', medium: 'Ativa às vezes', rare: 'Ativa raramente' } as const;
const StatusLabel = { live: 'ATIVO NO JOGO', ready: 'PRONTO · FALTA DADO', pending: 'AGUARDA SISTEMA' } as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

const formatValue = (def: BadgeDef, value: number): string => {
  const sign = value > 0 && /pp|\+/.test(def.effect) ? '+' : '';
  return `${sign}${Number.isInteger(value) ? value : value.toFixed(1).replace('.', ',')}`;
};

const UsageRank = { meta: 0, situational: 1, useless: 2 } as const;

export class BadgeMenu {
  private readonly root: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly toast: HTMLElement;
  private category: BadgeCategory = 'Shooting';
  private selected: BadgeId = 'Agent3';
  private openState = false;
  private toastTimer = 0;
  private padPrev: boolean[] = [];

  constructor(private readonly options: BadgeMenuOptions) {
    this.root = el('div', 'bm');
    this.root.setAttribute('aria-hidden', 'true');
    el('div', 'bm-bg', this.root);

    const header = el('header', 'bm-header', this.root);
    const brand = el('div', 'bm-brand', header);
    el('span', 'bm-tag', brand, 'MyPLAYER');
    el('h1', 'bm-title', brand, 'BADGES');
    const who = el('div', 'bm-who', header);
    el('div', 'bm-who-name', who, options.playerName);
    el('div', 'bm-who-build', who, options.buildName);
    this.summary = el('div', 'bm-summary', header);
    const close = el('button', 'bm-close', header, '✕');
    close.title = 'Fechar (B / Esc)';
    close.addEventListener('click', () => this.close());

    this.tabs = el('nav', 'bm-tabs', this.root);
    const body = el('div', 'bm-body', this.root);
    this.grid = el('div', 'bm-grid', body);
    this.detail = el('aside', 'bm-detail', body);

    const footer = el('footer', 'bm-footer', this.root);
    const hints = el('div', 'bm-hints', footer);
    for (const [key, label] of [
      ['Q / E', 'Categoria'],
      ['Setas', 'Badge'],
      ['Enter', 'Subir nível'],
      ['0–4', 'Nível direto'],
      ['Backspace', 'Desequipar'],
      ['B / Esc', 'Voltar ao jogo'],
    ]) {
      const hint = el('span', 'bm-hint', hints);
      el('kbd', '', hint, key);
      hint.append(label);
    }
    const actions = el('div', 'bm-actions', footer);
    const clear = el('button', 'bm-btn ghost', actions, 'Limpar categoria');
    clear.addEventListener('click', () => this.clearCategory());
    const reset = el('button', 'bm-btn', actions, 'Build do diretor');
    reset.addEventListener('click', () => {
      this.options.resetLoadout();
      this.flash('Build do diretor restaurada');
      this.render();
    });
    this.toast = el('div', 'bm-toast', this.root);

    (document.getElementById('hud')?.parentElement ?? document.body).appendChild(this.root);
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    this.openState = true;
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    this.render();
  }

  close(): void {
    this.openState = false;
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
  }

  toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  /** Quadro a quadro: controle (View abre/fecha; com a tela aberta, D-pad/LB/RB/A/X/B). */
  update(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (!pad) return;
    const pressed = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => pressed[i] && !this.padPrev[i];
    if (edge(8)) this.toggle();
    if (this.openState) {
      if (edge(1)) this.close();
      if (edge(4)) this.cycleCategory(-1);
      if (edge(5)) this.cycleCategory(1);
      if (edge(12)) this.move(0, -1);
      if (edge(13)) this.move(0, 1);
      if (edge(14)) this.move(-1, 0);
      if (edge(15)) this.move(1, 0);
      if (edge(0)) this.raise();
      if (edge(2)) this.setTier(this.selected, BadgeTier.None);
    }
    this.padPrev = pressed;
  }

  // ---------------------------------------------------------------- entrada

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'KeyB' && !e.repeat) {
      this.toggle();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (!this.openState) return;
    // Com a tela aberta, nada chega ao jogo.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat && !e.code.startsWith('Arrow')) return;
    switch (e.code) {
      case 'Escape':
        this.close();
        break;
      case 'KeyQ':
        this.cycleCategory(-1);
        break;
      case 'KeyE':
        this.cycleCategory(1);
        break;
      case 'ArrowLeft':
        this.move(-1, 0);
        break;
      case 'ArrowRight':
        this.move(1, 0);
        break;
      case 'ArrowUp':
        this.move(0, -1);
        break;
      case 'ArrowDown':
        this.move(0, 1);
        break;
      case 'Enter':
      case 'Space':
        this.raise();
        break;
      case 'Backspace':
      case 'Delete':
        this.setTier(this.selected, BadgeTier.None);
        break;
      default:
        if (/^Digit[0-4]$/.test(e.code)) this.setTier(this.selected, Number(e.code.slice(5)) as BadgeTier);
    }
  }

  private ordered(category: BadgeCategory): BadgeId[] {
    return AllBadgeIds.filter((id) => Badges[id].category === category).sort(
      (a, b) =>
        BadgeCostTier[b] - BadgeCostTier[a] ||
        UsageRank[Badges[a].usage] - UsageRank[Badges[b].usage] ||
        Badges[a].name.localeCompare(Badges[b].name),
    );
  }

  private cycleCategory(step: number): void {
    const index = Categories.findIndex((c) => c.id === this.category);
    this.category = Categories[(index + step + Categories.length) % Categories.length].id;
    this.selected = this.ordered(this.category)[0];
    this.render();
  }

  /** Grade de 4 colunas por faixa de tier; anda dentro da lista ordenada. */
  private move(dx: number, dy: number): void {
    const list = this.ordered(this.category);
    const index = list.indexOf(this.selected);
    const next = Math.max(0, Math.min(list.length - 1, index + dx + dy * 4));
    this.selected = list[next];
    this.render();
    this.grid.querySelector('.bm-card.selected')?.scrollIntoView({ block: 'nearest' });
  }

  private raise(): void {
    const current = this.options.getLoadout()[this.selected] ?? BadgeTier.None;
    this.setTier(this.selected, current >= BadgeTier.HallOfFame ? BadgeTier.None : ((current + 1) as BadgeTier));
  }

  private setTier(id: BadgeId, tier: BadgeTier): void {
    const loadout = this.options.getLoadout();
    if ((loadout[id] ?? BadgeTier.None) === tier) return;
    const check = checkBadgeChange(loadout, this.options.budget, id, tier);
    if (!check.ok) {
      this.flash(check.reason, true);
      return;
    }
    const next: BadgeLoadout = { ...loadout, [id]: tier };
    if (tier === BadgeTier.None) delete next[id];
    this.options.setLoadout(next);
    this.flash(tier === BadgeTier.None ? `${Badges[id].name} desequipado` : `${Badges[id].name} · ${TierLabels[tier]}`);
    this.render();
  }

  private clearCategory(): void {
    const next: BadgeLoadout = { ...this.options.getLoadout() };
    for (const id of AllBadgeIds) if (Badges[id].category === this.category) delete next[id];
    this.options.setLoadout(next);
    this.flash('Categoria limpa');
    this.render();
  }

  private flash(text: string, error = false): void {
    this.toast.textContent = text;
    this.toast.className = `bm-toast show${error ? ' error' : ''}`;
    this.toastTimer = 2.2;
  }

  // ---------------------------------------------------------------- desenho

  private render(): void {
    if (!this.openState) return;
    const loadout = this.options.getLoadout();
    const budget = this.options.budget;

    // Resumo de pontos no topo.
    this.summary.replaceChildren();
    let equipped = 0;
    for (const c of Categories) {
      const spend = categorySpend(loadout, c.id);
      equipped += spend.equipped;
      const pill = el('div', 'bm-pill', this.summary);
      el('span', 'bm-pill-label', pill, c.short);
      el('span', 'bm-pill-value', pill, `${spend.spent}`);
      el('span', 'bm-pill-max', pill, `/${budget[c.id]}`);
    }
    const total = el('div', 'bm-pill total', this.summary);
    el('span', 'bm-pill-label', total, 'EQUIPADOS');
    el('span', 'bm-pill-value', total, String(equipped));

    // Abas.
    this.tabs.replaceChildren();
    for (const c of Categories) {
      const spend = categorySpend(loadout, c.id);
      const tab = el('button', `bm-tab${c.id === this.category ? ' active' : ''}`, this.tabs);
      const icon = el('span', 'bm-tab-icon', tab);
      icon.innerHTML = badgeIconSvg(c.id as IconCategory, 'Silver');
      const text = el('span', 'bm-tab-text', tab);
      el('span', 'bm-tab-label', text, c.label);
      const bar = el('span', 'bm-tab-bar', text);
      const fill = el('span', 'bm-tab-fill', bar);
      fill.style.width = `${Math.min(100, (100 * spend.spent) / budget[c.id])}%`;
      el('span', 'bm-tab-points', tab, `${spend.spent}/${budget[c.id]}`);
      tab.addEventListener('click', () => {
        this.category = c.id;
        this.selected = this.ordered(c.id)[0];
        this.render();
      });
    }

    // Grade por tier (3 → 1, como o 2K23 next gen).
    this.grid.replaceChildren();
    const spend = categorySpend(loadout, this.category);
    const list = this.ordered(this.category);
    for (const costTier of [3, 2, 1] as const) {
      const band = el('section', 'bm-band', this.grid);
      const head = el('div', 'bm-band-head', band);
      el('span', 'bm-band-tier', head, `TIER ${costTier}`);
      el('span', 'bm-band-cost', head, `${TierCost[costTier].join(' / ')} pts`);
      if (costTier === 3) {
        const unlocked = spend.lowerTiers >= Tier3UnlockPoints;
        const lock = el('span', `bm-band-lock${unlocked ? ' open' : ''}`, head);
        lock.textContent = unlocked ? 'DESTRAVADO' : `🔒 ${spend.lowerTiers}/${Tier3UnlockPoints} pts em Tier 1/2`;
      }
      const cards = el('div', 'bm-cards', band);
      for (const id of list.filter((b) => BadgeCostTier[b] === costTier)) this.renderCard(cards, id, loadout);
    }

    this.renderDetail(loadout);
  }

  private renderCard(parent: HTMLElement, id: BadgeId, loadout: BadgeLoadout): void {
    const def = Badges[id];
    const tier = loadout[id] ?? BadgeTier.None;
    const card = el('button', `bm-card${id === this.selected ? ' selected' : ''}${tier ? ' equipped' : ''} usage-${def.usage}`, parent);
    if (tier) card.style.setProperty('--tier', TierColor[badgeTierName(tier)]);
    const icon = el('span', 'bm-card-icon', card);
    icon.innerHTML = badgeIconSvg(def.category as IconCategory, tier ? badgeTierName(tier) : 'Silver');
    const body = el('span', 'bm-card-body', card);
    el('span', 'bm-card-name', body, def.name);
    const pips = el('span', 'bm-pips', body);
    for (let level = 1; level <= 4; level++) {
      const pip = el('span', `bm-pip${level <= tier ? ' on' : ''}`, pips);
      if (level <= tier) pip.style.background = TierColor[badgeTierName(level as BadgeTier)];
    }
    const tags = el('span', 'bm-card-tags', body);
    el('span', `bm-chip usage ${def.usage}`, tags, UsageLabel[def.usage]);
    el('span', `bm-chip status ${def.status}`, tags, def.status === 'live' ? 'ATIVO' : def.status === 'ready' ? 'PRONTO' : 'EM BREVE');
    const count = this.options.activations(id);
    if (count > 0) el('span', 'bm-card-count', card, `×${count}`);
    card.addEventListener('click', () => {
      if (this.selected === id) this.raise();
      else {
        this.selected = id;
        this.render();
      }
    });
  }

  private renderDetail(loadout: BadgeLoadout): void {
    const id = this.selected;
    const def = Badges[id];
    const tier = loadout[id] ?? BadgeTier.None;
    const costTier = BadgeCostTier[id];
    const tierName = tier ? badgeTierName(tier) : 'Silver';
    this.detail.replaceChildren();
    this.detail.style.setProperty('--tier', tier ? TierColor[tierName] : '#5c6470');

    const hero = el('div', 'bm-hero', this.detail);
    const icon = el('div', 'bm-hero-icon', hero);
    icon.innerHTML = badgeIconSvg(def.category as IconCategory, tierName);
    const titles = el('div', 'bm-hero-titles', hero);
    el('div', 'bm-hero-cat', titles, `${Categories.find((c) => c.id === def.category)!.label} · Tier ${costTier}`);
    el('div', 'bm-hero-name', titles, def.name);
    const meta = el('div', 'bm-hero-meta', titles);
    el('span', `bm-chip usage ${def.usage}`, meta, UsageLabel[def.usage]);
    el('span', 'bm-chip freq', meta, FrequencyLabel[def.frequency]);
    el('span', 'bm-hero-level', hero, tier ? TierLabels[tier].toUpperCase() : 'NÃO EQUIPADO');

    const section = (title: string) => {
      const s = el('section', 'bm-sec', this.detail);
      el('h3', 'bm-sec-title', s, title);
      return s;
    };

    el('p', 'bm-text', section('Como ativa'), def.trigger);

    const effect = section('Efeito por nível');
    el('p', 'bm-text dim', effect, def.effect + (def.sourced ? ' · testado (2KLab)' : ' · estimativa'));
    const table = el('div', 'bm-levels', effect);
    for (let level = BadgeTier.Bronze; level <= BadgeTier.HallOfFame; level++) {
      const check = checkBadgeChange(loadout, this.options.budget, id, level);
      const row = el('button', `bm-level${level === tier ? ' current' : ''}${check.ok || level === tier ? '' : ' blocked'}`, table);
      row.style.setProperty('--lv', TierColor[badgeTierName(level)]);
      el('span', 'bm-level-name', row, TierLabels[level]);
      el('span', 'bm-level-value', row, formatValue(def, def.values[level - 1]));
      el('span', 'bm-level-cost', row, `${badgeCost(id, level)} pts`);
      row.title = check.ok ? `Equipar ${TierLabels[level]}` : check.reason;
      row.addEventListener('click', () => this.setTier(id, level));
    }
    if (tier) {
      const off = el('button', 'bm-btn ghost wide', effect, 'Desequipar');
      off.addEventListener('click', () => this.setTier(id, BadgeTier.None));
    }

    if (def.counteredBy?.length) {
      el('p', 'bm-text', section('Contra'), def.counteredBy.map((c) => Badges[c].name).join(' · '));
    }

    const game = section('No Garrafão');
    const status = el('div', `bm-status ${def.status}`, game);
    el('span', 'bm-status-dot', status);
    el('span', '', status, StatusLabel[def.status]);
    if (def.needs) el('p', 'bm-text dim', game, `Falta: ${def.needs}`);
    const count = this.options.activations(id);
    el('p', 'bm-text', game, count > 0 ? `Ativou ${count}× nesta partida` : 'Ainda não ativou nesta partida');

    // Pontos da categoria.
    const spend = categorySpend(loadout, def.category);
    const pts = el('div', 'bm-points', this.detail);
    el('span', 'bm-points-label', pts, 'Pontos da categoria');
    el('span', 'bm-points-value', pts, `${spend.spent}`);
    el('span', 'bm-points-max', pts, `/ ${this.options.budget[def.category]}`);
  }
}
