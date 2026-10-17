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
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uSkinMask;\nuniform vec3 uSkinTone;\nuniform vec3 uSkinRef;\nuniform float uSkinChroma;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  vec3 skinFactor = vec3(1.0);
  {
    float skinW = texture2D(uSkinMask, vMapUv).r;
    vec3 base = max(diffuseColor.rgb, vec3(1e-4));
    vec3 detail = base / uSkinRef;
    float l = dot(detail, vec3(0.2126, 0.7152, 0.0722));
    vec3 skin = uSkinTone * mix(vec3(l), detail, uSkinChroma);
    skinFactor = mix(vec3(1.0), skin / base, skinW);
    diffuseColor.rgb *= skinFactor;
  }`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= skinFactor;');
  };
  m.customProgramCacheKey = () => 'skinTone';
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
