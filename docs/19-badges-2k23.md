# 19 — Badges, Takeover e HUD de gameplay (padrão NBA 2K23)

> Decisão **D16** (diretor, 2026-10-14): o jogo usa **os 64 badges do NBA 2K23** (next gen), com os mesmos gatilhos,
> boosts e nerfs, mais o Takeover e o HUD de gameplay do 2K23. Isso substitui os "Estilos" de `09-atributos-progressao.md` §3.
> Referência visual: o vídeo do diretor jogando 1x1 na quadra pirata (badges Agent 3, Volume Shooter, Quick First Step,
> Green Machine e Handles for Days aparecendo, nota B-, timing Excellent / Wide Open).

Código: `web/src/sim/HoopsBadges.ts` (catálogo e motor), `HoopsTakeover.ts`, `HoopsTeammateGrade.ts`,
`web/src/game/MatchDirector.ts` (liga tudo à jogada) e `web/src/hud/GameHud.ts` (HUD). Testes: `HoopsBadges.test.ts`.

## 1. Como um badge do 2K vira número no nosso modelo

- **Boost de arremesso** no 2K = pontos percentuais de chance ("+5%"). Somamos os pontos dos badges ativos e
  convertemos uma vez para log-odds na chance base do arremesso: `bonus = logit(p0 + pp) − logit(p0)`. Isso entra em
  `ShotContext.badgeBonus` (teto ±1,2 em log-odds, `maxBadgeBonus`).
- **No 2K23 os badges não aumentam a janela green**: eles sobem a chance dentro dela (2KLab). Como aqui o green livre já é
  cesta garantida, os badges de arremesso pesam nas solturas boas mas não perfeitas e nos greens contestados. Isso é o
  mesmo comportamento do 2K23.
- Os badges que tiram uma fração de uma penalidade devolvem log-odds direto:
  - Amped tira parte da penalidade de cansaço.
  - Deadeye tira parte da penalidade de contestação.
  - Limitless Range tira parte da penalidade de distância.
- **Drible**: multiplicadores no `DribbleController.modifiers`, que mexem no custo de energia, na força do arranque e na
  velocidade dos dribles.
- **Nerfs do defensor**:
  - Challenger e Anchor tiram pontos do atacante.
  - O takeover Perimeter Badge Drop derruba um nível dos badges de arremesso.
  - Os counters (Clamp Breaker × Clamps, Unpluckable × Glove…) estão no catálogo, em `counteredBy`.
- Os números testados pelo 2KLab estão marcados `sourced: true` no código. Os demais são **estimativas** (marcadas
  *(est.)* nas tabelas), porque o 2K não publica esses valores.

## 2. Na mesa: quais valem a pena

Ranking feito a partir dos testes do 2KLab, da tier list da temporada 6 e do que mais ativava em Park/Rec/1x1.

### Tier S: ativam toda posse e decidem jogo (prioridade máxima)

| Badge | Por quê |
|---|---|
| **Quick First Step** | Ativa em toda arrancada do size-up. Testado: chega à velocidade máxima em 62 quadros no HOF, contra 71 sem o badge. |
| **Agent 3** | Quase todo pull-up de 3. É o badge de arremesso mais usado do 2K23. |
| **Handles for Days** | No HOF dá o dobro de dribles antes de cansar. Com o nosso D13 (energia é o único limitador), é ainda mais importante. |
| **Green Machine** | Testado: +15% no Ouro depois de 2 greens seguidos, valendo até errar. Recompensa o skill de timing. |
| **Limitless Range** | Abre a bola de 3 longe, que estica a defesa. |
| **Clamps / Clamp Breaker** | A briga principal do 1x1 na bola: corte contra blow-by. |
| **Glove / Unpluckable** | A briga do roubo de bola. |
| **Blinders, Challenger** | Ativam em todo arremesso contestado. É o duelo arremesso contra contestação. |
| **Anchor, Fearless Finisher, Slithery** | O duelo no aro. |
| **Pick Dodger / Brick Wall, Boxout Beast / Rebound Chaser** | Para o 3x3 e o 5x5: corta-luz e rebote. |

### Tier A: bons na build certa

Catch and Shoot, Volume Shooter (se arremessa 5+ por jogo), Space Creator, Hyperdrive, Killer Combos (exige skill no
Pro Stick), Fast Twitch, Posterizer, Rise Up, Limitless Takeoff, Interceptor, Deadeye, Middy Magician (forte no 1x1),
Break Starter.

