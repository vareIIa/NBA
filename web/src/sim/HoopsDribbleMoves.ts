// Porte de HoopsDribbleMoves.h/.cpp.
// Dribles no modelo do jogo de referência (docs/05-gameplay-ataque.md §2): gesto do Pro Stick → movimento, com fases
// (commit curto, janela de combo no fim, buffer de 150 ms), troca de mão e ENERGIA (stamina).
// Ramificação (docs/17 §4.4, P0-8): misdirection antes do 1º quique e arranque na saída do movimento.
// Sem Explosões/Adrenaline Boosts (decisão D13 do diretor): o único limitador é a barra de energia.
// Sem animação aqui: o núcleo diz QUAL movimento, QUANDO e com que impulso; o jogo escolhe o clipe.
import { clamp, lerp } from './HoopsMath';
import { StickDir, type StickGesture, StickGestureKind, mirrorDir } from './HoopsProStick';

export enum BallHand {
  Right,
  Left,
}

export const otherHand = (hand: BallHand): BallHand => (hand === BallHand.Right ? BallHand.Left : BallHand.Right);

export enum DribbleMove {
  None,
  Crossover,
  AttackingCrossover,
  BetweenLegs,
  BehindBack,
  Hesitation,
  EscapeHesitation,
  InAndOut,
  StepBack,
  EscapeStepBack,
  Spin,
  HalfSpin,
  DoubleCross, // double throw
  HesiCross, // switchback
  Retreat,
  Count,
}

export interface DribbleMoveSpec {
  readonly duration: number; // s (com playrate 1)
  readonly commitSeconds: number; // não cancela antes disso
  readonly comboWindow: number; // últimos X s: input aqui = combo com ritmo
  readonly handSwitches: number; // 0, 1 ou 2 (2 = volta à mesma mão)
  readonly lateralSpeed: number; // m/s para o lado da NOVA mão (negativo = lado oposto)
  readonly forwardSpeed: number; // m/s para frente (negativo = para trás)
  readonly energyCost: number; // fração da barra
  readonly exposure: number; // exposição da bola a roubo (0..1) durante o movimento
  readonly exitBurst: number; // m/s extras no arranque de saída (speedboost / cross launch)
}

function makeSpec(
  duration: number,
  commit: number,
  switches: number,
  lateral: number,
  forward: number,
  energy: number,
  exposure: number,
  exitBurst: number,
): DribbleMoveSpec {
  return {
    duration,
    commitSeconds: commit,
    comboWindow: 0.15,
    handSwitches: switches,
    lateralSpeed: lateral,
    forwardSpeed: forward,
    energyCost: energy,
    exposure,
    exitBurst,
  };
}

// Arranque (m/s extras na saída): crossovers e escapes lançam mais; step-back/retreat recuam e lançam pouco.
// prettier-ignore
const Specs: Record<Exclude<DribbleMove, DribbleMove.Count>, DribbleMoveSpec> = {
  //                                                  dur   commit sw  lat   fwd   energia  expos. arranque
  [DribbleMove.None]:               makeSpec(0.00, 0.00, 0, 0.0,  0.0,  0.000, 0.2,  0.0),
  [DribbleMove.Crossover]:          makeSpec(0.40, 0.12, 1, 2.2,  0.0,  0.025, 0.8,  1.4),
  [DribbleMove.AttackingCrossover]: makeSpec(0.42, 0.15, 1, 2.6,  2.2,  0.045, 0.7,  1.8),
  [DribbleMove.BetweenLegs]:        makeSpec(0.42, 0.12, 1, 1.2,  0.0,  0.025, 0.3,  1.1),
  [DribbleMove.BehindBack]:         makeSpec(0.45, 0.15, 1, 1.8,  0.0,  0.030, 0.3,  1.3),
  [DribbleMove.Hesitation]:         makeSpec(0.40, 0.08, 0, 0.0, -0.6,  0.015, 0.5,  1.2),
  [DribbleMove.EscapeHesitation]:   makeSpec(0.42, 0.10, 0, 0.0,  3.0,  0.045, 0.5,  1.8),
  [DribbleMove.InAndOut]:           makeSpec(0.38, 0.10, 0, -1.5, 0.0,  0.020, 0.6,  1.4),
  [DribbleMove.StepBack]:           makeSpec(0.50, 0.20, 0, 0.0, -3.2,  0.040, 0.4,  0.6),
  [DribbleMove.EscapeStepBack]:     makeSpec(0.50, 0.20, 0, 0.0, -3.6,  0.050, 0.4,  0.9),
  [DribbleMove.Spin]:               makeSpec(0.60, 0.25, 1, 0.0,  2.4,  0.045, 0.4,  1.3),
  [DribbleMove.HalfSpin]:           makeSpec(0.45, 0.18, 1, 0.0,  1.8,  0.030, 0.4,  1.0),
  [DribbleMove.DoubleCross]:        makeSpec(0.70, 0.15, 2, 1.5,  0.0,  0.040, 0.8,  1.5),
  [DribbleMove.HesiCross]:          makeSpec(0.60, 0.12, 1, 2.4,  0.0,  0.040, 0.7,  1.7),
  [DribbleMove.Retreat]:            makeSpec(0.45, 0.10, 0, 0.0, -2.0,  0.015, 0.3,  0.6),
};

