// Prints quadro a quadro da locomoção lado a lado (locomocao.html) e as métricas dos dois jogadores.
//   node tools/locomocao-folha.mjs <saída> [câmeras=tras,lado] [cada=4] [quadros=690] [query extra]
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [out = 'test-results/locomocao', camsArg = 'tras,lado', everyArg = '4', framesArg = '690', extra = ''] = process.argv.slice(2);
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop() : null;
const exe = dir ? join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') : process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
page.on('console', (m) => m.text().startsWith('loops') && console.log(m.text().slice(0, 600)));
const every = Number(everyArg);
const total = Number(framesArg);
let metrics = null;
for (const cam of camsArg.split(',')) {
  const folder = join(out, cam);
  mkdirSync(folder, { recursive: true });
  await page.goto(`http://127.0.0.1:5173/locomocao.html?cam=${cam}&auto=0${extra}`);
  await page.waitForFunction(() => window.__loco?.ready === true, undefined, { timeout: 60000 });
  for (let f = 0; f < total; f += every) {
    await page.evaluate((n) => window.__loco.step(n), every);
    await page.screenshot({ path: join(folder, `q${String(f + every).padStart(4, '0')}.png`) });
  }
  metrics = await page.evaluate(() => window.__loco.metrics());
}
writeFileSync(join(out, 'metricas.json'), JSON.stringify(metrics, null, 1));
console.log(JSON.stringify(metrics));
await browser.close();
