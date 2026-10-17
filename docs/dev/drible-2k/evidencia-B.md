# Análise B: dribles 12 s – 24 s (NBA 2K27, vídeo de referência)

Escopo: quadros 360–719 (11,97 s – 23,97 s), folhas s_012 a s_023, `metricas.csv`, `medidas.csv`, overlay do controle e transcrição (bloco 2).

## 0. Como ler este relatório (limitações)

- Tempo: tudo em tempo real do vídeo, 30 fps. A fonte tem cerca de 2,5 quadros duplicados por segundo (um a cada 12 quadros: 366, 378, 402, 414, 426, 438, 462, 474, 486, 498, 522, 534...). Os quadros duplicados contam no tempo; o movimento real aparece em passos de 12 quadros.
- Corte de câmera em 382 (12,73 s). Quadros 382–384 têm pose inválida (S_px 33–57). O quadro 385 também tem lean de −34°, que é lixo; a partir de 386 os dados são confiáveis.
- Detector de bola: pouco confiável. O `bola_altura` é medido em relação ao ponto médio dos tornozelos, não ao chão, e dá valores absurdos (2,0–2,4 S) em vários quadros. O círculo ciano sobre a cabeça entre 14,0 e 15,0 s é falso positivo (a bola real está na altura do quadril, como se vê nas folhas). Por isso não reporto altura de quique nem ritmo fino a partir do CSV; uso o CSV só para quadril, base, inclinação, rotação e centro, e as folhas para a trajetória da bola.
- Nomes de movimentos: incertos. A forma de cada movimento foi lida a olho nas folhas de 300 px, e a lateralidade (qual mão) é provável, não confirmada.
- Sobreposição de rótulos: o vídeo tem rótulos de texto ("DOUBLE BTB (LEFT/RIGHT)", "HOLD TURBO") e um controle com setas no overlay. As folhas são recortes no jogador, então não mostram o rótulo nem o controle; esses foram lidos nos quadros inteiros.
- Medidas de corpo: S ≈ 1,45 m. Quadril = altura do quadril em S (neutro ~0,55). Base = distância entre tornozelos em S (neutro ~0,75–0,80). Lean = graus, positivo = tela à direita. Rotação = largura aparente dos ombros em S (cai quando o tronco gira).

## 1. Linha do tempo do trecho

| Trecho | Quadros | Tempo (s) | O que aparece |
|---|---|---|---|
| M0 cruzamento de carregamento (herdado) | 355–381 | 11,83–12,70 | Overlay com as duas setas ↖ (11,83) e depois ↗ (11,90, mudança de entrada). Bola passa da mão direita do jogador (tela à esquerda) para a esquerda (tela à direita) por entre as pernas. |
| Corte de câmera | 382 | 12,73 | Overlay some. Rótulo "DOUBLE BTB (LEFT)" aparece em 383 (12,77). |
| M1 DOUBLE BTB, lado esquerdo | 382–443 | 12,73–14,80 (≈2,05 s) | Rótulo LEFT de 383 a 440. Quatro travamentos de base (pés juntos) em 13,20, 13,67, 14,10, 14,53. |
| M2 DOUBLE BTB, lado direito | 444–~487 | 14,80–~16,2 (≈1,5 s) | Rótulo RIGHT de 444 a 470 (confirmado). Travamentos de base em 15,17 e 15,67. |
| Transição para o overlay HOLD TURBO | 487–492 | ~16,2–16,4 | Controle e rótulo "HOLD TURBO" aparecem (confirmado em 492 e em 500). |
| M3 HOLD TURBO, entrada ↙ | 513 | 17,10 | Seta ↙ (direita). Pé se abre e o tronco inclina para a tela à esquerda. |
| M4 HOLD TURBO, entrada ↘ | 559 | 18,63 | Seta ↘ (direita). Pés cruzam (base cai a 0,00 em 569). Tronco vai a +15°. |
| M5 HOLD TURBO, entrada ↙ | 643 | 21,43 | Seta ↙ (direita). Pés cruzam em 644–652. Tronco vai a −11°. |
| Fim do overlay / corte | 708 | 23,60 | Setas somem. Próximo rótulo "JP COMBO X SGA STEPBACK" em 715 (23,83). |

