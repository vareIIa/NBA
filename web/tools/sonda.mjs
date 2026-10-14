// Avalia uma expressão JS na página do jogo (depuração): node tools/sonda.mjs "<expr>" [esperaMs]
import { chromium } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop() : null;
const exe = dir ? join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') : undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto('http://127.0.0.1:5173/');
await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 30000 });
await page.waitForTimeout(Number(process.argv[3] ?? 500));
console.log(JSON.stringify(await page.evaluate(process.argv[2]), null, 1));
await browser.close();
