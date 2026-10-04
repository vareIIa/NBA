# Como rodar o Freestyle no seu PC (Unreal Engine 5.8)

> O núcleo de simulação foi compilado e testado na nuvem (28 testes passando).
> A parte da Unreal **ainda não foi compilada** (a nuvem não tem a engine). Na primeira compilação podem aparecer erros pequenos: copie o log do **Output** do Visual Studio (ou a janela de erro da Unreal) e me mande. Eu corrijo.

## 1. Pré-requisitos (uma vez só)

1. **Unreal Engine 5.8** pelo Epic Games Launcher.
2. **Visual Studio 2022** com as cargas de trabalho:
   - "Desenvolvimento de jogos com C++" (inclui o suporte à Unreal Engine)
   - "Desenvolvimento para desktop com C++"
   - Windows 10/11 SDK (vem junto)
3. **Git** e **Git LFS** (`git lfs install`).
4. Controle de **Xbox** (ou PS5 via Steam Input / DS4Windows) conectado.

## 2. Baixar o projeto

```bash
git clone https://github.com/vareIIa/NBA.git
cd NBA
git checkout claude/hopeful-einstein-eargc1
git lfs pull          # baixa os vídeos de referência
```

## 3. Compilar e abrir

1. Clique com o botão direito em **`Garrafao.uproject`** → **Generate Visual Studio project files**.
2. Dê dois cliques em `Garrafao.uproject`. A Unreal vai perguntar *"The following modules are missing or built with a different engine version... Would you like to rebuild them now?"* → **Sim**. (Ou abra `Garrafao.sln` no Visual Studio, escolha **Development Editor / Win64** e compile o projeto `Garrafao`.)
3. Com o editor aberto: **File → New Level → Empty Level**. (Se usar um nível com luz própria, a quadra não cria uma segunda iluminação.)
4. Aperte **Play** (Alt+P). O modo **Freestyle** cria sozinho a quadra, a cesta, a bola e a iluminação.

### Quadra realista (opcional, recomendado)

A quadra já abre com **iluminação de ginásio à noite** (6 refletores, sem sol). Para o **piso de madeira envernizado**:
1. **Tools → Execute Python Script…** → escolha `Tools/Editor/setup_quadra_realista.py`.
2. O script baixa texturas **CC0 do Poly Haven** (licença livre, uso comercial ok), cria `M_HoopsWoodFloor` e `M_HoopsSolid` em `/Game/Hoops/Materials` e salva.
3. Aperte **Play**: o piso e as peças passam a usar os materiais novos automaticamente.

Para trocar para quadra ao ar livre (sol + céu): selecione o ator **HoopsCourt** durante o Play e mude `Lighting` para `Outdoor`, ou coloque um HoopsCourt no nível com essa opção.

### Jogador animado (recomendado)

O jogador **dribla de verdade** (mocap) assim que o boneco é importado — e isso agora é **automático**:
1. Depois do `git pull`, rode `git lfs pull` (o `Art/Characters/HoopsDummy/SK_HoopsDummy.fbx` tem ~8 MB; sem isso vem só um "ponteiro" de 130 bytes).
2. Abra o editor. Ao terminar de carregar, ele importa sozinho a malha, o esqueleto e as **25 animações** em `/Game/Hoops/Characters/Dummy` (Output Log: `[Garrafao] Pronto!`). Só reimporta quando o FBX muda.
3. Aperte **Play**. No topo da tela aparece `Garrafao Freestyle v0.5 | Boneco animado: ATIVO (25/25 clipes)`. Se aparecer em amarelo "NAO IMPORTADO", rode **Tools → Execute Python Script…** → `Tools/Editor/importar_personagem.py` e me mande o Output Log.
   (Último recurso: arraste o FBX para `/Game/Hoops/Characters/Dummy` no Content Browser com *Import Animations* ligado.)

O boneco é um "manequim de teste" (partes rígidas, cores de pele/uniforme/tênis) com mocap da CMU: drible parado, andando, correndo, de costas e de lado (as duas mãos), andar e correr sem bola e o arremesso saindo do drible. A **bola segue a mão animada** (sai no fim do empurrão e volta para a mão no topo) e no arremesso a **mão chega ao topo exatamente no centro da janela green**.

