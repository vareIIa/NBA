// 1 contra 1 contra a CPU de ponta a ponta (docs/25-1x1-cpu-e-defesa.md): o menu abre o modo e a partida monta com a
// sala local (o juiz do online no navegador) e o jogador da CPU; a CPU ataca, marca com a postura de defesa e ganha a
// partida; o jogador dá toco no arremesso dela (Y = K no teclado) e rouba a bola dela (X = Espaço); fim e revanche.
// Prints em test-results/cpu/. Com várias sessões salvando arquivos, rode contra um Vite sem HMR (E2E_ORIGIN). Não
// precisa do servidor de salas. ?sorte=1: todo toco e todo roubo possível saem (as chances ficam no vitest).
import { expect, test, type Page } from '@playwright/test';

const OUT = 'test-results/cpu';

type CpuDebug = {
  room: string;
  phase: string;
  score: [number, number];
  offense: number;
  you: number;
  ball: string;
  needsClear: boolean;
  seq: number;
  me: { x: number; y: number; phase: string; ballVisible: boolean };
  remote: { x: number; y: number; ball: boolean };
  events: string[];
  defense: { lastContest: { value: number; handsUp: number; jump: number; dist: number } | null };
  cpu: { decision: string; phase: string; defense: { stance: number }; lastContest: { jump: number } | null; shots: number } | null;
};

const state = (page: Page): Promise<CpuDebug | null> => page.evaluate(() => (window.__garrafao?.online?.() ?? null) as never);

async function waitFor(page: Page, ok: (o: CpuDebug) => boolean, timeout = 20_000, every = 100): Promise<CpuDebug> {
  const deadline = Date.now() + timeout;
  let last: CpuDebug | null = null;
  while (Date.now() < deadline) {
    last = await state(page);
    if (last && ok(last)) return last;
    await page.waitForTimeout(every);
  }
  throw new Error(`estado não chegou: ${JSON.stringify(last)}`);
}

const count = (o: CpuDebug, prefix: string): number => o.events.filter((e) => e.startsWith(prefix)).length;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

/** Espera uma posse da CPU com a bola viva, sem precisar limpar, e a deixa parada num ponto; o jogador colado à frente. */
async function setUpCpuBall(page: Page, gap: number): Promise<void> {
  await waitFor(page, (o) => o.phase === 'live' && o.offense === 1 && o.ball === 'held' && !o.needsClear && o.cpu?.phase === 'dribble', 60_000);
  await page.evaluate((g) => {
    type V2 = { x: number; y: number };
    const w = window as unknown as {
      __cpu: { force(k: string): void; game: { placeForLab(x: number, y: number, h: string): void; position: V2 } };
      __debug: { game: { position: V2; velocity: V2 } };
    };
    w.__cpu.force('idle');
    w.__cpu.game.placeForLab(5.6, 0.8, 'r');
    const c = w.__cpu.game.position;
    const l = Math.hypot(c.x, c.y);
    const game = w.__debug.game;
    // O Vec3 do núcleo é imutável: cria outro pelo construtor do que está lá.
    const V = (game.position as unknown as { constructor: new (x: number, y: number, z: number) => V2 }).constructor;
    game.position = new V(c.x - (c.x / l) * g, c.y - (c.y / l) * g, 0);
    game.velocity = new V(0, 0, 0);
  }, gap);
  await page.waitForTimeout(400);
}

test('1 contra 1: o menu abre o modo contra a CPU e a partida monta com o juiz local', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await page.goto('/?menu=1&nome=Teste');
  const item = page.locator('.mn .mm-item[data-mode="oneonone"]');
  await item.waitFor({ timeout: 90_000 });
  await expect(item).not.toHaveClass(/locked/);
  await item.click();
  await page.locator('.ol-item', { hasText: 'Jogar' }).waitFor({ timeout: 10_000 });
  await page.screenshot({ path: `${OUT}/01-escolha-do-adversario.png` });
  await page.locator('.ol-item', { hasText: 'Jogar' }).click();
  const o = await waitFor(page, (x) => x.phase === 'check' && !!x.cpu, 90_000);
  expect(o.room).toBe('CPU');
  expect(o.you).toBe(0);
  expect(o.offense).toBe(0); // o jogador começa atacando
  expect(o.me.ballVisible).toBe(true);
  await waitFor(page, (x) => x.phase === 'live', 15_000);
  await page.screenshot({ path: `${OUT}/02-valendo.png` });
  expect(errors).toEqual([]);
});

