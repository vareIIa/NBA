# Análise D: drible atrás das costas em corrida (BTB), 36,0–51,0 s

Referência: NBA 2K27, vídeo de dicas de drible. Trecho analisado: sheets s_036 a s_050 (quadros 1080–1529), `metricas.csv`, `medidas.csv`, `transcricao.txt`, e os quadros inteiros `frames/f_NNNN.jpg` para ler o overlay. Nenhum arquivo do projeto foi alterado.

---

## 0. Resumo

- O trecho tem quatro blocos: (a) BTB parado com setas de analógico direito ↑ e depois ↓ (35,5–36,8 s); (b) BTB em corrida sem seta, em três cortes, com a legenda "RUNNING BTB" (36,8–41,3 s); (c) pausa com a bola segurada na cintura (41,4–42,6 s), com "HOLD TURBO" em 42,30 s; (d) duas corridas com seta, ambas com o corpo indo para o lado da seta: ↘ em 43,50–44,57 s e ↙ em 48,07–50,33 s.
- Arranques e paradas são quase instantâneos: a velocidade muda em 1 a 3 quadros (≈33–100 ms), sem curva de aceleração ou frenagem visível. Quatro paradas medidas: 38,47 s (no meio do BTB de ombro), 40,37 s, 44,57 s e 49,27 s.
- A bola responde à seta em 1 a 3 quadros quando a seta é a causa direta (48,07 s: o cruzamento começa no quadro 1443). Em 36,10 s a varredura já estava em curso e não mudou de forma visível.
- Nem sempre a seta marca o input. Em 43,30 s o corpo inverte de direção 5 quadros antes da seta ↘ aparecer (1305). Em 46,57 s o corpo começa a andar 8 quadros antes da seta ↑ (1405). Em 42,30 s a seta ↑ aparece sem qualquer mudança no movimento. Tratar o timing da seta como ±5 quadros.
- A velocidade se mantém durante o cruzamento da bola. Não há perda visível ao trocar de mão em corrida.
- Quique em corrida: intervalo de ~15 quadros (0,5 s) entre quiques visíveis. Pausas com a bola na cintura sem quicar duram de 0,4 a 1,3 s.
- Cadência de passos não foi medida com confiança (pose de tornozelo instável nesta vista). Nenhum número de passada é afirmado aqui.
- Cabeça praticamente nivelada: 0,55 S acima do quadril durante a corrida, com desvio de 0,03–0,05 S.

---

## 1. Convenções, método e limitações

- **Tempo:** quadro N = t N/30 s. O arquivo `f_(N+1).jpg` corresponde ao quadro N. A checagem com os cortes confirma: a troca de cena em 1104, 1171, 1227, 1369 e 1511 coincide com 36,80 / 39,03 / 40,90 / 45,63 / 50,37 s, que são os mesmos cortes da lista de cenas.
- **Lado:** a câmera fica atrás do jogador (a camisa "24" aparece de costas quase o tempo todo). Por isso "esquerda da tela" = lado direito do jogador (mão direita), e "direita da tela" = lado esquerdo do jogador. Isso vale para toda a análise.
- **Quadros duplicados:** 32 quadros entre 1080 e 1529 têm diferença quase nula (`diff` < 0,1). Eles caem a cada 12 quadros, com algumas lacunas de 24. A fonte equivale a ~27,5 fps reamostrada para 30 fps. Os tempos em segundos estão corretos, com precisão de ±1 quadro (33 ms). Para medir timing, use 27,5 fps efetivos.
- **Cortes:** a escala da câmera muda em cada corte. `S_px` não é comparável entre cenas. Use as métricas normalizadas (quadril/S, base/S, ângulos).
- **Pose e bola:** MediaPipe e o detector de bola são instáveis nesta vista de costas. Os tornozelos dão picos com intervalos de 1 a 12 quadros, e o detector às vezes marca a cabeça como bola (ex.: 1127, 1338–1343). `quique` ficou vazio na maior parte. `bola_altura` tem saltos espúrios. Por isso as alturas e os quiques da bola foram lidos nos sheets, e os números do CSV só entram como tendência.
- **Velocidade (proxy):** calculei o deslocamento do fundo (quadra) entre quadros consecutivos por correlação de fase, na faixa y 560–760 (abaixo do controle). Com câmera seguindo o jogador, esse deslocamento é a velocidade dele na tela. Convenção (inferida, não verificada por marcador): dx < 0 = jogador indo para a direita da tela; dx > 0 = indo para a esquerda. Conversão para m/s usa S ≈ 1,45 m e S_px do trecho. É uma estimativa de ordem de grandeza.
- **Overlay:** detectei por pixel a caixa azul clara com seta branca em duas posições fixas: caixa **D** (direita, centro ≈ x 505, y 305) e caixa **E** (esquerda, centro ≈ x 352, y 300). A direção foi validada visualmente em 1080–1083 (↑ → ↓), 1306 (↘) e 1321 (↘). A narração só fala do analógico direito. A caixa E fica no lugar do analógico esquerdo da arte do controle, mas isso é suposição: o significado dela não está confirmado.
- **Passada:** não medida. Os picos de tornozelo não são confiáveis e os intervalos variam de 1 a 12 quadros. Por isso não há número de passo por quique.

---

