# Análise E: trecho final do vídeo (50.00 s a 61.90 s, quadros 1500 a 1857)

Fontes: folhas s_050 a s_061 (todas lidas, 358 quadros), `drible/metricas.csv` (linhas 1500 a 1857), `transcricao.txt` (bloco `drible/`). Tabela quadro a quadro: `analise/E_tabela.txt`. Janelas por instância: `analise/E_janelas.py`.

Legenda de confiança: alta = CSV e leitura visual concordam; média = só visual ou só CSV, com coerência; baixa = leitura incerta.

---

## 0. Limites da leitura (ler antes dos números)

- **Sem nomes de golpe no trecho.** A narração de 50 a 62 s é só encerramento ("...dropping the full youtube video on the bedroom moves..."; "Easy but effective turbo moves to learn"). Todos os nomes de golpe abaixo são identificação visual, com confiança indicada.
- **Normalização.** S = tamanho do corpo ≈ 1.45 m. `quadril` = altura do quadril / S. `base` = distância entre tornozelos / S. `tronco` = inclinação em graus, com + = tela-direita. `punho_altura` e `punho_lado` em unidades de S; `punho_lado` negativo = tela-esquerda. Os punhos batem com a leitura visual nos casos que checei (1530 a 1535, 1569 a 1572, 1650 a 1655, e 1554 a 1559 em recorte). Na primeira leitura de 1555 a 1559 eu tinha errado o lado; o punho estava certo. Uso o punho como proxy do lado da bola.
- **Detector de bola inválido nesta faixa.** `bola_altura` tem mediana 2.3 a 2.9 na maioria dos blocos, ou seja, a bola está travada na cabeça. Não usei `bola_*` nos números. Alturas da bola são estimativas visuais (± 0.2 S).
- **Cortes de cena (confirmados pelo `diff`).** 1511 (50.37 s, diff 73), 1686 (56.20 s, diff 36), 1754 (58.47 s, diff 125). Escurecimento (fade) de 1740 a 1753; quadros pretos 1750 a 1753 (sem pose). Faixa vermelha no topo, de 1703 a 1711, é provavelmente transição gráfica (não movimento).
- **1754 a 1769 é outra filmagem.** Modelo sem o número 24, vista frontal, quadra com pintura vermelha de arena (recorte conferido em 1754 e 1760). Não é o motor do jogo; não usar como referência. O retorno ao personagem "24" em 1770 não aparece como salto no `diff` (10.7), então a fronteira exata é incerta.
- **Quadros duplicados (PARADO).** Um quadro idêntico ao anterior a cada 12 quadros: 1506, 1518, 1529, 1542, 1553, 1565 ... 1841, 1852. Os tempos em segundos são reais; 11 de cada 12 quadros trazem movimento novo (fonte efetiva ≈ 27.5 fps convertida para 30).
- **Câmera.** Muda a cada corte e faz panorâmica. `centro_x` e `S_px` só são comparáveis dentro da mesma cena. Valores normalizados por S valem dentro de cada cena.

---

## 1. Estrutura do trecho

| Intervalo (s) | Quadros | Cena | O que aparece |
|---|---|---|---|
| 50.00 a 50.33 | 1500 a 1510 | A (quadra vermelha) | Drible vivo baixo, base média, bola perto do chão à frente-esquerda. Linha de base (seção A). |
| 50.37 a 56.17 | 1511 a 1685 | B (quadra de madeira) | Sequência longa de cruzamentos com pausas: I1 a I6. |
| 56.20 a 58.00 | 1686 a 1739 | C (corte em 1686) | I7 (agachamento e bola estendida), I8 (pausa com braços abertos), I9 (queda ao chão e cruzamento). Faixa vermelha 1703 a 1711. |
| 58.00 a 58.43 | 1740 a 1753 | C-escuro | Fade para preto. Sem pose confiável. |
| 58.47 a 58.97 | 1754 a 1769 | Outra filmagem | Ver seção 0. Não usado. |
| 59.00 a 61.90 | 1770 a 1857 | D (personagem "24", madeira) | I10 a I13: crossovers com inclinação forte, pausas e push-outs. |

Não há nenhum "parado" longo: a cada 10 a 15 quadros há troca de lado, pausa ou push. O trecho é uma cadeia contínua, sem respiro entre golpes.

---

## 2. A. Baseline (drible vivo sem golpe)

Não existe trecho de drible "parado" longo neste intervalo. O estado mais próximo do neutro é o início, 1500 a 1510 (cena A, 0.33 s):

