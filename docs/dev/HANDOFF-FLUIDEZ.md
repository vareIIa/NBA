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
