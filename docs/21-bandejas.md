# 21 — Bandejas: passadas, variações e finalização

> Pedido do diretor (2026-10-15): finalizações bem feitas, começando pelas bandejas, com variações (Kyrie, jelly, euro…),
> pontos de lançamento diferentes e o trabalho de pés de verdade (um pé, dois pés). Enterradas ficam para depois.
>
> Pedido do diretor (2026-10-16): fluidez das bandejas e enterradas, enterradas com variações e, segurando o X, o jogador
> fica pendurado no aro como no 2K. Enterradas no mesmo plano: §9.

Código: `web/src/sim/HoopsLayup.ts` (catálogo, escolha e plano, puro), `web/src/sim/HoopsLayupShot.ts` (soltura com tabela),
`web/src/anim/LayupMotion.ts` (o corpo desenhado em cima do plano), `web/src/game/LayupDriver.ts` (comando e estado no
jogo). Ganchos pontuais em `PlayerAnimator.ts` (`playLayup`, `applyLayupBody`, `applyLayupArms`, `driveLayupClip`) e
`Freestyle.ts` (seção "bandeja pelo plano"). Testes: `HoopsLayup.test.ts`, `HoopsLayupShot.test.ts`, `e2e/finish.spec.ts`.

## 1. Como a bandeja de verdade funciona (o que o jogo reproduz)

| Fato | Fonte | No jogo |
|---|---|---|
| Depois do **gather** valem **dois passos**; o pé que está no chão no gather é o "zero step" | Regra 10, seção XIII da NBA, esclarecida em 2019 | O pé apoiado no X é o zero; passo 1 = o próximo pé; passo 2 = o da decolagem |
| **Penúltimo passo longo e baixo, último curto** e plantado à frente: o centro de massa desce no penúltimo e o último converte corrida em subida | Relatório biomecânico do Mundial de Londres 2017 (salto em distância); Applied Sciences 10(1):309, 2020 (salto de uma perna no basquete: a corrida no ritmo preferido converte melhor que a rápida) | Passo 1 ~1,15 m, passo 2 ~0,75 m (jog); centro de massa −10 cm no penúltimo, −14 cm no plant |
| Bandeja natural: decola com o pé **oposto** à mão; o joelho do lado da mão sobe com a bola | Coach's Clipboard; FIBA (WABC) | `driveKnee` = o lado da mão; no voo a coxa dele fica quase na horizontal |
| **Mesmo pé, mesma mão** ("wrong foot"): um tempo mais cedo, tira o ritmo do protetor; acontece naturalmente no fim do euro | FIBA; Kyrie, Ja, Josh Hart (tutoriais) | Estilo Kyrie aceita; no euro é o padrão |
| Voo balístico: a velocidade horizontal da decolagem continua até o pouso | Física | O corpo não para no ar; cai embaixo ou além do aro |
| Mira com tabela no "canto de cima do quadrado"; por baixo (palma para cima) a bola sai mais macia | Coach's Clipboard | Soltura com tabela verificada na física da bola |
| Floater: decola cedo e solta subindo, arco alto, de 2–3,5 m | Shot Science (floater) | Arremesso de perto (`ShotType.Floater`), ~48% livre |
| Kyrie: termina alto, braço esticado por cima do protetor, muito vidro e efeito; finger roll e mão de dentro | `NSiPz8Kvuqw` 21,8–24,2 s; `Gu0dzNMAq70` 9:18–12:42 | Estilo "Kyrie" (jelly e finger roll mais frequentes, pé da mão aceito) |

Referências de vídeo: `referencias/real/BANDEJAS-REFERENCIAS.md` (catálogo dos trechos; fora do git).

## 2. Três eixos independentes (como o motor de bandejas do 2K)

| Gather / passadas | Finalização | Mão |
|---|---|---|
| Normal (zero + 1 + 2) | Por cima (tabela) | Pelo lado do aro (40 cm do meio = mão da bola) |
| Um passo | Finger roll | Scoop: a do RS |
| Euro step | Scoop | Euro: o lado do LS |
| Hop step (jump stop, dois pés) | Jelly | Reversa: a do lado da linha de fundo |
| Pro hop (hop lateral) | Reversa | |
| Cradle | Floater | |
| | De força (duas mãos) | |

