// Conferência da roupa inteira (docs/20, "Conferência"): poses do jogo (parado, corrida de frente e de lado, crossover,
// entre as pernas, arremesso, proteção, spin) em câmera lenta, cada uma fotografada de vários lados e de perto (pés,
// joelho e barra da bermuda, cava, gola, cintura). Um PNG por vista e uma folha por pose (<pasta>/folha_<pose>.png).
//   node tools/roupa-qa.mjs <pasta> [query]      ex.: node tools/roupa-qa.mjs ../Saved/qa "?tenis=tenis_cimento_4"
// Variáveis: LAB_BASE (servidor, padrão http://127.0.0.1:5173/), POSES=parado,corrida (só essas), LENTO (padrão 0.12),
// JS (código rodado na página antes das poses, com `d = window.__debug`; ex.: desligar as molas do pano para comparar).
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const out = process.argv[2] ?? '../Saved/qa';
const extra = (process.argv[3] ?? '').replace(/^\?/, '');
const slow = process.env.LENTO ?? '0.12';
const only = process.env.POSES ? new Set(process.env.POSES.split(',')) : null;
mkdirSync(out, { recursive: true });
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 560, height: 560 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(m.type(), m.text().slice(0, 300)));
const query = `?arena=0&menu=0&lento=${slow}${extra ? `&${extra}` : ''}`;
await page.goto(`${process.env.LAB_BASE ?? 'http://127.0.0.1:5173/'}${query}`);
await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 90000 });
if (process.env.JS) await page.evaluate(`{ const d = window.__debug; ${process.env.JS} }`);

// Câmera de inspeção num canvas por cima do jogo: alvo num osso, ângulo em volta do jogador, altura relativa ao alvo.
await page.evaluate(() => {
  const d = window.__debug;
  const T = d.THREE;
  let scene = d.animator.root;
  while (scene.parent) scene = scene.parent;
  const c = document.createElement('canvas');
  c.width = c.height = 560;
  c.style.cssText = 'position:fixed;left:0;top:0;width:560px;height:560px;z-index:99999;pointer-events:none';
  document.body.appendChild(c);
  const r = new T.WebGLRenderer({ canvas: c, antialias: true });
  r.outputColorSpace = T.SRGBColorSpace;
  r.toneMapping = T.ACESFilmicToneMapping;
  const cam = new T.PerspectiveCamera(32, 1, 0.03, 50);
  const tgt = new T.Vector3();
  window.__insp = { t: 'pelvis', az: 0, dist: 3, dy: 0.1, ly: 0 };
  const loop = () => {
    const i = window.__insp;
    d.animator.bone(i.t).getWorldPosition(tgt);
    const yaw = d.animator.root.rotation.y + i.az;
    cam.position.set(tgt.x + Math.sin(yaw) * i.dist, tgt.y + i.dy, tgt.z + Math.cos(yaw) * i.dist);
    cam.lookAt(tgt.x, tgt.y + i.ly, tgt.z);
    r.render(scene, cam);
    requestAnimationFrame(loop);
  };
  loop();
});

// Vistas: o corpo inteiro de 4 lados e os pontos onde a roupa encontra a pele, de perto.
const Views = [
  ['frente', { t: 'pelvis', az: 0.25, dist: 3.4, dy: 0.15, ly: 0.05 }],
  ['costas', { t: 'pelvis', az: Math.PI + 0.25, dist: 3.4, dy: 0.15, ly: 0.05 }],
  ['lado', { t: 'pelvis', az: Math.PI / 2, dist: 3.4, dy: 0.15, ly: 0.05 }],
  ['pes_d', { t: 'foot_r', az: -0.9, dist: 0.75, dy: 0.18, ly: 0.02 }],
  ['pes_e', { t: 'foot_l', az: 0.9, dist: 0.75, dy: 0.18, ly: 0.02 }],
  ['pes_tras', { t: 'foot_r', az: Math.PI + 0.4, dist: 0.8, dy: 0.15, ly: 0.03 }],
  ['joelho', { t: 'calf_r', az: -0.6, dist: 0.85, dy: 0.05, ly: 0.06 }],
  ['joelho_tras', { t: 'calf_l', az: Math.PI + 0.5, dist: 0.85, dy: -0.05, ly: 0.06 }],
  ['cava', { t: 'upperarm_r', az: -1.2, dist: 0.8, dy: 0.05, ly: -0.08 }],
  ['gola', { t: 'neck_01', az: 0.3, dist: 0.8, dy: 0.12, ly: -0.05 }],
  ['cintura', { t: 'pelvis', az: -0.9, dist: 1.0, dy: 0.0, ly: 0.05 }],
];

const wait = (ms) => page.waitForTimeout(ms);
const key = async (k, ms) => {
  await page.keyboard.down(k);
  await wait(ms);
  await page.keyboard.up(k);
};
const shootAll = async (pose) => {
  const files = [];
  for (const [name, v] of Views) {
    await page.evaluate((x) => (window.__insp = { ...window.__insp, ...x }), v);
    await wait(60);
    const f = join(out, `${pose}_${name}.png`);
    await page.screenshot({ path: f });
    files.push(f);
  }
  return files;
};

// Cada pose: o que fazer no teclado e quando fotografar (ms reais; o jogo anda a LENTO da velocidade).
const Poses = [
  ['parado', async () => wait(400)],
  ['corrida', async () => (await page.keyboard.down('KeyW'), await page.keyboard.down('ShiftLeft'), await wait(1800))],
  ['lateral', async () => (await page.keyboard.up('ShiftLeft'), await page.keyboard.up('KeyW'), await page.keyboard.down('KeyA'), await wait(1600))],
  ['crossover', async () => (await page.keyboard.up('KeyA'), await wait(900), await key('ArrowLeft', 90), await wait(1100))],
  ['entrepernas', async () => (await wait(1500), await key('ArrowDown', 90), await wait(1100))],
  ['protecao', async () => (await wait(1200), await page.keyboard.down('KeyQ'), await wait(1500))],
  ['spin', async () => (await page.keyboard.up('KeyQ'), await wait(1200), await key('KeyE', 90), await wait(1300))],
  ['arremesso', async () => (await wait(1800), await page.keyboard.down('Space'), await wait(2600))],
];

for (const [pose, act] of Poses) {
  await act();
  if (only && !only.has(pose)) continue;
  const files = await shootAll(pose);
  // Folha da pose: 4 colunas.
  execFileSync('python', ['-I', '-c', `
import sys
from PIL import Image
fs = sys.argv[2:]
W = 280
cols = 4
rows = (len(fs) + cols - 1) // cols
s = Image.new('RGB', (W * cols, W * rows))
for i, f in enumerate(fs):
    s.paste(Image.open(f).resize((W, W)), ((i % cols) * W, (i // cols) * W))
s.save(sys.argv[1])
`, join(out, `folha_${pose}.png`), ...files]);
  console.log('pose', pose);
}
await page.keyboard.up('Space');
await browser.close();
