// Menu principal e MyPlayer Builder (docs/23): o fluxo inteiro só com o teclado, do menu ao Freestyle com a build nova.
// Prints em test-results/menu/. Com várias sessões salvando arquivos, rode contra um build congelado (E2E_ORIGIN, ver
// playwright.config.ts): o HMR do Vite recarrega a página no meio do teste.
import { expect, test, type Page } from '@playwright/test';

const OUT = 'test-results/menu';

async function press(page: Page, key: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
}

const crumb = (page: Page): Promise<string> => page.locator('.mn-crumb').innerText();

/** Toque rápido numa seta = flick do Pro Stick (o press solta no mesmo instante e o quadro não vê). */
async function flick(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(70);
  await page.keyboard.up(key);
}

test('sem ?menu=1 o Playwright vai direto ao Freestyle (testes e ferramentas não mudam)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 60_000 });
  await expect(page.locator('.mn')).toHaveCount(0);
});

test('menu → Meu Jogador → criar build → corpo → atributos → Shades Of → Freestyle com a build', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?menu=1');
  await page.locator('.mn .mm-item').first().waitFor({ timeout: 60_000 });
  await page.evaluate(() => localStorage.removeItem('garrafao.builds.v1'));
  expect(await crumb(page)).toMatch(/Menu principal/i);
  // Modos que não existem ainda: aparecem e avisam "em desenvolvimento".
  await expect(page.locator('.mm-item.locked')).toHaveCount(4);
  await page.screenshot({ path: `${OUT}/01-menu.png` });

  // Meu Jogador → Criar nova build.
  await press(page, 'ArrowDown');
  await press(page, 'Enter');
  expect(await crumb(page)).toMatch(/Meu Jogador/i);
  while (!(await page.locator('.bl-item.new.on').count())) await press(page, 'ArrowDown');
  await press(page, 'Enter');
  expect(await crumb(page)).toMatch(/Jogador/i);

  // Nome e sobrenome (Enter abre a digitação, ↓ sai do campo e desce).
  await press(page, 'Enter');
  await page.keyboard.type('Tano');
  await press(page, 'ArrowDown');
  await press(page, 'Enter');
  await page.keyboard.type('Prestia');
  await press(page, 'ArrowDown'); // posição: armador
  await press(page, 'ArrowDown', 3); // mão, número, país
  await press(page, 'ArrowDown'); // continuar
  await page.screenshot({ path: `${OUT}/02-jogador.png` });
  await press(page, 'Enter');
  expect(await crumb(page)).toMatch(/Corpo/i);

  // Corpo: altura +2" e envergadura +2"; a tabela de caps mostra os deltas.
  await press(page, 'ArrowRight', 2);
  await press(page, 'ArrowDown', 2);
  await press(page, 'ArrowRight', 2);
  await expect(page.locator('.cap-row .d.up, .cap-row .d.down').first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/03-corpo.png` });
  await press(page, 'ArrowDown', 2);
  await press(page, 'Enter');
  expect(await crumb(page)).toMatch(/Atributos/i);

  // Atributos: preset (Tab abre, Enter aplica o primeiro) e terminar (Enter vai ao botão, Enter termina).
  await press(page, 'Tab');
  await press(page, 'Enter');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/04-atributos.png` });
  await press(page, 'Enter');
  await press(page, 'Enter');
  expect(await crumb(page)).toMatch(/Shades Of/i);
  await expect(page.locator('.so-shade')).toHaveCount(3);
  const archetype = (await page.locator('.so-arch').innerText()).trim();
  expect(archetype.length).toBeGreaterThan(5);
  await page.waitForTimeout(1200); // animação de entrada
  await page.screenshot({ path: `${OUT}/05-shades-of.png` });

  // Salvar e jogar: o menu sai, o Freestyle roda com a build (nome no HUD, arquétipo nas badges, build salva).
  await press(page, 'Enter');
  await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 30_000 });
  await expect(page.locator('.mn')).toHaveCount(0, { timeout: 5_000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('garrafao.builds.v1') ?? 'null'));
  expect(saved.builds).toHaveLength(1);
  expect(saved.active).toBe(saved.builds[0].id);
  expect(saved.builds[0].firstName).toBe('Tano');
  expect(saved.builds[0].lastName).toBe('Prestia');
  const badge = await page.evaluate(() => {
    const opts = (window as unknown as { __badgeMenu: { options: { playerName: string; buildName: string } } }).__badgeMenu.options;
    return { playerName: opts.playerName, buildName: opts.buildName };
  });
  expect(badge.playerName).toBe('T. Prestia');
  expect(badge.buildName.toLowerCase()).toContain(archetype.toLowerCase());
  await page.waitForTimeout(800);
  // Nada do que foi digitado no menu vaza para o jogo (o E de "Prestia" fazia um spin sozinho).
  expect(await page.evaluate(() => window.__garrafao!.moves())).toEqual([]);
  // O boneco tem a altura da build: armador padrão 6'3" + 2" = 6'5" (1,956 m) sobre o boneco de 1,86 m.
  const scale = await page.evaluate(() => (window as unknown as { __debug: { animator: { root: { scale: { x: number } } } } }).__debug.animator.root.scale.x);
  expect(scale).toBeCloseTo((77 * 2.54) / 186, 3);
  await page.screenshot({ path: `${OUT}/06-freestyle.png` });
  expect(errors).toEqual([]);
});

test('pivô de 2,24 m (7 pés e 4) com braço longo dribla no Freestyle sem a bola atravessar o chão nem fugir da mão', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?altura=224&envergadura=8');
  await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 60_000 });
  const body = await page.evaluate(() => {
    const a = (window as unknown as { __debug: { animator: { root: { scale: { x: number } }; heightMeters: number } } }).__debug.animator;
    return { scale: a.root.scale.x, height: a.heightMeters };
  });
  expect(body.scale).toBeCloseTo(224 / 186, 3);
  expect(body.height).toBeCloseTo(2.24, 3);
  // Anda driblando, crossover, entre as pernas e spin (como o freestyle.spec, mais curto).
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await flick(page, 'ArrowUp');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(500);
  await flick(page, 'ArrowRight');
  await page.waitForTimeout(900);
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(40);
  await page.keyboard.up('KeyE');
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${OUT}/07-pivo-224.png` });
  const moves = await page.evaluate(() => window.__garrafao!.moves());
  expect(moves).toContain('Crossover');
  const stats = await page.evaluate(() => window.__garrafao!.ballStats());
  expect(stats.minY).toBeGreaterThan(0.1); // a bola nunca entra no chão
  expect(stats.maxDist).toBeLessThan(1.3 * (224 / 186)); // nem foge do jogador (o limite do freestyle.spec, na escala)
  expect(stats.bounces).toBeGreaterThan(4);
  expect(errors).toEqual([]);
});
