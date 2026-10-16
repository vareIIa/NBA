// Online 1x1 de ponta a ponta: sobe o servidor de salas (web/server/dev.ts, porta própria), abre dois navegadores
// (dois jogadores), um cria a sala pelo menu e o outro entra pelo link de convite (?sala=). Os dois ficam prontos, o
// check monta atacante e defensor, o estado de cada um chega ao outro (boneco remoto), o ataque arremessa e a posse
// troca nos dois do mesmo jeito; no fim, um sai e o outro vence por W.O.
// Prints em test-results/online/. Com várias sessões salvando arquivos, rode contra um Vite sem HMR (E2E_ORIGIN).
import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OUT = 'test-results/online';
const HubPort = 8791;
const Mp = `ws://127.0.0.1:${HubPort}/ws`;

type OnlineDebug = {
  you: number;
  room: string;
  phase: string;
  score: [number, number];
  offense: number;
  ball: string;
  needsClear: boolean;
  ballAt: [number, number, number] | null;
  seq: number;
  winner: number | null;
  net: string;
  me: { x: number; y: number; phase: string; ballVisible: boolean };
  remote: { x: number; y: number; ball: boolean };
};

const online = (page: Page): Promise<OnlineDebug | null> =>
  page.evaluate(() => (window.__garrafao?.online?.() ?? null) as never);

async function waitOnline(page: Page, test: (o: OnlineDebug) => boolean, timeout = 20_000): Promise<OnlineDebug> {
  const deadline = Date.now() + timeout;
  let last: OnlineDebug | null = null;
  while (Date.now() < deadline) {
    last = await online(page);
    if (last && test(last)) return last;
    await page.waitForTimeout(150);
  }
  throw new Error(`estado online não chegou: ${JSON.stringify(last)}`);
}

let hub: ChildProcess | null = null;

