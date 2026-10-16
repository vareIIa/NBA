// Takeover do 2K23 (docs/19-badges-2k23.md §5): um takeover primário e um secundário por jogador, mais o Team
// Takeover. Os quadradinhos do HUD mostram as três barras (o fundo vermelho sobe); cheio e ativo = pega fogo.
//  - O medidor enche com jogada boa (cesta, green, assistência, roubo, toco, rebote, combos e arranques) e esvazia
//    com jogada ruim (erro, arremesso forçado, turnover, levar cesta). Um pouco de dreno parado.
//  - Primário cheio = ativo por 30 s (ou até 2 jogadas ruins). Ativo, as jogadas boas enchem o secundário; cheio,
//    os dois ficam ativos até o primário acabar.
//  - Team Takeover: medidor do time (no 1x1 é só o seu pedaço, mais lento); cheio = 45 s.
// O 2K não publica os números de enchimento: os valores abaixo são a proposta do doc (ajustáveis).
import { clamp } from './HoopsMath';

export type TakeoverGroup = 'Finishing' | 'Shooting' | 'Post' | 'Playmaking' | 'Defense' | 'Team';

export type TakeoverId =
  | 'AdvancedGathers'
  | 'EasyBlowbys'
  | 'FinishingMoves'
  | 'LimitlessRange'
  | 'PullUpPrecision'
  | 'SpotUpPrecision'
  | 'NegativeImpact'
  | 'AnklebreakingShots'
  | 'AdvancedPostMoves'
  | 'PowerBackdowns'
  | 'PostPlaymaking'
  | 'PostShotDaggers'
  | 'GlassClearingDimes'
  | 'BoxoutWall'
  | 'SeeTheFuture'
  | 'ExtremeClamps'
  | 'EnhancedJumpShotContests'
  | 'PerimeterBadgeDrop'
  | 'InteriorBadgeDrop'
  | 'PaintIntimidation'
  | 'StuffBlocks'
  | 'TeamRatingsBoost'
  | 'TeamTakeoverBoost'
  | 'TeamBadgeBoost';

export interface TakeoverDef {
  readonly id: TakeoverId;
  readonly name: string;
  readonly group: TakeoverGroup;
  readonly effect: string; // pt-BR
  readonly glyph: string; // ícone do HUD (TakeoverGlyph)
  readonly live: boolean; // já faz efeito no Freestyle
}

const t = (d: TakeoverDef): TakeoverDef => d;

