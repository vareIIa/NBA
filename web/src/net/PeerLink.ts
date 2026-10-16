// Canal direto entre os dois navegadores de uma partida (docs/24 §5.1). O estado do jogador ('st', ~20 por segundo)
// vai por um DataChannel do WebRTC, ponto a ponto, em vez de dar a volta pela sala (o Durable Object fica no leste dos
// EUA: ~130 ms de um jogador ao outro saindo do Rio). A sala continua sendo lobby, juiz e sinalização: repassa o
// offer/answer/ICE na mensagem 'rtc' sem ler. Só STUN público, sem TURN (D14): se a conexão direta não sair (CGNAT
// dos dois lados, rede que bloqueia UDP) ou cair no meio, o 'st' volta sozinho para o WebSocket da sala.
//
// Canal: sem ordem e sem retransmissão (UDP de verdade). Uma amostra de pose perdida não faz falta (a próxima chega em
// 50 ms e o boneco interpola) e não segura as outras, como um pacote perdido segura tudo no TCP do WebSocket.
//
// Comandos de animação (Payload.c: drible, arremesso, bandeja…) não podem sumir: o boneco deixaria de fazer o lance.
// O 'st' que leva comandos ganha um número (r); quem recebe confirma na hora ('ack') e descarta repetidos, e quem mandou
// repete o quadro a cada envio até a confirmação. Um quadro perdido chega de novo no envio seguinte (~50 ms), ainda
// dentro do buffer do boneco (~70–100 ms). Um canal confiável do SCTP também não perderia, mas reenvia só depois do
// próprio timer (centenas de ms) e segura na fila tudo o que vem atrás. Se o canal cair, o que não foi confirmado vai
// pela sala (com o mesmo r: repetido não toca duas vezes).
//
// Quem conecta: o lugar 1 pede ('req') e o lugar 0 oferece; o lugar 1 é quem tenta de novo quando falha.
//
// Privacidade: a conexão direta mostra o IP público de cada um ao outro (é o candidato do STUN). Por isso o canal só
// sobe em sala privada (quem joga trocou o código com um amigo); na partida rápida, com desconhecido, tudo vai pela sala.
import { MaxFrameBytes, type Side } from './protocol.ts';

/** on = tenta a conexão direta; off = só a sala; fail = tenta sem candidato nenhum (nunca conecta: testes do fallback). */
export type P2PMode = 'on' | 'off' | 'fail';
export type LinkState = 'off' | 'idle' | 'connecting' | 'open' | 'failed';

/** Sinalização (d da mensagem 'rtc'). a = id da tentativa, sorteado por quem oferece. */
export type RtcSignal =
  | { k: 'req' }
  | { k: 'offer' | 'answer'; a: string; sdp: string }
  | { k: 'ice'; a: string; c: RTCIceCandidateInit };

/** Um 'st' como sai e chega pela sala; r = número do quadro confiável (só no que já passou pelo canal). */
export interface StateMsg {
  t: 'st';
  d: unknown;
  r?: number;
}

/** Quadros do canal: estado, confirmação de um estado confiável e o ping do canal. */
type Frame = StateMsg | { t: 'ack'; r: number } | { t: 'lp'; c: number } | { t: 'lq'; c: number };

export const StunServers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
/** Nada chegou pelo canal neste tempo (o ping vai a cada PingMs): o envio passa para a sala até o canal voltar. */
export const StaleMs = 400;
export const PingMs = 200;
/** Tentativa que não abre o canal neste tempo falhou. */
export const AttemptMs = 10_000;
/** Espera antes de pedir de novo depois de cada falha; depois da última, fica na sala até a próxima partida. */
export const RetryMs = [1000, 3000, 8000, 20_000, 30_000];
/** Um quadro confiável sem confirmação depois disto já ficou para trás (o boneco passou dele): não vai mais. */
export const ReliableTtlMs = 1500;
/** Reenvio de um quadro confiável sem confirmação: depois de max(isto, 1,2 × ping do canal). */
const ResendMinMs = 30;
/** Fila de saída do canal acima disto: congestionado, o envio vai pela sala. */
const MaxBuffered = 256 * 1024;
/** Mesmo limite de ritmo da sala (Hub.MaxFramesPerSecond): quadros acima disto por segundo são ignorados. */
const MaxFramesPerSecond = 120;

