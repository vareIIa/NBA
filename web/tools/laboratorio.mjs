// Laboratório de dribles: roda cenários quadro a quadro no modo ?lab=1 e salva, para cada um, quadros com 4 câmeras
// (trás, lado, frente, cima), rastros da bola (laranja) e das palmas (azul = esquerda, rosa = direita), marcas dos pés
// apoiados (vermelho = pé deslizando) e as métricas de fluidez.
//
//   node tools/laboratorio.mjs <saida> [cenario1,cenario2,...] [cada=4]
//
// Precisa do Vite rodando em 127.0.0.1:5173 (npm run dev -- --host 127.0.0.1).
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [out = 'test-results/laboratorio', only = '', everyArg = '4'] = process.argv.slice(2);
const every = Number(everyArg);

// Entrada por quadro: {n: quadros, ...InputState parcial}. Flick = 4 quadros com o stick e solta.
const flick = (proX, proY, extra = {}) => [{ n: 4, proX, proY, ...extra }, { n: 1, ...extra }];
const sweep = (degrees, frames, extra = {}) =>
  Array.from({ length: frames + 1 }, (_, i) => {
    const deg = 90 - (degrees * i) / frames;
    return { n: 1, proX: Math.cos((deg * Math.PI) / 180), proY: Math.sin((deg * Math.PI) / 180), ...extra };
  }).concat([{ n: 1, ...extra }]);
const wait = (n, extra = {}) => [{ n, ...extra }];

export const Cenarios = {
  parado: { hand: 'r', steps: wait(60) },
  baixo_lt: { hand: 'r', steps: wait(60, { protect: true }) },
  andando: { hand: 'r', steps: wait(80, { moveY: 1 }) },
  correndo_rt: { hand: 'r', steps: wait(70, { moveY: 1, sprint: true }) },
  lado_esquerda: { hand: 'r', steps: wait(60, { moveX: -1 }) },
  lado_direita: { hand: 'r', steps: wait(60, { moveX: 1 }) },
  de_costas: { hand: 'r', steps: wait(70, { moveY: -1 }) },
  crossover: { hand: 'r', steps: [...flick(0, 1), ...wait(50)] },
  crossover_andando: { hand: 'r', steps: [...wait(25, { moveY: 1 }), ...flick(0, 1, { moveY: 1 }), ...wait(45, { moveY: 1 })] },
  crossover_ataque: { hand: 'r', steps: [...wait(25, { moveY: 1, sprint: true }), ...flick(0, 1, { moveY: 1, sprint: true }), ...wait(45, { moveX: -1, sprint: true })] },
  entre_pernas: { hand: 'r', steps: [...flick(-1, 0), ...wait(50)] },
  behind_back: { hand: 'r', steps: [...flick(-0.71, -0.71), ...wait(50)] },
  hesitacao: { hand: 'r', steps: [...flick(1, 0), ...wait(45)] },
  spin: { hand: 'r', steps: [...sweep(300, 12), ...wait(60)] },
  half_spin: { hand: 'r', steps: [...sweep(110, 6), ...wait(55)] },
  step_back: { hand: 'r', steps: [...flick(0, -1), ...wait(55)] },
  size_up: { hand: 'r', steps: [...flick(0, 1), ...wait(22), ...flick(0, 1), ...wait(22), ...flick(1, 0), ...wait(22), ...flick(0, 1), ...wait(40)] },
  troca_auto: { hand: 'l', steps: wait(70, { moveX: 1 }) },
  retreat: { hand: 'r', steps: [...wait(20, { moveY: 1 }), ...wait(60, { moveY: -1 })] },
};

const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop() : null;
const exe = dir ? join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') : process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch({
  executablePath: exe,
  args: process.platform === 'win32' ? ['--enable-gpu', '--use-angle=d3d11'] : ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));

const names = only ? only.split(',') : Object.keys(Cenarios);
const summary = {};
for (const name of names) {
  const sc = Cenarios[name];
  if (!sc) {
    console.log('cenário desconhecido:', name);
    continue;
  }
  await page.goto('http://127.0.0.1:5173/?lab=1');
  await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab, undefined, { timeout: 30000 });
  await page.evaluate((hand) => {
    window.__lab.place(7.4, -0.6, hand);
    window.__lab.step(45, {});
    window.__lab.reset();
  }, sc.hand);
  const folder = join(out, name);
  mkdirSync(folder, { recursive: true });
  let frame = 0;
  let shot = 0;
  for (const step of sc.steps) {
    const { n, ...input } = step;
    for (let i = 0; i < n; i++) {
      await page.evaluate((inp) => window.__lab.step(1, inp), input);
      if (frame % every === 0) {
        await page.evaluate(() => window.__lab.render());
        await page.screenshot({ path: join(folder, `${String(shot++).padStart(3, '0')}_q${String(frame).padStart(3, '0')}.png`) });
      }
      frame++;
    }
  }
  const metrics = await page.evaluate(() => window.__lab.metrics());
  summary[name] = metrics;
  writeFileSync(join(folder, 'metricas.json'), JSON.stringify(metrics, null, 1));
  console.log(
    `${name.padEnd(18)} pé desliza máx ${metrics.footSlideMax.toFixed(2)} m/s (média ${metrics.footSlideMean.toFixed(2)})` +
      `  estalos ${metrics.popCount}${metrics.popWorst ? ` (pior ${metrics.popWorst.bone} q${metrics.popWorst.frame})` : ''}` +
      `  bola-mão ${metrics.ballGapMax.toFixed(2)} m  quiques ${metrics.bounces}  ${metrics.moves.join(' > ')}`,
  );
}
writeFileSync(join(out, 'resumo.json'), JSON.stringify(summary, null, 1));
await browser.close();
