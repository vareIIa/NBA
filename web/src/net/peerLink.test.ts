// Canal direto (PeerLink) com uma rede de mentira: duas "RTCPeerConnection" que se acham pela SDP e abrem o canal
// quando cada uma tem a descrição do outro e um candidato. A sala é um atraso fixo na sinalização; o relógio é o do
// vitest (timers falsos), então dá para cortar o canal no meio e ver o 'st' voltar para a sala.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PeerLink,
  type P2PMode,
  type PeerLinkOptions,
  ReliableTtlMs,
  RetryMs,
  StaleMs,
  type StateMsg,
  carriesCommands,
  p2pModeFrom,
  parseSignal,
} from './PeerLink.ts';
import { Hub } from './hub/Hub.ts';
import { type ClientMsg, ProtocolVersion, type ServerMsg } from './protocol.ts';

const LobbyMs = 70;
const DirectMs = 5;

class FakeNet {
  /** Canal cortado em silêncio (nada passa, ninguém fecha: como um NAT que esqueceu a rota). */
  cut = false;
  /** O próximo quadro do canal que passar neste teste se perde (uma vez). */
  drop: ((text: string) => boolean) | null = null;
  readonly pcs: FakePc[] = [];
  /** Liga as duas pontas se as duas já trocaram descrição e candidato. */
  tryConnect(pc: FakePc): void {
    const other = this.pcs.find((p) => p !== pc && p.localDescription?.sdp === pc.remoteDescription?.sdp && p.remoteDescription?.sdp === pc.localDescription?.sdp);
    if (!other || pc.config.iceTransportPolicy === 'relay' || other.config.iceTransportPolicy === 'relay') return;
    if (pc.candidates.length === 0 || other.candidates.length === 0 || pc.closed || other.closed) return;
    if (pc.dc!.readyState === 'open') return;
    pc.dc!.peer = other.dc!;
    other.dc!.peer = pc.dc!;
    for (const p of [pc, other]) {
      p.dc!.readyState = 'open';
      p.connectionState = 'connected';
      setTimeout(() => p.dc!.onopen?.({} as Event), 0);
    }
  }
}

class FakeChannel {
  readyState: RTCDataChannelState = 'connecting';
  bufferedAmount = 0;
  peer: FakeChannel | null = null;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  readonly sent: string[] = [];
  constructor(private readonly net: FakeNet) {}
  send(text: string): void {
    if (this.readyState !== 'open') throw new Error('canal fechado');
    this.sent.push(text);
    if (this.net.cut) return;
    if (this.net.drop?.(text)) {
      this.net.drop = null;
      return;
    }
    const peer = this.peer;
    setTimeout(() => peer?.readyState === 'open' && peer.onmessage?.({ data: text } as MessageEvent), DirectMs);
  }
  close(): void {
    const was = this.readyState;
    this.readyState = 'closed';
    const peer = this.peer;
    // Fechar de um lado fecha o outro (o SCTP manda ABORT).
    if (was === 'open' && peer && peer.readyState === 'open') {
      setTimeout(() => {
        peer.readyState = 'closed';
        peer.onclose?.({} as Event);
      }, DirectMs);
    }
  }
}

let nextPc = 0;

