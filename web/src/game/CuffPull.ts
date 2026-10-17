/**
 * Pele dentro do cano: no vertex shader do corpo, depois da pele, os vértices da perna e do pé que ficam abaixo da boca
 * do tênis são puxados para o eixo da canela (até o raio interno do cano). Assim a pele nunca chega à parede do tênis,
 * em nenhuma pose: o que sobra dela está dentro do calçado, e a borda que o BodyCover deixa (cortada pela altura) fica
 * dentro do cano, sem dente aparecendo (docs/20, "Pé e tênis").
 *
 * Um segmento por pé (tornozelo → joelho), no espaço da malha do corpo. A boca e o raio de cada pé vêm do próprio GLB do
 * tênis (PlayerGear.shoeCuffs). Peso 1 abaixo da boca, caindo a 0 num centímetro e meio acima dela.
 */
import * as THREE from 'three';

/** Cano por altura: raio interno em cada faixa de 1 cm acima do tornozelo (até `CuffBins` cm). */
export const CuffBins = 32;

/** Um pé: tornozelo e joelho (bind), raio interno do cano por altura (m) e altura da boca (bind, m). */
export interface Cuff {
  ankle: THREE.Vector3;
  knee: THREE.Vector3;
  prof: number[];
  mouth: number;
}

/** Faixa (m) em que o peso cai de 1 para 0 acima da boca. */
export const CuffFade = 0.015;

/** Uniformes de um material do corpo (um conjunto por material, compartilhado pelos que o patch já tocou). */
interface CuffUniforms {
  uOn: { value: number };
  uMouth: { value: number };
  uFade: { value: number };
  uSegA0: { value: THREE.Vector3 };
  uSegB0: { value: THREE.Vector3 };
  uProf0: { value: number[] };
  uSegA1: { value: THREE.Vector3 };
  uSegB1: { value: THREE.Vector3 };
  uProf1: { value: number[] };
}

const GLSL_DECL = /* glsl */ `
uniform float uOn;
uniform float uMouth;
uniform float uFade;
uniform vec3 uSegA0;
uniform vec3 uSegB0;
uniform float uProf0[${CuffBins}];
uniform vec3 uSegA1;
uniform vec3 uSegB1;
uniform float uProf1[${CuffBins}];
void cuffNear(vec3 p, vec3 a, vec3 b, out vec3 c, out float l) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
  c = a + ab * t;
  l = length(p - c);
}
`;

const GLSL_PULL = /* glsl */ `
if (uOn > 0.5) {
  // Altura ao longo da canela na pose atual (não a do bind: com a perna dobrada a pele que estava acima da boca desce).
  // Peso: 1 até a boca, 0 um pouco acima dela (a pele que cruza a boca desce suave para dentro).
  vec3 c0; float l0; vec3 c1; float l1;
  cuffNear(transformed, uSegA0, uSegB0, c0, l0);
  cuffNear(transformed, uSegA1, uSegB1, c1, l1);
  float h0 = dot(transformed - uSegA0, normalize(uSegB0 - uSegA0));
  float h1 = dot(transformed - uSegA1, normalize(uSegB1 - uSegA1));
  // Só o pé mais perto: o outro segmento está longe e não deve puxar a pele.
  float r0 = uProf0[clamp(int(h0 * 100.0), 0, ${CuffBins - 1})];
  float r1 = uProf1[clamp(int(h1 * 100.0), 0, ${CuffBins - 1})];
  if (l0 <= l1 && l0 < 0.2 && l0 > r0 && h0 < uMouth + uFade)
    transformed = mix(transformed, c0 + (transformed - c0) / max(l0, 1e-6) * r0, 1.0 - smoothstep(uMouth, uMouth + uFade, h0));
  else if (l1 < l0 && l1 < 0.2 && l1 > r1 && h1 < uMouth + uFade)
    transformed = mix(transformed, c1 + (transformed - c1) / max(l1, 1e-6) * r1, 1.0 - smoothstep(uMouth, uMouth + uFade, h1));
}
`;