## 2. Linha do tempo (36,0–51,0 s)

| Tempo (s) | Quadros | Overlay (D = direita, E = esquerda) | Corpo / fundo | Bola | Legenda / corte |
|---|---|---|---|---|---|
| 35,47–36,07 | 1064–1082 | D ↑ (texto "HOLD TURBO" confirmado a partir de 36,00) | parado | BTB começa no lado de tela direita (lado esquerdo do jogador) | — |
| 36,00–36,07 | 1080–1082 | D ↑ | parado | mão estendida para o lado de tela direita, na altura do quadril/joelho | — |
| **36,10–36,77** | **1083–1103** | **D ↓** | parado (deriva ~2 px/q em y) | varre atrás do quadril e entre as pernas, para o lado de tela esquerda | — |
| **36,80** | **1104** | overlay some | corte | bola no lado de tela esquerda, baixa | "RUNNING BTB" aparece |
| 36,80–37,80 | 1104–1136 | sem overlay | virada: pan +12 a +13 px/q em 37,03–37,83 | bola sobe ao cós (1110–1121, sem quicar), desce e quica em 1132 (joelho, lado de tela esquerda) | — |
| **37,83–37,90** | **1135–1137** | sem overlay | **arranque**: pan +13 (1135) → −9 (1136) → −31 px/q (1137) | cruzamento à frente, baixo (1141–1143) | — |
| 38,00–38,40 | 1140–1152 | sem overlay | corrida para a direita da tela, pan −31 a −34 px/q | quica no lado direito em 1146 (chão); sobe no lado direito | — |
| 38,40–38,73 | 1152–1162 | sem overlay | corrida até 38,47; **parada em 1154–1156 (38,47–38,53)**: −34 → −17 → −5 → −2 px/q | BTB no ombro (1152–1157, oculta); quica no lado direito em 1162 (chão) | — |
| 38,73–39,00 | 1162–1170 | sem overlay | pan ≈ −2 px/q, deriva vertical +7 | bola no quadril direito, sem quica | — |
| **39,03** | **1171** | sem overlay | corte | bola no lado direito, quadril | nova cena |
| 39,20–39,80 | 1176–1194 | sem overlay | corrida para a esquerda da tela, pan +13 a +19 px/q | BTB: lado direito → atrás das costas (1187–1193) → por baixo para o lado esquerdo (1194–1199) | — |
| 39,90–40,30 | 1197–1209 | sem overlay | corrida para a esquerda, pan +13 a +26 px/q | quica no chão à esquerda em 1197 e 1212; oculta atrás do tronco em 1203–1208; reaparece à esquerda em 1209 | — |
| **40,33–40,40** | **1210–1212** | sem overlay | **parada abrupta**: +16,8 → +1,7 → +0,5 px/q | bola sobe à esquerda, na altura do quadril | — |
| 40,40–40,90 | 1212–1226 | sem overlay | parado, agachado (quadril 0,45–0,49) | bola à esquerda na altura do quadril (1215–1222); pés largos (1224–1226) | — |
| **40,90** | **1227** | sem overlay | corte | — | nova cena |
| 41,00–41,33 | 1230–1240 | sem overlay | parado | bola desce do quadril ao chão à esquerda em 1236 e volta à cintura em 1241 | "RUNNING BTB" some em ~41,3 s |
| **41,37–41,97** | **1241–1259** | controle visível **sem seta** a partir de 41,40 (1242) | parado; deriva ~0 | **bola segurada na cintura à esquerda, sem quicar** (~0,6 s) | — |
| 41,97–42,60 | 1259–1283 | controle sem seta | deriva lenta +6,3 px/q (~0,5 S/s) | bola segurada na cintura, sobe levemente | — |
| **42,30** | **1269** | **E ↑ + texto "HOLD TURBO"** | deriva +6,3 px/q, sem mudança | bola na cintura | — |
| 42,60–43,00 | 1278–1290 | E ↑ | deriva +6,7 px/q | bola desce (1284–1293) | — |
| **43,00–43,30** | **1290–1299** | E ↑ | deriva +7 px/q (para a esquerda) | quica no chão à frente-esquerda em 1293 | — |
| **43,30–43,33** | **1299–1300** | E ↑ | **inversão**: +7 → −15 px/q em 1–2 quadros (corpo vai para a direita) | sobe de novo ao cós | — |
| 43,37–43,50 | 1302–1305 | E ↑ | corrida −15 px/q | **bola parada na cintura, sem quicar** (1302–1307) | — |
| **43,50** | **1305** | **D ↘ + E ↑** (E some em 43,60) | corrida −15 a −16 px/q | bola ainda na cintura | — |
| 43,60–43,90 | 1308–1316 | D ↘ | corrida −15 a −16 px/q | **cruzamento à frente, baixo (joelho)**, da esquerda para a direita (começa em 1308, +3 q) | — |
| 43,90–44,50 | 1317–1335 | D ↘ | corrida −16 a −19 px/q, constante | quica no lado direito (1322, chão); sobe ao ombro direito (1326–1331) | — |
| 44,50–44,57 | 1335–1337 | D ↘ | corrida, pan −9 a −17 px/q | BTB no ombro, oculta atrás do tronco (1332–1343) | — |
| **44,57** | **1337** | **D some (soltar)** | desacelera | — | — |
| **44,60** | **1338** | — | **parada**: −9,5 → 0 → −1,3 px/q | bola reaparece no lado direito, quadril, descendo (1344–1349) | — |
| 44,63–45,50 | 1339–1368 | sem overlay | deriva −1,3 a −3 px/q | quica no lado direito (1353, chão), sobe até o ombro (1355–1367) | — |
| **45,63** | **1369** | sem overlay | corte; corpo quase parado (−1,5 px/q) | bola no lado esquerdo, quadril (1370–1373); chão abaixo do centro (1375–1378); lado direito (1379) | nova cena |
| 45,67–46,50 | 1370–1395 | sem overlay | parado | bola lado direito, quadril/joelho (1380–1385); oculta (1386–1397) | — |
| 46,00–46,50 | 1380–1399 | sem overlay | parado; **início de movimento em 1397–1399 (46,57–46,63)** | bola baixa entre as pernas (1398–1402) | — |
| **46,83** | **1405** | **E ↑** | corrida para a esquerda +7 px/q | bola à direita, quadril (1406–1421) | — |
| 47,00–47,90 | 1410–1439 | E ↑ | corrida para a esquerda +8 a +9 px/q | bola à direita; tronco vira para a direita (1422–1433), bola sai do quadro à direita (1428–1433); braço estendido à direita em altura de ombro (1434–1439) | — |
| **48,07** | **1442** | **D ↙** (E some em 48,17, quadro 1445) | corrida para a esquerda +9 a +10 px/q; **sem mudança** | bola na borda direita (1440–1442); **cruzamento baixo à frente em 1443–1444 (+1 q)** | — |
| 48,13–48,30 | 1445–1448 | D ↙ | corrida +9 px/q | bola cruza para a esquerda (1445–1448) | — |
| 48,30–49,20 | 1449–1476 | D ↙ | corrida +9 a +10 px/q, deriva vertical +3 a +6 | quica no chão à esquerda (1449–1451); sobe à cintura à esquerda (1452–1462); atrás da cabeça (1464–1469); volta ao ombro/quadril esquerdo (1470–1476) | — |
| 49,20–49,27 | 1477–1478 | D ↙ | corrida +8,8 px/q | quica no chão à esquerda em 1480 (1479–1482) | — |
| **49,27** | **1478** | D ↙ | **parada abrupta**: +8,8 → +0,8 px/q em 1 quadro | — | — |
| 49,30–50,00 | 1479–1499 | D ↙ (ligado até 50,33) | parado (+0,3 a +0,6 px/q) | **pausa: bola na cintura, sem quicar (1488–1499, ~0,4 s)**; sobe um pouco na cintura à esquerda | — |
| 50,00–50,37 | 1500–1510 | D ↙ | parado, agachado (quadril 0,45–0,54) | bola baixa à frente das pernas, joelho/chão (1507–1510), quadro lateral esquerdo | — |
| **50,37** | **1511** | overlay some | corte | bola no lado esquerdo, quadril (1511–1512) | nova cena |
| 50,40–51,00 | 1512–1529 | sem overlay | parado, postura larga (base 0,64 S, quadril 0,49–0,51) | bola no lado esquerdo: desce ao joelho (1513–1517), sobe ao quadril (1518–1523), volta ao joelho (1524–1529) | — |

