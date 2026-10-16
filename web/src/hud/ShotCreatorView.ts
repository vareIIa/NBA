// Criador de arremesso, no layout do 2K (Jump Shot Creator). Painel à esquerda (PauseMenu marca .pm--shots e a cena 3D
// aparece à direita). Coluna de quatro cartões: três famílias (base e as duas camadas de cima) e a mistura. A coluna da
// direita mostra o slot ativo: a tabela de animações (notas por linha) ou o painel de mistura (visual cue, velocidade
// de soltura, mistura e losango). O cartão SHOT ATTRIBUTES fica por cima da cena. A prévia repete o arremesso em
// montagem; focar uma linha da tabela já mostra essa escolha (sem gravar).
// Trabalha numa cópia (ShotEditor): só Salvar, Equipar e Apagar gravam no JumpShotStore.
// A parte sem DOM (rótulos, passos, estado da cópia e navegação) é exportada e testada em ShotCreatorView.test.ts.
import './shotcreator.css';
import { ReleaseSpeed } from '../sim/HoopsShotModel';
import { ShotSignatures } from '../shot/ShotForms';
import {
  type JumpShotSetup,
  type JumpShotStore,
  type ShotAttributes,
  type ShotFamily,
  MaxSetups,
  ShotFamilies,
  defaultSetup,
  gradeOf,
  shotAttributes,
  signatureAttributes,
  upperWeights,
} from '../shot/JumpShotSetup';
import { BaseIcon, MixIcon, UpperIcon } from './shotIcons';

/** Ação de navegação: vem do teclado ou do controle (PauseMenu.update). `save` é o Y (ou a tecla Y). */
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'save';
export type Dir = 'up' | 'down' | 'left' | 'right';

/** Campo de família do arremesso (um por cartão de família). */
type Slot = 'lowerBase' | 'upperRelease1' | 'upperRelease2';
type Editable = Slot | 'blendPercent' | 'releaseSpeed';
type ButtonId = 'new' | 'save' | 'equip' | 'delete' | 'test' | 'back';

/** Cartões da coluna esquerda. Os três primeiros são famílias; o último é a mistura e a velocidade. */
export const CardLabels = ['Corpo de baixo', 'Camada de cima 1', 'Camada de cima 2', 'Mistura e velocidade de soltura'] as const;
const FamilySlots: readonly Slot[] = ['lowerBase', 'upperRelease1', 'upperRelease2'];
/** Índice do cartão de mistura (o último). */
const MixCard = 3;

/** Rótulos das famílias: o nome do jogador de referência (src/shot/ShotForms.ts). */
export const FamilyLabels = Object.fromEntries(ShotFamilies.map((f) => [f, ShotSignatures[f].label])) as Record<ShotFamily, string>;

export const SpeedLabels: Record<ReleaseSpeed, string> = {
  [ReleaseSpeed.Quick]: 'Rápida',
  [ReleaseSpeed.Normal]: 'Normal',
  [ReleaseSpeed.Slow]: 'Lenta',
};
/** Passos da barra de velocidade, na ordem da tela. */
export const SpeedSteps: readonly ReleaseSpeed[] = [ReleaseSpeed.Quick, ReleaseSpeed.Normal, ReleaseSpeed.Slow];

/** Passo da barra de mistura (0 a 100). */
export const BlendStep = 5;

/** Colunas da tabela de animações e a ordem dos atributos em cada linha. */
export const TableColumns = ['ANIMAÇÃO', 'ALT. SOLT.', 'IMUN. DEF.', 'VEL. SOLT.', 'EST. TIM.'] as const;

/** Atributos do cartão SHOT ATTRIBUTES, na ordem da tela (duas colunas, de cima para baixo). */
export const AttributeNames = ['Altura de soltura', 'Velocidade de soltura', 'Imunidade defensiva', 'Estabilidade do timing'] as const;

/** Limita um índice ao intervalo da lista (sem dar a volta). */
export function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), Math.max(length - 1, 0));
}

/** Arredonda a porcentagem para o passo da barra e limita a 0..100. */
export function snapBlend(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value / BlendStep) * BlendStep));
}

/** Um passo na barra de mistura. `wrap` dá a volta (100 vira 0), que é o que o Enter faz. */
export function stepBlend(blend: number, dir: -1 | 1, wrap = false): number {
  const next = snapBlend(blend) + dir * BlendStep;
  if (wrap && (next > 100 || next < 0)) return dir > 0 ? 0 : 100;
  return snapBlend(next);
}

/** Um passo na barra de velocidade (para nas pontas, ou dá a volta com `wrap`). */
export function stepSpeed(speed: ReleaseSpeed, dir: -1 | 1, wrap = false): ReleaseSpeed {
  const n = SpeedSteps.length;
  const next = Math.max(0, SpeedSteps.indexOf(speed)) + dir;
  return SpeedSteps[wrap ? (next + n) % n : clampIndex(next, n)];
}

/** Porcentagem de cada camada de cima. Usa upperWeights; a camada 2 é o complemento, então X + Y = 100 sempre. */
export function blendShares(blend: number): { layer1: number; layer2: number } {
  const layer1 = Math.round(upperWeights(blend).upper1 * 100);
  return { layer1, layer2: 100 - layer1 };
}

