// Laboratório de dribles: roda cenários quadro a quadro no modo ?lab=1 e salva, para cada um, quadros com 4 câmeras
// (trás, lado, frente, cima), rastros da bola (laranja) e das palmas (azul = esquerda, rosa = direita), marcas dos pés
// apoiados (vermelho = pé deslizando) e as métricas de fluidez.
//
//   node tools/laboratorio.mjs <saida> [cenario1,cenario2,...] [cada=4]
//
// A/B: LAB_ANIM='{"legLayerEnabled":false}' aplica esses campos no PlayerAnimator antes de cada cenário, e
// LAB_STANCE='{"dribbleForward":0.2}' nos ajustes de postura (animator.stance). LAB_HZ=144 simula um monitor de
// 144 Hz (dt de 7 ms; os cenários continuam contados em quadros de 1/60 s).
//
// Precisa do Vite rodando em 127.0.0.1:5173 (npm run dev -- --host 127.0.0.1).
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Cenarios } from './cenarios.mjs';

const [out = 'test-results/laboratorio', only = '', everyArg = '4'] = process.argv.slice(2);
const every = Number(everyArg);

const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop() : null;
const exe = dir ? join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') : process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch({
  executablePath: exe,
  args: process.platform === 'win32' ? ['--enable-gpu', '--use-angle=d3d11'] : ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERRO', String(e)));

const names = only ? only.split(',') : Object.keys(Cenarios);
const summary = {};
for (const name of names) {
  const sc = Cenarios[name];
  if (!sc) {
    console.log('cenário desconhecido:', name);
    continue;
  }
  // LAB_ORIGIN: outro servidor (ex.: um build congelado no `vite preview`, sem o recarregamento do HMR no meio da rodada).
  await page.goto((process.env.LAB_ORIGIN || 'http://127.0.0.1:5173') + '/?lab=1' + (process.env.LAB_URL || ''));
  await page.waitForFunction(() => window.__garrafao?.ready === true && window.__lab, undefined, { timeout: 30000 });
  await page.evaluate(([hand, anim, stance, hz, place, noBall]) => {
    Object.assign(window.__debug.animator, JSON.parse(anim));
    Object.assign(window.__debug.animator.stance, JSON.parse(stance));
    window.__lab.lab.hz = hz;
    window.__lab.place(place[0], place[1], hand);
    if (noBall) {
      // Sem bola: a bola vai para o chão longe do jogador (fase 'loose', que não é a posse) e o boneco corre livre.
      const g = window.__debug.game;
      g.phase = 'loose';
      g.ball.position.x = place[0] - 2.5;
      g.ball.position.y = place[1] - 3;
      g.ball.position.z = 0.2;
      g.ball.velocity.x = g.ball.velocity.y = g.ball.velocity.z = 0;
    }
    window.__lab.step(45, {});
    window.__lab.reset();
  }, [sc.hand, process.env.LAB_ANIM || '{}', process.env.LAB_STANCE || '{}', Number(process.env.LAB_HZ || 60), sc.place ?? [7.4, -0.6], !!sc.noBall]);
  const folder = join(out, name);
  mkdirSync(folder, { recursive: true });
  let frame = 0;
  let shot = 0;
  // Latência: do quadro em que o RS sai do centro até o quadro em que o drible começa (game.moves cresce).
  const hz = Number(process.env.LAB_HZ || 60);
  const latency = [];
  let stickWas = false;
  let movesSeen = 0;
  let pendingCmd = -1;
  for (const step of sc.steps) {
    const { n, ...input } = step;
    for (let i = 0; i < n; i++) {
      const stick = Math.hypot(input.proX ?? 0, input.proY ?? 0) > 0.25;
      if (stick && !stickWas) pendingCmd = frame;
      stickWas = stick;
      const moves = await page.evaluate((inp) => {
        window.__lab.step(1, inp);
        return window.__debug.game.moves.length;
      }, input);
      if (moves > movesSeen) {
        if (pendingCmd >= 0) latency.push(Math.round(((frame - pendingCmd + 1) * 1000) / hz));
        pendingCmd = -1;
        movesSeen = moves;
      }
      if (every < 100000 && frame % every === 0) {
        await page.evaluate(() => window.__lab.render());
        await page.screenshot({ path: join(folder, `${String(shot++).padStart(3, '0')}_q${String(frame).padStart(3, '0')}.png`) });
      }
      frame++;
    }
  }
  const metrics = await page.evaluate(() => window.__lab.metrics());
  metrics.latencyMs = latency;
  summary[name] = metrics;
  writeFileSync(join(folder, 'metricas.json'), JSON.stringify(metrics, null, 1));
  console.log(
    `${name.padEnd(18)} pé desliza máx ${metrics.footSlideMax.toFixed(2)} m/s (média ${metrics.footSlideMean.toFixed(2)})` +
      `  estalos ${metrics.popCount}${metrics.popWorst ? ` (pior ${metrics.popWorst.bone} q${metrics.popWorst.frame})` : ''}` +
      `  bola-mão ${metrics.ballGapMax.toFixed(2)} m  quiques ${metrics.bounces}` +
      `  pernas ${(metrics.legGapMin * 100).toFixed(0)} cm (${metrics.legCrossFrames} q cruzando, base máx ${metrics.stanceMax.toFixed(2)} m)` +
      `  sola ${(metrics.soleMin * 100).toFixed(1)} cm (${metrics.soleBelowFrames} q no chão)` +
      `  bola-corpo ${(metrics.ballBodyMax * 100).toFixed(0)} cm (${metrics.ballBodyFrames} q)` +
      `  braço-corpo ${(metrics.armBodyMax * 100).toFixed(1)} cm (${metrics.armBodyFrames} q${metrics.armBodyWorst ? `, pior ${metrics.armBodyWorst.part} q${metrics.armBodyWorst.frame}` : ''})` +
      `  pé na ponta ${metrics.supportFrames ? ((100 * metrics.heelUpFrames) / metrics.supportFrames).toFixed(0) : '-'}% do apoio (calcanhar máx ${(metrics.heelUpMax * 100).toFixed(1)} cm, sequência máx ${Math.round(metrics.heelRunMaxMs)} ms)` +
      `  flicks bola ${metrics.ballKinkFrames} (máx ${Math.round(metrics.ballKinkMax)}) mão ${metrics.palmKinkFrames} corpo ${metrics.bodyKinkFrames} giro ${metrics.yawKinkFrames} NaN ${metrics.nanFrames}` +
      `  SALTOS ${metrics.snapFrames}${metrics.snapWorst ? ` (pior ${metrics.snapWorst.part} ${metrics.snapWorst.cm} cm q${metrics.snapWorst.frame})` : ''}` +
      `${latency.length ? `  latência ${latency.join('/')} ms` : ''}` +
      `  ${metrics.moves.join(' > ')}`,
  );
}
writeFileSync(join(out, 'resumo.json'), JSON.stringify(summary, null, 1));
await browser.close();
