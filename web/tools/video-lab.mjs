// Vídeo de cenários do laboratório a 60 quadros por segundo, quadro a quadro (determinístico, sem depender do FPS):
// cada quadro de 1/60 s é desenhado numa vista só e vai direto para o ffmpeg do imageio-ffmpeg (Python).
//   node tools/video-lab.mjs <cenario1,cenario2,...> <saida.mp4> [vista=jogo|back|side|front|top] [lento=1]
// lento=0.5 repete cada quadro 2x (câmera lenta). Entre um cenário e outro o jogador volta para o mesmo ponto.
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Cenarios } from './cenarios.mjs';

const [names, out, view = 'jogo', slowArg = '1'] = process.argv.slice(2);
const repeat = Math.max(1, Math.round(1 / Number(slowArg)));
const ffmpeg = execFileSync('python', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const browser = await chromium.launch({ executablePath: join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), args: ['--enable-gpu', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));
const enc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '60', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const label = async (text) =>
  page.evaluate((t) => {
    let el = document.getElementById('video-lab-label');
    if (!el) {
      el = document.createElement('div');
      el.id = 'video-lab-label';
      el.style.cssText = 'position:fixed;left:16px;top:12px;padding:4px 10px;font:700 18px system-ui;color:#fff;background:rgba(0,0,0,.6);border-radius:4px;z-index:9';
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
await page.goto('http://127.0.0.1:5173/?lab=1' + (process.env.LAB_URL || ''));
await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab);
let frames = 0;
for (const name of names.split(',')) {
  const sc = Cenarios[name];
  if (!sc) throw new Error(`cenário desconhecido: ${name}`);
  await page.evaluate((hand) => {
    window.__lab.place(7.4, -0.6, hand);
    window.__lab.step(45, {});
    window.__lab.reset();
  }, sc.hand);
  await label(name.replace(/_/g, ' '));
  for (const step of sc.steps) {
    const { n, ...input } = step;
    for (let i = 0; i < n; i++) {
      await page.evaluate(([inp, v]) => {
        window.__lab.step(1, inp);
        window.__lab.renderSingle(v);
      }, [input, view]);
      const png = await page.screenshot({ type: 'png' });
      for (let r = 0; r < repeat; r++) enc.stdin.write(png);
      frames++;
    }
  }
}
enc.stdin.end();
await new Promise((resolve) => enc.on('close', resolve));
await browser.close();
console.log(out, frames, 'quadros', (frames * repeat) / 60, 's');