Ajustes no painel Details do jogador durante o Play (categoria *Hoops*): `BodyHeightCm` (altura), `MeshYawAdjust` (se ele aparecer de lado/de costas), `DribbleIdlePlayRate` (velocidade do drible parado), `DribbleBallOffset`/`ShotBallOffset` (onde a bola fica na mão), cores.

**Postura atlética**: com a bola o jogador fica **mais baixo** (quadril desce, joelhos dobram por IK e os pés ficam plantados) e **inclina o corpo** nas acelerações e cortes. Ajustes: `DribbleCrouchCm` (0 desliga) e `bBodyLean`. O quique da bola agora é calculado **preso ao corpo** (como a mão): frear, virar ou levar o impulso de um drible não faz mais a bola "fugir".

**Drible no ritmo do 2K23**: o braço do drible parado/andando/correndo agora faz ~2,1–2,5 quiques/s (o mocap original fazia ~1–1,5; ver `docs/17-park-green-e-feel.md` §4.1).

**Green (estilo 2K Park)** — sequência de ~2,5 s, medida nos seus vídeos do 2K23 (`docs/17`):
- **Medidor do 2K23**: enche até o topo no ponto ideal e, se você segurar além, volta a descer. Depois da soltura fica ~1 s congelado onde você soltou, na cor do resultado; no green pisca em verde.
- **"GREEN!"** sobe ao lado do jogador + um **"ding"** (sintetizado) + banner de timing/cobertura no canto.
- O jogador **segura o follow-through** (~1,1 s no green, ~0,45 s nos outros) enquanto as pernas aterrissam.
- Se cair: **celebração automática** (flex / shrug, alternando) e o rebotedor espera um pouco mais para devolver a bola.
- **D-pad nos ~2,5 s depois da cesta** (sem a bola na mão): **cima = flex**, **direita = shrug**, **esquerda = segura a pose do arremesso**. Fora dessa janela o D-pad faz o de sempre.
- Ajustes em *Hoops|Green*: `GreenHoldSeconds`, `bAutoCelebrate`, `GreenSoundVolume`, `bGreenFeedbackAtRim` (ligado = o "GREEN!"/som/banner só aparecem quando a bola chega ao aro, como no 2K23; desligado = na hora, como o "Simple" do 2K25).

Dribles com mocap próprio (CMU 102, atlético e baixo): **crossover de ataque/escape** (RT + cima, ou qualquer troca de mão já correndo: planta, cruza e sai acelerando), **spin/half-spin** (o corpo gira pela curva medida no mocap) e **hesitação / in-and-out** (finta baixa e arranque); crossover parado, entre as pernas e por trás usam o crossover do 06_14; step-back, retreat e double cross ainda sem clipe (`Art/Characters/HoopsDummy/preview_moves.png`).

**Som da quadra** (tudo sintetizado em código, sem arquivos de áudio): **quique** da bola no taco em cada toque no chão (drible e bola solta, mais forte quanto mais rápido o impacto), **rede** na cesta (abafada se a bola tocou o aro antes), **aro**, **tabela**, **chiado do tênis** no gather, nos cortes do drible e na aterrissagem, e o "ding" do green. Cada som tem 2–4 variações sorteadas, com um pouco de variação de pitch e volume. Ajustes no jogador durante o Play em *Hoops|Audio → AudioMix*: `bMute`, `MasterVolume`, volume por categoria (`BallVolume`, `NetVolume`, `RimVolume`, `ShoesVolume`) e `DistanceFalloff`. Para ouvir sem a Unreal (Linux/Mac/WSL): `g++ -O2 -std=c++17 -I Source/Garrafao Tools/Audio/ouvir_sons.cpp Source/Garrafao/HoopsAudioSynth.cpp -o ouvir_sons && ./ouvir_sons` gera os WAVs em `/tmp/garrafao-sons`, incluindo `sequencia_park.wav` (uma posse inteira: drible, gather, ding, rede, aro).

### Manequim da Epic (alternativa)

Se o boneco não estiver importado, o jogo usa o **Manny** do pacote Third Person, se existir:
**Content Browser → Add → Add Feature or Content Pack → Third Person → Add to Project**.

## 4. Controles (iguais ao 2K23, Xbox)

