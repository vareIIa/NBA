// Teste de eco do boneco remoto (docs/24 §5): abre o jogo headless, liga src/online/EchoTest.ts (o boneco repete o
// jogador local com atraso de rede simulado, ao lado dele), joga um roteiro e salva prints + métricas.
//   node tools/eco-boneco.mjs <saida_dir> [roteiro] [opções JSON do eco]
// Origem: ECO_ORIGIN (padrão http://127.0.0.1:5173; use um Vite sem HMR para medir, veja docs/dev).
// Roteiro: o mesmo formato de tools/capturar.mjs (wait:ms, shot, seq:N:ms, up/down/left/right, +W/-W, space:ms, combo).
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [out = 'test-results/eco', script = 'wait:1500,shot,up:60,wait:150,shot,wait:900,shot,E,wait:400,shot,wait:900,+W,wait:700,-W,space:560,wait:250,shot,wait:900,shot,wait:2500,shot', optsJson = '{}'] =
  process.argv.slice(2);
const origin = process.env.ECO_ORIGIN ?? 'http://127.0.0.1:5173';
mkdirSync(out, { recursive: true });
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop() : null;
const exe = process.env.PW_CHROMIUM_PATH ?? (dir ? join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`));
await page.goto(`${origin}/?menu=0&arena=0`);
await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 60000 });
await page.evaluate(async (opts) => {
  const { startEcho } = await import('/src/online/EchoTest.ts');
  window.__eco = await startEcho(window.__debug, opts);
}, JSON.parse(optsJson));

const keys = { E: 'KeyE', R: 'KeyR', W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD', Shift: 'ShiftLeft', Q: 'KeyQ', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
let n = 0;
for (const step of script.split(',')) {
  const [act, a, b] = step.split(':');
  if (act === 'wait') await page.waitForTimeout(Number(a));
  else if (act === 'shot') await page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}.png` });
  else if (act === 'seq') {
    for (let i = 0; i < Number(a); i++) {
      await page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}.png` });
      await page.waitForTimeout(Number(b));
    }
  } else if (['up', 'down', 'left', 'right'].includes(act)) {
    await page.keyboard.down(keys[act]);
    await page.waitForTimeout(Number(a ?? 60));
    await page.keyboard.up(keys[act]);
  } else if (act === 'E' || act === 'R') {
    await page.keyboard.press(keys[act]);
  } else if (act === 'combo') {
    const ks = a.split('+');
    for (const k of ks) await page.keyboard.down(k);
    await page.waitForTimeout(Number(b ?? 70));
    for (const k of ks) await page.keyboard.up(k);
  } else if (act === 'space') {
    await page.keyboard.down('Space');
    await page.waitForTimeout(Number(a));
    await page.keyboard.up('Space');
  } else if (act.startsWith('+')) await page.keyboard.down(keys[act.slice(1)]);
  else if (act.startsWith('-')) await page.keyboard.up(keys[act.slice(1)]);
}
const result = await page.evaluate(() => ({
  eco: window.__eco.metrics(),
  moves: window.__garrafao.moves(),
  shots: window.__garrafao.shots().length,
  fps: Math.round(window.__garrafao.fps()),
}));
result.errors = errors;
writeFileSync(`${out}/metricas.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