export function getDribbleMoveSpec(move: DribbleMove): DribbleMoveSpec {
  return Specs[move as Exclude<DribbleMove, DribbleMove.Count>] ?? Specs[DribbleMove.None];
}

const MoveLabels: Record<DribbleMove, string> = {
  [DribbleMove.None]: '-',
  [DribbleMove.Crossover]: 'Crossover',
  [DribbleMove.AttackingCrossover]: 'Crossover de ataque',
  [DribbleMove.BetweenLegs]: 'Entre as pernas',
  [DribbleMove.BehindBack]: 'Por trás',
  [DribbleMove.Hesitation]: 'Hesitação',
  [DribbleMove.EscapeHesitation]: 'Escape (hesitação)',
  [DribbleMove.InAndOut]: 'In-and-out',
  [DribbleMove.StepBack]: 'Step-back',
  [DribbleMove.EscapeStepBack]: 'Escape (step-back)',
  [DribbleMove.Spin]: 'Spin',
  [DribbleMove.HalfSpin]: 'Half-spin',
  [DribbleMove.DoubleCross]: 'Double cross',
  [DribbleMove.HesiCross]: 'Hesi-cross',
  [DribbleMove.Retreat]: 'Retreat',
  [DribbleMove.Count]: '?',
};
export const dribbleMoveLabel = (move: DribbleMove): string => MoveLabels[move] ?? '?';

export interface DribbleContext {
  hand: BallHand;
  sprint: boolean; // RT segurado
  moving: boolean;
}

export const makeDribbleContext = (overrides: Partial<DribbleContext> = {}): DribbleContext => ({
  hand: BallHand.Right,
  sprint: false,
  moving: false,
  ...overrides,
});

/** Direção relativa à mão da bola: tudo é resolvido como se a bola estivesse na mão direita. */
const toBallHandFrame = (dir: StickDir, hand: BallHand): StickDir => (hand === BallHand.Right ? dir : mirrorDir(dir));

const switchesHand = (move: DribbleMove): boolean => getDribbleMoveSpec(move).handSwitches % 2 === 1;

const isComboGesture = (gesture: StickGesture): boolean =>
  gesture.kind === StickGestureKind.DoubleThrow || gesture.kind === StickGestureKind.Switchback;

/**
 * Traduz um gesto (orientação absoluta) no movimento do jogo de referência. Retorna None se o gesto não é drible
 * (ex.: Hold para baixo = arremesso pelo Pro Stick, tratado fora daqui).
 */
