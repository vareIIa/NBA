# 16 — Pipeline Aberto: Visual Realista e Captura de Movimento

> Decisão D7: visual **realista**, o melhor possível com ferramentas e assets **gratuitos/open-source**.
> Decisão D9: captura com **atletas e quadra fornecidos pelo diretor**.
> Pesquisa de outubro de 2026. **Conferir cada licença antes de lançar** (licenças mudam).

Legenda: ✅ uso comercial liberado · ⚠️ liberado com condições · ⛔ não comercial / só pesquisa (**armadilha**)

## 1. Stack recomendada

| Camada | Escolha | Licença |
|---|---|---|
| Personagens realistas | **MetaHuman** (UE 5.8) | ⚠️ EULA da UE: grátis abaixo de US$ 1 mi/ano; pode ser usado em qualquer engine e vendido; **proibido usar para treinar IA** |
| Personagens de fundo / variações | **MPFB2** (MakeHuman para Blender) | ✅ código GPL, **exportações CC0** |
| HDRIs, texturas de piso/asfalto | **Poly Haven** + **ambientCG** | ✅ CC0 |
| Piso de quadra (tábuas de maple), aro, tabela, bola | **Feitos por nós** (Blender + Material Maker) | ✅ nosso |
| Props extras | Pacote inicial grátis do Fab (1.500+ assets); Sketchfab CC-BY (com crédito) | ⚠️ por item |
| Público | MetaHuman Crowd (5.8, experimental) / Vertex Animation | ⚠️ |
| Mocap multicâmera | **Pose2Sim** + **RTMPose/RTMW** (rtmlib) + caliscope | ✅ BSD-3 / Apache-2.0 / BSD-2 |
| Mocap alternativo | **MetaHuman Animator Markerless** (1 câmera, 5.8, experimental); FreeMoCap | ✅ grátis / ⚠️ AGPL (só a ferramenta) |
| Rastreio da bola no vídeo | **RT-DETR** ou **RF-DETR (N–L)** + **SAM 2**, triangulado entre câmeras | ✅ Apache-2.0 |
| Dedos | **Poses de mão autorais** (5–10 grips) + Control Rig IK na bola | ✅ |
| Dados iniciais (protótipo) | **CMU Mocap** (clipes de basquete), Game Animation Sample (UE), 100STYLE | ✅ / ⚠️ só UE / ✅ CC-BY |
| Limpeza e retarget | **Blender 5.x** (+ Pose2Sim_Blender, Expy Kit) → **IK Retargeter** da UE | ✅ |
| Limpeza avançada (opcional) | Cascadeur Indie (~US$ 8/mês anual, exporta FBX) | Pago; o plano grátis **não** é comercial |

## 2. Armadilhas de licença (evitar)

| Item | Problema |
|---|---|
| **SMPL / SMPL-X / MANO** e tudo que depende deles (VIBE, WHAM, GVHMR, 4D-Humans, TRAM, HaMeR, modos de malha do EasyMocap) | A licença proíbe uso comercial **inclusive das animações geradas**. A licença comercial é vendida à parte |
| **OpenPose** | Não comercial; a licença comercial é cara e, segundo fontes secundárias, exclui esportes |
| **Ultralytics YOLO (v5/v8/v11)** | AGPL; a empresa diz que até pesos treinados e uso interno exigem licença Enterprise. YOLOv7/v9 são GPL; pesos do YOLO-NAS são não comerciais |
| **AMASS, LaFAN1, Bandai Namco Motion** | Não comerciais |
| **Conversões FBX do CMU** no 4TU/Hugging Face | CC BY-NC. **Converter nós mesmos** a partir do ASF/AMC original |
| **Daz Studio** | Cada asset exige licença "Interactive" para jogos |
| Modelos com logo da NBA/times | Licença CC não cobre marcas registradas |
| Código vazado (ex.: "nba-jam" no GitHub) | Proibido |

## 3. Visual realista: receita

