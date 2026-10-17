# Análise F: dribles NBA 2K27, vídeo 2 (19,5 s, 585 quadros)

Escopo: quadros 0–584 (0,00–19,47 s). Fontes: folhas s_000 a s_019 (lidas todas, 30 quadros por folha), `drible2/metricas.csv` e `transcricao.txt` (bloco 1, em inglês, com timestamps da fala). Confiança indicada em cada movimento.

Convenções:
- t = f / 30 (30 fps).
- S = tamanho do corpo (ombro médio até tornozelo médio), em pixels. 1 S ≈ 1,45 m.
- Quadril = altura do quadril / S (em pé ≈ 0,60; agachamento máximo ≈ 0,37).
- Base = distância entre tornozelos / S (pés paralelos ≈ 0,35; afastados ≈ 1,0; pés juntos ≈ 0,0).
- Tronco = inclinação em graus, + = para a direita da tela.
- Lados são da tela: + = direita. Wl / Wr = punho com rótulo esquerdo / direito do pose.
- Mão da bola inicial = punho Wl (−0,40 S, bola na mão, f0–16).

## 0. Limitações (leia antes de usar os números)

1. **Overlay do controle (setas, "hold turbo"): não verificado.** As folhas são recortes centrados no quadril e não mostram o topo do quadro, onde o overlay costuma aparecer. O vídeo-fonte não está no ambiente (procurei em Downloads, Videos, Documents e no temp). **A latência input→corpo não foi medida.** Só existe a narração.
2. **Narração e movimento não batem com precisão** (seção 1.1). Não use a narração para medir latência.
3. **Quadros duplicados (fps efetivo).** 60 quadros estão marcados PARADO (diff < 0,4), quase todos idênticos ao anterior (diff 0,0–0,07). A partir do f42 aparecem a cada 12 quadros (42, 54, 66, 78, 102, 114, 126, 138, 162, 174 ...), exceto nos múltiplos de 60 (90, 150, 210, 270, 330). A fonte tem cerca de 27,5 quadros reais por segundo, convertidos para 30. O vídeo B (`analise/B.md`) tem o mesmo padrão, então é característica da fonte. **Não há câmera lenta**: a mediana do diff por segundo fica entre 9 e 13 nos trechos de drible em movimento, e cai para 2–4 apenas em trechos parados (0–1 s, 5 s, 10 s, 15 s, 18 s), que são dribles no lugar. Trate o tempo como ±1 quadro.
4. **Cortes de plano** (diff ≥ 16 com troca de fundo e escala nas folhas): f41, f71, f125, f164, f193, f295, f342 e f455 (o 15,17 s da narração). Dentro de um plano os valores normalizados por S são confiáveis. Entre planos, valores absolutos (S_px, centro_x) não são comparáveis (S_px vai de 218 a 426).
5. **Bola: detector pouco confiável.** Em 0–29 pega bola de fundo de quadra (a bola da mão não aparece). Em 30–41 não há círculo. Em vários trechos dá altura negativa (−0,8 S, impossível) ou acima de 2 S (f474–501). Em 517–547 a lateral do CSV (+0,8 a +1,6) contradiz as folhas, que mostram a bola à esquerda. Para bola, uso as folhas; o CSV entra só quando a detecção é plausível.
6. **Rótulos L/R do pose trocam de lado em um quadro** (salto de 0,6–0,8 S) em f209–211, f227–231, f502 e f511–512. Por isso uso o lado da tela, não o rótulo.
7. **Lateralidade anatômica não confirmada.** Na maior parte do vídeo o jogador está de frente para a câmera (logo no peito), mas vira em trechos. Se estiver de frente, o punho Wl (esquerda da tela) é a mão direita dele. Confirme antes de rotular "mão direita/esquerda".
8. **Quiques (Q do CSV):** 21 detecções, das quais 9 têm altura negativa (f247, f256, f267, f286, f303, f312, f335, f340, f410) e são espúrias. As válidas estão na seção 2.6.

## 1. Linha do tempo

### 1.1 Narração × início visível no corpo

| Movimento (narração) | Janela da fala | Início visível | Diferença |
|---|---|---|---|
| M1 escape entre as pernas | 0,24 s (f7) | antecipação em f17 (0,57 s); pés abrem em f26–29 | +10 a +22 quadros |
| M2 cruzada de hesitação | 6,78 s (f203) | base já oscila desde f180 (6,00 s); fecha em f203 | a fala cai no fechamento de f203; a hesitação começa antes |
| M3 cruzada dupla | 11,76 s (f353) | pés abrem de 0,03 (f349) para 0,75 (f355) | fala 3 quadros depois do início |
| M4 entra e sai | 16,72 s (f501) | pés fecham de 1,19 (f499) para 0,39 (f507) | fala 2 quadros depois do início |

