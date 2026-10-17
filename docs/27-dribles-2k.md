# 27 — Dribles com o feel do 2K: engenharia reversa por evidência e plano completo

> Sessão de 2026-10-16/17. Pedido do diretor: replicar "com maestria e perfeição" a gameplay fluida de dribles de dois
> vídeos de referência do NBA 2K27 (turbo + flicks do analógico direito), seguindo os mesmos comandos, com um plano de
> ponta a ponta e a primeira fase delegada. Complementa `02-controles.md` §2, `04-animacoes.md` §2-3,
> `05-gameplay-ataque.md` §2 e `dev/HANDOFF-FLUIDEZ.md` (o diário da fluidez, que continua valendo).

## 0. Como isto foi feito (e o que o REA faz aqui)

**Material.** Duas gravações de tela de tutoriais do 2K27, guardadas só na máquina do diretor (não versionar vídeo
nem quadros do 2K neste repositório):

| | Arquivo (local) | Duração | O que mostra |
|---|---|---|---|
| Vídeo 1 | `…ScreenSketch…\Recordings\20261017-0048-26.7337847.mp4` | 62 s, 1858 quadros, 30 fps, 822×1506 | momentum spam, double behind-the-back E/D, "Jordan pull" + step-back do SGA, behind-the-back correndo, montagem final |
| Vídeo 2 | `…ScreenSketch…\Recordings\20261017-0054-03.8872185.mp4` | 19,5 s, 585 quadros, 30 fps, 848×1458 | escape entre as pernas, hesi-cross combo, double cross combo, "sai e volta" |

**Pipeline** (`web/tools/feel/`, Python com `python -I`):

1. `medir.py`: por quadro, pose do MediaPipe (heavy) e bola (cor HSV + raio inscrito), mais `diff` para achar quadro
   congelado ou câmera lenta.
2. `derivar.py`: normaliza pelo tamanho do corpo `S` (ombro médio → tornozelo médio; **1 S ≈ 1,45 m** num jogador de
   1,86 m). Calcula altura do quadril, largura da base, inclinação e giro do tronco, punhos, bola e quiques.
3. `folhas.py`: folhas de contato com **todos os quadros** (30 por folha), recortadas no jogador, com esqueleto e bola.
4. `transcrever.py`: faster-whisper na narração (os comandos falados).
5. Seis agentes leram as 82 folhas quadro a quadro, um trecho cada. Relatórios em `dev/drible-2k/evidencia-A.md` …
   `evidencia-F.md`; métricas por quadro em `dev/drible-2k/dados/`. Um sétimo agente mapeou o nosso código (resumo no §3).

**REA.** O REA (instalado no Claude Code: MCP `rea` + skill `reverse-engineer-anything`) é para binários e pacotes.
Ele **não** é usado no executável do 2K: a licença proíbe, e o formato das animações é fechado. Aproveitamos o
**método** dele, a reconstrução a partir de evidência de runtime. Cada afirmação deste documento tem fonte (`E-x`), os
limites ficam explícitos, e o que não sabemos está listado (§9). O REA continua útil para outras coisas, por exemplo
inspecionar um bundle JavaScript de outro jogo web com `analyze-javascript-application`.

**Ressalvas gerais.**
- Os primeiros ~4 s do vídeo 1 estão em câmera lenta: só servem para pose, nunca para tempo.
- O resto é tempo real. A fonte tem ~27,5 fps reamostrada a 30, com um quadro duplicado a cada 12.
- O overlay do controle (setas) foi montado na edição e **não serve de relógio de input**: o corpo às vezes começa 5 a
  15 quadros antes da seta (E-B, E-C, E-D).
- A detecção da bola falhou em vários trechos. As alturas de bola vêm da leitura visual.
- Nomes de golpe sem narração são identificação visual.

## 1. Os comandos (o que o diretor quer replicar)

