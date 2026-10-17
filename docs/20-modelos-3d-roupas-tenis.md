# 20 — Modelos 3D: tênis, uniforme e partes do jogador (HY 3D Studio)

Gerados no Tencent HY 3D Studio (Hunyuan3D v3.1) pela skill `hy3d-studio`, em 15/10/2026, com 3 contas em paralelo
(30 créditos no total). **Uso interno, sem fins comerciais.** Os tênis seguem silhuetas de Jordans conhecidos e, mesmo
com `no logos` no prompt, a textura do HY **pintou swoosh e Jumpman** em vários deles (e um swoosh grande na bermuda
branca). Para vender o jogo, todos os tênis e essas texturas precisam ser trocados por desenhos próprios.

![vitrine](img/vitrine-hy3d.png)

## O que está no jogo

| Arquivo (`web/public/assets/gear/`) | Base | Triângulos |
|---|---|---|
| `tenis_retro_alto_1.glb` | AJ1 High "Chicago" | 5k por pé |
| `tenis_verniz_11.glb` | AJ11 (saiu mais genérico: preto e azul-gelo) | 5k por pé |
| `tenis_cimento_4.glb` | AJ4 "Cement" | 5k por pé |
| `tenis_elefante_3.glb` | AJ3/AJ4 preto, vermelho e cimento | 5k por pé |
| `tenis_baixo_moderno.glb` | low-top atual, marinho e verde-neon | 5k por pé |
| `regata_vermelha.glb`, `bermuda_vermelha.glb` | kit da casa, **costurado no Blender** (`Tools/Animacao/costurar.py`, 17/10; ver "Roupa costurada") | 23k / 28k |
| `regata_branca.glb`, `bermuda_branca.glb` | kit visitante (mesmas peças, cores trocadas) | 23k / 28k |
| `../hoops_player.glb` (malha `Jogador`) | corpo `jogador_branco` (rig do HY), no esqueleto e com os clipes do boneco | 15k |

URL: padrão = kit vermelho + AJ1. `?uniforme=branco`, `?tenis=tenis_cimento_4` (nome do arquivo), `?roupa=0` (boneco liso).

Gerados, ainda **não usados** (em `models_raw/`): `jogador_pivo` (o corpo negro de 15/10, com regata cinza pintada no
tronco: sai pelo mesmo comando, sem `--sem-regata`), `jogador_armador` (mangas pretas que apareceriam sob a regata),
`cabeca_jogador` (busto; o lado da cabeça veio pintado de azul), `mao_aberta`, a regata/bermuda de 15/10 e as de 16/10
(`regata_nova`, `bermuda_nova` e as brancas), trocadas pelas costuradas em 17/10.

### Lote de 16/10 (11 créditos): jogador branco e uniforme novo
O usuário reprovou a primeira regata ("nem parece regata", ombro quebrado, braço atravessando) e as cores do corpo negro
(a regata cinza do HY repintada de pele lisa ficava com outro tom), e pediu jogador branco como padrão. Gerados:
`jogador_branco` (geometria sem camisa e descalço; a 1ª textura pintou um colante preto e batom e foi refeita descrevendo
só a pele), `regata_nova` + `regata_nova_branca` (mesma geometria, 2ª textura) e `bermuda_nova` + `bermuda_nova_branca`.
A moderação do HY recusa "invisible body", "shirtless", "bare chest" (erro 200006, sem custo); os textos aceitos estão na
skill `hy3d-studio`.

## O corpo do jogador (`Tools/Animacao/trocar_corpo.py`)

![antes e depois](img/corpo-antes-depois.png)

O boneco de tubos deu lugar ao corpo do HY (hoje `jogador_branco`) **sem mexer no esqueleto nem nos clipes**: os 31 ossos,
as matrizes de bind e os 38 clipes saem iguais aos do GLB antigo (o `hoops_player.clips.json` continua valendo) e a altura
do bind é a mesma (1,715 m → escala do jogo 1,0846, como antes). Quem se ajusta é a malha:

```bash
blender -b -P Tools/Animacao/trocar_corpo.py -- <hoops_player.glb com os clipes> web/public/assets/models_raw/jogador_branco_rig.fbx web/public/assets/hoops_player.glb --sem-regata
```

- **Conferir os tempos dos clipes** depois de exportar: o importador de FBX troca a cena para 24 quadros/s (a taxa do FBX
  do HY) e, sem voltar a 60 antes do export, os clipes saíam 2,5x mais lentos que o clips.json (o arremesso soltava a bola
  com o braço na cintura). O script volta a cena para 60; confira o `max` do accessor de tempo de cada animação.

- Usa o `*_rig.fbx` do `bone_skinning` (malha texturizada com pesos no esqueleto do HY). Escala para a altura do boneco e
  dá a cada osso do HY uma transformação que leva as juntas dele às do boneco: braços de A para T, pernas abertas ~25°,
  cada segmento esticado ao comprimento do osso da CMU; a malha segue pelos pesos do HY.
