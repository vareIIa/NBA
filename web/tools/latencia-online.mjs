// Latência do 1x1 online (docs/24 §5.1): abre dois navegadores headless na mesma máquina, cria uma sala, começa a
// partida e mede, com os dois jogadores andando:
//   - ping da sala (NetClient.rtt) e, com o canal direto, o ping do canal (link.rtt);
//   - atraso de rede jogador→jogador de cada 'st' (relógio de quem mandou → chegada no outro), pelo caminho que ele veio;
//   - buffer do boneco (RemotePlayer.stats().delayMs) e o atraso total do boneco (rede mínima da janela + buffer).
// Os relógios das duas abas são acertados pelo relógio do Node (amostra de menor ida e volta do page.evaluate).
//
//   node tools/latencia-online.mjs [--origem=URL] [--sala=wss://…/ws | --sala-local=PORTA] [--atraso=MS]
//                                  [--p2p=0|falha] [--segundos=N] [--saida=DIR]
// --origem      o jogo (padrão http://127.0.0.1:5173; meça contra um Vite sem HMR ou o site publicado)
// --sala        servidor de salas (?mp=); sem ele, o padrão do jogo (no site publicado, o Durable Object)
// --sala-local  sobe web/server/dev.ts nesta porta e usa ele
// --atraso      põe um proxy na frente da sala que segura cada quadro MS ms em cada sentido (simula a sala longe)
// --p2p         repassa ?p2p= às páginas (0 = sem canal direto; falha = o canal nunca conecta)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || '1'];
  }),
);
const origin = args.origem ?? 'http://127.0.0.1:5173';
const seconds = Number(args.segundos ?? 20);
const out = args.saida ?? 'test-results/latencia';
mkdirSync(out, { recursive: true });
const cleanups = [];

// ------------------------------------------------------------------ sala (local, com atraso)
let mp = args.sala ?? null;
if (args['sala-local']) {
  const port = Number(args['sala-local']);
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const hub = spawn(process.execPath, ['server/dev.ts'], { cwd, env: { ...process.env, PORT: String(port), MP_LOG: '0' }, stdio: 'pipe' });
  hub.stderr.on('data', (d) => process.stdout.write(`[sala!] ${d}`));
  cleanups.push(() => hub.kill());
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
    } catch {
      /* subindo */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  mp = `ws://127.0.0.1:${port}/ws`;
}
if (args.atraso) {
  if (!mp) throw new Error('--atraso precisa de --sala ou --sala-local');
  const delay = Number(args.atraso);
  const upstream = mp;
  const http = createServer((_q, res) => res.end('proxy'));
  const wss = new WebSocketServer({ server: http });
  // Cada quadro sai `delay` ms depois de chegar, na ordem (como um cabo longo: TCP, sem perda).
  wss.on('connection', (client) => {
    const up = new WebSocket(upstream);
    const pending = [];
    up.on('open', () => pending.splice(0).forEach((m) => up.send(m)));
    client.on('message', (m, bin) => {
      const text = bin ? m : m.toString();
      setTimeout(() => (up.readyState === 1 ? up.send(text) : pending.push(text)), delay);
    });
    up.on('message', (m, bin) => {
      const text = bin ? m : m.toString();
      setTimeout(() => client.readyState === 1 && client.send(text), delay);
    });
    client.on('close', () => setTimeout(() => up.close(), delay));
    up.on('close', () => setTimeout(() => client.close(), delay));
    up.on('error', () => client.close());
  });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  cleanups.push(() => http.close());
  mp = `ws://127.0.0.1:${http.address().port}/ws`;
}

