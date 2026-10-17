// Criação do jogador, 2ª tela ("Appearance" do MyPlayer do 2K, antes do corpo): tom de pele, uniforme e tênis, cada um
// numa aba (LB/RB). O jogador 3D veste ao vivo o que está selecionado (Showroom → PlayerOutfit) e a câmera chega perto
// do que a aba mexe: o rosto na pele, o tronco no uniforme, os pés nos tênis. Doc: docs/26-aparencia.md.
//
// Fase 2: o uniforme tem casa e visitante (modelo e cores por zona) e o tênis tem cores. Cada zona (principal, detalhe,
// debrum...) tem uma paleta rápida de 16 cores e três ajustes (matiz, saturação, brilho) pelo D-pad. Navegação: ←→
// anda na linha e escolhe; ↑↓ troca de linha; nas linhas de ajuste ←→ muda o valor; LB/RB trocam de aba; A passa de
// aba (ou vai ao Continuar); B volta; Y sorteia.
import { type MenuHint, type MenuScreen, type NavAction, el } from './MenuScreen';
import type { ShowroomFocus } from './Showroom';
import type { PlayerBuild } from '../build/PlayerBuild';
import { hexToHsl, shiftHex } from '../build/ColorEdit';
import {
  GearZones,
  KitOrder,
  Kits,
  type LookColors,
  type PlayerLook,
  type Side,
  ShoeOrder,
  Shoes,
  SkinTones,
  TextureSkin,
  UniformPalette,
  mainColor,
  randomLook,
  sanitizeLook,
  sideKit,
  zoneHex,
} from '../build/PlayerLook';

export interface AppearanceOptions {
  onBack: (build: PlayerBuild) => void;
  onNext: (build: PlayerBuild) => void;
}

type TabId = 'skin' | 'kit' | 'shoes';
type RowKey = 'skin' | 'model' | 'shoe' | 'slot' | 'palette' | 'hue' | 'sat' | 'light';

/** Uma linha de itens (grade de `cols` colunas) ou um ajuste (matiz, saturação, brilho: ←→ muda o valor). */
interface Row {
  key: RowKey;
  items: number;
  cols: number;
  /** Item destacado (o que a escolha tem agora); −1 = nenhum. */
  current: number;
}

const TabInfo: readonly { id: TabId; label: string; focus: ShowroomFocus }[] = [
  { id: 'skin', label: 'Pele', focus: 'rosto' },
  { id: 'kit', label: 'Uniforme', focus: 'tronco' },
  { id: 'shoes', label: 'Tênis', focus: 'pes' },
];

/** Nome de cada zona (a ordem é a da máscara: 0 = a maior área, a principal). */
const ZoneNames = ['Principal', 'Detalhe', 'Debrum', 'Extra'];
const SliderKeys: readonly RowKey[] = ['hue', 'sat', 'light'];

/** "Tom 3" (da paleta) ou "Personalizado" (?pele=rrggbb na URL). */
const skinLabel = (hex: string): string => {
  const i = SkinTones.indexOf(hex);
  return i < 0 ? 'Personalizado' : `Tom ${i + 1}`;
};

/** Quantas zonas tem a peça (ou a de maior número de zonas, no uniforme): 1 + o índice da última zona da máscara. */
const zoneCount = (pieces: readonly string[]): number =>
  Math.max(1, ...pieces.map((p) => (GearZones[p] ?? []).reduce<number>((n, c, i) => (c ? i + 1 : n), 0)));

export class AppearanceScreen implements MenuScreen {
  readonly root: HTMLElement;
  readonly crumb = 'MyPlayer Builder · Aparência';
  private tab = 0;
  /** Cursor: a linha e o item dentro dela. */
  private row = 0;
  private idx = 0;
  /** Foco no botão de continuar (abaixo da última linha). */
  private onCta = false;
  /** Uniforme que a aba está editando (casa ou visitante). */
  private side: Side = 'casa';
  /** Zona que a paleta e os ajustes pintam. */
  private slot = 0;
  private readonly tabsBar: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly note: HTMLElement;
  private readonly cta: HTMLButtonElement;
  private readonly summary: HTMLElement;

