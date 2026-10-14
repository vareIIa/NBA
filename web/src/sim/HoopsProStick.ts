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
}

export const makeStickGesture = (overrides: Partial<StickGesture> = {}): StickGesture => ({
  kind: StickGestureKind.Flick,
  dir: StickDir.Up,
  firstDir: StickDir.Up,
  clockwise: false,
  sweepDegrees: 0,
  time: 0,
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
  }

  /** Uma amostra por frame. Devolve os gestos reconhecidos nesta amostra (até MaxGesturesPerUpdate). */
  update(time: number, x: number, y: number): StickGesture[] {
    const out: StickGesture[] = [];
    const c = this.config;
    const magnitude = Math.sqrt(x * x + y * y);
    const angleDeg = radToDeg(Math.atan2(y, x));

    if (!this.active) {
      if (magnitude >= c.activeZone) {
        this.active = true;
        this.holdEmitted = false;
        this.activeStartTime = time;
        this.lastAngleDeg = angleDeg;
        this.sweepDeg = 0;
        this.peakMagnitude = magnitude;
        this.peakDir = dirFromVector(x, y);
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
    const elapsed = time - this.activeStartTime;
    const absSweep = Math.abs(this.sweepDeg);
    const clockwise = this.sweepDeg < 0;

    if (this.holdEmitted) {
      out.push(makeStickGesture({ kind: StickGestureKind.HoldRelease, dir: this.holdDir, time }));
      this.holdEmitted = false;
      return out;
    }

    if (absSweep >= c.rotationMinDegrees) {
      out.push(
        makeStickGesture({ kind: StickGestureKind.Rotation, clockwise, sweepDegrees: absSweep, dir: this.peakDir, time }),
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
        }),
      );
      return out;
    }

    if (elapsed <= c.flickMaxSeconds) {
      out.push(makeStickGesture({ kind: StickGestureKind.Flick, dir: this.peakDir, time }));

      if (this.hasLastFlick && time - this.lastFlickTime <= c.comboGapSeconds) {
        if (this.lastFlickDir === this.peakDir) {
          out.push(
            makeStickGesture({ kind: StickGestureKind.DoubleThrow, dir: this.peakDir, firstDir: this.lastFlickDir, time }),
          );
        } else if (areOpposite(this.lastFlickDir, this.peakDir)) {
          out.push(
            makeStickGesture({ kind: StickGestureKind.Switchback, dir: this.peakDir, firstDir: this.lastFlickDir, time }),
          );
        }
        this.hasLastFlick = false; // um combo consome o par
      } else {
        this.hasLastFlick = true;
        this.lastFlickTime = time;
        this.lastFlickDir = this.peakDir;
      }
    }
    return out;
  }
}
