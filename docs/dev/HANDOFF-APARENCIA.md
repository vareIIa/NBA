# Handoff — Aparência, fases 1 e 2 (para o release)

Sessão da aparência (nba-e4), 2026-10-16. Resposta ao pedido da sessão "Multiplayer 1v1" (dona do release), que fechou
antes da resposta chegar. Sem commit, publicação nem push. Doc da feature: `docs/26-aparencia.md`.

## Fase 2 (cores): o que mudou, para somar à lista da fase 1

**Novos:**
- `web/src/game/GearColors.ts` (shader das zonas de cor: `paintZones`, `loadZoneMask`)
- `web/src/build/ColorEdit.ts`, `web/src/build/ColorEdit.test.ts` (matiz, saturação e brilho)
- `web/public/assets/look/zonas/<peça>_zonas.webp` e `<peça>_zonas.json` (9 peças, ~800 KB no total)
- `web/e2e/aparencia-cores.spec.ts`
- `web/tools/zonas-cor.py` (agora gera as máscaras; na fase 1 era só protótipo)

**Editados** (vários arquivos já tinham edição de outra sessão sem commit; o diff da aparência é só o trecho abaixo):

| Arquivo | Trecho |
|---|---|
| `build/PlayerLook.ts` | reescrito: `kitAway`, `colors`, `GearZones`, `UniformPalette`, `matchWear`, `wearFor`, `mainColor`, `zoneHex`, `lookColors`, `colorDistance`/`clashes`; saíram `kitsFor` e `matchKits` |
| `build/PlayerLook.test.ts` | reescrito (regras novas, máscaras, limpeza das cores, 4 KB) |
| `game/PlayerGear.ts` | `GearColors` (tipo); `fetch` baixa a máscara junto e marca `userData.piece`; `dress(animator, scenes, colors?)`; `paint(colors)`; `wear` chama `paintZones` depois do avesso |
| `game/PlayerOutfit.ts` | reescrito: lado (`side`), `apply(look, side)`, pinta sem revestir quando só muda cor |
| `game/LimbPush.ts` | `patch` idempotente por material (tênis_r e tênis_l dividem o material; o patch duplo dava "uCapA redefinition" com as zonas). Correção feita junto com outra sessão, que fez a mesma mudança; ficou uma só |
| `game/OnlineMatch.ts` | só o `create` (`wearFor`; o `RemotePlayer` recebe `wear`) |
| `game/cpu/CpuOpponent.ts` | só o `load` (`wearFor`; `PlayerOutfit` com `side`) |
| `online/RemotePlayer.ts` | opção `wear: Side` no lugar de `kit` |
| `online/EchoTest.ts` | `wear: 'visitante'` no lugar de `kit: 'branca'` |
| `main.ts` | `wearFor` para o lado de cada um no 1x1 (no lugar de `kitsFor`) |
| `menu/AppearanceScreen.ts` | reescrito: linhas de escolha e de ajuste, 4 modelos, zonas, paleta, matiz/saturação/brilho, cartão com a regra |
| `menu/Showroom.ts` | `setLook(look, side)`; `apply(look, side)` |
| `menu/MenuScreen.ts`, `menu/MenuFlow.ts` | `wear?()` na interface e a chamada `setLook(..., wear)` |
| `menu/menu.css` | bloco `.ap-*` da fase 2 (linhas, zonas, paleta, ajustes, blocos) |
| `e2e/menu.spec.ts` | uniforme e tênis pelo novo teclado; build salva com `kitAway` |

**Protocolo:** `PlayerCard.look` e a build aceitam `kitAway` e `colors` (opcionais). Cliente da fase 1 (sem os campos)
continua funcionando: `kitAway` sai como o outro modelo e `colors` sai como as cores originais. O `ProtocolVersion` não
muda. `sanitizeLook` segue como o único validador (Hub e BuildCatalog), e `PlayerLook.ts` continua sem imports. Tamanho:
a build com as 4 zonas de todas as peças escolhidas cabe nos 4 KB (teste).

