// Quadros da roupa em movimento (headless): câmera de inspeção perto do jogador, roteiro de teclado (corrida, dribles do
// Pro Stick, agachar) e um PNG a cada 0,2 s. Serve para conferir se a roupa atravessa o corpo.
//   node tools/roupa-quadros.mjs <pasta> [query]        ex.: node tools/roupa-quadros.mjs ../Saved/roupa "?uniforme=branco"
// Com SEM_EMPURRAO=1 desliga o LimbPush (para comparar antes/depois).
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? '../Saved/roupa';
const query = process.argv[3] ?? '';
mkdirSync(out, { recursive: true });
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto(`http://127.0.0.1:5173/${query}`);
const setup = async () => {
await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 60000 });
await page.evaluate((semEmpurrao) => {
  const d = window.__debug;
  const T = d.THREE;
  if (semEmpurrao) for (const p of d.gear?.pushers ?? []) p.uniforms.uCapN.value = 0;
  let scene = d.animator.root;
  while (scene.parent) scene = scene.parent;
  const c = document.createElement('canvas');
  c.width = c.height = 640;
  c.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:640px;z-index:99999;pointer-events:none';
  document.body.appendChild(c);
  const r = new T.WebGLRenderer({ canvas: c, antialias: true });
  r.outputColorSpace = T.SRGBColorSpace;
  r.toneMapping = T.ACESFilmicToneMapping;
  const cam = new T.PerspectiveCamera(30, 1, 0.1, 50);
  window.__insp = { az: 0.5, h: 0.95, dist: 3.0 };
  const loop = () => {
    const i = window.__insp;
    const p = d.animator.root.position;
    const yaw = d.animator.root.rotation.y + i.az;
    cam.position.set(p.x + Math.sin(yaw) * i.dist, i.h, p.z + Math.cos(yaw) * i.dist);
    cam.lookAt(p.x, i.h - 0.05, p.z);
    r.render(scene, cam);
    requestAnimationFrame(loop);
  };
  loop();
}, !!process.env.SEM_EMPURRAO);
};
await setup();

const wait = (ms) => page.waitForTimeout(ms);
let n = 0;
const shot = async (tag) => page.screenshot({ path: join(out, `${String(n++).padStart(2, '0')}_${tag}.png`) });
// O Vite recarrega a página quando outra sessão salva arquivos: refaz a câmera se ela sumiu.
const az = async (v) => {
  if (!(await page.evaluate(() => !!window.__insp))) await setup();
  await page.evaluate((x) => (window.__insp.az = x), v);
};
const flick = async (key) => {
  await page.keyboard.down(key);
  await wait(70);
  await page.keyboard.up(key);
};
// Corrida de frente e de lado.
await page.keyboard.down('KeyW');
await page.keyboard.down('ShiftLeft');
for (const a of [0.5, 1.6, 3.1]) {
  await az(a);
  await wait(350);
  await shot('corrida');
}
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
// Corrida de lado (A), vista de trás e de lado: a barra de trás da regata e a perna que sobe.
await page.keyboard.down('KeyA');
for (const a of [3.14, 3.14, 2.4]) {
  await az(a);
  await wait(300);
  await shot('lado');
}
await page.keyboard.up('KeyA');
// Dribles do Pro Stick (setas), vistos de três lados.
for (const [key, a] of [
  ['ArrowLeft', 0.4],
  ['ArrowRight', -0.6],
  ['ArrowDown', 1.6],
  ['ArrowUp', 3.0],
  ['ArrowLeft', -1.6],
]) {
  await az(a);
  await flick(key);
  for (let k = 0; k < 3; k++) {
    await wait(200);
    await shot(key.replace('Arrow', '').toLowerCase());
  }
}
console.log(`${n} quadros em ${out}`);
await browser.close();
