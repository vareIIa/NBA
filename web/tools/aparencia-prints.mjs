// Prints da aparência (docs/26-aparencia.md): para cada aparência da lista, veste no jogador parado (PlayerOutfit,
// o mesmo caminho do menu), mede quanto a troca levou e fotografa rosto, corpo (frente e costas) e pés. Headless.
//   node tools/aparencia-prints.mjs <pasta> [query] [aparências JSON]
//   ex.: node tools/aparencia-prints.mjs ../Saved/aparencia "" '[{"skin":"#3f2418","kit":"branca","shoes":"tenis_cimento_4"}]'
// Sem a lista: o tom original, um médio e um escuro, cada um com outro kit e outro tênis. LAB_BASE troca o endereço.
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? '../Saved/aparencia';
const query = process.argv[3] || '?arena=0';
const looks = process.argv[4]
  ? JSON.parse(process.argv[4])
  : [
      { skin: '#e9bba9', kit: 'vermelha', shoes: 'tenis_retro_alto_1' },
      { skin: '#b07753', kit: 'branca', shoes: 'tenis_cimento_4' },
      { skin: '#3f2418', kit: 'vermelha', shoes: 'tenis_baixo_moderno' },
    ];
const base = process.env.LAB_BASE ?? 'http://127.0.0.1:5173/';
mkdirSync(out, { recursive: true });
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
page.on('console', (m) => m.type() === 'warning' && console.log('aviso:', m.text()));
await page.goto(`${base}${query}`);
await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 90000 });
// Câmera de inspeção num canvas por cima do jogo (o jogo segue rodando por baixo, o jogador parado no idle).
await page.evaluate(() => {
  const d = window.__debug;
  const T = d.THREE;
  let scene = d.animator.root;
  while (scene.parent) scene = scene.parent;
  const c = document.createElement('canvas');
  c.width = c.height = 640;
  c.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:640px;z-index:99999;pointer-events:none';
  document.body.appendChild(c);
  const r = new T.WebGLRenderer({ canvas: c, antialias: true });
  r.outputColorSpace = T.SRGBColorSpace;
  r.toneMapping = T.ACESFilmicToneMapping;
  const cam = new T.PerspectiveCamera(30, 1, 0.05, 50);
  window.__insp = { az: 0, h: 1.0, dist: 3.6, look: 0.95 };
  const head = new T.Vector3();
  const loop = () => {
    const i = window.__insp;
    let p = d.animator.root.position;
    // Rosto: segue a cabeça (o jogador parado fica na base do drible, agachado e com a cabeça à frente do quadril).
    if (i.face) {
      p = d.animator.bone('head').getWorldPosition(head);
      i.h = head.y + 0.08;
      i.look = head.y + 0.07;
    }
    const yaw = d.animator.root.rotation.y + i.az;
    cam.position.set(p.x + Math.sin(yaw) * i.dist, i.h, p.z + Math.cos(yaw) * i.dist);
    cam.lookAt(p.x, i.look, p.z);
    r.render(scene, cam);
    requestAnimationFrame(loop);
  };
  loop();
});
const views = {
  rosto: { az: 0.35, dist: 0.75, face: true },
  frente: { face: false, az: 0.3, h: 1.05, dist: 3.8, look: 0.98 },
  costas: { az: Math.PI - 0.3, h: 1.05, dist: 3.8, look: 0.98 },
  pes: { az: 0.6, h: 0.35, dist: 1.25, look: 0.1 },
};
for (const [i, look] of looks.entries()) {
  const ms = await page.evaluate(async (l) => {
    const t0 = performance.now();
    await window.__debug.outfit.apply(l);
    return performance.now() - t0;
  }, look);
  const tri = await page.evaluate(() => window.__debug.gear?.coveredTriangles ?? 0);
  console.log(`${i}: ${JSON.stringify(look)} vestiu em ${ms.toFixed(0)} ms (${tri} triângulos sob a roupa)`);
  for (const [name, v] of Object.entries(views)) {
    await page.evaluate((x) => Object.assign(window.__insp, x), v);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(out, `${i}_${name}.png`) });
  }
}
await browser.close();