/** Modo pelo endereço (?p2p=0 | falha) ou pelo build (VITE_P2P), nesta ordem. */
export function p2pModeFrom(param: string | null | undefined, env?: string): P2PMode {
  const v = (param ?? env ?? '').toLowerCase();
  if (v === '0' || v === 'off' || v === 'nao' || v === 'não') return 'off';
  if (v === 'falha' || v === 'fail') return 'fail';
  return 'on';
}

/** O 'st' leva comandos de animação (Payload.c não vazio): vai confiável. */
export function carriesCommands(d: unknown): boolean {
  const c = d && typeof d === 'object' ? (d as { c?: unknown }).c : undefined;
  return Array.isArray(c) && c.length > 0;
}

/** Sinalização que veio do outro jogador (pela sala), validada. null se não presta. */
export function parseSignal(raw: unknown): RtcSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const a = typeof o.a === 'string' && o.a.length > 0 && o.a.length <= 32 ? o.a : null;
  switch (o.k) {
    case 'req':
      return { k: 'req' };
    case 'offer':
    case 'answer':
      return a && typeof o.sdp === 'string' && o.sdp.length <= 32_000 ? { k: o.k, a, sdp: o.sdp } : null;
    case 'ice': {
      const c = o.c && typeof o.c === 'object' ? (o.c as Record<string, unknown>) : null;
      if (!a || !c || typeof c.candidate !== 'string' || c.candidate.length > 1024) return null;
      const out: RTCIceCandidateInit = {
        candidate: c.candidate,
        sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid.slice(0, 64) : null,
        sdpMLineIndex: typeof c.sdpMLineIndex === 'number' && Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : null,
      };
      if (typeof c.usernameFragment === 'string') out.usernameFragment = c.usernameFragment.slice(0, 256);
      return { k: 'ice', a, c: out };
    }
    default:
      return null;
  }
}

export interface PeerLinkOptions {
  mode: P2PMode;
  /** Manda sinalização ao outro jogador pela sala ('rtc'). */
  signal: (d: RtcSignal) => void;
  /** Um 'st' do outro jogador que chegou pelo canal (já sem repetidos). */
  deliver: (msg: StateMsg) => void;
  /** Manda um quadro pronto pela sala: o confiável que o canal não confirmou antes de cair. */
  viaLobby: (text: string) => void;
  iceServers?: RTCIceServer[];
  /** Relógio (ms). */
  now?: () => number;
  /** Fábrica da conexão (os testes passam uma de mentira). */
  createPeer?: (config: RTCConfiguration) => RTCPeerConnection;
}

export interface LinkStats {
  mode: P2PMode;
  state: LinkState;
  /** Por onde o 'st' sai agora. */
  via: 'direto' | 'sala';
  /** Ida e volta pelo canal (ms), suavizada; 0 = sem medida. */
  rtt: number;
  /** Tipo dos candidatos da rota escolhida (local/remoto: host, srflx, prflx, relay). */
  route: string;
  attempts: number;
  /** 'st' enviados e recebidos por caminho, e reenvios de quadros confiáveis. */
  tx: { direto: number; sala: number };
  rx: { direto: number; sala: number };
  resent: number;
  /** Quadros confiáveis que chegaram repetidos (descartados) e os que venceram sem confirmação. */
  dup: number;
  expired: number;
}

interface Attempt {
  id: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  /** Candidatos que chegaram antes da descrição remota. */
  pending: RTCIceCandidateInit[];
  remoteSet: boolean;
  timer: ReturnType<typeof setTimeout>;
  started: number;
}

const randomId = (): string => Math.random().toString(36).slice(2, 12);

export class PeerLink {
  state: LinkState;
  private at: Attempt | null = null;
  /** Lugar 1: pede a conexão e tenta de novo. */
  private driver = false;
  /** Partida em sala privada (match.start): só então o canal sobe e a sinalização do outro é ouvida. */
  private allowed = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastRx = -Infinity;
  private rtt = 0;
  private route = '';
  private attempts = 0;
  private readonly tx = { direto: 0, sala: 0 };
  private readonly rx = { direto: 0, sala: 0 };
  private resent = 0;
  private dup = 0;
  private expired = 0;
  /** Número do próximo quadro confiável (começa num valor sorteado: quem recarregou a página não repete números). */
  private nextR = Math.floor(Math.random() * 2 ** 30);
  private readonly unacked = new Map<number, { text: string; first: number; last: number }>();
  /** Quadros confiáveis já entregues (r → quando), para descartar repetidos. */
  private readonly seen = new Map<number, number>();
  private rateStart = 0;
  private rateCount = 0;
  private readonly now: () => number;