M2–M4 coincidem com a fala (±3 quadros). M1 começa cerca de 10 quadros depois da fala. Isso mostra só que a narração e o vídeo estão alinhados; não é medida de input.

### 1.2 Segmentos (classe provável)

| Quadros | Tempo (s) | O que acontece (evidência principal) | Classe |
|---|---|---|---|
| 0–16 | 0,00–0,53 | Parado, bola na mão esquerda da tela (Wl −0,40; altura 0,76 S). Duplicados em 0–10 e 14–16 | espera |
| 17–28 | 0,57–0,93 | Antecipação: Wl sobe a 0,93 S (f23); tronco −7,7° (f26); quadril 0,60 → 0,62 (f20–22) | antecipação M1 |
| 29–41 | 0,97–1,36 | Bola passa por baixo das pernas, da esquerda para a direita. Wl −0,27 (f29) → +0,19 (f39); Wr +0,12 (f29) → +0,74 (f41). Quadril 0,65 → 0,51 (f40). Tronco +33,7° (f40) | **escape entre as pernas (M1)** |
| 41 | 1,36 | corte de plano | |
| 42–50 | 1,40–1,66 | Pés cruzam: base 0,55 → 0,01 (f50). Quadril 0,52–0,53. Wr segura a bola à direita (+0,72 → +0,66, f42–48); Wl vai para −0,48 (f48) | passo cruzado (M1) |
| 51–60 | 1,70–2,00 | Abertura explosiva: base 0,05 → 1,00 (+0,11 S/quadro; pico de +0,12 a +0,15 em f53–57). Quadril cai 0,53 → 0,49 | saída (M1) |
| 58–67 | 1,93–2,23 | Segunda passagem, da direita para a esquerda: Wr +0,32 (f60) → −0,07 (f65); Wl −0,17 (f60) → −0,59 (f65). Tronco −34,3° (f66, pico). Quadril mínimo 0,47 (f66). Bola à esquerda baixa a partir de f67 | 2º passe M1 |
| 67–79 | 2,23–2,63 | Recuperação: pés juntos (base 0,02 em f76–79). Quadril sobe 0,47 → 0,53 (f71–76). Tronco −34 → −10° | recuperação M1 |
| 79–89 | 2,63–2,97 | Pés reabrem: base 0,01 → 1,03 (f89). Quique f88 à esquerda | reabre |
| 89–104 | 2,97–3,47 | Base larga (0,9–1,0), bola baixa à esquerda, quique f104. Quadril sobe 0,48 → 0,59 | drible em pé, afastado |
| 104–119 | 3,47–3,97 | Base 0,90 → 0,69 (f111) → 1,02 (f119). Quadril alto (0,61). Quique f119 | drible no lugar |
| 119–136 | 3,97–4,53 | Tronco para a direita, +30° (f124–127; pico +33,5°). Pés fecham: base 1,04 → 0,01 (f135). Wl varre da direita para a esquerda: +0,39 (f123) → −0,48 (f135). Quadril mínimo 0,49 (f124) | cruzada, direita → esquerda |
| 136–163 | 4,53–5,43 | Tronco para a esquerda: −16° (f143) → −37,6° (f151, pico). Quadril mínimo 0,44 (f149). Base 1,00 (f145) → 0,06 (f158). Bola à esquerda baixa; quique f145 | inclinação forte para a esquerda, pés fechando |
| 164 | 5,46 | corte de plano | |
| 164–180 | 5,46–6,00 | Plano novo. Quadril alto (0,60), tronco −9 a −13°. Bola à esquerda, altura 0,4–0,6 S. Quique f171 | drible no lugar, esquerda |
| 181–203 | 6,03–6,76 | **Hesitação com os pés**: base 0,64 → 1,02 (f188) → 0,29 (f195) → 0,82 (f201) → 0,23 (f203). Bola à direita na cintura (Wr +0,4; altura 1,6 S) a partir de f197. Tronco +20° (f190) | hesitação (pés) |
| 203–212 | 6,76–7,06 | **Cruzada horizontal**: bola vai da direita para a esquerda entre f208 e f216. Rótulos trocam em f209 (Wr +0,37 → −0,42). Tronco −16° (f212) | cruzada de hesitação (M2) |
| 212–223 | 7,06–7,43 | **Agachamento baixo**: quadril 0,39 (f217), o mínimo do vídeo. Bola baixa à esquerda, quique f216. Base 0,61 → 1,00 (f216) → 0,28 (f223) | passagem baixa (M2) |
| 223–240 | 7,43–8,00 | Base 0,28 → 0,80 (f229), depois 0,5. Bola à esquerda na cintura (altura 0,73–0,80 S) de f230 a f240 | reposição |
| 240–256 | 8,00–8,53 | Bola desce de 0,73 para 0,18 S (f255). Quadril 0,55–0,58. Tronco −7 a −13° | desce a bola |
| 256–299 | 8,53–9,97 | Drible no lugar, bola à esquerda. Corte em 295 (plano novo). Quiques em f272 e f298 | drible |
| 300–329 | 10,00–10,97 | Drible parado (diff mediano 2,1 por segundo). Tronco −6 a +2°. Base 0,54 → 0,41 → 0,49 | drible no lugar |
| 330–341 | 11,00–11,37 | Base abre 0,61 → 1,01 (f336), depois fecha para 0,71 (f341). Tronco +13° (f339). Wr vai para a direita (+0,77, f341) | preparação M3 |
| 342 | 11,40 | corte de plano | |
| 342–349 | 11,40–11,63 | Pés cruzam: base 0,71 → 0,03 (f349) | fim de M2 |
| 350–377 | 11,67–12,57 | **M3, passe 1 para a direita (lado da bola)**: base 0,03 → 0,76 (f356). Wr +0,39 (f356) → +0,58 (f370–376); bola à direita baixa (+0,40 a +0,60) | M3 parte 1 |
| 377–390 | 12,57–13,00 | Transição: bola vai para o centro (f388–392). Tronco +5 a +7° (f366–371) e volta a −2° (f381–383) | transição |
| 390–403 | 13,00–13,43 | **M3, passe 2 rápido para a esquerda ("away")**: bola de +0,37 (f390) para −0,73 (f403). Wl −0,10 (f395) → −0,77 (f402). Tronco +9° (f396) → −14° (f403) | M3 parte 2 |
| 403–412 | 13,43–13,73 | Agachamento: quadril 0,54 (f403) → 0,37 (f409), o mínimo de M3. Base 0,06 (f410) | agachamento M3 |
| 413–449 | 13,77–14,97 | Recuperação: quadril sobe 0,37 → 0,67 (f449). Base 0,06 → 0,5. Bola baixa à esquerda, altura 0,6–0,8 S | recuperação M3 |
| 450–473 | 15,00–15,77 | Corte em 455 (plano novo). Quadril 0,58–0,65. Tronco −6 a +4°. Bola à esquerda baixa (altura 0,1–0,4) | fim de M3 / drible |
| 474–495 | 15,80–16,50 | **Mão da bola à esquerda**: Wl −0,43 a −0,56 e altura 0,6–0,9 S; bola à esquerda nas folhas. Tronco −10° (f480–485), depois sobe para +11° (f496) | preparação M4 |
| 496–510 | 16,53–17,00 | **M4, "away": bola vai para a direita**. Wr +0,26 a +0,50 (f496–497). Tronco +11 a +18° (f510). Quadril 0,50–0,55 | M4 parte 1 |
| 499–507 | 16,63–16,90 | Pés fecham: base 1,19 (f499) → 0,39 (f507) | M4, pés |
| 511–530 | 17,03–17,67 | **M4, "back": bola volta para a esquerda** (folhas: bola esquerda baixa). Wl −0,35 a −0,45, altura 0,43–0,5 S. Tronco −8° (f517). Base 0,10 (f519), 0,01 (f528) | M4 parte 2 |
| 531–584 | 17,70–19,47 | Drible no lugar, bola à esquerda/centro. Tronco −10 a +18°. Base 0,3–1,0 | drible final |

