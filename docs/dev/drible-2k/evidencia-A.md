# Análise A: "momentum spam" (0,00 s a 13,00 s), NBA 2K27

Material: folhas `drible/folhas/s_000` a `s_012` (lidas uma a uma), `drible/metricas.csv`, `drible/medidas.csv`, `drible/frames/` (quadros inteiros, usados para o overlay), `transcricao.txt` (bloco de `drible/audio.wav`).
Convenção de numeração: quadro N = t N/30 s. Frames f0 a f389 cobrem 0,00 a 12,97 s.
"Tela direita" = lado direito da imagem. A câmera fica atrás do jogador (camisa "24" de costas), então tela direita = mão direita do jogador e tela esquerda = mão esquerda.
S = tamanho do corpo (1,0 S ≈ 1,45 m). Todas as alturas e larguras estão em S.

## 0. Antes de ler: confiabilidade

- **Câmera lenta em 0,00 a ~4,00 s (f0 a f119).** Quase todos os quadros estão congelados (marcados PARADO nas folhas s_000 a s_003). Não trate durações ali como tempo real. O movimento real começa em f120 (4,00 s), quando o diff entre quadros passa de ~0 para ~10 a 15.
- **Cortes de cena** (confirmados pelo diff): f65 (2,17 s, diff 41), f185 (6,17 s, diff 52), f382 (12,73 s, diff 49). Há uma mudança de câmera sem corte em f120 (4,00 s, diff 10), que coincide com o fim da câmera lenta.
- **Detector da bola: pouco confiável.** Só cerca de 65 dos 270 quadros entre f120 e f389 têm bola plausível, e em trechos curtos. Há um falso positivo na cabeça (bola_altura ≈ 1,18 e bola_lado ≈ 0). Esses valores foram ignorados. Os números de bola deste relatório vêm de leitura visual das folhas, marcados como "visual", ou de poucos pontos detectados, marcados como "detectado".
- **Pose (MediaPipe):** os tornozelos, quadril, ombros e punhos são estáveis entre f120 e f381. Em f382 a 384 (troca de câmera) a pose quebra e não deve ser usada.
- **Overlay:** não aparece nas folhas (cortadas no jogador), mas aparece nos quadros inteiros. Medi os dois widgets (esquerdo e direito, em forma de losango) por análise de pixel: fração de azul-claro e ângulo da seta branca (script `A_work/overlay_A.py`, saída `A_work/stick_A.txt`). Vi a classificação em montagem de recortes (`A_work/arrows_A.jpg`) para checar a direção.

## 1. Linha do tempo

| Trecho (s) | Frames | O que acontece | Overlay | Observação |
|---|---|---|---|---|
| 0,00 a 2,13 | f0 a f64 | Postura de carga: crouch largo, base 0,87 S, quadril 0,49 a 0,50 S, tronco quase vertical (+2 a +3°). Sem bola visível. | Ambos os widgets em ↖ fixo | Câmera lenta, sem movimento |
| 2,17 a 4,00 | f65 a f119 | Corte de câmera. Bola entre as pernas, na altura do joelho. Base alarga para 1,02 a 1,16 S, tronco inclina para a esquerda da tela (-11 a -19°). | Sem overlay | Câmera lenta (quase tudo PARADO). Pré-carga. |
| 4,00 a 7,37 | f120 a f220 | **Fase 1 do spam**, em tempo real. Ciclos de ~0,50 s (vale de pés juntos a cada ~0,5 s). A bola troca de lado a cada ciclo, passando entre as pernas. | Sem overlay | Título "momentum spam" aparece em 5,0 s (f151) |
| 6,17 | f185 | Corte de câmera (ângulo mais alto, quadra visível ao fundo) | | Continua o spam |
| 7,37 | f221 | Overlay aparece: widget direito em ↖ | R ↖ | Cadência de ~1 s por ciclo a partir de 7,90 s |
| 7,87 | f236 | Widget esquerdo aparece em ↗ | L ↗ | |
| **7,97** | f239 | Flick 1: R ↗ | ↗ ambos | Vale de pés em f237 (7,90 s) |
| **8,87** | f266 | Flick 2: R ↖ | ↖ ambos | Vale em f267 |
| **10,03** | f301 | Flick 3: R ↗, L ↑ | R ↗, L ↑ | Vale em f299 |
| **11,10** | f333 | Flick 4: R ↖, L ↖ | ↖ ambos | Vale em f328 |
| **11,90** | f357 | Flick 5: R ↗, L ↑ | R ↗, L ↑ | Vale em f359 |
| 12,73 | f382 | Corte de câmera (troca para ângulo mais próximo, jogador quase fora do quadro). Overlay some. | Some | Pose quebrada. Não medir. |

