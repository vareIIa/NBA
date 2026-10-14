// Teste visual do Freestyle: abre o jogo headless, joga sozinho com teclado simulado, tira prints e grava vídeo.
// Saída em test-results/entrega/ (prints .png e freestyle.webm), para mandar ao diretor junto com a entrega.
import { expect, test, type Page } from '@playwright/test';
import { Recorder } from './recorder';

const OUT = 'test-results/entrega';

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

async function waitForShots(page: Page, count: number): Promise<void> {
  await page.waitForFunction((n) => (window.__garrafao?.shots().length ?? 0) >= n, count, { timeout: 15_000 });
  await page.waitForFunction(() => window.__garrafao?.phase() === 'dribble', undefined, { timeout: 5_000 });
}

/** Segura o X (Espaço) por holdMs e solta: o tempo de segurar é o timing do arremesso. */
async function shoot(page: Page, holdMs: number): Promise<void> {
  await page.keyboard.down('Space');
  await page.waitForTimeout(holdMs);
  await page.keyboard.up('Space');
}

test('Freestyle: quadra, drible e arremessos com a física do núcleo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const recorder = new Recorder(page);
  await page.goto('/');
  await recorder.start();
  await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await shot(page, '01-quadra');

  // Drible andando para a direita (da câmera) e para a cesta. Câmera olha para -X; nos eixos da Unreal a
  // direita de quem olha para -X é -Y.
  const start = await page.evaluate(() => window.__garrafao!.player());
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyD');
  const afterRight = await page.evaluate(() => window.__garrafao!.player());
  expect(afterRight.y).toBeLessThan(start.y - 0.5);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await shot(page, '02-drible-andando');
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(600);
  const moved = await page.evaluate(() => window.__garrafao!.player());
  expect(Math.hypot(moved.x - start.x, moved.y - start.y)).toBeGreaterThan(1);

  // Arremesso no tempo ideal (560 ms com soltura normal). Sem print durante o gather: atrasaria a soltura.
  await shoot(page, 560);
  await page.waitForTimeout(450);
  await shot(page, '04-bola-no-ar');
  await page.waitForTimeout(500);
  await shot(page, '05-chegando-no-aro');
  await waitForShots(page, 1);
  await shot(page, '06-resultado');

  // Arremesso muito tarde (segura até a soltura automática) para ver o erro "longo"; o print do medidor sai aqui.
  await page.keyboard.down('Space');
  await page.waitForTimeout(470);
  await shot(page, '03-gather-medidor');
  await page.waitForTimeout(450);
  await page.keyboard.up('Space');
  await page.waitForTimeout(500);
  await shot(page, '07-muito-tarde');
  await waitForShots(page, 2);

  // Sprint para longe e arremesso de 3 com pull-up (sai em movimento).
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyS');
  await page.keyboard.up('ShiftLeft');
  await shoot(page, 560);
  await page.waitForTimeout(700);
  await shot(page, '08-pull-up');
  await waitForShots(page, 3);
  await page.waitForTimeout(400);
  await shot(page, '09-placar');

  const shots = await page.evaluate(() => window.__garrafao!.shots());
  console.log('Arremessos:', JSON.stringify(shots, null, 1));
  expect(shots.length).toBeGreaterThanOrEqual(3);
  // A física sempre realiza a decisão do modelo (cesta decidida = cesta na simulação).
  for (const record of shots) expect(record.scored).toBe(record.make);
  // O timing vem do relógio real dos eventos: segurar 560 ms (o ideal) não pode virar "muito tarde" com FPS baixo.
  expect(['GREEN', 'BOM']).toContain(shots[0].timing);
  expect(shots[1].timing).toBe('MUITO TARDE');
  console.log(`FPS no headless: ${(await page.evaluate(() => window.__garrafao!.fps())).toFixed(0)}`);
  expect(errors).toEqual([]);

  // Vídeo da sessão inteira.
  const seconds = await recorder.stop(`${OUT}/freestyle.webm`);
  console.log(`Vídeo: ${OUT}/freestyle.webm (${seconds.toFixed(1)} s)`);
});
