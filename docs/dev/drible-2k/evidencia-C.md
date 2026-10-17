# Análise C: Jordan pull / breakdown → SGA step-back (23,0 s – 36,8 s)

Fonte: folhas s_023 a s_036 (todas lidas quadro a quadro), `drible/metricas.csv`, `drible/medidas.csv` (pontos do MediaPipe em pixels do quadro cheio 822×1506), quadros completos `drible/frames/f_NNNN.jpg` e transcrição (bloco `drible/audio.wav`).

Convenção de quadros: `f` = índice do CSV (começa em 0), `t = f/30` s. O arquivo do quadro é `f_(f+1)`. Verificado pelo pico de diferença entre f_0708 e f_0709 (mad 57,4), que corresponde ao `diff` 58,3 do CSV em f708.

---

## 0. Convenções e ressalvas (ler antes dos números)

- **Lado.** A câmera fica atrás do jogador, que está de costas para ela. Por isso "esquerda da tela" = lado ESQUERDO do jogador. Confirmado pelo CSV: `lpunho_lado` negativo no lado da bola em f690. Neste relatório E = esquerdo do jogador (tela-esquerda), D = direito (tela-direita). "Recuar" = ir na direção da câmera.
- **Cortes de plano.** Três cortes no trecho: 23,60 s (f708), 27,37 s (f821) e 36,80 s (f1104). Em cada um, S_px e os pontos saltam. Os quadros de corte (708, 821–822, 1104–1105) foram excluídos das estatísticas. A passagem da bola E→D (entre f700 e f708) não tem quadros legíveis: a bola some nos recortes de f701–707 e reaparece na D no corte.
- **Detector de bola.** O `bola_*` do CSV e o `ball_*` do medidas.csv marcam a cabeça em grande parte do trecho (f701–707, f708–728, f740–741, f753–759, f893–899 e outros). Por isso tudo sobre a bola é visual (folhas), com incerteza de cerca de 1 quadro e de uma altura de quadril.
- **Quique.** `quique` = 0 em todo o trecho. Intervalos de quique não foram medidos de forma confiável.
- **Quadros duplicados.** Os quadros marcados PARADO caem a cada 12 quadros (≈2,5 por segundo). Precisão temporal efetiva de ±0,04 s.
- **Escala.** S_px varia de 245 a 400 px no trecho (agachamento e aproximação da câmera mudam S). Conversões para metros usam S ≈ 1,45 m e não corrigem perspectiva. Trate como ordem de grandeza.
- **Métricas.** `quadril_altura` é a altura do quadril em S. Referência em pé = **0,58 S** (quantil 90 do clipe inteiro = 0,583; pico em pé no trecho = 0,578 em f904). `base_largura` é a distância entre tornozelos em S. `tronco_inclinacao` é em graus, + = tela-direita.

## 1. Overlay do controle (cor do indicador azul do analógico direito)

Detectado por contagem de pixels de destaque azul e confirmado por leitura visual das setas em recorte ampliado.

| Janela (f) | Tempo (s) | Estado do overlay |
|---|---|---|
| 643–707 | 21,43–23,57 | Seta **↙** (diagonal) mantida. Controle visível com "HOLD TURBO" |
| 708–820 | 23,60–27,33 | **Sem controle na tela** |
| 821–904 | 27,37–30,13 | Controle visível, **analógico neutro** (sem seta) |
| 905–924 | 30,17–30,80 | **↑** (0,63 s, 20 quadros) |
| 925–983 | 30,83–32,77 | **↓** (1,93 s, 59 quadros) |
| 984–1004 | 32,80–33,47 | **↑** (0,67 s, 21 quadros) |
| 1005–1063 | 33,50–35,43 | **↓** (1,93 s, 59 quadros) |
| 1064–1082 | 35,47–36,07 | **↑** (0,60 s, 19 quadros) |
| 1083–1103 | 36,10–36,77 | **↓** (cortado no corte de 36,8 s; a janela normal seria de ~59 quadros) |

