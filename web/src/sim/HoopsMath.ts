// Núcleo de simulação do Projeto Garrafão (porte de Plugins/HoopsSim/.../HoopsMath.h).
// TypeScript puro, sem three.js: roda no jogo e no vitest. Unidades SI (metros, segundos, kg), eixo Z para cima,
// mesmo sentido de eixos da Unreal. A conversão para o Y-para-cima do three.js fica só em src/units.ts.

export const Pi = Math.PI;
export const DefaultGravity = 9.81;

export const degToRad = (degrees: number): number => degrees * (Pi / 180);
export const radToDeg = (radians: number): number => radians * (180 / Pi);

export function clamp(value: number, minValue: number, maxValue: number): number {
  return value < minValue ? minValue : value > maxValue ? maxValue : value;
}

export const lerp = (a: number, b: number, alpha: number): number => a + (b - a) * alpha;

/** Vetor imutável: toda operação devolve um novo (mesma semântica de valor do C++). */
export class Vec3 {
  constructor(
    readonly x = 0,
    readonly y = 0,
    readonly z = 0,
  ) {}

  add(o: Vec3): Vec3 {
    return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z);
  }
  sub(o: Vec3): Vec3 {
    return new Vec3(this.x - o.x, this.y - o.y, this.z - o.z);
  }
  scale(s: number): Vec3 {
    return new Vec3(this.x * s, this.y * s, this.z * s);
  }
  div(s: number): Vec3 {
    return new Vec3(this.x / s, this.y / s, this.z / s);
  }
  neg(): Vec3 {
    return new Vec3(-this.x, -this.y, -this.z);
  }
  dot(o: Vec3): number {
    return this.x * o.x + this.y * o.y + this.z * o.z;
  }
  cross(o: Vec3): Vec3 {
    return new Vec3(this.y * o.z - this.z * o.y, this.z * o.x - this.x * o.z, this.x * o.y - this.y * o.x);
  }
  length(): number {
    return Math.sqrt(this.dot(this));
  }
  lengthSquared(): number {
    return this.dot(this);
  }
  length2D(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
  flat(): Vec3 {
    return new Vec3(this.x, this.y, 0);
  }
  normalized(fallback: Vec3 = new Vec3(1, 0, 0)): Vec3 {
    const len = this.length();
    return len > 1e-12 ? this.div(len) : fallback;
  }
  withZ(z: number): Vec3 {
    return new Vec3(this.x, this.y, z);
  }
}

export const upVector = (): Vec3 => new Vec3(0, 0, 1);

export const distance = (a: Vec3, b: Vec3): number => a.sub(b).length();
export const distance2D = (a: Vec3, b: Vec3): number => a.sub(b).length2D();

export const lerpVec = (a: Vec3, b: Vec3, alpha: number): Vec3 => a.add(b.sub(a).scale(alpha));

export const sigmoid = (logit: number): number => 1 / (1 + Math.exp(-logit));

export function logitOf(probability: number): number {
  const p = clamp(probability, 1e-6, 1 - 1e-6);
  return Math.log(p / (1 - p));
}
