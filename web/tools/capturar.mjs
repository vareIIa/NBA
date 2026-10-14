// Captura rápida para inspeção da animação: node tools/capturar.mjs <saida_dir> <cam> <roteiro>
// roteiro: lista "acao:ms" separada por vírgula. Ações: wait, shot (print), W/A/S/D/Shift/Q (segura), up/down/left/right
// (flick do Pro Stick nas setas), space:ms (segura o arremesso), seq:N:ms (N prints a cada ms).
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [out, cam = 'jogo', script = 'wait:1500,shot', lento = '1'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop() : null;
const exe = dir ? join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') : undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
await page.goto(`http://127.0.0.1:5173/?cam=${cam}&lento=${lento}`);
await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 30000 });
const keys = { E: 'KeyE', R: 'KeyR', J: 'KeyJ', W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD', Shift: 'ShiftLeft', Q: 'KeyQ', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', space: 'Space' };
let n = 0;
const held = new Set();
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
  } else if (act === 'combo') {
    // combo:ArrowDown+ArrowLeft:ms — aperta juntas (diagonal do Pro Stick) e solta.
    const ks = a.split('+');
    for (const k of ks) await page.keyboard.down(k);
    await page.waitForTimeout(Number(b ?? 70));
    for (const k of ks) await page.keyboard.up(k);
  } else if (act === 'space') {
    await page.keyboard.down('Space');
    await page.waitForTimeout(Number(a));
    await page.keyboard.up('Space');
  } else if (act.startsWith('+')) {
    await page.keyboard.down(keys[act.slice(1)]);
    held.add(keys[act.slice(1)]);
  } else if (act.startsWith('-')) {
    await page.keyboard.up(keys[act.slice(1)]);
  } else if (act === 'log') console.log(JSON.stringify(await page.evaluate(() => ({ ...window.__garrafao.anim(), p: window.__garrafao.player(), moves: window.__garrafao.moves(), fps: window.__garrafao.fps() }))));
}
await browser.close();