Corte: depois de 455 não há corte até o fim (o plano muda de fundo, mas é câmera seguindo o jogador).

### 1.3 Sumário de fases (direção da bola nas folhas)

- Mão da bola esquerda: f0–29 (bola à esquerda); f474–495 (esquerda).
- Passe para a direita: f29–41 (M1); f350–377 (M3 parte 1, bola com a mão direita); f496–510 (M4 parte 1).
- Passe para a esquerda: f60–67 (M1 segundo passe); f209–216 (M2); f390–403 (M3 parte 2); f511–530 (M4 parte 2).

## 2. Movimentos

### 2.1 M1: escape entre as pernas (narração 0,24–6,78 s; núcleo f17–f79)

**Identificação.** Escape entre as pernas (between-the-legs escape), com dois passes por baixo das pernas e recuperação. Narração: "hold turbo and flick up diagonal towards your off-ball hand". Mão da bola inicial: Wl (esquerda da tela). Destino: Wr (direita da tela), a mão de apoio. Confiança alta para o primeiro passe (f29–41) e média para o segundo (f58–67).

**Entrada (input).** Narração em 0,24 s (f7). Primeira mudança corporal: f17 (0,57 s), com Wl subindo. Latência não medida. Estimativa indireta de 10 quadros (0,33 s) entre a fala e a primeira resposta, **não validada**.

