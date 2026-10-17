// Pés com tênis em movimento (headless, docs/20, "Pé e tênis"): câmera baixa e, a cada quadro medido, a pele do corpo
// visível que fica por fora do tênis, por pé (direito e esquerdo). Mede a pele como sai na tela: o corte do corpo e o
// CuffPull (puxada para dentro do cano) são repetidos na CPU, a partir dos valores que o jogo usa.
//   node tools/tenis-quadros.mjs <pasta> [query]     ex.: LAB_BASE=http://127.0.0.1:5190/ node tools/tenis-quadros.mjs ../Saved/tenis "?arena=0&tenis=tenis_cimento_4"
// Variáveis: LAB_BASE (servidor), HIRES=1 (1280 px), DETALHE=1 (ossos e alturas dos pontos fundos).
// Saída: uma linha por cena com a pior profundidade (mm) em cada pé e quantos vértices passam de 5 mm; PNG por vista.
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? '../Saved/tenis';
const query = process.argv[3] ?? '?arena=0';
mkdirSync(out, { recursive: true });
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const hires = !!process.env.HIRES;
const page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: hires ? 2 : 1 });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
await page.goto(`${process.env.LAB_BASE ?? 'http://127.0.0.1:5173/'}${query}`);
await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 90000 });
await page.evaluate((h) => (window.__hires = h), hires);

// Câmera de inspeção: canvas por cima do jogo, mirando o meio dos pés (na corrida o tronco se inclina).
await page.evaluate(() => {
  const d = window.__debug;
  const T = d.THREE;
  let scene = d.animator.root;
  while (scene.parent) scene = scene.parent;
  const c = document.createElement('canvas');
  c.width = c.height = window.__hires ? 1280 : 640;
  c.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:640px;z-index:99999;pointer-events:none';
  document.body.appendChild(c);
  const r = new T.WebGLRenderer({ canvas: c, antialias: true });
  r.outputColorSpace = T.SRGBColorSpace;
  r.toneMapping = T.ACESFilmicToneMapping;
  const cam = new T.PerspectiveCamera(30, 1, 0.05, 50);
  window.__insp = { az: 0.6, h: 0.3, dist: 0.6, look: 0.14 };
  const loop = () => {
    const i = window.__insp;
    // Alvo: o pé da vista (foot_r ou foot_l), ou o meio dos pés na vista de longe.
    const p = i.t
      ? d.animator.bone(i.t).getWorldPosition(new T.Vector3())
      : d.animator.bone('foot_l').getWorldPosition(new T.Vector3()).add(d.animator.bone('foot_r').getWorldPosition(new T.Vector3())).multiplyScalar(0.5);
    const yaw = d.animator.root.rotation.y + i.az;
    cam.position.set(p.x + Math.sin(yaw) * i.dist, i.h, p.z + Math.cos(yaw) * i.dist);
    cam.lookAt(p.x, i.look, p.z);
    r.render(scene, cam);
    requestAnimationFrame(loop);
  };
  loop();
});

