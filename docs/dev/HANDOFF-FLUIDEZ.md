# Handoff: fluidez e realismo do drible (three.js)

> Escrito em 2026-10-14, no fim da sessão "Garrafão: Unreal para three.js" [86eba1].
> Branch `claude/hopeful-einstein-eargc1`, último commit desta sessão: `ed48e95`.
> Ler antes: `web/README.md` (como rodar e a arquitetura) e `docs/dev/HANDOFF-THREEJS.md` (a migração D15).

## 1. O objetivo e onde estamos

O diretor quer a fluidez do NBA 2K23 com a física e a mecânica do basquete real. Ele testa com o controle de Xbox.

**Estamos longe disso.** O feedback dele no fim desta sessão:

- O jogo está "travado, stiff, rough".
- Pernas atravessam uma a outra.
- Correndo, quando ele puxa um drible, as duas pernas param e se movem em direções sem sentido.
- O pé entra no chão.
- A bola atravessa coisas.
- O size-up não parece size-up.

**Do que ele gostou:**

- A troca de mão automática pelo LS, quando ele corre para o lado da mão livre ("até que legal").
- O step-back e o crossover de ataque ("interessante").

**Pedido central dele:** quem trabalhar nisso precisa conseguir **ver e testar ponto a ponto**, comparando com o drible **real**, e não implementar "o que acha que é". Para isso esta sessão deixou um laboratório, métricas e vídeos de referência (seção 3).

## 2. Como a animação funciona hoje

Os detalhes estão no `web/README.md`, em "Como a animação funciona".

### Personagem

- `Tools/Animacao/exportar_glb.py` transforma o FBX da CMU (38 clipes) em `web/public/assets/hoops_player.glb`.
- A malha é contínua (Skin modifier) e os pesos são automáticos.
- O script grava também `hoops_player.clips.json`: as palmas quadro a quadro, os vales (soltura) e os picos (recepção).

### `src/anim/PlayerAnimator.ts`

- **Base de locomoção:**
  - loops de drible escolhidos pela velocidade, com fase do quique casada entre loops;
  - sem bola: Hold_Idle, Walk e Run.
- **Ação por cima:**
  - dribles de mocap: Cross, EscapeCross, Spin, HalfSpin, BetweenLegs, Hesitation;
  - procedurais: BehindBack, StepBack;
  - arremesso.
- **Transições:** inertialization (dead blending, `Inertialization.ts`). Pesos binários: só um clipe toca por vez.
- **Pós-processo, nesta ordem:**
  1. quadril abaixado;
  2. base larga;
  3. **base plantada** no size-up parado;
  4. **trava de pé** na locomoção;
  5. IK das pernas (`TwoBoneIK.ts`);
  6. inclinação do tronco;
  7. drible baixo (IK do braço da bola para 40%/32,5% da altura, Hirata et al., ISBS 2011);
  8. braços dos procedurais.

### Outros arquivos

- **`src/anim/ProceduralMoves.ts`:** trajetórias do behind the back e passos do step-back. Os pontos-chave estão no referencial do jogador.
- **`src/game/BallDribbler.ts`:** a bola presa à palma animada. Ela solta no evento do animador e quica pelo `DribbleArc` do núcleo, no referencial do jogador. A divisão descida/subida sai da restituição 0,78. No fim do arco, um "ímã" leva a bola até a palma real.
- **`src/game/Freestyle.ts`:**
  - movimento do jogador (velocidade depende da direção em relação ao corpo);
  - Pro Stick pelo `DribbleController` do núcleo;
  - impulso de cada drible (o corte acelera em vez de frear);
  - troca de mão automática pelo LS e retreat.
- **O núcleo (`src/sim/`) decide QUAL drible e QUANDO** (commit, buffer, combo, misdirection, energia). A animação só executa.

## 3. Ferramentas de teste (use sempre)

Suba o Vite antes: `cd web; npx vite --host 127.0.0.1`. **Desligue depois**, porque a porta 5173 é `strictPort` e o diretor usa `npm run dev`.

| Ferramenta | Para quê |
|---|---|
| `node tools/laboratorio.mjs <saída> [cenários] [cada=4]` | Abre `?lab=1` e roda cenários quadro a quadro. Salva PNGs com 4 câmeras (trás, lado, frente, cima): rastro da bola (laranja), palmas (azul = esquerda, rosa = direita) e marcas dos pés apoiados (**vermelho = pé deslizando**). Grava `metricas.json` e `resumo.json`. São 19 cenários (lista em `Cenarios` no arquivo). |
| `python tools/comparar.py <vídeo> <t0> <t1> <crop> <pasta_cenario> <vista> <n> <saída> [q0 q1]` | Folha comparativa: **drible real em cima x nosso embaixo**, no mesmo número de quadros. |
| `node tools/capturar.mjs <saída> <jogo/lado/frente> "<roteiro>" [lento]` | Prints do jogo rodando, com roteiro de teclas. `lento=0.25` é câmera lenta. |
| `node tools/sonda-lab.mjs "<expr>" <quadros> [input-json]` | Avalia uma expressão por quadro no laboratório. Tem acesso a `animator`, `game` e `THREE`. |
| `npm test` / `npm run e2e` | 50 testes no vitest. O e2e do Playwright joga sozinho, mede a bola e grava vídeo em `test-results/entrega/`. |
| URL `?cam=lado` / `?cam=frente` / `?lento=0.25` | Câmeras de inspeção e câmera lenta no jogo normal. |

**Métricas do laboratório** (`src/lab/Lab.ts`):

- `footSlideMax/Mean`: velocidade horizontal da ponta do pé enquanto apoiada; deveria ser ~0.
- `popCount`: quadros com aceleração angular de osso acima de 20.000°/s².
- `ballGapMax`: bola presa longe da palma.

> As métricas ainda **não** medem perna atravessando perna, pé abaixo do chão nem bola atravessando o corpo.
> **O primeiro trabalho é acrescentar essas três**, porque são exatamente as queixas do diretor:
> - distância mínima entre as cápsulas das pernas;
> - altura mínima de sola e tornozelo;
> - bola dentro das cápsulas do corpo.

### Vídeos de referência

**Basquete real**, em `referencias/real/`, fora do git, baixados com autorização do diretor via `yt-dlp`:

| Arquivo | Conteúdo |
|---|---|
| `MUvJacHl12g_Behind The Back Dribble SECRETS...mp4` | Compilação de behind the back da NBA. Demonstração no ginásio em **78–82 s** e **88,5–92 s** (câmera lateral, a melhor). Paige Bueckers em 94–96 s. Off-arm em 102–116 s. |
| `LZSlFyyCkhk_Kyrie Irving ... Slow-Motion.mp4` | Kyrie em câmera lenta, jogo real (4:32). |
| `nS2s_1VyDP8_Luka Doncic Stepback BREAKDOWN...mp4` | Step-back do Luka. |
| `avlY4yO_UAY_Luka Doncic Signature Move Breakdown...mp4` | Movimento assinatura do Luka. |
| `fvXFeCAS3ds_NBA Crossover Drill...mp4` | Tutorial de crossover (curto). |
| `u8jYUDS2eoo_James Harden's SIGNATURE DRIBBLE ... 2K23.mp4` | **2K23:** size-ups e step-backs do Harden (combos em 0:50, step-backs em 3:00). |

Não baixaram: `3ZRL43FYmKs` (entre as pernas em câmera lenta; pede login, não usar cookies do diretor) e `Pz0HP1Ly27c` (removido).

**Kyrie Irving é a referência principal** (pedido do diretor em 2026-10-15: "o OPUS dos dribblers"). Baixados em
2026-10-15, só o vídeo (sem ffmpeg no PATH o áudio veio separado e foi descartado):

| Arquivo | Conteúdo e trechos |
|---|---|
| `GHJRCzlht7k_Kyrie Irving Crazy Handles ｜ SLOWMO.mp4` (68 s, 720x720) | Câmera lenta. **0–5 s**: de branco contra os Warriors, drible baixo de perto. **8–16 s**: de preto contra o Klay, de lado e de perto (crossover baixo, entre as pernas). **33–38 s**: de novo contra o Klay. **42–51 s**: **câmera de cima** (Rockets), a melhor para ver os pés e o pivô. **52–58 s**: de branco contra o Curry. **61–66 s**: contra os Raptors. |
| `NSiPz8Kvuqw_Kyrie's Handles Slicing Through the Spurs in Super Slow-Motion.mp4` (38 s, 720p) | Câmera superlenta, uma posse inteira. **0–4 s**: de frente, drible com a direita. **9–10 s**: drible baixo com a esquerda. **14,4–18 s**: de lado, corpo inteiro, **infiltração muito baixa** (tronco quase horizontal, bola rente ao chão em 15,6–16,2 s): referência para a hesitação e o spin baixos. **18–23 s**: infiltração e bandeja. |
| `Gu0dzNMAq70_Attention to Detail： Kyrie Irving.mp4` (12:45) | Análise (By Any Means Basketball). **0:36–5:54**: Ballhandling (jogos, câmera de transmissão; treino de perto em 2:24, 4:00–4:06 e 4:24; "Momentum" em 5:12–5:20). **5:54–9:18**: arremesso. **9:18–12:42**: finalização ("Overhead" em 9:54; treinos em 11:18–12:24). |

Trechos já usados (comparação lado a lado no laboratório):

| Drible | Vídeo e tempo |
|---|---|
| Crossover em movimento | `LZSlFyyCkhk` 9,0–10,9 s (Kyrie x OKC, de lado) |
| Size-up | `LZSlFyyCkhk` 43,1–48,3 s (Kyrie x Bulls, pés) e Harden no 2K23 (`u8jYUDS2eoo` 47,7–51,0 s) |
| Crossover parado (recepção por fora do joelho) | `fvXFeCAS3ds` 6–8 s |
| Entre as pernas | `LZSlFyyCkhk` 164,0–165,2 s (de costas) |
| Spin | `LZSlFyyCkhk` 86,8–88,3 s |
| Behind the back | `MUvJacHl12g` 88,5–89,4 s (ginásio, de lado) |
| Escape (RT) | GIF de escape moves do 2K24 em game8.co/articles/featured/1048 |