| Métrica | Valor (1500 a 1510) | Observação |
|---|---|---|
| Quadril (S) | 0.45 a 0.51 (médio ≈ 0.48) | Agachamento leve. |
| Base, tornozelos (S) | 0.45 a 0.50 | ≈ 0.65 a 0.73 m entre tornozelos. |
| Tronco (graus) | +2 a +5 | Quase reto. |
| Rotação do tronco (ombros / S) | 0.30 a 0.34 | Tronco de frente para a câmera. |
| Punho da bola (lado / altura) | +0.31 a +0.41 / 0.49 a 0.54 | Mão da bola na altura do quadril, ao lado do corpo. |
| Punho livre (lado / altura) | −0.18 a −0.26 / 0.49 a 0.69 | Braço de fora levemente afastado. |

Leitura visual: a bola fica baixa, entre joelho e tornozelo, à frente-esquerda na tela; o quique não é resolvido quadro a quadro (1 a 3 quadros de contato). Cadência não medida diretamente. A estimativa do ritmo "vivo" é 0.33 a 0.40 s por quique, igual à de cruzamento, porque o trecho inteiro é feito de cruzamentos.

Vizinhança mais neutra depois do primeiro corte: 1806 a 1808 (base ≈ 0.6, quadril ≈ 0.50 a 0.52, tronco +11 a +16, quique no centro). Já um pouco inclinado para a direita.

Cabeça: quase estática, pouca oscilação (não medido). Pé de trás: calcanhar sobe no passo rápido (visual, 1681 a 1682 e 1688).

---

## 3. B. Instâncias (um golpe ou combinação por bloco)

Resumo numérico no fim da seção (3.14). Em cada bloco: identificação, fases, pés, quadril, tronco, braços, bola, encadeamento e leitura de "feel".

### I1. 1530 a 1559 (1.00 s), cena B. Confiança média.

- **Identificação.** Crossover esquerda para direita, pausa (hesitação) à direita e duplo cruzamento de volta. Nome provável: hesitation crossover combo, mas sem confirmação pelo áudio.
- **Fases.**
  - Antecipação, 1528 a 1530 (3 quadros): base abre para 0.95; tronco −8.6 em 1530 (inclina à esquerda); bola à esquerda (lado −0.45).
  - Cruzamento 1, 1530 a 1535 (5 quadros = 0.17 s): bola toca o chão no centro em 1532; lado +0.29 a +0.36 em 1534 a 1535. Tronco de −8.6 para +6.6 (15° em 5 quadros).
  - Pausa à direita, 1535 a 1549 (15 quadros = 0.50 s): bola na altura do quadril (punho 0.49 a 0.64); tronco +5 a +11.5 (pico 1537 a 1544); base 0.78 a 1.13 (pico em 1542).
  - Descida e cruzamento de volta, 1545 a 1550: bola desce do quadril ao centro (quique em 1550; base 0.81).
  - Duplo cruzamento, 1551 a 1559: esquerda em 1553 a 1554 (punho esquerdo −0.39 a −0.34), centro com quique em 1555 a 1556, direita em 1557 a 1559 (lado +0.29 a +0.47). Conferido em recorte.
  - Recuperação: tronco vai a +25 em 1559 e +33 em 1562, sem respiro para I2.
- **Pés.** Base 0.93 a 0.95 no início (aberta), 1.13 na pausa (pico), fecha até 0.78 no centro do cruzamento de volta (1551), reabre até 0.95 no final.
- **Quadril/centro de massa.** Cai de 0.56 (1535) para 0.48 (1542) durante a pausa e sobe a 0.59 em 1549, quando a bola desce. Não fica congelado: acompanha a descida da bola.
- **Tronco/cabeça.** Inclina para o lado da bola durante a pausa (+10 a +11.5). Rotação do tronco cai para 0.25 em 1559 (tronco vira para a direita).
- **Braços.** Braço da bola: cotovelo fletido, punho na altura do quadril. Braço de fora estendido à esquerda (lado −0.30 a −0.41) na altura da cintura (alt 0.54 a 0.64).
- **Bola.** Quique no centro em 1532, 1550, 1555 a 1556. Pausa com bola alta (quadril, alt ≈ 0.6), sem contato com o chão.
- **Encadeamento.** Sem respiro para I2 (tronco atinge +33 em 1562, e I2 começa com a bola subindo à esquerda).
- **Feel.** A pausa é lida como "segurar a bola": o tronco inclina e a base abre; o quadril cede 0.08 S ao longo dos 15 quadros. O cruzamento de volta é mais rápido (3 a 5 quadros) do que o de ida.

### I2. 1560 a 1580 (0.67 s), cena B. Confiança média-baixa.

