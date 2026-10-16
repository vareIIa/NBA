// Cliente do multiplayer: uma conexão WebSocket com o Hub (protocol.ts), reconexão automática com o token da aba,
// latência e relógio do servidor (ping a cada 2 s; o offset vem da amostra de menor ida e volta).
// Na partida, o estado do jogador ('st') vai pelo canal direto com o oponente (PeerLink, WebRTC) quando ele está de pé,
// e pela sala quando não: quem usa o cliente só chama send({t:'st'}) e on('st') e não vê a diferença.
import { type LinkStats, PeerLink, type StateMsg, p2pModeFrom } from './PeerLink.ts';
import {
  type ClientMsg,
  DevServerPort,
  type MatchState,
  type PlayerCard,
  ProtocolVersion,
  type ServerMsg,
  WsPath,
} from './protocol.ts';

export type NetStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

type Handler<T extends ServerMsg['t']> = (msg: Extract<ServerMsg, { t: T }>) => void;

/** O token fica na sessão da aba: duas abas no mesmo PC são dois jogadores (bom para testar sozinho). */
const TokenKey = 'garrafao.mp.token';
const PingMs = 2000;
const RetryMs = [500, 1000, 2000, 4000, 8000];
/** Envios de estado por segundo pelo canal direto (stateHz). */
const DirectStateHz = 30;

/**
 * Endereço do servidor de salas, nesta ordem: ?mp=<url> na página, VITE_MP_URL (ou VITE_SALA_URL) no build, a porta do
 * servidor de desenvolvimento (npm run dev) ou o próprio site (o Worker serve o jogo e a sala na mesma URL).
 */
export function defaultServerUrl(): string {
  const param = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('mp') : null;
  if (param) return param;
  const env = (import.meta.env?.VITE_MP_URL ?? import.meta.env?.VITE_SALA_URL) as string | undefined;
  if (env) return env;
  const secure = location.protocol === 'https:';
  if (import.meta.env?.DEV) return `${secure ? 'wss' : 'ws'}://${location.hostname}:${DevServerPort}${WsPath}`;
  return `${secure ? 'wss' : 'ws'}://${location.host}${WsPath}`;
}

const epochMs = (): number => performance.timeOrigin + performance.now();