  constructor(
    private draft: PlayerBuild,
    private readonly options: AppearanceOptions,
  ) {
    this.root = el('div', 'mn-screen');
    const layout = el('div', 'cp', this.root);
    const left = el('section', 'cp-col', layout);
    el('h1', 'mn-h1', left, 'Aparência');
    el('p', 'mn-sub', left, 'Ele veste na hora o que você escolher.');
    this.tabsBar = el('div', 'ap-tabs', left);
    TabInfo.forEach((t, i) => {
      const b = el('button', 'ap-tab', this.tabsBar, t.label);
      b.addEventListener('click', () => this.setTab(i));
    });
    this.grid = el('div', 'ap-grid', left);
    this.note = el('div', 'cp-note ap-note', left);
    this.cta = el('button', 'cp-cta', left, 'Continuar');
    this.cta.addEventListener('mouseenter', () => ((this.onCta = true), this.refresh()));
    this.cta.addEventListener('click', () => this.next());
    el('div', '', layout);
    const right = el('aside', 'cp-col', layout);
    right.style.justifyContent = 'center';
    this.summary = el('div', 'mm-card', right);
    // O cursor começa no que já está escolhido (como a grade de antes).
    this.idx = Math.max(0, this.rows()[0]!.current);
    this.refresh();
  }

  hints(): readonly MenuHint[] {
    return [
      { key: 'lb', label: 'Aba anterior' },
      { key: 'rb', label: 'Próxima aba' },
      { key: 'dpad', label: 'Escolher e ajustar' },
      { key: 'y', label: 'Aleatório' },
      { key: 'a', label: 'Continuar' },
      { key: 'b', label: 'Voltar' },
    ];
  }

  enter(): void {
    this.refresh();
  }

  leave(): void {}

  body(): PlayerBuild['body'] {
    return this.draft.body;
  }

  look(): PlayerLook {
    return this.draft.look;
  }

  /** Na aba de uniforme, o showroom veste o lado que está sendo editado; nas outras, o de casa. */
  wear(): Side {
    return TabInfo[this.tab]!.id === 'kit' ? this.side : 'casa';
  }

  focus(): ShowroomFocus {
    return this.onCta ? 'corpo' : TabInfo[this.tab]!.focus;
  }

  nav(action: NavAction): void {
    const { rows, row, idx } = this.cursor();
    switch (action) {
      case 'back':
        return this.options.onBack(this.draft);
      case 'prevTab':
      case 'nextTab':
        return this.setTab((this.tab + (action === 'nextTab' ? 1 : -1) + TabInfo.length) % TabInfo.length);
      case 'alt':
        this.setLook(randomLook());
        return;
      case 'confirm':
        // Na grade, A passa para a próxima aba (a escolha já valeu); na última, vai para o Continuar.
        if (this.onCta) return this.next();
        if (this.tab < TabInfo.length - 1) return this.setTab(this.tab + 1);
        this.onCta = true;
        break;
      case 'left':
      case 'right': {
        if (this.onCta) return;
        const d = action === 'right' ? 1 : -1;
        if (SliderKeys.includes(row.key)) return this.adjust(row.key, d);
        this.idx = Math.min(row.items - 1, Math.max(0, idx + d));
        return this.choose(row.key, this.idx);
      }
      case 'up':
      case 'down': {
        if (this.onCta) {
          if (action === 'up') this.onCta = false;
          break;
        }
        const d = action === 'down' ? 1 : -1;
        // Dentro da linha, ↑↓ andam uma fileira da grade (a paleta tem 2); fora dela, passam para a linha vizinha.
        if (idx + d * row.cols >= 0 && idx + d * row.cols < row.items) this.idx = idx + d * row.cols;
        else {
          const nr = this.row + d;
          if (nr < 0) return;
          if (nr >= rows.length) {
            this.onCta = true;
            break;
          }
          const next = rows[nr]!;
          const col = idx % row.cols;
          this.row = nr;
          // Descendo, a coluna se mantém (da primeira linha da próxima); subindo, cai na última linha da de cima.
          this.idx = d > 0 ? Math.min(col, next.items - 1) : Math.min(next.items - 1, col + Math.floor((next.items - 1 - col) / next.cols) * next.cols);
        }
        if (!this.onCta) this.choose(rows[this.row]!.key, this.idx);
        break;
      }
    }
    this.refresh();
  }

