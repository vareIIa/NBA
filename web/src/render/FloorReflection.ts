// Reflexo dos jogadores no piso envernizado (docs/28-render.md). A cena é desenhada de novo por uma câmera espelhada no
// plano do chão (y = 0), em meia resolução e sem a arena pesada (arquibancada e torcida ficam de fora: 7 M de
// triângulos; o brilho delas no piso vem do mapa de ambiente). O material do piso soma esse reflexo borrado, mais forte
// em ângulo rasante (Fresnel).
import * as THREE from 'three';

const Up = new THREE.Vector3(0, 1, 0);

export class FloorReflection {
  readonly target: THREE.WebGLRenderTarget;
  /** Objetos que não entram no reflexo (a arena pesada e os próprios pisos). */
  readonly hidden: THREE.Object3D[] = [];
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly uniforms = {
    uReflMap: { value: null as THREE.Texture | null },
    uReflMatrix: { value: new THREE.Matrix4() },
    uReflTexel: { value: new THREE.Vector2() },
    uReflStrength: { value: 1 },
  };
  private installed = 0;
  private readonly was: boolean[] = [];
  private readonly clear = new THREE.Color();
  private readonly v = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly rot = new THREE.Matrix4();

  constructor(width: number, height: number) {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
    });
    this.uniforms.uReflMap.value = this.target.texture;
    this.setSize(width, height);
  }

  get active(): boolean {
    return this.installed > 0;
  }

  /** Força do reflexo (0 desliga sem recompilar; a captura do ambiente usa). */
  set strength(value: number) {
    this.uniforms.uReflStrength.value = value;
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width / 2));
    const h = Math.max(1, Math.floor(height / 2));
    this.target.setSize(w, h);
    this.uniforms.uReflTexel.value.set(1 / w, 1 / h);
  }

  /** Liga o reflexo num material de piso (plano em y = 0, normal para cima). O piso sai do desenho do reflexo. */
  install(mesh: THREE.Mesh): void {
    const material = mesh.material as THREE.MeshStandardMaterial;
    const u = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uReflMatrix;\nvarying vec4 vReflCoord;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvReflCoord = uReflMatrix * modelMatrix * vec4(transformed, 1.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D uReflMap;
uniform vec2 uReflTexel;
uniform float uReflStrength;
varying vec4 vReflCoord;`,
        )
        .replace(
          '#include <opaque_fragment>',
          `{
  vec2 ruv = vReflCoord.xy / vReflCoord.w;
  // Borrão do verniz: 7 amostras nos mips, mais abertas na vertical (o reflexo de um piso encerado estica para baixo).
  vec3 refl = textureLod(uReflMap, ruv, 1.0).rgb * 0.28;
  refl += textureLod(uReflMap, ruv + uReflTexel * vec2( 2.5,  3.5), 2.0).rgb * 0.12;
  refl += textureLod(uReflMap, ruv + uReflTexel * vec2(-2.5,  3.5), 2.0).rgb * 0.12;
  refl += textureLod(uReflMap, ruv + uReflTexel * vec2( 2.5, -3.5), 2.0).rgb * 0.12;
  refl += textureLod(uReflMap, ruv + uReflTexel * vec2(-2.5, -3.5), 2.0).rgb * 0.12;
  refl += textureLod(uReflMap, ruv + uReflTexel * vec2( 0.0,  7.0), 2.5).rgb * 0.12;
  refl += textureLod(uReflMap, ruv + uReflTexel * vec2( 0.0, -7.0), 2.5).rgb * 0.12;
  float ndv = saturate(dot(normal, normalize(vViewPosition)));
  // Verniz de quadra: mais refletivo que o Fresnel de um dielétrico liso (0,04), como nos jogos de referência.
  float fresnel = 0.13 + 0.87 * pow(1.0 - ndv, 3.5);
  outgoingLight += min(refl, vec3(4.0)) * fresnel * uReflStrength;
}
#include <opaque_fragment>`,
        );
    };
    material.customProgramCacheKey = () => 'piso-reflexo';
    material.needsUpdate = true;
    this.hidden.push(mesh);
    this.installed++;
  }

  /** Desenha o reflexo para a câmera dada. Chamar antes do desenho principal do quadro. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (!this.active) return;
    camera.updateMatrixWorld();
    const eye = this.v.setFromMatrixPosition(camera.matrixWorld);
    if (eye.y <= 0) return; // câmera abaixo do piso: não há reflexo a ver
    const mirror = this.camera;
    this.rot.extractRotation(camera.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(this.rot).add(eye);
    this.look.y = -this.look.y;
    mirror.position.set(eye.x, -eye.y, eye.z);
    mirror.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(Up);
    mirror.lookAt(this.look);
    mirror.near = camera.near;
    mirror.far = camera.far;
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(camera.projectionMatrix);
    mirror.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.uniforms.uReflMatrix.value
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(mirror.projectionMatrix)
      .multiply(mirror.matrixWorldInverse);

    for (let i = 0; i < this.hidden.length; i++) {
      this.was[i] = this.hidden[i].visible;
      this.hidden[i].visible = false;
    }
    const background = scene.background;
    const shadows = renderer.shadowMap.autoUpdate;
    const previous = renderer.getRenderTarget();
    renderer.getClearColor(this.clear);
    const alpha = renderer.getClearAlpha();
    scene.background = null;
    renderer.shadowMap.autoUpdate = false; // as sombras são as do quadro anterior (o desenho principal as refaz)
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.target);
    renderer.render(scene, mirror);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(this.clear, alpha);
    renderer.shadowMap.autoUpdate = shadows;
    scene.background = background;
    for (let i = 0; i < this.hidden.length; i++) this.hidden[i].visible = this.was[i];
  }
}
