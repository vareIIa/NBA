// Porte de HoopsDribble.h.
// Trajetória cinemática de UM quique de drible: mão → chão → mão (a mesma ou a outra, num crossover).
// A bola chega EXATAMENTE no instante do catch (vindo dos quadros-chave da animação), então nunca "teleporta".
// docs/04-animacoes.md §3.1
import { Vec3, DefaultGravity, lerpVec } from './HoopsMath';

export class DribbleArc {
  startPos = new Vec3(); // mão que soltou (no instante da soltura)
  floorPos = new Vec3(); // ponto de contato no chão (centro da bola a 1 raio do chão)
  endPos = new Vec3(); // mão que vai receber (no instante do catch)
  downSeconds = 0.18;
  upSeconds = 0.22;
  gravity = DefaultGravity;

  totalSeconds(): number {
    return this.downSeconds + this.upSeconds;
  }

  /** Posição no tempo t desde a soltura (t é limitado a [0, total]). */
  evaluate(t: number): Vec3 {
    const g = this.gravity;
    if (t <= this.downSeconds) {
      const td = this.downSeconds > 1e-6 ? this.downSeconds : 1e-6;
      const clamped = t < 0 ? 0 : t;
      // Descida: z(t) = z0 - v0 t - g t²/2, chegando ao chão em td.
      const drop = this.startPos.z - this.floorPos.z;
      const v0 = (drop - 0.5 * g * td * td) / td;
      const z = this.startPos.z - v0 * clamped - 0.5 * g * clamped * clamped;
      return lerpVec(this.startPos.flat(), this.floorPos.flat(), clamped / td).withZ(z);
    }

    const tu = this.upSeconds > 1e-6 ? this.upSeconds : 1e-6;
    const local = t - this.downSeconds > tu ? tu : t - this.downSeconds;
    // Subida: z(t) = zf + vu t - g t²/2, chegando na mão em tu.
    const rise = this.endPos.z - this.floorPos.z;
    const vUp = (rise + 0.5 * g * tu * tu) / tu;
    const z = this.floorPos.z + vUp * local - 0.5 * g * local * local;
    return lerpVec(this.floorPos.flat(), this.endPos.flat(), local / tu).withZ(z);
  }

  /** Velocidade de saída do chão (para validar que é um quique fisicamente plausível). */
  floorExitSpeed(): number {
    const tu = this.upSeconds > 1e-6 ? this.upSeconds : 1e-6;
    return (this.endPos.z - this.floorPos.z + 0.5 * this.gravity * tu * tu) / tu;
  }

  floorEntrySpeed(): number {
    const td = this.downSeconds > 1e-6 ? this.downSeconds : 1e-6;
    const drop = this.startPos.z - this.floorPos.z;
    const v0 = (drop - 0.5 * this.gravity * td * td) / td;
    return v0 + this.gravity * td;
  }
}

/** Monta um quique a partir da posição/velocidade do jogador. O ponto no chão vai um pouco à frente (lead). */
export function makeDribbleArc(
  handRelease: Vec3,
  handCatch: Vec3,
  playerVelocity: Vec3,
  period: number,
  ballRadius: number,
  floorZ = 0,
): DribbleArc {
  const arc = new DribbleArc();
  arc.startPos = handRelease;
  arc.endPos = handCatch;
  // A bola desce mais rápido do que sobe (é empurrada para baixo).
  arc.downSeconds = period * 0.42;
  arc.upSeconds = period - arc.downSeconds;
  const mid = lerpVec(handRelease.flat(), handCatch.flat(), 0.5);
  const lead = playerVelocity.flat().scale(arc.downSeconds * 0.5);
  arc.floorPos = new Vec3(mid.x + lead.x, mid.y + lead.y, floorZ + ballRadius);
  return arc;
}