**2K23 do diretor:**

- `referencias/2k23/` (README com a análise).
- Os vídeos do WhatsApp em `C:\Users\Administrator\Downloads\WhatsApp Video 2026-10-03 at 19.51.*.mp4`.

**Dados medidos:**

- **Hirata et al., ISBS 2011:** o jogador bom recebe a bola a 40,3% da altura e solta a 32,5%, com contato de 0,39 s. O amador: 56%, 42% e 0,28 s.
- **Hashizume et al., ISBS 2014:** no crossover em velocidade, o jogador bom acelera durante o corte inteiro.

## 4. Números de hoje (laboratório, 2026-10-14)

| Cenário | Pé desliza máx (m/s) | Média | Estalos |
|---|---|---|---|
| parado | 0,00 | 0,00 | 6–14 |
| baixo_lt | 3,56 | 0,28 | 8 |
| andando | 2,98 | 0,63 | 49 |
| correndo_rt | 4,48 | 0,91 | 64 |
| lado_esquerda / direita | 8,74 / 5,22 | 3,11 / 1,20 | 37 / 15 |
| de_costas | 6,10 | 1,25 | 10 |
| crossover / andando / ataque | 3,40 / 10,37 / 18,21 | 1,24 / 3,37 / 3,67 | 37 / 40 / 74 |
| entre_pernas | 7,49 | 1,34 | 40 |
| behind_back | 12,67 | 2,18 | 107 |
| hesitacao | 11,64 | 1,83 | 37 |
| spin / half_spin | 12,36 / 13,85 | 2,15 / 2,72 | 107 / 112 |
| step_back | 4,96 | 0,67 | 19 |
| size_up | 12,35 | 2,33 | 92 |

Só o "parado" está bom (base plantada). **Todo o resto desliza e dá trancos.**

## 5. Diagnóstico (causas prováveis, a confirmar no laboratório)

1. **Pernas paradas ou em direção errada ao puxar um drible correndo.** O drible entra com peso total (inertialization) e as pernas passam a ser as do clipe do drible, que foi gravado **parado** (crossover e hesitação da CMU são no lugar). Enquanto isso, o corpo segue a velocidade de corrida e o impulso do núcleo.
   - **Proposta:** dribles em camadas, com o tronco e os braços do drible por cima das pernas da locomoção (máscara por osso a partir de spine_01), quando o jogador está em movimento. A alternativa é escolher variações do drible por velocidade.
2. **Pé deslizando na locomoção.** A trava de pé só pega quando a ponta do pé está a menos de 5,5 cm e o tornozelo quase parado no mundo. Com velocidade de reprodução limitada (0,7–1,7) e crossfade/inertialization entre passadas, o pé não para no mundo.
   - **Proposta:** casar a velocidade do jogador com a passada do clipe (não só o inverso), detectar o apoio pelos dados do clipe (altura do pé no `clips.json`) e não pela pose final, e travar com tolerância maior.
3. **Perna atravessando perna.** O IK das pernas usa o plano do clipe. Base larga, alvos procedurais e trava de pé podem cruzar os alvos.
   - **Proposta:** limitar a distância lateral mínima entre os tornozelos e o pole do joelho para fora.
4. **Pé entrando no chão.** A trava, a base plantada e o step-back escrevem o tornozelo, mas a sola pode ficar abaixo de 0 com o pé inclinado.
   - **Proposta:** depois do IK, garantir sola ≥ 0 (corrigir a altura do tornozelo pela inclinação do pé).
5. **Bola atravessando o corpo.** O arco da bola é cinemático, sem colisão com o corpo.
   - **Proposta:** cápsulas simples (coxas, canelas, tronco) no laboratório para medir, e um desvio do arco quando necessário.
6. **Size-up.** Os flicks parados empurram o jogador lateralmente (impulso do núcleo) e cada drible entra e sai da base.
   - **Proposta:** size-up no lugar (impulso quase zero sem LS) e combos encadeados direto de um drible para o outro.
7. **Mocap amador da CMU.** É o limite de fundo. A solução definitiva continua sendo capturar atletas (`Tools/Captura`) ou comprar/licenciar mocap bom. D14 diz "só gratuito e open source": isso é decisão do diretor.

## 6. Pendências de coordenação (IMPORTANTE)

Há **outras sessões** mexendo em `web/` ao mesmo tempo.

| Sessão | O que faz | Arquivos |
|---|---|---|
| "NBA 23 badges e HUD gameplay" [91b53e] | Badges, HUD, MatchDirector, rede/física da rede | `GameHud.ts`, `gamehud.css`, `badgeIcons.ts`, `MatchDirector.ts`, `GameStats.ts`, `PlayerRing.ts`, `HoopsBadges*.ts`, `HoopsTakeover.ts`, `HoopsTeammateGrade.ts`; edições em `HoopsDribbleMoves.ts`, `HoopsShotModel.ts`, `sim/index.ts`, `Hud.ts`, `index.html`, `style.css`, ganchos em `Freestyle.ts`/`main.ts`; depois `HoopMesh.ts`/`HoopsBallSim.ts` |
| "Animação de arremesso travando" [e33a1b] | Arremesso e comemoração depois da cesta | `PlayerAnimator.ts` (Celebrate_*), `Freestyle.ts` (updateFlight) |

**Regras combinadas entre as sessões:**

1. Só **edições pontuais** (Edit), nunca Write de arquivo inteiro.
2. Avisar a sessão dona, por SendMessage, antes de mexer em `PlayerAnimator.ts`, `Freestyle.ts` ou `main.ts`.
3. Nunca reverter trabalho de outra sessão sem combinar. Sem acordo, perguntar ao diretor.
4. Commitar só os próprios arquivos, com caminhos explícitos (nunca `git add -A`). A sessão de badges **não** quer que os arquivos dela sejam commitados sem o diretor pedir.

**Pendências abertas:**

- **Follow-through segurado no green: SAI. Não restaurar.**
  - O diretor reportou o personagem travando no ar e aprovou a remoção.
  - Esta sessão restaurou o hold por engano no `ed48e95`. A sessão [e33a1b] já tirou de novo (pasta de trabalho, typecheck e 69/69 testes passando) (a chamada em `Freestyle.release()`; `holdFollowThrough()`, `holdUntil` e o ramo do `timeScale = 0` no `PlayerAnimator.ts`), junto com a **comemoração depois da cesta** (`CelebrateClips`, `celebrate()`, `startCelebration()` e a fila no `updateAction()`; `animator.celebrate()` no `updateFlight` quando `ev.scored`).
  - O bloco `restArmWeight` do `PlayerAnimator.ts` (braço direito relaxado sem bola) também é de [e33a1b]: manter.
  - Antes de mexer em `release()` (Freestyle), `updateAction()` ou `startAction()` (PlayerAnimator), avisar a sessão [e33a1b].
- **Ainda não commitado desta sessão** (misturado com o trabalho em andamento das outras):
  - `main.ts`: ligação do `?lab=1` (o laboratório só funciona com ela);
  - `Freestyle.ts`: velocidade por direção, `placeForLab`, achatamento e som da bola.
  - Estão na pasta de trabalho. Quando o diretor autorizar o commit conjunto, commitar com as outras sessões.

## 7. Como trabalhar (o processo que o diretor pediu)

Para **cada** drible ou situação (size-up, crossover parado e correndo, entre as pernas, behind the back, hesitação, spin/half spin, step-back de drible, retreat, troca automática, corrida com drible):

1. Achar o trecho real no vídeo de referência. Anotar os tempos e o que acontece com os pés, o quadril, o tronco, a bola e o braço livre.
2. Rodar o cenário no laboratório (`cada=2`) e a comparação lado a lado (`tools/comparar.py`). Olhar as 4 vistas.
3. Corrigir. Medir de novo: deslize, estalos, e as métricas novas de perna cruzando, pé no chão e bola no corpo.
4. Só considerar pronto quando a folha comparativa convencer e as métricas caírem.
5. Rodar `npm test` e `npm run e2e` e mandar ao diretor o vídeo e a comparação.

**Step-back:** o que o diretor usa para driblar **não** é o saltinho de hoje.

- O dele é **andar alguns passos para trás driblando** (criando espaço) e depois parar e arremessar.
- O saltinho atual parece o step-back **de arremesso** (segurar para trás no arremesso), que é outra coisa.
- O trecho está num dos vídeos `19.51.*` do WhatsApp: ele disse que a sessão anterior só viu o finalzinho (o step-back de arremesso, por volta de 24 s do `19.51.44`). Procurar o trecho inteiro.

## 8. Fase 0 e Fase 1 (sessão "Fluidez de dribbles e movimentos", 2026-10-15)

**Fase 0 (estabilizar), aplicada no `PlayerAnimator.ts` / `TwoBoneIK.ts`:**

- `anim/ClipFilter.ts`: passa-baixa binomial (5 pontos, fase zero) nas rotações de tronco, braços e pés de todos os
  clipes ao carregar. Pelve, coxas, canelas e posições ficam de fora (filtrar a perna mudava o apoio e o pé deslizava).
  `?filtro=0` desliga, para A/B no laboratório (`LAB_URL="&filtro=0" node tools/laboratorio.mjs ...`).
- Soft IK (`solveTwoBoneIK(..., soft)`): braço freia nos últimos 8% do alcance (`ArmSoftReach`), perna 3%. A mão baixa
  do drible deixava o braço quase reto e o IK estalava ali. `applyPole` perde força com a cadeia quase reta.
