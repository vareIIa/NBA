// Sonda do arremesso no laboratório: o jogador parado com a bola segura o X por `segurar` quadros e solta; imprime a
// palma da mão do arremesso (mundo) a cada quadro e marca o quadro em que a bola sai (fase 'flight').
//   node tools/sonda-arremesso.mjs [segurar=34] [quadros=80]      (LAB_ANIM='{"restoreMixerEnabled":false}' para A/B)
import { chromium } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [holdArg = '34', framesArg = '80'] = process.argv.slice(2);
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto('http://127.0.0.1:5173/?lab=1' + (process.env.LAB_URL || ''));
await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab);
await page.evaluate(([anim, hz]) => {
  Object.assign(window.__debug.animator, JSON.parse(anim));
  window.__lab.lab.hz = hz;
  window.__lab.place(7.4, -0.6, 'r');
  window.__lab.step(45, {});
}, [process.env.LAB_ANIM || '{}', Number(process.env.LAB_HZ || 60)]);
let peak = { y: -1, frame: -1 };
let releaseLine = '';
for (let f = 0; f < Number(framesArg); f++) {
  const out = await page.evaluate((shoot) => {
    const { animator: A, game, THREE } = window.__debug;
    const before = game.phase;
    window.__lab.step(1, { shoot });
    const palm = A.palmWorld('r', new THREE.Vector3());
    const pelvis = A.bone('pelvis').getWorldPosition(new THREE.Vector3());
    return { phase: game.phase, released: before !== 'flight' && game.phase === 'flight', kind: A.actionKind(), t: A.actionTime(), palm: palm.toArray().map((x) => +x.toFixed(3)), pelvisY: +pelvis.y.toFixed(3), lift: +A.root.position.y.toFixed(3), crouch: +A.crouch.toFixed(3), hinge: +A.hinge.toFixed(1), lean: +A.leanForward.toFixed(1) };
  }, f < Number(holdArg));
  if (out.palm[1] > peak.y) peak = { y: out.palm[1], frame: f };
  const line = `${f} ${out.phase} ${out.kind ?? '-'} t=${out.t?.toFixed(3) ?? '-'} palma=${out.palm.join(',')} pelve=${out.pelvisY} raiz=${out.lift} agach=${out.crouch} dobra=${out.hinge} incl=${out.lean}`;
  if (out.released) releaseLine = `SOLTURA q${f}: ${line}`;
  if (process.env.VERBOSE) console.log(line);
}
console.log(releaseLine || 'sem soltura');
console.log(`pico da palma: y ${peak.y} no q${peak.frame}`);
await browser.close();
