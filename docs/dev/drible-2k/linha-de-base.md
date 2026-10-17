# Linha de base do feel: nós × NBA 2K27

> Gerado por `node tools/feel/regua.mjs` (Fase 1 do `docs/27-dribles-2k.md`). Não edite à mão: rode de novo.
> Rodada: 2026-10-17 03:19 UTC, código em 7929a1b (web/src sem alterações não commitadas).

**Como ler.** "Nós" é a verdade do motor: o laboratório roda o jogo em passo fixo de 1/60 s e lê o esqueleto e a bola em metros (`tools/feel/motor.mjs`, cenários em `tools/cenarios-feel.mjs`), convertidos para a régua do 2K: 1 S = 1,45 m, tempo em quadros de 30 fps (q = 33 ms). "2K" é a faixa do doc 27 §2 (`tools/feel/referencia-2k.json`, com fonte E-x e confiança). Delta = distância até a faixa do 2K (0 = dentro). Aprovado se o delta cabe na tolerância; **limítrofe** = reprovado por menos que a margem do pipeline de vídeo (o número do 2K pode estar errado nessa medida); a margem vem da calibração (seção 5). Golpe com várias fases do quique: vale a pior fase.

## 1. Resumo

110 linhas (métrica × golpe): **54 aprovado**, **31 reprovado**, **21 limítrofe**, **3 não existe**, **1 sem dado**.

- §2.1 Resposta e encadeamento: 14 de 27 aprovadas.
- §2.2 Ritmo e bola: 5 de 10 aprovadas.
- §2.3 Corpo: 30 de 58 aprovadas.
- §2.4 Duração por golpe: 5 de 11 aprovadas.

## 2. As 10 maiores diferenças (ordem de impacto no feel)

Impacto = peso da métrica no feel (doc 27 §2.1 pesa mais) × o quanto o pior golpe passa da tolerância × (0,7 + 0,3 × fração dos golpes reprovados) × confiança do número do 2K; limítrofe conta 0,6.

| # | Métrica | Pior golpe | Nós | 2K | Golpes reprovados | Hipótese de causa no código (doc 27 §3) |
|---|---|---|---|---|---|---|
| 1 | Pose neutra entre golpes encadeados (quadros sem ação de drible) (§2.1) | Crossovers em sequência | 11,5 q | 0,0 q | 1 de 4 | Limitações 2 e 3: janela de combo fixa de 0,15 s sem lista de cancelamento, e a ação termina e volta ao loop base antes do próximo golpe (reset duro do clipe em PlayerAnimator.startAction). |
| 2 | Antecipação: da primeira reação do corpo ao empurrão (soltura da bola) (§2.3) | Crossover parado | 0,5 q | 10,0–12,0 q | 3 de 4 | Limitação 4: ActionInBlend de 0,12 s e nenhuma fase de carga; o empurrão sai no começo do clipe. |
| 3 | Arranque com a bola (RT + LS): até 90% da velocidade máxima (§2.1) | Arranque e parada com a bola (RT) | 26,0 q | 1,0–3,0 q | 1 de 1 | Limitação 7: aceleração de 6,5 m/s² no Freestyle (0 -> 3,9 m/s em ~0,6 s). |
| 4 | Parada com a bola: soltar o LS até < 10% da velocidade (§2.1) | Arranque e parada com a bola (RT) | 12,0 q | 1,0–3,0 q | 1 de 1 | Limitação 7: freio de 14 m/s² no Freestyle. |
| 5 | Comando -> bola começar a cruzar (3 cm para o lado novo) (§2.1) | BTB correndo (RT) | 6,5 q | 1,0–3,0 q | 4 de 5 | Limitação 1 (pendente esperando a bola) e PlayerAnimator.holdMoveForBall: o clipe de mocap para antes da soltura até a bola chegar à mão. |
| 6 | Velocidade de pico da inclinação do tronco (a 30 fps) (§2.3) | Hesi-cross | 365 graus/s | 90–150 graus/s | 4 de 5 | Troca de clipe e inertialization de 0,12 s (PlayerAnimator.startAction): a inclinação muda em poucos quadros. |
| 7 | Double cross: do comando à 2ª recepção (passe lento + transição + passe rápido) (§2.4) | Double cross | 13,0 q | 40,0–46,0 q | 1 de 1 | Limitação 6: o double cross é dois crosses iguais em 0,70 s (Freestyle.secondCrossAt), sem o lento -> rápido. |
| 8 | Varredura do tronco pico a pico no golpe (§2.3) | Entre as pernas | 13 graus | 37–54 graus | 5 de 5 | Limitação 4 (inclinação pequena e sem lado a lado). |
| 9 | Crossover: bola em movimento (do começo à recepção do outro lado) (§2.4) | Crossover parado | 6,0 q | 9,0–11,0 q | 2 de 2 | Specs do crossover 0,40 s, clipe esticado (limitação 3). |
| 10 | Comando -> primeira reação visível do corpo (tronco ou mão > 1 cm ou > 2°) (§2.1) | Step-back | 6,0 q | 0,0–3,0 q | 2 de 9 | Limitação 1 e 8 do doc 27 §3: o corpo espera a bola (Freestyle.flushPendingMove/ballReadyForMove guarda o comando até 0,45 s como pendente) e o toque para baixo só sai na volta do stick ao centro (HoopsProStick.earlyFlickExcluded = [Down]). |

## 3. Latência por golpe e fase do quique

Do quadro em que o stick chega à zona ativa (0,7) até o primeiro quadro em que um osso do tronco ou da mão sai > 1 cm ou > 2° do mesmo cenário sem o comando (o laboratório é determinístico). 1 quadro de 60 Hz = 0,5 q = 17 ms; o mínimo possível é 0,5 q. 2K: 0–3 q. "Pendente" = tempo com o comando guardado esperando a bola (Freestyle); "espera da bola no clipe" = o clipe parado antes da soltura (PlayerAnimator.holdMoveForBall).

