// Ponto de entrada do jogo (three.js). Monta a cena, carrega o jogador animado, liga o núcleo e expõe um gancho de
// depuração para o Playwright.
import * as THREE from 'three';
import './style.css';
import { PlayerAnimator } from './anim/PlayerAnimator';
import { CameraRig } from './game/CameraRig';
import { buildCourt } from './game/Court';
import { Freestyle, type ShotRecord } from './game/Freestyle';
import { buildHoop, buildModelHoop } from './game/HoopMesh';
import { ArenaDressing } from './game/ArenaDressing';
import { Input } from './game/Input';
import { TimingGrade } from './sim';
import { Hud } from './hud/Hud';
import { GameHud } from './hud/GameHud';
import { MatchDirector } from './game/MatchDirector';
import { PlayerRing } from './game/PlayerRing';
import { NetMesh } from './game/NetMesh';
import { DirectorLoadout } from './game/MatchDirector';
import { loadBuild, saveBuild } from './game/BuildStore';
import { BadgeMenu } from './hud/BadgeMenu';
import { PauseMenu } from './hud/PauseMenu';
import { type JumpShotSetup, JumpShotStore, idealReleaseSeconds } from './shot/JumpShotSetup';
import { toThree } from './units';
import { Sfx } from './audio/Sfx';
import { Lab } from './lab/Lab';
import { PlayerGear } from './game/PlayerGear';
import { BuildSave } from './build/BuildSave';
import { DefaultBuild, archetypeName, badgePoints } from './build/BuildRules';
import { applyDribbleRatings, bodyScaleOf, playRatings, wingspanOverModelM } from './build/BuildRatings';
import { fitLoadout } from './build/BuildBadges';
import { displayName, formatMeters } from './build/PlayerBuild';

/** Y do controle (botão 3 do mapeamento padrão): Salvar no criador. O Input só lê A, B e Start na pausa. */
function padY(): boolean {
  return [...navigator.getGamepads()].some((p) => !!p?.connected && !!p.buttons[3]?.pressed);
}

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
      ballStats: () => { minY: number; maxDist: number; bounces: number; handChanges: number; samples: number; worst: Record<string, unknown> | null };
      /** HUD de gameplay: nota, box score, takeover, badges ativados, aviso na tela. */
      match?: () => Record<string, unknown>;
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

// Arena (docs/20, lote "arena"): cesta dos modelos do HY, volta da quadra, arquibancada e torcida. ?arena=0 desliga.
const arenaOn = params.get('arena') !== '0';
// Menu principal estilo 2K (docs/23): abre antes do Freestyle para quem joga. Fica fora no Playwright (navigator.webdriver,
// os testes e as ferramentas abrem "/" e esperam o Freestyle), no laboratório e com ?menu=0; ?menu=1 força.
const menuOn = params.get('menu') === '1' || (params.get('menu') !== '0' && !navigator.webdriver && params.get('lab') !== '1');

