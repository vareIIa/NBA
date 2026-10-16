// Menu de pausa. A tela inicial é uma lista de opções (MENU): "Arremessos" abre o criador de arremesso (ShotCreatorView.ts)
// e "Continuar" volta ao jogo. Dentro do criador, Voltar (Esc / B) leva de volta à lista. Segue o padrão do BadgeMenu: abre
// e fecha por método (quem liga é o jogo), o teclado escuta a janela só enquanto a tela está aberta e o controle entra por
// update(dt, input), a cada quadro, também com o jogo pausado.
import './pausemenu.css';
import type { JumpShotStore } from '../shot/JumpShotSetup';
import { type MenuAction, ShotCreatorOptions, ShotCreatorView } from './ShotCreatorView';

export interface PauseMenuOptions {
  store: JumpShotStore;
  /** Prévia do arremesso em edição (a cena repete o que aparece; pode ter alterações não salvas). */
  onPreview: ShotCreatorOptions['onPreview'];
  /** A prévia para (o menu voltou à lista). */
  onPreviewStop?: () => void;
  /** Chamado ao fechar o menu (Continuar, Esc/B na lista ou ✕), para o jogo retomar. */
  onClose: () => void;
  /** "Badges": a pausa sai da tela e o menu de badges abre (o jogo continua pausado). */
  onBadges: () => void;
  /** "Menu principal": sai do Freestyle para o menu (Meu Jogador e modos). */
  onMainMenu?: () => void;
}

/** Estado do controle neste quadro. A tela age na borda (apertou agora) e repete a direção que ficou segurada. */
export interface PauseMenuInput {
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
  confirm?: boolean;
  back?: boolean;
  /** Y no controle (Salvar no criador). */
  save?: boolean;
}

/** Atraso antes de repetir uma direção segurada e intervalo entre as repetições, em segundos. */
export const RepeatDelay = 0.4;
export const RepeatRate = 0.11;

const Actions: readonly MenuAction[] = ['up', 'down', 'left', 'right', 'confirm', 'back', 'save'];
const Directions: readonly MenuAction[] = ['up', 'down', 'left', 'right'];

/** Opções da tela inicial do menu, na ordem em que aparecem. */
export const PauseItems = [
  { id: 'shots', label: 'Arremessos', desc: 'Base, camadas de cima, mistura e velocidade de soltura' },
  { id: 'badges', label: 'Badges', desc: 'Equipar badges e montar a build' },
  { id: 'mainmenu', label: 'Menu principal', desc: 'Meu Jogador (builds) e modos de jogo' },
  { id: 'resume', label: 'Continuar', desc: 'Volta ao jogo' },
] as const;
export type PauseItemId = (typeof PauseItems)[number]['id'];

/** Próxima opção selecionada na lista (anda com cima/baixo e dá a volta nas pontas). */
export function nextHubIndex(index: number, action: MenuAction, count: number): number {
  if (count <= 0) return 0;
  if (action === 'up') return (index - 1 + count) % count;
  if (action === 'down') return (index + 1) % count;
  return index;
}

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
    case 'KeyY':
      return 'save';
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

type Screen = 'menu' | 'shots';

export class PauseMenu {
  private readonly root: HTMLElement;
  private readonly view: ShotCreatorView;
  private readonly title: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly hub: HTMLElement;
  private readonly hubButtons: HTMLButtonElement[] = [];
  private readonly hints: HTMLElement;
  private readonly toast: HTMLElement;
  // Listener de teclado: só existe enquanto a tela está aberta (entra em open, sai em close).
  private readonly onKeyBound = (e: KeyboardEvent): void => this.onKey(e);
  private openState = false;
  private screen: Screen = 'menu';
  private hubIndex = 0;
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
    this.title = el('h1', 'pm-title', brand, 'MENU');
    const close = el('button', 'pm-close', header, '✕');
    close.title = 'Voltar ao jogo (Esc / B)';
    close.addEventListener('click', () => (this.screen === 'shots' ? this.view.requestClose() : this.close()));

    this.tabs = el('nav', 'pm-tabs', this.root);
    el('span', 'pm-tab active', this.tabs, 'Arremessos');

