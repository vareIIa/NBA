// Medidas do esqueleto (bandejas): comprimentos de coxa/canela/braço, altura da pelve de pé (bind pose) e eixos da mão no
// espaço local do osso hand_* (para orientar a palma). node tools/sonda-rig.mjs
import { chromium } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto((process.env.LAB_BASE || 'http://127.0.0.1:5173') + '/?lab=1');
await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab);
const out = await page.evaluate(() => {
  const anim = window.__lab.lab.animator;
  const P = (n) => anim.bone(n).getWorldPosition(anim.root.position.clone());
  const r = (v) => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
  const len = (a, b) => +P(a).distanceTo(P(b)).toFixed(3);
  const res = {
    thigh: len('thigh_l', 'calf_l'),
    shank: len('calf_l', 'foot_l'),
    footToBall: len('foot_l', 'ball_l'),
    hipWidth: len('thigh_l', 'thigh_r'),
    upperarm: len('upperarm_r', 'lowerarm_r'),
    forearm: len('lowerarm_r', 'hand_r'),
    handToPalm: len('hand_r', 'palm_r'),
    handToFingers: len('hand_r', 'fingers_r'),
    pelvisToThigh: len('pelvis', 'thigh_l'),
    animPose: { pelvis: r(P('pelvis')), thighL: r(P('thigh_l')), ankleL: r(P('foot_l')), ballL: r(P('ball_l')), head: r(P('head')), shoulderR: r(P('upperarm_r')), clavR: r(P('clavicle_r')) },
  };
  // Eixos da mão no espaço local de hand_*: dedos, polegar e palma.
  for (const s of ['l', 'r']) {
    const hand = anim.bone(`hand_${s}`);
    hand.updateWorldMatrix(true, false);
    const loc = (n) => hand.worldToLocal(P(n)).normalize();
    res[`hand_${s}`] = { fingers: r(loc(`fingers_${s}`)), thumb: r(loc(`thumb_${s}`)), palm: r(loc(`palm_${s}`)) };
  }
  // Bind pose: posição de repouso (skeleton.pose) para a altura de pé.
  let skinned = null;
  anim.model.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o; });
  const saved = skinned.skeleton.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
  skinned.skeleton.pose();
  anim.root.updateMatrixWorld(true);
  res.bind = { pelvis: r(P('pelvis')), thighL: r(P('thigh_l')), ankleL: r(P('foot_l')), ballL: r(P('ball_l')), head: r(P('head')), shoulderR: r(P('upperarm_r')), handR: r(P('hand_r')), palmR: r(P('palm_r')) };
  const rootPos = anim.root.position.clone();
  res.root = r(rootPos);
  // Eixos locais da mão no mundo (pose de repouso) e a frente do corpo.
  const q = anim.root.position.clone();
  for (const sd of ['l', 'r']) {
    const h = anim.bone(`hand_${sd}`);
    const m = h.matrixWorld.elements;
    const ax = (i) => { const v = q.clone().set(m[i * 4], m[i * 4 + 1], m[i * 4 + 2]).normalize(); return r(v); };
    res[`axes_${sd}`] = { x: ax(0), y: ax(1), z: ax(2) };
  }
  const mm = anim.model.matrixWorld.elements;
  res.modelFwd = r(q.clone().set(mm[8], mm[9], mm[10]).normalize());
  res.modelLeft = r(q.clone().set(mm[0], mm[1], mm[2]).normalize());
  // Vértices da malha presos à mão direita: média deles em relação ao osso (o lado da palma é o lado com mais "carne"?).
  let sk = null;
  anim.model.traverse((o) => { if (o.isSkinnedMesh && !sk) sk = o; });
  const idx = sk.geometry.getAttribute('skinIndex');
  const wts = sk.geometry.getAttribute('skinWeight');
  const handIndex = sk.skeleton.bones.findIndex((b) => b.name === 'palm_r');
  const fingIndex = sk.skeleton.bones.findIndex((b) => b.name === 'fingers_r');
  const thumbIndex = sk.skeleton.bones.findIndex((b) => b.name === 'thumb_r');
  const hr = anim.bone('hand_r');
  const acc = { palm: [0, 0, 0, 0], thumb: [0, 0, 0, 0] };
  const pv = q.clone();
  for (let i = 0; i < idx.count; i++) {
    for (let k = 0; k < 4; k++) {
      const bi = idx.getComponent(i, k);
      if (wts.getComponent(i, k) < 0.5) continue;
      const key = bi === thumbIndex ? 'thumb' : bi === handIndex || bi === fingIndex ? 'palm' : null;
      if (!key) continue;
      sk.getVertexPosition(i, pv);
      sk.localToWorld(pv);
      hr.worldToLocal(pv);
      acc[key][0] += pv.x; acc[key][1] += pv.y; acc[key][2] += pv.z; acc[key][3]++;
    }
  }
  res.meshThumbLocal = acc.thumb[3] ? r(q.clone().set(acc.thumb[0] / acc.thumb[3], acc.thumb[1] / acc.thumb[3], acc.thumb[2] / acc.thumb[3])) : null;
  res.meshPalmLocal = acc.palm[3] ? r(q.clone().set(acc.palm[0] / acc.palm[3], acc.palm[1] / acc.palm[3], acc.palm[2] / acc.palm[3])) : null;
  res.counts = [acc.thumb[3], acc.palm[3]];
  res.scale = anim.scale;
  skinned.skeleton.bones.forEach((b, i) => { b.position.copy(saved[i][0]); b.quaternion.copy(saved[i][1]); b.scale.copy(saved[i][2]); });
  anim.root.updateMatrixWorld(true);
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