1. **Piso brilhante de maple** (a assinatura do basquete): material Substrate com clear-coat + reflexos via Lumen com ray tracing de hardware. Tábuas estreitas geradas no Material Maker/Blender (não há CC0 exato).
2. **Iluminação de ginásio**: MegaLights (centenas de luzes com sombra), HDRIs de ginásio do Poly Haven (`gym_01`, `gym_entrance`, `squash_court`, `crossfit_gym`) para referência e reflexo.
3. **Aro, tabela, bola**: geometria simples nas medidas oficiais (aro de 18" a 10 pés, tabela de 72×42") feita por nós; rede com Chaos Cloth.
4. **Personagens MetaHuman**: pele e cabelo do MetaHuman (a melhor opção gratuita); o suor cresce com a fadiga (`11-apresentacao.md`). Na 5.8, o MegaLights também suporta subsurface scattering.
5. **Risco a testar cedo**: se o MetaHuman alcança as alturas de pivô (2,10 m+) sem quebrar proporções. Há relato na 5.8 de o *conform* não preservar a altura.
6. Quadra externa (depois): asfaltos `asphalt_01–07` e `worn_asphalt` (Poly Haven), grade `modular_chainlink_fence`, linhas pintadas do ambientCG.

## 4. Captura de movimento com os atletas do diretor

### 4.1 Equipamento (orçamento baixo)

| Item | Recomendação | Custo aprox. (US$) |
|---|---|---|
| Câmeras | **6–8** GoPro (HERO9–13) ou celulares com gravação manual (app Blackmagic Camera) | 0 (celulares próprios) a ~2.400 |
| Resolução / fps | **1080p–2.7K a 120 fps** (60 fps só para corpo sem bola; 240 fps para close-up de mão/arremesso) | — |
| Obturador | **1/960–1/1000 s** (a 1/120 s, a bola borra 1/3 do diâmetro) | — |
| Luz | De dia ao ar livre, ou 2–4 refletores LED **sem flicker** no ginásio (testar flicker de 100/120 Hz das luzes do ginásio) | 300–1.000 |
| Tripés/suportes de 2–3 m, power banks, cartões V30 | — | 400–700 |
| Calibração | Placa **ChArUco** rígida (A1/A0) + cruzamentos das linhas da quadra medidos com trena | 50–200 |
| **Total** | | **~1.500–4.000** (usando um PC RTX já existente) |

Configuração GoPro: **lente Linear, HyperSmooth DESLIGADO** (a estabilização estraga a calibração), balanço de branco/ISO/obturador/resolução travados. Sincronismo: QR code de tempo do **GoPro Labs** + palma ou flash de LED por take + sincronização automática do Pose2Sim.

### 4.2 Volume de captura

- Câmeras ao redor de **meia-quadra**, concentradas num volume de ~**8×8 m** (garrafão até o topo do arco), para o atleta ocupar ≥ 1/3 da altura do quadro.
- Evitar câmera de cima (vista de topo).
- Um estudo de 2025 sobre basquete 3x3 usou RTMPose com 8 câmeras DJI Action 3 em 1080p60. É uma configuração próxima da nossa.

### 4.3 Pipeline

```
Vídeos (6–8 câmeras, 120 fps)
  → sincronizar (QR GoPro Labs + palma + auto-sync)
  → calibrar (ChArUco + linhas da quadra) ............ caliscope / Pose2Sim
  → 2D: RTMW (133 pontos, inclui mãos) ............... rtmlib (Apache-2.0)
  → 3D: triangulação + filtro + cinemática ........... Pose2Sim (BSD-3)
  → esqueleto no Blender ............................. Pose2Sim_Blender (MIT)
  → limpeza (pés travados, pulos, ruído) ............. Blender (+ Cascadeur opcional)
  → bola: RF-DETR/RT-DETR + SAM 2 → triangular → arcos com gravidade entre contatos
  → marcar notifies (contato da bola, soltura, fases) ... ferramenta própria (Editor Utility)
  → FBX → IK Retargeter → esqueleto MetaHuman/Manny .. UE 5.8
```

Comparação paralela: gravar alguns takes também com o **MetaHuman Animator Markerless** (1 câmera, experimental) e comparar a qualidade com o Pose2Sim.

### 4.4 Mãos e dedos

Na distância da quadra, a mão ocupa só 30–60 px num vídeo 1080p: dedos ficam ruidosos. Plano:
1. **5–10 poses de mão autorais** (drible, pegada de arremesso, passe, receber, proteger) aplicadas por Control Rig, com IK para a bola.
2. Sessão separada de **close-up** (4–6 câmeras a 1–2 m, 4K/120 ou 240 fps) só para a mecânica de arremesso, na Fase 1+.

### 4.5 Termo de cessão (obrigatório)