| Golpe (golpes que saíram) | Bola na mão | Descendo | Subindo | Pendente (pior) | Espera da bola no clipe (pior) | Bola começa a cruzar (pior) |
|---|---|---|---|---|---|---|
| Crossover parado (Crossover) | 1,5 q (50 ms) | 2,5 q (83 ms) | 1,5 q (50 ms) | 1,0 q | 1,5 q | 5,5 q |
| Entre as pernas (Entre as pernas) | 1,5 q (50 ms) | 2,5 q (83 ms) | 1,5 q (50 ms) | 1,0 q | 0,0 q | 3,0 q |
| Behind-the-back (Por trás) | 1,5 q (50 ms) | 3,5 q (117 ms) | 1,5 q (50 ms) | 2,0 q | 0,0 q | 5,0 q |
| Hesitação (Hesitação) | 1,5 q (50 ms) | 2,5 q (83 ms) | 1,5 q (50 ms) | 1,0 q | 0,0 q | — (não cruza) |
| Double cross (Crossover > Double cross) | 1,5 q (50 ms) | 2,5 q (83 ms) | 1,5 q (50 ms) | 1,0 q | 4,5 q | 5,5 q |
| Hesi-cross (Hesitação > Hesi-cross) | 1,5 q (50 ms) | 2,5 q (83 ms) | 1,5 q (50 ms) | 1,0 q | 3,5 q | 13,0 q |
| Step-back (Step-back) | 6,0 q (200 ms) | 3,5 q (117 ms) | 2,5 q (83 ms) | 3,5 q | 0,0 q | — (não cruza) |
| BTB correndo (RT) (Por trás) | 1,5 q (50 ms) | 5,5 q (183 ms) | 1,5 q (50 ms) | 4,0 q | 0,0 q | 6,5 q |
| Cross correndo (RT: crossover de ataque) (Crossover de ataque) | 1,5 q (50 ms) | 3,5 q (117 ms) | 1,5 q (50 ms) | 2,0 q | 0,5 q | 6,0 q |

## 4. Tabela por métrica e por golpe

### §2.1 Resposta e encadeamento

