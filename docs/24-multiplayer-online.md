# 24 — Multiplayer online: hospedagem e modelo de rede

> Pedido do diretor (2026-10-16): preparar o multiplayer e decidir onde hospedar, de preferência Vercel ou Netlify,
> para jogar com um amigo que abre a mesma URL.
> **Status: proposta.** Hospedagem recomendada abaixo (§2); falta o diretor aprovar e criar a conta. O trabalho foi
> dividido entre duas sessões (§7).

## 1. Resposta curta

- **O jogo (os arquivos do site) pode ficar no Vercel ou no Netlify.** É um site estático de ~23 MB (`npm run
  build:deploy`) e qualquer um dos dois serve de graça.
- **A sala em tempo real não fica bem em nenhum dos dois.** Um jogo online precisa de uma conexão aberta o tempo todo
  (WebSocket) entre os jogadores e um servidor de sala:
  - **Netlify:** não tem WebSocket.
  - **Vercel:** tem WebSocket em beta desde jun/2026. No plano grátis a conexão cai a cada 5 min, e dois jogadores da
    mesma sala podem cair em servidores diferentes (precisaria de Redis no meio).
- **Recomendação: Cloudflare (grátis) para as duas coisas.** Um Worker serve o jogo e o lobby na mesma URL. O lobby
  inteiro (fila, salas privadas, partidas) roda num Durable Object só, um "mini-servidor" que mantém os jogadores
  conectados. Ele fica no leste dos EUA (§3), não no Brasil. O amigo abre o link
  `https://garrafao.garrafao-web.workers.dev/?sala=K7QF` e entra.
- Se o diretor preferir o site no Vercel/Netlify, dá do mesmo jeito: só o lobby fica no Cloudflare, e o site aponta para
  ele (variável `VITE_MP_URL=wss://<nome>.workers.dev/ws` no build; `?mp=<url>` na página também troca).

## 2. Comparação

| | Site (estático) | Sala em tempo real | Custo para 1x1 entre amigos | Observação |
|---|---|---|---|---|
| **Cloudflare Workers + Durable Objects** | Sim (assets do Worker) | **Sim**, WebSocket num Durable Object | **Grátis** (cálculo em §3) | Uma conta, um comando de publicação, uma URL. **Recomendado** |
| Vercel | Sim | Beta; conexão fecha em 300 s no Hobby; sem garantia de mesma instância | Grátis o site; sala inviável sem Redis | Bom para o site |
| Netlify | Sim | Não | Grátis o site | Bom para o site |
| Render (free) | Sim | Sim (Node `ws`) | Grátis, mas dorme após 15 min sem uso (1º acesso leva ~1 min) | Alternativa se fugir do Cloudflare |
| Fly.io / Railway | Sim | Sim | Pago (poucos dólares/mês) | Para depois, se precisar de servidor autoritativo pesado |

## 3. Limites do plano grátis do Cloudflare (conferidos em 2026-10-16)

- Durable Objects entram no plano grátis (classe SQLite): **100 mil requisições/dia** e **13.000 GB-s/dia**. Cada
  mensagem WebSocket que chega ao objeto conta como 1/20 de requisição. Os limites zeram às 00:00 UTC; passou, a sala
  dá erro até o dia seguinte (nada é cobrado no plano grátis).
- O lobby inteiro é **um** Durable Object (`hub`): fila de partida rápida, salas privadas e os relógios do 1x1. Ele fica
  acordado enquanto houver alguém conectado (os relógios precisam rodar), então a duração é a mesma com 1 ou 10
  partidas.
- Conta para uma partida 1x1 com os dois mandando 20 estados/s:
  - mensagens: 2 × 20 × 3600 = 144 mil/h = **7.200 requisições/h**, ou seja, ~14 h de partida por dia (somando todas);
  - duração: 128 MB × 3600 s = 450 GB-s/h, ou seja, ~29 h com alguém conectado por dia.
  - **Sobra para jogar ~14 h por dia de graça.** Com mais gente, o plano pago custa US$ 5/mês.
