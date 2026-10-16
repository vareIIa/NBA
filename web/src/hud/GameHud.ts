// HUD de gameplay no estilo do jogo de referência (vídeo do diretor, 2K23 / quadra pirata):
//  - canto superior direito: faixa de avisos (timing/coverage em verde, badge em vermelho, nota de teammate em
//    dourado) saindo de trás do losango (nota do teammate ou ícone do badge), cartão preto com o nome e
//    PTS/REB/AST/3P%, e embaixo os quadradinhos do takeover (o fundo vermelho sobe; cheio = pega fogo);
//  - canto inferior direito: placar (nomes, pontos, relógio de posse em vermelho);
//  - embaixo do jogador: nome e barra de energia (o anel no chão é desenhado no three.js).
// Tudo em HTML/CSS por cima do canvas; o estado vem de fora (GameHud não conhece o núcleo).
import './gamehud.css';
import { type IconCategory, type IconTier, badgeIconSvg, shotIconSvg, takeoverIconSvg } from './badgeIcons';

export type TimingTone = 'excellent' | 'good' | 'slight' | 'bad';

export type HudNotice =
  | { kind: 'timing'; timing: string; coverage: string; tone: TimingTone; label?: string }
  | { kind: 'badge'; name: string; category: IconCategory; tier: IconTier }
  | { kind: 'grade'; text: string; positive: boolean };

export interface CardStats {
  name: string;
  pts: number;
  reb: number;
  ast: number;
  threePct: number;
}

export interface TakeoverSlot {
  label: string;
  glyph: string; // chave de TakeoverGlyph
  fill: number; // 0..1
  active: boolean;
}

export interface TakeoverHud {
  team: TakeoverSlot;
  primary: TakeoverSlot;
  secondary: TakeoverSlot;
}

export interface ScoreboardState {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  shotClock: number; // s
}

const NoticeSeconds: Record<HudNotice['kind'], number> = { timing: 1.8, badge: 1.25, grade: 1.5 };
const pad2 = (n: number): string => String(Math.max(0, Math.floor(n))).padStart(2, '0');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent?.appendChild(node);
  return node;
}

export class GameHud {
  readonly root: HTMLElement;
  private readonly ribbon: HTMLElement;
  private readonly ribbonText: HTMLElement;
  private readonly diamond: HTMLElement;
  private readonly diamondFace: HTMLElement;
  private readonly card: HTMLElement;
  private readonly cardName: HTMLElement;
  private readonly statPts: HTMLElement;
  private readonly statReb: HTMLElement;
  private readonly statAst: HTMLElement;
  private readonly stat3p: HTMLElement;
  private readonly sweep: HTMLElement;
  private readonly bolt: HTMLElement;
  private readonly slots: Record<keyof TakeoverHud, { box: HTMLElement; fill: HTMLElement; icon: HTMLElement; glyph: string }>;
  private readonly scoreHome: HTMLElement;
  private readonly scoreAway: HTMLElement;
  private readonly scoreHomeName: HTMLElement;
  private readonly scoreAwayName: HTMLElement;
  private readonly shotClock: HTMLElement;
  private readonly plate: HTMLElement;
  private readonly plateName: HTMLElement;
  private readonly plateEnergy: HTMLElement;

  private grade = 'C';
  private queue: HudNotice[] = [];
  private current: HudNotice | null = null;
  private noticeTimer = 0;
  private sweepTimer = 0;
  private boltTimer = 0;
  private takeoverActive = false;