| Métrica | Golpe | Nós | 2K | Delta | Tol. | Margem do pipeline | Status | Conf. | Fonte | Nota |
|---|---|---|---|---|---|---|---|---|---|---|
| Comando -> primeira reação visível do corpo (tronco ou mão > 1 cm ou > 2°) | Crossover parado | 2,5 | 0,0–3,0 | 0,0 | 0,5 | 1,0 | ✅ aprovado | M | E-A, E-B | pior fase: descendo; fases: mao 1,5, descendo 2,5, subindo 1,5 |
| Comando -> primeira reação visível do corpo (tronco ou mão > 1 cm ou > 2°) | Entre as pernas | 2,5 | 0,0–3,0 | 0,0 | 0,5 | 1,0 | ✅ aprovado | M | E-A, E-B | pior fase: descendo; fases: mao 1,5, descendo 2,5, subindo 1,5 |
| Comando -> primeira reação visível do corpo (tronco ou mão > 1 cm ou > 2°) | Behind-the-back | 3,5 | 0,0–3,0 | 0,5 | 0,5 | 1,0 | ✅ aprovado | M | E-A, E-B | pior fase: descendo; fases: mao 1,5, descendo 3,5, subindo 1,5 |
| Comando -> primeira reação visível do corpo (tronco ou mão > 1 cm ou > 2°) | Hesitação | 2,5 | 0,0–3,0 | 0,0 | 0,5 | 1,0 | ✅ aprovado | M | E-A, E-B | pior fase: descendo; fases: mao 1,5, descendo 2,5, subindo 1,5 |
| Comando -> primeira reação visível do corpo (tronco ou mão > 1 cm ou > 2°) | Double cross | 2,5 | 0,0–3,0 | 0,0 | 0,5 | 1,0 | ✅ aprovado | M | E-A, E-B | pior fase: descendo; fases: mao 1,5, descendo 2,5, subindo 1,5 |
| Comando -> primeira reação visível do corpo (tronco ou mão > 1 cm ou > 2°) | Hesi-cross | 2,5 | 0,0–3,0 | 0,0 | 0,5 | 1,0 | ✅ aprovado | M | E-A, E-B | pior fase: descendo; fases: mao 1,5, descendo 2,5, subindo 1,5 |
| Comando -> primeira reação visível do corpo (tronco ou mão > 1 cm ou > 2°) | Step-back | 6,0 | 0,0–3,0 | 3,0 | 0,5 | 1,0 | ❌ reprovado | M | E-A, E-B | pior fase: mao; fases: mao 6,0, descendo 3,5, subindo 2,5 |
| Comando -> primeira reação visível do corpo (tronco ou mão > 1 cm ou > 2°) | BTB correndo (RT) | 5,5 | 0,0–3,0 | 2,5 | 0,5 | 1,0 | ❌ reprovado | M | E-A, E-B | pior fase: descendo; fases: mao 1,5, descendo 5,5, subindo 1,5 |
| Comando -> primeira reação visível do corpo (tronco ou mão > 1 cm ou > 2°) | Cross correndo (RT: crossover de ataque) | 3,5 | 0,0–3,0 | 0,5 | 0,5 | 1,0 | ✅ aprovado | M | E-A, E-B | pior fase: descendo; fases: mao 1,5, descendo 3,5, subindo 1,5 |
| Comando -> bola começar a cruzar (3 cm para o lado novo) | Crossover parado | 5,5 | 1,0–3,0 | 2,5 | 0,5 | 1,0 | ❌ reprovado | M | E-D | pior fase: descendo; fases: mao 2,5, descendo 5,5, subindo 3,0 |
| Comando -> bola começar a cruzar (3 cm para o lado novo) | Entre as pernas | 3,0 | 1,0–3,0 | 0,0 | 0,5 | 1,0 | ✅ aprovado | M | E-D | pior fase: descendo; fases: mao 1,5, descendo 3,0, subindo 2,0 |
| Comando -> bola começar a cruzar (3 cm para o lado novo) | Behind-the-back | 5,0 | 1,0–3,0 | 2,0 | 0,5 | 1,0 | ❌ reprovado | M | E-D | pior fase: descendo; fases: mao 2,0, descendo 5,0, subindo 2,5 |
| Comando -> bola começar a cruzar (3 cm para o lado novo) | BTB correndo (RT) | 6,5 | 1,0–3,0 | 3,5 | 0,5 | 1,0 | ❌ reprovado | M | E-D | pior fase: descendo; fases: mao 2,0, descendo 6,5, subindo 2,0 |
| Comando -> bola começar a cruzar (3 cm para o lado novo) | Cross correndo (RT: crossover de ataque) | 6,0 | 1,0–3,0 | 3,0 | 0,5 | 1,0 | ❌ reprovado | M | E-D | pior fase: descendo; fases: mao 2,5, descendo 6,0, subindo 3,0 |
| Corpo × bola desacoplados: da reação do corpo à bola chegar ao lado novo | Crossover parado | 6,0 | 14,0–24,0 | -8,0 | 3,0 | 1,0 | ❌ reprovado | B | E-A | pior fase: mao; fases: mao 6,0, descendo 7,5, subindo 6,0 |
| Corpo × bola desacoplados: da reação do corpo à bola chegar ao lado novo | Entre as pernas | 9,0 | 14,0–24,0 | -5,0 | 3,0 | 1,0 | ❌ reprovado | B | E-A | pior fase: mao; fases: mao 9,0, descendo 9,0, subindo 9,0 |
| Corpo × bola desacoplados: da reação do corpo à bola chegar ao lado novo | Behind-the-back | 12,0 | 14,0–24,0 | -2,0 | 3,0 | 1,0 | ✅ aprovado | B | E-A | pior fase: mao; fases: mao 12,0, descendo 12,0, subindo 12,0 |
| Pose neutra entre golpes encadeados (quadros sem ação de drible) | Double cross | 0,0 | 0,0 | 0,0 | 0,5 | 1,0 | ✅ aprovado | A | E-B, E-C | pior fase: mao; fases: mao 0,0, descendo 0,0, subindo 0,0 |
| Pose neutra entre golpes encadeados (quadros sem ação de drible) | Hesi-cross | 0,0 | 0,0 | 0,0 | 0,5 | 1,0 | ✅ aprovado | A | E-B, E-C | pior fase: mao; fases: mao 0,0, descendo 0,0, subindo 0,0 |
| Pose neutra entre golpes encadeados (quadros sem ação de drible) | Crossovers em sequência | 11,5 | 0,0 | 11,5 | 0,5 | 1,0 | ❌ reprovado | A | E-B, E-C |  |
| Pose neutra entre golpes encadeados (quadros sem ação de drible) | BTB -> BTB (double BTB) | 0,0 | 0,0 | 0,0 | 0,5 | 1,0 | ✅ aprovado | A | E-B, E-C |  |
| Próximo golpe entra no vale da base (pés juntos) | Crossovers em sequência | sem vale | -2,0–5,0 | — | 1,0 | 1,0 | ❌ reprovado | M | E-A | algum golpe entrou a mais de 10 q de um vale da base |
| Próximo golpe entra no vale da base (pés juntos) | BTB -> BTB (double BTB) | -4,5 | -2,0–5,0 | -2,5 | 1,0 | 1,0 | ❌ reprovado | M | E-A | valores: -4,5 |
| Arranque com a bola (RT + LS): até 90% da velocidade máxima | Arranque e parada com a bola (RT) | 26,0 | 1,0–3,0 | 23,0 | 1,0 | 1,0 | ❌ reprovado | M | E-D |  |
| Parada com a bola: soltar o LS até < 10% da velocidade | Arranque e parada com a bola (RT) | 12,0 | 1,0–3,0 | 9,0 | 1,0 | 1,0 | ❌ reprovado | M | E-D |  |
| Velocidade mantida na troca de mão correndo (mín. no golpe / antes) | BTB correndo (RT) | 1,00 | ≥ 0,90 | 0,00 | 0,03 | — | ✅ aprovado | M | E-D | pior fase: descendo; fases: mao 1,04, descendo 1,00, subindo 1,09 |
| Velocidade mantida na troca de mão correndo (mín. no golpe / antes) | Cross correndo (RT: crossover de ataque) | 1,00 | ≥ 0,90 | 0,00 | 0,03 | — | ✅ aprovado | M | E-D | pior fase: descendo; fases: mao 1,04, descendo 1,00, subindo 1,09 |

### §2.2 Ritmo e bola

| Métrica | Golpe | Nós | 2K | Delta | Tol. | Margem do pipeline | Status | Conf. | Fonte | Nota |
|---|---|---|---|---|---|---|---|---|---|---|
| Intervalo do quique no drible parado (size-up) | Drible parado (linha de base) | 12,8 | 10,0–12,0 | 0,8 | 1,0 | 0,9 | ✅ aprovado | B | E-E |  |
| Intervalo do quique nos crossovers em sequência | Crossovers em sequência | 10,0 | 10,0 | 0,0 | 1,0 | 0,9 | ✅ aprovado | A | E-E |  |
| Intervalo do quique no BTB duplo | BTB -> BTB (double BTB) | 9,5 | 15,0 | -5,5 | 2,0 | 0,9 | ❌ reprovado | M | E-B, quiques-2k |  |
| Intervalo do quique correndo (RT) | Drible correndo (RT) | 9,5 | 15,0 | -5,5 | 2,0 | 0,9 | ❌ reprovado | M | E-D |  |
| Bola cruzando de um quadril ao outro (15% -> 85% do caminho lateral) | Crossover parado | 3,0 | 4,0–6,0 | -1,0 | 1,0 | 1,0 | ✅ aprovado | A | E-E | pior fase: descendo; fases: mao 3,5, descendo 3,0, subindo 3,5 |
| Bola cruzando de um quadril ao outro (15% -> 85% do caminho lateral) | Cross correndo (RT: crossover de ataque) | 2,0 | 4,0–6,0 | -2,0 | 1,0 | 1,0 | ⚠️ limítrofe | A | E-E | pior fase: descendo; fases: mao 4,0, descendo 2,0, subindo 4,5 |
| Bola cruzando de um quadril ao outro (15% -> 85% do caminho lateral) | Entre as pernas | 4,5 | 4,0–6,0 | 0,0 | 1,0 | 1,0 | ✅ aprovado | A | E-E | pior fase: subindo; fases: mao 5,0, descendo 5,0, subindo 4,5 |
| Bola cruzando de um quadril ao outro (15% -> 85% do caminho lateral) | Behind-the-back | 5,0 | 4,0–6,0 | 0,0 | 1,0 | 1,0 | ✅ aprovado | A | E-E | pior fase: mao; fases: mao 5,0, descendo 5,0, subindo 5,0 |
| Altura da bola cruzando o meio do corpo no entre as pernas | Entre as pernas | 0,06 | 0,25–0,35 | -0,19 | 0,05 | 0,21 | ⚠️ limítrofe | M | E-A | pior fase: mao; fases: mao 0,06, descendo 0,08, subindo 0,06 |
| Ápice lateral da bola no rocker | — | — | 0,60–0,70 | — | 0,05 | — | — não existe | M | E-A | O rocker (C2) não existe no jogo (Fase 4). |
| Pausa com a bola segurada (hold, sem quicar) | — | — | 12,0–39,0 | — | 3,0 | — | — não existe | M | E-D | Estado inexistente no jogo (0,4–1,3 s no 2K). |
| Bola no ombro (push alto): punho a 0,9 S | Drible parado (linha de base) | 0,61 | 0,85–0,95 | -0,24 | 0,05 | 0,11 | ❌ reprovado | M | E-E |  |

