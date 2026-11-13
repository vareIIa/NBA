// Render do jogo (docs/28-render.md). Um quadro:
//   1. reflexo do piso (FloorReflection, meia resolução, sem a arena pesada);
//   2. cena em HDR (meio-float) com MSAA 4x e textura de profundidade;
//   3. oclusão de ambiente (GTAO do three, em meia resolução, normais tiradas da profundidade: sem redesenhar a cena);
//   4. bloom (cadeia de redução/ampliação de 5 níveis, a partir de meia resolução);
//   5. saída: AO × cena + bloom, tone mapping ACES, gradação, vinheta e dither, direto na tela.
// Mais a captura do ambiente (captureEnvironment): a própria arena vira o mapa de ambiente (luz de preenchimento e
// brilho especular de tudo), tirada uma vez.
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FloorReflection } from './FloorReflection';
import { RenderLook, RenderOn } from './RenderLook';

const BloomLevels = 5;

const QuadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Redução de 13 amostras (Jimenez, SIGGRAPH 2014): estável em movimento (o texto do LED não pisca no bloom).
const DownFragment = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
vec3 tap(float x, float y) { return min(texture2D(tSrc, vUv + uTexel * vec2(x, y)).rgb, vec3(24.0)); }
void main() {
  vec3 c = tap(0.0, 0.0) * 0.125;
  c += (tap(-2.0, 2.0) + tap(2.0, 2.0) + tap(-2.0, -2.0) + tap(2.0, -2.0)) * 0.03125;
  c += (tap(0.0, 2.0) + tap(-2.0, 0.0) + tap(2.0, 0.0) + tap(0.0, -2.0)) * 0.0625;
  c += (tap(-1.0, 1.0) + tap(1.0, 1.0) + tap(-1.0, -1.0) + tap(1.0, -1.0)) * 0.125;
  if (uThreshold > 0.0) {
    // Limiar com joelho suave: só o que passa do branco da tela brilha.
    float bright = max(c.r, max(c.g, c.b));
    float knee = uThreshold * 0.5;
    float soft = clamp(bright - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    c *= max(soft, bright - uThreshold) / max(bright, 1e-4);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

// Ampliação em tenda 3x3, somada (blending aditivo) ao nível de cima.
const UpFragment = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 tap(float x, float y) { return texture2D(tSrc, vUv + uTexel * vec2(x, y)).rgb; }
void main() {
  vec3 c = tap(0.0, 0.0) * 4.0;
  c += (tap(-1.0, 0.0) + tap(1.0, 0.0) + tap(0.0, -1.0) + tap(0.0, 1.0)) * 2.0;
  c += tap(-1.0, -1.0) + tap(1.0, -1.0) + tap(-1.0, 1.0) + tap(1.0, 1.0);
  gl_FragColor = vec4(c / 16.0, 1.0);
}`;

const OutputFragment = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tAO;
uniform sampler2D tBloom;
uniform float uAO;
uniform float uBloom;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform float uTime;
uniform sampler2D tDepth;
uniform float uDof;
uniform vec2 uDepthRange;
uniform vec2 uTexel;
varying vec2 vUv;

float viewDepth(vec2 uv) {
  float ndc = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * uDepthRange.x * uDepthRange.y / (uDepthRange.y + uDepthRange.x - ndc * (uDepthRange.y - uDepthRange.x));
}
// Profundidade de campo (vitrine do menu): foca sozinha no que está mais perto numa grade de 9 pontos (o jogador) e
// desfoca só o que fica atrás dele. Raio em pixels para a profundidade dada.
float blurRadius(float depth, float focus) {
  return uDof * clamp((depth - focus - 0.7) / (focus * 1.2), 0.0, 1.0);
}
vec3 depthOfField(vec3 sharp) {
  float focus = 1e6;
  for (int y = 0; y < 3; y++) for (int x = 0; x < 3; x++) focus = min(focus, viewDepth(vec2(0.25 + 0.25 * float(x), 0.25 + 0.25 * float(y))));
  float radius = blurRadius(viewDepth(vUv), focus);
  if (radius < 0.5) return sharp;
  vec4 sum = vec4(sharp, 1.0);
  // Espiral de 16 amostras (ângulo de ouro). O que está em foco não vaza para o fundo.
  for (int i = 1; i <= 16; i++) {
    float r = sqrt(float(i) / 16.0) * radius;
    float a = float(i) * 2.39996;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uTexel;
    float w = smoothstep(0.0, 2.0, blurRadius(viewDepth(uv), focus));
    sum += vec4(min(texture2D(tScene, uv).rgb, vec3(16.0)), 1.0) * w;
  }
  return sum.rgb / sum.a;
}

// ACES Filmic (o mesmo ajuste do three: Stephen Hill), para o render novo sair com o tom do antigo.
vec3 rrtOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 inputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = inputMat * color;
  color = rrtOdtFit(color);
  color = outputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  if (uDof > 0.0) c = depthOfField(c);
  c *= mix(1.0, texture2D(tAO, vUv).r, uAO);
  c += texture2D(tBloom, vUv).rgb * uBloom;
  c = aces(c);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;
  vec2 d = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.18, 0.75, dot(d, d) * 2.0);
  c = toSRGB(clamp(c, 0.0, 1.0));
  // Dither de 1/255: tira as faixas dos degradês escuros da arena.
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uTime * 61.0, vec2(0.06711056, 0.00583715))));
  gl_FragColor = vec4(c + (noise - 0.5) / 255.0, 1.0);
}`;

function quadMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, additive = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: QuadVertex,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NoBlending,
  });
}

