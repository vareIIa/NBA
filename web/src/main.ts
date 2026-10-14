// Ponto de entrada do jogo (three.js). Monta a cena, liga o núcleo e expõe um gancho de depuração para o Playwright.
import * as THREE from 'three';
import './style.css';
import { CameraRig } from './game/CameraRig';
import { buildCourt } from './game/Court';
import { Freestyle, type ShotRecord } from './game/Freestyle';
import { buildHoop } from './game/HoopMesh';
import { Input } from './game/Input';
import { Hud } from './hud/Hud';

declare global {
  interface Window {
    __garrafao?: {
      ready: boolean;
      frame: number;
      phase: () => string;
      shots: () => ShotRecord[];
      player: () => { x: number; y: number };
      energy: () => number;
      fps: () => number;
    };
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.Fog(0x0b0d12, 28, 60);

const hud = new Hud();
const input = new Input();
const rig = new CameraRig(window.innerWidth / window.innerHeight);

let made = 0;
const game = new Freestyle(scene, {
  onRelease: (evaluation) => {
    hud.freezeMeter(evaluation);
    hud.showRelease(evaluation);
  },
  onResult: (record) => {
    made += record.scored ? 1 : 0;
    hud.showResult(record, made, game.history.length);
  },
});

const layout = game.layout;
buildCourt(scene, renderer, layout);
buildHoop(scene, game.hoop);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  rig.camera.aspect = window.innerWidth / window.innerHeight;
  rig.camera.updateProjectionMatrix();
});

const debug = {
  ready: false,
  frame: 0,
  phase: () => game.phase,
  shots: () => game.history,
  player: () => ({ x: game.position.x, y: game.position.y }),
  energy: () => game.dribble.getEnergy(),
  fps: () => fps,
};
window.__garrafao = debug;

let last = performance.now();
let fps = 60;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

  const state = input.read();
  game.update(now / 1000, dt, state, rig.forward());
  rig.update(dt, game.position, game.rimCenter());

  if (game.phase === 'gather' && game.windows) {
    const head = rig.project(game.headPoint(), window.innerWidth, window.innerHeight);
    hud.showMeter(head.x, head.y, game.holdMs, game.windows);
  }
  hud.update(dt, game.dribble.getEnergy(), state.gamepadConnected);

  renderer.render(scene, rig.camera);
  debug.frame++;
  if (debug.frame === 3) debug.ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
