// Vite próprio para medir (docs/27 §5, Fase 1): sem HMR e sem vigiar arquivos, noutra porta (nunca a 5173 do diretor) e
// com cache próprio. Várias sessões salvam arquivos em web/ ao mesmo tempo; com HMR a página recarregava no meio do
// cenário e a medida misturava versões do código.
//
//   node tools/feel/vite-proprio.mjs [porta=5191]      (fica no ar até Ctrl+C; o lab usa LAB_ORIGIN=http://127.0.0.1:5191)
//
// regua.mjs importa startViteProprio() e derruba o servidor no fim.
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const webDir = resolve(here, '..', '..');
export const repoDir = resolve(webDir, '..');

/** Sobe o Vite (root = web/) e devolve { origin, close }. */
export async function startViteProprio(port = 5191) {
  if (Number(port) === 5173) throw new Error('a porta 5173 é do diretor (npm run dev): use outra');
  const { createServer } = await import('vite');
  const cacheDir = join(repoDir, 'Saved', 'feel', '.vite-cache');
  mkdirSync(cacheDir, { recursive: true });
  const server = await createServer({
    root: webDir,
    configFile: false,
    logLevel: 'warn',
    cacheDir,
    server: { host: '127.0.0.1', port: Number(port), strictPort: true, hmr: false, watch: null },
  });
  await server.listen();
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { origin } = await startViteProprio(process.argv[2] ?? 5191);
  console.log(`Vite próprio (sem HMR) em ${origin} — LAB_ORIGIN=${origin}`);
}
