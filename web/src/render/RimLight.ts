// Contraluz dos jogadores (docs/28-render.md, direção de arte). Uma luz de cena por trás estoura o verniz do piso; aqui
// o recorte entra só no material do jogador: um brilho frio na borda da silhueta (Fresnel), mais forte no que aponta
// para cima, somado à luz difusa. É o que separa o jogador da torcida escura na câmera do jogo.
import type * as THREE from 'three';
import { RenderLook } from './RenderLook';

const Chunk = /* glsl */ `#include <lights_fragment_end>
  {
    vec3 rimView = normalize(vViewPosition);
    float rimEdge = pow(1.0 - saturate(dot(normal, rimView)), 3.0);
    float rimUp = 0.35 + 0.65 * saturate(normal.y * 0.5 + 0.5);
    reflectedLight.directDiffuse += vec3(0.86, 0.92, 1.0) * (RIM_STRENGTH * rimEdge * rimUp) * (diffuseColor.rgb * 0.6 + 0.08);
  }`;

/** Liga a contraluz no material (encadeia no `onBeforeCompile` que já houver). Sem efeito no render antigo. */
export function addRimLight(material: THREE.Material): void {
  if (RenderLook.rim <= 0 || material.userData.rim) return;
  material.userData.rim = true;
  const prev = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', Chunk.replace('RIM_STRENGTH', RenderLook.rim.toFixed(2)));
  };
  material.needsUpdate = true;
}