- **Onde o lobby roda:** Durable Objects ainda não nascem na América do Sul. A dica `sam` do Worker cai no leste dos
  EUA, e um objeto não muda de lugar depois de criado (docs da Cloudflare, "Data location", conferido em 2026-10-16).
  Medido do Rio (borda GIG a ~10 ms): ping de ~140 ms até o lobby. Para jogar entre amigos dá; para baixar, ver §5.
- Assets: até 20 mil arquivos e 25 MiB por arquivo no grátis. O maior arquivo do jogo tem 6,2 MB (`hoops_player.glb`).

## 4. Como publicar (Cloudflare)

**No ar desde 2026-10-16: https://garrafao.garrafao-web.workers.dev** (conta Cloudflare do diretor, plano grátis).
Testado lá com dois navegadores: sala pelo menu, convite pelo link, check, boneco remoto, arremesso e placar iguais
nos dois lados, sem erros.

1. Criar uma conta grátis em `dash.cloudflare.com` (o diretor faz; o Claude não cria contas).
2. Na pasta `web/`, uma vez: `npx wrangler@4.147.0 login` (abre o navegador para autorizar).
3. Publicar: `npm run deploy`. Isso roda o build de publicação e manda o site e a sala. Ao final, o wrangler mostra a
   URL (`https://garrafao.<conta>.workers.dev`).
4. Jogar: o lobby do jogo cria a sala e dá o link `…/?sala=CÓDIGO` para mandar ao amigo.

Notas:
- **Testar antes de publicar:** `npm run deploy:local` sobe o mesmo Worker em `http://localhost:8787` (sem conta). Em
  2026-10-16 ele foi testado assim de ponta a ponta: site e `.glb` servidos, duas conexões, sala privada, prontos,
  partida começando, estado repassado e ping.
- **Publicar da máquina local, não pelo git.** Os `.glb` estão no Git LFS e nem todo build por git baixa o LFS (no
  Vercel é preciso ligar a opção). Pela máquina local os arquivos já são os de verdade.
- `npm run build:deploy` (`web/deploy/vite.config.ts`) é o build normal **sem** `public/assets/models_raw`. Os modelos
  brutos do HY 3D (2,9 GB, fora do git) moravam em `public/` e o `vite build` comum os copiava para o `dist` (2,9 GB,
  com arquivos acima de 25 MB). Com o build de publicação, o `dist` tem ~23 MB.

### 4.1 No ar (2026-10-16)

| | URL | Como republicar (na pasta `web/`) |
|---|---|---|
| **Jogo + sala (Cloudflare)** | https://garrafao.garrafao-web.workers.dev | `npm run publicar` (os dois juntos) |
| **Jogo na Vercel** (usa a sala da Cloudflare) | https://garrafao.vercel.app | `npm run publicar` (os dois juntos) |

**Para jogar com os amigos, use https://garrafao.vercel.app** (o outro endereço é o mesmo jogo e a mesma sala).

- Os dois endereços servem o mesmo jogo e entram na **mesma sala**: um amigo pode abrir um e o outro o outro. Convite:
  `https://garrafao.vercel.app/?sala=CÓDIGO` (o lobby gera o link do site em que você está).
- A sala vem de `web/.env.production` (`VITE_MP_URL`), lido em todo build de produção. Se o subdomínio do Worker mudar,
  troque ali e republique os dois.
- Contas usadas: o `wrangler login` feito no PC do diretor (conta Cloudflare dele; o Durable Object `hub` nasceu no
  leste da América do Norte, ~140 ms de ping a partir do Rio, ver §3) e o login da Vercel já existente no PC (time
  pessoal `vareiias-projects`, projeto `garrafao`).
- **Quem publica:** uma sessão só, a dona do release (em 2026-10-16, a "Multiplayer 1v1"). As outras sessões não rodam
  `deploy`, `wrangler`, `vercel`, `git commit` nem `git push`: pedem a ela. O servidor e os dois sites saem sempre
  juntos do mesmo build; publicar um só derruba o outro (versão do protocolo diferente).
