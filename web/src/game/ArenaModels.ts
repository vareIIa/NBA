// Modelos da arena (lote "arena" do HY 3D, otimizados por Tools/Animacao/arena.py em assets/arena/<nome>.glb).
// Cada GLB tem uma malha só, em metros, frente para +Z (three) e origem no chão (ver o cabeçalho do arena.py).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Mesh>>();

/** Malha do modelo (a mesma instância para todos: clone() para pôr mais de uma na cena). */
export function arenaMesh(name: string): Promise<THREE.Mesh> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(`assets/arena/${name}.glb`).then((gltf) => {
      let mesh: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => {
        if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
      });
      if (!mesh) throw new Error(`${name}.glb sem malha`);
      const m = mesh as THREE.Mesh;
      m.updateWorldMatrix(true, false);
      m.geometry.applyMatrix4(m.matrixWorld); // o exportador já aplica tudo; garante a origem do arquivo
      m.position.set(0, 0, 0);
      m.rotation.set(0, 0, 0);
      m.scale.set(1, 1, 1);
      m.removeFromParent();
      m.name = name;
      return m;
    });
    cache.set(name, p);
  }
  return p;
}

/** Começa a baixar os modelos (o boot carrega o jogador ao mesmo tempo). */
export function preloadArena(names: readonly string[]): void {
  for (const n of names) arenaMesh(n).catch(() => undefined);
}
