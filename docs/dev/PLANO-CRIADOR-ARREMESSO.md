# Criador de arremesso (menu de pausa)

Objetivo: replicar o Jump Shot Creator do NBA 2K dentro do menu de pausa, sem a parte de VISUAL CUE. O jogador monta
o próprio arremesso (base, duas camadas de cima, mistura, velocidade de soltura), salva vários e equipa um.

## Escopo desta versão

Entra:
- Corpo de baixo (`lowerBase`), camada de cima 1 e 2 (`upperRelease1/2`), escolha entre as famílias que existem.
- Mistura de animação entre as camadas 1 e 2 (0 a 100%).
- Velocidade de soltura (Rápida, Normal, Lenta), ligada ao modelo de arremesso (`ReleaseSpeed`).
- Até 12 arremessos salvos, um equipado. Persistência em `localStorage` (com fallback em memória).
- Tela no menu de pausa, com teclado, mouse e controle. Prévia do arremesso no boneco.

Não entra (fica para depois):
- VISUAL CUE e a linha de timing do 2K.
- Cartão de atributos do arremesso (Release Height, Timing Stability...).
- Mais animações: só existem `JumpShot_R/L` e `JumpShot2_R/L` no `hoops_player.glb`. Mais opções
  exigem mais mocap (ver `docs/18-fontes-de-animacao.md`). A lista do 2K tem dezenas.

## Passos

| # | Passo | Dono | Estado |
|---|-------|------|--------|
| 1 | Modelo de dados, mistura de pesos, validação e armazenamento (`web/src/shot/JumpShotSetup.ts` + testes) | lead | feito (11 testes) |
| 2 | Tela do criador no menu de pausa (`web/src/hud/PauseMenu.ts`, CSS, testes da lógica pura) | agente A (Haiku, máximo) | feito (21 testes) |
| 3 | Medição dos clipes de arremesso: solturas, pico da palma, ossos de cima e de baixo, alinhamento | agente B (Haiku, máximo, só leitura) | feito |
| 4 | Camada de cima no animador: mistura das camadas 1 e 2 sobre o corpo de baixo, alinhada pela soltura | lead | feito (`applyShotLayer`, `ShotFamilyTiming`) |
| 5 | Ligação no jogo: P/Start abre a pausa, pausa o loop, prévia no boneco, arremesso equipado vai para o Freestyle, e a velocidade de soltura entra no contexto do modelo | lead | feito |
| 6 | Verificação: typecheck, vitest, e2e e medição no navegador | lead | feito, com os e2e de Freestyle e bandeja intermitentes por tempo real |

Decisões tomadas na ligação:
- A pausa abre com **P** (teclado) e **Start** (controle). Esc fica com as telas de badges e de pausa, e a tecla que abre
  não pode ser a mesma que fecha (senão reabre no mesmo quadro).
- O controle entra pelo `state.pad` (D-pad, LS, A, B e Start), separado do teclado, para a tela não andar duas vezes
  com WASD.
- A prévia usa `animator.playShot('r', 0.417, setup)` com o jogo parado; o loop só anima o boneco enquanto ela toca.
- O padrão (`defaultSetup`) é o arremesso que o jogo já tinha (JumpShot2 em tudo, mistura 0%), então sem setup nada muda.

## Contratos entre peças

- O modelo de dados é `JumpShotSetup` (`web/src/shot/JumpShotSetup.ts`). Não muda sem combinar com a tela e com o animador.
- Clipe da família na mão: `clipNameFor(family, hand)`, ex.: `JumpShot2` + `r` -> `JumpShot2_R`.
- Pesos das camadas: `upperWeights(blendPercent)`. A camada 2 entra com `blendPercent / 100`.
- A tela (`PauseMenu`) não conhece three.js. Ela recebe `onPreview(setup)` e `onClose()`.

## Riscos e decisões

- Com dois clipes por slot, a mistura fica pequena. O valor real vem depois que houver mais mocap.
- A soltura precisa cair no instante certo do arremesso: a camada de cima é alinhada pelo frame de soltura medido
  (passo 3), não pelo tempo do clipe.
- `Esc` já fecha o `BadgeMenu`, e `B` abre as badges. O menu de pausa não pode abrir por cima das badges.
- Velocidade de soltura é gameplay (janelas de timing no `HoopsShotModel`), não só visual. Por isso passa pelo
  `ReleaseSpeed`, e não pela taxa do clipe.
- O animador (`PlayerAnimator.ts`) é compartilhado com outras sessões. Antes de mexer em `update()` ou em
  `applyLegLayer`, avisar as sessões do drible e de layups.
