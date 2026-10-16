# 23 — Menu principal e MyPlayer Builder (estilo 2K)

> Pedido do diretor (2026-10-16): menu de jogo bonito e completo inspirado no 2K, criação do jogador (nome, altura,
> envergadura…), builder de atributos com caps por corpo, "Shades Of" no fim e a build valendo no Freestyle.
> Código: `web/src/build/` (regras), `web/src/menu/` (telas). Testes: `web/src/build/build.test.ts`,
> `web/src/menu/builder/*.test.ts`.

## 1. Fluxo

```
Menu principal ─┬─ Freestyle ───────────────────────────────────────────────▶ Freestyle (build ativa)
                ├─ Meu Jogador ─▶ builds salvas ─┬─ Jogar Freestyle ────────▶ Freestyle
                │                                ├─ Editar / Criar nova build
                │                                │    ▼
                │                                │  Jogador (nome, sobrenome, posição, mão, nº, país)
                │                                │    ▼
                │                                │  Corpo (altura, peso, envergadura, tipo; caps ao vivo)
                │                                │    ▼
                │                                │  Atributos (pontos, OVR, potencial restante, físico, badges, presets)
                │                                │    ▼
                │                                │  Shades Of + "VOCÊ CRIOU UM: <arquétipo>"
                │                                │    ├─ Salvar e jogar / Testar build ─▶ Freestyle
                │                                │    └─ Editar build / Voltar às builds
                │                                └─ Excluir build
                └─ Minha Carreira, 1 contra 1, 3x3, Configurações: "EM DESENVOLVIMENTO"
```

- O jogador 3D fica no meio de todas as telas (showroom: mesma cena, arena desfocada, foco de luz). A altura da build
  escala o boneco ao vivo; arrastar com o mouse ou o RS gira o jogador.
- Pausa (P / Start) → **Menu principal** volta ao menu (recarrega com `?menu=1`).
- Controles: setas/WASD ou D-pad/LS navegam, Enter/A confirma, Esc/B volta, Tab/Y = ação secundária, Q/E ou LB/RB = abas.

### 1.1 Quando o menu aparece

| Situação | Menu |
|---|---|
| Abrir `/` no navegador | Sim |
| Playwright / ferramentas (`navigator.webdriver`) | **Não**: vai direto ao Freestyle, como antes |
| `?lab=1` | Não |
| `?menu=0` | Não |
| `?menu=1` | Sim (força, inclusive no Playwright) |

As telas do menu são carregadas por `import()` dinâmico: o Freestyle dos testes não depende delas.

## 2. O que veio do 2K (pesquisa, com fonte) e o que é nosso

| Item | 2K (fonte) | No jogo |
|---|---|---|
| Atributos | 2K25/2K26: Close Shot, Driving Layup, Driving Dunk, Standing Dunk, Post Control · Mid-Range, Three-Point, Free Throw · Pass Accuracy, Ball Handle, Speed With Ball · Interior/Perimeter Defense, Steal, Block · Off/Def Rebound · Speed, Agility (era Acceleration até o 2K24), Strength, Vertical, Stamina | Os mesmos 22, em português. Mantemos **Aceleração** (é o que o nosso movimento usa e o que aparece nos prints do diretor) |
| Começo dos atributos | 25; Stamina começa em 85 (2K25) | Igual (`AttrStart`) |
| Altura máxima por posição | 2K25: PG 6'7", SG 6'8", SF 6'10", PF 7'0", C 7'3"; 2K26: até 7'4"; mínimo 5'9" | Igual; os mínimos por posição não foram publicados, são nossos (`HeightRangeIn`) |
| Envergadura | ±6" da altura (guia 2K26); builds Pro-Tuned entre 0 e +6" | ±6" |
| Peso | Builds 2K26: PG 175–225 lb … C 230–259 lb | Típico pela altura −14% … +12% |
| Teto de bola de 3 por altura | 2K25 (guia pré-lançamento): 99 até 6'5", 94 em 6'6", 89 em 6'7", 88 em 6'8", 87 em 6'9", 86 de 6'10" a 7'2", 85 em 7'3" | Tabela exata (`ThreePointCapByHeightIn`); 7'4" = 84 (extrapolado) |
| Teto dos outros atributos | **Não publicado** | `CapTable` nossa, por âncoras de altura (o que combina com o tamanho sobe, o resto desce) |
| Envergadura e peso nos tetos | **Não publicado** (o 2K só diz que mudam) | Nosso: por polegada de envergadura e por 10 kg acima do típico (`WingspanPerInch`, `WeightPer10Kg`) |
| Orçamento | 2K26 tem um medidor "Remaining Attribute Potential"; total fixo não publicado | 1500 pontos por build; custo por ponto 1 (até 59), 2 (60–69), 3 (70–79), 4 (80–89), 5 (90+) |
| Overall | Fórmula não publicada (Ronnie 2K: 30–40 "mini atributos") | Média ponderada por posição, esticada (`overall`) |
| Nome do arquétipo | Padrão 2K26 "qualificador + papel" ("2-Way 3-Level Scorer", "Iso Sniper"); regra não publicada | Nossa: papel pelas 2 maiores habilidades, qualificadores pela 3ª e pela defesa (`archetypeName`) |
| Shades Of | Existe (2K25 "NBA Player Comparisons"); critério não publicado | Nossa: distância entre o perfil de 7 habilidades e a altura da build e de ~45 jogadores de referência (`shadesOf`) |
| Cap Breakers | 2K25: 15, +5 acima do cap, ganhos com REP | Ainda não (fica para a Carreira) |

