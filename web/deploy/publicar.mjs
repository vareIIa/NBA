// Publica o jogo nos dois endereços de uma vez (docs/24 §4.1): Cloudflare (jogo + sala) e Vercel (jogo).
// O site e a sala precisam sair do MESMO build: uma sala nova com um site velho (ou o contrário) recusa o jogador
// ("versão 1 do jogo, servidor na 2"), e foi isso que derrubou o online por alguns minutos em 2026-10-16.
//
//   npm run publicar                  testa e publica o ÚLTIMO COMMIT nos dois
//   npm run publicar -- --pasta       publica a pasta web/ como está, com o que não foi commitado (só emergência)
//   npm run publicar -- --sem-vercel  só o Cloudflare
//   npm run publicar -- --sem-e2e     pula o teste de dois navegadores (só emergência)
//
// Com várias sessões editando web/ ao mesmo tempo, o build da pasta pegava edição pela metade de outra sessão. Por isso
// o padrão é uma cópia separada do commit (git worktree, com os arquivos do LFS de verdade), fora do repositório: o que
// vai para o ar é exatamente o commit, e ninguém precisa parar de editar. A cópia recebe só os assets locais que ficam
// fora do git de propósito (public/assets/mocap: Mixamo e pose de terceiros, docs/24 §4.1).
//
// Ordem: cópia do commit → tsc → vitest → teste online com dois navegadores (Vite e sala em portas livres) → build →
// Cloudflare → Vercel com o mesmo dist → apaga a cópia. Qualquer falha para tudo antes de publicar.
import { execSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const repo = join(web, '..');
const flags = new Set(process.argv.slice(2));
const fromFolder = flags.has('--pasta') || flags.has('--com-alteracoes');
const Wrangler = 'npx --yes wrangler@4.147.0';
const Vercel = 'npx --yes vercel@latest deploy dist --prod --yes --scope vareiias-projects --project garrafao';
/** Assets que o jogo usa e ficam fora do git de propósito: vão da pasta para a cópia. */
const LocalOnlyAssets = ['public/assets/mocap'];

const sh = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
const out = (cmd, cwd = web) => execSync(cmd, { cwd }).toString().trim();
const step = (text) => console.log(`\n=== ${text}`);

/**
 * Porta livre. Uma porta ocupada pelo servidor de outra sessão faria o teste rodar contra o jogo (ou a sala) dela: o
 * "subiu?" responderia do servidor errado.
 */
async function freePort(from, to) {
  for (let port = from; port <= to; port++) {
    const ok = await new Promise((resolve) => {
      const probe = createServer().once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  throw new Error(`nenhuma porta livre entre ${from} e ${to}`);
}

function killTree(child) {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // já saiu
    }
  } else child.kill();
}

// ---------------------------------------------------------------- 1. o que vai para o ar

const commit = out('git rev-parse --short HEAD');
const pending = out('git status --porcelain -- src server deploy index.html public .env.production e2e package.json')
  .split('\n')
  .filter((l) => l && !l.includes('models_raw'));
if (pending.length > 0) {
  console.log(`Em web/ há ${pending.length} arquivo(s) diferentes do commit ${commit}:`);
  for (const l of pending.slice(0, 30)) console.log(`  ${l}`);
  if (pending.length > 30) console.log(`  … e mais ${pending.length - 30}`);
  console.log(fromFolder ? '--pasta: eles VÃO para o ar junto.' : 'Eles NÃO vão para o ar: publica-se o commit, numa cópia separada.');
}

let root = web; // pasta web/ de onde sai o build
let worktree = null;
let linkedModules = null;

function cleanup() {
  if (!worktree) return;
  // Primeiro tira o atalho do node_modules (apagar a cópia não pode entrar nele e apagar o node_modules de verdade).
  if (linkedModules && existsSync(linkedModules)) unlinkSync(linkedModules);
  try {
    execSync(`git worktree remove --force "${worktree}"`, { cwd: repo, stdio: 'ignore' });
  } catch {
    rmSync(worktree, { recursive: true, force: true });
    execSync('git worktree prune', { cwd: repo, stdio: 'ignore' });
  }
  worktree = null;
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

if (!fromFolder) {
  step(`cópia separada do commit ${commit}`);
  // Caminho longo de verdade (o Temp do Windows vem como ADMINI~1, que atrapalha ferramentas como o wrangler).
  const base = join(realpathSync.native(tmpdir()), 'garrafao-publicar');
  mkdirSync(base, { recursive: true });
  worktree = join(base, commit);
  if (existsSync(worktree)) {
    try {
      execSync(`git worktree remove --force "${worktree}"`, { cwd: repo, stdio: 'ignore' });
    } catch {
      rmSync(worktree, { recursive: true, force: true });
    }
  }
  execSync('git worktree prune', { cwd: repo, stdio: 'ignore' });
  sh(`git worktree add --detach "${worktree}" ${commit}`, repo);
  root = join(worktree, 'web');
  // Os arquivos do LFS precisam ter vindo de verdade (um ponteiro de 130 bytes no lugar do .glb quebraria o jogo).
  const glb = join(root, 'public', 'assets', 'hoops_player.glb');
  if (!existsSync(glb) || statSync(glb).size < 100_000) throw new Error('a cópia veio sem os arquivos do Git LFS (rode git lfs install)');
  linkedModules = join(root, 'node_modules');
  symlinkSync(join(web, 'node_modules'), linkedModules, 'junction');
  for (const rel of LocalOnlyAssets) {
    const from = join(web, rel);
    if (existsSync(from)) {
      cpSync(from, join(root, rel), { recursive: true });
      console.log(`  + ${rel} (${readdirSync(from).length} arquivo(s) locais, fora do git)`);
    }
  }
}

// ---------------------------------------------------------------- 2. testes

step('typecheck');
sh('npx tsc --noEmit', root);
step('testes de unidade');
sh('npx vitest run', root);

if (!flags.has('--sem-e2e')) {
  const vitePort = await freePort(5182, 5199);
  const hubPort = await freePort(8791, 8799);
  step(`teste online com dois navegadores (Vite na ${vitePort}, sala na ${hubPort})`);
  const vite = spawn('npx', ['vite', '--config', 'deploy/vite.teste.config.ts'], {
    cwd: root,
    shell: true,
    stdio: 'ignore',
    env: { ...process.env, PUBLICAR_PORT: String(vitePort) },
  });
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await new Promise((r) => setTimeout(r, 500));
      up = await fetch(`http://127.0.0.1:${vitePort}/`).then((r) => r.ok, () => false);
    }
    if (!up) throw new Error('o Vite do teste não subiu');
    sh('npx playwright test e2e/online.spec.ts', root, { E2E_ORIGIN: `http://127.0.0.1:${vitePort}`, E2E_HUB_PORT: String(hubPort) });
  } finally {
    killTree(vite);
  }
}

// ---------------------------------------------------------------- 3. um build só, para os dois endereços

step('build de publicação');
sh('npx vite build --config deploy/vite.config.ts', root);

step('Cloudflare (jogo + sala)');
sh(`${Wrangler} deploy --config deploy/wrangler.jsonc`, root);

if (!flags.has('--sem-vercel')) {
  step('Vercel (o mesmo dist)');
  sh(Vercel, root);
}

console.log(`\nPublicado: commit ${commit}${fromFolder && pending.length ? ` + ${pending.length} arquivo(s) não commitado(s) da pasta` : ''}.`);
console.log('  https://garrafao.garrafao-web.workers.dev');
if (!flags.has('--sem-vercel')) console.log('  https://garrafao.vercel.app');