- **Identificação.** Empurrão em arco para a esquerda com bola a ombro, depois cruzamento para a direita. Nome provável: push-out seguido de crossover.
- **Fases.**
  - 1560 a 1565: bola ao centro-chão (1563 a 1565 contato baixo); tronco +33 em 1562.
  - Subida em arco à esquerda, 1566 a 1572 (6 quadros): punho esquerdo de −0.25 para −0.50 e altura de 0.56 para 0.79 (pico em 1571, altura de ombro, braço estendido).
  - Queda, 1573 a 1575 (3 quadros): bola ao centro-chão (1574 a 1575, lado +0.09).
  - Saída à direita, 1576 a 1580: lado +0.21 a +0.38, bola baixa.
  - (Queda em 1574 a 1575: punho direito +0.09, bola no centro-chão.)
- **Pés.** Base 0.61 em 1571 para 1.07 em 1579 (abre durante o arco).
- **Quadril.** 0.57 (1563, alto) para 0.47 (1577, agachado). Desce a cada queda.
- **Tronco.** De +33 (1562) para −5 (1575): varredura de 38° em 13 quadros (≈ 3°/quadro), mais lenta que a de I1.
- **Braços.** Braço da bola estendido e alto (alt 0.79) no pico do arco. Braço livre à direita na altura do quadril (alt 0.4 a 0.6).
- **Bola.** Sobe em 5 quadros e cai em 3 a 4. Assimetria: a subida é mais lenta.
- **Encadeamento.** Entra direto da pausa de I1 e sai para I3.
- **Feel.** O arco é "empurrado": a bola sobe com a mão estendida e a varredura do tronco vem antes da bola.

### I3. 1593 a 1613 (0.67 s), cena B. Confiança média.

- **Identificação.** Bola empurrada no chão para a direita com passo cruzado (step-through), depois crossover para a esquerda. Nome provável: push lateral com passo cruzado.
- **Fases.**
  - 1593 a 1597: bola no chão e para longe à direita (rola ≈ 1 S); punho direito a 0.56 a 0.62 (altura do quadril).
  - 1597 a 1601: bola sobe ao quadril direito (punho direito 0.57 a 0.74).
  - 1602 a 1606: pausa à direita (quadril 0.56, lado +0.50 a +0.27).
  - 1607 a 1608: bola no centro-chão (quique).
  - 1609 a 1613: bola à esquerda (punho esquerdo −0.50 em 1612).
- **Pés.** Passo cruzado de 1594 a 1598: base cai de 0.56 (1593) para 0.01 (1596), ou seja, tornozelos juntos por 3 a 4 quadros. Depois abre até 0.97 (1608) e fecha para 0.66 (1613).
- **Quadril.** 0.49 a 0.50 no passo, sobe a 0.56 (1600 a 1602) com a bola à direita e desce a 0.48 no cruzamento (1612).
- **Tronco.** +18 (1595) para −20 (1612): 38° em 17 quadros. O trecho rápido é 1608 a 1612 (−1.5 para −20.1, ≈ 4.7°/quadro). Retorno leve para −19 em 1613.
- **Braços.** Braço direito estende a bola para fora (cotovelo quase reto), punho entre 0.56 e 0.74.
- **Bola.** Quique de cruzamento no centro (1607 a 1608).
- **Encadeamento.** Sai do passo cruzado direto para o crossover, sem pausa.
- **Feel.** Passo cruzado com ombros e quadril girando juntos; a bola é "entregue" para longe e recuperada no cruzamento.

### I4. 1614 a 1649 (1.17 s), cena B. Confiança alta para o ritmo.

- **Identificação.** Crossover contínuo, sem pausa, com três quiques no centro (1626 a 1627, 1635 a 1639, 1645 a 1646). Nome provável: crossover em sequência (variante do double crossover curto).
- **Fases (ciclo de 21 quadros = 0.70 s).**
  - Extremo esquerdo em 1622 (lado −0.49). Quique no centro em 1626 a 1627.
  - Extremo direito em 1631 (lado +0.51). Quique no centro em 1635 a 1639 (contato de 4 a 5 quadros, o mais longo do trecho).
  - Extremo esquerdo em 1643 (lado −0.47). Quique no centro em 1645 a 1646.
  - Extremo direito em 1648 a 1649 (lado +0.36).