### Inúteis: ninguém usava (implementados por fidelidade, mas não vale gastar ponto)

| Badge | Motivo |
|---|---|
| **Clutch Shooter** | Só ativa no fim apertado e dá +2 a +5%. O 2KLab recomenda "nenhum". |
| **Comeback Kid** | Só quando está perdendo por 7 ou mais. |
| **Masher** | Exige ser 3–4" mais alto que o defensor. |
| **Menace** | −1 atributo por nível, quase imperceptível. |
| **Chase Down Artist** | Foi nerfado em relação ao 2K22. |
| **Mismatch Expert** | Retrabalhado e fraco. |
| **Dream Shake** | Funciona contra a IA, mas não contra humanos. |

Raros e de nicho: Corner Specialist, Guard Up, Claymore, Slippery Off-Ball, Work Horse.

**Sugestão de design:** manter os 64 por fidelidade (decisão D16). Na tela de build, destacar os Tier S e mostrar o
custo e o efeito real de cada um. Os "inúteis" ficam baratos de propósito, como o 2K já fazia (badges contra o seu
tamanho custam menos).

## 3. O que já funciona no jogo hoje

| Situação | Badges | Total |
|---|---|---|
| ✅ Ativam no Freestyle | Agent 3, Amped, Catch and Shoot (a bola que volta para a mão conta como passe), Claymore, Corner Specialist, Green Machine, Limitless Range, Middy Magician, Space Creator, Volume Shooter, Handles for Days, Hyperdrive, Quick First Step | 13 |
| 🟡 Lógica pronta, ativa quando o dado chegar | Blinders, Deadeye, Guard Up, Challenger e Anchor (precisam do defensor); Clutch Shooter e Comeback Kid (precisam do placar contra adversário); Acrobat, Fearless Finisher, Giant Slayer, Masher e Pro Touch: bandeja e enterrada já passam pelos badges, mas o Freestyle só tem a bandeja normal e não tem defensor. Faltam os estilos (Acrobat), o contato (Fearless Finisher) e o defensor (os outros) | 12 |
| ⏳ Valor por nível pronto em `BadgeEngine.value(id)` | Passe, post, rebote, roubo e defesa na bola. O sistema que vai ler o valor ainda não existe. | 39 |

**Build padrão (do diretor):** é a build do vídeo e fica em `DirectorLoadout`, no `MatchDirector.ts`.

| Nível | Badges |
|---|---|
| Hall of Fame | Quick First Step, Clamp Breaker |
| Ouro | Agent 3, Volume Shooter, Green Machine, Handles for Days, Limitless Range, Blinders, Unpluckable, Fearless Finisher |
| Prata | Catch and Shoot, Deadeye, Space Creator, Hyperdrive, Slithery |
| Bronze | Middy Magician, Amped, Pro Touch |

### 3.1 Prova de que os buffs funcionam

Medido no próprio modelo (`ShotModel` + `BadgeEngine`), com rating 85 num pull-up de 3 a 7,5 m, livre:

| Soltura | Sem badges | Agent 3 + Volume Shooter + Green Machine (Ouro, depois de 6 greens) |
|---|---|---|
| Boa (logo fora do green) | 36,7% | 64,8% |
| Levemente tarde | 30,1% | 58,8% (o Agent 3 Ouro rende mais nas bordas) |

O green livre continua 100% com ou sem badge, igual ao 2K23.

**Handles for Days**: dribles (hesi-cross) até a energia cair a 40%.

| Nível | Nenhum | Bronze | Prata | Ouro | HOF |
|---|---|---|---|---|---|
| Dribles | 17 | 19 | 21 | 27 | 34 |

**Quick First Step**: o arranque de saída do size-up fica +4%, +8%, +9% e +14% mais forte do Bronze ao HOF. É o inverso
dos quadros até a velocidade máxima medidos pelo 2KLab.

### 3.2 Como cada badge pendente vai funcionar na gameplay

Cada badge já tem o valor por nível. Falta só o sistema que vai consumir esse valor:

| Sistema que falta | Badges | Gancho (onde o valor entra) |
|---|---|---|
| **Defensor IA na bola** (contestação, corte, trombada) | Blinders, Deadeye, Guard Up, Challenger, Clamps, Clamp Breaker, Menace, Ankle Breaker, Ankle Braces, Killer Combos, Mismatch Expert, Space Creator (parte do desequilíbrio), Quick First Step (contra o cut-off) | `ShotSituation.contest/contestFromSide/defenderNearNoContest/defender` já existem: basta o `computeContest` do defensor preencher. Clamps × Clamp Breaker decide cut-off contra blow-by: quadros de reação do Clamps contra os níveis que o Clamp Breaker vence. Ankle Breaker e Killer Combos sobem a chance de desequilíbrio no drible; Ankle Braces reduz essa chance. |
| **Roubo de bola** | Glove, Unpluckable, Vice Grip, Slithery (gather), Post Lockdown | chance de roubo = base × Glove × Unpluckable (multiplicadores do catálogo) × exposição do drible (`DribbleMoveSpec.exposure`, já existe). |
| **Bandeja e enterrada no three.js** | Acrobat, Fearless Finisher, Giant Slayer, Masher, Pro Touch, Anchor (já ligados no `shotModifiers`); Fast Twitch, Limitless Takeoff, Posterizer, Rise Up, Slithery, Bully | Os seis primeiros entram no `shotModifiers`, que já trata `ShotType.Layup/Dunk`. Fast Twitch acelera o clipe; Limitless Takeoff aumenta a distância do salto (pés); Posterizer e Rise Up sobem a chance de pôster. |
| **Post up** | Backdown Punisher, Dropstepper, Post Spin Technician, Dream Shake, Brick Wall, Post Lockdown | Chance de vencer o backdown = Backdown Punisher − Brick Wall. |
| **Passe e companheiros** (3x3/5x5) | Dimer, Floor General, Bail Out, Break Starter, Needle Threader, Post Playmaker, Special Delivery, Aerial Wizard, Interceptor | Dimer e Post Playmaker entram como pontos para quem recebe, no `ShotSituation` dele. Interceptor contra Needle Threader decide o desvio do passe. |
| **Rebote, corta-luz e sem bola** | Boxout Beast, Rebound Chaser, Pogo Stick, Work Horse, Pick Dodger, Brick Wall, Off-Ball Pest, Slippery Off-Ball, Chase Down Artist | Raio de busca do rebote, força do box out, sucesso no corta-luz (Pick Dodger contra Brick Wall). |
| **Placar contra adversário** (1x1 valendo) | Clutch Shooter, Comeback Kid | Os campos `clutch` e `trailingBy` já existem: basta o modo de jogo preencher. |

## 4. Takeover

Primário e secundário por jogador, mais o Team Takeover. Os 24 takeovers do 2K23 estão no catálogo, em `HoopsTakeover.ts`.

**Enchimento** (o 2K não publica números, então estes são a proposta):

| Evento | Medidor |
|---|---|
| Cesta | +12 |
| Cesta de 3 | +14 |
| And-one | +18 |
| Green | +4 |
| Assistência | +10 |
| Roubo ou toco | +12 |
| Rebote | +6 |
| Combo de drible no ritmo | +1,5 |
| Arranque de saída | +2 |
| Erro | −6 |
| Arremesso forçado | −10 |
| Turnover | −15 |
| Levar cesta | −8 |
| Estouro do relógio | −15 |

- **Multiplicadores por tipo:**
  - Takeover de arremesso enche ×1,25 com cestas.
  - Takeover de slasher ou armação enche ×2 com combos e arranques.
- **Dreno parado:** 0,4%/s depois de 10 s sem evento.

**Ativação e duração:**
- Primário cheio fica ativo por 30 s, ou até 2 jogadas ruins.
- Com o primário ativo, as jogadas boas enchem o secundário. Quando ele enche, os dois ficam ativos.
- O Team Takeover enche com 40% dos ganhos (no 1x1 é só o seu pedaço). Cheio, fica ativo por 45 s.

**Padrão:**

| Slot | Takeover | Efeito |
|---|---|---|
| Primário | Easy Blowbys | Arranque +20%, velocidade +4% |
| Secundário | Limitless Range | Sem penalidade de distância até o logo |
| Time | Team Badge Boost | +1 nível em todos os badges |

## 5. HUD de gameplay (igual ao vídeo)

**Canto superior direito:**
- **Faixa de avisos** à esquerda do losango, com três cores:
  - **verde**: `TIMING: EXCELLENT` / `COVERAGE: WIDE OPEN`;
  - **vermelha**: o nome do badge que ativou;
  - **dourada**: evento da nota (`EXCELLENT SHOT RELEASE`, `GOOD SHOT SELECTION`).