test('Defesa do jogador contra a CPU: toco no arremesso dela (Y na hora) e roubo no drible dela', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.goto('/?menu=0&cpu=bala&nivel=pro&ataque=cpu&sorte=1&nome=Teste');
  await waitFor(page, (o) => !!o.cpu && o.phase === 'check', 90_000);

  // Toco: colado a 0,8 m, Y logo depois de a CPU começar o arremesso; a mão sobe junto com a bola.
  let blocked = false;
  for (let attempt = 0; attempt < 3 && !blocked; attempt++) {
    await setUpCpuBall(page, 0.8);
    const before = (await state(page))!;
    await page.evaluate(() => (window as unknown as { __cpu: { force(k: string): void } }).__cpu.force('shoot'));
    await waitFor(page, (o) => o.cpu?.phase === 'gather', 3_000, 16);
    await page.waitForTimeout(90);
    await page.keyboard.down('KeyK');
    await page.waitForTimeout(80);
    await page.keyboard.up('KeyK');
    const after = await waitFor(page, (o) => o.events.length > before.events.length && /block|score|miss|rebound/.test(o.events.slice(before.events.length).join(' ')), 8_000);
    if (count(after, 'block:0') > count(before, 'block:0')) {
      blocked = true;
      // A contestação da CPU no arremesso leu o pulo do jogador.
      expect(after.cpu?.lastContest?.jump ?? 0).toBeGreaterThan(0.1);
      await page.screenshot({ path: `${OUT}/03-toco-do-jogador.png` });
    }
    await page.waitForTimeout(2500);
  }
  expect(blocked, 'nenhum toco em 3 arremessos com o jogador colado e pulando na hora').toBe(true);

  // Roubo: a CPU dribla parada, o jogador encosta na bola e dá o tapa (sorte: o juiz sempre aceita).
  let stolen = false;
  for (let attempt = 0; attempt < 4 && !stolen; attempt++) {
    await setUpCpuBall(page, 0.7);
    const before = (await state(page))!;
    await page.keyboard.down('Space');
    await page.waitForTimeout(60);
    await page.keyboard.up('Space');
    const after = await waitFor(page, (o) => count(o, 'steal:0') > count(before, 'steal:0') || o.seq !== before.seq, 3_000).catch(() => null);
    if (after && count(after, 'steal:0') > count(before, 'steal:0')) {
      stolen = true;
      await waitFor(page, (o) => o.offense === 0 && o.me.ballVisible, 3_000);
      await page.screenshot({ path: `${OUT}/04-roubo-do-jogador.png` });
    } else await page.waitForTimeout(1000);
  }
  expect(stolen, 'nenhum roubo em 4 tapas na bola da CPU').toBe(true);
  expect(errors).toEqual([]);
});

test('A CPU ataca, marca com postura de defesa e fecha a partida; revanche começa outra', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto('/?menu=0&cpu=flash&nivel=allstar&ataque=cpu&alvo=2&nome=Teste');
  await waitFor(page, (o) => !!o.cpu, 90_000);
  // A CPU pontua (o jogador fica parado).
  await waitFor(page, (o) => count(o, 'score:1') > 0, 90_000, 250);
  // Na posse do jogador, a CPU marca de perto, agachada (postura de defesa).
  const guarded = await waitFor(page, (o) => o.phase === 'live' && o.offense === 0 && (o.cpu?.defense.stance ?? 0) > 0.5, 30_000, 100);
  expect(Math.hypot(guarded.remote.x - guarded.me.x, guarded.remote.y - guarded.me.y)).toBeLessThan(3);
  await page.screenshot({ path: `${OUT}/05-cpu-marcando.png` });
  // Fim: a CPU chega a 2.
  const over = await waitFor(page, (o) => o.phase === 'over', 150_000, 250);
  expect(over.score[1]).toBe(2);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/06-fim.png` });
  await page.keyboard.press('Enter'); // Revanche (A)
  const again = await waitFor(page, (o) => o.phase === 'check' && o.score[0] + o.score[1] === 0, 10_000);
  expect(again.offense).toBe(0); // o primeiro ataque troca
  expect(errors).toEqual([]);
});
