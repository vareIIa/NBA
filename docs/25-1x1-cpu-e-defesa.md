# 25 — 1 contra 1 contra a CPU e a defesa (toco físico, postura, contestação)

> Sessão nba-b0, 2026-10-16. Pedido do diretor: "tem como o personagem dar toco no outro: clica Y, ele pula e manda a
> bola para longe? Ele consegue roubar a bola? A gente precisa de gameplay fluida e divertida." Complementa
> `06-gameplay-defesa.md` (o desenho da defesa) e `24-multiplayer-online.md` §6 (a defesa do online, que esta sessão
> herdou da sessão "Defesa do 1x1 online"). Código: `web/src/game/cpu/`, `web/src/sim/HoopsBlock.ts`,
> `web/src/game/BlockWatch.ts`, `web/src/anim/DefenseMotion.ts`, `web/src/menu/CpuSetup.ts`.

## 1. O que mudou

| Antes | Agora |
|---|---|
| Defesa (toco, roubo, contestação) só no Online 1x1, contra outra pessoa. No Freestyle, contestação sempre 0 | **1 contra 1 contra a CPU** no menu (era "EM DESENVOLVIMENTO"): a CPU marca, contesta, dá toco, rouba e ataca com a build dela, com as regras do online |
| Toco sorteado na soltura: mão parada × os primeiros 0,3 s da subida, bola desviada para um lado qualquer, a mão do defensor não ia à bola | **Toco físico**: a mão ao longo do pulo inteiro × a trajetória real (aro e tabela inclusos), decidido quando o contato está para acontecer; a mão vai até a bola e a bola espirra para longe |
| Enterrada nunca tomava toco; bandeja só depois de a bola sair da mão | **Toco no aro**: o defensor no ar arranca a bola da mão de quem sobe para a bandeja/enterrada (menos na enterrada) |
| Sem interferência | **Goaltending**: tocar na bola descendo acima do aro = cesta valendo |
| Defensor corria como sem bola (deslize lateral ~2,1 m/s contra 3,9 m/s do atacante) | **Postura de defesa**: perto do atacante, agachado (13 cm) com as mãos abertas e deslize/recuo até ~3,5 m/s (LT = defesa intensa) |
| O tapa do toco não fazia barulho; quem tocou pegava a bola na hora | Som do tapa, tranco da câmera, "TOCO!", e 0,45 s em que ninguém pega a bola (ela voa) |

## 2. O modo (como jogar)

Menu principal → **1 contra 1** → escolha **Adversário**, **Nível**, pontos, cestas (1 e 2 / 2 e 3), make it take it e
relógio de posse → **Jogar**. A última escolha fica salva (`localStorage garrafao.cpu`).

| Adversário | Build (preset do builder) | Estilo da IA |
|---|---|---|
| Rafa Flash (SF 1,98) | Infiltrador | Ataca o aro e enterra; pune quem pula |
| Zé Bala (SG 1,91) | Arremessador | Step-back e bola de 3 com espaço |
| Dudu Maestro (PG 1,85, canhoto) | Armador | Muito drible, rouba bola, Glove e Unpluckable |
| Tiago Muralha (C 2,11) | Pivô protetor de aro | Espera no garrafão para dar o toco |
| Caio Cadeado (SF 2,01) | 3&D | Marca colado no perímetro |

As builds são de verdade (`cpuBuild`: os mesmos tetos, pontos e presets do MyPlayer Builder). O **nível** mexe só na
cabeça, nunca nos atributos (`CpuLevels` em `CpuRoster.ts`):

| Nível | Reação da defesa | Erro do timing do arremesso | Erro do tempo do pulo | Mordida no pump fake | Ruído nas decisões |
|---|---|---|---|---|---|
| Calouro | 0,34 s | ×1,9 | 0,14 s | alta | 0,45 |
| Profissional | 0,25 s | ×1,35 | 0,09 s | média | 0,28 |
| All-Star | 0,19 s | ×1,05 | 0,06 s | baixa | 0,16 |
| Hall da Fama | 0,14 s | ×0,82 | 0,045 s | quase nenhuma | 0,08 |

**URL** (testes e atalho): `?cpu=<flash|bala|maestro|muralha|cadeado>&nivel=<rookie|pro|allstar|hof>` abre direto na
partida, sem menu. Também: `&ataque=cpu` (a CPU começa atacando), `&alvo=N` (pontos para vencer), `&sorte=1` (testes:
todo toco e todo roubo possível do jogador sai), `&autoplay=<nível>` (o jogador também vira CPU: CPU contra CPU).

