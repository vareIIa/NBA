# Handoff: finalizações (bandejas, hop step e bola presa)

> Escrito em 2026-10-16 pela sessão das bandejas (nomes que ela teve: nba-24, nba-c9). Assumido em 2026-10-15 por nba-9f
> (hop step refeito: `planHopStop`, ver `docs/21-bandejas.md` §3.1). Ler antes: `docs/21-bandejas.md`
> (desenho, pesquisa, comandos e números) e `web/README.md` (como rodar). O jogo é `NBA/web` (three.js + Vite, branch
> `claude/hopeful-einstein-eargc1`); `NBA 5.8*` é a Unreal antiga, não mexer.

## 1. O pedido do diretor e onde paramos

O diretor pediu as **finalizações**, começando pelas bandejas: variações (Kyrie, jelly, euro…), pontos de lançamento
diferentes e trabalho de pés de verdade (um pé, dois pés). Depois pediu o **hop step em fases** (como no 2K): toque no X
→ hop → pousa nos dois pés e **fica com a bola presa**; nesse estado o RS faz os fundamentos (jab etc.) com um pé de pivô
parado. Ele **confirmou**: toque rápido no X = hop step (é assim no 2K). Referências que ele quer: jogadores de elite
(Hakeem, Shaq, Jordan, Kobe, Kyrie), **nunca** tutorial de amador ("desse gordinho aí não").

**Feito e testado** (tsc limpo, 181 testes de unidade, 11 e2e passando contra um build congelado):

- Bandeja pelo plano físico: zero step + 2 passos (penúltimo longo e baixo, último curto), pé de impulsão saído da passada
  real, joelho de impulso subindo, voo balístico (o corpo não para no ar), soltura perto do ápice, tabela verificada na
  física da bola.
- Variações: gathers normal, um passo, euro, hop, pro hop, cradle; finalizações por cima, finger roll, scoop, jelly,
  reversa, floater, de força; estilos Padrão e Kyrie.
- Comandos pelo X: segurado = bandeja; toque = hop step; X 2x com LS = euro (LS para a mão livre) ou cradle (LS para a
  mão da bola); LT = cradle.
- Hop step em fases + bola presa (`HoopsHold`): jab, jab grande, jab cruzado, stepover, pivô reverso, spin-out, pump fake,
  step-through; X segurado finaliza (bandeja parada até 2,6 m; mais longe chama o arremesso da sessão do jump shot).
- Bugs corrigidos no caminho: corpo congelando depois da bandeja; pernas penduradas no voo; agachamento no gather.

**Parou em:** primeira versão da bola presa funcionando e gravada (`Saved/bandejas/bola_presa_frente.mp4`). Nada foi
commitado (o trabalho de várias sessões está misturado na pasta de trabalho desde `229db14`; commit só com o diretor
pedindo).

## 2. Arquivos (todos desta sessão, exceto os ganchos)

| Arquivo | O que tem |
|---|---|
| `web/src/sim/HoopsLayup.ts` | Catálogo (gather × finalização × mão), `chooseLayup` (comando + contexto + estilo), `planLayup` (passadas, decolagem, voo, soltura), `planStandingLayup` (bandeja parada saindo da bola presa), `layupCom/layupHeight/layupFootState`, `LayupTuning` (todos os números). |
| `web/src/sim/HoopsLayupShot.ts` | `realizeLayupShot`: mira no vidro conferida na `BallSim` (ou direto no aro). |
| `web/src/sim/HoopsHold.ts` | Bola presa: `HoldMove`, `HoldMoveSpecs` (passo, peso, agachamento, giro, bola), `holdMoveForGesture` (mapa do 2K24), `HoldState` (pivô livre → fixo, pose por quadro), `holdFinishFor`. |
| `web/src/anim/LayupMotion.ts` | O corpo desenhado: pelve (com limite de alcance da perna), tronco a partir da pose de repouso, pés presos nos contatos, joelho de impulso, bola e mãos por IK com orientação da palma; modo `hold` para a bola presa. |
| `web/src/game/LayupDriver.ts` | Estado no jogo: zona, pendência do X cedo, toque/toque duplo, hop que para (`hopStop`), bola presa (`readHold`, Pro Stick próprio). |
| Testes | `HoopsLayup.test.ts`, `HoopsLayupShot.test.ts`, `HoopsHold.test.ts`, `e2e/finish.spec.ts`. |
| Ferramentas | `web/tools/bandeja-video.mjs` (vídeo por cenário: vistas `lado|perto|perto3|atras|cima|frente|jogo`, + `.json` por quadro), `web/tools/cenarios-bandeja.mjs`, `web/tools/sonda-bandeja.mjs` (expressão por quadro desde o gather), `web/tools/sonda-rig.mjs` (medidas do esqueleto/eixos da mão). |

**Ganchos em arquivos de outras sessões** (edições pontuais; lista também em `docs/21-bandejas.md`):

- `PlayerAnimator.ts`: seção "bandeja pelo plano (nba-24)" (`playLayup`, `layupLive`, `driveLayupClip`, `holdLayup`,
  `setHoldPose`, `applyLayupBody`, `applyLayupArms`, `feetState`); no `update()`: `driveLayupClip()` depois de
  `driveHalfSpinClip`, `applyLayupBody()` depois de `applyStance`, `applyLayupArms()` depois de `applyHandHold`.
- `Freestyle.ts`: campo `layup`; ramo do X no drible (enterrada → `beginFinish`; senão `tryLayup`; senão o fluxo antigo)
  + `updatePendingLayup`; ramo `phase === 'gather' && this.layup.busy`; retorno antecipado no começo do `updateMovement`;
  fim da bandeja depois do `animator.update`; seção "bandeja pelo plano" e "bola presa" (`enterHold`, `updateHold`,
  `finishFromHold`).