- `plantWeight()`: o peso da base plantada chega a zero junto com o corte (antes o pé pulava ~10 cm ao sair dela) e
  a orientação do pé segue esse peso (antes virava num quadro em 0,5).
- `keepFeetApart()`: tornozelos a ≥ 10 cm na lateral do corpo, antes do IK das pernas.
- Postura: `crouchRun` 0,2, `leanPerSpeedDeg` 5, `leanMaxDeg` 44 e cabeça erguida (`headUpShare` 0,65 da inclinação).
- `lowDribbleEnabled` (A/B do IK do drible baixo).
- Laboratório: andando 51 -> 17 estalos, correndo 58 -> 19, retreat 23 -> 7, spin 113 -> 82 (deslize 9,4 -> 4,8 m/s);
  troca automática sem perna cruzando. O spin ainda cruza 4 quadros.

**Fase 1 (vídeo -> mocap), prova com um clipe:**

- Sem GPU NVIDIA (AMD RX 9070 XT): GVHMR/WHAM ficam de fora; eles também pedem o SMPL (cadastro do diretor).
- `Tools/Animacao/video_para_pose.py`: MediaPipe Pose (CPU) num trecho do vídeo -> `pose.json` (33 pontos 3D por
  quadro). Precisa de um venv com `mediapipe av pillow` e do modelo `pose_landmarker_heavy.task` (Google).
- `web/public/assets/mocap/kyrie_cross.json`: crossover do Kyrie (`LZSlFyyCkhk` 9,0–10,9 s), 56/57 quadros.
- `web/src/mocap/Retarget.ts`: pose -> clipe do nosso esqueleto (só direções; pelve e tronco pela orientação dos
  quadris e ombros, coluna em 3 partes, membros por swing, pé pelo calcanhar -> ponta, altura pelo pé mais baixo;
  sem deslocamento horizontal).
- `web/mocap.html?cam=lado|frente|tras|cima&cmu=Cross_R2L&vel=0.4&filtro=3`: CMU (esq.) x Kyrie (dir.), sem pós-processo.
- Folha: `node tools/mocap-folha.mjs <saída>` + `python Tools/Animacao/folha_mocap.py <vídeo> <pose.json> <saída> <jpg>`.
  Resultado em `Saved/fluidez/fase1_retarget_kyrie_x_cmu*.jpg`.
- O que já ficou melhor que a CMU: o Kyrie sai baixo, com passada de ataque e braço de proteção. Limites: a
  profundidade do vídeo monocular subestima a inclinação do tronco (vista de lado ~30° contra ~45° do vídeo), sem
  bola, sem deslocamento, sem torção dos antebraços, e o fator de câmera lenta (`vel`) é chute.

## 9. Fase 2: pernas do Mixamo no jogo (2026-10-15)

- **Clipes:** `Tools/Animacao/mixamo/` (FBX brutos, fora do git; 2 pacotes + 20 avulsos). As juntas por quadro saem pelo
  Blender (`Tools/Animacao/mixamo_juntas_blender.py`; o FBXLoader do three não abre vários arquivos do Mixamo) e viram
  `web/public/assets/mocap/mixamo_loco.json` com `node tools/mixamo-bake.mjs <saída> --extra <juntas.json>`.
- **Retarget:** `src/mocap/Retarget.ts` (`retargetMixamo`, `mirrorMixamoClip`). Altura do quadril de origem escalada pela
  razão das pernas; tendência linear do quadril = velocidade nativa.
- **Mistura:** `src/mocap/MixamoLocomotion.ts`: parado, andar, trote em 8 direções (JogR = espelho do JogL), corrida e
  disparo, todos na mesma fase (0 = pé esquerdo pousando), fase = distância / passada misturada.
- **No jogo:** `PlayerAnimator.applyMixamoLegs` (logo depois de `applyLegLayer`): um esqueleto-clone escondido toca a
  mistura; a pelve e as pernas dele substituem as do loop da CMU andando/correndo para a frente e para trás, e a
  spine_01 desfaz a rotação nova da pelve (o tronco, o drible e a bola continuam da CMU). De lado fica a CMU (o trote do
  Mixamo cruza os pés), e também nos dribles parados, no arremesso, na bandeja e na comemoração. Todo o pós-processo
  roda por cima. `?loco=cmu` volta para a CMU; `mixamoLegsEnabled` para A/B no laboratório.
- **Laboratório (CMU -> Mixamo):** deslize médio somado 10,52 -> 9,12; andando máx 2,82 -> 1,11 (média 0,74 -> 0,40);
  crossover andando 3,24 -> 1,11; crossover de ataque 2,64 -> 1,11; retreat 5,39 -> 2,08. Pior: estalos correndo 18 -> 31
  e no crossover de ataque 65 -> 88; de costas média 0,36 -> 0,64.
- **Página:** `locomocao.html` (CMU x Mixamo crus lado a lado) e `node tools/locomocao-folha.mjs`.

## 10. Polimento: contato mão-bola, emenda entre dribles e flicks (2026-10-15, à noite)

Pedido do diretor: dribles fluidos e conectados como no 2K (LS + RS juntos), sem flicks nem personagem "piscando", e
rever regras e planos.

### O que mudou (arquitetura)

1. **Contato mão-bola nos loops** (`PlayerAnimator` + `BallDribbler`, `ClipLibrary.dribbleHandShape/contactFrames`):
   - A altura da mão da bola é uma curva **desenhada** no ritmo do loop (meios-cossenos entre os vales e os picos da palma
     do clipe), numa faixa por loop (`stance.palmBottom/palmTop`, `...Run`, `...Low`), e o ponto da mão é fixo à frente da
     ponta do pé (`dribbleForward` 0,2, `DribbleSwing` para a frente na descida). A curva medida da CMU tinha degraus
     (correndo, a mão caía 27 cm num quadro) e o IK lia a altura "nativa" da pose já abaixada (a mão andava 4 cm).
   - **Soltura na metade da descida** (a mão ainda empurrando) com a velocidade da mão; a descida da bola é empurrada
     (acelera até o chão, sem salto de velocidade). **Recepção a 65% da subida**; na subida o desvio até a palma real
     entra em smoothstep; na recepção a mão "cede" (absorb, Δv·t·e^(-t/τ)).
   - Soltura do loop com a bola no ar é ignorada; desvio da bola no ar para não atravessar a perna é suave (30/s).
2. **Drible só começa com a bola na mão** (`Freestyle.pendingMove`, até 0,45 s; o gesto é relido na hora). Em combo, o
   próximo entra na **recepção** do anterior. Crossover e entre as pernas acabam ~0,06 s depois da recepção e o loop da
   mão nova recomeça na recepção (`restartLoopAtCatch`): o resto do clipe da CMU segurava a bola parada 0,3 s.
3. **Coreografia do crossover e do entre as pernas**: a recepção é a do caminho de drible da mão nova (`crossCatch`), a mão
   que recebe vai por IK, quique em V à frente dos joelhos (crossover) ou entre os pés (entre as pernas).
4. **Mesma postura em todos os dribles**: altura média da pelve (`pelvisAvg`) e inclinação média do tronco
   (`measureClipPitch`) de cada clipe são descontadas (o entre as pernas da CMU é 17 cm mais baixo e dobra o tronco 62°
   contra 13° do drible parado). Joelhos para fora e dobra do quadril também nos dribles parados; passos do size-up numa
   meia base de 15–42 cm (a base chegava a 1,2 m). Spin 8 cm abaixo da base (não mais de cócoras), girando em arco em volta
   do pé de pivô.
5. **Trocas de IK sem salto**: quando uma mão sai de um IK (recepção, drible, braço livre do spin) ela segura a última
   posição desenhada e solta em ~0,15 s (`handHold`); saindo de um drible, a mão da bola entra no loop partindo da palma
   desenhada no quadro anterior (`lastPalmLocal`); o desvio da perna não briga mais com um IK desenhado.
6. **IK do braço** (`reachPalm`): resolve, gira o cotovelo pelo pole e depois corrige a palma em 3 passadas fixas (antes
   errava até 16 cm e, com parada antecipada, tremia).
7. **Corpo vira no corte**: correndo, depois que a bola sai da mão no crossover/entre as pernas/por trás, o corpo vira para
   a direção nova (antes ~0,4 s de passo lateral a 4,6 m/s de frente para a cesta).
8. **Bugs que causavam flicks**:
   - pé: `footQL.copy(reto).slerp(footQL, ...)` misturava o reto com ele mesmo (pé 100% reto e giro de 40–95° num quadro
     ao sair andando);
   - **mixer do three só escreve o osso quando o valor do clipe muda**: com o clipe parado ou a 144 Hz o pós-processo
     entrava duas vezes (quadril 16 cm e 28° num quadro). Agora a pose crua do mixer volta aos ossos antes de cada
     atualização (`restoreMixerPose`). **Isso é provavelmente o "personagem piscando" num monitor de 120/144 Hz**;
   - troca de loop com a camada das pernas ativa sem inertialization (pé saltava 31–52 cm no crossover acelerando).
9. Sprint: o loop de corrida da CMU fica em até 1,1x quando as pernas são do Mixamo; inclinação 2,5°/m/s até 30°.

### Laboratório novo

- Métricas: flicks (bola, mão, corpo, giro), **SALTOS** (segunda diferença da posição em cm por quadro, de pés, joelhos,
  mãos, cabeça, pelve e bola: o que o olho vê como pulo) e NaN (osso quebrado = malha some).
- `LAB_HZ=144` (monitor de 144 Hz) e `LAB_STANCE='{"dribbleForward":0.2}'`. **Rodar sempre a 60 e a 144 Hz.**
- 12 cenários de combo com LS + RS (`combo_size_up`, `combo_rapido`, `corre_cross_corre`, `corre_cross_volta`,
  `corre_spin`, `corre_hesi_arranca`, `corre_por_tras`, `corre_step_back`, `anda_entre_pernas`, `lado_cross_lado`,
  `zigue_zague`, `para_e_cruza`).
