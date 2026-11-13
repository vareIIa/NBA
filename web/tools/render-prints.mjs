// Prints do render do jogo (o canvas de verdade, com o pós-processamento) e FPS sem limite de quadros:
//   node tools/render-prints.mjs <saida> [base=http://127.0.0.1:5173] [query=?menu=0]
// Vistas: câmera do jogo, de frente, de lado, perto por trás e os pés. Compare com ?render=0 (render antigo).
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [out, base = 'http://127.0.0.1:5173', query = '?menu=0'] = process.argv.slice(2);
if (!out) throw new Error('uso: node tools/render-prints.mjs <saida> [base] [query]');
mkdirSync(out, { recursive: true });
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
async function open(extra = []) {
  const browser = await chromium.launch({
    executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
    args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', ...extra],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('ERRO', String(e)));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(m.type().toUpperCase(), m.text().slice(0, 300)));
  await page.goto(base + query);
  await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 120000 });
  await page.addStyleTag({ content: '#hud, .hud, .gamehud { opacity: 0 !important; }' });
  if (process.env.JS) await page.evaluate((code) => new Function('d', code)(window.__debug), process.env.JS);
  await page.waitForTimeout(1500);
  return { browser, page };
}
let { browser, page } = await open();

const views = {
  jogo: { mode: 'jogo' },
  frente: { mode: 'frente' },
  lado: { mode: 'lado' },
  perto: { mode: 'jogo', tuning: { distanceBehind: 2.7, height: 1.55, lookHeight: 1.05, lookTowardRim: 0, rimPull: 0 } },
  pes: { mode: 'jogo', tuning: { distanceBehind: 1.7, height: 0.55, lookHeight: 0.12, lookTowardRim: 0, rimPull: 0 } },
  // Close do rosto: a câmera de frente, levada para 80 cm da cabeça a cada quadro.
  rosto: { mode: 'frente', face: true },
};
// JS=<código> roda na página antes dos prints (d = window.__debug; ex.: JS="d.render.look.bloom=0"); VISTAS=jogo,perto filtra.
const only = process.env.VISTAS?.split(',');
for (const [name, v] of Object.entries(views)) {
  if (only && !only.includes(name)) continue;
  await page.evaluate((v) => {
    const rig = window.__debug.rig;
    window.__tuning0 ??= { ...rig.tuning };
    Object.assign(rig.tuning, window.__tuning0, v.tuning ?? {});
    rig.mode = v.mode;
    const d = window.__debug;
    d.render.__render ??= d.render.render.bind(d.render);
    d.render.render = !v.face
      ? d.render.__render
      : (scene, camera) => {
          const head = d.animator.root.getObjectByName('head').getWorldPosition(new d.THREE.Vector3());
          const away = camera.position.clone().sub(head).setY(0).normalize();
          camera.position.copy(head).addScaledVector(away, 0.8).add(new d.THREE.Vector3(0, 0.1, 0));
          camera.lookAt(head.x, head.y + 0.08, head.z);
          camera.updateMatrixWorld();
          d.render.__render(scene, camera);
        };
  }, v);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(out, name + '.png') });
}
await browser.close();
if (process.env.FPS === '0') process.exit(0);
// FPS: outro navegador, sem limite de quadros (com ele ligado o print não fecha).
({ browser, page } = await open(['--disable-frame-rate-limit', '--disable-gpu-vsync']));
const fps = await page.evaluate(async () => {
  const f0 = window.__garrafao.frame;
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 4000));
  return ((window.__garrafao.frame - f0) * 1000) / (performance.now() - t0);
});
const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '?';
});
console.log(`FPS sem limite (1600x900, câmera do jogo): ${fps.toFixed(0)} · ${gpu}`);
await browser.close();