Entradas do controle (overlay), medidas em cada quadro:
- Lado esquerdo (tela): ↖ em 355; ↗ em 357 a 381, ambos os sticks.
- Lado direito (tela): ↙ de 513 a 558; ↘ de 559 a 642; ↙ de 643 a 708. Lado esquerdo sem destaque nesse trecho.
- Durações das setas: ↙ 1,53 s (17,10–18,63); ↘ 2,80 s (18,63–21,43); ↙ 2,17 s (21,43–23,60).

Narração (bloco 2) se encaixa assim: "double from the left and the right" (10,7–16,0) corresponde ao DOUBLE BTB; "hold turbo and flick the right stick to the left side for the left side" (16,0–20,5) corresponde à sequência HOLD TURBO com setas. Nesta narração, a parte com setas diagonais para baixo não é o BTB duplo: as setas aparecem só no HOLD TURBO.

## 2. M0, cruzamento herdado (11,83–12,73)

- Entrada: seta ↗ em 357 (11,90). Antes, ↖ de 355 a 356 (11,83–11,87).
- Pés: base cai de 0,78 (363) para 0,39 (381) em 0,6 s. Os pés cruzam; não há passo largo.
- Quadril: sobe de 0,531 (363) para 0,556 (369–372) e fica ali.
- Tronco: lean de −19,9° (364) para +15,8° (376) em 12 quadros (0,4 s). Média ≈ 90°/s; pico ≈ 150°/s (−7,4° em 370 para +12,6° em 374).
- Bola: lado esquerdo da tela, na altura do quadril (360–366); desce e passa por entre as pernas (368–370, visível sob o corpo); aparece do lado direito da tela, baixa (371–376). Ela para no lado direito em 377–381 com a mão junto ao quadril.
- Reação à entrada ↗ (11,90): o tronco já vinha inclinando para a esquerda; a mudança para a direita começa em 364–366 (antes do corte), por isso não tiro latência limpa daqui.

## 3. M1 DOUBLE BTB, lado esquerdo (12,73–14,80)

Fases (quadros, a olho nas folhas):
1. 386–390 (12,87–13,00): bola cai do lado direito da tela (ombro-cintura) até o chão. Base 0,32–0,38.
2. 391–401 (13,03–13,37): a bola sobe do chão para o quadril-cotovelo do lado direito, o braço estende para fora. Base cai a 0,215 (396, 13,20) e depois sobe a 0,525 (401). Quadril 0,543–0,596 (quadril alto, 396–398).
3. 402–406 (13,40–13,53): mergulho. Quadril cai a 0,421 (406, mínimo do trecho). Base chega a 0,832 em 406 (passo largo). Tronco −7,7° a −11° (tela à esquerda).
4. 407–413 (13,57–13,77): pés cruzam, base cai a 0,180 (410, 13,67). Tronco a −15° (410). Bola passa de baixo para o lado esquerdo da tela e sobe.
5. 414–422 (13,80–14,07): tronco vira para a direita. Lean de −12,9° (414) para +8° (420) e +11,6° (423). Base 0,055 em 423 (14,10), pés juntos.
6. 423–440 (14,10–14,67): base abre até 0,748 (431, 14,37). Tronco vai a +25° (432) e depois +34,6° (437) — o pico mais alto do trecho. Quadril cai para 0,545–0,579 (ponto neutro ou um pouco acima). Bola alta na mão direita, no quadril.
7. 437–440 (14,57–14,67): base cai para 0,123 (435, 14,50) e 0,090 (436). Pés juntos de novo. Tronco volta a +31°.

Ritmo de travamentos (base perto de zero): 13,20, 13,67, 14,10, 14,53, intervalo médio 0,44 s (≈13 quadros).

