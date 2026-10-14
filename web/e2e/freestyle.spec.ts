// Teste visual do Freestyle: abre o jogo headless, joga sozinho com teclado simulado (drible parado e andando,
// crossover, entre as pernas, spin, crossover em sprint, drible baixo, arremessos), tira prints e grava vídeo.
// Saída em test-results/entrega/ (prints .png e freestyle.webm), para mandar ao diretor junto com a entrega.
import { expect, test, type Page } from '@playwright/test';
import { Recorder } from './recorder';

const OUT = 'test-results/entrega';
let shotIndex = 0;

async function shot(page: Page, name: string): Promise<void> {
  shotIndex++;
  await page.screenshot({ path: `${OUT}/${String(shotIndex).padStart(2, '0')}-${name}.png` });
}

async function waitForShots(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__garrafao?.shots().length ?? 0) >= n, count, { timeout: 15_000 });
  await page.waitForFunction(() => window.__garrafao?.phase() === 'dribble', undefined, { timeout: 5_000 });
}

/** Toque rápido numa seta = flick do Pro Stick. */
async function flick(page: Page, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(70);
  await page.keyboard.up(key);
}

async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

const ballHand = (page: Page): Promise<string> => page.evaluate(() => window.__garrafao!.anim().ballHand);

test('Freestyle: jogador animado, dribles do Pro Stick e arremessos', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const recorder = new Recorder(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 30_000 });
  await recorder.start();
  await page.waitForTimeout(1500);
  await shot(page, 'drible-parado');

  // Drible andando para a cesta e crossover no meio da passada.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(450);
  await shot(page, 'drible-andando');
  await flick(page, 'ArrowUp');
  await page.waitForTimeout(250);
  await shot(page, 'crossover-andando');
  await page.keyboard.up('KeyW');
  // Volta um pouco para o topo do garrafão (os próximos dribles acontecem com espaço).
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(700);
  expect(await ballHand(page)).toBe('l');

  // Entre as pernas: flick para o lado da mão livre (bola na esquerda -> direita).
  await flick(page, 'ArrowRight');
  await page.waitForTimeout(300);
  await shot(page, 'entre-as-pernas');
  await page.waitForTimeout(800);
  expect(await ballHand(page)).toBe('r');

  // Spin (E gira o Pro Stick virtual).
  await hold(page, 'KeyE', 40);
  await page.waitForTimeout(350);
  await shot(page, 'spin');
  await page.waitForTimeout(1000);

  // Behind the back: diagonal baixo + lado da mão da bola (bola na esquerda depois do spin -> baixo-direita).
  const hand = await ballHand(page);
  const diag = hand === 'r' ? 'ArrowLeft' : 'ArrowRight';
  await page.keyboard.down('ArrowDown');
  await page.keyboard.down(diag);
  await page.waitForTimeout(70);
  await page.keyboard.up(diag);
  await page.keyboard.up('ArrowDown');
  await page.waitForTimeout(160);
  await shot(page, 'behind-the-back');
  await page.waitForTimeout(800);
  expect(await ballHand(page)).not.toBe(hand);

  // Step-back (seta para baixo) e half spin (R) seguidos de step-back: o combo do diretor.
  await flick(page, 'ArrowDown');
  await page.waitForTimeout(260);
  await shot(page, 'step-back');
  await page.waitForTimeout(800);
  await hold(page, 'KeyR', 40);
  await page.waitForTimeout(260);
  await shot(page, 'half-spin');
  await page.waitForTimeout(500);
  await flick(page, 'ArrowDown');
  await page.waitForTimeout(800);

  // Troca de mão automática pelo LS: correndo para o lado da mão livre, ele cruza a bola sozinho.
  const freeSide = (await ballHand(page)) === 'r' ? 'KeyA' : 'KeyD';
  await page.keyboard.down(freeSide);
  await page.waitForTimeout(450);
  await shot(page, 'troca-automatica');
  await page.waitForTimeout(400);
  await page.keyboard.up(freeSide);
  await page.waitForTimeout(700);

  // Sprint para a direita da tela e crossover de ataque (RT + flick para cima).
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(600);
  await flick(page, 'ArrowUp');
  await page.waitForTimeout(220);
  await shot(page, 'crossover-de-ataque');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('ShiftLeft');
  await page.waitForTimeout(900);

  // Drible baixo de proteção (LT = Q).
  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(900);
  await shot(page, 'drible-baixo');
  await page.keyboard.up('KeyQ');
  await page.waitForTimeout(500);

  const stats = await page.evaluate(() => window.__garrafao!.ballStats());
  console.log('Bola no drible:', JSON.stringify(stats));

  // Arremesso no tempo ideal (560 ms com soltura normal). Sem print durante o gather: atrasaria a soltura.
  await hold(page, 'Space', 560);
  await page.waitForTimeout(250);
  await shot(page, 'arremesso-soltura');
  await page.waitForTimeout(700);
  // Sem a bola (ela está no ar), o boneco não dribla: a base é parado/andando/correndo sem bola.
  const baseWithoutBall = await page.evaluate(() => window.__garrafao!.anim().base);
  expect(baseWithoutBall.startsWith('Dribble_')).toBe(false);
  await shot(page, 'bola-no-ar');
  await waitForShots(page, 1);
  await shot(page, 'resultado');

  // Arremesso muito tarde (segura até a soltura automática); o print do medidor sai aqui.
  await page.keyboard.down('Space');
  await page.waitForTimeout(470);
  await shot(page, 'medidor');
  await page.waitForTimeout(450);
  await page.keyboard.up('Space');
  await waitForShots(page, 2);
  await page.waitForTimeout(500);
  await shot(page, 'placar');

  const shots = await page.evaluate(() => window.__garrafao!.shots());
  const moves = await page.evaluate(() => window.__garrafao!.moves());
  console.log('Dribles:', moves.join(', '));
  console.log('Arremessos:', JSON.stringify(shots.map((s) => [s.holdMs, s.timing, s.scored])));
  console.log(`FPS no headless: ${(await page.evaluate(() => window.__garrafao!.fps())).toFixed(0)}`);

  // Dribles reconhecidos pelo núcleo e tocados pelo animador.
  for (const move of ['Crossover', 'Entre as pernas', 'Spin', 'Crossover de ataque', 'Por trás', 'Step-back', 'Half-spin']) {
    expect(moves).toContain(move);
  }
  // A troca automática pelo LS gerou mais um drible de troca de mão sem o Pro Stick.
  expect(moves.filter((m) => m === 'Crossover' || m === 'Entre as pernas').length).toBeGreaterThanOrEqual(3);
  // A bola nunca atravessa o chão nem foge do jogador no drible, e quica de verdade (com as trocas de mão).
  expect(stats.minY).toBeGreaterThan(0.1);
  expect(stats.maxDist).toBeLessThan(1.3);
  expect(stats.bounces).toBeGreaterThan(12);
  expect(stats.handChanges).toBeGreaterThanOrEqual(7);
  // Arremessos: timing pelo relógio real e a física realiza a decisão do modelo.
  expect(shots.length).toBe(2);
  expect(['GREEN', 'BOM']).toContain(shots[0].timing);
  expect(shots[1].timing).toBe('MUITO TARDE');
  for (const record of shots) expect(record.scored).toBe(record.make);
  expect(errors).toEqual([]);

  const seconds = await recorder.stop(`${OUT}/freestyle.webm`);
  console.log(`Vídeo: ${OUT}/freestyle.webm (${seconds.toFixed(1)} s)`);
});