- **Braço** (16/10, o usuário achou o braço "quebrado, pontiagudo"; antes e depois em `img/braco-antes-depois.png`):
  - o esqueleto da CMU tem o braço direito com 30,5 cm em cima e 17,7 cm de antebraço (o esquerdo, 28,6 e 19,9) e o ombro
    direito 2,6 cm mais para dentro. Mudar o esqueleto mexeria nos clipes e no `clips.json` (palma por quadro, usada no
    drible), então quem se ajusta é a malha;
  - o braço e o antebraço engrossam com a raiz do estiramento (`thicken`): o braço de cima esticado ~30% ficava um
    macarrão comprido;
  - o ombro da malha é simétrico, na largura do ombro mais largo (`shoulder_target`); o osso continua girando na junta da
    CMU, dentro do deltoide;
  - a redução protege a pele que fica à mostra (braços, mãos, cabeça, pescoço, canelas; `DETAIL`): com só rosto e mãos
    protegidos o braço ficava facetado e o cotovelo dobrava numa ponta.
- Tronco: estica 1,15× na vertical entre quadril e ombro e cisalha em Y (no HY os ombros ficam 5 cm atrás do quadril; sem
  isso as costas ficavam atrás do esqueleto e saíam da regata). Cabeça e pescoço só se deslocam.
- Pé só desloca até a sola tocar o chão do bind (o tornozelo do boneco fica a 4,5 cm do chão, o do HY a 9 cm: a canela do
  HY termina acima da junta). Mão rígida a 90% (a do HY tinha 21 cm).
- Ombros: a clavícula do HY desce (A-pose) e a do boneco sobe (T-pose, e a direita fica 1,7 cm mais alta que a
  esquerda); a mistura linear das transformações dobrava a pele no alto do ombro direito numa prega rasgada que furava a
  alça. O script suaviza o **deslocamento** (não a forma) na região da clavícula: o relevo do HY fica e a prega some.
- Pesos: Spine/Spine1/Spine2 → spine_01/02/03, Neck dividido em neck_01/neck_02, LeftHand → hand_l etc. **A mão inteira
  fica em `hand_*`**: nos clipes da CMU o `palm_*` e o `thumb_*` giram até 175–179° (dado ruim que a mão-tubo escondia;
  com dedos de verdade a mão virava do avesso). `palm_*`/`fingers_*` continuam no esqueleto para o jogo achar a palma.
- Redução 50k → 30k (com 15k–20k o tronco perdia o relevo do peito e do abdome ou o braço ficava facetado); cor em
  2048 px e normal em 1024 px (WebP). GLB de ~6 MB.
- **Rosto com textura própria** (material `Rosto`): a cabeça do HY está espalhada em dezenas de ilhas pelo atlas, então
  as faces dela ganham UV nova e a cor do atlas 4K original é passada para uma imagem de 1024 px só da cabeça (bake de
  emissão no Cycles). De perto, o rosto deixou de ser borrado.
- **Pele no jogo**: a arena ilumina de cima, com ambiente azulado e sem mapa de ambiente, e a pele saía cinza-arroxeada,
  com o rosto (que olha para baixo) escuro. `Pele` e `Rosto` levam emissão fraca e quente com a própria textura
  (0,22 / 0,19 / 0,17, imita a luz que atravessa a pele), rugosidade 0,65 e mapa de normal a 60%. O exportador do Blender
  não grava emissão tingida com textura: o script ajusta o JSON do GLB depois do export.
- Material `Pele` (textura). Num corpo que veio de camisa (o `jogador_pivo`), sem `--sem-regata` a regata do HY vira o
  material `Uniforme` cor de pele lisa; o `PlayerGear` não repinta o `Uniforme` quando a pele é textura.
- Depois de trocar o corpo, **vestir de novo os 5 tênis** com o `vestir.py` e **costurar de novo os 2 kits** com o
  `costurar.py` (os dois usam a forma do corpo).

## Pipeline

Desde 17/10 a regata e a bermuda do jogo não passam por aqui: saem do `costurar.py` (ver "Roupa costurada"). O pipeline
abaixo vale para os tênis; a parte de regata e bermuda fica como registro.

1. **HY 3D** (`web/tools/hy3d-fila.js`, colado numa aba `hy3d.tencent.ai/robots.txt` logada): `text2geometry` 50k faces →
   `text2texture_v31` (PBR) [→ `bone_skinning` nos corpos]. A retopologia do site foi pulada: vivia em "servidor lotado"
   e o Blender reduz os polígonos. Uma conta roda até 5 tarefas; com 3 contas, as 13 peças saíram em ~25 min.
