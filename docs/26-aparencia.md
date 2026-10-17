# 26 — Aparência do jogador (MyPlayer: rosto, pele, cabelo, roupa, tênis)

> Pedido do diretor (2026-10-16): na criação do personagem, editar a aparência inteira, como no 2K: rosto, cabelo,
> roupa, tênis, cor da pele, "tudo que for possível". Modelos novos saem do HY 3D Studio (skill `hy3d-studio`, pelo
> Chrome logado), como as roupas e a arena (docs/20).
> Decisões do diretor: a tela de aparência vem **antes do corpo** (como no 2K); no 1x1, se os dois vestirem o mesmo
> uniforme, **o visitante troca** para o outro.

## 1. Fluxo

```
Jogador (nome, posição, mão, nº, país) ─▶ APARÊNCIA ─▶ Corpo ─▶ Atributos ─▶ Shades Of
                                           ├─ Pele      (câmera no rosto)
                                           ├─ Uniforme  (câmera no tronco; casa e visitante, modelo e cores)
                                           └─ Tênis     (câmera nos pés; modelo e cores)
```

- LB/RB (Q/E) trocam de aba; o D-pad escolhe e o jogador do showroom **veste na hora**; Y (Tab) sorteia tudo; A passa
  para a próxima aba e, na última, para o Continuar; B volta ao Jogador.
- O cartão "SEU VISUAL" à direita resume a escolha (casa, visitante e tênis, com a cor principal de cada um) e traz a
  regra do 1 contra 1.
- Na aba Uniforme, a 1ª fileira são os 4 modelos (casa vermelho e branco; visitante vermelho e branco). Escolher um
  modelo põe o lado em foco: o showroom veste aquele uniforme. Abaixo: as zonas da peça, a paleta de 16 cores e os
  ajustes de matiz, saturação e brilho (←→ muda o valor). Na aba Tênis, a fileira são os 5 tênis, e abaixo, as cores.
- Nas outras telas (lista de builds, corpo, atributos, Shades Of) o showroom veste a aparência da build mostrada.

## 2. Como cada parte funciona

### Pele (`game/SkinTone.ts`, `tools/pele-mascara.py`)

O corpo do HY tem a pele pintada nas texturas `Pele` (2048 px) e `Rosto` (1024 px), junto com o cabelo, as
sobrancelhas, os olhos e os lábios. A máscara de cada textura diz o que é pele:

- `assets/look/pele_mascara.webp` e `rosto_mascara.webp`: R = pele, G = cabelo pintado, B = lábios;
- gerada por cor, pelo script: o branco do olho do HY é branco-azulado e a pele, até no brilho, é rosada. O frio sai da
  pele, o escuro vira cabelo, e lábios e orelhas ficam na pele (escurecem com ela).

O shader troca a cor só onde a máscara manda:

```
detalhe = texel / TextureSkin
pele    = tom × mix(luma(detalhe), detalhe, croma)
```

- Com o tom do modelo (`TextureSkin`, o 2º da paleta), sai a textura exata: a build padrão não muda.
- Longe dele o croma cai até 0,55, e as orelhas muito vermelhas do HY não ficam rosadas numa pele escura.
- A emissão fraca do corpo (docs/20, "Pele no jogo") recebe o mesmo fator.
- Trocar de tom só muda uniforms, sem recompilar o shader.

Refazer a máscara depois de trocar o corpo:

```
python -I web/tools/pele-mascara.py web/public/assets/hoops_player.glb web/public/assets/look [pasta de conferência]
```

### Uniforme e tênis (`game/PlayerOutfit.ts`, `game/PlayerGear.ts`)

- `PlayerOutfit` aplica um `PlayerLook` num jogador: pele no mesmo quadro, roupa baixada em segundo plano.
- Troca de roupa: `PlayerGear.fetch` baixa as peças novas; num quadro só, a velha sai (`dispose`) e a nova entra
  (`dress`). O jogador não aparece pelado.
- `PlayerGear.dispose` devolve o corpo ao que era antes de vestir: a geometria sem o recorte do BodyCover, as partes
  escondidas e as cores.
- Pedidos seguidos (passar pelos tênis com o D-pad) não se acumulam: vale o último.
- Medido no headless (RX 9070 XT): **~230 ms** para trocar kit + tênis, baixando e vestindo; a pele, 0 ms.

#### Cores (fase 2)

Cada peça (regata, bermuda, tênis) tem até **4 zonas**: a principal (zona 0, a maior área), a detalhe, o debrum e uma
extra. Gravadas em `web/public/assets/look/zonas/<peça>_zonas.webp` (peso de cada zona, um canal R, G, B, A por zona) e
`<peça>_zonas.json` (cor de cada uma, `null` = zona que a peça não tem). As cores originais estão em `GearZones`
(`build/PlayerLook.ts`); um teste confere com os JSON.
- **Tênis**: as zonas saem da própria textura do HY, agrupando as cores pelo `web/tools/zonas-cor.py` (k-means em Lab;
  grupos do mesmo matiz e cinzas/brancos parecidos viram uma zona; até 4).
