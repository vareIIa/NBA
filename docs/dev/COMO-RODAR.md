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
1. Depois do `git pull`, rode `git lfs pull` (o `Art/Characters/HoopsDummy/SK_HoopsDummy.fbx` tem ~5 MB; sem isso vem só um "ponteiro" de 130 bytes).
2. Abra o editor. Ao terminar de carregar, ele importa sozinho a malha, o esqueleto e as **15 animações** em `/Game/Hoops/Characters/Dummy` (Output Log: `[Garrafao] Pronto!`). Só reimporta quando o FBX muda.
3. Aperte **Play**. No topo da tela aparece `Garrafao Freestyle v0.5 | Boneco animado: ATIVO (15/15 clipes)`. Se aparecer em amarelo "NAO IMPORTADO", rode **Tools → Execute Python Script…** → `Tools/Editor/importar_personagem.py` e me mande o Output Log.
   (Último recurso: arraste o FBX para `/Game/Hoops/Characters/Dummy` no Content Browser com *Import Animations* ligado.)

O boneco é um "manequim de teste" (partes rígidas, cores de pele/uniforme/tênis) com mocap da CMU: drible parado, andando, correndo, de costas e de lado (as duas mãos), andar e correr sem bola e o arremesso saindo do drible. A **bola segue a mão animada** (sai no fim do empurrão e volta para a mão no topo) e no arremesso a **mão chega ao topo exatamente no centro da janela green**.

Ajustes no painel Details do jogador durante o Play (categoria *Hoops*): `BodyHeightCm` (altura), `MeshYawAdjust` (se ele aparecer de lado/de costas), `DribbleIdlePlayRate` (velocidade do drible parado), `DribbleBallOffset`/`ShotBallOffset` (onde a bola fica na mão), cores.

Ainda **sem** animação própria: os dribles do Pro Stick (o corpo troca de mão e a bola cruza, mas sem o movimento do crossover), bandeja e enterrada (usam o arremesso por enquanto). Vêm na próxima etapa.

### Manequim da Epic (alternativa)

Se o boneco não estiver importado, o jogo usa o **Manny** do pacote Third Person, se existir:
**Content Browser → Add → Add Feature or Content Pack → Third Person → Add to Project**.

## 4. Controles (iguais ao 2K23, Xbox)

| Botão | Ação no Freestyle |
|---|---|
| **LS** | Mover. Com a bola: **analógico pela metade** = size-up encarando a cesta (anda de frente, de lado, de costas); **analógico todo** = corre virando o corpo |
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
