// Sonda do laboratório: node tools/sonda-lab.mjs "<expressão por quadro>" quadros [input-json]
import { chromium } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto('http://127.0.0.1:5173/?lab=1');
await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab);
const [expr, frames = '30', input = '{}'] = process.argv.slice(2);
await page.evaluate(() => { window.__lab.place(7.4, -0.6, 'r'); window.__lab.step(45, {}); });
for (let i = 0; i < Number(frames); i++) {
  console.log(i, JSON.stringify(await page.evaluate(([e, inp]) => { window.__lab.step(1, JSON.parse(inp)); const { animator, game, THREE } = window.__debug; return eval(e); }, [expr, input])));
}
await browser.close();
