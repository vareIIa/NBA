// Criador de arremesso: conteúdo da aba "Arremessos" do menu de pausa. Layout do 2K sem a linha de timing: cartões de
// família à esquerda (cada um abre a lista de opções), painel de velocidade e mistura à direita, faixa de arremessos
// salvos embaixo. Trabalha numa cópia (ShotEditor): só Salvar, Equipar e Apagar gravam no JumpShotStore.
// A parte sem DOM (rótulos, passos, estado da cópia e navegação) é exportada e testada em ShotCreatorView.test.ts.
// Navegação: Enter num cartão abre a lista (ou entra no painel, no cartão de mistura); setas ajustam a barra; Esc/B
// volta um nível e, na raiz, pede para fechar (com aviso se houver alterações não salvas).
import { ReleaseSpeed } from '../sim/HoopsShotModel';
import {
  type JumpShotSetup,
  type JumpShotStore,
  type ShotFamily,
  MaxSetups,
  ShotFamilies,
  defaultSetup,
  upperWeights,
} from '../shot/JumpShotSetup';

/** Ação de navegação: vem do teclado ou do controle (PauseMenu.update). */
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';
export type Dir = 'up' | 'down' | 'left' | 'right';

/** Campo de família do arremesso (um por cartão de família). */
type Slot = 'lowerBase' | 'upperRelease1' | 'upperRelease2';
type Editable = Slot | 'blendPercent' | 'releaseSpeed';
type ButtonId = 'new' | 'save' | 'equip' | 'delete' | 'back';

/** Cartões da coluna esquerda. Os três primeiros são famílias; o último é a mistura e a velocidade (painel à direita). */
export const CardLabels = [
  'Corpo de baixo',
  'Camada de cima 1',
  'Camada de cima 2',
  'Mistura e velocidade de soltura',
] as const;
const FamilySlots: readonly Slot[] = ['lowerBase', 'upperRelease1', 'upperRelease2'];

/** Rótulos das famílias. Tipado por família: se o modelo ganhar outra, o typecheck pede o rótulo aqui. */
export const FamilyLabels: Record<ShotFamily, string> = {
  JumpShot: 'Arremesso clássico (JumpShot)',
  JumpShot2: 'Arremesso alto (JumpShot2)',
};

export const SpeedLabels: Record<ReleaseSpeed, string> = {
  [ReleaseSpeed.Quick]: 'Rápida',
  [ReleaseSpeed.Normal]: 'Normal',
  [ReleaseSpeed.Slow]: 'Lenta',
};
/** Passos da barra de velocidade, na ordem da tela. */
export const SpeedSteps: readonly ReleaseSpeed[] = [ReleaseSpeed.Quick, ReleaseSpeed.Normal, ReleaseSpeed.Slow];

/** Passo da barra de mistura (0 a 100). */
export const BlendStep = 5;

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

/** O que a navegação precisa saber da faixa e dos botões neste momento. */
export interface NavContext {
  /** Chips da faixa, na ordem em que aparecem. */
  chips: string[];
  /** Botões habilitados, na ordem. */
  buttons: string[];
  /** Chip do arremesso em edição: é para onde o foco volta ao descer dos cartões ou subir dos botões. */
  editing: string;
  /** Cartão de onde o foco entrou no painel: Esquerda, no "Testar", devolve para ele. */
  home: string;
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
    if (dir === 'up') return 'card:3';
    if (dir === 'down') return pick(ctx.buttons, 0);
    return null;
  }
  if (focus.startsWith('btn:')) {
    if (side) return pick(ctx.buttons, ctx.buttons.indexOf(focus) + side);
    return dir === 'up' ? ctx.editing : null;
  }
  switch (focus) {
    case 'card:0':
    case 'card:1':
    case 'card:2':
    case 'card:3': {
      const row = Number(focus.slice(5));
      if (dir === 'up') return row > 0 ? `card:${row - 1}` : null;
      if (dir === 'down') return row < 3 ? `card:${row + 1}` : ctx.editing;
      return dir === 'right' ? 'speed' : null;
    }
    case 'speed':
      return dir === 'down' ? 'blend' : null;
    case 'blend':
      return dir === 'up' ? 'speed' : dir === 'down' ? 'test' : null;
    case 'test':
      return dir === 'up' ? 'blend' : dir === 'down' ? ctx.editing : dir === 'left' ? ctx.home : null;
    default:
      return null;
  }
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
  /** "Testar arremesso": recebe uma cópia do arremesso em edição (salvo ou não). */
  onPreview: (setup: JumpShotSetup) => void;
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