- `npm run publicar` (`web/deploy/publicar.mjs`): recusa se houver código não commitado em `web/`, roda `tsc`, `vitest`
  e `e2e/online.spec.ts` num Vite próprio (primeira porta livre a partir da 5182), faz **um** build e manda o mesmo
  `dist` para a Cloudflare e para a Vercel. `npm run deploy` e `deploy:vercel` continuam existindo, mas sozinhos
  publicam só um lado.
- **Republicar com várias sessões editando `web/`:** o build pega o que está na pasta naquele instante, inclusive edição
  pela metade de outra sessão. O `build:deploy` roda o `tsc` antes e para se algo não compilar; para ter certeza, copie
  `web/` (sem `node_modules`, `dist` e `models_raw`) para uma pasta à parte, rode `tsc`, `vitest` e o
  `e2e/online.spec.ts` lá e publique dessa cópia (foi assim na primeira publicação: os dois testes de dois navegadores
  passaram contra o Worker publicado e contra a Vercel).

## 5. O jogador do outro na tela (boneco remoto)

Código: `web/src/online/`. O jogo hoje anima um jogador só, e a bola segue a mão animada (`BallDribbler`). O adversário
na tela é um **boneco que repete os comandos de animação** do outro jogador, não um vídeo de poses:

- Do lado de quem joga, o `AnimRecorder` se pendura no `PlayerAnimator` local e anota cada comando (drible X com a mão
  Y em Z s, arremesso com a forma W, bandeja com o plano P, comemoração, mãos para cima, pulo de contestação, tapa do
  roubo…) e, a cada quadro, a entrada exata da locomoção (`AnimInput`), a posição, a direção e o estado da defesa
  (quanto das mãos está em cima e a altura do pulo, que a contestação do outro lado lê). Não lê nem muda o Freestyle.
- Do outro lado, o `RemotePlayer` tem o próprio `PlayerAnimator`, a roupa branca e a própria bola. Ele toca os mesmos
  comandos e, enquanto o outro está com a bola no drible, a bola fica presa à mão **do boneco** (a rede nunca tira a
  bola da mão dele). No voo e com a bola solta, mostra a bola que veio pela rede (quem arremessou manda nela).
- Posição e velocidade chegam 20 vezes por segundo e são interpoladas ~100 ms no passado; o atraso fica escondido
  atrás da animação. Teletransporte (bola de saída) não é interpolado: o boneco pula para o lugar novo.
- **Relógio:** cada mensagem leva o relógio de quem mandou. Quem recebe estima a diferença pelo menor atraso visto e
  toca comandos e posições na mesma linha do tempo, então um drible começa exatamente onde o jogador estava.
- **Nada que vem do outro jogador é confiável:** toda mensagem é validada (tipos, números finitos, nomes de dribles
  conhecidos) e um comando que falhar é descartado sem derrubar o jogo.
- **WebSocket pela sala primeiro, WebRTC depois.** O lobby fica no leste dos EUA (§3), então o estado de um jogador
  vai do Brasil aos EUA e volta ao outro: ~140 ms de ping medido do Rio. Conexão direta entre os navegadores (WebRTC)
  cortaria a ida aos EUA, mas sofre com o CGNAT das operadoras. Pode entrar depois sem mudar o boneco.

**Medido (2026-10-16, teste de eco `web/tools/eco-boneco.mjs`).** O boneco repete o próprio jogador com 60 ms de rede
+ até 25 ms de jitter, 20 envios/s, Chromium headless a 60 FPS:

| Medida | Resultado |
|---|---|
| Tamanho do envio | ~210 bytes em média; ~2 KB no quadro que leva o plano da bandeja |
| Buffer escolhido pelo relógio | ~115 ms |
| Raiz do boneco fora do caminho do jogador | média 3–6 mm, pior quadro 5 cm (bandeja) |
| Bola presa: distância do centro da bola à palma mais perto (média do ciclo do quique) | boneco 0,19–0,23 m; jogador local 0,19–0,22 m (igual) |
| Dribles, arremesso com comemoração, enterrada pendurando no aro | mesma sequência, ~150 ms depois; nenhum payload recusado, nenhum comando falhou |

