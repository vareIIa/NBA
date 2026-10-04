# Pipeline de animação (mocap aberto → boneco animado na Unreal)

Enquanto a sessão de captura própria (docs/dev/SESSAO-CAPTURA-01.md) não acontece, o jogador usa mocap
da **CMU Graphics Lab Motion Capture Database**, processado por estes scripts até virar um FBX com malha,
esqueleto e todas as animações (`Art/Characters/HoopsDummy/SK_HoopsDummy.fbx`).

```
CMU (ASF/AMC) ──processar_clipes.py──► BVH por clipe ──montar_personagem_blender.py──► SK_HoopsDummy.fbx ──► Unreal
                 (recorte, loop, no lugar,           (esqueleto c/ nomes da Unreal,           (Tools/Editor/
                  frente, espelho, retarget)          boneco articulado, 1 FBX)                 importar_personagem.py)
```

## Licença dos dados (CMU)

> "The data used in this project was obtained from mocap.cs.cmu.edu.
> The database was created with funding from NSF EIA-0196217."

Uso comercial permitido, inclusive em jogo vendido. **Não pode** revender/redistribuir os dados em si
(nem convertidos) como produto. Por isso os `.amc/.asf` **não** vão para o repositório: cada um baixa da fonte.
O FBX do jogo é um asset derivado, usado dentro do jogo (permitido).

## 1. Baixar os dados

```bash
mkdir -p cmu && cd cmu
curl -O http://mocap.cs.cmu.edu/subjects/06/06.asf
for i in 01 02 04 05 06 08 12 15; do curl -O http://mocap.cs.cmu.edu/subjects/06/06_$i.amc; done
curl -O http://mocap.cs.cmu.edu/subjects/06/06_14.amc
curl -O http://mocap.cs.cmu.edu/subjects/16/16.asf
curl -O http://mocap.cs.cmu.edu/subjects/16/16_45.amc
curl -O http://mocap.cs.cmu.edu/subjects/79/79.asf
curl -O http://mocap.cs.cmu.edu/subjects/79/79_94.amc
curl -O http://mocap.cs.cmu.edu/subjects/141/141.asf
curl -O http://mocap.cs.cmu.edu/subjects/141/141_21.amc
curl -O http://mocap.cs.cmu.edu/subjects/102/102.asf
for i in 11 14 18; do curl -O http://mocap.cs.cmu.edu/subjects/102/102_$i.amc; done
# Segunda leva: bandeja/enterrada/jump shot alto (124), drible baixo e entre as pernas (06_13), comemorações e "vira e volta"
curl -O http://mocap.cs.cmu.edu/subjects/06/06_13.amc
curl -O http://mocap.cs.cmu.edu/subjects/124/124.asf
for i in 05 06; do curl -O http://mocap.cs.cmu.edu/subjects/124/124_$i.amc; done
curl -O http://mocap.cs.cmu.edu/subjects/79/79_86.amc
curl -O http://mocap.cs.cmu.edu/subjects/141/141_22.amc
curl -O http://mocap.cs.cmu.edu/subjects/142/142.asf
curl -O http://mocap.cs.cmu.edu/subjects/142/142_09.amc
curl -O http://mocap.cs.cmu.edu/subjects/69/69.asf
curl -O http://mocap.cs.cmu.edu/subjects/69/69_39.amc
```

- Sujeito 06: drible (parado, andando, de costas, de lado, crossover) e arremesso saindo do drible.
- Sujeito 16: corrida (16_45, ~4 m/s), passada para o esqueleto do 06.
- Sujeitos 79 (flexing) e 141 (shrug): celebrações, também passadas para o esqueleto do 06.
- Sujeito 102 (basquete atlético, baixo e explosivo): 102_14 "GoLeft" (crossover em corrida com corte), 102_11
  "OffensiveMoveSpinLeft" (spin com a bola na direita) e 102_18 "FeintLeftMoveRight" (finta e arranque),
  passados para o esqueleto do 06. Outros trials úteis do 102: 12/15 (spin), 13 (crossover em corrida E->D),
  19 (finta), 20/21 (pump fake + infiltração), 30–32 (infiltrações). Não há step-back no 102.