export class ShotCreatorView {
  readonly root: HTMLElement;
  private readonly editor: ShotEditor;
  /** Foco atual: a data-key de um elemento (card:0..3, speed, blend, test, chip:<id>, btn:<nome>, opt:<família>, ...). */
  private focus = 'card:0';
  /** Cartão de família de onde o foco entrou no painel de mistura. */
  private home = 'card:0';
  /** Foco de onde saiu uma tela sobreposta (lista ou aviso), para voltar a ele ao fechar. */
  private returnFocus = 'card:0';
  /** Cartão cuja lista de opções está aberta. */
  private picker: number | null = null;
  private pickerIndex = 0;
  private dialog: Dialog | null = null;
  private dragging = false;

  private readonly nameEl: HTMLElement;
  private readonly stateEl: HTMLElement;
  private readonly cardEls: HTMLButtonElement[] = [];
  private readonly cardValues: HTMLElement[] = [];
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly track: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly layer1El: HTMLElement;
  private readonly layer2El: HTMLElement;
  private readonly chipsEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly buttonEls: Record<ButtonId, HTMLButtonElement>;
  private readonly pickerEl: HTMLElement;
  private readonly pickerTitle: HTMLElement;
  private readonly pickerOptions: { button: HTMLButtonElement; tag: HTMLElement }[] = [];
  private readonly modalEl: HTMLElement;
  private readonly modalTitle: HTMLElement;
  private readonly modalText: HTMLElement;
  private readonly modalChoices: HTMLElement;

  constructor(private readonly options: ShotCreatorOptions) {
    this.editor = new ShotEditor(options.store);
    this.root = el('section', 'sc');
    this.root.setAttribute('aria-label', 'Criador de arremesso');

    // Cabeçalho: nome do arremesso em edição e a situação (não salvo, equipado).
    const head = el('header', 'sc-head', this.root);
    const title = el('h2', 'sc-title', head);
    el('span', 'sc-title-kicker', title, 'EDITANDO ARREMESSO:');
    title.append(' ');
    this.nameEl = el('span', 'sc-title-name', title);
    this.stateEl = el('span', 'sc-state', head);

    // Coluna esquerda: os quatro cartões.
    const main = el('div', 'sc-main', this.root);
    const cards = el('div', 'sc-cards', main);
    CardLabels.forEach((label, i) => {
      const card = el('button', 'sc-card', cards);
      card.dataset.key = `card:${i}`;
      el('span', 'sc-card-label', card, label);
      this.cardValues.push(el('span', 'sc-card-value', card));
      el('span', 'sc-card-go', card, '›');
      card.addEventListener('click', () => {
        this.setFocus(`card:${i}`);
        this.onConfirm();
      });
      this.cardEls.push(card);
    });

    // Painel da direita: velocidade de soltura, mistura de animação e o teste.
    const mix = el('aside', 'sc-mix', main);
    const speedSec = el('section', 'sc-sec', mix);
    el('h3', 'sc-sec-title', speedSec, 'Velocidade de soltura');
    const steps = el('div', 'sc-steps', speedSec);
    steps.dataset.key = 'speed';
    for (const speed of SpeedSteps) {
      const step = el('button', 'sc-step', steps, SpeedLabels[speed]);
      step.addEventListener('click', () => {
        this.setFocus('speed');
        this.setSpeed(speed);
      });
      this.speedButtons.push(step);
    }

    const blendSec = el('section', 'sc-sec', mix);
    el('h3', 'sc-sec-title', blendSec, 'Mistura de animação');
    this.track = el('div', 'sc-track', blendSec);
    this.track.dataset.key = 'blend';
    this.fill = el('div', 'sc-track-fill', this.track);
    this.thumb = el('div', 'sc-track-thumb', this.track);
    const layers = el('div', 'sc-layers', blendSec);
    this.layer1El = el('span', 'sc-layer-1', layers);
    this.layer2El = el('span', 'sc-layer-2', layers);
    // Mouse: clicar ou arrastar na barra escolhe a porcentagem (com a captura, o arrasto segue fora da barra).
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

    const test = el('button', 'sc-test', mix, 'Testar arremesso');
    test.dataset.key = 'test';
    test.addEventListener('click', () => {
      this.setFocus('test');
      this.preview();
    });

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
      back: this.button(actions, 'back', 'Voltar', 'ghost'),
    };