**Fases:**

| Fase | Quadros | Duração | Dados |
|---|---|---|---|
| Antecipação | 17–28 | 0,37 s (11 quadros) | Wl_h 0,76 → 0,93 (f23) → 0,72 (f26). Tronco −1,2 → −7,7° (f26). Base 0,35 → 0,50 (f29). Quadril sobe 0,60 → 0,62 (f20–22) antes de agachar |
| Passe por baixo (E→D) | 29–41 | 0,40 s (12 quadros) | Wl: −0,27 (f29), −0,13 (f36), +0,19 (f39), −0,19 (f41). Wr: +0,12 (f29) → +0,74 (f41). Ponto de maior deslocamento: Wl +0,31 em f36–37 (possível ruído de pose). Quadril 0,65 → 0,51 (f40). Tronco +33,7° (f40). Rotação dos ombros cai para 0,20 em f38–39 (normal 0,28–0,33): o tronco vira |
| Passo cruzado | 38–50 | 0,40 s (12 quadros) | Base 0,90 (f38) → 0,01 (f50): os pés se cruzam. Wr segura a bola à direita (+0,72 a +0,66, f42–48). Wl volta para −0,48 (f48) |
| Explosão (saída) | 51–60 | 0,30 s (9 quadros) | Base 0,05 → 1,00. Máximo em f53–57 (+0,12 a +0,15 S/quadro). Quadril 0,53 → 0,49 |
| 2º passe (D→E) | 60–67 | 0,23 s (7 quadros) | Wr +0,32 (f60) → −0,20 (f66). Wl −0,17 (f60) → −0,59 (f65) → −0,73 (f70). Tronco +3 → −34° (f66). Quadril mínimo 0,47 (f66). Bola à esquerda baixa a partir de f67 |
| Recuperação | 67–79 | 0,40 s (12 quadros) | Pés juntos f76–79 (base 0,02). Quadril 0,47 → 0,53 (f71–76). Tronco −34 → −10°: overshoot seguido de volta |
| Reabertura | 79–89 | 0,33 s (10 quadros) | Base 0,01 → 1,03 (0,10 S/quadro). Quique f88 à esquerda |

**Pés.** Passo cruzado (f42–50): fecha 0,55 S em 8 quadros (0,27 s). Abertura explosiva (f51–60): abre 1,0 S em 9 quadros (0,30 s). A base fica perto do máximo só 1–3 quadros (f63–64: 1,08). Pés cruzam de novo em f76–79. Nenhum hop detectado.

**Quadril.** Cai 0,14 S em 11 quadros (f29–40, −0,013 S/quadro). Fica em 0,52–0,53 (f42–53) e desce até 0,47 (f58–66). Sobe 0,06 em 6 quadros (f71–76). A queda total de 0,13–0,15 S (≈ 0,2 m) é típica de um dribble baixo.

**Tronco e cabeça.** Varredura de +34° (f40) para −34° (f66) em 26 quadros (0,87 s), com pico de 7,7°/quadro (f35). Overshoot: o tronco passa do alvo e volta para −10° em 12 quadros. Torção dos ombros em f38–39, com o corpo girando junto à passada. A cabeça segue o tronco (não medida; leitura pelas folhas).

**Braços.** Wl sobe antes do passe (f17–23, altura 0,93 S), cai em f26–29 e leva a bola por baixo do corpo até perto do centro (Wl +0,19, f39). Wr recebe a bola em f38–41 (+0,67 a +0,74) e a segura à direita até f48. A mão de apoio acompanha a bola em vez de ficar parada.

**Bola.** Fica na mão esquerda até f29. Passa por baixo das pernas (f30–35, baixa, perto do chão, pelas folhas). Chega à mão direita em f40–41. Passa de novo por baixo em f60–67 (direita para a esquerda). Quique em f88 (esquerda).