// prettier-ignore
export const Takeovers: Readonly<Record<TakeoverId, TakeoverDef>> = {
  AdvancedGathers: t({ id: 'AdvancedGathers', name: 'Advanced Gathers', group: 'Finishing', effect: 'Gathers de spin, euro, hop e cradle mais eficazes', glyph: 'slasher', live: false }),
  EasyBlowbys: t({ id: 'EasyBlowbys', name: 'Easy Blowbys', group: 'Finishing', effect: 'Passa pelo defensor no drible com mais facilidade (arranque +20%, velocidade +4%)', glyph: 'slasher', live: true }),
  FinishingMoves: t({ id: 'FinishingMoves', name: 'Finishing Moves', group: 'Finishing', effect: 'Absorve o contato e finaliza', glyph: 'slasher', live: false }),
  LimitlessRange: t({ id: 'LimitlessRange', name: 'Limitless Range', group: 'Shooting', effect: 'Alcance até o logo: sem penalidade de distância', glyph: 'shooter', live: true }),
  PullUpPrecision: t({ id: 'PullUpPrecision', name: 'Pull-Up Precision', group: 'Shooting', effect: 'Arremessos saindo do drible bem cronometrados: +6 pp', glyph: 'shooter', live: true }),
  SpotUpPrecision: t({ id: 'SpotUpPrecision', name: 'Spot-Up Precision', group: 'Shooting', effect: 'Arremessos parados bem cronometrados: +6 pp', glyph: 'shooter', live: true }),
  NegativeImpact: t({ id: 'NegativeImpact', name: 'Negative Impact', group: 'Shooting', effect: 'Menos efeito da defesa em pull-ups e arremessos de habilidade', glyph: 'shooter', live: false }),
  AnklebreakingShots: t({ id: 'AnklebreakingShots', name: 'Anklebreaking Shots', group: 'Shooting', effect: 'Mais desequilíbrios em spin e step-back', glyph: 'handles', live: false }),
  AdvancedPostMoves: t({ id: 'AdvancedPostMoves', name: 'Advanced Post Moves', group: 'Post', effect: 'Movimentos de post passam mais', glyph: 'slasher', live: false }),
  PowerBackdowns: t({ id: 'PowerBackdowns', name: 'Power Backdowns', group: 'Post', effect: 'Empurra mais no backdown', glyph: 'slasher', live: false }),
  PostPlaymaking: t({ id: 'PostPlaymaking', name: 'Post Playmaking', group: 'Post', effect: 'Passe saindo do post melhora o arremesso do companheiro', glyph: 'handles', live: false }),
  PostShotDaggers: t({ id: 'PostShotDaggers', name: 'Post Shot Daggers', group: 'Post', effect: 'Hooks, fades e shimmies melhores', glyph: 'shooter', live: false }),
  GlassClearingDimes: t({ id: 'GlassClearingDimes', name: 'Glass-Clearing Dimes', group: 'Playmaking', effect: 'Passe depois do rebote melhora o arremesso', glyph: 'handles', live: false }),
  BoxoutWall: t({ id: 'BoxoutWall', name: 'Boxout Wall', group: 'Playmaking', effect: 'Box out mais fácil', glyph: 'lockdown', live: false }),
  SeeTheFuture: t({ id: 'SeeTheFuture', name: 'See the Future', group: 'Playmaking', effect: 'Mostra onde o rebote vai cair', glyph: 'lockdown', live: false }),
  ExtremeClamps: t({ id: 'ExtremeClamps', name: 'Extreme Clamps', group: 'Defense', effect: 'Corta e tromba melhor na bola', glyph: 'lockdown', live: false }),
  EnhancedJumpShotContests: t({ id: 'EnhancedJumpShotContests', name: 'Enhanced Contests', group: 'Defense', effect: 'Contestações de arremesso mais fortes', glyph: 'lockdown', live: false }),
  PerimeterBadgeDrop: t({ id: 'PerimeterBadgeDrop', name: 'Perimeter Badge Drop', group: 'Defense', effect: 'Badges de arremesso do adversário caem um nível perto de você', glyph: 'lockdown', live: false }),
  InteriorBadgeDrop: t({ id: 'InteriorBadgeDrop', name: 'Interior Badge Drop', group: 'Defense', effect: 'Badges de finalização do adversário caem um nível no garrafão', glyph: 'lockdown', live: false }),
  PaintIntimidation: t({ id: 'PaintIntimidation', name: 'Paint Intimidation', group: 'Defense', effect: 'Mais efeito nos arremessos no aro', glyph: 'lockdown', live: false }),
  StuffBlocks: t({ id: 'StuffBlocks', name: 'Stuff Blocks', group: 'Defense', effect: 'Mais tocos, pins e tocos segurando a bola', glyph: 'lockdown', live: false }),
  TeamRatingsBoost: t({ id: 'TeamRatingsBoost', name: 'Team Ratings Boost', group: 'Team', effect: 'Atributos ofensivos do time sobem', glyph: 'team', live: false }),
  TeamTakeoverBoost: t({ id: 'TeamTakeoverBoost', name: 'Team Takeover Boost', group: 'Team', effect: 'Medidores do time enchem mais rápido', glyph: 'team', live: true }),
  TeamBadgeBoost: t({ id: 'TeamBadgeBoost', name: 'Team Badge Boost', group: 'Team', effect: 'Todos os badges sobem um nível', glyph: 'team', live: true }),
};

export enum TakeoverEvent {
  Make,
  MakeThree,
  AndOne,
  Green,
  Assist,
  Steal,
  Block,
  Rebound,
  GoodContest,
  DribbleCombo, // combo no ritmo (2+)
  ExitBurst, // arranque de saída
  Miss,
  BadShot,
  Turnover,
  AllowedScore,
  ShotClockViolation,
}