2. Baixar o GLB texturizado (22–45 MB, textura 4K) para `web/public/assets/models_raw/` (fora do git).
3. **Blender** (`Tools/Animacao/vestir.py`):
   ```bash
   blender -b -P Tools/Animacao/vestir.py -- web/public/assets/hoops_player.glb web/public/assets/models_raw/<peca>.glb <regata|bermuda|tenis> web/public/assets/gear/<peca>.glb
   ```
   Ordem: bermudas, depois regatas com `--por-cima-de=web/public/assets/gear/bermuda_<kit>.glb`, depois os tênis.
   - solda as costuras de UV e tira pedaços soltos pequenos (cordão, etiqueta);
   - **regata e bermuda ficam com uma camada só**: o HY gera tecido + avesso a milímetros e, depois da redução e do
     encaixe, o avesso furava o tecido em lascas (azuis no kit branco). Saem as faces viradas para dentro, medido a partir
     do eixo interno mais próximo (coluna e linha clavícula-ombro; quadril e coxas): no alto do ombro o "fora" é para cima
     (com a direção radial horizontal a alça ficava com as duas camadas). O jogo desenha a roupa dos dois lados;
   - encaixa a caixa da peça no corpo: regata do topo do ombro na pele (trapézio onde a alça passa, ~9 cm acima da junta
     do ombro: com a junta, as duas alças nasciam dentro do ombro) ao quadril, largura e fundura medidas até o peito; bermuda da cintura ao joelho (com as coxas endireitadas, como a peça gerada), tênis pelo pé descalço:
     calcanhar 1 cm atrás do calcanhar, comprimento +6%, largura +15%, sola na altura da sola (o jogo prega a sola no chão);
   - regata: pregas um pouco mais rasas (Smooth 12x); alças e decote assentados no ombro e no peito (a camada de dentro a
     0,7 cm da pele; o alvo inclui a base do pescoço); tudo empurrado para fora da pele e, com `--por-cima-de`, para fora
     da bermuda, por um campo suave com núcleo plano (o tecido vizinho recebe o mesmo empurrão), repetido até convergir;
     depois a faixa das alças é alisada e empurrada mais duas vezes (no ombro curvo as normais da pele divergem e o
     empurrão amassava a alça). Testados e descartados: deitar a alça de dentro para fora na pele (dobrava o pano) e
     empurrar na direção radial do eixo (perto do pescoço apontava para cima e inflava a alça);
   - **bermuda cortada ~1,5 cm acima da barra da regata**: o cós e a braguilha franzidos ficam escondidos e eram onde ela
     se dobrava sobre si mesma ao levantar a coxa (alisar, assentar ou refazer como casca da pele foram testados e
     descartados: amassavam as pregas ou estragavam a textura);
   - pesos: regata só no tronco (pelvis, spine_*, clavicle: a cava não acompanha o braço); onde cobre a bermuda, a barra
     copia os pesos dela e o pano balança só 20%. Bermuda: quadril acima da barra da regata, rampa de 20 cm até as coxas,
     esquerda/direita meio a meio numa faixa de ±17 cm (com a fronteira curta da pele, as pernas largas se cruzavam).
     Depois, média espacial dos pesos (5 cm na regata, 2,5 cm na bermuda); cria os ossos de pano `pano_*`; o tênis copia
     os pesos da pele do pé (ver "Pé e tênis" abaixo) e sai em par, com o esquerdo espelhado;
   - reduz para 9k (roupa) / 5k (tênis), sombreamento suave, textura 1024 px em WebP: 0,5–1 MB por GLB.
4. Conferência: `Tools/Animacao/ver_vestido.py` (corpo + peças, frente/lado/pé) e `Tools/Animacao/vitrine.py`.

## No jogo (`web/src/game/PlayerGear.ts`)

- A malha da peça é religada aos ossos do `PlayerAnimator` pelo nome. As matrizes de bind vêm do próprio GLB da peça
  (o importador do Blender usa `bone_heuristic='BLENDER'`, que preserva os eixos dos ossos do glTF).
- **Física do pano**: cada `pano_*` é um pêndulo verlet a 60 Hz (inércia, gravidade, mola de volta ao repouso, ângulo
  máximo). Regata: pano com até 10% do peso, ossos pendurados na pélvis (mola 55, até 35°); bermuda presa à coxa (pano
  com até 40% do peso, mola 140, até 28°). A ponta do pano não chega mais perto do eixo do que veste (tronco, coxa) do que
  fica em repouso (`keepOutOfCore`: balança para fora, não para dentro; no agachamento fundo as costas da regata ficam para
  cima e a gravidade as puxava para dentro do corpo). As pontas colidem com cápsulas das coxas, das canelas e do tronco, e
  a barra não entra na outra perna.
- **O corpo nunca atravessa a roupa** (`BodyCover.ts`): ao vestir, **na pose de ligação** (a pose em que as peças foram
  ajustadas: a do primeiro quadro, com os nós do GLB de braços baixos, deixava a coxa dobrada à frente do pano), cada
  vértice do corpo lança um raio para fora; se bater numa peça a menos de 2,5 cm, o vértice está coberto. Também conta como
  coberto o vértice cujo raio para **dentro** bate na peça a menos de 4 cm (a pele furou o tecido). A máscara é erodida um
  anel (a pele continua um pouco sob a barra e o decote, e o recorte serrilhado não aparece pela fresta) e os triângulos
  com 2+ vértices cobertos saem do índice. **Pele funda** (osso dominante `pelvis`, `spine_01`, `hip_*`, ou coxa nos 40% de
  cima do fêmur: quadril, virilha, alto da coxa, barriga baixa, lombar): sai com peça a até 12 cm em qualquer de 14
  direções e não é erodida (a bermuda costurada pende à frente da virilha e o gancho passa longe dela; só pelo raio da
  normal, a pele do alto da coxa, o short branco esculpido no corpo do HY, furava a frente da bermuda com a coxa dobrada).
  Sem pele por baixo, nenhuma pose empurra o corpo através do tecido. A roupa é dupla face (pela cava aparece o avesso).
  Os raios usam uma grade espacial dos triângulos das peças. **Ombro**: pele de braço (osso dominante upperarm, lowerarm,
  hand…) só some sob um triângulo da peça que também segue aquele osso; a alça segue o tronco, então o deltoide que no bind
  (braços em T) ficava sob ela continua desenhado. E a pele coberta a até 2 anéis da pele de braço/clavícula que ficou
  também fica (`uncoverNear`): sem isso o recorte serrilhado do trapézio deixava uma fresta, e pelo ombro apareciam
  triângulos pretos (o avesso escuro da regata).