- **Regata e bermuda** (costuradas no Blender, docs/20 "Roupa costurada"): zonas exatas, tecido e debrum, gravadas pelo
  `costurar.py` (`--zonas`) e convertidas pelo `web/tools/zonas-costura.py`. A cor de cada zona é a cor lisa do kit.

| Peça | Zonas (cor original) |
|---|---|
| Regata e bermuda vermelhas | tecido `#c8202c`, debrum `#f2f2f2` |
| Regata e bermuda brancas | tecido `#f2f2f2`, debrum `#c8202c` |
| Tênis cimento 4 | cimento (cinza-claro), branca, cinza-escuro, vermelho (4) |
| Tênis verniz 11 | preto, azul-gelo, branco, cinza (4) |
| Tênis retrô alto 1, elefante 3, baixo moderno | 3 zonas cada |

O **shader** (`game/GearColors.ts`, no padrão do `SkinTone`) troca a cor média de cada zona pela escolhida e guarda o
relevo da textura:

```
zOrig  = Σ peso_j × cor original da zona j
zNew   = Σ peso_j × cor escolhida da zona j
detalhe = texel / zOrig                      (≈ 1 no tecido liso)
sombra  = mix(1, mix(luma(detalhe), detalhe, croma), força)
cor     = zNew × sombra
```

- Com a cor igual à original: `zNew = zOrig`, croma 1 e força 1, então sai a textura exata (a build padrão não muda).
- Cor trocada: o croma cai até 0 (só o brilho vai) e a força até 0,3, porque o contraste claro-escuro das pinceladas
  da textura do HY, com a cor toda, vira listras da cor nova. O detalhe da razão por canal é limitado a 1,6× nas zonas
  trocadas, para a listra branca de um vermelho não virar mancha.
- Peças de textura assada (`BakedGear`: regata e bermuda, cor lisa vezes a sombra das dobras): a força fica 1, e a cor
  nova sai com a mesma sombra da original, como se a peça fosse costurada naquela cor.
- O shader entra em `color_fragment`, depois da cor base e do avesso (`PlayerGear.insideColor`); o avesso também recebe
  a cor nova. Encadeia no `onBeforeCompile` que já existe; `customProgramCacheKey = gearColors:<tipo>`.
- Uniforms no material (`userData.zones`): trocar de cor só muda uniforms (`PlayerGear.paint`), sem revestir a peça;
  trocar de modelo (ou de tênis) baixa as peças e a máscara e veste num quadro só, já com as cores.

**Dados** (`PlayerLook`): `kit` = uniforme de casa, `kitAway` = uniforme de visitante (sem o campo numa build antiga: o
outro modelo), `shoes` como antes, e `colors?: { casa?, visitante?, tenis? }`, cada um com até 4 `#rrggbb` (ou `''` =
original da zona). O saneamento (`sanitizeLook`) aceita só hex, corta em 4 e tira as pontas vazias; sem cor escolhida o
campo some. Uma build com as 4 zonas de todas as peças escolhidas cabe nos 4 KB (um teste confere).

**Paleta e ajustes** (`build/ColorEdit.ts`, tela): 16 cores rápidas (`UniformPalette`, também sorteadas pelo Aleatório);
matiz ±10°, saturação e brilho ±5 pontos sobre a cor da zona (HSL de sRGB). Zona original aparece com listra no chip.

### Na partida

| Onde | Aparência |
|---|---|
| Freestyle | A da build ativa (`main.ts`). `?uniforme=branco`, `?tenis=<GLB>` e `?pele=<0–14 ou rrggbb>` trocam por cima; `?roupa=0` tira a roupa e mantém a pele |
| 1x1 online | Vai no cartão do jogador (`PlayerCard.look`, saneado no `Hub`). Cada um veste o uniforme do seu lado (`wearFor`): o mandante (lado 0, quem criou a sala) veste o de casa; o visitante veste o de visitante. Se a **cor principal** do visitante (zona 0 da regata, `mainColor`) se confundir com a do mandante (ΔE76 abaixo de 25, `clashes`), o visitante veste o de casa dele; se os dois também se confundirem, fica o de visitante. Os dois clientes chegam ao mesmo par. Cliente antigo sem o campo: aparência padrão |
| 1x1 contra a CPU | Cada adversário tem uma aparência sorteada pelo id (`cpuBuild`, sempre a mesma), e veste o de visitante (com a mesma regra de choque). O jogador é o mandante e veste o de casa |
| Builds compartilhadas | A aparência vai junto (`normalizeBuild` saneia) e cabe nos 4 KB |

