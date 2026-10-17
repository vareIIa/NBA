// Verdade do motor para a régua do feel (docs/27 §5, Fase 1). Roda os cenários de tools/cenarios-feel.mjs no laboratório
// (?lab=1, passo fixo de 1/60 s, Chromium headless) e exporta, por quadro, o esqueleto e a bola em metros no referencial
// do jogador, mais os eventos do drible (núcleo, animador e bola). Com --video grava também os mesmos cenários a 30 fps
// com uma câmera atrás e acima, parecida com a dos tutoriais do 2K, para calibrar o pipeline de vídeo (medir/derivar).
//
//   node tools/feel/motor.mjs <saida> [--cenarios a,b,...] [--video] [--video-cenarios a,b,...]
//
// Precisa de um Vite servindo web/: LAB_ORIGIN=http://127.0.0.1:5191 (o regua.mjs sobe um próprio, sem HMR; nunca a 5173).
// Não muda nada no jogo: lê o estado por window.__debug / window.__lab e importa HoopsDribbleMoves.ts só para ler as Specs.
//
// Referencial por quadro (m): lado = para a DIREITA do jogador (+), alt = acima do chão, frente = para onde ele olha.
// Com a câmera atrás do jogador, lado + = direita da tela (a mesma convenção de derivar.py).
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FeelCenarios, FasesDoQuique, wait } from '../cenarios-feel.mjs';

/** Juntas exportadas (nome na régua -> osso do GLB). l/r = esquerda/direita do próprio jogador. */
export const Juntas = {
  hip_l: 'thigh_l', hip_r: 'thigh_r', knee_l: 'calf_l', knee_r: 'calf_r', ank_l: 'foot_l', ank_r: 'foot_r',
  toe_l: 'ball_l', toe_r: 'ball_r', sh_l: 'upperarm_l', sh_r: 'upperarm_r', el_l: 'lowerarm_l', el_r: 'lowerarm_r',
  wr_l: 'hand_l', wr_r: 'hand_r', neck: 'neck_01', head: 'head', pelvis: 'pelvis', chest: 'spine_03',
};
/** Ossos vigiados na latência (tronco e mãos), em coordenadas do mundo: posição e rotação. */
export const Vigiados = ['spine_02', 'spine_03', 'neck_01', 'head', 'hand_l', 'hand_r'];

/** Câmera do vídeo de calibração: atrás e acima, retrato, como nos tutoriais do 2K (doc 27 §0, evidencia-A/C/D). */
export const CameraVideo = { largura: 822, altura: 1506, fov: 40, atras: 8.5, altura_m: 3.1, alvoFrente: 20, alvoAlt: 1.8 };

/**
 * Instalado na página: avança o laboratório quadro a quadro e amostra o estado. Precisa ser autocontido (o Playwright
 * serializa o código da função).
 */
