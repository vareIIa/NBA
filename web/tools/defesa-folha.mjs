// Folha de quadros da defesa no laboratório (DefenseMotion): o jogador sem bola, de frente para a câmera da frente, e um
// cenário tocado direto no animador. Para ver os braços quadro a quadro (giro do braço, mãos na bola).
//   node tools/defesa-folha.mjs <saida_dir> <cenario> [quadros=60] [cada=3] [vistas=front,side]
// Cenários: maos (RS para cima), pulo (Y: contestação), toco (pulo + tapa na bola acima da cabeça), rebote-x (pega
// parado com as duas mãos), rebote-y (pula e pega com as duas mãos).
// LAB_ORIGIN = servidor (padrão http://127.0.0.1:5173; use um Vite sem HMR). Junta a folha com o Python:
//   python tools/defesa-folha.py <saida_dir> <saida.jpg>
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [out, scenario = 'pulo', framesArg = '60', everyArg = '3', viewsArg = 'front,side'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({
  executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
  args: ['--enable-gpu', '--use-angle=d3d11'],
});
const page = await browser.newPage({ viewport: { width: 420, height: 560 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto(`${process.env.LAB_ORIGIN ?? 'http://127.0.0.1:5173'}/?lab=1${process.env.LAB_URL ?? ''}`);
await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab);

// Sem bola, parado (como o defensor do online: fase da bola solta com a bola escondida embaixo do chão).
await page.evaluate(() => {
  const { game } = window.__debug;
  window.__lab.place(6.2, 0, 'r');
  window.__lab.step(30, {});
  const V = game.ball.position.constructor;
  game.phase = 'loose';
  game.ballMesh.visible = false;
  game.ball.position = new V(0, 0, -3);
  game.ball.velocity = new V(0, 0, 0);
  window.__lab.step(40, {});
});

const log = [];
for (let f = 0; f < Number(framesArg); f++) {
  const info = await page.evaluate(
    ([f, scenario]) => {
      const { animator: A, game, THREE } = window.__debug;
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(A.root.quaternion);
      const up = new THREE.Vector3(0, 1, 0);
      // Bola do rebote: à frente do jogador, na altura dada (mundo).
      const ballAt = (h, ahead = 0.45) => A.root.position.clone().addScaledVector(fwd, ahead).setY(h);
      if (scenario === 'maos') {
        if (f === 0) A.setHandsUp(true);
        if (f === 36) A.setHandsUp(false);
      } else if (scenario === 'pulo') {
        if (f === 0) A.playContest(0.55);
      } else if (scenario === 'toco') {
        if (f === 0) A.playContest(0.55);
        if (f === 10) A.playBlock('r', A.root.position.clone().addScaledVector(fwd, 0.55).addScaledVector(up, 3.05), 0.16);
      } else if (scenario === 'rebote-x' || scenario === 'rebote-y') {
        // A bola cai até o ponto do contato no instante dele; depois fica nas mãos (catchHold).
        const y = scenario === 'rebote-y';
        if (f === 0) {
          window.__catch = { target: ballAt(y ? 2.85 : 1.75), at: y ? 0.43 : 0.2, t: 0 };
          A.playCatch(window.__catch.target, window.__catch.at, y ? 0.55 : 0);
          game.ballMesh.visible = true;
        }
      }
      window.__lab.step(1, {});
      const c = window.__catch;
      if (c && scenario.startsWith('rebote')) {
        c.t += 1 / 60;
        const held = A.catchHold();
        const dt = Math.max(0, c.at - c.t);
        if (held) game.ballMesh.position.copy(held);
        else if (c.t < c.at) game.ballMesh.position.copy(c.target).add(new THREE.Vector3(0, 1.4 * dt + 4.9 * dt * dt, -0.6 * dt));
        else game.ballMesh.visible = false;
      }
      const pl = A.palmWorld('l', new THREE.Vector3());
      const pr = A.palmWorld('r', new THREE.Vector3());
      const d = A.defenseState();
      const cp = A.catchPhase ? A.catchPhase() : null;
      return `${cp ? cp.phase + ' ' + cp.u.toFixed(2) : '-'} mãos=${d.handsUp.toFixed(2)} pulo=${d.jump.toFixed(2)} palmaE=${pl.y.toFixed(2)} palmaD=${pr.y.toFixed(2)} entre=${pl.distanceTo(pr).toFixed(2)}`;
    },
    [f, scenario],
  );
  log.push(`${f} ${info}`);
  if (f % Number(everyArg) !== 0) continue;
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
      const target = pos.clone().add(pos.clone().set(0, 1.55, 0));
      cam.up.set(0, 1, 0);
      const dist = 4.4;
      if (vv === 'side') cam.position.copy(pos).addScaledVector(left, -dist).add(pos.clone().set(0, 1.6, 0));
      else if (vv === 'back') cam.position.copy(pos).addScaledVector(fwd, -dist).add(pos.clone().set(0, 1.7, 0));
      else cam.position.copy(pos).addScaledVector(fwd, dist).add(pos.clone().set(0, 1.6, 0)).addScaledVector(left, 0.6);
      cam.lookAt(target);
      lab.renderer.render(lab.scene, cam);
    }, v);
    await page.screenshot({ path: `${out}/${v}_q${String(f).padStart(3, '0')}.png` });
  }
}
writeFileSync(`${out}/log.txt`, log.join('\n'));
console.log(log.filter((_, i) => i % 3 === 0).join('\n'));
await browser.close();