- **Membros nunca atravessam a roupa** (`LimbPush.ts`): o que o BodyCover não cobre é resolvido no vertex shader da peça,
  depois da pele, a cada quadro. Cápsulas nos membros, com o raio médio medido no corpo + 1,2 cm, e uma esfera em cada
  joelho, com o raio da fatia do joelho incluindo a patela. Modo `in` (o membro passa por dentro da peça): o tecido sai
  pela superfície, numa curva suave que começa 1,5 cm antes (sem lascas de triângulos esticados). Modo `out` (o membro
  cruza por fora): o tecido recua para trás dele. Hoje: **bermuda** com joelho `in`, antebraço e mão `out`; **regata sem
  nenhum** (a costurada é solta e de cava aberta, o braço e a mão passam por fora dela; a ponta da cápsula do braço, na
  junta do ombro, alcançava a borda da cava e a serrilhava no giro, e a do antebraço e a da mão recuavam a barra solta em
  degrau). Elipses no tronco e no quadril foram testadas e descartadas (abriam a gola e faziam pontas na barra).
- Conferência em movimento: `node web/tools/roupa-quadros.mjs <pasta> "?uniforme=vermelho"` (headless, 21 quadros de
  corrida de frente e de lado e dribles; `SEM_EMPURRAO=1` desliga o LimbPush para comparar) e `node web/tools/roupa-qa.mjs
  <pasta> [query]` (8 poses do jogo em câmera lenta × 11 vistas, uma folha por pose; `POSES=`, `LENTO=` e `JS=`, código
  rodado na página antes das poses, com `d = window.__debug`, ex.: desligar as molas do pano para comparar). Parado e de
  perto: `node web/tools/perto.mjs <saída> <base> <query> <vistas JSON>`.
- O 1º quadro depois de vestir chegava com dt negativo (o Chrome data o quadro antes do fim da tarefa longa de ~1 s), e o
  animador integrava para trás (mãos a 17 m). O `main.ts` limita o dt em [0; 0,1] s.
- O PBR do HY deixa o tecido com cara de plástico molhado: os mapas de rugosidade e de metal são descartados no pano.

## Roupa costurada (17/10): regata e bermuda feitas no Blender

**Por quê.** As peças do HY (`vestir.py`) tinham bordas rasgadas, furos e uma textura pintada a pincel (trocar a cor dava
"tie-dye"). A primeira versão do `costurar.py` fazia a peça como casca da pele do corpo, mas o corpo do HY veste um short
de compressão esculpido (cós franzido, dobras da braguilha, a barra no meio da coxa, faces viradas na frente), tem o rego
do glúteo e um vinco no trapézio, e a casca copiava tudo isso. Agora cada peça é uma grade nova, feita por raios até a pele.

```bash
blender -b -P Tools/Animacao/costurar.py -- web/public/assets/hoops_player.glb bermuda web/public/assets/gear/bermuda_vermelha.glb --cores=#c8202c,#f2f2f2 --zonas=<pasta>
blender -b -P Tools/Animacao/costurar.py -- web/public/assets/hoops_player.glb regata web/public/assets/gear/regata_vermelha.glb --cores=#c8202c,#f2f2f2 --por-cima-de=web/public/assets/gear/bermuda_vermelha.glb --zonas=<pasta>
python -I web/tools/zonas-costura.py <pasta> web/public/assets/gear web/public/assets/look/zonas
```

O kit branco é o mesmo com `--cores=#f2f2f2,#c8202c`. Bermuda antes da regata (a regata segue a bermuda). Cerca de 1 min
por peça (o AO do Cycles na CPU).

- **Regata**: grade de 128 colunas em volta do tronco. Da barra até 2 cm abaixo da axila, anéis horizontais; daí até
  dentro do pescoço, cones em volta de um ponto no meio do peito (cada linha sobe 1,5°). Cada vértice fica no raio que
  acha a pele do tronco (sem braço nem cabeça); onde o tecido vai ser cortado (cavas, gola) ou não há pele, o valor vem dos
  vizinhos. Depois:
  - fechamento (máximo e mínimo em ±4 colunas e ±3 linhas: o pano passa por cima do sulco do esterno e da coluna) e
    média leve;
  - caimento: de cima para baixo o pano não entra mais que 5 mm a cada 10 cm abaixo do ponto mais saliente acima dele
    (cai reto do peito e das escápulas); na cortina, média em volta do tronco (sem listras de cada coluna);
  - folga de 1,2 cm no peito, 2,8 cm na barra e 7 mm nas alças;
  - **tenda**: o que falta para 7 mm da pele (mamilo, osso do quadril) levanta o pano em volta com inclinação de 15%.