- **Intervalos.** Extremo para centro: 4 a 5 quadros. Centro para extremo: 4 a 7 quadros. Meio-ciclo, ou seja, um quique a cada cruzamento: 10 quadros (0.33 s).
- **Pés.** Base de 0.17 (1618, passo cruzado) a 0.81 (1634); fecha para 0.39 a 0.45 em 1639 a 1645 (pés juntos no meio do ciclo).
- **Quadril.** 0.48 no extremo esquerdo (1623), 0.55 no extremo direito (1630 a 1631). Amplitude 0.07 S (≈ 0.10 m).
- **Tronco.** +16.8 (1632) para −20.6 (1643): ≈ 37° em 11 quadros, ≈ 3.4°/quadro. Mantém o pico 1 a 2 quadros em cada extremo.
- **Rotação do tronco.** 0.24 (extremo esquerdo, 1642) a 0.34 (1624).
- **Braços.** Os dois punhos entre 0.44 e 0.75 S. Mão da bola cruza por baixo da linha da cintura. Braço livre oposto estendido.
- **Encadeamento.** Não há pausa nos extremos; o quadril nunca congela. Cadência mecânica e muito regular.
- **Feel.** É o trecho mais "motor" do vídeo: intervalos iguais (10 e 10 quadros), tronco com varredura contínua e pico curto.

### I5. 1650 a 1673 (0.77 s), cena B. Confiança média.

- **Identificação.** Bola levantada ao ombro à direita (push-out alto), queda ao centro e cruzamento para a esquerda, com passo cruzado em 1670 a 1672. Nome provável: pick-up/push-out com hesitação.
- **Fases.**
  - Subida, 1650 a 1653 (3 quadros): punho direito de 0.72 para 0.94 (ombro).
  - Descida, 1654 a 1659 (6 quadros): 0.86 para 0.62, bola no centro-quadril (1658 a 1659).
  - Esquerda, 1662 a 1667: bola na altura 0.46 a 0.73 (ombro em 1665 a 1667), lado −0.35 a −0.41.
  - Queda à direita, 1668 a 1673: bola perto do chão à direita (visual, contato baixo).
- **Pés.** Base 0.90 (1661) para 0.15 (1671): passo cruzado 1670 a 1672 (3 quadros).
- **Quadril.** Sobe de 0.51 (1654) para 0.57 (1666 a 1667) enquanto a bola está no ombro. Inverso do crossover: o quadril sobe quando a bola sobe.
- **Tronco.** −13.8 (1653) para +6.3 (1666), depois −1.4 (1673).
- **Braços.** Braço da bola estendido e alto. Braço livre levemente afastado (alt 0.46 a 0.66).
- **Encadeamento.** Passagem limpa para I6 (bola já à direita).
- **Feel.** O push é mais lento para subir (3 quadros) do que para cair (6 a 9).

### I6. 1674 a 1685 (0.40 s), cena B. Confiança média-baixa.

- **Identificação.** Passo de corrida com bola à direita, lateral, tronco inclinado para a direita. Nome provável: running dribble. Não é behind-the-back.
- **Fases.** 1674 a 1676: bola no chão à direita (lado +0.24 a +0.40). 1677 a 1681: bola alta à direita (lado +0.45 a +0.68, altura até 0.76). 1682 a 1685: bola desce (lado +0.57 a +0.42).
- **Pés.** Base 0.89 (1679) para 0.17 (1684): fechamento em 5 quadros, passo rápido.
- **Quadril.** 0.54 a 0.57, estável.
- **Tronco.** +25.3 em 1681 (pico), depois +3 em 1685.
- **Centro (cx).** Desloca 0.9 S para a direita em 12 quadros. Pode ser movimento do corpo ou panorâmica; não confiável.
- **Feel.** Passo rápido com bola fora do corpo; o tronco segue a bola.

### I7. 1686 a 1703 (0.57 s), cena C (corte em 1686). Confiança média.

- **Identificação.** Agachamento profundo, cruzamento para a esquerda com bola estendida (push à esquerda). Nome provável: crossover baixo com empurrão.
- **Fases.**
  - 1686 a 1694: quadril desce de 0.53 para 0.40 (pico de agachamento em 1694), amplitude de 0.13 S em 8 quadros. Bola à direita na altura do quadril (alt 0.46 a 0.64).
  - 1695 a 1697: bola baixa à esquerda (alt 0.30 a 0.48, lado −0.35 a −0.44; mínimo 0.30 em 1697).
  - 1698 a 1700: bola sobe à esquerda, braço estendido (lado −0.56 para −0.65 em 1700, pico).
  - 1701 a 1703: bola sobe para o ombro (alt 0.48 para 0.59).
