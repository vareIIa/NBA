// Comparação lado a lado (Fase 1): à esquerda o clipe atual da CMU, à direita o mesmo jogador com a pose do Kyrie
// tirada do vídeo (Retarget.ts). Sem pós-processo nenhum nos dois: é a qualidade do dado bruto que está em jogo.
//
// URL: /mocap.html?cam=lado|frente|tras|cima&cmu=Cross_R2L&vel=0.4&filtro=3
// Playwright: window.__mocap.setPhase(u) põe os dois no mesmo ponto do clipe (0..1) e desenha.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { type PoseFile, retargetPose } from './Retarget';

const params = new URLSearchParams(location.search);
const cmuName = params.get('cmu') ?? 'Cross_R2L';
const speed = Number(params.get('vel') ?? '0.4');
const smooth = Number(params.get('filtro') ?? '3');
const camName = params.get('cam') ?? 'lado';
import { PlayerHeightMeters as PlayerHeight } from '../anim/ProceduralMoves';
const GroundOffset = 0.028; // a ponta do pé da CMU fica ~3 cm acima do chão (mesmo valor do PlayerAnimator)
const Gap = 0.75;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1d22);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 4);
sun.castShadow = true;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0xc8a06a, roughness: 0.8 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(12, 24, 0x000000, 0x000000);
(grid.material as THREE.Material).opacity = 0.15;
(grid.material as THREE.Material).transparent = true;
grid.position.y = 0.002;
scene.add(grid);

const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 100);
const views: Record<string, [THREE.Vector3, THREE.Vector3]> = {
  lado: [new THREE.Vector3(5.2, 1.0, 0), new THREE.Vector3(0, 0.75, 0)],
  frente: [new THREE.Vector3(0, 1.1, 5.2), new THREE.Vector3(0, 0.75, 0)],
  tras: [new THREE.Vector3(0, 1.2, -5.2), new THREE.Vector3(0, 0.75, 0)],
  cima: [new THREE.Vector3(0, 8, 0.01), new THREE.Vector3(0, 0, 0)],
};

function resize(): void {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

function place(model: THREE.Object3D, x: number): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Box3().setFromObject(model);
  const s = PlayerHeight / (box.max.y - box.min.y);
  model.scale.setScalar(s);
  model.position.y = -box.min.y * s - GroundOffset;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) {
      m.castShadow = true;
      m.frustumCulled = false;
    }
  });
  g.add(model);
  g.position.x = x;
  scene.add(g);
  return g;
}

function label(text: string, cls: string): void {
  const d = document.createElement('div');
  d.className = `label ${cls}`;
  d.textContent = text;
  document.body.appendChild(d);
}

async function main(): Promise<void> {
  const gltf = await new GLTFLoader().loadAsync('/assets/hoops_player.glb');
  const pose = (await (await fetch('/assets/mocap/kyrie_cross.json')).json()) as PoseFile;
  const cmuModel = gltf.scene;
  const kyrieModel = cloneSkinned(gltf.scene);
  // Lado a lado na tela: a CMU à esquerda e o Kyrie à direita em toda câmera (de lado, a separação é em Z).
  const side = camName === 'tras' ? -1 : 1;
  const cmuGroup = place(cmuModel, 0);
  const kyrieGroup = place(kyrieModel, 0);
  if (camName === 'lado') {
    cmuGroup.position.z = Gap;
    kyrieGroup.position.z = -Gap;
  } else {
    cmuGroup.position.x = -Gap * side;
    kyrieGroup.position.x = Gap * side;
  }
  const kyrieClip = retargetPose(kyrieModel, pose, { speed, smooth, name: 'Kyrie_Cross' });
  const cmuClip = gltf.animations.find((c) => c.name === cmuName);
  if (!cmuClip) throw new Error(`clipe ${cmuName} não existe`);

  const mixers = [new THREE.AnimationMixer(cmuModel), new THREE.AnimationMixer(kyrieModel)];
  const actions = [mixers[0].clipAction(cmuClip), mixers[1].clipAction(kyrieClip)];
  for (const a of actions) a.play();
  const [eye, target] = views[camName] ?? views.lado;
  camera.position.copy(eye);
  camera.lookAt(target);
  resize();
  label(`CMU: ${cmuName} (${cmuClip.duration.toFixed(2)} s)`, 'left');
  label(`Kyrie (vídeo→MediaPipe→retarget, ${kyrieClip.duration.toFixed(2)} s)`, 'right');

  const setPhase = (u: number): void => {
    actions.forEach((a, i) => {
      a.time = (u % 1) * a.getClip().duration;
      mixers[i].update(0);
    });
    renderer.render(scene, camera);
  };
  let auto = true;
  const clock = new THREE.Clock();
  let u = 0;
  const loop = (): void => {
    if (!auto) return;
    // Os dois em loop no mesmo tempo normalizado (a duração do Kyrie depende do fator de câmera lenta).
    u = (u + clock.getDelta() / Math.max(cmuClip.duration, kyrieClip.duration)) % 1;
    setPhase(u);
    requestAnimationFrame(loop);
  };
  loop();
  (window as unknown as { __mocap: unknown }).__mocap = {
    ready: true,
    setPhase: (p: number) => {
      auto = false;
      setPhase(p);
    },
    durations: { cmu: cmuClip.duration, kyrie: kyrieClip.duration },
  };
}

main().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre class="err">${String(e?.stack ?? e)}</pre>`);
  throw e;
});