Rodar de novo: `node tools/eco-boneco.mjs <pasta> [roteiro] [opções]` com `ECO_ORIGIN` apontando para um Vite sem HMR
(o roteiro usa o formato do `tools/capturar.mjs`; `'{"offset":[0,0,0],"hideLocal":true}'` mostra só o boneco).

## 6. Netcode e regras do 1x1

Código: `web/src/net/` (protocolo, cliente, `hub/`), `web/server/dev.ts`, `web/src/menu/OnlineLobby.ts`,
`web/src/game/OnlineMatch.ts`, `web/src/hud/OnlineHud.ts`.

### 6.1 Quem manda em quê

| O quê | Quem decide | Por quê |
|---|---|---|
| Meu jogador (movimento, dribles, arremesso, timing do green) | **meu navegador** | Zero atraso no controle; o timing é julgado no cliente (`03-arremessos.md` §9) |
| A bola (drible, voo, bola solta depois do erro) | **o navegador de quem tem a posse** | A física da bola já roda a 120 Hz no Freestyle de quem arremessou |
| Placar, posse, check-ball, rebote, roubo (sorteio), toco (bola solta), limpar a bola, relógio de posse, vitória, queda de conexão | **servidor (`Referee`)** | Os dois veem o mesmo placar; um relato atrasado de outra posse é ignorado (`seq`) |
| Contestação e toco do meu arremesso | **meu navegador** (com o estado do defensor que chegou) | A soltura é minha; o toco desvia a minha bola na hora |
| O oponente na minha tela | boneco remoto (§5) | Estado dele 20×/s, ~100 ms no passado |

O servidor nunca simula a bola nem o corpo: ele recebe relatos (`g.release`, `g.result`, `g.claim`, `g.cleared`,
`g.block`, `g.steal`) e decide. Entre amigos isso basta; ranqueado exige validar os relatos (distância, tempo de voo) ou servidor autoritativo.

### 6.2 Lobby e sessão

- **Partida rápida:** entra na fila; os dois primeiros formam uma sala e a partida começa sozinha.
- **Sala privada:** "Criar sala" dá um código de 4 letras (sem 0/O/1/I/L) e o link `…/?sala=CÓDIGO`. O amigo digita o
  código ou abre o link (o menu abre direto no lobby e entra). Quem criou escolhe as regras; os dois apertam **Pronto**.
- **Regras (padrão de rua, `docs/10-modos.md`):** até 11, cestas de 1 (dentro) e 2 (fora da linha de 3), sem make it
  take it, limpar a bola no rebote defensivo, relógio de posse de 24 s, sem vencer por 2. Dá para mudar: 7/11/15/21,
  cestas 2 e 3, make it take it, vencer por 2, relógio 12/24/sem.
- **Revanche:** no fim, os dois pedem e outra partida começa na mesma sala, com o primeiro ataque trocado.
- **Queda de conexão:** o cliente reconecta sozinho (token na sessão da aba). A partida congela por até 30 s esperando;
  voltou, a posse recomeça com um check do mesmo atacante (o placar fica). Não voltou: W.O. Sair no meio também é W.O.
- **Duas abas no mesmo PC são dois jogadores** (o token fica no `sessionStorage`): dá para testar sozinho.

### 6.3 Uma posse

1. **Check** (2,5 s; 5 s no primeiro, para carregar o boneco do oponente): o atacante aparece 1 m além da linha de 3,
   com a bola; o defensor 1,7 m à frente dele, entre ele e a cesta. Ninguém se mexe até "Valendo!".
2. **Bola viva:** quem ataca joga o Freestyle de sempre. Quem defende fica **sem bola** (o Freestyle dele vai para a fase
   da bola solta com a bola escondida) e **de frente para o atacante** (desliza de lado e recua; com RT corre virado).
3. **Corpo a corpo:** os dois não se atravessam (raio de 32 cm). Cada navegador empurra o próprio jogador metade da
   sobreposição.