- **Pés.** Base 0.15 (1686, passo cruzado) para 0.85 (1697, aberta), depois 0.34 (1703): abre em 11 quadros.
- **Quadril.** 0.40 (1694) para 0.44 a 0.48 (1700 a 1703): sobe com o braço.
- **Tronco.** −3 (1686) para −15 (1689), −32 (1700, pico com a bola mais estendida), −18 (1703).
- **Encadeamento.** Entra do corte. Sai para I8 (pausa com bola à esquerda).
- **Feel.** O agachamento antecipa o empurrão em 6 a 8 quadros: o quadril cai antes da bola ir para a esquerda.

### I8. 1704 a 1725 (0.70 s), cena C. Confiança alta para "pausa".

- **Identificação.** Pausa com bola estendida à esquerda, braços abertos, e queda da bola ao quadril. Nome provável: hold/freeze de bola estendida (hesitação).
- **Fases.**
  - Pausa, 1704 a 1716 (13 quadros = 0.43 s): bola à esquerda, lado −0.44 a −0.55, punho esquerdo subindo de 0.64 para 0.92.
  - Braço direito também sobe (alt 0.93 em 1710 a 1714): postura de braços abertos.
  - Queda, 1716 a 1721 (6 quadros): bola desce do ombro (0.92) para o quadril (0.65).
  - 1721 a 1725: bola no quadril esquerdo (alt ≈ 0.48 a 0.50), iniciando I9.
- **Pés.** Base 0.10 (1706) para 0.91 (1725): passo cruzado seguido de abertura em 19 quadros.
- **Quadril.** 0.48 a 0.58: sobe até 0.58 (1710) durante a pausa (corpo se ergue com o braço), cai a 0.48 (1716 a 1718).
- **Tronco.** −12.5 (1704) para −2.3 (1721): endireita durante a pausa.
- **Feel.** A pausa é "congelada" nos ombros e tronco; a energia está nos braços. Ótimo exemplo de hold sem movimento de cabeça.

### I9. 1726 a 1737 (0.37 s), cena C. Confiança média-alta.

- **Identificação.** Queda ao chão no centro, cruzamento para a direita e volta à esquerda, com contato baixo. Nome provável: rocker/cruzamento baixo.
- **Fases.**
  - 1726 a 1728: bola no centro-chão (punhos 0.35 a 0.42), quadril cai até 0.42 a 0.43 (1727 a 1729).
  - 1729 a 1733: bola à direita baixa (lado +0.44 a +0.55, alt 0.48).
  - 1734 a 1736: cruzamento para a esquerda (lado +0.40 para +0.10 em 1736); quadril no mínimo de 0.34 (1736).
  - 1737: bola no chão à esquerda.
- **Pés.** Base 1.11 (1727) a 1.19 (1733), aberta no lado direito; fecha para 0.54 (1736) no cruzamento e 0.47 (1737).
- **Tronco.** −1.8 (1726) para +13.1 (1733), depois +5.9 (1736).
- **Feel.** Afunda mais no cruzamento baixo (0.34 é o mínimo do trecho sem cortes). Quadril e tronco fazem o trabalho juntos.

### I10. 1770 a 1787 (0.60 s), cena D (personagem "24"). Confiança alta.

- **Identificação.** Crossover esquerda para direita com inclinação forte e pausa à direita. Nome provável: crossover com inclinação (lean crossover) e pausa.
- **Fases.**
  - Extremo esquerdo em 1776 (lado −0.58, punho alt 0.45, na altura da coxa), quadril no mínimo de 0.43 (1775).
  - Quique no centro, 1778 a 1779 (punho direito 0.55 a 0.59).
  - Pausa à direita, 1782 a 1787 (6 quadros): lado +0.40 para +0.52 (1785).
- **Pés.** Base 0.96 (1776) para 0.06 (1785): passo cruzado em 1785 a 1786 (2 quadros abaixo de 0.2), depois 0.17 (1786).
- **Quadril.** 0.43 (1775) para 0.58 (1786): sobe 0.15 S (≈ 0.22 m) durante o cruzamento; pico no mesmo quadro do pico de inclinação.
- **Tronco.** −17.3 (1776) para +36.8 (1786): **54° em 10 quadros (5.4°/quadro)**, a maior varredura do trecho.
- **Rotação do tronco.** 0.20 em 1770 a 1771 (tronco virado), 0.32 em 1775 a 1777, 0.23 em 1785 a 1786.
- **Braços.** No extremo esquerdo, punho da bola estendido e baixo (alt 0.39 a 0.45). Na pausa à direita, punho da bola no quadril (alt 0.35 a 0.47) e braço livre subindo de 0.54 para 0.73.
- **Feel.** Tronco e quadril chegam ao lado de destino junto com a bola (picos em 1785 a 1786), e o quadril sobe nesse momento. É o crossover mais "teatral" do vídeo.

