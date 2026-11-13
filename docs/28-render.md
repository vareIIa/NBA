# 28 — Render (Fase 1 do visual: luz, reflexo, pós-processamento e torcida em cartões)

> Pedido do diretor (2026-11-12): visual mais bonito e fluido, sem quinas. O mapa completo tem 5 fases (luz e render;
> corpo sem arestas; tênis e uniforme; rosto, cabelo e pele; apresentação). Este doc é a **Fase 1**: só código, nenhum
> modelo mudou. Sem níveis de qualidade para GPU fraca (decisão do diretor): um render só, otimizado.

## Resultado medido

RTX 3050 Laptop, 1600×900, câmera do jogo, sem limite de quadros (`tools/render-prints.mjs`):

| Versão | FPS | Quadro |
|---|---|---|
| Render antigo (`?render=0&torcida=3d`) | 133 | 7,5 ms |
| Render novo com a torcida 3D (`?torcida=3d`) | 104 | 9,6 ms |
| **Render novo com a torcida em cartões (padrão)** | **168** | **5,9 ms** |

O pós-processamento inteiro custa ~2 ms (oclusão 0,8; reflexo 0,4; bloom 0,2; HDR, MSAA e saída 0,9). A torcida e a
arquibancada custavam 7 ms; com os cartões, ~3 ms.

## O que um quadro faz (`web/src/render/RenderPipeline.ts`)

1. **Reflexo do piso** (`FloorReflection.ts`): a cena desenhada por uma câmera espelhada no chão, em meia resolução e
   sem a arena pesada (`ArenaDressing.outOfReflection`). Entram os jogadores, a bola, as cestas, a faixa de LED e o
   telão. O material do piso soma o reflexo borrado (7 amostras nos mips, esticadas na vertical) com Fresnel.
2. **Cena em HDR** (meio-float) com MSAA 4x e textura de profundidade.
3. **Oclusão de ambiente**: GTAO do three em meia resolução. As normais saem da profundidade, então a cena não é
   desenhada de novo.
4. **Bloom**: 5 níveis de redução (13 amostras) e ampliação (tenda 3×3), com limiar: só brilha o que passa do branco
   (LED, telão, brilho do verniz).
5. **Saída**: AO × cena + bloom, tone mapping ACES (o mesmo ajuste do three), saturação, contraste, vinheta e dither.

**Mapa de ambiente** (`captureEnvironment`, uma vez no carregamento): a própria arena vira o ambiente da cena (cubo de
256 px → PMREM). Os refletores do teto entram como painéis acesos só nessa captura, porque `SpotLight` não aparece em
reflexo. É ele que dá a luz de preenchimento, o brilho especular da pele, da bola e do tênis, e o brilho largo do piso.

**Luz** (`RenderLook.ts`): com o ambiente, a hemisférica caiu de 0,55 para 0,16 e os refletores de 140 para 70; a
direcional subiu de 1,6 para 2,6 com sombra de 4096 px. Antes a sombra do jogador quase não aparecia (os 8 refletores
sem sombra a lavavam) e ele parecia flutuar.

**Pele** (`SkinTone.ts`): a textura do corpo do HY traz luz pintada (frente clara, costas marrons numa pele clara). O
shader achata essa luz com um expoente (0,35 no corpo, 0,7 no rosto); o volume vem da luz de verdade. A emissão quente
que fingia a luz de ambiente (docs/20) caiu para 50%.

## Torcida em cartões (`web/src/game/CrowdCards.ts`)

Do 2º anel para trás, cada pessoa é um quadrado de 2 triângulos com a foto do modelo, que gira em pé para a câmera. O
1º anel, as fileiras VIP e a volta da quadra continuam em 3D. As fotos saem dos próprios modelos no carregamento (um
atlas de 1280×768, só a cor; a luz e o giro de matiz por pessoa são os mesmos do 3D) e são lidas de volta para uma
textura comum, que vale em qualquer `WebGLRenderer`. De 6,1 M para ~0,9 M de triângulos de torcida.

## Chaves

| URL | O quê |
|---|---|
| `?render=0` | Render antigo (uma passada na tela, sem ambiente, luz e pele de antes). O laboratório (`?lab=1`) usa sempre |
| `?torcida=3d` | Torcida toda em malha 3D |
| `?juntas=0` | Pesos do corpo como vieram no GLB (sem a suavização das juntas) |
| `?acabamento=0` | Uniforme sem a trama e sem o brilho de tecido |