Tudo **segurando o turbo (RT)**. Direções no referencial da mão da bola (bola na direita; com a bola na esquerda,
espelha). "Mão livre" = a mão sem a bola.

| # | Comando (narração + overlay) | O que acontece no 2K | Fonte |
|---|---|---|---|
| C1 | RT + flick **diagonal para cima, para o lado da mão livre** | **Escape entre as pernas**: o passe por baixo vira passo cruzado e arranque | E-F §2.1 |
| C2 | RT + flicks **alternados ↖ / ↗** ("para cima, vai e volta"), parado | **Momentum (rocker)**: base aberta, a bola passa entre as pernas a cada flick, os pés não cruzam | E-A |
| C3 | RT + flick **horizontal para o lado da mão livre** | **Hesi-cross combo**: duas batidas de pés (finta) e crossover encadeado | E-F §2.2 |
| C4 | RT + flick **para o lado da bola e logo para o outro** | **Double cross combo**: 1º passe lento, transição, 2º passe rápido com agachamento | E-F §2.3 |
| C5 | RT + flick **para longe da mão da bola e de volta** | **Sai e volta** (in-and-out cruzado) | E-F §2.4 (confiança baixa) |
| C6 | RT + flick **diagonal para baixo** (↙/↘), parado, duas vezes | **Double behind-the-back**: dois BTB emendados, sem pausa | E-B |
| C7 | RT + **↑ depois ↓** | **Breakdown ("Jordan pull") + step-back do SGA** | E-C |
| C8 | RT + flick **diagonal para baixo correndo** | **Behind-the-back correndo**, sem perder velocidade | E-D |

**Como isso encaixa com o nosso Pro Stick hoje** (`sim/HoopsDribbleMoves.ts:141-176`):

- Sem RT: ↑ cross, ← entre as pernas, ↙ BTB, → hesitação, ↗ in-and-out, ↓ step-back, ↘ retreat.
- Com RT só existem três variantes: cross de ataque, escape de hesitação e escape de step-back.

A proposta (decisão **D1**) é uma **camada turbo**:

- Com RT, os flicks resolvem para os golpes C1–C8.
- Sem RT, fica o mapa atual dos size-ups.
- C2 é o C1 encadeado. Cada escape entre as pernas troca a mão, então "para o lado da mão livre" alterna ↖/↗ sozinho.
  É por isso que no vídeo o comando é "vai e volta".
- C6 usa o `DoubleThrow`, que é o mesmo gesto do double cross, na direção do BTB.

## 2. A régua: números do 2K (alvos)

Unidades: `S` = 1,45 m; quadros a 30 fps (1 q = 33 ms). Conversão para o nosso jogador (1,86 m): multiplique `S` por
1,45 m. "Conf." = confiança (A alta, M média, B baixa).

### 2.1 Resposta e encadeamento (o que mais pesa no "feel")

| Métrica | 2K | Nós hoje | Conf. | Fonte |
|---|---|---|---|---|
| Comando → primeira reação do corpo (tronco/mão) | **0–3 q (0–100 ms)**. O corpo inverte no próprio flick | flick na borda ~25 ms + 1 quadro, mas **step-back ~0,2 s** e **até 0,45 s esperando a bola chegar à mão** (`Freestyle.ts:592-611`) | M | E-A, E-B |
| Comando → bola começar a cruzar | 1–3 q | depende da bola estar na mão | M | E-D |
| Corpo × bola | **desacoplados**: o corpo reage já e a bola chega ao lado novo 14–24 q depois (rocker) | o corpo espera a bola (`ballReadyForMove`) | A | E-A |
| Pose neutra entre golpes | **nenhuma**: sobreposição de 0–2 q (BTB→BTB) a 3–6 q (pull→agachamento) | buffer de 0,15 s mais o pendente de 0,45 s em cascata | A | E-B, E-C |
| Quando o próximo golpe entra | no "vale" da base (pés juntos), −2 a +5 q | qualquer momento depois do commit | M | E-A |
| Arranque e parada correndo | **1–3 q**, sem curva visível; a velocidade não cai na troca de mão | aceleração 6,5 m/s² (0→3,9 m/s em ~0,6 s), freio 14 m/s² | M (proxy da câmera) | E-D |