---

## 3. Movimento a movimento

### M0 — BTB parado, de costas para a câmera (35,47–36,77 s)
- **Identificação:** BTB em pé, com a bola saindo da mão do lado de tela direita (mão esquerda do jogador) para o lado de tela esquerda (mão direita). Setas: D ↑ de 35,47 a 36,07 (quadros 1064–1082) e D ↓ de 36,10 a 36,77 (quadros 1083–1103). Overlay some no corte (1104).
- **Fases:**
  - Antecipação: 1080–1085 (≈0,2 s). Braço estendido para o lado de tela direita, bola na altura do quadril-joelho.
  - Saída: a seta ↓ (1083) coincide com a varredura, que já estava em curso. A passagem atrás do quadril começa em 1086–1088 (3 a 5 quadros depois da seta).
  - Trajeto: 1086–1091 a bola passa atrás do quadril (altura de quadril). 1092–1094 fica oculta atrás das coxas. 1095–1097 aparece entre as pernas, na altura do joelho. 1098–1103 vai para o lado de tela esquerda e chega perto do chão (~1100).
  - Captura: 1104–1109 bola na mão de tela esquerda, altura do quadril.
  - Recuperação: 1110–1121 bola sobe até a cintura, sem quicar.
- **Quique:** nenhum quique claro em 1080–1121. O movimento é uma varredura baixa, não um quique.
- **Pés:** base larga, 1,1 S de separação (tornozelos). Não há passo, o jogador fica parado. Deriva da câmera de ~2 px/quadro em y e <1 px/quadro em x.
- **Tronco:** inclinação lateral oscila entre −19° e +20° (média +5°), em sincronia com a varredura da bola. Quadril 0,42–0,49 S (postura baixa).
- **Cabeça:** 0,69 S acima do quadril (postura baixa).

### M1 — BTB em corrida, sem seta (36,80–40,37 s)
Três cenas diferentes (cortes em 36,80, 39,03 e 40,90). A legenda "RUNNING BTB" fica na tela de 36,80 até ~41,3 s.

