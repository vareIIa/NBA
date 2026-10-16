// Sonda de um cenário do laboratório: roda o cenário (cenarios.mjs) quadro a quadro, como laboratorio.mjs, e imprime
// uma expressão por quadro (acesso a animator, game e THREE).
//   node tools/sonda-cenario.mjs <cenario> "<expressão>" [q0] [q1]   (LAB_HZ=144: um passo = 1/144 s; a expressão roda
//   uma vez por quadro de 1/60 s do cenário)
import { chromium } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Cenarios } from './cenarios.mjs';

const [name, expr, q0 = '0', q1 = '9999'] = process.argv.slice(2);
const sc = Cenarios[name];
if (!sc) throw new Error(`cenário desconhecido: ${name}`);
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto('http://127.0.0.1:5173/?lab=1' + (process.env.LAB_URL || ''));
await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab);
await page.evaluate(([hand, hz]) => {
  window.__lab.lab.hz = hz;
  window.__lab.place(7.4, -0.6, hand);
  window.__lab.step(45, {});
  window.__lab.reset();
}, [sc.hand, Number(process.env.LAB_HZ || 60)]);
let frame = 0;
for (const step of sc.steps) {
  const { n, ...input } = step;
  for (let i = 0; i < n; i++) {
    const out = await page.evaluate(
      ([e, inp]) => {
        window.__lab.step(1, inp);
        const { animator, game, THREE } = window.__debug;
        return eval(e);
      },
      [expr, input],
    );
    if (frame >= Number(q0) && frame <= Number(q1)) console.log(frame, JSON.stringify(out));
    frame++;
  }
}
await browser.close();