/** Variação do medidor (fração da barra). Negativos contam como "jogada ruim" para encerrar o takeover. */
const Fill: Record<TakeoverEvent, number> = {
  [TakeoverEvent.Make]: 0.12,
  [TakeoverEvent.MakeThree]: 0.14,
  [TakeoverEvent.AndOne]: 0.18,
  [TakeoverEvent.Green]: 0.04,
  [TakeoverEvent.Assist]: 0.1,
  [TakeoverEvent.Steal]: 0.12,
  [TakeoverEvent.Block]: 0.12,
  [TakeoverEvent.Rebound]: 0.06,
  [TakeoverEvent.GoodContest]: 0.06,
  [TakeoverEvent.DribbleCombo]: 0.015,
  [TakeoverEvent.ExitBurst]: 0.02,
  [TakeoverEvent.Miss]: -0.06,
  [TakeoverEvent.BadShot]: -0.1,
  [TakeoverEvent.Turnover]: -0.15,
  [TakeoverEvent.AllowedScore]: -0.08,
  [TakeoverEvent.ShotClockViolation]: -0.15,
};

const ShotEvents = new Set([TakeoverEvent.Make, TakeoverEvent.MakeThree, TakeoverEvent.AndOne, TakeoverEvent.Green]);
const HandleEvents = new Set([TakeoverEvent.DribbleCombo, TakeoverEvent.ExitBurst]);

/** O takeover enche mais rápido com o tipo de jogada dele (arremessador com cestas, slasher com arranques). */
function groupScale(group: TakeoverGroup, event: TakeoverEvent): number {
  if (group === 'Shooting' && ShotEvents.has(event)) return 1.25;
  if ((group === 'Finishing' || group === 'Playmaking') && HandleEvents.has(event)) return 2;
  if (group === 'Defense' && (event === TakeoverEvent.Steal || event === TakeoverEvent.Block || event === TakeoverEvent.GoodContest)) return 1.25;
  return 1;
}

export interface TakeoverConfig {
  activeSeconds: number;
  teamActiveSeconds: number;
  strikesToEnd: number; // jogadas ruins que encerram o takeover ativo
  idleDrainPerSecond: number; // dreno sem ação (só fora do ativo)
  idleDrainDelay: number; // s sem evento antes do dreno começar
  teamShareOfGain: number; // no 1x1/treino: fração do ganho que vai para o medidor do time
}

export const defaultTakeoverConfig = (overrides: Partial<TakeoverConfig> = {}): TakeoverConfig => ({
  activeSeconds: 30,
  teamActiveSeconds: 45,
  strikesToEnd: 2,
  idleDrainPerSecond: 0.004,
  idleDrainDelay: 10,
  teamShareOfGain: 0.4,
  ...overrides,
});

export class TakeoverSlotState {
  fill = 0;
  active = false;
  timeLeft = 0;
}

export interface TakeoverChange {
  gained: boolean; // o medidor subiu (raio no HUD)
  activated: 'primary' | 'secondary' | 'team' | null;
  ended: boolean;
}

export class TakeoverMeter {
  readonly primary = new TakeoverSlotState();
  readonly secondary = new TakeoverSlotState();
  readonly team = new TakeoverSlotState();
  private strikes = 0;
  private idle = 0;

  constructor(
    public primaryId: TakeoverId = 'EasyBlowbys',
    public secondaryId: TakeoverId = 'LimitlessRange',
    public teamId: TakeoverId = 'TeamBadgeBoost',
    readonly config: TakeoverConfig = defaultTakeoverConfig(),
  ) {}

  isActive(id: TakeoverId): boolean {
    return (
      (this.primaryId === id && this.primary.active) ||
      (this.secondaryId === id && this.secondary.active) ||
      (this.teamId === id && this.team.active)
    );
  }

  /** Algum takeover aceso (anel do jogador e quadradinhos pegando fogo). */
  anyActive(): boolean {
    return this.primary.active || this.secondary.active || this.team.active;
  }

