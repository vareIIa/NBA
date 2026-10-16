// Canal direto do 1x1 (docs/24 §5.1, src/net/PeerLink.ts): dois navegadores, sala pelo servidor de desenvolvimento.
//   1. O canal abre no check e o estado de cada um passa a ir direto (a sala só sinaliza e apita); cortado em silêncio
//      no meio da partida, o estado volta para a sala sem o boneco parar; o canal volta e o estado volta para ele.
//   2. Com ?p2p=falha o canal nunca conecta e a partida inteira anda pela sala.
// Rodando contra um Vite com VITE_P2P=falha, o teste 1 vira o 2 (o canal nunca abre): é o e2e do fallback.
// Com várias sessões salvando arquivos, rode contra um Vite sem HMR (E2E_ORIGIN).
import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OUT = 'test-results/online-p2p';
const HubPort = 8792;
const Mp = `ws://127.0.0.1:${HubPort}/ws`;

type Link = {
  mode: 'on' | 'off' | 'fail';
  state: string;
  via: 'direto' | 'sala';
  rtt: number;
  route: string;
  attempts: number;
  tx: { direto: number; sala: number };
  rx: { direto: number; sala: number };
};
type OnlineDebug = {
  phase: string;
  rtt: number;
  link: Link;
  me: { x: number; y: number };
  remote: { x: number; y: number; ball: boolean };
  remoteStats: { delayMs: number; rejected: number; failed: number };
};

const online = (page: Page): Promise<OnlineDebug | null> => page.evaluate(() => (window.__garrafao?.online?.() ?? null) as never);