A narração (`transcricao.txt`, bloco `drible/audio.wav`) é: "The moment of spam" (3,73 a 6,85 s), "hold turbo then flick up on your right stick back and forth" (6,85 a 10,69 s), e depois "the on the back double" (10,69 a 16,01 s). A narração anuncia o "on the back double" a partir de 10,69 s, mas no vídeo o spam continua até 12,7 s (flicks em 11,10 e 11,90 s). O corte em 12,73 s provavelmente marca a troca para o movimento seguinte. Não verificado.

Observação: o arquivo `drible2/` é outro material (585 quadros, dados de pose que não batem com `drible/`). Não usei. Também não toquei em `analise/` além de criar `A.md`. Meus scripts estão em `A_work/`.

## 2. Identificação do movimento

**"Momentum spam"**: é um rocker lateral com a bola passando de um lado ao outro entre as pernas. A cada meio-ciclo a bola troca de mão: mão direita, depois esquerda, depois direita. Os pés NÃO cruzam. Ficam sempre em straddle (separação mínima ~0,25 S, em 6,83 s, e sem inversão lateral). Não é crossover nem between-the-legs com passo cruzado.

- Direção do flick: ↗ = bola para a tela direita (mão direita do jogador). ↖ = bola para a tela esquerda (mão esquerda).
- Texto "HOLD TURBO" aparece no quadro f301 (10,0 s), junto com o controle na tela.
- Input: o flick é o widget direito (R) trocando de ↖ para ↗ e vice-versa. O widget esquerdo (L) acompanha na maior parte do tempo, mas em 10,03 a 11,07 e 11,90 a 12,72 fica em ↑ (≈-100 a -115°) enquanto o R está em ↗.
- Intervalos entre flicks: 0,90 s, 1,16 s, 1,07 s e 0,80 s (média 0,98 s, de 7,97 a 11,90 s).

### Ciclo típico (fase 2, 8,87 a 10,03 s, f266 a f301)

| Fase | Frames | Tempo | Evento |
|---|---|---|---|
| Carga / fechamento antes do flick | f257 a f266 | 0,30 s | Base cai de 0,95 (f258) para 0,48 (f265). Tronco volta de +16° (f257) para +4,6° (f266). Bola ainda à direita, alta (~0,70 S). |
| Flick (input) | f266 | 0 | R: ↗ para ↖. Ambos os widgets em ↖. |
| Vale de pés | f267 | +1 | Base mínima 0,47 S |
| Bola à direita, descendo | f267 a f279 | 0,40 s | Bola de 0,70 para 0,47 (f273) e volta a 0,53 (f277). |
| Travessia (entre as pernas) | f280 a f284 | 0,17 s | Bola fica sem detecção, visualmente baixa, no centro, entre as pernas. |
| Chegada à esquerda | f285 | +19 | Bola à esquerda (bl = -0,28), bh = 0,15 (toque no chão, detectado) |
| Pico de abertura | f287 | +21 | Base máxima 1,00 S. Quadril mínimo 0,49 (f283). Tronco a -25° (f289). |
| Fechamento | f287 a f297 | 0,33 s | Base cai de 1,00 para 0,64 S. Quadril sobe para 0,58 (f297). |
| Assentamento | f297 a f301 | 0,13 s | Tronco de -17° (f297) para -7° (f301). |
| Próximo flick | f301 | | R: ↖ para ↗ |

Duração total do ciclo: 35 quadros (1,17 s entre flicks, por causa de 266 para 301). Ciclo vale a vale: 267 para 299 = 32 quadros (1,07 s).