Antes de 23 s há uma seta ↓ entre 20,0 e 21,4 s. Não foi analisada, por estar fora do intervalo.

**Discrepância com o briefing.** As setas não começam em ~27 s. Entre 23,6 e 30,13 s não há seta alguma. A primeira seta do bloco, ↑, aparece em 30,17 s. O controle fica neutro de 27,37 a 30,13 s, justamente quando o quadril afunda (28,7 s) e o pé E recua (29,1–29,7 s) (seção 3, M3). O overlay não é um registro confiável do input.

**Padrão das setas.** Os intervalos de ↓ são quase sempre de 59 quadros e os de ↑ de cerca de 20 quadros. O período completo é de 79–80 quadros (≈2,65 s). Essa regularidade sugere overlay roteirizado ou com defasagem, e não flicks humanos de ~0,6 s e ~2 s.

**Latência input → reação.** Não é mensurável com confiança. As viradas de tronco coincidem com as trocas de seta a menos de ±8 quadros, e em algumas transições o corpo começa a virar antes da troca:

- ↓→↑ em f984: o tronco começa a cair em f982 (+17,6° em f976 → +15,7° em f982 → +11,8° em f984).
- ↑→↓ em f1005: o tronco começa a cair em f996–998 (+1,3° → +0,4°) e chega a −15,7° em f1006.
- ↑ em f905: o tronco já vinha subindo desde f850 (−20,6°). Cruza zero em f908–909. A seta chega 3 quadros antes do cruzamento, no meio de uma reversão que já estava em curso.

Conclusão: a latência input→reação sai com sinal ≤ 0 (o corpo antecede a seta em 2–5 quadros nas transições f984 e f1005). Esse overlay não serve como relógio de input. Para medir latência de verdade, é preciso captura com o input registrado junto (ou 60–240 fps da própria tela).

## 2. Linha do tempo (resumo)

| Janela (f) | Tempo (s) | Movimento (identificação) | Mão da bola |
|---|---|---|---|
| 643–707 | 21,4–23,6 | Dribble baixo; início do pull (seta ↙ mantida) | E |
| 690–707 | 23,0–23,6 | **M1a: Jordan pull** (bola na E, quadril afunda e sobe; a bola some em 701–707) | E |
| 708–716 | 23,6–23,9 | **M1b: breakdown** (bola na D; cruza por entre as pernas e encosta no chão em f713–714 e f716) | D → E |
| 717–731 | 23,9–24,4 | Agacha fundo com bola baixa na E; base alarga e depois fecha (f732) | E |
| 732–745 | 24,4–24,9 | Bola sobe pela D até o ombro (punho D +0,53 S acima do quadril); pés se juntam em f732 (base 0,04) | D |
| 746–820 | 24,9–27,3 | **M2**: dribble baixo com trocas laterais (identificação incerta) | E ↔ D |
| 821–852 | 27,37–28,4 | **M3a**: corte + deslocamento lateral para a D (quadril x 292→507 px) | E |
| 853–905 | 28,4–30,2 | **M3b: SGA step-back**. Fundo em f861 (0,374). Bola sobe na D (até +0,52 S). Pé E recua. Depois volta | D → E |
| 905–1103 | 30,17–36,77 | **M4**: sequência com setas ↑/↓. Base larga, trocas de mão por baixo do corpo a cada ~0,7–1 s, tronco oscilando | E ↔ D |

Não há pausa entre M3 e M4. O overlay passa de neutro para ↑ sem interrupção do movimento.

---

## 3. Detalhe por movimento

### M1: Jordan pull → breakdown (23,0–24,4 s; f690–732)

**Identificação.** Pull com a bola na mão E (f690–707), passagem E→D no corte de 23,6 s, breakdown D→E por entre as pernas (f708–716) e carregamento na E (f717–731). Os nomes são prováveis e não confirmados pela transcrição, que só fala "Jordan pull breakdown combo".