async function waitOnline(page: Page, ok: (o: OnlineDebug) => boolean, timeout = 20_000): Promise<OnlineDebug> {
  const deadline = Date.now() + timeout;
  let last: OnlineDebug | null = null;
  while (Date.now() < deadline) {
    last = await online(page);
    if (last && ok(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`estado online não chegou: ${JSON.stringify(last)}`);
}

let hub: ChildProcess | null = null;

test.beforeAll(async () => {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  hub = spawn(process.execPath, ['server/dev.ts'], { cwd, env: { ...process.env, PORT: String(HubPort), MP_LOG: '0' }, stdio: 'pipe' });
  hub.stderr?.on('data', (d) => process.stdout.write(`[sala!] ${d}`));
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${HubPort}/`)).ok) return;
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

/** Partida valendo entre dois navegadores. `p2p` vai na URL dos dois (vazio = o padrão do build). */
async function startMatch(browser: Browser, names: [string, string], p2p = '') {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  const pages: Page[] = [];
  for (const [name, ctx] of [['A', ctxA], ['B', ctxB]] as const) {
    // Corte do canal em silêncio (nada passa, nada fecha), ligado pelo teste: window.__cortaP2P = true.
    await ctx.addInitScript(() => {
      const send = RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send = function (this: RTCDataChannel, ...args: Parameters<RTCDataChannel['send']>) {
        if ((window as { __cortaP2P?: boolean }).__cortaP2P) return;
        return send.apply(this, args);
      } as RTCDataChannel['send'];
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${String(e)}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
    pages.push(page);
  }
  const [a, b] = pages;
  const extra = `&mp=${encodeURIComponent(Mp)}${p2p ? `&p2p=${p2p}` : ''}`;
  await a.goto(`/?menu=1&nome=${names[0]}${extra}`);
  await a.locator('.mn .mm-item[data-mode="online"]').click({ timeout: 90_000 });
  await a.locator('.ol-item', { hasText: 'Criar sala' }).click();
  const code = (await a.locator('.ol-code b').innerText({ timeout: 10_000 })).trim();
  await b.goto(`/?sala=${code}&nome=${names[1]}${extra}`);
  await b.locator('.ol-slot.me').waitFor({ timeout: 90_000 });
  await a.locator('.ol-item', { hasText: /^Pronto/ }).click();
  await b.locator('.ol-item', { hasText: /^Pronto/ }).click();
  await waitOnline(a, (o) => o.phase === 'live', 60_000);
  await waitOnline(b, (o) => o.phase === 'live', 60_000);
  return { a, b, errors, close: async () => (await ctxA.close(), await ctxB.close()) };
}

/** `mover` anda com a tecla por um tempo; o boneco dele na tela de `ver` tem de andar junto. */
async function follows(mover: Page, viewer: Page, key: string): Promise<number> {
  const before = (await online(viewer))!.remote;
  await mover.keyboard.down(key);
  await mover.waitForTimeout(700);
  await mover.keyboard.up(key);
  await mover.waitForTimeout(400);
  const after = (await online(viewer))!.remote;
  return Math.hypot(after.x - before.x, after.y - before.y);
}

/** O canal nunca abre: tudo pela sala, e a partida anda igual. */
async function expectLobbyOnly(a: Page, b: Page): Promise<void> {
  await a.waitForTimeout(2500);
  for (const page of [a, b]) {
    const o = (await online(page))!;
    expect(o.link.state).not.toBe('open');
    expect(o.link.via).toBe('sala');
  }
  const rx0 = (await online(a))!.link.rx;
  expect(await follows(b, a, 'KeyD')).toBeGreaterThan(0.4);
  expect(await follows(a, b, 'KeyA')).toBeGreaterThan(0.4);
  const rx1 = (await online(a))!.link.rx;
  expect(rx1.sala - rx0.sala).toBeGreaterThan(15);
  expect(rx1.direto).toBe(0);
}

test('Canal direto: o estado vai direto, cai em silêncio e volta pela sala, e o canal volta', async ({ browser }) => {
  test.setTimeout(180_000);
  const { a, b, errors, close } = await startMatch(browser, ['Rui', 'Lia']);
  if ((await online(a))!.link.mode === 'fail') {
    // Build com VITE_P2P=falha: o e2e do fallback.
    await expectLobbyOnly(a, b);
    expect(errors).toEqual([]);
    await close();
    return;
  }

  // Abre durante o check (5 s) e o estado passa a ir direto.
  const la = await waitOnline(a, (o) => o.link.state === 'open' && o.link.via === 'direto', 15_000);
  await waitOnline(b, (o) => o.link.state === 'open' && o.link.via === 'direto', 5_000);
  console.log(`canal: rota ${la.link.route}, ping do canal ${la.link.rtt} ms, ping da sala ${la.rtt} ms`);
  const d0 = (await online(a))!.link;
  expect(await follows(b, a, 'KeyD')).toBeGreaterThan(0.4);
  const d1 = (await online(a))!.link;
  expect(d1.rx.direto - d0.rx.direto).toBeGreaterThan(15);
  expect(d1.rx.sala - d0.rx.sala).toBeLessThanOrEqual(1);
  await a.screenshot({ path: `${OUT}/01-direto-A.png` });

  // Corte em silêncio nos dois: o estado volta para a sala em menos de 1 s e o boneco continua seguindo.
  for (const page of [a, b]) await page.evaluate(() => ((window as { __cortaP2P?: boolean }).__cortaP2P = true));
  await waitOnline(a, (o) => o.link.via === 'sala', 2_000);
  await waitOnline(b, (o) => o.link.via === 'sala', 2_000);
  const s0 = (await online(a))!.link;
  expect(await follows(b, a, 'KeyA')).toBeGreaterThan(0.4);
  expect(await follows(a, b, 'KeyD')).toBeGreaterThan(0.4);
  const s1 = (await online(a))!.link;
  expect(s1.rx.sala - s0.rx.sala).toBeGreaterThan(15);
  await b.screenshot({ path: `${OUT}/02-cortado-pela-sala-B.png` });

  // O canal volta (o ping dele chega de novo): o estado volta para ele.
  for (const page of [a, b]) await page.evaluate(() => ((window as { __cortaP2P?: boolean }).__cortaP2P = false));
  await waitOnline(a, (o) => o.link.via === 'direto', 3_000);
  await waitOnline(b, (o) => o.link.via === 'direto', 3_000);
  const r0 = (await online(a))!.link;
  expect(await follows(b, a, 'KeyD')).toBeGreaterThan(0.4);
  const r1 = (await online(a))!.link;
  expect(r1.rx.direto - r0.rx.direto).toBeGreaterThan(15);

  // O boneco nunca recusou payload nem falhou comando.
  for (const page of [a, b]) {
    const st = (await online(page))!.remoteStats;
    expect(st.rejected).toBe(0);
    expect(st.failed).toBe(0);
  }
  expect(errors).toEqual([]);
  await close();
});

test('Canal direto forçado a falhar (?p2p=falha): a partida inteira anda pela sala', async ({ browser }) => {
  test.setTimeout(180_000);
  const { a, b, errors, close } = await startMatch(browser, ['Gil', 'Ivo'], 'falha');
  expect((await online(a))!.link.mode).toBe('fail');
  await expectLobbyOnly(a, b);
  expect(errors).toEqual([]);
  await close();
});