O pé da decolagem sai da passada real no momento do X: se ele cair "errado" para a mão, o plano escolhe entre um passo a
mais (zero-1-2), a bandeja de um passo ou o mesmo pé e mesma mão, pelo custo de encaixe.

## 3. Comandos (D6: iguais ao 2K23, `docs/02-controles.md` §1)

| Comando | Bandeja | Estado |
|---|---|---|
| X **segurado** correndo para a cesta | Normal; a finalização sai do ângulo e do estilo | ✅ |
| **Toque** no X (soltou em < 0,17 s) dirigindo para a cesta, até 5,2 m do aro | Hop step em fases: pousa e fica com a bola presa (§3.1) | ✅ vira hop assim que o X é solto (o segundo toque, antes de o pé empurrar, troca por euro/cradle). Fora da zona da bandeja o X vai para o arremesso e o toque, dirigindo, vira hop em vez de pump fake. **Confirmado pelo diretor em 2026-10-16; 2K27 "Hop Step Finish: tap X while driving".** |
| X 2x com LS para a mão livre / para a mão da bola | Euro step / cradle | ✅ |
| LT segurado | Cradle | ✅ |
| RS (toque ou segurado) dirigindo para a cesta, na zona: cima / baixo / lados (vindo pela linha de fundo: o lado dela) | Normal / floater / scoop daquela mão / reversa | ✅ gancho de uma linha no `updateProStick` (`layupFromStick`); fora da zona o RS é drible |
| RS no gather: switchback / double throw / giro | Euro para o lado do 2º toque / hop / spin gather | ✅ euro e hop (`LayupDriver.readStick`); spin gather ainda não existe |
| RT + RS na zona: cima / lados / diagonais para baixo / diagonais para cima / baixo segurado | Duas mãos / uma mão daquela mão / tomahawk (moinho acima de 4 m/s) / cock-back / enterra e pendura | ✅ (§9) |
| RT + X perto do aro | Enterrada pelo plano (§9): correndo, parada (dois pés) ou saindo da bola presa | ✅ |
| X **segurado** na soltura da enterrada | Fica pendurado no aro até soltar o X (máx. 2,6 s) | ✅ |

Zona da bandeja: `2,6 + 0,36·velocidade` m (até 5 m; ~4 m no jog, ~4,8 m no sprint). X mais longe que o que dois passos
alcançam fica esperando até 0,7 s e começa sozinho.

### 3.1 Hop step em fases e bola presa (`web/src/sim/HoopsHold.ts`)

Pedido do diretor (2026-10-16): como no 2K, o toque no X faz o hop, o jogador **pousa nos dois pés e fica com a bola**, e
o RS faz os fundamentos com um pé de pivô parado.

Referências de elite (`referencias/real/`): Hakeem, `3w9KLLE0r68` ("Reverse Pivot Split Jump": pousa nos dois pés, base
larga, quadril baixo, **sem fixar o pivô**, escolhe o lado depois); Jordan ensinando a ameaça tripla, `iekqeoHB0Co`
194–223 s (joelhos bem dobrados, tronco ~35°, bola no quadril do lado da mão, jab curto do pé livre, pump fake acima da
testa com as pernas dobradas); Kobe, `ruGQRHgQJjw` (repertório de jab sem drible); pivôs depois do jump stop,
`uZsO61OL0Bk`.

| Comando na bola presa (bola na direita; na esquerda espelha) | Fundamento |
|---|---|
| RS direita | Jab (pé livre ~36 cm à frente e volta; peso no pivô) |
| RS cima-direita | Jab grande (~56 cm, mais baixo) |
| RS esquerda / cima-esquerda | Jab cruzado (o pé livre cruza na frente e volta) |
| RS cima | Stepover (passo cruzado que fica) |
| RS baixo-esquerda / quarto de círculo | Pivô reverso (~110°, de costas para o defensor) |
| RS giro | Spin-out (giro inteiro em volta do pivô) |
| RS baixo / toque no X | Pump fake (bola acima da testa, pernas dobradas) |
| X segurado (ou apertado de novo no ar do hop e segurado: sobe ao pousar, como no 2K24) | Finaliza: bandeja de força de dois pés até 3,0 m do aro; floater de dois pés (hop floater) até 4,6 m; mais longe, arremesso |
| X segurado durante (ou até 0,55 s depois de) um pump fake | Step-through (passo longo por fora) e bandeja |