- `Freestyle.updateGather` (dono: sessão do arremesso, combinado com nba-57 em 2026-10-15): uma linha no ramo do pump fake,
  `if (this.hopFromShotTap()) return;` (toque no X dirigindo para a cesta fora da zona da bandeja = hop step).

## 3. Como testar (importante)

O Vite da 5173 é de outra sessão e recarrega quando qualquer sessão salva arquivo (quebra gravações no meio). Use um
build congelado:

```bash
cd web
npx vite build --outDir <scratchpad>/dist --emptyOutDir
npx vite preview --outDir <scratchpad>/dist --port 5181 --strictPort --host 127.0.0.1   # em segundo plano
LAB_BASE=http://127.0.0.1:5181 node tools/bandeja-video.mjs hop_jab_bandeja,frente_x <saida.mp4> perto3
LAB_BASE=http://127.0.0.1:5181 node tools/sonda-bandeja.mjs hop_jab_bandeja "[game.phase, game.layup.label]" 0 200
```

e2e contra o build: uma config temporária com `baseURL: http://127.0.0.1:5181`, `webServer: undefined` e `outputDir`
fora de `web/test-results` (o e2e apaga essa pasta); rodar `npx playwright test -c <config>`. Folhas de contato dos
vídeos: um script com PyAV (`av`) que pega N quadros de um trecho e monta uma grade; ler a imagem e olhar quadro a
quadro. Sempre comparar com o vídeo real antes de dar como pronto (pedido central do diretor).

## 4. Problemas conhecidos (prioridade)

1. **Bola presa ainda crua:** jabs discretos de longe (amplitude do Jordan é curta, mas falta "vender": ombro e cabeça
   indo junto, bola rasgando para o quadril de fora no jab grande); o pivô reverso termina de costas e a finalização dali
   não vira para o aro; spin-out e stepover não foram conferidos em vídeo; transição do pouso do hop para a base é um
   pouco brusca nos braços.
2. ~~RS no drible para bandejas~~ (feito em 2026-10-16 pela sessão "Fluidez de layups e dunks": gancho de uma linha
   `layupFromStick` no `updateProStick`, combinado com a sessão de dribles; ver `docs/21-bandejas.md` §3 e §9). Efeito
   colateral desejado (2K): dirigindo para a cesta dentro da zona, o RS é finalização, não drible.
3. Euro de lado ainda tímido (~0,5–0,7 m); jelly/finger roll precisam do punho virando mais visível.
4. Hop step de frente teve salto de cabeça de 12 cm num quadro na troca de plano (normal → hop).
5. Efeito (english) da bola é só visual: a `BallSim` não usa a velocidade angular no contato (arquivo de outra sessão).

## 5. Próximos passos sugeridos

1. Polir a bola presa olhando quadro a quadro contra Jordan (`iekqeoHB0Co` 194–223 s, 310 s) e Hakeem (`3w9KLLE0r68`,
   `vQF3hWds-Vw` "Hakeem Teaches Kobe", `dkxFtT0GUP0`); analisar Shaq (`QT8w8Ot8Pcw`) para costas para a cesta.
2. Fundamentos que faltam: rocker step (jab e volta atacando), up-and-under, pivô de frente pelo LS, jab-and-go (exige
   não ter driblado: hoje a bola presa só vem do hop, drible morto), bola ao queixo depois de cada pivô.
3. ~~RS no drible para bandejas~~ (feito).
4. Escolha do pacote de bandejas no menu (Padrão / Kyrie); spin gather; troca de mão no ar; double clutch.
5. ~~Enterradas pelo mesmo plano de passadas~~ (feito, `docs/21-bandejas.md` §9: 5 variações, parada de dois pés,
   pendurar no aro com X ou RS baixo segurado, RT + RS para escolher, requisitos pela build). Falta: pôster (precisa de
   defensor), alley-oop, reversa/360, skill dunk com medidor.
6. Build congelado quando outra sessão deixa o `vite build` quebrado (import que ainda não existe): config no scratchpad
   que troca imports inexistentes por módulos vazios (`vite build -c <config> --outDir <dist>`), servido por
   `vite preview --outDir <dist> --port 5186`.

## 6. Coordenação e regras

- Várias sessões editam `web/` ao mesmo tempo; os nomes mudam quando reiniciam: começar com `ListAgents` e avisar.
  Donos atuais conhecidos: jump shot = sessão do arremesso (era nba-52/nba-57; `playShot`, `JumpShotMotion`,
  `beginGather/updateGather/release`, doc `docs/22-arremessos-jump-shot.md`); drible/Pro Stick = sessão de fluidez; modelo
  3D = sessão HY 3D.
- Só Edit pontual em arquivo dos outros; avisar antes de mexer em `startAction`/`updateAction`/`reachPalm`/
  `restoreMixerPose`; nunca reverter trabalho alheio; não commitar sem o diretor pedir; nunca `git add -A`.
- O arremesso (outra sessão) não interfere na bandeja: o desenho dele só age com o clipe `JumpShot2_R/L`; a bandeja usa
  `Layup_R/L` e é reconhecida por `layupLive()`.
- Vídeos de referência baixados com `yt-dlp` ficam em `referencias/real/` (fora do git); catálogo
  `referencias/real/BANDEJAS-REFERENCIAS.md`. Não usar cookies do diretor quando o YouTube pedir login.
- Entregas em vídeo para o diretor: `Saved/bandejas/` (fora do git).