test.beforeAll(async () => {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  hub = spawn(process.execPath, ['server/dev.ts'], { cwd, env: { ...process.env, PORT: String(HubPort) }, stdio: 'pipe' });
  hub.stdout?.on('data', (d) => process.stdout.write(`[sala] ${d}`));
  hub.stderr?.on('data', (d) => process.stdout.write(`[sala!] ${d}`));
  // Espera o servidor responder no HTTP.
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${HubPort}/`);
      if (res.ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('servidor de salas não subiu');
});

test.afterAll(() => {
  hub?.kill();
});

test('Online 1x1: sala com código, convite, check, estado remoto, posse e W.O.', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors: string[] = [];
  for (const [name, page] of [['A', a], ['B', b]] as const) {
    page.on('pageerror', (e) => errors.push(`${name}: ${String(e)}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  }

  // A: menu → Online 1x1 → Criar sala.
  await a.goto(`/?menu=1&nome=Ana&mp=${encodeURIComponent(Mp)}`);
  await a.locator('.mn .mm-item[data-mode="online"]').waitFor({ timeout: 90_000 });
  await a.locator('.mn .mm-item[data-mode="online"]').click();
  await a.locator('.ol-item', { hasText: 'Criar sala' }).click();
  const code = (await a.locator('.ol-code b').innerText({ timeout: 10_000 })).trim();
  expect(code).toMatch(/^[A-Z2-9]{4}$/);
  const link = await a.locator('.ol-link').innerText();
  expect(link).toContain(`sala=${code}`);
  await a.screenshot({ path: `${OUT}/01-sala-criada.png` });

  // B: abre o link do convite (com o mesmo servidor de salas) e cai direto na sala.
  await b.goto(`/?sala=${code}&nome=Bia&mp=${encodeURIComponent(Mp)}`);
  await b.locator('.ol-slot.me').waitFor({ timeout: 90_000 });
  await expect(a.locator('.ol-slot:not(.empty)')).toHaveCount(2);
  await expect(b.locator('.ol-slot-name', { hasText: 'Ana' })).toHaveCount(1);

  // Os dois prontos: a partida começa (o menu fecha, a quadra monta e o boneco do oponente carrega).
  await a.locator('.ol-item', { hasText: /^Pronto/ }).click();
  await b.locator('.ol-item', { hasText: /^Pronto/ }).click();
  const sa = await waitOnline(a, (o) => o.phase === 'check', 60_000);
  const sb = await waitOnline(b, (o) => o.phase === 'check', 60_000);
  expect(sa.room).toBe(code);
  expect(sa.you).toBe(0);
  expect(sb.you).toBe(1);
  expect(sa.offense).toBe(sb.offense);
  const [off, def] = sa.offense === 0 ? [a, b] : [b, a];
  // Check: o atacante com a bola além da linha de 3, o defensor à frente dele sem bola.
  const so = (await online(off))!;
  const sd = (await online(def))!;
  expect(so.me.ballVisible).toBe(true);
  expect(sd.me.ballVisible).toBe(false);
  expect(so.me.x).toBeGreaterThan(sd.me.x);
  await off.waitForTimeout(1200);
  await a.screenshot({ path: `${OUT}/02-check-A.png` });
  await b.screenshot({ path: `${OUT}/03-check-B.png` });

  // O estado de cada um chega ao outro: o boneco remoto está onde o outro jogador está.
  const ro = (await online(off))!;
  const rd = (await online(def))!;
  expect(Math.hypot(ro.remote.x - rd.me.x, ro.remote.y - rd.me.y)).toBeLessThan(0.5);
  expect(Math.hypot(rd.remote.x - ro.me.x, rd.remote.y - ro.me.y)).toBeLessThan(0.5);
  expect(rd.remote.ball).toBe(true); // a bola do atacante aparece na tela do defensor

  // Valendo: o defensor anda e o atacante vê o boneco andar.
  await waitOnline(off, (o) => o.phase === 'live', 15_000);
  const before = (await online(off))!.remote;
  await def.keyboard.down('KeyD');
  await def.waitForTimeout(700);
  await def.keyboard.up('KeyD');
  await def.waitForTimeout(400);
  const after = (await online(off))!.remote;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0.4);

  // O atacante arremessa (segura e solta o espaço): o juiz recebe a soltura e o resultado; a posse termina com cesta
  // (check do outro) ou com erro (bola solta → rebote ou bola presa → defesa). Em todos os casos a bola troca.
  const seq0 = (await online(off))!.seq;
  await off.keyboard.down('Space');
  await off.waitForTimeout(520);
  await off.keyboard.up('Space');
  await waitOnline(off, (o) => o.ball !== 'held' || o.seq !== seq0, 6_000);
  await a.screenshot({ path: `${OUT}/04-arremesso-A.png` });
  await b.screenshot({ path: `${OUT}/05-arremesso-B.png` });
  const next = await waitOnline(off, (o) => o.phase === 'check' && o.seq > seq0, 25_000);
  const nextB = await waitOnline(def, (o) => o.seq === next.seq, 5_000);
  expect(nextB.score).toEqual(next.score);
  expect(nextB.offense).toBe(next.offense);
  await off.waitForTimeout(800);
  await a.screenshot({ path: `${OUT}/06-posse-seguinte-A.png` });
  await b.screenshot({ path: `${OUT}/07-posse-seguinte-B.png` });

  // B sai da partida (P → confirmar): A vence por W.O.
  // Tecla segurada um pouco (o jogo lê o teclado por quadro; um press instantâneo cai entre dois quadros).
  await b.keyboard.down('KeyP');
  await b.waitForTimeout(120);
  await b.keyboard.up('KeyP');
  await b.locator('.oh-leave.show').waitFor({ timeout: 5_000 });
  await b.keyboard.press('Enter');
  const end = await waitOnline(a, (o) => o.phase === 'over', 10_000);
  expect(end.winner).toBe(0);
  await expect(a.locator('.oh-result')).toHaveText('VITÓRIA');
  await a.screenshot({ path: `${OUT}/08-wo-A.png` });

  expect(errors.filter((e) => !/favicon|ERR_CONNECTION_REFUSED|WebSocket/.test(e))).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});

/** Partida pronta entre dois navegadores (sala privada pelo menu, o segundo entra pelo código). */
async function startMatch(browser: import('@playwright/test').Browser, names: [string, string]) {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await a.goto(`/?menu=1&nome=${names[0]}&mp=${encodeURIComponent(Mp)}`);
  await a.locator('.mn .mm-item[data-mode="online"]').click({ timeout: 90_000 });
  await a.locator('.ol-item', { hasText: 'Criar sala' }).click();
  const code = (await a.locator('.ol-code b').innerText({ timeout: 10_000 })).trim();
  await b.goto(`/?sala=${code}&nome=${names[1]}&mp=${encodeURIComponent(Mp)}`);
  await b.locator('.ol-slot.me').waitFor({ timeout: 90_000 });
  await a.locator('.ol-item', { hasText: /^Pronto/ }).click();
  await b.locator('.ol-item', { hasText: /^Pronto/ }).click();
  await waitOnline(a, (o) => o.phase === 'live', 60_000);
  await waitOnline(b, (o) => o.phase === 'live', 60_000);
  return { a, b, close: async () => (await ctxA.close(), await ctxB.close()) };
}