Ao vivo, no console: `__debug.render.look` (`ao`, `bloom`, `bloomThreshold`, `exposure`, `saturation`, `contrast`,
`vignette`) e `__debug.render.reflection.strength`.

**Ferramentas com outro renderer** (`perto.mjs`, `roupa-qa.mjs`, `aparencia-prints.mjs`, `roupa-quadros.mjs`,
`rente-chao.mjs`, `arena-prints.mjs`): o mapa de ambiente e o reflexo são texturas do renderer do jogo e não existem no
delas. Abrir a página com `?render=0` para ter a luz antiga. Para fotografar o render de verdade:

```bash
node tools/render-prints.mjs <saída> [base] [query]   # jogo, frente, lado, perto e pés + FPS sem limite
# VISTAS=jogo,perto filtra; JS="d.render.look.bloom=0" roda na página antes; FPS=0 pula a medição
```

## Fase 2, parte em código (2026-11-13): braços e juntas

Sem Blender na máquina, o que dava para fazer sem mexer no GLB:

- **Braços e mãos pretos** (`web/tools/pele-mascara.py`, `SkinTone.ts`): o HY pintou de preto a parte de trás dos
  braços e as mãos. A ferramenta da máscara agora desenha os triângulos do corpo no espaço da UV com o peso dos ossos
  e grava no **alfa** de `pele_mascara.webp` onde é braço ou mão e a textura não é pele clara (7% da textura). Ali o
  shader põe o tom de pele direto, sem a razão sobre o texel (num texel quase preto ela amplifica o ruído da
  compressão), e usa a normal da malha (o mapa de normal ali é lixo e saía manchado). Vale para todos os tons do menu. `RenderLook.skinRepair`; o render antigo (`?render=0`) não usa.
- **Juntas em ponta** (`web/src/anim/SkinSmooth.ts`): os pesos do corpo trocavam de osso em 1 ou 2 cm. No carregamento,
  10 voltas de média com os vizinhos na superfície abrem a transição para ~5 cm; cotovelo, ombro e joelho dobram
  redondos. Cabeça, pescoço e dedos ficam como vieram (a costura com a malha do rosto não pode abrir). O tornozelo e a
  canela baixa também: a meia segue os pesos originais, e com a perna suavizada ali ela furava a meia (borda rasgada).
  `?juntas=0` desliga, para comparar. As peças de roupa não mudam.

Continua para o Blender: retopologia com normal assado, ossos de torção (o ombro ainda sai quadrado) e dedos com pose.

## Fase 3, parte em código (2026-11-13): tecido do uniforme

`web/src/game/GearPolish.ts`: a regata e a bermuda eram cor lisa. Ao vestir, o material do GLB vira um
`MeshPhysicalMaterial` com a trama de malha esportiva (mapa de normal de 64 px gerado em código, repetido 60×) e brilho
rasante de tecido (sheen 0,6). Os shaders da peça (avesso, zonas de cor, empurrão dos membros) encadeiam nele como
antes. `?acabamento=0` desliga. Os tênis já usam o normal, a rugosidade e o metal do GLB; o que falta neles (sola e
cabedal em geometria limpa, zonas exatas) é do Blender.

## Fase 4, parte em código (2026-11-13): pele e olhos

Tudo no shader da pele (`SkinTone.ts`), com os números em `RenderLook.ts`; o render antigo não usa:

- **Albedo** (`skinAlbedo` 0,8): a pele clara do HY reflete mais que pele de verdade e estourava de branco sob os
  refletores. A emissão não muda.
- **Luz que atravessa a pele** (`skinScatter` 0,6): uma faixa avermelhada onde a luz principal vira sombra. Sem ela a
  passagem de luz para sombra saía cinza. É só da direcional e não olha a sombra projetada.
- **Olho molhado** (`eyeGloss`): no rosto, o que a máscara não marca como pele nem cabelo (branco do olho e íris) fica
  liso (rugosidade 0,08) e pega o brilho dos refletores.

`tools/render-prints.mjs` ganhou a vista `rosto` (close a 80 cm da cabeça).

Fica para depois: cabelo em malha, sobrancelha e boca por cor (canais G e B da máscara), suor, rosto escaneado.

## Fase 5, parte em código (2026-11-13): torcida viva e vitrine

- **Torcida animada** (`ArenaDressing.ts`, `crowdMaterial`): no vértice, cada pessoa inclina o tronco e respira num
  ritmo e numa fase próprios (tirados do `aTint` dela). Vale igual para a malha 3D e para o cartão, sem custo medido.
  Na cesta, `arena.cheer()` (chamado no `onScore`) aumenta o balanço e põe um pulo rápido, que some em ~2,5 s. A
  sombra da torcida não acompanha (não se vê).
