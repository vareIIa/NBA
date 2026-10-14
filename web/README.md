# Garrafão — versão three.js (D15)

Jogo em TypeScript + Vite + three.js. O núcleo de simulação (`src/sim/`) é o porte arquivo por arquivo de
`Plugins/HoopsSim` (C++), com os mesmos nomes e números.

## Rodar

```bash
cd web
npm install
npm run dev        # abre em http://localhost:5173
```

Controles (mapa do jogo de referência): controle de Xbox — LS move, RT sprint, **RS = Pro Stick** (dribles),
LT drible baixo, X arremessa (segure e solte no topo). Teclado — WASD move, Shift sprint, **setas = Pro Stick**
(toque = flick), **E = spin** (gira o stick virtual), Q drible baixo, Espaço arremessa.

Dribles pelo Pro Stick (bola na direita; com a esquerda é o espelho): cima = crossover (com RT = crossover de ataque),
esquerda = entre as pernas, direita = hesitação, giro = spin, toques rápidos = double cross / hesi-cross.

Inspeção da animação: `?cam=lado` ou `?cam=frente` na URL troca para uma câmera perto do jogador.

## Testes

```bash
npm test           # vitest: 33 testes do núcleo C++ + 1 de paridade do RNG + 11 da animação (clipes, fase, IK)
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
| `src/anim/` | Animação do jogador: `PlayerAnimator` (camadas sobre o `AnimationMixer`, postura com IK), `ClipLibrary` (dados dos clipes, fase do drible, quadros-chave), `TwoBoneIK`. |
| `src/game/` | Quadra, cesta (gerada do `HoopSpec`), bola, `BallDribbler` (bola presa à mão animada), câmera, entrada (Gamepad API + teclado) e o Freestyle. |
| `public/assets/` | `hoops_player.glb` (personagem + 38 clipes) e `hoops_player.clips.json` (análise dos clipes), gerados por `Tools/Animacao/exportar_glb.py`. |
| `tools/` | `capturar.mjs` (sequência de prints com roteiro de teclas) e `sonda.mjs` (avalia uma expressão na página): depuração visual. |
| `src/hud/` | HUD em HTML/CSS: medidor, banner de timing/cobertura, energia, placar do treino. |
| `e2e/` | Teste visual do Playwright e o gravador de vídeo (screencast do Chromium → ffmpeg). |

## Decisões desta etapa

- **Timing do arremesso pelo relógio real.** O tempo de segurar o X vem do `timeStamp` do evento de tecla
  (no controle, do quadro em que a Gamepad API mudou), não da soma dos `dt`. Com FPS baixo, a soma limitada
  atrasava o relógio e um toque de 560 ms virava 800 ms ("muito tarde").
- **Física em passo fixo de 120 Hz** (acumulador), igual ao C++; o resto do jogo usa o `dt` do quadro.

## Como a animação funciona (passo 3)

- **Base de locomoção**: loops de drible (parado, baixo, andando, correndo, de costas, de lado) escolhidos pela
  velocidade no referencial do jogador, com crossfade de 0,22 s e **fase casada**: o empurrão do clipe novo cai onde
  estava o do antigo, então trocar de andar para correr não quebra o ritmo da bola. A velocidade de reprodução segue a
  velocidade real (passada casada, sem pé deslizando).
- **Ações** por cima: crossover, crossover de ataque, spin (a malha gira 360° pela curva medida no mocap), entre as
  pernas, hesitação e arremesso. O núcleo (`DribbleController`) decide QUAL drible e QUANDO (commit, buffer, combo,
  misdirection, energia); o clipe é esticado para a duração do núcleo.
- **Bola**: solta no vale da palma (empurrão) ou no quadro de soltura do drible, quica pelo `DribbleArc` do núcleo
  no referencial do jogador e chega na palma prevista no quadro de recepção, com um "ímã" no fim para a palma real.
- **Postura**: quadril mais baixo (13 cm parado) com IK nas duas pernas (pés presos onde o clipe os pôs), base mais
  larga parada, tronco inclinado 15° para a frente e inclinação extra na aceleração.
- O teste `npm run e2e` mede a bola no drible: nunca abaixo do raio, nunca a mais de 1,3 m do jogador, e conta os
  quiques e as trocas de mão.
