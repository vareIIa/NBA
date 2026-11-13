/**
 * Tom de pele do jogador (docs/26-aparencia.md §2). O corpo do HY tem a pele pintada nas texturas `Pele` e `Rosto`
 * (junto com o cabelo, as sobrancelhas, os olhos e os lábios). A máscara de cada textura (web/tools/pele-mascara.py,
 * canal R) diz o que é pele; ali o shader troca a cor:
 *
 *   detalhe = texel / TextureSkin           (≈ 1 na pele média: guarda sombra, poro, músculo pintado)
 *   pele    = tom × mix(luma(detalhe), detalhe, croma)
 *
 * Com o tom igual ao da textura e croma 1, sai a textura exata (a build padrão não muda). Longe dele, o croma cai para
 * 0,55: as orelhas e o nariz, muito vermelhos na textura do HY, não ficam rosados numa pele escura. A emissão fraca do
 * corpo (luz que atravessa a pele, trocar_corpo.py) usa a mesma textura e recebe o mesmo fator.
 *
 * Os uniforms ficam no material (`userData.skinTone`): trocar de tom no menu não recompila o shader.
 */
import * as THREE from 'three';
import { RenderLook } from '../render/RenderLook';
import { addRimLight } from '../render/RimLight';
import { TextureSkin } from '../build/PlayerLook';

const Masks: Record<string, string> = { Pele: 'look/pele_mascara.webp', Rosto: 'look/rosto_mascara.webp' };

interface SkinUniforms {
  uSkinMask: { value: THREE.Texture };
  uSkinTone: { value: THREE.Color };
  uSkinRef: { value: THREE.Color };
  uSkinChroma: { value: number };
}

const maskCache = new Map<string, Promise<THREE.Texture>>();

function loadMask(url: string): Promise<THREE.Texture> {
  let p = maskCache.get(url);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(url).then((t) => {
      t.flipY = false; // UV do glTF
      t.colorSpace = THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    });
    maskCache.set(url, p);
  }
  return p;
}

/** Croma do detalhe pela distância do tom ao da textura (0 = o mesmo tom). */
export function skinChroma(tone: THREE.Color, ref: THREE.Color): number {
  const d = Math.hypot(tone.r - ref.r, tone.g - ref.g, tone.b - ref.b); // linear
  const t = Math.min(1, d / 0.12);
  return 1 - 0.45 * t * t * (3 - 2 * t);
}

function skinMaterials(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const out = new Set<THREE.MeshStandardMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || mesh.userData.gear) return;
    for (const m of ([] as THREE.Material[]).concat(mesh.material)) if (m.name in Masks && (m as THREE.MeshStandardMaterial).map) out.add(m as THREE.MeshStandardMaterial);
  });
  return [...out];
}