**M1a — início e virada (36,80–37,83 s).**
- 1104–1110: bola na mão do lado de tela esquerda, baixa.
- 1110–1121: bola sobe até a cintura, sem quicar. Não há passo nem translação (pan ~0), mas há uma virada: pan +12 a +13 px/q em 37,03–37,83 (a câmera gira e o corpo passa a ~3/4 da câmera).
- 1128–1131: bola desce; quique no chão em 1132 (37,73 s), na altura do joelho, lado de tela esquerda.

**M1b — corrida para a direita da tela (37,83–38,73 s).**
- Arranque em 1135–1137 (37,83–37,90 s): pan passa de +13 para −9 e depois −31 px/q em 3 quadros.
- Cruzamento à frente, baixo (altura do joelho), de tela esquerda para tela direita em 1141–1143.
- Quique no chão do lado direito em 1146 (38,20 s). Intervalo do quique anterior: 14 quadros.
- 1148–1153: a bola sobe no lado direito, até a altura do ombro.
- 1152–1157: BTB no ombro, parte da bola fica oculta atrás do tronco.
- Quique no chão do lado direito em 1162 (38,73 s). Intervalo: 16 quadros.
- Corrida para a direita: pan −31 a −34 px/q (≈4 m/s pelo proxy; ver seção 5).
- **Parada em 1154–1156 (38,47–38,53 s):** −34 → −17 → −5 → −2 px/q. Ela cai no meio do BTB de ombro (1152–1157).

**M1c — corrida para a esquerda da tela (39,03–40,37 s).**
- Corte em 1171 (39,03 s). A bola fica no lado direito, na altura do quadril (1175–1181).
- BTB em movimento: 1187–1193 a bola passa atrás das costas do lado direito, parcialmente oculta. 1194–1199 cruza por baixo para o lado de tela esquerda.
- Quique no chão do lado esquerdo em 1197 (39,90 s). Próximo quique em 1212 (40,40 s), intervalo de 15 quadros.
- 1203–1208: bola oculta atrás do tronco, por 6 quadros. Reaparece do lado de tela esquerda, baixa, em 1209.
- Corrida para a esquerda: pan +13 a +19 px/q em 39,5–40,3. Pico de +26 em 1209.
- **Parada abrupta em 1210–1212 (40,33–40,40 s):** +16,8 → +1,7 → +0,5 px/q. Sem desaceleração.

**M1d — parado e agachado (40,40–40,90 s).**
- Bola na altura do quadril, lado de tela esquerda, sem movimento (1215–1222). Quadril baixo (0,45–0,49 S). Pés largos (1224–1226).
- Corte em 1227 (40,90 s).

### M2 — pausa com bola na cintura e deriva lenta (40,90–43,00 s)
- 1230–1236: bola desce do quadril até o chão do lado de tela esquerda (quique em 1236, 41,20 s).
- 1237–1241: bola sobe de volta à cintura.
- **1241–1259 (41,37–41,97 s): bola segurada na cintura, sem quicar, por ~0,6 s.** O CSV mostra altura da bola quase constante (1,41 → 1,38), sem saltos.
- Deriva da câmera: +6,3 px/q (≈190 px/s, ~0,5 S/s, ≈0,7 m/s pelo proxy) entre 41,5 e 42,6 s. O corpo anda devagar com a bola segurada. Não é uma parada total.
- Controle aparece em 41,40 (1242) sem seta. Em 42,30 (1269) aparece o texto "HOLD TURBO" com seta E ↑, e o corpo não muda de movimento.
- Quique retomado: bola desce 1284–1293, quica no chão à frente-esquerda em 1293 (43,10 s).

### M3 — corrida BTB para a direita (R ↘ de 43,50 a 44,57 s; corrida começa em 43,30 s)
- Antes da seta: 1292–1298 o corpo anda para a esquerda da tela (+7 px/q).
- **Inversão em 1299–1300 (43,30–43,33 s):** +7 → −15 px/q em 1–2 quadros. O corpo muda de direção **5 quadros antes da seta ↘ (1305)**.
- Bola parada na cintura, à esquerda, sem quicar (1302–1307, ~0,2 s), enquanto o corpo já corre a −15 px/q.
- Seta D ↘ em 1305 (43,50). E ↑ continua até 1307 e some em 1308.
- Cruzamento à frente, baixo (joelho), de tela esquerda para tela direita, de 1308 a 1316. Começa 3 quadros depois da seta.
- 1317–1335: corrida para a direita a −16 a −19 px/q, sem perda de velocidade durante o cruzamento. Quique no chão do lado direito em 1322 (44,07 s), altura de joelho.
- 1326–1331: bola sobe no lado direito, até o ombro.
- 1332–1343: BTB no ombro. Bola oculta atrás do tronco. O detector marca a cabeça em 1341–1343 (não usar).
- 1344–1349: bola reaparece do lado direito, na altura do quadril, descendo. **Direção final não confirmada:** a bola parece voltar ao mesmo lado, o que sugere um BTB de "volta" e não de cruzamento. Vale checar em vídeo de mais resolução.
- **Soltar a seta (44,57 s, 1337):** o corpo para em 1338–1339 (−9,5 → 0 → −1,3 px/q). Parada em 1–2 quadros, sem desaceleração.
- Quique seguinte no chão do lado direito em 1353 (45,10 s). Intervalo de 31 quadros, mas a bola ficou oculta entre 1332 e 1343.

