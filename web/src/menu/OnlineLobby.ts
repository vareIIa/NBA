// Lobby do Online 1x1 (docs/24-multiplayer-online.md): conecta no servidor de salas e oferece partida rápida (fila),
// criar sala (código de 4 letras e link de convite) e entrar com código. Na sala: os dois jogadores, as regras (só quem
// criou muda) e o "Pronto". Quando o servidor manda match.start o menu fecha e o jogo monta a partida.
import './online.css';
import { type MenuHint, type MenuScreen, type NavAction, el } from './MenuScreen';
import type { PlayerBuild } from '../build/PlayerBuild';
import { NetClient, type NetStatus } from '../net/NetClient';
import { cardFromBuild } from '../net/playerCard';
import {
  type MatchRules,
  type RoomInfo,
  type ServerMsg,
  type Side,
  normalizeRoomCode,
} from '../net/protocol';

export interface OnlineStart {
  net: NetClient;
  start: Extract<ServerMsg, { t: 'match.start' }>;
}

export interface OnlineLobbyOptions {
  build: PlayerBuild;
  /** Nome do jogador na partida (?nome= na URL); sem ele, o nome da build. */
  name?: string | null;
  /** Código vindo do link de convite (?sala=). */
  autoJoin?: string | null;
  onBack: () => void;
  onMatch: (start: OnlineStart) => void;
}

type View = 'connecting' | 'offline' | 'home' | 'queue' | 'room' | 'starting';

interface Item {
  root: HTMLElement;
  activate?: () => void;
  left?: () => void;
  right?: () => void;
}

const TargetChoices = [7, 11, 15, 21];
const ClockChoices = [0, 12, 24];

/** Link de convite: esta página com ?sala=CODE (mantém ?mp= do servidor, se houver). */
export function inviteLink(code: string): string {
  const url = new URL(location.href);
  const keep = url.searchParams.get('mp');
  url.search = '';
  url.hash = '';
  url.searchParams.set('sala', code);
  if (keep) url.searchParams.set('mp', keep);
  return url.toString();
}

export class OnlineLobby implements MenuScreen {
  readonly root: HTMLElement;
  readonly crumb = 'ONLINE · 1 CONTRA 1';
  showroomOffset = 0.15;
  private readonly net: NetClient;
  private readonly main: HTMLElement;
  private readonly side: HTMLElement;
  private readonly toast: HTMLElement;
  private view: View = 'connecting';
  private items: Item[] = [];
  private index = 0;
  private room: RoomInfo | null = null;
  private you: Side = 0;
  private queueSince = 0;
  private queueClock: HTMLElement | null = null;
  private codeInput: HTMLInputElement | null = null;
  private toastTimer = 0;
  private pingLabel: HTMLElement | null = null;
  private readonly offs: (() => void)[] = [];
  private handedOff = false;
  private pendingJoin: string | null;

  constructor(private readonly opts: OnlineLobbyOptions) {
    this.net = new NetClient(cardFromBuild(opts.build, opts.name));
    this.pendingJoin = opts.autoJoin ? normalizeRoomCode(opts.autoJoin) : null;
    this.root = el('div', 'mn-screen');
    const grid = el('div', 'ol', this.root);
    this.main = el('section', 'ol-main', grid);
    el('div', '', grid); // meio: o jogador 3D
    this.side = el('aside', 'ol-side', grid);
    this.toast = el('div', 'mm-toast', this.root);
  }

  hints(): readonly MenuHint[] {
    if (this.view === 'room')
      return [
        { key: 'dpad', label: 'Navegar / mudar regra' },
        { key: 'a', label: 'Selecionar' },
        { key: 'b', label: 'Sair da sala' },
      ];
    return [
      { key: 'dpad', label: 'Navegar' },
      { key: 'a', label: 'Selecionar' },
      { key: 'b', label: this.view === 'queue' ? 'Cancelar' : 'Voltar' },
    ];
  }

