# 18 — Fontes de Animação: o que usar já para o Freestyle

> Pesquisa de 2026-10-04. Complementa `04-animacoes.md` (sistema) e `16-pipeline-aberto-visual-e-mocap.md` (captura própria).
> Objetivo: trocar ou complementar o mocap da CMU (amador, ~1 quique a cada 0,85 s) por animações dignas de um Freestyle "estilo 2K23".
> **Licenças mudam: conferir cada uma de novo antes de lançar.** Itens marcados *(não confirmado)* vieram de fonte secundária ou de inferência.

> **Decisão D14 (diretor, 2026-10-04): só gratuito e open source.** O pacote pago do Fab (§1, "atalho mais forte") **não** será comprado. Caminho escolhido: (1) minerar toda a CMU útil (sujeito 102: spin, finta, pump fake, drives, drible correndo; 06_13; 124_05/06 e 15_12 para arremesso/bandeja; gestos 79/141/142 para comemorações); (2) Mixamo só como opcional, se o diretor baixar (grátis); (3) captura própria com Pose2Sim + RTMPose (open source, multi-câmera com celulares), cuja saída é 100% nossa — os planos grátis de DeepMotion/Rokoko/QuickMagic não liberam uso comercial.

Legenda: ✅ uso comercial liberado · ⚠️ liberado com condições · ⛔ **INUTILIZÁVEL** (não comercial, sem derivados ou território restrito)

## 0. Resumo em 8 linhas

1. **O Mixamo quase não tem basquete**: só **1 clipe** ("Dribble"). Nada de bandeja, jump shot, enterrada ou crossover (busca no catálogo inteiro em 2026-10-04). Serve para **comemorações e gestos** (muitos, e bons).
2. **Atalho mais forte**: o pacote **"Basketball" da animo-mocap no Fab** (167 clipes, US$ 69,99 na licença Personal) cobre quase tudo o que o Freestyle pede: crossover, entre as pernas, por trás das costas, spin, step-back, pull-up, fadeaway, bandeja, 2 enterradas e 5 comemorações. Não é grátis (D7), então **é decisão do diretor**.
3. **Grátis e já no nosso pipeline**: CMU além do 06/124. O **sujeito 102 (Basketball)** tem spin, fintas, pump fake, infiltrações e pivô.
4. **Captura com os atletas do diretor**: fazer um teste comparativo de 1 semana com 3 clipes em QuickMagic, DeepMotion, Uthana e Move One. Os planos grátis geralmente **não** dão licença comercial: o processamento final é feito num mês pago.
5. **Texto→movimento** só serve para comemorações (não sabe nada da bola). Comercial só nos planos pagos (Uthana, SayMotion). Modelos abertos são ⛔.
6. **⛔ Não usar**: nada baseado em SMPL/AMASS (WHAM, GVHMR, 4D-Humans, MDM, MoMask…), LaFAN1, Bandai Namco, Motorica Dance, HY-Motion (exclui UE/Reino Unido/Coreia do Sul).
7. **Drible a 2 quiques/s**: nenhuma fonte gratuita entrega isso pronto. A solução definitiva é **capturar com metrônomo a 120 bpm**. Até lá, reamostramos só o ciclo do braço (pipeline de camadas existente).
8. O plano de 2 semanas está na seção 4.

---

## 1. Fontes prontas

### 1.1 Mixamo (Adobe) — ✅ grátis, comercial, sem redistribuir os arquivos brutos

