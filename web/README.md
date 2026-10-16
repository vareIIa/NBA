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
(toque = flick; duas setas juntas = diagonal), **E = spin**, **R = half spin** (giram o stick virtual), Q drible baixo,
Espaço arremessa.

Dribles pelo Pro Stick (bola na direita; com a esquerda é o espelho): cima = crossover (com RT = crossover de ataque),
esquerda = entre as pernas, **baixo-esquerda = behind the back**, direita = hesitação, **baixo = step-back**,
giro = spin, meio giro = half spin, toques rápidos = double cross / hesi-cross.

**Dribles de transição pelo LS** (sem o Pro Stick, como no jogo de referência): correndo para o lado da mão livre, o
jogador troca a bola de mão sozinho (crossover; entre as pernas quando está devagar); puxando o LS para trás, sai num
retreat (step-back curto).

Inspeção: `?lento=0.25` deixa o jogo em câmera lenta (não arremesse nela: o timing usa o relógio real).

Inspeção da animação: `?cam=lado` ou `?cam=frente` na URL troca para uma câmera perto do jogador.

## Testes

```bash
npm test           # vitest: 33 testes do núcleo C++ + 1 de paridade do RNG + 16 da animação (clipes, fase, IK, procedurais)
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
- **Drible de jogador bom** (dados medidos, Hirata et al., ISBS 2011): o IK do braço da bola leva a recepção para
  40% da altura e a soltura para 32,5% (o mocap da CMU, amador, recebia a ~58%), com a bola por fora e à frente do pé.
- **Quique físico**: a divisão descida/subida sai da restituição da madeira (a bola sai do chão com 78% da velocidade
  de chegada), com achatamento no impacto e som sintetizado (porte de `HoopsAudioSynth.cpp` para WebAudio).
- **Procedurais** (`src/anim/ProceduralMoves.ts`), para o que a CMU não tem: behind the back (a mão leva a bola por
  fora e por trás do quadril, quique atrás do outro calcanhar, a outra mão recebe), step-back (pé de trás e pé da
  frente em passos presos no chão, saltinho, bola puxada com um quique forte à frente) e half spin (giro de ~150°
  que volta). Dribles que começam com a bola no ar trazem a bola para a mão na hora.
- **Corte acelerando** (Hashizume et al., ISBS 2014): o impulso dos dribles laterais cresce e se mantém, somado ao
  embalo para a frente; o step-back joga o impulso no meio (o salto).
- **Sem a bola** o boneco usa parado/andando/correndo sem drible. Parado, `src/anim/IdleLife.ts` solta os braços e de
  tempos em tempos faz um gesto (mãos na cintura, palmas, alongar o braço...); `animator.playIdleGesture(nome)` dispara um
  pelo nome no laboratório.
- **Braço nunca atravessa o tronco nem a roupa** (`src/anim/ArmClearance.ts`, último passo dos braços): tronco,
  quadril e coxas (estas só sem bola) viram cilindros de seção elíptica medidos na regata e na bermuda vestidas. Cotovelo
  dentro gira o braço no ombro; antebraço, punho ou mão dentro giram o antebraço no cotovelo. A saída é suave na
  distância e no tempo (60 ms). Fica livre só a mão da bola no behind the back, que segue o caminho desenhado por trás
  do quadril. A métrica `braço-corpo` do laboratório mede o que sobra.
- **Retarget do Mixamo** (`src/mocap/Retarget.ts`): desconta a inclinação de repouso do pescoço do mixamorig (22° no
  IdleStand; o nosso, 4°), senão a cabeça ficava ~18° baixa em todo clipe. Nas pernas do Mixamo (`applyMixamoLegs`) a
  pelve fica com a inclinação para a frente do clipe da CMU (a do Mixamo vem do tronco inteiro e empinava a bunda), girando
  em volta das articulações do quadril (as pernas não mudam), e o
  sobe-e-desce do quadril cai a 40% (13,6 → ~8,5 cm no sprint). Chaves de comparação no animador:
  `armClearanceEnabled`, `mixamoPelvisPitchFix` e `mixamoBounceKeep` (1 = clipe inteiro).
- O teste `npm run e2e` mede a bola no drible: nunca abaixo do raio, nunca a mais de 1,3 m do jogador, e conta os
  quiques e as trocas de mão.