### §2.3 Corpo

| Métrica | Golpe | Nós | 2K | Delta | Tol. | Margem do pipeline | Status | Conf. | Fonte | Nota |
|---|---|---|---|---|---|---|---|---|---|---|
| Quadril no drible parado (acima dos tornozelos) | Drible parado (linha de base) | 0,51 | 0,48–0,58 | 0,00 | 0,03 | 0,06 | ✅ aprovado | M | E-B, E-C, E-E |  |
| Queda do quadril num golpe (neutro − mínimo) | Crossover parado | 0,02 | 0,08–0,14 | -0,06 | 0,02 | 0,07 | ⚠️ limítrofe | A | E-B, E-F | pior fase: subindo; fases: mao 0,03, descendo 0,03, subindo 0,02 |
| Queda do quadril num golpe (neutro − mínimo) | Entre as pernas | 0,12 | 0,08–0,14 | 0,00 | 0,02 | 0,07 | ✅ aprovado | A | E-B, E-F | pior fase: mao; fases: mao 0,12, descendo 0,12, subindo 0,12 |
| Queda do quadril num golpe (neutro − mínimo) | Behind-the-back | 0,07 | 0,08–0,14 | -0,01 | 0,02 | 0,07 | ✅ aprovado | A | E-B, E-F | pior fase: subindo; fases: mao 0,08, descendo 0,07, subindo 0,07 |
| Queda do quadril num golpe (neutro − mínimo) | Hesitação | 0,04 | 0,08–0,14 | -0,04 | 0,02 | 0,07 | ⚠️ limítrofe | A | E-B, E-F | pior fase: subindo; fases: mao 0,05, descendo 0,04, subindo 0,04; descontando o viés do pipeline (+0,02): aprovado |
| Tempo do comando ao mínimo do quadril | Crossover parado | — | 6,0–11,0 | — | 2,0 | 1,0 | — sem dado | A | E-B, E-F | sem queda quadril (< 0,04) |
| Tempo do comando ao mínimo do quadril | Entre as pernas | 4,5 | 6,0–11,0 | -1,5 | 2,0 | 1,0 | ✅ aprovado | A | E-B, E-F | pior fase: mao; fases: mao 4,5, descendo 5,5, subindo 4,5 |
| Tempo do comando ao mínimo do quadril | Behind-the-back | 4,0 | 6,0–11,0 | -2,0 | 2,0 | 1,0 | ✅ aprovado | A | E-B, E-F | pior fase: mao; fases: mao 4,0, descendo 6,0, subindo 4,0 |
| Tempo do comando ao mínimo do quadril | Hesitação | 4,0 | 6,0–11,0 | -2,0 | 2,0 | 1,0 | ✅ aprovado | A | E-B, E-F | pior fase: mao; fases: mao 4,0, descendo 5,0, subindo 4,0 |
| Quadril mínimo nos golpes de agachamento profundo | Step-back | 0,41 | 0,36–0,41 | 0,00 | 0,03 | 0,06 | ✅ aprovado | A | E-C, E-F | pior fase: mao; fases: mao 0,41, descendo 0,41, subindo 0,41 |
| Quadril mínimo nos golpes de agachamento profundo | Double cross | 0,48 | 0,36–0,41 | 0,07 | 0,03 | 0,06 | ⚠️ limítrofe | A | E-C, E-F | pior fase: mao; fases: mao 0,48, descendo 0,48, subindo 0,48 |
| Quadril mínimo nos golpes de agachamento profundo | Hesi-cross | 0,46 | 0,36–0,41 | 0,05 | 0,03 | 0,06 | ⚠️ limítrofe | A | E-C, E-F | pior fase: subindo; fases: mao 0,46, descendo 0,46, subindo 0,46 |
| Antecipação: da primeira reação do corpo ao empurrão (soltura da bola) | Crossover parado | 0,5 | 10,0–12,0 | -9,5 | 2,0 | 1,0 | ❌ reprovado | A | E-E, E-F | pior fase: mao; fases: mao 0,5, descendo 2,0, subindo 0,5 |
| Antecipação: da primeira reação do corpo ao empurrão (soltura da bola) | Entre as pernas | 3,5 | 10,0–12,0 | -6,5 | 2,0 | 1,0 | ❌ reprovado | A | E-E, E-F | pior fase: mao; fases: mao 3,5, descendo 3,5, subindo 3,5 |
| Antecipação: da primeira reação do corpo ao empurrão (soltura da bola) | Behind-the-back | 6,5 | 10,0–12,0 | -3,5 | 2,0 | 1,0 | ❌ reprovado | A | E-E, E-F | pior fase: mao; fases: mao 6,5, descendo 6,5, subindo 6,5 |
| Antecipação: da primeira reação do corpo ao empurrão (soltura da bola) | Hesi-cross | 8,5 | 10,0–12,0 | -1,5 | 2,0 | 1,0 | ✅ aprovado | A | E-E, E-F | pior fase: mao; fases: mao 8,5, descendo 8,5, subindo 8,5 |
| Quadril baixando durante a antecipação (neutro − na soltura) | Crossover parado | 0,00 | 0,07–0,13 | -0,07 | 0,02 | 0,07 | ⚠️ limítrofe | A | E-E, E-F | pior fase: descendo; fases: mao 0,00, descendo 0,00, subindo 0,00 |
| Quadril baixando durante a antecipação (neutro − na soltura) | Entre as pernas | 0,12 | 0,07–0,13 | 0,00 | 0,02 | 0,07 | ✅ aprovado | A | E-E, E-F | pior fase: mao; fases: mao 0,12, descendo 0,11, subindo 0,11 |
| Quadril baixando durante a antecipação (neutro − na soltura) | Behind-the-back | 0,01 | 0,07–0,13 | -0,06 | 0,02 | 0,07 | ⚠️ limítrofe | A | E-E, E-F | pior fase: subindo; fases: mao 0,01, descendo 0,01, subindo 0,01 |
| Quadril baixando durante a antecipação (neutro − na soltura) | Hesi-cross | 0,01 | 0,07–0,13 | -0,06 | 0,02 | 0,07 | ⚠️ limítrofe | A | E-E, E-F | pior fase: subindo; fases: mao 0,02, descendo 0,02, subindo 0,01 |
| Base no drible parado (distância lateral entre os tornozelos) | Drible parado (linha de base) | 0,24 | 0,45–0,80 | -0,21 | 0,05 | 0,10 | ❌ reprovado | M | E-B, E-E |  |
| Base aberta nas pausas (máximo na hesitação) | Hesitação | 0,30 | 0,80–1,30 | -0,50 | 0,10 | 0,13 | ❌ reprovado | M | E-A, E-E | pior fase: mao; fases: mao 0,30, descendo 0,30, subindo 0,30 |
| Passo cruzado: base mínima no golpe (tornozelos a 0–0,2 S) | Crossover parado | 0,24 | 0,00–0,20 | 0,04 | 0,03 | 0,08 | ⚠️ limítrofe | A | E-B, E-F | pior fase: mao; fases: mao 0,24, descendo 0,24, subindo 0,24 |
| Passo cruzado: base mínima no golpe (tornozelos a 0–0,2 S) | Entre as pernas | 0,24 | 0,00–0,20 | 0,04 | 0,03 | 0,08 | ⚠️ limítrofe | A | E-B, E-F | pior fase: mao; fases: mao 0,24, descendo 0,24, subindo 0,24 |
| Passo cruzado: base mínima no golpe (tornozelos a 0–0,2 S) | Behind-the-back | 0,18 | 0,00–0,20 | 0,00 | 0,03 | 0,08 | ✅ aprovado | A | E-B, E-F | pior fase: mao; fases: mao 0,18, descendo 0,18, subindo 0,18; descontando o viés do pipeline (+0,06): reprovado |
| Passo cruzado: base mínima no golpe (tornozelos a 0–0,2 S) | Hesi-cross | 0,24 | 0,00–0,20 | 0,04 | 0,03 | 0,08 | ⚠️ limítrofe | A | E-B, E-F | pior fase: mao; fases: mao 0,24, descendo 0,24, subindo 0,24 |
| Inclinação do tronco para o lado da bola (máximo no golpe) | Crossover parado | 9 | 15–37 | -6 | 3 | 6 | ⚠️ limítrofe | A | E-A, E-B, E-E | pior fase: descendo; fases: mao 9, descendo 9, subindo 9 |
| Inclinação do tronco para o lado da bola (máximo no golpe) | Entre as pernas | 7 | 15–37 | -8 | 3 | 6 | ⚠️ limítrofe | A | E-A, E-B, E-E | pior fase: descendo; fases: mao 7, descendo 7, subindo 7 |
| Inclinação do tronco para o lado da bola (máximo no golpe) | Behind-the-back | 23 | 15–37 | 0 | 3 | 6 | ✅ aprovado | A | E-A, E-B, E-E | pior fase: mao; fases: mao 23, descendo 23, subindo 23 |
| Inclinação do tronco para o lado da bola (máximo no golpe) | Hesitação | 21 | 15–37 | 0 | 3 | 6 | ✅ aprovado | A | E-A, E-B, E-E | pior fase: mao; fases: mao 21, descendo 21, subindo 21 |
| Inclinação do tronco para o lado da bola (máximo no golpe) | Double cross | 9 | 15–37 | -6 | 3 | 6 | ⚠️ limítrofe | A | E-A, E-B, E-E | pior fase: mao; fases: mao 9, descendo 11, subindo 9 |
| Inclinação do tronco para o lado da bola (máximo no golpe) | Hesi-cross | 21 | 15–37 | 0 | 3 | 6 | ✅ aprovado | A | E-A, E-B, E-E | pior fase: mao; fases: mao 21, descendo 21, subindo 21 |
| Varredura do tronco pico a pico no golpe | Crossover parado | 15 | 37–54 | -22 | 5 | 9 | ❌ reprovado | A | E-A, E-B, E-E | pior fase: subindo; fases: mao 16, descendo 15, subindo 15 |
| Varredura do tronco pico a pico no golpe | Entre as pernas | 13 | 37–54 | -24 | 5 | 9 | ❌ reprovado | A | E-A, E-B, E-E | pior fase: descendo; fases: mao 13, descendo 13, subindo 13 |
| Varredura do tronco pico a pico no golpe | Behind-the-back | 29 | 37–54 | -8 | 5 | 9 | ⚠️ limítrofe | A | E-A, E-B, E-E | pior fase: mao; fases: mao 29, descendo 29, subindo 29 |
| Varredura do tronco pico a pico no golpe | Double cross | 15 | 37–54 | -22 | 5 | 9 | ❌ reprovado | A | E-A, E-B, E-E | pior fase: subindo; fases: mao 16, descendo 17, subindo 15 |
| Varredura do tronco pico a pico no golpe | Hesi-cross | 30 | 37–54 | -7 | 5 | 9 | ⚠️ limítrofe | A | E-A, E-B, E-E | pior fase: descendo; fases: mao 30, descendo 30, subindo 30 |
| Velocidade de pico da inclinação do tronco (a 30 fps) | Crossover parado | 212 | 90–150 | 62 | 15 | 125 | ⚠️ limítrofe | A | E-B | pior fase: subindo; fases: mao 185, descendo 154, subindo 212; descontando o viés do pipeline (-93,53): aprovado |
| Velocidade de pico da inclinação do tronco (a 30 fps) | Entre as pernas | 89 | 90–150 | -1 | 15 | 125 | ✅ aprovado | A | E-B | pior fase: mao; fases: mao 89, descendo 89, subindo 89; descontando o viés do pipeline (-93,53): reprovado |
| Velocidade de pico da inclinação do tronco (a 30 fps) | Behind-the-back | 199 | 90–150 | 49 | 15 | 125 | ⚠️ limítrofe | A | E-B | pior fase: mao; fases: mao 199, descendo 185, subindo 185; descontando o viés do pipeline (-93,53): aprovado |
| Velocidade de pico da inclinação do tronco (a 30 fps) | Double cross | 212 | 90–150 | 62 | 15 | 125 | ⚠️ limítrofe | A | E-B | pior fase: subindo; fases: mao 186, descendo 184, subindo 212; descontando o viés do pipeline (-93,53): aprovado |
| Velocidade de pico da inclinação do tronco (a 30 fps) | Hesi-cross | 365 | 90–150 | 215 | 15 | 125 | ❌ reprovado | A | E-B | pior fase: mao; fases: mao 365, descendo 365, subindo 365 |
| Overshoot do tronco (passa do alvo e assenta em 12–20 q) | Crossover parado | 0,27 | 0,25–0,35 | 0,00 | 0,10 | — | ✅ aprovado | M | E-F | pior fase: descendo; fases: mao 0,31, descendo 0,27, subindo 0,32 |
| Overshoot do tronco (passa do alvo e assenta em 12–20 q) | Entre as pernas | 0,17 | 0,25–0,35 | -0,08 | 0,10 | — | ✅ aprovado | M | E-F | pior fase: descendo; fases: mao 0,19, descendo 0,17, subindo 0,19 |
| Overshoot do tronco (passa do alvo e assenta em 12–20 q) | Behind-the-back | -0,14 | 0,25–0,35 | -0,39 | 0,10 | — | ❌ reprovado | M | E-F | pior fase: subindo; fases: mao -0,14, descendo 0,05, subindo -0,14 |
| Overshoot do tronco (passa do alvo e assenta em 12–20 q) | Double cross | 0,20 | 0,25–0,35 | -0,05 | 0,10 | — | ✅ aprovado | M | E-F | pior fase: mao; fases: mao 0,20, descendo 0,34, subindo 0,21 |
| Overshoot do tronco (passa do alvo e assenta em 12–20 q) | Hesi-cross | 0,38 | 0,25–0,35 | 0,03 | 0,10 | — | ✅ aprovado | M | E-F | pior fase: descendo; fases: mao 0,34, descendo 0,38, subindo 0,35 |
| Cabeça estável: desvio padrão da altura cabeça − ombros | Drible parado (linha de base) | 0,00 | 0,00–0,02 | 0,00 | 0,01 | 0,01 | ✅ aprovado | A | E-C, E-D |  |
| Cabeça estável: desvio padrão da altura cabeça − ombros | Crossover parado | 0,01 | 0,00–0,02 | 0,00 | 0,01 | 0,01 | ✅ aprovado | A | E-C, E-D | pior fase: mao; fases: mao 0,01, descendo 0,01, subindo 0,01 |
| Cabeça estável: desvio padrão da altura cabeça − ombros | Entre as pernas | 0,01 | 0,00–0,02 | 0,00 | 0,01 | 0,01 | ✅ aprovado | A | E-C, E-D | pior fase: descendo; fases: mao 0,01, descendo 0,01, subindo 0,01 |
| Cabeça estável: desvio padrão da altura cabeça − ombros | Behind-the-back | 0,01 | 0,00–0,02 | 0,00 | 0,01 | 0,01 | ✅ aprovado | A | E-C, E-D | pior fase: mao; fases: mao 0,01, descendo 0,01, subindo 0,01 |
| Cabeça estável: desvio padrão da altura cabeça − ombros | Hesitação | 0,01 | 0,00–0,02 | 0,00 | 0,01 | 0,01 | ✅ aprovado | A | E-C, E-D | pior fase: descendo; fases: mao 0,01, descendo 0,01, subindo 0,01 |
| Cabeça estável: desvio padrão da altura cabeça − ombros | Double cross | 0,01 | 0,00–0,02 | 0,00 | 0,01 | 0,01 | ✅ aprovado | A | E-C, E-D | pior fase: mao; fases: mao 0,01, descendo 0,01, subindo 0,01 |
| Cabeça estável: desvio padrão da altura cabeça − ombros | Hesi-cross | 0,01 | 0,00–0,02 | 0,00 | 0,01 | 0,01 | ✅ aprovado | A | E-C, E-D | pior fase: mao; fases: mao 0,01, descendo 0,01, subindo 0,01 |
| Cabeça estável: desvio padrão da altura cabeça − ombros | Step-back | 0,00 | 0,00–0,02 | 0,00 | 0,01 | 0,01 | ✅ aprovado | A | E-C, E-D | pior fase: mao; fases: mao 0,00, descendo 0,00, subindo 0,00 |
| Cabeça estável: desvio padrão da altura cabeça − ombros | BTB correndo (RT) | 0,00 | 0,00–0,02 | 0,00 | 0,01 | 0,01 | ✅ aprovado | A | E-C, E-D | pior fase: mao; fases: mao 0,00, descendo 0,00, subindo 0,00 |
| Cabeça estável: desvio padrão da altura cabeça − ombros | Cross correndo (RT: crossover de ataque) | 0,00 | 0,00–0,02 | 0,00 | 0,01 | 0,01 | ✅ aprovado | A | E-C, E-D | pior fase: mao; fases: mao 0,00, descendo 0,01, subindo 0,01 |
| Braço livre (guarda): punho afastado para o lado oposto ao da bola | Drible parado (linha de base) | 0,19 | 0,20–0,50 | -0,01 | 0,05 | 0,05 | ✅ aprovado | M | E-A, E-E |  |
| Braço livre (guarda): altura do punho | Drible parado (linha de base) | 0,65 | 0,50–0,70 | 0,00 | 0,05 | 0,11 | ✅ aprovado | M | E-A, E-E |  |
| Rotação do tronco no rocker (~45–50°) | — | — | 45–50 | — | 5 | — | — não existe | M | E-A | O rocker não existe; o giro máximo de cada golpe aparece na tabela por golpe. |