Builds salvas antes da tela abrem com a aparência padrão (`sanitizeBuild`); builds da fase 1 (sem visitante nem cores)
abrem com o visitante no outro modelo e sem cores.

**Limites conhecidos da fase 2:**
- As texturas do HY dos tênis são pinturas com pinceladas. Com cores muito diferentes da original, a zona recebe a cor
  nova, mas as pinceladas de zonas vizinhas continuam misturadas (aparece como "tie-dye" nas cores fortes). O uniforme
  não tem mais isso: desde 17/10 a regata e a bermuda são costuradas no Blender, lisas, com zonas exatas (docs/20).
- Os tênis trazem swoosh e Jumpman pintados na própria textura (docs/20): a cor de zona pega esses desenhos também.

## 3. Fases

| Fase | Entrega | HY | Estado |
|---|---|---|---|
| 1. Base | Tela Aparência no fluxo; `look` na build, no catálogo e no online; tom de pele com máscara; os 2 kits e os 5 tênis; câmera por aba; CPU com aparência | — | **feito** |
| 2. Cores | **feito**, exceto o número e o nome nas costas (adiados, ver abaixo). Troca de cor por máscara de 4 zonas (principal, detalhe, debrum e extra) da regata, da bermuda e do tênis, tiradas da textura do HY por agrupamento de cores (no tênis; regata e bermuda, costuradas no Blender desde 17/10, têm zonas exatas); uniforme de casa e de visitante (modelo e cores); paleta de 16 cores e ajuste de matiz, saturação e brilho pelo D-pad; choque de cor no 1x1 | não usado (o uniforme liso veio da costura no Blender, sem créditos) | **feito** |
| 3. Cabelo | Modo `cabelo` no `vestir.py` (rígido no osso `head`), encaixe pela caixa da cabeça; 10 a 12 cortes com cor (os 3 já gerados: afro, dreads, tranças); careca e raspado pela máscara G (o cabelo pintado vira pele) | ~20 créditos | a fazer |
| 4. Rosto | `trocar_cabeca.py`: 12 a 16 cabeças carecas do HY cortadas no pescoço e soldadas no anel do corpo atual (mesmos pesos; esqueleto e clipes iguais); UV comum projetada de frente (sobrancelha, barba rala e tatuagem servem em qualquer cabeça); cor dos olhos; sobrancelhas; barba (textura e malha) | ~35 créditos | a fazer |
| 5. Ajuste fino | Formas por região geradas no Blender com os mesmos nomes em toda cabeça (mandíbula, queixo, nariz, maçãs, olhos, orelhas); o tipo de corpo (magro…pesado) passa a mudar o boneco (escala de ossos ou formas, com a roupa acompanhando) | — | a fazer |
| 6. Acessórios | Munhequeira, faixa, joelheira, manga, meia de cano alto e óculos (lote da arena), com cor; tatuagens; e2e no online | gerar de novo a manga | a fazer |

**Número e nome nas costas (adiado da fase 2).** Não entrou porque pede o mapa de UV: a regata costurada (docs/20) tem
UV por ilhas (`smart_project`), sem uma ilha plana para o número. O caminho para depois: (a) uma UV plana extra só para
as costas, feita no próprio `costurar.py` (uma ilha retangular onde cabe o número e o nome), com a textura de dígitos e
letras num atlas; ou (b) uma projeção no shader, sem UV: a posição local do vértice nas costas (x e y da regata, em
repouso) mapeia um atlas de dígitos, e o shader de zonas (`GearColors.ts`) soma o decal por cima da cor. (a) é mais
limpo e serve para qualquer peça; (b) sai sem mexer em modelo e cabe no mesmo lugar do shader.

Riscos:
- A emenda do pescoço na troca de cabeça é a parte mais difícil; o tom de pele único (mesmo shader no corpo e na
  cabeça) ajuda a esconder.
- A moderação do HY pode recusar "cabeça careca": guardar os textos aceitos na skill.
- Os tênis seguem com swoosh e Jumpman pintados, mesmo com outra cor: antes de distribuir, viram desenhos nossos
  (docs/20).

## 4. Testes e conferência

- `build/PlayerLook.test.ts` (fase 1 e 2):
  - padrão = jogador de antes (casa vermelho, visitante branco);
  - paleta de pele em ordem; paleta de cores com 16 cores distintas;
  - limpeza do que vem de fora, inclusive as cores (hex, até 4 por lado, vazio some);
  - build antiga (sem visitante nem cores);
  - catálogo (com cores, cabe nos 4 KB) e cartão do online;
  - regra do uniforme (`matchWear`, `wearFor`): o visitante troca só se a cor principal bater; os dois clientes chegam
    ao mesmo par;
  - `GearZones` = os JSON das máscaras;
  - distância de cor (ΔE76) e parâmetros da URL; sorteio repetível da CPU.
