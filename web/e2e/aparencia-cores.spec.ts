// Aparência, fase 2 (docs/26): as cores das zonas do uniforme e do tênis, só com o teclado (paleta e matiz). A cor
// chega à malha vestida pelos uniforms do shader (GearColors) e troca sem revestir a peça (o PlayerGear é o mesmo).
// Prints em test-results/aparencia/. Mesmo caminho do menu.spec até a aba Aparência.
import { expect, test, type Page } from '@playwright/test';

const OUT = 'test-results/aparencia';

async function press(page: Page, key: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
}

const crumb = (page: Page): Promise<string> => page.locator('.mn-crumb').innerText();

/** Menu → Meu Jogador → criar build → nome → Aparência (a aba Pele abre). */
async function abrirAparencia(page: Page): Promise<void> {
  await page.goto('/?menu=1');
  await page.locator('.mn .mm-item').first().waitFor({ timeout: 60_000 });
  await page.evaluate(() => localStorage.removeItem('garrafao.builds.v1'));
  await press(page, 'ArrowDown');
  await press(page, 'Enter');
  while (!(await page.locator('.bl-item.new.on').count())) await press(page, 'ArrowDown');
  await press(page, 'Enter');
  await press(page, 'Enter');
  await page.keyboard.type('Tano');
  await press(page, 'ArrowDown');
  await press(page, 'Enter');
  await page.keyboard.type('Prestia');
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown', 4);
  await press(page, 'Enter');
  expect(await crumb(page)).toMatch(/Aparência/i);
}

/** Cor (sRGB, '#rrggbb') que a malha da peça vestida está pintando na zona 0 (o uniform do shader). */
const paintedZone = (page: Page, kind: 'jersey' | 'shoes', zone: number): Promise<string | null> =>
  page.evaluate(
    ([k, z]) => {
      const gear = (window as unknown as { __showroom: { outfit: { gear: { worn: { userData: { gear: string }; material: unknown }[] } | null } } }).__showroom.outfit.gear;
      // A malha pintada da peça (o GLB do tênis traz também as meias, sem zonas, antes dele).
      const mesh = gear?.worn.find((m) => m.userData.gear === k && (m.material as { userData: { zones?: unknown } }).userData.zones) as unknown as { material: { userData: { zones?: { uZoneNew: { value: { getHexString: () => string } }[] } } } } | undefined;
      const u = mesh?.material.userData.zones?.uZoneNew[z];
      return u ? `#${u.value.getHexString()}` : null;
    },
    [kind, zone] as const,
  );

test('cores do uniforme de casa e do tênis: paleta e matiz pelo teclado, a roupa pinta sem revestir', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await abrirAparencia(page);

  // Uniforme: a 1ª fileira são os modelos; ↓ zonas (cai na 1ª), ↓ paleta (branco), → vermelho da paleta (índice 5).
  await press(page, 'KeyE');
  await press(page, 'ArrowDown', 2);
  await press(page, 'ArrowRight', 5);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __showroom: { outfit: { look: { colors?: { casa?: string[] } } } } }).__showroom.outfit.look.colors?.casa?.[0])).toBe('#c8202c');
  // A malha da regata já pinta a zona com a cor escolhida (o shader lê o uniform).
  await expect.poll(() => paintedZone(page, 'jersey', 0)).toBe('#c8202c');

  // Sem revestir: a mesma PlayerGear continua vestida depois da troca de cor.
  const before = await page.evaluate(() => {
    const w = window as unknown as { __showroom: { outfit: { gear: object } }; __gearRef?: object };
    w.__gearRef = w.__showroom.outfit.gear;
    return w.__gearRef !== undefined;
  });
  expect(before).toBe(true);

  // Matiz da zona principal: ↓ paleta → ↓ ↓ até o matiz (linha de ajuste) → → gira 30°.
  await press(page, 'ArrowDown', 2);
  await press(page, 'ArrowDown', 2);
  await press(page, 'ArrowRight', 3);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __showroom: { outfit: { look: { colors?: { casa?: string[] } } } } }).__showroom.outfit.look.colors?.casa?.[0])).not.toBe('#c8202c');
  const hued = await page.evaluate(() => (window as unknown as { __showroom: { outfit: { look: { colors?: { casa?: string[] } } } } }).__showroom.outfit.look.colors?.casa?.[0]);
  await expect.poll(() => paintedZone(page, 'jersey', 0)).toBe(hued);
  expect(await page.evaluate(() => (window as unknown as { __showroom: { outfit: { gear: object } }; __gearRef?: object }).__showroom.outfit.gear === (window as unknown as { __gearRef?: object }).__gearRef)).toBe(true);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/01-uniforme-cores.png` });

  // Tênis: ↓ (zonas do tênis), → ... a paleta na zona 2 (azul de 16 cores, índice 13).
  await press(page, 'KeyE');
  await press(page, 'ArrowRight', 2); // Cimento 4 (o 3º da lista)
  await press(page, 'ArrowDown', 2); // zonas (cai na 3ª) e paleta
  await press(page, 'ArrowRight', 11); // paleta índice 13: azul
  await expect.poll(() => page.evaluate(() => (window as unknown as { __showroom: { outfit: { look: { shoes: string; colors?: { tenis?: string[] } } } } }).__showroom.outfit.look.colors?.tenis?.[2])).toBe('#2f6fd6');
  await expect.poll(() => paintedZone(page, 'shoes', 2)).toBe('#2f6fd6');
  expect(await page.evaluate(() => (window as unknown as { __showroom: { outfit: { look: { shoes: string } } } }).__showroom.outfit.look.shoes)).toBe('tenis_cimento_4');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/02-tenis-cores.png` });

  expect(errors).toEqual([]);
});
