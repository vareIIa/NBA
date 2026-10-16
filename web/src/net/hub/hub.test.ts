import { describe, expect, it } from 'vitest';
import { Hub, IdleTimeoutMs, ReconnectGraceMs, type Peer } from './Hub.ts';
import { CheckMs, DeadMs, FirstCheckMs, LooseMaxMs } from './Referee.ts';
import { type ClientMsg, type PlayerCard, ProtocolVersion, type ServerMsg, type Side, normalizeRoomCode, shotClockLeft } from '../protocol.ts';

const card = (name: string): PlayerCard => ({
  name,
  heightCm: 196,
  wingspanOverM: 0.05,
  wingspanCm: 205,
  overall: 80,
  archetype: 'Armador',
  position: 'PG',
  perimeterDefense: 70,
});

class FakePeer implements Peer {
  inbox: ServerMsg[] = [];
  closed: { code?: number; reason?: string } | null = null;
  /** O teste derrubou a conexão (hub.disconnect): para de pingar. */
  gone = false;
  constructor(readonly id: string) {}
  send(text: string): void {
    this.inbox.push(JSON.parse(text) as ServerMsg);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i].t === t) return this.inbox[i] as Extract<ServerMsg, { t: T }>;
    return undefined;
  }
  all<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }>[] {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[];
  }
}

function setup(randomValues: number[] = []) {
  let clock = 1_000_000;
  let r = 0;
  const hub = new Hub({ now: () => clock, random: () => (r < randomValues.length ? randomValues[r++] : 0.3) });
  let n = 0;
  const peers: FakePeer[] = [];
  const join = (name: string, token?: string) => {
    const peer = new FakePeer(`c${++n}`);
    peers.push(peer);
    hub.connect(peer);
    const send = (msg: ClientMsg) => hub.message(peer.id, JSON.stringify(msg));
    send({ t: 'hello', v: ProtocolVersion, card: card(name), token });
    return { peer, send };
  };
  const advance = (ms: number, ping = true) => {
    // Avança em passos de 100 ms, como o tick do servidor; um ping a cada passo mantém as conexões vivas.
    for (let t = 0; t < ms; t += 100) {
      clock += 100;
      if (ping) for (const p of peers) if (!p.closed && !p.gone) hub.message(p.id, JSON.stringify({ t: 'ping', c: clock }));
      hub.tick();
    }
  };
  const drop = (peer: FakePeer) => {
    peer.gone = true;
    hub.disconnect(peer.id);
  };
  return { hub, join, advance, drop, now: () => clock };
}

/** Sala privada com os dois prontos: devolve os jogadores e o lado de quem ataca primeiro. */
function privateMatch(randomValues: number[] = []) {
  const env = setup(randomValues);
  const a = env.join('Ana');
  const b = env.join('Bia');
  a.send({ t: 'room.create' });
  const code = a.peer.last('room')!.room.code;
  b.send({ t: 'room.join', code: code.toLowerCase() });
  a.send({ t: 'room.ready', ready: true });
  b.send({ t: 'room.ready', ready: true });
  const start = a.peer.last('match.start')!;
  const players = { 0: a, 1: b } as Record<Side, typeof a>;
  return { ...env, a, b, code, start, players };
}

const state = (p: FakePeer) => p.last('match.state')?.state ?? p.last('match.start')!.state;

