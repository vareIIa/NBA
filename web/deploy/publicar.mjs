// Publica o jogo nos dois endereços de uma vez (docs/24 §4): Cloudflare (jogo + sala) e Vercel (jogo).
// O site e a sala precisam sair do MESMO build: uma sala nova com um site velho (ou o contrário) recusa o jogador
// ("versão 1 do jogo, servidor na 2"), e foi isso que derrubou o online por alguns minutos em 2026-10-16.
//
//   npm run publicar                      testa e publica nos dois
//   npm run publicar -- --com-alteracoes  publica mesmo com código não commitado em web/ (a lista aparece antes)
//   npm run publicar -- --sem-vercel      só o Cloudflare
//   npm run publicar -- --sem-e2e         pula o teste de dois navegadores (só para emergência)
//
// Ordem: trava de código não commitado → tsc → vitest → teste online com dois navegadores → build → Cloudflare →
// Vercel com o mesmo dist. Qualquer falha para tudo antes de publicar.
import { execSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const flags = new Set(process.argv.slice(2));
/**
 * Porta livre para o Vite do teste. Uma porta ocupada pelo servidor de outra sessão faria o teste rodar contra o jogo
 * dela (o fetch de "subiu?" responderia do servidor errado).
 */
async function freePort(from = 5182, to = 5199) {
  for (let port = from; port <= to; port++) {
    const ok = await new Promise((resolve) => {
      const probe = createServer().once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  throw new Error(`nenhuma porta livre entre ${from} e ${to}`);
}
const Wrangler = 'npx --yes wrangler@4.147.0';
const Vercel = 'npx --yes vercel@latest deploy dist --prod --yes --scope vareiias-projects --project garrafao';

const run = (cmd, env = {}) => execSync(cmd, { cwd: web, stdio: 'inherit', env: { ...process.env, ...env } });
const out = (cmd) => execSync(cmd, { cwd: web }).toString().trim();
const step = (text) => console.log(`\n=== ${text}`);

// 1. O que vai para o ar e não está no git (o build pega a pasta como ela está, inclusive trabalho de outras sessões).
const commit = out('git rev-parse --short HEAD');
const pending = out('git status --porcelain -- src server deploy index.html public .env.production')
  .split('\n')
  .filter((l) => l && !l.includes('models_raw'));
if (pending.length > 0) {
  console.log(`Código e arquivos em web/ diferentes do commit ${commit} (${pending.length}):`);
  for (const l of pending.slice(0, 40)) console.log(`  ${l}`);
  if (pending.length > 40) console.log(`  … e mais ${pending.length - 40}`);
  if (!flags.has('--com-alteracoes')) {
    console.log('\nNada foi publicado. Commite o que deve ir para o ar, ou rode com --com-alteracoes para publicar a pasta como está.');
    process.exit(1);
  }
}

// 2. Testes.
step('typecheck');
run('npx tsc --noEmit');
step('testes de unidade');
run('npx vitest run');

if (!flags.has('--sem-e2e')) {
  const E2EPort = await freePort();
  step(`teste online com dois navegadores (Vite próprio na porta ${E2EPort})`);
  const vite = spawn('npx', ['vite', '--config', 'deploy/vite.teste.config.ts'], {
    cwd: web,
    shell: true,
    stdio: 'ignore',
    env: { ...process.env, PUBLICAR_PORT: String(E2EPort) },
  });
  const stop = () => {
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        // já saiu
      }
    } else vite.kill();
  };
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await new Promise((r) => setTimeout(r, 500));
      up = await fetch(`http://127.0.0.1:${E2EPort}/`).then((r) => r.ok, () => false);
    }
    if (!up) throw new Error('o Vite do teste não subiu');
    run('npx playwright test e2e/online.spec.ts', { E2E_ORIGIN: `http://127.0.0.1:${E2EPort}` });
  } finally {
    stop();
  }
}

// 3. Um build só, para os dois endereços.
step('build de publicação');
run('npx vite build --config deploy/vite.config.ts');

step('Cloudflare (jogo + sala)');
run(`${Wrangler} deploy --config deploy/wrangler.jsonc`);

if (!flags.has('--sem-vercel')) {
  step('Vercel (o mesmo dist)');
  run(Vercel);
}

console.log(`\nPublicado: commit ${commit}${pending.length ? ` + ${pending.length} arquivo(s) não commitado(s)` : ''}.`);
console.log('  https://garrafao.garrafao-web.workers.dev');
if (!flags.has('--sem-vercel')) console.log('  https://garrafao.vercel.app');