Quiques (`ball_y` no chão, detector ruidoso, só ordem de grandeza): 12,97, 13,13, 13,37, 13,60, 13,90, 14,03, 14,40, 14,57. Intervalos 0,13–0,37 s, mediana ≈ 0,23 s (≈ 4,3 quiques/s).

## 4. M2 DOUBLE BTB, lado direito (14,80–~16,2)

- Início do rótulo RIGHT: 444 (14,80). A base chega ao pico 0,806 em 443 (14,77), então o quadril cai até 0,476 (444, 14,80). A transição não tem parada: o quadril já desce durante o pico de base.
- 445–457 (14,83–15,23): base cai para 0,172 (455, 15,17), tronco em +15–18° na tela à direita, quadril 0,528–0,549. Bola no lado direito, baixa (quadril a joelho).
- 458–466 (15,27–15,53): base abre para 0,725 (462, 15,40), depois fecha. Tronco vai de +14° para −2° (466). Quadril 0,486–0,551.
- 467–470 (15,57–15,67): base 0,00–0,06 (pés juntos, pé cruza). Bola sobe para a altura da cabeça-ombro do lado da tela esquerda (sheets 467–471). Tronco −6,8° a −12,9°.
- 471–480 (15,70–16,00): base reabre para 0,77 (477, 15,90). Tronco −17° a −26°.

Travamentos de base: 15,17 e 15,67 (intervalo 0,50 s, mais longo que no lado esquerdo). Quiques prováveis: 15,07, 15,37, 15,57, 15,73, com intervalo ≈ 0,2–0,3 s.

Ligação entre os dois lados: pelo que as folhas mostram, o direito começa enquanto o esquerdo ainda está no pico de base. Não há quadro parado entre os dois. O espaço entre o último travamento do lado esquerdo (14,53) e o primeiro do direito (15,17) é de 0,64 s, mas não é uma pausa: a base sobe e desce entre eles.

Duração do duplo: 12,73 → 16,2 = ≈3,5 s. Cada lado tem entre 2 e 4 travamentos de base. Não medi um BTB simples nesse trecho, então não comparo duplo com simples aqui.

Retorno à mão original: não consigo afirmar com confiança. As folhas sugerem que a bola volta ao lado direito no fim do duplo, mas o detector não confirma.

## 5. M3–M5, sequência HOLD TURBO (16,4–23,6)

### 5.1 Latência entrada → reação do corpo

| Entrada (quadro, s) | Seta | Lean começa a mudar | Base muda de sentido | Quadril cai | Pico |
|---|---|---|---|---|---|
| 513 (17,10) | ↙ | 516 (+3 quadros, 0,10 s) | 518–519 (+5/+6, 0,17–0,20 s) | 524 (+11, 0,37 s) | Quadril mínimo 0,460 em 536; base 0,62 em 529–535; lean −10,1° em 536 |
| 559 (18,63) | ↘ | 559–561 (0–2 quadros) | Base já vinha caindo desde 555; colapsa a 0,00 em 569 | 560–564 (quadril 0,491 em 564) | Lean +15,8° em 568 (+9 quadros) |
| 643 (21,43) | ↙ | 645 (+2 quadros, 0,07 s) | 644–652 (base de 0,66 em 644 para 0,007 em 652, ~8 quadros, 0,27 s) | 645–649 (quadril 0,480 em 649, +6 quadros) | Lean −11,0° em 651 |

Leitura: o corpo responde em 0–3 quadros (lean) e em 5–6 quadros (base). Em 17,10 e 18,63 a base já vinha se mexendo antes da seta (5 a 15 quadros antes), então o overlay parece aparecer um pouco depois do movimento real. Não dá para cravar a latência absoluta.

### 5.2 Movimento A (entrada ↙ em 17,10)

- 16,4–17,1 (492–512): quadril 0,55–0,58, base cai de 0,45 para 0,25; bola na lateral direita da tela, quadril a joelho.
- 17,10–17,30 (513–521): base mínima 0,210 em 517 (pés quase juntos), depois abre. Tronco para −2 a −3° (516–519).
- 17,30–17,67 (521–530): base abre de 0,275 para 0,62; tronco vai de −3 para −5°, depois para −10°. Quadril cai de 0,594 para 0,502.
- 17,67–17,87 (530–536): quadril chega ao mínimo 0,460 (536). Tronco em −10°. Base 0,60–0,62, mantida.
- Bola: lado direito da tela (17,1–17,2, quadril) → desce e cruza para a esquerda, baixa, no chão (537–539, 17,9–18,0).

