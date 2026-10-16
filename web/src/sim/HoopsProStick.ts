// Porte de HoopsProStick.h/.cpp.
// Reconhecedor de gestos do Pro Stick (analógico direito), no modelo do jogo de referência (docs/02-controles.md §2):
// toque (flick), segurar, giro completo, quarto de círculo, "double throw" (mesma direção 2x) e "switchback".
// Entrada: amostras do stick já na orientação ABSOLUTA (cima = para onde o jogador ataca, X = direita do jogador).
import { radToDeg } from './HoopsMath';

export enum StickDir {
  Up,
  UpRight,
  Right,
  DownRight,
  Down,
  DownLeft,
  Left,
  UpLeft,
}

export enum StickGestureKind {
  Flick, // vai e volta ao centro rápido
  Hold, // segurou numa direção
  HoldRelease, // soltou depois de um Hold
  Rotation, // giro (spin)
  QuarterCircle, // quarto de círculo (half-spin)
  DoubleThrow, // dois flicks na mesma direção (emitido junto com o 2º Flick)
  Switchback, // flick e depois o oposto (emitido junto com o 2º Flick)
}

export interface StickGesture {
  kind: StickGestureKind;
  dir: StickDir; // direção principal (no Switchback: a segunda)
  firstDir: StickDir; // no DoubleThrow/Switchback: a primeira
  clockwise: boolean; // Rotation/QuarterCircle
  sweepDegrees: number;
  time: number;
  /** Quando o toque começou (o stick passou da zona ativa). */
  startTime: number;
  /** Rotation/QuarterCircle de um toque que já tinha saído como flick na borda (earlyFlick). */
  afterEarlyFlick: boolean;
}

export const makeStickGesture = (overrides: Partial<StickGesture> = {}): StickGesture => ({
  kind: StickGestureKind.Flick,
  dir: StickDir.Up,
  firstDir: StickDir.Up,
  clockwise: false,
  sweepDegrees: 0,
  time: 0,
  startTime: 0,
  afterEarlyFlick: false,
  ...overrides,
});

export interface ProStickConfig {
  deadZone: number;
  activeZone: number;
  flickMaxSeconds: number;
  holdSeconds: number;
  comboGapSeconds: number; // entre dois flicks para virar DoubleThrow/Switchback
  rotationMinDegrees: number;
  quarterMinDegrees: number;
  quarterMaxDegrees: number;
  holdMaxSweepDegrees: number;
  /**
   * Flick na borda: o toque sai assim que o stick para na zona ativa, sem esperar a volta ao centro (~50–70 ms antes; o
   * stick segurado também vira o drible). Parado = girando menos que earlyFlickMaxTurnDegPerSecond durante
   * earlyFlickStableSeconds: o spin e o meio giro varrem a borda a 700–1400°/s e não disparam.
   */
  earlyFlick: boolean;
  earlyFlickStableSeconds: number;
  earlyFlickMaxTurnDegPerSecond: number;
  earlyFlickMaxSweepDegrees: number;
  /**
   * Direções que esperam a volta ao centro: segurar para baixo é o arremesso pelo Pro Stick (docs/02 §1), e o toque
   * para baixo (step-back) só se distingue dele quando o stick volta.
   */
  earlyFlickExcluded: StickDir[];
  /** Giro completo sai assim que a varredura passa de rotationMinDegrees (nenhum outro gesto chega lá), sem a volta. */
  earlyRotation: boolean;
}

export const defaultProStickConfig = (): ProStickConfig => ({
  deadZone: 0.25,
  activeZone: 0.7,
  flickMaxSeconds: 0.22,
  holdSeconds: 0.2,
  comboGapSeconds: 0.3,
  rotationMinDegrees: 230,
  quarterMinDegrees: 65,
  quarterMaxDegrees: 160,
  holdMaxSweepDegrees: 45,
  earlyFlick: true,
  earlyFlickStableSeconds: 0.025,
  earlyFlickMaxTurnDegPerSecond: 300,
  earlyFlickMaxSweepDegrees: 30,
  earlyFlickExcluded: [StickDir.Down],
  earlyRotation: true,
});

/** Arredonda como std::lround (metade se afasta do zero). */
const lround = (value: number): number => Math.sign(value) * Math.round(Math.abs(value));

