// Gerador determinístico (SplitMix64), porte de HoopsRandom.h. Mesma semente => mesma sequência do C++, bit a bit.
// Usa BigInt para a aritmética de 64 bits sem sinal.
// O dono da semente é a autoridade da partida (servidor/host), para replays e rede.

const MASK64 = (1n << 64n) - 1n;

export class Rng {
  private state: bigint;

  constructor(seed: bigint | number = 0x6a09e667f3bcc909n) {
    this.state = BigInt.asUintN(64, BigInt(seed));
  }

  nextU64(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return z ^ (z >> 31n);
  }

  /** Uniforme em [0, 1). */
  nextDouble(): number {
    return Number(this.nextU64() >> 11n) * (1 / 9007199254740992);
  }

  range(minValue: number, maxValue: number): number {
    return minValue + (maxValue - minValue) * this.nextDouble();
  }

  chance(probability: number): boolean {
    return this.nextDouble() < probability;
  }

  getState(): bigint {
    return this.state;
  }
}