describe('Hub: salas e lobby', () => {
  it('cria sala com código, o amigo entra, os dois ficam prontos e a partida começa no check', () => {
    const { a, b, code, start } = privateMatch();
    expect(normalizeRoomCode(code)).toBe(code);
    expect(a.peer.last('welcome')!.token).toHaveLength(24);
    expect(start.you).toBe(0);
    expect(b.peer.last('match.start')!.you).toBe(1);
    expect(start.state.phase).toBe('check');
    expect(start.state.phaseEndsAt - start.serverTime).toBe(FirstCheckMs);
    expect(start.room.players.map((p) => p.card.name)).toEqual(['Ana', 'Bia']);
    // O evento 'start' não sai antes do match.start.
    expect(a.peer.all('match.state')).toHaveLength(0);
  });

  it('a check acaba e a bola fica viva com o relógio de posse correndo', () => {
    const { a, advance, now } = privateMatch();
    advance(FirstCheckMs);
    const s = state(a.peer);
    expect(s.phase).toBe('live');
    expect(s.clockRunning).toBe(true);
    expect(shotClockLeft(s, now())).toBeLessThanOrEqual(24000);
  });

  it('código errado, sala cheia e regras só do dono', () => {
    const env = setup();
    const a = env.join('Ana');
    const b = env.join('Bia');
    const c = env.join('Caio');
    a.send({ t: 'room.create', rules: { target: 21, makeItTakeIt: true } });
    const room = a.peer.last('room')!.room;
    expect(room.rules.target).toBe(21);
    expect(room.rules.makeItTakeIt).toBe(true);
    c.send({ t: 'room.join', code: 'ZZZZ' });
    expect(c.peer.last('error')!.code).toBe('room_not_found');
    b.send({ t: 'room.join', code: room.code });
    c.send({ t: 'room.join', code: room.code });
    expect(c.peer.last('error')!.code).toBe('room_full');
    b.send({ t: 'room.rules', rules: { target: 5 } });
    expect(b.peer.last('error')!.code).toBe('not_host');
    a.send({ t: 'room.rules', rules: { target: 5, shotClock: 3 } });
    expect(b.peer.last('room')!.room.rules.target).toBe(5);
    expect(b.peer.last('room')!.room.rules.shotClock).toBe(8); // relógio curto demais sobe para o mínimo
  });

  it('partida rápida junta os dois primeiros da fila', () => {
    const env = setup();
    const a = env.join('Ana');
    const b = env.join('Bia');
    a.send({ t: 'queue.join' });
    expect(a.peer.last('queue')!.waiting).toBe(true);
    b.send({ t: 'queue.join' });
    expect(a.peer.last('match.start')!.room.quick).toBe(true);
    expect(b.peer.last('match.start')!.you).toBe(1);
  });

  it('o estado do jogador vai só para o oponente, como chegou', () => {
    const { a, b } = privateMatch();
    const before = a.peer.inbox.length;
    a.send({ t: 'st', d: { x: 1, cmds: ['playMove'] } });
    expect(b.peer.last('st')!.d).toEqual({ x: 1, cmds: ['playMove'] });
    expect(a.peer.inbox.length).toBe(before);
  });

  it('versão diferente do jogo fecha a conexão', () => {
    const env = setup();
    const peer = new FakePeer('x');
    env.hub.connect(peer);
    env.hub.message('x', JSON.stringify({ t: 'hello', v: 999, card: card('Velho') }));
    expect(peer.last('error')!.code).toBe('version');
    expect(peer.closed?.code).toBe(4001);
  });

  it('JSON inválido e mensagem antes do hello', () => {
    const env = setup();
    const peer = new FakePeer('x');
    env.hub.connect(peer);
    env.hub.message('x', '{oi');
    expect(peer.last('error')!.code).toBe('bad_message');
    env.hub.message('x', JSON.stringify({ t: 'queue.join' }));
    expect(peer.last('error')!.code).toBe('not_hello');
  });

  it('limita mensagens por segundo', () => {
    const { a, b } = privateMatch();
    for (let i = 0; i < 200; i++) a.send({ t: 'st', d: i });
    expect(a.peer.last('error')!.code).toBe('rate_limit');
    expect(b.peer.all('st').length).toBeLessThan(200);
  });
});