**Fases (quadros; durações em s).**
- **Pull (E):** f690–707 (0,6 s). Bola baixa na E, altura do punho E +0,06 a +0,29 S acima do quadril. Quadril cai de 0,52 (f690) para 0,45 (f700) e sobe de novo para 0,48 (f707). A bola não aparece nos recortes de f701–707: fica escondida atrás da perna/braço E ou fora do quadro, e o detector marca a cabeça.
- **Corte:** f708.
- **Bola na D:** f708–711 (0,13 s). Bola na D na altura do quadril-peito (punho D +0,19 a +0,25 S acima do quadril).
- **Breakdown:** f712–716 (0,17 s). A bola vai da D para o centro e encosta no chão entre as pernas em f713–714; toca de novo em f716.
- **Captura na E:** f717–720 (0,13 s). Bola volta à E e o braço E desce e avança para a tela-esquerda (leitura visual).
- **Agachamento:** f721–731 (0,4 s). Quadril desce até o mínimo de **0,383 em f731 (24,37 s)**, queda de 0,20 S (−34% em relação a 0,58). Base alarga até 1,05 em f726 e depois fecha para 0,04–0,12 em f732.

**Pés.** Passo lateral da D (pé D para a tela-direita) durante o breakdown. Base vai de 0,49 (f708) para 1,05 (f726): abertura de ~0,56 S em ~0,6 s. Cruzamento de um quadro em f693 (base 0,03) e em f732 (base 0,04). Sem salto visível: o quadril não passa de 0,564 entre f690 e f732.

**Quadril / centro de massa.** Queda 0,52 → 0,383 (f690→f731) enquanto o centro vai para a E. Subida 0,38 → 0,55 em f731→f745 (0,17 S em 0,47 s).

**Tronco e cabeça.** Tronco começa em +1° (f690, levemente para a D, contrário à bola), vai a +9° (f706), passa a −20,1° (f726) e fica entre −10 e −15° até f745. Ou seja, o tronco se inclina para o lado da bola depois do breakdown. Cabeça estável: desvio padrão de (ombro médio − nariz)/S = 0,02 S. Inclinação dos ombros entre −0,05 e +0,10 S.

**Braços.** Braço E (com bola) desce até a altura do quadril-coxa e avança para a tela-esquerda. Braço D (fora da bola) fica dobrado ao lado do corpo durante o pull e sobe com a bola no breakdown.

**Bola.** Altura na E ≈ quadril (f690–707). Troca D→E em ~6 quadros (f712→f718). Dois contatos com o chão, f713–714 e f716, com intervalo de 2–3 quadros (dentro do cruzamento). Bola sobe à D até o ombro (+0,53 S acima do quadril) em f732–745.

**Encadeamento.** Não há pausa entre M1 e M2. A captura na E (f717–720) já se sobrepõe ao início do agachamento (f721), com ~0,1–0,2 s de sobreposição.

**Feel.** Antecipação: o quadril cai 0,07 S em 0,3 s antes do pull (f690–700). Troca de mão com o quadril alto (0,49–0,56 em f708–716); o agachamento profundo só vem depois da troca (f721–731). Recuperação: subida do quadril em 0,47 s (f731→f745). O tronco atinge o pico de inclinação (−20°, f726) cerca de 0,25 s depois que a bola chega à E (f718). Sem overshoot visível.

### M2: dribble baixo com trocas laterais (24,9–27,3 s; f746–820). Identificação incerta.

- Tronco vai de −18° (f746) a +23° (f765, 25,5 s, lado da bola D). Fica entre +4 e +18° até f790. Depois cai para −13 a −16° (f803–818, 26,8–27,3 s).
- Quadril entre 0,41 e 0,58. Mínimo 0,405 em f770 (25,67 s).
- Base entre 0,02 (f813, cruzamento de pés) e 1,18 (f805). Pés sem cruzamento completo além desse ponto.
- Bola (aproximado): baixa, sai da E (f750–752), passa pelo centro (f753–759) e vai à D (f760–769). Depois volta à E (f790–820). Quiques não medidos.
- Sem overlay de input (controle fora da tela).

