// Ponto de entrada do jogo (three.js). Monta a cena, carrega o jogador animado, liga o núcleo e expõe um gancho de
// depuração para o Playwright.
import * as THREE from 'three';
import './style.css';
import { PlayerAnimator } from './anim/PlayerAnimator';
import { CameraRig } from './game/CameraRig';
import { buildCourt } from './game/Court';
import { Freestyle, type ShotRecord } from './game/Freestyle';
import { buildHoop } from './game/HoopMesh';
import { Input } from './game/Input';
import { TimingGrade } from './sim';
import { Hud } from './hud/Hud';
import { Sfx } from './audio/Sfx';

declare global {
  interface Window {
    __garrafao?: {
      ready: boolean;
      frame: number;
      phase: () => string;
      shots: () => ShotRecord[];
      moves: () => string[];
      player: () => { x: number; y: number; vx: number; vy: number };
      energy: () => number;
      fps: () => number;
      anim: () => { base: string; action: string | null; ballMode: string; ballHand: string; ballY: number };
      /** Amostras da bola no drible: altura mínima, maior distância horizontal ao jogador, quiques e trocas de mão. */
      ballStats: () => { minY: number; maxDist: number; bounces: number; handChanges: number; samples: number };
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
scene.fog = new THREE.Fog(0x0b0d12, 30, 70);

const hud = new Hud();
const input = new Input();
const sfx = new Sfx();
// O navegador só libera o som depois de um gesto (tecla, clique; o controle conta quando a página já tem foco).
for (const type of ['keydown', 'pointerdown']) window.addEventListener(type, () => sfx.unlock());
const rig = new CameraRig(window.innerWidth / window.innerHeight);
const params = new URLSearchParams(location.search);
const camParam = params.get('cam');
if (camParam === 'lado' || camParam === 'frente') rig.mode = camParam;
// Câmera lenta de inspeção da animação (?lento=0.25). O timing do arremesso usa o relógio real: não arremesse nela.
const timeScale = Math.min(1, Math.max(0.05, Number(params.get('lento') ?? 1)));

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  rig.camera.aspect = window.innerWidth / window.innerHeight;
  rig.camera.updateProjectionMatrix();
});

async function boot(): Promise<void> {
  hud.setLoading('Carregando o jogador…');
  const animator = await PlayerAnimator.load('assets/hoops_player.glb', 'assets/hoops_player.clips.json');
  hud.setLoading(null);

  let made = 0;
  const game: Freestyle = new Freestyle(scene, animator, {
    onRelease: (evaluation) => {
      hud.freezeMeter(evaluation);
      hud.showRelease(evaluation);
      if (evaluation.timing === TimingGrade.Green) sfx.ding();
    },
    onFloorBounce: (speed) => sfx.bounce(speed),
    onRim: () => sfx.rim(),
    onBoard: () => sfx.rim(),
    onScore: () => sfx.swish(),
    onResult: (record) => {
      made += record.scored ? 1 : 0;
      hud.showResult(record, made, game.history.length);
    },
    onMove: (label, detail) => hud.showMove(label, detail),
  });
  buildCourt(scene, renderer, game.layout);
  buildHoop(scene, game.hoop);

  let fps = 60;
  const debug = {
    ready: false,
    frame: 0,
    phase: () => game.phase,
    shots: () => game.history,
    moves: () => game.moves,
    player: () => ({ x: game.position.x, y: game.position.y, vx: game.velocity.x, vy: game.velocity.y }),
    energy: () => game.dribble.getEnergy(),
    fps: () => fps,
    anim: () => ({
      base: animator.baseClip(),
      action: animator.actionKind(),
      ballMode: game.dribbler.mode,
      ballHand: game.dribbler.ballHand(),
      ballY: game.ballMesh.position.y,
    }),
  };
  const stats = { minY: Infinity, maxDist: 0, bounces: 0, handChanges: 0, samples: 0 };
  let lastHand = game.dribbler.ballHand();
  let lastMode = game.dribbler.mode;
  const sampleBall = (): void => {
    if (game.phase !== 'dribble') return;
    const ball = game.ballMesh.position;
    const root = animator.root.position;
    stats.minY = Math.min(stats.minY, ball.y);
    stats.maxDist = Math.max(stats.maxDist, Math.hypot(ball.x - root.x, ball.z - root.z));
    if (game.dribbler.mode === 'air' && lastMode === 'held') stats.bounces++;
    if (game.dribbler.ballHand() !== lastHand) stats.handChanges++;
    lastHand = game.dribbler.ballHand();
    lastMode = game.dribbler.mode;
    stats.samples++;
  };
  window.__garrafao = { ...debug, ballStats: () => ({ ...stats }) };
  (window as unknown as { __debug: unknown }).__debug = { animator, game, THREE };

  let last = performance.now();
  let gameClock = performance.now() / 1000;
  const frame = (now: number): void => {
    const realDt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const dt = realDt * timeScale;
    gameClock += timeScale === 1 ? realDt : dt;
    if (timeScale === 1) gameClock = now / 1000;
    fps += (1 / Math.max(realDt, 1e-3) - fps) * 0.05;

    const state = input.read();
    if (state.gamepadConnected && (state.shoot || state.sprint)) sfx.unlock();
    game.update(gameClock, dt, state, rig.forward());
    rig.playerFacing = game.facing;
    rig.update(dt, game.position, game.rimCenter());

    if (game.phase === 'gather' && game.windows) {
      const head = rig.project(game.headPoint(), window.innerWidth, window.innerHeight);
      hud.showMeter(head.x, head.y, game.holdMs, game.windows);
    }
    hud.update(dt, game.dribble.getEnergy(), state.gamepadConnected);
    sampleBall();

    renderer.render(scene, rig.camera);
    debug.frame++;
    window.__garrafao!.frame = debug.frame;
    if (debug.frame === 3) window.__garrafao!.ready = true;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((error: unknown) => {
  console.error(error);
  hud.setLoading(`Erro ao carregar: ${String(error)}`);
});