- **Losango:** mostra a nota do teammate (A+…F). Durante um aviso, mostra o ícone do badge na cor do nível (bronze,
  prata, ouro, roxo HOF) ou o ícone do arremesso.
- **Cartão preto:** nome e `PTS · REB · AST · 3P%`, com os números em amarelo.
  - Uma varredura vermelha passa por trás das estatísticas quando um badge ativa.
  - Aparece um raio no topo quando o takeover ganha carga.
- **Três quadradinhos embaixo:** Team Takeover, primário e secundário. O fundo vermelho sobe com o medidor; cheio
  brilha; ativo pega fogo.

**Canto inferior direito:** placar com os nomes, os pontos e o relógio de posse em vermelho (pisca abaixo de 5 s).

**Embaixo do jogador:** anel vermelho no chão (vira fogo laranja com o takeover), o nome e a barra de energia.

**Labels de timing** (2K23). O nosso "Bom" fica entre o green e o "leve":

| Nosso grau | Label |
|---|---|
| Green | EXCELLENT |
| Bom | SLIGHTLY EARLY / SLIGHTLY LATE |
| Leve | EARLY / LATE |
| Muito | VERY EARLY / VERY LATE |

**Labels de cobertura** (pela contestação):

| Contestação | Label |
|---|---|
| < 0,05 | WIDE OPEN |
| < 0,20 | OPEN |
| < 0,65 | LIGHTLY CONTESTED |
| < 0,90 | HEAVILY CONTESTED |
| resto | SMOTHERED |

**Nota de teammate:**
- Os pesos do 2K23 são baixo ±0,5, médio ±1 e alto ±2. As subidas encolhem perto do A+.
- A partida começa em C.
- A seleção de arremesso é avaliada em toda soltura:
  - **boa** quando o arremesso é livre e está dentro do alcance;
  - **ruim** quando é contestado acima de 65%, ou longe demais sem Limitless Range.

## 5.1 Tela de badges e regras de build

Abre com **B** no teclado ou **View** no controle, e o jogo pausa enquanto ela está aberta. Código em
`web/src/hud/BadgeMenu.ts` e `web/src/sim/HoopsBadgeBuild.ts`.

**Layout:**
- Quatro abas, uma por categoria, cada uma com os pontos usados sobre o total.
- Os badges ficam agrupados em **Tier 3 → Tier 2 → Tier 1**, como no 2K23 next gen.
- Cada cartão mostra:
  - o ícone na cor do nível;
  - as barrinhas de nível (B/S/G/HOF);
  - as etiquetas META / SITUACIONAL / POUCO USADO;
  - o estado no jogo (ATIVO, PRONTO ou EM BREVE);
  - quantas vezes o badge ativou nesta partida.
- O painel da direita traz:
  - como o badge ativa;
  - o efeito e o custo em cada nível, com indicação de testado ou estimativa;
  - os counters;
  - o que falta para ele funcionar aqui.

**Controles:**

| Ação | Teclado | Controle |
|---|---|---|
| Trocar categoria | Q / E | LB / RB |
| Escolher badge | setas | D-pad |
| Subir nível | Enter | A |
| Escolher nível direto | 0–4 | — |
| Desequipar | Backspace | X |
| Voltar ao jogo | Esc | B |

Também há os botões "Build do diretor" e "Limpar categoria".

**Regras do 2K23 next gen:**

| Tier | Badges por categoria | Custo (Bronze / Prata / Ouro / HOF) |
|---|---|---|
| Tier 1 | 8 | 1 / 2 / 3 / 4 |
| Tier 2 | 4 | 3 / 4 / 5 / 6 |
| Tier 3 | 4 | 5 / 6 / 7 / 8 |

- **Tier 3 só destrava com 10 pontos equipados em Tier 1/2** da mesma categoria. Pela mesma regra, não dá para tirar
  um Tier 1/2 que está segurando o destrave.
- No 2K o tier muda com a altura da build. A tabela atual é a de um armador de 1,96 m.
- Os tiers confirmados pelo 2KLab:
  - Agent 3: T3;
  - Limitless Range: T3;
  - Catch and Shoot: T2;
  - Amped: T2;
  - Slithery: T3;
  - Acrobat: T2;
  - Giant Slayer: T1;
  - Ankle Breaker: T1;
  - Bail Out: T2;
  - Ankle Braces: T2;
  - Anchor: T1.

  O resto foi distribuído para fechar 8/4/4 em cada categoria.