### I11. 1788 a 1805 (0.60 s), cena D. Confiança média.

- **Identificação.** Retorno à esquerda com bola alta (ombro), depois nova passagem à direita com passo cruzado em 1796 a 1798. Nome provável: crossover de ombro.
- **Fases.** 1788 a 1794: bola sobe à esquerda (punho 0.61 para 0.87, pico em 1794; lado −0.28 para −0.43). 1795 a 1799: cruza para a direita (lado −0.25 para +0.02). 1800 a 1805: bola à direita (lado +0.44 a +0.51).
- **Pés.** Base 0.34 (1790) para 0.01 (1797, passo cruzado), depois 0.65 (1803).
- **Quadril.** 0.46 a 0.53, pouca amplitude (0.07).
- **Tronco.** +33 (1788) para +9.6 (1796), depois +16 (1804 a 1805).
- **Feel.** A bola vai ao ombro e cruza para a direita em cerca de 7 quadros (1791 a 1798), e o quadril quase não se mexe (amplitude 0.07 S).

### I12. 1806 a 1829 (0.80 s), cena D. Confiança média.

- **Identificação.** Mistura: quique no centro, pausa à esquerda, quique no centro-esquerda, lado direito, push ao ombro direito, queda ao quadril direito.
- **Fases.**
  - 1806 a 1808: quique no centro (lado −0.12 para −0.09).
  - 1809 a 1817 (9 quadros): pausa à esquerda, lado −0.19 para −0.49 (pico em 1814 a 1815), punho 0.56 a 0.59.
  - 1818 a 1820: quique centro-esquerda (lado −0.33 para −0.15, quadril mínimo de 0.45 em 1820).
  - 1821 a 1823: bola à direita (lado +0.40 a +0.46, alt 0.51 a 0.65).
  - 1824 a 1826: push ao ombro direito (alt 0.85 para 0.96, subida em 3 a 4 quadros).
  - 1827 a 1829: queda ao quadril direito (alt 0.84 para 0.70).
- **Pés.** Base 0.32 (1816) para 0.82 (1823) para 0.38 (1828): abre e fecha em torno do push.
- **Quadril.** 0.53 (1809, alto na pausa) para 0.45 (1820 a 1822, agachado).
- **Tronco.** −17.4 (1814), +15.7 (1806, lado direito no início), voltando a −6 em 1829.
- **Feel.** A pausa à esquerda é mais longa que a de I1 (9 quadros); o push ao ombro é o movimento mais rápido de subida do bloco.

### I13. 1830 a 1857 (0.90 s, até o fim). Confiança média.

- **Identificação.** Sequência final de cruzamentos com quique no centro (1834 a 1835, 1844 a 1847) e fechamento. Nome provável: crossovers finais com push à direita.
- **Fases.**
  - 1830 a 1832: bola à direita (lado +0.15 a +0.21), quadril alto (0.55 a 0.56).
  - 1833 a 1835: quique centro-esquerda (lado −0.19 para −0.25, quadril 0.45 a 0.48).
  - 1836 a 1841: bola à esquerda (lado −0.31 para −0.53, alt 0.51 para 0.70). Base abre de 0.73 para 1.03.
  - 1842 a 1844: cruzamento (lado −0.40 para −0.16); quique no centro em 1844 (diff 25.8, um dos maiores fora dos cortes).
  - 1845 a 1847: bola à direita baixa (lado +0.18 a +0.22). Base 1.32 em 1845, o maior valor do trecho.
  - 1848 a 1851: bola à direita (lado +0.39 para +0.51, alt 0.45 a 0.47). Base fecha de 1.02 para 0.57. Tronco +15 para +21 (pico em 1849 a 1850).
  - 1852 a 1857: bola à direita com braço estendido (alt 0.46 a 0.58); tronco +20 para +14; quadril sobe para 0.55 no fim.
- **Pés.** Base de 1.32 (1845) a 0.36 (1855). Maior abertura do trecho.
- **Feel.** O final é o mais "solto": base muito aberta com quique baixo e pausa à direita no fim.

### 3.14 Resumo numérico por instância

Valores das janelas do CSV (mínimo e máximo). Tronco com sinal (+ = tela-direita). Punho e lado: L = punho esquerdo (tela), R = punho direito (tela), lado em unidades de S (− = tela-esquerda).