### 5.3 Movimento B (entrada ↘ em 18,63)

- 18,40–18,63 (552–559): base já em queda de 0,70 (555) para 0,64 (559). Tronco vai de −11° para 0°.
- 18,63–18,97 (559–569): base 0,64 → 0,00 (pés cruzados). Tronco de 0,1° para +15,8° (568), tela à direita, coerente com ↘.
- 18,97–19,30 (569–579): pés reabrem; base de 0,00 para 0,15 (571) e 0,55 (580). Tronco +15°.
- 19,30–20,00 (579–600): tronco inclina de +15° para +34,6° (19,9, 597). Quadril 0,53–0,57. Bola dribla na lateral direita, na altura do joelho-quadril, com o braço estendido para a frente e para a direita.
- 20,00–20,30 (600–609): bola passa do lado direito para o esquerdo por baixo do corpo (aprox. 20,1–20,3). Tronco de +31,7° para −12,7°.

### 5.4 Movimento C (entrada ↙ em 21,43)

- 21,20–21,43 (636–643): tronco +11° a +14°, base 0,53–0,73 (aberta), bola à direita.
- 21,43–21,73 (643–652): tronco de +11° para −11° (651). Base 0,66 → 0,007 (652), pés cruzam. Quadril 0,555 → 0,480 (649) → 0,523 (652).
- 21,73–22,70 (652–682): bola vai para a esquerda da tela, no chão e na altura do quadril (659, 664, 668, 682 com quique). Base reabre para 0,8 (perna direita estendida para trás e para a direita, 672–677).
- 22,70–23,60 (682–708): bola na esquerda, altura do quadril-joelho; quadril 0,45–0,56; base 0,4–0,6; tronco −18° a +12°.

## 6. Chaining, transições e feel

- DOUBLE BTB: os dois lados se encadeiam sem parada. Pelo que se vê, o pé do lado de chegada abre a base enquanto o do lado de saída ainda não voltou ao neutro.
- A transição HOLD TURBO não tem BTB duplo nem cruzamento limpo; cada seta muda a direção do movimento seguinte em 0–3 quadros.
- Feel (a partir de números):
  - Rápido no pico: o tronco muda 10–15° em 2–4 quadros (pico 90–150°/s). Média no giro completo de 50–75°/s (21,43: +3,7° para −11° em 6 quadros, ≈ 73°/s; 18,63: +0,1° para +15,8° em 9 quadros, ≈ 52°/s).
  - Quadril desce em 0,2–0,45 s e volta em 0,4–0,5 s. Desce mais rápido que sobe.
  - Base colapsa em 6–8 quadros (0,2–0,27 s) e reabre em 0,2–0,4 s. Isso é o passo cruzado, rápido.
  - Overshoot: pequeno. Lean em 17,10 vai a −10,1° e volta para −2° em ~0,5 s; em 21,43 vai a −11° e volta para −3° em 0,3 s.
  - Antecipação: a base começa a fechar 5–15 quadros antes da seta em 17,10 e 18,63. Pode ser preparação do próprio movimento.
  - Responsividade: visualmente o personagem responde ao overlay em 0–3 quadros (0,03–0,1 s) no lean. Parece ágil, com pouca inércia.

## 7. Tabela de números por movimento