async function instalarFeel({ juntas, vigiados, cam }) {
  const { animator, game, THREE } = window.__debug;
  const lab = window.__lab;
  const moves = await import('/src/sim/HoopsDribbleMoves.ts');
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  const st = { t0: 0, frame: 0, camYaw: 0 };
  const camera = new THREE.PerspectiveCamera(cam.fov, cam.largura / cam.altura, 0.05, 200);

  function local(p) {
    const root = animator.root.position;
    const yaw = animator.root.rotation.y;
    const dx = p.x - root.x;
    const dz = p.z - root.z;
    // frente = (sen yaw, 0, cos yaw); esquerda = (cos yaw, 0, -sen yaw); direita = -esquerda.
    return [r4(-dx * Math.cos(yaw) + dz * Math.sin(yaw)), r4(p.y), r4(dx * Math.sin(yaw) + dz * Math.cos(yaw))];
  }

  function placeCamera() {
    const root = animator.root.position;
    const yaw = st.camYaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    camera.position.set(root.x - fx * cam.atras, cam.altura_m, root.z - fz * cam.atras);
    camera.up.set(0, 1, 0);
    camera.lookAt(root.x + fx * cam.alvoFrente, cam.alvoAlt, root.z + fz * cam.alvoFrente);
    camera.updateMatrixWorld(true);
  }

  /** Projeção na imagem (px), como um detector de pose perfeito veria a junta. */
  function project(p) {
    const s = p.clone().project(camera);
    return [r4(((s.x + 1) / 2) * cam.largura), r4(((1 - s.y) / 2) * cam.altura)];
  }

  function sample(input) {
    const root = animator.root.position;
    const out = { f: st.frame, t: r4(game.now - st.t0) };
    out.i = [input.proX ?? 0, input.proY ?? 0, input.moveX ?? 0, input.moveY ?? 0, input.sprint ? 1 : 0];
    for (const [k, b] of Object.entries(juntas)) out[k] = local(animator.bone(b).getWorldPosition(v));
    out.palm_l = local(animator.palmWorld('l', v));
    out.palm_r = local(animator.palmWorld('r', v));
    out.ball = local(game.ballMesh.position);
    out.w = vigiados.map((b) => {
      const bone = animator.bone(b);
      const p = bone.getWorldPosition(v);
      const qq = bone.getWorldQuaternion(q);
      return [p.x, p.y, p.z, qq.x, qq.y, qq.z, qq.w].map(r6);
    });
    out.root = [r4(root.x), r4(root.z), r4(animator.root.rotation.y)];
    out.vel = r4(Math.hypot(game.velocity.x, game.velocity.y));
    const d = game.dribbler;
    out.bm = d.mode === 'held' ? 1 : 0;
    out.bh = d.ballHand();
    out.bq = d.bounces.length;
    out.asc = d.ascending() ? 1 : 0;
    out.ttc = r4(d.timeToCatch());
    const a = game.dribble.getActive();
    const now = game.now;
    const ativo = a.isActive(now);
    const spec = moves.getDribbleMoveSpec(a.move);
    const rate = a.playRate > 1e-6 ? a.playRate : 1;
    out.mv = ativo ? a.move : 0;
    out.mvn = ativo ? moves.dribbleMoveLabel(a.move) : '';
    out.mvs = r4(a.startTime - st.t0);
    out.mve = r4(a.endTime() - st.t0);
    out.commit = r4(a.startTime - st.t0 + spec.commitSeconds / rate);
    out.comboIni = r4(a.endTime() - st.t0 - spec.comboWindow);
    out.rate = r4(rate);
    out.rhy = a.inRhythm ? 1 : 0;
    out.redir = a.redirected ? 1 : 0;
    out.combo = game.dribble.getComboCount();
    out.cancel = game.dribble.canCancel(now) ? 1 : 0;
    out.pend = game.pendingMove ? 1 : 0;
    out.ak = animator.actionKind() ?? '';
    const act = animator.active;
    out.rel = act && !act.fadingOut ? (act.released ? 1 : 0) : -1;
    out.wait = animator.waitingForBall() ? 1 : 0;
    out.nmov = game.moves.length;
    if (cam.projetar) {
      placeCamera();
      const lm = {};
      const pares = { lsh: 'upperarm_l', rsh: 'upperarm_r', lwr: 'hand_l', rwr: 'hand_r', lhip: 'thigh_l', rhip: 'thigh_r', lknee: 'calf_l', rknee: 'calf_r', lank: 'foot_l', rank: 'foot_r', nose: 'head' };
      for (const [k, b] of Object.entries(pares)) lm[k] = project(animator.bone(b).getWorldPosition(v).clone());
      const ball = game.ballMesh.position.clone();
      const c = project(ball);
      // Raio aparente: ponto na borda da bola, perpendicular à linha de visada (aprox. pelo "para cima" da câmera).
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(0.119);
      const e = project(ball.clone().add(up));
      lm.ball = [c[0], c[1], r4(Math.hypot(e[0] - c[0], e[1] - c[1]))];
      out.lm = lm;
    }
    return out;
  }

  window.__feel = {
    heightMeters: animator.heightMeters,
    /** Coloca o jogador, aquece 45 quadros (como laboratorio.mjs) e zera as métricas do laboratório. */
    reset(place, hand) {
      lab.lab.hz = 60;
      lab.place(place[0], place[1], hand);
      lab.step(45, {});
      lab.reset();
      st.t0 = game.now;
      st.frame = 0;
      st.camYaw = animator.root.rotation.y;
    },
    /** Avança os passos ({n, ...input}) e devolve uma amostra por quadro de 1/60 s. */
    run(steps) {
      const frames = [];
      for (const step of steps) {
        const { n, ...input } = step;
        for (let i = 0; i < n; i++) {
          lab.step(1, input);
          frames.push(sample(input));
          st.frame++;
        }
      }
      return frames;
    },
    /** Desenha o quadro atual com a câmera do vídeo (sem rastros nem letreiros do laboratório). */
    render() {
      placeCamera();
      lab.lab.renderSingle('jogo', camera);
    },
    labMetrics: () => lab.metrics(),
  };
  return animator.heightMeters;
}

