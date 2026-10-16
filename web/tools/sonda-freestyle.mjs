// Sonda do e2e do freestyle: repete o roteiro de teclado de e2e/freestyle.spec.ts (até o drible baixo) e registra cada
// quadro em que a bola, no drible, fica a mais de 1,3 m do jogador (com o estado do jogo e do animador naquele quadro).
//   node tools/sonda-freestyle.mjs            (JOGO_URL='?flick=volta&bola=mao' para o comportamento antigo)
import { chromium } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
// JOGO_ORIGIN: outro servidor (build congelado, sem HMR); LAB_ANIM: campos do PlayerAnimator para A/B (como no laboratório).
await page.goto(`${process.env.JOGO_ORIGIN ?? 'http://127.0.0.1:5173'}/${process.env.JOGO_URL ?? ''}`);
await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 60000 });
await page.evaluate((anim) => Object.assign(window.__debug.animator, JSON.parse(anim)), process.env.LAB_ANIM || '{}');
// SONDA_TRAVA=<ms>: trava a página esse tempo a cada ~0,6 s (como os prints do e2e e uma máquina carregada).
if (process.env.SONDA_TRAVA) {
  await page.evaluate((ms) => {
    setInterval(() => {
      const end = performance.now() + ms * (0.5 + Math.random());
      while (performance.now() < end);
    }, 600);
  }, Number(process.env.SONDA_TRAVA));
}

await page.evaluate(() => {
  const { animator: A, game } = window.__debug;
  const log = { start: performance.now(), far: [], max: 0, moves: [] };
  window.__sonda = log;
  let seen = 0;
  const tick = (now) => {
    const t = +((now - log.start) / 1000).toFixed(2);
    if (game.moves.length !== seen) {
      for (const m of game.moves.slice(seen)) log.moves.push(`${t}s ${m}`);
      seen = game.moves.length;
    }
    if (game.phase === 'dribble') {
      const b = game.ballMesh.position;
      const r = A.root.position;
      const d = Math.hypot(b.x - r.x, b.z - r.z);
      log.max = Math.max(log.max, d);
      if (d > 1.3 && log.far.length < 40) {
        log.far.push({
          t,
          d: +d.toFixed(2),
          bola: [b.x, b.y, b.z].map((x) => +x.toFixed(2)),
          raiz: [r.x, r.z].map((x) => +x.toFixed(2)),
          modo: game.dribbler.mode,
          mao: game.dribbler.ballHand(),
          acao: A.actionKind(),
          base: A.baseClip(),
          noAr: game.dribbler.timeToCatch?.().toFixed?.(3),
          palmaE: A.palmWorld('l').toArray().map((x) => +x.toFixed(2)),
          palmaD: A.palmWorld('r').toArray().map((x) => +x.toFixed(2)),
        });
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const wait = (ms) => page.waitForTimeout(ms);
const flick = async (key) => {
  await page.keyboard.down(key);
  await wait(70);
  await page.keyboard.up(key);
};
const hold = async (key, ms) => {
  await page.keyboard.down(key);
  await wait(ms);
  await page.keyboard.up(key);
};
const ballHand = () => page.evaluate(() => window.__garrafao.anim().ballHand);

await wait(1500);
await page.keyboard.down('KeyW');
await wait(450);
await flick('ArrowUp');
await wait(250);
await page.keyboard.up('KeyW');
await page.keyboard.down('KeyS');
await wait(500);
await page.keyboard.up('KeyS');
await wait(700);
await flick('ArrowRight');
await wait(1100);
await hold('KeyE', 40);
await wait(1350);
const hand = await ballHand();
const diag = hand === 'r' ? 'ArrowLeft' : 'ArrowRight';
await page.keyboard.down('ArrowDown');
await page.keyboard.down(diag);
await wait(70);
await page.keyboard.up(diag);
await page.keyboard.up('ArrowDown');
await wait(960);
await flick('ArrowDown');
await wait(1060);
await hold('KeyR', 40);
await wait(760);
await flick('ArrowDown');
await wait(800);
const freeSide = (await ballHand()) === 'r' ? 'KeyA' : 'KeyD';
await page.keyboard.down(freeSide);
await wait(850);
await page.keyboard.up(freeSide);
await wait(700);
await page.keyboard.down('ShiftLeft');
await page.keyboard.down('KeyD');
await wait(600);
await flick('ArrowUp');
await wait(720);
await page.keyboard.up('KeyD');
await page.keyboard.up('ShiftLeft');
await wait(900);
await page.keyboard.down('KeyQ');
await wait(900);
await page.keyboard.up('KeyQ');
await wait(500);

const log = await page.evaluate(() => window.__sonda);
console.log('dribles', log.moves.join(' | '));
console.log(`distância máxima bola-jogador no drible: ${log.max.toFixed(2)} m; quadros acima de 1,3 m: ${log.far.length}`);
for (const f of log.far) console.log(' ', JSON.stringify(f));
await browser.close();