// Pele fora do tênis, no quadro atual, por pé. Vértice do corpo visível (triângulos cortados pelo BodyCover e pela
// altura do tênis não contam), abaixo do topo local do calçado e a até 12 cm dele. "Fora" = paridade de cruzamentos com
// o tênis em 4 direções horizontais (maioria). Profundidade = distância ao triângulo mais próximo do tênis.
const MEASURE = `(async () => {
  const d = window.__debug;
  const { skinnedWorldPositions, rayTriangle, dominantBones, triangleSoup } = await import('/src/game/BodyCover.ts');
  const T = d.THREE;
  const shoes = [], bodies = [];
  d.animator.root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    if (o.userData.gear === 'shoes') shoes.push(o);
    else if (!o.userData.gear && o.visible) bodies.push(o);
  });
  const tri = triangleSoup(shoes);
  let yTop = -Infinity, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tri.length; i += 3) {
    yTop = Math.max(yTop, tri[i + 1]);
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], tri[i + k]); hi[k] = Math.max(hi[k], tri[i + k]); }
  }
  // CuffPull na CPU (mesma conta do shader de CuffPull.ts): só o pé mais perto puxa, com peso 1 abaixo da boca.
  const cp = d.gear?.cuff?.state?.() ?? { on: false, segs: [] };
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const cuffPoint = (q) => {
    if (!cp.on) return q;
    let best = null;
    for (const s of cp.segs) {
      const ab = new T.Vector3().subVectors(s.b, s.a);
      const u = ab.clone().normalize();
      const t = Math.min(1, Math.max(0, q.clone().sub(s.a).dot(ab) / Math.max(ab.dot(ab), 1e-8)));
      const c = s.a.clone().addScaledVector(ab, t);
      const l = q.clone().sub(c).length();
      const h = q.clone().sub(s.a).dot(u);
      if (!best || l < best.l) best = { c, l, r: s.prof[Math.min(s.prof.length - 1, Math.max(0, Math.floor(h * 100)))], h };
    }
    if (!best || best.l >= 0.2 || best.l <= best.r || best.h >= cp.mouth + 0.015) return q;
    const w = 1 - smooth(cp.mouth, cp.mouth + 0.015, best.h);
    return q.clone().lerp(best.c.clone().addScaledVector(q.clone().sub(best.c), best.r / best.l), w);
  };
  const rootInv = new T.Matrix4().copy(d.animator.root.matrixWorld).invert();
  let worst = { R: { depth: 0 }, L: { depth: 0 } };
  let over = 0, n = 0;
  const porOsso = {}, porAltura = {};
  for (const m of bodies) {
    const p = skinnedWorldPositions(m);
    const inv = new T.Matrix4().copy(m.matrixWorld).invert();
    const idx = m.geometry.getIndex().array;
    const dom = dominantBones(m);
    const seen = new Uint8Array(p.length / 3);
    for (let t = 0; t < idx.length; t++) seen[idx[t]] = 1;
    for (let v = 0; v < seen.length; v++) {
      if (!seen[v]) continue;
      let q = new T.Vector3(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
      q = q.clone().applyMatrix4(inv);
      q = cuffPoint(q).applyMatrix4(m.matrixWorld);
      const x = q.x, y = q.y, z = q.z;
      if (y > yTop - 0.005) continue;
      if (x < lo[0] - 0.12 || x > hi[0] + 0.12 || z < lo[2] - 0.12 || z > hi[2] + 0.12 || y < lo[1] - 0.12) continue;
      let best = Infinity;
      for (let i = 0; i < tri.length; i += 9) {
        const cx = (tri[i] + tri[i + 3] + tri[i + 6]) / 3, cy = (tri[i + 1] + tri[i + 4] + tri[i + 7]) / 3, cz = (tri[i + 2] + tri[i + 5] + tri[i + 8]) / 3;
        if (Math.abs(cx - x) > 0.2 || Math.abs(cy - y) > 0.2 || Math.abs(cz - z) > 0.2) continue;
        const dd = pointTri(x, y, z, tri, i);
        if (dd < best) best = dd;
      }
      if (best > 0.12) continue;
      let top = -Infinity;
      for (let i = 0; i < tri.length; i += 3) if (tri[i + 1] > top && Math.hypot(tri[i] - x, tri[i + 2] - z) < 0.03) top = tri[i + 1];
      if (y > top - 0.01) continue;
      // Fora = alguma direção horizontal, saindo do ponto, não cruza o tênis (ele é um anel ao redor da perna; ponto
      // dentro do cano ou entre as duas camadas do tecido sempre cruza a parede de fora). Paridade não serve: o forro conta.
      let escape = false;
      for (let k = 0; k < 8 && !escape; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const dx = Math.cos(ang), dz = Math.sin(ang);
        let c = 0;
        for (let i = 0; i < tri.length; i += 9) if (rayTriangle([x, y, z], [dx, 0, dz], tri, i) > 0) c++;
        if (c === 0) escape = true;
      }
      if (!escape) continue; // dentro do tênis
      n++;
      if (best > 0.005) {
        over++;
        porOsso[dom[v]] = (porOsso[dom[v]] || 0) + 1;
        const alt = Math.round(y * 50) * 2;
        porAltura[alt] = (porAltura[alt] || 0) + 1;
      }
      const side = rootInv ? (new T.Vector3(x, y, z).applyMatrix4(rootInv).x < 0 ? 'R' : 'L') : 'L';
      if (best > worst[side].depth) {
        // Diagnóstico: o ponto antes e depois da puxada, e a altura/raio do cano nele (segmento mais perto).
        let info = null;
        if (cp.on) {
          const raw = p[v * 3] !== undefined ? new T.Vector3(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]).applyMatrix4(inv) : null;
          for (const sg of cp.segs) {
            const ab = new T.Vector3().subVectors(sg.b, sg.a);
            const uu = ab.clone().normalize();
            const tt = Math.min(1, Math.max(0, raw.clone().sub(sg.a).dot(ab) / ab.dot(ab)));
            const cc = sg.a.clone().addScaledVector(ab, tt);
            const hh = raw.clone().sub(sg.a).dot(uu);
            info = { ...(info ?? {}), [sg === cp.segs[0] ? 'seg0' : 'seg1']: { h: +hh.toFixed(3), l: +raw.clone().sub(cc).length().toFixed(3), prof: sg.prof[Math.min(23, Math.max(0, Math.floor(hh * 100)))] } };
          }
          info.raw = raw.toArray().map((q) => +q.toFixed(3));
          info.pulled = q.clone().applyMatrix4(inv).toArray().map((q2) => +q2.toFixed(3));
        }
        worst[side] = { depth: best, bone: dom[v], at: [x, y, z], info };
      }
    }
  }
  const pack = (w) => ({ mm: +(w.depth * 1000).toFixed(1), osso: w.bone || '', em: w.at ? w.at.map((q) => +q.toFixed(3)) : null, info: w.info ?? null });
  return { R: pack(worst.R), L: pack(worst.L), over5mm: over, outside: n, yTop: +yTop.toFixed(3), porOsso, porAltura };
  function pointTri(px, py, pz, T_, i) {
    // Distância ponto-triângulo (Ericson, "Real-Time Collision Detection", 5.1.5).
    const a = [T_[i], T_[i + 1], T_[i + 2]], b = [T_[i + 3], T_[i + 4], T_[i + 5]], c = [T_[i + 6], T_[i + 7], T_[i + 8]];
    const sub = (u, w) => [u[0] - w[0], u[1] - w[1], u[2] - w[2]];
    const dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
    const len = (u) => Math.hypot(u[0], u[1], u[2]);
    const ab = sub(b, a), ac = sub(c, a), ap = sub([px, py, pz], a);
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return len(sub([px, py, pz], a));
    const bp = sub([px, py, pz], b);
    const d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return len(sub([px, py, pz], b));
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return len(sub([px, py, pz], [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v])); }
    const cp_ = sub([px, py, pz], c);
    const d5 = dot(ab, cp_), d6 = dot(ac, cp_);
    if (d6 >= 0 && d5 <= d6) return len(sub([px, py, pz], c));
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return len(sub([px, py, pz], [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w])); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); const q = [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]; return len(sub([px, py, pz], q)); }
    const den = 1 / (va + vb + vc);
    const v = vb * den, w = vc * den;
    const q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
    return len(sub([px, py, pz], q));
  }
})()`;