function launchArgs() {
  const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
  const dir = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop() : null;
  const exe = dir ? join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') : process.env.PW_CHROMIUM_PATH;
  return {
    executablePath: exe,
    args: process.platform === 'win32' ? ['--enable-gpu', '--use-angle=d3d11'] : ['--enable-unsafe-swiftshader'],
  };
}

async function abrirLab(page, origin, projetar) {
  await page.goto(origin + '/?lab=1');
  await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab, undefined, { timeout: 60000 });
  return page.evaluate(instalarFeel, { juntas: Juntas, vigiados: Vigiados, cam: { ...CameraVideo, projetar } });
}

const expandir = (steps) => steps.flatMap(({ n, ...input }) => Array.from({ length: n }, () => input));
const comprimir = (inputs) => inputs.map((input) => ({ n: 1, ...input }));

/** Quadro do comando = primeiro quadro com o stick na zona ativa (0,7) do Pro Stick. */
export function quadroDoComando(steps) {
  const inputs = expandir(steps);
  return inputs.findIndex((i) => Math.hypot(i.proX ?? 0, i.proY ?? 0) >= 0.7);
}

/**
 * Fases do quique no controle: primeiro quadro k (depois do aquecimento) em que o estado ANTERIOR ao comando é
 * 'mao' (bola presa há 3 quadros), 'descendo' (no ar, antes do chão, há 2 quadros) ou 'subindo' (depois do chão, há 2).
 */
export function escolherFases(frames, k0) {
  const ok = {
    mao: (f) => f.bm === 1,
    descendo: (f) => f.bm === 0 && f.asc === 0,
    subindo: (f) => f.bm === 0 && f.asc === 1,
  };
  const need = { mao: 3, descendo: 2, subindo: 2 };
  const out = {};
  for (const fase of FasesDoQuique) {
    for (let k = k0; k < frames.length; k++) {
      let good = true;
      for (let j = 1; j <= need[fase]; j++) good &&= ok[fase](frames[k - j]);
      if (good) {
        out[fase] = k;
        break;
      }
    }
  }
  return out;
}

async function rodar(page, origin, sc, steps) {
  await abrirLab(page, origin, false);
  return page.evaluate(
    ([place, hand, steps]) => {
      window.__feel.reset(place, hand);
      const frames = window.__feel.run(steps);
      return { frames, lab: window.__feel.labMetrics(), height: window.__feel.heightMeters };
    },
    [sc.place ?? [7.4, -0.6], sc.hand, steps],
  );
}

function acharFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  for (const py of [process.env.FEEL_PYTHON, 'python'].filter(Boolean)) {
    try {
      return execFileSync(py, ['-I', '-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      /* tenta o próximo */
    }
  }
  return 'ffmpeg';
}

/** Grava o cenário a 30 fps (um quadro a cada 2 do laboratório) e devolve a verdade nos quadros gravados. */
async function gravar(page, origin, sc, steps, mp4) {
  const altura = await abrirLab(page, origin, true);
  const enc = spawn(acharFfmpeg(), ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', mp4], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const closed = new Promise((resolve, reject) => {
    enc.on('error', reject);
    enc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg saiu com ${code}`))));
  });
  await page.evaluate(([place, hand]) => window.__feel.reset(place, hand), [sc.place ?? [7.4, -0.6], sc.hand]);
  const inputs = expandir(steps);
  const frames = [];
  for (let i = 0; i + 1 < inputs.length; i += 2) {
    const got = await page.evaluate((st) => {
      const out = window.__feel.run(st);
      window.__feel.render();
      return out;
    }, comprimir(inputs.slice(i, i + 2)));
    // O quadro desenhado é o 2º dos dois passos; o quique do 1º (o vídeo não tem esse quadro) conta nele.
    const last = got[got.length - 1];
    last.bq = got.reduce((acc, f) => acc + f.bq, 0);
    frames.push(last);
    const png = await page.screenshot({ type: 'png' });
    if (!enc.stdin.write(png)) await new Promise((r) => enc.stdin.once('drain', r));
  }
  enc.stdin.end();
  await closed;
  return { frames, altura };
}

/** Cenários de golpe expandidos por fase; controles e sequências como vêm. */
export function planoDeRodadas(nomes, fasesPorControle) {
  const plano = [];
  for (const nome of nomes) {
    const sc = FeelCenarios[nome];
    if (!sc) throw new Error(`cenário desconhecido: ${nome}`);
    if (sc.tipo === 'controle') plano.push({ id: nome, nome, sc, steps: wait(sc.quadros, sc.input) });
    else if (sc.tipo === 'sequencia') plano.push({ id: nome, nome, sc, steps: sc.steps });
    else {
      const fases = fasesPorControle[sc.controle];
      for (const fase of FasesDoQuique) {
        const k = fases?.[fase];
        if (k === undefined) continue;
        const input = sc.input ?? {};
        plano.push({ id: `${nome}__${fase}`, nome, fase, sc, steps: [...wait(k, input), ...sc.comando, ...wait(sc.depois, input)] });
      }
    }
  }
  return plano;
}

export async function medirMotor(out, { origin, cenarios, video = false, videoCenarios } = {}) {
  origin ??= process.env.LAB_ORIGIN;
  if (!origin) throw new Error('defina LAB_ORIGIN (um Vite próprio, sem HMR; nunca a 5173)');
  const dirMotor = join(out, 'motor');
  mkdirSync(dirMotor, { recursive: true });
  const browser = await chromium.launch(launchArgs());
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => console.log('ERRO na página:', String(e)));
  const nomes = cenarios ?? Object.keys(FeelCenarios);
  // Os controles rodam primeiro: deles saem as fases do quique dos golpes.
  const controles = [...new Set(nomes.map((n) => (FeelCenarios[n]?.tipo === 'golpe' ? FeelCenarios[n].controle : FeelCenarios[n]?.tipo === 'controle' ? n : null)).filter(Boolean))];
  const fasesPorControle = {};
  const indice = { origin, hz: 60, quando: new Date().toISOString(), rodadas: [], fases: fasesPorControle };
  const salvar = (id, dados) => writeFileSync(join(dirMotor, `${id}.json`), JSON.stringify(dados));
  for (const nome of controles) {
    const sc = FeelCenarios[nome];
    const t = Date.now();
    const res = await rodar(page, origin, sc, wait(sc.quadros, sc.input));
    fasesPorControle[nome] = escolherFases(res.frames, sc.input?.moveY ? 60 : 50);
    salvar(nome, { id: nome, cenario: nome, tipo: 'controle', hz: 60, vigiados: Vigiados, alturaJogador: res.height, frames: res.frames, lab: res.lab });
    indice.rodadas.push({ id: nome, cenario: nome, tipo: 'controle' });
    console.log(`motor: ${nome.padEnd(16)} ${res.frames.length} q (${Date.now() - t} ms)  fases do quique: ${JSON.stringify(fasesPorControle[nome])}`);
  }
  for (const r of planoDeRodadas(nomes.filter((n) => FeelCenarios[n]?.tipo !== 'controle'), fasesPorControle)) {
    const t = Date.now();
    const res = await rodar(page, origin, r.sc, r.steps);
    const cmd = quadroDoComando(r.steps);
    const golpes = res.frames.filter((f, i) => i > 0 && f.nmov > res.frames[i - 1].nmov).map((f) => f.mvn || '?');
    salvar(r.id, { id: r.id, cenario: r.nome, fase: r.fase ?? null, tipo: r.sc.tipo, controle: r.sc.controle ?? null, cmd, hz: 60, vigiados: Vigiados, alturaJogador: res.height, trecho2k: r.sc.trecho2k ?? '', frames: res.frames, lab: res.lab });
    indice.rodadas.push({ id: r.id, cenario: r.nome, fase: r.fase ?? null, tipo: r.sc.tipo, controle: r.sc.controle ?? null, cmd });
    console.log(`motor: ${r.id.padEnd(24)} cmd q${cmd}  ${golpes.join(' > ') || '(nenhum golpe)'}  (${Date.now() - t} ms)`);
  }
  // Rodada parcial (--cenarios): mantém no índice as rodadas anteriores que não foram refeitas.
  const idxPath = join(dirMotor, 'indice.json');
  if (cenarios && existsSync(idxPath)) {
    const antigo = JSON.parse(readFileSync(idxPath, 'utf8'));
    const novos = new Set(indice.rodadas.map((r) => r.id));
    indice.rodadas = [...antigo.rodadas.filter((r) => !novos.has(r.id)), ...indice.rodadas];
    indice.fases = { ...antigo.fases, ...indice.fases };
  }
  writeFileSync(idxPath, JSON.stringify(indice, null, 1));
  await page.close();

  if (video) {
    const dirVideo = join(out, 'video');
    mkdirSync(dirVideo, { recursive: true });
    const vpage = await browser.newPage({ viewport: { width: CameraVideo.largura, height: CameraVideo.altura } });
    vpage.on('pageerror', (e) => console.log('ERRO na página:', String(e)));
    const lista = videoCenarios ?? ['drible_parado', 'cross_parado', 'entre_pernas', 'behind_back', 'hesitacao', 'step_back', 'double_cross', 'hesi_cross', 'btb_correndo', 'cross_correndo', 'cross_seguidos', 'btb_btb'];
    const videos = [];
    for (const r of planoDeRodadas(lista, fasesPorControle).filter((x) => !x.fase || x.fase === 'mao')) {
      const t = Date.now();
      const steps = r.sc.tipo === 'controle' ? wait(Math.min(180, r.sc.quadros), r.sc.input) : r.steps;
      const mp4 = join(dirVideo, `${r.nome}.mp4`);
      const { frames, altura } = await gravar(vpage, origin, r.sc, steps, mp4);
      writeFileSync(join(dirVideo, `${r.nome}.verdade.json`), JSON.stringify({ id: r.id, cenario: r.nome, fps: 30, camera: CameraVideo, alturaJogador: altura, frames }));
      videos.push({ cenario: r.nome, mp4: `${r.nome}.mp4`, verdade: `${r.nome}.verdade.json`, quadros: frames.length });
      console.log(`vídeo: ${r.nome.padEnd(16)} ${frames.length} q a 30 fps (${Date.now() - t} ms)`);
    }
    writeFileSync(join(dirVideo, 'indice.json'), JSON.stringify({ camera: CameraVideo, videos }, null, 1));
  }
  await browser.close();
  return indice;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/feel/motor.mjs')) {
  const args = process.argv.slice(2);
  const out = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.match(/^--(cenarios|video-cenarios)$/)) ?? join('..', 'Saved', 'feel', 'manual');
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  await medirMotor(out, {
    cenarios: opt('--cenarios')?.split(','),
    video: args.includes('--video'),
    videoCenarios: opt('--video-cenarios')?.split(','),
  });
}