- `node tools/video-lab.mjs <cenários> <saída.mp4> [jogo|back|side|front|top] [lento]`: vídeo 60 fps quadro a quadro.
- `python tools/folha-lab.py <pasta> <vista> <saída.jpg> [colunas] [q0] [q1] [zoom]`, `node tools/sonda-cenario.mjs`,
  `python tools/sumico.py <pasta de png>` (procura quadros sem o jogador num vídeo).
- Números finais em `Saved/fluidez/metricas_polimento.txt`; vídeos `Saved/fluidez/dribles_polimento_*.mp4`.

### Como estava x como ficou (60 Hz)

| | antes | depois |
|---|---|---|
| Drible parado: estalos / flicks da bola | 0 / 11 | 0 / 1 |
| Drible parado: curso da mão | 4 cm | 20 cm |
| Drible parado a 144 Hz: estalos | 92 (quadril 16 cm/28° num quadro) | 5 |
| Bola presa longe da mão (métrica bola-mão, pior cenário) | 46 cm | 0 cm |
| Saltos de pé no crossover de lado | 52 cm | 15 cm |
| Saltos de mão no size-up encadeado | 31–42 cm | 13–16 cm |
| Base no combo de size-up | 1,23 m | 0,88 m |

### Pendente

- **Spin e half spin**: o giro chega a ~1100°/s e a mão da bola anda 25–30 cm por quadro (lê como pulo); a bola entra no
  corpo no spin (até 17 cm). Próximo passo: raio menor da bola durante o giro e curva de giro menos concentrada.
- **Bola no corpo** no entre as pernas e no por trás correndo (9–15 cm, poucos quadros). No entre as pernas a bola sobe
  do meio dos pés e contorna a canela da mão que recebe (salto de ~24 cm em 2–3 quadros na recepção): o caminho certo é
  com os pés escalonados (o da mão que recebe à frente) e a recepção por fora do joelho.
- **Latência do Pro Stick**: o flick só é reconhecido quando o stick volta ao centro (~80–120 ms), mais a espera da bola
  (0–0,25 s). Proposta: reconhecer o flick na borda (2 quadros parados na direção) com o gesto podendo ser trocado
  enquanto espera a bola.
- Pé desliza ao parar de repente e cruzar (`para_e_cruza`: pico 9,7 m/s num quadro).
- e2e do freestyle: 1 de 6 rodadas com a bola a >1,3 m do jogador (máquina carregada); não reproduzido no laboratório.

### Teste no jogo de verdade (controle simulado)

- `node tools/jogar.mjs <saída>`: abre o jogo (não o laboratório) num Chromium isolado, troca `navigator.getGamepads` por
  um controle de Xbox simulado (LS/RS analógicos, RT, LT, X) e joga um roteiro de 17 s em tempo real: andar, disparo,
  crossover correndo saindo na diagonal com o LS, combo de size-up, spin correndo, hesitação com RT, step-back e
  arremesso. Grava `jogo.mp4` e `log.json` (FPS, cronologia dos dribles e cada quadro em que um ponto do corpo ou a bola
  sai mais de 6 cm da trajetória, com o dt real). Não interfere no controle físico do diretor.
- Resultado: 60 fps estáveis, todos os dribles saíram, 130–290 ms do flick ao drible (os mais longos esperando a bola
  voltar para a mão). Saltos acima de 10 cm: 49 -> 38; pior 27 -> 21 cm (fim do spin correndo, não reproduzido no
  laboratório).
- Achados e correções dessa rodada: correndo contra a linha da quadra a posição parava mas a velocidade não (pernas
  correndo no lugar); bola do drible correndo com 0,17 s no ar (`DribbleContactRun`); giro do spin começando a 1080°/s
  (`SpinYawSmooth`); mão "segurada" no referencial da raiz durante o spin (agora no da malha); IK do drible apagando devagar
  durante o drible (vira `handHold` no começo); inertialization extrapolando velocidade de um quadro com salto (a 144 Hz o
  joelho ia 37 cm para trás; limite em `Inertializer.maxAngularSpeed/maxLinearSpeed`).

### Revisão das regras e dos planos (proposta ao diretor)

1. **D14 (só gratuito/open source) é o teto da qualidade dos dribles.** O mocap da CMU é amador (drible alto e solto,
   crossover em pé, entre as pernas de cócoras); o polimento desta sessão desenha mão, bola e postura por cima dele, mas o
   corpo dos movimentos continua sendo o da CMU. O 2K usa centenas de dribles capturados de jogadores da NBA. Para chegar
   perto: (a) permitir comprar um pacote de mocap de basquete com licença para jogo, ou (b) a captura própria com
   atletas (D9), com uma ferramenta de vídeo que dê saída comercial. O GVHMR/WHAM (vídeo → 3D bom) pede GPU NVIDIA e o
   modelo SMPL, cuja licença padrão não é comercial. **Recomendação: liberar mocap pago/licenciado só para os dribles.**
2. **"O núcleo decide QUAL e QUANDO; a animação só executa" precisa mudar para: o núcleo decide QUAL; o QUANDO respeita
   a bola na mão.** Hoje isso está no `Freestyle` (pendingMove); o certo é o núcleo (`DribbleController`) ter a janela de
   entrada presa ao ritmo do quique.
3. **Nova regra: mão e bola nunca vêm cruas do mocap.** O mocap dá o corpo; o caminho da mão e da bola é desenhado (IK),
   com a postura normalizada. É o que permite trocar de drible sem salto.
4. **Critério de pronto** (antes de mandar ao diretor): a 60 **e** a 144 Hz, NaN 0, bola presa ≤ 5 cm da mão, nenhum
   SALTO acima de ~15 cm fora do spin, e o vídeo de `video-lab` revisto quadro a quadro.
5. **Uma sessão dona da animação** (`PlayerAnimator.ts`): várias sessões mexendo no mesmo arquivo de 2 mil linhas é o que
   mais gera regressão. As outras pedem por mensagem.
6. **Commit**: há trabalho de várias sessões sem commit desde o `229db14`. Pedir ao diretor um ponto de commit conjunto.
7. Mocap por vídeo do Kyrie (Fase 1, MediaPipe monocular): bom como referência de pose, ruidoso demais para virar drible.
   Pausar até haver captura própria ou GPU NVIDIA.

## 11. Passagem para a sessão nba-55 (2026-10-15, 20h30)

A sessão "Fluidez de dribbles e movimentos" [0d9bbf] passou o trabalho de fluidez para a sessão **nba-55** (VS Code), a
pedido do diretor. Desde esta passagem a [0d9bbf] não edita mais os arquivos de movimentação, drible e animação.

### 1. Pasta e como rodar

- **O jogo é `C:\Users\Administrator\Documents\Codes\Games\NBA\NBA\web`** (three.js + TypeScript + Vite), na branch
  `claude/hopeful-einstein-eargc1`. `NBA 5.8`, `NBA 5.8 - 2` e `NBA 5.8 - 3` são os projetos antigos da Unreal 5.8,
  abandonados pela decisão D15 (migração para three.js): não mexer neles.
- Rodar: `cd web; npm run dev` (porta 5173, `strictPort`), abrir `http://127.0.0.1:5173/`. Controle de Xbox pela Gamepad
  API ou teclado (WASD = LS, setas = RS, E/R = spin/meio giro, Shift = RT, Q = LT, Espaço = X).
- **Estado agora:** a [0d9bbf] deixou um servidor Vite rodando na 5173 pelo navegador do app
  (`.claude/launch.json`, "jogo-web"). Com ele aberto, `npm run dev` falha (porta presa): feche a aba/pare o servidor
  no app ou use esse mesmo servidor.
- Testes: `npm test` (vitest, 135) e `npx playwright test` (e2e, 8). **O e2e apaga `web/test-results/`** a cada rodada:
  salve vídeos e prints fora dela (ex.: `Saved/fluidez/`).
- Laboratório: seção 3 e seção 10 ("Laboratório novo"). Precisa do Vite rodando. Sempre rodar a 60 **e** a 144 Hz
  (`LAB_HZ=144`). `node tools/jogar.mjs <saída>` joga o jogo de verdade com controle simulado.

### 2. Arquivos e funções principais

| Arquivo | O que tem |
|---|---|
| `web/src/game/Freestyle.ts` | Entrada → movimento (`updateMovement`, `updateFacing`), Pro Stick (`updateProStick`), dribles de transição pelo LS (`updateTransitionDribbles`), fila do drible até a bola voltar à mão (`pendingMove`, `ballReadyForMove`, `flushPendingMove`), início do drible e impulso (`syncMoveStart`), arremesso, bandeja/enterrada. |
| `web/src/sim/HoopsDribbleMoves.ts` | Núcleo: gesto → drible (`resolveDribbleMove`), `DribbleController` (commit, buffer, combo, misdirection, energia, arranque). Tabela `Specs` (durações e impulsos). |
| `web/src/sim/HoopsProStick.ts` | Reconhecedor do RS (flick na volta ao centro, hold, giro, quarto de giro, double/switchback). |
| `web/src/anim/PlayerAnimator.ts` | Tudo da animação: `chooseBase`/`switchBase` (loops), `playMove`/`startAction`/`updateAction` (dribles), `detectEvents` (soltura/recepção), `applyStance` (agachamento, dobra, inclinação, pés, IK das pernas, normalização por clipe `pelvisAvg`/`clipPitch`), `applyArms` (IK do drible: `lowDribblePalm`, `handShapeNow`, `dribbleTarget`), `applyBetweenLegsArm` (recepção desenhada `crossCatch`/`betweenLegsPath`), `applySpinFreeArm`, `applyGuardArm`, `applyHandHold`, `applyBallClearance`, `reachPalm` (IK do braço), `applySpinPivot`, `applyMixamoLegs`, `restoreMixerPose`/`saveMixerPose`. |
| `web/src/game/BallDribbler.ts` | A bola: presa à palma, arco no ar (descida empurrada, subida, correção suave até a palma, absorção na recepção, desvio da perna). |
| `web/src/anim/ClipLibrary.ts` | Tempos dos dribles (`MoveTimings`), `dribbleHandShape`, `contactFrames`, `spinTurnAlpha`. |
| `web/src/anim/ProceduralMoves.ts` | Altura do jogador (`PlayerHeightMeters` = 1,86), behind the back e step-back procedurais. |
| `web/src/anim/Inertialization.ts` | Transições (dead blending) com limite de velocidade extrapolada. |
| `web/src/anim/TwoBoneIK.ts`, `ClipFilter.ts` | IK de duas articulações (soft IK, pole) e filtro dos clipes. |
| `web/src/mocap/MixamoLocomotion.ts`, `Retarget.ts` | Pernas do Mixamo por direção e velocidade (seção 9). |
| `web/src/lab/Lab.ts`, `web/tools/*` | Laboratório, métricas (inclusive SALTOS e NaN), cenários, vídeo, sondas. |