Controles da defesa (os mesmos do online, docs/24 §6.3): **Y** (K) pula — contestação, toco e rebote no ar; **RS para
cima** (↑) mãos para cima; **X** (Espaço/J) tapa do roubo; **LT** (Q) defesa intensa; **RT** corre virado. Bola solta:
**X** pega o rebote parado e **Y** pula e pega, com as duas mãos (§4).

## 3. Toco físico (`sim/HoopsBlock.ts`, `game/BlockWatch.ts`)

Quem arremessa decide (no online o lance é dele; contra a CPU, o mesmo caminho dos dois lados):

1. **A bola**: a cada quadro do voo, o caminho dela pela própria física (`samplePath`: um clone da bola no `BallSim`,
   com aro e tabela) pelos próximos 0,9 s.
2. **A mão**: o ombro do defensor sobe com o pulo (`jumpLiftAt`, a mesma parábola do `DefenseMotion`: agacha 0,1 s e
   voa) e o braço (42% da envergadura) alcança uma esfera em volta dele. No chão e sem as mãos em cima, um pouco menos.
3. **O contato**: o primeiro instante em que a bola passa ao alcance da ponta dos dedos (raio da bola + 3 a 10 cm pelo
   rating de toco), acima do ombro e a mais de 0,45 m da soltura (antes disso a bola ainda está na mão e no braço de
   quem arremessa: seria falta). Bola descendo acima do aro, a até 2,5 m dele = **interferência** (a cesta vale: o
   arremessador relata `g.result` com cesta; o protocolo não mudou).
4. **A decisão sai uma vez por pulo**, quando o contato está a no máximo 0,16 s (a mão ainda tem tempo de chegar). Um
   pulo que começa depois da soltura também conta (toco atrasado, chase-down).
5. **Pegou?** `blockSuccess` = 0,2 + 0,3·rating de toco + 0,5·quão em cheio (máx. 95%); arremesso de longe × 0,4
   (`JumperBlockScale`). Pegou em cheio = **tapa** (a bola vai para longe da cesta, 5,5–10 m/s, um pouco para baixo ou
   para cima); de raspão = **desvio** (segue torta e devagar). Não pegou = a mão passa um palmo atrasada, por baixo.
6. **Toco no aro**, antes da soltura (`finishBlock` + `Freestyle.stripBall`): com o defensor no ar alcançando a bola na
   mão de quem sobe para a bandeja/enterrada, a mesma chance × 0,45 na bandeja e × 0,3 na enterrada (`FinishResist`) e
   × 0,6 vindo de trás (`ChaseDownScale`). A bola é arrancada e o corpo de quem finaliza segue o plano até pousar.
7. **Na tela**: a mão do defensor vai por IK até o ponto do contato no instante dele e segue o tapa
   (`PlayerAnimator.playBlock` → `DefenseMotion.block`); som do tapa (`Sfx.block`), tranco de 6–8 cm na câmera
   (`CameraRig.kick`), "TOCO!" e 0,45 s em que ninguém pega a bola (`BlockNoClaimS`). No online, o arremessador põe o
   tapa no boneco do defensor (o pulo dele chega pela rede: `RemotePlayer.defenseJump`), e o defensor sente o tapa
   quando o juiz confirma o toco.

Calibração (CPU contra CPU, abaixo): ~13% dos arremessos tomam toco, quase todos no aro ou de defensor colado e no
tempo; jump shot de longe só com defensor alto, colado e pulando junto com o arremessador. O teste de laboratório
(`cpu-toco`): colado a 0,74 m de um arremesso de meia, o Y entre 0 e 150 ms depois do começo do arremesso dá toco; com
200 ms ou mais a bola já passou (só a contestação, 1,0).

## 4. Postura de defesa e contestação

- **Postura** (`net/defense.ts` `stanceFor`/`slideFor`, `DefenseMotion.setStance`): inteira até 2,4 m do atacante, some
  até 3,6 m; sem RT e com a bola na mão do atacante. O quadril desce 13 cm (o `applyStance` do animador soma
  `stanceCrouch()` ao agachamento sem bola) e as mãos vão abertas para fora dos ombros. O deslize de lado e o recuo vão
  até 0,55 + 0,35·postura da velocidade de corrida (`Freestyle.defenseSlide`), pela defesa de perímetro (25 → 65%,
  99 → 100% do extra), +15% com LT. No online, o boneco do oponente defensor faz a mesma postura pela mesma regra.