O hop do toque tem plano próprio (`planHopStop`, `HopStopTuning`): não depende do aro (vale andando e longe). O pé no ar
pisa e empurra se está para pisar (senão o apoiado empurra já), voo de 0,15 s e ~3 cm de arco, os dois pés pousam juntos
com base de ~0,54 m, freio de 0,16 s e agachamento fundo (−0,28 m no fundo, −0,20 m na base); os pés no ar andam junto com
o corpo. Anda ~1,0 m andando e ~1,9 m correndo (o passo do empurrão incluso) e nunca para a menos de 1,5 m do aro.
Medidas: 2K27 drill "Hop Step Finish" (`OSaLcgjVmlE`, 60 qps): empurra no quadro 1840, pousa no 1848, ~0,3 s agachado com
a bola no peito, sobe no 1866; Wade (`ogX9esDX0xc` 2905–2925) igual. 2K24: depois do hop, apertar e segurar o X de novo
completa a bandeja (`1K-D-b9lRQE`).

Regras: depois do pouso dos dois pés o pivô é livre; o primeiro movimento com um pé fixa o outro como pivô, e o pivô nunca
sai do lugar (teste). Drible morto: da bola presa não se volta a driblar. Vídeos: `Saved/bandejas/bola_presa_frente.mp4`,
`hop_step_corrigido_lado.mp4` e `hop_step_corrigido_perto.mp4` (2026-10-15: andando, correndo, X de novo no ar, longe).

## 4. O plano (`planLayup`)

1. Escolhe o ponto de soltura pela finalização e pelo lado (por cima: 0,55 m do aro, sempre na frente da tabela).
2. Subida (0,5 m; floater 0,32) → velocidade vertical; a soltura cai numa fração do tempo até o ápice (por cima 0,9;
   finger roll 1,0; jelly 1,06; floater 0,5).
3. Velocidade horizontal da decolagem ≈ `0,55·v + 0,5` (hop ~0,25·v). O ponto da decolagem fica para trás da soltura o
   quanto o voo anda até ela.
4. Encaixa as passadas entre o jogador e esse ponto: escala do tempo das passadas 0,72–1,35 e velocidade da decolagem
   ajustadas pelo menor custo (perto do ritmo da corrida e da velocidade natural). Curva do centro de massa em Bézier por
   trechos (o euro e o pro hop passam por um ponto lateral).
5. Pés presos no chão em cada contato (sem deslizar por construção); altura do centro de massa por chaves (corrida,
   penúltimo baixo, plant, decolagem, voo balístico, absorção do pouso).

Números de hoje (jog a 45°, pé esquerdo no chão no X): passos 1,15 e 0,75 m; decola a 1,58 m do aro, 0,59 s depois do X;
solta a 2,91 m de altura a 0,55 m do aro; cai embaixo do aro. Sprint: decola a 1,80 m.

## 5. O corpo (`LayupMotion`)

- Pelve na altura do plano, nunca acima do que a perna apoiada alcança (a diferença some suave quando o pé sai do chão).
- Tronco a partir da pose de repouso (ereta), com a inclinação por fase: à frente na passada longa, um pouco para trás no
  plant, quase ereto no voo, à frente no pouso. O clipe de bandeja da CMU só dá o tempo; ele afundava o jogador.
- Joelho de impulso sobe (coxa quase horizontal), perna da decolagem fica para trás, as duas descem para o pouso.
- Bola com caminho desenhado (pega → bolso do lado da mão → peito → rosto → soltura); palmas por IK com a orientação de cada
  finalização (por cima: palma para a tabela; finger roll/jelly/scoop: palma para cima). A outra mão vira braço de
  proteção. Follow-through e queda dos braços no pouso.