### M3: SGA step-back (27,37–30,30 s; f821–910)

**Identificação.** Step-back com recuo do pé E. O deslocamento lateral prévio é para a D, e na fase final o corpo volta para a E.

**Fases (quadros; durações em s).**
- **Abertura / deslocamento lateral:** f821–852 (27,37–28,4). Quadril desloca de x=292 para x=507 px (+215 px ≈ 0,6 S, para a D). Tronco vai de +6° para −20,6° (f850), inclinado para o lado da bola E. Base chega a 1,06 (f852).
- **Fechamento e fundo:** f853–862 (28,4–28,7). Base cai para 0,04 em f864 (28,8 s, pés juntos). **Quadril mínimo 0,374 em f861 (28,70 s)**, −0,21 S (−36%). S_px cai para 249.
- **Bola na D:** f865–885 (28,8–29,5). Bola sobe na D até o ombro (punho D +0,52 S acima do quadril). Quadril sobe de 0,374 para 0,545 em f886 (29,53 s), em 0,83 s (0,21 S/s).
- **Recuo:** f877–898 (29,2–29,9). Pé E recua 148 px (y 1224→1372, ≈0,38 S) e o pé D 92 px (y 1152→1244, ≈0,24 S). Os pés se afastam lateralmente (E para a tela-esquerda, D para a tela-direita), com abertura de ~145 px (≈0,4 S). Tornozelos médios vão de y 1134 (f862) a 1303 (f893): +169 px ≈ 0,43 S de recuo (≈0,6 m, estimativa).
- **Retorno:** f899–910 (29,9–30,3). Corpo volta para a E (quadril x 516→359 px, −0,4 S) e avança (tornozelos 1303→1227, −0,2 S). Base de 0,44 a 0,46 em f904–906.

**Pés.** O pé E é o que recua e o que mais se move (≈0,38 S). O pé D (que segura o apoio durante o recuo) abre para a lateral e recua menos (≈0,24 S). Não identifiquei passo em voo: tornozelos e quadril não passam dos valores de chão. No step-back, o quadril não passa de 0,578 (f904).

**Quadril / centro de massa.** Fundo 0,374 (f861) → subida até 0,545 (f886) → pico 0,578 (f904). Recuo e subida começam quase juntos (f877 em diante).

**Tronco e cabeça.** Tronco −20,6° (f850) → −13,8 (f876) → −18,5 (f895) → +6 (f913) → +23 (f930, já em M4). Cabeça estável (desvio de 0,02 S). Ombros entre −0,1 e +0,1 S.

**Braços.** Braço D sobe com a bola até o ombro (punho D +0,52 S). Braço E fica baixo, ao lado do corpo, e pega a bola de volta em f893–910.

**Bola (aproximado).** E baixa (f822–852, quadril a joelho) → D baixa-média (f853–862) → D alta, ombro (f865–885) → D baixa (f886–892) → E baixa (f893–910). Os quadros exatos de troca e de quique não são medidos.

**Encadeamento.** M2 → M3 sem pausa (o corte de 27,37 s é a única descontinuidade). M3 → M4 sem pausa: o retorno de M3 (f899–910) já é o início do balanço de M4.

**Feel.** Antecipação longa e lenta: o deslocamento lateral leva 1,4 s (27,5→28,9) antes do recuo. O recuo em si é curto: 0,6 s (29,1→29,7) para ir e 0,4 s para voltar. Tronco muda ~45°/s em média. A subida do quadril (0,21 S/s) é mais lenta que o recuo. O corpo estabiliza em pé sem overshoot visível.

### M4: sequência com setas ↑/↓ (30,17–36,80 s; f905–1103)