| Instância | Quadros | Duração (s) | Quadril (S) | Base (S) | Tronco (°) | Punho L alt | Punho R alt | Lado L | Lado R |
|---|---|---|---|---|---|---|---|---|---|
| I1 hesitation + duplo cruz. | 1530 a 1559 | 1.00 | 0.48 a 0.59 | 0.78 a 1.13 | −10.9 a +25.1 | 0.49 a 0.69 | 0.44 a 0.65 | −0.45 a −0.03 | 0.01 a 0.49 |
| I2 push-out + cruz. | 1560 a 1580 | 0.67 | 0.47 a 0.57 | 0.61 a 1.07 | −4.9 a +33.4 | 0.56 a 0.79 | 0.40 a 0.59 | −0.50 a −0.02 | 0.09 a 0.49 |
| I3 push no chão + passo cruz. | 1593 a 1613 | 0.67 | 0.48 a 0.56 | 0.01 a 0.97 | −20.1 a +18.0 | 0.44 a 0.84 | 0.56 a 0.74 | −0.50 a −0.15 | 0.06 a 0.51 |
| I4 crossover em sequência | 1614 a 1649 | 1.17 | 0.48 a 0.55 | 0.17 a 0.81 | −20.6 a +16.8 | 0.44 a 0.75 | 0.47 a 0.73 | −0.49 a −0.12 | 0.00 a 0.51 |
| I5 bola ao ombro + passo cruz. | 1650 a 1673 | 0.77 | 0.51 a 0.57 | 0.15 a 0.90 | −13.8 a +6.3 | 0.46 a 0.86 | 0.57 a 0.94 | −0.43 a −0.10 | 0.08 a 0.47 |
| I6 corrida lateral | 1674 a 1685 | 0.40 | 0.54 a 0.57 | 0.17 a 0.89 | −2.5 a +25.3 | 0.56 a 0.87 | 0.61 a 0.76 | −0.38 a −0.16 | 0.24 a 0.68 |
| I7 agachamento + push à esq. | 1686 a 1703 | 0.57 | 0.40 a 0.53 | 0.15 a 0.85 | −32.2 a −3.2 | 0.30 a 0.64 | 0.46 a 0.85 | −0.65 a −0.25 | −0.13 a 0.39 |
| I8 pausa com braços abertos | 1704 a 1725 | 0.70 | 0.48 a 0.58 | 0.10 a 0.91 | −12.5 a −2.3 | 0.48 a 0.93 | 0.48 a 0.93 | −0.55 a −0.34 | 0.21 a 0.37 |
| I9 queda ao chão + cruz. baixo | 1726 a 1737 | 0.37 | 0.34 a 0.47 | 0.47 a 1.19 | −1.8 a +13.1 | 0.32 a 0.47 | 0.28 a 0.48 | −0.42 a −0.27 | 0.10 a 0.55 |
| I10 crossover com inclinação | 1770 a 1787 | 0.60 | 0.43 a 0.58 | 0.06 a 0.96 | −17.3 a +36.8 | 0.39 a 0.84 | 0.35 a 0.70 | −0.58 a −0.14 | −0.06 a 0.52 |
| I11 retorno com bola no ombro | 1788 a 1805 | 0.60 | 0.46 a 0.53 | 0.01 a 0.65 | +9.6 a +32.9 | 0.51 a 0.87 | 0.36 a 0.57 | −0.43 a +0.02 | 0.18 a 0.51 |
| I12 mistura (pausa e push) | 1806 a 1829 | 0.80 | 0.45 a 0.53 | 0.32 a 0.82 | −17.4 a +15.7 | 0.45 a 0.85 | 0.47 a 0.96 | −0.49 a −0.09 | 0.25 a 0.47 |
| I13 crossovers finais | 1830 a 1857 | 0.90 | 0.43 a 0.56 | 0.36 a 1.32 | −3.5 a +20.8 | 0.43 a 0.70 | 0.41 a 0.67 | −0.53 a −0.06 | 0.15 a 0.51 |

Diff máximo fora dos cortes: 26 (1533, flick do cruzamento de I1) e 25.8 (1844, quique de I13). Rotação do tronco mínima: 0.20 (I10) e 0.21 (I2).

---

## 4. Padrões que se repetem

