# 17 — Green, comemorações e "feel" de 2K Park (referência de design)

> **Pedido do diretor**: o Freestyle tem que parecer "igual um 2K": drible fluido e grudado na mão, jumper saindo da mão do jeito certo e **"animações de green, algo bem 2K PARK"**.
> **Método**: análise de design com fontes públicas (Courtside Reports, respostas do diretor de gameplay Mike Wang, testes da NBA2KLab, guias da comunidade, estudos de biomecânica) **e medição quadro a quadro dos clipes do diretor** (`referencias/2k23/`, 60 fps, medidos com ffmpeg). Pesquisa de outubro de 2026.
> **Legenda**: [OFICIAL] 2K · [DEV] Mike Wang · [MEDIDO] teste automatizado da comunidade · [CLIPE] medido por nós nos clipes do diretor · [COMUNIDADE] guias/fóruns · [ESTIMATIVA] cálculo nosso. **(não confirmado)** = não achamos fonte primária.
> **Legal**: copiamos a **ideia e o ritmo** (timing, ordem dos eventos, sensação). **Não** copiamos nomes de animações, nomes/gestos-assinatura ligados a atletas reais, sons, UI nem textos do 2K. Ver §2.4.
> Relacionados: `03-arremessos.md` (modelo do green), `04-animacoes.md` (camadas e cancelamento), `05-gameplay-ataque.md` (drible), `11-apresentacao.md` (áudio/câmera).

## 0. Resumo (o que mais importa)

1. **Um green do 2K é uma sequência de ~2,5 s**, não um flash: gather → soltura → aterrissagem com pose → braço segurado ~1 s → rede → banner de feedback → o jogador já está voltando para a defesa. É o **ritmo** dessa sequência que dá a sensação "Park".
2. No 2K23, com o feedback ligado, o **feedback e a "animação de green" só aparecem quando a bola chega ao aro** (para dar drama e evitar que o jogador desista da jogada) [OFICIAL]. A comunidade pediu o green instantâneo de volta e o 2K25 criou o feedback "Simple", **imediato** [DEV].
3. No 2K, a **"shot celebration" substitui a aterrissagem do jumper quando ele é green**, com listas separadas para NBA/Pro-Am e para o **Park**. Gestos depois da cesta saem pelo **D-pad**; flop é **B duas vezes** [COMUNIDADE].
4. Nos clipes do diretor: **último quique → soltura ≈ 0,6 s**, braço do arremesso no alto por **≈ 1,0–1,25 s** depois da soltura, mão de apoio desce em **≈ 0,4 s**, o jogador **vira para voltar logo depois de a bola cair** (≈ 1,3 s), e o banner "TIMING: EXCELLENT / COVERAGE: WIDE OPEN" fica **≈ 1,5–2 s** no canto superior direito [CLIPE].
5. **Drible do 2K23 em velocidade: ≈ 2,1–2,7 quiques/s** [CLIPE]. Os nossos clipes CMU driblam a **≈ 1,0–1,5 Hz**: é **metade** do ritmo do 2K. É o maior motivo de o drible ainda não "parecer 2K".
6. O que os jogadores de alto nível valorizam no drible: **sair rápido do movimento** (speedboost/cross launch), movimentos **apertados** (bola perto do corpo), **encadear sem travar** e **cancelar antes do primeiro quique** [DEV][MEDIDO].

---

## 1. O que acontece num GREEN no 2K (2K21 → 2K26, foco 2K23)

### 1.1 Linha do tempo de um green (2K23, arremesso de 3 livre)

`t = 0` é a soltura da bola. Valores [CLIPE] medidos no clipe `2k23-05` (três bolas de 3 no 1x1) e no `2k23-03` (3x3 no Park).

