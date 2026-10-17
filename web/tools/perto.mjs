// Close-ups em alta resolução de pontos do jogador parado: node perto.mjs <saida> <base> <query> <vistas JSON>
import { chromium } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const [out, base, query, viewsJson] = process.argv.slice(2);
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto(base + query);
await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 90000 });
await page.evaluate(() => {
  const d = window.__debug; const T = d.THREE;
  let scene = d.animator.root; while (scene.parent) scene = scene.parent;
  const c = document.createElement('canvas'); c.width = c.height = 700;
  c.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:700px;z-index:99999';
  document.body.appendChild(c);
  const r = new T.WebGLRenderer({ canvas: c, antialias: true }); r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping;
  const cam = new T.PerspectiveCamera(28, 1, 0.01, 50); const tgt = new T.Vector3();
  window.__insp = { t: 'foot_r', az: 0, dist: 0.5, dy: 0.1, ly: 0, oy: 0 };
  const loop = () => { const i = window.__insp; d.animator.bone(i.t).getWorldPosition(tgt); tgt.y += i.oy;
    const yaw = d.animator.root.rotation.y + i.az;
    cam.position.set(tgt.x + Math.sin(yaw) * i.dist, tgt.y + i.dy, tgt.z + Math.cos(yaw) * i.dist); cam.lookAt(tgt.x, tgt.y + i.ly, tgt.z);
    r.render(scene, cam); requestAnimationFrame(loop); };
  loop();
});
await page.waitForTimeout(800);
for (const [name, v] of Object.entries(JSON.parse(viewsJson))) {
  // v.js: código para rodar antes da foto (esconder o corpo, pintar uma peça...), com `d` = window.__debug.
  if (v.js) await page.evaluate((code) => new Function('d', code)(window.__debug), v.js);
  await page.evaluate((x) => Object.assign(window.__insp, x), v);
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(out, name + '.png') });
}
await browser.close();
