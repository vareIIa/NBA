// Fluxo do menu principal, antes do Freestyle (docs/23-myplayer-builder.md):
//   Menu principal → Meu Jogador (builds) → Jogador (nome, posição, mão, número) → Corpo (altura, peso, envergadura)
//   → Atributos (builder/BuilderView) → Shades Of → Freestyle.
// O fluxo monta a moldura (topo, palco, rodapé), troca as telas, lê teclado e controle (com repetição de direção
// segurada, como a pausa) e roda o showroom (o nosso jogador 3D no meio). run() termina quando o jogador entra no
// Freestyle e devolve a build escolhida.
import './menu.css';
import { type MenuHint, type MenuScreen, type NavAction, el, keyToNav } from './MenuScreen';
import { MainMenu } from './MainMenu';
import { BuildList } from './BuildList';
import { CreatePlayer } from './CreatePlayer';
import { BodyScreen } from './BodyScreen';
import { BuilderView } from './builder/BuilderView';
import { ShadesOf } from './ShadesOf';
import type { Showroom } from './Showroom';
import type { PlayerBuild } from '../build/PlayerBuild';
import { displayName, formatFeet, Positions } from '../build/PlayerBuild';
import { overall } from '../build/BuildRules';
import { BuildSave } from '../build/BuildSave';
import { RepeatDelay, holdRepeats } from '../hud/PauseMenu';
import { OnlineLobby, type OnlineStart } from './OnlineLobby';
import { type CpuStart, CpuSetupScreen } from './CpuSetup';

export interface MenuResult {
  build: PlayerBuild;
  /** "Testar build": a build não foi salva (o Freestyle usa, mas ela não vira a ativa). */
  test: boolean;
  /** Online 1x1: a partida que o servidor começou (com a conexão aberta). */
  online?: OnlineStart;
  /** 1 contra 1 contra a CPU: a sala local e o oponente (docs/25). */
  cpu?: CpuStart;
}

// Índices do mapeamento standard (Xbox).
const Btn = { a: 0, b: 1, y: 3, lb: 4, rb: 5, up: 12, down: 13, left: 14, right: 15 } as const;

const HintGlyph: Record<MenuHint['key'], { pad: string; key: string; cls: string }> = {
  a: { pad: 'A', key: 'Enter', cls: 'a' },
  b: { pad: 'B', key: 'Esc', cls: 'b' },
  y: { pad: 'Y', key: 'Tab', cls: 'y' },
  lb: { pad: 'LB', key: 'Q', cls: 'k' },
  rb: { pad: 'RB', key: 'E', cls: 'k' },
  dpad: { pad: '✥', key: '↑↓←→', cls: 'k' },
};

export class MenuFlow {
  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly crumb: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly hintsBar: HTMLElement;
  private screen: MenuScreen | null = null;
  private readonly main: MainMenu;
  private readonly list: BuildList;
  /** Build ativa em memória (o localStorage só é lido quando ela pode ter mudado). */
  private active: PlayerBuild = BuildSave.active();
  private padUsed = false;
  private prevButtons: Record<string, boolean> = {};
  private hold: { dir: NavAction; wait: number } | null = null;
  private resolve: ((r: MenuResult) => void) | null = null;
  private last = performance.now();
  private running = false;
  private readonly onKeyBound = (e: KeyboardEvent): void => this.onKey(e);
  /** Soltar tecla também não chega ao jogo enquanto o menu está aberto (o Input veria uma soltura sem o aperto). */
  private readonly onKeyUpBound = (e: KeyboardEvent): void => e.stopPropagation();

