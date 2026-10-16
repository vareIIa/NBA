// Filtro passa-baixa dos clipes de mocap (Fase 0 da fluidez).
//
// O mocap da CMU tem ruído de marcador quadro a quadro (tremor de 10–30 Hz nos punhos, antebraços e pés). Com a
// reprodução acelerada até 1,7x (a passada acompanhando a velocidade), a aceleração angular desse tremor cresce com o
// quadrado da velocidade e vira os "estalos" que o laboratório mede, mesmo com todo o pós-processo desligado.
// Movimento humano útil fica abaixo de ~8 Hz; um binomial centrado corta o tremor sem atrasar a pose (fase zero).
import * as THREE from 'three';

/** Pesos do binomial de 2·r+1 pontos (r=2: 1 4 6 4 1). */
function binomial(radius: number): number[] {
  const n = radius * 2;
  const w: number[] = [1];
  for (let i = 0; i < n; i++) w.push((w[i] * (n - i)) / (i + 1));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

/**
 * Suaviza as trilhas de rotação (e de posição) de um clipe, no lugar. `loop`: as pontas se emendam (o fim vizinha o
 * começo); senão as pontas repetem o primeiro/último quadro (o começo e o fim da pose não mudam).
 */
export function smoothClip(clip: THREE.AnimationClip, loop: boolean, radius = 2, skip: (track: string) => boolean = () => false): void {
  const w = binomial(radius);
  for (const track of clip.tracks) {
    if (skip(track.name)) continue;
    const isQuat = track instanceof THREE.QuaternionKeyframeTrack;
    const isVec = track instanceof THREE.VectorKeyframeTrack;
    if (!isQuat && !isVec) continue;
    const size = track.getValueSize();
    const src = track.values;
    const n = src.length / size;
    if (n < radius * 2 + 2) continue;
    // Os loops costumam repetir o primeiro quadro no fim: o vizinho do fim é o 2º quadro, não o 1º de novo.
    const period = loop ? n - 1 : n;
    const at = (i: number): number => {
      if (loop) return ((i % period) + period) % period;
      return Math.min(n - 1, Math.max(0, i));
    };
    const out = new Float32Array(src.length);
    const acc = new Array<number>(size);
    for (let i = 0; i < n; i++) {
      acc.fill(0);
      for (let k = -radius; k <= radius; k++) {
        const j = at(i + k);
        let sign = 1;
        if (isQuat) {
          // Mesmo hemisfério do quadro central (q e -q são a mesma rotação).
          let dot = 0;
          for (let c = 0; c < 4; c++) dot += src[i * 4 + c] * src[j * 4 + c];
          sign = dot < 0 ? -1 : 1;
        }
        const wk = w[k + radius] * sign;
        for (let c = 0; c < size; c++) acc[c] += src[j * size + c] * wk;
      }
      if (isQuat) {
        const len = Math.hypot(acc[0], acc[1], acc[2], acc[3]) || 1;
        for (let c = 0; c < 4; c++) out[i * 4 + c] = acc[c] / len;
      } else {
        for (let c = 0; c < size; c++) out[i * size + c] = acc[c];
      }
    }
    if (loop && period < n) out.set(out.subarray(0, size), (n - 1) * size); // fim = começo, sem degrau na emenda
    track.values = out;
  }
}