  constructor(private readonly opts: PeerLinkOptions) {
    this.now = opts.now ?? (() => performance.now());
    this.state = opts.mode === 'off' || !PeerLink.supported(opts) ? 'off' : 'idle';
  }

  static supported(opts?: Pick<PeerLinkOptions, 'createPeer'>): boolean {
    return !!opts?.createPeer || typeof RTCPeerConnection === 'function';
  }

  /** O canal está de pé e ouvindo o outro lado agora (o 'st' sai por ele). */
  healthy(): boolean {
    const dc = this.at?.dc;
    return (
      this.state === 'open' &&
      !!dc &&
      dc.readyState === 'open' &&
      this.now() - this.lastRx < StaleMs &&
      dc.bufferedAmount < MaxBuffered
    );
  }

  // ---------------------------------------------------------------- ganchos do NetClient

  /**
   * match.start (começo, revanche ou volta de uma queda): o lugar 1 pede a conexão se ela não está de pé. `allowed` =
   * sala privada (na partida rápida o canal não sobe: o IP de cada um não vai para um desconhecido).
   */
  matchStart(you: Side, allowed = true): void {
    if (this.state === 'off') return;
    if (!allowed) {
      this.close();
      return;
    }
    this.allowed = true;
    this.driver = you === 1;
    this.failures = 0;
    if (this.driver && this.state !== 'open' && this.state !== 'connecting') this.request();
  }

  /** O oponente caiu ou voltou para a sala. O canal pode continuar de pé com a sala fora (não derruba). */
  opponent(connected: boolean): void {
    if (this.state === 'off' || !this.allowed) return;
    this.clearRetry();
    if (connected && this.driver && !this.healthy()) {
      this.failures = 0;
      this.request();
    }
  }

  /** Sinalização que chegou pela sala. */
  signal(raw: unknown): void {
    if (this.state === 'off' || !this.allowed) return;
    const s = parseSignal(raw);
    if (!s) return;
    switch (s.k) {
      case 'req': {
        // O outro lado está sem canal: oferece (a não ser que uma oferta acabou de sair e ainda está em andamento).
        const at = this.at;
        if (at && this.state === 'connecting' && this.now() - at.started < 1500) return;
        this.driver = false;
        void this.offer();
        return;
      }
      case 'offer':
        this.driver = true;
        void this.answer(s.a, s.sdp);
        return;
      case 'answer':
        void this.accept(s.a, s.sdp);
        return;
      case 'ice':
        this.addCandidate(s.a, s.c);
        return;
    }
  }

  /**
   * Manda um 'st' pelo canal se ele está saudável (true). false = mande pela sala. Antes de cada envio, repete os
   * quadros confiáveis sem confirmação; se o canal não está saudável, eles vão pela sala.
   */
  send(msg: StateMsg): boolean {
    if (!this.healthy()) {
      this.flushToLobby();
      this.tx.sala++;
      return false;
    }
    this.resendDue();
    const frame: StateMsg = { t: 'st', d: msg.d };
    if (carriesCommands(msg.d)) {
      const r = this.nextR++;
      frame.r = r;
      const text = JSON.stringify(frame);
      const now = this.now();
      this.unacked.set(r, { text, first: now, last: now });
      this.raw(text);
    } else {
      this.raw(JSON.stringify(frame));
    }
    this.tx.direto++;
    return true;
  }

  /** Um 'st' que chegou pela sala: false se é um confiável repetido (já chegou pelo canal). */
  fromLobby(msg: StateMsg): boolean {
    if (typeof msg.r === 'number' && !this.firstTime(msg.r)) return false;
    this.rx.sala++;
    return true;
  }

  /** Saiu da sala ou do online: derruba o canal (a próxima partida, em outra sala, começa do zero). */
  close(): void {
    if (this.state === 'off') return;
    this.clearRetry();
    this.teardown();
    this.unacked.clear();
    this.driver = false;
    this.allowed = false;
    this.state = 'idle';
  }

