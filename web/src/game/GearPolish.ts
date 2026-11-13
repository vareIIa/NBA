// Tecido do uniforme (docs/28-render.md, Fase 3 em código). Nada aqui muda os GLBs: a regata e a bermuda eram cor
// lisa; ganham a trama de malha esportiva num mapa de normal que se repete (gerado aqui, sem arquivo) e o brilho rasante
// de tecido (sheen).
import * as THREE from 'three';
import { addRimLight } from '../render/RimLight';

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
export const GearPolishOn = params.get('render') !== '0' && params.get('lab') !== '1' && params.get('acabamento') !== '0';

let weave: THREE.DataTexture | null = null;

/** Mapa de normal da malha esportiva (furinhos em quincôncio), 64 px, que se repete. */
function weaveNormal(): THREE.DataTexture {
  if (weave) return weave;
  const size = 64;
  const cells = 4;
  const heightAt = (x: number, y: number): number => {
    // Dois furos por célula (um no canto, outro no meio): a altura cai num cone suave em volta de cada um.
    const u = ((x / size) * cells) % 1;
    const v = ((y / size) * cells) % 1;
    let d = 1;
    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]] as const) d = Math.min(d, Math.hypot(u - cx, v - cy));
    return Math.min(1, d / 0.3);
  };
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = heightAt(x + 1, y) - heightAt(x - 1 + size, y);
      const dy = heightAt(x, y + 1) - heightAt(x, y - 1 + size);
      const nx = -dx * 2.2;
      const ny = -dy * 2.2;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * size + x) * 4;
      data[o] = Math.round((nx / l) * 127.5 + 127.5);
      data[o + 1] = Math.round((ny / l) * 127.5 + 127.5);
      data[o + 2] = Math.round((1 / l) * 127.5 + 127.5);
      data[o + 3] = 255;
    }
  }
  weave = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.minFilter = THREE.LinearMipmapLinearFilter;
  weave.magFilter = THREE.LinearFilter;
  weave.generateMipmaps = true;
  weave.anisotropy = 8;
  // 4 células por repetição: ~1,4 mm por furo numa peça com a UV de ~60 cm de lado.
  weave.repeat.set(110, 110);
  weave.needsUpdate = true;
  return weave;
}

/**
 * Material de tecido para a regata e a bermuda: o mesmo material do GLB, com a trama e o brilho rasante. Devolve um
 * MeshPhysicalMaterial novo (o do GLB é Standard e não tem sheen); quem chama troca na malha.
 */
export function fabricMaterial(source: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  if (!GearPolishOn) return source;
  const fabric = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(fabric, source);
  fabric.normalMap = weaveNormal();
  fabric.normalScale.set(0.4, 0.4);
  fabric.sheen = 0.3;
  fabric.sheenRoughness = 0.45;
  fabric.sheenColor.set(0xffffff);
  source.dispose();
  addRimLight(fabric);
  return fabric;
}
