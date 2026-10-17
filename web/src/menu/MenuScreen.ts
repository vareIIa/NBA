// Contrato das telas do menu principal (MenuFlow.ts). Cada tela é um bloco de HTML que o fluxo monta por cima do
// canvas; o fluxo lê teclado e controle e entrega uma ação de navegação por vez (já com repetição de direção segurada).
// A cena 3D (o nosso jogador no meio, no lugar do LeBron das telas do 2K) é do Showroom: a tela só diz qual corpo mostrar.
import type { Body } from '../build/PlayerBuild';
import type { PlayerLook, Side } from '../build/PlayerLook';
import type { ShowroomFocus } from './Showroom';

/**
 * Ação de navegação. `alt` = Y no controle / Tab no teclado (ação secundária da tela, ex.: "presets");
 * `prevTab`/`nextTab` = LB/RB ou Q/E (trocar de aba ou de grupo de atributos).
 */
export type NavAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'alt' | 'prevTab' | 'nextTab';

/** Dica de botão no rodapé. O fluxo desenha o glifo do controle ou a tecla, conforme o último aparelho usado. */
export interface MenuHint {
  key: 'a' | 'b' | 'y' | 'lb' | 'rb' | 'dpad';
  label: string;
}

export interface MenuScreen {
  /** Raiz da tela (o fluxo a coloca dentro da moldura do menu). */
  readonly root: HTMLElement;
  /** Caminho no topo (ex.: "MYPLAYER BUILDER · ATRIBUTOS"). */
  readonly crumb: string;
  /** Dicas do rodapé desta tela. */
  hints(): readonly MenuHint[];
  /** Onde o jogador 3D fica na tela (−1 esquerda … 0 meio … 1 direita). Padrão 0. */
  showroomOffset?: number;
  /** A tela entrou (foco no primeiro item, animação de entrada). */
  enter(): void;
  /** A tela saiu (para timers e listeners próprios). */
  leave(): void;
  /** Uma ação de navegação do teclado ou do controle. */
  nav(action: NavAction): void;
  /** Corpo que o showroom mostra agora (altura e envergadura do rascunho). null = o corpo da build ativa. */
  body?(): Body | null;
  /** Aparência que o showroom veste agora (o rascunho da tela de aparência). null = a da build ativa. */
  look?(): PlayerLook | null;
  /** Qual uniforme (casa ou visitante) a tela está editando: é o que o showroom veste (padrão: casa). */
  wear?(): Side;
  /** O que a câmera do showroom enquadra (padrão: o corpo inteiro). */
  focus?(): ShowroomFocus;
  /** Por quadro, enquanto a tela está aberta (animações de barra, contadores). */
  update?(dt: number): void;
}

/** Atalho de criação de elemento com classe (o mesmo do PauseMenu). */
export function el<K extends keyof HTMLElementTagNameMap>(
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

/** Tecla (KeyboardEvent.code) para ação de navegação. Setas/WASD andam, Enter/Espaço confirmam, Esc/Backspace voltam. */
export function keyToNav(code: string): NavAction | null {
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
    case 'Backspace':
      return 'back';
    case 'Tab':
      return 'alt';
    case 'KeyQ':
    case 'PageUp':
      return 'prevTab';
    case 'KeyE':
    case 'PageDown':
      return 'nextTab';
    default:
      return null;
  }
}
