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
```

- Sujeito 06: drible (parado, andando, de costas, de lado, crossover) e arremesso saindo do drible.
- Sujeito 16: corrida (16_45, ~4 m/s), passada para o esqueleto do 06.
- Sujeitos 79 (flexing) e 141 (shrug): celebrações, também passadas para o esqueleto do 06.
- Sujeito 102 (basquete atlético, baixo e explosivo): 102_14 "GoLeft" (crossover em corrida com corte), 102_11
  "OffensiveMoveSpinLeft" (spin com a bola na direita) e 102_18 "FeintLeftMoveRight" (finta e arranque),
  passados para o esqueleto do 06. Outros trials úteis do 102: 12/15 (spin), 13 (crossover em corrida E->D),
  19 (finta), 20/21 (pump fake + infiltração), 30–32 (infiltrações). Não há step-back no 102.
- Próximos: sujeito 124 (124_05 jump shot, 124_06 bandeja) e 06_13 (drible baixo/rápido, entre as pernas).

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

## 3. Montar o personagem e exportar (Blender 4.x/5.x ou módulo `bpy`)

```bash
blender --background --python montar_personagem_blender.py -- bvh_jogo SK_HoopsDummy.fbx --render previews
# ou, sem Blender instalado:  pip install bpy  e  python montar_personagem_blender.py -- ...
```

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
