/**
 * Roupa sempre por cima dos membros: no vertex shader da peça, depois da pele, todo vértice que cai dentro de uma
 * cápsula de membro (braço, antebraço, mão, coxa, canela) é empurrado para fora dela, em qualquer pose e a cada quadro.
 *
 * Dois modos por membro:
 *  - 'in': o membro passa por dentro da peça (coxa na bermuda, ombro na cava): o tecido sai pela superfície mais
 *    próxima da cápsula e fica por cima da pele.
 *  - 'out': o membro está por fora (mão ou antebraço cruzando o peito): o tecido recua para trás do membro, na direção
 *    do "miolo" da peça (eixo do tronco), como pano de verdade sob um braço.
 *
 * O BodyCover cuida do corpo que fica debaixo da peça; este módulo cuida do que vem de fora dela.
 */
import * as THREE from 'three';

export const MaxLimbCapsules = 10;
export type PushMode = 'in' | 'out';

export interface LimbCapsule {
  a: THREE.Bone;
  b: THREE.Bone;
  r: number; // raio no mundo (m), já com a folga
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const inv = new THREE.Matrix4();

/** Faixa (m) em que o empurrão 'in' começa antes do raio, para a dobra sair suave. */
export const PushBand = 0.015;

const PushGLSL = /* glsl */ `
{
  vec3 cab = uCoreB - uCoreA;
  float ct = clamp(dot(transformed - uCoreA, cab) / max(dot(cab, cab), 1e-8), 0.0, 1.0);
  vec3 outw = transformed - (uCoreA + cab * ct);
  for (int i = 0; i < ${MaxLimbCapsules}; i++) {
    if (i >= uCapN) break;
    vec3 a = uCapA[i];
    vec3 ab = uCapB[i] - a;
    float ab2 = max(dot(ab, ab), 1e-8);
    float t = clamp(dot(transformed - a, ab) / ab2, 0.0, 1.0);
    vec3 c = a + ab * t;
    vec3 d = transformed - c;
    float l = length(d);
    float r = uCapR[i];
    vec3 ax = ab / sqrt(ab2);
    if (l >= r + uBand) continue;
    if (uCapOut[i] < 0.5) {
      // Saída suave: g(l) = r + b·e^((l−r−b)/b) é contínua e com derivada 1 em l = r+b e nunca fica abaixo de r, então
      // vizinhos empurrados por quantidades diferentes não viram triângulos esticados (lascas) na barra.
      float g = r + uBand * exp((l - r - uBand) / uBand);
      transformed = c + (l > 1e-6 ? d / l : normalize(outw + vec3(1e-6))) * g;
    } else if (l < r) {
      // Recua ao longo de -n (n = para fora do miolo, perpendicular ao membro) até sair do cilindro.
      vec3 n = outw - ax * dot(outw, ax);
      float nl = length(n);
      if (nl < 1e-6) continue;
      n /= nl;
      vec3 dp = d - ax * dot(d, ax);
      float dn = dot(dp, n);
      transformed -= n * (dn + sqrt(max(0.0, dn * dn - dot(dp, dp) + r * r)));
    }
  }
}
`;

/** Empurrão de membros de uma peça (uma malha). Chamar update() a cada quadro, com os ossos já na pose final. */
export class LimbPush {
  private readonly uniforms = {
    uCapA: { value: Array.from({ length: MaxLimbCapsules }, () => new THREE.Vector3()) },
    uCapB: { value: Array.from({ length: MaxLimbCapsules }, () => new THREE.Vector3()) },
    uCapR: { value: new Array<number>(MaxLimbCapsules).fill(0) },
    uCapOut: { value: new Array<number>(MaxLimbCapsules).fill(0) },
    uCapN: { value: 0 },
    uBand: { value: PushBand },
    uCoreA: { value: new THREE.Vector3() },
    uCoreB: { value: new THREE.Vector3() },
  };

  constructor(
    private readonly mesh: THREE.SkinnedMesh,
    private readonly caps: { cap: LimbCapsule; mode: PushMode }[],
    private readonly core: [THREE.Bone, THREE.Bone],
  ) {
    this.uniforms.uCapN.value = Math.min(MaxLimbCapsules, caps.length);
    caps.slice(0, MaxLimbCapsules).forEach((c, i) => (this.uniforms.uCapOut.value[i] = c.mode === 'out' ? 1 : 0));
    for (const m of ([] as THREE.Material[]).concat(mesh.material)) this.patch(m);
  }

  private patch(material: THREE.Material): void {
    const prev = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      prev(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 uCapA[${MaxLimbCapsules}];
uniform vec3 uCapB[${MaxLimbCapsules}];
uniform float uCapR[${MaxLimbCapsules}];
uniform float uCapOut[${MaxLimbCapsules}];
uniform int uCapN;
uniform float uBand;
uniform vec3 uCoreA;
uniform vec3 uCoreB;`,
        )
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>\n${PushGLSL}`);
    };
    // Programa próprio (não reaproveita o de outro material sem o empurrão).
    material.customProgramCacheKey = () => 'limbpush';
    material.needsUpdate = true;
  }

  /** Cápsulas e miolo no espaço do objeto da malha (o `transformed` do shader, depois da pele). */
  update(): void {
    inv.copy(this.mesh.matrixWorld).invert();
    const scale = 1 / this.mesh.matrixWorld.getMaxScaleOnAxis();
    this.uniforms.uBand.value = PushBand * scale;
    this.caps.slice(0, MaxLimbCapsules).forEach(({ cap }, i) => {
      this.uniforms.uCapA.value[i].copy(cap.a.getWorldPosition(tmpA)).applyMatrix4(inv);
      this.uniforms.uCapB.value[i].copy(cap.b.getWorldPosition(tmpB)).applyMatrix4(inv);
      this.uniforms.uCapR.value[i] = cap.r * scale;
    });
    this.uniforms.uCoreA.value.copy(this.core[0].getWorldPosition(tmpA)).applyMatrix4(inv);
    this.uniforms.uCoreB.value.copy(this.core[1].getWorldPosition(tmpB)).applyMatrix4(inv);
  }
}