    // Sobreposições: lista de opções de um cartão, e aviso (alterações não salvas, apagar).
    this.pickerEl = el('div', 'sc-overlay sc-picker', this.root);
    this.pickerEl.addEventListener('click', (e) => {
      if (e.target === this.pickerEl) this.closePicker();
    });
    const pickerBox = el('div', 'sc-modal-box', this.pickerEl);
    this.pickerTitle = el('h3', 'sc-modal-title', pickerBox);
    const opts = el('div', 'sc-opts', pickerBox);
    for (const family of ShotFamilies) {
      const option = el('button', 'sc-opt', opts);
      option.dataset.key = `opt:${family}`;
      el('span', 'sc-opt-name', option, FamilyLabels[family]);
      const tag = el('span', 'sc-opt-tag', option);
      option.addEventListener('click', () => this.pickFamily(family));
      this.pickerOptions.push({ button: option, tag });
    }

    this.modalEl = el('div', 'sc-overlay sc-modal', this.root);
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) this.closeDialog();
    });
    const box = el('div', 'sc-modal-box', this.modalEl);
    this.modalTitle = el('h3', 'sc-modal-title', box);
    this.modalText = el('p', 'sc-modal-text', box);
    this.modalChoices = el('div', 'sc-modal-choices', box);

    this.paint();
  }

  /** Abre a aba: copia o arremesso equipado e foca o primeiro cartão. */
  open(): void {
    this.editor.loadEquipped();
    this.picker = null;
    this.dialog = null;
    this.dragging = false;
    this.focus = 'card:0';
    this.home = 'card:0';
    this.paint();
  }

  /** Pedido de saída (Voltar, Esc/B ou ✕). Fecha antes a lista ou o aviso que estiver aberto; com alterações, pergunta. */
  requestClose(): void {
    if (this.dialog) return this.closeDialog();
    if (this.picker !== null) return this.closePicker();
    this.requestLeave(() => this.options.onRequestClose());
  }

  /** Uma ação de navegação (teclado ou controle). */
  handle(action: MenuAction): void {
    const d = this.dialog;
    if (d) return this.handleDialog(d, action);
    if (this.picker !== null) return this.handlePicker(action);
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

  private handlePicker(action: MenuAction): void {
    if (action === 'back') return this.closePicker();
    if (action === 'confirm') return this.pickFamily(ShotFamilies[this.pickerIndex]);
    const step = stepOf(action);
    if (step === 0) return;
    this.pickerIndex = clampIndex(this.pickerIndex + step, ShotFamilies.length);
    this.focus = `opt:${ShotFamilies[this.pickerIndex]}`;
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
      const card = Number(f.slice(5));
      if (card < FamilySlots.length) return this.openPicker(card);
      return this.moveTo('speed');
    }
    const s = this.editor.setup;
    if (f === 'speed') return this.setSpeed(stepSpeed(s.releaseSpeed, 1, true));
    if (f === 'blend') return this.setBlend(stepBlend(s.blendPercent, 1, true));
    if (f === 'test') return this.preview();
    this.activate(f);
  }

  private onBack(): void {
    if (this.focus === 'speed' || this.focus === 'blend' || this.focus === 'test') return this.setFocus(this.home);
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

  private openPicker(card: number): void {
    this.picker = card;
    this.pickerIndex = Math.max(0, ShotFamilies.indexOf(this.editor.setup[FamilySlots[card]]));
    this.returnFocus = `card:${card}`;
    this.focus = `opt:${ShotFamilies[this.pickerIndex]}`;
    this.paint();
  }

  private closePicker(): void {
    this.picker = null;
    this.focus = this.returnFocus;
    this.paint();
  }

  /** Escolhe a família do cartão aberto. Só mexe na cópia. */
  private pickFamily(family: ShotFamily): void {
    if (this.picker === null) return;
    const change: Partial<Pick<JumpShotSetup, Slot>> = {};
    change[FamilySlots[this.picker]] = family;
    this.editor.patch(change);
    this.closePicker();
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

  private preview(): void {
    this.options.onPreview(this.editor.setup);
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
    if (key.startsWith('card:')) this.home = key;
    this.paint();
  }

  /** Foco por teclado ou controle: troca e leva o item para dentro da área de rolagem. */
  private moveTo(key: string): void {
    this.setFocus(key);
    this.root.querySelector<HTMLElement>(`[data-key="${key}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private navContext(): NavContext {
    return {
      chips: this.chipKeys(),
      buttons: this.buttonKeys(),
      editing: `chip:${this.editor.id}`,
      home: this.home,
    };
  }

  /** Chips da faixa: os salvos e, no fim, o rascunho (se houver). */
  private chipKeys(): string[] {
    const keys = this.editor.list().map((s) => `chip:${s.id}`);
    if (!this.editor.isStored()) keys.push(`chip:${this.editor.id}`);
    return keys;
  }

  /** Botões habilitados agora. Salvar e Voltar estão sempre disponíveis. */
  private buttonState(): Record<ButtonId, boolean> {
    return {
      new: this.editor.canCreate(),
      save: true,
      equip: this.editor.isStored() && !this.editor.isEquipped(),
      delete: this.editor.canDelete(),
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
    const stored = this.editor.isStored();
    const dirty = this.editor.isDirty();
    const equipped = this.editor.isEquipped();

    this.nameEl.textContent = s.name;
    this.stateEl.textContent = !stored ? 'NOVO · NÃO SALVO' : dirty ? 'ALTERAÇÕES NÃO SALVAS' : equipped ? 'EQUIPADO' : '';
    this.stateEl.className = `sc-state${dirty || !stored ? ' dirty' : equipped ? ' equipped' : ''}`;

    // Cartões: nome da opção atual. O cartão de mistura mostra velocidade e camada 2.
    FamilySlots.forEach((slot, i) => {
      this.cardValues[i].textContent = FamilyLabels[s[slot]];
    });
    this.cardValues[3].textContent = `${SpeedLabels[s.releaseSpeed]} · camada 2 em ${s.blendPercent}%`;
    const inMix = this.focus === 'speed' || this.focus === 'blend' || this.focus === 'test';
    this.cardEls[3].classList.toggle('is-active', inMix);

    this.speedButtons.forEach((b, i) => b.classList.toggle('on', SpeedSteps[i] === s.releaseSpeed));

    const shares = blendShares(s.blendPercent);
    this.fill.style.width = `${s.blendPercent}%`;
    this.thumb.style.left = `${s.blendPercent}%`;
    this.layer1El.textContent = `Camada 1: ${shares.layer1}%`;
    this.layer2El.textContent = `Camada 2: ${shares.layer2}%`;

    const list = this.editor.list();
    const equippedId = this.editor.equippedId();
    this.chipsEl.replaceChildren();
    for (const item of list) this.chip(item.id, item.name, item.id === equippedId, item.id === this.editor.id, false);
    if (!stored) this.chip(this.editor.id, s.name, false, true, true);
    this.countEl.textContent = `${list.length}/${MaxSetups}`;

    const state = this.buttonState();
    for (const id of Object.keys(state) as ButtonId[]) this.buttonEls[id].disabled = !state[id];

    this.pickerEl.classList.toggle('open', this.picker !== null);
    if (this.picker !== null) {
      this.pickerTitle.textContent = CardLabels[this.picker];
      const current = s[FamilySlots[this.picker]];
      ShotFamilies.forEach((family, i) => {
        const { button, tag } = this.pickerOptions[i];
        button.classList.toggle('current', family === current);
        tag.textContent = family === current ? 'ATUAL' : '';
      });
    }

    const d = this.dialog;
    this.modalEl.classList.toggle('open', d !== null);
    if (d) {
      this.modalTitle.textContent = d.title;
      this.modalText.textContent = d.text;
      this.modalChoices.replaceChildren();
      d.choices.forEach((c, i) => {
        const b = el(
          'button',
          `sc-choice${c.danger ? ' danger' : ''}${c.run ? '' : ' ghost'}`,
          this.modalChoices,
          c.label,
        );
        b.dataset.key = `choice:${i}`;
        b.addEventListener('click', () => this.chooseDialog(i));
      });
    }

    this.ensureFocus();
    this.paintFocus();
  }

  /** Se o foco caiu num item que sumiu ou ficou desabilitado, leva para um vizinho válido. */
  private ensureFocus(): void {
    if (this.visibleKeys().includes(this.focus)) return;
    if (this.focus.startsWith('btn:')) this.focus = 'btn:back';
    else if (this.focus.startsWith('chip:')) this.focus = `chip:${this.editor.id}`;
    else this.focus = 'card:0';
  }

  private visibleKeys(): string[] {
    return [...this.root.querySelectorAll<HTMLElement>('[data-key]')]
      .filter((node) => !(node as HTMLButtonElement).disabled)
      .map((node) => node.dataset.key ?? '');
  }

  private paintFocus(): void {
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-key]')) {
      node.classList.toggle('is-focus', node.dataset.key === this.focus);
    }
  }
}