function readToken(): string | undefined {
  try {
    return sessionStorage.getItem(TokenKey) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeToken(token: string): void {
  try {
    sessionStorage.setItem(TokenKey, token);
  } catch {
    /* aba sem storage: reconecta só enquanto a página estiver aberta */
  }
}

export class NetClient {
  status: NetStatus = 'idle';
  /** Ida e volta (ms), suavizada. */
  rtt = 0;
  id = '';
  /** Último erro de conexão (para a tela do lobby). */
  lastError = '';
  /** O servidor está noutra versão do protocolo (o site em que o jogador está ficou para trás de uma publicação). */
  versionMismatch = false;
  /**
   * Último estado da partida que chegou, com ou sem alguém ouvindo: quem monta a partida depois do match.start (o boneco
   * do oponente leva alguns segundos para carregar) começa daqui e não perde a mudança de fase que veio no meio.
   */
  lastMatchState: MatchState | null = null;
  private ws: WebSocket | null = null;
  private token: string | undefined = readToken();
  private readonly handlers = new Map<string, Set<(msg: ServerMsg) => void>>();
  private readonly statusHandlers = new Set<(s: NetStatus) => void>();
  private pingTimer = 0;
  private retry = 0;
  private retryTimer = 0;
  private wanted = false;
  /** Amostras recentes de (ida e volta, offset do relógio do servidor). */
  private samples: { rtt: number; offset: number }[] = [];
  private offset = 0;
  private welcomed: ((ok: boolean) => void) | null = null;
  /** Canal direto com o oponente (?p2p=0 desliga, ?p2p=falha testa o fallback; VITE_P2P no build). */
  private readonly link: PeerLink;

  constructor(
    private card: PlayerCard,
    readonly url: string = defaultServerUrl(),
  ) {
    const param = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('p2p') : null;
    this.link = new PeerLink({
      mode: p2pModeFrom(param, import.meta.env?.VITE_P2P as string | undefined),
      signal: (d) => this.send({ t: 'rtc', d }),
      deliver: (msg) => this.dispatch(msg),
      viaLobby: (text) => this.ws?.readyState === WebSocket.OPEN && this.ws.send(text),
    });
  }

  /** Conecta (ou reconecta) e espera o welcome. false = o servidor não respondeu. */
  connect(timeoutMs = 6000): Promise<boolean> {
    this.wanted = true;
    if (this.status === 'open') return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => finish(false), timeoutMs);
      const finish = (ok: boolean): void => {
        window.clearTimeout(timer);
        this.welcomed = null;
        resolve(ok);
      };
      this.welcomed = finish;
      this.open();
    });
  }

  /** Fecha de vez (saiu do online). */
  close(): void {
    this.wanted = false;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    this.link.close();
    this.ws?.close(1000, 'bye');
    this.ws = null;
    this.setStatus('closed');
  }

  setCard(card: PlayerCard): void {
    this.card = card;
  }

  /** O 'st' vai pelo canal direto quando ele está saudável; o resto (e o 'st' sem canal) vai pela sala. */
  send(msg: ClientMsg): void {
    if (msg.t === 'st' && this.link.send(msg)) return;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Canal direto: estado, caminho atual do 'st', ping do canal e contagens (debug, e2e, medição de latência). */
  linkStats(): LinkStats {
    return this.link.stats();
  }

  /**
   * Envios de estado por segundo: pela sala, `lobbyHz` (cada quadro conta no plano grátis do Durable Object); pelo
   * canal direto, pelo menos DirectStateHz (não passa pela sala, e o buffer do boneco encolhe com o intervalo).
   */
  stateHz(lobbyHz: number): number {
    return this.link.healthy() ? Math.max(lobbyHz, DirectStateHz) : lobbyHz;
  }

  on<T extends ServerMsg['t']>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as (msg: ServerMsg) => void);
    return () => set!.delete(handler as (msg: ServerMsg) => void);
  }

  onStatus(handler: (s: NetStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /** Relógio do servidor agora (ms). */
  serverNow(): number {
    return epochMs() + this.offset;
  }

  /** Converte um instante do servidor para o relógio local do performance.now (s), o do jogo. */
  serverToLocalSeconds(serverMs: number): number {
    return (serverMs - this.offset - performance.timeOrigin) / 1000;
  }

  // ---------------------------------------------------------------- interno

  private open(): void {
    window.clearTimeout(this.retryTimer);
    this.setStatus(this.retry > 0 ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.lastError = `endereço inválido: ${this.url}`;
      console.warn('multiplayer:', e);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', v: ProtocolVersion, card: this.card, token: this.token } satisfies ClientMsg));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data) as ServerMsg;
      } catch {
        return;
      }
      this.receive(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      window.clearInterval(this.pingTimer);
      // 4001 = versão diferente, 4002 = a mesma conta abriu em outra aba: não adianta reconectar.
      if (ev.code === 4001 || ev.code === 4002) this.wanted = false;
      if (!this.wanted) {
        this.setStatus('closed');
        this.welcomed?.(false);
        return;
      }
      if (!this.lastError) this.lastError = 'sem resposta do servidor de salas';
      this.scheduleRetry();
    };
    ws.onerror = () => {
      this.lastError = `sem resposta do servidor de salas (${this.url})`;
    };
  }

  private scheduleRetry(): void {
    if (!this.wanted) return;
    this.setStatus('reconnecting');
    const wait = RetryMs[Math.min(this.retry, RetryMs.length - 1)];
    this.retry++;
    this.retryTimer = window.setTimeout(() => this.open(), wait);
  }

  private receive(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.id = msg.id;
        this.token = msg.token;
        writeToken(msg.token);
        this.retry = 0;
        this.lastError = '';
        this.samples = [];
        this.offset = msg.serverTime - epochMs();
        this.setStatus('open');
        window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => this.ping(), PingMs);
        // Três pings seguidos acertam o relógio logo no começo.
        for (let i = 0; i < 3; i++) window.setTimeout(() => this.ping(), 150 * i);
        this.welcomed?.(true);
        break;
      case 'pong':
        this.onPong(msg.c, msg.s);
        break;
      case 'match.start':
        this.lastMatchState = msg.state;
        this.link.matchStart(msg.you, !msg.room.quick); // partida rápida (desconhecido): sem canal direto
        break;
      case 'match.state':
        this.lastMatchState = msg.state;
        break;
      case 'opponent':
        this.link.opponent(msg.connected);
        break;
      case 'room.left':
        this.link.close();
        break;
      case 'rtc':
        this.link.signal(msg.d);
        return;
      case 'st':
        // Confiável que já tinha chegado pelo canal direto (o outro lado repetiu pela sala quando o canal caiu).
        if (!this.link.fromLobby(msg as StateMsg)) return;
        break;
      case 'error':
        if (msg.code !== 'rate_limit') console.warn('multiplayer:', msg.code, msg.message);
        this.lastError = msg.message;
        if (msg.code === 'version') this.onVersionMismatch();
        break;
    }
    this.dispatch(msg);
  }

  private dispatch(msg: ServerMsg): void {
    const set = this.handlers.get(msg.t);
    if (set) for (const h of [...set]) h(msg);
  }

  /**
   * Versão diferente da do servidor: quase sempre é uma aba aberta antes de uma publicação nova. Recarrega a página (o
   * index.html não fica em cache, então vem o jogo novo, com o mesmo ?sala=). No máximo uma vez por minuto: se o próprio
   * site estiver desatualizado, recarregar não adianta e o jogador vê a mensagem em vez de um loop.
   */
  private onVersionMismatch(): void {
    this.versionMismatch = true;
    const key = 'garrafao.versionReloadAt';
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(key) ?? 0);
    } catch {
      // sem sessionStorage (janela privada, dados bloqueados): recarrega mesmo assim, uma vez por carregamento
    }
    if (Date.now() - last < 60_000) {
      this.lastError = 'O jogo deste endereço está numa versão diferente da sala. Tente de novo em alguns minutos.';
      return;
    }
    try {
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // idem
    }
    this.lastError = 'O jogo foi atualizado: recarregando…';
    location.reload();
  }

  private ping(): void {
    this.send({ t: 'ping', c: epochMs() });
  }

  private onPong(sentAt: number, serverTime: number): void {
    const now = epochMs();
    const rtt = Math.max(0, now - sentAt);
    this.rtt = this.rtt === 0 ? rtt : this.rtt + (rtt - this.rtt) * 0.2;
    this.samples.push({ rtt, offset: serverTime - (sentAt + rtt / 2) });
    if (this.samples.length > 10) this.samples.shift();
    // A amostra de menor ida e volta é a que menos sofreu com fila na rede.
    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    this.offset = best.offset;
  }

  private setStatus(status: NetStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const h of [...this.statusHandlers]) h(status);
  }
}