const off = (): CuffUniforms => ({
  uOn: { value: 0 },
  uMouth: { value: 0 },
  uFade: { value: CuffFade },
  uSegA0: { value: new THREE.Vector3() },
  uSegB0: { value: new THREE.Vector3() },
  uProf0: { value: new Array<number>(CuffBins).fill(0) },
  uSegA1: { value: new THREE.Vector3() },
  uSegB1: { value: new THREE.Vector3() },
  uProf1: { value: new Array<number>(CuffBins).fill(0) },
});

const inv = new THREE.Matrix4();

function patch(material: THREE.Material): CuffUniforms {
  const existing = material.userData.cuffPull as CuffUniforms | undefined;
  if (existing) return existing;
  const u = off();
  material.userData.cuffPull = u;
  const prev = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_DECL}`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>\n${GLSL_PULL}`);
  };
  const prevKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${prevKey()}|cuffPull`;
  material.needsUpdate = true;
  return u;
}

/** Puxa a pele da perna e do pé abaixo da boca do tênis para dentro do cano. Um objeto por corpo vestido. */
export class CuffPull {
  private readonly sets: CuffUniforms[] = [];
  /** Distância da boca até o tornozelo, medida ao longo da canela (bind, m). */
  private readonly mouthAxial: number;

  /**
   * `meshes`: malhas do corpo (sem roupa). Materiais são corrigidos uma vez; a troca de tênis só atualiza os valores.
   */
  constructor(
    private readonly meshes: THREE.SkinnedMesh[],
    private readonly bones: { foot: THREE.Object3D[]; calf: THREE.Object3D[] },
    private readonly cuffs: Cuff[],
  ) {
    // Altura da boca ao longo da canela (bind): a boca está na altura `mouth` e a canela sobe `axis.y` por metro.
    this.mouthAxial = cuffs.reduce((acc, c) => acc + (c.mouth - c.ankle.y) / Math.max(1e-3, (c.knee.y - c.ankle.y) / c.knee.clone().sub(c.ankle).length()), 0) / Math.max(1, cuffs.length);
    const seen = new Set<THREE.Material>();
    for (const m of meshes)
      for (const mat of ([] as THREE.Material[]).concat(m.material)) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        this.sets.push(patch(mat));
      }
    this.update();
  }

  /** Valores dos segmentos e da boca no espaço da malha do corpo (a pose atual). */
  update(): void {
    const mesh = this.meshes[0];
    if (!mesh) return;
    mesh.updateMatrixWorld(true);
    inv.copy(mesh.matrixWorld).invert();
    const mouth = this.mouthAxial;
    const seg = (i: number): { a: THREE.Vector3; b: THREE.Vector3; prof: number[] } | null => {
      const c = this.cuffs[i];
      if (!c) return null;
      const a = this.bones.foot[i].getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      const b = this.bones.calf[i].getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      return { a, b, prof: c.prof };
    };
    const s0 = seg(0);
    const s1 = seg(1);
    for (const u of this.sets) {
      u.uOn.value = s0 || s1 ? 1 : 0;
      u.uMouth.value = mouth;
      if (s0) (u.uSegA0.value.copy(s0.a), u.uSegB0.value.copy(s0.b), u.uProf0.value.splice(0, CuffBins, ...s0.prof));
      if (s1) (u.uSegA1.value.copy(s1.a), u.uSegB1.value.copy(s1.b), u.uProf1.value.splice(0, CuffBins, ...s1.prof));
    }
  }

  /** Desliga (tirar o tênis: o corpo volta como era). */
  off(): void {
    for (const u of this.sets) u.uOn.value = 0;
  }

  /** Estado para o diagnóstico (tools/tenis-quadros.mjs repete a conta na CPU). */
  state(): { on: boolean; mouth: number; segs: { a: THREE.Vector3; b: THREE.Vector3; prof: number[] }[] } {
    const u = this.sets[0];
    if (!u) return { on: false, mouth: 0, segs: [] };
    return {
      on: u.uOn.value > 0.5,
      mouth: u.uMouth.value,
      segs: [
        { a: u.uSegA0.value.clone(), b: u.uSegB0.value.clone(), prof: u.uProf0.value.slice() },
        { a: u.uSegA1.value.clone(), b: u.uSegB1.value.clone(), prof: u.uProf1.value.slice() },
      ],
    };
  }
}
