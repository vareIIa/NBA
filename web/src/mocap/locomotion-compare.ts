// Locomoção lado a lado (Fase 2): à esquerda o jogador de hoje (PlayerAnimator, loops da CMU com todo o pós-processo),
// à direita a locomoção nova (clipes do Mixamo misturados por direção e velocidade). Os dois seguem o mesmo roteiro de
// velocidade (mesma aceleração do jogo) olhando para a frente, sem bola, para comparar pernas, passada e tronco.
//
// URL: /locomocao.html?cam=tras|lado|frente|cima&drible=1
// Playwright: window.__loco.step(n) avança n quadros de 1/60 s e desenha; window.__loco.metrics() devolve deslize do pé
// e estalos dos dois.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PlayerAnimator } from '../anim/PlayerAnimator';
import { MixamoLocomotion } from './MixamoLocomotion';
import type { MixamoFile } from './Retarget';

const params = new URLSearchParams(location.search);
const camName = params.get('cam') ?? 'tras';
const dribbleLayer = params.get('drible') !== '0';
import { PlayerHeightMeters as PlayerHeight } from '../anim/ProceduralMoves';
const GroundOffset = 0.028;
const Gap = 0.8; // metade da distância entre os dois (m)
const Accel = 6.5; // m/s² (Freestyle)
const Decel = 14;

/** Roteiro: [tempo de início (s), velocidade alvo no referencial do corpo (right, forward), rótulo]. */
const Script: [number, number, number, string][] = [
  [0, 0, 0, 'parado'],
  [0.8, 0, 1.6, 'andando para a frente'],
  [2.2, 0, 3.9, 'trotando (velocidade do jogo)'],
  [4.0, -2.4, 0, 'deslizando para a esquerda'],
  [5.6, 0, -1.4, 'recuando'],
  [7.0, 2.1, 2.1, 'diagonal frente-direita'],
  [8.6, 0, 6.2, 'disparando (RT)'],
  [10.2, 0, 0, 'freando'],
  [11.4, 0, 0, 'fim'],
];

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
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
scene.add(sun);
scene.add(sun.target);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0xc8a06a, roughness: 0.8 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(80, 160, 0x000000, 0x000000);
(grid.material as THREE.Material).opacity = 0.18;
(grid.material as THREE.Material).transparent = true;
grid.position.y = 0.002;
scene.add(grid);
const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 200);

function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const label = document.getElementById('fase')!;

/** Métricas de um jogador: deslize da ponta do pé apoiada e estalos (aceleração angular dos ossos). */
class Meter {
  slideMax = 0;
  slideSum = 0;
  slideN = 0;
  pops = 0;
  private prevToe = new Map<string, THREE.Vector3>();
  private prevQ = new Map<string, THREE.Quaternion>();
  private prevW = new Map<string, number>();
  constructor(private readonly bones: Map<string, THREE.Object3D>) {}
  sample(dt: number): void {
    const v = new THREE.Vector3();
    for (const toe of ['ball_l', 'ball_r']) {
      const p = this.bones.get(toe)!.getWorldPosition(v).clone();
      const prev = this.prevToe.get(toe);
      if (prev && p.y < 0.06) {
        const s = Math.hypot(p.x - prev.x, p.z - prev.z) / dt;
        this.slideMax = Math.max(this.slideMax, s);
        this.slideSum += s;
        this.slideN++;
      }
      this.prevToe.set(toe, p);
    }
    const q = new THREE.Quaternion();
    for (const name of ['pelvis', 'spine_02', 'head', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r', 'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r']) {
      this.bones.get(name)!.getWorldQuaternion(q);
      const pq = this.prevQ.get(name);
      if (pq) {
        const w = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(pq.dot(q))))) / dt;
        const pw = this.prevW.get(name);
        if (pw !== undefined && Math.abs(w - pw) / dt > 20000) this.pops++;
        this.prevW.set(name, w);
        pq.copy(q);
      } else {
        this.prevQ.set(name, q.clone());
      }
    }
  }
  result() {
    return { footSlideMax: +this.slideMax.toFixed(2), footSlideMean: +(this.slideSum / Math.max(1, this.slideN)).toFixed(2), pops: this.pops };
  }
}

function bonesOf(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const m = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) m.set(o.name, o);
  });
  return m;
}

