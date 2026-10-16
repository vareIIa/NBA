// Hub do multiplayer: conexões, jogadores (com reconexão por token), fila da partida rápida, salas privadas com código,
// prontos, regras, partida (Referee), revanche e queda de conexão. Puro: não importa Node nem ws. Quem hospeda
// (web/server/dev.ts no Node, o Durable Object no Worker) entrega as conexões como Peer e chama tick() a cada ~100 ms.
import {
  type ClientMsg,
  DefaultRules,
  type ErrorCode,
  MaxFrameBytes,
  type MatchEvent,
  type MatchRules,
  type PlayerCard,
  ProtocolVersion,
  type RoomInfo,
  RoomCodeAlphabet,
  RoomCodeLength,
  type ServerMsg,
  type Side,
  normalizeRoomCode,
  otherSide,
} from '../protocol.ts';
import { Referee } from './Referee.ts';

export interface Peer {
  id: string;
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

export interface HubOptions {
  /** Relógio (ms). */
  now?: () => number;
  /** [0, 1): códigos de sala, cara ou coroa do primeiro ataque. */
  random?: () => number;
  /** [0, 1): o sorteio do juiz (roubo). Padrão: o random. */
  refereeRandom?: () => number;
  log?: (...args: unknown[]) => void;
}

/** Sem mensagem nenhuma por este tempo (o cliente pinga a cada 2 s): a conexão caiu sem fechar. */
export const IdleTimeoutMs = 20000;
/** Quanto tempo a vaga (e a partida) espera quem caiu. */
export const ReconnectGraceMs = 30000;
/** Limite de quadros por segundo de uma conexão (o estado vai a ~20 Hz; pings e relatos são poucos). */
export const MaxFramesPerSecond = 120;

interface Conn {
  peer: Peer;
  player: Player | null;
  lastSeen: number;
  windowStart: number;
  windowCount: number;
}

interface Player {
  id: string;
  token: string;
  card: PlayerCard;
  conn: Conn | null;
  room: Room | null;
  queued: boolean;
  droppedAt: number;
}

interface Room {
  code: string;
  quick: boolean;
  rules: MatchRules;
  seats: [Player | null, Player | null];
  ready: [boolean, boolean];
  rematch: [boolean, boolean];
  referee: Referee | null;
  /** Quem começou atacando na última partida (a revanche alterna). */
  lastFirstOffense: Side | null;
  /** Dentro do startMatch: os eventos do juiz esperam o match.start. */
  starting: boolean;
}

const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
};
const cleanText = (v: unknown, max: number, fallback: string): string => {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '';
  return s || fallback;
};

export function sanitizeCard(raw: unknown): PlayerCard {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PlayerCard, unknown>>;
  return {
    name: cleanText(c.name, 18, 'Jogador'),
    heightCm: clampNum(c.heightCm, 150, 240, 191),
    wingspanOverM: clampNum(c.wingspanOverM, 0, 0.3, 0),
    wingspanCm: clampNum(c.wingspanCm, 150, 260, 198),
    overall: Math.round(clampNum(c.overall, 25, 99, 60)),
    archetype: cleanText(c.archetype, 40, ''),
    position: cleanText(c.position, 4, ''),
    perimeterDefense: Math.round(clampNum(c.perimeterDefense, 25, 99, 60)),
    steal: Math.round(clampNum(c.steal, 25, 99, 60)),
    block: Math.round(clampNum(c.block, 25, 99, 60)),
    vertical: Math.round(clampNum(c.vertical, 25, 99, 60)),
    ballHandle: Math.round(clampNum(c.ballHandle, 25, 99, 60)),
    glove: Math.round(clampNum(c.glove, 0, 4, 0)),
    unpluckable: Math.round(clampNum(c.unpluckable, 0, 4, 0)),
  };
}

export function sanitizeRules(raw: unknown, base: MatchRules = DefaultRules): MatchRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof MatchRules, unknown>>;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const int = (v: unknown, lo: number, hi: number, fallback: number): number => Math.round(clampNum(v, lo, hi, fallback));
  const clock = int(r.shotClock, 0, 30, base.shotClock);
  return {
    target: int(r.target, 3, 30, base.target),
    winByTwo: bool(r.winByTwo, base.winByTwo),
    makeItTakeIt: bool(r.makeItTakeIt, base.makeItTakeIt),
    clearBall: bool(r.clearBall, base.clearBall),
    insidePoints: int(r.insidePoints, 1, 3, base.insidePoints),
    outsidePoints: int(r.outsidePoints, 1, 4, base.outsidePoints),
    shotClock: clock > 0 && clock < 8 ? 8 : clock,
  };
}