### Ciclo típico (fase 1, 4,30 a 4,80 s, f129 a f144)

| Fase | Frames | Tempo | Evento |
|---|---|---|---|
| Vale (bola à direita, alta) | f129 | 0 | Base 0,47 S. Bola à direita (D) de f129 a f134. |
| Abertura | f129 a f139 | 0,33 s | Base sobe até 1,01 S (f139). Quadril cai para 0,49 (f136). |
| Travessia entre as pernas | f135 a f136 | 0,07 s | Bola no centro, baixa (joelho). Visual. |
| Toque no chão à esquerda | f137 a f139 | 0,07 s | Bola toca o chão, à esquerda (bh = 0,15, detectado em f137). |
| Fechamento | f139 a f144 | 0,17 s | Base cai para 0,61 S (f144). Tronco chega a -27,5° (f141). |
| Vale (bola à esquerda) | f144 | 0 | Quadril sobe (0,58 em f144). |

Ciclo fase 1: 0,50 s entre vales (f129, f144, f158, f173). Troca de bola a cada vale. Cada meio ciclo: fecha em ~0,17 s e abre em ~0,30 s.

## 3. Pés

- **Straddle simétrico.** Os dois tornozelos se afastam e se aproximam em fase, espelhados em relação ao quadril (medidas em `A_work/pes_A.py`).
- **Fase 1 (4,0 a 7,3 s):** tornozelo esquerdo (tela) varia entre -0,08 e -0,65 S (lateral, relativo ao quadril). Direito entre +0,12 e +0,63 S. Largura da base entre 0,24 e 1,16 S.
- **Fase 2 (7,4 a 12,7 s):** base de 0,32 a 1,16 S. Tornozelo esquerdo de -0,08 a -0,64. Direito de +0,15 a +0,63.
- **Não há passo de cruzamento.** O menor afastamento é 0,24 S (f205, 6,83 s). Os pés ficam lado a lado sem trocar de ordem.
- **Profundidade (eixo da câmera):** os pés alternam levemente de profundidade, ±0,04 a ±0,12 S (±8 a ±17 cm). Visualmente, um pé fica um pouco atrás do outro a cada meio ciclo.
- **Calcanhar/ponta:** visual, no pé de trás aparece com calcanhar ou ponta levantados em ~8,6 s (f258) e ~12,6 s (f378 a 381). Não medido com confiança.
- **Ritmo de cada pé:** abertura de 0,33 s (fase 1) e 0,43 a 0,67 s (fase 2). Fechamento de 0,17 a 0,20 s (fase 1) e 0,40 a 0,57 s (fase 2).

## 4. Quadril e centro de massa

- **Quadril (altura do quadril acima do tornozelo, em S):**
  - Fase 1: mínimo 0,46 (f188, 6,27 s), máximo 0,60 (f157). Faixa típica 0,49 a 0,58.
  - Fase 2: mínimo 0,49 (f283), máximo 0,60 (f322). Faixa 0,49 a 0,60.
  - Amplitude pico a pico: 0,08 a 0,10 S (≈ 12 a 15 cm).
- **Quadril desce quando a base abre e sobe quando fecha.** O mínimo do quadril chega de 0 a 0,2 s antes do pico de abertura. O máximo acontece no vale de pés juntos (0 a 2 quadros na maioria dos ciclos; em 10,73 s e 11,83 s ele vem 4 a 6 quadros antes).
- **Centro lateral:** o quadril fica no meio dos tornozelos, com desvio de ±0,1 S na maior parte do tempo e picos de ±0,22 S (f198 e f234). Não há deslocamento lateral do centro além do que a base permite.
- **Peso:** não medido diretamente. O padrão simétrico sugere apoio dividido entre os dois pés, sem passo claro de um pé para o outro.

## 5. Tronco e cabeça

- **Inclinação lateral** (+ = tela direita):
  - Fase 1: de -27,5° (f141) a +17,5° (f183). Oscila a cada ~0,5 s.
  - Fase 2: de -37,4° (f233) a +16,2° (f257). Inverte a cada vale/pico.
  - O tronco se inclina para o lado da bola. Exemplos: bola à esquerda (9,50 a 9,73 s): tronco -28°. Bola à direita (8,77 a 9,30 s): tronco de +7 a -7°, voltando a zero.