  enter(): void {
    this.offs.push(
      this.net.onStatus((s) => this.onStatus(s)),
      this.net.on('room', (m) => {
        this.room = m.room;
        this.you = m.you;
        this.show('room');
      }),
      this.net.on('room.left', () => {
        this.room = null;
        this.show('home');
      }),
      this.net.on('queue', (m) => {
        if (m.waiting) {
          if (this.view !== 'queue') this.queueSince = performance.now();
          this.show('queue');
        } else if (this.view === 'queue') this.show('home');
      }),
      this.net.on('error', (m) => {
        if (m.code === 'rate_limit') return;
        this.flash(m.message);
        if (this.view === 'starting') this.show('home');
      }),
      this.net.on('match.start', (m) => {
        this.show('starting');
        this.handedOff = true;
        this.opts.onMatch({ net: this.net, start: m });
      }),
    );
    this.renderSide();
    this.show('connecting');
    void this.connect();
  }

  leave(): void {
    for (const off of this.offs.splice(0)) off();
    // Voltou ao menu sem partida: sai da sala/fila e fecha a conexão (a partida leva a conexão junto).
    if (!this.handedOff) {
      this.net.send({ t: 'queue.leave' });
      this.net.send({ t: 'room.leave' });
      this.net.close();
    }
  }