/**
 * Leva o jogador da página até o alvo (núcleo) pelo WASD, em malha fechada. A câmera fica atrás do jogador olhando a
 * cesta (na origem): W = para a cesta, D = direita da tela (direita = cima × frente, eixos da Unreal).
 */
async function steer(page: Page, target: () => Promise<[number, number] | null>, done: () => Promise<boolean>, ms: number): Promise<boolean> {
  const held = new Set<string>();
  const set = async (key: string, on: boolean) => {
    if (on && !held.has(key)) (await page.keyboard.down(key), held.add(key));
    if (!on && held.has(key)) (await page.keyboard.up(key), held.delete(key));
  };
  const deadline = Date.now() + ms;
  let ok = false;
  while (Date.now() < deadline) {
    if (await done()) {
      ok = true;
      break;
    }
    const t = await target();
    const me = (await online(page))!.me;
    if (!t) break;
    const len = Math.hypot(me.x, me.y) || 1;
    const f = [-me.x / len, -me.y / len];
    const r = [-f[1], f[0]];
    const d = [t[0] - me.x, t[1] - me.y];
    const along = d[0] * f[0] + d[1] * f[1];
    const side = d[0] * r[0] + d[1] * r[1];
    await set('KeyW', along > 0.2);
    await set('KeyS', along < -0.2);
    await set('KeyD', side > 0.2);
    await set('KeyA', side < -0.2);
    await page.waitForTimeout(60);
  }
  for (const k of [...held]) await set(k, false);
  return ok;
}

test('Online 1x1: erro, rebote do defensor (bola vem para a mão dele) e limpar a bola', async ({ browser }) => {
  test.setTimeout(240_000);
  const { a, b, close } = await startMatch(browser, ['Caio', 'Duda']);
  const page = (side: number) => (side === 0 ? a : b);
  // Arremessa com timing ruim (soltura atrasada) até sair um erro; cesta troca a posse e quem ataca tenta de novo.
  let missed: OnlineDebug | null = null;
  for (let attempt = 0; attempt < 6 && !missed; attempt++) {
    const s = await waitOnline(a, (o) => o.phase === 'live' && o.ball === 'held', 20_000);
    const shooter = page(s.offense);
    await shooter.keyboard.down('Space');
    await shooter.waitForTimeout(1100); // soltura bem atrasada: quase sempre erra
    await shooter.keyboard.up('Space');
    const after = await waitOnline(a, (o) => o.seq !== s.seq || o.ball === 'loose', 12_000);
    if (after.ball === 'loose' && after.seq === s.seq) missed = after;
    else await waitOnline(a, (o) => o.phase === 'live', 12_000);
  }
  expect(missed, 'nenhum erro em 6 arremessos com timing ruim').not.toBeNull();
  const shooterSide = missed!.offense;
  const def = page(1 - shooterSide);
  const off = page(shooterSide);
  await def.screenshot({ path: `${OUT}/10-bola-solta-defensor.png` });
  // O defensor corre até a bola que ele vê (a do boneco do oponente) e pega.
  const got = await steer(
    def,
    async () => {
      const o = (await online(def))!;
      return o.ballAt ? [o.ballAt[0], o.ballAt[1]] : null;
    },
    async () => (await online(def))!.seq !== missed!.seq,
    12_000,
  );
  expect(got).toBe(true);
  const sd = await waitOnline(def, (o) => o.seq !== missed!.seq, 3_000);
  if (sd.offense === sd.you) {
    // Rebote defensivo: a bola voa para a mão dele, o atacante fica sem bola, e precisa limpar.
    expect(sd.needsClear).toBe(true);
    const held = await waitOnline(def, (o) => o.me.phase === 'dribble' && o.me.ballVisible, 3_000);
    expect(held.ballAt).not.toBeNull();
    const so = await waitOnline(off, (o) => o.seq === sd.seq, 3_000);
    expect(so.me.ballVisible).toBe(false);
    expect(so.offense).toBe(sd.you);
    await def.screenshot({ path: `${OUT}/11-rebote-defensivo.png` });
    // Limpa: vai para fora da linha de 3 (7,24 m da cesta).
    const cleared = await steer(def, async () => [8.6, 0], async () => !(await online(def))!.needsClear, 10_000);
    expect(cleared).toBe(true);
    await waitOnline(off, (o) => !o.needsClear, 3_000);
    await def.screenshot({ path: `${OUT}/12-bola-limpa.png` });
  } else {
    // O arremessador chegou antes (rebote ofensivo): não precisa limpar e a bola volta para a mão dele.
    expect(sd.needsClear).toBe(false);
    await waitOnline(off, (o) => o.me.phase === 'dribble' && o.me.ballVisible, 3_000);
  }
  await close();
});