**Feel.** Antecipação pequena e clara (11 quadros). Transição principal rápida (9–12 quadros). Pouco hold entre fases (1–3 quadros de máximo). Overshoot de tronco forte e curto (12 quadros de recuperação). A explosão está concentrada em 9 quadros (f51–60).

### 2.2 M2: cruzada de hesitação (narração 6,78–11,76 s; núcleo f181–212, combo até f349)

**Identificação.** Hesitação com os pés (duas batidas, sem trocar a bola), seguida de cruzada horizontal da mão da bola (direita da tela) para a mão de apoio (esquerda). Narração: "hold turbo and flick horizontally towards your off-ball hands". Confiança média: a hesitação (f181–203) é clara pelos pés; a cruzada (f203–212) depende da bola, que está mal detectada.

**Input.** Narração em 6,78 s (f203). A hesitação começa em f180–181 (6,00–6,03 s), **antes** da fala. A cruzada começa em f203, junto com a fala.

**Fases:**

| Fase | Quadros | Duração | Dados |
|---|---|---|---|
| Hesitação (feint de pés) | 181–203 | 0,73 s (22 quadros) | Base: 0,64 → 1,02 (f188–189) → 0,29 (f195) → 0,82 (f201) → 0,23 (f203). Duas batidas (f188 e f201) com fechamento entre elas (f195) |
| Cruzada | 203–212 | 0,30 s (9 quadros) | Bola da direita para a esquerda (f208–216). Tronco +20° (f190) → −16° (f212), ≈ 2°/quadro. Rótulos trocam em f209 (Wr +0,37 → −0,42) |
| Agachamento baixo | 212–223 | 0,37 s (11 quadros) | Quadril 0,39 (f217), o mínimo do vídeo. Bola baixa à esquerda, quique em f216. Base 0,61 → 1,00 (f216) → 0,28 (f223) |
| Reposição | 223–240 | 0,57 s (17 quadros) | Base 0,28 → 0,80 (f229) → 0,5. Bola à esquerda na cintura (altura 0,73–0,80 S) |

**Combo entre hesitação e cruzada.** Intervalo de 0 quadros: a cruzada começa no fim da 2ª batida de pé (f201–203). A janela de "hold turbo" da narração (6,78–11,76 s) cobre a cruzada e depois dribles no lugar até o início do M3 (f349).

**Pés.** Duas batidas (f188 e f201), com a base abrindo até 1,02 e fechando até 0,23. O fechamento de f203 (0,23 em 1 quadro) é grande para um movimento de pé, mas as folhas mostram pés se cruzando em f203–204.

**Quadril.** Sobe de 0,50 (f190) para 0,58 (f203) e desce até 0,39 (f217). A queda de 0,19 em 14 quadros (0,47 s) é a mais forte do trecho.

**Tronco.** +20° (f190) → −16° (f212): varredura de 36° em 22 quadros, mais lenta que a do M1.

**Braços.** A mão da bola (Wr, direita da tela) fica alta até f208 (altura 0,87 S). Depois troca de rótulo (f209) e desce, com punhos baixos (0,3–0,5 S) entre f212 e f223.

**Feel.** A hesitação tem tempo curto de resposta. A cruzada é mais lenta que o passe do M1. A pausa dos pés entre as duas batidas (f195) é a marca do feint.

### 2.3 M3: cruzada dupla (narração 11,76–16,72 s; núcleo f350–f449)

**Identificação.** Dupla cruzada: primeiro passe para a direita (lado da bola, ballhand), depois passe rápido para a esquerda ("away"). Narração: "flick towards your ballhand and then away from it quickly". Confiança média-alta para a ordem (direita → esquerda) e para os tempos. A bola tem leitura confiável (folhas) entre f350 e f412.

**Input.** Narração em 11,76 s (f353). Os pés começam a abrir em f350 (11,67 s), 3 quadros antes da fala.

**Fases:**