- **Contestação**: a de antes (`HoopsContest` com as mãos e o pulo de verdade). Contra a CPU, quem defende vê na hora
  "Sufocado!" (≥ 0,7), "Contestado" (≥ 0,4) ou "Livre!" (< 0,12) no arremesso dela, mesmo quando a bola entra.
- **Braços** (diretor, 2026-10-16: "quando ele vai levantar os braços para contestar, gira os dois lados meio
  estranho"; o mesmo no toco e no rebote). A mão ia em linha reta da coxa até acima da cabeça: passava pelo ombro e o
  cotovelo abria para trás (asa de galinha, mãos atrás da cabeça). Agora ela sobe num arco pela frente do corpo (braço
  quase esticado à frente do rosto no meio da subida), o cotovelo aponta para baixo no começo e para fora e um pouco à
  frente no alto, e a mão é orientada: dedos para cima, palma para a frente (no toco, a palma vira para a batida).
  Antes e depois: `docs/img/defesa-bracos-antes-depois.jpg`. Folha de quadros: `node tools/defesa-folha.mjs <pasta>
  <maos|pulo|toco|rebote-x|rebote-y>` + `python tools/defesa-folha.py <pasta> <saida.jpg>`.
- **Rebote com as duas mãos** (`game/ReboundCatch.ts`, `DefenseMotion.catchBall`): X pega parado, Y pula e pega. As
  mãos vão abertas para os lados da bola e fecham nela no instante do contato (previsto pela trajetória), a bola fica
  presa às mãos (desce junto no pulo), vai para o peito e só então desce para o drible. Bola acima de 0,95 m só com as
  mãos; abaixo, passando por cima. `docs/img/rebote-duas-maos.jpg`.

## 5. A CPU (`game/cpu/`)

| Arquivo | O que faz |
|---|---|
| `LocalHub.ts` | O juiz do online (`net/hub/Referee`) rodando no navegador. Para o `OnlineMatch` do jogador faz o papel do `NetClient` (`MatchNet`); a CPU fala por `fromCpu`/`onCpu`. As mensagens chegam depois do quadro (microtarefa), o jogador antes da CPU, como na rede. O relógio da partida é o tempo de jogo (parado enquanto a CPU carrega). Revanche: a CPU sempre aceita |
| `CpuOpponent.ts` | O jogador da CPU: um `Freestyle` próprio (o mesmo jogo: drible, arremesso, bandeja, física) com animador e uniforme branco. Faz do lado dela o que o `OnlineMatch` faz do lado do jogador (check, defesa sem bola, corpo a corpo, rebote, limpar, toco e contestação no arremesso dela). Para o `OnlineMatch` é o oponente (`MatchOpponent`), no lugar do boneco remoto |
| `CpuBrain.ts` | A cabeça: lê a vista e devolve o controle (LS, RT, LT, X, Y, RS). Dribles saem de **gestos de verdade no Pro Stick** (`StickScript`: flick na borda, giro de 300°, meio giro), passando pelo mesmo reconhecedor do jogador |
| `CpuSight.ts` | A vista de um lado (posições, fases, bola, exposição, bandeja do outro, previsão do rebote pela física) |
| `CpuRoster.ts` | Adversários, builds e níveis |
| `AutoPilot.ts` | A cabeça no lugar do controle do jogador (`?autoplay`): CPU contra CPU para calibrar |

**Defesa**: vê o atacante `reactionS` atrás e antecipa pela velocidade; fica entre ele e a cesta numa distância pela
zona e pelo arremesso dele (de 3: 1,0–1,75 m; meia: 0,95–1,5 m; perto do aro: 0,75 m; longe do alcance: 2,2 m); o
protetor de aro recua para o aro na infiltração; batido, corre (RT) para a frente dele. No arremesso: mãos para cima
depois da reação; **tenta o toco** (pula cedo, pelo começo do arremesso) com chance pelo rating de toco, colado, mais a
mordida do nível (o calouro pula em tudo e cai no pump fake; o Hall da Fama espera o arremessador sair do chão e só
contesta); percebe o pump fake com o mesmo atraso de reação. Na bandeja: pula no tempo da soltura. **Roubo**: tapa
quando a bola dele fica exposta perto (quanto mais exposta e mais "jogadora" a CPU, mais tapas), e fica desequilibrada
0,35 s depois de cada tapa (o atacante passa).

**Ataque**: limpa a bola quando precisa (LT com o defensor perto); a cada ~0,25–0,5 s lê o defensor (distância, se
está na frente, no ar, batido, fechando rápido) e escolhe por utilidade + ruído do nível: arremessar (pela chance do
arremesso daqui e o espaço), infiltrar (pelo lado em que o defensor não está; bandeja, ou enterrada com RT se a build
enterra e o estilo gosta), driblar para criar (step-back colado se é arremessador, crossover/por trás/entre as pernas/
spin para atacar o outro lado, saindo com o LS para o lado da mão nova) ou pump fake no defensor que fecha correndo.
Cortada na infiltração: spin, crossover ou pull-up. O arremesso é X segurado e solto na janela ideal + erro normal
(σ = 150 → 75 ms pelo rating, × o nível). Relógio de posse acabando: arremessa o que tiver.

**Rebote**: os dois correm para o primeiro ponto do caminho da bola baixo o bastante para pegar (a física de verdade)
e pulam (Y) na bola alta perto ou pegam parados (X) a bola na altura do peito, com as duas mãos, como o jogador. Na bola
baixa a CPU pega um pouco mais perto que o jogador (empate é do jogador).

## 6. Medido (CPU contra CPU, 2026-10-16)

`?autoplay=pro` contra cada adversário, 150 s cada, 60 FPS com dois jogos abertos ao mesmo tempo:

| Confronto | Piloto (build padrão) | CPU | Tocos (piloto / CPU) | Roubos |
|---|---|---|---|---|
| Rafa Flash (Pro) | 4/8 (50%) | 6/7 (86%, infiltrando) | 1 / 1 | 0 |
| Zé Bala (Pro) | 4/9 (44%) | 3/7 (43%) | 1 / 0 | 0 |
| Tiago Muralha (All-Star) | 4/8 (50%) | 5/6 (83%) | 1 / 2 | 1 |

~10 s por posse, nenhum estouro de relógio, partida até 7 em ~2,5 min. Antes do ajuste da chance do toco no aro e do
fator do jump shot, eram 4 tocos da CPU em 6–8 arremessos (alto demais).

## 7. Testes

- `npx vitest run src/game/cpu src/sim/HoopsBlock.test.ts src/anim/DefenseMotion.test.ts`: o juiz local (check, cesta,
  roubo e toco da CPU, revanche), os gestos da CPU no reconhecedor do Pro Stick, a defesa da CPU (posição, contestação,
  pump fake), o toco físico (pulo = DefenseMotion, bandeja, jump shot, interferência, toco no aro).
- `E2E_ORIGIN=<Vite sem HMR> npx playwright test e2e/cpu.spec.ts`: o menu abre o modo; toco (Y na hora) e roubo do
  jogador na CPU; a CPU pontua, marca com postura e fecha a partida; revanche. Não precisa do servidor de salas.
  Um Vite sem HMR numa porta livre: `PUBLICAR_PORT=5193 npx vite --config deploy/vite.teste.config.ts`.
- O `e2e/online.spec.ts` continua passando (a defesa do online usa o mesmo toco físico).
- Ganchos de depuração: `window.__cpu` (o jogador da CPU; `__cpu.force('shoot'|'drive'|'pump'|'idle')`),
  `window.__garrafao.online().cpu` (decisão, fase, postura, contagens), `window.__debug.rig` (a câmera).

## 8. Próximos passos (para ficar como o 2K)

1. **Roubo que espirra**: hoje o tapa que rouba leva a bola direto à mão de quem roubou. No 2K a bola muitas vezes fica
   solta (disputa). Precisa de um evento novo no juiz e no protocolo (versão 3, publicação conjunta).
2. **Contato no drible** (bump/cutoff): o atacante que entra no defensor plantado perde velocidade e desequilibra; o
   defensor que chega atrasado é empurrado. Hoje os corpos só se separam.
3. **Ankle breaker**: o vetor de compromisso do defensor (docs/06 §2) para o crossover na hora certa derrubar quem se
   comprometeu (a CPU já reage com atraso e fica desequilibrada depois do tapa).
4. **Enterrada de contato** contra o toco no aro (posterizer × protetor de aro: badges de enterrada contra Rim Protector).
5. **Câmera de defesa**: na defesa o atacante fica entre a câmera e o defensor e às vezes esconde a mão do toco.
6. **Locomoção da postura**: os clipes `CrouchL/R/F/B` do Mixamo já estão no `mixamo_loco.json` e podem ser as pernas
   do deslize (hoje são as da passada sem bola; dono: a sessão da fluidez de movimento).
7. **Passe** (para o 3x3 e o 5x5) e IA de time; badges de defesa ativos na CPU (Clamps, Rim Protector, Interceptor).
