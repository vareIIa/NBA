// Prints da arena: câmera do jogo (parado e andando para o canto), de cima e aérea, e o FPS.
//   node tools/arena-prints.mjs <saida_dir> ["?arena=0"]
// As vistas de cima/aérea usam um renderer à parte, na cena do jogo, sem a neblina.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [out, query = ''] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop() : null;
const exe = dir ? join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') : undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
const t0 = Date.now();
await page.goto(`http://127.0.0.1:5173/${query}`);
await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 60000 });
console.log(`pronto em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/jogo.png` });
console.log(`FPS parado: ${(await page.evaluate(() => window.__garrafao.fps())).toFixed(0)}`);
const census = await page.evaluate(() => {
  const arena = window.__debug.animator.root.parent.getObjectByName('arena');
  if (!arena) return null;
  let tris = 0, people = 0, meshes = 0;
  arena.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const n = o.count ?? 1;
    const g = o.geometry;
    tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * n;
    if (o.name.startsWith('torcida_')) people += n;
  });
  return { tris, people, meshes };
});
if (census) console.log(`arena: ${census.meshes} malhas, ${(census.tris / 1e6).toFixed(2)} M triângulos, ${census.people} torcedores`);
await page.keyboard.down('KeyA');
await page.waitForTimeout(1400);
await page.keyboard.up('KeyA');
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/jogo-canto.png` });
await page.keyboard.down('KeyS');
await page.waitForTimeout(1500);
await page.keyboard.up('KeyS');
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/jogo-recuo.png` });
console.log(`FPS andando: ${(await page.evaluate(() => window.__garrafao.fps())).toFixed(0)}`);

// cesta / cesta-lado: de perto, com o aro e a face da tabela da física em arame vermelho por cima (confere o encaixe).
const views = {
  cima: { pos: [12.7, 78, 0.01], target: [12.7, 0, 0], fov: 40, hide: ['telao'] },
  aerea: { pos: [44, 26, 30], target: [8, 0, -2], fov: 45 },
  cesta: { pos: [2.6, 3.6, 1.9], target: [-0.1, 3.1, 0], fov: 40, physics: true },
  'cesta-lado': { pos: [-0.2, 3.25, 2.4], target: [-0.2, 3.25, 0], fov: 40, physics: true },
  estrutura: { pos: [3.5, 2.2, 6.5], target: [-1.8, 1.9, 0], fov: 45 },
};
for (const [name, v] of Object.entries(views)) {
  const data = await page.evaluate((v) => {
    const { THREE, animator } = window.__debug;
    const scene = animator.root.parent;
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(1600, 1000, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const cam = new THREE.PerspectiveCamera(v.fov, 1.6, v.pos[1] > 40 ? 5 : 0.05, 400);
    cam.position.set(...v.pos);
    cam.lookAt(...v.target);
    const fog = scene.fog;
    scene.fog = null;
    const hidden = (v.hide ?? []).map((n) => scene.getObjectByName(n)).filter((o) => o?.visible);
    hidden.forEach((o) => (o.visible = false));
    const extra = [];
    if (v.physics) {
      // Aro e tabela da física (HoopSpec): toro na linha central do tubo e o contorno da face.
      const { game } = window.__debug;
      const h = game.hoop;
      const red = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, depthTest: false });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(h.rimCenterlineRadius(), h.rimTubeRadius, 6, 48), red);
      const c = h.rimCenter();
      rim.position.set(c.x, c.z, c.y);
      rim.rotation.x = -Math.PI / 2;
      const f = h.backboardFaceCenter;
      const face = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(h.backboardWidth, h.backboardHeight)),
        new THREE.LineBasicMaterial({ color: 0xff0000, depthTest: false }),
      );
      face.position.set(f.x, f.z, f.y);
      face.rotation.y = Math.PI / 2;
      extra.push(rim, face);
      extra.forEach((o) => (o.renderOrder = 10, scene.add(o)));
    }
    renderer.render(scene, cam);
    extra.forEach((o) => scene.remove(o));
    hidden.forEach((o) => (o.visible = true));
    scene.fog = fog;
    const url = canvas.toDataURL('image/png');
    renderer.dispose();
    return url;
  }, v);
  writeFileSync(`${out}/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
}
await browser.close();
console.log('prints em', out);