| Fase | Quadros | Duração | Dados |
|---|---|---|---|
| Abertura | 350–356 | 0,20 s (6 quadros) | Base 0,03 → 0,76 (f356), +0,12 S/quadro. Quadril 0,49 (f350) |
| 1º passe (bola à direita) | 356–377 | 0,70 s (21 quadros) | Wr +0,39 (f356) → +0,58 (f370–376). Bola à direita baixa (+0,40 a +0,60). Altura do punho 0,7–0,9 S. Base 0,76 → 0,6 |
| Transição | 377–390 | 0,43 s (13 quadros) | Bola vai para o centro (f388–392). Tronco volta a 0° |
| **2º passe (rápido, para a esquerda)** | 390–403 | 0,43 s (13 quadros); o deslocamento de 1,1 S dura 10 quadros (f393–403) | Bola de +0,37 (f390) para −0,73 (f403). Wl −0,10 (f395) → −0,77 (f402). Tronco +9° (f396) → −14° (f403) |
| Agachamento | 403–412 | 0,30 s (9 quadros) | Quadril 0,54 (f403) → 0,37 (f409), o mínimo de M3. Base 0,06 em f410 (pés se cruzam) |
| Recuperação | 413–449 | 1,20 s (36 quadros) | Quadril sobe 0,37 → 0,67 (f449). Base 0,06 → 0,5. Bola baixa à esquerda |

**Intervalo entre os dois passes.** Do fim do 1º passe (f377) ao início do 2º (f390): 13 quadros (0,43 s). A janela de decisão entre as duas partes é de cerca de 0,4 s.

**Pés.** Abertura rápida (f350–356), manutenção (f356–390), fechamento (f397–410). Pés cruzam em f410 (base 0,06), o mesmo gesto de M1, mas com o quadril mais baixo.

**Quadril.** 0,55 (f396) → 0,37 (f409): 0,18 em 13 quadros (0,43 s). É o agachamento mais profundo do vídeo, e vem junto do 2º passe.

**Tronco.** De +9° (f396) para −14° (f403): 23° em 7 quadros (3,3°/quadro). Gira mais rápido que o do M1 e dá a sensação de passe de saída.

**Feel.** O 1º passe lento (21 quadros, bola à direita) e o 2º passe rápido (10 quadros, bola da direita para a esquerda) criam o contraste típico da dupla. A recuperação de 36 quadros é longa: depois do 2º passe o corpo leva 1,2 s para subir de volta.

### 2.4 M4: entra e sai (narração 16,72–19,36 s; núcleo f496–530)

**Identificação.** Movimento de entra e sai (in-and-out / switchback): a bola sai do lado da mão da bola (esquerda) para a direita e volta para a esquerda. Narração: "flick away from your ballhand and then back". **Confiança média-baixa.** A bola do CSV é inconsistente entre f474 e f547. Por isso o lado da bola vem das folhas, e a posição dos punhos (Wl, Wr) é o apoio quantitativo.

**Input.** Narração em 16,72 s (f501). Os pés começam a fechar em f499 (1,19), 2 quadros antes da fala. O "away" (bola à direita) começa em f496, 5 quadros antes da fala.

**Fases:**

| Fase | Quadros | Duração | Dados |
|---|---|---|---|
| Preparação (bola à esquerda) | 474–495 | 0,7 s (22 quadros) | Wl −0,43 a −0,56, altura 0,6–0,9 S. Tronco −10° (f480–485), depois sobe a +11° (f496) |
| "Away" (bola à direita) | 496–510 | 0,47 s (15 quadros) | Wr +0,26 a +0,50. Tronco +11 → +18° (f510). Quadril 0,50–0,55. Base 1,19 → 0,39 (f499–507) |
| "Back" (bola à esquerda, baixa) | 511–530 | 0,63 s (20 quadros) | Wl −0,35 a −0,45, altura 0,43–0,5 S. Tronco −8° (f517). Base 0,10 (f519), 0,01 (f528): pés cruzam de novo |
| Drible final | 531–584 | 1,8 s | Bola à esquerda e no centro. Tronco −10 a +18°. Base 0,3–1,0 |

**Pés.** Fechamentos em f499–507 (1,19 → 0,39), f515–519 (0,75 → 0,10) e f525–528 (0,06 → 0,01). Entre f529 e f547 os pés abrem (0,09 → 0,46).

**Quadril.** Sem queda forte (0,49–0,55) até f547. Depois sobe para 0,60 (f548–557). Esse trecho final tem cara de drible no lugar.

**Tronco.** Ondas de −8° a +18° em cerca de 20 quadros (0,67 s).

**Feel.** M4 parece mais lento que M1–M3. As fases têm 9–20 quadros e não há explosão clara. É mais controle de bola do que saída.

### 2.5 Trechos sem movimento claro (drible no lugar)

- **f0–16 (0–0,53 s):** parado; duplicados em 0–10 e 14–16.
- **f300–329 (10,0–10,97 s):** drible no lugar, diff mediano de 2,1 por segundo, pouco movimento de pés.
- **f450–473 e f531–584:** drible no lugar, bola à esquerda ou centro, base 0,3–0,6.