- Segunda leva (escolhas olhando bonecos de palito de frente/lado/cima e as curvas de pelve, mãos e pés):
  - **124_06** "Basketball Lay Up": dois passos com drible, plant de dois pés e salto de ~60 cm com a mão direita a
    ~2,6 m (no sujeito 124). Vira a bandeja e, com o braço esquerdo espelhando o direito no voo, a **enterrada de duas
    mãos**. A CMU não tem enterrada: **124_11** "2 Foot Jump" é salto em distância com os braços baixos (mão ≤ 1,25 m),
    13_39/118_01 (jump) não levantam os braços acima da cabeça e 14_07 (jump up to grab) são pulinhos de ~20 cm.
  - **15_12** (dribble, lay-up shot, pass): a "bandeja" é mímica parada (pés nunca saem mais de 5 cm do chão, mão até
    1,89 m). Não serve.
  - **124_05** "Basketball Jump Shot" é claramente melhor que o 06_15 (comparação abaixo) e virou o JumpShot2.
  - **06_13** (low, fast free style dribble, dribble through legs): 41 s girando pela quadra. Drible baixo de proteção em
    1759-1805 e um entre as pernas limpo (quase parado) em 2376-2431. Os outros entre-as-pernas do take (f544, f770,
    f1685) acontecem girando 75-100° (no lugar, o pé plantado desliza). **Não há por trás das costas limpo**: as mãos
    atrás do corpo (f1220-1239, f1490-1507) ficam na altura do quadril e parecem a bola passando em volta da cintura,
    sem quique; o "por trás" continua com o crossover do 06_14.
  - Comemorações: **79_86** (arco e flecha), **142_09** "Joy" (os dois braços em V, 745-840) e **141_22** (toca aqui).
    **142_06** "Elated" é um andar saltitado: só os braços não leem como gesto (fica de fora).
  - "Vira e volta": **69_39** ("walk backward, turn in place") em vez do 69_34. No 69_34 o giro acontece andando de costas
    em arco (0,2-0,6 m/s, o pé desliza no lugar); no 69_39 ele para e gira ~170° no lugar.

## 2. Processar os clipes (numpy)

```bash
python processar_clipes.py cmu bvh_jogo
```

O que faz em cada clipe:
- **Loop**: procura a melhor emenda pela distância de pose, comparando uma janela de quadros (−4, 0, +4)
  para casar também a direção do movimento; fecha com crossfade (slerp).
- **No lugar**: tira o deslocamento horizontal (quem anda é o capsule do jogo) e guarda a velocidade nativa.
- **Frente**: gira o clipe para o corpo olhar para +Z (no arremesso, a frente é medida no trecho do arremesso).
- **Des-girar** (`unturn`, clipes do 102): tira do clipe o giro "grosso" do corpo (frente suavizada), deixando o
  balanço dos quadris. No spin quem gira é a malha (curva medida, `HoopsDummyRig::SpinTurnProgress`); no crossover
  em corrida o corte vira o capsule. Assim o giro do clipe e o do jogo nunca somam.
- **Espelho**: gera a versão da outra mão (S·R·S com S = diag(−1, 1, 1), trocando ossos l/r).
- **Retarget**: as rotações locais da CMU já estão em frames alinhados ao mundo (C·M·C⁻¹), então valem para
  qualquer sujeito; só a altura da pelve é escalada.
- **Camadas** (`Dribble_Run`): pernas/pelve da corrida + braços/cabeça de UM drible do `Dribble_Walk_R`,
  reamostrado para caber em uma passada; o tronco mistura os dois (50%).
- Imprime o ritmo do drible de cada clipe (quadros do "empurrão" = vale da mão com histerese de 10 cm,
  o mesmo detector que o jogo usa em tempo real para soltar a bola).
- **Sem deriva** (`remove_drift`, ações da segunda leva): tira o caminho horizontal suavizado da raiz (corrida -> salto
  tem velocidade variável, o `in_place` deixaria a pelve indo e voltando); quem anda é o capsule.
