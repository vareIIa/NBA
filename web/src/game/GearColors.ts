/**
 * Cor das zonas da roupa e do tênis (docs/26-aparencia.md, fase 2). Cada peça tem até 4 zonas (principal, detalhe,
 * debrum...), gravadas em assets/look/zonas/<peça>_zonas.webp (canais R, G, B, A = peso de cada zona; web/tools/
 * zonas-cor.py). O shader troca a cor média de cada zona pela escolhida e guarda o relevo da textura (dobras, costuras):
 *
 *   zOrig  = Σ peso_j × cor original da zona j      (a média que a textura tem ali)
 *   zNew   = Σ peso_j × cor escolhida da zona j
 *   detalhe = texel / zOrig                          (≈ 1 no tecido liso; menor nas dobras; maior nos brilhos)
 *   sombra = mix(1, mix(luma(detalhe), detalhe, croma), força)
 *   cor    = zNew × sombra
 *
 * Com a cor escolhida igual à original, zNew = zOrig, croma 1 e força 1: sai a textura exata (a build padrão não muda).
 * Quando a cor muda, o croma cai até 0 (só o brilho do tecido é levado, para o detalhe colorido da textura não virar
 * manchas da cor antiga) e a força cai até 0,3 (o contraste claro-escuro das pinceladas da textura do HY vira listras
 * da cor nova se ficar todo). A pele (SkinTone.ts) usa o mesmo princípio, com croma mínimo maior.
 *
 * Os uniforms ficam no material (`userData.zones`): trocar de cor no menu só muda uniforms, sem recompilar o shader e
 * sem revestir a peça. O shader entra depois da cor base e do avesso (PlayerGear.insideColor), então o avesso também
 * recebe a cor nova.
 */
import * as THREE from 'three';
import { GearZones, MaxZones } from '../build/PlayerLook';

const HexColor = /^#[0-9a-f]{6}$/;

/** Máscaras já baixadas, por peça (o PlayerGear espera por elas antes de vestir: a troca não pisca o uniforme antigo). */
const masks = new Map<string, THREE.Texture>();
const maskTasks = new Map<string, Promise<THREE.Texture>>();

/** Baixa a máscara de zonas da peça (uma vez; as seguintes voltam na hora). `base` = pasta dos assets. */
export function loadZoneMask(piece: string, base = 'assets/'): Promise<THREE.Texture> {
  const done = masks.get(piece);
  if (done) return Promise.resolve(done);
  let p = maskTasks.get(piece);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(`${base}look/zonas/${piece}_zonas.webp`).then((t) => {
      t.flipY = false; // UV do glTF
      t.colorSpace = THREE.NoColorSpace; // são pesos, não cor
      t.needsUpdate = true;
      masks.set(piece, t);
      return t;
    });
    maskTasks.set(piece, p);
  }
  return p;
}

/** Uniforms do shader de zonas (um conjunto por material). */
interface ZoneUniforms {
  uZoneMask: { value: THREE.Texture };
  uZoneOrig: { value: THREE.Color }[];
  uZoneNew: { value: THREE.Color }[];
  uZoneC: { value: number }[];
  uZoneS: { value: number }[];
}

const zoneUniformNames = (u: ZoneUniforms): Record<string, { value: unknown }> => {
  const out: Record<string, { value: unknown }> = { uZoneMask: u.uZoneMask };
  for (let i = 0; i < MaxZones; i++) {
    out[`uZoneOrig${i}`] = u.uZoneOrig[i]!;
    out[`uZoneNew${i}`] = u.uZoneNew[i]!;
    out[`uZoneC${i}`] = u.uZoneC[i]!;
    out[`uZoneS${i}`] = u.uZoneS[i]!;
  }
  return out;
};

const declarations = [
  'uniform sampler2D uZoneMask;',
  ...Array.from({ length: MaxZones }, (_, i) => `uniform vec3 uZoneOrig${i};\nuniform vec3 uZoneNew${i};\nuniform float uZoneC${i};\nuniform float uZoneS${i};`),
].join('\n');