// ------------------------------------------------------------------ navegador
const root = join(homedir(), 'AppData', 'Local', 'ms-playwright');
const dir = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop() : null;
const exe = process.env.PW_CHROMIUM_PATH ?? (dir ? join(root, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'] });
cleanups.push(() => browser.close());

/** Anota a chegada de cada 'st' (o NetClient e o canal direto fazem JSON.parse do quadro). */
const hook = () => {
  const log = [];
  window.__lat = log;
  const parse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const v = parse.call(this, text, reviver);
    if (v && v.t === 'st' && v.d && v.d.s && typeof v.d.s.t === 'number' && log.length < 20000) {
      // Caminho: o quadro do canal direto é lido dentro do PeerLink (no Vite de desenvolvimento o nome aparece na pilha).
      log.push([performance.now(), v.d.s.t, /PeerLink/.test(new Error().stack ?? '') ? 'direto' : 'sala']);
    }
    return v;
  };
};

const q = (extra) => {
  const p = new URLSearchParams(extra);
  if (mp) p.set('mp', mp);
  if (args.p2p !== undefined) p.set('p2p', args.p2p);
  return `${origin}/?${p}`;
};

const errors = [];
const ctxA = await browser.newContext({ viewport: { width: 960, height: 540 } });
const ctxB = await browser.newContext({ viewport: { width: 960, height: 540 } });
const a = await ctxA.newPage();
const b = await ctxB.newPage();
for (const [name, page] of [['A', a], ['B', b]]) {
  await page.addInitScript(hook);
  page.on('pageerror', (e) => errors.push(`${name}: ${String(e)}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
}
const online = (page) => page.evaluate(() => window.__garrafao?.online?.() ?? null);
async function waitOnline(page, test, timeout) {
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    last = await online(page);
    if (last && test(last)) return last;
    await page.waitForTimeout(150);
  }
  throw new Error(`estado online não chegou: ${JSON.stringify(last)}`);
}

console.log(`jogo ${origin}  sala ${mp ?? '(padrão do jogo)'}${args.atraso ? `  (+${args.atraso} ms por sentido)` : ''}`);
await a.goto(q({ menu: '1', nome: 'Ana' }));
await a.locator('.mn .mm-item[data-mode="online"]').click({ timeout: 120_000 });
await a.locator('.ol-item', { hasText: 'Criar sala' }).click({ timeout: 30_000 });
const code = (await a.locator('.ol-code b').innerText({ timeout: 30_000 })).trim();
await b.goto(q({ sala: code, nome: 'Bia' }));
await b.locator('.ol-slot.me').waitFor({ timeout: 120_000 });
await a.locator('.ol-item', { hasText: /^Pronto/ }).click();
await b.locator('.ol-item', { hasText: /^Pronto/ }).click();
await waitOnline(a, (o) => o.phase === 'live', 60_000);
await waitOnline(b, (o) => o.phase === 'live', 60_000);
console.log(`sala ${code}: partida valendo, medindo ${seconds} s`);

/** Relógio da aba (timeOrigin + now, ms) menos o do Node, pela amostra de menor ida e volta. */
async function clockOffset(page) {
  let best = null;
  for (let i = 0; i < 15; i++) {
    const t0 = Date.now();
    const p = await page.evaluate(() => performance.timeOrigin + performance.now());
    const t1 = Date.now();
    if (!best || t1 - t0 < best.rtt) best = { rtt: t1 - t0, off: p - (t0 + t1) / 2 };
  }
  return best;
}

// Os dois andam de um lado para o outro (o atacante dribla), para o estado mudar o tempo todo.
for (const page of [a, b]) await page.evaluate(() => (window.__lat.length = 0));
const samples = { A: [], B: [] };
const t0 = Date.now();
let flip = false;
while (Date.now() - t0 < seconds * 1000) {
  flip = !flip;
  for (const page of [a, b]) {
    await page.keyboard.up(flip ? 'KeyA' : 'KeyD');
    await page.keyboard.down(flip ? 'KeyD' : 'KeyA');
  }
  for (let k = 0; k < 2; k++) {
    await a.waitForTimeout(500);
    for (const [name, page] of [['A', a], ['B', b]]) {
      const o = await online(page);
      if (o) samples[name].push({ rtt: o.rtt, delayMs: o.remoteStats?.delayMs ?? null, link: o.link ?? null, phase: o.phase });
    }
  }
}
for (const page of [a, b]) for (const k of ['KeyA', 'KeyD']) await page.keyboard.up(k);

const offA = await clockOffset(a);
const offB = await clockOffset(b);
const origins = { A: await a.evaluate(() => performance.timeOrigin), B: await b.evaluate(() => performance.timeOrigin) };
const lat = { A: await a.evaluate(() => window.__lat), B: await b.evaluate(() => window.__lat) };

const stat = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  if (s.length === 0) return null;
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const r = (x) => Math.round(x * 10) / 10;
  return { n: s.length, min: r(s[0]), p10: r(at(0.1)), med: r(at(0.5)), p90: r(at(0.9)), max: r(s[s.length - 1]) };
};

const report = { origin, mp, atraso: Number(args.atraso ?? 0), p2p: args.p2p ?? null, seconds, room: code, clock: { A: offA, B: offB } };
for (const [me, other] of [['A', 'B'], ['B', 'A']]) {
  const offMe = me === 'A' ? offA.off : offB.off;
  const offOther = other === 'A' ? offA.off : offB.off;
  // Chegada (relógio da aba que recebe → Node) menos envio (relógio de quem mandou: performance.now/1000 dele → Node).
  const rows = lat[me].map(([recv, t, via]) => ({
    at: recv,
    ms: origins[me] + recv - offMe - (origins[other] + t * 1000 - offOther),
    via,
  }));
  // Atraso do boneco: o relógio dele usa a MENOR rede dos últimos 3 s e soma o buffer.
  const minWin = rows.map((r) => Math.min(...rows.filter((x) => x.at <= r.at && x.at > r.at - 3000).map((x) => x.ms)));
  const delays = samples[me].map((s) => s.delayMs).filter((x) => x !== null);
  const buf = stat(delays);
  const byVia = {};
  for (const r of rows) (byVia[r.via] ??= []).push(r.ms);
  report[`${other}→${me}`] = {
    redeMs: stat(rows.map((r) => r.ms)),
    porCaminho: Object.fromEntries(Object.entries(byVia).map(([k, v]) => [k, stat(v)])),
    bufferMs: buf,
    bonecoMs: buf && minWin.length ? Math.round(stat(minWin).med + buf.med) : null,
    pingSalaMs: stat(samples[me].map((s) => s.rtt)),
    link: samples[me].at(-1)?.link ?? null,
  };
}
report.errors = errors.filter((e) => !/favicon/.test(e));
writeFileSync(join(out, `latencia-${Date.now()}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
for (const c of cleanups.reverse()) await c();
process.exit(0);