Fontes: nba.2k.com (Courtside Reports MyPLAYER Builder 2K25 e 2K26), newsroom.2k.com (2K25), hoopsgamers.com (atributos,
caps de 3PT, builds 2K26), nba2klab.com (62 builds Pro-Tuned, requisitos de animação), destructoid.com (requisitos de
badge 2K26), si.com (entrevista Ronnie 2K sobre o OVR).

### 2.1 Efeitos do corpo nos tetos (regra nossa, com o espírito do 2K)

- **Mais envergadura (por polegada acima da altura):** 3 −1,6 · meia −1,1 · lance livre −0,6 · drible −1,3 ·
  vel. c/ bola −0,5 · passe −0,4 · roubo +0,9 · toco +1,6 · def. interior +0,9 · def. perímetro +0,6 ·
  reb. of. +1,1 · reb. def. +1,2 · enterrada +0,7 · enterrada parado +1,1 · perto +0,3.
- **Braço curto** devolve só metade do que o braço longo tira; não transforma um 6'8" em arremessador 99.
- **Mais peso (por 10 kg acima do típico):** força +9 · poste, enterrada parado, def. interior +2 · rebotes +1 ·
  velocidade −4 · aceleração −5 · impulsão −5 · vel. c/ bola −3 · resistência −2 · enterrada −2 · def. perímetro −2.

Exemplos verificados nos testes:
- Armador de 6'1" com braço curto: 3 = 99, toco < 70.
- Pivô de 7'2" com +6": toco 99, 3 < 80.

## 3. O que a build muda no Freestyle (`BuildRatings.ts`)

| Sistema | Antes (fixo) | Agora |
|---|---|---|
| Rating do arremesso (janela do green e chance) | 85 | Bola de 3 / Meia distância / Perto (< 3,05 m) |
| Bandeja | rating do plano | rating do plano + (Bandeja − 85) |
| Enterrada | 80 (FinishSpecs) | + (Enterrada − 80) |
| Floater | 85 | Arremesso de perto |
| Velocidade máxima driblando | ×1 | × fator de Velocidade com bola (25 → −11%, 99 → +7% em relação à padrão) |
| Pontos de badge por categoria | DirectorBudget | Da build (0–88; a padrão dá o DirectorBudget); badges salvas descem de nível até caber |
| Nome no HUD / tela de badges | cardoso2k / "Armador arremessador · 1,96 m" | Nome da build / arquétipo · altura |

**Build padrão** (`DefaultBuild`, armador de 6'5" / 1,96 m): é a que vale sem nenhuma build salva. Ela dá **exatamente**
os números de antes (teste `build padrão = Freestyle de antes do builder`). Os testes e as ferramentas do Freestyle não
mudam.

Ainda **não** entram no Freestyle:
- aceleração;
- controle de bola (janela/energia do drible);
- impulsão;
- resistência na barra de energia;
- requisitos de atributo das badges e das animações. No 2K26: Limitless Range pede 3PT 83/89/93/96/99; Posterizer,
  DD 73 + Vert 65; Elite Contact Dunk, DD 96 + Vert 82.
- altura do boneco: no Freestyle ele volta ao tamanho do modelo, porque a física e as animações são calibradas para ele.

## 4. Arquivos

| Arquivo | O quê |
|---|---|
| `build/PlayerBuild.ts` | Tipos, os 22 atributos (nomes, grupos, cores, descrições), posições, formatos (pés/m, kg/lb) |
| `build/BuildRules.ts` | Faixas de corpo, caps, custo/orçamento, overall, pontos de badge, arquétipo, Shades Of, build padrão |
| `build/BuildRatings.ts` | Build → ratings do Freestyle |
| `build/BuildBadges.ts` | Ajusta as badges salvas ao orçamento da build |
| `build/BuildSave.ts` | Builds no `localStorage` (`garrafao.builds.v1`) e a ativa |
| `menu/MenuFlow.ts` | Moldura, troca de telas, teclado/controle, laço do showroom |
| `menu/Showroom.ts` | Jogador 3D no meio (câmera fixa, altura ao vivo, giro) |
| `menu/MainMenu.ts`, `BuildList.ts`, `CreatePlayer.ts`, `BodyScreen.ts`, `ShadesOf.ts`, `FormList.ts`, `menu.css` | Telas |
| `menu/builder/` | Tela de atributos (sessão "Builder de atributos estilo 2K") |

## 5. Próximos passos

1. Ligar aceleração, controle de bola, impulsão e resistência ao Freestyle, cada um com a padrão = número de hoje.
2. Requisitos de atributo nas badges (tabela do 2K26) e nas animações de enterrada.
3. Altura e envergadura de verdade no Freestyle: escala do boneco + alcance no aro, toco e drible.
4. Minha Carreira: Cap Breakers (+5 acima do cap), progressão por uso (`09-atributos-progressao.md` §4).
5. Antes de lançar: trocar os nomes reais do Shades Of por lendas fictícias da nossa liga (brief: liga e jogadores
   fictícios).