### M4 — deslocamento lento após M3 (44,60–45,63 s)
- Deriva −1,3 a −3 px/q (≈0,1 S/s). O corpo anda devagar para a direita.
- Bola no lado direito, subindo do quique (1353) até o ombro (1355–1367).

### M5 — reposicionamento e nova virada (45,63–46,57 s)
- Corte em 1369 (45,63 s). Nova cena, sem movimento de fundo (~ −1,5 px/q).
- Bola no lado esquerdo, na altura do quadril (1370–1373). Chão no centro, abaixo (1375–1378). Lado direito na altura do quadril (1379).
- Parado de 45,67 a 46,50 s.

### M6 — troca de lado parada, depois virada e arranque para a esquerda (46,00–47,90 s)
- Bola no lado direito, quadril/joelho (1380–1385). Oculta atrás do tronco (1386–1397).
- Baixa entre as pernas (1398–1402), no centro-esquerda da tela.
- **Início do movimento em 1397–1399 (46,57–46,63 s):** −0,7 → +3,2 → +7,2 px/q. Arranque abrupto, para a esquerda da tela.
- Seta E ↑ aparece em 1405 (46,83 s), 8 quadros depois do início do movimento.
- Corpo vira para a direita (1422–1433) e a bola sai do quadro à direita. Braço estendido à altura do ombro (1434–1439).
- Corrida para a esquerda com +8 a +9 px/q (47,0–47,9 s).

### M7 — corrida BTB para a esquerda (R ↙ de 48,07 a 50,33 s)
- **Seta D ↙ em 1442 (48,07 s).** A caixa E some em 1445 (48,17 s).
- **Latência da bola: 1 quadro.** Ela começa a cruzar em 1443 (quique baixo, centralizado, à frente das pernas). Cruzamento para a tela esquerda em 1445–1448 (6 quadros para completar).
- **Corpo não muda de direção:** pan +8,7 a +9,7 px/q em 48,0–48,4. A velocidade se mantém durante a troca de mão.
- Quique no chão à esquerda em 1449–1451 (48,30 s). Sobe à cintura à esquerda (1452–1462). Atrás da cabeça ou do ombro (1464–1469), com a mão alta.
- Volta ao lado esquerdo (1470–1476). Quique no chão à esquerda em 1480 (49,33 s). Intervalo de 31 quadros desde 1449, com trecho oculto entre 1464 e 1469.
- **Parada abrupta em 1478 (49,27 s):** +8,8 → +0,8 px/q em 1 quadro. A seta D ↙ continua ligada até 50,33 s, então a parada não coincide com soltar a seta.

### M8 — pausa com bola na cintura (49,30–50,00 s)
- 1488–1499 (~0,4 s): bola na cintura à esquerda, sem quicar. Corpo parado (+0,3 a +0,6 px/q). Quadril 0,50 S.
- Seta D ↙ continua ligada.

### M9 — cruzamento baixo à frente, agachado (50,00–50,37 s)
- 1500–1510: postura larga e agachada. Bola baixa à frente das pernas (1507–1510, joelho/chão), lado de tela esquerda.
- Corte em 1511 (50,37 s).

### M10 — nova cena, drible baixo à esquerda (50,37–51,00 s)
- Bola no quadril esquerdo (1511–1512), desce ao joelho (1513–1517), sobe ao quadril (1518–1523), volta ao joelho (1524–1529).
- Corpo quase parado (+0,5 px/q). Postura larga e agachada: quadril 0,49–0,51 S, base 0,64 S.

---

## 4. Pernas e passadas

- **Passada não medida.** Os picos de tornozelo não são confiáveis nesta vista (intervalos de 1 a 12 quadros), então não há número de passo.
- **Quique visível em corrida:** intervalo de 14 a 16 quadros (0,47–0,53 s) em trechos sem oclusão (1132 → 1146 → 1162; 1197 → 1212). Em trechos com a bola oculta, o intervalo sobe para 24–31 quadros. Não é possível afirmar 1 quique por passo.
- **Ritmo parado:** em pausas a bola não quica e o corpo fica parado (M2 parcial, M8). Nessas janelas não há passo nem quique.
- **Base de apoio (tornozelos / S):** BTB parado 1,11; postura de pé 0,51–0,53; pausa 0,51; corrida 0,24–0,31 (os tornozelos ficam quase juntos ou se cruzam); pausa baixa 0,33; postura larga final 0,64.
- **Quebra de ritmo:** a bola para de quicar nas pausas (41,4–42,6 s e 49,3–50,0 s). O corpo não para no mesmo instante: em 41,4 s o corpo anda devagar e em 49,3 s ele já parou. A "quebra" do ritmo é uma pausa com bola segurada, não uma troca de passada.

---

## 5. Quadril, centro de massa e velocidade

Janelas de análise (quadril = `quadril_altura`, S-normalizado; base = `base_largura`; inclinação = `tronco_inclinacao` com + para a direita da tela; rotação = `tronco_rotacao`; velocidade = deslocamento do fundo, px/quadro e S/s):