const wait = (ms) => page.waitForTimeout(ms);
const key = async (k, ms) => {
  await page.keyboard.down(k);
  await wait(ms);
  await page.keyboard.up(k);
};
// Três vistas: de lado e de frente, de perto, e uma de longe (o jogo inteiro).
const VIEWS = [
  { az: 0.6, dist: 0.6, h: 0.3, look: 0.14, t: 'foot_r' },
  { az: 2.3, dist: 0.6, h: 0.3, look: 0.14, t: 'foot_l' },
  { az: -1.4, dist: 1.1, h: 0.3, look: 0.12, t: null },
];
const shoot = async (tag, j) => {
  await page.evaluate((v) => Object.assign(window.__insp, v), VIEWS[j]);
  await wait(60);
  await page.screenshot({ path: join(out, `${tag}_${j}.png`) });
};
const cenas = [
  { nome: 'parado', roteiro: async () => wait(400) },
  { nome: 'corrida_lado', roteiro: async () => { await page.keyboard.down('KeyA'); await page.keyboard.down('ShiftLeft'); await wait(500); } },
  { nome: 'corrida_frente', roteiro: async () => { await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await wait(500); } },
  { nome: 'parada_brusca', roteiro: async () => { await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await wait(600); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); await key('KeyS', 160); await wait(200); } },
  { nome: 'agachar', roteiro: async () => { await key('KeyS', 700); await wait(200); } },
  { nome: 'crossover', roteiro: async () => { await key('ArrowLeft', 70); await wait(120); await key('ArrowRight', 70); await wait(120); await key('ArrowLeft', 70); await wait(200); } },
  { nome: 'pulo', roteiro: async () => { await key('Space', 90); await wait(150); } },
];
const resumo = [];
for (const cena of cenas) {
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyS'); await page.keyboard.up('ShiftLeft');
  await wait(900);
  const quadros = [];
  const pendente = cena.roteiro();
  for (let k = 0; k < 6; k++) {
    await wait(110);
    quadros.push(await page.evaluate(MEASURE));
    if (k % 2 === 1) await shoot(cena.nome, Math.floor(k / 2) % VIEWS.length);
  }
  await pendente;
  const piorR = quadros.reduce((a, b) => (b.R.mm > a.R.mm ? b : a));
  const piorL = quadros.reduce((a, b) => (b.L.mm > a.L.mm ? b : a));
  const linha = {
    cena: cena.nome,
    pe_direito_mm: piorR.R.mm,
    osso_direito: piorR.R.osso,
    pe_esquerdo_mm: piorL.L.mm,
    osso_esquerdo: piorL.L.osso,
    vertices_acima_5mm: Math.max(...quadros.map((q) => q.over5mm)),
  };
  if (process.env.DETALHE) linha.detalhe = { alturas: piorL.porAltura, ossos: piorL.porOsso, em_esquerdo: piorL.L.em, info_esquerdo: piorL.L.info };
  resumo.push(linha);
  console.log(JSON.stringify(linha));
}
writeFileSync(join(out, 'resumo.json'), JSON.stringify(resumo, null, 1));
await browser.close();