| Movimento | Duração | Latência entrada→reação | Quadril (mín., neutro ~0,55) | Base (faixa) | Lean (faixa) | Bola: altura na soltura/recepção | Intervalo de quique |
|---|---|---|---|---|---|---|---|
| M0 cruzamento herdado | 12,20–12,73 (0,5 s) | não medível (lean já mudava) | 0,531 (363), sobe a 0,556 | 0,78 → 0,39 | −20° → +16° | não medido com confiança (quadril a joelho) | — |
| M1 DOUBLE BTB esq. | 12,73–14,80 (2,05 s) | não há seta | 0,421 (13,53) | 0,055–0,832 | −15° a +34,6° | quadril (~1,0 m); base do tronco | ~0,23 s (mediana) |
| M2 DOUBLE BTB dir. | 14,80–16,2 (1,4 s) | não há seta | 0,476 (14,80) e 0,490 (15,5) | 0,00–0,77 | −26° a +18° | quadril a joelho | ~0,2–0,3 s |
| M3 HOLD ↙ (17,10) | 17,10–17,87 (0,8 s) | 3 quadros (lean), 5–6 (base) | 0,460 (17,87) | 0,21–0,62 | −2° a −10° | quadril (lado esquerdo, no chão em 17,9) | não medido |
| M4 HOLD ↘ (18,63) | 18,63–20,30 (1,7 s) | 0–2 quadros | 0,491 (18,80) | 0,00–0,70 | 0° a +34,6° (19,9) | quadril-joelho (lado direito) | não medido |
| M5 HOLD ↙ (21,43) | 21,43–23,60 (2,2 s) | 2 quadros (lean), 1–2 (base) | 0,480 (21,63) | 0,007–0,80 | +14° a −11° a +12° | quadril-joelho (lado esquerdo) | ~0,25–0,4 s (incerto) |

## 8. Regras para replicar

1. Base: largura de pé neutra ≈ 0,75–0,80 S (≈ 1,1–1,2 m). Em cada troca de mão, os pés cruzam até base ≈ 0,0–0,2 S e reabrem para 0,6–0,8 S em 0,35–0,45 s, com ease in-out.
2. Quadril: deslocar o centro de massa em queda de 0,08–0,13 S (≈ 0,12–0,19 m) a partir do neutro 0,55, mínimo 5–6 quadros depois do pico de abertura da base. Descida em 0,2–0,45 s, subida em 0,4–0,5 s.
3. Tronco: inclinar lateralmente ±10–15° na troca, em 6–9 quadros (0,2–0,3 s), para o lado da seta. Em sequências longas, chega a ±30–35°. Velocidade angular: pico 90–150°/s em 2–4 quadros, média 50–75°/s no giro completo.
4. Latência de entrada: resposta do tronco em 0–3 quadros após a seta; resposta da base em 5–6 quadros. Se a animação for disparada pelo input, o tronco deve começar no mesmo quadro ou no seguinte.
5. Ritmo de quique no DOUBLE BTB: intervalo médio 0,23 s (≈ 4,3 quiques/s), faixa 0,13–0,37 s. Um travamento de pés a cada dois quiques (≈ 0,44 s).
6. Encadeamento: o lado seguinte começa enquanto o anterior ainda está no pico da base (sobreposição de 0–2 quadros), sem frame parado. Não inserir pausa entre os lados.
7. Bola: a soltura acontece perto do quadril-joelho (estimativa visual), e a bola alcança o outro lado em ~0,2 s. Não medi altura de soltura nem de recepção com confiança; antes de usar esse número, medir em quadros de vídeo com a bola bem marcada.
8. Tempo: a fonte tem 2,5 quadros duplicados por segundo. Defina curvas em segundos reais, não em quadros da fonte.
9. Overshoot: sem overshoot grande. Tronco volta a −2/−3° do neutro em 0,3–0,5 s após o pico de −10°.

## Arquivos de apoio (dentro do scratchpad, nada copiado para fora)

- Tabela por quadro: `analise/tabela_B.py` (impressão). Dados: `drible/metricas.csv`.
- Setas do overlay: `analise/stick2_B.txt` (on/off e mudanças de direção, com ângulo pouco confiável). Direções confirmadas a olho em `analise/tira_sticks_B.png`.
- Rótulos e controle: `analise/tira_topo_B.png` (controle e rótulos), `analise/tira_rotulo_B.png` (transição LEFT → RIGHT em 441–444).
