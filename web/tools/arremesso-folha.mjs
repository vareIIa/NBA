// Folha de quadros do jump shot no laboratório, câmera aberta (vê a bola no alto).
//   node tools/arremesso-folha.mjs <saida_dir> [segurar=26] [quadros=90] [cada=4] [vistas=side,front]
// SETUP='{"lowerBase":"Kobe",...}' troca o arremesso equipado. Imprime por quadro a fase, a palma e a bola.
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const [out, holdArg = '26', framesArg = '90', everyArg = '4', viewsArg = 'side,front'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 400, height: 520 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto('http://127.0.0.1:5173/?lab=1' + (process.env.LAB_URL || ''));
await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab);
// MAO=l arremessa com a esquerda.
await page.evaluate(([setup, hand]) => {
  const { game } = window.__debug;
  if (setup) game.setShotSetup({ id: 'x', name: 'x', lowerBase: 'Curry', upperRelease1: 'Curry', upperRelease2: 'Curry', blendPercent: 0, releaseSpeed: 1, ...JSON.parse(setup) });
  window.__lab.place(7.4, -0.6, hand);
  window.__lab.step(45, {});
}, [process.env.SETUP || '', process.env.MAO || 'r']);
// ANDAR='{"n":30,"moveX":0.7,"sprint":true}': anda/corre antes do arremesso (pull-up), segue segurando o comando;
// CONTINUAR=1 continua andando depois de soltar o X.
const walk = process.env.ANDAR ? JSON.parse(process.env.ANDAR) : null;
if (walk) await page.evaluate((w) => window.__lab.step(w.n, { moveX: w.moveX ?? 0, moveY: w.moveY ?? 0, sprint: !!w.sprint }), walk);
const log = [];
for (let f = 0; f < Number(framesArg); f++) {
  const info = await page.evaluate(([shoot, w]) => {
    const { animator: A, game, THREE } = window.__debug;
    window.__lab.step(1, { shoot, ...(w ? { moveX: w.moveX ?? 0, moveY: w.moveY ?? 0, sprint: !!w.sprint } : {}) });
    const st = A.jumpShotState();
    const palm = A.palmWorld(game.dribbler.ballHand(), new THREE.Vector3());
    const ball = game.ballMesh.position;
    const toe = A.bone('ball_l').getWorldPosition(new THREE.Vector3());
    const pel = A.bone('pelvis').getWorldPosition(new THREE.Vector3());
    return `${game.phase} t=${st ? st.t.toFixed(3) : '-'} R=${st ? st.releaseAt.toFixed(3) : '-'} palmaY=${palm.y.toFixed(2)} bolaY=${ball.y.toFixed(2)} peL=${toe.y.toFixed(3)} peLxz=${toe.x.toFixed(3)},${toe.z.toFixed(3)} raiz=${A.root.position.x.toFixed(3)},${A.root.position.z.toFixed(3)} pelve=${pel.x.toFixed(3)},${pel.y.toFixed(3)},${pel.z.toFixed(3)} acao=${A.actionKind() ?? "-"} gesto=${(A.idleGesture?.() || "-").replace(/ /g, "_")}`;
  }, [f < Number(holdArg), f < Number(holdArg) || process.env.CONTINUAR ? walk : null]);
  log.push(`${f} ${info}`);
  if (f % Number(everyArg) === 0) {
    for (const v of viewsArg.split(',')) {
      await page.evaluate((vv) => {
        const lab = window.__lab.lab;
        const A = lab.animator;
        const cam = lab.cameras[0];
        const size = lab.renderer.getSize(new A.root.position.constructor());
        lab.renderer.setScissorTest(false);
        lab.renderer.setViewport(0, 0, size.x, size.y);
        for (const line of lab.lines) line.visible = false;
        for (const label of lab.labels) label.style.display = 'none';
        lab.flagsLabel.style.display = 'none';
        cam.aspect = size.x / size.y;
        cam.fov = 40;
        cam.updateProjectionMatrix();
        const pos = A.root.position.clone();
        const fwd = pos.clone().set(0, 0, 1).applyQuaternion(A.root.quaternion);
        const left = pos.clone().set(1, 0, 0).applyQuaternion(A.root.quaternion);
        const target = pos.clone().add(pos.clone().set(0, 1.25, 0));
        cam.up.set(0, 1, 0);
        if (vv === 'side') cam.position.copy(pos).addScaledVector(left, -4.6).add(pos.clone().set(0, 1.3, 0)).addScaledVector(fwd, 0.4);
        else cam.position.copy(pos).addScaledVector(fwd, 4.6).add(pos.clone().set(0, 1.4, 0));
        cam.lookAt(target);
        lab.renderer.render(lab.scene, cam);
      }, v);
      await page.screenshot({ path: `${out}/${v}_${String(f).padStart(3, '0')}.png` });
    }
  }
}
writeFileSync(`${out}/log.txt`, log.join('\n'));
console.log(log.filter((l, i) => i % 3 === 0).join('\n'));
await browser.close();