| Botão | Ação no Freestyle |
|---|---|
| **LS** | Mover. Com a bola, como no 2K23: parado ou com o analógico só um pouco = **size-up encarando a cesta**; andando para o lado ou para a frente o jogador **vira o corpo** para onde vai (drible lateral de perfil); **recuando** (retreat dribble) continua encarando a cesta |
| **X** segurar → soltar | Arremesso (solte no topo do medidor = **GREEN**). Toque rápido = pump fake |
| **RS** toque cima / esquerda / baixo-esquerda / direita / baixo | Crossover / entre as pernas / por trás / hesitação / step-back |
| **RS** giro / ¼ de giro | Spin / half-spin |
| **RS** mesma direção 2× / direção + oposta | Double cross / hesi-cross |
| **RS** segurar baixo → soltar | Arremesso pelo Pro Stick |
| **RT** segurar | Sprint (gasta **energia**; com RT, os dribles viram escapes). A barra de energia fica embaixo dos pés e no canto: abaixo de 40% o jogador fica mais lento e o arremesso piora |
| **RT + X** ou **RT + RS cima** perto da cesta | Enterrada |
| **X** ou **RS cima** infiltrando | Bandeja |
| **LT** | Proteger a bola (drible mais baixo); segurando, o jogador fica encarando a cesta mesmo com o analógico todo |
| **D-pad cima** | Pedir a bola de volta |
| **D-pad baixo** | Resetar no spot atual |
| **D-pad esquerda/direita** | Trocar de spot (topo, alas, cantos, cotovelos, lance livre, logo) |
| **View** | Liga/desliga o **laboratório** (histórico de inputs, janelas, chance, física, linha de contestação) |
| **Menu** | **Defensor manequim**: sem defensor → parado (mãos baixas) → mãos para cima → contesta (pula) → marca e contesta |
| **L3** (clicar o analógico esquerdo) | **Câmera lenta** 100% → 50% → 25% (o timing estica junto: é para analisar, não para treinar green) |

Teclado (provisório; o teclado é sempre "analógico todo", então use Ctrl para o size-up): WASD mover · setas = Pro Stick · Espaço = X · Shift = RT · Ctrl = LT · G = pedir bola · Backspace = reset · 1/2 = spots · Tab = laboratório · M = defensor · T = câmera lenta.

## 5. O que testar e me contar

1. **Green**: o medidor branco sobe; solte quando passar pela faixa **verde** (na altura da marca branca). Green livre **sempre** entra.
2. **Drible**: encadeie crossover → por trás → step-back → arremesso. Inputs no **fim** de cada drible contam como **ritmo** (mais rápido, combo sobe).
3. **Pull-up**: corra lateralmente com a bola e aperte X. O arremesso vira *Pull-up* (janela um pouco menor) e mantém parte do embalo.
4. **Laboratório** (View): veja quanto você segurou, o offset em ms, a janela e a chance.
5. **Contestação** (Menu): com o defensor pulando a ~1,2 m, um green contestado deixa de ser garantido. No laboratório aparece a linha da mão do defensor até a trajetória (verde = livre, amarelo = leve, vermelho = contestado).

Me diga **o que parece diferente do 2K23**: tempo do arremesso, velocidade do drible, resposta do analógico. Os números ficam em `Plugins/HoopsSim/Source/HoopsSimCore` (`ShotTuning` e a tabela de dribles) e são fáceis de ajustar.

## 6. Testes do núcleo (opcional)

```bash
cmake -S Plugins/HoopsSim/Tests -B build/tests
cmake --build build/tests --config Release
build/tests/Release/hoops_tests.exe
```

## 7. Estrutura do código

| Pasta | O que é |
|---|---|
| `Plugins/HoopsSim/Source/HoopsSimCore` | **Núcleo** em C++ puro: bola/aro/tabela, modelo de arremesso (green), solucionador de trajetória, drible, Pro Stick |
| `Plugins/HoopsSim/Tests` | Testes do núcleo (CMake) |
| `Source/Garrafao` | Camada Unreal: jogador, bola, cesta, quadra, HUD, modo Freestyle |
| `Config/` | Configuração do projeto (modo padrão = Freestyle, Enhanced Input) |