Cada atleta assina um termo cobrindo **movimento, imagem e uso comercial** (inclusive em jogo vendido e em material de divulgação), com opção de anonimato (o personagem não precisa ter o rosto dele).

### 4.6 Captura própria open source — pronto para usar

Guia do diretor e ferramentas em **`Tools/Captura/README.md`** (2026-10-04). Provado de ponta a ponta aqui com o demo
de 4 câmeras do Pose2Sim: calibração → pose 2D (RTMW, 133 pontos) → sincronia → triangulação → filtro → aumento de
marcadores → OpenSim IK → **BVH no esqueleto CMU 06** → FBX do boneco no Blender (`exemplos/` tem as imagens).

- **Celulares em vez de GoPros**: 4 celulares (mínimo 2) nas diagonais, a 5–7 m, dois a ~1,2 m e dois a ~2,2 m,
  1080p a 120 fps, obturador 1/1000 s, app Blackmagic Camera. Ensaiar antes com 2.
- **Calibração**: tabuleiro A3 impresso (`gerar_tabuleiro.py`) para as lentes + 12 pontos medidos da quadra
  (garrafão, lance livre, linha de 3, tabela) clicados uma vez por sessão.
- **Sincronia pelo som**: o atleta dá um "pulo de sincronia" no começo de cada take; `sincronizar_audio.py` acha o
  instante em cada vídeo e as câmeras são alinhadas quadro a quadro (no teste, deslocamentos exatos). A sincronia
  automática do Pose2Sim pelo movimento fica como alternativa: ela erra no drible, que é periódico.
- **Um comando por take** (Windows ou Linux): `rodar_pose2sim.py <take> --calib <Calib.toml> --bvh <saida.bvh>`.
  O conversor `pose2sim_para_bvh.py` usa os ângulos do OpenSim (ossos de comprimento fixo) e orienta o punho pela
  palma (pontos da mão do RTMW). CPU funciona (~4 quadros/s em 4 núcleos); GPU NVIDIA é opcional.
- **Licenças conferidas** (tabela no guia): Pose2Sim BSD-3, rtmlib/MMPose Apache-2.0, OpenSim Apache-2.0, modelo
  Rajagopal MIT, caliscope BSD-2, ONNX Runtime MIT, OpenVINO Apache-2.0. ⚠️ Os **pesos** (Apache-2.0) foram treinados
  com bases de termos variados, inclusive não comerciais (ex.: Human-Art, no detector padrão): não usamos as bases nem
  distribuímos os pesos; risco baixo, documentado no guia com a troca possível do detector. O aumento de marcadores
  (LSTM do OpenCap, Apache-2.0) fica desligado por padrão.
- **Limitações** do conversor: retarget por direção (o pé pode deslizar alguns cm, sem trava de pé ainda), dedos só
  como flexão média (usar as poses de mão autorais da §4.4), clavícula presa ao tórax.

### 4.7 Dados gratuitos para começar antes da primeira sessão

| Fonte | Conteúdo útil |
|---|---|
| **CMU Mocap** (✅, não pode revender os dados) | `06_02–06_15`: drible para frente/trás/lado, giros, crossover, drible baixo e entre as pernas, crossover + arremesso. `124_03–06`: arremesso, lance livre, jump shot, bandeja. `102_01–33`: spin, fintas, deslizes defensivos, pivô, infiltrações. `86_14` e `15_12`: drible, bandeja, passe. 120 Hz, **sem dedos e sem bola**, qualidade antiga |
| **Game Animation Sample** (UE) | 500+ clipes de locomoção para Motion Matching (só pode ser usado na UE) |
| **100STYLE** (CC BY 4.0) | Locomoção estilizada (sem basquete) |

## 5. Referências de física e animação abertas

- **SkillMimic** (Apache-2.0, CVPR 2025): drible, arremesso e bandeja com física a partir de demonstrações humano–bola. A melhor referência aberta de contato mão–bola. O dataset tem licença incerta.
- Artigos: Okubo & Hubbard, "Dynamics of basketball–rim interactions" (2004) e sobre a dinâmica do arremesso (2006); Brancazio, "Physics of basketball" (1981); Liu & Hodgins (2018), drible com otimização de trajetória e RL.
- **Não existe** um jogo de basquete 3D realista e open-source de boa qualidade para estudar. Vamos construir o nosso.