- **Bermuda**: uma calça de verdade, em três grades costuradas.
  - Pélvis: anéis de 192 colunas, do cós até 3 cm acima do gancho, pela mesma regra (raios, fechamento, caimento da
    barriga e do glúteo, tenda).
  - Gancho: um leque de 15 raios no plano do meio, da frente, por baixo do gancho, até as costas.
  - Pernas: cada uma sai da sua metade do último anel mais a costura do gancho (112 colunas). Por fora cai da pélvis (não
    entra); por dentro fecha até a coxa em ~7 cm; mais abaixo, o perfil da coxa sem afinar (a pele tem a barra de um
    calção esculpida no meio da coxa), abrindo até +2,4 cm na barra.
- **Aberturas**: cortes exatos por superfícies suaves (barra num plano; gola num elipsoide, mais funda na frente; cavas
  num cilindro elíptico em volta de cada ombro). Vértice a menos de 1/4 da aresta vizinha da superfície vai para cima dela:
  sem isso o corte deixava lascas, triângulos finíssimos que dobravam o debrum em dentes. Alças de 5,1 e 5,6 cm (o script
  imprime). Em cada abertura, menos o cós, um debrum enrolado: 1,3 cm além do corte e de volta por dentro.
- **Pesos**: copiados da pele (face mais próxima), filtrados pelos ossos que a peça segue (regata: pélvis, coluna,
  clavículas; bermuda: pélvis, spine_01, coxas) e com média espacial (5 cm na regata, 2,6 cm na bermuda).
  - Bermuda: a coxa entra pela posição ao longo do fêmur (nada até 2 cm abaixo do quadril, toda a 16 cm). Pelo vizinho mais
    perto, o painel da frente (que pende à frente da virilha) girava com a coxa no arremesso e a bermuda dobrava sobre si.
  - Regata: onde cobre a bermuda, copia os pesos dela, e volta aos seus em 6 cm acima do cós.
  - Ossos de pano: regata 10%, pendurados na pélvis; bermuda 40%.
- **Textura**: UV por ilhas (`smart_project`), AO do Cycles (alcance de 12 cm), cor lisa de cada zona vezes a sombra
  (`0,42 + 0,58·AO^0,8`), 1024 px em WebP. Fora das ilhas, a sombra média: de longe a textura reduzida mistura o fundo com
  a borda. `--zonas` grava a máscara exata (tecido e debrum) e o JSON das cores; o `zonas-costura.py` converte para o
  WebP que o jogo lê e confere a orientação contra a textura do GLB. No jogo a cor trocada leva a sombra toda
  (`PlayerLook.BakedGear`, docs/26).
- **Diagnóstico**: `DIAG_ETAPA=1|2|3` exporta a peça antes do alisamento, depois da folga ou depois dos cortes;
  `DIAG_BORDAS=1` lista as arestas de borda que não estão em nenhum corte (meta: zero).

**Conferência (17/10)**:
- `roupa-qa.mjs` nas 8 poses (parado, corrida, lateral, crossover, entre as pernas, proteção, giro, arremesso), com os
  dois kits e tênis diferentes;
- no Blender, com as peças: os clipes `JumpShot_R`, `Spin_R2L`, `Dribble_Low_R` e `Layup_R`.

Limpo: bordas, alças, gola, cavas, barra sobre a bermuda e gancho, sem pele atravessando. Restam detalhes pequenos (ver
Pendências).

## Lote "arena" (16/10/2026): 61 modelos para a quadra e a arena

Prompts em `web/tools/hy3d-lote-arena.mjs` (gera um `.js` por conta, com a divisão equilibrada de créditos; colar depois de
`hy3d-fila.js`). ~145 créditos nas 3 contas. Brutos em `web/public/assets/models_raw/arena/` (fora do git, ~2 GB): `<nome>.glb`
texturizado e, nas pessoas, `<nome>_rig.fbx` (rig do HY). Download: a aba imprime `<pasta da conta>|nome glb rig;...` e
`sh web/tools/hy3d-baixar.sh '<isso>'` baixa o que falta.

![objetos](img/vitrine-arena-objetos.png)
![pessoas](img/vitrine-arena-pessoas.png)
![acessórios](img/vitrine-arena-acessorios.png)

- **Cesta oficial**: base, braço, tabela, aro, shot clock e completa. A "base" e o "braço" vieram como estrutura inteira
  (o HY desenha a cesta toda mesmo pedindo uma peça só); a tabela, o aro e o shot clock saíram certos.
- **Volta da quadra**: mesa de anotação, cadeira e fileira do banco, cadeira e fileira VIP, mesa de transmissão, câmera de
  TV, câmera de fotógrafo, cooler, rack de bolas, bola HD, toalhas, rodo, prancheta, microfone e painel/púlpito de entrevista.
- **Arena (módulos para instanciar)**: bloco de arquibancada, camarote, telão central, faixa de LED, banners, refletor, túnel.
- **Pessoas (A-pose + rig)**: 10 torcedores, 2 árbitros, 2 técnicos, dançarina, fotógrafo, segurança, ball boy,
  comentarista. O **mascote** saiu sem rig: a A-pose padronizada e o `bone_skinning` do HY só aceitam humanoide padrão
  (`仅支持人形标准化`), e o mascote de cabeça grande não passa. Dá para riggar no Blender transferindo os pesos de um torcedor.
