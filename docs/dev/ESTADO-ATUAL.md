# Estado atual do Projeto Garrafão (ponto de retomada)

> Última atualização: 2026-10-14 · branch `claude/hopeful-einstein-eargc1` · commit de referência `a40fb2d`.
> Este arquivo é o resumo para retomar o desenvolvimento numa conversa nova. Detalhes ficam nos docs citados.
> **ATENÇÃO (D15, 2026-10-14): o jogo vai migrar para three.js. A próxima sessão começa por `docs/dev/HANDOFF-THREEJS.md`.**
> **Migração (2026-10-14): passos 1 e 2 do handoff feitos.** `web/` tem o esqueleto (Vite + TS + three + vitest +
> Playwright) e o núcleo portado em `web/src/sim/` com os 33 testes passando. Ver `web/README.md`.
> **Passo 3 feito:** jogador animado (GLB, 38 clipes), dribles do Pro Stick e arremesso jogáveis no navegador.

## 1. O que é o projeto

Jogo de basquete original (liga fictícia, sem marcas da NBA/2K), sim-arcade, na Unreal Engine 5.8 (C++).
Referência de sensação: **NBA 2K23** (vídeos do diretor em `referencias/2k23/`). Ordem dos modos:
**Freestyle → 1x1 → 3x3**. Freestyle é o laboratório de gameplay.

Papéis: diretor = decide; Claude = lead técnico/design que propõe com recomendação e executa.
Decisões registradas em `docs/15-brief-e-decisoes.md`. As que mais pesam agora:
- **D6** controles idênticos ao 2K23 (Xbox) — mapa em `docs/02-controles.md`.
- **D12** janela green maior que a do 2K.
- **D13** sem Explosões/Adrenaline: só a barra de energia limita.
- **D14** só gratuito e open source (nenhum pacote pago).

## 2. O que já existe

**Núcleo** (`Plugins/HoopsSim`, C++20 puro, 33 testes passando com CMake):
física da bola/aro/tabela, modelo de arremesso com green, solucionador de trajetória, contestação,
Pro Stick do 2K23, dribles com energia, misdirection, arranque de saída e pull-up sem frear.

**Freestyle na Unreal** (`Source/Garrafao`):
- Quadra com luz de ginásio e um script de piso de madeira com texturas livres (CC0).
- HUD com medidor do 2K23, feedback de timing e cobertura, energia, laboratório (View), câmera lenta (L3)
  e defensor manequim (Menu).
- **Boneco animado** com 38 clipes de mocap gratuito da CMU. O editor o importa sozinho ao abrir
  (`Content/Python/init_unreal.py`), e o HUD mostra `Boneco animado: ATIVO (38/38 clipes)`.
- Animação sem Animation Blueprint (`HoopsAnimInstance`):
  - loop de base com crossfade;
  - ação por cima, com crossfade da anterior e "segurar quadro";
  - camada só do tronco;
  - postura atlética: quadril baixo com IK das pernas e inclinação nos cortes.
- **Drible:**
  - a bola segue a mão animada e sai no fim do empurrão;
  - o quique é calculado preso ao corpo, para a bola não fugir;
  - ritmo de cerca de 2–2,5 quiques/s.
  - Clipes de drible:
    - parado, andando, correndo, de costas e de lado;
    - LT = drible baixo;
    - crossover e escape crossover;
    - spin, hesitação e entre as pernas.
- **Orientação do corpo:** encara a cesta no size-up, no recuo e com LT; vira o corpo no drible lateral.
- **Arremesso:**
  - a mão chega ao topo no centro do green e espera até soltar o X;
  - arremesso novo 124_05 (`JumpShotStyle`);
  - bandeja e enterrada com o capsule decolando no quadro certo do clipe.
- **Green estilo 2K Park:**
  - medidor que pisca e "GREEN!" com som;
  - follow-through segurado;
  - comemoração automática e pelo D-pad;
  - vira e volta depois do green;
  - modo de feedback só quando a bola chega ao aro.
- **Sons sintetizados** (sem arquivos): quique, rede, aro, tabela, tênis e o ding do green.

**Ferramentas:**
- `Tools/Animacao`: pipeline CMU → BVH → Blender → FBX.
- `Tools/Captura`: captura própria com celulares (Pose2Sim + RTMPose + OpenSim, tudo open source). Testada no
  demo de 4 câmeras, ainda não com atleta real.
- `Tools/Audio/ouvir_sons.cpp`: ouvir os sons sem a Unreal.

## 3. Como está de verdade (avaliação honesta)

- O código da Unreal **nunca foi compilado no nosso ambiente** (não há engine na nuvem). Revisões o compararam com o
  código-fonte real da UE 5.6 e com o compilador MSVC. O primeiro build depois de muita mudança pode ter erros pequenos.
- Último teste do diretor (antes destas levas): **o drible ainda está longe de AAA**.
  - "a bola às vezes quica e vai pro caralho" — corrigido em seguida, ainda não confirmado em jogo.
  - "boneco sempre olhando para a cesta" — corrigido em seguida, ainda não confirmado em jogo.
  - "faltam animações de movimentos tipo escape crossover" — parte adicionada.
- **Limite principal:** o mocap da CMU é amador e lento. Mesmo acelerado e tratado, não chega à qualidade do 2K.
  O salto de qualidade depende de **capturar atletas bons de bola** com `Tools/Captura`.
- O boneco é um "manequim de teste" (partes rígidas). Não há personagem final, roupa, rosto nem mãos com dedos.

## 4. O que falta (prioridade)

**P0 — confirmar e polir o que existe (próxima sessão):**
1. Diretor compila `a40fb2d` e testa. Corrigir erros de build e bugs que aparecerem.
2. Afinar com o diretor jogando:
   - ritmo e altura do drible;
   - velocidade de giro do corpo;
   - postura (`DribbleCrouchCm`);
   - alturas da bandeja e da enterrada;
   - pé deslizando nos clipes acelerados.
3. Dribles ainda sem clipe próprio: **por trás das costas, step-back, retreat, double cross**.
4. Mão de apoio descendo antes no follow-through (máscara por braço) e mão "buscando" a bola por IK na recepção.

**P1 — qualidade AAA de animação:**
5. Ensaio de captura com 2 celulares e depois a sessão com os atletas (roteiro em `Tools/Captura/README.md`).
6. Trava de pé na conversão da captura e poses de mão.
7. Trocar a enterrada improvisada por uma capturada.
8. Personagem final (MetaHuman ou modelo livre), com mãos e dedos.

**P2 — sair do Freestyle (Fase 1 do `docs/13-roadmap.md`):**
9. Defesa (postura, cutoff, roubo, toco), contato e faltas, IA de 1x1 e o modo 1x1.

**Decisões pendentes do diretor:**
- data da gravação com atletas;
- trocar o detector de pessoas por um treinado só em COCO (risco de licença baixo, recomendado pela D14).

## 5. Como retomar

- Rodar o jogo: `docs/dev/COMO-RODAR.md`. Animações: `Tools/Animacao/README.md`. Captura: `Tools/Captura/README.md`.
- Feel do 2K Park e P0 do green/drible: `docs/17-park-green-e-feel.md`. Fontes de animação: `docs/18-fontes-de-animacao.md`.
- Roadmap: `docs/13-roadmap.md`.
- **Regras de trabalho:**
  - commits em português, só nesta branch;
  - sem PR, a menos que o diretor peça;
  - nunca commitar ASF/AMC/BVH da CMU;
  - mídia vai pelo Git LFS;
  - todo C++ novo passa por revisão contra os headers reais da UE antes de ir para o diretor.