- **Voo mais baixo no clipe** (`soften_flight`, bandeja/enterrada): tira 70% / 55% do arco da pelve entre a decolagem e a
  aterrissagem (duas meias-parábolas que valem 0 nas pontas). O resto do pulo é do capsule, lançado no quadro da decolagem
  com o ápice no ápice do clipe: os pés saem e voltam ao chão junto com o mocap.
- **Braço espelhado** (`copy_arm`, enterrada): o braço esquerdo vira o espelho do direito no voo, o tronco fica simétrico
  (sem inclinação lateral nem torção) e os dois úmeros fecham 15° para as mãos se encontrarem na bola.
- **Emenda** (`splice`, arco e flecha): corta a mira de ~1 s juntando dois trechos com 8 quadros de mistura.

## 3. Montar o personagem e exportar (Blender 4.x/5.x ou módulo `bpy`)

```bash
blender --background --python montar_personagem_blender.py -- bvh_jogo SK_HoopsDummy.fbx --render previews
# ou, sem Blender instalado:  pip install bpy  e  python montar_personagem_blender.py -- ...
```

`--clipes Nome1,Nome2,...` troca a lista padrão de clipes (p.ex. para incluir um take da captura própria convertido por
`Tools/Captura/pose2sim_para_bvh.py`, que grava no mesmo esqueleto e com a mesma hierarquia destes BVH).

Ossos renomeados para o padrão da Unreal (`pelvis`, `spine_01..03`, `neck_01/02`, `head`, `clavicle_l`,
`upperarm_l`, `lowerarm_l`, `hand_l`, `palm_l`, `fingers_l`, `thumb_l`, `thigh_l`, `calf_l`, `foot_l`, `ball_l`, ...).
Malha "boneco de teste" com 3 materiais (`Pele`, `Uniforme`, `Tenis`) que o jogo colore em runtime.

## 4. Importar na Unreal

Ver `docs/dev/COMO-RODAR.md` (script `Tools/Editor/importar_personagem.py`, ou arrastar o FBX para
`/Game/Hoops/Characters/Dummy`).

## Clipes (60 fps)