### 2.6 Quiques válidos (CSV) e intervalos

| Quique (f) | Tempo (s) | Altura (S) | Intervalo (quadros) |
|---|---|---|---|
| 88 | 2,93 | 0,10 | — |
| 104 | 3,46 | 0,11 | 16 |
| 119 | 3,96 | 0,13 | 15 |
| 145 | 4,83 | 0,07 | 26 (falta um) |
| 171 | 5,69 | 0,14 | 26 (falta um) |
| 188 | 6,26 | −0,01 | 17 |
| 216 | 7,19 | 0,00 | 28 |
| 272 | 9,05 | 0,05 | 56 (faltam dois) |
| 298 | 9,92 | 0,14 | 26 |
| 425 | 14,17 | 0,08 | 127 (bola fora de detecção) |
| 452 | 15,07 | 0,07 | 27 |
| 468 | 15,60 | 0,10 | 16 |

Os intervalos de 26–28 quadros têm quique faltando no meio, então são menores do que parecem. Nas folhas, o drible parado tem bola subindo e descendo em ritmo de cerca de 8–15 quadros (0,27–0,5 s). Não resolvi o ritmo fino.

### 2.7 Combos: intervalos resumidos

| Combo | 1ª parte (f) | 2ª parte (f) | Intervalo | Observação |
|---|---|---|---|---|
| M2 (hesitação → cruzada) | 181–203 (feint) | 203–212 (cruzada) | 0 quadros (encadeado) | a 2ª batida de pé dispara a cruzada |
| M3 (dupla cruzada) | 350–377 (bola à direita) | 390–403 (bola à esquerda, rápida) | 13 quadros entre o fim e o início do 2º passe | o 2º passe dura 10 quadros |
| M1 (dois passes) | 29–41 (E→D) | 60–67 (D→E) | 19 quadros (0,63 s) | a 2ª passagem começa durante a recuperação do 1º |
| M4 (away → back) | 496–510 (bola à direita) | 511–530 (bola à esquerda) | 1 quadro | troca quase imediata |

## 3. Números-resumo

| Movimento | Janela (f) | Duração | Quadril (min) | Base (min → max) | Tronco (pico) | Velocidade (tronco / pés / punho) |
|---|---|---|---|---|---|---|
| Antecipação M1 | 17–28 | 0,37 s | 0,60 | 0,35 → 0,50 | −7,7° (f26) | — |
| Passe M1 (E→D) | 29–41 | 0,40 s | 0,51 (f40) | 0,50 → 0,90 | +33,7° (f40) | tronco 7,7°/q (f35); Wr +0,05 S/q em média |
| Passo cruzado M1 | 38–50 | 0,40 s | 0,52 | 0,90 → 0,01 | — | pés 0,07 S/q em média |
| Explosão M1 | 51–60 | 0,30 s | 0,49 (f57) | 0,05 → 1,00 | — | pés 0,11 S/q em média, pico 0,15 |
| 2º passe M1 (D→E) | 60–67 | 0,23 s | 0,47 (f66) | 1,00 → 1,08 | −34,3° (f66) | Wl −0,73 em 10 quadros |
| Recuperação M1 | 67–79 | 0,40 s | 0,47 → 0,53 | 0,94 → 0,02 | −34° → −10° | pés ≈ 0,07 S/q |
| Hesitação M2 | 181–203 | 0,73 s | 0,48 (f192) | 0,23 → 1,02 | +20° (f190) | pés até 0,8 S/q (f201–203) |
| Cruzada M2 | 203–212 | 0,30 s | 0,46 (f214) | 0,23 → 0,93 | +20° → −16° | tronco ≈ 2°/q |
| Agachamento M2 | 212–223 | 0,37 s | **0,39 (f217)** | 0,28 → 1,00 | −16° | — |
| Passe 1 M3 | 350–377 | 0,90 s | 0,49 (f350) | 0,03 → 0,76 | +7° (f368) | Wr +0,2 em 20 quadros |
| Passe 2 M3 (D→E) | 390–403 | 0,43 s | 0,59 → 0,54 | 0,47 → 1,04 (f398) | +9° → −14° | tronco 3,3°/q (f396–403); Wl −0,67 em 7 quadros |
| Agachamento M3 | 403–412 | 0,30 s | **0,37 (f409)** | 0,06 → 0,63 | −14° (f403) | — |
| M4 pés fecham | 499–507 | 0,27 s | 0,53 | 1,19 → 0,39 | +11° (f507) | pés ≈ 0,1 S/q |
| M4 back (cruza) | 511–528 | 0,57 s | 0,52–0,55 | 0,01 → 0,84 (f514) | −8° a +12° | — |