export function resolveDribbleMove(gesture: StickGesture, context: DribbleContext): DribbleMove {
  const dir = toBallHandFrame(gesture.dir, context.hand);
  switch (gesture.kind) {
    case StickGestureKind.Rotation:
      return DribbleMove.Spin;
    case StickGestureKind.QuarterCircle:
      return DribbleMove.HalfSpin;
    case StickGestureKind.DoubleThrow:
      return DribbleMove.DoubleCross;
    case StickGestureKind.Switchback:
      return DribbleMove.HesiCross;
    case StickGestureKind.Flick:
      switch (dir) {
        case StickDir.Up:
        case StickDir.UpLeft:
          return context.sprint ? DribbleMove.AttackingCrossover : DribbleMove.Crossover;
        case StickDir.Left:
          return DribbleMove.BetweenLegs;
        case StickDir.DownLeft:
          return DribbleMove.BehindBack;
        case StickDir.Right:
          return context.sprint ? DribbleMove.EscapeHesitation : DribbleMove.Hesitation;
        case StickDir.UpRight:
          return DribbleMove.InAndOut;
        case StickDir.Down:
          return context.sprint ? DribbleMove.EscapeStepBack : DribbleMove.StepBack;
        case StickDir.DownRight:
          return DribbleMove.Retreat;
      }
      return DribbleMove.None;
    case StickGestureKind.Hold:
    case StickGestureKind.HoldRelease:
      return DribbleMove.None; // Hold = arremesso/bandeja pelo Pro Stick (fora do drible)
  }
  return DribbleMove.None;
}

export interface DribbleEnergyConfig {
  sprintDrainPerSecond: number; // ~12 s de sprint esvaziam a barra
  regenPerSecond: number; // parado: ~10 s para encher
  movingRegenScale: number; // andando/correndo sem sprint: recupera pela metade
  comboEnergyDiscount: number; // combo no ritmo gasta menos
  comboPlayRate: number; // combo no ritmo é mais rápido
  inputBufferSeconds: number;
  lowEnergyThreshold: number; // abaixo disso a energia começa a pesar
  lowEnergyMinSpeedScale: number; // velocidade com a barra vazia
  lowEnergyMinMovePlayRate: number; // dribles mais lentos com a barra vazia
  infiniteEnergy: boolean; // opção de treino do Freestyle

  // Misdirection (docs/17 §4.4): até o 1º quique, um gesto que leva a bola para o lado oposto troca o
  // movimento na hora (a bola nem chega a trocar de mão). Um por movimento; o resto vai para o buffer.
  misdirectionWindowScale: number; // janela = commitSeconds × isto (o commit acaba no 1º quique)
  misdirectionNeedsSprint: boolean; // true = variante mais nova (só com RT segurado)

  // Arranque na saída do movimento (speedboost / cross launch): LS apontado quando o movimento acaba.
  // Pago com energia, sem contador de boosts (D13).
  exitBurstWindowSeconds: number; // o LS pode apontar até X s depois do fim do movimento
  exitBurstMinStick: number; // LS pelo menos pela metade
  exitBurstHoldSeconds: number; // velocidade extra cheia (1º passo)...
  exitBurstFadeSeconds: number; // ...e depois cai até zero (2º passo)
  speedboostScale: number; // sair para o lado da bola ou em frente (estilo de drible, docs/05 §2.3)
  crossLaunchScale: number; // sair para o lado da nova mão depois de uma troca de mão
  againstMoveBurstScale: number; // sair contra o movimento (para trás ou para o lado da mão livre)
  exitBurstEnergyPerMps: number; // fração da barra por m/s de arranque
  lowEnergyMinBurstScale: number; // arranque com a barra vazia (abaixo de 40% começa a cair)
}

export const defaultDribbleEnergyConfig = (overrides: Partial<DribbleEnergyConfig> = {}): DribbleEnergyConfig => ({
  sprintDrainPerSecond: 0.08,
  regenPerSecond: 0.1,
  movingRegenScale: 0.5,
  comboEnergyDiscount: 0.8,
  comboPlayRate: 1.15,
  inputBufferSeconds: 0.15,
  lowEnergyThreshold: 0.4,
  lowEnergyMinSpeedScale: 0.82,
  lowEnergyMinMovePlayRate: 0.85,
  infiniteEnergy: false,
  misdirectionWindowScale: 1.0,
  misdirectionNeedsSprint: false,
  exitBurstWindowSeconds: 0.2,
  exitBurstMinStick: 0.5,
  exitBurstHoldSeconds: 0.15,
  exitBurstFadeSeconds: 0.3,
  speedboostScale: 1.0,
  crossLaunchScale: 1.0,
  againstMoveBurstScale: 0.5,
  exitBurstEnergyPerMps: 0.012,
  lowEnergyMinBurstScale: 0.4,
  ...overrides,
});