- **Rotação do tronco** (largura aparente dos ombros, em S; neutro = 0,33):
  - Mínimo 0,22 (f233 a f234, 7,8 s) e 0,25 a 0,26 (f262 a f265, 8,7 a 8,8 s).
  - Estimativa grosseira: um ombro projetado em 0,22 de 0,33 indica uma rotação de ~45 a 50° do tronco para o lado da bola. Valide com a animação.
- **Cabeça:** não medida. Visualmente acompanha o tronco (sem medida).

## 6. Braços

- **Braço da bola:** a mão do lado da bola estende lateralmente até 0,35 a 0,45 S. Exemplos: direita a 0,39 S em 8,70 s (bola à direita). Esquerda a -0,49 S em 9,87 s (bola à esquerda, ou em transição). Altura do punho:
  - Lado direito com bola (8,7 s): 0,63 a 0,75 S, na altura da cintura ou do peito.
  - Lado esquerdo com bola (9,5 s): 0,44 a 0,56 S, mais baixo.
- **Braço oposto:** quando a bola está do outro lado, a mão oposta recolhe para 0,05 a 0,10 S (perto da linha média, o que aparece como a mão puxada para dentro).
- **Ambas as mãos ficam afastadas** durante o spam, em lados opostos. Em nenhum momento cruzam.
- **Troca:** a mão que segura a bola muda no meio da travessia. A mão oposta vai para a linha média e a mão da bola estende.

## 7. Bola

- **Altura no lado (apex):** fase 2: 0,61 a 0,70 S (≈ 0,9 a 1,0 m), altura de cintura/quadril (detectado em f263 a f266). Fase 1: ~0,5 S (detectado em f132 a f134; visual em f140 a f149).
- **Altura no centro (travessia):** ~0,3 S (≈ 0,45 m), altura de joelho. Detectado em 8,37 a 8,40 s (0,29 a 0,32).
- **Toque no chão:** detectado em 4,57 s (f137, esquerda), 5,57 s (f167, esquerda), 6,23 s (f187, direita) e 9,50 s (f285, esquerda). Em todos, bh = 0,11 a 0,15 S. Pelo detector, a maioria das passagens não toca o chão, mas o detector perde muitos toques. Visualmente, na fase 1 há toques também em ~5,85 s (f175, esquerda, baixa) e ~7,07 s (f212, direita, baixa). Não consegui confirmar o intervalo entre toques. Os intervalos detectados (1,0 s e 0,67 s) não batem com a cadência de troca de lado. Hipótese para checar quadro a quadro: um toque por passagem, ou seja, a cada 0,5 s na fase 1 e a cada ~1 s na fase 2.
- **Velocidade da bola na travessia:** a travessia dura de 0,17 a 0,45 s, com salto lateral de ~0,6 S (≈ 0,9 m) de um lado ao outro. Velocidade média ~1,4 a 3 S/s (≈ 2 a 4,5 m/s).
- **Posição lateral do apex:** ±0,28 a 0,34 S do centro do quadril, mais estreita que os tornozelos (±0,5 S).
- **Giro da bola:** não medido.

## 8. Encadeamento

- **Não há pose neutra entre os movimentos.** A base nunca fica parada. O quadril nunca sobe acima de 0,60 S. O intervalo entre vales é contínuo (0,5 s na fase 1 e ~1 s na fase 2).
- **Próximo flick antecipado:** o flick seguinte está pronto no vale. O vale é o momento do próximo input. A transição é contínua: o fechamento e a reversão do tronco acontecem juntos no vale.
- **Sobreposição:** a reversão do tronco e da mão cai entre 9 quadros antes e 2 depois do flick (seção 9). Não há intervalo de repouso entre um ciclo e o seguinte.
- **Trocas de câmera:** em 2,17, 6,17 e 12,73 s. Não são movimento. Não usar a continuidade nesses cortes.

## 9. Sensação (feel)

