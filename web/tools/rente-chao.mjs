// Câmera rente ao chão (2 cm), de lado, olhando os pés: mostra a sola entrando no piso.
//   node tools/rente-chao.mjs <saida.png> [quadros] [input-json]
import { chromium } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const [out, steps = '45', input = '{}'] = process.argv.slice(2);
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:5173/?lab=1');
await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab);
await page.evaluate(([n, inp]) => {
  window.__lab.place(7.4, -0.6, 'r'); window.__lab.step(45, {}); window.__lab.step(Number(n), JSON.parse(inp));
  for (const d of document.querySelectorAll('body > div')) if (d.style.position === 'fixed') d.style.display = 'none';
  const { lab } = window.__lab; const { animator, THREE } = window.__debug;
  const cam = new THREE.PerspectiveCamera(20, 16 / 9, 0.05, 50);
  const p = animator.root.position; const left = new THREE.Vector3(1, 0, 0).applyQuaternion(animator.root.quaternion);
  cam.position.copy(p).addScaledVector(left, -2.2); cam.position.y = 0.02; cam.lookAt(p.x, 0.08, p.z);
  lab.renderer.setViewport(0, 0, 1280, 720); lab.renderer.render(lab.scene, cam);
}, [steps, input]);
await page.screenshot({ path: out });
await browser.close();