- **Acessórios**: munhequeira, faixa, manga de compressão, joelheira, meia-calça, meia, óculos e 3 cabelos (para o
  `vestir.py`). O afro, os dreads e os óculos vieram num busto de manequim (apagar a cabeça antes de vestir); a manga de
  compressão saiu estranha (gerar de novo).
- Mais fracos: telão central (saiu com "antenas" de cabo), camarote (caixa genérica), faixa de LED (vale fazer no jogo).
- Textos e logos: base da cesta completa ("FREMIN"), dígitos do shot clock e um swoosh no banner de camisa; trocar por
  textura nossa.

### A arena no jogo

![antes e depois](img/arena-antes-depois.jpg)

**Otimização** (`Tools/Animacao/arena.py`, um GLB por item em `web/public/assets/arena/`, LFS pelo `*.glb`; 36 arquivos,
7,3 MB):

```bash
blender -b -P Tools/Animacao/arena.py -- web/public/assets/models_raw/arena web/public/assets/arena [nome ...]
```

- Escala real por item (mesa de anotação 1,15 m de altura, fileira VIP 3 m de largura, bloco de arquibancada 4,79 m...),
  frente para -Y no Blender (+Z no three) e origem no centro da base. Solda as costuras de UV antes de reduzir.
- Props 3–8k triângulos, cor + normal em 1024 px WebP; o metal/rugosidade do HY sai (material fosco). Arquibancada 2,5k e
  camarote 2k, só cor.
- Pessoas saem do `*_rig.fbx` numa pose fixa, com a pele aplicada e sem esqueleto: `sentado` (torcida, origem no apoio da
  coxa no assento), `mesa` (comentarista), `em_pe` com os braços baixos (técnicos, segurança, ball boy) e `ajoelhado`
  (fotógrafo). A pose aponta cada osso pela direção cabeça→cabeça do filho (a cauda do osso no FBX importado não aponta
  para a junta seguinte) com o "cima" no Z da armadura (o pescoço do HY fica ~8° atrás do quadril). Torcida 1,5k
  triângulos e cor em 512 px (são ~4 mil no anel); gente da volta da quadra 4k e 1024 px.
- Cesta: `cesta_estrutura` é a `cesta_completa` sem a tabela, o aro e a rede (tudo à frente da ponta do braço), com o
  braço esticado 0,5 m (na escala do modelo a base encostava na linha de fundo). `cesta_tabela` perde os dois aros que o
  HY desenhou (um de cada lado) e é escalada para 1,83 x 1,07 m; as faces do vidro viram o material `Vidro`. `cesta_aro`
  perde a moldura e a rede, é escalado pelo diâmetro externo da física (45,7 cm + tubo) e a placa é esticada até a face
  da tabela (15,1 cm). Não entraram: telão e faixa de LED (feitos no three.js), árbitros, dançarina, mascote, bola HD,
  prancheta, microfone, painel/púlpito, cadeiras soltas e os acessórios.

**No jogo** (`?arena=0` desliga tudo e volta à quadra antiga):

- `HoopMesh.buildModelHoop`: tabela na face da física (`backboardFaceCenter`), aro no `rimCenter()`, relógio de 24 s em
  cima e a estrutura nas costas da tabela. Só visual: a colisão e a rede (`NetMesh`) são as mesmas. O vidro é
  transparente e a pintura (borda e quadrado com a base na altura do aro) vem de um canvas do tamanho do vidro do modelo.
  Se algum GLB não carregar, cai no `buildHoop` antigo. Conferência: `node web/tools/arena-prints.mjs <pasta>` gera
  `cesta.png`/`cesta-lado.png` com o aro e a face da física em arame vermelho por cima.
- `ArenaDressing.ts` (posições da `game.layout`): a outra metade da quadra (o canvas do piso girado 180° em torno do
  centro, como numa quadra de verdade) e a cesta do outro lado com rede parada; mesa de anotação (3 módulos) no meio da
  lateral -y, transmissão com 4 comentaristas atrás, bancos dos dois times (2 fileiras de 2 módulos), técnicos de pé,
  cooler e toalhas; 3 fileiras VIP na lateral +y (a 2ª e a 3ª em degrau) com ~75% de gente; 6 fotógrafos ajoelhados e
  2 câmeras remotas sob cada cesta, câmeras de TV nos cantos, rack de bolas, rodo, ball boy, seguranças e o túnel no canto
  dos bancos.
- Arquibancada: 6 anéis de `bloco_arquibancada` num retângulo de cantos arredondados (218 blocos, InstancedMesh por
  lado da arena para o corte por frustum), recuo entre o 3º e o 4º anel com a faixa de LED (canvas que corre),
  camarotes no topo das laterais, 12 banners atrás das linhas de fundo, refletores no teto e o telão central (placar em
  canvas). Torcida: ~4.100 pessoas sentadas, uma InstancedMesh por lado e modelo; o shader gira o matiz das roupas por
  instância (a pele fica: vermelho > verde > azul com saturação de pele) e clareia/escurece o resto, com um pouco de luz
  própria (a arquibancada fica na penumbra). 7,2 M triângulos na arena, 96 malhas; 60 FPS no headless (RX 9070 XT).
