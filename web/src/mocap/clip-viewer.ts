// Um clipe do Mixamo (mixamo_loco.json) no nosso jogador, retargetado como o jogo faz, com o deslocamento do quadril.
// Para ver um clipe antes de usá-lo (ex.: a virada de 180° correndo, ChangeDir).
//
// URL: /clipe-mixamo.html?clipe=ChangeDir&cam=lado|frente|tras|cima&espelho=1&vel=1
// Playwright: window.__clip.step(n) avança n quadros de 1/60 s e desenha; window.__clip.info() devolve o tempo e a duração.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PlayerHeightMeters as PlayerHeight } from '../anim/ProceduralMoves';
import { type MixamoFile, mirrorMixamoClip, retargetMixamo } from './Retarget';

const params = new URLSearchParams(location.search);
const clipName = params.get('clipe') ?? 'ChangeDir';
const camName = params.get('cam') ?? 'lado';
const speed = Number(params.get('vel') ?? 1);
const GroundOffset = 0.028;

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
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0xc8a06a, roughness: 0.8 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(80, 160, 0x000000, 0x000000);
(grid.material as THREE.Material).opacity = 0.25;
(grid.material as THREE.Material).transparent = true;
grid.position.y = 0.002;
scene.add(grid);
const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 200);
const label = document.getElementById('fase')!;

function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

async function main(): Promise<void> {
  const [gltf, file] = await Promise.all([
    new GLTFLoader().loadAsync('/assets/hoops_player.glb'),
    fetch('/assets/mocap/mixamo_loco.json').then((r) => r.json() as Promise<MixamoFile>),
  ]);
  const model = gltf.scene;
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
  const holder = new THREE.Group();
  holder.add(model);
  scene.add(holder);
  holder.updateMatrixWorld(true);
  let name = clipName;
  if (params.get('espelho') === '1') {
    mirrorMixamoClip(file, clipName, `${clipName}_espelho`);
    name = `${clipName}_espelho`;
  }
  const { clip } = retargetMixamo(model, file, name, { loop: false, smooth: 2 });
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const pelvis = model.getObjectByName('pelvis')!;
  let time = 0;
  const dt = 1 / 60;
  const step = (): void => {
    time = Math.min(clip.duration, time + dt * speed);
    action.time = time;
    mixer.update(0);
    holder.updateMatrixWorld(true);
    label.textContent = `${clipName} ${time.toFixed(2)} / ${clip.duration.toFixed(2)} s`;
  };
  const views: Record<string, (c: THREE.Vector3) => [THREE.Vector3, THREE.Vector3]> = {
    lado: (c) => [new THREE.Vector3(c.x - 6.5, 1.1, c.z), new THREE.Vector3(c.x, 0.75, c.z)],
    frente: (c) => [new THREE.Vector3(c.x, 1.3, c.z + 6.5), new THREE.Vector3(c.x, 0.75, c.z)],
    tras: (c) => [new THREE.Vector3(c.x, 1.8, c.z - 6.5), new THREE.Vector3(c.x, 0.75, c.z)],
    cima: (c) => [new THREE.Vector3(c.x, 8, c.z + 0.01), new THREE.Vector3(c.x, 0, c.z)],
    diag: (c) => [new THREE.Vector3(c.x - 4.6, 1.6, c.z + 4.6), new THREE.Vector3(c.x, 0.75, c.z)],
  };
  const render = (): void => {
    const c = pelvis.getWorldPosition(new THREE.Vector3()).setY(0);
    const [eye, look] = (views[camName] ?? views.lado)(c);
    camera.position.copy(eye);
    camera.lookAt(look);
    sun.position.set(c.x + 3, 6, c.z + 4);
    sun.target.position.copy(c);
    sun.target.updateMatrixWorld();
    renderer.render(scene, camera);
  };
  resize();
  step();
  render();
  (window as unknown as { __clip: unknown }).__clip = {
    ready: true,
    step: (n: number) => {
      for (let i = 0; i < n; i++) step();
      render();
      return time;
    },
    info: () => ({ time, duration: clip.duration }),
  };
}

main().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre class="err">${String(e?.stack ?? e)}</pre>`);
  throw e;
});