    const body = el('main', 'pm-body', this.root);
    this.hub = el('div', 'pm-hub', body);
    PauseItems.forEach((item, i) => {
      const button = el('button', 'pm-item', this.hub);
      button.type = 'button';
      el('strong', '', button, item.label);
      el('small', '', button, item.desc);
      button.addEventListener('click', () => {
        this.hubIndex = i;
        this.runItem(item.id);
      });
      this.hubButtons.push(button);
    });
    this.view = new ShotCreatorView({
      store: options.store,
      onPreview: options.onPreview,
      // Voltar no criador (depois de resolver as alterações não salvas) leva de volta à lista do menu.
      onRequestClose: () => this.showMenu(),
      onFlash: (text, error) => this.flash(text, error),
    });
    body.appendChild(this.view.root);
    // Cartão SHOT ATTRIBUTES: por cima da cena, fora do painel.
    this.root.appendChild(this.view.attrsRoot);

    const footer = el('footer', 'pm-footer', this.root);
    this.hints = el('div', 'pm-hints', footer);
    this.toast = el('div', 'pm-toast', this.root);

    (document.getElementById('hud')?.parentElement ?? document.body).appendChild(this.root);
    this.showMenu();
  }

  isOpen(): boolean {
    return this.openState;
  }

  /** Abre na lista do menu. O criador só é preparado quando a opção "Arremessos" é escolhida. */
  open(): void {
    if (this.openState) return;
    this.openState = true;
    this.waitRelease = true;
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    window.addEventListener('keydown', this.onKeyBound, true);
    this.showMenu();
  }

  /** Esconde a tela e chama onClose (o jogo retoma). */
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

  // ---------------------------------------------------------------- telas

  /** Lista inicial do menu. */
  private showMenu(): void {
    const wasShots = this.screen === 'shots';
    this.screen = 'menu';
    this.title.textContent = 'MENU';
    this.tabs.style.display = 'none';
    this.hub.style.display = '';
    this.root.classList.remove('pm--shots');
    this.view.hide();
    if (wasShots) this.options.onPreviewStop?.();
    this.renderHub();
    this.setHints([
      ['Setas / WASD', 'Mover'],
      ['Enter / A', 'Escolher'],
      ['Esc / B', 'Continuar'],
    ]);
  }

  /** Criador de arremesso, com o equipado copiado para edição. */
  private showShots(): void {
    this.screen = 'shots';
    this.title.textContent = 'ARREMESSOS';
    this.tabs.style.display = 'none';
    this.hub.style.display = 'none';
    this.root.classList.add('pm--shots');
    this.view.open();
    this.setHints([
      ['Setas / WASD', 'Mover'],
      ['← / →', 'Ajustar'],
      ['Enter / A', 'Escolher'],
      ['Y', 'Salvar'],
      ['Esc / B', 'Voltar'],
    ]);
  }

  private renderHub(): void {
    this.hubButtons.forEach((button, i) => button.classList.toggle('sel', i === this.hubIndex));
  }

  private runItem(id: PauseItemId): void {
    if (id === 'shots') this.showShots();
    else if (id === 'badges') this.suspend(this.options.onBadges);
    else if (id === 'mainmenu' && this.options.onMainMenu) this.options.onMainMenu();
    else this.close();
  }

  /**
   * Sai da tela sem retomar o jogo (quem abre outra tela, como as badges, cuida do resto). Depois, o jogo chama open() de
   * novo para voltar à lista.
   */
  private suspend(next: () => void): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
    window.removeEventListener('keydown', this.onKeyBound, true);
    this.toast.classList.remove('show');
    this.prev = {};
    this.hold = null;
    next();
  }

  private setHints(pairs: [string, string][]): void {
    this.hints.replaceChildren();
    for (const [key, label] of pairs) {
      const hint = el('span', 'pm-hint', this.hints);
      el('kbd', '', hint, key);
      hint.append(label);
    }
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
    if (!this.openState) return;
    if (this.screen === 'shots') {
      this.view.handle(action);
      return;
    }
    // Lista do menu: cima/baixo escolhe, Enter/A abre, Esc/B continua o jogo.
    if (action === 'up' || action === 'down') {
      this.hubIndex = nextHubIndex(this.hubIndex, action, PauseItems.length);
      this.renderHub();
    } else if (action === 'confirm') {
      this.runItem(PauseItems[this.hubIndex].id);
    } else if (action === 'back') {
      this.close();
    }
  }

  private flash(text: string, error = false): void {
    this.toast.textContent = text;
    this.toast.className = `pm-toast show${error ? ' error' : ''}`;
    this.toastTimer = 2.2;
  }
}