/** Nome de um arremesso novo: "Meu arremesso", e a partir do segundo "Meu arremesso N" (N é o número do id). */
export function draftName(id: string): string {
  const n = Number(id.replace(/^arremesso-/, ''));
  return Number.isInteger(n) && n > 1 ? `Meu arremesso ${n}` : 'Meu arremesso';
}

/** Compara os campos do arremesso. É assim que se sabe se há alterações não salvas. */
export function sameSetup(a: JumpShotSetup, b: JumpShotSetup): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.lowerBase === b.lowerBase &&
    a.upperRelease1 === b.upperRelease1 &&
    a.upperRelease2 === b.upperRelease2 &&
    a.blendPercent === b.blendPercent &&
    a.releaseSpeed === b.releaseSpeed
  );
}

/** Chave do que aparece na cena: muda quando a prévia precisa começar de novo. */
export function previewKey(s: JumpShotSetup): string {
  return [s.lowerBase, s.upperRelease1, s.upperRelease2, s.blendPercent, s.releaseSpeed].join('|');
}

/**
 * Arremesso mostrado agora: a cópia, com a família da linha focada da tabela no lugar da família do slot. Só a prévia
 * usa isso; a cópia (e o que se salva) muda só com Enter ou clique na linha.
 */
export function withRowPreview(setup: JumpShotSetup, focus: string, slot: number): JumpShotSetup {
  if (!focus.startsWith('opt:') || slot < 0 || slot > 2) return setup;
  const family = focus.slice(4);
  if (!(ShotFamilies as readonly string[]).includes(family)) return setup;
  return { ...setup, [FamilySlots[slot]]: family as ShotFamily };
}

/** O que a navegação precisa saber da faixa, dos botões e da tabela neste momento. */
export interface NavContext {
  /** Chips da faixa, na ordem em que aparecem. */
  chips: string[];
  /** Botões habilitados, na ordem. */
  buttons: string[];
  /** Chip do arremesso em edição: é para onde o foco volta ao descer dos cartões ou subir dos botões. */
  editing: string;
  /** Cartão do slot ativo (card:0..3): Esquerda e Esc levam de volta a ele a partir do conteúdo. */
  home: string;
  /** Família de cada slot de família (base, camada 1, camada 2): a linha que o foco pega ao entrar pela direita. */
  current: string[];
}

function pick(list: readonly string[], index: number): string | null {
  return list.length > 0 ? list[clampIndex(index, list.length)] : null;
}

/**
 * Vizinho do foco na grade da tela, ou null quando o foco não anda. Esquerda e direita sobre a barra de velocidade ou
 * de mistura são ajuste de valor, então não passam por aqui.
 */
export function navNeighbor(focus: string, dir: Dir, ctx: NavContext): string | null {
  const side = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  if (focus.startsWith('chip:')) {
    if (side) return pick(ctx.chips, ctx.chips.indexOf(focus) + side);
    if (dir === 'up') return ctx.home;
    if (dir === 'down') return pick(ctx.buttons, 0);
    return null;
  }
  if (focus.startsWith('btn:')) {
    if (side) return pick(ctx.buttons, ctx.buttons.indexOf(focus) + side);
    return dir === 'up' ? ctx.editing : null;
  }
  if (focus.startsWith('opt:')) {
    const i = ShotFamilies.indexOf(focus.slice(4) as ShotFamily);
    if (dir === 'up') return i > 0 ? `opt:${ShotFamilies[i - 1]}` : null;
    if (dir === 'down') return i < ShotFamilies.length - 1 ? `opt:${ShotFamilies[i + 1]}` : null;
    return dir === 'left' ? ctx.home : null;
  }
  if (focus === 'speed') return dir === 'down' ? 'blend' : null;
  if (focus === 'blend') return dir === 'up' ? 'speed' : dir === 'down' ? ctx.editing : null;
  const card = /^card:([0-3])$/.exec(focus);
  if (card) {
    const n = Number(card[1]);
    if (dir === 'up') return n > 0 ? `card:${n - 1}` : null;
    if (dir === 'down') return n < MixCard ? `card:${n + 1}` : ctx.editing;
    if (dir === 'right') return n < MixCard ? `opt:${ctx.current[n]}` : 'speed';
    return null;
  }
  return null;
}

/** -1 para cima e esquerda, +1 para baixo e direita (nas listas), 0 para as demais ações. */
function stepOf(action: MenuAction): number {
  if (action === 'up' || action === 'left') return -1;
  if (action === 'down' || action === 'right') return 1;
  return 0;
}

/**
 * Estado da edição, sem DOM. Guarda uma cópia de trabalho do arremesso e a versão gravada no store (`saved`), que é null
 * quando a cópia é um rascunho ("Novo") ainda fora do store. Campos mudam só na cópia; `save`, `equip` e `remove` são
 * os únicos métodos que gravam.
 */
export class ShotEditor {
  private working: JumpShotSetup;
  private saved: JumpShotSetup | null;

  constructor(private readonly store: JumpShotStore) {
    this.working = store.equipped();
    this.saved = store.get(this.working.id) ?? null;
  }