- Os GLBs começam a baixar junto com o jogador e os shaders são compilados antes do 1º quadro (`compileAsync`).

![de cima](img/arena-cima.jpg)
![cesta](img/arena-cesta.jpg)

## Pé e tênis (16/10): a pele furava o cano (rodadas 1–4 parciais; a 5ª fechou)

O usuário viu nos prints a canela e o tornozelo aparecendo através do tênis, e o tênis sem acompanhar o pé. Duas
rodadas. A medição é `web/tools/tenis-quadros.mjs` (pés em movimento, câmera baixa; por quadro, a pele do corpo visível
que fica fora do tênis, por pé; "mm" = pior vértice; repete na CPU o corte e a puxada do corpo).

**Medição antes (rodada 1, a medição antiga por paridade de raio; ainda serve de referência):** parado 28,4 mm; corrida de
lado 94,7; corrida de frente 52,0; parada 30,8; agachar 28,0; crossover 27,4; pulo 26,9.

**Causa.** Os tênis tinham só dois ossos, `foot_r` (rígido, com o cano inteiro) e `ball_r` (biqueira). O corpo pesa a pele
acima do tornozelo (a partir de ~11 cm) em `calf_*`: ao flexionar o tornozelo, a canela saía do cano. Além disso, o cano
do HY não é centrado na canela: a 13 cm do chão a parede de trás está a 1 a 3 cm do eixo da canela e a da frente a 5 a 9
cm, e há falhas (sem tecido de fora) na parede de trás da malha. A pele que passa por essas falhas aparece mesmo com o
cano inteiro. Empurrar o tênis para fora da canela (normal da pele, escala por altura, cilindro da canela) rasgou ou
amassou o cano: descartado.

**O que está no código.**
- `Tools/Animacao/vestir.py` (tênis): os pesos são copiados da pele do pé do corpo (média de 4 vértices mais próximos no
  bind, do mesmo pé). Cano segue `calf_*`, calcanhar `foot_*`, biqueira `ball_*`. Geometria e UV não mudaram.
- `web/src/game/CuffPull.ts` (novo): no vertex shader do corpo (encadeado no material, depois da pele), a pele da perna e do
  pé abaixo da boca do cano é puxada para o eixo do osso até o raio do cano por altura, com peso 1 abaixo da boca e 0 um
  centímetro e meio acima. Altura medida ao longo da canela na pose atual (não no bind: com a perna dobrada a pele que
  estava acima da boca desce).
- `web/src/game/BodyCover.ts` (`cutBelowCuff`): corte do corpo pela altura, sem o recorte em dentes por triângulo, para os
  triângulos inteiros abaixo da boca perto do pé.
- `web/src/game/PlayerGear.ts` (`shoeCuffs`): boca (ponto mais alto do tênis) e perfil do cano por altura (1 cm; em 12
  setores, o menor raio externo, menos 3 mm), medidos no GLB de cada tênis ao vestir; `dispose` desliga a puxada. Os
  ossos do bind vêm do skeleton do próprio tênis (conferido: tornozelo a 3,6 cm).

**Resultado (rodada 2, `tenis-quadros.mjs`, tênis retrô alto, pior vértice por pé):**
parado: esquerdo 16,7 mm, direito 0; corrida de lado: esquerdo 50,5, direito 0; corrida de frente: esquerdo 49,3, direito 0;
parada brusca: direito 30,6; agachar: direito 19,2; crossover: direito 16,3; pulo: direito 15,8.
**Meta do diretor (< 3 mm em todas as cenas, pés direito e esquerdo, os 5 tênis): NÃO atingida.** Pendências:
- Falhas da malha do tênis (parede de trás do cano a 1 a 3 cm do eixo, sem tecido de fora em alguns setores): a pele que
  passa por elas aparece. Corrigir na malha (fechar a parede de trás do cano e centrá-lo na canela no `vestir.py`), o que
  mexe nas UVs e nas máscaras de cor (`zonas-cor.py`).
- Corrida: a câmera de `tenis-quadros.mjs` perde o pé em movimento (os quadros de corrida não servem para olhar de perto).
- Os 5 tênis e o pé esquerdo não foram medidos nas 7 cenas com esta rodada.

### Terceira rodada: meia (estado: parcial)
- `Tools/Animacao/vestir.py` (tênis) agora sai com a **meia**: `meia_r` e `meia_l`, casca da pele do pé e da canela do corpo
  (todos os vértices do lado até 3 cm acima do topo do cano + 5 cm), inflada 3,5 mm, pesos copiados, boca num plano 5 cm
  acima da boca do tênis, material branco de dois lados, buracos da sola tampados. Mesmo GLB do tênis (5 GLBs regenerados).
- No jogo (`PlayerGear.shoeCuffs`) a boca e o perfil do cano vêm da meia (`meia*`); o corte da pele e o `CuffPull`
  (32 faixas de 1 cm) usam esse perfil.
- Câmera do `tenis-quadros.mjs`: cada vista segue um pé (direito, esquerdo) ou o meio dos pés.
- **Não atingido:** a medição ainda dá ~36–44 mm nos dois pés em quase todas as cenas (118 mm na corrida de lado do pé
  direito do Retrô). A causa mais provável é a malha do próprio corpo: ele tem ~500 arestas abertas (cracks e a sola não
  fechada), e a casca herda isso, então a medição vê buracos. O meia esquerda sai limpa no quadro parado; a direita ainda
  escura e com dentes no topo. Próximo passo: fechar a malha do corpo antes de copiar (ou construir a meia por um
  envelope fechado da perna, não pelas faces do corpo) e rever a orientação das faces.

