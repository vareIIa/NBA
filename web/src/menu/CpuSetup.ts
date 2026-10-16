// 1 contra 1 contra a CPU (docs/25-1x1-cpu-e-defesa.md): escolha do adversário, do nível e das regras; "Jogar" monta a
// sala local (o mesmo juiz do online rodando no navegador) e o jogo começa a partida com o jogador da CPU no lugar do
// boneco remoto. Mesma moldura e classes do lobby do online (online.css).
import './online.css';
import { type MenuHint, type MenuScreen, type NavAction, el } from './MenuScreen';
import type { PlayerBuild } from '../build/PlayerBuild';
import { formatMeters } from '../build/PlayerBuild';
import { playRatings } from '../build/BuildRatings';
import { cardFromBuild } from '../net/playerCard';
import { DefaultRules, type MatchRules, type ServerMsg } from '../net/protocol';
import type { MatchOpponent, OnlineMatchDeps } from '../game/OnlineMatch';
import { CpuOpponent } from '../game/cpu/CpuOpponent';
import { type CpuLevel, CpuLevelOrder, CpuLevels, CpuRoster, type CpuRosterEntry, cpuBuild, cpuCard, cpuEntry } from '../game/cpu/CpuRoster';
import { CpuSide, HumanSide, LocalHub } from '../game/cpu/LocalHub';

/** A partida contra a CPU pronta para o jogo (o main.ts monta como a do online, com o oponente da CPU). */
export interface CpuStart {
  net: LocalHub;
  start: Extract<ServerMsg, { t: 'match.start' }>;
  opponent: (deps: OnlineMatchDeps) => Promise<MatchOpponent>;
  offline: true;
}

export interface CpuStartOptions {
  build: PlayerBuild;
  name?: string | null;
  entry: CpuRosterEntry;
  level: CpuLevel;
  rules?: Partial<MatchRules>;
  /** Quem começa atacando (padrão: o jogador; ?ataque=cpu na URL troca). */
  cpuFirst?: boolean;
  /** Testes (?sorte=1): todo roubo e todo toco possível DO JOGADOR saem (os da CPU seguem o sorteio). */
  sorte?: boolean;
  /** ?autoplay=<nível>: o jogador vira CPU também (CPU contra CPU, para testar e calibrar). */
  autoplay?: CpuLevel;
}

/** Monta a sala local e o oponente. O relógio da partida só anda quando a CPU já está na quadra. */
export function makeCpuStart(o: CpuStartOptions): CpuStart {
  const human = cardFromBuild(o.build, o.name);
  const build = cpuBuild(o.entry);
  const card = cpuCard(o.entry, build);
  const hub = new LocalHub({ human, cpu: card, rules: o.rules, firstOffense: o.cpuFirst ? CpuSide : HumanSide, sorteHuman: o.sorte });
  return {
    net: hub,
    start: hub.startMsg(HumanSide),
    offline: true,
    opponent: (deps) =>
      CpuOpponent.load(deps, {
        hub,
        entry: o.entry,
        build,
        card,
        level: o.level,
        humanRatings: playRatings(o.build),
        humanCard: human,
        humanBuild: o.build,
        autoplay: o.autoplay,
        blockRandom: o.sorte ? () => 0 : undefined,
      }),
  };
}

interface Item {
  root: HTMLElement;
  activate?: () => void;
  left?: () => void;
  right?: () => void;
}

const TargetChoices = [7, 11, 15, 21];
const ClockChoices = [0, 12, 24];

export interface CpuSetupOptions {
  build: PlayerBuild;
  name?: string | null;
  onBack: () => void;
  onStart: (start: CpuStart) => void;
}

/** Última escolha (adversário e nível), para a próxima partida começar dela. */
const PrefKey = 'garrafao.cpu';

export class CpuSetupScreen implements MenuScreen {
  readonly root: HTMLElement;
  readonly crumb = '1 CONTRA 1 · CONTRA A CPU';
  showroomOffset = 0.15;
  private readonly main: HTMLElement;
  private readonly side: HTMLElement;
  private items: Item[] = [];
  private index = 0;
  private entry: CpuRosterEntry;
  private level: CpuLevel;
  private rules: MatchRules = { ...DefaultRules };

  constructor(private readonly opts: CpuSetupOptions) {
    const pref = readPref();
    this.entry = cpuEntry(pref.entry ?? CpuRoster[0]!.id);
    this.level = pref.level && pref.level in CpuLevels ? pref.level : 'pro';
    this.root = el('div', 'mn-screen');
    const grid = el('div', 'ol', this.root);
    this.main = el('section', 'ol-main', grid);
    el('div', '', grid); // meio: o jogador 3D
    this.side = el('aside', 'ol-side', grid);
  }

  hints(): readonly MenuHint[] {
    return [
      { key: 'dpad', label: 'Navegar / mudar' },
      { key: 'a', label: 'Selecionar' },
      { key: 'b', label: 'Voltar' },
    ];
  }

  enter(): void {
    this.render();
  }

  leave(): void {}

  nav(action: NavAction): void {
    const n = this.items.length;
    if (!n) return;
    if (action === 'up') this.select((this.index - 1 + n) % n);
    else if (action === 'down') this.select((this.index + 1) % n);
    else if (action === 'left') this.items[this.index]?.left?.();
    else if (action === 'right') this.items[this.index]?.right?.();
    else if (action === 'confirm') this.items[this.index]?.activate?.();
    else if (action === 'back') this.opts.onBack();
  }