function install(m: THREE.MeshStandardMaterial, mask: THREE.Texture): SkinUniforms {
  addRimLight(m);
  const u: SkinUniforms = {
    uSkinMask: { value: mask },
    uSkinTone: { value: new THREE.Color(TextureSkin) },
    uSkinRef: { value: new THREE.Color(TextureSkin) },
    uSkinChroma: { value: 1 },
  };
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, u);
    const flatten = m.name === 'Rosto' ? RenderLook.faceFlatten : RenderLook.skinFlatten;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uSkinMask;\nuniform vec3 uSkinTone;\nuniform vec3 uSkinRef;\nuniform float uSkinChroma;\n#define SKIN_FLATTEN ' + flatten.toFixed(2) + '\n#define SKIN_REPAIR ' + (RenderLook.skinRepair && m.name === 'Pele' ? '1.0' : '0.0') + '\n#define SKIN_ALBEDO ' + RenderLook.skinAlbedo.toFixed(2) + '\n#define SKIN_SSS ' + RenderLook.skinScatter.toFixed(2) + '\n#define SKIN_EYES ' + (RenderLook.eyeGloss && m.name === 'Rosto' ? '1.0' : '0.0'),
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  vec3 skinFactor = vec3(1.0);
  vec4 skinRepaired = vec4(0.0);
  float skinAmount = 0.0;
  float skinEye = 0.0;
  {
    vec4 skinMask = texture2D(uSkinMask, vMapUv);
    vec3 base = max(diffuseColor.rgb, vec3(1e-4));
    // Reparo (alfa da máscara, pele-mascara.py): o HY pintou de preto a parte de trás dos braços e as mãos. Ali o texel
    // vira o tom médio da textura e conta como pele inteira.
    float skinFix = SKIN_REPAIR * (1.0 - skinMask.a);
    float skinW = max(skinMask.r, skinFix);
    vec3 painted = mix(base, uSkinRef, skinFix);
    // Render novo (docs/28): a textura do HY traz luz pintada (as costas saem marrons numa pele clara). O expoente
    // achata essa luz; o volume vem da luz de verdade e do mapa de normal. 1 = textura exata (render antigo).
    vec3 detail = pow(painted / uSkinRef, vec3(SKIN_FLATTEN));
    float l = dot(detail, vec3(0.2126, 0.7152, 0.0722));
    vec3 skin = uSkinTone * mix(vec3(l), detail, uSkinChroma);
    skinFactor = mix(vec3(1.0), skin / base, skinW);
    // No reparo a cor entra direto: a razão sobre um texel quase preto amplifica o ruído da compressão.
    diffuseColor.rgb = mix(diffuseColor.rgb * skinFactor, skin, skinFix);
    skinRepaired = vec4(skin, skinFix);
    // Fase 4 (docs/28): a pele reflete menos que a textura do HY diz (estourava de branco sob os refletores).
    diffuseColor.rgb *= mix(1.0, SKIN_ALBEDO, skinW);
    skinAmount = skinW;
    // Olhos (rosto): o que não é pele nem cabelo pintado é o branco e a íris.
    skinEye = SKIN_EYES * (1.0 - skinMask.r) * (1.0 - skinMask.g);
  }`,
      )
      // O mapa de normal também é lixo onde a textura era preta (sai manchado): no reparo vale a normal da malha.
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize(mix(normal, nonPerturbedNormal, skinRepaired.a));')
      // Olho molhado: liso, para pegar o brilho dos refletores e do mapa de ambiente.
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.08, skinEye);')
      // Luz que atravessa a pele: uma faixa avermelhada onde a luz principal vira sombra (o terminador), como em pele
      // de verdade; sem ela a passagem de luz para sombra sai cinza, de boneco.
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  {
    float sssNdl = dot(normal, directionalLights[0].direction);
    float sssBand = smoothstep(-0.45, 0.1, sssNdl) * (1.0 - smoothstep(0.1, 0.6, sssNdl));
    reflectedLight.directDiffuse += SKIN_SSS * skinAmount * sssBand * directionalLights[0].color * diffuseColor.rgb * vec3(0.95, 0.24, 0.13) * RECIPROCAL_PI;
  }
#endif`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance = mix(totalEmissiveRadiance * skinFactor, emissive * skinRepaired.rgb, skinRepaired.a);');
  };
  m.customProgramCacheKey = () => 'skinTone:' + m.name;
  m.needsUpdate = true;
  m.userData.skinTone = u;
  return u;
}

/**
 * Pinta a pele do jogador (corpo e rosto do HY; as peças de roupa ficam como estão). Na 1ª vez baixa as máscaras e
 * instala o shader; depois só muda os uniforms. Corpo sem os materiais `Pele`/`Rosto` com textura: não faz nada.
 */
export async function applySkinTone(root: THREE.Object3D, hex: string, base = 'assets/'): Promise<void> {
  const mats = skinMaterials(root);
  for (const m of mats) {
    let u = m.userData.skinTone as SkinUniforms | undefined;
    if (!u) {
      const mask = await loadMask(base + Masks[m.name]!);
      u = (m.userData.skinTone as SkinUniforms | undefined) ?? install(m, mask);
    }
    u.uSkinTone.value.set(hex);
    u.uSkinChroma.value = skinChroma(u.uSkinTone.value, u.uSkinRef.value);
  }
}
