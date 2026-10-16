// Build de publicação (npm run build:deploy): igual ao `vite build`, mas sem copiar public/assets/models_raw.
// Os modelos brutos do HY 3D (2,9 GB, fora do git) moram em public/ só para as ferramentas; o jogo não os carrega, e
// com eles o dist passa de 25 MB por arquivo e de qualquer limite de hospedagem.
import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config.ts';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));
const Skip = /[\\/]models_raw([\\/]|$)/;

export default mergeConfig(
  base,
  defineConfig({
    publicDir: false,
    plugins: [
      {
        name: 'public-sem-modelos-brutos',
        apply: 'build',
        writeBundle(options) {
          cpSync(publicDir, options.dir ?? 'dist', { recursive: true, filter: (src) => !Skip.test(src) });
        },
      },
    ],
  }),
);