export function dirFromVector(x: number, y: number): StickDir {
  const angleDeg = radToDeg(Math.atan2(y, x)); // 90 = cima
  let index = lround((90 - angleDeg) / 45);
  index = ((index % 8) + 8) % 8;
  return index as StickDir;
}

/** Espelha esquerda/direita (bola na mão esquerda). Índice i (cima=0, horário) vira (8 - i) % 8. */
export const mirrorDir = (dir: StickDir): StickDir => ((8 - dir) % 8) as StickDir;

export function areOpposite(a: StickDir, b: StickDir): boolean {
  const diff = (((a - b) % 8) + 8) % 8;
  return diff >= 3 && diff <= 5;
}

const DirLabels: Record<StickDir, string> = {
  [StickDir.Up]: 'cima',
  [StickDir.UpRight]: 'cima-dir',
  [StickDir.Right]: 'dir',
  [StickDir.DownRight]: 'baixo-dir',
  [StickDir.Down]: 'baixo',
  [StickDir.DownLeft]: 'baixo-esq',
  [StickDir.Left]: 'esq',
  [StickDir.UpLeft]: 'cima-esq',
};
export const stickDirLabel = (dir: StickDir): string => DirLabels[dir] ?? '?';

export class ProStickRecognizer {
  static readonly MaxGesturesPerUpdate = 3;

  private readonly config: ProStickConfig;

  private active = false;
  private holdEmitted = false;
  private activeStartTime = 0;
  private lastAngleDeg = 0;
  private sweepDeg = 0;
  private peakMagnitude = 0;
  private peakDir = StickDir.Up;
  private holdDir = StickDir.Up;

  private hasLastFlick = false;
  private lastFlickTime = -1000;
  private lastFlickDir = StickDir.Up;

  /** Flick na borda: já saiu neste toque; desde quando o stick está parado na zona ativa (-1 = não está). */
  private earlyEmitted = false;
  /** O giro completo deste toque já saiu (earlyRotation). */
  private rotationEmitted = false;
  private stableSince = -1;
  private lastSampleTime = 0;

  constructor(config: ProStickConfig = defaultProStickConfig()) {
    this.config = config;
  }

  isHolding(): boolean {
    return this.active && this.holdEmitted;
  }
  getHoldDir(): StickDir {
    return this.holdDir;
  }

  reset(): void {
    this.active = false;
    this.holdEmitted = false;
    this.sweepDeg = 0;
    this.peakMagnitude = 0;
    this.hasLastFlick = false;
    this.earlyEmitted = false;
    this.rotationEmitted = false;
    this.stableSince = -1;
  }