async function boot(): Promise<void> {
  if (arenaOn) ArenaDressing.preload(); // baixa os GLBs enquanto o jogador carrega
  hud.setLoading('Carregando o jogador…');
  const animator = await PlayerAnimator.load('assets/hoops_player.glb', 'assets/hoops_player.clips.json');
  // Tênis, regata e bermuda do HY 3D (docs/20). ?roupa=0 volta ao boneco liso; ?uniforme=branco e ?tenis=<nome> trocam
  // as peças. Sem os GLBs, segue sem roupa.
  const kit = params.get('uniforme') === 'branco' ? 'branca' : 'vermelha';
  const gear =
    params.get('roupa') === '0'
      ? null
      : await PlayerGear.load(animator, {
          shoes: `assets/gear/${params.get('tenis') ?? 'tenis_retro_alto_1'}.glb`,
          jersey: `assets/gear/regata_${kit}.glb`,
          shorts: `assets/gear/bermuda_${kit}.glb`,
        }).catch(
          (e) => (console.warn('roupa não carregou', e), null),
        );
  hud.setLoading(null);

  const gameHud = new GameHud();
  let director: MatchDirector | null = null;
  let netMesh: NetMesh | null = null;
  const game: Freestyle = new Freestyle(scene, animator, {
    modifyShot: (context, timing, contest) => director?.modifyShot(context, timing, contest),
    // Rede com física: colide com a bola a cada tick do voo (a bola nunca atravessa a rede).
    onFlightTick: (ball, step) => netMesh?.stepWithBall(ball, step, game.sim.getConfig().ball.radius),
    onRelease: (evaluation, _windows, finish) => {
      // Bandeja e enterrada não têm green: sem medidor colorido e sem ding.
      if (!finish) hud.freezeMeter(evaluation);
      director?.onRelease(evaluation);
      if (evaluation.timing === TimingGrade.Green) sfx.ding();
    },
    onFloorBounce: (speed) => sfx.bounce(speed),
    onRim: () => sfx.rim(),
    onBoard: () => sfx.rim(),
    onScore: () => sfx.swish(),
    onResult: (record) => {
      director?.onResult(record);
    },
    onMove: (label, detail) => {
      hud.showMove(label, detail);
      director?.onMove(label);
    },
  });
  buildCourt(scene, renderer, game.layout);
  let arena: ArenaDressing | null = null;
  if (arenaOn) {
    hud.setLoading('Montando a arena…');
    await buildModelHoop(scene, game.hoop).catch((e) => (console.warn('cesta do HY não carregou', e), buildHoop(scene, game.hoop)));
    arena = await ArenaDressing.build(scene, game.layout).catch((e) => (console.warn('arena não carregou', e), null));
    // Compila os shaders antes do 1º quadro (sem engasgo quando a arena aparece).
    await renderer.compileAsync(scene, rig.camera).catch(() => undefined);
    hud.setLoading(null);
  } else {
    buildHoop(scene, game.hoop);
  }
  // Menu principal: o jogador escolhe (ou cria) a build; o Freestyle usa os ratings dela. Sem menu, a build ativa salva
  // (ou a padrão, que joga igual a antes do builder).
  let build = BuildSave.active();
  if (menuOn) {
    // Import dinâmico: as telas do menu só carregam quando o menu abre (o Freestyle dos testes não depende delas). Se o
    // menu falhar ao carregar (arquivo em edição), o Freestyle abre direto com a build ativa.
    try {
      const [{ MenuFlow }, { Showroom }] = await Promise.all([import('./menu/MenuFlow'), import('./menu/Showroom')]);
      const spot = animator.root.position.clone();
      const rim = toThree(game.rimCenter());
      const facing = new THREE.Vector3(spot.x - rim.x, 0, spot.z - rim.z).normalize(); // de costas para a cesta
      const showroom = new Showroom(renderer, scene, rig.camera, animator, gear, spot, facing, canvas, [game.ballMesh]);
      (window as unknown as { __showroom: unknown }).__showroom = { showroom, animator, THREE };
      build = (await new MenuFlow(showroom).run()).build;
    } catch (e) {
      console.error('menu não carregou; abrindo o Freestyle', e);
    }
  }
  const ratings = playRatings(build);
  game.setRatings(ratings);
  // Altura e envergadura da build: o boneco escala e os braços alongam (drible, arremesso, bandeja e enterrada
  // acompanham). ?altura=<cm> e ?envergadura=<cm além da altura, 0 a 15,24> forçam (laboratório:
  // ?lab=1&altura=224&envergadura=15). A build padrão dá escala 1 e braço 1: o jogo de antes.
  const alturaParam = Number(params.get('altura'));
  const heightCm = alturaParam >= 150 && alturaParam <= 240 ? alturaParam : build.body.heightCm;
  const wingParam = params.get('envergadura');
  const wingOverM = wingParam !== null && Number(wingParam) >= 0 && Number(wingParam) <= 25 ? Number(wingParam) / 100 : wingspanOverModelM(build.body);
  animator.setBodyScale(bodyScaleOf(heightCm), wingOverM);
  const badgeBudget = badgePoints(build);
  const ring = new PlayerRing(scene);
  netMesh = new NetMesh(scene, game.hoop);
  (window as unknown as { __net: unknown }).__net = netMesh;
  const playerName = params.get('nome') ?? (build.id === DefaultBuild.id ? 'cardoso2k' : displayName(build));
  // Badges salvas, ajustadas aos pontos de badge da build (as mais caras descem de nível se não couberem).
  const looseBudget = { Finishing: 999, Shooting: 999, Playmaking: 999, Defense: 999 };
  director = new MatchDirector(game, gameHud, ring, { playerName, loadout: fitLoadout(loadBuild(looseBudget), badgeBudget) });
  // Tela de badges (B / View): equipar, trocar nível e desequipar; a build fica salva no navegador.
  const badgeMenu = new BadgeMenu({
    playerName,
    buildName: `${archetypeName(build)} · ${formatMeters(build.body.heightCm)}`,
    budget: badgeBudget,
    getLoadout: () => director!.badges.loadout,
    setLoadout: (loadout) => {
      director!.badges.loadout = loadout;
      saveBuild(loadout);
    },
    resetLoadout: () => {
      const loadout = fitLoadout(DirectorLoadout, badgeBudget);
      director!.badges.loadout = loadout;
      saveBuild(loadout);
      return loadout;
    },
    activations: (id) => director!.activations.filter((a) => a === id).length,
  });
  (window as unknown as { __badgeMenu: unknown }).__badgeMenu = badgeMenu;
  // Menu de pausa (P / Start): criador de arremesso. O arremesso equipado vale no próximo arremesso do Freestyle.
  let awaitingBadges = false;
  const shotStore = new JumpShotStore();
  game.setShotSetup(shotStore.equipped());
  let previewing = false;
  /** Arremesso que a prévia repete em loop enquanto o criador está aberto. */
  let previewSetup: JumpShotSetup | null = null;
  let previewKey = '';
  // Bola da prévia: segue a mão do arremesso e, solta, sobe num arco só visual; a cada volta do loop ela volta à mão.
  const previewBall = { flying: false, vel: new THREE.Vector3() };
  const endPreview = (): void => {
    previewing = false;
    previewSetup = null;
    previewKey = '';
    previewBall.flying = false;
    game.ballMesh.position.copy(game.dribbler.position);
  };
  const startPreview = (setup: JumpShotSetup): void => {
    previewing = true;
    previewSetup = setup;
    previewBall.flying = false;
    animator.ballWorld.copy(game.ballMesh.position);
    animator.playShot('r', idealReleaseSeconds(setup.releaseSpeed), setup); // janela ideal da velocidade escolhida
  };
  // Câmera da pausa: 3/4 do jogador com a cesta ao fundo; o painel cobre a esquerda, então o jogador fica à direita.
  let pauseCam = false;
  const framePauseCamera = (): void => {
    const cam = rig.camera;
    const root = animator.root.position;
    const rim = toThree(game.rimCenter());
    const toRim = new THREE.Vector3(rim.x - root.x, 0, rim.z - root.z).normalize();
    const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toRim).normalize();
    // 3/4 de frente, do lado da mão do arremesso: vê o rosto, o braço e a bola subindo (no 2K o boneco aparece assim).
    cam.position.copy(root).addScaledVector(toRim, 3.6).addScaledVector(side, -4.2);
    cam.position.y = root.y + 1.5;
    cam.lookAt(root.x, root.y + 1.05, root.z);
    const w = window.innerWidth;
    const h = window.innerHeight;
    cam.setViewOffset(w, h, -w * 0.27, 0, w, h);
    pauseCam = true;
  };
  const pauseMenu = new PauseMenu({
    store: shotStore,
    onPreview: (setup, restart = false) => {
      const key = JSON.stringify(setup);
      if (!restart && previewing && key === previewKey) return;
      previewKey = key;
      startPreview(setup);
    },
    onPreviewStop: endPreview,
    onClose: () => {
      endPreview();
      game.setShotSetup(shotStore.equipped());
    },
    onBadges: () => {
      badgeMenu.open();
      awaitingBadges = true; // quando as badges fecharem, a lista da pausa volta
    },
    // Menu principal: recarrega a página com o menu aberto (mantém os outros parâmetros da URL).
    onMainMenu: () => {
      const query = new URLSearchParams(location.search);
      query.set('menu', '1');
      location.search = query.toString();
    },
  });
  let prevPause = false;

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
  const stats = { minY: Infinity, maxDist: 0, bounces: 0, handChanges: 0, samples: 0, worst: null as Record<string, unknown> | null };
  const trail: Record<string, unknown>[] = [];
  let lastHand = game.dribbler.ballHand();
  let lastMode = game.dribbler.mode;
  const sampleBall = (): void => {
    if (game.phase !== 'dribble') return;
    const ball = game.ballMesh.position;
    const root = animator.root.position;
    stats.minY = Math.min(stats.minY, ball.y);
    const dist = Math.hypot(ball.x - root.x, ball.z - root.z);
    const palmR = animator.palmWorld('r', new THREE.Vector3());
    const palmL = animator.palmWorld('l', new THREE.Vector3());
    const r2 = (v: THREE.Vector3) => [v.x, v.y, v.z].map((x) => +x.toFixed(2));
    trail.push({ f: debug.frame, d: +dist.toFixed(2), m: game.dribbler.mode, a: animator.actionKind(), b: animator.baseClip(), ball: r2(ball), root: [+root.x.toFixed(2), +root.z.toFixed(2)], pr: r2(palmR), pl: r2(palmL) });
    if (trail.length > 12) trail.shift();
    if (dist > stats.maxDist) {
      // O pior quadro, para o e2e mostrar de onde veio a bola longe (é intermitente: depende do relógio real).
      stats.worst = {
        frame: debug.frame,
        dist: +dist.toFixed(2),
        mode: game.dribbler.mode,
        hand: game.dribbler.ballHand(),
        action: animator.actionKind(),
        base: animator.baseClip(),
        moves: game.moves.length,
        ball: [ball.x, ball.y, ball.z].map((x) => +x.toFixed(2)),
        root: [root.x, root.z].map((x) => +x.toFixed(2)),
        trail: [...trail],
      };
    }
    stats.maxDist = Math.max(stats.maxDist, dist);
    if (game.dribbler.mode === 'air' && lastMode === 'held') stats.bounces++;
    if (game.dribbler.ballHand() !== lastHand) stats.handChanges++;
    lastHand = game.dribbler.ballHand();
    lastMode = game.dribbler.mode;
    stats.samples++;
  };
  window.__garrafao = { ...debug, ballStats: () => ({ ...stats }), match: () => director!.snapshot() };
  (window as unknown as { __debug: unknown }).__debug = { animator, game, THREE, gear };

  let last = performance.now();
  let gameClock = performance.now() / 1000;
  const frame = (now: number): void => {
    // Depois de uma tarefa longa (vestir a roupa leva ~0,8 s) o Chrome pode entregar ao 1º quadro um horário anterior ao
    // fim do boot: dt negativo fazia o animador integrar para trás (mãos a 17 m no primeiro 0,3 s).
    const realDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const dt = realDt * timeScale;
    gameClock += timeScale === 1 ? realDt : dt;
    if (timeScale === 1) gameClock = now / 1000;
    fps += (1 / Math.max(realDt, 1e-3) - fps) * 0.05;

    const state = input.read();
    // Badges abertas pela pausa: quando fecham, a lista da pausa volta.
    if (awaitingBadges && !badgeMenu.isOpen()) {
      awaitingBadges = false;
      pauseMenu.open();
    }
    // Menu de pausa (P / Start): o jogo para; a prévia do arremesso anima o boneco enquanto toca.
    const pausePressed = !!state.pause && !prevPause;
    prevPause = !!state.pause;
    if (pausePressed && !pauseMenu.isOpen() && !badgeMenu.isOpen()) pauseMenu.open();
    if (pauseMenu.isOpen()) {
      if (badgeMenu.isOpen()) badgeMenu.close(); // o B abre as badges por cima da pausa: fecha de volta
      const pad = state.pad;
      pauseMenu.update(
        realDt,
        pad && {
          up: pad.up || pad.ly > 0.5,
          down: pad.down || pad.ly < -0.5,
          left: pad.left || pad.lx < -0.5,
          right: pad.right || pad.lx > 0.5,
          confirm: pad.a,
          back: pad.b,
          save: padY(),
        },
      );
      // O boneco anima sempre (parado na lista, em loop na prévia).
      animator.update(realDt, { right: 0, forward: 0, ballHand: 'r', hasBall: false, low: false, accelRight: 0, accelForward: 0 });
      gear?.update(realDt);
      if (previewing) {
        const ball = game.ballMesh.position;
        if (animator.ballHeldLocal) {
          ball.copy(animator.ballHeldLocal).applyMatrix4(animator.root.matrixWorld);
        } else if (animator.actionKind() === 'Shot') {
          if (!previewBall.flying) {
            // Arco de arremesso: ~7,5 m/s a 52° para a frente do jogador.
            const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(animator.root.quaternion);
            previewBall.vel.copy(fwd).multiplyScalar(7.5 * Math.cos(0.91)).setY(7.5 * Math.sin(0.91));
            previewBall.flying = true;
          }
          previewBall.vel.y -= 9.81 * realDt;
          ball.addScaledVector(previewBall.vel, realDt);
        }
        // Acabou uma volta do arremesso: a prévia repete (o criador está aberto e mostra o mesmo arremesso).
        if (animator.actionKind() !== 'Shot') {
          if (previewSetup) startPreview(previewSetup);
          else endPreview();
        }
      }
      framePauseCamera();
      renderer.render(scene, rig.camera);
      requestAnimationFrame(frame);
      return;
    }
    // Tela de badges aberta: o jogo pausa (só desenha a cena parada atrás).
    badgeMenu.update(realDt);
    if (badgeMenu.isOpen()) {
      renderer.render(scene, rig.camera);
      requestAnimationFrame(frame);
      return;
    }
    // Saiu da pausa: a câmera do jogo volta (o rig a reposiciona neste quadro).
    if (pauseCam) {
      rig.camera.clearViewOffset();
      pauseCam = false;
    }
    if (state.gamepadConnected && (state.shoot || state.sprint)) sfx.unlock();
    game.update(gameClock, dt, state, rig.forward());
    gear?.update(dt);
    rig.playerFacing = game.facing;
    rig.update(dt, game.position, game.rimCenter());

    if (game.phase === 'gather' && game.windows && !game.finishing) {
      const head = rig.project(game.headPoint(), window.innerWidth, window.innerHeight);
      hud.showMeter(head.x, head.y, game.holdMs, game.windows);
    }
    hud.update(dt, state.gamepadConnected);
    ring.update(dt, animator.root.position, animator.root.rotation.y);
    arena?.update(dt);
    if (game.phase !== 'flight') netMesh.advance(dt);
    netMesh.sync();
    director!.update(dt, state.sprint, (p) => rig.project(p, window.innerWidth, window.innerHeight));
    // A build multiplica os multiplicadores do drible que as badges montaram (energia, ritmo dos dribles, sprint).
    applyDribbleRatings(game.dribble.modifiers, ratings);
    gameHud.update(dt);
    sampleBall();

    renderer.render(scene, rig.camera);
    debug.frame++;
    window.__garrafao!.frame = debug.frame;
    if (debug.frame === 3) window.__garrafao!.ready = true;
    requestAnimationFrame(frame);
  };
  if (params.get('lab') === '1') {
    // Laboratório: o jogo não roda sozinho; o Playwright (tools/laboratorio.mjs) avança quadro a quadro.
    document.getElementById('hud')!.style.display = 'none';
    const lab = new Lab(renderer, scene, game, animator, () => rig.forward());
    rig.update(0, game.position, game.rimCenter());
    lab.render();
    (window as unknown as { __lab: unknown }).__lab = {
      lab,
      step: (n: number, input: object) => {
        lab.step(n, input);
        rig.update(n / 60, game.position, game.rimCenter());
      },
      render: () => lab.render(),
      // Uma vista só, sem rastros (vídeos do laboratório: tools/video-lab.mjs).
      renderSingle: (kind: 'jogo' | 'back' | 'side' | 'front' | 'top') => lab.renderSingle(kind, rig.camera),
      metrics: () => lab.metrics(),
      reset: () => lab.resetMetrics(),
      place: (x: number, y: number, hand: 'r' | 'l') => game.placeForLab(x, y, hand),
      state: () => debug.anim(),
    };
    window.__garrafao!.ready = true;
    return;
  }
  requestAnimationFrame(frame);
}

boot().catch((error: unknown) => {
  console.error(error);
  hud.setLoading(`Erro ao carregar: ${String(error)}`);
});