### 3. O que mudou, o que funcionou e o que não funcionou

Detalhado nas seções 8, 9 e 10 (com números). Resumo:

- **Funcionou:** curva desenhada da mão e contato mão-bola (drible parado sem estalo e sem flick); drible só com a bola
  na mão e emenda na recepção; postura igual em todos os dribles (altura e inclinação normalizadas por clipe, base
  limitada no size-up); trocas de IK sem salto (`handHold`, saída do drible pela palma desenhada); corpo virando no corte;
  correções de bugs que faziam o personagem "piscar" (mixer do three que não reescreve osso parado; orientação do pé;
  inertialization nas trocas de loop e com velocidade limitada); IK do braço acertando o alvo; linha da quadra.
- **Não funcionou / foi desfeito:** joelhos para fora durante os dribles sem a recepção desenhada (a bola batia no
  joelho); parada antecipada do IK do braço (tremia); deixar a inertialization de fora das trocas de loop com a camada
  das pernas (pé saltava 55 cm); filtro nas pernas (seção 8); tocar o loop de corrida da CMU mais devagar não mudou os
  estalos do braço (o que resolveu foi a faixa da mão).

### 4. Problemas conhecidos

- **Spin e meio giro:** ainda o drible pior (mão e bola saltam 15–25 cm em alguns quadros; bola entra no corpo até 12 cm).
- **Entre as pernas e combos:** a bola contorna a perna de quem recebe (salto de 20–30 cm em 2–3 quadros). O caminho
  certo é o entre as pernas com os pés escalonados e recepção por fora do joelho.
- **Latência do Pro Stick:** 130–290 ms do flick ao drible (o flick só é lido na volta ao centro, mais a espera da bola).
- Pé desliza na parada brusca (`para_e_cruza`); estalos (aceleração angular) altos a 144 Hz nos braços correndo (os
  SALTOS em cm estão baixos).
- No jogo real, uma vez a cabeça saltou 14 cm no fim do spin correndo (não reproduzido no laboratório).
- e2e do freestyle: 1 de 6 rodadas com a bola a >1,3 m do jogador (máquina carregada).
- Teto de qualidade: o mocap da CMU (ver a revisão das regras no fim da seção 10).

### 5. Próximos passos planejados

1. Spin: raio menor da bola e do braço livre durante o giro; recepção desenhada como no crossover.
2. Entre as pernas: pés escalonados, recepção por fora do joelho, caminho da bola sem o desvio de perna.
3. Pro Stick: reconhecer o flick na borda (2 quadros parados na direção), podendo trocar o gesto enquanto espera a bola;
   no núcleo, a janela de entrada presa ao ritmo do quique (regra nova proposta na seção 10).
4. Parada brusca sem deslizar; revisar estalos do braço correndo a 144 Hz.
5. Decisões do diretor pendentes: mocap pago/licenciado (D14) e commit conjunto.

### 6. Mudanças não salvas ou pela metade

- **Nada pela metade:** tudo está salvo no disco, compila (`tsc`) e passa nos testes. **Nada foi commitado** (o último
  commit é `229db14`; o trabalho de várias sessões está misturado na pasta de trabalho).
- Os campos `restoreMixerEnabled` e `blendLegSwitch` do `PlayerAnimator` são chaves de A/B do laboratório (padrão
  `true`), de propósito.
- `web/src/game/Input.ts`, `HoopMesh.ts`, `MatchDirector.ts`, `web/tools/hy3d-fila.js` e os arquivos de badges/HUD **não
  são** da [0d9bbf]: são de outras sessões.
- Coordenação: avisar as sessões do arremesso [b4c8f115] e das bandejas [260fb44e] antes de mexer em `startAction`,
  `updateAction`, `reachPalm` ou `restoreMixerPose` (elas medem o arremesso e as bandejas em cima disso).

## 12. Sessão nba-55: latência do Pro Stick e pernas no por trás (2026-10-15, noite)

Pedido do diretor: fluidez de NBA 2K, dribles que respondem ao controle e casam com o corpo. Primeira etapa: a resposta.

### Diagnóstico

Do flick ao drible passavam 130–290 ms no jogo (até 383 ms no laboratório), em três esperas somadas: (1) o flick só era
lido na volta do stick ao centro; (2) o comando esperava a bola inteira na mão (correndo, a mão segura a bola numa fração
pequena do quique: `DribbleContactRun`); (3) a transição de entrada. Além disso, o stick empurrado e segurado não fazia
drible nenhum (o Hold resolve para None).

### O que mudou

1. **Flick na borda** (`HoopsProStick`, `earlyFlick`): sai quando o stick fica 25 ms na zona ativa girando menos de
   300°/s, sem esperar a volta. Para baixo continua na volta (`earlyFlickExcluded`): segurar para baixo é o arremesso
   pelo Pro Stick (docs/02 §1), ainda não implementado. O spin e o meio giro varrem a borda a 700–1400°/s e não disparam.
2. **Giro completo no meio do gesto** (`earlyRotation`): sai quando a varredura passa de 230°.
3. **Um toque nunca vira dois dribles** (`DribbleController.resolveGesture`): um giro que começou como flick na borda
   (`afterEarlyFlick`) troca o drible antes do 1º quique ou é descartado.
4. **Drible começa com a bola subindo** (`Freestyle.ballReadyForMove`, `PlayerAnimator.moveBallLead`): se a bola chega
   antes da soltura do drible. Os de mocap param logo antes da soltura até a bola chegar (`holdMoveForBall`, no máximo
   0,15 s); o spin só começa se ela chegar antes da soltura (parar congelaria o giro); os procedurais quase não esperam.
5. **A mão vai buscar a bola** (`applyReachForBall`): nesse caso a mão da bola sobe ao encontro dela por IK, em vez de
   pular para a pose do clipe; na recepção passa para o clipe pelo `handHold`. Fora: procedurais e spin.
6. **Pernas da locomoção no por trás em movimento** (`legLayerMoves`, agora campo do animador): corre_por_tras SALTOS
   46 -> 35, bola no corpo 13 -> 5 quadros. A hesitação foi testada e **ficou de fora** (pernas cruzando 13 -> 40).

A/B pela URL: `?flick=volta` (flick e giro só na volta ao centro) e `?bola=mao` (espera a bola inteira na mão). Os dois
juntos são o comportamento antigo. `jogar.mjs` aceita `JOGO_URL`; o laboratório, `LAB_URL`. O laboratório agora mede a
latência de cada comando do RS, e cenários aceitam `place: [x, y]` (novos: `linha_de_fundo`, `spin_na_linha`).

### Números (laboratório, todos os cenários)

| | antes, 60 Hz | agora, 60 Hz | antes, 144 Hz | agora, 144 Hz |
|---|---|---|---|---|
| Latência média (máx) | 215 ms (383) | **145 ms (267)** | 95 ms (160) | **57 ms (111)** |
| SALTOS | 1170 | 1206 (+3%) | 591 | 614 (+4%) |
| Bola no corpo (quadros) | 123 | **88** | 316 | **246** |
| Estalos | 1743 | 1856 (+6%) | 6363 | 6710 (+5%) |
| NaN | 0 | 0 | 0 | 0 |

No jogo com controle simulado (`jogar.mjs`), os flicks saem em ~80 ms (antes 120–250). O `combo_rapido` antes perdia um
dos quatro comandos; agora sai os quatro.

### Pendências encontradas

- **Hesitação correndo** (`corre_hesi_arranca`): SALTOS 39 -> 53, joelho 20 cm. As pernas do clipe da CMU (gravado
  parado) entram agora em outra fase da corrida; com as pernas da locomoção cruzavam. Precisa de solução própria.
- **Spin correndo** ainda demora ~180–230 ms: correndo a bola fica pouco na mão e o spin não pode esperá-la parado.
- **Linha de fundo**: o jogador atravessa a base da tabela (sem colisão) e cruza as pernas empurrado contra a linha.
  No jogo, depois do spin correndo até a linha, a mão e a bola saltaram 114 cm uma vez (não reproduzido no laboratório).
- ~~e2e do freestyle falhando~~ **resolvido** pela sessão "Modelos 3D para jogo": o 1º quadro depois do `PlayerGear.load`
  chegava com dt negativo (−792 ms) e o animador integrava para trás (palmas a ~17 m). `main.ts` agora limita o dt por
  baixo também. Conferido: 159 testes unitários e 8 e2e passando, bola no máximo a 0,94 m do jogador no e2e.
  `node tools/sonda-freestyle.mjs` registra cada quadro com a bola longe do jogador, para casos parecidos.