  /** Uma amostra por frame. Devolve os gestos reconhecidos nesta amostra (até MaxGesturesPerUpdate). */
  update(time: number, x: number, y: number): StickGesture[] {
    const out: StickGesture[] = [];
    const c = this.config;
    const magnitude = Math.sqrt(x * x + y * y);
    const angleDeg = radToDeg(Math.atan2(y, x));
    const sampleDt = time - this.lastSampleTime;
    this.lastSampleTime = time;

    if (!this.active) {
      if (magnitude >= c.activeZone) {
        this.active = true;
        this.holdEmitted = false;
        this.activeStartTime = time;
        this.lastAngleDeg = angleDeg;
        this.sweepDeg = 0;
        this.peakMagnitude = magnitude;
        this.peakDir = dirFromVector(x, y);
        this.earlyEmitted = false;
        this.rotationEmitted = false;
        this.stableSince = time;
      }
      return out;
    }

    // Ativo: acumula a varredura angular enquanto fora da zona morta.
    if (magnitude > c.deadZone) {
      let delta = angleDeg - this.lastAngleDeg;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      this.sweepDeg += delta;
      this.lastAngleDeg = angleDeg;
      if (magnitude > this.peakMagnitude) {
        this.peakMagnitude = magnitude;
        // Para flicks, a direção do pico é a direção "pretendida".
        if (Math.abs(this.sweepDeg) < c.quarterMinDegrees) {
          this.peakDir = dirFromVector(x, y);
        }
      }

      // Flick na borda: o stick está na zona ativa e quase não gira há earlyFlickStableSeconds.
      const turning = sampleDt > 1e-6 && Math.abs(delta) / sampleDt > c.earlyFlickMaxTurnDegPerSecond;
      if (magnitude < c.activeZone || turning) this.stableSince = magnitude >= c.activeZone ? time : -1;
      else if (this.stableSince < 0) this.stableSince = time;
      if (
        c.earlyFlick &&
        !this.earlyEmitted &&
        !this.holdEmitted &&
        this.stableSince >= 0 &&
        time - this.stableSince >= c.earlyFlickStableSeconds - 1e-6 &&
        Math.abs(this.sweepDeg) < c.earlyFlickMaxSweepDegrees
      ) {
        const dir = dirFromVector(x, y);
        if (!c.earlyFlickExcluded.includes(dir)) {
          this.earlyEmitted = true;
          this.peakDir = dir;
          this.emitFlick(dir, time, out);
        }
      }

      // Giro completo: sai no meio do gesto, assim que passa do mínimo (~70 ms antes da volta ao centro).
      if (c.earlyRotation && !this.rotationEmitted && !this.holdEmitted && Math.abs(this.sweepDeg) >= c.rotationMinDegrees) {
        this.rotationEmitted = true;
        out.push(
          makeStickGesture({
            kind: StickGestureKind.Rotation,
            clockwise: this.sweepDeg < 0,
            sweepDegrees: Math.abs(this.sweepDeg),
            dir: this.peakDir,
            time,
            startTime: this.activeStartTime,
            afterEarlyFlick: this.earlyEmitted,
          }),
        );
      }

      const elapsed = time - this.activeStartTime;
      if (
        !this.holdEmitted &&
        elapsed >= c.holdSeconds &&
        Math.abs(this.sweepDeg) < c.holdMaxSweepDegrees &&
        magnitude >= c.activeZone
      ) {
        this.holdEmitted = true;
        this.holdDir = dirFromVector(x, y);
        out.push(makeStickGesture({ kind: StickGestureKind.Hold, dir: this.holdDir, time }));
      }
      return out;
    }

    // Voltou ao centro: classifica.
    this.active = false;
    this.stableSince = -1;
    const elapsed = time - this.activeStartTime;
    const absSweep = Math.abs(this.sweepDeg);
    const clockwise = this.sweepDeg < 0;
    const startTime = this.activeStartTime;
    const afterEarlyFlick = this.earlyEmitted;
    this.earlyEmitted = false;
    if (this.rotationEmitted) {
      this.rotationEmitted = false;
      return out; // o giro já saiu no meio do gesto
    }

    if (this.holdEmitted) {
      out.push(makeStickGesture({ kind: StickGestureKind.HoldRelease, dir: this.holdDir, time, startTime }));
      this.holdEmitted = false;
      return out;
    }

    if (absSweep >= c.rotationMinDegrees) {
      out.push(
        makeStickGesture({
          kind: StickGestureKind.Rotation,
          clockwise,
          sweepDegrees: absSweep,
          dir: this.peakDir,
          time,
          startTime,
          afterEarlyFlick,
        }),
      );
      return out;
    }

    if (absSweep >= c.quarterMinDegrees && absSweep <= c.quarterMaxDegrees) {
      out.push(
        makeStickGesture({
          kind: StickGestureKind.QuarterCircle,
          clockwise,
          sweepDegrees: absSweep,
          dir: this.peakDir,
          time,
          startTime,
          afterEarlyFlick,
        }),
      );
      return out;
    }

    // O flick que já saiu na borda não sai de novo na volta.
    if (!afterEarlyFlick && elapsed <= c.flickMaxSeconds) this.emitFlick(this.peakDir, time, out);
    return out;
  }

  /** Flick (na borda ou na volta ao centro) e o combo com o flick anterior (double throw / switchback). */
  private emitFlick(dir: StickDir, time: number, out: StickGesture[]): void {
    const c = this.config;
    const startTime = this.activeStartTime;
    out.push(makeStickGesture({ kind: StickGestureKind.Flick, dir, time, startTime }));
    if (this.hasLastFlick && time - this.lastFlickTime <= c.comboGapSeconds) {
      if (this.lastFlickDir === dir) {
        out.push(makeStickGesture({ kind: StickGestureKind.DoubleThrow, dir, firstDir: this.lastFlickDir, time, startTime }));
      } else if (areOpposite(this.lastFlickDir, dir)) {
        out.push(makeStickGesture({ kind: StickGestureKind.Switchback, dir, firstDir: this.lastFlickDir, time, startTime }));
      }
      this.hasLastFlick = false; // um combo consome o par
    } else {
      this.hasLastFlick = true;
      this.lastFlickTime = time;
      this.lastFlickDir = dir;
    }
  }
}