| Janela (s) | Estado | Quadril (S) média [mín–máx] | Base (S) | Inclinação (°) | Rotação | Fundo (px/q) | Velocidade proxy |
|---|---|---|---|---|---|---|---|
| 36,00–36,79 | BTB parado | 0,46 [0,42–0,49] | 1,11 | +5 [−19/+20] | 0,31 | ~0 (deriva y +2) | 0 |
| 36,80–37,60 | cena nova, virada | 0,58 [0,51–0,65] | 0,51 | +2 | 0,27 | +12 a +13 (37,03–37,83) | ~1,5 m/s (virada) |
| 37,60–39,00 | arranque + corrida | 0,55 [0,51–0,59] | 0,24 | −3 [−18/+16] | 0,27 | −31 a −34 (37,9–38,4); −2 (38,5–39,0) | ~4 m/s (pico) |
| 39,03–40,90 | corrida BTB (cena nova) | 0,54 [0,45–0,65] | 0,31 | −6 [−26/+11] | 0,27 | +13 a +19 (39,2–40,3); 0 (após 40,37) | 1,5–2,2 m/s |
| 40,90–41,40 | corte, parado | 0,59 | 0,53 | −2 | 0,27 | ~0 | 0 |
| 41,40–42,60 | segura bola, anda devagar | 0,57 [0,51–0,60] | 0,51 | +1 | 0,27 | +6,3 | ~0,7 m/s |
| 42,60–43,90 | corrida + inversão 43,30 | 0,54 [0,49–0,57] | 0,26 | −11 [−20/−3] | 0,27 | +7 → −15 (inversão em 43,30) | ~2 m/s |
| 43,90–45,60 | corrida até 44,57; depois lento | 0,55 [0,51–0,59] | 0,23 | +1 [−8/+9] | 0,28 | −16 a −19 até 44,57; −1,3 a −3 depois | 2,1–2,5 m/s; 0,1 S/s |
| 45,63–46,80 | corte, parado | 0,59 [0,55–0,69] | 0,18 | −7 (cena) | 0,23 | −1,5 | 0 |
| 46,80–48,00 | arranque para a esquerda | 0,56 [0,47–0,59] | 0,37 | −16 [−25/−9] | 0,25 | +6 a +9 | 1,0–1,3 m/s |
| 48,00–49,60 | corrida BTB; parada 49,27 | 0,54 [0,47–0,60] | 0,26 | −3 | 0,28 | +9 a +10 até 49,2; +0,8 depois | 1,0–1,3 m/s |
| 49,60–50,36 | pausa, parado | 0,50 [0,45–0,54] | 0,33 | +4 [+2/+8] | 0,31 | +0,3 a +0,6 | ~0 |
| 50,37–51,00 | corte, postura larga | 0,55 [0,49–0,58] | 0,64 | −3 | 0,29 | +0,5 | ~0 |

Leituras:
- **Quadril:** em corrida 0,54–0,56 S. Parado e agachado 0,46–0,50 S. Parado em pé 0,57–0,59 S. A variação dentro de uma janela é pequena (±0,05 S, com ruído de pose incluso).
- **Velocidade:** arranques e paradas ocorrem em 1–2 quadros. Trocas de direção também ocorrem em 1–2 quadros (43,30 s). Ao cruzar a bola durante a corrida, a velocidade fica constante.
- **Sentido de deslocamento:** alterna entre direita da tela (37,9–38,4 s; 43,3–44,6 s) e esquerda da tela (39,2–40,4 s; 46,6–49,3 s). Em cada corrida, o corpo se move para o lado para onde a bola vai (ver regra 4).
- **Ordem de grandeza:** a corrida de pico (37,9–38,4 s, ~1000 px/s) dá ~4 m/s pelo proxy. Esse valor é o mais incerto, porque o fundo pode incluir giro e zoom da câmera.

---

## 6. Tronco e cabeça

- **Inclinação lateral (+ = direita da tela):** em BTB parado oscila de −19° a +20° (média +5°), em sincronia com a varredura da bola. Em corrida: −3° (37,6–39,0), −6° (39,03–40,9), −11° (42,6–43,9, com a bola à esquerda), −16° (46,8–48,0, com a bola à direita e a virada). Em pausa: +4° (49,6–50,4). A inclinação não está ligada de forma simples ao lado da bola.
- **Rotação de ombro** (`tronco_rotacao`, largura aparente dos ombros / S): 0,27–0,31 com o tronco de costas. Cai para 0,17–0,18 nos quadros de corte (39,03 e 45,63): o tronco aparece mais de lado na nova cena (giro estimado de ~55°). Não é movimento contínuo e não entra nas médias.
- **Cabeça:** distância entre nariz e quadril, em S (pose com nariz visível):
  - Postura baixa (36,0–36,8): 0,69 ± 0,02.
  - Corrida (37,6–39,0; 43,9–45,6; 46,8–48,0; 48,0–49,6): 0,55–0,57, com desvio de 0,03–0,04.
  - Pausa (41,4–42,6): 0,55 ± 0,02.
  - Pausa final (49,6–50,4): 0,63 ± 0,06.
  - A cabeça fica nivelada durante a corrida. Não há oscilação visível de cabeça.

---

## 7. Braços

