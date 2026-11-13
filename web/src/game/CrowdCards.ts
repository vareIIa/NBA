// Torcida em cartões (docs/28-render.md, "Otimização"). A torcida 3D custava 7 ms de um quadro de 9,6 ms: ~4.100 pessoas
// de 1,5 mil triângulos. Do 2º anel para trás, cada pessoa vira um quadrado de 2 triângulos com a foto do modelo, que
// gira em pé para a câmera. As fotos saem dos próprios modelos, uma vez, no carregamento (um atlas só), e são lidas de
// volta para uma textura comum: assim valem em qualquer WebGLRenderer (as ferramentas desenham a cena com outro).
import * as THREE from 'three';

const CellW = 256;
const CellH = 384;
const Columns = 5;

export interface CrowdAtlas {
  texture: THREE.DataTexture;
  /** Quadrado de cada modelo (mesma ordem das malhas dadas), com a UV da célula dele no atlas. */
  cards: THREE.BufferGeometry[];
}

/** Fotografa cada modelo de frente (+Z), só com a cor da textura (a luz vem do jogo), e monta o atlas. */
export function bakeCrowdAtlas(renderer: THREE.WebGLRenderer, sources: readonly THREE.Mesh[]): CrowdAtlas {
  const rows = Math.ceil(sources.length / Columns);
  const width = CellW * Columns;
  const height = CellH * rows;
  const target = new THREE.WebGLRenderTarget(width, height);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera();
  // O alvo guarda o que o shader escreve: a cor sai já em sRGB (8 bits lineares perderiam os tons escuros).
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: null as THREE.Texture | null } },
    vertexShader: 'varying vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}',
    fragmentShader: `uniform sampler2D map;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(map, vUv).rgb;
  gl_FragColor = vec4(mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)), 1.0);
}`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(sources[0].geometry, material);
  scene.add(mesh);

  const previous = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new THREE.Color());
  const alpha = renderer.getClearAlpha();
  const autoClear = renderer.autoClear;
  // Fundo transparente numa cor média de roupa: os mips misturam a borda com ele (preto dava contorno escuro).
  renderer.setClearColor(0x5a5350, 0);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.autoClear = false;
  target.scissorTest = true;

  const cards: THREE.BufferGeometry[] = [];
  const box = new THREE.Box3();
  sources.forEach((source, i) => {
    box.setFromBufferAttribute(source.geometry.attributes.position as THREE.BufferAttribute);
    // Enquadra a caixa do modelo na proporção da célula, com 4% de folga.
    const cx = (box.min.x + box.max.x) / 2;
    const cy = (box.min.y + box.max.y) / 2;
    let hw = ((box.max.x - box.min.x) / 2) * 1.04;
    let hh = ((box.max.y - box.min.y) / 2) * 1.04;
    if (hw / hh < CellW / CellH) hw = (hh * CellW) / CellH;
    else hh = (hw * CellH) / CellW;
    camera.left = -hw;
    camera.right = hw;
    camera.top = hh;
    camera.bottom = -hh;
    camera.near = 0.01;
    camera.far = box.max.z - box.min.z + 2;
    camera.position.set(cx, cy, box.max.z + 1);
    camera.rotation.set(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const col = i % Columns;
    const row = Math.floor(i / Columns);
    target.viewport.set(col * CellW, row * CellH, CellW, CellH);
    target.scissor.set(col * CellW, row * CellH, CellW, CellH);
    renderer.setRenderTarget(target);
    mesh.geometry = source.geometry;
    material.uniforms.map.value = (source.material as THREE.MeshStandardMaterial).map;
    renderer.render(scene, camera);

    // Meio texel para dentro: a célula vizinha não vaza na borda.
    const u0 = (col * CellW + 0.5) / width;
    const u1 = ((col + 1) * CellW - 0.5) / width;
    const v0 = (row * CellH + 0.5) / height;
    const v1 = ((row + 1) * CellH - 0.5) / height;
    const card = new THREE.BufferGeometry();
    card.setAttribute('position', new THREE.Float32BufferAttribute([cx - hw, cy - hh, 0, cx + hw, cy - hh, 0, cx + hw, cy + hh, 0, cx - hw, cy + hh, 0], 3));
    card.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
    // Normal para a frente e para cima: o cartão pega a luz do teto como o ombro e o colo de quem está sentado.
    card.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0.6, 0.8, 0, 0.6, 0.8, 0, 0.6, 0.8, 0, 0.6, 0.8], 3));
    card.setIndex([0, 1, 2, 0, 2, 3]);
    cards.push(card);
  });

  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  renderer.setRenderTarget(previous);
  renderer.setClearColor(clear, alpha);
  renderer.autoClear = autoClear;
  target.dispose();
  material.dispose();

  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, cards };
}

/**
 * Vértice do cartão: gira em torno do eixo vertical para ficar de frente para a câmera (a do quadro, a do reflexo ou a
 * da captura do ambiente), no lugar e na escala da instância. Entra no lugar do `project_vertex` do material.
 */
export const CardProjectVertex = /* glsl */ `
  vec4 cardOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 cardScale = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vec3 cardToCamera = cameraPosition - cardOrigin.xyz;
  cardToCamera.y = 0.0;
  vec3 cardRight = normalize(cross(vec3(0.0, 1.0, 0.0), cardToCamera));
  vec3 cardWorld = cardOrigin.xyz + cardRight * (transformed.x * cardScale.x) + vec3(0.0, transformed.y * cardScale.y, 0.0);
  vec4 mvPosition = viewMatrix * vec4(cardWorld, 1.0);
  gl_Position = projectionMatrix * mvPosition;
`;