**Atenção no release:** `PlayerGear.ts`, `main.ts`, `OnlineMatch.ts`, `CpuOpponent.ts`, `RemotePlayer.ts`, `MenuFlow.ts`,
`Showroom.ts`, `menu.css` e `menu.spec.ts` também têm edições de outras sessões sem commit. Publicar com o diff da
aparência (procurar `wearFor`, `GearColors`, `paintZones`, `userData.piece`, `kitAway`).

## Rodada 5 (2026-10-17): roupa costurada no Blender e tênis refeitos

Pedido do diretor: fazer a 5ª rodada inteira no Blender e deixar todo o uniforme limpo (tênis dobrando com o pé sem a
pele atravessar; regata e bermuda sem bordas rasgadas, furos, "tie-dye" ou corpo aparecendo). Detalhes em docs/20
("Roupa costurada" e "Quinta rodada") e docs/26.

| Arquivo | O quê |
|---|---|
| `Tools/Animacao/costurar.py` (novo) | regata e bermuda feitas no Blender: grades por raios até a pele, cortes exatos (barra, gola, cavas), debrum, pesos, ossos de pano, textura assada e máscaras de zona |
| `Tools/Animacao/vestir.py` | tênis: meia (casca da pele soldada, ribana, lábio), cano refeito até o colarinho por tipo (`--cano=alto\|medio\|baixo`), UVs de paleta, conferência `CONFERE` nos 38 clipes |
| `web/public/assets/gear/*.glb` (9) | as 4 peças costuradas e os 5 tênis regenerados |
| `web/public/assets/look/zonas/{regata,bermuda}_{vermelha,branca}_zonas.webp` e `.json` | máscaras exatas (tecido e debrum); as dos tênis não mudaram |
| `web/src/game/PlayerGear.ts` | sem CuffPull nem `shoeCuffs`; `coverBody` com a pele funda (`DeepUnderGear`, peça a até 12 cm em volta); LimbPush só na bermuda (joelho, antebraço, mão); regata até 35°; `keepOutOfCore` nas molas |
| `web/src/game/BodyCover.ts` | conta na pose de ligação (`skinnedWorldPositions(m, true)`, `bindBonePosition`); teste "em volta" (`around`, 14 direções), sem erosão nessa pele; saiu `cutBelowCuff` |
| `web/src/game/GearColors.ts` | peça de textura assada (`BakedGear`) leva a sombra toda na cor trocada |
| `web/src/build/PlayerLook.ts` | `GearZones` da regata e da bermuda (cores lisas dos kits) e `BakedGear` |
| `web/src/build/PlayerLook.test.ts` | cor principal do kit de casa: `#c8202c` |
| `web/e2e/aparencia-cores.spec.ts` | procura a malha pintada do tênis (o GLB traz as meias antes dele, sem zonas) |
| `web/tools/roupa-qa.mjs` | variável `JS` (código na página antes das poses) |
| `web/tools/perto.mjs`, `web/tools/zonas-costura.py` (novos) | close-ups do jogador parado; máscaras de zona da roupa costurada |
| `web/src/game/CuffPull.ts`, `web/tools/tenis-quadros.mjs` | apagados |
| `docs/20-modelos-3d-roupas-tenis.md`, `docs/26-aparencia.md`, este arquivo | seções novas e atualizadas |

**Verificado (2026-10-17):** tsc limpo; vitest 38 arquivos / 435 testes; e2e freestyle, movement, menu,
aparencia-cores, cpu e online (`E2E_HUB_PORT=8797`) com 15 de 16 no run completo. A falha foi a intermitente conhecida
`cpu.spec.ts:91` (a CPU roubou e marcou antes da jogada montar); repetida 2 vezes, passou nas 2. `roupa-qa.mjs` nas 8 poses
com os dois kits e tênis diferentes; no Blender, os clipes de arremesso, giro, drible baixo e bandeja com as peças; tênis
contra meia sem cruzamento nas 267 poses dos 5 tênis.