  /** Cópia do arremesso em edição (o que o "Testar" recebe, com ou sem alterações). */
  get setup(): JumpShotSetup {
    return { ...this.working };
  }

  get id(): string {
    return this.working.id;
  }

  isStored(): boolean {
    return this.saved !== null;
  }

  isDirty(): boolean {
    return this.saved === null || !sameSetup(this.working, this.saved);
  }

  isEquipped(): boolean {
    return this.saved !== null && this.store.equipped().id === this.working.id;
  }

  equippedId(): string {
    return this.store.equipped().id;
  }

  list(): JumpShotSetup[] {
    return this.store.list();
  }

  canCreate(): boolean {
    return this.store.list().length < MaxSetups;
  }

  /** Só dá para apagar um arremesso salvo, e só se sobrar pelo menos outro. */
  canDelete(): boolean {
    return this.saved !== null && this.store.list().length > 1;
  }

  patch(changes: Partial<Pick<JumpShotSetup, Editable>>): void {
    this.working = { ...this.working, ...changes };
  }

  /** Abre um arremesso salvo para editar (a cópia atual é descartada). */
  load(id: string): boolean {
    const stored = this.store.get(id);
    if (!stored) return false;
    this.working = { ...stored };
    this.saved = { ...stored };
    return true;
  }

  loadEquipped(): void {
    this.load(this.store.equipped().id);
  }

  /** Começa um arremesso novo, com o padrão do modelo e o próximo id livre. */
  newDraft(): boolean {
    if (!this.canCreate()) return false;
    const id = this.store.nextId();
    this.working = defaultSetup(id, draftName(id));
    this.saved = null;
    return true;
  }

  /** Grava a cópia no store (um arremesso novo entra no fim). */
  save(): boolean {
    if (!this.store.upsert(this.working)) return false;
    const stored = this.store.get(this.working.id);
    if (stored) {
      this.working = { ...stored };
      this.saved = { ...stored };
    }
    return true;
  }

  /** Volta à versão gravada. Um rascunho volta ao arremesso equipado. */
  discard(): void {
    if (this.saved) this.working = { ...this.saved };
    else this.loadEquipped();
  }

  /** Equipa o arremesso em edição. Precisa estar salvo e sem alterações. */
  equip(): boolean {
    if (this.saved === null || this.isDirty()) return false;
    return this.store.equip(this.working.id);
  }

  /** Apaga o arremesso em edição; a edição passa para o equipado. */
  remove(): boolean {
    if (!this.canDelete() || !this.store.remove(this.working.id)) return false;
    this.loadEquipped();
    return true;
  }
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

export interface ShotCreatorOptions {
  store: JumpShotStore;
  /**
   * Prévia do arremesso (a cena repete este arremesso). Chamada quando o que aparece muda (cópia ou linha focada).
   * `restart` reinicia mesmo sem mudança ("Testar arremesso").
   */
  onPreview: (setup: JumpShotSetup, restart?: boolean) => void;
  /** Pedido de saída (Voltar, Esc/B ou ✕), já depois do aviso de alterações não salvas. */
  onRequestClose: () => void;
  /** Mensagem rápida no menu (em vermelho quando `error`). */
  onFlash: (text: string, error?: boolean) => void;
}

interface Choice {
  label: string;
  danger?: boolean;
  /** Ação da escolha. Sem ela, a escolha só fecha o aviso. */
  run?: () => void;
}

interface Dialog {
  title: string;
  text: string;
  choices: Choice[];
  /** Escolha que começa com o foco. */
  index: number;
}

interface RowEls {
  family: ShotFamily;
  row: HTMLElement;
  star: HTMLElement;
}

export class ShotCreatorView {
  readonly root: HTMLElement;
  /** Cartão SHOT ATTRIBUTES: fica por cima da cena, fora do painel (PauseMenu o põe na moldura). */
  readonly attrsRoot: HTMLElement;
  private readonly editor: ShotEditor;
  /** Foco atual: a data-key de um elemento (card:0..3, opt:<família>, speed, blend, chip:<id>, btn:<nome>, choice:<i>). */
  private focus = 'card:0';
  /** Slot ativo (0..2 famílias, 3 mistura): é o que a coluna da direita mostra. */
  private slot = 0;
  /** Foco de onde saiu uma tela sobreposta (aviso), para voltar a ele ao fechar. */
  private returnFocus = 'card:0';
  private dialog: Dialog | null = null;
  private dragging = false;
  /** Só há prévia com a tela aberta (open) e enquanto ela não sai (hide). */
  private active = false;
  private lastPreview: string | null = null;

  private readonly nameEl: HTMLElement;
  private readonly stateEl: HTMLElement;
  private readonly cardEls: HTMLButtonElement[] = [];
  private readonly cardValues: HTMLElement[] = [];
  private readonly tableEl: HTMLElement;
  private readonly tableTitle: HTMLElement;
  private readonly rowEls: RowEls[] = [];
  private readonly mixEl: HTMLElement;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly track: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly layerNames: HTMLElement[] = [];
  private readonly layerPcts: HTMLElement[] = [];
  private readonly diamondFill: SVGRectElement;
  private readonly attrBars: { fill: HTMLElement; grade: HTMLElement }[] = [];
  private readonly chipsEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly buttonEls: Record<ButtonId, HTMLButtonElement>;
  private readonly modalEl: HTMLElement;
  private readonly modalTitle: HTMLElement;
  private readonly modalText: HTMLElement;
  private readonly modalChoices: HTMLElement;

