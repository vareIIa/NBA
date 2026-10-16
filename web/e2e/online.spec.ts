// Online 1x1 de ponta a ponta: sobe o servidor de salas (web/server/dev.ts, porta própria), abre dois navegadores
// (dois jogadores), um cria a sala pelo menu e o outro entra pelo link de convite (?sala=). Os dois ficam prontos, o
// check monta atacante e defensor, o estado de cada um chega ao outro (boneco remoto), o ataque arremessa e a posse
// troca nos dois do mesmo jeito; no fim, um sai e o outro vence por W.O. A defesa (contestar, roubar, dar toco) também.
// Prints em test-results/online/. Com várias sessões salvando arquivos, rode contra um Vite sem HMR (E2E_ORIGIN).
// O servidor de salas sobe com HUB_SORTE=1 (o sorteio do roubo sai sempre) e as páginas da defesa com ?sorte=1 (o toco
// possível sai sempre): o e2e confere a ligação de ponta a ponta; as chances ficam no vitest (src/net/hub/hub.test.ts).
// E2E_HUB_PORT troca a porta do servidor de salas (outra sessão pode estar com a 8791). E2E_MP=<wss da sala publicada>
// testa contra a sala no ar (com E2E_ORIGIN no site publicado): nada sobe aqui, e sem a sorte de teste o roubo é um
// sorteio de verdade (mais tapas; se nenhum sair, o teste anota em vez de falhar).
import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ProtocolVersion } from '../src/net/protocol';

const OUT = 'test-results/online';
const HubPort = Number(process.env.E2E_HUB_PORT ?? 8791);
const LiveMp = process.env.E2E_MP;
const Mp = LiveMp ?? `ws://127.0.0.1:${HubPort}/ws`;

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
  events: string[];
  defense: {
    me: { handsUp: number; jump: number };
    remoteShown: { handsUp: number; jump: number };
    remoteNet: { handsUp: number; jump: number };
    myHandY: number;
    remoteHandY: number;
    lastContest: { value: number; handsUp: number; jump: number; dist: number } | null;
    lastBlock: { dist: number; chance: number; blocked: boolean } | null;
    jumps: number;
    stealTries: number;
    stealSent: number;
    blocks: number;
  };
};

const online = (page: Page): Promise<OnlineDebug | null> =>
  page.evaluate(() => (window.__garrafao?.online?.() ?? null) as never);

async function waitOnline(page: Page, test: (o: OnlineDebug) => boolean, timeout = 20_000, every = 150): Promise<OnlineDebug> {
  const deadline = Date.now() + timeout;
  let last: OnlineDebug | null = null;
  while (Date.now() < deadline) {
    last = await online(page);
    if (last && test(last)) return last;
    await page.waitForTimeout(every);
  }
  throw new Error(`estado online não chegou: ${JSON.stringify(last)}`);
}

let hub: ChildProcess | null = null;