### Quarta rodada: meia como envelope fechado (estado: parcial)
- `vestir.py` (tênis) gera a meia por código, sem copiar faces do corpo: tubo em anéis de 1 cm (24 setores) do topo da meia
  até o tornozelo, curvado no tornozelo e seguindo o pé até a ponta. Raio por setor = maior raio da pele do lado ali + 3,5
  mm, suavizado entre setores e anéis. Ponta fechada e sola fechada (malha fechada: só a borda do topo fica aberta; 24
  arestas). Pesos por trecho (calf na perna, foot no pé, ball na frente); normais suaves; material branco fosco.
- Não feito nesta rodada: ribana arredondada (o topo é uma borda simples mais grossa 1,5 cm, sem a dobra), e a meia não
  se encolhe para dentro do cano (o `CuffPull` puxa a pele para o perfil da meia, sem mexer no tênis).
- Medição (`tenis-quadros.mjs`, 7 cenas, dois pés): ~40 mm no retrô, cimento e baixo, parado e em quase todas as cenas.
  Diagnóstico: esse número é quase todo da borda do topo da meia (a pele logo acima do aro, que a meia inclinada deixa
  de fora de um lado), contada como pele por fora. O critério de borda local não separa "pele acima do aro" de "pele
  furando"; por isso a medição não fecha e não serve de meta ainda.
- Falta visível: dentes da pele dentro da abertura do topo (o corte da pele é por triângulo, e a pele que aparece por
  dentro do aro é a borda desse corte).

### Quinta rodada (17/10): meia e cano refeitos no Blender (estado: feito)

```bash
blender -b -P Tools/Animacao/vestir.py -- web/public/assets/hoops_player.glb web/public/assets/models_raw/<tenis>.glb tenis web/public/assets/gear/<tenis>.glb --cano=alto|medio|baixo
```

No `vestir.py` (tênis), sem nada no jogo puxando ou cortando a perna:
- **Meia**: casca da pele soldada (malha fechada), da perna até 5 cm acima do colarinho, afastada 2,5 mm e alisada. Tem a
  ribana (+0,8 mm nos 2 cm de cima) e o lábio dobrado para dentro da pele (a borda não aparece). Pesos copiados da pele.
- **Cano refeito**: o do HY entrava na perna (parede de trás a 1–3 cm do eixo, falhas sem tecido de fora) e sai. O novo é
  um loft de anéis da parte baixa do tênis até o colarinho, em volta da meia, com o colarinho acolchoado e o forro. As UVs
  são de paleta (texels sólidos das cores dominantes do tênis), então as máscaras de zona continuam valendo.
- **Altura do colarinho** por tipo (`--cano=alto|medio|baixo`: 9,5, 7 e 4,5 cm). Alto: retrô alto 1. Médio: verniz 11,
  cimento 4 e elefante 3. Baixo: baixo moderno.
- **Acabamento**: o tênis é empurrado para fora da meia (folga de 1,5 mm) e ganha normais novas (as do HY ficavam erradas
  onde a parede andou). Os pesos do tênis são copiados da meia.
- **Conferência no Blender** (o próprio `vestir.py`, linhas `CONFERE`): 38 clipes × 7 quadros mais o bind. Os pontos são
  ancorados por baricentro (meia → pele, tênis → meia) e a distância tem sinal, pela normal do triângulo posado.
  - Tênis contra meia: 0 cruzamentos nas 267 poses, nos 5 tênis (folga mínima de 0,4 a 1 mm).
  - Meia visível contra pele: até 1,8 mm, só no lábio (de propósito).
- **Saíram**: `CuffPull.ts`, `BodyCover.cutBelowCuff`, `web/tools/tenis-quadros.mjs` e as chamadas no `PlayerGear`.

## Pendências
- Arena: torcida sem animação (próximo passo: VAT); cantos da arquibancada com blocos girados sobrepostos (um bloco de
  canto próprio fecharia); dígitos do shot clock e o placar do telão são estáticos; GPUs fracas podem precisar de menos
  anéis ou menos torcida.
- Pele: com a emissão o tom ficou claro e quente, mas um pouco brilhante na testa e no nariz de perto; ajustar com a
  iluminação final da arena (a sessão da arena mexe nas luzes).
- Roupa costurada, detalhes pequenos:
  - de muito perto, a borda entre tecido e debrum na textura tem degraus de 1 texel (1024 px);
  - a mão no quadril entra na barra solta da regata (a regata não tem LimbPush);
  - no alto da cava, com o braço descendo, o deltoide encosta na borda da alça;
  - no kit branco, a frente fica cinza sob a luz de cima (é sombra, não textura).
- Número e nome nas costas: a regata costurada tem UV por ilhas. Uma ilha plana nas costas sai no próprio `costurar.py`
  (caminho em docs/26).
- Texturas próprias, sem marca, antes de qualquer distribuição (os tênis do HY trazem swoosh e Jumpman pintados).