## Tênis e meia (rodadas 1–4, 2026-10-16/17): o que mudou

Correção do tênis atravessando a perna, feita por um agente desta sessão. O estado visual tinha defeito (meia com a
boca irregular e grossa, colarinho do tênis encaroçado); a rodada 5 (acima) trocou a meia e o cano e tirou o CuffPull.

| Arquivo | O quê |
|---|---|
| `Tools/Animacao/vestir.py` | bloco do tênis: pesos copiados da pele e meia procedural (`sock_envelope`) |
| `web/public/assets/gear/tenis_*.glb` (5) | regenerados: pesos novos + `meia_r`/`meia_l` no mesmo GLB; UV e textura iguais, as máscaras de cor continuam valendo |
| `web/src/game/CuffPull.ts` (novo) | puxa a pele da perna para dentro da meia no vertex shader do corpo |
| `web/src/game/BodyCover.ts` | `cutBelowCuff` no fim do arquivo (só isso mudou em relação ao HEAD) |
| `web/src/game/PlayerGear.ts` | `shoeCuffs`, `cuffs`/`cuff`, chamadas em `dress`, `coverBody`, `dispose` e `update` |
| `web/tools/tenis-quadros.mjs` (novo) | quadros dos pés em movimento |
| `web/tools/roupa-qa.mjs` (novo) | prints de conferência de toda a roupa: 8 poses × 11 vistas |
| `docs/20-modelos-3d-roupas-tenis.md` | seção "Pé e tênis (16/10)" |

Verificado em 2026-10-17: tsc limpo, vitest 38 arquivos / 434 testes. O agente rodou os e2e freestyle, movement, menu e
aparencia-cores: 9 de 9 num Vite próprio.

## Arquivos

Caminhos a partir de `NBA/`.

**Novos:**
- `web/src/build/PlayerLook.ts`, `web/src/build/PlayerLook.test.ts`
- `web/src/game/SkinTone.ts`, `web/src/game/PlayerOutfit.ts`
- `web/src/menu/AppearanceScreen.ts`
- `web/public/assets/look/pele_mascara.webp`, `web/public/assets/look/rosto_mascara.webp` (~430 KB, fora do LFS)
- `web/tools/pele-mascara.py`, `web/tools/aparencia-prints.mjs`
- `docs/26-aparencia.md`, este arquivo
- `web/tools/zonas-cor.py`: protótipo da fase 2, nada o usa ainda; pode ficar fora.

**Editados (trechos):**

| Arquivo | Trecho |
|---|---|
| `build/PlayerBuild.ts` | campo `look` e import de tipo |
| `build/BuildRules.ts` | `look` no DefaultBuild, no newDraft e no sanitizeBuild |
| `net/builds/BuildCatalog.ts` | `look: sanitizeLook(...)` no normalizeBuild |
| `net/protocol.ts` | `PlayerCard.look?`, import de tipo, comentário "só importa tipos". O `ProtocolVersion` não mudou |
| `net/playerCard.ts` | look no cartão |
| `net/hub/Hub.ts` | `look: sanitizeLook(c.look)` no sanitizeCard e o import |
| `game/cpu/CpuRoster.ts` | cpuBuild com aparência sorteada pelo id; look no cpuCard |
| `game/cpu/CpuOpponent.ts` | só o `load` (PlayerOutfit + kitsFor; a CPU é a visitante) |
| `game/OnlineMatch.ts` | só o `create` (kitsFor + look do oponente) e um import |
| `online/RemotePlayer.ts` | opção `look` no lugar de `shoes` (ninguém passava) e o load via PlayerOutfit |
| `game/PlayerGear.ts` | `load` = `fetch` + `dress`; `dispose` novo |
| `main.ts` | PlayerOutfit no lugar do PlayerGear.load; build.look depois do menu com a regra do uniforme; `__debug.gear` virou getter; `__debug.outfit` e `__showroom.outfit` |
| `menu/Showroom.ts`, `menu/MenuScreen.ts`, `menu/MenuFlow.ts` | setLook/setFocus; tela nova entre Jogador e Corpo |
| `menu/BodyScreen.ts`, `menu/builder/BuilderView.ts`, `menu/BuildList.ts`, `menu/CreatePlayer.ts`, `menu/ShadesOf.ts` | `look()` ao lado do `body()` |
| `menu/menu.css` | bloco `.ap-*` |
| `e2e/menu.spec.ts` | o fluxo passa pela Aparência |
| `docs/23-myplayer-builder.md` | uma linha no diagrama |