### 2.2 Ritmo e bola

| Métrica | 2K | Nós hoje | Conf. | Fonte |
|---|---|---|---|---|
| Quique no crossover parado | **10 q (0,33 s)**; ciclo E-D-E de 20–21 q | idle ~0,42 s (2,4/s) | A | E-E |
| Quique no BTB duplo | ~7 q (0,23 s) | — | B | E-B |
| Quique correndo | **15 q (0,5 s)**, ~1 a cada 2 passadas | ~0,34 s (2,9/s) | M | E-D |
| Bola cruzando de um quadril ao outro (cross) | **4–6 q** | ~0,2 s (clipe esticado) | A | E-E |
| Altura da bola cruzando entre as pernas | ~0,3 S (≈0,45 m) | — | M | E-A |
| Ápice lateral no rocker | 0,6–0,7 S (≈0,9–1,0 m) | palma 0,69–0,89 m parado | M | E-A |
| "Pausa" com a bola segurada (hold) | 0,4–1,3 s, um estado próprio, sem quicar | não existe | M | E-D |
| Bola no ombro (push alto) | punho de 0,5 a 0,9 S em 3–5 q; desce em 6–9 q | não existe | M | E-E |

### 2.3 Corpo

| Métrica | 2K | Nós hoje | Conf. | Fonte |
|---|---|---|---|---|
| Quadril neutro (drible) | 0,48–0,58 S | crouch 0,17 m parado | M | E-B, E-C, E-E |
| Queda do quadril num golpe | **−0,08 a −0,14 S (12–20 cm)** em 6–11 q; volta em 0,4–0,5 s | crouch fixo por estado | A | E-B, E-F |
| Queda profunda (breakdown / step-back / double cross) | até **0,37 S (−36%)**, subida a 0,21 S/s | — | A | E-C, E-F |
| Antecipação antes do empurrão | **10–12 q**: quadril −0,07 a −0,13 S, mão sobe ~0,15 S, tronco 7–8° | `ActionInBlend` 0,12 s, sem carga | A | E-E, E-F |
| Base neutra | 0,45–0,8 S (≈0,65–1,15 m) | tornozelos ~0,62 m | M | E-B, E-E |
| Base aberta (rocker / pausas) | 0,8–1,3 S. No rocker os pés **não cruzam** | — | M | E-A, E-E |
| Passo cruzado | tornozelos a 0–0,2 S por 1–5 q; fecha em ~10 q e abre de novo em ~9 q | tesoura (`SplitStance`) | A | E-B, E-F |
| Inclinação do tronco para o lado da bola | **±15–37°**; varre 37–54° pico a pico em 10–11 q; pico de 90–150°/s | 8° + 2,5°/m/s; hesitação 17° | A | E-A, E-B, E-E |
| Overshoot do tronco | ~30%, assenta em 12–20 q | mola do BodyLean | M | E-F |
| Cabeça | estável: desvio de 0,02 S | — | A | E-C, E-D |
| Braço livre (guarda) | aberto 0,2–0,5 S para o lado oposto ao da bola, a 0,5–0,7 S de altura | `dribbleArmWeight` | M | E-A, E-E |
| Rotação do tronco no rocker | ~45–50° (os ombros aparentes caem de 0,33 para 0,22–0,25) | — | M | E-A |

### 2.4 Duração por golpe (2K × nós)