  constructor(private readonly options: ShotCreatorOptions) {
    this.editor = new ShotEditor(options.store);
    this.root = el('section', 'sc');
    this.root.setAttribute('aria-label', 'Criador de arremesso');
    this.root.hidden = true;

    // Cabeçalho: título com o nome do arremesso em edição, a situação e o ✕.
    const head = el('header', 'sc-head', this.root);
    const title = el('h2', 'sc-title', head);
    el('span', 'sc-title-kicker', title, 'EDITANDO ARREMESSO:');
    title.append(' ');
    this.nameEl = el('span', 'sc-title-name', title);
    this.stateEl = el('span', 'sc-state', head);
    const close = el('button', 'sc-x', head, '✕');
    close.type = 'button';
    close.title = 'Voltar (Esc / B)';
    close.addEventListener('click', () => this.requestClose());

    const main = el('div', 'sc-main', this.root);

    // Coluna esquerda: os quatro cartões (ícone, nome do jogador ou o resumo da mistura).
    const cards = el('div', 'sc-cards', main);
    const icons = [BaseIcon, UpperIcon, UpperIcon, MixIcon];
    CardLabels.forEach((label, i) => {
      const card = el('button', 'sc-card', cards);
      card.type = 'button';
      card.dataset.key = `card:${i}`;
      card.title = label;
      el('span', 'sc-card-bar', card, i === MixCard ? 'Mistura' : label.replace('Camada de cima', 'Camada').replace('Corpo de baixo', 'Base'));
      el('span', 'sc-card-icon', card).innerHTML = icons[i];
      this.cardValues.push(el('span', 'sc-card-value', card));
      card.addEventListener('click', () => {
        this.setFocus(`card:${i}`);
        this.onConfirm();
      });
      this.cardEls.push(card);
    });

    // Conteúdo da direita, um de cada vez (o slot ativo decide): tabela de famílias ou painel de mistura.
    const content = el('div', 'sc-content', main);
    this.tableEl = el('section', 'sc-table', content);
    this.tableTitle = el('h3', 'sc-sec-title', this.tableEl);
    const table = el('table', 'sc-grid', this.tableEl);
    const headRow = el('tr', '', el('thead', '', table));
    TableColumns.forEach((col, i) => el('th', i === 0 ? 'sc-th-name' : 'sc-th', headRow, col));
    const tbody = el('tbody', '', table);
    for (const family of ShotFamilies) {
      const row = el('tr', 'sc-row', tbody);
      row.dataset.key = `opt:${family}`;
      row.addEventListener('click', () => {
        this.setFocus(`opt:${family}`);
        this.onConfirm();
      });
      const name = el('td', 'sc-row-name', row);
      const star = el('span', 'sc-row-star', name);
      el('span', 'sc-row-label', name, FamilyLabels[family]);
      el('span', 'sc-row-traits', name, ShotSignatures[family].traits);
      // Notas: a mesma ordem das colunas (alt. soltura, imunidade, velocidade, estabilidade). Não mudam com a escolha.
      const a = signatureAttributes(family);
      const grades = [a.releaseHeight, a.defensiveImmunity, a.releaseSpeed, a.timingStability];
      for (const v of grades) el('td', 'sc-grade', row, gradeOf(v));
      this.rowEls.push({ family, row, star });
    }
    const legend = el('p', 'sc-legend', this.tableEl);
    el('span', 'sc-legend-star', legend, '★ Equipado');
    el('span', 'sc-legend-unlocked', legend, '■ Desbloqueado');

    this.mixEl = el('section', 'sc-mix', content);
    // Velocidade de soltura: três passos.
    const speedBox = el('div', 'sc-block', this.mixEl);
    el('h4', 'sc-label', speedBox, 'VELOCIDADE DE SOLTURA');
    const steps = el('div', 'sc-steps', speedBox);
    steps.dataset.key = 'speed';
    for (const speed of SpeedSteps) {
      const step = el('button', 'sc-step', steps, SpeedLabels[speed]);
      step.type = 'button';
      step.addEventListener('click', () => {
        this.setFocus('speed');
        this.setSpeed(speed);
      });
      this.speedButtons.push(step);
    }
    // Mistura de animação: arrasta ou clica (ou setas, de 5 em 5).
    const blendBox = el('div', 'sc-block', this.mixEl);
    el('h4', 'sc-label', blendBox, 'MISTURA DE ANIMAÇÃO');
    this.track = el('div', 'sc-track', blendBox);
    this.track.dataset.key = 'blend';
    this.fill = el('div', 'sc-track-fill', this.track);
    this.thumb = el('div', 'sc-track-thumb', this.track);
    this.track.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.track.setPointerCapture(e.pointerId);
      this.setFocus('blend');
      this.blendFromPointer(e);
    });
    this.track.addEventListener('pointermove', (e) => {
      if (this.dragging) this.blendFromPointer(e);
    });
    const release = () => {
      this.dragging = false;
    };
    this.track.addEventListener('pointerup', release);
    this.track.addEventListener('pointercancel', release);
    // Losango: nome e porcentagem de cada camada; o losango enche de baixo para cima com a camada 2.
    const diamondBox = el('div', 'sc-diamond', this.mixEl);
    const names = el('div', 'sc-diamond-values', diamondBox);
    for (let i = 0; i < 2; i++) {
      const layer = el('div', 'sc-layer', names);
      this.layerNames.push(el('h4', 'sc-label', layer));
      this.layerPcts.push(el('span', `sc-pct${i === 1 ? ' is-second' : ''}`, layer));
    }
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('class', 'sc-diamond-svg');
    svg.setAttribute('aria-hidden', 'true');
    const cx = 100;
    const half = 92;
    const diamondPts = (r: number): string => {
      const cy = 100;
      return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
    };
    const defs = document.createElementNS(svgNS, 'defs');
    const clip = document.createElementNS(svgNS, 'clipPath');
    clip.setAttribute('id', 'sc-diamond-clip');
    const clipShape = document.createElementNS(svgNS, 'polygon');
    clipShape.setAttribute('points', diamondPts(half));
    clip.appendChild(clipShape);
    defs.appendChild(clip);
    svg.appendChild(defs);
    for (const r of [half, 70, 50, 30]) {
      const ring = document.createElementNS(svgNS, 'polygon');
      ring.setAttribute('points', diamondPts(r));
      ring.setAttribute('class', r === half ? 'sc-diamond-edge' : 'sc-diamond-ring');
      svg.appendChild(ring);
    }
    this.diamondFill = document.createElementNS(svgNS, 'rect') as SVGRectElement;
    this.diamondFill.setAttribute('x', '0');
    this.diamondFill.setAttribute('width', '200');
    this.diamondFill.setAttribute('height', '200');
    this.diamondFill.setAttribute('y', '192');
    this.diamondFill.setAttribute('clip-path', 'url(#sc-diamond-clip)');
    this.diamondFill.setAttribute('class', 'sc-diamond-fill');
    svg.appendChild(this.diamondFill);
    diamondBox.appendChild(svg);