- **Profundidade de campo** (`RenderPipeline.ts`, `look.dof`): na saída, 16 amostras em espiral com o raio pela
  profundidade. Foca sozinha no que está mais perto numa grade de 9 pontos da tela (o jogador) e desfoca só o que fica
  atrás; o que está em foco não vaza para o fundo. Ligada na vitrine do menu (`dof = 9`), desligada no jogo (custo
  zero). Serve para replays quando existirem.
- **Desfoque de movimento: não entrou.** Sem velocidade por objeto, o desfoque por reprojeção da câmera borra o próprio
  jogador (ele anda junto com a câmera), e a 160 FPS o ganho é pequeno. Precisa de um passe de velocidade.

## Direção de arte (2026-11-13): quadra iluminada, arquibancada na penumbra

O quadro era todo claro por igual, e a torcida colorida disputava com o jogador. Agora, como numa transmissão:

- **Penumbra** (`RenderLook.crowd` 0,6): a cor da torcida (no shader dela) e a de todo material da arena que não é
  piso (arquibancada, mesa, câmeras, fotógrafos) caem para 60%. A quadra e os jogadores ficam com a luz.
- **Contraluz dos jogadores** (`web/src/render/RimLight.ts`, `RenderLook.rim` 0,8): brilho frio na borda da silhueta,
  no material da pele, do uniforme e do tênis. Como luz de cena (uma direcional baixa por trás) ela estourava o verniz
  do piso num clarão branco; por isso é no shader.
- **Gradação** (`RenderPipeline.look`): exposição 0,94, contraste 1,08, saturação 1,1, vinheta 0,26.
- **Tecido**: o sheen caiu de 0,6 para 0,3 (lavava o vermelho da regata).
- **Reparo dos braços**: limiar mais alto (a sombra pintada que sobrava aparecia marrom com o contraste novo).

**Blender** (5.3 portátil, em `%LOCALAPPDATA%\Programs\blender-5.3.0-windows-x64`; o instalador MSI ficou preso
esperando elevação). Testado e descartado: pesos de pele recalculados pelo calor dos ossos ("pesos automáticos"),
aplicados por um arquivo ao lado do GLB. O ombro quase não muda em relação à difusão do `SkinSmooth`, e o peito passa
a furar a regata (a roupa foi costurada sobre os pesos antigos). Para valer, teria de recosturar a regata e a bermuda
(`costurar.py`) sobre o corpo novo e refazer as meias.

## Achados para as próximas fases

- **Luz pintada na textura do corpo e dos tênis**: o certo é tirar a luz da textura no Blender (Fase 2 e 3); o expoente
  do shader é um remendo.
- **Arquibancada**: sobram ~3 ms no 1º anel 3D e nos blocos. Dá para levar o 1º anel a cartões nas câmeras longe.
- **Sombra dos refletores**: só a direcional faz sombra. Duas sombras de refletor dariam o leque de sombras de arena.

## Ambiente de desenvolvimento (2026-11-12)

- O LFS do GitHub estourou a cota: os 46 GLBs de `web/public/assets` vieram do site publicado (idênticos aos do
  repositório). `web/public/assets/mocap/mixamo_loco.json` (fora do git) também.
- O vitest 5 pede Node 22.12+; e no Windows o diretório atual precisa estar com a letra do disco maiúscula (`C:\...`),
  senão todo teste falha com "Cannot read properties of undefined (reading 'config')".

## Arquivos

| Arquivo | O quê |
|---|---|
| `web/src/render/RenderPipeline.ts` | O quadro (HDR, AO, bloom, saída), captura do ambiente, reforço do LED |
| `web/src/render/FloorReflection.ts` | Câmera espelhada e o shader do reflexo no material do piso |
| `web/src/render/RenderLook.ts` | `?render=0` e os números da luz |
| `web/src/game/CrowdCards.ts` | Atlas da torcida e o vértice do cartão |
| `web/src/game/ArenaDressing.ts` | Cartões do 2º anel para trás, `outOfReflection`, luz |
| `web/src/game/Court.ts`, `game/SkinTone.ts`, `anim/PlayerAnimator.ts` | Luz, luz pintada da pele, emissão da pele |
| `web/src/main.ts`, `menu/Showroom.ts` | Tudo desenha pelo pipeline |
| `web/tools/render-prints.mjs` | Prints do render e FPS |