| Clipe | Origem | Duração | Velocidade nativa | Empurrões (quadro) |
|---|---|---|---|---|
| Hold_Idle | 06_02 | 0,83 s | parado | — |
| Walk | 06_01 | 1,25 s | 1,05 m/s frente | — |
| Run | 16_45 (retarget) | 0,70 s | 4,14 m/s frente | — |
| Dribble_Idle_R / _L | 06_12 (+ espelho) | 0,85 s | parado | 5 |
| Dribble_Walk_R | 06_05 | 1,93 s | 1,33 m/s frente | 1, 50 |
| Dribble_Walk_L | 06_04 | 2,05 s | 1,42 m/s frente | 42, 89 |
| Dribble_Run_R / _L | Run + drible do 06_05 | 0,70 s | 4,14 m/s frente | 17 |
| Dribble_Back_R / _L | 06_06 (+ espelho) | 2,07 s | 1,19 m/s para trás | 42, 93, 123 |
| Dribble_Side_R | 06_08 | 1,32 s | 1,23 m/s para a ESQUERDA do jogador | 37, 77 |
| Dribble_Side_L | espelho | 1,32 s | 1,23 m/s para a DIREITA do jogador | 38, 77 |
| JumpShot_R / _L | 06_15 quadros 55–fim (+ espelho) | 3,63 s | one-shot | — |
| Cross_R2L / _L2R | 06_14 quadros 8–60 (+ espelho) | 0,88 s | ação (crossover) | solta ~9, recebe ~30 |
| Celebrate_Flex | 79_94 quadros 295–370 (retarget) | 1,27 s | só tronco no jogo | — |
| Celebrate_Shrug | 141_21 quadros 25–90 (retarget) | 1,10 s | só tronco no jogo | — |
| EscapeCross_R2L / _L2R | 102_14 quadros 20–65 (retarget, des-girado; + espelho) | 0,77 s | ação (crossover de ataque/escape, em corrida) | início 6, solta ~16, recebe 30, fim 42 |
| Spin_R2L / _L2R | 102_11 quadros 9–83 (retarget, des-girado; + espelho) | 1,25 s | ação (spin; o jogo gira a malha) | início 6, solta ~16, recebe 43, empurra ~55, fim 68 |
| Hesitation_R / _L | 102_18 quadros 26–63 (retarget, 60% des-girado; + espelho) | 0,63 s | ação (hesitação, in-and-out) | início 5, empurra ~26, fim 34 |
| Layup_R / _L | 124_06 quadros 160–247 (retarget, des-girado, sem deriva, 30% do arco; + espelho) | 1,47 s | ação (bandeja) | gather 18, decola 25, ápice/solta 45, aterrissa ~66, fim 82 |
| Dunk | 124_06 quadros 160–247 (idem, 45% do arco, braço esquerdo = espelho do direito no voo) | 1,47 s | ação (enterrada de duas mãos) | gather 22, decola 25, ápice 45, solta 49, aterrissa ~66, fim 82 |
| JumpShot2_R / _L | 124_05 quadros 150–261 (retarget, des-girado, sem deriva; + espelho) | 1,87 s | one-shot (jump shot alto) | dip 18, decola 41, solta 55, follow-through 61, aterrissa 72, fim 88 |
| Dribble_Low_R / _L | 06_13 loop 1759–1805 (+ espelho) | 0,77 s | parado (LT, proteger) | 17, 37 (~2,6/s; o jogo toca a 1,15 = ~3/s) |
| BetweenLegs_L2R / _R2L | 06_13 quadros 2376–2431 (60% des-girado, sem deriva; + espelho) | 0,93 s | ação (entre as pernas) | início 12, solta ~23, recebe 40, fim 48 |
| Celebrate_Bow | 79_86 quadros 138–191 + 248–289 (retarget, emenda) | 1,47 s | só tronco no jogo | — |
| Celebrate_ArmsUp | 142_09 quadros 745–840 (retarget) | 1,60 s | só tronco no jogo | — |
| Celebrate_HighFive | 141_22 quadros 25–95 (retarget) | 1,18 s | só tronco no jogo | — |
| TurnBack | 69_39 quadros 238–358 (retarget, des-girado; o jogo gira o ator) | 2,02 s | ação (vira e volta depois do green) | início 4, giro 14–112 (166° no mocap), fim 118 |

**JumpShot** (quadros do clipe): gather 33 · dip **80** (início da ação no jogo; o clipe é centralizado aqui)
· pés saem ~108 · **soltura 117** · ápice 119 · aterrissagem ~132. O jogo toca a partir do 80 com
`playrate = (117 − 80) / 60 / (tempo ideal de soltura)`, então a mão chega no topo exatamente no green.

**Movimentos do Pro Stick** (quadros do clipe; constantes em `Source/Garrafao/HoopsDummyRig.h`). Nos que trocam de mão a
bola sai no **início** da ação e a outra mão recebe no fim do voo: `playrate = (recebe − início) / 60 / SwitchFlightSeconds`
(0,6 × a duração do movimento). Sem troca de mão (hesitação), o miolo início–fim é tocado na duração do movimento.

| Clipe | Movimentos | O que mostra | Notas |
|---|---|---|---|
| EscapeCross_* | Crossover de ataque (RT); qualquer troca de mão simples já correndo (> 3 m/s) | Corre com a direita, planta baixo (pelve ~72 cm no 102), cruza na frente e sai acelerando (1,8 → 3,9 m/s) | O corte de ~40° foi tirado: quem vira é o capsule (orientado ao movimento no sprint) |
| Spin_* | Spin (360°), half-spin (vai a 180° e volta) | Mão direita leva a bola por fora, empurra no giro, a esquerda recebe e empurra | Giro medido de 211° no miolo (horário visto de cima com a bola na direita); progresso por 1/8 do miolo: 0, 0,230, 0,431, 0,578, 0,682, 0,779, 0,873, 0,956, 1 |
| Hesitation_* | Hesitação, escape de hesitação, in-and-out | Bola na cintura, corpo começa ~22° virado para o lado da mão livre e volta de frente com o arranque | Termina de frente para emendar no loop de base |
| BetweenLegs_* | Entre as pernas parado / no size-up (correndo, a troca de mão vira o EscapeCross) | Base escalonada e baixa (quadril ~82 cm), a mão empurra a bola entre os pés (~47 cm) e a outra recebe subindo pela frente | 60% do giro (~25°) saiu; o "por trás" segue com o Cross_* (sem clipe limpo na CMU) |