### §2.4 Duração por golpe

| Métrica | Golpe | Nós | 2K | Delta | Tol. | Margem do pipeline | Status | Conf. | Fonte | Nota |
|---|---|---|---|---|---|---|---|---|---|---|
| Crossover: bola em movimento (do começo à recepção do outro lado) | Crossover parado | 6,0 | 9,0–11,0 | -3,0 | 1,0 | 1,0 | ❌ reprovado | A | E-E | pior fase: mao; fases: mao 6,0, descendo 7,5, subindo 6,0 |
| Crossover: bola em movimento (do começo à recepção do outro lado) | Cross correndo (RT: crossover de ataque) | 7,0 | 9,0–11,0 | -2,0 | 1,0 | 1,0 | ⚠️ limítrofe | A | E-E | pior fase: mao; fases: mao 7,0, descendo 7,5, subindo 7,5 |
| Behind-the-back: bola sai da frente, passa atrás e volta à frente | Behind-the-back | 12,0 | 10,0–12,0 | 0,0 | 1,0 | 1,0 | ✅ aprovado | M | E-D | pior fase: mao; fases: mao 12,0, descendo 12,0, subindo 12,0 |
| Behind-the-back: bola sai da frente, passa atrás e volta à frente | BTB correndo (RT) | 12,0 | 10,0–12,0 | 0,0 | 1,0 | 1,0 | ✅ aprovado | M | E-D | pior fase: mao; fases: mao 12,0, descendo 12,0, subindo 12,0 |
| Entre as pernas: passe da bola por baixo | Entre as pernas | 8,5 | 11,0–13,0 | -2,5 | 1,0 | 1,0 | ❌ reprovado | A | E-F | pior fase: descendo; fases: mao 9,0, descendo 8,5, subindo 9,0 |
| Hesi-cross: do comando à recepção do cross (2 batidas + cross) | Hesi-cross | 23,5 | 24,0–29,0 | -0,5 | 3,0 | 1,0 | ✅ aprovado | M | E-F | pior fase: mao; fases: mao 23,5, descendo 24,5, subindo 23,5 |
| Double cross: do comando à 2ª recepção (passe lento + transição + passe rápido) | Double cross | 13,0 | 40,0–46,0 | -27,0 | 4,0 | 1,0 | ❌ reprovado | M | E-F | pior fase: mao; fases: mao 13,0, descendo 15,5, subindo 13,0 |
| Double cross: duração total com a recuperação | Double cross | 14,0 | 72,0–86,0 | -58,0 | 6,0 | 1,0 | ❌ reprovado | M | E-F | pior fase: mao; fases: mao 14,0, descendo 15,5, subindo 14,0 |
| Hesitação: duração da pausa (ação visível) | Hesitação | 12,0 | 13,0–15,0 | -1,0 | 3,0 | 1,0 | ✅ aprovado | M | E-E | pior fase: mao; fases: mao 12,0, descendo 12,0, subindo 12,0 |
| Step-back: recuo do corpo | Step-back | 0,82 | 0,50–0,70 | 0,12 | 0,10 | — | ❌ reprovado | M | E-C | pior fase: mao; fases: mao 0,82, descendo 0,82, subindo 0,82 |
| Step-back: tempo do comando ao fim do recuo | Step-back | 13,0 | 15,0–21,0 | -2,0 | 2,0 | 1,0 | ✅ aprovado | M | E-C | pior fase: subindo; fases: mao 16,5, descendo 14,0, subindo 13,0 |