- **Fase 1 (2 Hz):** fechamento rápido (0,17 a 0,20 s), abertura mais lenta (0,27 a 0,33 s). É a parte mais "estalada" e snappy.
- **Fase 2 (1 Hz):** mais pesada e ritmada. Fechamento de 0,40 a 0,57 s e abertura de 0,43 a 0,67 s, um pouco mais lenta que a fase 1.
- **Antecipação:** a base fecha por 0,3 a 0,6 s antes do flick (na fase 2, de 1,14 S em 8,33 para 0,47 S em 8,87). Esse fechamento é o "carregamento" do flick.
- **Oscilação do tronco:** a inclinação vai de +16° (8,57 s) a -7° (9,07 s) em 0,5 s, e volta a acumular antes de assentar. Assentamento em ~0,13 a 0,3 s, sem tempo de repouso.
- **Resposta:** o tronco e a mão reagem no próprio quadro do flick (mediana 0 quadros, faixa -9 a +2). A bola leva mais tempo para chegar ao outro lado: 14 a 24 quadros (0,47 a 0,80 s). O que parece "responsivo" é a reversão do corpo. O que parece "lento" é a bola.
- **Estabilidade:** o centro de massa fica sobre os tornozelos (±0,1 S). A postura é baixa e estável, sem saltos visíveis.

## 10. Tabela numérica

| Movimento / fase | Duração total | Input até reação do corpo | Input até bola no lado alvo | Quadril (mín / máx, S) | Base (faixa, S) | Tronco (faixa, °) | Bola: alto do lado / no cruzamento (S) | Intervalo de toques no chão |
|---|---|---|---|---|---|---|---|---|
| Pré-carga (0,00 a 4,00 s, câmera lenta) | 4,00 s (não é tempo real) | n/a | n/a | 0,49 a 0,53 | 0,87 a 1,16 | +2 a -19 | n/a / ~0,3 (f70 a 119, visual) | n/a |
| Fase 1 do spam (4,00 a 7,37 s) | ~3,4 s, vales a cada 0,50 s | não medido (sem overlay) | n/a | 0,46 a 0,60 | 0,24 a 1,16 | -28 a +18 | ~0,5 (visual, f132 a f149) / ~0,3 | 4,57, 5,85 (visual), 5,57, 6,23 (detectado; intervalo 0,67 a 1,0 s, incerto) |
| Fase 2 do spam (7,37 a 12,73 s) | ~5,4 s, flicks a cada ~1,0 s | 0 quadros (faixa -9 a +2) | 14 a 24 quadros (0,47 a 0,80 s) | 0,49 a 0,60 | 0,32 a 1,16 | -37 a +16 | 0,61 a 0,70 / ~0,3 | 9,50 (detectado; incerto) |
| Ciclo típico fase 2 (f266 a f301) | 35 quadros (1,17 s) | 0 quadros | 19 quadros (0,63 s) | 0,49 (f283) a 0,58 (f297) | 0,47 a 1,00 | +4,6 a -25,4 | 0,70 (f266) / 0,15 (f285) | 1 toque em 9,50 s |
| Ciclo típico fase 1 (f129 a f144) | 15 quadros (0,50 s) | n/a | travessia 0,07 s | 0,49 a 0,58 | 0,47 a 1,01 | +4 a -28 | 0,50 (f132 a f134) / 0,15 (f137) | 1 toque em 4,57 s |

Observação sobre as larguras da fase 2: o mínimo de 0,32 em 7,90 s e o máximo de 1,16 em 10,43 s são extremos. Os valores típicos do ciclo são 0,47 a 1,00.

## 11. Regras para replicar