4. **Defesa (botões do 2K):** **Y** (teclado **K**) pula com os dois braços esticados (contestação, toco e rebote no
   ar); **RS para cima** (teclado **↑**) levanta as mãos enquanto segura; **X** (teclado **Espaço/J**) dá o tapa do roubo.
   A pose é procedural (`web/src/anim/DefenseMotion.ts`, no `PlayerAnimator`) e vai pelo gravador para o boneco do outro
   lado (ops `hands`, `contest`, `steal`). No ar o analógico não mexe o corpo até pousar. Pulo pela impulsão da build
   (0,40 m no 25, 0,75 m no 99).
5. **Contestação:** na soltura, o arremessador calcula a contestação com o `HoopsContest` (altura, envergadura e defesa
   de perímetro do defensor) usando o **estado real do defensor**: mãos e pulo da amostra mais nova que chegou (sem o
   buffer de ~100 ms do boneco). Sem botão, a posição sozinha conta até 40% das mãos (perto de 1,4 m).
6. **Toco:** se o defensor está no ar (pulo ≥ 12 cm) com a mão a até 0,30–0,45 m (rating de toco) da subida da bola
   nos primeiros 0,3 s, o cliente do arremessador sorteia (`blockChance`, `web/src/net/defense.ts`). Tocou: a bola
   desvia para longe da cesta quando chega à mão e vai `g.block`; o juiz solta a bola na hora (evento `block`).
   Enterrada (bola saindo para baixo) não toma toco.
7. **Roubo:** o tapa sai sempre; com a bola do atacante no drible e ao alcance (meia envergadura + 0,3 m), o defensor
   manda `g.steal` com a exposição que viu (bola longe do corpo, do lado dele, no quique; drible baixo e bola presa
   protegem). O **juiz sorteia** com os cartões (`stealChance`: roubo 25 → 6%, 99 → 40% com a bola toda exposta;
   controle de bola do atacante; Glove e Unpluckable; teto 60%; um tapa a cada 0,9 s). Roubou: a posse troca como num
   rebote defensivo (precisa limpar) e a bola voa da mão do boneco para a de quem roubou.
8. **Resultado:** quem arremessou manda `g.result` no primeiro toque da bola no chão, ou antes: um erro já decidido (a
   bola descendo 0,3 m abaixo do aro sem cesta) vai na hora. Cesta: pontos, comemoração (1,8 s) e novo check da outra
   pessoa (ou da mesma, com make it take it). Erro: bola solta.
9. **Rebote:** passar a até 85 cm da bola solta (centro abaixo de 1,25 m; no pulo, até o alcance em pé + o pulo) pede a
   bola; o servidor dá ao primeiro pedido válido. Com o erro antecipado dá para **pegar no ar**, antes do quique.
   Rebote ofensivo continua a posse; **rebote defensivo precisa limpar** (levar a bola para fora da linha de 3)
   antes de valer cesta. Cesta sem limpar não vale e a bola troca. Bola solta 10 s sem dono volta para a defesa.
10. **Relógio de posse:** corre com a bola na mão, para no arremesso, zera em cada posse nova. Estourou: bola do outro.

### 6.4 Mensagens (`web/src/net/protocol.ts`)

Um endpoint (`/ws`), quadros JSON `{t, ...}`, até 64 KB, até 120 por segundo por conexão.

| Cliente → servidor | |
|---|---|
| `hello {v, card, token?}` | Identidade (cartão da build: nome, altura, envergadura, OVR, defesa de perímetro, roubo, toco, impulsão, controle de bola, níveis de Glove e Unpluckable) e reconexão. Protocolo 2 desde a defesa |
| `ping {c}` | A cada 2 s: latência e relógio do servidor (amostra de menor ida e volta) |
| `queue.join` / `queue.leave` | Partida rápida |
| `room.create {rules?}` / `room.join {code}` / `room.leave` / `room.ready` / `room.rules` / `room.rematch` | Sala |
| `st {d}` | Estado do meu jogador para o boneco do outro (o servidor repassa sem ler) |
| `g.release` / `g.result` / `g.claim` / `g.cleared` `{seq, ...}` | Relatos da jogada para o juiz |
| `g.block {seq}` | Quem arremessou: tomei toco, a bola fica solta já |
| `g.steal {seq, exp}` | Quem defende: tapa na bola com a exposição que viu (0..1); o juiz sorteia |