  apply(event: TakeoverEvent): TakeoverChange {
    const change: TakeoverChange = { gained: false, activated: null, ended: false };
    this.idle = 0;
    const base = Fill[event];
    const teamBoost = this.team.active && this.teamId === 'TeamTakeoverBoost' ? 1.25 : 1;

    if (base < 0) {
      if (this.primary.active) {
        this.strikes++;
        if (this.strikes >= this.config.strikesToEnd) {
          this.endPrimary();
          change.ended = true;
        }
      } else {
        this.primary.fill = clamp(this.primary.fill + base, 0, 1);
      }
      if (!this.team.active) this.team.fill = clamp(this.team.fill + base * 0.5, 0, 1);
      return change;
    }

    const gain = base * groupScale(Takeovers[this.primaryId].group, event) * teamBoost;
    if (!this.primary.active) {
      this.primary.fill = clamp(this.primary.fill + gain, 0, 1);
      change.gained = gain > 0;
      if (this.primary.fill >= 1) {
        this.primary.active = true;
        this.primary.timeLeft = this.config.activeSeconds;
        this.strikes = 0;
        change.activated = 'primary';
      }
    } else if (!this.secondary.active) {
      const secondaryGain = base * groupScale(Takeovers[this.secondaryId].group, event) * teamBoost;
      this.secondary.fill = clamp(this.secondary.fill + secondaryGain, 0, 1);
      change.gained = secondaryGain > 0;
      if (this.secondary.fill >= 1) {
        this.secondary.active = true;
        this.primary.timeLeft = Math.max(this.primary.timeLeft, this.config.activeSeconds * 0.5);
        change.activated = 'secondary';
      }
    }

    if (!this.team.active) {
      this.team.fill = clamp(this.team.fill + base * this.config.teamShareOfGain, 0, 1);
      if (this.team.fill >= 1) {
        this.team.active = true;
        this.team.timeLeft = this.config.teamActiveSeconds;
        change.activated = change.activated ?? 'team';
      }
    }
    return change;
  }

  update(dt: number): boolean {
    let ended = false;
    this.idle += dt;
    if (this.primary.active) {
      this.primary.timeLeft -= dt;
      // A barra cheia "queima" enquanto o takeover dura.
      this.primary.fill = clamp(this.primary.timeLeft / this.config.activeSeconds, 0, 1);
      if (this.primary.timeLeft <= 0) {
        this.endPrimary();
        ended = true;
      }
    } else if (this.idle > this.config.idleDrainDelay) {
      this.primary.fill = clamp(this.primary.fill - this.config.idleDrainPerSecond * dt, 0, 1);
    }
    if (this.team.active) {
      this.team.timeLeft -= dt;
      this.team.fill = clamp(this.team.timeLeft / this.config.teamActiveSeconds, 0, 1);
      if (this.team.timeLeft <= 0) {
        this.team.active = false;
        this.team.fill = 0;
        ended = true;
      }
    }
    return ended;
  }

  private endPrimary(): void {
    this.primary.active = false;
    this.primary.fill = 0;
    this.primary.timeLeft = 0;
    this.secondary.active = false;
    this.secondary.fill = 0;
    this.strikes = 0;
  }

  // ---------------------------------------------------------------- efeitos (Freestyle)

  /** Multiplicador do arranque de saída (Easy Blowbys). */
  burstScale(): number {
    return this.isActive('EasyBlowbys') ? 1.2 : 1;
  }
  speedScale(): number {
    return this.isActive('EasyBlowbys') ? 1.04 : 1;
  }
  /** Limitless Range: tira toda a penalidade de distância (até o logo). */
  removesDeepPenalty(): boolean {
    return this.isActive('LimitlessRange');
  }
  /** Pontos percentuais extras num arremesso bem cronometrado (Pull-Up / Spot-Up Precision). */
  precisionBonusPp(offDribble: boolean, wellTimed: boolean): number {
    if (!wellTimed) return 0;
    if (offDribble && this.isActive('PullUpPrecision')) return 6;
    if (!offDribble && this.isActive('SpotUpPrecision')) return 6;
    return 0;
  }
  /** Team Badge Boost: badges +1 nível. */
  badgeTierBoost(): number {
    return this.isActive('TeamBadgeBoost') ? 1 : 0;
  }
}