  /** Cursor válido: a linha e o item de agora, depois de a aba ou o uniforme terem mudado a grade. */
  private cursor(): { rows: Row[]; row: Row; idx: number } {
    const rows = this.rows();
    this.row = Math.min(this.row, rows.length - 1);
    const row = rows[this.row]!;
    this.idx = Math.min(this.idx, row.items - 1);
    return { rows, row, idx: this.idx };
  }

  /** As linhas da aba agora (a paleta e os ajustes só aparecem nas abas com cor: uniforme e tênis). */
  private rows(): Row[] {
    const look = this.draft.look;
    const tab = TabInfo[this.tab]!.id;
    if (tab === 'skin') return [{ key: 'skin', items: SkinTones.length, cols: 5, current: SkinTones.indexOf(look.skin) }];
    const n = this.slotCount();
    this.slot = Math.min(this.slot, n - 1);
    // Uniforme: uma fileira com os 4 modelos (casa vermelho e branco; visitante vermelho e branco). O lado é o do bloco.
    const head: Row[] =
      tab === 'kit'
        ? [{ key: 'model', items: 2 * KitOrder.length, cols: 2 * KitOrder.length, current: this.side === 'casa' ? KitOrder.indexOf(look.kit) : KitOrder.length + KitOrder.indexOf(look.kitAway) }]
        : [{ key: 'shoe', items: ShoeOrder.length, cols: ShoeOrder.length, current: ShoeOrder.indexOf(look.shoes) }];
    return [
      ...head,
      { key: 'slot', items: n, cols: n, current: this.slot },
      { key: 'palette', items: UniformPalette.length, cols: 8, current: UniformPalette.indexOf(this.zoneHex()) },
      ...SliderKeys.map((key) => ({ key, items: 1, cols: 1, current: -1 })),
    ];
  }

  /** Zonas da peça que a aba mexe (uniforme: a regata e a bermuda do lado; tênis: o modelo). */
  private slotCount(): number {
    const look = this.draft.look;
    if (TabInfo[this.tab]!.id === 'shoes') return zoneCount([look.shoes]);
    const kit = sideKit(look, this.side);
    return zoneCount([`regata_${kit}`, `bermuda_${kit}`]);
  }

  /** Chave das cores no look: o lado do uniforme ou o tênis. */
  private colorKey(): keyof LookColors {
    return TabInfo[this.tab]!.id === 'shoes' ? 'tenis' : this.side;
  }

  /** Cor atual da zona que se edita (escolhida ou a original da peça). */
  private zoneHex(): string {
    const look = this.draft.look;
    if (TabInfo[this.tab]!.id === 'shoes') return zoneHex(look, 'tenis', look.shoes, this.slot);
    return zoneHex(look, this.side, `regata_${sideKit(look, this.side)}`, this.slot);
  }

  /** A zona escolhida (true) ou a original da peça (false). */
  private slotSet(i: number): boolean {
    return !!this.draft.look.colors?.[this.colorKey()]?.[i];
  }

  private choose(key: RowKey, i: number): void {
    const look = this.draft.look;
    switch (key) {
      case 'skin':
        return this.setLook({ ...look, skin: SkinTones[i]! });
      case 'model': {
        // Os dois primeiros são de casa; os dois últimos, de visitante. Escolher um modelo já põe o lado em foco.
        const casa = i < KitOrder.length;
        this.side = casa ? 'casa' : 'visitante';
        this.slot = Math.min(this.slot, this.slotCount() - 1);
        const kit = KitOrder[casa ? i : i - KitOrder.length]!;
        return this.setLook(casa ? { ...look, kit } : { ...look, kitAway: kit });
      }
      case 'shoe':
        return this.setLook({ ...look, shoes: ShoeOrder[i]! });
      case 'slot':
        this.slot = i;
        return;
      case 'palette':
        return this.setZone(UniformPalette[i]!);
      default:
        return;
    }
  }

