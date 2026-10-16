// Joga o jogo de verdade (não o laboratório), em tempo real, com um controle de Xbox simulado (analógicos, RT, LT, X) e
// grava o vídeo. Um detector roda a cada quadro e anota quando um ponto do corpo ou a bola sai mais de 6 cm da trajetória
// (previsão por velocidade constante, com o dt real). Isolado do controle físico do diretor (navigator.getGamepads
// trocado antes do jogo carregar).
//   node tools/jogar.mjs <pasta_saida> [hz=0: o do navegador; 144 força quadros de 1/144 s]
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [out = 'test-results/jogar'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('ERRO', String(e)));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
await page.addInitScript(() => {
  const pad = { lx: 0, ly: 0, rx: 0, ry: 0, rt: 0, lt: 0, x: false, a: false };
  window.__pad = pad;
  const button = (pressed, value) => ({ pressed, touched: pressed, value: value ?? (pressed ? 1 : 0) });
  navigator.getGamepads = () => [
    {
      id: 'Xbox simulado',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: performance.now(),
      axes: [pad.lx, -pad.ly, pad.rx, -pad.ry],
      buttons: Array.from({ length: 17 }, (_, i) =>
        i === 0 ? button(pad.a) : i === 2 ? button(pad.x) : i === 6 ? button(pad.lt > 0.3, pad.lt) : i === 7 ? button(pad.rt > 0.3, pad.rt) : button(false),
      ),
    },
  ];
});
// JOGO_URL: parâmetros extras (ex.: "?flick=volta" para comparar com o flick lido na volta ao centro).
await page.goto(`http://127.0.0.1:5173/${process.env.JOGO_URL ?? ''}`);
await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 60000 });
await page.waitForTimeout(1500);

// Vídeo: screencast do Chromium (como e2e/recorder.ts), codificado no fim com o ffmpeg do imageio-ffmpeg.
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', (e) => {
  frames.push({ data: Buffer.from(e.data, 'base64'), time: e.metadata.timestamp ?? Date.now() / 1000 });
  void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });

// Detector de saltos e cronologia dos dribles.
await page.evaluate(() => {
  const { animator: A, game, THREE } = window.__debug;
  const log = { frames: 0, dts: [], snaps: [], moves: [], start: performance.now() };
  window.__rt = log;
  const parts = () => ({
    pelve: A.bone('pelvis').getWorldPosition(new THREE.Vector3()),
    cabeca: A.bone('head').getWorldPosition(new THREE.Vector3()),
    mao_e: A.palmWorld('l', new THREE.Vector3()),
    mao_d: A.palmWorld('r', new THREE.Vector3()),
    pe_e: A.bone('foot_l').getWorldPosition(new THREE.Vector3()),
    pe_d: A.bone('foot_r').getWorldPosition(new THREE.Vector3()),
    bola: game.ballMesh.position.clone(),
  });
  const h = [];
  let last = performance.now();
  let seen = 0;
  const tick = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    log.frames++;
    log.dts.push(dt);
    h.push({ p: parts(), dt, bounce: game.dribbler.bounces.length > 0, phase: game.phase });
    if (h.length > 3) h.shift();
    if (h.length === 3 && h[1].dt > 0) {
      for (const k of Object.keys(h[2].p)) {
        if (k === 'bola' && (h[1].bounce || h[2].bounce || h[2].phase !== 'dribble' || h[1].phase !== 'dribble')) continue;
        const pred = h[1].p[k].clone().add(h[1].p[k].clone().sub(h[0].p[k]).multiplyScalar(h[2].dt / h[1].dt));
        const cm = pred.distanceTo(h[2].p[k]) * 100;
        if (cm > 6) log.snaps.push({ t: +((now - log.start) / 1000).toFixed(2), parte: k, cm: +cm.toFixed(1), dtMs: +(h[2].dt * 1000).toFixed(1), acao: A.actionKind() });
      }
    }
    if (game.moves.length !== seen) {
      for (const m of game.moves.slice(seen)) log.moves.push({ t: +((now - log.start) / 1000).toFixed(2), m });
      seen = game.moves.length;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// Roteiro (ms desde o início): o que um jogador faria no controle.
const S = [];
const at = (t, s) => S.push([t, s]);
/** Comandos do RS (ms): a latência é medida de cada um até o drible começar. */
const commands = [];
const flick = (t, x, y) => {
  commands.push({ t, label: `flick ${x},${y}` });
  at(t, { rx: x * 0.5, ry: y * 0.5 });
  at(t + 25, { rx: x, ry: y });
  at(t + 80, { rx: x * 0.4, ry: y * 0.4 });
  at(t + 105, { rx: 0, ry: 0 });
};
const spin = (t, deg = 300, ms = 220) => {
  commands.push({ t, label: `giro ${deg}°/${ms} ms` });
  for (let i = 0; i <= 12; i++) {
    const a = ((90 - (deg * i) / 12) * Math.PI) / 180;
    at(t + (ms * i) / 12, { rx: Math.cos(a), ry: Math.sin(a) });
  }
  at(t + ms + 30, { rx: 0, ry: 0 });
};
at(0, {});
at(1500, { ly: 0.5 }); // andando
at(2500, { ly: 1, rt: 1 }); // sprint
at(3700, { rt: 0 });
flick(4000, 0, 1); // crossover correndo
at(4120, { lx: -0.7, ly: 0.7 }); // LS para o lado da mão nova
at(5600, { lx: 0, ly: 0 }); // para
flick(6800, 0, 1); // size-up: crossover
flick(7400, 1, 0); // entre as pernas (bola na esquerda)
flick(8000, -0.71, -0.71); // por trás (bola na direita)
flick(8600, 0, 1); // crossover
at(9600, { ly: 1 });
spin(10400); // spin correndo
at(11600, { ly: 1, rt: 1 });
flick(12100, -1, 0); // hesitação de escape
at(13000, { ly: 0, rt: 0 });
flick(13900, 0, -1); // step-back
at(14700, { x: true }); // arremesso
at(15300, { x: false });
at(17000, {});
S.sort((a, b) => a[0] - b[0]);

const t0 = Date.now();
await page.evaluate((script) => {
  window.__rt.start = performance.now();
  window.__rt.snaps.length = 0;
  window.__rt.moves.length = 0;
  window.__rt.dts.length = 0;
  return new Promise((resolve) => {
    const t0 = performance.now();
    let i = 0;
    const step = () => {
      const t = performance.now() - t0;
      while (i < script.length && script[i][0] <= t) Object.assign(window.__pad, script[i++][1]);
      if (i >= script.length) return resolve(t);
      requestAnimationFrame(step);
    };
    step();
  });
}, S);
const log = await page.evaluate(() => {
  const L = window.__rt;
  const dts = L.dts.slice(1).sort((a, b) => a - b);
  const q = (p) => +(dts[Math.floor(p * (dts.length - 1))] * 1000).toFixed(1);
  return { quadros: L.frames, fpsMedio: +(dts.length / dts.reduce((s, x) => s + x, 0)).toFixed(1), dtMs: { p50: q(0.5), p95: q(0.95), max: q(1) }, moves: L.moves, saltos: L.snaps, fase: window.__debug.game.phase, historico: window.__debug.game.history };
});
console.log('tempo real', ((Date.now() - t0) / 1000).toFixed(1), 's', JSON.stringify({ quadros: log.quadros, fpsMedio: log.fpsMedio, dtMs: log.dtMs }));
console.log('dribles', log.moves.map((m) => `${m.t}s ${m.m}`).join(' | '));
// Latência: do começo de cada comando do RS até o primeiro drible que começou depois dele (e antes do próximo comando).
commands.sort((a, b) => a.t - b.t);
log.latencias = commands.map((c, i) => {
  const next = commands[i + 1]?.t ?? Infinity;
  const move = log.moves.find((m) => m.t * 1000 >= c.t && m.t * 1000 < next);
  return { comando: c.label, t: c.t / 1000, drible: move?.m ?? null, ms: move ? Math.round(move.t * 1000 - c.t) : null };
});
const ok = log.latencias.filter((l) => l.ms !== null);
console.log('latência (ms)', log.latencias.map((l) => `${l.comando} -> ${l.drible ?? 'nada'} ${l.ms ?? ''}`).join(' | '));
if (ok.length) console.log(`latência média ${Math.round(ok.reduce((s, l) => s + l.ms, 0) / ok.length)} ms, máx ${Math.max(...ok.map((l) => l.ms))} ms`);
const big = log.saltos.filter((s) => s.cm > 10);
console.log(`saltos > 6 cm: ${log.saltos.length}; > 10 cm: ${big.length}`);
for (const s of big.slice(0, 40)) console.log(' ', JSON.stringify(s));
writeFileSync(join(out, 'log.json'), JSON.stringify(log, null, 1));
await cdp.send('Page.stopScreencast').catch(() => {});
await context.close();
await browser.close();
if (frames.length) {
  const ffmpeg = execFileSync('python', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  const fps = 30;
  const enc = spawn(ffmpeg, ['-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-r', String(fps), '-i', 'pipe:0', '-y', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', join(out, 'jogo.mp4')], { stdio: ['pipe', 'ignore', 'inherit'] });
  const start = frames[0].time;
  const end = frames[frames.length - 1].time;
  let i = 0;
  for (let t = start; t < end; t += 1 / fps) {
    while (i + 1 < frames.length && frames[i + 1].time <= t) i++;
    if (!enc.stdin.write(frames[i].data)) await new Promise((r) => enc.stdin.once('drain', r));
  }
  enc.stdin.end();
  await new Promise((r) => enc.on('close', r));
  console.log('vídeo', join(out, 'jogo.mp4'), frames.length, 'quadros capturados');
}