test.beforeAll(async () => {
  if (LiveMp) return; // sala publicada: nada a subir
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  hub = spawn(process.execPath, ['server/dev.ts'], { cwd, env: { ...process.env, PORT: String(HubPort), HUB_SORTE: '1' }, stdio: 'pipe' });
  hub.stdout?.on('data', (d) => process.stdout.write(`[sala] ${d}`));
  hub.stderr?.on('data', (d) => process.stdout.write(`[sala!] ${d}`));
  // Espera o servidor responder no HTTP. Tem de ser ESTE (versão do protocolo e a sorte dos testes): um servidor velho
  // esquecido na porta derruba os clientes com 'version' sem dizer por quê.
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${HubPort}/`);
      if (res.ok) {
        const info = (await res.json()) as { v?: number; lucky?: boolean };
        if (info.v !== ProtocolVersion || info.lucky !== true) {
          throw new Error(`a porta ${HubPort} tem outro servidor de salas (${JSON.stringify(info)}): use E2E_HUB_PORT`);
        }
        return;
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('E2E_HUB_PORT')) throw e;
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
async function startMatch(browser: import('@playwright/test').Browser, names: [string, string], extra = '') {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await a.goto(`/?menu=1&nome=${names[0]}&mp=${encodeURIComponent(Mp)}${extra}`);
  await a.locator('.mn .mm-item[data-mode="online"]').click({ timeout: 90_000 });
  await a.locator('.ol-item', { hasText: 'Criar sala' }).click();
  const code = (await a.locator('.ol-code b').innerText({ timeout: 10_000 })).trim();
  await b.goto(`/?sala=${code}&nome=${names[1]}&mp=${encodeURIComponent(Mp)}${extra}`);
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

/** Tecla apertada por `ms` (o jogo lê o teclado por quadro: um press instantâneo cai entre dois quadros). */
async function tap(page: Page, key: string, ms = 120): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** Ponto `gap` m à frente do jogador, do lado da cesta (na origem do núcleo). */
function inFront(p: { x: number; y: number }, gap: number): [number, number] {
  const len = Math.hypot(p.x, p.y) || 1;
  return [p.x - (p.x / len) * gap, p.y - (p.y / len) * gap];
}

/** Distância (m) do ponto p ao segmento a→b, no chão. */
function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const k = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / Math.max(1e-9, abx * abx + aby * aby)));
  return Math.hypot(p.x - (a.x + abx * k), p.y - (a.y + aby * k));
}

/**
 * Leva o defensor para `gap` m à frente do atacante (entre ele e a cesta). Se o atacante está no caminho (o defensor
 * atrás dele, depois de um roubo), contorna por um lado: o corpo a corpo não deixa atravessar.
 */
async function guard(def: Page, gap: number): Promise<boolean> {
  const o = (await online(def))!;
  const [tx, ty] = inFront(o.remote, gap);
  if (segDist(o.remote, o.me, { x: tx, y: ty }) < 0.75) {
    const len = Math.hypot(o.remote.x, o.remote.y) || 1;
    const side = [-o.remote.y / len, o.remote.x / len]; // perpendicular à linha atacante–cesta
    const s = (o.me.x - o.remote.x) * side[0] + (o.me.y - o.remote.y) * side[1] >= 0 ? 1 : -1;
    const way: [number, number] = [o.remote.x + side[0] * s * 1.2, o.remote.y + side[1] * s * 1.2];
    await steer(
      def,
      async () => way,
      async () => {
        const m = (await online(def))!.me;
        return Math.hypot(m.x - way[0], m.y - way[1]) < 0.4;
      },
      5_000,
    );
  }
  return steer(
    def,
    async () => inFront((await online(def))!.remote, gap),
    async () => {
      const o = (await online(def))!;
      const t = inFront(o.remote, gap);
      return Math.hypot(o.me.x - t[0], o.me.y - t[1]) < 0.3;
    },
    8_000,
  );
}

const count = (o: OnlineDebug, prefix: string): number => o.events.filter((e) => e.startsWith(prefix)).length;

test('Online 1x1: defesa — contestação com pulo e braços, roubo e toco, vistos nos dois lados', async ({ browser }) => {
  test.setTimeout(240_000);
  const { a, b, close } = await startMatch(browser, ['Gil', 'Hana'], '&sorte=1');
  const errors: string[] = [];
  for (const [name, p] of [['A', a], ['B', b]] as const) {
    p.on('pageerror', (e) => errors.push(`${name}: ${String(e)}`));
    p.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  }
  const page = (side: number) => (side === 0 ? a : b);
  let s = await waitOnline(a, (o) => o.phase === 'live' && o.ball === 'held', 20_000);
  let off = page(s.offense);
  let def = page(1 - s.offense);

  // 1) Mãos para cima (↑ = RS para cima) e pulo de contestação (K = Y): no animador do defensor e no boneco dele que o
  //    atacante vê (comando repetido) e no estado que chega pela rede (a contestação da soltura lê este).
  const rest = (await online(off))!.defense.remoteHandY;
  await def.keyboard.down('ArrowUp');
  await waitOnline(def, (o) => o.defense.me.handsUp > 0.9, 3_000, 50);
  const up = await waitOnline(off, (o) => o.defense.remoteShown.handsUp > 0.9 && o.defense.remoteNet.handsUp > 0.9, 3_000, 50);
  expect(up.defense.remoteHandY).toBeGreaterThan(rest + 0.7);
  await off.screenshot({ path: `${OUT}/20-maos-para-cima-vistas-pelo-atacante.png` });
  await def.keyboard.up('ArrowUp');
  await tap(def, 'KeyK');
  const air = await waitOnline(def, (o) => o.defense.me.jump > 0.25, 2_000, 30);
  const seen = await waitOnline(off, (o) => o.defense.remoteShown.jump > 0.25, 2_000, 30);
  await off.screenshot({ path: `${OUT}/21-pulo-visto-pelo-atacante.png` });
  await def.screenshot({ path: `${OUT}/22-pulo-do-defensor.png` });
  expect(air.defense.jumps).toBe(1);
  expect(seen.defense.remoteHandY).toBeGreaterThan(up.defense.remoteHandY + 0.2);
  await waitOnline(def, (o) => o.defense.me.jump === 0 && o.defense.me.handsUp < 0.05, 3_000);

  // 2) Roubo: o defensor encosta no atacante (que dribla parado) e dá o tapa (Espaço = X). O juiz sorteia (sorte de
  //    teste: sai); a posse troca nos dois, a bola voa para a mão de quem roubou e ele precisa limpar.
  const thief = (await online(def))!.you;
  expect(await guard(def, 0.8)).toBe(true);
  let stolen: OnlineDebug | null = null;
  for (let i = 0; i < (LiveMp ? 30 : 8) && !stolen; i++) {
    await tap(def, 'Space', 100);
    stolen = await waitOnline(def, (o) => o.offense === thief, 1_100, 50).catch(() => null);
    if (!stolen) await guard(def, 0.8);
  }
  const tries = (await online(def))!.defense;
  expect(tries.stealSent, 'nenhum tapa chegou ao juiz (bola fora do alcance ou fora do drible)').toBeGreaterThan(0);
  if (!stolen && LiveMp) {
    console.log(`sala publicada: ${tries.stealSent} tapas sem roubo (sorteio de verdade)`);
    test.info().annotations.push({ type: 'roubo', description: `${tries.stealSent} tapas sem roubo na sala publicada` });
  } else {
    expect(stolen, `nenhum roubo: ${JSON.stringify(tries)}`).not.toBeNull();
    expect(stolen!.events).toContain(`steal:${thief}`);
    const victim = await waitOnline(off, (o) => o.offense === thief, 3_000);
    expect(victim.events).toContain(`steal:${thief}`);
    expect(victim.needsClear).toBe(true);
    await waitOnline(def, (o) => o.me.phase === 'dribble' && o.me.ballVisible, 4_000);
    await waitOnline(off, (o) => !o.me.ballVisible && o.remote.ball, 3_000);
    await def.screenshot({ path: `${OUT}/23-roubo-quem-roubou.png` });
    await off.screenshot({ path: `${OUT}/24-roubo-quem-perdeu.png` });
  }

  // 3) Toco: quem defende fica colado à frente do arremessador e pula logo depois do começo do arremesso. Na soltura o
  //    cliente do arremessador lê o pulo e as mãos do defensor (contestação e toco); o toco solta a bola nos dois.
  let blocked = false;
  for (let attempt = 0; attempt < 4 && !blocked; attempt++) {
    s = await waitOnline(a, (o) => o.phase === 'live' && o.ball === 'held', 25_000);
    off = page(s.offense);
    def = page(1 - s.offense);
    await waitOnline(off, (o) => o.me.phase === 'dribble' && o.me.ballVisible, 5_000);
    expect(await guard(def, 0.75)).toBe(true);
    const before = (await online(off))!;
    const beforeDef = (await online(def))!;
    await off.keyboard.down('Space');
    await off.waitForTimeout(230);
    await tap(def, 'KeyK', 80);
    await off.waitForTimeout(200);
    await off.keyboard.up('Space');
    const after = await waitOnline(off, (o) => count(o, 'block:') > count(before, 'block:') || o.seq !== before.seq || o.ball === 'loose', 6_000);
    const shot = (await online(off))!;
    if (count(after, 'block:') > count(before, 'block:')) {
      blocked = true;
      expect(shot.defense.lastBlock?.blocked).toBe(true);
      // A contestação da soltura usou o pulo e as mãos do defensor (não só a distância).
      expect(shot.defense.lastContest!.jump).toBeGreaterThan(0.1);
      expect(shot.defense.lastContest!.handsUp).toBeGreaterThan(0.5);
      const d = await waitOnline(def, (o) => count(o, 'block:') > count(beforeDef, 'block:'), 3_000);
      expect(d.events.at(-1)?.startsWith('block:') || d.events.includes(`block:${d.you}`)).toBe(true);
      await off.screenshot({ path: `${OUT}/25-toco-visto-pelo-arremessador.png` });
      await def.screenshot({ path: `${OUT}/26-toco-do-defensor.png` });
    } else {
      console.log(`tentativa ${attempt + 1} sem toco: ${JSON.stringify(shot.defense)}`);
      await waitOnline(a, (o) => o.seq !== before.seq, 25_000);
    }
  }
  expect(blocked, 'nenhum toco em 4 arremessos com o defensor colado e pulando').toBe(true);

  expect(errors.filter((e) => !/favicon|ERR_CONNECTION_REFUSED|WebSocket/.test(e))).toEqual([]);
  await close();
});