- `updateFacing` interpola a frente como vetor: com a direção desejada oposta, o corpo não gira até surgir uma componente
  lateral. Trocar por giro em ângulo com velocidade máxima.

## 13. Quique com dwell, footwork do drible e entre as pernas com base escalonada (2026-10-16)

Sessão "Sistema de dribles e animação procedural". Pedido: quique natural com tempo de mão na bola, pernas reagindo à
direção do drible e ao peso, e entre as pernas com base escalonada que inverte em combo (tesoura), como no 2K.

### Diagnóstico (o que deixava rígido)

1. **Mão no quique:** a curva desenhada da mão era um meio-cosseno simétrico (sobe e desce igual). Sem tempo no alto
   (a mão virava no topo e já descia) e com o empurrão saindo devagar: a bola parecia "cair" da mão, num ritmo de
   metrônomo. A recepção não olhava a velocidade da mão: a bola chegava subindo a ~3 m/s numa mão que subia a ~1.
2. **Pernas no size-up:** a base plantada pregava os pés onde o clipe pedia, só com passinhos de ajuste; o quadril só
   descia (agachamento) e dobrava (hinge). Nada levava o peso para o pé de apoio, nada girava o quadril com a base.
3. **Entre as pernas:** os pés eram os do clipe da CMU (de cócoras, lado a lado, base até 1,05–1,12 m no combo). O
   quique caía no meio dos pés e a recepção era à frente da ponta do pé da mão nova: a bola subia cruzando a canela.

### O que mudou

- **`ClipLibrary.ts`** (`HandDwell`, `handRise`/`handPush`, `handDwellFor`): a curva da mão entorta o tempo de cada meio
  do ciclo: subida rápida que chega devagar no alto, ~15% do ciclo a menos de 2% do topo (dwell), empurrão que acelera
  até a soltura (sai ~27% mais rápido na metade da altura). Contato mais longo, como o jogador bom (Hirata, 2011).
  Correndo continua simétrico (`HandDwellRun`). `contactFrames` inverte a curva nova.
- **`BallDribbler.ts`**: a escolha da divisão descida/subida pesa também a diferença entre a velocidade de chegada da
  bola e a da mão na recepção (`catchSpeedY`, que o animador manda na soltura do loop; `CatchMatchWeight` 0,35).
- **`anim/DribbleFootwork.ts`** (novo, puro, testado em `footwork.test.ts`):
  - `SplitStance`/`splitFoot`: base escalonada (pé da mão que recebe 18 cm à frente, o outro 17 cm atrás, meia base 20 cm);
  - `scissorStep`/`scissorSeconds`: tesoura com os dois pés no ar ao mesmo tempo, o pé sobe antes de andar e pousa depois
    (janela 25–80% do passo), duração 1,3x o tempo até o quique (os pés se cruzam lado a lado perto do quique, com 40 cm de
    corredor, e o pé da frente novo pousa antes da recepção);
  - `weightTarget` + `WeightShift`: transferência de peso por mola amortecida (ω 13, ζ 0,78; altura ω 18), sub-passos de
    1/120 s. Base escalonada: quadril vai ao pé da frente e gira 9° com ela; crossover parado: carrega na mão que solta e
    passa para o lado da mão nova; hesitação: sobe e recua e no fim vai à frente; impulso para baixo no pouso da tesoura.
- **`PlayerAnimator.ts`**:
  - `applyPlantedStance`: a tesoura dispara uma vez por entre as pernas parado (modo `hold`); a base escalonada vira o
    alvo dos pés enquanto a base plantada vale (some andando ou no escape). Os passos têm duração e altura próprias.
  - `applyWeightShift` (novo, dentro do `applyStance`, antes do IK das pernas): desloca e gira a pelve; spine_01 fica com
    40% do giro (quadril e ombros dissociados).
  - `betweenLegsPath`: com a base escalonada, quique no meio dos pés (6 cm atrás) usando onde o pé vai pousar, e
    recepção por fora do joelho da frente (`SplitStance.catchOutside` 0,34). Com 0,24 a bola raspava a coxa (36 quadros).
  - `lowDribblePalm` + `footAhead`: o ponto do drible acompanha o pé da mão quando ele está à frente.
  - `applyBallClearance`: o desvio da perna vale já no começo de um drible (antes ficava ~70 ms desligado).
  - Chaves de A/B: `footworkEnabled`, `handDwellEnabled`; ajustes ao vivo em `animator.footworkTuning.{split,weight}`.
- Laboratório: cenário `entre_pernas_combo` (4 entre as pernas seguidos); `LAB_ORIGIN` em `tools/laboratorio.mjs`.

### Como medir sem o HMR derrubar a rodada

Com várias sessões salvando arquivos, o Vite recarrega a página no meio do cenário ("Execution context was destroyed").
Rode o laboratório num build congelado:

    cd web; npx vite build --outDir ../Saved/lab-dist --emptyOutDir
    (servidor "lab-congelado" em .claude/launch.json: vite preview de Saved/lab-dist na 5174; se ela estiver ocupada o
    app escolhe outra porta, veja qual)
    LAB_ORIGIN=http://127.0.0.1:5174 node tools/laboratorio.mjs <saída> <cenários>

Ajustes ao vivo na aba do laboratório (sem rebuild): `__debug.animator.footworkTuning.split/.weight`, `.stance.moveExit`,
`.clearanceAtMoveStart`, `.footworkEnabled`, `.handDwellEnabled`.

### Números (laboratório, antes = `footworkEnabled` e `handDwellEnabled` desligados, mesmo build)

Tabelas completas em `Saved/drible-aaa/comparacao.md`; folha `Saved/drible-aaa/btl_combo_antes_depois.png`.

| 60 Hz | antes | depois |
|---|---|---|
| entre_pernas: pé desliza máx / base máx / bola no corpo | 2,73 m/s / 1,05 m / 13 cm (5 q) | 0,11 / 0,50 / 2 cm (2 q) |
| entre_pernas_combo: idem | 2,76 / 1,12 / 13 cm (21 q) | 0,80 / 0,50 / 2 cm (3 q) |
| combo_size_up: idem | 4,46 / 0,96 / 13 cm (17 q) | 2,03 / 0,65 / 3 cm (4 q) |
| soma dos 12 cenários: deslize máx / bola no corpo (q) / saltos de mão | 46,7 / 56 / 95 | 34,5 / 34 / 84 |

A 144 Hz o padrão é o mesmo (bola no corpo 136 -> 110 quadros, profundidade somada 78 -> 53 cm).

### Pendências

- **Estalos dos braços no entre as pernas** (só em mão/antebraço/braço; os SALTOS de mão em cm caíram). Sonda quadro a
  quadro (pesos de cada IK do braço por quadro): q3–11 a mão que solta passa pela coxa e o desvio da perna a empurra até
  16 cm; q22–23 entra o braço de guarda; q27–30 a saída da recepção para o loop; q45–51 a mão do loop muito à frente
  (perto do alcance) com a base escalonada. Corrigido o último: `SplitStance.handAhead` 0,5 (34 -> 20 a 60 Hz; 98 -> 65 a
  144 Hz, igual aos 64 de antes do footwork). Combo: 115 -> 103 (antes do footwork 65). **Testado e descartado:**
  empurrão desenhado da mão que solta até um ponto entre as pernas + joelho de trás abrindo pelo pole (a bola passou a
  bater 20 cm na coxa no combo, e os estalos não caíram); saída da recepção mais lenta (`stance.moveExit` 0,4: igual);
  desvio da perna só depois de ~70 ms (`clearanceAtMoveStart=false`: estalos iguais, bola mais no corpo). O que sobra
  está espalhado no combo (troca de mão a cada ~0,3 s com IKs entrando e saindo); o próximo passo é um caminho único da
  mão por drible (soltura -> recepção -> loop) em vez de três IKs que se passam o braço.
- **Bola encosta 2–6 cm na coxa** em poucos quadros de size_up, hesitação e crossover (antes 0). Com o dwell mais
  dribles começam com a bola na mão, e a mão do clipe passa pela coxa na entrada (0,12 s de inertialization).
- **Entre as pernas andando** (`anda_entre_pernas`): continua com as pernas da locomoção (46 quadros cruzando, igual a
  antes). A base escalonada só vale parado; em movimento o certo é cronometrar o drible com a passada aberta.
- `escape_combo` a 144 Hz: pernas cruzando 29 -> 39 quadros.

### Depois do commit 0d56bf8 (mesma sessão, junto com o plano do GPT/Codex)

O Codex fez a 1ª etapa de responsividade (LS radial, freio na inversão, giro de 180°, drible com o LS/RT do quadro):
`docs/dev/RESPONSIVIDADE-MOVIMENTO.md`, `web/src/game/Movement.ts`, `e2e/movement.spec.ts`. Daqui:

- **Bola fugindo no e2e do freestyle (corrigido).** A falha intermitente (maxDist 1,5–7 m) era o IK do braço:
  `solveTwoBoneIK` com a cadeia reta e o pole paralelo a ela (bola na mão de fora no deslize lateral, braço para fora,
  baixo e para trás) gerava eixo nulo, `setFromAxisAngle` dava |q| ≠ 1 (até 4,5 no upperarm_r) e a matriz do osso
  esticava o braço até 6 m num quadro. Só aparecia com quadros longos (os prints do e2e). Agora há eixo de reserva e os
  quaternions saem normalizados (`TwoBoneIK.ts`, teste `twoBoneIK.test.ts`). e2e: antes 4 de 6 falhando; depois 10 de 10
  passando, maxDist 0,94 m. Ferramentas: `tools/sonda-palma.mjs` (embrulha cada etapa do animador e acusa a primeira que
  gera quaternion não-unitário ou palma longe) e `ballStats().worst` com o rastro dos 12 quadros antes do pior.
