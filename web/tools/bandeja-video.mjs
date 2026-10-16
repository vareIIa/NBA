// Vídeo das bandejas no laboratório, quadro a quadro (1/60 s, determinístico), com câmera FIXA mostrando o aro:
//   node tools/bandeja-video.mjs <cenario1,cenario2,...> <saida.mp4> [vista=lado|jogo|tras|cima|frente] [lento=1]
// Grava também <saida>.json com, por quadro: fase, posição, salto, pontas dos pés, palmas e bola (para medir as passadas).
// lento=0.5 repete cada quadro 2x. Cenários em tools/cenarios-bandeja.mjs (ponto de partida próprio de cada um).
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CenariosBandeja } from './cenarios-bandeja.mjs';

const [names, out, view = 'lado', slowArg = '1'] = process.argv.slice(2);
const repeat = Math.max(1, Math.round(1 / Number(slowArg)));
const ffmpeg = execFileSync('python', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
const enc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '60', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out], { stdio: ['pipe', 'inherit', 'inherit'] });
await page.goto((process.env.LAB_BASE || 'http://127.0.0.1:5173') + '/?lab=1' + (process.env.LAB_URL || ''));
await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab);

const log = {};
let frames = 0;
for (const name of names.split(',')) {
  const sc = CenariosBandeja[name];
  // `dunk`: força a enterrada do cenário (LayupFinish), para ver cada variação.
  await page.evaluate((d) => { window.__forceDunk = d; }, sc?.dunk ?? null);
  if (!sc) throw new Error(`cenário desconhecido: ${name}`);
  await page.evaluate(([x, y, hand, label]) => {
    const L = window.__lab;
    // Cenário novo: sem comemoração nem bandeja do cenário anterior.
    L.lab.animator.endCelebration();
    L.lab.game.layup.end();
    L.lab.game.layup.forceDunk = window.__forceDunk ?? null;
    L.place(x, y, hand);
    L.step(30, {});
    L.reset();
    // Câmera fixa do cenário: perpendicular à linha começo -> aro, enquadrando os dois.
    const lab = L.lab;
    const start = lab.animator.root.position.clone();
    window.__bandejaCam = { start, label };
    let el = document.getElementById('video-lab-label');
    if (!el) {
      el = document.createElement('div');
      el.id = 'video-lab-label';
      el.style.cssText = 'position:fixed;left:16px;top:12px;padding:4px 10px;font:700 18px system-ui;color:#fff;background:rgba(0,0,0,.6);border-radius:4px;z-index:9';
      document.body.appendChild(el);
    }
    el.textContent = label;
  }, [sc.at[0], sc.at[1], sc.hand, name.replace(/_/g, ' ')]);
  const rows = [];
  let q = 0;
  for (const step of sc.steps) {
    const { n, until, ...input } = step;
    for (let i = 0; i < n; i++) {
      // `until`: anda com esta entrada até ficar a esta distância (m) do aro (e passa para o próximo passo).
      if (until !== undefined) {
        const d = await page.evaluate(() => Math.hypot(window.__lab.lab.game.position.x, window.__lab.lab.game.position.y));
        if (d <= until) break;
      }
      const row = await page.evaluate(
        ([inp, v, frame]) => {
          const L = window.__lab;
          L.step(1, inp);
          const lab = L.lab;
          const game = lab.game;
          const anim = lab.animator;
          const P = (b) => {
            const p = anim.bone(b).getWorldPosition(anim.root.position.clone());
            return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)];
          };
          if (v === 'jogo') {
            L.renderSingle('jogo');
          } else {
            for (const line of lab.lines) line.visible = false;
            lab.footMarks.visible = false;
            for (const l of lab.labels) l.style.display = 'none';
            lab.flagsLabel.style.display = 'none';
            const cam = lab.cameras[0];
            const size = lab.renderer.getSize(cam.position.clone().set(0, 0, 0));
            lab.renderer.setScissorTest(false);
            lab.renderer.setViewport(0, 0, size.x, size.y);
            cam.aspect = size.x / size.y;
            cam.fov = 44;
            cam.updateProjectionMatrix();
            // Aro: núcleo (0, 0, 3,05) -> three (0, 3,05, 0).
            const rim = cam.position.clone().set(0, 3.05, 0);
            const start = window.__bandejaCam.start;
            const along = rim.clone().sub(start).setY(0);
            const len = along.length();
            along.normalize();
            const side = cam.position.clone().set(along.z, 0, -along.x); // perpendicular horizontal
            const mid = start.clone().lerp(rim, 0.66).setY(1.45);
            cam.up.set(0, 1, 0);
            if (v === 'lado') cam.position.copy(mid).addScaledVector(side, Math.max(5.2, len * 0.95)).setY(1.45);
            if (v === 'tras') cam.position.copy(start).addScaledVector(along, -3.5).setY(2.2);
            if (v === 'frente') cam.position.copy(rim).addScaledVector(along, 1.2).setY(2.0);
            if (v === 'cima') cam.position.copy(mid).setY(11).addScaledVector(along, -0.01);
            // Perto: de lado, acompanhando o jogador a ~4 m (para ver passadas, joelho e braços).
            const me = anim.root.position.clone();
            if (v === 'perto') cam.position.copy(me).addScaledVector(side, 4.2).setY(1.25);
            if (v === 'perto3') cam.position.copy(me).addScaledVector(side, 3.2).addScaledVector(along, 2.4).setY(1.35);
            // Atrás, acompanhando: para ver passos laterais (euro, pro hop) e a mão.
            if (v === 'atras') cam.position.copy(me).addScaledVector(along, -3.6).setY(1.7);
            const look = v === 'perto' || v === 'perto3' || v === 'atras' ? anim.root.position.clone().addScaledVector(along, 0.25).setY(1.15 + Math.max(0, anim.root.position.y)) : v === 'frente' ? anim.root.position.clone().setY(1.2) : mid;
            cam.lookAt(look);
            lab.renderer.render(lab.scene, cam);
          }
          const lbl = document.getElementById('video-lab-label');
          if (lbl && game.layup?.plan) lbl.textContent = window.__bandejaCam.label + ' — ' + game.layup.label;
          return {
            q: frame,
            layup: game.layup?.plan ? game.layup.label : null,
            phase: game.phase,
            finishing: game.finishing,
            pos: [+game.position.x.toFixed(3), +game.position.y.toFixed(3)],
            vel: +game.velocity.length2D().toFixed(2),
            rootY: +anim.root.position.y.toFixed(3),
            toeL: P('ball_l'),
            toeR: P('ball_r'),
            ankleL: P('foot_l'),
            ankleR: P('foot_r'),
            palmL: P('palm_l'),
            palmR: P('palm_r'),
            head: P('head'),
            ball: [+game.ballMesh.position.x.toFixed(3), +game.ballMesh.position.y.toFixed(3), +game.ballMesh.position.z.toFixed(3)],
            shoot: !!inp.shoot,
          };
        },
        [input, view, q],
      );
      rows.push(row);
      q++;
      const png = await page.screenshot({ type: 'png' });
      for (let r = 0; r < repeat; r++) enc.stdin.write(png);
      frames++;
    }
  }
  log[name] = rows;
}
enc.stdin.end();
await new Promise((resolve) => enc.on('close', resolve));
await browser.close();
writeFileSync(out.replace(/\.mp4$/, '') + '.json', JSON.stringify(log));
console.log(out, frames, 'quadros', (frames * repeat) / 60, 's');
