# Garrafão — versão three.js (D15)

Jogo em TypeScript + Vite + three.js. O núcleo de simulação (`src/sim/`) é o porte arquivo por arquivo de
`Plugins/HoopsSim` (C++), com os mesmos nomes e números.

## Rodar

```bash
cd web
npm install
npm run dev        # abre em http://localhost:5173
```

Controles: controle de Xbox (LS move, RT sprint, X arremessa: segure e solte no topo) ou teclado
(WASD move, Shift sprint, Espaço arremessa).

## Testes

```bash
npm test           # vitest: os 33 testes do núcleo C++ portados + 1 de paridade do RNG
npm run typecheck  # tsc
npm run e2e        # Playwright: abre o jogo headless, joga sozinho, tira prints e grava vídeo
npm run build      # gera web/dist
```

O `npm run e2e` salva os prints e o vídeo em `test-results/entrega/` (`01-quadra.png` … `09-placar.png` e
`freestyle.webm`). Ele nunca baixa navegador nem ffmpeg: usa o Chromium e o ffmpeg que já estiverem instalados
(`~/AppData/Local/ms-playwright`, `~/.cache/ms-playwright` ou `/opt/pw-browsers`). Para forçar outro, defina
`PW_CHROMIUM_PATH` e/ou `PW_FFMPEG_PATH`. No Windows o teste usa a GPU (D3D11, 60 FPS); sem GPU, o SwiftShader
(~20 FPS).

## Estrutura

| Pasta | O que tem |
|---|---|
| `src/sim/` | Núcleo puro (sem three.js nem DOM): física da bola/aro/tabela a 120 Hz, modelo de arremesso/green, solucionador, contestação, Pro Stick, dribles + energia. SI, **Z para cima**, eixos da Unreal (mão esquerda: direita = up × frente). |
| `src/units.ts` | Única conversão núcleo → three.js: `(x, y, z)` → `(x, z, y)`. Velocidade angular troca de sinal (vetor axial num espelhamento). |
| `src/game/` | Quadra, cesta (gerada do `HoopSpec`), bola, jogador provisório, câmera do jogo de referência, entrada (Gamepad API + teclado) e o Freestyle. |
| `src/hud/` | HUD em HTML/CSS: medidor, banner de timing/cobertura, energia, placar do treino. |
| `e2e/` | Teste visual do Playwright e o gravador de vídeo (screencast do Chromium → ffmpeg). |

## Decisões desta etapa

- **Timing do arremesso pelo relógio real.** O tempo de segurar o X vem do `timeStamp` do evento de tecla
  (no controle, do quadro em que a Gamepad API mudou), não da soma dos `dt`. Com FPS baixo, a soma limitada
  atrasava o relógio e um toque de 560 ms virava 800 ms ("muito tarde").
- **Física em passo fixo de 120 Hz** (acumulador), igual ao C++; o resto do jogo usa o `dt` do quadro.
- O jogador ainda é um boneco de cápsulas; o GLB com os 38 clipes é o passo 3 do `docs/dev/HANDOFF-THREEJS.md`.
