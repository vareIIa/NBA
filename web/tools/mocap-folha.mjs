// Prints da comparação lado a lado (mocap.html) em N pontos do clipe, para a folha com o vídeo real.
//   node tools/mocap-folha.mjs <saída> [câmeras=lado,frente] [n=8] [query extra, ex.: "&vel=0.4&filtro=3"]
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [out = 'test-results/mocap', camsArg = 'lado,frente', nArg = '8', extra = ''] = process.argv.slice(2);
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop() : null;
const exe = dir ? join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') : process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
mkdirSync(out, { recursive: true });
const n = Number(nArg);
let info = null;
for (const cam of camsArg.split(',')) {
  await page.goto(`http://127.0.0.1:5173/mocap.html?cam=${cam}${extra}`);
  await page.waitForFunction(() => window.__mocap?.ready === true, undefined, { timeout: 30000 });
  info = await page.evaluate(() => window.__mocap.durations);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    await page.evaluate((p) => window.__mocap.setPhase(p), u);
    await page.screenshot({ path: join(out, `${cam}_${String(i).padStart(2, '0')}.png`) });
  }
}
writeFileSync(join(out, 'info.json'), JSON.stringify({ n, ...info }, null, 1));
console.log('ok', out, info);
await browser.close();
