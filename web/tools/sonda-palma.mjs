// Sonda do salto da palma no e2e do freestyle: repete o roteiro do e2e/freestyle.spec.ts COM os prints (cada print trava a
// página um quadro longo) e embrulha cada etapa do PlayerAnimator.update: acusa a primeira etapa que leva uma palma a mais
// de 1,2 m do jogador (o quadro, a etapa, o dt e a pose antes/depois).
//   JOGO_ORIGIN=http://127.0.0.1:5174 node tools/sonda-palma.mjs [rodadas=3]
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const runs = Number(process.argv[2] ?? 3);
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const out = join(tmpdir(), 'sonda-palma');
mkdirSync(out, { recursive: true });

for (let run = 1; run <= runs; run++) {
  const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('ERRO', String(e)));
  await page.goto(`${process.env.JOGO_ORIGIN ?? 'http://127.0.0.1:5173'}/`);
  await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 60000 });
  await page.evaluate(() => {
    const { animator: A } = window.__debug;
    const log = { hits: [], quat: [], frame: 0 };
    const bones = [];
    A.model.traverse((o) => { if (o.isBone) bones.push(o); });
    const badQuat = () => {
      for (const b of bones) {
        const len = b.quaternion.length();
        if (Math.abs(len - 1) > 1e-3) return { name: b.name, len: +len.toFixed(4) };
      }
      return null;
    };
    window.__palma = log;
    const far = () => {
      const r = A.root.position;
      let worst = 0;
      for (const h of ['l', 'r']) {
        A.bone(`palm_${h}`).updateWorldMatrix(true, false);
        const p = A.palmWorld(h);
        worst = Math.max(worst, Math.hypot(p.x - r.x, p.z - r.z));
      }
      return worst;
    };
    const proto = Object.getPrototypeOf(A);
    const names = Object.getOwnPropertyNames(proto).filter((n) => /^(apply|detect|update|choose|drive|hold|restore|save)/.test(n) && n !== 'update');
    for (const n of names) {
      const orig = A[n];
      A[n] = function (...args) {
        const qBefore = badQuat();
        const before = far();
        const res = orig.apply(this, args);
        const after = far();
        const qAfter = badQuat();
        if (!qBefore && qAfter && log.quat.length < 6) log.quat.push({ frame: log.frame, step: n, bone: qAfter.name, len: qAfter.len, dt: log.lastDt, action: A.actionKind(), base: A.baseClip() });
        if (after > 1.2 && before <= 1.2 && log.hits.length < 10) {
          log.hits.push({ frame: log.frame, step: n, before: +before.toFixed(2), after: +after.toFixed(2), action: A.actionKind(), base: A.baseClip() });
        }
        return res;
      };
    }
    // reachPalm em detalhe: entrada, saída e o tamanho dos quaternions do braço (não-unitário estica a malha).
    const reach = A.reachPalm.bind(A);
    A.reachPalm = (hand, target, weight, pole) => {
      const p0 = A.palmWorld(hand).clone();
      const t0 = target.clone();
      reach(hand, target, weight, pole);
      const p1 = A.palmWorld(hand);
      if (p1.distanceTo(A.bone(`upperarm_${hand}`).getWorldPosition(p0.clone())) > 0.85 && log.hits.length < 10) {
        const qn = ['upperarm', 'lowerarm', 'hand'].map((b) => +A.bone(`${b}_${hand}`).quaternion.length().toFixed(4));
        const sc = ['upperarm', 'lowerarm', 'hand'].map((b) => +A.bone(`${b}_${hand}`).scale.x.toFixed(4));
        const sh = A.bone(`upperarm_${hand}`).getWorldPosition(p0.clone());
        log.hits.push({ frame: log.frame, step: 'reachPalm', hand, weight, moved: +p1.distanceTo(p0).toFixed(2), targetFromPalm: +t0.distanceTo(p0).toFixed(2), targetFromShoulder: +t0.distanceTo(sh).toFixed(2), palmFromShoulder: +p1.distanceTo(sh).toFixed(2), qn, sc, stack: new Error().stack.split(String.fromCharCode(10)).slice(2, 5).map((l) => l.trim()) });
      }
    };
    const mix = A.mixer;
    const mixUpdate = mix.update.bind(mix);
    mix.update = (dt) => {
      const before = far();
      const qb = badQuat();
      const res = mixUpdate(dt);
      const qa = badQuat();
      if (!qb && qa && log.quat.length < 6) log.quat.push({ frame: log.frame, step: 'mixer.update', bone: qa.name, len: qa.len, dt });
      const after = far();
      if (after > 1.2 && before <= 1.2 && log.hits.length < 10) log.hits.push({ frame: log.frame, step: 'mixer.update', dt, before, after, base: A.baseClip() });
      return res;
    };
    const upd = A.update.bind(A);
    A.update = (dt, input) => {
      log.frame++;
      log.lastDt = dt;
      const res = upd(dt, input);
      if (far() > 1.2 && log.hits.length < 10 && !log.hits.some((h) => h.frame === log.frame)) log.hits.push({ frame: log.frame, step: '(depois do update)', dt });
      return res;
    };
  });
  const wait = (ms) => page.waitForTimeout(ms);
  let shotN = 0;
  const shot = () => page.screenshot({ path: join(out, `${run}-${++shotN}.png`) });
  const flick = async (key) => { await page.keyboard.down(key); await wait(70); await page.keyboard.up(key); };
  const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
  const ballHand = () => page.evaluate(() => window.__garrafao.anim().ballHand);

  // Mesmo roteiro do e2e/freestyle.spec.ts até o drible baixo, com os prints nos mesmos pontos.
  await wait(1500); await shot();
  await page.keyboard.down('KeyW'); await wait(450); await shot();
  await flick('ArrowUp'); await wait(250); await shot();
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyS'); await wait(500); await page.keyboard.up('KeyS'); await wait(700);
  await flick('ArrowRight'); await wait(300); await shot(); await wait(800);
  await hold('KeyE', 40); await wait(350); await shot(); await wait(1000);
  const hand = await ballHand();
  const diag = hand === 'r' ? 'ArrowLeft' : 'ArrowRight';
  await page.keyboard.down('ArrowDown'); await page.keyboard.down(diag); await wait(70);
  await page.keyboard.up(diag); await page.keyboard.up('ArrowDown');
  await wait(250); await shot(); await wait(710);
  await flick('ArrowDown'); await wait(300); await shot(); await wait(760);
  await hold('KeyR', 40); await wait(350); await shot(); await wait(410);
  await flick('ArrowDown'); await wait(800);
  const freeSide = (await ballHand()) === 'r' ? 'KeyA' : 'KeyD';
  await page.keyboard.down(freeSide); await wait(400); await shot(); await wait(450); await page.keyboard.up(freeSide);
  await wait(700);
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyD'); await wait(600);
  await flick('ArrowUp'); await wait(300); await shot(); await wait(420);
  await page.keyboard.up('KeyD'); await page.keyboard.up('ShiftLeft'); await wait(900);
  const stats = await page.evaluate(() => window.__garrafao.ballStats());
  const log = await page.evaluate(() => window.__palma);
  console.log(`rodada ${run}: maxDist ${stats.maxDist.toFixed(2)} (quadro ${stats.worst?.frame}) | quaternion: ${JSON.stringify(log.quat)} | etapas: ${JSON.stringify(log.hits.filter((h) => h.step !== 'reachPalm'))}`);
  await browser.close();
}