**Identificação.** Sequência de trocas de mão por baixo do corpo (cruzamentos/hesitações encadeadas), com base larga, feita durante a janela de setas. A narração diz "flick up and then flick down" com turbo o tempo todo. Não mapeei cada troca de mão quadro a quadro. Sequência aproximada: E baixa (f900–905) → bola no chão central (f907–909) → D alta (f917–929) → D baixa (f930–935) → E ao ombro (f951–955) → D baixa-quadril (f960–978) → E quadril (f990–1004) → centro no chão (f1005–1020) → D (f1020–1040) → E (f1065–1100).

**Fases.** Ciclo de troca a cada ~0,7–1 s. Cada trecho de bola dura ~0,5 s e acompanha uma virada de tronco.

**Pés.** Base larga com cruzamentos ocasionais: 0,08 (f1027) a 1,27 (f1102). Pé de apoio e pé de passo alternam. Pico de 1,27 em f1102 (36,7 s), pouco antes do corte.

**Quadril.** Oscila entre 0,388 e 0,577. Mergulho mais forte em **f1021 (34,03 s)**, 0,388 (−0,19 S, −33%). Subidas até 0,577 em f1067 (35,57 s).

**Tronco.** Oscila entre −19,6 e +24,1°. Extremos (f, graus): +23,5 (930), +12,3 (957), +17,4 (976), −15,6 (1008), −14,8 (1018), −15,5 (1038), −19,6 (1057), +6,0 (1075), +18,5 (1090). Ritmo irregular: 0,5 a 2 s entre extremos.

**Braços e bola.** A mão da bola sobe ao ombro: E até +0,53 S (f936–1003) e D até +0,56 S (f1004–1103). A mão livre fica baixa, avança para o lado oposto e recolhe. Bola na altura do quadril-joelho nas trocas, e no ombro só nos picos.

**Encadeamento.** As setas ↑ ocorrem perto dos extremos do tronco (até ±8 quadros) e não parecem comandar o movimento (seção 1).

**Feel.** Ritmo mais lento e mais sustentado que M1 e M3. O balanço do tronco e a troca de mão têm a mesma escala de tempo.

---

## 4. Tabela-resumo numérica

| Movimento | Duração | Latência input→reação | Queda do quadril (mín. vs 0,58) | Base (S) | Tronco (graus) | Bola (soltar / pegar) | Intervalo de quique |
|---|---|---|---|---|---|---|---|
| M1 Pull → breakdown (23,0–24,4) | 1,4 s | Não medido. Seta ↙ mantida desde 21,43 s, antes do início | 0,383 em f731 (−0,20 S, −34%) | 0,03–1,05 (1,05 em f726; 0,03 em f693; 0,04 em f732) | +9 (f706) a −20 (f726) | Soltar D f708–711 (punho +0,19–0,25 S), pegar E f717–718. Contato com o chão f713–714 e f716 | Não medido |
| M2 Dribble lateral (24,9–27,3) | 2,4 s | Sem overlay | 0,405 em f770 (−0,175 S, −30%) | 0,02 (f813)–1,18 (f805) | −18 a +23 (f765) | Baixa (quadril a joelho). Troca E→D ~25,1 s (aprox.) | Não medido |
| M3 SGA step-back (27,4–30,3) | 2,9 s | Seta ↑ em 30,17 s, com o corpo já voltando desde 29,9 s. Latência ≤ 0 | 0,374 em f861 (−0,21 S, −36%) | 0,04 (f864)–1,06 (f852) | −20,6 (f850) a +7 (f913) | Soltar D (ombro +0,52 S) f865–885; pegar E f893–910 | Não medido |
| M4 Sequência ↑/↓ (30,2–36,8) | 6,6 s | Setas ↑/↓ viram a ±8 quadros dos extremos do tronco; corpo antecede a seta em 2–5 quadros em f984 e f1005 | 0,388 em f1021 (−0,19 S, −33%) | 0,08 (f1027)–1,27 (f1102) | −20 a +24 (f930) | Trocas a cada 0,7–1 s; ombro até +0,53–0,56 S | Não medido |