  /** Ajuste de matiz (±10°), saturação e brilho (±5 pontos) sobre a cor da zona. */
  private adjust(key: RowKey, d: number): void {
    const hex = this.zoneHex();
    const next =
      key === 'hue' ? shiftHex(hex, 10 * d, 0, 0) : key === 'sat' ? shiftHex(hex, 0, 0.05 * d, 0) : shiftHex(hex, 0, 0, 0.05 * d);
    this.setZone(next);
  }

  /** Grava a cor da zona que se edita no look (as outras zonas e o outro lado ficam como estavam). */
  private setZone(hex: string): void {
    const look = this.draft.look;
    const key = this.colorKey();
    const list = [...(look.colors?.[key] ?? [])];
    while (list.length <= this.slot) list.push('');
    list[this.slot] = hex;
    this.setLook({ ...look, colors: { ...look.colors, [key]: list } });
  }

  private setLook(look: PlayerLook): void {
    this.draft = { ...this.draft, look: sanitizeLook(look) };
    this.refresh();
  }

  private setTab(i: number): void {
    this.tab = i;
    this.row = 0;
    this.idx = Math.max(0, this.rows()[0]!.current);
    this.onCta = false;
    this.refresh();
  }

  private next(): void {
    this.options.onNext(this.draft);
  }

  /** Monta a grade da aba (linhas de itens e de ajuste) e pinta o cursor e o que está escolhido. */
  private renderGrid(): void {
    const { rows } = this.cursor();
    this.grid.replaceChildren();
    this.grid.dataset.tab = TabInfo[this.tab]!.id;
    rows.forEach((row, r) => {
      const box = el('div', 'ap-row', this.grid);
      box.style.setProperty('--cols', String(row.cols));
      if (SliderKeys.includes(row.key)) {
        const s = this.sliderCell(row.key, box);
        s.classList.toggle('on', r === this.row && !this.onCta);
        s.addEventListener('click', (e) => {
          this.row = r;
          this.onCta = false;
          const rect = s.getBoundingClientRect();
          this.adjust(row.key, e.clientX < rect.left + rect.width / 2 ? -1 : 1);
        });
        return;
      }
      for (let i = 0; i < row.items; i++) {
        const cell = this.cellFor(row, i, box);
        cell.classList.toggle('sel', i === row.current);
        cell.classList.toggle('on', r === this.row && i === this.idx && !this.onCta);
        cell.addEventListener('click', () => {
          this.row = r;
          this.idx = i;
          this.onCta = false;
          this.choose(row.key, i);
          this.refresh();
        });
      }
    });
    // Mantém o cursor à vista na grade (o uniforme tem mais linhas que cabem na coluna).
    const on = this.grid.querySelector<HTMLElement>('.on');
    if (on && this.grid.scrollHeight > this.grid.clientHeight) {
      if (on.offsetTop < this.grid.scrollTop) this.grid.scrollTop = on.offsetTop;
      else if (on.offsetTop + on.offsetHeight > this.grid.scrollTop + this.grid.clientHeight) this.grid.scrollTop = on.offsetTop + on.offsetHeight - this.grid.clientHeight;
    }
  }

