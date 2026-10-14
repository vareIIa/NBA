// Rastro do laboratório: roda um cenário do laboratorio.mjs e imprime, por quadro, uma expressão.
//   node tools/rastro-lab.mjs <cenario> "<expressão>" [q0] [q1]
// A expressão tem acesso a animator, game, THREE e lab (métricas do quadro em lab.frameFlags).
import { chromium } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Cenarios } from './cenarios.mjs';
const [name, expr, q0 = '0', q1 = '9999'] = process.argv.slice(2);
const sc = Cenarios[name];
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto('http://127.0.0.1:5173/?lab=1');
await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab);
await page.evaluate(([hand, anim]) => {
  Object.assign(window.__debug.animator, JSON.parse(anim));
  window.__lab.place(7.4, -0.6, hand); window.__lab.step(45, {}); window.__lab.reset();
}, [sc.hand, process.env.LAB_ANIM || '{}']);
let frame = 0;
for (const { n, ...input } of sc.steps) {
  for (let i = 0; i < n; i++, frame++) {
    const out = await page.evaluate(([inp, e]) => {
      window.__lab.step(1, inp);
      const { animator, game, THREE } = window.__debug; const lab = window.__lab.lab;
      return eval(e);
    }, [input, expr]);
    if (frame + 1 >= Number(q0) && frame + 1 <= Number(q1)) console.log(`q${frame + 1}`, JSON.stringify(out));
  }
}
await browser.close();