  constructor(parent: HTMLElement = document.getElementById('hud') ?? document.body) {
    this.root = el('div', 'gh', parent);

    // ---- topo direito
    const top = el('div', 'gh-top', this.root);
    const row = el('div', 'gh-row', top);
    this.ribbon = el('div', 'gh-ribbon', row);
    this.ribbonText = el('div', 'gh-ribbon-text', this.ribbon);
    this.card = el('div', 'gh-card', row);
    this.bolt = el('div', 'gh-bolt', row);
    this.bolt.innerHTML =
      '<svg viewBox="0 0 300 14" preserveAspectRatio="none"><polyline points="0,9 18,6 31,10 44,4 60,8 77,5 90,9 108,3 121,8 139,6 152,10 170,4 186,8 200,5 214,9 231,4 247,8 262,5 281,9 300,6"/></svg>';
    this.sweep = el('div', 'gh-sweep', this.card);
    this.cardName = el('div', 'gh-name', this.card);
    const stats = el('div', 'gh-stats', this.card);
    const stat = (label: string): HTMLElement => {
      el('span', 'gh-stat-label', stats).textContent = label;
      return el('span', 'gh-stat-value', stats);
    };
    this.statPts = stat('PTS');
    this.statReb = stat('REB');
    this.statAst = stat('AST');
    this.stat3p = stat('3P%');
    this.diamond = el('div', 'gh-diamond', row);
    this.diamondFace = el('div', 'gh-diamond-face', this.diamond);

    const takeover = el('div', 'gh-takeover', top);
    const makeSlot = (kind: keyof TakeoverHud, round: boolean) => {
      const box = el('div', `gh-slot gh-slot-${kind}${round ? ' round' : ''}`, takeover);
      const fill = el('div', 'gh-slot-fill', box);
      el('div', 'gh-slot-fire', box);
      const icon = el('div', 'gh-slot-icon', box);
      return { box, fill, icon, glyph: '' };
    };
    this.slots = { team: makeSlot('team', false), primary: makeSlot('primary', true), secondary: makeSlot('secondary', true) };

    // ---- placar
    const score = el('div', 'gh-score', this.root);
    el('div', 'gh-score-art', score);
    const names = el('div', 'gh-score-names', score);
    this.scoreAwayName = el('span', '', names);
    this.scoreHomeName = el('span', '', names);
    const nums = el('div', 'gh-score-nums', score);
    this.scoreAway = el('span', 'gh-score-num', nums);
    this.scoreHome = el('span', 'gh-score-num', nums);
    this.shotClock = el('span', 'gh-clock', nums);

    // ---- embaixo do jogador
    this.plate = el('div', 'gh-plate', this.root);
    this.plateName = el('div', 'gh-plate-name', this.plate);
    const bar = el('div', 'gh-plate-bar', this.plate);
    this.plateEnergy = el('div', 'gh-plate-energy', bar);

    this.showIdle();
  }

  // ------------------------------------------------------------------ cartão e losango

  setCard(stats: CardStats): void {
    this.cardName.textContent = stats.name;
    this.statPts.textContent = String(stats.pts);
    this.statReb.textContent = String(stats.reb);
    this.statAst.textContent = String(stats.ast);
    this.stat3p.textContent = `${stats.threePct}%`;
    this.plateName.textContent = stats.name;
  }

  /** Nota do teammate (A+..F). Quando muda, o losango pisca. */
  setGrade(letter: string): void {
    if (letter === this.grade) return;
    this.grade = letter;
    if (!this.current || this.current.kind === 'grade') this.paintDiamond(this.current);
    this.diamond.classList.remove('flash');
    void this.diamond.offsetWidth;
    this.diamond.classList.add('flash');
  }

  // ------------------------------------------------------------------ avisos

  /** Timing entra na hora (substitui o que estiver na tela); badges e notas fazem fila. */
  notify(notice: HudNotice): void {
    if (notice.kind === 'timing') {
      this.queue = this.queue.filter((n) => n.kind !== 'timing');
      // O que estava na tela volta para a frente da fila (o badge do arremesso aparece depois do timing).
      if (this.current && this.current.kind !== 'timing') this.queue.unshift(this.current);
      this.show(notice);
      return;
    }
    // Não repete o mesmo badge que já está na tela ou na fila.
    const same = (n: HudNotice | null) => n?.kind === 'badge' && notice.kind === 'badge' && n.name === notice.name;
    if (same(this.current) || this.queue.some(same)) return;
    if (!this.current) this.show(notice);
    else this.queue.push(notice);
  }

  /** Faixa vermelha que varre o cartão (ativação de badge / takeover subindo). */
  flashSweep(): void {
    this.sweepTimer = 0.55;
    this.sweep.classList.remove('run');
    void this.sweep.offsetWidth;
    this.sweep.classList.add('run');
  }

  /** Raios no topo do cartão (o takeover ganhou carga). */
  pulseBolt(seconds = 0.9): void {
    this.boltTimer = Math.max(this.boltTimer, seconds);
  }

