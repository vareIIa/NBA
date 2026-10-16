// Juiz do 1x1 (roda no servidor): placar, posse, check-ball, relógio de posse, rebote, roubo, toco, limpar a bola e
// vitória. Puro (sem rede nem relógio próprio): o Hub dá o relógio, o sorteio e os cartões e repassa os relatos dos
// clientes; cada mudança sai por emit. Os relatos trazem o seq da posse: um relato atrasado de uma posse que já acabou
// é ignorado.
import { type MatchEvent, type MatchRules, type MatchState, type PlayerCard, type Side, otherSide, shotClockLeft } from '../protocol.ts';
import { StealCooldownMs, stealChance } from '../defense.ts';

/** Contagem do primeiro check (os clientes ainda carregam o boneco do oponente). */
export const FirstCheckMs = 5000;
/** Contagem do check-ball nas posses seguintes. */
export const CheckMs = 2500;
/** Pausa depois de cesta ou violação (comemoração, a bola cai da rede). */
export const DeadMs = 1800;
/** Bola solta sem ninguém pegar por este tempo: volta para a defesa (presa na rede, jogadores longe). */
export const LooseMaxMs = 10000;

export interface RefereeOptions {
  /** Cartão de cada lado (ratings e badges do roubo). Sem cartão, os valores médios. */
  card?: (side: Side) => PlayerCard | null;
  /** [0, 1): o sorteio do roubo. */
  random?: () => number;
}

/** Cartão médio (um lado sem cartão: só nos testes). */
const PlainCard: PlayerCard = {
  name: '',
  heightCm: 196,
  wingspanOverM: 0,
  wingspanCm: 200,
  overall: 60,
  archetype: '',
  position: '',
  perimeterDefense: 60,
};

export class Referee {
  readonly state: MatchState;
  readonly rules: MatchRules;
  private readonly now: () => number;
  private readonly emit: (event: MatchEvent | null) => void;
  /** Quem ataca no check que vem depois do dead. */
  private nextOffense: Side = 0;
  private looseSince = 0;
  private readonly card: (side: Side) => PlayerCard | null;
  private readonly random: () => number;
  /** Último tapa de cada lado (ms): um por StealCooldownMs. */
  private readonly lastSteal: [number, number] = [-Infinity, -Infinity];

  // Sem "parameter properties": o Node roda este arquivo só apagando os tipos (o servidor de desenvolvimento não tem
  // bundler), e elas não são apagáveis.
  constructor(rules: MatchRules, firstOffense: Side, now: () => number, emit: (event: MatchEvent | null) => void, opts: RefereeOptions = {}) {
    this.rules = rules;
    this.now = now;
    this.emit = emit;
    this.card = opts.card ?? (() => null);
    this.random = opts.random ?? Math.random;
    this.state = {
      phase: 'check',
      phaseEndsAt: 0,
      score: [0, 0],
      offense: firstOffense,
      ball: 'held',
      shooter: null,
      needsClear: false,
      clockMs: this.fullClock(),
      clockAt: 0,
      clockRunning: false,
      seq: 0,
      winner: null,
    };
  }

  /** Primeiro check da partida. */
  start(): void {
    this.toCheck(this.state.offense, FirstCheckMs);
    this.emit({ kind: 'start', offense: this.state.offense });
  }

  get over(): boolean {
    return this.state.phase === 'over';
  }

  /** Relógio: fim das contagens, estouro do relógio de posse e bola solta abandonada. */
  tick(): void {
    const s = this.state;
    const now = this.now();
    if (s.phase === 'check' && now >= s.phaseEndsAt) {
      s.phase = 'live';
      s.phaseEndsAt = 0;
      s.ball = 'held';
      this.runClock(true);
      this.emit(null);
    } else if (s.phase === 'dead' && now >= s.phaseEndsAt) {
      this.toCheck(this.nextOffense, CheckMs);
      this.emit(null);
    } else if (s.phase === 'live') {
      if (s.clockRunning && shotClockLeft(s, now) <= 0) {
        const side = s.offense;
        this.toDead(otherSide(side));
        this.emit({ kind: 'shotClock', side });
      } else if (s.ball === 'loose' && now - this.looseSince > LooseMaxMs) {
        const defense = otherSide(s.offense);
        this.toDead(defense);
        this.emit({ kind: 'deadBall', side: defense });
      }
    }
  }

  // ---------------------------------------------------------------- relatos dos clientes

  /** O atacante soltou o arremesso (ou a bandeja/enterrada). */
  release(side: Side, seq: number): boolean {
    const s = this.state;
    if (!this.live(seq) || side !== s.offense || s.ball !== 'held') return false;
    s.ball = 'air';
    s.shooter = side;
    this.runClock(false);
    this.emit(null);
    return true;
  }

  /** O arremesso resolveu (primeiro toque no chão): cesta, cesta sem limpar ou erro (bola solta). */
  result(side: Side, seq: number, scored: boolean, isThree: boolean): boolean {
    const s = this.state;
    if (!this.live(seq) || side !== s.offense || s.ball !== 'air') return false;
    if (!scored) {
      s.ball = 'loose';
      this.looseSince = this.now();
      this.emit({ kind: 'miss', side });
      return true;
    }
    if (s.needsClear) {
      this.toDead(otherSide(side));
      this.emit({ kind: 'noClear', side });
      return true;
    }
    const points = isThree ? this.rules.outsidePoints : this.rules.insidePoints;
    s.score[side] += points;
    if (this.won(side)) {
      s.phase = 'over';
      s.phaseEndsAt = 0;
      s.winner = side;
      this.runClock(false);
      this.emit({ kind: 'score', side, points, isThree });
      this.emit({ kind: 'over', winner: side, reason: 'score' });
      return true;
    }
    this.toDead(this.rules.makeItTakeIt ? side : otherSide(side));
    this.emit({ kind: 'score', side, points, isThree });
    return true;
  }