    // Faixa de arremessos salvos e botões de ação.
    const strip = el('section', 'sc-strip', this.root);
    const stripHead = el('div', 'sc-strip-head', strip);
    el('span', 'sc-strip-title', stripHead, 'Arremessos salvos');
    this.countEl = el('span', 'sc-strip-count', stripHead);
    this.chipsEl = el('div', 'sc-chips', strip);
    const actions = el('div', 'sc-actions', strip);
    this.buttonEls = {
      new: this.button(actions, 'new', 'Novo', ''),
      save: this.button(actions, 'save', 'Salvar', ''),
      equip: this.button(actions, 'equip', 'Equipar', ''),
      delete: this.button(actions, 'delete', 'Apagar', 'danger'),
      test: this.button(actions, 'test', 'Testar arremesso', ''),
      back: this.button(actions, 'back', 'Voltar', 'ghost'),
    };

    // Aviso (alterações não salvas, apagar).
    this.modalEl = el('div', 'sc-overlay sc-modal', this.root);
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) this.closeDialog();
    });
    const box = el('div', 'sc-modal-box', this.modalEl);
    this.modalTitle = el('h3', 'sc-modal-title', box);
    this.modalText = el('p', 'sc-modal-text', box);
    this.modalChoices = el('div', 'sc-modal-choices', box);

    // Cartão de atributos (fora do painel).
    // Classe sc também no cartão: ele fica fora da raiz .sc, e sem ela as cores (--sc-*) não chegavam.
    this.attrsRoot = el('section', 'sc sc-attrs');
    this.attrsRoot.hidden = true;
    el('div', 'sc-attrs-title', this.attrsRoot, 'SHOT ATTRIBUTES');
    const grid = el('div', 'sc-attrs-grid', this.attrsRoot);
    for (const name of AttributeNames) {
      const item = el('div', 'sc-attr', grid);
      el('span', 'sc-attr-name', item, name);
      const bar = el('span', 'sc-attr-bar', item);
      const fill = el('span', 'sc-attr-fill', bar);
      const grade = el('span', 'sc-attr-grade', item);
      this.attrBars.push({ fill, grade });
    }

    this.paint();
  }

  /** Abre a aba: copia o arremesso equipado e foca o primeiro cartão. A prévia começa com o que aparece. */
  open(): void {
    this.editor.loadEquipped();
    this.dialog = null;
    this.dragging = false;
    this.active = true;
    this.slot = 0;
    this.focus = 'card:0';
    this.returnFocus = 'card:0';
    this.lastPreview = null;
    this.root.hidden = false;
    this.attrsRoot.hidden = false;
    // O HUD do jogo (placar, dicas, medidor) sai enquanto o criador está aberto: a cena fica só com o boneco.
    document.body.classList.add('sc-open');
    this.paint();
  }

  /** Esconde o criador (o menu volta para a lista). A prévia para por quem chama (PauseMenu.onPreviewStop). */
  hide(): void {
    this.active = false;
    this.dialog = null;
    this.root.hidden = true;
    this.attrsRoot.hidden = true;
    document.body.classList.remove('sc-open');
  }

  /** Pedido de saída (Voltar, Esc/B ou ✕). Fecha antes o aviso que estiver aberto; com alterações, pergunta. */
  requestClose(): void {
    if (this.dialog) return this.closeDialog();
    this.requestLeave(() => this.options.onRequestClose());
  }

  /** Uma ação de navegação (teclado ou controle). */
  handle(action: MenuAction): void {
    const d = this.dialog;
    if (d) return this.handleDialog(d, action);
    if (action === 'save') return this.saveOrHint();
    if (action === 'confirm') return this.onConfirm();
    if (action === 'back') return this.onBack();
    this.onDirection(action);
  }

  // ---------------------------------------------------------------- entrada

  private handleDialog(d: Dialog, action: MenuAction): void {
    if (action === 'back') return this.closeDialog();
    if (action === 'confirm') return this.chooseDialog(d.index);
    const step = stepOf(action);
    if (step === 0) return;
    d.index = clampIndex(d.index + step, d.choices.length);
    this.focus = `choice:${d.index}`;
    this.paint();
  }

  private onDirection(dir: Dir): void {
    const side = dir === 'left' ? -1 : dir === 'right' ? 1 : null;
    const s = this.editor.setup;
    if (side !== null && this.focus === 'speed') return this.setSpeed(stepSpeed(s.releaseSpeed, side));
    if (side !== null && this.focus === 'blend') return this.setBlend(stepBlend(s.blendPercent, side));
    const next = navNeighbor(this.focus, dir, this.navContext());
    if (next !== null) this.moveTo(next);
  }

  private onConfirm(): void {
    const f = this.focus;
    if (f.startsWith('card:')) {
      // Enter num cartão entra no conteúdo: a tabela (famílias) ou o painel de velocidade (mistura).
      const next = navNeighbor(f, 'right', this.navContext());
      if (next) this.moveTo(next);
      return;
    }
    if (f.startsWith('opt:')) return this.pickFamily(f.slice(4) as ShotFamily);
    const s = this.editor.setup;
    if (f === 'speed') return this.setSpeed(stepSpeed(s.releaseSpeed, 1, true));
    if (f === 'blend') return this.setBlend(stepBlend(s.blendPercent, 1, true));
    this.activate(f);
  }

  private onBack(): void {
    if (this.focus.startsWith('opt:') || this.focus === 'speed' || this.focus === 'blend') {
      return this.setFocus(`card:${this.slot}`);
    }
    this.requestClose();
  }

  private activate(key: string): void {
    if (key.startsWith('chip:')) return this.pickChip(key.slice(5));
    switch (key) {
      case 'btn:new':
        return this.requestLeave(() => this.createDraft());
      case 'btn:save':
        this.save();
        return;
      case 'btn:equip':
        return this.equip();
      case 'btn:delete':
        return this.askDelete();
      case 'btn:test':
        return this.preview(true);
      case 'btn:back':
        return this.requestClose();
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- ações

  private pickChip(id: string): void {
    if (id === this.editor.id) return;
    this.requestLeave(() => {
      if (this.editor.load(id)) this.setFocus(`chip:${id}`);
    });
  }

  /** Escolhe a família da linha no slot ativo. Só mexe na cópia; o foco fica na linha. */
  private pickFamily(family: ShotFamily): void {
    if (this.slot > 2) return;
    const change: Partial<Pick<JumpShotSetup, Slot>> = {};
    change[FamilySlots[this.slot]] = family;
    this.editor.patch(change);
    this.paint();
  }

  private openDialog(d: Dialog): void {
    this.dialog = d;
    this.returnFocus = this.focus;
    this.focus = `choice:${d.index}`;
    this.paint();
  }

  private chooseDialog(i: number): void {
    const d = this.dialog;
    if (!d) return;
    this.dialog = null;
    this.focus = this.returnFocus;
    this.paint();
    d.choices[i].run?.();
  }

  private closeDialog(): void {
    this.dialog = null;
    this.focus = this.returnFocus;
    this.paint();
  }

  /** Antes de trocar de arremesso ou sair: com alterações não salvas, pergunta (salvar, descartar ou continuar). */
  private requestLeave(then: () => void): void {
    if (!this.editor.isDirty()) return then();
    this.openDialog({
      title: 'Alterações não salvas',
      text: `«${this.editor.setup.name}» tem mudanças que ainda não foram salvas.`,
      choices: [
        {
          label: 'Salvar',
          run: () => {
            if (this.save()) then();
          },
        },
        {
          label: 'Descartar',
          run: () => {
            this.editor.discard();
            then();
          },
        },
        { label: 'Continuar editando' },
      ],
      index: 0,
    });
  }

  private askDelete(): void {
    if (!this.editor.canDelete()) return;
    this.openDialog({
      title: 'Apagar arremesso',
      text: `Apagar «${this.editor.setup.name}»? Isso não pode ser desfeito.`,
      choices: [{ label: 'Apagar', danger: true, run: () => this.removeTarget() }, { label: 'Cancelar' }],
      index: 1,
    });
  }

  private removeTarget(): void {
    const name = this.editor.setup.name;
    if (!this.editor.remove()) {
      this.options.onFlash('Não deu para apagar este arremesso', true);
      return;
    }
    this.options.onFlash(`«${name}» apagado`);
    this.paint();
  }

  private createDraft(): void {
    if (!this.editor.newDraft()) {
      this.options.onFlash(`A lista está cheia (${MaxSetups} arremessos)`, true);
      return;
    }
    this.setFocus(`chip:${this.editor.id}`);
  }

  /** Y: salva; sem alterações, só avisa. */
  private saveOrHint(): void {
    if (!this.editor.isDirty()) return this.options.onFlash('Nada para salvar');
    this.save();
  }

  /** Salvar: grava a cópia no store. Devolve se deu certo. */
  private save(): boolean {
    if (!this.editor.save()) {
      this.options.onFlash('Não deu para salvar este arremesso', true);
      return false;
    }
    this.options.onFlash(`«${this.editor.setup.name}» salvo`);
    this.paint();
    return true;
  }

  private equip(): void {
    if (!this.editor.isStored()) {
      this.options.onFlash('Salve o arremesso novo antes de equipar', true);
      return;
    }
    if (this.editor.isDirty()) {
      this.options.onFlash('Salve as alterações antes de equipar', true);
      return;
    }
    if (!this.editor.equip()) {
      this.options.onFlash('Não deu para equipar este arremesso', true);
      return;
    }
    this.options.onFlash(`«${this.editor.setup.name}» equipado`);
    this.paint();
  }

  /** Mostrado agora: a cópia, com a linha focada da tabela no lugar do slot. */
  private shown(): JumpShotSetup {
    return withRowPreview(this.editor.setup, this.focus, this.slot);
  }

  /** Prévia explícita ("Testar arremesso"): reinicia a cena com o que aparece. */
  private preview(restart: boolean): void {
    const shown = this.shown();
    this.lastPreview = previewKey(shown);
    this.options.onPreview(shown, restart);
  }

  private setSpeed(speed: ReleaseSpeed): void {
    this.editor.patch({ releaseSpeed: speed });
    this.paint();
  }

  private setBlend(value: number): void {
    this.editor.patch({ blendPercent: snapBlend(value) });
    this.paint();
  }

  private blendFromPointer(e: PointerEvent): void {
    const rect = this.track.getBoundingClientRect();
    if (rect.width > 0) this.setBlend(((e.clientX - rect.left) / rect.width) * 100);
  }

  // ---------------------------------------------------------------- foco

  private setFocus(key: string): void {
    this.focus = key;
    if (key.startsWith('card:')) this.slot = Number(key.slice(5));
    this.paint();
  }

  /** Foco por teclado ou controle: troca e leva o item para dentro da área de rolagem. */
  private moveTo(key: string): void {
    this.setFocus(key);
    this.root.querySelector<HTMLElement>(`[data-key="${key}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private navContext(): NavContext {
    const s = this.editor.setup;
    return {
      chips: this.chipKeys(),
      buttons: this.buttonKeys(),
      editing: `chip:${this.editor.id}`,
      home: `card:${this.slot}`,
      current: FamilySlots.map((slot) => s[slot]),
    };
  }

  /** Chips da faixa: os salvos e, no fim, o rascunho (se houver). */
  private chipKeys(): string[] {
    const keys = this.editor.list().map((s) => `chip:${s.id}`);
    if (!this.editor.isStored()) keys.push(`chip:${this.editor.id}`);
    return keys;
  }

  /** Botões habilitados agora. Salvar, Testar e Voltar estão sempre disponíveis. */
  private buttonState(): Record<ButtonId, boolean> {
    return {
      new: this.editor.canCreate(),
      save: true,
      equip: this.editor.isStored() && !this.editor.isEquipped(),
      delete: this.editor.canDelete(),
      test: true,
      back: true,
    };
  }

  private buttonKeys(): string[] {
    const state = this.buttonState();
    return (Object.keys(state) as ButtonId[]).filter((id) => state[id]).map((id) => `btn:${id}`);
  }

  // ---------------------------------------------------------------- desenho

  private button(parent: HTMLElement, id: ButtonId, label: string, variant: string): HTMLButtonElement {
    const b = el('button', `sc-btn${variant ? ` ${variant}` : ''}`, parent, label);
    b.type = 'button';
    b.dataset.key = `btn:${id}`;
    b.addEventListener('click', () => {
      this.setFocus(`btn:${id}`);
      this.activate(`btn:${id}`);
    });
    return b;
  }

  private chip(id: string, name: string, equipped: boolean, editing: boolean, draft: boolean): void {
    const key = `chip:${id}`;
    const b = el('button', `sc-chip${editing ? ' editing' : ''}${equipped ? ' equipped' : ''}`, this.chipsEl);
    b.type = 'button';
    b.dataset.key = key;
    el('span', 'sc-chip-name', b, name);
    el('span', 'sc-chip-tag', b, draft ? 'NÃO SALVO' : equipped ? 'EQUIPADO' : '');
    b.addEventListener('click', () => {
      this.setFocus(key);
      this.activate(key);
    });
  }

  private paint(): void {
    const s = this.editor.setup;
    const shown = this.shown();
    const stored = this.editor.isStored();
    const dirty = this.editor.isDirty();
    const equipped = this.editor.isEquipped();
    const shares = blendShares(s.blendPercent);

    this.nameEl.textContent = s.name;
    this.stateEl.textContent = !stored ? 'NOVO · NÃO SALVO' : dirty ? 'ALTERAÇÕES NÃO SALVAS' : equipped ? 'EQUIPADO' : '';
    this.stateEl.className = `sc-state${dirty || !stored ? ' dirty' : equipped ? ' equipped' : ''}`;

    // Cartões: nome do jogador escolhido em cada família; o de mistura resume velocidade e camadas.
    FamilySlots.forEach((slot, i) => {
      this.cardValues[i].textContent = FamilyLabels[s[slot]];
    });
    this.cardValues[MixCard].textContent = `Velocidade: ${SpeedLabels[s.releaseSpeed]} · Mistura: ${shares.layer1}% / ${shares.layer2}%`;
    this.cardEls.forEach((card, i) => card.classList.toggle('is-active', i === this.slot));

    // Coluna da direita: a tabela do slot de família, ou a mistura.
    const inFamily = this.slot < MixCard;
    this.tableEl.hidden = !inFamily;
    this.mixEl.hidden = inFamily;
    if (inFamily) {
      this.tableTitle.textContent = CardLabels[this.slot];
      const current = s[FamilySlots[this.slot]];
      for (const r of this.rowEls) {
        const on = r.family === current;
        r.row.classList.toggle('current', on);
        r.star.textContent = on ? '★' : '';
      }
    } else {
      this.paintMix(s);
    }

    // Cartão de atributos: da prévia (com a linha focada).
    const a: ShotAttributes = shotAttributes(shown);
    const values = [a.releaseHeight, a.releaseSpeed, a.defensiveImmunity, a.timingStability];
    this.attrBars.forEach((bar, i) => {
      bar.fill.style.width = `${Math.round(values[i] * 100)}%`;
      bar.grade.textContent = gradeOf(values[i]);
    });

    // Prévia: a cena repete o que aparece; só chama de novo quando muda.
    if (this.active) {
      const key = previewKey(shown);
      if (key !== this.lastPreview) {
        this.lastPreview = key;
        this.options.onPreview(shown);
      }
    }

    this.chipsEl.replaceChildren();
    const list = this.editor.list();
    const equippedId = this.editor.equippedId();
    for (const item of list) this.chip(item.id, item.name, item.id === equippedId, item.id === this.editor.id, false);
    if (!stored) this.chip(this.editor.id, s.name, false, true, true);
    this.countEl.textContent = `${list.length}/${MaxSetups}`;

    const state = this.buttonState();
    for (const id of Object.keys(state) as ButtonId[]) this.buttonEls[id].disabled = !state[id];

    const d = this.dialog;
    this.modalEl.classList.toggle('open', d !== null);
    this.modalChoices.replaceChildren();
    if (d) {
      this.modalTitle.textContent = d.title;
      this.modalText.textContent = d.text;
      d.choices.forEach((c, i) => {
        const b = el('button', `sc-choice${c.danger ? ' danger' : ''}${c.run ? '' : ' ghost'}`, this.modalChoices, c.label);
        b.type = 'button';
        b.dataset.key = `choice:${i}`;
        b.addEventListener('click', () => this.chooseDialog(i));
      });
    }

    this.ensureFocus();
    this.paintFocus();
  }

  private paintMix(s: JumpShotSetup): void {
    this.speedButtons.forEach((b, i) => b.classList.toggle('on', SpeedSteps[i] === s.releaseSpeed));
    const shares = blendShares(s.blendPercent);
    this.fill.style.width = `${s.blendPercent}%`;
    this.thumb.style.left = `${s.blendPercent}%`;
    this.layerNames[0].textContent = FamilyLabels[s.upperRelease1];
    this.layerNames[1].textContent = FamilyLabels[s.upperRelease2];
    this.layerPcts[0].textContent = `${shares.layer1}%`;
    this.layerPcts[1].textContent = `${shares.layer2}%`;
    // Losango: a camada 2 enche de baixo para cima (y da borda do retângulo; o clip recorta no losango).
    this.diamondFill.setAttribute('y', String(192 - 184 * (shares.layer2 / 100)));
  }

  /** Foco com a tela aberta: se o item sumiu ou está escondido, leva para um vizinho válido. */
  private ensureFocus(): void {
    if (this.visibleKeys().includes(this.focus)) return;
    if (this.focus.startsWith('btn:')) this.focus = 'btn:back';
    else if (this.focus.startsWith('chip:')) this.focus = `chip:${this.editor.id}`;
    else if (this.focus.startsWith('choice:')) this.focus = 'choice:0';
    else this.focus = `card:${this.slot}`;
  }

  private visibleKeys(): string[] {
    return [...this.root.querySelectorAll<HTMLElement>('[data-key]')]
      .filter((node) => !(node as HTMLButtonElement).disabled && node.closest('[hidden]') === null)
      .map((node) => node.dataset.key ?? '');
  }

  private paintFocus(): void {
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-key]')) {
      node.classList.toggle('is-focus', node.dataset.key === this.focus);
    }
  }
}