describe('Referee: regras do 1x1', () => {
  it('cesta de dentro vale 1, de fora 2; a bola troca e vem um novo check', () => {
    const { a, players, start, advance } = privateMatch();
    advance(FirstCheckMs);
    const off = start.state.offense;
    const shooter = players[off];
    let s = state(a.peer);
    shooter.send({ t: 'g.release', seq: s.seq });
    expect(state(a.peer).ball).toBe('air');
    expect(state(a.peer).clockRunning).toBe(false);
    shooter.send({ t: 'g.result', seq: s.seq, scored: true, isThree: true });
    s = state(a.peer);
    expect(s.score[off]).toBe(2);
    expect(s.phase).toBe('dead');
    expect(a.peer.last('match.state')!.event).toEqual({ kind: 'score', side: off, points: 2, isThree: true });
    advance(DeadMs);
    s = state(a.peer);
    expect(s.phase).toBe('check');
    expect(s.offense).toBe(1 - off);
    advance(CheckMs);
    expect(state(a.peer).phase).toBe('live');
  });

  it('erro → bola solta → rebote defensivo precisa limpar; cesta sem limpar não vale', () => {
    const { a, players, start, advance } = privateMatch();
    advance(FirstCheckMs);
    const off = start.state.offense;
    const def = (1 - off) as Side;
    let s = state(a.peer);
    players[off].send({ t: 'g.release', seq: s.seq });
    players[off].send({ t: 'g.result', seq: s.seq, scored: false, isThree: false });
    expect(state(a.peer).ball).toBe('loose');
    // Os dois pedem: o primeiro leva, o segundo (mesma posse) é ignorado.
    players[def].send({ t: 'g.claim', seq: s.seq, at: [1, 0, 0.1] });
    players[off].send({ t: 'g.claim', seq: s.seq, at: [1, 0, 0.1] });
    s = state(a.peer);
    expect(s.offense).toBe(def);
    expect(s.needsClear).toBe(true);
    expect(s.ball).toBe('held');
    players[def].send({ t: 'g.release', seq: s.seq });
    players[def].send({ t: 'g.result', seq: s.seq, scored: true, isThree: false });
    s = state(a.peer);
    expect(s.score).toEqual([0, 0]);
    expect(a.peer.last('match.state')!.event).toEqual({ kind: 'noClear', side: def });
    advance(DeadMs);
    expect(state(a.peer).offense).toBe(off);
  });

  it('limpou a bola: a cesta vale; rebote ofensivo não precisa limpar', () => {
    const { a, players, start, advance } = privateMatch();
    advance(FirstCheckMs);
    const off = start.state.offense;
    const def = (1 - off) as Side;
    let s = state(a.peer);
    players[off].send({ t: 'g.release', seq: s.seq });
    players[off].send({ t: 'g.result', seq: s.seq, scored: false, isThree: false });
    players[off].send({ t: 'g.claim', seq: s.seq, at: [1, 0, 0.1] });
    s = state(a.peer);
    expect(s.offense).toBe(off);
    expect(s.needsClear).toBe(false);
    expect(a.peer.last('match.state')!.event).toEqual({ kind: 'rebound', side: off, offensive: true });
    players[off].send({ t: 'g.release', seq: s.seq });
    players[off].send({ t: 'g.result', seq: s.seq, scored: false, isThree: false });
    players[def].send({ t: 'g.claim', seq: s.seq, at: [1, 0, 0.1] });
    s = state(a.peer);
    players[def].send({ t: 'g.cleared', seq: s.seq });
    expect(state(a.peer).needsClear).toBe(false);
    players[def].send({ t: 'g.release', seq: s.seq });
    players[def].send({ t: 'g.result', seq: s.seq, scored: true, isThree: false });
    expect(state(a.peer).score[def]).toBe(1);
  });

  it('relato de outra posse (seq velho) e do defensor são ignorados', () => {
    const { a, players, start, advance } = privateMatch();
    advance(FirstCheckMs);
    const off = start.state.offense;
    const s = state(a.peer);
    players[(1 - off) as Side].send({ t: 'g.release', seq: s.seq });
    expect(state(a.peer).ball).toBe('held');
    players[off].send({ t: 'g.release', seq: s.seq - 1 });
    expect(state(a.peer).ball).toBe('held');
  });

  it('estouro do relógio de posse dá a bola ao outro', () => {
    const { a, start, advance } = privateMatch();
    advance(FirstCheckMs + 24000 + 100);
    expect(a.peer.all('match.state').some((m) => m.event?.kind === 'shotClock')).toBe(true);
    advance(DeadMs);
    expect(state(a.peer).offense).toBe(1 - start.state.offense);
  });

  it('bola solta abandonada volta para a defesa', () => {
    const { a, players, start, advance } = privateMatch();
    advance(FirstCheckMs);
    const off = start.state.offense;
    const s = state(a.peer);
    players[off].send({ t: 'g.release', seq: s.seq });
    players[off].send({ t: 'g.result', seq: s.seq, scored: false, isThree: false });
    advance(LooseMaxMs + 200);
    expect(a.peer.all('match.state').some((m) => m.event?.kind === 'deadBall')).toBe(true);
  });

  it('chega a 11 e acaba; revanche começa outra com o primeiro ataque trocado', () => {
    const { a, b, players, start, advance } = privateMatch();
    const off = start.state.offense;
    // make it take it desligado: a bola alterna. Quem começa atacando faz 2 por posse; o outro erra e a bola fica com ele.
    advance(FirstCheckMs);
    for (let i = 0; i < 40 && state(a.peer).phase !== 'over'; i++) {
      const s = state(a.peer);
      if (s.phase !== 'live') {
        advance(100);
        continue;
      }
      const shooter = players[s.offense];
      shooter.send({ t: 'g.release', seq: s.seq });
      shooter.send({ t: 'g.result', seq: s.seq, scored: s.offense === off, isThree: true });
      if (s.offense !== off) players[off].send({ t: 'g.claim', seq: s.seq, at: [0, 0, 0] });
      const now = state(a.peer);
      if (now.needsClear) players[now.offense].send({ t: 'g.cleared', seq: now.seq });
      advance(DeadMs + CheckMs);
    }
    const end = state(a.peer);
    expect(end.phase).toBe('over');
    expect(end.winner).toBe(off);
    expect(end.score[off]).toBeGreaterThanOrEqual(11);
    a.send({ t: 'room.rematch', want: true });
    expect(b.peer.last('room')!.room.rematch).toEqual([true, false]);
    b.send({ t: 'room.rematch', want: true });
    const again = a.peer.last('match.start')!;
    expect(again.state.score).toEqual([0, 0]);
    expect(again.state.offense).toBe(1 - off);
  });
});