class FakePc {
  readonly id = ++nextPc;
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  onicecandidate: ((ev: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  dc: FakeChannel | null = null;
  readonly candidates: RTCIceCandidateInit[] = [];
  closed = false;
  constructor(
    private readonly net: FakeNet,
    readonly config: RTCConfiguration,
  ) {
    net.pcs.push(this);
  }
  createDataChannel(): FakeChannel {
    return (this.dc = new FakeChannel(this.net));
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: `sdp-${this.id}` };
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: `sdp-${this.id}` };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = d;
    // Política "só relay" sem TURN: nenhum candidato.
    if (this.config.iceTransportPolicy === 'relay') return;
    const c: RTCIceCandidateInit = { candidate: `candidate:${this.id} 1 udp 1 127.0.0.1 5${this.id} typ host`, sdpMid: '0', sdpMLineIndex: 0 };
    setTimeout(() => this.onicecandidate?.({ candidate: { toJSON: () => c } }), 1);
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void> {
    if (this.closed) throw new Error('fechada');
    this.remoteDescription = d;
    this.net.tryConnect(this);
  }
  async addIceCandidate(c: RTCIceCandidateInit): Promise<void> {
    if (!this.remoteDescription) throw new Error('sem descrição remota');
    this.candidates.push(c);
    this.net.tryConnect(this);
  }
  async getStats(): Promise<Map<string, unknown>> {
    return new Map();
  }
  close(): void {
    this.closed = true;
    this.dc?.close();
  }
}

interface Side {
  link: PeerLink;
  got: unknown[];
  lobby: string[];
}

/** Dois lados ligados pela "sala" (atraso fixo) e pela rede de mentira. */
function pair(mode: P2PMode = 'on') {
  const net = new FakeNet();
  const sides: Side[] = [];
  for (let i = 0; i < 2; i++) {
    const side: Side = { link: null as unknown as PeerLink, got: [], lobby: [] };
    const opts: PeerLinkOptions = {
      mode,
      now: () => Date.now(),
      createPeer: (config) => new FakePc(net, config) as unknown as RTCPeerConnection,
      signal: (d) => setTimeout(() => sides[1 - i].link.signal(JSON.parse(JSON.stringify(d))), LobbyMs),
      deliver: (msg) => side.got.push(msg.d),
      viaLobby: (text) => {
        side.lobby.push(text);
        // A sala repassa o quadro como veio; o outro lado decide se é repetido.
        setTimeout(() => {
          const msg = JSON.parse(text) as StateMsg;
          if (sides[1 - i].link.fromLobby(msg)) sides[1 - i].got.push(msg.d);
        }, LobbyMs);
      },
    };
    side.link = new PeerLink(opts);
    sides.push(side);
  }
  return { net, a: sides[0], b: sides[1] };
}

const pose = (t: number) => ({ v: 1, s: { t } });
const withCmd = (t: number, op = 'move') => ({ v: 1, s: { t }, c: [{ op, t }] });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PeerLink', () => {
  it('conecta pelo pedido do lugar 1 e passa o estado pelo canal, não pela sala', async () => {
    const { a, b } = pair();
    a.link.matchStart(0);
    b.link.matchStart(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.link.stats().state).toBe('open');
    expect(b.link.stats().state).toBe('open');
    expect(a.link.healthy()).toBe(true);
    expect(a.link.send({ t: 'st', d: pose(1) })).toBe(true);
    expect(b.link.send({ t: 'st', d: pose(2) })).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(b.got).toEqual([pose(1)]);
    expect(a.got).toEqual([pose(2)]);
    expect(a.link.stats()).toMatchObject({ via: 'direto', attempts: 1, tx: { direto: 1, sala: 0 }, rx: { direto: 1, sala: 0 } });
    // O ping do canal mede a ida e volta direta (2 × 5 ms), não a da sala.
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.link.stats().rtt).toBe(2 * DirectMs);
  });

  it('comando perdido no canal chega no envio seguinte, uma vez só', async () => {
    const { net, a, b } = pair();
    a.link.matchStart(0);
    b.link.matchStart(1);
    await vi.advanceTimersByTimeAsync(1000);
    net.drop = (text) => text.includes('"c":'); // o quadro com o comando se perde
    a.link.send({ t: 'st', d: withCmd(1) });
    await vi.advanceTimersByTimeAsync(50);
    expect(b.got).toEqual([]);
    a.link.send({ t: 'st', d: pose(2) }); // 50 ms depois: o comando vai de novo antes da pose nova
    await vi.advanceTimersByTimeAsync(20);
    expect(b.got).toEqual([withCmd(1), pose(2)]);
    // Confirmado: não repete mais; e a confirmação perdida não faz o comando tocar duas vezes.
    a.link.send({ t: 'st', d: pose(3) });
    await vi.advanceTimersByTimeAsync(20);
    expect(b.got).toEqual([withCmd(1), pose(2), pose(3)]);
    expect(a.link.stats().resent).toBeGreaterThanOrEqual(1);
    expect(carriesCommands(withCmd(1))).toBe(true);
    expect(carriesCommands(pose(1))).toBe(false);
  });

  it('confirmação perdida: o repetido chega e é descartado', async () => {
    const { net, a, b } = pair();
    a.link.matchStart(0);
    b.link.matchStart(1);
    await vi.advanceTimersByTimeAsync(1000);
    net.drop = (text) => text.includes('"ack"'); // o ack de B se perde
    a.link.send({ t: 'st', d: withCmd(1) });
    await vi.advanceTimersByTimeAsync(50);
    a.link.send({ t: 'st', d: pose(2) });
    await vi.advanceTimersByTimeAsync(20);
    expect(b.got).toEqual([withCmd(1), pose(2)]);
    expect(b.link.stats().dup).toBe(1);
  });

  it('canal cortado em silêncio: o estado volta para a sala e o comando sem confirmação vai junto', async () => {
    const { net, a, b } = pair();
    a.link.matchStart(0);
    b.link.matchStart(1);
    await vi.advanceTimersByTimeAsync(1000);
    net.cut = true;
    expect(a.link.send({ t: 'st', d: withCmd(1) })).toBe(true); // ainda parece saudável: vai para o nada
    await vi.advanceTimersByTimeAsync(StaleMs + 10);
    expect(a.link.healthy()).toBe(false);
    expect(a.link.stats().via).toBe('sala');
    // O próximo envio vai pela sala (false), e o comando não confirmado foi antes, pela sala, com o número dele.
    expect(a.link.send({ t: 'st', d: pose(2) })).toBe(false);
    expect(a.lobby).toHaveLength(1);
    expect(JSON.parse(a.lobby[0])).toMatchObject({ t: 'st', d: withCmd(1) });
    await vi.advanceTimersByTimeAsync(LobbyMs + 10);
    expect(b.got).toEqual([withCmd(1)]);
    // O canal volta: o ping chega de novo e o estado volta para ele.
    net.cut = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(a.link.healthy()).toBe(true);
    expect(a.link.send({ t: 'st', d: pose(3) })).toBe(true);
  });

  it('o repetido que chega pela sala depois do canal é descartado', async () => {
    const { net, a, b } = pair();
    a.link.matchStart(0);
    b.link.matchStart(1);
    await vi.advanceTimersByTimeAsync(1000);
    // O comando chega pelo canal, mas o ack não volta e o canal emudece.
    net.drop = (text) => text.includes('"ack"');
    a.link.send({ t: 'st', d: withCmd(1) });
    await vi.advanceTimersByTimeAsync(DirectMs + 1);
    net.cut = true;
    await vi.advanceTimersByTimeAsync(StaleMs + 10);
    a.link.send({ t: 'st', d: pose(2) }); // pela sala; antes dele, o comando repetido
    await vi.advanceTimersByTimeAsync(LobbyMs + 10);
    expect(b.got).toEqual([withCmd(1)]);
    expect(b.link.stats().dup).toBe(1);
  });

  it('comando velho demais não vai mais (o boneco já passou dele)', async () => {
    const { net, a, b } = pair();
    a.link.matchStart(0);
    b.link.matchStart(1);
    await vi.advanceTimersByTimeAsync(1000);
    net.cut = true;
    a.link.send({ t: 'st', d: withCmd(1) });
    await vi.advanceTimersByTimeAsync(ReliableTtlMs + 100);
    a.link.send({ t: 'st', d: pose(2) });
    expect(a.lobby).toHaveLength(0);
    expect(a.link.stats().expired).toBe(1);
    expect(b.got).toEqual([]);
  });

  it('canal fechado pelo outro lado: o lugar 1 pede de novo e o canal volta', async () => {
    const { net, a, b } = pair();
    a.link.matchStart(0);
    b.link.matchStart(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(b.link.stats().attempts).toBe(1);
    net.pcs.find((p) => !p.closed)!.close();
    await vi.advanceTimersByTimeAsync(50);
    expect(b.link.stats().state).toBe('failed');
    expect(b.link.send({ t: 'st', d: pose(1) })).toBe(false);
    await vi.advanceTimersByTimeAsync(RetryMs[0] + 1000);
    expect(a.link.stats().state).toBe('open');
    expect(b.link.stats().state).toBe('open');
    expect(b.link.stats().attempts).toBe(2);
  });

  it('forçado a falhar: nunca abre, tenta de novo com espera crescente e desiste; tudo pela sala', async () => {
    const { a, b } = pair('fail');
    a.link.matchStart(0);
    b.link.matchStart(1);
    let total = 0;
    for (const wait of RetryMs) total += wait + 10_000 + LobbyMs * 2;
    await vi.advanceTimersByTimeAsync(total + 60_000);
    expect(a.link.stats().state).toBe('failed');
    expect(b.link.stats().attempts).toBe(RetryMs.length + 1);
    expect(a.link.send({ t: 'st', d: pose(1) })).toBe(false);
    expect(b.link.send({ t: 'st', d: pose(1) })).toBe(false);
  });

  it('desligado (?p2p=0): nem tenta', async () => {
    const { a, b } = pair('off');
    a.link.matchStart(0);
    b.link.matchStart(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(a.link.stats().state).toBe('off');
    expect(b.link.stats().attempts).toBe(0);
    expect(a.link.send({ t: 'st', d: pose(1) })).toBe(false);
  });

  it('sair da sala derruba o canal; a próxima partida conecta de novo', async () => {
    const { a, b } = pair();
    a.link.matchStart(0);
    b.link.matchStart(1);
    await vi.advanceTimersByTimeAsync(1000);
    a.link.close();
    b.link.close();
    expect(a.link.stats().state).toBe('idle');
    a.link.matchStart(0);
    b.link.matchStart(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.link.stats().state).toBe('open');
  });
});