- **Impulso do drible esperando a bola** (item 2 do plano do Codex, passo pequeno): enquanto o clipe espera a bola
  (`animator.waitingForBall()`), a rampa do impulso no `Freestyle.updateMovement` também espera e depois cabe no que
  sobra até o fim do núcleo (janelas de combo iguais). `?impulso=relogio` volta ao antigo. Medido: efeito nulo nos 9
  cenários em movimento (o jogo já só começa o drible com a bola chegando); fica por coerência.
- **Quique no referencial da quadra** (item 4 do plano do Codex): implementado em `BallDribbler` (arco planejado na
  soltura, herda a velocidade do jogador, segue o desvio dele ao longo do arco), **desligado** (`?quique=quadra` liga):
  saltos da bola 163 -> 154 e spin correndo sem bola no corpo, mas bola no corpo 16 -> 20 quadros e o pior salto do
  zigue-zague maior. Falta a mão ir para onde a bola vai (e não o contrário) antes de ligar.
- **Behind the back dentro da bermuda** (achado da sessão dos braços, 15 cm): mover o caminho da bola para trás não muda
  nada, o braço não alcança (tronco inclinado, ombros à frente). Precisa girar o tronco para o lado da bola no por trás.
  Não mexido.
- e2e contra build congelado: `E2E_ORIGIN=http://127.0.0.1:5174 npx playwright test ...` ("lab-congelado" no
  .claude/launch.json serve `Saved/lab-dist`).

## 14. Escape e saída correndo: o pé preso no chão (2026-10-16)

Pedido do diretor (print do crossover de ataque parado): "a perna fica presa no lugar e buga", "deveria se mover mais um
pouquinho"; depois: "faço um behind the back e corro, o pé fica bugado no chão; a mesma coisa com o escape".
Antes/depois: `docs/img/escape-perna-antes-depois.jpg`. Cenários novos no laboratório: `escape_e_corre`,
`escape_e_corre_lado`, `por_tras_e_corre`, `por_tras_e_corre_depois`.

### Diagnóstico

- **Um pé sem vez na base do escape.** Os passos são um de cada vez e o pé do lado para onde o corpo vai era sempre
  testado primeiro; com o corpo andando, ele já pedia outro passo quando pousava e o de trás ficava pregado até o corpo
  parar (1,4 m atrás no crossover de ataque parado, base de 1,17 m; no por trás seguido de corrida ele nunca saía).
- **O escape parado girava o corpo 90°.** O giro do corte (`CutMoves`, feito para o crossover correndo) ligava porque a
  velocidade lateral do escape passa de 2 m/s; a base do escape (no referencial do jogador) girava junto.
- **Sair correndo de um drible parado.** Os passos do escape (0,14 s) seguiam até 4 m/s (passadas de 1,5 m) e, quando a
  base soltava, o pé era arrastado ~1,2 m pelo chão até a pose da corrida (até 15–18 m/s de deslize).

### O que mudou

- `PlayerAnimator.applyPlantedStance` (escape): os pés **alternam** (`plant.lastStep`) e o pé no ar **mira onde o corpo
  vai estar** até a metade do passo (`EscapeStep.retarget`); freando, o passo mira onde o corpo vai parar (v²/2a).
  Enquanto o corpo ainda freia, o assentamento da base espera (`standingSettleUntil`).
- **Saída correndo** (`RunOut`, chave `runOutEnabled`): drible parado + corpo indo para a frente ≥ 1,5 m/s (ou ≥ 3,2 m/s
  em qualquer direção) deixa de ser parado (`updateRunOut`): as pernas passam para a locomoção (a camada das pernas entra
  em rampa) e a base entrega os pés à trava de pé (`handOffPlant`) depois que o pé no meio de um passo pousa. O pé que a
  corrida já quer no ar fica no chão por 0,12 s como impulso (`footLock.pinned`, com a sola mais baixa no chão: preso pelo
  tornozelo a ponta entrava 4,6 cm no piso) e depois sobe até a pose do clipe.
- Deslize para o lado da mão da bola com os pés na base (o escape vai para o lado da mão nova): o drible é o do loop
  parado dessa mão (`chooseBase`). Os dois `Dribble_Side` só quicam com a mão do outro lado e a bola ficava 0,6 s na mão.
- `Freestyle`: o escape parado (`moveIsEscape`) não tem o giro do corte e, freando com o LS solto, segue de frente para a
  cesta; o crossover de ataque parado guarda 60% do ataque para a frente do núcleo (`EscapeAttackForward`) e freia a
  9 m/s² (`EscapeBrake`): desloca 1,52 m na diagonal (antes 1,18 m, virando de lado).

### Números (laboratório a 60 Hz; "antes" = código anterior, mesmo cenário)

| cenário | pé desliza máx (méd) | base máx |
| --- | --- | --- |
| escape_cross | 7,69 (0,94) -> 6,98 (0,52) m/s | 1,17 -> 1,14 m |
| escape_e_corre | 13,40 (1,28) -> 6,81 (0,91) | 1,06 -> 1,08 |
| por_tras_e_corre_depois | 13,22 (0,77) -> 7,88 (0,56) | 0,95 -> 0,92 |

A/B da saída correndo (`runOutEnabled` desligado x ligado, mesmo build, os 42 cenários com bola): só os 4 cenários novos
mudam; `escape_e_corre_lado` 18,0 -> 7,3 m/s, `por_tras_e_corre` 11,9 -> 6,5 m/s. Unitários e e2e (`movement`,
`freestyle`) passando.

### Pendências

- ~~Deslize lateral comum para o lado da mão da bola~~: feito, ver a seção 15.
- Correndo com a bola na esquerda depois do escape, a ponta do pé de impulso afunda ~2–3 cm no piso (passada do Mixamo).
- Saindo em diagonal, as coxas encostam 1–2 cm por ~10 quadros no começo da corrida (a corrida em diagonal já faz isso).

## 15. Deslize lateral para o lado da mão da bola: a bola presa na cintura (2026-10-16)

Os dois `Dribble_Side` da CMU só quicam com a mão do lado oposto ao deslize (Side_R anda para a esquerda com a bola na
direita; o espelho para a direita com a bola na esquerda). Deslizando para o lado da mão da bola o jogo tocava o Side da
outra mão: a bola ficava parada na cintura e a mão vazia fazia o drible no ar (`lado_direita`: 1 quique em 1 s; o espelho,
`lado_esquerda_mao_esq`: nenhum). Antes/depois: `docs/img/deslize-mao-da-bola-antes-depois.jpg`.

### O que mudou

- `PlayerAnimator.chooseBase`: para o lado da mão da bola o loop é o drible parado dessa mão (`Dribble_Idle_<mão>`, ou
  `Dribble_Low` com LT) e as pernas e a pelve vêm do Side da direção (`BaseState.legs`, aplicadas por osso em
  `applyBaseLegs`, com o tempo e a velocidade de passada próprios em `baseLegs`). Os quiques, o braço da bola, o braço de
  guarda e o drible baixo passam a ser da mão certa porque todos leem o nome do loop. Num drible no meio do deslize a
  camada das pernas usa as mesmas pernas, no mesmo tempo (`applyLegLayer`, `switchBase` casa a fase da passada).
- Só até 2,3 m/s (`SideBallLegsMaxSpeed`): o Side anda 1,23 m/s e toca até 1,7x; acima disso o pé rente ao chão
  arrastava a 9 m/s, e o corpo já vira para correr (Freestyle, 2,2 m/s). A saída desse modo é imediata (sem a histerese
  de 0,16 s): freando de lado, as pernas seguiam dando passos com o corpo parado por 10 quadros.
- Chave de A/B: `LAB_ANIM='{"sideBallLegsEnabled":false}'`. Cenários novos: `lado_esquerda_mao_esq`, `lado_bola_cruza`.

### Números (laboratório a 60 Hz, chave desligada x ligada, mesmo build, 44 cenários com bola)

Mudam 8 cenários; os outros 36 ficam iguais.

| cenário | quiques | pernas cruzando | bola no corpo | pé desliza máx (méd) |
| --- | --- | --- | --- | --- |
| lado_direita | 1 -> 3 | 4 -> 4 q | 2 -> 0 q | 4,42 (1,03) -> 6,05 (1,06) m/s |
| lado_esquerda_mao_esq | 0 -> 2 | 2 -> 4 | 0 -> 0 | 7,41 (1,02) -> 7,40 (1,19) |
| lado_bola_cruza | 2 -> 3 | 17 -> 12 | 6 -> 0 | 3,84 (1,17) -> 6,05 (1,27) |
| lado_cross_lado | 3 -> 4 | 21 -> 9 | 3 -> 0 | 6,87 (1,30) -> 8,33 (1,52) |

- Estalos do braço da bola: 8 -> 31 em `lado_direita`, porque ele passou a driblar (antes segurava a bola parado). É o
  nível de qualquer drible em movimento (`andando` 29, `lado_esquerda` 40).
- Os picos do pé são o pé que passa rente ao chão no próprio Side (ponta a 3,7–4,4 cm, conta como apoiado no laboratório);
  com o Side puro eles já existiam (3–4,4 m/s). Em `lado_cross_lado` o crossover acelera de lado até 3 m/s e a troca para
  as pernas da corrida custa 2 quadros a ~8 m/s.
- `para_e_cruza` tem um quique a menos só na janela do cenário: freando, o loop parado entra pela fase (antes entrava pela
  recepção depois de um quadro de Side) e a bola fica 0,25 s na mão em vez de 0,12 s; estendendo o cenário o ritmo é igual.
- Unitários (339) e e2e (`movement`, `freestyle`) passando. `tsc` acusa `e2e/_publicado.spec.ts` (arquivo de outra
  sessão, `hub` possivelmente nulo), fora deste trabalho.

