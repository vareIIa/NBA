// Protocolo do multiplayer (docs/24-multiplayer.md): o que cliente e servidor trocam pelo WebSocket. Um único endpoint
// (/ws), quadros de texto JSON {t, ...}. Este arquivo não importa nada: o servidor de desenvolvimento (Node, sem
// bundler) e o Worker da Cloudflare usam o mesmo arquivo do jogo.
//
// Quem manda em quê (netcode do 1x1):
//   - Cada cliente simula o PRÓPRIO jogador (sem atraso no controle; o timing do arremesso é julgado no cliente, docs/03 §9)
//     e manda o estado dele ~20 vezes por segundo ('st', que o servidor só repassa ao oponente).
//   - A bola é do dono da posse: driblando, no voo e solta depois do arremesso, quem a simula é o cliente do atacante.
//   - O servidor é o juiz: placar, posse, check-ball, relógio de posse, rebote (o primeiro pedido válido leva), roubo
//     (sorteado aqui, src/net/defense.ts), toco, vitória, queda de conexão e revanche.

/**
 * 2: defesa (roubo, toco, contestação com o estado do defensor) e cartão com os ratings de defesa.
 * 3: canal direto entre os jogadores (sinalização 'rtc', 'st' com número r nos quadros com comando; src/net/PeerLink.ts).
 */
export const ProtocolVersion = 3;
export const WsPath = '/ws';
/** Porta do servidor de desenvolvimento (web/server/dev.ts). */
export const DevServerPort = 8790;
/** Maior quadro aceito (bytes). */
export const MaxFrameBytes = 64 * 1024;

/** Lugar na sala: 0 = quem criou (ou o primeiro da fila), 1 = convidado. */
export type Side = 0 | 1;
export const otherSide = (s: Side): Side => (s === 0 ? 1 : 0);

/** Cartão do jogador (o que o oponente vê no lobby e o que o jogo precisa para montar o boneco dele). */
export interface PlayerCard {
  name: string;
  heightCm: number;
  /** Envergadura além do modelo, em m (o 2º argumento de PlayerAnimator.setBodyScale). */
  wingspanOverM: number;
  /** Envergadura total (cm), para a contestação. */
  wingspanCm: number;
  overall: number;
  archetype: string;
  /** Sigla da posição (PG, SG...). */
  position: string;
  /** Defesa de perímetro (25–99): entra na contestação. */
  perimeterDefense: number;
  /** Roubo, toco, impulsão e controle de bola (25–99): roubo e toco (src/net/defense.ts). Sem o campo, 60. */
  steal?: number;
  block?: number;
  vertical?: number;
  ballHandle?: number;
  /** Níveis (0 = sem, 1–4 = Bronze–HOF) dos badges de roubo: Glove do defensor e Unpluckable do atacante. */
  glove?: number;
  unpluckable?: number;
}

/** Regras da partida (docs/10-modos.md: 1x1 de rua até 11, cestas de 1 e 2). */
export interface MatchRules {
  /** Pontos para vencer. */
  target: number;
  /** Precisa de 2 pontos de vantagem. */
  winByTwo: boolean;
  /** Quem marca continua com a bola. */
  makeItTakeIt: boolean;
  /** Depois do rebote defensivo a bola precisa sair da linha de 3 antes de valer cesta. */
  clearBall: boolean;
  /** Pontos da cesta de dentro e de fora da linha de 3. */
  insidePoints: number;
  outsidePoints: number;
  /** Relógio de posse (s); 0 = sem relógio. */
  shotClock: number;
}

export const DefaultRules: MatchRules = {
  target: 11,
  winByTwo: false,
  makeItTakeIt: false,
  clearBall: true,
  insidePoints: 1,
  outsidePoints: 2,
  shotClock: 24,
};

/**
 * Fase da partida:
 *   check  = jogadores parados nos lugares do check-ball, contagem até a bola ficar viva;
 *   live   = bola em jogo;
 *   dead   = depois de cesta ou violação, a pausa curta (comemoração) antes do próximo check;
 *   paused = oponente caiu, esperando ele voltar;
 *   over   = acabou.
 */
export type MatchPhase = 'check' | 'live' | 'dead' | 'paused' | 'over';

/** held = na mão do atacante; air = arremesso no ar; loose = solta (rebote). */
export type BallStatus = 'held' | 'air' | 'loose';

export type MatchEvent =
  | { kind: 'start'; offense: Side }
  | { kind: 'score'; side: Side; points: number; isThree: boolean }
  | { kind: 'noClear'; side: Side } // cesta sem limpar a bola: não vale, a bola troca
  | { kind: 'miss'; side: Side }
  | { kind: 'rebound'; side: Side; offensive: boolean }
  | { kind: 'steal'; side: Side } // side = quem roubou (a posse troca como num rebote defensivo)
  | { kind: 'block'; side: Side } // side = quem deu o toco (a bola fica solta)
  | { kind: 'cleared'; side: Side }
  | { kind: 'shotClock'; side: Side } // estouro do relógio de posse
  | { kind: 'deadBall'; side: Side } // bola solta sem dono por tempo demais: volta para a defesa
  | { kind: 'over'; winner: Side; reason: 'score' | 'forfeit' }
  | { kind: 'paused'; side: Side } // side = quem caiu
  | { kind: 'resumed' };