  private cellFor(row: Row, i: number, box: HTMLElement): HTMLElement {
    const look = this.draft.look;
    switch (row.key) {
      case 'skin': {
        const s = el('button', 'ap-swatch', box);
        s.style.setProperty('--c', SkinTones[i]!);
        return s;
      }
      case 'model': {
        // Um bloco por modelo: a faixa de cima é a cor do uniforme; a legenda diz de que lado ele é.
        const casa = i < KitOrder.length;
        const k = Kits[KitOrder[casa ? i : i - KitOrder.length]!];
        const b = el('button', 'ap-tile ap-kitt', box);
        b.style.setProperty('--c', k.color);
        el('b', '', b, k.label);
        el('small', '', b, casa ? 'Casa' : 'Visitante');
        return b;
      }
      case 'shoe': {
        // Um bloco por tênis (as cores e o nome); o texto de cada um (cano, cores) sai na nota ao escolher.
        const s = Shoes[ShoeOrder[i]!];
        const b = el('button', 'ap-tile', box);
        const dots = el('span', 'ap-dots', b);
        for (const c of s.colors) el('i', '', dots).style.background = c;
        el('b', '', b, s.label);
        return b;
      }
      case 'slot': {
        const key = this.colorKey();
        const piece = TabInfo[this.tab]!.id === 'shoes' ? look.shoes : `regata_${sideKit(look, this.side)}`;
        const b = el('button', 'ap-slotc', box);
        b.style.setProperty('--c', zoneHex(look, key === 'tenis' ? 'tenis' : this.side, piece, i));
        b.classList.toggle('orig', !this.slotSet(i));
        el('span', '', b, ZoneNames[i]!);
        return b;
      }
      case 'palette': {
        const s = el('button', 'ap-pal', box);
        s.style.setProperty('--c', UniformPalette[i]!);
        return s;
      }
      default:
        return el('button', '', box);
    }
  }

  /** Ajuste de matiz, saturação ou brilho da zona: o nome, o valor e a barra (a cor da zona no preenchimento). */
  private sliderCell(key: RowKey, box: HTMLElement): HTMLElement {
    const hex = this.zoneHex();
    const c = hexToHsl(hex);
    const [label, value, frac] =
      key === 'hue'
        ? ['Matiz', `${Math.round(c.h)}°`, c.h / 360]
        : key === 'sat'
          ? ['Saturação', `${Math.round(c.s * 100)}%`, c.s]
          : ['Brilho', `${Math.round(c.l * 100)}%`, c.l];
    const s = el('button', 'ap-slider', box);
    const head = el('span', 'ap-slider-h', s);
    el('span', '', head, label);
    el('b', '', head, value);
    const bar = el('i', key === 'hue' ? 'ap-bar hue' : 'ap-bar', s);
    const fill = el('u', '', bar);
    fill.style.width = `${Math.round(frac * 100)}%`;
    fill.style.setProperty('--c', hex);
    return s;
  }

  private refresh(): void {
    [...this.tabsBar.children].forEach((b, i) => b.classList.toggle('on', i === this.tab));
    this.renderGrid();
    this.note.textContent = this.noteText();
    this.cta.classList.toggle('on', this.onCta);
    this.renderSummary();
  }

  private noteText(): string {
    const look = this.draft.look;
    switch (TabInfo[this.tab]!.id) {
      case 'skin':
        return `${skinLabel(look.skin)} de ${SkinTones.length}${look.skin === TextureSkin ? ' · o do modelo' : ''}`;
      case 'kit':
        return `${this.side === 'casa' ? 'Uniforme de casa' : 'Uniforme de visitante'} · ${ZoneNames[this.slot]}`;
      case 'shoes':
        return `${Shoes[look.shoes].sub} · ${ZoneNames[this.slot]}`;
    }
  }

  private renderSummary(): void {
    const look = this.draft.look;
    const card = this.summary;
    card.replaceChildren();
    el('h3', '', card, 'SEU VISUAL');
    const facts = el('div', 'ap-facts', card);
    const row = (k: string, v: string, swatch?: string): void => {
      const r = el('div', '', facts);
      el('span', '', r, k);
      const b = el('b', '', r, v);
      if (swatch) el('i', 'ap-chip', b).style.background = swatch;
    };
    row('PELE', skinLabel(look.skin), look.skin);
    row('CASA', Kits[look.kit].label, mainColor(look, 'casa'));
    row('VISITANTE', Kits[look.kitAway].label, mainColor(look, 'visitante'));
    row('TÊNIS', Shoes[look.shoes].label, zoneHex(look, 'tenis', look.shoes, 0));
    el('p', 'ap-rule', card, 'No 1 contra 1, o visitante veste o de visitante; se a cor principal dele bater com a do mandante, veste o de casa.');
  }
}