/** Gesto lido pelo controlador: qual movimento e se ele troca o atual antes do 1º quique. */
export interface DribbleIntent {
  move: DribbleMove;
  redirect: boolean;
}

export enum ExitBurstKind {
  None,
  Speedboost, // saiu para o lado da bola (sem troca de mão) ou em frente
  CrossLaunch, // saiu para o lado da nova mão depois de uma troca (crossover, entre as pernas, spin...)
  AgainstMove, // saiu contra o movimento: arranque menor
}

const BurstLabels: Record<ExitBurstKind, string> = {
  [ExitBurstKind.None]: '-',
  [ExitBurstKind.Speedboost]: 'speedboost',
  [ExitBurstKind.CrossLaunch]: 'cross launch',
  [ExitBurstKind.AgainstMove]: 'contra o movimento',
};
export const exitBurstKindLabel = (kind: ExitBurstKind): string => BurstLabels[kind] ?? '?';

export class DribbleExitBurst {
  kind = ExitBurstKind.None;
  fromMove = DribbleMove.None;
  dirX = 0; // direção (unitária) no referencial do ataque: X = direita, Y = para a cesta
  dirY = 0;
  speed = 0; // m/s extras no início (depois cai até zero)
  startTime = 0;
  energyCost = 0; // fração da barra que custou

  isValid(): boolean {
    return this.kind !== ExitBurstKind.None && this.speed > 0;
  }
}

export class ActiveDribbleMove {
  move = DribbleMove.None;
  startTime = 0;
  playRate = 1;
  inRhythm = false; // entrou na janela de combo do anterior
  handAtStart = BallHand.Right;
  redirected = false; // misdirection: trocou outro movimento antes do 1º quique
  redirectedFrom = DribbleMove.None;

  endTime(): number {
    const rate = this.playRate > 1e-6 ? this.playRate : 1;
    return this.startTime + getDribbleMoveSpec(this.move).duration / rate;
  }
  isActive(now: number): boolean {
    return this.move !== DribbleMove.None && now < this.endTime();
  }
}

/**
 * Multiplicadores externos (badges, takeover) aplicados por cima da configuração. 1 = sem efeito. Ficam fora do
 * DribbleEnergyConfig porque mudam durante a partida (badge que ativa, takeover que acende).
 */
export interface DribbleModifiers {
  moveEnergyScale: number; // custo de energia dos dribles (Handles for Days)
  burstEnergyScale: number; // custo de energia do arranque de saída
  sprintDrainScale: number; // gasto do sprint
  movePlayRate: number; // velocidade dos dribles (Killer Combos, Hyperdrive...)
  burstScale: number; // força do arranque de saída (Quick First Step)
  speedScale: number; // velocidade máxima com a bola
}

export const neutralDribbleModifiers = (): DribbleModifiers => ({
  moveEnergyScale: 1,
  burstEnergyScale: 1,
  sprintDrainScale: 1,
  movePlayRate: 1,
  burstScale: 1,
  speedScale: 1,
});

export class DribbleController {
  private readonly config: DribbleEnergyConfig;
  /** Badges/takeover: trocados a cada quadro por quem conhece o jogador. */
  modifiers: DribbleModifiers = neutralDribbleModifiers();
  private active = new ActiveDribbleMove();
  private buffered = DribbleMove.None;
  private bufferedTime = -1000;
  private hand = BallHand.Right;
  private energy = 1;
  private comboCount = 0;
  private lastMove = DribbleMove.None;
  private lastMoveEndTime = -1000;
  private exitMove = DribbleMove.None; // movimento que acabou e ainda pode dar o arranque
  private exitTime = -1000;
  private exitBurst = new DribbleExitBurst();

  constructor(config: DribbleEnergyConfig = defaultDribbleEnergyConfig()) {
    this.config = config;
  }