- **Mão da bola:** o BTB passa atrás do quadril (1088–1094, 1187–1193, 1203–1208) ou do ombro (1152–1157, 1332–1343). O cruzamento à frente é baixo, na altura do joelho (1141–1143, 1308–1316, 1443–1444, 1507–1510).
- **Braço livre:** em pausa fica estendido para fora e para trás (1260–1283, 1488–1499). Durante a corrida abre para os lados (1320–1331, 1434–1439). Não identifiquei um bombeio regular sincronizado com a passada.
- **Cotovelo do braço de condução:** perto do corpo nos cruzamentos baixos; alto, na altura do ombro, no BTB de ombro (1152–1157).

---

## 8. Bola

- **Quiques no chão (estimativa visual; altura de joelho ou abaixo):** 1132, 1146, 1162, 1197, 1212, 1236, 1293, 1322, 1353, 1449–1451, 1480, 1507–1510 (joelho), 1527–1529 (joelho).
- **Intervalos entre quiques visíveis:** 14 (1132→1146), 16 (1146→1162), 15 (1197→1212). Intervalos longos, com trechos ocultos ou pausa: 24 (1212→1236), 31 (1322→1353), 31 (1449→1480), 57 (1236→1293, com pausa).
- **Altura de soltura e captura (BTB parado):** soltura na altura do quadril (1083–1086), captura na altura do quadril esquerdo (1104–1109). A bola faz uma varredura baixa, não um quique.
- **Altura em corrida:** a bola fica entre o joelho (cruzamentos e quiques) e o ombro (BTB). Entre esses dois extremos, passa pela cintura.
- **Bola à frente do corpo:** só nos cruzamentos baixos (joelho), que passam à frente das pernas. Na cintura e no ombro a bola fica ao lado do tronco.
- **Pausa com bola segurada:** a bola fica na cintura, com movimento vertical pequeno (~0,1 S ao longo de ~0,6 s). Não identifiquei quique de baixa amplitude; a bola parece não sair da mão.

---

## 9. Encadeamento: drible e locomoção

- **BTB parado → corrida (36,8 → 37,8 s):** sem parada visível. A virada leva ~1 s, e o arranque (37,83 s) sai direto do movimento de virada.
- **Corrida BTB → pausa (40,37 → 41,37 s):** parada abrupta em 40,37. Sem deslocamento por ~0,9 s; a bola quica em 40,40 (1212) e 41,20 (1236).
- **Pausa → corrida com seta (42,6 → 43,30 s):** a inversão de direção (43,30) começa antes da seta (43,50). O drible continua no intervalo.
- **Seta ↘ → fim da corrida (43,50 → 44,57 s):** a corrida dura enquanto a seta está ligada. Ao soltar (44,57), o corpo para em 1–2 quadros.
- **Seta ↙ → corrida (48,07 s):** o corpo já andava para a esquerda desde 46,57. A seta não altera a velocidade, mas a bola cruza de imediato (1 quadro).
- **Parada natural (49,27 s):** o corpo para em 1–2 quadros, com a seta ↙ ainda ligada. A pausa com bola segurada começa em 49,30 e vai até 50,00.
- **Overlap:** o cruzamento da bola (começa em 1–3 quadros e dura 6–9) acontece durante a corrida, sem parar o corpo.

---

## 10. Sensação (feel)

- **Snappy:** arranque em 2 quadros (≈67 ms), inversão de direção em 1–2 quadros, parada em 1–2 quadros. Não há easing visível em nenhuma das três transições.
- **Responsividade da bola:** cruzamento começa 1 a 3 quadros após o input, quando a seta é a causa direta (48,07 s). A bola completa o cruzamento em 6–9 quadros (0,2–0,3 s).
- **Pausas:** a bola "segurada" (0,4–1,3 s) cria a sensação de carregar a bola antes de partir. É um tempo morto que dá o contraste entre pausa e corrida.
- **Descolamento seta/corpo:** a seta não é um timestamp confiável. Ela pode aparecer antes ou depois da reação do corpo, com diferença de até 8 quadros. Quem for replicar deve usar o movimento do corpo como referência de timing, não a seta.

---

## 11. Tabela-resumo por movimento