| Golpe | 2K (fases) | Nós (`Specs`) | Fonte |
|---|---|---|---|
| Crossover | cruza em 4–6 q; ciclo completo ~0,33 s | 0,40 s | E-E |
| Behind-the-back | **10–12 q (0,33–0,40 s)** | 0,45 s | E-D |
| Double BTB | 2 × BTB sem pausa (travas de pé a cada ~0,44 s) | não existe | E-B |
| Escape entre as pernas | antecipação 12 q + passe 12 q + cruzado 10 q + arranque 9 q + 2º passe 7 q + recuperação 12 q | entre as pernas 0,42 s | E-F |
| Hesi-cross | 2 batidas de base (15–20 q) + cross 9 q + agachamento 11 q | 0,60 s | E-F |
| Double cross | passe lento 20 q + transição 13 q + passe rápido 10 q + recuperação 36 q (≈2,6 s no total) | 0,70 s | E-F |
| Step-back (SGA) | recuo ~0,6 m em 0,6 s, o pé do lado da bola primeiro; retorno de 0,4 S em 0,4 s | 0,50 s | E-C |
| Rocker (momentum) | período vale-a-vale 0,5 s (livre) a ~1 s (a cada flick) | não existe | E-A |

**Padrão geral do feel** (E-F §4, E-E §5):
- **Passes "snappy"**: 9–12 q, ease in-out, com 1–3 q de pausa nos extremos.
- **Recuperação pesada**: 12–36 q.
- **Antecipação curta, mas presente.**
- **O corpo vende o golpe antes da bola.**

## 3. Onde estamos (mapa do nosso drible)

Fluxo (detalhe com linhas no relatório do mapeamento, resumido aqui):

`Input.read` (RS sem zona morta radial) → `ProStickRecognizer` (Flick/Hold/Rotation/QuarterCircle/DoubleThrow/
Switchback; flick na borda em ~25 ms, **menos para baixo**) → `DribbleController.resolveGesture/request` (Specs,
commit, combo de 0,15 s fixo, buffer de 0,15 s, misdirection, energia, arranque) → `Freestyle` (pendente de até 0,45 s
esperando a bola; impulso; `syncMoveStart` → `animator.playMove(kind, hand, dur)`) → `PlayerAnimator` (loop base com
fase casada; ação com **reset duro do clipe** e inertialization de 0,12 s; **clipe esticado de 1,2x a 2,0x** para
caber em `Specs`; pernas da locomoção só em 4 golpes; postura, peso, pés e IK) → `BallDribbler` (bola cinemática:
segura ou em arco) → render. Online: só vai `(kind, hand, dur)` (`AnimRecorder`/`Payload` v3), e um `MoveKind` novo
sem bump de versão **derruba a amostra inteira** no cliente antigo.

**As 10 limitações que nos separam do 2K** (as fontes estão no relatório de mapeamento):

1. O corpo espera a bola: dois buffers em cascata (0,45 s + 0,15 s).
2. A janela de combo é igual para todos os golpes (0,15 s) e não há lista de cancelamento por fase
   (Startup/Commit/Recovery do `04` §2).
3. O clipe é esticado para caber na duração do núcleo, e o ritmo do mocap se perde. A ação começa com reset duro, sem
   casar com a passada.
4. A postura é fixa por estado: não há queda de quadril nem antecipação por golpe, e a inclinação do tronco é pequena.
5. Não existe camada turbo: o BTB ignora o RT, e o "escape" é um comportamento genérico de passos.
6. Faltam os golpes C1, C2, C3 de duas batidas, C4 lento→rápido, C5, C6, C7 e o hold/pausa.
7. Drible em movimento: só cross, escape-cross, entre as pernas e BTB usam as pernas da locomoção. A aceleração é
   lenta (6,5 m/s²).
8. O step-back só sai com o stick voltando ao centro (~0,2 s).
9. O HesiCross e o InAndOut não têm clipe próprio (reusam o cross e a hesitação). O Retreat não tem clipe.
10. O online não transmite golpe, combo, energia nem arranque.

## 4. Princípios do desenho