## 16. Física da corrida sem bola, plantadas e hesitação com corpo (2026-10-16, sessão nba-34)

Pedido do diretor (com dois prints correndo sem bola): "corre um pouco com a ponta do pé", "anda na ponta do pé", "o braço
não tem movimentação realista", "o personagem vai correndo de um lado pro outro, ele tem que ter a física: o pé jogar um
pouco pro lado e dar um impulso dele se jogando pro outro lado", e na hesitação "o boneco nem se mexe; devia se jogar um
pouco pro lado". Antes/depois: `docs/img/corrida-sem-bola-antes-depois.jpg`, `virada-180-antes-depois.jpg`,
`parada-antes-depois.jpg`, `hesitacao-parada-antes-depois.jpg`, `hesitacao-correndo-antes-depois.jpg`.

### Diagnóstico

1. **Pé na ponta (causa raiz):** no mixamorig o osso do pé (tornozelo -> metatarso) desce 39° com o pé plano; no nosso
   esqueleto, 13–17°. O retarget copiava a direção crua: todo clipe do Mixamo (locomoção, IdleStand) deixava o pé ~25°
   apontado para baixo. O tornozelo do Mixamo também é mais alto, e as duas coisas se compensavam (a ponta encostava no
   chão, o calcanhar ficava no ar). O `flattenFoot` corrigia devagar (10/s, o apoio da corrida dura ~0,2 s).
2. **Braços:** sem bola, o tronco e os braços eram do loop Run/Walk da CMU (braços dobrados e quase parados na cintura);
   só pelve e pernas vinham do Mixamo.
3. **Física:** a inclinação pela aceleração era só da coluna (1,4°/(m/s²)); a virada freava em pé, parava de frente
   para a câmera e só então girava; a parada inclinava o corpo reto para trás com os pés juntos.
4. **Hesitação:** o clipe da CMU (gravado parado) quase não mexe o corpo; correndo, o drible freava a 30 m/s² (3,9 ->
   0,6 m/s em 0,1 s) com as pernas do clipe parado.

### O que mudou

- `mocap/Retarget.ts`: `footSlopeRest` (declive do pé da fonte, medido no IdleStand) é descontado girando o pé em torno
  do eixo lateral do quadril (pelo rumo horizontal do pé o eixo virava perto da vertical e o pé girava 40–50° num
  quadro). `?pemixamo=cru` volta ao antigo. Teste: `mocap/retarget.test.ts` (pula sem o `mixamo_loco.json`).
- `PlayerAnimator` (pés): trava de pé também pela sola da pose do clipe ANTES do agachamento (`clipSole`; a sola depois
  dele estava 12 cm mais baixa com a bola e travava pé no ar), só com as pernas do Mixamo na locomoção
  (`lockBySoleEnabled`); pé de apoio plano encosta no piso (`groundFlatEnabled`); a base parada que entra com um pé
  preso pela trava começa com ele onde está (pulava ~20 cm depois da parada).
- `PlayerAnimator.applyMixamoLegs`: sem a bola, tronco, pescoço e braços do clone do Mixamo (`MixamoUpperBones`,
  `mixamoUpperEnabled`); a spine_01 pega a orientação do tronco do clone e a pelve continua com a inclinação corrigida
  (sem a "bunda empinada"). A inclinação sem bola pela velocidade fica com 30% (o tronco do Mixamo já inclina).
- `PlayerAnimator.applyBodyLean` (`BodyLean`, `bodyLeanEnabled`): o corpo inteiro inclina atan(a/g)·ganho (pêndulo
  invertido: arrancar = à frente dos pés, frear = atrás, corte = para dentro da curva), com mola e com a pelve girando em
  volta de um ponto abaixo dela; desce o quadril com a carga da freada/corte. Com a bola fica 55% (a postura de
  infiltração já é baixa). A inclinação antiga só da coluna ficou com 35%.
- **Plantadas com root motion** (`anim/RootMotion.ts` + `PlayerAnimator.playPlantTurn/playPlantStop/cancelPlant`,
  `PlantClip`, ação `'Plant'`): clipes do Mixamo retargetados com o deslocamento e o giro do quadril tirados para uma
  trilha de raiz (a pose fica "no lugar"); o jogo anda e gira a raiz pela trilha (`takeRootMotion` + `takeRootYaw` +
  `plantVelocity`), como o spin. **Virada** (ChangeDir; `Turn_L` = o clipe, que vira para a esquerda; `Turn_R` =
  espelho): freia girando 90°, planta o pé de fora, desce o quadril (metade da descida do clipe é desfeita) e sai com o
  passo cruzado; ~0,8 s, entrada pela fase da passada mais parecida, giro escalado para o ângulo pedido.
  **Parada** (RunStop; `Stop_L/R`): o pé da frente planta e freia; o LS de volta depois do plantio corta. A regra
  "pernas nunca cruzam" sai durante a plantada e volta em rampa (o passo cruzado é de propósito).
- `Freestyle`: `tryPlant` (sem a bola, fora da defesa): correndo ≥ 2,8 m/s com o LS a > 125° da corrida -> virada para
  o lado do LS (quase 180°: para o lado da cesta); ≥ 3 m/s com o LS solto -> parada. Na plantada a posição é a do root
  motion e a velocidade é a da trilha (a saída continua dela); `?virada=0` desliga.
- **Hesitação** (`HesiBody`, `hesiBodyEnabled`): o quadril e o tronco vão para o lado da bola (ombro descendo, cabeça
  desfazendo 60%), a bola vai para fora junto (IK com peso do balanço: a inclinação girava a bola para dentro da coxa) e,
  parado, o pé do lado da bola dá um jab de 10 cm e volta. Correndo, o próprio movimento decide: freando é a de parada
  (o corpo sobe e o tronco se endireita, depois vai à frente); acelerando (escape com RT) só o jab de lado e o tronco à
  frente. `Freestyle`: a hesitação correndo freia a 12 m/s² e guarda 25% da velocidade (`HesiRun`). As pernas da
  locomoção na hesitação correndo foram testadas de novo e continuam fora (pernas cruzando 0 -> 4 quadros).

### Ferramentas novas

- `clipe-mixamo.html?clipe=ChangeDir&cam=lado|frente|tras|cima|diag&espelho=1&vel=1` (`src/mocap/clip-viewer.ts`):
  qualquer clipe do `mixamo_loco.json` no nosso jogador, retargetado como no jogo; `window.__clip.step(n)` para filmar.
  Clipes ainda não usados que valem a pena: `StartWalk`, `SideStep`, `StrafeL/R`, `CrouchF/B/L/R` (defesa).
- Cenários: `sb_anda_devagar`, `sb_arranca`, `sb_para`, `sb_vira_180`, `sb_vira_150`, `sb_vira_dispara`, `sb_vai_volta`,
  `sb_zigue`, `sb_corte_90` e `corre_hesi_freia` (hesitação correndo sem RT; com RT é a escape, `corre_hesi_arranca`).
- Para filmar uma vista com câmera parada no mundo (as do laboratório giram com o jogador): `window.__lab.lab` dá o
  renderer e a cena (campos privados acessíveis no JS).

### Números

Laboratório, build congelado antes (5186) x depois (5187), mesmos cenários. Soma dos 58 cenários a 60 Hz (os 15
principais a 144 Hz entre parênteses):

| métrica | antes | depois |
| --- | --- | --- |
| pé na ponta (quadros de apoio) | 1259 (732) | 300 (176), −76% |
| sola abaixo do piso (quadros) | 414 (192) | 160 (92) |
| pernas cruzando (quadros) | 1044 (825) | 667 (511) |
| bola no corpo (quadros) | 75 (53) | 47 (37) |
| deslize médio do pé (soma, m/s) | 52 (12) | 39 (10) |
| estalos | 3353 (2619) | 2892 (2516) |
| SALTOS | 2255 (237) | 2163 (225) |
| NaN | 0 | 0 |

Sem bola (13 cenários): pé na ponta 445 -> 65 quadros, SALTOS 491 -> 402, deslize médio 12,1 -> 8,7. Virada em
disparada: pernas cruzando 70 -> 41, pé na ponta 41% -> 9%; parada: pernas cruzando 79 -> 27, sola no chão 6 -> 0,
SALTOS 36 -> 25; hesitação correndo (`corre_hesi_freia`): deslize 5,6 -> 4,0 m/s, SALTOS 49 -> 41. Unitários 403/403
e e2e `movement`, `freestyle` e `finish` (19) passando.

Pioram em um cenário só (picos de um quadro): deslize máximo em `corre_spin`/`spin_e_dispara`/`spin_na_linha` (~7 -> 9 m/s;
some com `?pemixamo=cru`, o pé corrigido muda o pico do giro), `anda_entre_pernas` (6 -> 8,7) e `sb_vai_volta` (10 -> 14); SALTOS
em `escape_e_corre_lado` (45 -> 52) e `sb_vira_dispara` (59 -> 65).

### Pendências

- O online não grava as plantadas (`AnimRecorder` não embrulha `playPlantTurn/playPlantStop/cancelPlant`): o boneco
  remoto anda e gira pela rede, mas com a locomoção comum. Se entrarem no gravador, o `RemotePlayer` precisa descartar o
  `takeRootYaw()` também (como já descarta o `takeRootMotion()`).
- Plantadas só sem a bola. Com a bola a virada e a parada continuam pelos dribles e pela freada de sempre.
- A virada usa ~135° do clipe; o resto (até 180°) o jogo gira correndo nos primeiros passos.
- A hesitação parada ganhou estalos de braço (18 -> 30; os SALTOS em cm ficaram 13 -> 16), pelo movimento maior.
- `combo_rapido`: o jab da hesitação aparece como deslize de pé (2 m/s) na métrica.
