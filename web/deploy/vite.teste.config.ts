// Vite para o teste online antes de publicar (deploy/publicar.mjs): o mesmo do jogo, sem HMR (outras sessões salvando
// arquivos não recarregam a página no meio do teste) e numa porta própria.
import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config.ts';

// A porta vem do publicar.mjs (a primeira livre a partir da 5182).
const port = Number(process.env.PUBLICAR_PORT ?? 5182);

export default mergeConfig(base, defineConfig({ server: { port, strictPort: true, hmr: false, host: '127.0.0.1' } }));