| Servidor → cliente | |
|---|---|
| `welcome`, `pong`, `error {code}` | Conexão |
| `queue`, `room {room, you}`, `room.left` | Lobby |
| `match.start {room, you, state}` | Partida começou (também na revanche e ao voltar de uma queda) |
| `match.state {state, event}` | Cada mudança: fase, placar, posse, bola, limpar, relógio, vencedor + o evento (cesta, rebote, roubo, toco…) |
| `opponent {connected, graceEndsAt}` | O outro caiu / voltou |
| `st {d}` | Estado do oponente |

### 6.5 Rodar e testar no PC

```bash
cd web
npm run server        # sala em ws://localhost:8790/ws (mostra o IP da rede local)
npm run dev           # jogo em http://localhost:5173/?menu=1
```

Abra duas abas em `http://localhost:5173/?menu=1`, escolha **Online 1x1** nas duas: numa, "Criar sala"; na outra,
"Entrar com código". Com um amigo na mesma rede: `npm run dev -- --host` e ele abre `http://<seu IP>:5173/?menu=1`.
`?mp=ws://host:porta/ws` na URL força outro servidor de salas. Testes do juiz e do lobby: `npx vitest run src/net`.
E2E com dois navegadores: `E2E_ORIGIN=<Vite sem HMR> npx playwright test e2e/online.spec.ts` (sobe o servidor de salas
na 8791, ou em `E2E_HUB_PORT`, com `HUB_SORTE=1`: o sorteio do roubo sai sempre; `?sorte=1` faz o mesmo com o toco).
No ar: `E2E_MP=wss://garrafao.garrafao-web.workers.dev/ws E2E_ORIGIN=<site publicado>` usa a sala publicada (o roubo
vira sorteio de verdade). A defesa foi publicada assim em 2026-10-16 e os 3 casos passaram no Worker e na Vercel.

### 6.6 O que ainda falta para ficar como o 2K

- **Postura de defesa** e passada lateral sem bola (o boneco usa a locomoção sem bola do Freestyle); falta de alcance
  (reach-in) no tapa e roubo na linha de passe.
- **Contato no drible:** o corpo a corpo só separa os dois; falta o choque do 2K (bump, hip ride) e o ritmo cortado.
- **Animação de check-ball** (passar a bola) e câmera de transição entre posses.
- **Anti-trapaça** para ranqueado (§8).

## 7. Divisão do trabalho (2026-10-16)

Duas sessões receberam o mesmo pedido e dividiram assim:

| Parte | Onde | Sessão |
|---|---|---|
| Protocolo, lobby e salas (`Hub`), servidor de desenvolvimento (Node), modo 1x1, ganchos no Freestyle, §6 | `web/src/net/`, `web/server/`, `web/src/main.ts` | "Multiplayer 1v1 no Vercel/Netlify" |
| Publicação (Worker + Durable Object, build sem modelos brutos), este documento menos o §6, boneco do adversário | `web/deploy/`, `docs/24`, `web/src/online/` | esta |

## 8. Riscos

- **Trapaça:** cada cliente manda no próprio jogador e no voo da própria bola. Entre amigos, tudo bem; ranqueado exige
  servidor autoritativo (`12-arquitetura-tecnica.md` §4).
- **WebSocket é TCP:** um pacote perdido segura os seguintes por um instante. O buffer de interpolação absorve a maior
  parte; WebRTC (UDP) resolve se incomodar.
- **Limite diário do plano grátis:** se estourar, a sala recusa conexões até 00:00 UTC (21:00 em Brasília). O jogo
  deve mostrar a mensagem, não travar.
