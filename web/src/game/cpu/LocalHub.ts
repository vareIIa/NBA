// Sala local do 1x1 contra a CPU (docs/25-1x1-cpu-e-defesa.md): o mesmo juiz do online (net/hub/Referee) rodando no
// navegador. Para o OnlineMatch do jogador (lado 0) ela faz o papel do NetClient (MatchNet); a CPU (lado 1, CpuOpponent)
// fala com ela por fromCpu/onCpu. As regras são as do online (check, limpar a bola, relógio de posse, toco, roubo).
//
// Como a rede: o que o juiz decide chega aos dois lados DEPOIS do quadro em que o relato foi feito (microtarefa), nunca
// no meio de quem mandou; o jogador recebe antes da CPU (a bola que muda de mão sai de onde o outro a deixou). O relógio
// da partida é o tempo do jogo (advance, a cada quadro): parado enquanto a CPU carrega e com a aba escondida.
import { Referee } from '../../net/hub/Referee';
import type { NetStatus } from '../../net/NetClient';
import type { LinkStats } from '../../net/PeerLink';
import {
  type ClientMsg,
  DefaultRules,
  type MatchEvent,
  type MatchRules,
  type MatchState,
  type PlayerCard,
  type RoomInfo,
  type ServerMsg,
  type Side,
  otherSide,
} from '../../net/protocol';

/** Lado do jogador e da CPU na sala local. */
export const HumanSide: Side = 0;
export const CpuSide: Side = 1;

type StartMsg = Extract<ServerMsg, { t: 'match.start' }>;
type Handler = (msg: ServerMsg) => void;
/** Relatos da jogada (os mesmos do online). */
type ReportMsg = Extract<ClientMsg, { t: 'g.release' | 'g.result' | 'g.claim' | 'g.cleared' | 'g.block' | 'g.steal' }>;