**Licença.** Segundo o FAQ oficial, é *"available for free, with no licensing or royalty fees, for unlimited commercial or non commercial use"*. Jogos são permitidos. A única proibição é *"distribute the raw character and animation files"* (vender ou repassar os FBX brutos, inclusive como pacote para engine ou asset store). Os termos completos são os Adobe General Terms.
Fontes: [FAQ Mixamo (comunidade Adobe, post oficial)](https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400), [Adobe Terms](https://www.adobe.com/legal/terms.html). É preciso ter um **Adobe ID gratuito**.

> **Consequência prática:** os FBX brutos do Mixamo podem ficar num repositório **privado** só da equipe. Se o repositório um dia for público, eles **não** podem ir para o git (o mesmo vale para os ASF/AMC da CMU, ver `Tools/Animacao/README.md`).

**Catálogo relevante.** Levantado pela busca do próprio site (mixamo.com, API pública de busca) em 2026-10-04. Nomes exatos como aparecem no Mixamo: **Nome (descrição)**.

| Clipe no Mixamo | Uso no jogo |
|---|---|
| **Dribble** (*Dribbling Basketball With Right Arm*) | **Único clipe de basquete.** 75 quadros a 30 fps = 2,5 s, em loop, **sem** opção In Place. Postura baixa e larga. Estimei **~1,1–1,3 quique/s** pela prévia animada *(não confirmado)*: é melhor que a CMU, mas ainda longe de 2/s |
| **Defender** (*Jumping And Swatting At A Ball*) | Toco (1x1, depois) |
| **Jump** (*Jump In Place*), **Standing Jump** (*Jumping And Landing In Place*) | Referência de impulsão e aterrissagem (pernas do jump shot) |
| **Victory** (*Celebrating After A Win*) | Comemoração genérica |
| **Fist Pump** (*High Enthusiasm Fist Pump* / *Pumping A Fist*) | Green / cesta importante |
| **Cheering** (*Male Cheering With Two Fists Pump*) | Comemoração forte |
| **Excited** (*Super Excited*), **Joyful Jump** (*Ecstatic Jumping With Both Legs And Arms*) | Game-winner |
| **Taunt** (*Flexing Muscles*) | "Muque" depois de and-one/enterrada |
| **Taunt** (*Taunting Pointing At Wrist*) | Gesto de "relógio" ("é a minha hora") |
| **Shrugging** (*Shoulder Shrug*) | "Shrug" depois de sequência de cestas |
| **Hip Hop Dancing** (*Hip Hop Dancing Shimmy*) | **Shimmy** |
| **Rallying** (*Rallying The Crowd To Make Them Cheer*) | Pedir barulho da torcida |
| **Swagger Walk** (*Walking With A Swagger*) | Voltar para a defesa depois do green |
| **Clapping** (*Clap While Standing*), **Pointing Gesture**, **Happy** (*Standing Happily*) | Reações e idles |

**Não existem no Mixamo** (0 resultados): *layup, jump shot, dunk, crossover, free throw, rebound*. "Shoot", "shot" e "throw" só retornam armas, golfe, futebol e granada.

**Como baixar para o nosso esqueleto** (tarefa do diretor, porque o download exige login):
1. Entrar em mixamo.com com o Adobe ID. Manter o personagem padrão **Y Bot**: o esqueleto é igual em todos os downloads, o que facilita o retarget. Subir o nosso `SK_HoopsDummy.fbx` também funciona (personagens já riggados *"will have their skeleton automatically mapped"*), mas é mais frágil. Fonte: [Adobe: Upload and rig](https://helpx.adobe.com/creative-cloud/help/mixamo-rigging-animation.html).
2. Para cada clipe, clicar em **Download** com as configurações abaixo:

| Campo | Valor |
|---|---|
| Format | **FBX Binary (.fbx)** |
| Skin | **With Skin** só no 1º arquivo; **Without Skin** nos demais |
| Frames per Second | **60** |
| Keyframe Reduction | **none** |
| In Place | **desmarcado** (o nosso pipeline tira o deslocamento e guarda a velocidade nativa) |
| Mirror | desmarcado (espelhamos no pipeline) |
| Overdrive / Arm-Space / Trim | padrão. Arm-Space só se o braço atravessar o corpo |

3. Salvar tudo numa pasta e passar para o dev. Nomear os arquivos como `Mixamo_<Nome>_<descrição-curta>.fbx`.

**Limitações conhecidas:**
- **Sem osso root**: o `mixamorig:Hips` é a raiz. Na UE 5.6+, o *Root Motion Generator op* do IK Retargeter com **"Generate From Target Pelvis"** cria o root motion ([docs](https://dev.epicgames.com/documentation/unreal-engine/retargeting-operation-stack-in-unreal-engine), [API](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/IKRetargetRootMotionOpSettings)). A alternativa é o nosso script Blender, que já tira e guarda o deslocamento.
- **In Place** só existe em parte dos clipes e falha em alguns (relato da comunidade). O Dribble não tem.
- **Dedos**: o esqueleto padrão (*Standard Skeleton, 65 ossos*) tem os 5 dedos. Muitos clipes têm pouca animação de dedo. A pegada na bola continua vindo das nossas **poses de mão autorais** (doc 16, §4.4).
- **Retarget na UE**: o Auto Retarget da UE 5.4+ reconhece esqueletos Mixamo pelo nome dos ossos ([Auto Retargeting](https://dev.epicgames.com/documentation/en-us/unreal-engine/auto-retargeting-in-unreal-engine)).
- **Overdrive**: o efeito varia por clipe. A comunidade diz que **não** é um controle de velocidade ([thread](https://community.adobe.com/questions-696/how-does-the-overdrive-parameter-work-589184)). A velocidade se ajusta no jogo.
- Qualidade: mocap profissional antigo, um pouco "macio". Ótimo para gestos, fraco para basquete.

### 1.2 Fab (antigo Unreal Marketplace)

**Licença.** A **Fab Standard License** permite uso comercial em jogos, modificação, uso em qualquer engine e compartilhar com a equipe. É proibido revender ou redistribuir o asset avulso. Há dois níveis de preço com os mesmos direitos: **Personal** (receita bruta ≤ US$ 100 mil nos últimos 12 meses) e **Professional** (acima disso). Fontes: [Licenses and pricing in Fab](https://dev.epicgames.com/documentation/en-us/fab/licenses-and-pricing-in-fab), [Fab EULA](https://www.fab.com/eula).
**UE-only** é o conteúdo da própria Epic designado assim pela [Epic Content License](https://www.unrealengine.com/eula/content) (ex.: GASP, Paragon). Só pode ser usado com a Unreal, o que não é problema para nós.
Itens grátis por tempo limitado ficam na biblioteca **para sempre** depois de resgatados ([gamedev.net, resumo mensal](https://gamedev.net/news/5586-september-free-gamedev-assets-round-up/)). Vale o diretor resgatar todo mês.

**Busca no Fab (API do site, 2026-10-04): não há pacote de basquete 100% grátis.** Os relevantes:

| Pacote (vendedor) | Preço Personal / Pro | Conteúdo | Observações |
|---|---|---|---|
| [**Basketball** (animo-mocap)](https://www.fab.com/listings/b13b7b06-8c0f-435e-88df-0b616c15e468) | **US$ 69,99** / 99,99 | **167 clipes**: idles e stances, jog/run com bola nas 2 mãos, triple threat, **crossover** (parado e em jogo, 2 lados), **double crossover**, **between the legs**, **behind the back**, **spin move**, euro step, jab/hop/pump fakes, half spin, jump stop, **step back**, pull back, side step, **jump shot**, **pull-up jump shot**, **fade away**, turnaround, catch-and-shoot, floater, finger roll, hook, **layup** D/E, tip-in, **2 enterradas**, passes, recepções, pivôs, defesa, roubo, toco, box-out, **5 celebrations**, cansaço, raiva | ✅ Standard. UE + FBX + Unity. Nota 4,0 (3 avaliações). **Sem animação de dedos** (o anúncio avisa). Prévia: [rápida](https://youtu.be/AoApIbi6ijM), [completa](https://youtu.be/pB-x0Z_Y9lk). Não há clipe chamado "hesitation": usar jab fake / pull back ou capturar. Ritmo de drible a conferir na prévia *(não confirmado)* |
| [**Dunk** (animo-mocap)](https://www.fab.com/listings/7285f23d-d42c-4217-b3fc-695edf6f75fa) | US$ 29,99 / 39,99 | 20 enterradas (one-hand, two-hand, tomahawk, reverse, windmill, 360, alley-oop, east bay…) | ✅ Standard. UE 4.27–5.6. O anúncio diz *"not performed by professionals"* |
| [**Basketball Animation Pack** (Ailive)](https://www.fab.com/listings/e3010509-8edd-4e24-9578-0e694cb4bb03) | US$ 3,99 / 7,99 | 5: bloqueio, drible parado (2), finta de arremesso, lance livre | ✅ Standard. **Com dedos**, esqueleto Manny, FBX |
| [**Basketball Anim Pack** (Jane Gintsar)](https://www.fab.com/listings/fb26bb7e-5362-499b-b07b-eb6efdbf67b1) | US$ 4,99 / 9,99 | 21: drible, arremesso, passe, roubo, defesa, árbitro, torcida | ✅ Standard. Qualidade *(não confirmada)*; parece keyframe/estilizado |
| [**Basketball Emotes Mocap** (Araz Creates)](https://www.fab.com/listings/f9420530-a6ae-4d3f-b051-d3c8aa9c5ba3) | US$ 26,99 / 80,99 | 3 emotes, 60 fps | ⚠️ Um deles se chama "LeBron James Emote": **não** usar nome de atleta real no jogo |
| [**Motifect Sports & Athletics**](https://www.fab.com/listings/374ce372-8c4c-4d2f-86c5-d5893769bfc7) | **Grátis** | 40 clipes de esporte (sprint, saltos, arremessar, pegar…) | ✅ *"Free for personal and commercial use in Unreal projects"*. A Motifect é um **gerador de movimento por IA**: qualidade *(não confirmada)*, 30 fps |
| [**Motifect Emotes & Social**](https://www.fab.com/listings/9b07a055-d31d-41fc-96f6-c86f4aed7ae2) | **Grátis** | 30: cheering, clapping, pointing, victory… | Mesmas condições acima |
| [**MoCap Online Free Animation Pack**](https://www.fab.com/listings/64c53af0-dcb7-4483-9d65-5cbc84bd9a93) | **Grátis** | Idles e locomoção de amostra | ✅ Standard. Sem basquete |

### 1.3 Game Animation Sample (GASP, Epic) — ⚠️ comercial, **só na Unreal**

- 500+ animações de locomoção e travessia para **Motion Matching** (UE 5.4). A atualização da 5.7 trouxe o personagem com Mover e **+400 animações**, com um novo dataset de locomoção mais equilibrado entre resposta e qualidade. Fontes: [blog Epic](https://www.unrealengine.com/en-US/blog/game-animation-sample), [CG Channel](https://www.cgchannel.com/2024/06/get-500-free-game-ready-animations-for-use-in-unreal-engine), [GASP 5.7](https://www.unrealengine.com/tech-blog/explore-the-updates-to-the-game-animation-sample-project-in-ue-5-7).
- Licença: conteúdo **UE-only**, *"can be used in commercial projects"*, retarget livre para os nossos personagens.
- **Não tem bola nem basquete.** Serve para a **locomoção sem bola** e como **base de pernas** para a camada de drible (o mesmo esquema do `Dribble_Run` atual), além de paradas e giros naturais.

### 1.4 CMU além dos sujeitos 06/124 — ✅ (*"You may include this data in commercially-sold products, but you may not resell this data directly, even in converted form"*)

Fonte: [mocap.cs.cmu.edu](http://mocap.cs.cmu.edu/) (busca por sujeito: `search.php?subjectnumber=102`). São 120 Hz, **sem dedos e sem bola registrada**. As conversões FBX do 4TU/Hugging Face são CC BY-NC (doc 16): converter nós mesmos.

| Trial | Descrição oficial | Uso para nós |
|---|---|---|
| **102_11, 102_12 / 102_15** | OffensiveMoveSpinLeft / SpinRight | **Spin move** |
| **102_18 / 102_19** | FeintLeftMoveRight / FeintRightMoveLeft | **Hesitação / finta + crossover** |
| **102_20 / 102_21** | FakeShotBreakRight / Left | Pump fake + infiltração |
| 102_13 / 102_14 | OffensiveMoveGoRight / GoLeft | Primeiro passo |
| 102_30, 102_31, 102_32 | Drive from stop; RightDrive; LeftDrive | Infiltração para a bandeja |
| 102_01–08, 102_33 | Curvas abertas e fechadas, corrida reta | **Drible em movimento** com curvas |
| 102_29 | Pivoting | Pivô (triple threat) |
| 102_22–28 | Deslizes defensivos | 1x1 (depois) |
| 102_10 | RunningNoBall | Indica que os outros trials do 102 são com bola *(não confirmado)* |
| **06_13** | Low, fast free style dribble, **dribble through legs** | Drible baixo e rápido, **entre as pernas** |
| 06_12, 06_14 | Crossover; crossover + shoot | Crossover (já em uso) |
| **124_05 / 124_06** | Basketball Jump Shot / Lay Up | Jump shot, **bandeja** |
| 124_03, 124_04, 124_11 | Shoot; Free Throw; 2 Foot Jump | Lance livre; impulsão com 2 pés (enterrada/rebote) |
| 86_14 | Bouncing, shooting, dribble, two-handed dribble | Variações |
| 15_12 | (take longo) dribble, **lay-up**, pass | Segunda bandeja (recortar) |
| **141_21** / 141_22 / 141_24 / 141_28 | Shrug / High Five / Around the world high five low / Slap hands | Comemorações (o shrug já está em uso) |
| **79_94** / 79_69 / 80_43 | Flexing / Very happy / Happy | Comemorações (o flexing já está em uso) |
| 142_06 / 142_09 / 142_20 | Elated / Joy / Singing in the rain jump (andares estilizados) | Voltar comemorando |
| 26_02, 27_02 … 41_11 | "Basketball signals" | Sinais de árbitro (não serve para o jogador) |

### 1.5 Outros datasets de mocap

| Dataset | Licença | Status |
|---|---|---|
| **100STYLE** | CC BY 4.0 ([Zenodo](https://zenodo.org/records/8127870)) | ✅ com crédito. Locomoção em 100 estilos (cansado, orgulhoso…), sem basquete |
| **Rokoko Motion Library** (150 grátis) + **12 free sports animations** + pacote de 263 assets | Grátis, *"including for commercial use"*, **com dedos** ([sports](https://www.rokoko.com/resources/rokoko-mocap-12-free-sports-animations), [CG Channel](https://www.cgchannel.com/2020/03/get-150-free-mocap-moves-from-rokokos-motion-library)) | ✅. Não sei se os 12 de esporte incluem basquete *(não confirmado)*: o diretor baixa (exige cadastro) e confere |
| **LaFAN1** (Ubisoft) | CC BY-NC-ND 4.0 ([GitHub](https://github.com/ubisoft/ubisoft-laforge-animation-dataset)) | ⛔ **INUTILIZÁVEL** |
| **Bandai Namco Research Motiondataset 1 e 2** | CC BY-NC 4.0 no README atual (antes NC-ND) ([GitHub](https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset)) | ⛔ **INUTILIZÁVEL** |
| **AMASS** e derivados (HumanML3D, Motion-X, BABEL…) | Pesquisa não comercial ([licença](https://amass.is.tue.mpg.de/license.html)) | ⛔ **INUTILIZÁVEL** |
| **SMPL / SMPL-H / SMPL-X** (modelo de corpo) | Proíbe *"production of other artefacts for commercial purposes"* ([licença](https://smpl.is.tue.mpg.de/modellicense.html)); licença comercial vendida pela Meshcapade | ⛔ (contamina tudo o que gera SMPL) |
| **Motorica Dance Dataset** | *"Use for commercial purposes is not permitted"* ([GitHub](https://github.com/simonalexanderson/MotoricaDanceDataset)) | ⛔ **INUTILIZÁVEL** |
| SkillMimic (BallPlay) | Incerta (doc 16) | ⚠️ só como referência técnica |

---

## 2. Mocap a partir de vídeo de celular (atletas do diretor)

### 2.1 Comparação (preços e termos de 2026-10)

| Ferramenta | Câmeras | Grátis | Pago (entrada) | Dedos | Saída | Licença do resultado | Movimento rápido (relatos) |
|---|---|---|---|---|---|---|---|
| **DeepMotion Animate 3D** ([preços](https://www.deepmotion.com/pricing-animate3d)) | 1 (multi-pessoa) | 25 créditos/mês (1 crédito = 1 s), clipe ≤ 20 s, **máx. 30 fps** | Starter US$ 9/mês (anual, 180 cr.); Innovator US$ 17 (**60 fps**); Professional US$ 39 (**120 fps**) | ✅ (corpo + rosto + mão) | FBX, BVH, GLB | Comercial **só no pago**; grátis = não comercial ([fonte secundária](https://toolradar.com/tools/deepmotion/pricing), *não confirmado*) | Tremidas e pé deslizando ([tato.studio, 08/2025](https://tato.studio/blog/best-ai-video-to-mocap)) |
| **Rokoko Vision 3.0** ([produto](https://www.rokoko.com/products/vision), [preços](https://www.rokoko.com/pricing)) | **1** (o modo de 2 câmeras **foi removido** na 3.0) | 30 s/mês | Basic US$ 10/mês (600 s, BVH); Plus US$ 20 (3.000 s) | ⛔ (*"Not at launch"*) | FBX (BVH no pago) | Comercial no grátis *(não confirmado)* | Versões antigas "tremidas"; a 3.0 promete melhora |
| **Move One / Move Pro** ([preços Move One](https://docs.move.ai/knowledge/move-one-pricing)) | Move One: **só iPhone**, 1 câmera; Move Pro: até 12 câmeras, 120 fps *(não confirmado)* | 30 créditos **uma vez** (Gen 2 = 2 créditos/s, ou seja, ~15 s) | Starter US$ 18/mês (60 cr. = 30 s em Gen 2); Standard US$ 48 (180 cr.); Move Pro: teste de 30 dias ~US$ 995 *(não confirmado)* | Mãos/dedos no Pro; no One *(não confirmado)* | FBX, USD | Grátis = "view only" ([fonte secundária](https://us.fitgap.com/products/move-ai), *não confirmado*) | Boa com poses difíceis (mãos e joelhos no chão), um pouco de deslize |
| **Plask Motion** ([preços](https://plask.ai/pricing)) | 1 (multi-pessoa) | **15 s/dia** | US$ 18/mês (10 min); US$ 50 (1 h) | ✅ "Full Body & Hand" | FBX, GLB, BVH | *(não confirmado)*: ler os termos | Tremidas e deslize relatados |
| **Radical** | — | — | — | — | — | — | ⛔ **Encerrado**: o portal fechou em 6 jul 2026 e a Autodesk comprou a tecnologia para o Flow Studio ([CG Channel](https://www.cgchannel.com/?p=175200)) |
| **QuickMagic** ([site](https://www.quickmagic.ai/)) | 1 vídeo (multi-pessoa; câmera parada ou em movimento) | Plano grátis (limites na página de preços) | ~US$ 9,90/mês (~150 s, *não confirmado*) | ✅ corpo + mão + rosto | FBX, BVH, presets UE5.5/5.6, Mixamo… | *"Commercial-use rights depend on the plan"*: ler o User Agreement | **A mais suave nas comparações**, dedos funcionam, algum deslize em poses complexas |
| **Uthana Video-to-motion** ([preços](https://uthana.com/pricing)) | 1 | — | **Pré-pago, US$ 0,05/s**, sem assinatura | *(não confirmado)* | FBX, GLB | ✅ *"Paid usage includes commercial use of generated outputs"* | Sem relato independente para esporte |
| **Pose2Sim + RTMPose/RTMW** ([Pose2Sim](https://github.com/perfanalytics/pose2sim) BSD-3, [rtmlib](https://github.com/Tau-J/rtmlib) Apache-2.0) | **2+ (ideal 4–8)** sincronizadas e calibradas | Grátis (roda no PC) | — | RTMW tem 133 pontos com mãos, mas fica ruidoso a distância | TRC/MOT → BVH/FBX via Blender | ✅ **o resultado é 100% nosso** | Depende da calibração e do fps (ver doc 16) |
| **WHAM** (código MIT), **4D-Humans** (código MIT), **GVHMR** (código não comercial) | 1 | Grátis | — | ⛔ | Parâmetros **SMPL** | ⛔ **INUTILIZÁVEL**: saída SMPL + treino em AMASS ([licença SMPL](https://smpl.is.tue.mpg.de/modellicense.html), [GVHMR LICENSE](https://github.com/zju3dv/GVHMR)) | Os melhores da pesquisa monocular, mas proibidos para nós |

**O que pesa no basquete:**
- **A bola não é capturada** por nenhuma dessas ferramentas. Isso é ótimo para nós: o atleta usa bola de verdade (o movimento fica natural) e a bola é gerada na engine, sincronizada com os notifies de contato da mão (como já fazemos).
- **Mão rápida** precisa de vídeo a **60–120 fps** e processamento no mesmo fps. O DeepMotion limita o grátis e o Starter a 30 fps, o que é pouco para o "empurrão" do drible.
- **Saltos** com 1 câmera costumam errar a altura e deslizar o pé. Corrigimos no pipeline (travar o pé no chão, escalar a altura do pulo).
- **Dedos** na bola: mesmo com "hand tracking", o resultado é instável. Mantemos as **poses de mão autorais** (doc 16, §4.4) por cima.

### 2.2 Caminho recomendado para o diretor (celulares + atletas reais)

**Fase A: teste comparativo com 1 celular (semana 1, ~1–2 h de gravação).**

1. **Termo de cessão** de imagem e movimento assinado antes de gravar (doc 16, §4.5).
2. **Câmera**: celular **deitado (paisagem)** num tripé a **1,0–1,2 m** de altura, a **5–7 m** do atleta, enquadrando o **corpo inteiro com ~1 m de folga acima da cabeça** (para o pulo). Câmera **parada, sem zoom**. Ângulos:
   - drible e dribles de movimento: **3/4 de frente** (30–45° fora da frente do atleta), para as duas mãos aparecerem;
   - jump shot e bandeja: **45° de lado**, para a extensão do braço e a impulsão aparecerem.
3. **Configuração**: **60 fps** (120 fps se houver muita luz, como de dia ao ar livre), 1080p ou 4K, foco e exposição **travados**, estabilização **desligada**. Se possível, obturador 1/500 s ou mais rápido (o app gratuito **Blackmagic Camera** permite ajuste manual).
4. **Roupa**: **justa** (bermuda de compressão ou legging, ou short acima do joelho; camiseta justa de manga curta). **Nada de regata e bermuda largas de basquete**, que escondem joelhos e quadril. Cor que **contraste** com o piso e a parede. Tênis de cor diferente da calça.
5. **Quadra e fundo**: luz uniforme, **sem contraluz** (janela atrás do atleta), **ninguém mais no quadro**. Marcar com fita a posição do atleta e a do tripé (para repetir).
6. **Protocolo de cada take**: 2 s parado em **pose A**, depois uma **palma** (sincronia), depois o movimento, depois 2 s parado. **Um movimento por take**, de **10–20 s** (os limites das ferramentas são de 15–30 s). **5–10 repetições** de cada lado ou mão.
7. **Ritmo do drible**: **metrônomo a 120 bpm = 2 quiques/s** (caixinha de som ou fone). Para o drible baixo e rápido, 150–180 bpm.
8. **3 clipes de teste**: (a) drible parado mão direita a 120 bpm, (b) crossover D→E, (c) jump shot parado. O diretor sobe os vídeos numa pasta compartilhada.
9. O dev processa os **mesmos 3 clipes** no QuickMagic (grátis), DeepMotion (grátis), Uthana (~US$ 2) e Move One (grátis, se houver iPhone). Compara na UE com métricas objetivas: quiques/s pelo nosso detector, deslize do pé, altura do pulo, mão no topo na soltura, ruído. Entrega um relatório com vídeo lado a lado.
10. O diretor **assina 1 mês** da vencedora (licença comercial) e o dev **reprocessa** os takes finais no plano pago. Não usar no jogo nada gerado no plano grátis.

**Fase B (depois, se a nuvem não bastar):** **Pose2Sim com 4–8 celulares** (receita completa no doc 16: sincronismo, calibração ChArUco, 120 fps, obturador 1/1000 s). É o caminho de maior qualidade potencial e risco legal zero, mas dá mais trabalho.

---

## 3. IA texto→movimento

**Uso para nós:** só para **comemorações, gestos e reações** (sem bola). A IA não sabe o timing mão–bola, então drible e arremesso gerados por texto ficam ruins.

| Ferramenta | Comercial? | Notas |
|---|---|---|
| **Uthana** ([preços](https://uthana.com/pricing)) | ✅ no uso pago | Texto→movimento de US$ 0,02 a 0,10/s, sem assinatura (assinaturas encerradas em ago/2026), FBX/GLB, retarget automático |
| **DeepMotion SayMotion** ([preços](https://www.deepmotion.com/pricing-saymotion)) | ✅ nos planos pagos (linha "Commercial License") | Grátis: 3 créditos/mês. Pago a partir de US$ 9/mês (anual). FBX/GLB/BVH ([CG Channel](https://www.cgchannel.com/?p=156294)) |
| **QuickMagic** (texto) | ⚠️ depende do plano | Mesmo User Agreement da captura por vídeo |
| **Rokoko** (Text & Video-to-Motion) | ⚠️ *(não confirmado)* | Incluído nos planos do Rokoko Studio |
| **Autodesk MotionMaker** (Maya 2026+) | ✅ com licença do Maya | Só **locomoção** ao longo de um caminho; treinado em mocap da própria Autodesk ([blog](https://blogs.autodesk.com/media-and-entertainment/2025/06/04/meet-motionmaker/)) |
| **Motorica MoGen** | ⚠️ termos *(não confirmados)*, voltado a estúdios | Plugin para UE ([80.lv](https://80.lv/articles/a-new-tool-for-ai-generated-character-animation-enters-open-beta/)) |
| **Cascadeur** | Plano grátis **não** comercial; Indie pago é comercial (doc 16) | Não é texto: IA de pose e física para **limpar e polir** clipes |
| **Planos grátis** (Uthana antigo, DeepMotion, Move…) | ⛔ geralmente não comercial | Só para teste |
| **MDM, MotionGPT, T2M-GPT, MoMask, MotionDiffuse** e similares | ⛔ **INUTILIZÁVEL** | Treinados em HumanML3D/AMASS + SMPL (não comercial) |
| **HY-Motion 1.0** (Tencent) | ⛔ **INUTILIZÁVEL** para nós | A licença **não vale na UE, Reino Unido e Coreia do Sul** e proíbe usar ou **exibir o resultado** fora desse território ([LICENSE](https://huggingface.co/tencent/HY-Motion-1.0/blob/main/LICENSE.txt)). Um jogo na Steam é global. Também usa base SMPL-H |

> Cuidado com comemorações "assinatura" de atletas reais: o gesto genérico é livre, mas **não** usamos o nome do atleta nem marcas associadas (ver `00-visao-geral.md`, §4).

---

## 4. Recomendação: plano das próximas 2 semanas

### 4.1 Ranking das opções

| # | Opção | Qualidade | Esforço | Segurança legal | Custo | Cobre |
|---|---|---|---|---|---|---|
| 1 | **Fab "Basketball" (animo-mocap)** + "Dunk" opcional | Alta (mocap profissional) *(conferir prévia)* | **Baixo** (retarget) | ✅ Standard License | **US$ 69,99** (+29,99) | Quase tudo: dribles, arremessos, bandeja, enterrada, 5 comemorações (sem dedos) |
| 2 | **Captura dos atletas do diretor** (nuvem, Fase A) | Média-alta, **exclusiva** e no ritmo certo (metrônomo) | Médio | ✅ no plano pago | US$ 10–50 (1 mês) | Tudo, inclusive comemorações próprias |
| 3 | **Mixamo** (comemorações + drible base) | Média (gestos ótimos) | **Muito baixo** | ✅ (sem redistribuir) | Grátis | Comemorações, shrug, shimmy, relógio |
| 4 | **CMU 102 / 06_13 / 124** | Baixa-média (amador) | **Muito baixo** (o pipeline existe) | ✅ | Grátis | Spin, finta, bandeja, entre as pernas |
| 5 | **Texto→movimento (Uthana)** | Média | Baixo | ✅ no pago | ~US$ 1–5 | Gestos que faltarem ("too small", "three goggles") |
| 6 | **Pose2Sim multicâmera** | Alta potencial | Alto | ✅✅ | Grátis (+ equipamento) | Fase 1+ (doc 16) |

> **Decisão pendente do diretor:** comprar o pacote do item 1. Ele foge do "só gratuito" de D7, mas economiza semanas, tem licença limpa e serve de **referência de qualidade** para a captura própria. Se a resposta for não, o plano segue com 2+3+4+5 e o drible fica no nível da CMU/Mixamo até a captura.

### 4.2 Quem faz o quê

| Diretor (precisa de conta, compra ou atleta) | Dev (IA, sozinho) |
|---|---|
| Criar o **Adobe ID** grátis e baixar os clipes do Mixamo da §1.1 com as configurações da tabela | Processar CMU 102/06_13/124/141/79 no pipeline existente (`Tools/Animacao`) |
| Decidir e **comprar o pacote do Fab** (opcional) e adicionar à biblioteca; mandar o arquivo ao dev | Script de importação Mixamo/Fab → esqueleto HoopsDummy (Blender) e/ou IK Retargeter na UE; root motion pela pelve |
| Baixar o pacote grátis de esporte da **Rokoko** (exige cadastro) e conferir se tem basquete | Reamostrar o ciclo do braço do drible para ~2 quiques/s nas camadas (provisório) |
| Gravar os **3 clipes de teste** (§2.2) e depois a **sessão completa** | Teste comparativo QuickMagic × DeepMotion × Uthana × Move One; relatório com métricas |
| **Termo de cessão** dos atletas; assinar 1 mês da ferramenta vencedora | Notifies (contato, soltura), janela green, poses de mão, espelhamento, integração no Freestyle |
| Aprovar no playtest qual versão de cada animação fica | Gerar por texto os gestos que faltarem (com o crédito pago pelo diretor) |

### 4.3 Cronograma

**Semana 1**
- **Dia 1 (diretor, ~40 min):** Adobe ID + download de 14 clipes do Mixamo: *Dribble; Defender (Jumping And Swatting At A Ball); Jump (Jump In Place); Victory (Celebrating After A Win); Fist Pump (High Enthusiasm Fist Pump); Cheering (Male Cheering With Two Fists Pump); Excited (Super Excited); Joyful Jump; Taunt (Flexing Muscles); Taunt (Taunting Pointing At Wrist); Shrugging (Shoulder Shrug); Hip Hop Dancing (Hip Hop Dancing Shimmy); Rallying; Swagger Walk*. Assistir às prévias do pacote Fab e decidir.
- **Dias 1–2 (dev):** CMU 102_11/12/15 (spin), 102_18/19 (hesitação), 102_20/21 (pump fake), 06_13 (entre as pernas), 124_05 (jump shot), 124_06 + 15_12 (bandejas) → novos clipes no `SK_HoopsDummy`, com o ritmo medido.
- **Dias 2–3 (dev):** importar o Mixamo (retarget, espelho, no lugar). Primeiras **3 comemorações green** jogáveis: **(1) segurar o follow-through** (pose final do jump shot congelada ~1,5 s + respiração, feita pelo dev sem fonte externa), **(2) shimmy** (Mixamo), **(3) "relógio" ou muque** (Mixamo).
- **Dias 3–5 (dev, se o pacote for comprado):** retarget do pacote Fab; trocar no Freestyle: idle dribble (*Basic_Stance*), drible andando e correndo (*Jog/Run_RH/LH*), **crossover, between the legs, behind the back, spin**, hesitação (*Jab_Fake/Pull_Back*), **step back**, **jump shot, pull-up, fadeaway**, **layup** D/E, enterrada. Remarcar notifies e o topo do arremesso no centro da janela green.
- **Fim de semana (diretor, 1–2 h):** gravar os 3 clipes de teste com um atleta (§2.2).

**Semana 2**
- **Dias 6–7 (dev):** teste comparativo das 4 ferramentas → relatório e recomendação.
- **Dia 8 (diretor):** assinar 1 mês da vencedora.
- **Dias 8–9 (diretor, sessão de ~2 h):** 25 takes. Drible parado D/E a 120 bpm; drible baixo a 160 bpm; crossover, entre as pernas, por trás das costas, hesitação, step-back, spin (os dois lados); jump shot parado, pull-up, step-back jumper, fadeaway; bandeja D/E; 4 comemorações (follow-through segurado, **"three goggles"**, shimmy, **"too small"**).
- **Dias 9–12 (dev):** processar, limpar (pé travado, altura do pulo, suavização) e integrar. A/B no Freestyle: captura própria × Fab × CMU por slot.
- **Dias 13–14 (diretor + dev):** playtest, escolha final por animação e registro em `15-brief-e-decisoes.md`.

**Critério de pronto (fim da semana 2):** idle dribble ≥ 1,8 quique/s sem pé deslizando; 4 dribles (crossover, entre as pernas, por trás, spin) encadeáveis com janela de cancelamento; jump shot e bandeja com notifies corretos; 3 comemorações green. Tudo com licença registrada numa planilha de assets (origem, licença, data, URL).