async function main(): Promise<void> {
  const [current, gltf, file] = await Promise.all([
    PlayerAnimator.load('/assets/hoops_player.glb', '/assets/hoops_player.clips.json', { mixamo: params.get('atual') === 'mixamo' }),
    new GLTFLoader().loadAsync('/assets/hoops_player.glb'),
    fetch('/assets/mocap/mixamo_loco.json').then((r) => r.json() as Promise<MixamoFile>),
  ]);
  scene.add(current.root);

  // Jogador novo: o mesmo GLB, na mesma escala e altura do PlayerAnimator.
  const fresh = new THREE.Group();
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
  fresh.add(model);
  scene.add(fresh);
  fresh.updateMatrixWorld(true);
  const loco = new MixamoLocomotion(model, file, { dribbleLayer });
  console.log('loops', JSON.stringify(loco.describe()));

  const meters = [new Meter(bonesOf(current.root)), new Meter(bonesOf(model))];
  const body = { pos: new THREE.Vector3(), vel: new THREE.Vector2() }; // vel: (right, forward)
  let time = 0;
  const dt = 1 / 60;
  const target = new THREE.Vector2();

  const step = (): void => {
    let cur = Script[0];
    for (const sc of Script) if (time >= sc[0]) cur = sc;
    target.set(cur[1], cur[2]);
    const prev = body.vel.clone();
    const delta = target.clone().sub(body.vel);
    const a = (target.length() > 0.1 ? Accel : Decel) * dt;
    if (delta.length() <= a) body.vel.copy(target);
    else body.vel.add(delta.normalize().multiplyScalar(a));
    // Olhando para +Z: frente = +Z, direita = -X.
    body.pos.x += -body.vel.x * dt;
    body.pos.z += body.vel.y * dt;
    const accel = body.vel.clone().sub(prev).divideScalar(dt);

    // De lado (câmera em -X) um ficaria atrás do outro: a separação vai para a frente/trás (Z), o de hoje à esquerda.
    const off = camName === 'lado' ? new THREE.Vector3(0, 0, -1.1) : new THREE.Vector3(Gap, 0, 0);
    current.root.position.set(body.pos.x + off.x, 0, body.pos.z + off.z);
    current.root.rotation.y = 0;
    current.root.updateMatrixWorld(true);
    current.update(dt, { right: body.vel.x, forward: body.vel.y, ballHand: 'r', hasBall: dribbleLayer, low: false, accelRight: accel.x, accelForward: accel.y });
    fresh.position.set(body.pos.x - off.x, 0, body.pos.z - off.z);
    fresh.updateMatrixWorld(true);
    loco.update(dt, body.vel.x, body.vel.y);
    fresh.updateMatrixWorld(true);
    current.root.updateMatrixWorld(true);
    for (const m of meters) m.sample(dt);
    time += dt;
    label.textContent = `${time.toFixed(2)} s — ${cur[3]} — ${body.vel.length().toFixed(1)} m/s`;
  };

  const views: Record<string, (c: THREE.Vector3) => [THREE.Vector3, THREE.Vector3]> = {
    tras: (c) => [new THREE.Vector3(c.x, 2.4, c.z - 6.5), new THREE.Vector3(c.x, 0.9, c.z + 1)],
    lado: (c) => [new THREE.Vector3(c.x - 8.5, 1.1, c.z), new THREE.Vector3(c.x, 0.8, c.z)],
    frente: (c) => [new THREE.Vector3(c.x, 1.3, c.z + 6.5), new THREE.Vector3(c.x, 0.8, c.z)],
    cima: (c) => [new THREE.Vector3(c.x, 9, c.z + 0.01), new THREE.Vector3(c.x, 0, c.z)],
  };
  const render = (): void => {
    const c = body.pos.clone();
    const [eye, look] = (views[camName] ?? views.tras)(c);
    camera.position.copy(eye);
    camera.lookAt(look);
    sun.position.set(c.x + 3, 6, c.z + 4);
    sun.target.position.copy(c);
    renderer.render(scene, camera);
  };
  resize();
  render();

  let auto = true;
  const loop = (): void => {
    if (!auto) return;
    step();
    if (time > Script[Script.length - 1][0]) time = 0;
    render();
    requestAnimationFrame(loop);
  };
  if (params.get('auto') !== '0') loop();
  (window as unknown as { __loco: unknown }).__loco = {
    ready: true,
    step: (n: number) => {
      auto = false;
      for (let i = 0; i < n; i++) step();
      render();
      return time;
    },
    metrics: () => ({ atual: meters[0].result(), mixamo: meters[1].result() }),
    loops: () => loco.describe(),
  };
}

main().catch((e) => {
  document.body.insertAdjacentHTML('beforeend', `<pre class="err">${String(e?.stack ?? e)}</pre>`);
  throw e;
});