| Movimento | Tempo (s) | Entrada (seta) | Latência corpo | Latência bola | Corrida (proxy) | Quiques (intervalo, quadros) | Início / fim | Observações |
|---|---|---|---|---|---|---|---|---|
| M0 BTB parado | 35,47–36,77 | D ↑ (35,47) / D ↓ (36,10) | 0 (parado) | sem atraso visível (varredura já em curso) | 0 | sem quique; varredura baixa | — | BTB da mão esquerda à direita, joelho |
| M1a virada | 36,80–37,83 | — | — | — | pan +13 px/q (virada) | 1132 (joelho) | 37,83 | cena nova em 36,80 |
| M1b BTB corrida, direita | 37,83–38,73 | — | arranque em 2–3 q | — | 31–34 px/q (~4 m/s pico); para em 38,47 | 14, 16 | 37,83 / 38,73 | cruzamento à frente; BTB no ombro |
| M1c BTB corrida, esquerda | 39,03–40,37 | — | ~0 | — | 13–19 px/q (1,5–2,2 m/s) | 15 | 39,03 / 40,37 | corte 39,03; parada em 40,35 |
| M2 pausa com bola | 40,90–43,00 | E ↑ em 42,30 (sem reação) | — | — | 6,3 px/q (0,7 m/s) | 1236 (chão), pausa 1241–1259 | 41,37–42,60 | bola na cintura sem quicar 0,6–1,3 s |
| M3 corrida ↘ | 43,30–44,57 | D ↘ em 43,50 | −5 q (inversão antes da seta) | +3 q | 16–19 px/q (2–2,5 m/s) | 1322, 1353 | 43,30 / 44,60 | parada em 1–2 q ao soltar |
| M5/M6 arranque para a esquerda | 46,57–47,90 | E ↑ em 46,83 | arranque 46,57 (−8 q da seta) | — | 7–9 px/q (1,0–1,3 m/s) | — | 46,57 | virada para a direita e bola larga à direita |
| M7 corrida ↙ | 48,07–49,27 | D ↙ em 48,07 | 0 (já corria) | +1 q | 9–10 px/q (1,0–1,3 m/s) | 1449–1451, 1480 | 48,07 / 49,27 | parada em 1 q em 49,27 |
| M8 pausa com bola | 49,30–50,00 | D ↙ continua | parado | — | 0 | sem quique 1488–1499 | 49,27 / 50,00 | bola na cintura |
| M9/M10 cruzamento baixo e nova toma | 50,00–51,00 | D ↙ até 50,33; corte 50,37 | — | — | 0 | 1507–1510, 1527–1529 (joelho) | — | postura agachada, base 0,64 S |

---

## 12. Regras para replicar

1. **Latência entrada → bola:** a bola começa o cruzamento 1 a 3 quadros (33–100 ms) após o input. O cruzamento completo leva 6 a 9 quadros (0,2–0,3 s). Use 2 quadros como latência padrão.
2. **Arranque em corrida:** velocidade de 0 para plena em ≤ 2 quadros (≈67 ms), sem curva de aceleração.
3. **Parada:** para em ≤ 2 quadros (≈67 ms), sem desaceleração. Paradas em 38,47; 40,37; 44,57 (ao soltar a seta) e 49,27 s (sem soltar, com a seta ainda ligada) são todas abruptas. Se quiser um pouco de suavidade, faça no máximo 1 quadro de transição.
4. **Corrida do drible acompanha o lado da bola:** o corpo anda para o lado para onde a bola cruza. Ao trocar de mão em corrida, a velocidade se mantém (pan −16 a −19 px/q, 43,5–44,5 s; +8 a +10 px/q, 48,0–48,5 s).
5. **Inversão de direção:** troca de sinal em 1–2 quadros, sem frenagem prévia. Velocidade de corrida: 1,0–1,3 m/s em passo lento (a bola pode ser segurada), 1,5–2,5 m/s em corrida com BTB, e pico ~4 m/s (estimativa, o valor mais incerto).
6. **Quique em corrida:** 15 quadros (0,5 s) entre quiques com a bola visível. Em trechos com a bola oculta, o intervalo chega a 24–31 quadros, provavelmente com quiques ocultos.
7. **Pausa com bola segurada:** 0,4–1,3 s em que a bola fica na cintura sem quicar. Corpo parado (deriva ≤ 0,5 S/s) ou andando devagar. Modele como estado separado do quique, não como quique de baixa amplitude.
8. **Altura do quadril e cabeça:** quadril 0,46–0,50 S em postura baixa (BTB parado, pausa, agachado); 0,54–0,57 S em corrida; 0,57–0,59 S em pé. Cabeça 0,55–0,57 S acima do quadril em corrida, com desvio de 0,03–0,05 S (cabeça praticamente nivelada).
9. **Tronco:** oscilação lateral de ±20° durante passagens de BTB. Inclinação sustentada de −11° a −16° em duas corridas (42,6–43,9 e 46,8–48,0 s), sem relação simples com o lado da bola. Rotação de ombro cai para ~0,17 quando o tronco vira ~55° (giro estimado; nos cortes não vale).
10. **Base de apoio:** BTB parado 1,1 S (pés largos); pé 0,5 S; corrida 0,2–0,3 S (tornozelos quase juntos ou cruzados); pausa baixa 0,33 S; agachado 0,64 S.
11. **Trajetória do BTB:** a bola sai da mão, passa atrás do quadril ou do ombro e volta à frente, em 10 a 12 quadros (0,33–0,40 s). Em BTB de corrida, a bola fica no ombro ou no quadril na passagem atrás do corpo, e o cruzamento frontal fica na altura do joelho.
12. **Timing das setas:** tratar o timing da seta como ±5 quadros. Em 43,30 s o corpo reage 5 quadros antes da seta, e em 46,57 s, 8 quadros antes. Em 42,30 s a seta aparece sem reação visível. A seta não pode ser usada sozinha como referência de latência de input.

---

## 13. Limitações e próximos passos

- Para medir passada: é preciso vídeo a 60 fps, câmera lateral e pose confiável (ou telemetria do próprio jogo).
- Para validar a latência das setas: vídeo com HUD sincronizado ao input real (controle gravado junto), ou o registro de input do jogo.
- Confirmar o significado da caixa E (analógico esquerdo?) e a direção final do BTB de 44,0–44,9 s, que está oculto nos quadros.
- Os números de velocidade são proxy de deslocamento do fundo, não de simulação física. Use como referência relativa, não como constante absoluta.