describe('sinalização e modo', () => {
  it('recusa sinalização torta', () => {
    expect(parseSignal(null)).toBeNull();
    expect(parseSignal({ k: 'offer', a: 'x' })).toBeNull();
    expect(parseSignal({ k: 'offer', a: 'x', sdp: 'y'.repeat(40_000) })).toBeNull();
    expect(parseSignal({ k: 'ice', a: 'x', c: { candidate: 5 } })).toBeNull();
    expect(parseSignal({ k: 'boom' })).toBeNull();
    expect(parseSignal({ k: 'ice', a: 'x', c: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0, extra: 1 } })).toEqual({
      k: 'ice',
      a: 'x',
      c: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 },
    });
    expect(parseSignal({ k: 'req', junk: 1 })).toEqual({ k: 'req' });
  });

  it('modo pelo endereço e pelo build', () => {
    expect(p2pModeFrom(null)).toBe('on');
    expect(p2pModeFrom('0')).toBe('off');
    expect(p2pModeFrom('falha')).toBe('fail');
    expect(p2pModeFrom(null, 'falha')).toBe('fail');
    expect(p2pModeFrom('1', 'falha')).toBe('on');
  });
});

describe('Hub: sinalização do canal direto', () => {
  /** Duas conexões no Hub (sem timers falsos: o Hub recebe o relógio). */
  function hubPair() {
    const hub = new Hub({ now: () => 1_000_000, random: () => 0.3 });
    const inbox: Record<string, string[]> = { a: [], b: [], c: [] };
    const send = (id: string, msg: ClientMsg) => hub.message(id, JSON.stringify(msg));
    for (const id of ['a', 'b', 'c']) {
      hub.connect({ id, send: (text) => inbox[id].push(text), close: () => undefined });
      send(id, { t: 'hello', v: ProtocolVersion, card: { name: id, heightCm: 196, wingspanOverM: 0, wingspanCm: 200, overall: 70, archetype: '', position: '', perimeterDefense: 60 } });
    }
    return { hub, inbox, send };
  }
  const rtc = (inbox: string[]) => inbox.map((t) => JSON.parse(t) as ServerMsg).filter((m) => m.t === 'rtc');

  it('repassa ao outro da sala como chegou, já na sala (antes da partida); fora da sala, a ninguém', () => {
    const { inbox, send } = hubPair();
    send('a', { t: 'rtc', d: { k: 'req' } });
    expect(rtc(inbox.b)).toEqual([]);
    send('a', { t: 'room.create' });
    const code = (JSON.parse(inbox.a.at(-1)!) as Extract<ServerMsg, { t: 'room' }>).room.code;
    send('b', { t: 'room.join', code });
    const offer = { k: 'offer', a: 'x1', sdp: 'v=0' };
    send('a', { t: 'rtc', d: offer });
    send('b', { t: 'rtc', d: { k: 'answer', a: 'x1', sdp: 'v=0 b' } });
    expect(rtc(inbox.b)).toEqual([{ t: 'rtc', d: offer }]);
    expect(rtc(inbox.a)).toEqual([{ t: 'rtc', d: { k: 'answer', a: 'x1', sdp: 'v=0 b' } }]);
    // Quem não está na sala não recebe nem manda para ela.
    send('c', { t: 'rtc', d: offer });
    expect(rtc(inbox.c)).toEqual([]);
    expect(rtc(inbox.a)).toHaveLength(1);
  });
});
