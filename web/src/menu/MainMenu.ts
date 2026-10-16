// Tela inicial (estilo do menu do NBA 2K): os modos numa coluna à esquerda, o nosso jogador no meio e, à direita, o
// cartão da build ativa e o destaque do modo selecionado. Modos que ainda não existem aparecem com "EM DESENVOLVIMENTO"
// (dá para navegar até eles, não para entrar).
import { type MenuHint, type MenuScreen, type NavAction, el } from './MenuScreen';
import type { PlayerBuild } from '../build/PlayerBuild';
import { Positions, displayName, formatFeet, formatMeters } from '../build/PlayerBuild';
import { archetypeName, overall } from '../build/BuildRules';

export type MainMenuChoice = 'freestyle' | 'builder' | 'online';

interface ModeItem {
  id: string;
  label: string;
  desc: string;
  /** Cor do destaque à direita. */
  color: string;
  pitch: string;
  choice?: MainMenuChoice;
}

/** Modos na ordem da tela. Só os que têm `choice` entram; o resto está em desenvolvimento (docs/10-modos.md). */
export const MainModes: readonly ModeItem[] = [
  { id: 'freestyle', label: 'Freestyle', desc: 'Treino livre na quadra com a sua build', color: '#e0262f', pitch: 'Quadra só sua, bola infinita: drible, green, bandejas e enterradas com os atributos da build ativa.', choice: 'freestyle' },
  { id: 'myplayer', label: 'Meu Jogador', desc: 'MyPlayer Builder: criar, editar e trocar de build', color: '#2de0b0', pitch: 'Crie o jogador: posição, altura, peso e envergadura mudam os limites de cada atributo, como no 2K.', choice: 'builder' },
  { id: 'online', label: 'Online 1x1', desc: 'Contra um amigo pela internet', color: '#19b5e6', pitch: 'Crie uma sala e mande o código (ou o link) para o seu amigo, ou entre na partida rápida. Até 11, check-ball, limpar a bola no rebote.', choice: 'online' },
  { id: 'career', label: 'Minha Carreira', desc: 'Da quadra de rua ao profissional', color: '#2f74d8', pitch: 'A carreira começa no streetball: 1x1 e 21 na quadra do bairro, circuito 3x3, semi-pro e a liga.' },
  { id: 'oneonone', label: '1 contra 1', desc: 'Até 11, make it take it', color: '#e9a227', pitch: 'Você contra a IA (ou um amigo no sofá), com check-ball e regras de rua.' },
  { id: 'threes', label: '3x3', desc: 'Rua e FIBA 3x3', color: '#8a4bdc', pitch: 'Times de três, meia quadra, relógio de 12 s no modo FIBA.' },
  { id: 'settings', label: 'Configurações', desc: 'Controles, câmera, áudio e vídeo', color: '#5a6272', pitch: 'Mapa do controle (igual ao 2K), câmera, volume e qualidade gráfica.' },
];

export class MainMenu implements MenuScreen {
  readonly root: HTMLElement;
  readonly crumb = 'Menu principal';
  private readonly items: HTMLButtonElement[] = [];
  private readonly feature: HTMLElement;
  private readonly card: HTMLElement;
  private readonly toast: HTMLElement;
  private index = 0;
  private toastTimer = 0;

  constructor(
    private readonly getBuild: () => PlayerBuild,
    private readonly onChoose: (choice: MainMenuChoice) => void,
  ) {
    this.root = el('div', 'mn-screen');
    const grid = el('div', 'mm', this.root);
    const list = el('nav', 'mm-list', grid);
    MainModes.forEach((mode, i) => {
      const item = el('button', `mm-item${mode.choice ? '' : ' locked'}`, list);
      item.dataset.mode = mode.id;
      el('span', 'lbl', item, mode.label);
      if (!mode.choice) el('span', 'tag', item, 'EM DESENVOLVIMENTO');
      el('span', 'desc', item, mode.desc);
      item.addEventListener('mouseenter', () => this.select(i));
      item.addEventListener('click', () => {
        this.select(i);
        this.confirm();
      });
      this.items.push(item);
    });
    el('div', '', grid); // meio: o jogador 3D
    const side = el('aside', 'mm-side', grid);
    this.card = el('div', 'mm-card', side);
    this.feature = el('div', 'mm-feature', side);
    this.toast = el('div', 'mm-toast', this.root);
  }

  hints(): readonly MenuHint[] {
    return [
      { key: 'dpad', label: 'Navegar' },
      { key: 'a', label: 'Selecionar' },
    ];
  }

  enter(): void {
    this.renderCard();
    this.select(this.index);
  }

  leave(): void {
    this.toastTimer = 0;
    this.toast.classList.remove('show');
  }

  update(dt: number): void {
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toast.classList.remove('show');
  }

  nav(action: NavAction): void {
    const n = this.items.length;
    if (action === 'up') this.select((this.index - 1 + n) % n);
    else if (action === 'down') this.select((this.index + 1) % n);
    else if (action === 'confirm') this.confirm();
  }

  private select(i: number): void {
    this.index = i;
    this.items.forEach((item, k) => item.classList.toggle('on', k === i));
    const mode = MainModes[i]!;
    this.feature.style.setProperty('--feat', mode.color);
    this.feature.replaceChildren();
    el('b', '', this.feature, mode.label);
    el('p', '', this.feature, mode.pitch);
    el('span', 'state', this.feature, mode.choice ? 'DISPONÍVEL' : 'EM DESENVOLVIMENTO');
  }

  private confirm(): void {
    const mode = MainModes[this.index]!;
    if (mode.choice) {
      this.onChoose(mode.choice);
      return;
    }
    this.toast.textContent = `${mode.label}: em desenvolvimento`;
    this.toast.classList.add('show');
    this.toastTimer = 1.8;
  }

  private renderCard(): void {
    const b = this.getBuild();
    this.card.replaceChildren();
    el('h3', '', this.card, 'BUILD ATIVA');
    el('div', 'name', this.card, displayName(b));
    el('div', 'arch', this.card, archetypeName(b));
    const facts = el('div', 'facts', this.card);
    const fact = (k: string, v: string): void => {
      const d = el('div', '', facts);
      el('span', '', d, k);
      el('b', '', d, v);
    };
    fact('OVR', String(overall(b)));
    fact('POS', Positions[b.position].label);
    fact('ALTURA', formatFeet(b.body.heightCm));
    this.card.title = `${Positions[b.position].full} · ${formatMeters(b.body.heightCm)}`;
  }
}
