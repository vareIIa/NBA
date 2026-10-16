// HUD do Online 1x1 (por cima do GameHud): faixa central (check, cesta, rebote, limpar a bola, queda de conexão), papel
// (ataque/defesa), latência, nome em cima do oponente, tela de fim (revanche/sair) e a confirmação de sair (P / Start).
import './online-hud.css';

export interface OverState {
  won: boolean;
  myScore: number;
  theirScore: number;
  forfeit: boolean;
  wantRematch: boolean;
  theyWantRematch: boolean;
  opponentGone: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

export class OnlineHud {
  readonly root: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerText: HTMLElement;
  private readonly bannerSub: HTMLElement;
  private readonly role: HTMLElement;
  private readonly net: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly over: HTMLElement;
  private readonly leaveBox: HTMLElement;
  private bannerTimer = 0;
  private sticky = false;
  private overOpen = false;
  private leaveOpen = false;
  private prevPad: Record<string, boolean> = {};
  private readonly onKeyBound = (e: KeyboardEvent): void => this.onKey(e);

  constructor(
    private readonly actions: { rematch: () => void; leave: () => void },
    parent: HTMLElement = document.getElementById('hud') ?? document.body,
  ) {
    this.root = el('div', 'oh', parent);
    this.banner = el('div', 'oh-banner', this.root);
    this.bannerText = el('b', '', this.banner);
    this.bannerSub = el('span', '', this.banner);
    this.role = el('div', 'oh-role', this.root);
    this.net = el('div', 'oh-net', this.root);
    this.tag = el('div', 'oh-tag', this.root);
    this.over = el('div', 'oh-over', this.root);
    this.leaveBox = el('div', 'oh-leave', this.root);
    const box = el('div', 'oh-box', this.leaveBox);
    el('b', '', box, 'Sair da partida?');
    el('p', '', box, 'Saindo agora você perde por W.O.');
    const row = el('div', 'oh-actions', box);
    el('button', 'oh-btn danger', row, 'Sair (A / Enter)').addEventListener('click', () => this.actions.leave());
    el('button', 'oh-btn', row, 'Continuar (B / Esc)').addEventListener('click', () => this.setLeave(false));
    window.addEventListener('keydown', this.onKeyBound, true);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyBound, true);
    this.root.remove();
  }

  /** Mensagem no centro; seconds = 0 deixa até a próxima (contagem, espera da reconexão). */
  say(text: string, sub = '', seconds = 1.6, tone: 'info' | 'good' | 'bad' | 'gold' = 'info'): void {
    this.bannerText.textContent = text;
    this.bannerSub.textContent = sub;
    this.banner.className = `oh-banner show ${tone}`;
    this.sticky = seconds <= 0;
    this.bannerTimer = seconds;
  }

  clear(): void {
    this.banner.classList.remove('show');
    this.sticky = false;
    this.bannerTimer = 0;
  }

  get speaking(): boolean {
    return this.banner.classList.contains('show');
  }

  setRole(text: string, warn = false): void {
    this.role.textContent = text;
    this.role.classList.toggle('warn', warn);
    this.role.style.display = text ? '' : 'none';
  }

  setNet(rttMs: number, status: string): void {
    const ok = status === 'open';
    this.net.textContent = ok ? `${Math.round(rttMs)} ms` : 'RECONECTANDO…';
    this.net.className = `oh-net ${!ok ? 'bad' : rttMs > 150 ? 'warn' : ''}`;
  }

  setTag(x: number, y: number, visible: boolean, name: string): void {
    this.tag.textContent = name;
    this.tag.style.opacity = visible ? '1' : '0';
    this.tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
  }

  showOver(s: OverState): void {
    this.overOpen = true;
    this.over.classList.add('show');
    this.over.replaceChildren();
    const box = el('div', 'oh-box big', this.over);
    el('b', `oh-result ${s.won ? 'won' : 'lost'}`, box, s.won ? 'VITÓRIA' : 'DERROTA');
    el('div', 'oh-final', box, `${s.myScore} x ${s.theirScore}`);
    if (s.forfeit) el('p', '', box, s.won ? 'O oponente saiu da partida.' : 'Você saiu da partida.');
    const row = el('div', 'oh-actions', box);
    if (!s.opponentGone) {
      const label = s.wantRematch ? 'Esperando o oponente…' : s.theyWantRematch ? 'Aceitar revanche (A)' : 'Revanche (A)';
      const b = el('button', 'oh-btn primary', row, label);
      b.disabled = s.wantRematch;
      b.addEventListener('click', () => this.actions.rematch());
      if (s.theyWantRematch && !s.wantRematch) el('p', 'oh-hint', box, 'O oponente quer revanche!');
    } else {
      el('p', 'oh-hint', box, 'O oponente saiu da sala.');
    }
    el('button', 'oh-btn', row, 'Sair (B)').addEventListener('click', () => this.actions.leave());
  }

  hideOver(): void {
    this.overOpen = false;
    this.over.classList.remove('show');
  }

  /** P / Start: abre ou fecha a confirmação de sair (o jogo continua rodando por trás, como no online do 2K). */
  toggleLeave(): void {
    if (this.overOpen) return;
    this.setLeave(!this.leaveOpen);
  }

  update(dt: number): void {
    if (!this.sticky && this.bannerTimer > 0 && (this.bannerTimer -= dt) <= 0) this.banner.classList.remove('show');
    // Controle nas caixas de fim e de sair: A confirma, B volta.
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
    if (!pad) return;
    const now = { a: !!pad.buttons[0]?.pressed, b: !!pad.buttons[1]?.pressed };
    const edge = (k: 'a' | 'b'): boolean => now[k] && !this.prevPad[k];
    if (this.overOpen) {
      if (edge('a')) this.actions.rematch();
      if (edge('b')) this.actions.leave();
    } else if (this.leaveOpen) {
      if (edge('a')) this.actions.leave();
      if (edge('b')) this.setLeave(false);
    }
    this.prevPad = now;
  }

  private setLeave(open: boolean): void {
    this.leaveOpen = open;
    this.leaveBox.classList.toggle('show', open);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.overOpen && !this.leaveOpen) return;
    const confirm = e.code === 'Enter' || e.code === 'NumpadEnter';
    const back = e.code === 'Escape' || e.code === 'Backspace';
    if (!confirm && !back) return;
    e.preventDefault();
    e.stopPropagation();
    if (this.overOpen) {
      if (confirm) this.actions.rematch();
      else this.actions.leave();
    } else if (confirm) this.actions.leave();
    else this.setLeave(false);
  }
}