- Pontos da build do diretor:

  | Finalização | Arremesso | Armação | Defesa |
  |---|---|---|---|
  | 30 | 52 | 44 | 30 |

  No 2K esses pontos vêm dos atributos. Aqui ficam em `DirectorBudget` até existir a criação de jogador.
- A build fica salva no navegador (`localStorage`). Se a build salva for inválida, o jogo volta para a do diretor.

## 6. Os 64 badges

Legenda: *(est.)* = estimativa (sem teste publicado). Ativa = com que frequência disparava numa partida normal.

### Finalização

| Badge | Gatilho | Efeito (B / S / G / HOF) | Contra | Uso no 2K23 | Ativa | No jogo |
|---|---|---|---|---|---|---|
| **Acrobat** | Bandeja de spin, hop step, euro, cradle, reverse ou troca de mão no ar | +pp na bandeja acrobática: 3 / 6 / 10 / 12 *(est.)* | Anchor | Situacional | Média | 🟡 pronto (falta dado) — bandejas com estilo |
| **Aerial Wizard** | Ponte aérea e putback de rebote ofensivo | % a mais na janela do alley-oop: 10 / 20 / 30 / 40 *(est.)* | — | Situacional | Rara | ⏳ pendente — passe e alley-oop |
| **Backdown Punisher** | Backdown no garrafão (post up) | +% de vencer o backdown: 8 / 15 / 22 / 30 *(est.)* | Brick Wall, Post Lockdown | Situacional | Média | ⏳ pendente — jogo de costas (post) |
| **Bully** | Infiltração com contato, bandeja do Pro Stick no corpo do defensor | +% de vencer o contato: 10 / 18 / 22 / 30 *(est.)* | Brick Wall | Situacional | Média | ⏳ pendente — contato com defensor |
| **Dream Shake** | Fintas, shimmy e pump fake no post | +% de deixar o defensor parado: 10 / 20 / 30 / 40 *(est.)* | — | ❌ Inútil | Rara | ⏳ pendente — post e defensor |
| **Dropstepper** | Drop step e hop step no post | +% de passar pelo defensor: 5 / 10 / 15 / 20 *(est.)* | Post Lockdown | Situacional | Média | ⏳ pendente — post |
| **Fast Twitch** | Bandeja/enterrada parado embaixo do aro | % mais rápida a animação: 5 / 9 / 13 / 17 *(est.)* | Anchor, Pogo Stick | 🔥 META | Alta | ⏳ pendente — finalização parada |
| **Fearless Finisher** | Bandeja com contato | +pp na bandeja contestada com contato (HOF +14 testado): 4 / 8 / 11 / 14 | — | 🔥 META | Alta | 🟡 pronto (falta dado) — bandeja com contato |
| **Giant Slayer** | Bandeja contra defensor mais alto | +pp na bandeja (e menos toco): 3 / 5 / 8 / 10 *(est.)* | — | Situacional | Média | 🟡 pronto (falta dado) — defensor |
| **Limitless Takeoff** | Enterrada na infiltração: sai do chão mais longe | pés a mais de distância do salto: 0.5 / 1 / 2 / 3 *(est.)* | — | 🔥 META | Média | ⏳ pendente — enterrada |
| **Masher** | Finalização no aro sendo 3–4" mais alto que o defensor | +pp no aro: 3 / 5 / 7 / 9 *(est.)* | — | ❌ Inútil | Rara | 🟡 pronto (falta dado) — defensor |
| **Post Spin Technician** | Spin no post e spin na infiltração | +% de passar pelo defensor: 5 / 10 / 15 / 25 *(est.)* | Post Lockdown | Situacional | Média | ⏳ pendente — post |
| **Posterizer** | Enterrada com contato | +% de pôster: 5 / 10 / 15 / 20 *(est.)* | Anchor | 🔥 META | Média | ⏳ pendente — enterrada com contato |
| **Pro Touch** | Bandeja solta Slightly Early, Slightly Late ou Excellent | +pp contra contestação vermelha (HOF +6 testado; amarela é metade): 2 / 3 / 4 / 6 | — | Situacional | Alta | 🟡 pronto (falta dado) — bandeja |
| **Rise Up** | Enterrada parado no garrafão | +% de enterrada/pôster: 6 / 12 / 18 / 24 *(est.)* | Anchor | 🔥 META | Média | ⏳ pendente — enterrada parada |
| **Slithery** | Gather e finalização no meio do tráfego | +% de escapar do contato (e −% de roubo no gather): 10 / 20 / 30 / 40 *(est.)* | — | 🔥 META | Alta | ⏳ pendente — contato e roubo no gather |

