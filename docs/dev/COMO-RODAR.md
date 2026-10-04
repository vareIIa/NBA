# Como rodar o Freestyle no seu PC (Unreal Engine 5.8)

> O núcleo de simulação foi compilado e testado na nuvem (24 testes passando).
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
3. Com o editor aberto: **File → New Level → Empty Level** (ou *Basic*).
4. Aperte **Play** (Alt+P). O modo **Freestyle** cria sozinho a quadra, a cesta, a bola e a iluminação.

### Manequim (opcional, recomendado)

Sem asset nenhum, o jogador aparece como um cilindro preto. Para ver o **Manny** animado (andar/correr):
**Content Browser → Add → Add Feature or Content Pack → Third Person → Add to Project**. O jogo detecta o manequim sozinho no próximo Play.

## 4. Controles (iguais ao 2K23, Xbox)

| Botão | Ação no Freestyle |
|---|---|
| **LS** | Mover |
| **X** segurar → soltar | Arremesso (solte no topo do medidor = **GREEN**). Toque rápido = pump fake |
| **RS** toque cima / esquerda / baixo-esquerda / direita / baixo | Crossover / entre as pernas / por trás / hesitação / step-back |
| **RS** giro / ¼ de giro | Spin / half-spin |
| **RS** mesma direção 2× / direção + oposta | Double cross / hesi-cross |
| **RS** segurar baixo → soltar | Arremesso pelo Pro Stick |
| **RT** segurar | Sprint (corre para onde vai; com RT, os dribles viram escapes) |
| **RT** toque correndo | **Explosão** (3 por posse; no Freestyle, infinitas) |
| **RT + X** ou **RT + RS cima** perto da cesta | Enterrada |
| **X** ou **RS cima** infiltrando | Bandeja |
| **LT** | Proteger a bola (drible mais baixo) |
| **D-pad cima** | Pedir a bola de volta |
| **D-pad baixo** | Resetar no spot atual |
| **D-pad esquerda/direita** | Trocar de spot (topo, alas, cantos, cotovelos, lance livre, logo) |
| **View** | Liga/desliga o **laboratório** (histórico de inputs, janelas, chance, física) |

Teclado (provisório): WASD mover · setas = Pro Stick · Espaço = X · Shift = RT · Ctrl = LT · G = pedir bola · Backspace = reset · 1/2 = spots · Tab = laboratório.

## 5. O que testar e me contar

1. **Green**: o medidor branco sobe; solte quando passar pela faixa **verde** (na altura da marca branca). Green livre **sempre** entra.
2. **Drible**: encadeie crossover → por trás → step-back → arremesso. Inputs no **fim** de cada drible contam como **ritmo** (mais rápido, combo sobe).
3. **Pull-up**: corra lateralmente com a bola e aperte X. O arremesso vira *Pull-up* (janela um pouco menor) e mantém parte do embalo.
4. **Laboratório** (View): veja quanto você segurou, o offset em ms, a janela e a chance.

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
