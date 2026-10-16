// Sonda das bandejas: roda cenários de tools/cenarios-bandeja.mjs e avalia uma expressão por quadro (com `lab`, `game`,
// `anim` e `t` = s desde o gather no escopo). Imprime os quadros de q0 a q1 contados do gather.
//   LAB_BASE=http://127.0.0.1:5181 node tools/sonda-bandeja.mjs <cenario1,cenario2> "<expr>" [q0=-5] [q1=60]
import { chromium } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CenariosBandeja } from './cenarios-bandeja.mjs';

const [names, expr, q0 = '-5', q1 = '60'] = process.argv.slice(2);
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto((process.env.LAB_BASE || 'http://127.0.0.1:5173') + '/?lab=1');
await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab);
for (const name of names.split(',')) {
  const sc = CenariosBandeja[name];
  // `dunk`: força a enterrada do cenário (LayupFinish), para ver cada variação.
  await page.evaluate((d) => { window.__forceDunk = d; }, sc?.dunk ?? null);
  await page.evaluate(([x, y, hand]) => {
    const L = window.__lab;
    L.lab.animator.endCelebration();
    L.lab.game.layup.end();
    L.lab.game.layup.forceDunk = window.__forceDunk ?? null;
    L.place(x, y, hand);
    L.step(30, {});
    L.reset();
    window.__gq = null;
  }, [sc.at[0], sc.at[1], sc.hand]);
  console.log('==', name);
  let q = 0;
  const buffer = [];
  for (const step of sc.steps) {
    const { n, until, ...input } = step;
    for (let i = 0; i < n; i++) {
      if (until !== undefined) {
        const d = await page.evaluate(() => Math.hypot(window.__lab.lab.game.position.x, window.__lab.lab.game.position.y));
        if (d <= until) break;
      }
      const out = await page.evaluate(
        ([inp, e, frame]) => {
          const L = window.__lab;
          L.step(1, inp);
          const lab = L.lab;
          const game = lab.game;
          const anim = lab.animator;
          if (window.__gq === null && game.layup.plan) window.__gq = frame;
          const t = game.layup.plan ? game.layup.time(game.now) : null;
          let v;
          try {
            v = eval(e);
          } catch (err) {
            v = String(err);
          }
          return { gq: window.__gq, v };
        },
        [input, expr, q],
      );
      buffer.push({ q, ...out });
      q++;
    }
  }
  const gq = buffer.find((b) => b.gq !== null)?.gq ?? 0;
  for (const b of buffer) {
    const k = b.q - gq;
    if (k >= Number(q0) && k <= Number(q1)) console.log(k, JSON.stringify(b.v));
  }
}
await browser.close();
