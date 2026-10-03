# 01 — Engenharia Reversa (Análise de Design) do NBA 2K27

> **Método**: análise de design a partir de fontes públicas: notas oficiais da 2K (Courtside Report, newsroom, patch notes), respostas do diretor de gameplay (Mike Wang), testes automatizados da comunidade (NBA2KLab), reviews e avaliações de usuários.
> **Não** descompilamos nem extraímos nada do jogo (ver `00-visao-geral.md §4`).
> Pesquisa feita em **outubro de 2026**, ~1 mês após o lançamento.

**Legenda de confiabilidade**: **[OFICIAL]** 2K · **[DEV]** diretor de gameplay · **[MEDIDO]** teste automatizado da comunidade · **[REVIEW]** crítica · **[COMUNIDADE]** opinião de jogadores (menos confiável).

## 1. Ficha

| Item | Dado |
|---|---|
| Lançamento | 4 set. 2026 (acesso antecipado em 26–27 ago.) |
| Plataformas | PS5, Xbox Series X\|S, Switch 2, PC (PS4/Xbox One/Switch 1 saíram) |
| Metacritic | PS5 78 · XSX 81 · PC 74 · **usuários 3,8/10** (58% negativas) |
| OpenCritic | ~76, 60% dos críticos recomendam |
| Notas | IGN 6 · GameSpot 7 · Game Informer 7,75 · Steam ~51% positivas (recentes) |
| Preço | US$ 69,99 (Standard) / 99,99 / 149,99 + VC (US$ 1,99 a 149,99) + passe de temporada |