  constructor(private readonly showroom: Showroom) {
    this.root = el('div', 'mn');
    el('div', 'mn-bg', this.root);
    const top = el('header', 'mn-top', this.root);
    const logo = el('div', 'mn-logo', top);
    el('b', '', logo, 'GARRAFÃO');
    this.crumb = el('span', 'mn-crumb', top);
    this.chip = el('div', 'mn-chip', top);
    this.stage = el('main', 'mn-stage', this.root);
    this.hintsBar = el('footer', 'mn-hints', this.root);

    this.main = new MainMenu(
      () => BuildSave.active(),
      (choice) => {
        if (choice === 'freestyle') this.finish({ build: BuildSave.active(), test: false });
        else if (choice === 'online') this.showOnline(null);
        else if (choice === 'cpu') this.showCpu();
        else this.show(this.list);
      },
    );
    this.list = new BuildList({
      onBack: () => this.show(this.main),
      onPlay: (build) => {
        BuildSave.setActive(build.id);
        this.finish({ build, test: false });
      },
      onCreate: (draft) => this.editIdentity(draft),
      onEdit: (build) => this.editIdentity({ ...build }),
      onChanged: () => this.renderChip(),
    });
  }

  /** Abre o menu e espera o jogador escolher o Freestyle. */
  run(): Promise<MenuResult> {
    document.body.appendChild(this.root);
    document.body.classList.add('mn-open'); // esconde o HUD do jogo atrás do menu
    window.addEventListener('keydown', this.onKeyBound, true);
    window.addEventListener('keyup', this.onKeyUpBound, true);
    this.renderChip();
    // Link de convite (?sala=CODE): abre direto no lobby online, entrando na sala.
    const invite = new URLSearchParams(location.search).get('sala');
    if (invite) this.showOnline(invite);
    else this.show(this.main);
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    return new Promise((resolve) => (this.resolve = resolve));
  }

  // ------------------------------------------------------------------ telas do builder

  private editIdentity(draft: PlayerBuild): void {
    this.show(
      new CreatePlayer(draft, {
        onBack: () => this.show(this.list),
        onNext: (b) => this.editBody(b),
      }),
    );
  }

  private editBody(draft: PlayerBuild): void {
    this.show(
      new BodyScreen(draft, {
        onBack: (b) => this.editIdentity(b),
        onNext: (b) => this.editAttributes(b),
      }),
    );
  }

  private editAttributes(draft: PlayerBuild): void {
    this.show(
      new BuilderView({
        build: draft,
        onBack: (b) => this.editBody(b),
        onDone: (b) => this.showShades(b),
      }),
    );
  }

  private showShades(build: PlayerBuild): void {
    this.show(
      new ShadesOf(build, {
        onPlay: (b) => {
          BuildSave.save(b, true);
          this.finish({ build: b, test: false });
        },
        onTest: (b) => this.finish({ build: b, test: true }),
        onEdit: (b) => this.editAttributes(b),
        onBuilds: (b) => {
          BuildSave.save(b, true);
          this.renderChip();
          this.show(this.list);
        },
      }),
    );
  }

  // ------------------------------------------------------------------ online

  private showOnline(autoJoin: string | null): void {
    const build = BuildSave.active();
    this.show(
      new OnlineLobby({
        build,
        name: new URLSearchParams(location.search).get('nome'),
        autoJoin,
        onBack: () => this.show(this.main),
        onMatch: (online) => this.finish({ build, test: false, online }),
      }),
    );
  }

  // ------------------------------------------------------------------ 1 contra 1 contra a CPU

  private showCpu(): void {
    const build = BuildSave.active();
    this.show(
      new CpuSetupScreen({
        build,
        name: new URLSearchParams(location.search).get('nome'),
        onBack: () => this.show(this.main),
        onStart: (cpu) => this.finish({ build, test: false, cpu }),
      }),
    );
  }

  // ------------------------------------------------------------------ moldura

  private show(next: MenuScreen): void {
    this.screen?.leave();
    this.stage.replaceChildren(next.root);
    this.screen = next;
    this.crumb.textContent = next.crumb;
    this.showroom.setOffset(next.showroomOffset ?? 0);
    next.enter();
    this.renderHints();
  }

  private renderChip(): void {
    const b = (this.active = BuildSave.active());
    this.chip.replaceChildren();
    el('div', 'ovr', this.chip, String(overall(b)));
    const who = el('div', 'who', this.chip);
    el('b', '', who, displayName(b));
    el('span', '', who, `${Positions[b.position].full} · ${formatFeet(b.body.heightCm)}`);
  }