1. **Corpo primeiro, bola depois.** O comando muda o corpo no mesmo quadro (tronco, quadril, mão). A bola obedece a
   física e às "promessas" do golpe e chega quando chegar. Acaba a espera pela bola na mão.
2. **Golpe = curvas por fase, não clipe esticado.** Cada golpe tem marcadores (carga, empurrão, travessia, recepção,
   recuperação) com duração própria vinda da régua. O clipe, quando existe, é reamostrado **por fase**, e as camadas
   procedurais (quadril, tronco, braço livre, pés) seguem curvas medidas.
3. **Cancelamento por fase.** Startup e commit não cancelam. A recuperação cancela para qualquer golpe ou arremesso.
   O combo entra no "vale" (os últimos 3–6 q da travessia ou da recuperação).
4. **Camada turbo** separada do size-up (D1), com os golpes C1–C8.
5. **Medir sempre contra a régua.** Nada é "melhor" sem número. O mesmo pipeline que mediu o 2K mede o nosso jogo.
6. **Coordenação.** Outras sessões mexem em `PlayerAnimator`, `Freestyle` e `BallDribbler`. Cada fase lista os
   arquivos que toca. Commit, deploy e push são do dono do release (memória "dono único").

## 5. O plano, fase por fase

Cada fase termina verde (`npm run typecheck`, `npm test`, os e2e de drible) e com a régua rodada antes e depois.

### Fase 1 — Régua do feel (medidor nós × 2K) · *delegada*

**Objetivo:** um comando que gera, para o nosso jogo, os mesmos números do §2, e uma tabela "nós × 2K" com
aprovado/reprovado por tolerância. Sem mudar gameplay.

- `web/tools/feel/`:
  - transformar os scripts em ferramenta (README, `requirements.txt`, entrada e saída por argumento);
  - `referencia-2k.json` com os alvos e as tolerâncias do §2, cada um com a sua fonte `E-x`.
- **Verdade do motor:** cenários de laboratório (fixed step, Vite próprio sem HMR, `LAB_ORIGIN`) que executam
  sequências de input equivalentes aos trechos do 2K. Golpes que já existem: cross parado, entre as pernas, BTB,
  hesitação, double cross, hesi-cross, step-back, BTB correndo, cross correndo. Por quadro, o cenário exporta em metros
  e graus:
  - quadril, base, tronco (inclinação e giro), punhos, cabeça e bola;
  - eventos de quique;
  - **latência comando → primeiro deslocamento visível** (de osso do tronco e da mão > 1 cm ou 2°) e
    comando → bola começar a cruzar;
  - duração de cada fase.
- **Calibração do pipeline de vídeo:** gravar os mesmos cenários com câmera atrás e acima, parecida com a do 2K (30 fps),
  e passar pelo `medir.py`/`derivar.py`. A diferença entre o vídeo e a verdade do motor dá o erro do pipeline, e esse
  erro vira a margem de confiança dos números do 2K.
- `comparar` → `docs/dev/drible-2k/linha-de-base.md`: tabela por métrica e por golpe (nós, 2K, delta, tolerância,
  status).
- Testes: unitário da derivação de métricas (um quadro sintético → números esperados).
- **Pronto quando:** um comando roda tudo e a linha de base está escrita, com as 10 maiores diferenças ordenadas pelo
  impacto no feel.
- Arquivos: só novos (`web/tools/feel/*`, `web/tools/cenarios-feel.mjs` ou entradas novas em `tools/cenarios.mjs`,
  `docs/dev/drible-2k/*`). Se precisar expor dado do animador, apenas leitura via `window.__debug`.

### Fase 2 — Resposta imediata e encadeamento

- O corpo reage no quadro do comando: o golpe começa já com a "carga" do corpo, e a bola segue o que der (o fim do
  pendente de 0,45 s vira, no máximo, uma espera **só da bola**).
- Flick para baixo na borda (o step-back sai em ~25 ms, como os outros), com o Hold de arremesso protegido por um
  limiar de tempo maior ou por zona.