export interface MatchState {
  phase: MatchPhase;
  /** Fim da contagem desta fase (ms do relógio do servidor); 0 = sem contagem. */
  phaseEndsAt: number;
  score: [number, number];
  /** Quem ataca (ou atacou por último, com a bola solta). */
  offense: Side;
  ball: BallStatus;
  /** Quem arremessou por último (rebote ofensivo x defensivo). */
  shooter: Side | null;
  /** O ataque ainda precisa limpar a bola (levar para fora da linha de 3). */
  needsClear: boolean;
  /** Relógio de posse: ms restantes no instante clockAt (relógio do servidor); corre só com clockRunning. */
  clockMs: number;
  clockAt: number;
  clockRunning: boolean;
  /** Sobe a cada troca de posse ou novo check: relatos de outra posse são ignorados. */
  seq: number;
  winner: Side | null;
}

/** ms restantes no relógio de posse, no instante serverNow. */
export function shotClockLeft(state: MatchState, serverNow: number): number {
  if (!state.clockRunning) return state.clockMs;
  return Math.max(0, state.clockMs - (serverNow - state.clockAt));
}

export interface RoomPlayer {
  side: Side;
  card: PlayerCard;
  ready: boolean;
  connected: boolean;
}

export interface RoomInfo {
  code: string;
  /** Sala da partida rápida (sem código para convidar, começa sozinha). */
  quick: boolean;
  rules: MatchRules;
  players: RoomPlayer[];
  /** Partida em andamento ou terminada nesta sala. */
  inMatch: boolean;
  /** Pedido de revanche de cada lado. */
  rematch: [boolean, boolean];
}

// ---------------------------------------------------------------- cliente → servidor

export type ClientMsg =
  | { t: 'hello'; v: number; card: PlayerCard; token?: string }
  | { t: 'ping'; c: number }
  /** Sinalização do canal direto com o oponente (src/net/PeerLink.ts): o servidor repassa ao outro da sala sem ler. */
  | { t: 'rtc'; d: unknown }
  | { t: 'queue.join' }
  | { t: 'queue.leave' }
  | { t: 'room.create'; rules?: Partial<MatchRules> }
  | { t: 'room.join'; code: string }
  | { t: 'room.leave' }
  | { t: 'room.ready'; ready: boolean }
  | { t: 'room.rules'; rules: Partial<MatchRules> }
  | { t: 'room.rematch'; want: boolean }
  /**
   * Estado do próprio jogador para o oponente (o servidor não lê, só repassa). r = número de sequência de quem manda,
   * só nos quadros com comando de animação: quem recebe entrega esses em ordem e uma vez só (src/net/PeerLink.ts).
   */
  | { t: 'st'; d: unknown; r?: number }
  /** O atacante soltou o arremesso (o relógio de posse para). */
  | { t: 'g.release'; seq: number }
  /** O arremesso resolveu: primeiro toque da bola no chão, ou um erro que já não entra (caindo abaixo do aro sem cesta). */
  | { t: 'g.result'; seq: number; scored: boolean; isThree: boolean }
  /** O arremesso tomou toco (o cliente do arremessador decide na soltura): a bola fica solta já. */
  | { t: 'g.block'; seq: number }
  /** Tapa do defensor na bola. exp = exposição da bola que ele viu (0..1); o juiz sorteia. */
  | { t: 'g.steal'; seq: number; exp: number }
  /** Pedido da bola solta (rebote). at = onde o cliente viu a bola (núcleo, m). */
  | { t: 'g.claim'; seq: number; at: [number, number, number] }
  /** O atacante levou a bola para fora da linha de 3. */
  | { t: 'g.cleared'; seq: number };

// ---------------------------------------------------------------- servidor → cliente

export type ErrorCode =
  | 'version'
  | 'bad_message'
  | 'not_hello'
  | 'room_not_found'
  | 'room_full'
  | 'in_room'
  | 'in_match'
  | 'not_host'
  | 'rate_limit'
  | 'replaced';

export type ServerMsg =
  | { t: 'welcome'; id: string; token: string; serverTime: number }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'queue'; waiting: boolean; players: number }
  | { t: 'room'; room: RoomInfo; you: Side }
  | { t: 'room.left' }
  /** A partida começou (ou recomeçou na revanche, ou você voltou depois de cair). */
  | { t: 'match.start'; room: RoomInfo; you: Side; state: MatchState; serverTime: number }
  | { t: 'match.state'; state: MatchState; event: MatchEvent | null; serverTime: number }
  | { t: 'opponent'; connected: boolean; graceEndsAt: number }
  /** Estado do oponente, como ele mandou (r: ver o 'st' do cliente). */
  | { t: 'st'; d: unknown; r?: number }
  | { t: 'rtc'; d: unknown };

/** Alfabeto do código da sala: sem 0/O nem 1/I/L (ditado por voz ou lido num print sem confusão). */
export const RoomCodeAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RoomCodeLength = 4;

/** Normaliza o que o jogador digitou (minúsculas, espaços, traço). null se não for um código possível. */
export function normalizeRoomCode(text: string): string | null {
  const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== RoomCodeLength) return null;
  for (const ch of code) if (!RoomCodeAlphabet.includes(ch)) return null;
  return code;
}