  getActive(): ActiveDribbleMove {
    return this.active;
  }
  isMoveActive(now: number): boolean {
    return this.active.isActive(now);
  }
  getHand(): BallHand {
    return this.hand;
  }
  setHand(hand: BallHand): void {
    this.hand = hand;
  }
  getEnergy(): number {
    return this.energy;
  }
  setEnergy(energy: number): void {
    this.energy = clamp(energy, 0, 1);
  }
  getExitBurst(): DribbleExitBurst {
    return this.exitBurst;
  }
  getComboCount(): number {
    return this.comboCount;
  }
  /** Último movimento terminado (para escolher o tipo de arremesso: step-back jumper, spin jumper...). */
  getLastMove(): DribbleMove {
    return this.lastMove;
  }
  getLastMoveEndTime(): number {
    return this.lastMoveEndTime;
  }

  /** Pode sair do movimento atual para arremesso/passe (depois do commit)? */
  canCancel(now: number): boolean {
    if (!this.active.isActive(now)) {
      return true;
    }
    const rate = this.active.playRate > 1e-6 ? this.active.playRate : 1;
    return now >= this.active.startTime + getDribbleMoveSpec(this.active.move).commitSeconds / rate;
  }

  /** Ainda dá para trocar o movimento atual (misdirection, antes do 1º quique)? */
  canRedirect(now: number): boolean {
    if (!this.active.isActive(now) || this.active.redirected) {
      return false; // uma misdirection por movimento: a troca não pode ser trocada de novo
    }
    const rate = this.active.playRate > 1e-6 ? this.active.playRate : 1;
    const window = (getDribbleMoveSpec(this.active.move).commitSeconds * this.config.misdirectionWindowScale) / rate;
    return now < this.active.startTime + window;
  }

  private isMisdirection(move: DribbleMove): boolean {
    // "Direção oposta" = o novo movimento, a partir da mesma mão, termina com a bola do outro lado.
    return (
      move !== DribbleMove.None && this.active.move !== DribbleMove.None && switchesHand(move) !== switchesHand(this.active.move)
    );
  }

  /**
   * Lê um gesto do Pro Stick na mão certa (context.hand é ignorado: a mão vem do controlador). Na janela de
   * misdirection o gesto é lido a partir da mão do início do movimento (a bola ainda não quicou): se ele leva a
   * bola para o lado oposto, ou é um combo (double throw/switchback), redirect = true.
   */
  resolveGesture(gesture: StickGesture, context: DribbleContext, now: number): DribbleIntent {
    const local: DribbleContext = { ...context };
    // Giro de um toque que já saiu como flick na borda (o stick parou na zona ativa e depois girou): se o drible desse
    // flick já começou, o giro o troca antes do 1º quique; depois disso é descartado (um toque não vira dois dribles).
    const turning = gesture.kind === StickGestureKind.Rotation || gesture.kind === StickGestureKind.QuarterCircle;
    if (turning && gesture.afterEarlyFlick && this.active.isActive(now) && this.active.startTime >= gesture.startTime) {
      if (!this.canRedirect(now)) return { move: DribbleMove.None, redirect: false };
      local.hand = this.active.handAtStart;
      return { move: resolveDribbleMove(gesture, local), redirect: true };
    }
    if (this.canRedirect(now)) {
      // A bola ainda não quicou: o gesto é lido a partir da mão do início do movimento.
      local.hand = this.active.handAtStart;
      const candidate = resolveDribbleMove(gesture, local);
      // Combo (double throw/switchback) chega junto com o 2º toque: é o mesmo toque lido como combo, então
      // substitui o movimento que acabou de começar (não precisa de RT nem de lado oposto).
      const combo = isComboGesture(gesture) && candidate !== this.active.move;
      const misdirection = (context.sprint || !this.config.misdirectionNeedsSprint) && this.isMisdirection(candidate);
      if (candidate !== DribbleMove.None && (combo || misdirection)) {
        return { move: candidate, redirect: true };
      }
    }
    // Fora da janela (ou para o mesmo lado): lido na mão atual; vai para o buffer ou encadeia como sempre.
    local.hand = this.hand;
    return { move: resolveDribbleMove(gesture, local), redirect: false };
  }