  private show(notice: HudNotice): void {
    this.current = notice;
    this.noticeTimer = NoticeSeconds[notice.kind];
    this.ribbon.className = `gh-ribbon show ${notice.kind}`;
    if (notice.kind === 'timing') {
      this.ribbon.classList.add(notice.tone);
      this.ribbonText.innerHTML = `<div><b>${notice.label ?? 'TIMING'}:</b> <span class="gh-timing ${notice.tone}">${notice.timing}</span></div><div class="gh-coverage"><b>COVERAGE:</b> ${notice.coverage}</div>`;
    } else if (notice.kind === 'badge') {
      this.ribbonText.textContent = notice.name.toUpperCase();
      this.flashSweep();
    } else {
      this.ribbon.classList.add(notice.positive ? 'positive' : 'negative');
      this.ribbonText.textContent = notice.text.toUpperCase();
    }
    // Reinicia a animação de entrada.
    this.ribbon.style.animation = 'none';
    void this.ribbon.offsetWidth;
    this.ribbon.style.animation = '';
    this.paintDiamond(notice);
  }

  private showIdle(): void {
    this.current = null;
    this.ribbon.className = 'gh-ribbon';
    this.paintDiamond(null);
  }

  private paintDiamond(notice: HudNotice | null): void {
    if (notice?.kind === 'badge') {
      this.diamondFace.innerHTML = badgeIconSvg(notice.category, notice.tier);
      this.diamond.className = 'gh-diamond badge';
    } else if (notice?.kind === 'timing') {
      this.diamondFace.innerHTML = shotIconSvg;
      this.diamond.className = `gh-diamond timing ${notice.tone}`;
    } else {
      this.diamondFace.innerHTML = `<span class="gh-grade">${this.grade}</span>`;
      this.diamond.className = 'gh-diamond grade';
    }
  }

  // ------------------------------------------------------------------ takeover

  setTakeover(state: TakeoverHud): void {
    for (const key of Object.keys(this.slots) as (keyof TakeoverHud)[]) {
      const slot = this.slots[key];
      const data = state[key];
      if (slot.glyph !== data.glyph) {
        slot.icon.innerHTML = takeoverIconSvg(data.glyph);
        slot.glyph = data.glyph;
        slot.box.title = data.label;
      }
      slot.fill.style.height = `${Math.round(Math.min(1, Math.max(0, data.fill)) * 100)}%`;
      slot.box.classList.toggle('full', data.fill >= 0.999 && !data.active);
      slot.box.classList.toggle('active', data.active);
    }
    this.takeoverActive = state.primary.active || state.secondary.active || state.team.active;
  }

  // ------------------------------------------------------------------ placar e jogador

  setScoreboard(state: ScoreboardState): void {
    this.scoreHomeName.textContent = state.home;
    this.scoreAwayName.textContent = state.away;
    this.scoreHome.textContent = pad2(state.homeScore);
    this.scoreAway.textContent = pad2(state.awayScore);
    this.shotClock.textContent = state.shotClock >= 1 ? String(Math.ceil(state.shotClock)) : state.shotClock.toFixed(1);
    this.shotClock.classList.toggle('low', state.shotClock <= 5);
  }

  /** Nome e energia embaixo dos pés do jogador (x, y em pixels da tela). */
  setPlayerPlate(x: number, y: number, energy: number, visible = true): void {
    this.plate.style.opacity = visible ? '1' : '0';
    this.plate.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, 0)`;
    const e = Math.min(1, Math.max(0, energy));
    this.plateEnergy.style.width = `${e * 100}%`;
    this.plateEnergy.classList.toggle('low', e < 0.4);
  }

  update(dt: number): void {
    if (this.current) {
      this.noticeTimer -= dt;
      if (this.noticeTimer <= 0) {
        const next = this.queue.shift();
        if (next) this.show(next);
        else this.showIdle();
      }
    }
    if (this.sweepTimer > 0) {
      this.sweepTimer -= dt;
      if (this.sweepTimer <= 0) this.sweep.classList.remove('run');
    }
    if (this.boltTimer > 0) this.boltTimer -= dt;
    this.bolt.classList.toggle('on', this.boltTimer > 0 || this.takeoverActive);
  }

  /** Para os testes: o que está escrito na faixa agora. */
  currentNoticeText(): string {
    return this.current ? this.ribbonText.textContent ?? '' : '';
  }
}