1. **Ciclo de flick:** cada meio-ciclo troca de lado da bola. Período vale a vale: **0,50 s na fase de início (4,0 a 7,4 s)** e **~1,0 s na fase de flicks (7,9 a 12,7 s)**.
2. **Gatilho no vale:** o flick acontece no vale de largura (pés mais próximos). Desvio medido: -2 a +5 quadros (mediana +2). Dispare a mudança de direção do corpo nesse ponto, não no pico.
3. **Base em S:** vales entre **0,25 e 0,75 S** (típico 0,45 a 0,60) e picos entre **0,8 e 1,16 S** (típico 1,0 a 1,15). Pés nunca cruzam (separação mínima ~0,25 S). Os dois pés se movem em fase, espelhados.
4. **Tempo dos pés:** fase 1: fechamento 0,17 a 0,20 s, abertura 0,27 a 0,33 s. Fase 2: fechamento 0,40 a 0,57 s, abertura 0,43 a 0,67 s. Assimetria: fecha mais rápido que abre na fase 1.
5. **Quadril:** sobe até **0,58 a 0,60 S** no vale e desce até **0,49 a 0,53 S** no pico. Amplitude ~0,09 S (≈13 cm). O mínimo chega 0,05 a 0,2 s antes do pico de abertura.
6. **Centro:** quadril centralizado entre tornozelos (±0,1 S). Não desloque o centro de massa lateralmente além da base.
7. **Tronco:** inclina para o lado da bola, entre **-25° e -37°** (bola à esquerda da tela) e **+5° a +17°** (bola à direita). Inverte no mesmo quadro do flick. Rotação dos ombros cai para ~0,22 a 0,25 S (de 0,33 neutro), compatível com ~45 a 50° de rotação.
8. **Braços:** a mão do lado da bola estende até **0,35 a 0,45 S** lateralmente, na altura de **0,6 a 0,75 S**. A mão oposta vai para **0,05 a 0,10 S** (linha média) quando a bola está do outro lado. Ambas as mãos ficam afastadas, sem cruzamento.
9. **Bola:** altura no lado (apex) **~0,5 S** na fase 1 e **0,6 a 0,7 S** na fase 2 (≈ 0,7 a 1,0 m). Altura no cruzamento **~0,3 S** (≈ 0,45 m). Travessia de 0,17 a 0,45 s. Toque no chão raro no cruzamento, a 0,11 a 0,15 S. Confirme quadro a quadro antes de fixar o intervalo do quique.
10. **Latência:** o corpo reage em **0 quadros** (faixa -9 a +2). A bola chega ao lado alvo em **14 a 24 quadros (0,47 a 0,80 s)** e tende a cruzar **no pico de abertura seguinte** (0 a 0,45 s depois dele). Ou seja, o corpo responde ao input na hora, mas a bola precisa de meio ciclo para trocar de lado.
11. **Encadeamento:** nenhuma pose neutra entre flicks. O próximo flick entra no próximo vale. Não pause o quadril nem a base entre ciclos.
12. **Overlay / direção:** ↗ manda a bola para a tela direita (mão direita do jogador). ↖ manda para a tela esquerda (mão esquerda). Widget R é o principal. Widget L segue o R na maioria dos flicks, mas em 10,03 a 11,07 e 11,90 a 12,72 fica em ↑ (≈-100 a -115°).

## 12. Limitações

- Detecção de bola quase nula entre f120 e f389. Boa parte dos números de bola são visuais, com precisão de ±3 quadros e ±0,05 S.
- Perspectiva: a câmera fica atrás e acima, então alturas e larguras são aproximadas. Tratar como ordem de grandeza.
- Cabeça e pés (altura do pé no ar) não foram medidos com confiança.
- Corte em 12,73 s: não é possível medir o jogador a partir daí. Os números valem só até f381.
- Overlay: a classificação de ângulo usa centroide da seta branca. Validei a direção por montagem visual. Mudanças de ↖ para ↗ são confiáveis. A diferença entre ↑ e ↗ no widget L é mais fraca (ângulo -100 contra -116).
- Ciclo fase 1: não há overlay para medir latência de input nessa fase.

## Arquivos auxiliares

- `A_work/overlay_A.py`, `A_work/stick_A.txt`: medidas de overlay por quadro (f0 a f389).
- `A_work/montage_A.py`, `A_work/arrows_A.jpg`: montagem de recortes dos widgets usada para validar direção.
- `A_work/analise_A.py`, `A_work/eventos_A.py`, `A_work/tabela_A.py`, `A_work/pes_A.py`, `A_work/quadril_A.py`: extremos, cadência, pés, quadril e tabela por quadro.