### Segunda leva no jogo (`HoopsPlayerCharacter.cpp`)

**Jump shot alto (JumpShot2, padrão: `JumpShotStyle` = 1).** Comparado no mesmo esqueleto (06): soltura com os dedos a
~2,37 m, **~50 cm acima da cabeça** (06_15: ~1,88 m, ~12 cm acima da cabeça, um "empurrão" na frente do rosto); set point
acima da testa num movimento só (06_15 segura a bola no queixo ~0,7 s antes do dip); pés a ~33 cm do chão (06_15: ~20);
follow-through de verdade: a mão de apoio sai primeiro e o braço do arremesso fica no alto até a aterrissagem (06_15:
as duas mãos descem juntas). Dip → soltura = 37 quadros nos dois, e o jogo usa `playrate = (soltura − dip) / tempo ideal`:
o green não muda. `JumpShotStyle` = 0 volta ao clássico; sem o clipe importado, o jogo usa o clássico.

**Bandeja e enterrada.** O clipe vai do gather à soltura em `LayupReleaseSeconds` (0,42 s) / `DunkReleaseSeconds` (0,48 s).
O capsule fica no chão no gather (embalo para o aro mantido) e decola no quadro da decolagem com
`JumpZ = g × (ápice − decolagem) / playrate`: o ápice do capsule cai no ápice do clipe, e o capsule volta ao chão junto
com os pés do mocap. Bandeja: decola 0,11 s depois do gather e sobe ~47 cm (+30% do arco do mocap no clipe), mão a ~2,9 m
na soltura (jogador de 1,96 m). Enterrada: começa mais perto da decolagem (subida mais longa), sobe ~62 cm (+45% do arco), mãos a ~3,1 m
(acima do aro) e solta 4 quadros depois do ápice, já descendo as mãos. O capsule chega a 60 cm do aro (bandeja) / 35 cm
(enterrada) na soltura. Bandeja do lado do aro por onde entra (perto do meio, a mão do drible); a da esquerda é o espelho
e leva a bola na mão esquerda. Sem os clipes (FBX antigo) ou sem o boneco, vale o caminho antigo (`RigJumpScale` 0,55 com o
arremesso como bandeja; sem boneco, pulo inteiro do capsule).

**LT (proteger).** Parado com a bola e LT: `Dribble_Low_*` (base escalonada, tronco sobre a bola, braço livre de escudo) a
`DribbleLowPlayRate` = 1,15 (~3 quiques/s), com 40% da postura procedural por cima (o clipe já é ~14 cm mais baixo).

**Comemorações (só tronco).** D-pad nos ~2,5 s depois da cesta, sem a bola: cima = bíceps → (de novo) braços para o alto;
direita = ombros → (de novo) toca aqui; baixo = arco e flecha; esquerda = segura a pose do arremesso. A celebração
automática do green alterna bíceps, ombros, arco e flecha e braços para o alto (o toca aqui pede um companheiro).

**Vira e volta (green).** 1,3 s depois da soltura de um green, parado e sem a bola: `TurnBack` a 1,8× (giro em ~0,9 s) e o
ator gira 180° para a esquerda pela curva medida (`HoopsDummyRig::TurnBackProgress`: 0, 0,072, 0,218, 0,386, 0,562,
0,733, 0,861, 0,959, 1), com o braço/celebração por cima. LS, receber a bola ou arremessar cancela. `bTurnBackAfterGreen`
desliga.

Folha de contato: `Art/Characters/HoopsDummy/preview_wave2.png` (renderizada do FBX exportado; no TurnBack o boneco gira
como no jogo).