  private start(move: DribbleMove, now: number, inRhythm: boolean): void {
    const spec = getDribbleMoveSpec(move);
    const a = this.active;
    a.move = move;
    a.startTime = now;
    a.inRhythm = inRhythm;
    a.playRate = (inRhythm ? this.config.comboPlayRate : 1) * this.movePlayRateScale();
    a.handAtStart = this.hand;
    a.redirected = false;
    a.redirectedFrom = DribbleMove.None;

    // Um novo drible fecha a saída do anterior e corta o arranque que estiver rolando.
    this.exitMove = DribbleMove.None;
    this.exitBurst = new DribbleExitBurst();

    this.comboCount = inRhythm ? this.comboCount + 1 : 1;
    if (!this.config.infiniteEnergy) {
      this.energy = clamp(
        this.energy - spec.energyCost * (inRhythm ? this.config.comboEnergyDiscount : 1) * this.modifiers.moveEnergyScale,
        0,
        1,
      );
    }
    if (spec.handSwitches % 2 === 1) {
      this.hand = otherHand(this.hand);
    }
  }

  private redirect(move: DribbleMove, now: number): void {
    // Misdirection: o movimento atual some antes do 1º quique. A bola não chegou a trocar de mão, o ritmo e o
    // combo continuam os do movimento trocado, e a energia do fingido já foi gasta (paga os dois).
    const from = this.active.move;
    const inRhythm = this.active.inRhythm;
    const combo = this.comboCount;
    this.hand = this.active.handAtStart;
    this.buffered = DribbleMove.None; // a troca é o input mais novo
    this.start(move, now, inRhythm);
    this.comboCount = combo;
    this.active.redirected = true;
    this.active.redirectedFrom = from;
  }

  /**
   * Pede um movimento. Se o atual ainda está no commit, guarda no buffer (150 ms). Retorna true se começou agora.
   * redirect (vindo de resolveGesture): troca o movimento atual na hora, sem esperar o commit.
   */
  request(move: DribbleMove, now: number, redirect = false): boolean {
    if (move === DribbleMove.None) {
      return false;
    }

    // Misdirection/combo antes do 1º quique: troca na hora. Se a janela já fechou (não acontece quando o pedido
    // vem de resolveGesture no mesmo instante), segue o caminho normal para não "comer" o input.
    if (redirect && this.canRedirect(now) && move !== this.active.move) {
      this.redirect(move, now);
      return true;
    }

    if (!this.active.isActive(now)) {
      // Ritmo: o input caiu logo depois do fim do anterior (dentro da janela) também conta.
      const inRhythm =
        this.lastMove !== DribbleMove.None && now - this.lastMoveEndTime <= getDribbleMoveSpec(this.lastMove).comboWindow;
      this.start(move, now, inRhythm);
      return true;
    }

    if (!this.canCancel(now)) {
      this.buffered = move;
      this.bufferedTime = now;
      return false;
    }

    // Depois do commit: cancela no próximo. Na janela de combo do fim = combo no ritmo.
    const comboStart = this.active.endTime() - getDribbleMoveSpec(this.active.move).comboWindow;
    const inRhythm = now >= comboStart;
    this.lastMove = this.active.move;
    this.lastMoveEndTime = now;
    this.start(move, now, inRhythm);
    return true;
  }

  /** Avança o tempo: termina movimentos, consome buffer, gasta/regenera energia. */
  update(now: number, deltaSeconds: number, sprinting: boolean, moving = false): void {
    if (this.active.move !== DribbleMove.None && now >= this.active.endTime()) {
      this.lastMove = this.active.move;
      this.lastMoveEndTime = this.active.endTime();
      this.exitMove = this.active.move; // terminou sem encadear: abre a janela do arranque de saída
      this.exitTime = this.lastMoveEndTime;
      this.active.move = DribbleMove.None;
    }

    if (this.buffered !== DribbleMove.None) {
      if (now - this.bufferedTime > this.config.inputBufferSeconds) {
        this.buffered = DribbleMove.None; // expirou
      } else if (this.canCancel(now)) {
        const next = this.buffered;
        this.buffered = DribbleMove.None;
        this.request(next, now);
      }
    }

    if (this.config.infiniteEnergy) {
      this.energy = 1;
    } else if (sprinting) {
      this.energy = clamp(this.energy - this.config.sprintDrainPerSecond * this.modifiers.sprintDrainScale * deltaSeconds, 0, 1);
    } else if (!this.active.isActive(now)) {
      const regen = this.config.regenPerSecond * (moving ? this.config.movingRegenScale : 1);
      this.energy = clamp(this.energy + regen * deltaSeconds, 0, 1);
    }
  }