  update(dt: number): void {
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toast.classList.remove('show');
    if (this.queueClock) {
      const s = Math.floor((performance.now() - this.queueSince) / 1000);
      this.queueClock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    if (this.pingLabel) this.pingLabel.textContent = this.net.status === 'open' ? `${Math.round(this.net.rtt)} ms` : '—';
  }

  nav(action: NavAction): void {
    const n = this.items.length;
    if (action === 'back') return this.back();
    if (!n) return;
    if (action === 'up') this.select((this.index - 1 + n) % n);
    else if (action === 'down') this.select((this.index + 1) % n);
    else if (action === 'left') this.items[this.index]?.left?.();
    else if (action === 'right') this.items[this.index]?.right?.();
    else if (action === 'confirm') this.items[this.index]?.activate?.();
  }

  // ---------------------------------------------------------------- conexão

  private async connect(): Promise<void> {
    this.show('connecting');
    const ok = await this.net.connect();
    if (!ok) {
      this.show('offline');
      return;
    }
    if (this.pendingJoin) {
      const code = this.pendingJoin;
      this.pendingJoin = null;
      this.net.send({ t: 'room.join', code });
    } else if (this.view === 'connecting') {
      this.show('home');
    }
  }

  private onStatus(status: NetStatus): void {
    this.renderSide();
    if (status === 'open' && this.view === 'offline') this.show('home');
  }

  private back(): void {
    switch (this.view) {
      case 'queue':
        this.net.send({ t: 'queue.leave' });
        this.show('home');
        return;
      case 'room':
        this.net.send({ t: 'room.leave' });
        return;
      case 'starting':
        return;
      default:
        this.opts.onBack();
    }
  }

  // ---------------------------------------------------------------- telas

  private show(view: View): void {
    this.view = view;
    this.queueClock = null;
    this.codeInput = null;
    this.items = [];
    this.main.replaceChildren();
    el('h1', 'mn-h1', this.main, 'Online 1x1');
    switch (view) {
      case 'connecting':
        el('p', 'mn-sub', this.main, 'Conectando ao servidor de salas…');
        el('div', 'ol-spin', this.main);
        break;
      case 'offline':
        this.renderOffline();
        break;
      case 'home':
        this.renderHome();
        break;
      case 'queue':
        this.renderQueue();
        break;
      case 'room':
        this.renderRoom();
        break;
      case 'starting':
        el('p', 'mn-sub', this.main, 'Partida encontrada! Indo para a quadra…');
        el('div', 'ol-spin', this.main);
        break;
    }
    this.index = Math.min(this.index, Math.max(0, this.items.length - 1));
    if (view !== 'room') this.index = 0;
    this.select(this.index);
    this.renderSide();
  }

  private renderOffline(): void {
    el('p', 'mn-sub', this.main, 'O servidor de salas não respondeu.');
    const box = el('div', 'ol-note', this.main);
    el('p', '', box, this.net.lastError || 'Sem conexão.');
    // Instrução de programador só no `npm run dev`; quem joga pelo site vê o que pode fazer.
    if (import.meta.env.DEV) el('p', '', box, 'No PC: rode "npm run server" na pasta web. Online: confira o VITE_MP_URL do deploy (docs/24).');
    else if (!this.net.versionMismatch) el('p', '', box, 'Confira a sua internet e tente de novo.');
    this.button('Tentar de novo', 'Conectar outra vez', () => void this.connect());
    this.button('Voltar', 'Menu principal', () => this.opts.onBack());
  }

  private renderHome(): void {
    el('p', 'mn-sub', this.main, 'Jogue contra um amigo pela internet, até 11, regras de rua.');
    this.button('Partida rápida', 'Entra na fila e joga com quem aparecer', () => this.net.send({ t: 'queue.join' }));
    this.button('Criar sala', 'Gera um código para o seu amigo entrar', () => this.net.send({ t: 'room.create' }));
    const join = this.button('Entrar com código', 'Digite as 4 letras que o seu amigo mandou', () => {
      const code = normalizeRoomCode(input.value);
      if (code) this.net.send({ t: 'room.join', code });
      else input.focus();
    });
    const input = el('input', 'ol-code-input', join.root);
    input.maxLength = 6;
    input.placeholder = 'CÓDIGO';
    input.spellcheck = false;
    input.autocomplete = 'off';
    // O menu segura o teclado (keydown não chega ao campo): a digitação chega pelo evento input. 4 letras válidas já
    // entram na sala.
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase();
      const code = normalizeRoomCode(input.value);
      if (code) this.net.send({ t: 'room.join', code });
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    this.codeInput = input;
    this.button('Voltar', 'Menu principal', () => this.opts.onBack());
  }

  private renderQueue(): void {
    el('p', 'mn-sub', this.main, 'Procurando oponente…');
    const box = el('div', 'ol-queue', this.main);
    el('div', 'ol-spin', box);
    this.queueClock = el('b', 'ol-queue-clock', box, '0:00');
    this.button('Cancelar', 'Sair da fila', () => {
      this.net.send({ t: 'queue.leave' });
      this.show('home');
    });
  }

  private renderRoom(): void {
    const room = this.room!;
    const host = this.you === 0;
    el('p', 'mn-sub', this.main, room.quick ? 'Partida rápida' : 'Sala privada · mande o código para o seu amigo');
    if (!room.quick) {
      const code = el('div', 'ol-code', this.main);
      el('span', '', code, 'SALA');
      el('b', '', code, room.code);
      const link = inviteLink(room.code);
      el('div', 'ol-link', this.main, link);
      this.button('Copiar convite', 'Link que já entra na sala', () => {
        navigator.clipboard?.writeText(link).then(
          () => this.flash('Convite copiado'),
          () => this.flash('Não deu para copiar: copie o link acima'),
        ) ?? this.flash('Copie o link acima');
      });
    }
    const slots = el('div', 'ol-slots', this.main);
    for (const side of [0, 1] as const) {
      const p = room.players.find((q) => q.side === side);
      const slot = el('div', `ol-slot${p ? '' : ' empty'}${p?.ready ? ' ready' : ''}${side === this.you ? ' me' : ''}`, slots);
      if (!p) {
        el('div', 'ol-slot-name', slot, 'Esperando o amigo…');
        el('div', 'ol-slot-meta', slot, room.quick ? '' : `Código ${room.code}`);
        continue;
      }
      el('div', 'ol-slot-ovr', slot, String(p.card.overall));
      el('div', 'ol-slot-name', slot, `${p.card.name}${side === this.you ? ' (você)' : ''}`);
      el('div', 'ol-slot-meta', slot, `${p.card.position} · ${p.card.archetype} · ${(p.card.heightCm / 100).toFixed(2).replace('.', ',')} m`);
      el('div', 'ol-slot-state', slot, !p.connected ? 'RECONECTANDO' : p.ready ? 'PRONTO' : 'NÃO PRONTO');
    }
    this.rulesBlock(room.rules, host);
    const me = room.players.find((q) => q.side === this.you);
    const full = room.players.length === 2;
    this.button(me?.ready ? 'Cancelar pronto' : 'Pronto', full ? 'Os dois prontos começa a partida' : 'Fica pronto enquanto espera', () =>
      this.net.send({ t: 'room.ready', ready: !me?.ready }),
    );
    this.button('Sair da sala', '', () => this.net.send({ t: 'room.leave' }));
  }

  private rulesBlock(rules: MatchRules, host: boolean): void {
    const block = el('div', 'ol-rules', this.main);
    el('h3', '', block, host ? 'REGRAS (← → muda)' : 'REGRAS (quem criou a sala escolhe)');
    const set = (patch: Partial<MatchRules>): void => {
      if (host) this.net.send({ t: 'room.rules', rules: { ...rules, ...patch } });
    };
    const cycle = <T>(list: readonly T[], value: T, step: number): T => list[(list.indexOf(value) + step + list.length) % list.length] ?? list[0];
    const row = (label: string, value: string, change: (step: number) => void): void => {
      const r = el('div', `ol-rule${host ? '' : ' ro'}`, block);
      el('span', '', r, label);
      el('b', '', r, host ? `‹ ${value} ›` : value);
      if (!host) return;
      r.addEventListener('mouseenter', () => this.select(this.items.findIndex((i) => i.root === r)));
      r.addEventListener('click', () => change(1));
      this.items.push({ root: r, activate: () => change(1), left: () => change(-1), right: () => change(1) });
    };
    row('Pontos para vencer', String(rules.target), (s) => set({ target: cycle(TargetChoices, rules.target, s) }));
    row('Cestas', `${rules.insidePoints} e ${rules.outsidePoints}`, () =>
      set(rules.insidePoints === 1 ? { insidePoints: 2, outsidePoints: 3 } : { insidePoints: 1, outsidePoints: 2 }),
    );
    row('Make it take it', rules.makeItTakeIt ? 'Sim' : 'Não', () => set({ makeItTakeIt: !rules.makeItTakeIt }));
    row('Limpar a bola no rebote', rules.clearBall ? 'Sim' : 'Não', () => set({ clearBall: !rules.clearBall }));
    row('Vencer por 2', rules.winByTwo ? 'Sim' : 'Não', () => set({ winByTwo: !rules.winByTwo }));
    row('Relógio de posse', rules.shotClock ? `${rules.shotClock} s` : 'Sem', (s) => set({ shotClock: cycle(ClockChoices, rules.shotClock, s) }));
  }

  private renderSide(): void {
    this.side.replaceChildren();
    const card = el('div', 'mm-card', this.side);
    const c = cardFromBuild(this.opts.build, this.opts.name);
    el('h3', '', card, 'VOCÊ');
    el('div', 'name', card, c.name);
    el('div', 'arch', card, c.archetype);
    const facts = el('div', 'facts', card);
    const fact = (k: string, v: string): HTMLElement => {
      const d = el('div', '', facts);
      el('span', '', d, k);
      return el('b', '', d, v);
    };
    fact('OVR', String(c.overall));
    fact('POS', c.position);
    this.pingLabel = fact('PING', '—');
    const net = el('div', `ol-net ${this.net.status}`, this.side);
    const label: Record<NetStatus, string> = {
      idle: 'Desconectado',
      connecting: 'Conectando…',
      open: 'Conectado',
      reconnecting: 'Reconectando…',
      closed: 'Desconectado',
    };
    el('b', '', net, label[this.net.status]);
    el('span', '', net, this.net.url);
  }

  // ---------------------------------------------------------------- apoio

  private button(label: string, desc: string, activate: () => void): Item {
    const root = el('button', 'mm-item ol-item', this.main);
    el('span', 'lbl', root, label);
    if (desc) el('span', 'desc', root, desc);
    const item: Item = { root, activate };
    const i = this.items.length;
    root.addEventListener('mouseenter', () => this.select(i));
    root.addEventListener('click', () => {
      this.select(i);
      activate();
    });
    this.items.push(item);
    return item;
  }

  private select(i: number): void {
    if (i < 0) return;
    this.index = i;
    this.items.forEach((item, k) => item.root.classList.toggle('on', k === i));
    // No item do código, o campo ganha o foco (dá para digitar direto).
    if (this.codeInput && this.items[i]?.root.contains(this.codeInput)) this.codeInput.focus();
    else this.codeInput?.blur();
  }

  private flash(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = 2.4;
  }
}