describe('Hub: queda de conexão', () => {
  it('quem cai pausa a partida; volta com o token e a posse recomeça no check', () => {
    const { a, b, join, advance, drop } = privateMatch();
    advance(FirstCheckMs);
    const token = b.peer.last('welcome')!.token;
    drop(b.peer);
    expect(a.peer.last('opponent')!.connected).toBe(false);
    expect(state(a.peer).phase).toBe('paused');
    advance(5000);
    const back = join('Bia', token);
    expect(back.peer.last('welcome')!.token).toBe(token);
    expect(back.peer.last('match.start')!.you).toBe(1);
    expect(a.peer.last('opponent')!.connected).toBe(true);
    expect(state(a.peer).phase).toBe('check');
  });

  it('não voltou a tempo: perde por W.O.', () => {
    const { a, b, advance, drop } = privateMatch();
    advance(FirstCheckMs);
    drop(b.peer);
    advance(ReconnectGraceMs + 200);
    const end = state(a.peer);
    expect(end.phase).toBe('over');
    expect(end.winner).toBe(0);
    expect(a.peer.last('match.state')!.event).toEqual({ kind: 'over', winner: 0, reason: 'forfeit' });
  });

  it('a mesma conta em outra aba derruba a aba antiga', () => {
    const env = setup();
    const a = env.join('Ana');
    const token = a.peer.last('welcome')!.token;
    const a2 = env.join('Ana', token);
    expect(a.peer.last('error')!.code).toBe('replaced');
    expect(a.peer.closed?.code).toBe(4002);
    expect(a2.peer.last('welcome')!.token).toBe(token);
  });

  it('sem sinal por muito tempo: a conexão é fechada', () => {
    const env = setup();
    const a = env.join('Ana');
    env.advance(IdleTimeoutMs + 200, false);
    expect(a.peer.closed?.reason).toBe('timeout');
  });

  it('sair da sala no meio da partida é desistência', () => {
    const { a, b, advance } = privateMatch();
    advance(FirstCheckMs);
    b.send({ t: 'room.leave' });
    expect(b.peer.last('room.left')).toBeTruthy();
    expect(a.peer.last('match.state')!.event).toEqual({ kind: 'over', winner: 0, reason: 'forfeit' });
    // Na sala privada quem ficou continua lá, sozinho, esperando outro.
    expect(a.peer.last('room')!.room.players).toHaveLength(1);
  });
});