  resetPossession(): void {
    this.active = new ActiveDribbleMove();
    this.buffered = DribbleMove.None;
    this.comboCount = 0;
    this.exitMove = DribbleMove.None;
    this.exitBurst = new DribbleExitBurst();
  }

  private lowEnergyScale(minScale: number): number {
    const threshold = this.config.lowEnergyThreshold;
    if (this.energy >= threshold || threshold <= 0) {
      return 1;
    }
    return lerp(minScale, 1, this.energy / threshold);
  }

  /** Efeito da energia baixa na velocidade máxima. */
  speedScale(): number {
    return this.lowEnergyScale(this.config.lowEnergyMinSpeedScale) * this.modifiers.speedScale;
  }
  /** Efeito da energia baixa na velocidade dos dribles. */
  movePlayRateScale(): number {
    return this.lowEnergyScale(this.config.lowEnergyMinMovePlayRate) * this.modifiers.movePlayRate;
  }
  exitBurstEnergyScale(): number {
    return this.lowEnergyScale(this.config.lowEnergyMinBurstScale);
  }

  /**
   * Arranque na saída: chamar a cada frame com o LS no referencial do ataque (X = direita, Y = para a cesta,
   * módulo 0..1). Dispara uma vez por movimento terminado, se o LS apontar dentro da janela, e cobra a energia.
   */
  tryExitBurst(now: number, stickX: number, stickY: number): DribbleExitBurst {
    const result = new DribbleExitBurst();
    if (this.exitMove === DribbleMove.None || this.active.isActive(now)) {
      return result;
    }
    if (now - this.exitTime > this.config.exitBurstWindowSeconds) {
      this.exitMove = DribbleMove.None; // saiu do movimento sem apontar o LS a tempo
      return result;
    }
    const magnitude = Math.sqrt(stickX * stickX + stickY * stickY);
    if (magnitude < this.config.exitBurstMinStick || magnitude <= 1e-9) {
      return result; // ainda pode apontar dentro da janela
    }

    const spec = getDribbleMoveSpec(this.exitMove);
    result.fromMove = this.exitMove;
    result.dirX = stickX / magnitude;
    result.dirY = stickY / magnitude;

    // Lado "natural" da saída = o lado da mão da bola depois do movimento (a nova mão num crossover).
    const ballSide = this.hand === BallHand.Right ? 1 : -1;
    const against = result.dirY < -0.5 || result.dirX * ballSide < -0.5;
    let kindScale = this.config.speedboostScale;
    if (against) {
      result.kind = ExitBurstKind.AgainstMove;
      kindScale = this.config.againstMoveBurstScale;
    } else if (switchesHand(this.exitMove)) {
      result.kind = ExitBurstKind.CrossLaunch;
      kindScale = this.config.crossLaunchScale;
    } else {
      result.kind = ExitBurstKind.Speedboost;
    }

    // Energia é o único limitador (D13): abaixo de 40% o arranque cai; nunca há contador de boosts.
    result.speed = spec.exitBurst * kindScale * this.exitBurstEnergyScale() * this.modifiers.burstScale;
    result.startTime = now;
    if (!this.config.infiniteEnergy) {
      result.energyCost = result.speed * this.config.exitBurstEnergyPerMps * this.modifiers.burstEnergyScale;
      this.energy = clamp(this.energy - result.energyCost, 0, 1);
    }
    this.exitMove = DribbleMove.None;
    this.exitBurst = result;
    return result;
  }

  /** Velocidade extra (m/s) do arranque agora: cheia no 1º passo, depois cai até zero. */
  exitBurstSpeed(now: number): number {
    const burst = this.exitBurst;
    if (!burst.isValid()) {
      return 0;
    }
    const elapsed = now - burst.startTime;
    if (elapsed < 0) {
      return 0;
    }
    if (elapsed <= this.config.exitBurstHoldSeconds) {
      return burst.speed;
    }
    const fade = elapsed - this.config.exitBurstHoldSeconds;
    if (this.config.exitBurstFadeSeconds <= 0 || fade >= this.config.exitBurstFadeSeconds) {
      return 0;
    }
    return burst.speed * (1 - fade / this.config.exitBurstFadeSeconds);
  }
}