### Arremesso

| Badge | Gatilho | Efeito (B / S / G / HOF) | Contra | Uso no 2K23 | Ativa | No jogo |
|---|---|---|---|---|---|---|
| **Agent 3** | Bola de 3 saindo do drible: pull-up, stop-and-pop, de 3 andando, depois de um drible do Pro Stick (não step-back) | +pp no centro da janela (Ouro/HOF sobem mais nas bordas): 1 / 5 / 5 / 7 | Challenger | 🔥 META | Alta | ✅ ativo |
| **Amped** | Arremesso com menos de 50% de energia | % da penalidade de cansaço removida (a soltura lenta continua): 25 / 50 / 75 / 100 *(est.)* | — | Situacional | Média | ✅ ativo |
| **Blinders** | Defensor fechando pela visão periférica (lado ou costas) | +pp (empilha com Deadeye): 2 / 4 / 6 / 9 *(est.)* | Challenger | 🔥 META | Alta | 🟡 pronto (falta dado) — defensor |
| **Catch and Shoot** | Arremesso logo depois de receber o passe (~1,5 s), parado | +pp (testado: +2,5 / +5 / +8 / +10): 2.5 / 5 / 8 / 10 | Challenger | Situacional | Alta | ✅ ativo |
| **Claymore** | Spot-up parado: cresce quanto mais tempo parado (1 s → 3 s) | +pp no máximo: 2 / 4 / 6 / 8 *(est.)* | — | Situacional | Média | ✅ ativo |
| **Clutch Shooter** | Fim de jogo apertado (Park: um time com 15+ e diferença ≤ 8) | +pp (testado: Bronze ~+2, HOF ~+5): 2 / 3 / 4 / 5 | — | ❌ Inútil | Rara | 🟡 pronto (falta dado) — placar contra adversário |
| **Comeback Kid** | Seu time perdendo por 7 ou mais | +pp: 2 / 4 / 6 / 8 *(est.)* | — | ❌ Inútil | Rara | 🟡 pronto (falta dado) — placar contra adversário |
| **Corner Specialist** | Bola de 3 do canto (fundo da quadra) | +pp: 2 / 4 / 6 / 8 *(est.)* | — | Situacional | Rara | ✅ ativo |
| **Deadeye** | Defensor fechando o arremesso | % da penalidade de contestação removida: 15 / 30 / 45 / 60 *(est.)* | Challenger | Situacional | Alta | 🟡 pronto (falta dado) — defensor |
| **Green Machine** | 2 solturas Excellent seguidas: vale a partir do 3º arremesso até errar | +pp (testado: ~+15 no Ouro): 5 / 10 / 15 / 17 | — | 🔥 META | Média | ✅ ativo |
| **Guard Up** | Defensor perto que não contesta (mão baixa, sem pular) | +pp: 3 / 5 / 7 / 9 *(est.)* | — | Situacional | Rara | 🟡 pronto (falta dado) — defensor |
| **Limitless Range** | Bola de 3 bem atrás da linha (~26 pés / 7,9 m ou mais) | % da penalidade de distância removida: 25 / 50 / 75 / 90 *(est.)* | — | 🔥 META | Alta | ✅ ativo |
| **Middy Magician** | Meia distância saindo do drible: pull-up, spin, fadeaway (não perto do aro) | +pp: 3 / 5 / 7 / 9 *(est.)* | — | Situacional | Média | ✅ ativo |
| **Slippery Off-Ball** | Correndo sem a bola por bloqueios e tráfego | −% de ser segurado/trombado: 15 / 30 / 45 / 60 *(est.)* | Off-Ball Pest | Situacional | Média | ⏳ pendente — jogo sem a bola (5x5) |
| **Space Creator** | Arremesso de step-back (e mais desequilíbrio no defensor) | +pp no step-back: 3 / 5 / 7 / 10 *(est.)* | Ankle Braces | Situacional | Média | ✅ ativo |
| **Volume Shooter** | Cresce desde o 1º arremesso do jogo (cesta ou erro); máximo no 5º–6º | +pp no máximo (testado: HOF ~+10): 4 / 6 / 8 / 10 | — | Situacional | Alta | ✅ ativo |