Velocidades e tempos derivados: tronco ~30–45°/s típico, pico de ~75°/s (f1064–1070). Subida do quadril 0,21 S/s no step-back. Recuo do pé E 0,38 S em 0,6 s. Retorno em 0,4 s.

---

## 5. Regras para replicar

1. **Quadril.** Referência em pé 0,58 S. Pose de drible 0,45–0,52 S. Agachamento para pull e breakdown: mínimo 0,38 S em 0,4–0,5 s (queda de ~0,2 S, 34%). Step-back: mínimo 0,37 S (f861), subida a 0,545 em 0,8 s (0,21 S/s) e pico de 0,578 cerca de 1,4 s depois do mínimo.
2. **Troca de mão antes do agachamento.** Durante o breakdown o quadril fica entre 0,49 e 0,56 S (f708–716). O agachamento profundo começa só depois da troca (f721). Não abaixar antes de trocar de mão.
3. **Breakdown.** Bola por baixo das pernas, contato com o chão em f713–714 e de novo em f716 (intervalo de 2–3 quadros). Troca D→E em ~6 quadros (f712→f718).
4. **Pull.** Bola sobe até o ombro (punho +0,5 S acima do quadril), fica ~0,4–0,5 s e depois desce.
5. **Tronco.** Inclina para o lado da bola, com ±15–24°. Velocidade típica 30–45°/s e pico de ~75°/s. Exceção: no início do pull (f690–707) o tronco vai para o lado oposto (+9°).
6. **Cabeça.** Altura cabeça-ombro quase constante (desvio padrão 0,02 S). Ombros dentro de ±0,1 S.
7. **Base.** Largura entre tornozelos 0,5–1,1 S nas trocas. Cruzamento de pés (base ≤ 0,1 S) dura 1–2 quadros (f693, f732, f863–864). Step-back: deslocamento lateral de ~0,6 S em 1,4 s, depois recuo de 0,4 S em 0,6 s com o pé do lado da bola recuando primeiro (E ≈ 0,38 S, D ≈ 0,24 S), depois retorno de 0,4 S em 0,4 s.
8. **Encadeamento.** Sem pausa entre movimentos. Sobreposição observada de ~0,1–0,2 s: a captura E (f717–720) já se mistura com o início do agachamento (f721).
9. **Input.** Não usar o overlay como relógio. As viradas do corpo antecedem a seta em 2–5 quadros (f984, f1005) ou coincidem com ela em ±8 quadros. Latência input→reação ≈ 0 ou negativa. Medir com captura do input real antes de fixar valores em frames.
10. **Bola.** Não medida de forma confiável. Estimativa visual: contatos com o chão com 2–3 quadros de intervalo no breakdown. Intervalo de quique no dribble baixo não medido.

---

## 6. Limitações e próximos passos

- Overlay de input inconsistente com o briefing (seta só a partir de 30,17 s) e padrão de 59/20 quadros. Antes de tirar latência, confirmar com captura de input no próprio jogo.
- Detector de bola falha sobre a cabeça. Para trajetória da bola, rastrear por cor (bola laranja-marrom) só na região abaixo do ombro.
- Conversões para metros assumem S = 1,45 m e ignoram perspectiva. Valores em S são mais confiáveis do que em metros.
- M2 e M4 não foram mapeados quadro a quadro em cada troca de mão. Os intervalos são aproximados (±0,2 s).
- Cortes em 23,6, 27,4 e 36,8 s interrompem transições. A passagem E→D em 23,6 s e a entrada de M4 não estão em uma única tomada.

Scripts de leitura (métricas, detector de setas, tabelas de pés e quadril, estatísticas): `analise\scripts\`. Nenhum arquivo de projeto foi alterado.