export interface LocalHubOptions {
  human: PlayerCard;
  cpu: PlayerCard;
  rules?: Partial<MatchRules>;
  /** Quem começa atacando (padrão: o jogador). Na revanche troca. */
  firstOffense?: Side;
  /** [0, 1): o sorteio do roubo (o juiz). */
  random?: () => number;
  /** Testes (?sorte=1): todo roubo possível DO JOGADOR sai (os da CPU seguem o sorteio). */
  sorteHuman?: boolean;
}

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export class LocalHub {
  status: NetStatus = 'open';
  rtt = 0;
  lastMatchState: MatchState | null = null;
  readonly rules: MatchRules;
  readonly cards: [PlayerCard, PlayerCard];
  private referee!: Referee;
  private room!: RoomInfo;
  private firstOffense: Side;
  /** Relógio da partida (ms): soma do tempo de jogo, não do relógio da parede. */
  private clockMs = 0;
  private starting = false;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly cpuHandlers = new Set<Handler>();
  private outbox: { to: Side | 'both'; msg: ServerMsg }[] = [];
  private flushQueued = false;
  private closed = false;
  private readonly random: () => number;
  /** Lado do relato que o juiz está sorteando agora (a sorte de teste vale só para o jogador). */
  private rollSide: Side = HumanSide;
  /** Os eventos do juiz desta partida, para o debug e os testes. */
  readonly events: MatchEvent[] = [];

  constructor(opts: LocalHubOptions) {
    this.rules = { ...DefaultRules, ...opts.rules };
    this.cards = [opts.human, opts.cpu];
    this.firstOffense = opts.firstOffense ?? HumanSide;
    const base = opts.random ?? Math.random;
    this.random = opts.sorteHuman ? () => (this.rollSide === HumanSide ? 0 : base()) : base;
    this.newMatch();
  }

  // ---------------------------------------------------------------- MatchNet (o lado do jogador)

  on<T extends ServerMsg['t']>(type: T, handler: (msg: Extract<ServerMsg, { t: T }>) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as Handler);
    return () => set!.delete(handler as Handler);
  }

  /** O que o OnlineMatch do jogador manda. O estado do boneco ('st'), o ping e o resto do lobby não têm para onde ir. */
  send(msg: ClientMsg): void {
    if (this.closed) return;
    switch (msg.t) {
      case 'g.release':
      case 'g.result':
      case 'g.claim':
      case 'g.cleared':
      case 'g.block':
      case 'g.steal':
        this.report(HumanSide, msg);
        return;
      case 'room.rematch':
        // A CPU sempre quer a revanche: começa outra, com o primeiro ataque trocado.
        if (msg.want && this.referee.over) this.rematch();
        return;
      case 'room.leave':
        this.close();
        return;
      default:
        return;
    }
  }

  /** Relógio da partida (ms), o mesmo do juiz. */
  serverNow(): number {
    return this.clockMs;
  }

  close(): void {
    this.closed = true;
    this.status = 'closed';
    this.outbox = [];
  }

  /** O 1x1 local não tem canal direto: o envio fica na taxa pedida. */
  stateHz(hz: number): number {
    return hz;
  }

  /** Sem canal direto: tudo zerado (o tipo é do PeerLink, que ainda cresce; os campos que faltarem ficam de fora). */
  linkStats(): LinkStats {
    const neutral: Partial<LinkStats> = {
      mode: 'off',
      state: 'off',
      via: 'sala',
      rtt: 0,
      route: 'offline',
      attempts: 0,
      tx: { direto: 0, sala: 0 },
      rx: { direto: 0, sala: 0 },
      resent: 0,
      dup: 0,
      expired: 0,
      skipped: 0,
    };
    return neutral as LinkStats;
  }

  // ---------------------------------------------------------------- a CPU

  /** Mensagens do juiz para a CPU (as mesmas que o jogador recebe, com you = lado da CPU). */
  onCpu(handler: Handler): () => void {
    this.cpuHandlers.add(handler);
    return () => this.cpuHandlers.delete(handler);
  }

  /** Relato da CPU (g.release, g.result, g.claim, g.cleared, g.block, g.steal). */
  fromCpu(msg: ReportMsg): void {
    if (!this.closed) this.report(CpuSide, msg);
  }

  /** O 'match.start' da partida atual para um lado (o OnlineMatch e a CPU começam daqui). */
  startMsg(side: Side): StartMsg {
    return { t: 'match.start', room: copy(this.room), you: side, state: copy(this.referee.state), serverTime: this.clockMs };
  }

  /** Estado do juiz agora (cópia). */
  state(): MatchState {
    return copy(this.referee.state);
  }

  /** Avança o relógio da partida (s de jogo) e roda o juiz: fim do check, relógio de posse, bola solta abandonada. */
  advance(dt: number): void {
    if (this.closed) return;
    this.clockMs += Math.max(0, Math.min(0.1, dt)) * 1000;
    this.referee.tick();
  }

  /** Entrega já o que está na fila (os testes; o jogo usa a microtarefa). */
  flush(): void {
    this.flushQueued = false;
    const box = this.outbox;
    this.outbox = [];
    for (const { to, msg } of box) {
      if (this.closed) return;
      if (to === HumanSide || to === 'both') this.deliverHuman(to === 'both' ? this.forSide(msg, HumanSide) : msg);
      if (to === CpuSide || to === 'both') for (const h of [...this.cpuHandlers]) h(to === 'both' ? this.forSide(msg, CpuSide) : msg);
    }
  }

  // ---------------------------------------------------------------- interno

  private newMatch(): void {
    this.room = {
      code: 'CPU',
      quick: false,
      rules: { ...this.rules },
      players: [
        { side: HumanSide, card: this.cards[HumanSide], ready: true, connected: true },
        { side: CpuSide, card: this.cards[CpuSide], ready: true, connected: true },
      ],
      inMatch: true,
      rematch: [false, false],
    };
    this.events.length = 0;
    this.referee = new Referee(this.rules, this.firstOffense, () => this.clockMs, (event) => this.onEvent(event), {
      card: (side) => this.cards[side],
      random: this.random,
    });
    // O match.start já leva o primeiro check (como no Hub): o evento 'start' não sai à parte.
    this.starting = true;
    this.referee.start();
    this.starting = false;
    this.lastMatchState = copy(this.referee.state);
  }

  private rematch(): void {
    this.firstOffense = otherSide(this.firstOffense);
    this.newMatch();
    this.post('both', { t: 'match.start', room: copy(this.room), you: HumanSide, state: copy(this.referee.state), serverTime: this.clockMs });
  }

  private report(side: Side, msg: ReportMsg): void {
    const ref = this.referee;
    this.rollSide = side;
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
        ref.steal(side, seq, Number.isFinite(msg.exp) ? Math.min(1, Math.max(0, msg.exp)) : 0);
        return;
    }
  }

  private onEvent(event: MatchEvent | null): void {
    if (this.starting) return;
    if (event) this.events.push(event);
    this.post('both', { t: 'match.state', state: copy(this.referee.state), event: event && copy(event), serverTime: this.clockMs });
  }

  /** A mesma mensagem para o outro lado: o match.start leva o `you` de quem recebe; o resto é igual (cópia). */
  private forSide(msg: ServerMsg, side: Side): ServerMsg {
    const out = copy(msg);
    if (out.t === 'match.start') out.you = side;
    return out;
  }

  private post(to: Side | 'both', msg: ServerMsg): void {
    this.outbox.push({ to, msg });
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      if (this.flushQueued) this.flush();
    });
  }

  private deliverHuman(msg: ServerMsg): void {
    if (msg.t === 'match.start' || msg.t === 'match.state') this.lastMatchState = msg.state;
    const set = this.handlers.get(msg.t);
    if (set) for (const h of [...set]) h(msg);
  }
}