### Armação

| Badge | Gatilho | Efeito (B / S / G / HOF) | Contra | Uso no 2K23 | Ativa | No jogo |
|---|---|---|---|---|---|---|
| **Ankle Breaker** | Step-back e dribles quando o defensor cai na finta | +% de desequilibrar/derrubar: 10 / 20 / 30 / 40 *(est.)* | Ankle Braces | Situacional | Média | ⏳ pendente — defensor |
| **Bail Out** | Passe no meio do arremesso/bandeja ou saindo da dobra | −% de passe errado: 30 / 45 / 60 / 75 *(est.)* | — | Situacional | Rara | ⏳ pendente — passe |
| **Break Starter** | Passe longo de saída logo depois do rebote defensivo | % de recepção limpa (sem badge ~50%): 65 / 75 / 85 / 95 | — | 🔥 META | Média | ⏳ pendente — rebote e passe |
| **Clamp Breaker** | Defensor trombando ou no hip ride | níveis de Clamps que vence (HOF vence todos): 1 / 3 / 3 / 4 | — | 🔥 META | Alta | ⏳ pendente — contato com defensor |
| **Dimer** | Passe para arremessador livre na meia quadra | +pp para quem recebe: 2 / 4 / 6 / 8 *(est.)* | — | Situacional | Média | ⏳ pendente — companheiros |
| **Floor General** | Em quadra (o dono não ganha nada) | +atributos ofensivos dos companheiros: 1 / 2 / 3 / 4 | — | Situacional | Alta | ⏳ pendente — companheiros |
| **Handles for Days** | Dribles seguidos | dribles até cansar (sem badge: 4): 4.5 / 5 / 6.5 / 8 | — | 🔥 META | Alta | ✅ ativo |
| **Hyperdrive** | Dribles do Pro Stick em movimento, atacando | % mais rápidos: 3 / 6 / 9 / 12 *(est.)* | Clamps | Situacional | Alta | ✅ ativo |
| **Killer Combos** | Combos de drible no size-up (parado) | desequilíbrios por posse (HOF 2–3; sem badge 0). Não acelera: 0.5 / 1 / 2 / 2.5 | Ankle Braces | Situacional | Média | ⏳ pendente — defensor |
| **Mismatch Expert** | Armador marcado por defensor mais alto, 1x1 | +% de passar: 5 / 10 / 15 / 20 *(est.)* | — | ❌ Inútil | Rara | ⏳ pendente — defensor |
| **Needle Threader** | Passe entre dois defensores (principalmente quicado) | −% de roubo/desvio: 15 / 25 / 35 / 45 *(est.)* | Interceptor | Situacional | Média | ⏳ pendente — passe |
| **Post Playmaker** | Passe saindo do post ou depois do rebote ofensivo | +pp para quem recebe: 2 / 4 / 6 / 8 *(est.)* | — | Situacional | Média | ⏳ pendente — post e passe |
| **Quick First Step** | Arrancada saindo do triple threat ou do size-up | % menos tempo até a velocidade máxima (testado: 71 → 68/66/65/62 quadros): 4 / 7 / 8 / 12 | Clamps | 🔥 META | Alta | ✅ ativo |
| **Special Delivery** | Depois de passes de efeito | +% de acerto do alley-oop: 5 / 10 / 15 / 20 *(est.)* | — | Situacional | Rara | ⏳ pendente — passe e alley-oop |
| **Unpluckable** | Tentativa de roubo de tapa/alcance do defensor (não de corpo) | × chance de roubo do defensor: 0.85 / 0.7 / 0.5 / 0.4 *(est.)* | — | 🔥 META | Alta | ⏳ pendente — roubo de bola |
| **Vice Grip** | Logo depois do rebote, da recepção ou de pegar bola solta (~1 s) | −% de roubo: 20 / 35 / 50 / 65 *(est.)* | — | Situacional | Média | ⏳ pendente — roubo de bola |

### Defesa e rebote