export class RenderPipeline {
  readonly enabled = RenderOn;
  readonly reflection: FloorReflection;
  /** Ajustes da saída (o laboratório de aparência pode mexer ao vivo por `__debug.render.look`). */
  readonly look = { ao: 1, bloom: 0.07, bloomThreshold: 1.05, exposure: 0.94, saturation: 1.1, contrast: 1.08, vignette: 0.26, dof: 0 };

  private readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly gtao: GTAOPass;
  private readonly bloom: THREE.WebGLRenderTarget[] = [];
  private readonly down = quadMaterial(DownFragment, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 } });
  private readonly up = quadMaterial(UpFragment, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, true);
  private readonly output = quadMaterial(OutputFragment, {
    tScene: { value: null },
    tAO: { value: null },
    tBloom: { value: null },
    uAO: { value: 1 },
    uBloom: { value: 0 },
    uExposure: { value: 1 },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uVignette: { value: 0 },
    uTime: { value: 0 },
    tDepth: { value: null },
    uDof: { value: 0 },
    uDepthRange: { value: new THREE.Vector2(0.1, 100) },
    uTexel: { value: new THREE.Vector2() },
  });
  private readonly quad = new FullScreenQuad();
  private readonly size = new THREE.Vector2();
  private frames = 0;

  constructor(readonly renderer: THREE.WebGLRenderer) {
    renderer.getDrawingBufferSize(this.size);
    const { x: w, y: h } = this.size;
    this.sceneTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(w, h),
    });
    this.reflection = new FloorReflection(w, h);
    // GTAO: a cena do construtor só serviria para ele desenhar o próprio G-buffer; aqui ele lê a profundidade do quadro.
    this.gtao = new GTAOPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 1, 1);
    this.gtao.setGBuffer(this.sceneTarget.depthTexture!);
    this.gtao.output = GTAOPass.OUTPUT.Off;
    this.gtao.updateGtaoMaterial({ radius: 0.42, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 8, distanceFallOff: 1, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1.3, rings: 2, samples: 8 });
    for (let i = 0; i < BloomLevels; i++) {
      this.bloom.push(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
    }
    this.output.uniforms.tScene.value = this.sceneTarget.texture;
    this.output.uniforms.tAO.value = this.gtao.pdRenderTarget.texture;
    this.output.uniforms.tBloom.value = this.bloom[0].texture;
    this.output.uniforms.tDepth.value = this.sceneTarget.depthTexture;
    this.setSize();
  }

  /** Depois de `renderer.setSize`: os alvos seguem o tamanho do canvas em pixels de verdade. */
  setSize(): void {
    this.renderer.getDrawingBufferSize(this.size);
    const { x: w, y: h } = this.size;
    this.sceneTarget.setSize(w, h);
    this.reflection.setSize(w, h);
    this.gtao.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.bloom.forEach((target, i) => target.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))));
  }

  /** Compila os shaders da cena para o alvo HDR (sem isso o 1º quadro engasga: o programa da tela é outro). */
  async compile(scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
    if (!this.enabled) return void (await this.renderer.compileAsync(scene, camera));
    this.renderer.setRenderTarget(this.sceneTarget);
    try {
      await this.renderer.compileAsync(scene, camera);
    } finally {
      this.renderer.setRenderTarget(null);
    }
  }

  /**
   * A arena vira o mapa de ambiente da cena. Os refletores do teto (SpotLight não aparece em reflexo nenhum) entram como
   * painéis acesos só nesta captura: dão a luz de cima no ambiente e o brilho especular na pele, na bola e no tênis.
   * `hide` = o que não deve ficar gravado no ambiente (jogador, bola).
   */
  captureEnvironment(scene: THREE.Scene, center: THREE.Vector3, hide: readonly THREE.Object3D[] = []): void {
    if (!this.enabled) return;
    const cards = new THREE.Group();
    const card = new THREE.PlaneGeometry(3.2, 1.8);
    const lit = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(11, 11, 10.4, THREE.LinearSRGBColorSpace), side: THREE.DoubleSide, fog: false });
    scene.updateMatrixWorld();
    scene.traverse((o) => {
      if (!(o as THREE.SpotLight).isSpotLight) return;
      const mesh = new THREE.Mesh(card, lit);
      o.getWorldPosition(mesh.position);
      mesh.rotation.x = Math.PI / 2;
      cards.add(mesh);
    });
    scene.add(cards);
    const was = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    this.reflection.strength = 0;

    const cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const probe = new THREE.CubeCamera(0.1, 200, cube);
    probe.position.copy(center);
    probe.update(this.renderer, scene);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment?.dispose();
    scene.environment = pmrem.fromCubemap(cube.texture).texture;
    scene.environmentIntensity = RenderLook.environment;
    pmrem.dispose();
    cube.dispose();

    this.reflection.strength = 1;
    hide.forEach((o, i) => (o.visible = was[i]));
    scene.remove(cards);
    card.dispose();
    lit.dispose();
    this.renderer.setRenderTarget(null);
  }

  /** Telão e faixas de LED (MeshBasicMaterial com toneMapped = false) passam do branco: é o que o bloom pega. */
  boostUnlit(root: THREE.Object3D): void {
    if (!this.enabled) return;
    const seen = new Set<THREE.Material>();
    root.traverse((o) => {
      for (const m of ([] as THREE.Material[]).concat((o as THREE.Mesh).material ?? [])) {
        const basic = m as THREE.MeshBasicMaterial;
        if (!basic.isMeshBasicMaterial || basic.toneMapped || !basic.map || seen.has(m)) continue;
        seen.add(m);
        basic.color.multiplyScalar(RenderLook.unlitBoost);
      }
    });
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const renderer = this.renderer;
    if (!this.enabled) {
      renderer.render(scene, camera);
      return;
    }
    // O reflexo usa as sombras do quadro anterior: no 1º quadro elas ainda não existem.
    if (this.frames++ > 0) this.reflection.render(renderer, scene, camera);
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);

    const look = this.look;
    if (look.ao > 0) {
      this.gtao.camera = camera;
      this.gtao.render(renderer, this.sceneTarget, this.sceneTarget, 0, false);
    }

    // Bloom: desce 5 níveis (o 1º com o limiar) e sobe somando.
    const quad = this.quad;
    quad.material = this.down;
    let source: THREE.Texture = this.sceneTarget.texture;
    let sw = this.size.x;
    let sh = this.size.y;
    for (let i = 0; i < BloomLevels && look.bloom > 0; i++) {
      this.down.uniforms.tSrc.value = source;
      this.down.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      this.down.uniforms.uThreshold.value = i === 0 ? look.bloomThreshold : 0;
      renderer.setRenderTarget(this.bloom[i]);
      quad.render(renderer);
      source = this.bloom[i].texture;
      sw = this.bloom[i].width;
      sh = this.bloom[i].height;
    }
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    quad.material = this.up;
    for (let i = BloomLevels - 1; i > 0 && look.bloom > 0; i--) {
      this.up.uniforms.tSrc.value = this.bloom[i].texture;
      this.up.uniforms.uTexel.value.set(1 / this.bloom[i].width, 1 / this.bloom[i].height);
      renderer.setRenderTarget(this.bloom[i - 1]);
      quad.render(renderer);
    }
    renderer.autoClear = autoClear;

    const u = this.output.uniforms;
    u.uAO.value = look.ao;
    u.uBloom.value = look.bloom;
    u.uExposure.value = look.exposure * renderer.toneMappingExposure;
    u.uSaturation.value = look.saturation;
    u.uContrast.value = look.contrast;
    u.uVignette.value = look.vignette;
    u.uTime.value = this.frames % 1024;
    // `look.dof`: raio máximo do desfoque do fundo, em pixels de uma tela de 1080 de altura (0 = desligado).
    u.uDof.value = (look.dof * this.sceneTarget.height) / 1080;
    u.uDepthRange.value.set(camera.near, camera.far);
    u.uTexel.value.set(1 / this.sceneTarget.width, 1 / this.sceneTarget.height);
    quad.material = this.output;
    renderer.setRenderTarget(null);
    quad.render(renderer);
  }
}