  private renderHints(): void {
    this.hintsBar.replaceChildren();
    for (const hint of this.screen?.hints() ?? []) {
      const glyph = HintGlyph[hint.key];
      const h = el('span', 'mn-hint', this.hintsBar);
      el('span', `mn-btn ${this.padUsed ? glyph.cls : 'k'}`, h, this.padUsed ? glyph.pad : glyph.key);
      el('span', '', h, hint.label);
    }
  }

  private finish(result: MenuResult): void {
    if (!this.resolve) return;
    const resolve = this.resolve;
    this.resolve = null;
    this.running = false;
    this.screen?.leave();
    window.removeEventListener('keydown', this.onKeyBound, true);
    window.removeEventListener('keyup', this.onKeyUpBound, true);
    this.root.classList.add('mn-out');
    setTimeout(() => this.root.remove(), 320);
    document.body.classList.remove('mn-open');
    this.showroom.dispose();
    resolve(result);
  }

  // ------------------------------------------------------------------ entrada e quadro

  private onKey(e: KeyboardEvent): void {
    // O menu é dono do teclado: nenhuma tecla chega ao Input do jogo (digitar "Prestia" apertava o E = spin, que
    // disparava quando o Freestyle começava). A digitação nos campos continua (stopPropagation não impede o padrão).
    e.stopPropagation();
    const typing = e.target instanceof HTMLInputElement;
    // Num campo de texto, só Enter, Esc, Tab e ↑↓ navegam; o resto é digitação.
    if (typing && !['Enter', 'NumpadEnter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) return;
    const action = keyToNav(e.code);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (typing) (e.target as HTMLInputElement).blur();
    if (this.padUsed) {
      this.padUsed = false;
      this.renderHints();
    }
    // Esc/Enter num campo só saem dele (não voltam de tela nem confirmam a tela).
    if (typing && (action === 'back' || action === 'confirm')) return;
    this.screen?.nav(action);
  }

  private pollPad(dt: number): void {
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
    if (!pad) return;
    const pressed = (i: number): boolean => !!pad.buttons[i]?.pressed;
    const lx = pad.axes[0] ?? 0;
    const ly = pad.axes[1] ?? 0;
    const now: Record<string, boolean> = {
      up: pressed(Btn.up) || ly < -0.5,
      down: pressed(Btn.down) || ly > 0.5,
      left: pressed(Btn.left) || lx < -0.5,
      right: pressed(Btn.right) || lx > 0.5,
      confirm: pressed(Btn.a),
      back: pressed(Btn.b),
      alt: pressed(Btn.y),
      prevTab: pressed(Btn.lb),
      nextTab: pressed(Btn.rb),
    };
    this.showroom.nudge(pad.axes[2] ?? 0, dt);
    const fire = (a: NavAction): void => {
      if (!this.padUsed) {
        this.padUsed = true;
        this.renderHints();
      }
      this.screen?.nav(a);
    };
    for (const [name, down] of Object.entries(now)) {
      const action = name as NavAction;
      if (down && !this.prevButtons[name]) {
        fire(action);
        if (['up', 'down', 'left', 'right'].includes(action)) this.hold = { dir: action, wait: RepeatDelay };
      }
    }
    if (this.hold) {
      if (!now[this.hold.dir]) this.hold = null;
      else for (let i = holdRepeats(this.hold, dt); i > 0; i--) fire(this.hold.dir);
    }
    this.prevButtons = now;
  }

  private frame(t: number): void {
    if (!this.running) return;
    const dt = Math.min(0.1, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    this.pollPad(dt);
    this.screen?.update?.(dt);
    // O corpo do showroom segue o rascunho da tela (altura ao vivo na tela de corpo).
    const body = this.screen?.body?.() ?? this.active.body;
    this.showroom.setBody(body);
    this.showroom.update(dt);
    requestAnimationFrame((n) => this.frame(n));
  }
}