  private render(): void {
    const keep = this.index;
    this.items = [];
    this.main.replaceChildren();
    el('h1', 'mn-h1', this.main, '1 contra 1');
    el('p', 'mn-sub', this.main, 'Você contra a CPU, regras de rua: check, limpar a bola no rebote, relógio de posse.');
    this.button('Jogar', `Contra ${this.entry.firstName} ${this.entry.lastName} · ${CpuLevels[this.level].label}`, () => this.start());
    const block = el('div', 'ol-rules', this.main);
    el('h3', '', block, 'ADVERSÁRIO E REGRAS (← → muda)');
    const cycle = <T>(list: readonly T[], value: T, step: number): T => list[(list.indexOf(value) + step + list.length) % list.length] ?? list[0]!;
    const row = (label: string, value: string, change: (step: number) => void): void => {
      const r = el('div', 'ol-rule', block);
      el('span', '', r, label);
      el('b', '', r, `‹ ${value} ›`);
      const i = this.items.length;
      r.addEventListener('mouseenter', () => this.select(i));
      r.addEventListener('click', () => change(1));
      this.items.push({ root: r, activate: () => change(1), left: () => change(-1), right: () => change(1) });
    };
    const update = (fn: () => void): void => {
      fn();
      writePref({ entry: this.entry.id, level: this.level });
      this.render();
    };
    row('Adversário', `${this.entry.firstName} ${this.entry.lastName}`, (s) => update(() => (this.entry = cycle(CpuRoster, this.entry, s))));
    row('Nível', CpuLevels[this.level].label, (s) => update(() => (this.level = cycle(CpuLevelOrder, this.level, s))));
    row('Pontos para vencer', String(this.rules.target), (s) => update(() => (this.rules.target = cycle(TargetChoices, this.rules.target, s))));
    row('Cestas', `${this.rules.insidePoints} e ${this.rules.outsidePoints}`, () =>
      update(() => {
        const two = this.rules.insidePoints === 1;
        this.rules.insidePoints = two ? 2 : 1;
        this.rules.outsidePoints = two ? 3 : 2;
      }),
    );
    row('Make it take it', this.rules.makeItTakeIt ? 'Sim' : 'Não', () => update(() => (this.rules.makeItTakeIt = !this.rules.makeItTakeIt)));
    row('Relógio de posse', this.rules.shotClock ? `${this.rules.shotClock} s` : 'Sem', (s) =>
      update(() => (this.rules.shotClock = cycle(ClockChoices, this.rules.shotClock, s))),
    );
    this.button('Voltar', 'Menu principal', () => this.opts.onBack());
    this.select(Math.min(keep, this.items.length - 1));
    this.renderSide();
  }

  private renderSide(): void {
    this.side.replaceChildren();
    const build = cpuBuild(this.entry);
    const card = cpuCard(this.entry, build);
    const box = el('div', 'mm-card', this.side);
    el('h3', '', box, 'ADVERSÁRIO');
    el('div', 'name', box, card.name);
    el('div', 'arch', box, card.archetype);
    const facts = el('div', 'facts', box);
    const fact = (k: string, v: string): void => {
      const d = el('div', '', facts);
      el('span', '', d, k);
      el('b', '', d, v);
    };
    fact('OVR', String(card.overall));
    fact('POS', card.position);
    fact('ALTURA', formatMeters(card.heightCm));
    const note = el('div', 'ol-note', this.side);
    el('p', '', note, this.entry.blurb);
    const a = build.attrs;
    el('p', '', note, `3PT ${a.threePoint} · Bandeja ${a.drivingLayup} · Enterrada ${a.drivingDunk} · Defesa ${a.perimeterDefense} · Toco ${a.block} · Roubo ${a.steal}`);
    const me = cardFromBuild(this.opts.build, this.opts.name);
    const you = el('div', 'mm-card', this.side);
    el('h3', '', you, 'VOCÊ');
    el('div', 'name', you, me.name);
    el('div', 'arch', you, `${me.archetype} · OVR ${me.overall}`);
  }

  private start(): void {
    this.opts.onStart(makeCpuStart({ build: this.opts.build, name: this.opts.name, entry: this.entry, level: this.level, rules: this.rules }));
  }

  private button(label: string, desc: string, activate: () => void): void {
    const root = el('button', 'mm-item ol-item', this.main);
    el('span', 'lbl', root, label);
    if (desc) el('span', 'desc', root, desc);
    const i = this.items.length;
    root.addEventListener('mouseenter', () => this.select(i));
    root.addEventListener('click', () => {
      this.select(i);
      activate();
    });
    this.items.push({ root, activate });
  }

  private select(i: number): void {
    if (i < 0) return;
    this.index = i;
    this.items.forEach((item, k) => item.root.classList.toggle('on', k === i));
  }
}

function readPref(): { entry?: string; level?: CpuLevel } {
  try {
    return JSON.parse(localStorage.getItem(PrefKey) ?? '{}') as { entry?: string; level?: CpuLevel };
  } catch {
    return {};
  }
}

function writePref(p: { entry: string; level: CpuLevel }): void {
  try {
    localStorage.setItem(PrefKey, JSON.stringify(p));
  } catch {
    // sem armazenamento: escolhe de novo da próxima vez
  }
}