## 5. Calibração do pipeline de vídeo (margem dos números do 2K)

Vídeos: 12 cenários do motor gravados a 30 fps com a câmera atrás e acima (retrato 822×1506, FOV 40°, 8,5 m atrás e 3,1 m de altura; S mediano no vídeo ≈ 272 px, como os ~295 px do 2K). Pose encontrada em 831/874 quadros; bola em 599/874. Troca esquerda/direita dos punhos pelo MediaPipe: 0% dos quadros.

Erro por quadro (vídeo − verdade). Geometria = landmarks perfeitos (projetados do motor) passados pelo derivar.py, contra a verdade em metros/1,45; detector = MediaPipe − landmarks perfeitos.

| Métrica (derivar.py) | Unid. | Viés total | RMS total | p90 \|erro\| | Viés da geometria | Viés do detector | RMS do detector | Quadros |
|---|---|---|---|---|---|---|---|---|
| quadril_altura | S | +0,001 | 0,062 | 0,112 | +0,095 | -0,095 | 0,103 | 831 |
| base_largura | S | +0,099 | 0,105 | 0,136 | +0,052 | +0,046 | 0,049 | 831 |
| tronco_inclinacao | graus | -0,2 | 3,2 | 4,6 | -0,3 | +0,1 | 2,3 | 831 |
| tronco_rotacao | S | +0,070 | 0,073 | 0,093 | +0,043 | +0,027 | 0,032 | 831 |
| lpunho_altura | S | +0,087 | 0,108 | 0,169 | +0,164 | -0,079 | 0,085 | 831 |
| rpunho_altura | S | +0,101 | 0,113 | 0,168 | +0,174 | -0,072 | 0,078 | 831 |
| lpunho_lado | S | -0,038 | 0,050 | 0,086 | -0,040 | +0,003 | 0,027 | 831 |
| rpunho_lado | S | +0,053 | 0,063 | 0,083 | +0,042 | +0,011 | 0,029 | 831 |
| bola_altura | S | +0,120 | 0,214 | 0,188 | +0,174 | -0,049 | 0,178 | 588 |
| bola_lado | S | +0,077 | 0,337 | 0,127 | +0,015 | +0,064 | 0,327 | 588 |
| cabeca | S | +0,054 | 0,056 | 0,068 | +0,022 | +0,032 | 0,035 | 831 |