## Estado da fase 2 (2026-10-16, noite)

- `tsc --noEmit`: limpo.
- `vitest run`: 38 arquivos, 434 testes, todos passando.
- e2e completo (`E2E_HUB_PORT=8796`): 30 de 32 no último run. As 2 falhas (`online.spec.ts:108` e
  `online-p2p.spec.ts:186`, "estado online não chegou: null") não são do shader; rodadas sozinhas, 6 de 6 passaram.
  Tratar como flake de tempo sob carga do run completo.
- Specs novos: `e2e/aparencia-cores.spec.ts` (passa); `e2e/menu.spec.ts` (passa).
- Capturas de conferência: `web/test-results/aparencia/01-uniforme-cores.png`, `02-tenis-cores.png`; prints de
  três aparências com cores em `%TEMP%` (`cores18/`).
- Limites: a textura do HY tem pinceladas; cores muito diferentes da original deixam mistura de zonas (ver
  `docs/26-aparencia.md`, "Limites conhecidos"). Número e nome nas costas: não feito (caminho em docs/26).

## Estado da fase 1 (2026-10-16, 20:45)

- tsc limpo; vitest 37 arquivos / 422 testes.
- e2e completo (`E2E_HUB_PORT=8795`): 30 de 31; `menu.spec` atualizado e passando.
- Falha intermitente em `cpu.spec.ts:91` ("Defesa do jogador contra a CPU: toco e roubo"): no `--repeat-each 2` passou
  uma vez e falhou na outra. Nas falhas, a CPU rouba e marca antes de o `setUpCpuBall` montar a jogada (placar 0x4 e
  0x5, eventos steal/score): é o sorteio do roubo. A aparência da CPU não muda atributo nem cartão.

## Para quem joga

> Na criação do jogador entrou a tela Aparência, antes do Corpo: tom de pele (15 tons), uniforme de casa e de visitante
> e tênis, com o jogador vestindo na hora e a câmera indo ao rosto, ao tronco e aos pés. Dá para escolher a cor de cada
> parte do uniforme e do tênis (paleta de 16 cores e ajuste de matiz, saturação e brilho). A aparência vale no
> Freestyle, no 1x1 online (o adversário te vê como você se montou; se a cor principal do visitante bater com a do
> mandante, o visitante veste o uniforme de casa dele) e contra a CPU (cada adversário tem a sua cara).

## Protocolo e validação

- `PlayerCard.look?` é opcional e compatível com cliente antigo (sem o campo, vale a aparência padrão).
- O servidor valida no `sanitizeCard` (Hub) e no `normalizeBuild` (BuildCatalog), pelo mesmo `sanitizeLook`.
  `PlayerLook.ts` não tem imports e roda no Node e no Worker.
- Só aceita:
  - skin `#rrggbb`, por regex;
  - `kit` e `kitAway` da lista (vermelha, branca);
  - shoes da lista dos 5 GLBs;
  - `colors` (fase 2): até 4 `#rrggbb` por lado (casa, visitante, tênis); `''` = cor original da zona.

  O resto vira o padrão: não dá para mandar caminho arbitrário de GLB.
- Tamanho: ~70 bytes sem cores; com as cores de todas as peças, bem abaixo dos 4 KB da build (teste) e dos 64 KB do
  quadro.