  /** Pedido da bola solta: o primeiro válido leva. Rebote defensivo obriga a limpar (se a regra estiver ligada). */
  claim(side: Side, seq: number): boolean {
    const s = this.state;
    if (!this.live(seq) || s.ball !== 'loose') return false;
    const offensive = side === s.shooter;
    this.giveBall(side, !offensive);
    this.emit({ kind: 'rebound', side, offensive });
    return true;
  }

  /**
   * Tapa do defensor na bola (na mão do atacante). `exposure` = o que ele viu (0..1, ballExposure); o juiz sorteia com
   * os cartões dos dois. Roubou: a posse troca como num rebote defensivo (precisa limpar). true = roubou.
   */
  steal(side: Side, seq: number, exposure: number): boolean {
    const s = this.state;
    if (!this.live(seq) || side === s.offense || s.ball !== 'held') return false;
    const now = this.now();
    if (now - this.lastSteal[side] < StealCooldownMs) return false;
    this.lastSteal[side] = now;
    const exp = Number.isFinite(exposure) ? exposure : 0;
    const chance = stealChance(this.card(side) ?? PlainCard, this.card(s.offense) ?? PlainCard, exp);
    if (!(this.random() < chance)) return false;
    this.giveBall(side, true);
    this.emit({ kind: 'steal', side });
    return true;
  }

  /** O arremesso de `side` tomou toco (quem arremessou relata): a bola fica solta já, sem esperar o quique. */
  block(side: Side, seq: number): boolean {
    const s = this.state;
    if (!this.live(seq) || side !== s.offense || s.ball !== 'air') return false;
    s.ball = 'loose';
    this.looseSince = this.now();
    this.emit({ kind: 'block', side: otherSide(side) });
    return true;
  }

  /** O atacante saiu da linha de 3 com a bola. */
  cleared(side: Side, seq: number): boolean {
    const s = this.state;
    if (!this.live(seq) || side !== s.offense || !s.needsClear || s.ball !== 'held') return false;
    s.needsClear = false;
    this.emit({ kind: 'cleared', side });
    return true;
  }

  // ---------------------------------------------------------------- conexão

  /** Um lado caiu: a partida congela até ele voltar (ou desistir). */
  pause(side: Side): void {
    const s = this.state;
    if (s.phase === 'over' || s.phase === 'paused') return;
    this.runClock(false);
    s.phase = 'paused';
    s.phaseEndsAt = 0;
    this.emit({ kind: 'paused', side });
  }

  /** Voltou: a posse recomeça com um check do mesmo atacante (o placar fica). */
  resume(): void {
    if (this.state.phase !== 'paused') return;
    this.toCheck(this.state.offense, FirstCheckMs);
    this.emit({ kind: 'resumed' });
  }

  /** Desistiu (saiu da sala ou não voltou a tempo): o outro vence. */
  forfeit(loser: Side): void {
    const s = this.state;
    if (s.phase === 'over') return;
    this.runClock(false);
    s.phase = 'over';
    s.phaseEndsAt = 0;
    s.winner = otherSide(loser);
    this.emit({ kind: 'over', winner: s.winner, reason: 'forfeit' });
  }

  // ---------------------------------------------------------------- interno

  private live(seq: number): boolean {
    return this.state.phase === 'live' && seq === this.state.seq;
  }

  private won(side: Side): boolean {
    const mine = this.state.score[side];
    const theirs = this.state.score[otherSide(side)];
    return mine >= this.rules.target && (!this.rules.winByTwo || mine - theirs >= 2);
  }

  private fullClock(): number {
    return this.rules.shotClock > 0 ? this.rules.shotClock * 1000 : 0;
  }

  /** Liga ou para o relógio de posse guardando o que sobrou. Sem relógio nas regras, nunca corre. */
  private runClock(run: boolean): void {
    const s = this.state;
    const now = this.now();
    s.clockMs = shotClockLeft(s, now);
    s.clockAt = now;
    s.clockRunning = run && this.rules.shotClock > 0;
  }

  /** A bola passa para `side` (rebote ou roubo): posse nova, relógio cheio. */
  private giveBall(side: Side, defensive: boolean): void {
    const s = this.state;
    s.offense = side;
    s.ball = 'held';
    s.needsClear = this.rules.clearBall && defensive;
    s.shooter = null;
    s.seq++;
    s.clockMs = this.fullClock();
    this.runClock(true);
  }

  private toDead(nextOffense: Side): void {
    const s = this.state;
    this.runClock(false);
    s.phase = 'dead';
    s.phaseEndsAt = this.now() + DeadMs;
    s.ball = 'loose';
    this.nextOffense = nextOffense;
  }

  private toCheck(offense: Side, ms: number): void {
    const s = this.state;
    s.phase = 'check';
    s.phaseEndsAt = this.now() + ms;
    s.offense = offense;
    s.ball = 'held';
    s.shooter = null;
    s.needsClear = false;
    s.seq++;
    s.clockMs = this.fullClock();
    s.clockAt = this.now();
    s.clockRunning = false;
  }
}