Erro nas métricas derivadas (uma por vídeo; vídeo − verdade):

| Métrica derivada | Viés | RMS | Máx. \|erro\| | Viés só da geometria | Vídeos |
|---|---|---|---|---|---|
| nivel_quadril | +0,004 | 0,062 | 0,136 | +0,094 | 12 |
| queda_quadril | +0,023 | 0,069 | 0,119 | -0,038 | 12 |
| nivel_base | +0,102 | 0,105 | 0,167 | +0,052 | 12 |
| base_min | +0,059 | 0,080 | 0,105 | +0,019 | 12 |
| base_max | +0,126 | 0,130 | 0,181 | +0,078 | 12 |
| inclinacao_max_abs | -4,5 | 5,5 | 9,2 | -2,5 | 12 |
| varredura_tronco | -6,9 | 8,6 | 18,0 | -3,7 | 12 |
| vel_tronco_pico | -93,5 | 125,2 | 287,5 | -46,3 | 12 |
| ombros_min | +0,045 | 0,046 | 0,061 | +0,033 | 12 |
| cabeca_desvio | +0,009 | 0,010 | 0,015 | +0,001 | 12 |

Quiques: 23 de 70 achados pelo derivar.py no vídeo (±2 q), 0 falsos; com landmarks e bola perfeitos, 14 de 70. Erro de tempo dos achados: viés -0,43 q, RMS 0,66 q. A bola no chão aparece a 0,27 S acima dos tornozelos na imagem (ela quica à frente dos pés e a câmera é alta), por isso o limite de 0,15 S do `derivar.py` perde quiques; com `--limite-quique 0.35` o mesmo detector acha 67 de 70 (1 falso(s)) e, com landmarks perfeitos, 69.

