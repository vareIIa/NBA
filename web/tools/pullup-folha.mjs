// Pull-up no laboratório: corre (sprint ou trote) até perto da linha de 3, segura o X e solta; mede pés e pelve e salva
// quadros de lado (STICK='x,y' muda a direção da corrida, HAND=l para canhoto). node tools/pullup-folha.mjs <saida> [sprint=1] [corre=40] [segura=30] [quadros=90] [setup JSON]
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [out, sprintArg = '1', runArg = '40', holdArg = '30', framesArg = '90', setupArg = ''] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto((process.env.BASE || 'http://127.0.0.1:5173') + '/?lab=1');
await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab);
const sprint = sprintArg === '1';
const [stickX, stickY] = (process.env.STICK || '0,1').split(',').map(Number);
const hand = process.env.HAND === 'l' ? 'l' : 'r';
await page.evaluate(([setup, hand]) => {
  if (setup) window.__debug.game.setShotSetup({ id: 'x', name: 'x', upperRelease2: 'Curry', blendPercent: 0, releaseSpeed: 1, ...JSON.parse(setup) });
  window.__lab.place(12.5, -0.3, hand);
  window.__lab.step(30, {});
}, [setupArg, hand]);
const rows = [];
const total = Number(runArg) + Number(framesArg);
for (let f = 0; f < total; f++) {
  const running = f < Number(runArg);
  const shoot = !running && f < Number(runArg) + Number(holdArg);
  const r = await page.evaluate(
    ([shoot, running, sprint, sx, sy]) => {
      const { animator: A, game, THREE } = window.__debug;
      const go = running || shoot ? 1 : 0;
      window.__lab.step(1, { shoot, moveX: sx * go, moveY: sy * go, sprint: go > 0 && sprint });
      const P = (n) => A.bone(n).getWorldPosition(new THREE.Vector3());
      const fl = P('foot_l');
      const fr = P('foot_r');
      return {
        phase: game.phase,
        kind: A.actionKind(),
        root: A.root.position.toArray(),
        pelvis: P('pelvis').toArray(),
        fl: fl.toArray(),
        fr: fr.toArray(),
        speed: Math.hypot(game.velocity.x, game.velocity.y),
        shot: A.jumpShotState(),
      };
    },
    [shoot, running, sprint, stickX, stickY],
  );
  rows.push(r);
  if (!running && (f - Number(runArg)) % 4 === 0) {
    await page.evaluate(() => window.__lab.renderSingle('side'));
    await page.screenshot({ path: join(out, `q${String(f).padStart(3, '0')}.png`) });
  }
}
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows));
// Métricas: escorregão de pé apoiado (tornozelo no chão nos dois quadros, y < 0,075) e maior mudança de velocidade
// vertical da pelve.
let slide = 0;
let slideAt = -1;
let jerk = 0;
let jerkAt = -1;
const start = Number(runArg);
for (let i = start + 1; i < rows.length; i++) {
  for (const k of ['fl', 'fr']) {
    const a = rows[i - 1][k];
    const b = rows[i][k];
    if (a[1] < 0.075 && b[1] < 0.075) {
      const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (d > slide) {
        slide = d;
        slideAt = i;
      }
    }
  }
  if (i >= start + 2) {
    const v1 = rows[i - 1].pelvis[1] - rows[i - 2].pelvis[1];
    const v2 = rows[i].pelvis[1] - rows[i - 1].pelvis[1];
    const dv = Math.abs(v2 - v1) * 60;
    if (dv > jerk) {
      jerk = dv;
      jerkAt = i;
    }
  }
}
const first = rows[start];
console.log(`entrada ${first.speed.toFixed(2)} m/s, fase ${first.phase}`);
console.log(`escorregão máx do pé apoiado: ${(slide * 100).toFixed(1)} cm/quadro no q${slideAt}`);
console.log(`maior tranco da pelve: ${jerk.toFixed(2)} m/s de um quadro para o outro no q${jerkAt}`);
const pel = rows.slice(start).map((r) => r.pelvis[1]);
console.log(`pelve: min ${Math.min(...pel).toFixed(3)} max ${Math.max(...pel).toFixed(3)}`);
const shots = rows.filter((r) => r.shot);
console.log(`quadros com o arremesso: ${shots.length}; soltou: ${shots.some((r) => r.shot.released)}`);
console.log(`raiz andou no arremesso: ${Math.hypot(rows[rows.length - 1].root[0] - first.root[0], rows[rows.length - 1].root[2] - first.root[2]).toFixed(2)} m`);
await browser.close();