function randomToken(length: number, random: () => number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(random() * 256);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export class Hub {
  private readonly conns = new Map<string, Conn>();
  private readonly players = new Map<string, Player>();
  private readonly byToken = new Map<string, Player>();
  private readonly rooms = new Map<string, Room>();
  private queue: Player[] = [];
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly refereeRandom: () => number;
  private readonly log: (...args: unknown[]) => void;

  constructor(opts: HubOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
    this.refereeRandom = opts.refereeRandom ?? this.random;
    this.log = opts.log ?? (() => undefined);
  }

  /** Números para o painel do servidor. */
  stats(): { connections: number; players: number; rooms: number; matches: number; queued: number } {
    let matches = 0;
    for (const room of this.rooms.values()) if (room.referee && !room.referee.over) matches++;
    return { connections: this.conns.size, players: this.players.size, rooms: this.rooms.size, matches, queued: this.queue.length };
  }

  connect(peer: Peer): void {
    const now = this.now();
    this.conns.set(peer.id, { peer, player: null, lastSeen: now, windowStart: now, windowCount: 0 });
  }

  disconnect(peerId: string): void {
    const conn = this.conns.get(peerId);
    if (!conn) return;
    this.conns.delete(peerId);
    const player = conn.player;
    if (!player || player.conn !== conn) return;
    player.conn = null;
    player.droppedAt = this.now();
    this.leaveQueue(player);
    const room = player.room;
    if (!room) return;
    const side = this.sideOf(room, player);
    this.log('caiu', player.card.name, room.code);
    if (room.referee && !room.referee.over) room.referee.pause(side);
    this.sendTo(this.opponentOf(room, side), { t: 'opponent', connected: false, graceEndsAt: player.droppedAt + ReconnectGraceMs });
    this.broadcastRoom(room);
  }

  message(peerId: string, text: string): void {
    const conn = this.conns.get(peerId);
    if (!conn) return;
    const now = this.now();
    conn.lastSeen = now;
    if (now - conn.windowStart >= 1000) {
      conn.windowStart = now;
      conn.windowCount = 0;
    }
    if (++conn.windowCount > MaxFramesPerSecond) {
      if (conn.windowCount === MaxFramesPerSecond + 1) this.error(conn, 'rate_limit', 'mensagens demais por segundo');
      return;
    }
    if (text.length > MaxFrameBytes) return this.error(conn, 'bad_message', 'quadro grande demais');
    let msg: ClientMsg;
    try {
      msg = JSON.parse(text) as ClientMsg;
    } catch {
      return this.error(conn, 'bad_message', 'JSON inválido');
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return this.error(conn, 'bad_message', 'sem tipo');
    if (msg.t === 'hello') return this.hello(conn, msg);
    if (msg.t === 'ping') return this.send(conn, { t: 'pong', c: Number(msg.c) || 0, s: now });
    const player = conn.player;
    if (!player) return this.error(conn, 'not_hello', 'mande hello primeiro');
    switch (msg.t) {
      case 'queue.join':
        return this.joinQueue(player);
      case 'queue.leave':
        this.leaveQueue(player);
        return this.sendTo(player, { t: 'queue', waiting: false, players: this.queue.length });
      case 'room.create':
        return this.createRoom(player, msg.rules);
      case 'room.join':
        return this.joinRoom(player, String(msg.code ?? ''));
      case 'room.leave':
        return this.leaveRoom(player);
      case 'room.ready':
        return this.setReady(player, !!msg.ready);
      case 'room.rules':
        return this.setRules(player, msg.rules);
      case 'room.rematch':
        return this.setRematch(player, !!msg.want);
      case 'st':
        return this.relay(player, text);
      case 'rtc':
        return this.relaySignal(player, text);
      case 'g.release':
      case 'g.result':
      case 'g.claim':
      case 'g.cleared':
      case 'g.block':
      case 'g.steal':
        return this.report(player, msg);
      default:
        return this.error(conn, 'bad_message', `tipo desconhecido: ${String((msg as { t: unknown }).t)}`);
    }
  }

  tick(): void {
    const now = this.now();
    for (const conn of [...this.conns.values()]) {
      if (now - conn.lastSeen > IdleTimeoutMs) {
        this.log('sem sinal', conn.player?.card.name ?? conn.peer.id);
        try {
          conn.peer.close(4000, 'timeout');
        } catch {
          /* já fechada */
        }
        this.disconnect(conn.peer.id);
      }
    }
    for (const room of [...this.rooms.values()]) {
      room.referee?.tick();
      for (const side of [0, 1] as const) {
        const p = room.seats[side];
        if (p && !p.conn && now - p.droppedAt > ReconnectGraceMs) {
          this.log('não voltou', p.card.name, room.code);
          this.leaveRoom(p);
        }
      }
    }
    // Jogador sem conexão e sem sala: some depois da janela de reconexão.
    for (const p of [...this.players.values()]) {
      if (!p.conn && !p.room && now - p.droppedAt > ReconnectGraceMs) {
        this.players.delete(p.id);
        this.byToken.delete(p.token);
      }
    }
  }

  // ---------------------------------------------------------------- conexão e identidade

  private hello(conn: Conn, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (msg.v !== ProtocolVersion) {
      this.error(conn, 'version', `versão ${String(msg.v)} do jogo, servidor na ${ProtocolVersion}: recarregue a página`);
      conn.peer.close(4001, 'version');
      return;
    }
    const card = sanitizeCard(msg.card);
    if (conn.player) {
      // hello repetido na mesma conexão: só a mesma identidade.
      if (msg.token !== conn.player.token) return this.error(conn, 'bad_message', 'hello repetido');
      conn.player.card = card;
      return this.send(conn, { t: 'welcome', id: conn.player.id, token: conn.player.token, serverTime: this.now() });
    }
    let player = typeof msg.token === 'string' ? this.byToken.get(msg.token) : undefined;
    if (player) {
      // Voltou (recarregou a página, a rede piscou): a conexão antiga, se ainda existir, sai.
      const old = player.conn;
      if (old && old !== conn) {
        old.player = null;
        this.error(old, 'replaced', 'conectado em outra aba');
        try {
          old.peer.close(4002, 'replaced');
        } catch {
          /* já fechada */
        }
      }
      player.card = card;
    } else {
      player = {
        id: randomToken(10, this.random),
        token: randomToken(24, this.random),
        card,
        conn: null,
        room: null,
        queued: false,
        droppedAt: 0,
      };
      this.players.set(player.id, player);
      this.byToken.set(player.token, player);
    }
    player.conn = conn;
    conn.player = player;
    this.send(conn, { t: 'welcome', id: player.id, token: player.token, serverTime: this.now() });
    const room = player.room;
    if (!room) return;
    // Estava numa sala: devolve a sala (e a partida, se houver) e avisa o oponente.
    const side = this.sideOf(room, player);
    this.log('voltou', card.name, room.code);
    this.sendTo(this.opponentOf(room, side), { t: 'opponent', connected: true, graceEndsAt: 0 });
    if (room.referee) {
      if (room.referee.state.phase === 'paused' && this.bothConnected(room)) room.referee.resume();
      this.sendTo(player, { t: 'match.start', room: this.roomInfo(room), you: side, state: room.referee.state, serverTime: this.now() });
      this.broadcastRoom(room);
    } else {
      this.broadcastRoom(room);
    }
  }

  // ---------------------------------------------------------------- fila e salas

  private joinQueue(player: Player): void {
    if (player.room) return this.error(player.conn, 'in_room', 'saia da sala antes de entrar na fila');
    if (!player.queued) {
      player.queued = true;
      this.queue.push(player);
    }
    this.queue = this.queue.filter((p) => p.conn && p.queued);
    while (this.queue.length >= 2) {
      const a = this.queue.shift()!;
      const b = this.queue.shift()!;
      a.queued = b.queued = false;
      const room = this.newRoom(true, DefaultRules);
      this.seat(room, a, 0);
      this.seat(room, b, 1);
      this.log('partida rápida', room.code, a.card.name, 'x', b.card.name);
      this.startMatch(room);
    }
    for (const p of this.queue) this.sendTo(p, { t: 'queue', waiting: true, players: this.queue.length });
  }

  private leaveQueue(player: Player): void {
    if (!player.queued) return;
    player.queued = false;
    this.queue = this.queue.filter((p) => p !== player);
  }

  private createRoom(player: Player, rules: Partial<MatchRules> | undefined): void {
    if (player.room) return this.error(player.conn, 'in_room', 'você já está numa sala');
    this.leaveQueue(player);
    const room = this.newRoom(false, sanitizeRules(rules));
    this.seat(room, player, 0);
    this.log('sala criada', room.code, player.card.name);
    this.broadcastRoom(room);
  }

  private joinRoom(player: Player, raw: string): void {
    const code = normalizeRoomCode(raw);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) return this.error(player.conn, 'room_not_found', `sala ${raw.toUpperCase()} não existe`);
    if (player.room === room) return this.broadcastRoom(room);
    if (player.room) return this.error(player.conn, 'in_room', 'saia da sala atual primeiro');
    const free = room.seats[0] === null ? 0 : room.seats[1] === null ? 1 : -1;
    if (free < 0 || room.quick) return this.error(player.conn, 'room_full', `sala ${code} está cheia`);
    if (room.referee && !room.referee.over) return this.error(player.conn, 'in_match', `sala ${code} está em partida`);
    this.leaveQueue(player);
    this.seat(room, player, free as Side);
    room.ready = [false, false];
    this.log('entrou', code, player.card.name);
    this.broadcastRoom(room);
  }

  private leaveRoom(player: Player): void {
    const room = player.room;
    if (!room) return;
    const side = this.sideOf(room, player);
    if (room.referee && !room.referee.over) room.referee.forfeit(side);
    room.seats[side] = null;
    room.ready = [false, false];
    room.rematch = [false, false];
    player.room = null;
    this.sendTo(player, { t: 'room.left' });
    if (!room.seats[0] && !room.seats[1]) {
      this.rooms.delete(room.code);
      this.log('sala fechada', room.code);
      return;
    }
    // Ficou um só: a partida terminada sai (a próxima começa do zero quando alguém entrar). O dono da sala passa a ser
    // quem ficou (lugar 0).
    if (!room.referee || room.referee.over) room.referee = null;
    if (!room.referee && !room.seats[0] && room.seats[1]) {
      room.seats = [room.seats[1], null];
    }
    if (room.quick && !room.referee) {
      // Sala da partida rápida não recebe ninguém: quem ficou volta para o lobby.
      const left = room.seats[0] ?? room.seats[1];
      if (left) this.leaveRoom(left);
      return;
    }
    this.broadcastRoom(room);
  }

  private setReady(player: Player, ready: boolean): void {
    const room = player.room;
    if (!room || (room.referee && !room.referee.over)) return;
    room.ready[this.sideOf(room, player)] = ready;
    this.broadcastRoom(room);
    if (room.seats[0] && room.seats[1] && room.ready[0] && room.ready[1] && this.bothConnected(room)) this.startMatch(room);
  }

  private setRules(player: Player, rules: Partial<MatchRules>): void {
    const room = player.room;
    if (!room) return;
    if (this.sideOf(room, player) !== 0) return this.error(player.conn, 'not_host', 'só quem criou a sala muda as regras');
    if (room.referee && !room.referee.over) return this.error(player.conn, 'in_match', 'partida em andamento');
    room.rules = sanitizeRules(rules, room.rules);
    room.ready = [false, false];
    this.broadcastRoom(room);
  }

  private setRematch(player: Player, want: boolean): void {
    const room = player.room;
    if (!room?.referee?.over) return;
    room.rematch[this.sideOf(room, player)] = want;
    this.broadcastRoom(room);
    if (room.rematch[0] && room.rematch[1] && this.bothConnected(room)) this.startMatch(room);
  }

  private startMatch(room: Room): void {
    const first: Side = room.lastFirstOffense === null ? (this.random() < 0.5 ? 0 : 1) : otherSide(room.lastFirstOffense);
    room.lastFirstOffense = first;
    room.ready = [false, false];
    room.rematch = [false, false];
    room.referee = new Referee(room.rules, first, this.now, (event) => this.onMatchEvent(room, event), {
      card: (side) => room.seats[side]?.card ?? null,
      random: this.refereeRandom,
    });
    // O match.start já leva o estado do primeiro check (com a contagem): o evento 'start' do juiz não sai à parte.
    room.starting = true;
    room.referee.start();
    room.starting = false;
    for (const side of [0, 1] as const) {
      this.sendTo(room.seats[side], {
        t: 'match.start',
        room: this.roomInfo(room),
        you: side,
        state: room.referee.state,
        serverTime: this.now(),
      });
    }
    this.log('partida', room.code, room.seats[0]?.card.name, 'x', room.seats[1]?.card.name);
  }

  private onMatchEvent(room: Room, event: MatchEvent | null): void {
    if (room.starting) return;
    const state = room.referee!.state;
    for (const p of room.seats) this.sendTo(p, { t: 'match.state', state, event, serverTime: this.now() });
    if (event?.kind === 'over') {
      this.log('fim', room.code, state.score.join(' x '), event.reason);
      this.broadcastRoom(room);
    }
  }

  // ---------------------------------------------------------------- jogo

  /**
   * Sinalização do canal direto (offer/answer/ICE do WebRTC): vai como chegou para o outro da sala, só com partida
   * (o canal sobe no match.start). O servidor não lê; quem recebe valida (src/net/PeerLink.ts).
   */
  private relaySignal(player: Player, text: string): void {
    const room = player.room;
    if (!room?.referee) return;
    const other = this.opponentOf(room, this.sideOf(room, player));
    if (other?.conn) this.raw(other.conn, text);
  }

  private relay(player: Player, text: string): void {
    const room = player.room;
    if (!room?.referee) return;
    const other = this.opponentOf(room, this.sideOf(room, player));
    // O quadro vai como chegou ({t:'st', d}, a mesma forma nos dois sentidos): o servidor não lê nem reescreve o estado.
    if (other?.conn) this.raw(other.conn, text);
  }

  private report(player: Player, msg: Extract<ClientMsg, { t: 'g.release' | 'g.result' | 'g.claim' | 'g.cleared' | 'g.block' | 'g.steal' }>): void {
    const room = player.room;
    const ref = room?.referee;
    if (!room || !ref) return;
    const side = this.sideOf(room, player);
    const seq = Number(msg.seq);
    switch (msg.t) {
      case 'g.release':
        ref.release(side, seq);
        return;
      case 'g.result':
        ref.result(side, seq, !!msg.scored, !!msg.isThree);
        return;
      case 'g.claim':
        ref.claim(side, seq);
        return;
      case 'g.cleared':
        ref.cleared(side, seq);
        return;
      case 'g.block':
        ref.block(side, seq);
        return;
      case 'g.steal':
        ref.steal(side, seq, clampNum(msg.exp, 0, 1, 0));
        return;
    }
  }

  // ---------------------------------------------------------------- apoio

  private newRoom(quick: boolean, rules: MatchRules): Room {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < RoomCodeLength; i++) code += RoomCodeAlphabet[Math.floor(this.random() * RoomCodeAlphabet.length)];
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      quick,
      rules,
      seats: [null, null],
      ready: [false, false],
      rematch: [false, false],
      referee: null,
      lastFirstOffense: null,
      starting: false,
    };
    this.rooms.set(code, room);
    return room;
  }

  private seat(room: Room, player: Player, side: Side): void {
    room.seats[side] = player;
    player.room = room;
  }

  private sideOf(room: Room, player: Player): Side {
    return room.seats[1] === player ? 1 : 0;
  }

  private opponentOf(room: Room, side: Side): Player | null {
    return room.seats[otherSide(side)];
  }

  private bothConnected(room: Room): boolean {
    return !!room.seats[0]?.conn && !!room.seats[1]?.conn;
  }

  private roomInfo(room: Room): RoomInfo {
    const players = [];
    for (const side of [0, 1] as const) {
      const p = room.seats[side];
      if (p) players.push({ side, card: p.card, ready: room.ready[side], connected: !!p.conn });
    }
    return {
      code: room.code,
      quick: room.quick,
      rules: room.rules,
      players,
      inMatch: !!room.referee,
      rematch: [...room.rematch] as [boolean, boolean],
    };
  }

  private broadcastRoom(room: Room): void {
    const info = this.roomInfo(room);
    for (const side of [0, 1] as const) this.sendTo(room.seats[side], { t: 'room', room: info, you: side });
  }

  private sendTo(player: Player | null, msg: ServerMsg): void {
    if (player?.conn) this.send(player.conn, msg);
  }

  private send(conn: Conn, msg: ServerMsg): void {
    this.raw(conn, JSON.stringify(msg));
  }

  private raw(conn: Conn, text: string): void {
    try {
      conn.peer.send(text);
    } catch (e) {
      this.log('falha ao enviar', conn.peer.id, e);
    }
  }

  private error(conn: Conn | null, code: ErrorCode, message: string): void {
    if (conn) this.send(conn, { t: 'error', code, message });
  }
}