## 6. O que não deu para medir (e por quê)

- **Golpes que não existem no jogo** (Fase 4): rocker/momentum (C2), escape entre as pernas com passo cruzado e arranque
  (C1), hesi-cross de duas batidas (C3), double cross lento → rápido (C4), sai e volta (C5), double BTB como golpe próprio
  (C6), breakdown + step-back do SGA (C7), hold/pausa com a bola segurada e push ao ombro. As métricas que só existem
  nesses golpes (ápice do rocker, giro do tronco no rocker, duração do hold, punho a 0,9 S) aparecem como "não existe".
  Onde há um equivalente medimos o equivalente: double BTB = dois BTB em sequência (`btb_btb`); hesi-cross e double cross
  = os nossos (switchback e double throw do Pro Stick); a pausa = a hesitação.
- **Latência real do 2K.** O overlay de setas dos tutoriais foi montado na edição e não é relógio de input (doc 27 §0 e
  §9). O alvo de 0–3 q é a leitura visual "o corpo inverte no próprio flick". A nossa latência é exata (contrafactual no
  laboratório determinístico), mas o número do 2K tem confiança média.
- **Comandos com RT parados.** A camada turbo (D1) não existe: com RT os toques parados viram escapes genéricos. Os golpes
  parados foram medidos sem RT (os size-ups que existem); os correndo, com RT, como no 2K.
- **Velocidades correndo do 2K** vêm de um proxy (deslocamento do fundo da quadra, E-D), não de medida direta; o arranque e
  a parada têm confiança média.
- **Quiques do 2K pelo CSV.** O detector de quique do `derivar.py` com os padrões (limite de 0,15 S acima dos
  tornozelos) perde a maior parte dos quiques numa câmera alta, porque a bola à frente dos pés aparece acima deles na
  imagem (seção 5). No 2K o problema maior era o detector de bola, que travava longe do jogador e no joelho. A re-medição
  com `medir.py --bola-perto` e `derivar.py --limite-quique 0.35 --raio-min 0.8` está em
  `docs/dev/drible-2k/quiques-2k.md`: confirma os alvos de crossover (10 q), correndo (15 q) e drible parado, e corrigiu o
  BTB duplo de ~7 q para 15 q.
- **A calibração usa a nossa câmera e o nosso boneco**, parecidos com os do 2K (atrás e acima, retrato, S ≈ 270–300 px),
  mas não iguais: proporções, roupa e lente diferem. A margem do pipeline é a ordem de grandeza do erro dos números do 2K,
  não uma correção exata. O viés medido só é mostrado (coluna Nota), não descontado do alvo.
- **Pernas e pés no vídeo** (joelhos, calcanhares, passada correndo) não entram na régua: o MediaPipe de costas é instável
  neles (E-D) e não há alvo do 2K confiável.
- **Lateralidade (mão direita × esquerda)** de parte dos trechos do 2K continua incerta (doc 27 §9). A régua compara a
  inclinação "para o lado da bola", sem depender da mão.
- **Spin, half spin, in-and-out e retreat** ficaram fora: não há número do 2K para eles nos vídeos.

## 7. Como reproduzir

```bash
cd web
python -I tools/feel/preparar.py
node tools/feel/regua.mjs
```

O `regua.mjs` sobe um Vite próprio sem HMR na porta 5191 (nunca a 5173 do diretor), roda os cenários de
`tools/cenarios-feel.mjs` no laboratório em passo fixo, grava os vídeos de calibração, roda o MediaPipe e escreve este
arquivo. Os dados por quadro e os vídeos do nosso jogo ficam em `Saved/feel/<data>/` (fora do git). Detalhes em
`web/tools/feel/README.md`.