## 6. Soltura e acerto

`ShotModel` com o rating da bandeja menos a dificuldade da variação (euro −2, cradle −3, jelly −4, reversa −4, de força
+2…); o floater usa `ShotType.Floater`. Sem green (conta como "Boa"). Com tabela, `realizeLayupShot` procura a mira no vidro
que entra (ou um erro que bate no aro) conferindo na física da bola. O efeito (giro) é só visual por enquanto: a física de
contato não usa a velocidade angular.

## 7. Como testar

Com um `vite build` congelado servido por `vite preview` numa porta própria (o Vite da 5173 recarrega com as outras
sessões):

- `node tools/bandeja-video.mjs <cenários> <saída.mp4> [lado|perto|atras|cima|frente|jogo] [lento]` (cenários em
  `tools/cenarios-bandeja.mjs`; `LAB_BASE=http://127.0.0.1:<porta>`). Grava também `<saída>.json` por quadro.
- `node tools/sonda-bandeja.mjs <cenários> "<expressão>" [q0] [q1]`: expressão por quadro desde o gather.
- `node tools/sonda-rig.mjs`: medidas do esqueleto e eixos da mão.
- Vídeos da primeira entrega: `Saved/bandejas/` (`antes_bandeja_lado.mp4`, `bandejas_lado.mp4`, `bandejas_lado_lento.mp4`,
  `bandejas_atras.mp4`).

## 8. Próximos passos

1. ~~RS (Pro Stick) para floater, scoop, reversa e switchback/double throw~~ (feito, §3 e §9).
2. Comparar quadro a quadro com o real (SIKANA `Wp3nQOG4D4o` 36–41 s; floater `_LGKqZVQvzw` 98–100 s; euro do Giannis
   `LHV1Yt4pcTo` 11–13 s) e afinar passadas, inclinação e tempo da subida da bola.
3. Jelly e finger roll com o punho virando mais visível; troca de mão no ar; spin gather; double clutch.
4. Escolha do pacote de bandejas no menu (Padrão / Kyrie).
5. Defensor: contato, toco, mão de dentro contra o protetor (Fearless Finisher, Giant Slayer, Acrobat já ligados no modelo).
6. ~~Enterradas pelo mesmo plano, RS para escolher e requisitos pela build~~ (feito, §9). Falta: enterrada com contato
   (pôster, precisa de defensor), alley-oop, reversa e 360, skill dunk com medidor (RT + RS cima → baixo do 2K), altura do
   jogador pela build (o boneco tem 1,86 m fixo).

## 9. Enterradas (2026-10-16)

Código: as mesmas peças das bandejas. `HoopsLayup.ts`: finalizações `DunkOneHand`, `DunkTwoHand`, `Tomahawk`, `CockBack`,
`Windmill` (`isDunkFinish`), `chooseDunk`, `DunkTuning`, `startHang`/`dropHang` e o voo/pendurado/queda em `airborne`.
`LayupMotion.ts`: caminho da bola de cada enterrada (`dunkBallKeys`), mãos agarrando o aro (`dunkGrips`), pernas e tronco
pendurados. `LayupDriver.ts`: pedido `'dunk'`, `hangOnRelease`, `updateHang`, `forceDunk` (laboratório). `Freestyle.ts`:
RT + X vai para o plano (`tryLayup(..., dunk)`, `tryStandingDunk`), soltura que soca a bola pelo aro (`releaseLayup`).

| Situação | Enterrada |
|---|---|
| Correndo (> 2,2 m/s) | Sorteio pelo contexto: uma mão 45%, duas mãos 30%, tomahawk 15%, cock-back 10%; acima de 4 m/s entra o moinho (18%) |
| Devagar / parado perto do aro (até 2,1 m) | Dois pés: duas mãos (70%) ou cock-back; parado dá um pulinho de ajuste até embaixo da decolagem |
| Bola presa (hop step) com RT, perto do aro | Dois pés parada |
| Não alcança o aro (subida maior que a da Impulsão) ou fora da zona | Bandeja (ou arremesso), sem travar |