const body = `
  {
    vec4 zw = texture2D(uZoneMask, vMapUv);
    float zs = zw.r + zw.g + zw.b + zw.a;
    if (zs > 0.01) {
      zw /= zs;
      vec3 zOrig = zw.r * uZoneOrig0 + zw.g * uZoneOrig1 + zw.b * uZoneOrig2 + zw.a * uZoneOrig3;
      vec3 zNew = zw.r * uZoneNew0 + zw.g * uZoneNew1 + zw.b * uZoneNew2 + zw.a * uZoneNew3;
      float zC = dot(zw, vec4(uZoneC0, uZoneC1, uZoneC2, uZoneC3));
      float zS = dot(zw, vec4(uZoneS0, uZoneS1, uZoneS2, uZoneS3));
      vec3 base = max(diffuseColor.rgb, vec3(1e-4));
      vec3 detail = base / max(zOrig, vec3(1e-3));
      // Zona trocada: a razão por canal explode onde a textura é clara numa zona escura (a listra branca do vermelho
      // viraria mancha da cor antiga); só o brilho e um limite de 1,6× ficam. Sem troca (zC = 1), a identidade é exata.
      if (zC < 0.999) detail = min(detail, vec3(1.6));
      float l = dot(detail, vec3(0.2126, 0.7152, 0.0722));
      // zS: quanto do sombreado da textura a zona leva (1 = todo; a zona trocada leva 30%, porque as pinceladas claras
      // e escuras da textura do HY viram listras da cor nova se ficarem com o contraste todo).
      vec3 shade = mix(vec3(1.0), mix(vec3(l), detail, zC), zS);
      diffuseColor.rgb = zNew * shade;
    }
  }`;

/** Instala o shader de zonas no material (uma vez). Encadeia no que já estiver (o avesso do PlayerGear). */
function install(m: THREE.MeshStandardMaterial, gear: string): ZoneUniforms {
  const u: ZoneUniforms = {
    uZoneMask: { value: null as unknown as THREE.Texture },
    uZoneOrig: Array.from({ length: MaxZones }, () => ({ value: new THREE.Color() })),
    uZoneNew: Array.from({ length: MaxZones }, () => ({ value: new THREE.Color() })),
    uZoneC: Array.from({ length: MaxZones }, () => ({ value: 1 })),
    uZoneS: Array.from({ length: MaxZones }, () => ({ value: 1 })),
  };
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, zoneUniformNames(u));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${declarations}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${body}`);
  };
  // Mesma cadeia de shader = mesmo programa; as peças de pano (com o avesso) e o tênis têm cadeias diferentes.
  m.customProgramCacheKey = () => `gearColors:${gear}`;
  m.needsUpdate = true;
  m.userData.zones = u;
  return u;
}

/**
 * Pinta as zonas das peças de `root` (a malha de uma peça vestida, com `userData.piece` = nome do GLB). `colors` é a
 * cor de cada zona na ordem (0 = principal); '' ou ausente = a original. Sem a máscara baixada, não faz nada.
 */
export function paintZones(root: THREE.Object3D, piece: string, colors: readonly string[] | undefined): void {
  const mask = masks.get(piece);
  const orig = GearZones[piece];
  if (!mask || !orig) return;
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || mesh.userData.piece !== piece) return;
    for (const m of ([] as THREE.Material[]).concat(mesh.material) as THREE.MeshStandardMaterial[]) {
      if (!m.map) continue;
      const u = (m.userData.zones as ZoneUniforms | undefined) ?? install(m, String(mesh.userData.gear));
      u.uZoneMask.value = mask;
      for (let i = 0; i < MaxZones; i++) {
        const from = orig[i] ?? '#808080';
        const to = colors?.[i] && HexColor.test(colors[i]!) ? colors[i]! : from;
        u.uZoneOrig[i]!.value.set(from);
        u.uZoneNew[i]!.value.set(to);
        // Croma: 1 na cor original; cai até 0 quando a cor muda (em linear, distância de 0,25 ou mais = trocada).
        const d = Math.hypot(u.uZoneNew[i]!.value.r - u.uZoneOrig[i]!.value.r, u.uZoneNew[i]!.value.g - u.uZoneOrig[i]!.value.g, u.uZoneNew[i]!.value.b - u.uZoneOrig[i]!.value.b);
        const t = Math.min(1, d / 0.25);
        const k = t * t * (3 - 2 * t);
        u.uZoneC[i]!.value = 1 - k;
        u.uZoneS[i]!.value = 1 - 0.7 * k;
      }
    }
  });
}