- `build/ColorEdit.test.ts`: matiz, saturação e brilho (ida e volta RGB↔HSL; giro de 360° volta ao mesmo).
- `e2e/menu.spec.ts`: o fluxo passa pela aparência (tom 8, uniforme de casa branco, tênis Cimento 4). A build salva
  guarda a escolha (com `kitAway`) e o Freestyle veste a mesma. Prints em `test-results/menu/02b…02d`.
- `e2e/aparencia-cores.spec.ts`: as cores pelo teclado (paleta, matiz, tênis). Confere pela malha vestida que o uniform
  do shader recebeu a cor e que a mesma `PlayerGear` continua vestida depois da troca (sem revestir). Prints em
  `test-results/aparencia/`.
- `node web/tools/aparencia-prints.mjs <pasta> [query] [aparências JSON]`: veste cada aparência no jogador parado,
  mede a troca e fotografa rosto, frente, costas e pés. As aparências aceitam `colors` (ex.:
  `{"skin":"#c08862","kit":"vermelha","kitAway":"branca","shoes":"tenis_cimento_4","colors":{"casa":["#1d2a4a","#f4c430"],"tenis":["#2f6fd6"]}}`).
- Identidade (cor igual à original = textura exata) é garantida pela conta do shader, não pelo pixel: as capturas de
  duas execuções têm a pose do drible em fases diferentes, então a comparação de pixels não serve.
- Zonas dos tênis: `python -I web/tools/zonas-cor.py web/public/assets/gear web/public/assets/look/zonas [conferência]`
  (a partir de `NBA/`; só os tênis: as peças costuradas trazem as suas). A conferência mostra cada zona na própria cor
  média. Da regata e da bermuda: `costurar.py --zonas=<pasta>` e `python -I web/tools/zonas-costura.py <pasta>
  web/public/assets/gear web/public/assets/look/zonas` (confere a orientação contra a textura do GLB).
- Roupa no jogo: `node web/tools/roupa-qa.mjs <pasta> [query]` (8 poses × 11 vistas, docs/20).

## 5. Arquivos

| Arquivo | O quê |
|---|---|
| `build/PlayerLook.ts` | Tipos (casa, visitante, cores), paleta de tons, kits, tênis, zonas originais (`GearZones`), paleta de 16 cores, padrão, limpeza, regra do uniforme (`matchWear`, `wearFor`), sorteio, peças, parâmetros da URL |
| `build/ColorEdit.ts` | Matiz, saturação e brilho (HSL) para o ajuste da cor |
| `game/SkinTone.ts` | Shader do tom de pele (máscara + uniforms) |
| `game/GearColors.ts` | Shader das zonas de cor (máscara RGBA + uniforms por zona, `paintZones`) |
| `game/PlayerOutfit.ts` | Aparência aplicada num jogador (pele + roupa, lado casa ou visitante, troca ao vivo e pintura sem revestir) |
| `game/PlayerGear.ts` | `fetch` (baixa a peça e a máscara) / `dress` (com as cores) / `paint` / `dispose` |
| `menu/AppearanceScreen.ts`, `menu.css` (`.ap-*`) | A tela (abas, linhas de escolha e de ajuste, paleta, zonas) |
| `menu/Showroom.ts`, `menu/MenuScreen.ts`, `menu/MenuFlow.ts` | `setLook(look, side)`, `setFocus`; o `wear()` da tela diz qual uniforme vestir |
| `game/OnlineMatch.ts`, `game/cpu/CpuOpponent.ts`, `online/RemotePlayer.ts`, `online/EchoTest.ts`, `main.ts` | Uniforme de cada lado na partida (`wearFor`) |
| `public/assets/look/` | Máscaras da pele; `zonas/` tem as máscaras de zona (`<peça>_zonas.webp` e `.json`) |
| `tools/pele-mascara.py`, `tools/zonas-cor.py`, `tools/aparencia-prints.mjs` | Máscara da pele, zonas de cor dos tênis e conferência |
| `Tools/Animacao/costurar.py`, `tools/zonas-costura.py` | Regata e bermuda costuradas no Blender (docs/20) e as máscaras de zona delas |
| `tools/roupa-qa.mjs`, `tools/perto.mjs` | Conferência da roupa no jogo: 8 poses × 11 vistas; close-ups do jogador parado |
| `e2e/menu.spec.ts`, `e2e/aparencia-cores.spec.ts` | Fluxo da aparência e cores pelo teclado |