Observação sobre a velocidade dos punhos: Wr vai de +0,12 (f29) a +0,74 (f41), ou seja, 0,6 S em 12 quadros (≈ 0,05 S/quadro, cerca de 2,2 m/s com S = 1,45 m). O pico isolado de Wl +0,31 em f36–37 provavelmente é ruído de pose. O deslocamento de 1,0 S entre os punhos (f29–41) leva 12 quadros (0,40 s).

## 4. Regras para replicar

1. **Antecipação antes do passe por baixo das pernas:** 10–12 quadros (0,33–0,40 s). A mão da bola sobe ~0,15 S, o tronco inclina ~7–8° para o lado da bola e a base abre ~0,15 S. Só depois começa o empurrão. Não pule essa fase, é ela que dá sensação de peso.
2. **Passe por baixo das pernas:** a bola cruza ~1,0 S (de −0,27 a +0,74 entre os punhos) em 12 quadros (0,40 s), com ease-in-out. O quadril cai ~0,14 S (de 0,65 para 0,51) no mesmo intervalo. O tronco vai de ~0° a +34° (ou ao lado oposto), com pico de ~7–8°/quadro.
3. **Pés cruzados e saída explosiva:** feche a base de ~0,55 S para ~0,0 S em ~10 quadros (passo cruzado) e reabra de ~0,0 para ~1,0 S em ~9 quadros (0,11–0,15 S/quadro no meio). A abertura é a parte mais rápida do movimento.
4. **Overshoot do tronco:** o tronco ultrapassa o alvo em ~30% (de +34 para −34, com volta para −10 em 12 quadros). Dê uma curva de assentamento de 12–20 quadros para voltar ao centro.
5. **Hesitação com os pés:** duas batidas de base (1,0 e 0,8) com fechamento entre elas (0,3) em ~15–20 quadros (0,5–0,7 s). Não troque a mão nesse intervalo. Só então vem a cruzada.
6. **Cruzada de hesitação (M2):** intervalo de 0 quadro entre a 2ª batida e a cruzada (encadeado). A cruzada leva ~9 quadros (0,3 s), mais lenta que o passe do M1.
7. **Dupla cruzada (M3):** primeiro passe para o lado da bola em ~20 quadros (lento); transição de ~13 quadros; 2º passe para o lado oposto em ~10 quadros (mais rápido). O agachamento máximo (quadril ~0,37) vem junto do 2º passe. Recuperação de ~36 quadros (1,2 s).
8. **Bola no ar:** em passes entre as pernas, a bola fica perto do chão (altura ~0,1 S) por ~3–5 quadros. Em drible no lugar, o quique ocorre a cada ~0,25–0,5 s (hipótese; o detector perdeu quiques).
9. **Resposta a input (hipótese):** a primeira mudança corporal aparece ~10 quadros depois do início da fala, mas o overlay do controle não foi verificado. Não use esse número como meta sem medir a latência real no vídeo-fonte.
10. **Fps da fonte:** a fonte tem ~27,5 quadros reais por segundo (duplicado a cada 12). Para comparar animação, normalize a cadência ao tempo real. Não trate os duplicados como pausa.
11. **Feel geral:** transições principais de 9–12 quadros (0,3–0,4 s), holds de 1–3 quadros nos extremos e recuperação de 12–36 quadros. O movimento é rápido e "snappy" nos passes. A recuperação é mais lenta e pesada.

## 5. O que falta para fechar

- Obter o vídeo-fonte e verificar o overlay do controle (setas e "hold turbo") em 0–20, 200–205, 350–355 e 496–505. Com isso dá para medir a latência input → primeira mudança corporal em quadros. É o principal número que ainda falta.
- Refazer a detecção de bola com ROI em torno da mão e checar a altura contra o chão real. O detector atual não serve para altura nem ritmo fino.
- Confirmar a lateralidade (mão direita ou esquerda) com a orientação do jogador em cada trecho.
- M4 é o mais fraco. Revisar f496–547 quadro a quadro, com a bola marcada à mão.

Arquivos de apoio: `drible2/metricas.csv` (métricas por quadro), `drible2/folhas/s_000.jpg` a `s_019.jpg` (folhas de contato), `transcricao.txt` (bloco 1). Não copiei imagens para outro lugar.