| t (ms) | O que se vê | O que se ouve | Fonte |
|---|---|---|---|
| −650 a −550 | **Último quique / gather**: pega a bola baixa, pés plantam (pull-up saindo do drible lateral) | **Chiado do tênis** no plant (chirp tonal 3–4 kHz) | [CLIPE] |
| −600 a −500 | Medidor aparece ao iniciar o arremesso. No 2K23 ele **enche até o fim no ponto ideal e depois esvazia do lado "tarde"** (como no 2K17–2K20) | — | [OFICIAL] [CR 2K23](https://nba2kw.com/nba-2k23-gameplay-breakdown-skill-moves-adrenaline-boosts-badges-pro-stick-dribbling-shooting-more) |
| −300 a −100 | Bola sobe ao **set point** (acima da testa), decolagem | — | [CLIPE] |
| **0** | **Soltura** perto do ápice, punho quebra. Medidor para na posição da soltura. No 2K23, a janela green de um spot-up ficava ≈ **501–550 ms** depois do início (49 ms) | (o "ding" do green: ver §1.4) | [MEDIDO] [NBA2KLab](https://www.nba2klab.com/videos/2k24-vs-2K23-Jumper-Guide) (não confirmado no texto da página) |
| +0 a +400 | Os **dois braços no alto**; a mão de apoio desce primeiro (≈ +400 ms) | — | [CLIPE] |
| +150 a +300 | **Aterrissagem**. Num green, a aterrissagem é a **shot celebration** equipada ("determina como você aterrissa no jumper quando acerta um green") | **Chiado do tênis** na aterrissagem | [COMUNIDADE] [lista 2K23](https://nba2kw.com/nba-2k23-full-list-of-player-in-game-celebrations) · [CLIPE] |
| +400 a +1250 | **Braço do arremesso segurado no alto** (follow-through) enquanto o corpo já se vira | — | [CLIPE] |
| +700 a +1300 | **Bola entra**. Arco alto = cedo, achatado = tarde, ideal = no tempo | **Rede** (ruído largo, ~200 ms) | [OFICIAL] · [CLIPE] |
| +800 a +3200 | **Banner verde "TIMING: EXCELLENT / COVERAGE: WIDE OPEN"** no canto superior direito, **≈ 1,5–2 s** na tela. No 2K23 ele espera a bola chegar ao aro; no clipe 05 veio junto com a cesta num arremesso e até 1,7 s depois dela em outro, atrás da fila de avisos (badge, nota) | — | [OFICIAL] · [CLIPE] |
| +1100 a +1600 | Placar atualiza; nota de companheiro aparece ("B"); badge ("GREEN MACHINE" etc.) | Som de UI (~0,3–0,6 s depois da rede) (não confirmado) | [CLIPE] |
| +1300 a +1500 | Jogador **vira e trota de volta** para a defesa, ainda com o braço descendo | — | [CLIPE] |
| +1400 a +2200 | **Cesta da vitória (1x1)**: corte para câmera baixa sob o aro, banner "EXCELLENT SHOT RELEASE" e gráfico de vitória | **Torcida/trilha explodem** | [CLIPE] `2k23-05` |
| +1600 a +2200 | **Park 3x3**: a câmera gira rápido (borrão de movimento, ~0,5 s) para o outro lado, porque a posse mudou | — | [CLIPE] `2k23-03` |

**Leitura de design**: há três "picos" de recompensa: (1) o **corpo** (pose de aterrissagem + braço segurado), (2) o **som da rede**, (3) o **texto** de confirmação. O 2K23 atrasou o (3) de propósito; o (1) é o que o jogador vê sempre e é o mais "Park".

### 1.2 O medidor, ano a ano

| Versão | Medidor | Fonte |
|---|---|---|
| 2K21 | Arremesso pelo Pro Stick: o medidor vira **mira** (acertar um ponto central que muda de tamanho com habilidade, distância e contestação); dá para "travar" centralizando o stick ou tocando um gatilho no ápice | [OFICIAL] [PS Blog](https://blog.playstation.com/?p=334631) |
| 2K22 | Medidor novo que **cresce** em bons arremessos de bons arremessadores e **encolhe** com contestação, arremessador fraco ou cansaço. **Som do green trocável** | [OFICIAL] [Spin.ph](https://www.spin.ph/esports/look-nba-2k22-new-shot-meter-a1017-20210901) · [Sportskeeda](https://www.sportskeeda.com/basketball/news-how-change-turn-shot-meter-nba-2k22) |
| **2K23** | **5 medidores** no lançamento + 15 desbloqueáveis nas Seasons, "uns grandes, uns pequenos, uns acima da cabeça, uns ao lado, uns abaixo". Enche até o fim no ideal e esvazia do lado tarde. Ajuste **"Shot Timing Release Time"** (muito cedo / cedo / tarde / muito tarde): a animação não muda, muda a velocidade com que o medidor chega à janela. **Arco** como feedback de timing | [OFICIAL] [CR](https://nba2kw.com/nba-2k23-gameplay-breakdown-skill-moves-adrenaline-boosts-badges-pro-stick-dribbling-shooting-more) · [Realsport101](https://realsport101.com/article/nba-2k23-shot-meters-meter-20-all-5-gameplay) · [NBA2KLab](https://nba2klab.com/videos/controller-settings) |
| 2K24 | **Visual Cue**: Jump / Set Point / Push / Release. **Green-or-miss** no Hall of Fame e no online competitivo | [OFICIAL] [CR 2K25](https://nba.2k.com/2k25/courtside-report/gameplay/) · [NLSC](https://www.nba-live.com/mto-thoughts-on-green-or-miss-in-nba-2k24/) |
| 2K25 | Arrow / Ring / Dial viram **linha do tempo**: animam do início ao fim sincronizados com o ideal; **o ideal é o quadro em que o medidor some** (mais preciso online). Cor, tamanho, posição e visibilidade (arremesso / bandeja / lance livre) no "Customize HUD". Visual Cue em **qualquer ponto** do jumper | [DEV] [FAQ 2K25](https://www.nba2klab.com/nba-2k25-mike-wang-faqs) · [Deltia's](https://deltiasgaming.com/?p=69769) |
| 2K26 | **Pure green** (soltou dentro da janela = cesta, sem RNG). Todos os medidores mostram a janela verde, menos dial/arrow/ring. **"Green Light Celebration"** customizável: gráfico, posição e **som** (ex.: "Yahoo", "Golf Swing", ou desligado) | [DEV] [FAQ 2K26](https://www.nba2klab.com/nba-2k26-mike-wang-faqs) · [MagicGameWorld](https://www.magicgameworld.com/?p=128679) (fonte secundária) |

Notas:
- **Medidor desligado dá bônus** de janela em todas as versões recentes [DEV]. Nos clipes do diretor **não aparece medidor** perto do jogador (provavelmente desligado; não confirmado).
- No 2K24 existem "green animations" desbloqueáveis (gráficos do green no HUD) (não confirmado, [fonte secundária](https://www.magicgameworld.com/?p=128431)).

### 1.3 Texto na tela

- **2K23, clipes do diretor** [CLIPE]: banner com fundo verde **"TIMING: EXCELLENT" / "COVERAGE: WIDE OPEN"** no canto superior direito, ao lado do nome e da linha PTS/REB/AST/3P%. No MyTEAM: **"RELEASE: LATE / COVERAGE: WIDE OPEN"** no placar suspenso. Avisos de nota de companheiro em amarelo/verde: **"EXCELLENT SHOT RELEASE"**, **"GOOD SHOT SELECTION"**. Badges ativados aparecem como faixa com o nome e um losango do nível (ver `referencias/2k23/README.md`).
- **Categorias de timing**: Excellent (green) / Good / Slightly Early-Late / Very Early-Late [COMUNIDADE] ([Steam, 2K18](https://steamcommunity.com/app/577800/discussions/0/2650805212057865443/)). Cores verde → amarelo → vermelho (não confirmado para o 2K23).
- **Cobertura**: Wide Open / Open / Lightly Contested / Heavily Contested / Smothered (lista exata do 2K23 não confirmada). O 2K26 voltou a mostrar a **porcentagem de cobertura** no feedback completo [DEV]; o 2K27 tem 8 níveis coloridos (`01-engenharia-reversa-2k27.md`).
- **"All Shots"** mostra também o feedback dos arremessos do adversário [COMUNIDADE].

### 1.4 Som

| Camada | No 2K | Fonte |
|---|---|---|
| "Ding" do green | Existe e é **trocável** desde o 2K22. No 2K26 há opções (ex.: "Yahoo", "Golf Swing") e dá para desligar | [Sportskeeda](https://www.sportskeeda.com/basketball/news-how-change-turn-shot-meter-nba-2k22) · [MagicGameWorld](https://www.magicgameworld.com/?p=128679) |
| Momento do "ding" no 2K23 | Com o feedback ligado, a "animação de green" espera a bola chegar ao aro; se o som também espera, não confirmamos | [OFICIAL] (não confirmado para o som) |
| Rede | É o som mais forte do lance, ~1 s depois da soltura | [CLIPE] |
| Tênis | Chiado no **plant do gather** e na **aterrissagem**: dois "chirps" curtos que marcam o ritmo do pull-up | [CLIPE] (espectrograma) |
| Torcida / Park | Jogo NBA: narradores + arena. Park/City: **sem narrador** (não confirmado), trilha do jogo nos alto-falantes e voz dos jogadores. 2K21: o "prefeito" de cada afiliação escolhia a playlist, e a música **crescia/sumia com a distância** da quadra | [OFICIAL] [CR City 2K21](https://devtrackers.gg/nba2k/p/6209a66f-nba-2k21-next-gen-the-city-courtside-report) |
| Cesta da vitória | A torcida/trilha explode quando a câmera corta para baixo do aro | [CLIPE] |

### 1.5 Bola, rede, corpo e câmera

- **Arco** = leitura do timing (alto = cedo, achatado = tarde) [OFICIAL]. Já está no `03-arremessos.md §10`.
- **Rede/bola**: não achamos efeito especial de rede ou bola no green comum (não confirmado). Efeito de bola existe como **recompensa de sequência**: no 2K21, depois de **10 vitórias seguidas** numa quadra de afiliação, a bola **pega fogo** até a equipe perder, e as pessoas se juntam em volta da quadra [OFICIAL] [CR 2K21](https://devtrackers.gg/nba2k/p/6209a66f-nba-2k21-next-gen-the-city-courtside-report).
- **Corpo**: sem brilho no jogador no green do 2K23 (não confirmado). O que muda é a **pose** (aterrissagem/celebração) e o braço segurado. O anel sob os pés tem ícones (há chamas no clipe; significado não confirmado).
- **2K26**: as celebrações do jumper e o feedback ficaram **dinâmicos pela qualidade do arremesso** (ratings + cobertura + timing). Soltura Excellent, bem livre e com bom arremessador = **"insta-green"** [DEV] [FAQ 2K26](https://www.nba2klab.com/nba-2k26-mike-wang-faqs).
- **Câmera**: no green comum, a câmera **não faz nada especial** [CLIPE]. No Park (meia quadra) ela **gira para o outro lado** quando a posse troca. Na cesta da vitória, **corte** para câmera baixa sob o aro [CLIPE]. O 2K26 usa uma "matrix cam" (360°) nos replays [OFICIAL] [CR Apresentação 2K26](https://nba.2k.com/2k26/courtside-report/presentation/).

### 1.6 Park/City/Rec × jogo normal

| Elemento | Park / City / Rec | Jogo NBA / MyCareer |
|---|---|---|
| Celebração de aterrissagem do green | Lista **"Park Shot Celebrations"** (mais exagerada, dancinhas) | Lista "NBA & Pro-Am Shot Celebrations" (gestos de atleta) |
| Depois de cesta de 2 / de 3 | "Park After Two / After Three" | "NBA & Pro-Am After Two / Three" |
| Parado | "Park Standing" | "NBA & Pro-Am Standing" |
| Flop | "Park Flops" (cômico) | — |
| Som | Música e voz dos jogadores | Narração e arena |
| Câmera | Gira com a posse (meia quadra) | Transmissão |
| Recompensa de sequência | Bola em chamas (2K21), "Park MVP" e "Streak Setters" (2K26) | Takeover |

Fonte das listas: [NBA 2KW](https://nba2kw.com/nba-2k23-full-list-of-player-in-game-celebrations).

---

## 2. Celebrações e animações depois do green

### 2.1 Como o 2K organiza (2K23)

| Tipo | Quando dispara | Input | Fonte |
|---|---|---|---|
| **Shot celebration** (green) | **Automático**: substitui a aterrissagem do jumper green (NBA, Park e Pro-Am) | — | [lista](https://nba2kw.com/nba-2k23-full-list-of-player-in-game-celebrations) |
| Dunk celebration | Automático na aterrissagem da enterrada (lista própria no Park) | — | idem |
| After Two / After Three | Depois de uma cesta | **D-pad** (cima, baixo etc.: um gesto por direção) | [NBA 2KW](https://nba2kw.com/nba-2k23-how-to-show-off-hang-on-the-rim-celebrate-flop-emotes-more/) |
| Standing | Parado | D-pad | idem |
| Flop | Em qualquer momento (muito usado como piada) | **B ×2** | idem |
| Intros/Outros | Antes/depois do jogo | RS na direção configurada | idem |
| City Emotes / Dribble Emotes | Andando pela City | RS | idem |
| Celebração dinâmica (2K26) | Green + livre + bom arremessador → celebração/feedback instantâneos | — | [DEV] |

- Compradas na loja de animações e equipadas por slot (sistema de VC: **não** copiamos a monetização).
- **Duração**: não há dados públicos. Nos clipes, aterrissagem + braço segurado ≈ 1,0–1,3 s [CLIPE]. Nossos clipes CMU: flex 1,27 s, shrug 1,10 s.
- **Cancelamento**: não achamos documentação (não confirmado). No clipe, o jogador **anda de volta durante** a pose (o tronco celebra, as pernas obedecem). O 2K23 atrasou o feedback justamente para que os jogadores não "desistissem da posse e voltassem cedo para a transição" [OFICIAL].

### 2.2 Uso social no Park

- **Green e já voltar**: quem sabe que acertou vira de costas e trota para a defesa com o braço ainda no alto, na hora em que a bola cai ou até antes (no clipe, ≈ 1,3 s depois da soltura). É o gesto de confiança mais "Park". O 2K23 atrasou o feedback do green em parte porque os jogadores "desistiam da posse" e voltavam cedo [OFICIAL] [CLIPE].
- **Provocação**: "muito baixo" depois de enterrar ou arremessar sobre um defensor menor, dedo na boca, mão na orelha, encarar o defensor. A provocação é parte da cultura, mas o 2K dá para ela um slot próprio e controlado (D-pad).
- **Comédia e grupo**: flops quando um companheiro erra feio ou acontece algo engraçado [NBA 2KW](https://nba2kw.com/nba-2k23-how-to-show-off-hang-on-the-rim-celebrate-flop-emotes-more/).
- **Status**: sequência de vitórias vira espetáculo (bola em chamas, gente em volta da quadra, nome do recordista na lateral da quadra no 2K26) [OFICIAL] [CR City 2K26](https://nba.2k.com/2k26/courtside-report/the-city/).

### 2.3 Catálogo de gestos (movimento do corpo, para gravar ou animar)

"Nosso nome" é provisório e original. Coluna "CMU" = clipe gratuito que serve de base agora; "Captura" = gravar na sessão S7 (`04-animacoes.md §5.4`). Prioridade: **P0** = próximas 2 semanas · **P1** = Fase 0/1 · **P2** = depois.

| # | Nosso nome | Movimento do corpo | Quando | Dur. alvo | Base | Prior. |
|---|---|---|---|---|---|---|
| 1 | **Segura o punho** | Braço do arremesso estendido acima da cabeça, punho quebrado, dedos apontando para o aro; mão de apoio desce em ~0,4 s; queixo segue a bola | Todo green (nos outros acertos, versão curta de 0,45 s) | 1,0–1,2 s | Já existe (`GreenHoldSeconds`) | **P0** |
| 2 | **Aterrissa travado** | Pousa com os pés na largura dos ombros, joelhos semiflexionados, tronco ereto, sem passo extra; braço segue no alto | Green parado (spot-up) | 0,3 s + #1 | Ajuste de pose (Control Rig) | **P0** |
| 3 | **Vira antes de cair** | Depois de aterrissar, gira ~180° sobre o pé de dentro e trota de volta; braço desce durante o giro; cabeça olha a bola por cima do ombro | Green livre ou se o jogador mexer o LS depois de ~300 ms | 0,6–0,9 s | CMU 69_39 (no jogo: gira 180° em ~0,9 s, 1,3 s depois da soltura) | **P0** |
| 4 | **Encarada** | Trotando de volta, a cabeça vira para o defensor por ~0,6 s, sem expressão; ombros relaxados | Green contestado que caiu | 0,6 s | **Procedural** (look-at) | **P0** |
| 5 | **Murro no ar** | Punho fecha na altura do peito e desce num golpe curto, cotovelo dobrado, leve agachada | D-pad depois da cesta / automático em streak | 0,6–0,8 s | CMU 56_02 (punhos) ou keyframe | **P0** |
| 6 | **Bíceps** | Dois braços em "duplo bíceps", peito para frente, grito | D-pad / enterrada | 1,2 s | CMU 79_94 (já no jogo) | **P0** |
| 7 | **Ombros** | Ombros sobem, palmas para cima, cabeça inclina, "fácil" | D-pad / automático | 1,1 s | CMU 141_21 (já no jogo) | **P0** |
| 8 | **Binóculo de três** | Uma ou duas mãos: indicador e polegar fazem um círculo em volta do olho, outros três dedos abertos; tronco gira para a torcida | D-pad após bola de 3 | 1,0–1,3 s | Keyframe (dedos) / Captura | **P0** (o mais "Park") |
| 9 | **Três para cima** | Braço sobe com três dedos abertos (como o sinal de 3 pontos da arbitragem), olhando para cima; opcional: beija os dedos antes | D-pad após 3 | 1,0 s | CMU 26_02…41_11 ("basketball signals", conferir) | P1 |
| 10 | **Arco e flecha** | Braço de apoio estica apontando para frente, a mão do arremesso "puxa a corda" até a orelha e solta, com recuo do tronco | D-pad após 3 | 1,2 s | **CMU 79_86** (no jogo: D-pad baixo) | P1 |
| 11 | **Muito baixo** | Mão espalmada para baixo na altura da cintura, desce duas vezes, olhando para o defensor | Cesta/enterrada sobre defensor menor | 1,0 s | Keyframe | P1 |
| 12 | **Escuta** | Mão em concha atrás da orelha, tronco inclina para a arquibancada | D-pad, jogo com público | 1,2 s | Keyframe | P1 |
| 13 | **Silêncio** | Indicador vertical nos lábios, olhando para a torcida ou o defensor | D-pad, jogo como visitante | 1,0 s | Keyframe | P1 |
| 14 | **Gelo** | Dois dedos batem duas vezes no antebraço oposto (as "veias"), olhar sério | D-pad, arremesso decisivo | 1,0 s | Keyframe | P1 |
| 15 | **Dormiu** | Mãos juntas ao lado do rosto, cabeça deita sobre elas, olhos fechados | **Só cesta da vitória** | 1,2 s | Keyframe | P1 (cuidado legal, §2.4) |
| 16 | **Cabeça** | Indicador toca a têmpora duas vezes ("inteligência") | D-pad após assistência/arremesso difícil | 0,8 s | Keyframe | P1 |
| 17 | **Shimmy** | Ombros alternam frente/trás ~4 vezes por segundo, mãos baixas, joelhos soltos | Celebração de aterrissagem "Park" | 1,0 s | Captura | P1 |
| 18 | **Ajeita a faixa/munhequeira** | Mão vai à testa ou ao pulso oposto e ajusta, olhar para o chão | Standing / antes do lance livre | 1,5 s | Captura | P1 (realista, risco zero) |
| 19 | **Limpa o tênis** | Mão passa na sola do tênis com o pé levantado para trás | Standing / ritual | 1,5 s | Captura | P1 |
| 20 | **Mãos nos joelhos** | Tronco dobra, mãos nos joelhos, respiração visível | Automático com energia < 25% | loop | Captura | P1 (liga à stamina) |
| 21 | **Toca aqui** | Palma com palma com um companheiro (alto ou "around the world") | 3x3, cesta do companheiro | 1,0 s | **CMU 141_22** (no jogo: D-pad direita 2×) / 141_24 | P1 (3x3) |
| 22 | **Telefone** | Mão em "Y" no ouvido ("me liga"), anda de volta | Park standing | 1,2 s | **CMU 79_36 / 80_25** | P2 |
| 23 | **Zíper** | Polegar e indicador passam pelos lábios como um zíper | Park | 0,8 s | Keyframe | P2 |
| 24 | **Agachado** | Aterrissa e desce num agachamento profundo, braços abertos ao lado | Aterrissagem "Park" | 1,2 s | Captura | P2 |
| 25 | **Pulinhos** | 2–3 saltinhos curtos para trás depois de aterrissar | Aterrissagem "Park" | 1,0 s | CMU 13_39–13_42 (jump) | P2 |
| 26 | **Dancinha** | 2–4 tempos de dança (salsa, passinho) | Park standing | 2–3 s | **CMU 60_xx / 61_xx (salsa)** | P2 |
| 27 | **Flop** | Queda exagerada para trás ou de lado, braços abertos | B ×2 (defesa) | 1,5 s | Física (ragdoll guiado) | P2 |
| 28 | **Pendura no aro** | Pendurado com as duas mãos, pernas balançando, solta e aterrissa | Enterrada (RT + RS baixo) | físico | Physics Control | P1 (com enterradas) |

**Gatilhos no nosso jogo** (proposta):
- **Aterrissagem do green**: automática, escolhida de um slot "estilo de aterrissagem" (#1–#3 no P0; #17, #24, #25 depois). Como no 2K26: **green + livre** → celebra na aterrissagem (sabemos que entra, pois green livre = cesta garantida, `03-arremessos.md §3.2`); **green contestado** → só o #1 neutro, e a celebração vem depois, se cair.
- **Depois da cesta**: **D-pad** numa janela de **2,5 s** depois da cesta (4 slots: cima/direita/baixo/esquerda), igual ao 2K23. No Freestyle, o D-pad é dos comandos de laboratório (`02-controles.md §8`), então ele é **contextual**: dentro da janela pós-cesta = comemoração; fora dela = laboratório.
- **Sequência**: 3 greens seguidos → a próxima aterrissagem usa um gesto "Park" automático (a sequência fica visível, como o badge "Green Machine", que dá bônus por releases Excellent seguidos [NBA2KLab](https://www.nba2klab.com/badge-descriptions-2k23)).
- **Nunca prende o jogador**: toda celebração é **só tronco** (camada de `04-animacoes.md §1`). As pernas seguem o LS desde a aterrissagem. Qualquer ação (arremesso, passe, roubo, sprint com bola) **cancela em ≤ 100 ms** com blend de 150 ms. Respeita o pilar "nada trava > 250 ms" (`00-visao-geral.md §2`).

### 2.4 Cuidados legais

- **Nomes**: o 2K usa muitos nomes que citam atletas ("Steph Point", "Kawhi Squat", "Ja Slide", "Melo Triple Tap", "Trae Of Ice" etc.). **Não usamos nenhum**: nomes próprios, apelidos e frases de atletas ficam fora.
- **Frases com pedido de marca**: um atleta pediu registro de marca para "Night night" e para "Nuit nuit" ([NBC Sports](https://nbcsports.com/bayarea/warriors/warriors-steph-curry-trademarked-night-night-phrase-after-nba-finals), [Bleacher Report](https://www.bleacherreport.com/articles/10132556-warriors-stephen-curry-files-trademark-for-viral-nuit-nuit-phrase-after-olympics)). O gesto #15 só entra com nome nosso, sem texto/legenda associada, e sem imitar trejeitos específicos do atleta.
- **Gestos genéricos** (binóculo de três, murro no ar, shhh, mão na orelha) são cultura do esporte. Rotinas simples de dança **não** foram aceitas para registro de direitos autorais nos EUA (caso "Carlton dance": [Goodmans](https://www.goodmans.ca/insights/post/goodmans-ip-blog/copyright-office-denies-registration-for-viral-dance-move)). Mesmo assim, **não reproduzimos coreografias famosas** passo a passo nem danças virais ligadas a pessoas.
- **Captura**: gestos gravados pelos atletas do diretor, com **termo de cessão de imagem e movimento** (`00-visao-geral.md §4`). CMU: uso comercial permitido como asset derivado (`Tools/Animacao/README.md`).
- **UI e som**: textos do banner, ícones e "ding" são nossos. Não usamos "EXCELLENT", "WIDE OPEN" etc. em inglês na mesma forma: ver §6 (P0-1).

---

## 3. Arremesso fluente (jump shot)

### 3.1 Como o 2K monta um jumper (Jump Shot Creator, 2K23)

| Peça | O que controla | Fonte |
|---|---|---|
| **Base** (parte de baixo) | Dip, preparação, **altura e direção do salto**, ângulo do corpo e **o timing** do arremesso | [COMUNIDADE] [DiamondLobby](https://diamondlobby.com/nba-2k23/best-jumpshots-nba-2k23/) |
| **Release 1** (parte de cima) | Como e onde a bola sai da mão, set point e **follow-through** | idem |
| **Release 2** + **Blending** | Mistura de duas solturas (ex.: 50/50, 75/25, 20/80). Release 1 = Release 2 → sem mistura | idem · [NBA 2KW](https://nba2kw.com/nba-2k23-best-jumpshots-next-gen-current-gen) |
| **Velocidade** | Muito lenta → muito rápida (5 níveis). Mais rápida = janela menor | [MEDIDO] |
| **Atributos gerados** (2K23) | **Shot Speed** (rapidez até o ponto ideal), **Release Height**, **Defensive Immunity**, **Timing Impact** (janela maior para quem acerta o tempo, penalidade maior para quem erra), com notas A+ a F | [OFICIAL] [CR](https://nba2kw.com/nba-2k23-gameplay-breakdown-skill-moves-adrenaline-boosts-badges-pro-stick-dribbling-shooting-more) |
| Animações de assinatura | 2K23: "mais que o dobro de qualquer 2K anterior", liberadas por rating de arremesso | [OFICIAL] |
| Pacotes separados | Pull-up, spin jumper, hop jumper, step-back e fade são **animações próprias** (não vêm do criador). A NBA2KLab mede a janela de cada pull-up separadamente | [MEDIDO] [NBA2KLab](https://www.nba2klab.com/premium-dribble-pull-ups) |

Nosso `03-arremessos.md §6` já segue esse modelo (Base + Soltura + Mistura + Velocidade, com orçamento fixo).

### 3.2 Fases e ponto ideal

O 2K24 deu nome às fases que o jogador lê: **Jump → Set Point → Push → Release** (Visual Cue) [OFICIAL]. O 2K23 tinha uma versão anterior disso: "muito cedo… muito tarde", que Mike Wang descreveu como escolher se o ponto ideal fica "cedo, perto da decolagem, ou tarde, perto do flick do punho" [DEV] ([tweet](https://x.com/Beluba/status/1554841415204540416)). No Rhythm Shooting do 2K26, o input **muda o tronco**: empurrar cedo apressa a animação, atrasar **segura o set point**, empurrar devagar deixa o follow-through "preguiçoso", e há um **teto** de quanto tempo dá para segurar o set point [DEV].

**Para nós**: marcar em toda animação de arremesso os notifies `Gather · Dip · Takeoff · SetPoint · Push · Release · Apex · Land` (`04-animacoes.md §7` já pede `ReleasePoint`, `Gather`, `Takeoff`, `Land`; faltam **SetPoint** e **Push**).

### 3.3 Números

| Medida | Valor | Fonte |
|---|---|---|
| Início → green, base mais rápida do 2K19 | 409 ms | [MEDIDO] [NBA2KLab](https://nba2klab.com/nba2k-how-has-shooting-changed) |
| 2K20 / 2K21 | começo da faixa de 500 ms / ~600 ms em média | idem |
| **2K23**, janela green (spot-up) | **501–550 ms** (49 ms) | [MEDIDO] [NBA2KLab](https://www.nba2klab.com/videos/2k24-vs-2K23-Jumper-Guide) (não confirmado no texto) |
| 2K24, janela green | 605–635 ms (30 ms) | idem |
| 2K27, centro da janela por velocidade | 683,5 / 703,5 / 718,5 / 728,5 / 743,5 ms (muito rápida → muito lenta), ~15 ms por nível | [MEDIDO] [NBA2KLab](https://www.nba2klab.com/release-speed-test) |
| Hands-on do 2K23 | "jumper parece mais lento" que no 2K22; a velocidade geral do jogo também | [COMUNIDADE] [NBA 2KW](https://nba2kw.com/nba-2k23-hands-on-gameplay-impressions-dribbling-shooting-shot-dunk-meter-defense-more) |
| **Clipe do diretor**: último quique → soltura (pull-up de 3) | **≈ 0,6 s** | [CLIPE] |
| **Nosso clipe CMU 06_15** | dip → soltura 37 quadros = **0,62 s**; pés saem → soltura 150 ms; soltura → ápice 33 ms; ápice → chão ~217 ms | `Tools/Animacao/README.md` |
| Biomecânica: tempo total do jumper | ~0,62 s (amostra de 2 pessoas, citada) | [Niš 2017](https://casopisi.junis.ni.ac.rs/index.php/FUPhysEdSport/article/view/3908) |
| Ângulo de soltura | 45–55°; lance livre ótimo ≈ 52° | [Frontiers 2023](https://frontiersin.org/articles/10.3389/fspor.2023.1208915/full) |
| Ângulo de entrada (elite) | 36,6° (pivôs) a 42° (alas) | [Niš](https://casopisi.junis.ni.ac.rs/index.php/FUPhysEdSport/article/view/3908) |
| Backspin | 100–130 rpm (**≈ 1,7–2,2 rotações/s**) | idem |
| Arremesso mais longo | soltura **mais perto da decolagem** (antes do ápice), bola mais rápida | [PMC 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC8822900) |

**Conclusão**: o nosso jumper CMU (0,62 s do dip à soltura) está no **ritmo do 2K23** (≈ 0,5–0,6 s). Não dá para deixá-lo mais lento.

### 3.4 Gather saindo do drible (pull-up, hop, spin, step-back)

- O padrão nº 1 do diretor: **drible lateral em velocidade → gather abaixado sem frear → subida → soltura** (`referencias/2k23/README.md`, padrão 1).
- No 2K25, segurar RS para cima dispara **Signature Go-To Shots** (combos drible→arremesso tirados de vídeo), e qualquer arremesso avançado pode ser **cancelado** em hesitação ou pump fake [OFICIAL] [CR 2K25](https://nba.2k.com/2k25/courtside-report/gameplay/).
- Pull-ups e jumpers de spin/hop/step-back são **pacotes separados** com janela própria [MEDIDO].
- **O que faz parecer fluido** [ESTIMATIVA]: (1) o último quique já **"vira" gather** (a mão sobe com a bola sem uma pegada parada); (2) **1–2 passos de plant** com warp para cancelar a velocidade lateral (≤ 0,6 m, `04-animacoes.md §1.2`); (3) o chiado do tênis no plant; (4) a janela do green **travada no gather** (`03-arremessos.md §3.2`), e não recalculada no ar.
- **Hop** (pulo com os dois pés), **spin** (giro de 180–270° sobre o pé de pivô) e **step-back** (empurrão para trás com a perna da frente, pouso nos dois pés) usam o mesmo esquema: o último notify do drible (`BallCatch`) é o `Gather` do arremesso.

### 3.5 Como a bola sai da mão

- A bola deixa as **pontas dos dedos indicador e médio** por último; o punho flexiona ("quebra") e o antebraço termina apontando para o aro.
- **Backspin visível**: 2–3 rotações/s (medido em atletas: 1,7–2,2), eixo horizontal perpendicular à linha do aro. Costuras girando para trás é o que o olho lê como "saiu certo" (`03-arremessos.md §10` usa ~3 rot/s: manter, ou baixar para 2,5).
- **Altura da soltura**: acima da testa, braço quase estendido. Release mais alto = mais difícil de contestar (`Release Height` do 2K23).
- **Arco**: 45–55° na saída; cedo = mais alto, tarde = mais achatado. Entrada ideal 40–45°.
- **Sincronia**: a bola tem que sair **no quadro do notify `Release`**, com a mão ainda em contato até esse quadro (bola presa ao socket com offset), senão parece "teleporte" ou "atraso".

### 3.6 Follow-through e aterrissagem

- **Segurar**: green ≈ **1,0–1,25 s** (braço do arremesso) [CLIPE]; mão de apoio desce em ≈ 0,4 s. Erro ou soltura "Boa": ~0,4–0,5 s (nosso valor atual, 0,45 s, está bom).
- **Aterrissagem**: pés ~na mesma marca da decolagem num spot-up; nos pull-ups, deriva de 10–30 cm no sentido do movimento; no fade, 30–60 cm para trás [ESTIMATIVA].
- No 2K, **a celebração de green é a aterrissagem** (§2.1).

### 3.7 O que deixa o jumper "liso" e o que incomoda

**Suave** (quando dá certo):
1. Medidor e animação **na mesma batida**: a mão chega ao topo exatamente no centro da janela (já fazemos isso com o playrate; `Tools/Animacao/README.md`).
2. **Timing igual sempre** para o mesmo jumper: o jogador aprende o ritmo (por isso trocar a velocidade "custa" 15 ms por nível e obriga a reaprender [MEDIDO]).
3. **Feedback legível em < 1 s** (arco + texto + som).
4. Transição drible → arremesso **sem frear** (§3.4).
5. Pés plantados sem deslizar (2K26: "pose matching" das pernas para tirar o "patinar" [OFICIAL] [CR 2K26](https://nba.2k.com/2k26/courtside-report/gameplay/)).

**Incomoda**:
1. **Green atrasado** (2K23): a comunidade pediu o green instantâneo de volta; o 2K25 respondeu com o feedback "Simple" imediato [DEV].
2. Jumper lento ou que "decide sozinho" (2K23: "shooting muito mais difícil, nem sempre o green entra" [COMUNIDADE] [Sportskeeda](https://www.sportskeeda.com/basketball/nba-2k23-shooting-tips-the-ultimate-guide-scoring-success)).
3. Medidor que **congela** mostrando uma coisa enquanto o servidor decide outra (latência). O 2K25 trocou por medidor "linha do tempo" [DEV].
4. Janela que muda depois do gather (reclamação nº 1 do 2K27, `01-engenharia-reversa-2k27.md`).

---

## 4. Drible fluente conectado à mão

### 4.1 Ritmo

| Medida | Valor | Fonte |
|---|---|---|
| **2K23, drible lateral em velocidade** (clipe 05) | **0,37–0,48 s entre quiques → ≈ 2,1–2,7 Hz** | [CLIPE] (transientes do áudio) |
| Nossos clipes CMU (sujeito 06) | parado ≈ 1,2 Hz; andando ≈ 1,0 Hz; de lado/de costas ≈ 1,5 Hz | `Tools/Animacao/README.md` (quadros de "empurrão") |
| Física: drible na cintura (mão ~0,85 m, empurrão 2,5–4 m/s, e = 0,76) | ≈ **1,7–1,9 Hz** | [ESTIMATIVA] |
| Física: drible baixo/forte (joelho, ~0,45 m) | ≈ **3–3,5 Hz** | [ESTIMATIVA] |
| Contato mão-bola por quique | ~100–200 ms | [ESTIMATIVA] |
| Experientes × iniciantes | experientes driblam **mais rápido** e com espectro de frequência **mais largo** (mudam de altura, mão e ritmo) | [Hang-Time HAR](https://arxiv.org/abs/2305.13124) |

**Consequência direta**: os clipes CMU estão a **metade do ritmo** do 2K23. Precisamos de: parado ≈ 1,8–2,2 Hz, correndo ≈ 2,2–2,6 Hz (sincronizado com a passada: 1 quique a cada 2 passos), baixo/protegendo ≈ 3 Hz.

### 4.2 Pacotes e mecânicas do 2K23

| Item | 2K23 | Fonte |
|---|---|---|
| **Size-ups de assinatura** | Encadeados **balançando o Pro Stick no ritmo** | [OFICIAL] [CR](https://nba2kw.com/nba-2k23-gameplay-breakdown-skill-moves-adrenaline-boosts-badges-pro-stick-dribbling-shooting-more) |
| **Attacking size-ups** (novo) | Mais deslocamento lateral, "forçam a defesa a recuar e se mexer" | idem |
| **Double throw** (mesma direção 2×) | Novos combos | idem |
| **Switchback** (direção + oposta) | Double-cross e hesi-cross de assinatura; pacote Moving Crossover foi de **15 para 28** opções | idem |
| **Signature Combos** | Flicks repetidos para frente e para trás | idem |
| Recado do CR | "Aprender a **velocidade dos flicks** e o **timing das animações** de assinatura é especialmente importante" | idem |
| Energia | "Gasta bem mais rápido ao **spammar** movimentos" (o 2K23 ainda tinha Adrenaline Boosts; **nós não**, D13) | idem |
| Badges de drible | Killer Combos (size-ups), Handles for Days, Hyperdrive, Quick First Step, Unpluckable | [OFICIAL] · `referencias/2k23/README.md` |
| Hands-on | "Drible no LS parecia forte demais" | [COMUNIDADE] [NBA 2KW](https://nba2kw.com/nba-2k23-hands-on-gameplay-impressions-dribbling-shooting-shot-dunk-meter-defense-more) |
| Histórico | 2K21: 14 size-ups de Park + 36 de NBA [OFICIAL] [PS Blog](https://blog.playstation.com/?p=334631). 2K25: 1.500 animações de drible novas; cada estilo com **20–40 sequências** (antes 4–5), "6× mais dados de movimento"; paradas mais firmes e arranques mais explosivos [DEV][OFICIAL] | [FAQ 2K25](https://www.nba2klab.com/nba-2k25-mike-wang-faqs) |

### 4.3 Contato mão-bola e proteção

O que vende o drible "grudado na mão" [ESTIMATIVA, a partir de `04-animacoes.md §3`]:
- **Mão por cima da bola** no empurrão (dedos abertos, palma não bate), punho flexiona, e a mão **acompanha a bola para baixo** ~10–20 cm antes de soltar.
- **Recepção**: a mão **sobe com a bola** (amortece) em vez de a bola "bater" numa mão parada. Hand IK corrige até ~8 cm.
- **Altura muda com a situação**: alta e solta correndo livre; baixa (joelho) e mais rápida perto do defensor; LT (proteger) = corpo entre bola e defensor, braço livre levantado como escudo. O 2K26 adicionou o **Quick Protect** (toque em LT) contra roubos [OFICIAL].
- **Movimentos apertados**: entre os por trás das costas, os melhores são os "tight"; os "largos" deixam a bola exposta ao roubo [MEDIDO] [NBA2KLab](https://www.nba2klab.com/recommended-dribble-moves).
- Som do quique **no quadro do contato** com o piso, variando por superfície (madeira/asfalto).

### 4.4 Momento, plant-and-cut e "sair do movimento"

- **O estilo de drible decide a rapidez com que você sai do movimento**, em dois arranques: **Speedboost** (sair para o mesmo lado) e **Cross Launch** (sair para o lado oposto ao crossover). Não muda a velocidade máxima com bola, muda os **primeiros 1–2 passos**, "exatamente onde o defensor é batido ou não" [MEDIDO] [NBA2KLab](https://www.nba2klab.com/dribble-styles-explained). Os estilos de drible surgiram no 2K20 e a lista "cresceu de verdade" no 2K23 [MEDIDO].
- **Cancelar antes do 1º quique** (2K26): crossover, entre as pernas, por trás e hesitação de **misdirection** = começar o movimento parado e, **antes do primeiro quique**, segurar RT e jogar o RS para o lado oposto. **Momentum cross** = in-and-out e sprint imediato para a mão livre [DEV] [FAQ 2K26](https://www.nba2klab.com/nba-2k26-mike-wang-faqs).
- 2K26: "ramificar e encadear movimentos ficou mais responsivo, e dá para **interromper mais movimentos**"; velocidade geral do jogo **+10%** [DEV].
- Movimentos de referência do meta do 2K23 [MEDIDO] [NBA2KLab](https://www.nba2klab.com/recommended-dribble-moves): **spin em movimento** que "devolve para a linha de 3"; **hesitação "pro"** (troca de ritmo e pés prontos para o jumper, ótima depois do spin); **step-back em movimento** ("Asta slide") para começar combos, ganhar arranque ou andar de lado; crossover em movimento que leva "para arremessar, andar de lado ou passar do defensor".

### 4.5 O que os jogadores avançados valorizam (checklist)

1. **Sair do movimento rápido** (speedboost/cross launch), mais que o movimento em si.
2. **Sem animação presa**: toda ação ramifica ou cancela cedo (antes do 1º quique) e o buffer não "come" input.
3. **Ritmo aprendível**: a mesma entrada no mesmo ritmo dá sempre o mesmo resultado.
4. **Movimentos apertados**, bola perto do corpo.
5. **Paradas firmes e cortes que não arredondam** (o 2K25 vendeu justamente "stops tighter, launches more explosive").
6. **Custo justo**: a energia limita o spam, mas uma posse longa bem administrada é possível (o diretor dribla ~11 s numa posse, `referencias/2k23/README.md`).

---

## 5. Clima do 2K Park (para o nosso Freestyle/Streetball)

- **Quadra**: o 2K26 trouxe o Park de volta "mais natural e realista", com hora do dia **fixa** para evitar sombras duras ao ar livre, e remasterizou os quatro parques clássicos do 2K16 [OFICIAL] [CR City 2K26](https://nba.2k.com/2k26/courtside-report/the-city/). O parque de 2K23 que o diretor joga (GOAT Boat) é diurno e pastel; o 1x1 é numa quadra temática fechada [CLIPE]. **Para nós (realista, D7)**: quadra de rua **à noite** com **refletores de vapor de sódio/LED em postes**, poças de luz quente, alambrado, asfalto com marcas e um pouco de umidade (reflexo barato, `11-apresentacao.md §2`).
- **Música e som**: trilha licenciada tocando "de algum lugar" (caixa de som ou carro), **espacializada** e abafada pela distância, como as playlists por quadra do 2K21. O 2K17 fez eventos noturnos com DJ, palco e show de luzes ("Park After Dark") [OFICIAL] [GosuNoob](https://www.gosunoob.com/nba-2k17/park-after-dark-announced/).
- **Público**: no Park, quem assiste são **outros jogadores em pé em volta da quadra** [CLIPE]. As pessoas se juntam quando há uma sequência (bola em chamas, 2K21) [OFICIAL]. Para nós: 6–15 NPCs encostados no alambrado, com reações de "uuuh" e palmas nos greens e enterradas.
- **Rep e status**: Rookie → Starter → Veteran → Legend, cinco níveis cada (2K25–2K26); ícone de **Park MVP** sobre a cabeça; **nome do recordista de vitórias seguidas na lateral da quadra** [OFICIAL] [CR City 2K26](https://nba.2k.com/2k26/courtside-report/the-city/).
- **HUD de badges**: faixa com o nome do badge + losango do nível no topo, nota de companheiro em letra (B, B+), anel e barra de energia **sob os pés** [CLIPE].
- **Social**: chat de voz, emotes pelo RS andando pela City, flops pelo B ×2 [COMUNIDADE].

---

## 6. Recomendações para o Projeto Garrafão

Respeitando: **sim-arcade** (D1), **controles do 2K23 no Xbox** (D6), **sem Explosões/Adrenaline** (D13, só stamina), **janela green maior** (D12), **visual realista com ferramentas abertas** (D7: o green fica no HUD, no som e na pose, **sem brilho cartunesco** no jogador), **mocap CMU agora e atletas do diretor depois** (D9).

### 6.1 P0: próximas 2 semanas (Freestyle)

| # | Entrega | Detalhe e critério de pronto | Seções | Esforço |
|---|---|---|---|---|
| **P0-1** | **Linha do tempo do green "Park"** | Implementar a sequência da §1.1 com dois modos: **Instantâneo** (padrão no Freestyle: "ding" na soltura, como o "Simple" do 2K25) e **Na cesta** (como o 2K23: ding e banner quando a bola chega ao aro). Banner nosso no canto superior direito por **2,0 s**: "TEMPO: PERFEITO · CONTESTAÇÃO: ABERTO" (textos e layout próprios; categorias do `03-arremessos.md §3.2–3.3`). Pronto quando os tempos medidos no jogo batem com a tabela da §1.1 (±100 ms) | 1.1, 1.3 | 1,5 d |
| **P0-2** | **Medidor estilo 2K23 com janela visível** | Enche até o fim **no ideal** e esvazia do lado tarde. A faixa verde aparece (como no 2K26) e já reflete a janela maior do D12. Congela na soltura com a cor do resultado e pisca no green (já existe). Opções: tamanho P/M/G, posição (lado/acima/pés), cor | 1.2 | 1 d |
| **P0-3** | **Camadas de som do arremesso** | (a) **chiado do tênis** no plant do gather e na aterrissagem (variando por superfície); (b) **rede** com 3 variações (swish limpo no green, aro-e-entra, tabela); (c) ding do green com 2–3 timbres e opção de desligar; (d) som de UI no banner. Sons sintetizados ou gravados por nós, ou CC0 conferido. **Implementado (v1, `Source/Garrafao/HoopsAudio` + `HoopsAudioSynth`)**: tudo sintetizado em código, sem amostras: chiado no gather, nos cortes do drible e na aterrissagem; rede limpa e rede abafada (cesta depois do aro; na tabela toca a pancada da tabela + rede); aro e tabela com volume pela força do contato; quique no taco em cada toque no chão (drible e bola solta); ding com opção de desligar (`AudioMix.bMute` ou `GreenSoundVolume` = 0). 2–4 variações por som com variação de pitch/volume. Falta: superfície (asfalto), timbres do ding e som de UI do banner | 1.4 | 1,5 d |
| **P0-4** | **Follow-through e aterrissagem** | Green: braço do arremesso no alto **1,1 s** (faixa 1,0–1,25 s; hoje `GreenHoldSeconds` = 1,3), mão de apoio desce em **0,4 s**. Outros: 0,45 s. Aterrissagem "travada" (#2) no spot-up. Pernas livres pelo LS **300 ms** depois de aterrissar | 3.6, 2.3 | 1 d |
| **P0-5** | **"Vira antes de cair" + encarada** | Se o jogador mexer o LS depois de um green livre, o corpo gira e trota de volta com o braço descendo (#3, CMU 69_34–69_41). **Look-at procedural**: cabeça segue a bola no ar e depois encara o defensor manequim por 0,6 s (#4). É o momento "Park" que já dá para fazer com o que temos. **Implementado (v1)**: parado e sem a bola, 1,3 s depois da soltura de um green, o jogador dá os últimos passos de costas e gira 180° no lugar (CMU 69_39, o ator gira pela curva do mocap) com o braço/celebração por cima; LS ou receber a bola cancela. Falta: trotar de volta sozinho e o look-at (#4) | 2.2, 2.3 | 1,5 d |
| **P0-6** | **Comemorações pelo D-pad (4 slots)** | Janela de **2,5 s** depois da cesta: D-pad = comemoração; fora dela = comandos de laboratório. Slots iniciais: **binóculo de três** (#8, keyframe com dedos), **murro no ar** (#5), **bíceps** (#6, já existe), **ombros** (#7, já existe). Só tronco, cancela em ≤ 100 ms com qualquer ação. **Implementado com CMU (v1)**: cima = bíceps → braços para o alto (142_09), direita = ombros → toca aqui (141_22), baixo = arco e flecha (79_86), esquerda = segura a pose; a mesma direção de novo passa para a segunda do slot. Faltam binóculo (#8, precisa de dedos) e murro no ar (#5) | 2.1, 2.3 | 2 d |
| **P0-7** | **Ritmo do drible no padrão 2K23** | Reprocessar/acelerar os clipes CMU por fase (entre `BallRelease` e `BallCatch`) para **parado 1,8–2,2 Hz, correndo 2,2–2,6 Hz (1 quique a cada 2 passos), baixo/LT ≈ 3 Hz**, sem quebrar o contato mão-bola. Medir no jogo com o detector de "empurrão" que já existe. **LT (v1)**: drible baixo de proteção do 06_13 (2 quiques por loop de 0,77 s, tocado a 1,15 = ~3/s, base escalonada e braço de escudo) | 4.1, 4.3 | 1,5 d |
| **P0-8** | **Ramificar antes do 1º quique + saída do movimento** | Todo drible do Pro Stick pode ser **trocado/cancelado até a bola tocar o chão** (misdirection com RT + direção oposta) e abre a janela de combo depois (`05-gameplay-ataque.md §2.2`). Depois de cada movimento, um **arranque** parametrizado (speedboost para o mesmo lado, cross launch para o oposto: distância nos primeiros 2 passos) que gasta **energia**, nunca um contador de boosts. **Implementado** (núcleo + Unreal, 4 testes): misdirection na janela do commit (RT opcional), arranque de 0,6–1,8 m/s por ~0,45 s a 1,2% da barra por m/s; números em `05-gameplay-ataque.md §2.7` | 4.4, 4.5 | 1,5 d |
| **P0-9** | **Pull-up sem frear** | Do drible lateral em velocidade: último quique vira gather, 1–2 passos de plant com warp, **último quique → soltura ≈ 0,6 s**. Pronto quando o padrão 1 do diretor (`referencias/2k23/README.md`) sai sem parar e com a janela travada no gather. **Implementado** (núcleo + Unreal, 1 teste): o gather mantém 85% da velocidade e desacelera no plant (≤ 0,6 m) até a deriva do salto; falta conferir no jogo com o padrão 1 (`05-gameplay-ataque.md §2.7`) | 3.4 | 1 d |

**Total ≈ 12,5 dias de trabalho**: cabe em 2 semanas com 1–2 pessoas. Se faltar tempo, adiar só a parte de opções do P0-2 (manter o medidor padrão).

**Teste com o diretor no fim do P0**: 3 bolas de 3 seguidas da ala esquerda saindo do drible (como no clipe 05). Pergunta: "**parece 2K Park?**" Medir no lab: cadência do drible, último quique → soltura, duração do follow-through e tempo até o banner.

### 6.2 P1: resto da Fase 0 e Fase 1

| # | Entrega | Seções |
|---|---|---|
| P1-1 | **Variante noturna "Park"** da quadra de rua: refletores, alambrado, música espacializada, 6–15 espectadores com reações (Mass/VAT depois) | 5 |
| P1-2 | **Sequência "em chamas"** visível e realista: 3 greens seguidos → ícone no HUD, público mais alto, fala do MC, celebração automática "Park". Sem fogo na bola (D7); opcional: "bola da sequência" só como cosmético de modo | 1.5, 2.3 |
| P1-3 | **Celebração dinâmica** (2K26): o tipo e a hora da celebração dependem da qualidade (green + livre = na aterrissagem; contestado = só depois de cair) | 1.5, 2.3 |
| P1-4 | Mais 10 gestos do catálogo (#9–#21), priorizando os da **sessão S7** com os atletas do diretor (lista da §2.3 vira a pauta da sessão) | 2.3 |
| P1-5 | **MC de quadra** em português (10–20 falas: green, sequência, ankle-breaker, pôster, vitória) | 1.4, 5 |
| P1-6 | **Câmera**: no 1x1/3x3 de meia quadra, girar com a posse depois da cesta (~0,5 s); na cesta da vitória, corte para câmera baixa sob o aro + replay curto | 1.5 |
| P1-7 | Medidor "linha do tempo" (2K25) como opção, para o online futuro | 1.2 |
| P1-8 | Notifies `SetPoint` e `Push` em todos os arremessos + opção "momento de soltura" com os nomes Salto / Set Point / Empurrão / Soltura | 3.2 |
| P1-9 | Pacotes separados de pull-up, hop, spin e step-back jumper (CMU 124_05 agora; captura S2 depois) | 3.1, 3.4 |
| P1-10 | Dribles com altura variável (alto correndo, baixo perto do defensor) e **proteção** no LT com braço-escudo | 4.3 |

### 6.3 P2: depois

- Dancinhas, telefone, zíper, agachado, pulinhos (#22–#26), **flops** com ragdoll guiado (#27), intros/outros.
- Rep (níveis de rua com nomes nossos), "rei da quadra" com nome na lateral (como os "Streak Setters" do 2K26), MVP da quadra.
- Customização do green (gráfico, posição, som) desbloqueável **jogando**, nunca vendida como vantagem.
- Pose "pendura no aro" física e celebrações de enterrada.

### 6.4 Riscos e cuidados

- **Celebração que prende**: é a frustração nº 1 do pilar 1. Toda comemoração é só tronco e cancelável (≤ 100 ms).
- **Provocação tóxica no online**: no 1x1/3x3 online, gestos de provocação (#11–#14, #23) só depois da cesta, com limite (ex.: 1 a cada 10 s) e opção "ocultar comemorações do adversário".
- **Legal**: nenhum nome, frase ou trejeito de atleta (§2.4). Os clipes do 2K continuam só como referência interna.
- **Realismo × "juice"**: o green é recompensado com **som, pose, câmera e texto**, não com efeitos de partícula no corpo (D7).

---

## 7. Fontes principais (além das citadas no texto)

- Courtside Report 2K23, gameplay (espelho): https://nba2kw.com/nba-2k23-gameplay-breakdown-skill-moves-adrenaline-boosts-badges-pro-stick-dribbling-shooting-more · cópia no Steam: https://steamcommunity.com/app/1919590/discussions/0/3431200155176513941/
- Lista de celebrações do 2K23: https://nba2kw.com/nba-2k23-full-list-of-player-in-game-celebrations · como celebrar/flop/emotes: https://nba2kw.com/nba-2k23-how-to-show-off-hang-on-the-rim-celebrate-flop-emotes-more/
- Mike Wang, 2K25 e 2K26: https://www.nba2klab.com/nba-2k25-mike-wang-faqs · https://www.nba2klab.com/nba-2k26-mike-wang-faqs
- Courtside Reports 2K25/2K26: https://nba.2k.com/2k25/courtside-report/gameplay/ · https://nba.2k.com/2k26/courtside-report/gameplay/ · https://nba.2k.com/2k26/courtside-report/the-city/ · https://nba.2k.com/2k26/courtside-report/presentation/
- NBA2KLab: janelas de green https://www.nba2klab.com/green-windows · histórico https://nba2klab.com/nba2k-how-has-shooting-changed · velocidade de soltura https://www.nba2klab.com/release-speed-test · estilos de drible https://www.nba2klab.com/dribble-styles-explained · dribles 2K23 https://www.nba2klab.com/recommended-dribble-moves
- Base de mocap CMU (busca de clipes por descrição): http://mocap.cs.cmu.edu/search.php
- Clipes e quadros do diretor: `referencias/2k23/` (medições desta seção feitas com ffmpeg em 60 fps; espectrogramas para os eventos de som)