| Badge | Gatilho | Efeito (B / S / G / HOF) | Contra | Uso no 2K23 | Ativa | No jogo |
|---|---|---|---|---|---|---|
| **Anchor** | Arremessos no aro ou perto dele | −pp de acerto do atacante no garrafão: -4 / -7 / -10 / -14 *(est.)* | — | 🔥 META | Alta | 🟡 pronto (falta dado) — defensor no garrafão |
| **Ankle Braces** | Dribles do atacante | −% de ser desequilibrado: 15 / 30 / 45 / 60 *(est.)* | — | Situacional | Média | ⏳ pendente — defensor |
| **Boxout Beast** | Box out nos dois lados da quadra | +% de vencer o box out: 10 / 20 / 30 / 40 *(est.)* | Rebound Chaser | 🔥 META | Alta | ⏳ pendente — rebote disputado |
| **Brick Wall** | Corta-luz, defesa de post e contato | % a mais de resistência no backdown (HOF +100): 25 / 50 / 75 / 100 | Pick Dodger | 🔥 META | Alta | ⏳ pendente — contato e corta-luz |
| **Challenger** | Contestação no tempo certo num arremesso do perímetro | −pp de acerto do arremessador: -2 / -4 / -6 / -9 *(est.)* | — | 🔥 META | Alta | 🟡 pronto (falta dado) — defensor |
| **Chase Down Artist** | Perseguindo o atacante por trás para o toco | +% de velocidade/salto: 3 / 6 / 9 / 12 *(est.)* | — | ❌ Inútil | Rara | ⏳ pendente — toco |
| **Clamps** | Defesa na bola: cut-off, trombada, hip ride | quadros do cut-off (Bronze 38 → HOF 31): 38 / 36 / 34 / 31 | Clamp Breaker | 🔥 META | Alta | ⏳ pendente — defesa na bola |
| **Glove** | Roubo no drible, no tapa e no gather | × chance de roubo: 1.1 / 1.3 / 1.6 / 1.65 *(est.)* | Unpluckable, Slithery, Vice Grip | 🔥 META | Alta | ⏳ pendente — roubo de bola |
| **Interceptor** | Linhas de passe | × desvios e interceptações: 1.2 / 1.4 / 1.6 / 1.8 *(est.)* | Needle Threader, Break Starter | 🔥 META | Média | ⏳ pendente — passe |
| **Menace** | Defesa colada de frente (fora do garrafão) | −atributos do atacante: -1 / -2 / -3 / -4 *(est.)* | — | ❌ Inútil | Média | ⏳ pendente — defensor |
| **Off-Ball Pest** | Marcando sem a bola | −% de separação do atacante: 10 / 20 / 30 / 40 *(est.)* | — | Situacional | Média | ⏳ pendente — jogo sem a bola |
| **Pick Dodger** | Passando pelo corta-luz (LT segurado) | % de sucesso (testado: +6/+4/+4/+18 por nível; HOF 72% sem Brick Wall): 30 / 34 / 38 / 72 | Brick Wall | 🔥 META | Alta | ⏳ pendente — corta-luz |
| **Pogo Stick** | Pousando depois de rebote, toco ou arremesso | −% de espera para o 2º salto: 10 / 20 / 30 / 40 *(est.)* | — | Situacional | Média | ⏳ pendente — salto e rebote |
| **Post Lockdown** | Roubo no início do movimento de post do atacante | +% de roubo no post: 5 / 10 / 15 / 20 *(est.)* | — | Situacional | Média | ⏳ pendente — post |
| **Rebound Chaser** | Arremessos errados | +% de raio de busca do rebote: 10 / 20 / 30 / 40 *(est.)* | Boxout Beast | 🔥 META | Alta | ⏳ pendente — rebote |
| **Work Horse** | Bolas soltas | +% de velocidade e de recuperar a bola: 5 / 10 / 15 / 20 *(est.)* | — | Situacional | Rara | ⏳ pendente — bola solta |

## 7. Fontes

- 2KLab: testes e descrições dos badges do 2K23 (nba2klab.com/badges-2k23, /videos/quick-first-step,
  /videos/agent-3-2k23, /videos/green-machine-2k23, /videos/volume-shooter, /videos/catch-and-shoot, /videos/clamps,
  /videos/pick-dodger-2k23).
- Guia completo de badges e takeovers do 2K23 (hoopsgamers.com) e patch notes de 19/10/22 e 09/01/23.
- Tier list da temporada 6 (aoeah.com) e Courtside Report do 2K23 (via gamingbolt e impulsegamer).
- Eventos da nota de teammate: Dexerto (hotfix de "Bad Shot Selection") e Diamond Lobby.