- Fases por golpe (`startup`, `commit`, `recovery`) em `Specs` e uma lista de cancelamento. Janela de combo por golpe
  (com o Ball Handle, como diz o `05` §2.2). Entrada do combo no vale.
- Ação sem reset duro: entrar no golpe pela fase compatível da passada ou do quique.
- **Pronto quando:** na régua, latência ≤ 2 q (66 ms), em todo golpe e com a bola em qualquer fase, e nenhum quadro
  de pose neutra entre golpes em combos.
- Arquivos: `HoopsProStick.ts`, `HoopsDribbleMoves.ts`, `Freestyle.ts` (`flushPendingMove`/`syncMoveStart`),
  `PlayerAnimator.startAction`. Testes de núcleo em `HoopsSim.test.ts`.

### Fase 3 — Corpo do 2K no drible (camadas procedurais guiadas pela régua)

- Curvas por golpe: queda e volta do quadril, antecipação de 10–12 q, inclinação do tronco para o lado da bola
  (±15–37°) com overshoot de ~30%, cabeça estabilizada, braço livre de guarda, base que respira (abre e fecha),
  passo cruzado nas trocas.
- Live dribble: quique de 0,33 s no size-up, base 0,45–0,6 S, balanço do corpo.
- Tempo por fase com a duração da régua (§2.4), sem esticar o clipe por igual.
- **Pronto quando:** cada métrica do §2.3 está dentro da tolerância em pelo menos 8 dos 9 golpes medidos.
- Arquivos: `PlayerAnimator` (`applyStance`/`applyWeightShift`/`applyBodyLean`/`applyArms`), `DribbleFootwork.ts`,
  `ProceduralMoves.ts`, `ClipLibrary.MoveTimings`.

### Fase 4 — Camada turbo e golpes novos

Em ordem de valor e risco:

1. C1, escape entre as pernas (um golpe só, com arranque);
2. C2, rocker (o C1 encadeado no lugar, com base aberta e sem cruzar os pés);
3. C6, double BTB;
4. C3, hesi-cross de duas batidas;
5. C4, double cross lento→rápido;
6. C7, breakdown + step-back do SGA;
7. C5, sai e volta;
8. hold/pausa com a bola segurada e push ao ombro.

Cada golpe leva:

- `DribbleMove` + `Specs` com fases, `moveKindFor`, `MoveKind`/`MoveTimings`;
- animação (procedural guiada pela régua ou mocap próprio, D3);
- `flickFor`/`startMove` da CPU;
- cenário de laboratório e teste.

- **Pronto quando:** os 8 golpes saem com os comandos do §1 e passam na régua.

### Fase 5 — Drible em movimento

- Arranque e parada com o feel do 2K (aceleração muito maior com RT, ≤ 3 q para responder), sem perder velocidade na
  troca de mão. O corpo corre para o lado onde a bola cruza.
- Pernas da locomoção em todos os golpes que podem ser feitos andando ou correndo. C8, BTB correndo. Quique de 0,5 s
  correndo.
- Coordenar com `dev/RESPONSIVIDADE-MOVIMENTO.md` (a outra sessão de movimento).
- **Pronto quando:** BTB e cross correndo mantêm ≥ 90% da velocidade e o quique correndo fica em 0,5 ± 0,07 s.

### Fase 6 — Bola

- Caminhos por golpe com as alturas da régua: travessia baixa a 0,3 S, ápices, quique no centro entre os pés.
- Aceleração da bola no empurrão, recepção amortecida, push ao ombro e hold.
- Colisão de perna como contato e não como desvio de arco, se a régua mostrar que é preciso.

### Fase 7 — CPU, online e interface

- CPU usando a camada turbo (combos por estilo e nível).
- Online: `PayloadVersion` 4 com `MoveKind` novos (e, se a Fase 2 pedir, fase/combo no `move`). Publicar os dois sites
  juntos (`npm run publicar`, pelo dono do release).