1. **Meio-ciclo de cruzamento = 9 a 11 quadros** entre quiques no centro (1626 a 1636 a 1646 em I4; 1779 a 1788 em I10; 1835 a 1844 em I13). Ciclo L-R-L = 20 a 21 quadros.
2. **Cruzamento = 3 a 6 quadros** (0.10 a 0.20 s) de um lado do quadril ao outro (1530 a 1535; 1607 a 1611; 1733 a 1736). O quique de cruzamento fica no centro, entre os pés.
3. **Pausa = 8 a 15 quadros** (0.27 a 0.50 s), bola no quadril ou no ombro, quadril com variação de 0.02 a 0.09 S e tronco inclinado 10 a 15° para o lado da bola (I1, I8, I10, I12).
4. **Antecipação**: quadril cai 0.07 a 0.13 S em 6 a 8 quadros antes de um push ou de uma queda (I7: 0.53 para 0.40 em 1686 a 1694; I10: 0.55 para 0.43 em 1770 a 1775; I12: 0.53 para 0.45 em 1809 a 1820).
5. **Quadril acompanha a altura da bola**: sobe 0.05 a 0.08 S com a bola alta (I5, I8, I10); cai ao ir para o chão (I7, I9).
6. **Passo cruzado**: tornozelos a 0.0 a 0.2 S durante 3 a 5 quadros em cada passagem de bola (1594 a 1598; 1670 a 1672; 1686; 1706; 1784 a 1786; 1797).
7. **Tronco vira antes da bola**: a inclinação chega ao lado de destino antes do punho (I10: tronco +37 em 1786 com o punho ainda a 0.52).

---

## 5. Regras para replicar

1. **Cadência do crossover**: um quique a cada 10 quadros (0.33 s) no centro; ciclo completo de 20 a 21 quadros (0.67 a 0.70 s). Limite inferior observado: 9 quadros.
2. **Tempo de cruzamento**: a bola leva 4 a 6 quadros (0.13 a 0.20 s) para ir de um lado do quadril ao outro. O contato com o chão é no centro, entre os pés; contato visível de 1 a 4 quadros (até 5 em I4).
3. **Pausa (hesitação)**: 10 a 14 quadros (0.33 a 0.47 s) com bola parada no quadril (punho 0.45 a 0.60 S) ou no ombro (0.85 a 0.95 S). Durante a pausa, quadril com variação de 0.02 a 0.09 S e tronco inclinado 10 a 15° para o lado da bola.
4. **Antecipação**: quadril desce 0.07 a 0.13 S em 6 a 8 quadros antes de começar um push ou uma queda. O quadril é o mínimo 3 a 5 quadros antes da virada.
5. **Varredura do tronco**: 15 a 35° no lado da bola; em crossover forte, varredura de 37 a 54° pico a pico em 10 a 11 quadros (1632 para 1643 = 37° em 11; 1776 para 1786 = 54° em 10). Pico curto (1 a 2 quadros) em cada extremo.
6. **Passo cruzado**: tornozelos a 0.0 a 0.2 S por 3 a 5 quadros em cada troca de bola; base volta a 0.8 a 1.3 S durante pausa (aberta) e a 0.45 a 0.6 S em neutro.
7. **Push ao ombro**: punho sobe de 0.5 para 0.9 S em 3 a 5 quadros e desce em 6 a 9 quadros. Quadril sobe 0.05 a 0.08 S enquanto a bola está no ombro.
8. **Braço de fora**: lateral −0.2 a −0.5 S no lado oposto à bola, altura 0.5 a 0.7 S. Em pausas de braços abertos (1710 a 1714), os dois punhos a 0.9 S de altura.
9. **Escala**: 1 S = 1.45 m. Base neutra 0.5 S ≈ 0.73 m; quadril neutro 0.50 S (agachado); amplitude de agachamento 0.15 S ≈ 0.22 m. Calibrar a animação com esses valores, não com números absolutos do CSV.
10. **Quadros duplicados**: a fonte repete um quadro a cada 12 (PARADO). Para timing fiel ao vídeo, tratar um quadro em 12 como hold de 33 ms, ou ignorar, porque o efeito é pequeno.

---

## 6. Feel (observações gerais, visual)

- O tronco é o sinal de transferência de peso: ele acompanha a bola ou chega antes dela em 1 a 4 quadros (I1, I10).
- Os extremos da varredura do tronco têm pico curto (1 a 2 quadros), mas não há "freio" entre eles: o corpo passa direto para o lado seguinte, exceto nas pausas.
- Pés: o pé de trás levanta o calcanhar nos passos rápidos (1681 a 1682, 1688). Não medido.
- Cabeça: quase estática em todo o trecho (não medida).
- Limite do que não dá para medir aqui: altura exata da bola, contatos quadro a quadro e cadência do drible "parado" (sem momento parado longo no trecho).

---

## 7. Arquivos

- Tabela quadro a quadro (1500 a 1857): `analise/E_tabela.txt`
- Janelas por instância: `analise/E_janelas.py` (saída no chat)
- Resumo por folha: `analise/E_blocos.py`
- Recortes conferidos (não copiados, removidos): 1554 a 1559, 1754 e 1760 vs 1770 e 1771.