**Pela build** (`dunkAbility` em `HoopsLayup.ts`, `PlayRatings.dunk` em `build/BuildRatings.ts`; regra nossa com os números
do 2K26): enterra correndo e pendura com Enterrada em infiltração ≥ 55 e Impulsão ≥ 35 (o `canDunk` do builder, "Hangs Off
One"); parado com Enterrada parado ≥ 40; tomahawk e cock-back com Enterrada ≥ 70; moinho com Enterrada ≥ 78 e Impulsão ≥ 65.
Sem o requisito, a pedida vira a mais simples (moinho → tomahawk → uma mão; cock-back → duas mãos). A subida máxima vai
de ~0,89 m (Impulsão 25) a ~1,20 m (99); a build padrão (DD 80, SD 45, Vert 70) dá os 1,08 m de sempre e libera tudo.

- **Subida pela altura do aro:** a bola solta 6 cm acima do topo do aro, 7 cm à frente do centro; a subida do centro de
  massa sai disso e do alcance do braço do boneco (ombro -> punho 0,52 m; ~1,0 m de subida para 1,86 m). Decola a ~1,8 m
  do aro correndo. De uma mão, o corpo passa 20 cm para o outro lado (a bola fica do lado do ombro).
- **Soltura:** a bola é socada da mão para baixo pelo meio do aro (entra) ou contra o aro de trás (erra e espirra). Nos
  últimos quadros a bola converge para o ponto planejado mesmo se o braço não alcança inteiro.
- **Mão no aro:** sem pendurar, a mão toca a frente do aro ~0,15 s e o embalo cai a 8% (o corpo não atravessa a tabela).
- **Pendurado (X segurado na soltura):** agarra a frente do aro 0,07 s depois da soltura (uma ou duas mãos), o corpo
  assenta embaixo das mãos, 0,3 m à frente do centro, e balança como um pêndulo amortecido (11 cm, 1,25 s); de uma mão o
  corpo pende para o lado dela e a outra mão desce relaxada. Soltar o X (mínimo 0,3 s, máximo 2,6 s) solta o aro: queda
  livre, empurrando o aro 0,45 m/s para a quadra, absorção no pouso. A pelve pendurada é corrigida pelo erro real
  palma -> aro (a palma da mão espalmada fica à frente do punho): as palmas ficam a 3–8 cm do aro.
- **Fluidez (medida quadro a quadro, `sonda-bandeja.mjs`):** três estalos que já existiam nas bandejas saíram: na soltura
  a mão pulava 35–54 cm (a palma era lida antes do IK do quadro), no fim da bandeja a cabeça/pés pulavam 30–38 cm (a
  transição partia da pose crua do clipe: agora `Inertializer.capture()` guarda a pose desenhada), e o pé no ar pulava
  ~30 cm no começo do gather. Também: braços descendo depois da soltura mais devagar, mão relaxada sem girar 180°, pelve
  da bandeja parada descendo em 0,15 s.
- Cenários: `dunk_uma_mao`, `dunk_duas_maos`, `dunk_tomahawk`, `dunk_cockback`, `dunk_moinho` (`dunk` força a variação),
  `dunk_ala`, `dunk_frente`, `dunk_pendurado`, `dunk_pendurado_frente`, `dunk_pendurado_duas`; pelo RS: `rs_cima`,
  `rs_lado_scoop`, `rs_baixo_floater`, `rs_dunk_cima`, `rs_dunk_tomahawk`, `rs_dunk_pendura`. Vídeos:
  `Saved/bandejas/enterradas_variacoes.mp4`, `Saved/bandejas/enterrada_pendurado.mp4`, `Saved/bandejas/finalizacoes_rs.mp4`.
- Fluidez também na descida dos braços depois da soltura: a mão desce num arco pela frente do corpo (a reta passava rente
  ao ombro e o cotovelo virava, salto de ~0,4 m no floater).
- Testes: `HoopsLayup.test.ts` (enterrada pelo plano, pendurado, habilidade pela build), `game/LayupDriver.test.ts`
  (mapa do RS), `e2e/finish.spec.ts` (enterrada parada, pendurado com X e com RS, RS cima/baixo/lado, build sem
  enterrada, tolerância do RT).
