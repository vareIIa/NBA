// Menu de pausa. Hoje tem a aba "Arremessos" (o criador de arremesso, em ShotCreatorView.ts). Segue o padrão do
// BadgeMenu: abre e fecha por método (quem liga é o jogo), o teclado escuta a janela só enquanto a tela está aberta e
// o controle entra por update(dt, input), a cada quadro, também com o jogo pausado.
import './pausemenu.css';
import type { JumpShotSetup, JumpShotStore } from '../shot/JumpShotSetup';
import { type MenuAction, ShotCreatorView } from './ShotCreatorView';

export interface PauseMenuOptions {
  store: JumpShotStore;
  /** "Testar arremesso": recebe a cópia do arremesso em edição (pode ter alterações não salvas). */
  onPreview: (setup: JumpShotSetup) => void;
  /** Chamado ao fechar (Voltar, Esc/B ou ✕), depois do aviso de alterações não salvas. */
  onClose: () => void;
}

/** Estado do controle neste quadro. A tela age na borda (apertou agora) e repete a direção que ficou segurada. */
export interface PauseMenuInput {
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
  confirm?: boolean;
  back?: boolean;
}

/** Atraso antes de repetir uma direção segurada e intervalo entre as repetições, em segundos. */
export const RepeatDelay = 0.4;
export const RepeatRate = 0.11;

const Actions: readonly MenuAction[] = ['up', 'down', 'left', 'right', 'confirm', 'back'];
const Directions: readonly MenuAction[] = ['up', 'down', 'left', 'right'];

/** Tecla (KeyboardEvent.code) para ação do menu: setas ou WASD andam, Enter/Espaço escolhem, Esc volta. */
export function keyToAction(code: string): MenuAction | null {
  switch (code) {
    case 'ArrowUp':
    case 'KeyW':
      return 'up';
    case 'ArrowDown':
    case 'KeyS':
      return 'down';
    case 'ArrowLeft':
    case 'KeyA':
      return 'left';
    case 'ArrowRight':
    case 'KeyD':
      return 'right';
    case 'Enter':
    case 'NumpadEnter':
    case 'Space':
      return 'confirm';
    case 'Escape':
      return 'back';
    default:
      return null;
  }
}

/** Repetições de uma direção segurada neste quadro. `hold.wait` é o tempo até a próxima repetição. */
export function holdRepeats(hold: { wait: number }, dt: number): number {
  hold.wait -= dt;
  let fired = 0;
  while (hold.wait <= 0 && fired < 8) {
    fired++;
    hold.wait += RepeatRate;
  }
  return fired;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

export class PauseMenu {
  private readonly root: HTMLElement;
  private readonly view: ShotCreatorView;
  private readonly toast: HTMLElement;
  // Listener de teclado: só existe enquanto a tela está aberta (entra em open, sai em close).
  private readonly onKeyBound = (e: KeyboardEvent): void => this.onKey(e);
  private openState = false;
  /** Depois de abrir, nada age até o controle soltar: o botão que abriu a tela não pode escolher nada. */
  private waitRelease = false;
  private toastTimer = 0;
  private prev: PauseMenuInput = {};
  private hold: { dir: MenuAction; wait: number } | null = null;

  constructor(private readonly options: PauseMenuOptions) {
    this.root = el('div', 'pm');
    this.root.setAttribute('aria-hidden', 'true');
    el('div', 'pm-bg', this.root);

    const header = el('header', 'pm-header', this.root);
    const brand = el('div', 'pm-brand', header);
    el('span', 'pm-tag', brand, 'PAUSA');
    el('h1', 'pm-title', brand, 'ARREMESSOS');
    const close = el('button', 'pm-close', header, '✕');
    close.title = 'Voltar ao jogo (Esc / B)';
    close.addEventListener('click', () => this.view.requestClose());

    const tabs = el('nav', 'pm-tabs', this.root);
    el('span', 'pm-tab active', tabs, 'Arremessos');

    const body = el('main', 'pm-body', this.root);
    this.view = new ShotCreatorView({
      store: options.store,
      onPreview: options.onPreview,
      onRequestClose: () => this.close(),
      onFlash: (text, error) => this.flash(text, error),
    });
    body.appendChild(this.view.root);

    const footer = el('footer', 'pm-footer', this.root);
    const hints = el('div', 'pm-hints', footer);
    for (const [key, label] of [
      ['Setas / WASD', 'Mover'],
      ['← / →', 'Ajustar'],
      ['Enter / A', 'Escolher'],
      ['Esc / B', 'Voltar'],
    ]) {
      const hint = el('span', 'pm-hint', hints);
      el('kbd', '', hint, key);
      hint.append(label);
    }
    this.toast = el('div', 'pm-toast', this.root);

    (document.getElementById('hud')?.parentElement ?? document.body).appendChild(this.root);
  }

  isOpen(): boolean {
    return this.openState;
  }

  /** Mostra a aba de arremessos, copia o equipado e foca o primeiro cartão. */
  open(): void {
    if (this.openState) return;
    this.openState = true;
    this.waitRelease = true;
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    window.addEventListener('keydown', this.onKeyBound, true);
    this.view.open();
  }

  /** Esconde a tela e chama onClose. As alterações não salvas são resolvidas antes, por Voltar (ou pelo ✕). */
  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
    window.removeEventListener('keydown', this.onKeyBound, true);
    this.toast.classList.remove('show');
    this.prev = {};
    this.hold = null;
    this.options.onClose();
  }

  /**
   * Quadro a quadro: age na borda de cada botão do controle e repete a direção segurada. Chame a cada quadro, também
   * com o jogo pausado, porque é daqui que vêm o controle e o tempo da mensagem na tela.
   */
  update(dt: number, input?: PauseMenuInput): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
    if (!this.openState) {
      this.prev = {};
      this.hold = null;
      return;
    }
    const now = input ?? {};
    if (this.waitRelease) {
      this.prev = { ...now };
      if (Actions.some((a) => now[a])) return;
      this.waitRelease = false;
    }
    for (const action of Actions) {
      if (now[action] && !this.prev[action]) this.act(action);
    }
    const held = Directions.find((d) => now[d]) ?? null;
    const h = this.hold;
    if (held === null) this.hold = null;
    else if (h === null || h.dir !== held) this.hold = { dir: held, wait: RepeatDelay };
    else for (let n = holdRepeats(h, dt); n > 0; n--) this.act(held);
    this.prev = { ...now };
  }

  // ---------------------------------------------------------------- entrada

  private onKey(e: KeyboardEvent): void {
    if (!this.openState) return;
    // Com a tela aberta, nada chega ao jogo.
    e.stopImmediatePropagation();
    // Tab não tira o foco da tela.
    if (e.code === 'Tab') return e.preventDefault();
    const action = keyToAction(e.code);
    if (!action || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    // A repetição do sistema vale só para direções: segurar a seta anda no ajuste, Enter não dispara em série.
    if (e.repeat && !Directions.includes(action)) return;
    this.act(action);
  }

  private act(action: MenuAction): void {
    if (this.openState) this.view.handle(action);
  }

  private flash(text: string, error = false): void {
    this.toast.textContent = text;
    this.toast.className = `pm-toast show${error ? ' error' : ''}`;
    this.toastTimer = 2.2;
  }
}
