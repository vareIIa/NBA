// Lista de campos das telas de criação (estilo da criação do MyPlayer do 2K / EA FC): cada linha é um rótulo pequeno
// em cima e uma caixa grande; a linha selecionada fica branca, com setas. ←→ muda o valor, A num campo de texto abre a
// digitação, e a última linha é o botão de continuar.
import { type NavAction, el } from './MenuScreen';

export type FormField =
  | { kind: 'text'; key: string; label: string; get: () => string; set: (v: string) => void; max?: number; note?: () => string }
  | { kind: 'step'; key: string; label: string; get: () => string; sub?: () => string; step: (dir: -1 | 1) => void; note?: () => string }
  | { kind: 'cta'; key: string; label: string; run: () => void };

export class FormList {
  readonly root: HTMLElement;
  private rows: HTMLElement[] = [];
  private index = 0;

  constructor(
    parent: HTMLElement,
    private readonly fields: readonly FormField[],
    /** Algum valor mudou (a tela redesenha o resto: tabela de caps, showroom). */
    private readonly onChange: () => void,
  ) {
    this.root = el('div', 'cp-fields', parent);
    this.build();
  }

  get selected(): FormField {
    return this.fields[this.index]!;
  }

  nav(action: NavAction): boolean {
    const n = this.fields.length;
    const f = this.selected;
    if (action === 'up') this.index = (this.index - 1 + n) % n;
    else if (action === 'down') this.index = (this.index + 1) % n;
    else if ((action === 'left' || action === 'right') && f.kind === 'step') {
      f.step(action === 'left' ? -1 : 1);
      this.onChange();
    } else if (action === 'confirm') {
      if (f.kind === 'cta') f.run();
      else if (f.kind === 'text') this.focusInput();
      else this.index = Math.min(n - 1, this.index + 1);
    } else return false;
    this.refresh();
    return true;
  }

  refresh(): void {
    this.fields.forEach((f, i) => {
      const row = this.rows[i]!;
      row.classList.toggle('on', i === this.index);
      if (f.kind === 'step') {
        const v = row.querySelector('.v')!;
        v.textContent = f.get();
        if (f.sub) el('small', '', v as HTMLElement, f.sub());
      } else if (f.kind === 'text') {
        const input = row.querySelector('input')!;
        if (document.activeElement !== input) input.value = f.get();
      }
      if (f.kind !== 'cta') row.querySelector('.cp-note')!.textContent = f.note?.() ?? '';
    });
  }

  private focusInput(): void {
    const input = this.rows[this.index]?.querySelector('input');
    if (!input) return;
    input.focus();
    input.select();
  }

  private build(): void {
    this.fields.forEach((f, i) => {
      if (f.kind === 'cta') {
        const b = el('button', 'cp-cta', this.root, f.label);
        b.addEventListener('mouseenter', () => this.select(i));
        b.addEventListener('click', () => f.run());
        this.rows.push(b);
        return;
      }
      const row = el('div', 'cp-field', this.root);
      el('span', 'k', row, f.label);
      const box = el('div', 'cp-box', row);
      if (f.kind === 'text') {
        const input = el('input', '', box);
        input.maxLength = f.max ?? 16;
        input.spellcheck = false;
        input.value = f.get();
        input.addEventListener('input', () => {
          f.set(input.value);
          this.onChange();
        });
        input.addEventListener('focus', () => this.select(i));
      } else {
        const l = el('button', 'arr', box, '◀');
        el('span', 'v', box);
        const r = el('button', 'arr', box, '▶');
        l.style.background = r.style.background = 'none';
        l.style.border = r.style.border = '0';
        l.addEventListener('click', () => (f.step(-1), this.onChange(), this.refresh()));
        r.addEventListener('click', () => (f.step(1), this.onChange(), this.refresh()));
      }
      el('div', 'cp-note', row);
      row.addEventListener('mouseenter', () => this.select(i));
      this.rows.push(row);
    });
    this.refresh();
  }

  private select(i: number): void {
    if (this.index === i) return;
    this.index = i;
    this.refresh();
  }
}
