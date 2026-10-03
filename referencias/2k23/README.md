# Referências — NBA 2K23 (gameplay do diretor do projeto)

Clipes de gameplay enviados em 03/10/2026 pelo diretor do projeto (jogador **cardoso2k**). O 2K23 é a versão favorita dele e a principal referência de **sensação de drible e arremesso** do nosso jogo.

> Uso: **referência interna de design**. São imagens de um jogo de terceiros (2K/Take-Two). Não distribuir junto com o jogo nem usar em material público.
> Vídeos versionados com **Git LFS** (`git lfs pull` para baixar).

## Clipes

| Arquivo | Duração | Modo | O que mostra |
|---|---|---|---|
| `2k23-01_1v1-quadra-pirata_drible-longo-e-poster.mp4` | 29 s | 1x1 (quadra temática de navio pirata) | Posse longa de drible, ~11 s, atravessando o perímetro de ala a ala → infiltração pela esquerda → **pôster** (badge Posterizer). Depois uma bola de 3 (8 → 11) |
| `2k23-02_myteam-clutch-time-5v5_kobe.mp4` | 9 s | MyTEAM Clutch Time 5x5 | Jogada com falta (4 pontos), feedback "RELEASE: LATE / COVERAGE: WIDE OPEN" no placar suspenso, close-up de comemoração (pele, suor, uniforme), menu de pausa |
| `2k23-03_3v3-goat-boat_drible-e-bola-de-3.mp4` | 19 s | 3x3 no Park (GOAT Boat) | Drible no perímetro com badges Unpluckable, Hyperdrive e Handles for Days → bola de 3 (12 → 15); câmera do Park girando com a posse |
| `2k23-04_1v1-quadra-pirata_copia-identica-do-01.mp4` | 29 s | — | **Cópia idêntica** do clipe 01 (mesmo hash). Mantido porque foi enviado |
| `2k23-05_1v1-quadra-pirata_tres-bolas-de-3.mp4` | 27 s | 1x1 | **Três bolas de 3** seguidas da ala esquerda (12 → 15 → 18 → 21?), todas no mesmo padrão; feedback "TIMING: EXCELLENT / COVERAGE: WIDE OPEN" |

## Quadros-chave (`frames/`)

| Arquivo | Conteúdo |
|---|---|
| `05_bola-de-3_a/b/c` | Sequência quadro a quadro (6 fps) da 3ª bola de 3 do clipe 05 |
| `01_posse-longa_a…d` | Sequência (4 fps) da posse longa do clipe 01, até a infiltração e o pôster |
| `feedback-timing-excellent-wide-open.jpg` | Feedback de arremesso do 2K23 no HUD |
| `feedback-release-late-wide-open_placar-clutch-time.jpg` | Feedback de arremesso no placar suspenso (MyTEAM) |
| `closeup-pele-suor.jpg` | Close-up de comemoração: referência de pele/suor/uniforme |

## Análise: o estilo de jogo do diretor

### Padrão 1 — "Drible até a ala e pull-up de 3" (clipe 05, 3×)

Linha do tempo da 3ª bola de 3 (tempo relativo ao início da jogada):

| t (s) | Ação | Observação |
|---|---|---|
| 0,0–0,8 | **Size-up** no topo da quadra, de frente para o defensor, a ~1,5 m | Bola trocando de mão, pernas abertas, ritmo |
| 1,0–1,3 | **Primeiro passo explosivo** para a esquerda da tela | Badge *Quick First Step* aparece |
| 1,5–2,2 | **Drible lateral em velocidade** em direção à ala esquerda, afastando-se da cesta | O defensor fica no garrafão (não acompanha) |
| 2,3–2,5 | **Gather** abaixado (pés se posicionando em movimento) | Transição drible → arremesso sem parar |
| 2,5–3,1 | Subida e **soltura no topo do salto** | ~**0,75 s do gather à soltura** |
| 3,1–4,0 | Aterrissagem e follow-through mantido | Feedback "TIMING: EXCELLENT / COVERAGE: WIDE OPEN"; badges *Agent 3*, *Volume Shooter*, *Green Machine* |

**O que o nosso jogo precisa para isso ser gostoso:**
1. Transição **drible em velocidade → pull-up** sem frear até parar (gather em movimento, "momentum pull-up").
2. Size-up responsivo no lugar, com troca de mão rápida.
3. Primeiro passo explosivo que **realmente** ganha espaço quando o defensor está mal posicionado.
4. Feedback de timing e cobertura logo após a soltura, legível em < 1 s.
5. A satisfação da sequência de acertos (*Green Machine*): o nosso "Em chamas" visível (ver `docs/03-arremessos.md §3.4`).

### Padrão 2 — "Posse longa, movimento constante e infiltração" (clipe 01)

- Cerca de **11 s de drible** numa única posse (relógio de 16 → 4,7). O jogador **não para**: retrocede (retreat dribble) para resetar o espaço, corre lateralmente pelo arco de uma ala até a outra, faz hesitações baixas e trocas de direção em velocidade.
- Movimentos identificados: crossovers baixos no lugar, retreat dribble, drible lateral em velocidade, hesitação baixa (corpo quase agachado), trocas de mão em movimento (provável behind-the-back/crossover em corrida), mudança de direção aguda e **ataque à cesta pela esquerda** com finalização por cima do defensor.
- Badges que disparam em sequência: *Quick First Step*, *Hyperdrive* (moves em movimento), *Handles for Days* (menos energia gasta por drible), *Amped* (recuperação de energia), *Posterizer*.

**O que o nosso jogo precisa:**
1. **Dribles encadeados em movimento** (não só parado) sem perder velocidade: crossover, behind-the-back, entre as pernas, spin, hesitação, todos com versão "em corrida".
2. **Retreat dribble** e drible lateral fluidos (o jogador "dança" pelo perímetro).
3. **Energia** que limita o spam mas permite posses longas para quem gerencia bem (*Handles for Days*, *Amped*).
4. **Spin em velocidade** e mudanças de direção que não "arredondam" a curva.
5. Infiltração que termina em **enterrada com contato** quando o defensor chega atrasado.

### HUD do 2K23 observado

- **Topo, centro-direita**: nome do badge ativado + ícone do nível (losango colorido) + linha de estatísticas do jogador (PTS, REB, AST, 3P%) + nota de companheiro (C, B, B+).
- **Mensagens de feedback**: "EXCELLENT SHOT RELEASE", "GOOD SHOT SELECTION", "TIMING: EXCELLENT / COVERAGE: WIDE OPEN".
- **Embaixo à direita**: placar com os nomes dos jogadores e relógio de posse.
- **Sob os pés**: anel indicador do jogador controlado (com ícone) + **barra de energia** logo abaixo.

### Câmera

- 1x1: câmera lateral elevada e afastada, mostrando a meia-quadra inteira; o aro sempre visível no topo da tela.
- Park 3x3: câmera similar que **acompanha e gira** quando a posse muda de lado.
- Replay/fim de jogo: câmera atrás da tabela.