Fontes: [Metacritic](https://www.metacritic.com/game/nba-2k27/), [OpenCritic](https://opencritic.com/game/21036/nba-2k27/reviews), [Game Informer](https://gameinformer.com/review/nba-2k27/double-edge), [Wikipedia](https://en.wikipedia.org/wiki/NBA_2K27).

**Resumo em uma frase**: a crítica gosta da **quadra** (movimento, defesa, MyNBA); os jogadores odeiam o **entorno** (pay-to-win, Cidade, latência, anúncios) e desconfiam do arremesso.

---

## 2. Arremesso

### 2.1 Como funciona

| Aspecto | 2K27 | Fonte |
|---|---|---|
| Aleatoriedade | "Não existe RNG que faça você errar; soltura perfeita sempre entra." Janela **pure green** sem RNG desde o 2K26 | [DEV] |
| Ponto de soltura | Fixo por jumper; pequenas variações por blend de animação, energia e transições | [DEV] |
| Largura da janela | Largura a meia altura: **35,3 ms** (2K26: 39,2 ms, ~10% mais apertada). Núcleo "sempre green": **4 ms** (2K26: 8 ms) | [MEDIDO] [NBA2KLab](https://www.nba2klab.com/shooting-comparison) |
| Efeito do rating | O núcleo ≥94% quase não muda (±3,1 ms no 65 → ±3,6 ms no 99). O "ombro" ≥70% cresce ~2,4× (±5,8 → ±13,9 ms). **"O timing te dá o green; o rating impede que uma soltura levemente errada vire tijolo."** | [MEDIDO] [teste de ratings](https://www.nba2klab.com/shooting-ratings-test) |
| Velocidade de soltura | Very Quick −10% de janela, Quick −5%, Slow/Very Slow leve bônus. Cada nível desloca a janela ~15 ms | [DEV] + [MEDIDO] |
| Medidor | Arrow / Ring / Dial; desligar dá janela maior (no 2K26: 57% de acerto sem medidor vs. 48% com) | [DEV] [MEDIDO] |
| Rhythm Shooting (analógico) | Puxa o RS no *set point* e empurra no *tempo* da animação. No 2K26 bastava acertar o **tempo** (tolerante a lag); no 2K27 **voltou a exigir o timing** + marcador de tempo em tempo real; vale também para lance livre | [OFICIAL] |
| Zonas quentes/frias | Hot Zone ≈ +5,4 "pontos" de janela; Cold Zone ≈ −2,1 | [MEDIDO] |
| Adrenalina | Perder adrenalina (por contato/body-up) reduz ratings **e** a janela | [DEV] |
| Resultado em quadra | 3P% da comunidade caiu: Park 45,6→41,2%, 3x3 competitivo 37,6→29,8%, REC 44,5→36,4% | [MEDIDO] |

### 2.2 Contestação

- Feedback de cobertura em **8 níveis coloridos** (arco branco → carmesim) + **Defensive Impact Indicator** (de onde veio a contestação e quanto pesou). [OFICIAL]
- **Altura é o fator mais forte**; Perimeter D "não salva" uma diferença grande de altura/posição. [DEV]
- Histórico: no 2K26, jogadores de **2,24 m (7'4") viraram arremessadores de 3**. Corrigido com patch (+10% de contestação média, +15% se o defensor for mais alto) e, no 2K27, com **tetos de atributo por altura** (um pivô de 7'3" tem teto de ~85 em 3PT). [MEDIDO] [COMUNIDADE]

### 2.3 Bandejas e enterradas

- **Dynamic Layup Engine**: ajustes no ar, troca de mão contra protetor de aro, gathers (euro, hop, spin) desacoplados das finalizações. [OFICIAL]
- **Todas as enterradas têm medidor** no 2K27; a janela **muda do salto à finalização** (cresce com caminho livre, encolhe com closeout tardio). [OFICIAL] [DEV]

### 2.4 O que funciona × o que falha × nossa resposta

| Funciona | Falha | Nossa resposta |
|---|---|---|
| Perfeito = cesta (sem RNG) | Janela de 4–20 ms: "loteria de frame", sensível a lag | Perfeito sempre entra **se livre**; janela Perfeito com **piso de ±17 ms (2 frames)** e ±30 ms no rating 85 → `03-arremessos.md §3.2` |
| Rating amplia o "ombro" e não o green | No 2K26 esse modelo **criou o pivô sniper**, e precisou de remendos (patch + tetos) | Rating amplia a janela **moderadamente** (±18 → ±45 ms) **e** muda o L base; tetos físicos por corpo desde o design → `09` |
| Trade-off explícito de velocidade de soltura | — | Copiamos a ideia (Jump Shot Creator com orçamento de stats) → `03 §6` |
| Feedback de cobertura colorido | "Pressão visual forte registrada como leve"; "janela muda no meio do arremesso"; jogo parece "decidir aleatoriamente" | **Janela travada no gather** (não muda no ar); contestação calculada pela **geometria mão→linha da bola**, desenhada no replay → `03 §3.2–3.3` |
| Rhythm Shooting tolerante a lag (2K26) | 2K27 voltou a exigir timing → lag voltou a doer online | Timing julgado **no relógio local da animação** e validado no servidor → `03 §9` |
| Enterrada com medidor = skill gap (elogiado) | A janela reage tarde demais ao closeout | Enterrada sem medidor obrigatório; resultado decidido no **salto**, com contato físico → `03 §7.2` |
| Hot/Cold zones, adrenalina | Modificadores escondidos que "mexem" na janela | Sem modificador escondido; tudo que muda a janela aparece **antes** do arremesso (ícones) |

---

## 3. Drible e movimento

| Aspecto | 2K27 | Fonte |
|---|---|---|
| Animações | ProPLAY (vídeo de transmissão → animação, desde o 2K24). 2K25 tinha 9.000+ (1.500 de drible, 1.100 de arremesso, 1.300 de movimento, 1.110 bandejas, 434 enterradas, 550 tocos); 2K27 adiciona **7.000+** | [OFICIAL] [DEV] |
| Movimento | "Dynamic Motion Engine" (2K26): pose matching do quadril para baixo com ML, para acabar com o "patinar" | [OFICIAL] |
| Personalização | Pacotes de drible quebrados em **29 movimentos independentes** combináveis | [OFICIAL] |
| Ankle-breakers | "Baseados em habilidade e lógica": leem momento, posição, ratings e reação do defensor | [OFICIAL] |
| Reclamações | "Mudanças bruscas de direção ainda arrastadas, contornando o ângulo em vez de cortar"; corpos se embolando no garrafão; bola "atravessando o corpo" no post | [REVIEW] [Beebom](https://beebom.com/nba-2k27-review/), [ComicBook](https://comicbook.com/gaming/review/nba-2k27-review/) |

**Nossa resposta**: ankle-breaker pelo **vetor de compromisso** do defensor (mesma ideia, e visível) → `05 §2.3`, `06 §2`; **plant-and-cut** com custo previsível em vez de curvas "arredondadas" → `05 §1`; bola com colisores nos jogadores (não atravessa) → `07 §2`; dribles **decompostos em movimentos** e pacotes combináveis (como os 29 do 2K27, mas em escala indie) → `04 §4`.

---

## 4. Defesa

| Aspecto | 2K27 | Nossa resposta |
|---|---|---|
| Hands-up | RS ↑ = agressivo (auto-contestação, verticalidade); RS ↓ = conservador (menos falta) | RS = mão alta/lado; verticalidade no toco → `06 §5` |
| Cutoffs | Rápido (flick) ou investida (gatilho + flick); **roubo pelo RS removido** | Cutoff por posição/ângulo + contato → `06 §3` |
| Roubo | Steal × Ball Handle decide se a bola solta; bug no lançamento fazia defensores fracos roubarem mais que os bons | Roubo por **exposição da bola** + janela da mão → `06 §4`; teste automatizado de "rating maior nunca pior" |
| Ajuda | Sistema de ajuda reescrito, lê linhas de infiltração; elogiado | Influence map de perigo → `08 §3` |
| Rebote | Feedback de timing de rebote | Timing do salto + box-out → `06 §6` |
| Reclamação | Defesa **"exagerada"** no lançamento (difícil passar/pontuar), muitas faltas de alcance, "parece RNG" | Alvos estatísticos validados por **simulação headless** antes de lançar → `08 §6` |

---

## 5. Atributos, badges e Takeover

| 2K27 | Problema | Nossa resposta |
|---|---|---|
| **53 badges** (eram 40), 4–5 níveis, **tokens** com custo variável por altura/posição, **Synergy** (Fuse/Reaction), especializações, Cap Breakers, Rebirth | Complexidade enorme; difícil saber o que ativa o quê | **~24 Estilos**, 3 níveis, 6 slots, efeito explicado em uma linha, desbloqueados jogando → `09 §3` |
| Matriz limpa de badges de arremesso (pés posicionados × em movimento, 3PT × meia distância) | — | Boa ideia de organização: nossos Estilos de arremesso seguem a mesma matriz |
| **Takeover**: 5 medidores × 6 níveis (Frozen → Takeover); ao encher, ativa sozinho por algumas posses | Nerf de Takeovers quebrados na primeira semana (um deles dava 500/500 greens numa faixa de 20 ms) | "Em chamas" único, visível e com efeito pequeno; no streetball, **Hype da quadra** (opcional) → `10 §1.4` |
| Build máxima: ~200k VC até 85 OVR, 360k+ até 99 (≈ US$ 80–100 por build) | **Pay-to-win** na Cidade | Atributos só jogando; nada de VC → `09 §6` |

---

## 6. IA

- **[OFICIAL]** "Set AI": ações que passam por "hubs" (ex.: pivô que distribui), **planos de jogo em tempo real** que caçam mismatches, armadores que caçam o mismatch preferido via corta-luz, melhores leituras de pick & roll.
- **[REVIEW]** comportamento inconsistente ("Ben Wallace arremessando de 3"); outros dizem que a IA conhece melhor os pontos fortes de cada jogador.

**Nossa resposta**: decisão por **pontos esperados** + tendências, com o mesmo "controle virtual" do jogador → `08`.

---

## 7. Modos, apresentação e monetização

| 2K27 | Recepção | Lição para nós |
|---|---|---|
| MyCAREER "Fire & Concrete": 11 capítulos, **5 Eras** (1984–2016), co-op com "Running Mate" | Eras elogiadas; o companheiro forçado foi criticado (GI, IGN) | História curta e pulável; nada de companheiro obrigatório → `10 §2` |
| Cidade co-ed (jogadoras e jogadores no mesmo sistema de atributos), Crews, REC, Rucker Park | Cidade = "desastre de UI", "lobby gigante", **cheia de "baleias"** | Começar por quadras locais/online simples; hub social só se houver público → `10 §1.3` |
| MyNBA (CBA real, Legacy de 100 anos) | "Melhor modo de franquia dos esportes" (GI) | Franquia/GM é pós-Early Access, mas é uma referência forte |
| Apresentação: filtros de transmissão por era, Cidade neon, DLSS 5 no PC, 60 fps no Switch 2 | "Estagnada" (entradas, intervalo, tempos) | Investir em **quadras de rua lindas** e juice, não em cerimônia de TV → `11` |
| VC compartilhado entre modos, anúncios, missões patrocinadas, passe fraco | Principal fonte de nota 3,8 dos usuários | Preço único, sem anúncios, cosméticos opcionais |
| PC: crashes com GPU < 8 GB, **teclas não remapeáveis**, cheaters, sem crossplay Steam↔PS5 | Steam ~51% | Remapeamento total, anti-cheat de timing, teste em GPU de 6–8 GB → `02`, `03 §9` |

---

## 8. Outros jogos: lições

| Jogo | Lição |
|---|---|
| **NBA The Run (2026)** — o análogo mais próximo do nosso projeto | UE5, animação **feita à mão**, cel-shading, 3x3 com **rollback**, US$ 29,99, sem microtransações. Elogiado pela rede e pelo controle; criticado pelo **feedback de arremesso impreciso sem medidor**, por "**não ter colisões reais**" e pelo pouco conteúdo no lançamento. → Nosso diferencial: colisão física + feedback claro + visual realista estilizado |
| **NBA Elite 11** (cancelado) | Prometeu movimento 100% por física → "pose de Jesus" na demo → cancelado a uma semana do lançamento. **Não apostar o lançamento em tecnologia de animação não provada** |
| **NBA Live 14+** | A física da bola (bounceTek) era boa, mas os corpos se moviam mal. **Qualidade do movimento > fidelidade da bola** |
| **NBA Playgrounds** | Timing opaco fazia lendas errarem bandejas (o medidor veio em patch); online chegou 2 meses atrasado; roubos fortes demais. **Feedback claro; online no lançamento** |
| **NBA Street Vol. 2** | Medidor de estilo → "Gamebreaker" (pontos a mais e tira ponto do rival). **Estilo vira placar** |
| **NBA Jam** | "On Fire", espetáculo de enterradas. Rubber-band de recuperação (nós evitamos) |
| **College Hoops 2K8** | Medidor de torcida ("6th Man") que influenciava o jogo: **atmosfera como sistema de gameplay** |
| **Hoop Land** (indie) | 2D retrô + sistemas de liga profundos: escopo pequeno bem feito vende |
| **Rematch (futebol, 2025–26)** | Predição de bola/jogadores gerou defesas que "viravam gol" no rollback → reescrita completa da rede. **Rede desde o design, não remendo** |

---

## 9. Dez regras que tiramos desta análise

1. **Timing decide; rating suaviza.** Mas com tetos físicos, para não criar o pivô sniper.
2. **A janela não muda depois que o arremesso começa.**
3. **O que o defensor parece fazer é o que conta** (contestação geométrica, visível no replay).
4. **Nenhum modificador escondido** (zonas, adrenalina, "speedups"). Se afeta o arremesso, aparece na tela.
5. **Latência não decide arremesso.**
6. **Menos sistemas, mais claros** (24 Estilos, não 53 badges com tokens e sinergias).
7. **Movimento bonito > bola perfeita**, mas a bola nunca atravessa um corpo.
8. **Defesa recompensadora, mas validada por simulação** antes de lançar (o 2K27 saiu "defensivo demais").
9. **Zero pay-to-win, zero anúncios.** É a principal fonte de ódio ao 2K.
10. **Online e remapeamento de teclas no lançamento** (lições do Playgrounds e do 2K27 no PC).