- Tela de controles e tutorial com os comandos C1–C8.

### Fase 8 — Validação final "lado a lado"

- O mesmo roteiro dos vídeos, gravado no nosso jogo com a câmera parecida, medido pelo mesmo pipeline. As tabelas do
  §2 ficam com as duas colunas, e as folhas de contato lado a lado vão para o diretor avaliar o feel.
- Teste de mão: o diretor joga com controle (Xbox/PS) cada combo dos vídeos.

## 6. Decisões em aberto (do diretor)

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Camada turbo: RT + flick vira os golpes C1–C8 e substitui as três variantes atuais com RT (cross de ataque, escape de hesitação, escape de step-back) | Sim. O cross de ataque passa a ser o C7 (↑ com RT) e o escape de step-back passa a ser o 2º tempo do C7 |
| D2 | Tempo dos golpes: régua do 2K (fases) × duração atual | Régua do 2K, por fase |
| D3 | Fonte da animação dos golpes novos: procedural guiada pela régua × mocap próprio (gravar a gente no celular → vídeo → mocap) | Procedural primeiro (mais rápido de iterar e medir). Mocap próprio depois, só para o rocker e o double BTB, se a régua mostrar que o procedural não chega |
| D4 | Online: subir `PayloadVersion` na Fase 4 ou só na Fase 7 | Na Fase 4, junto com o primeiro golpe novo |

## 7. Riscos

- **Sessões em paralelo** editando o animador: cada fase declara os arquivos e mede num Vite próprio.
- **Overfit no vídeo**: as fontes são tutoriais editados. A régua tem tolerâncias e não vira cópia pose a pose.
  Copiar a animação quadro a quadro do 2K (rotoscopia) **não** está no plano.
- **Câmera e perspectiva**: as medidas verticais vindas do vídeo têm erro, e a Fase 1 calibra esse erro.
- **Latência real do 2K**: não medida (o overlay não serve). A meta de ≤ 2 q é a nossa, e é conservadora.

## 8. Evidências (o livro de registro)

| Id | Arquivo | Trecho | Conteúdo principal |
|---|---|---|---|
| E-A | `dev/drible-2k/evidencia-A.md` | vídeo 1, 0–13 s | momentum spam (rocker): base, quadril, tronco, latência corpo × bola |
| E-B | `dev/drible-2k/evidencia-B.md` | vídeo 1, 12–24 s | double BTB E/D; turbo + diagonais para baixo; ritmo de base e quique |
| E-C | `dev/drible-2k/evidencia-C.md` | vídeo 1, 23–37 s | breakdown + step-back do SGA; agachamento profundo; recuo |
| E-D | `dev/drible-2k/evidencia-D.md` | vídeo 1, 36–51 s | BTB correndo; arranque e parada; quique correndo |
| E-E | `dev/drible-2k/evidencia-E.md` | vídeo 1, 50–62 s | linha de base do drible parado; crossovers; push ao ombro; pausas |
| E-F | `dev/drible-2k/evidencia-F.md` | vídeo 2, 0–19,5 s | escape entre as pernas, hesi-cross, double cross, sai e volta |
| — | `dev/drible-2k/dados/video{1,2}-metricas.csv` | todos os quadros | métricas por quadro (normalizadas por `S`) |

## 9. O que não sabemos (unknowns)

- A latência real de input do 2K (o overlay não serve). Só uma captura com o input real gravado resolveria.
- O significado da segunda caixa de setas do overlay no vídeo 1 (E-D).
- A lateralidade exata (mão direita × esquerda) em parte dos golpes, porque o pose troca L/R em alguns quadros.
- A trajetória completa da bola onde o detector falhou. Há uma hipótese de um quique por passagem no rocker.
- O C5 ("sai e volta") tem identificação de confiança baixa.
- Velocidades correndo vêm de um proxy, o deslocamento do fundo, e não de medida direta.