  stats(): LinkStats {
    return {
      mode: this.opts.mode,
      state: this.state,
      via: this.healthy() ? 'direto' : 'sala',
      rtt: Math.round(this.rtt),
      route: this.route,
      attempts: this.attempts,
      tx: { ...this.tx },
      rx: { ...this.rx },
      resent: this.resent,
      dup: this.dup,
      expired: this.expired,
    };
  }

  // ---------------------------------------------------------------- conexão

  private request(): void {
    this.clearRetry();
    this.opts.signal({ k: 'req' });
    // Se ninguém oferecer (o outro ainda não está na sala, sinalização perdida), conta como falha e pede de novo.
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.state !== 'open' && this.state !== 'connecting') this.failed(null);
    }, AttemptMs);
  }

  private newAttempt(id: string): Attempt {
    this.teardown();
    this.clearRetry();
    this.attempts++;
    const config: RTCConfiguration =
      this.opts.mode === 'fail'
        ? { iceServers: [], iceTransportPolicy: 'relay' } // sem TURN e só relay: nenhum candidato, nunca conecta
        : { iceServers: this.opts.iceServers ?? StunServers };
    const pc = this.opts.createPeer ? this.opts.createPeer(config) : new RTCPeerConnection(config);
    // Canal combinado dos dois lados (id 0): sem ordem, sem retransmissão.
    const dc = pc.createDataChannel('st', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    const at: Attempt = { id, pc, dc, pending: [], remoteSet: false, timer: setTimeout(() => this.failed(at), AttemptMs), started: this.now() };
    this.at = at;
    this.state = 'connecting';
    pc.onicecandidate = (ev) => {
      if (this.at === at && ev.candidate) this.opts.signal({ k: 'ice', a: id, c: ev.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.failed(at);
    };
    dc.onopen = () => this.opened(at);
    dc.onclose = () => this.failed(at);
    dc.onmessage = (ev) => this.onFrame(at, ev.data);
    return at;
  }

  private async offer(): Promise<void> {
    const at = this.newAttempt(randomId());
    try {
      await at.pc.setLocalDescription(await at.pc.createOffer());
      if (this.at !== at || !at.pc.localDescription) return;
      this.opts.signal({ k: 'offer', a: at.id, sdp: at.pc.localDescription.sdp });
    } catch (e) {
      console.warn('canal direto: oferta falhou', e);
      this.failed(at);
    }
  }

  private async answer(id: string, sdp: string): Promise<void> {
    const at = this.newAttempt(id);
    try {
      await at.pc.setRemoteDescription({ type: 'offer', sdp });
      this.remoteReady(at);
      await at.pc.setLocalDescription(await at.pc.createAnswer());
      if (this.at !== at || !at.pc.localDescription) return;
      this.opts.signal({ k: 'answer', a: id, sdp: at.pc.localDescription.sdp });
    } catch (e) {
      console.warn('canal direto: resposta falhou', e);
      this.failed(at);
    }
  }

  private async accept(id: string, sdp: string): Promise<void> {
    const at = this.at;
    if (!at || at.id !== id || at.remoteSet) return;
    try {
      await at.pc.setRemoteDescription({ type: 'answer', sdp });
      this.remoteReady(at);
    } catch (e) {
      console.warn('canal direto: resposta recusada', e);
      this.failed(at);
    }
  }

  private remoteReady(at: Attempt): void {
    at.remoteSet = true;
    for (const c of at.pending.splice(0)) at.pc.addIceCandidate(c).catch(() => undefined);
  }

  private addCandidate(id: string, c: RTCIceCandidateInit): void {
    const at = this.at;
    if (!at || at.id !== id) return;
    if (!at.remoteSet) {
      if (at.pending.length < 64) at.pending.push(c);
      return;
    }
    at.pc.addIceCandidate(c).catch(() => undefined);
  }

  private opened(at: Attempt): void {
    if (this.at !== at) return;
    clearTimeout(at.timer);
    this.state = 'open';
    this.failures = 0;
    this.lastRx = this.now();
    this.ping();
    if (this.pingTimer === null) this.pingTimer = setInterval(() => this.ping(), PingMs);
    this.readRoute(at);
  }

  private failed(at: Attempt | null): void {
    if (at && this.at !== at) return;
    if (this.state === 'off') return;
    this.teardown();
    this.state = 'failed';
    if (!this.driver || this.retryTimer !== null) return;
    const wait = RetryMs[this.failures];
    this.failures++;
    if (wait === undefined) return; // desistiu: fica na sala até a próxima partida
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.state === 'failed' || this.state === 'idle') this.request();
    }, wait);
  }

  private teardown(): void {
    const at = this.at;
    this.at = null;
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.route = '';
    if (!at) return;
    clearTimeout(at.timer);
    at.pc.onicecandidate = null;
    at.pc.onconnectionstatechange = null;
    at.dc.onopen = at.dc.onclose = at.dc.onmessage = null;
    try {
      at.dc.close();
      at.pc.close();
    } catch {
      /* já fechada */
    }
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Tipos dos candidatos da rota (para o diagnóstico e o doc: host = mesma rede, srflx = pelo NAT). */
  private readRoute(at: Attempt): void {
    at.pc
      .getStats()
      .then((report) => {
        let pairId = '';
        report.forEach((s: { type: string; selectedCandidatePairId?: string }) => {
          if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
        });
        const pair = pairId ? report.get(pairId) : null;
        if (!pair || this.at !== at) return;
        const type = (id: string): string => report.get(id)?.candidateType ?? '?';
        this.route = `${type(pair.localCandidateId)}/${type(pair.remoteCandidateId)}`;
      })
      .catch(() => undefined);
  }

  // ---------------------------------------------------------------- quadros

  private raw(text: string): void {
    try {
      this.at?.dc.send(text);
    } catch {
      /* canal fechando: o próximo envio vê que não está saudável */
    }
  }

  private ping(): void {
    if (this.state !== 'open') return;
    this.raw(JSON.stringify({ t: 'lp', c: this.now() } satisfies Frame));
    this.resendDue();
  }

  private onFrame(at: Attempt, data: unknown): void {
    if (this.at !== at || typeof data !== 'string' || data.length > MaxFrameBytes) return;
    const now = this.now();
    if (now - this.rateStart >= 1000) {
      this.rateStart = now;
      this.rateCount = 0;
    }
    if (++this.rateCount > MaxFramesPerSecond) return;
    let f: Frame;
    try {
      f = JSON.parse(data) as Frame;
    } catch {
      return;
    }
    if (!f || typeof f !== 'object') return;
    this.lastRx = now;
    switch (f.t) {
      case 'st': {
        if (f.d === undefined) return;
        if (typeof f.r === 'number') {
          this.raw(JSON.stringify({ t: 'ack', r: f.r } satisfies Frame));
          if (!this.firstTime(f.r)) return;
        }
        this.rx.direto++;
        this.opts.deliver({ t: 'st', d: f.d });
        return;
      }
      case 'ack':
        if (typeof f.r === 'number') this.unacked.delete(f.r);
        return;
      case 'lp':
        if (typeof f.c === 'number') this.raw(JSON.stringify({ t: 'lq', c: f.c } satisfies Frame));
        return;
      case 'lq': {
        const rtt = now - f.c;
        if (typeof f.c === 'number' && rtt >= 0 && rtt < 10_000) this.rtt = this.rtt === 0 ? rtt : this.rtt + (rtt - this.rtt) * 0.2;
        return;
      }
    }
  }

  /** Primeira vez que o confiável r chega (por qualquer caminho). Guarda os últimos ~5 s. */
  private firstTime(r: number): boolean {
    if (this.seen.has(r)) {
      this.dup++;
      return false;
    }
    const now = this.now();
    this.seen.set(r, now);
    if (this.seen.size > 256) for (const [k, t] of this.seen) if (now - t > 5000) this.seen.delete(k);
    return true;
  }

  private resendDue(): void {
    if (this.unacked.size === 0) return;
    const now = this.now();
    const wait = Math.max(ResendMinMs, 1.2 * this.rtt);
    for (const [r, q] of this.unacked) {
      if (now - q.first > ReliableTtlMs) {
        this.unacked.delete(r);
        this.expired++;
      } else if (now - q.last >= wait) {
        q.last = now;
        this.resent++;
        this.raw(q.text);
      }
    }
  }

  /** O canal parou de responder: o que ele não confirmou vai pela sala (quem recebe descarta se já tinha chegado). */
  private flushToLobby(): void {
    if (this.unacked.size === 0) return;
    const now = this.now();
    for (const [r, q] of this.unacked) {
      if (now - q.first > ReliableTtlMs) this.expired++;
      else this.opts.viaLobby(q.text);
      this.unacked.delete(r);
    }
  }
}
