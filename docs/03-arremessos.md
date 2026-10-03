# 03 — Sistema de Arremessos

> O arremesso é o coração do jogo. Se arremessar não for gostoso, nada mais importa.
> Meta: **todo acerto e todo erro precisa ser explicável** para o jogador em menos de 1 segundo.

## 1. Princípios

1. **Habilidade > sorte.** O tempo de soltura (timing) é o fator que o jogador controla; ele deve pesar mais do que qualquer número escondido.
2. **Aleatoriedade limitada e visível.** Existe variância (é basquete), mas ela é limitada por piso/teto e sempre mostrada no feedback pós-arremesso.
3. **Defesa importa.** Um arremesso perfeito contra uma contestação perfeita **não** é cesta garantida. Um arremesso perfeito livre **é**.
4. **Latência não pode roubar uma cesta.** O timing é julgado no relógio local da animação do cliente, não no servidor (ver §9).
5. **Trade-offs visíveis, não "jumper meta".** Personalização de arremesso tem custos e benefícios explícitos.
6. **A janela não muda depois do gather.** Nada de "a janela fugiu no ar" (a reclamação nº 1 sobre o arremesso do 2K27).

## 2. Tipos de arremesso

O tipo é escolhido pelo **contexto** (posição, velocidade, ação anterior) + **input** (botão ou analógico direito).

| Família | Tipos | Dificuldade base (D) | Observação |
|---|---|---|---|
| Spot-up / Catch & shoot | parado, pés já posicionados, relocation (passo lateral) | 1.00 | O mais fácil; recompensa movimentação sem bola |
| Pull-up | parado após drible, em movimento reto, drift lateral | 0.85–0.90 | Penalidade escala com velocidade no momento do gather |
| Step-back | lateral, para trás, double step-back | 0.80 | Cria espaço; ganha "bônus de separação" se tirou o defensor |
| Fadeaway / Turnaround | fade, turnaround, one-legged fade | 0.75 | Difícil de contestar (alto release point), janela menor |
| Floater / Runner | floater, runner, teardrop | 0.80 | Ganha bônus contra protetor de aro alto |
| Hook | jump hook, sky hook, baby hook | 0.85 | Garrafão, de costas ou em movimento |
| Bandeja | ver §7 | — | Sistema próprio |
| Enterrada | ver §7 | — | Sistema próprio |
| Lance livre | ver §8 | — | Mini-mecânica própria |
| Heave / meio da quadra | heave, buzzer-beater | 0.25 | Sempre possível, raramente entra |
| Tip-in / Putback | tapinha, putback layup/dunk | 0.70 | Depende de timing de pulo no rebote |

## 3. Modelo de probabilidade (em log-odds)

Trabalhamos em **log-odds** (logit) porque modificadores somam de forma estável e nunca estouram 0% ou 100%.

```
L = L_base(rating, distância, tipo)
  + T(timing)              // qualidade da soltura
  − K_c · contest          // contestação 0..1
  − K_f · fadiga           // 0..1
  − K_b · (1 − equilíbrio) // pés/momento no gather 0..1
  + Σ traits               // estilos/badges equivalentes (pequenos)
  + mira                   // só no modo analógico

P = clamp( sigmoid(L), P_min(tipo), P_max(tipo) )
```

### 3.1 Base (`L_base`)

Tabela por rating e distância, ajustada pelo multiplicador de dificuldade `D` do tipo. Os alvos abaixo são para **arremesso livre com soltura "Boa"** (não perfeita):

| Rating do atributo | 3PT livre "Bom" | Média distância livre "Bom" |
|---|---|---|
| 40 | 18% | 28% |
| 60 | 28% | 38% |
| 75 | 36% | 45% |
| 85 | 42% | 50% |
| 99 | 50% | 56% |

> Referência de realismo (aprox. NBA 2023–25): 3P% liga ≈ 36%, FG% ≈ 47%, LL ≈ 78%.
> Nosso alvo no modo "Sim-arcade padrão": estatísticas de box score **plausíveis** com um pouco mais de highlights — 3P% de partida entre 33–42%.

### 3.2 Timing (`T`)

O ponto ideal de soltura é marcado na animação por um `AnimNotify_ReleasePoint` (topo do salto, ajustável por perfil de arremesso). O offset `Δt` (ms) entre input e ponto ideal cai em uma faixa:

| Faixa | Largura (exemplo, rating 85, livre, velocidade normal) | Efeito em L | Feedback |
|---|---|---|---|
| **Perfeito** | ±30 ms | +2.5 (e **cesta garantida** se `contest < 0.30` e não for heave) | "PERFEITO" + som/rede especial |
| **Bom** | ±31–70 ms | +0.8 | "Bom" |
| **Leve cedo / leve tarde** | ±71–120 ms | −0.3 | "Cedo" / "Tarde" |
| **Muito cedo / muito tarde** | > 120 ms | −1.5 | "Muito cedo" / "Muito tarde" |

**Largura da janela Perfeito**, calculada **uma única vez, no gather**, e **travada** até a soltura:

```
W_perfeito = W_base(rating)          // 99 → ±45ms, 85 → ±30ms, 70 → ±24ms, 50 → ±18ms
           × M_tipo                  // spot-up 1.0, pull-up 0.85, step-back 0.8, fade 0.75, heave 0.3
           × M_velocidade_release    // rápido 0.85, normal 1.0, lento 1.15
           × (1 − 0.30 · fadiga)
           × M_sem_medidor           // 1.10 se o jogador desligou o medidor (incentivo a ler a animação)
```

A janela "Bom" é proporcional (≈ 2.3× a Perfeito) e a "Leve" ≈ 4×. Todos os números ficam em `CurveFloat`/`DataAsset` para tuning sem recompilar.

**Por que travar no gather?** A reclamação mais repetida sobre o 2K27 é que a janela "muda no meio do arremesso" e que o jogo parece "decidir aleatoriamente" (ver `01-engenharia-reversa-2k27.md §2.4`). Aqui, tudo que define a janela (rating, tipo, velocidade, fadiga, medidor) já é conhecido **antes** de o jogador sair do chão. A defesa age depois, só pela contestação em `L` (§3.3).

**Por que o rating mexe na janela?** No 2K27 o rating quase não altera o núcleo do green; ele só alarga o "ombro" (a faixa de quase-acerto). É um modelo limpo, mas no 2K26 ele gerou pivôs de 2,24 m acertando de 3 como especialistas, e a correção veio em patch e com tetos de atributo. Nós usamos um meio-termo: o rating alarga a janela Perfeito **moderadamente** (2,5× do 50 ao 99), muda o `L` base (o "ombro"), e os tetos físicos por corpo valem desde o design.

**Piso rígido**: depois de todos os multiplicadores, a janela Perfeito nunca fica menor que **±17 ms (2 frames a 60 Hz)**. Abaixo disso, o resultado vira loteria de frame — e loteria é o que queremos eliminar.

> Comparação com o 2K27 (medições da NBA2KLab): janela de green com **~35 ms** de largura a meia altura, núcleo "sempre green" de **4 ms** e pure green de ~15–20 ms ([comparação](https://www.nba2klab.com/shooting-comparison)). A nossa janela Perfeito para um rating 85 tem 60 ms no total: **de propósito mais generosa**. A dificuldade vem da contestação, do tipo de arremesso e de criar espaço, não de acertar um único frame (que, online, também depende do ping).

**Exemplo numérico (rating 85, 3PT, "Bom" livre = 42% → L = −0.32):**

| Situação | L | P |
|---|---|---|
| Perfeito, livre | — | **100% (garantido)** |
| Perfeito, contestação forte (0.8) | −0.32 + 2.5 − 1.44 = 0.74 | 68% |
| Bom, livre | −0.32 | 42% |
| Bom, contestação total (1.0) | −0.32 − 1.8 | 11% |
| Leve tarde, livre | −0.62 | 35% |
| Muito cedo, livre | −1.82 | 14% |

### 3.3 Contestação (`contest`)

Calculada no frame da soltura, **não** no início do arremesso (isso premia defensores que chegam a tempo):

```
contest = clamp( max_over_defensores( proximidade_mão_bola × cobertura_angular × fator_altura × fator_timing_pulo × fator_rating_defesa ), 0, 1 )
```

- `proximidade_mão_bola`: distância da mão mais alta do defensor até a linha bola→aro (não até o corpo do arremessador).
- `cobertura_angular`: defensor de frente cobre mais que defensor vindo de lado/trás.
- `fator_altura`: altura da mão do defensor vs. altura do release point (arremessos com release alto são mais difíceis de contestar).
- `fator_timing_pulo`: pular cedo demais = mão já descendo na soltura.
- `fator_rating_defesa`: Perimeter/Interior Defense (pequeno, ±15%).

Categorias para o HUD: **Aberto** (< 0.15) · **Leve** (0.15–0.40) · **Contestado** (0.40–0.70) · **Sufocado** (> 0.70).

Peso inicial: `K_c ≈ 1.8`. A contestação **não** mexe na janela (travada no gather). Ela age em `L` e no corte da cesta garantida (`contest < 0.30`). Assim o melhor arremessador ainda precisa de espaço, o defensor sente que fez diferença, e o atacante nunca sente que "a janela fugiu".

**O que se vê é o que conta**: o 2K27 é criticado por contestações visualmente fortes registradas como "leves". Aqui o número vem da **geometria** (mão → linha da bola). No replay e no modo treino, desenhamos essa linha e a mão que contou, com a cor da categoria. Se o número e a imagem discordam, é bug, não "RNG".

### 3.4 Outros fatores

- **Fadiga** (`K_f ≈ 0.8`): energia < 40% começa a doer. Visível na barra de energia.
- **Equilíbrio** (`K_b ≈ 0.7`): pés não posicionados, arremesso caindo de lado, recebendo passe ruim (passe na altura do joelho → catch pior).
- **Traits** (substituem badges): no máximo ±0.4 combinados. Ver `09-atributos-progressao.md`.
- **Sem "hot/cold" escondido.** Se existir modo "Em chamas", ele é visível (ícone) e ganho por desempenho.

## 4. Modos de input

| Modo | Como funciona | Público |
|---|---|---|
| **Botão (padrão)** | Segura **X/□** para iniciar, solta no ponto de soltura | Todos |
| **Analógico (Shot Stick)** | Puxa o RS para baixo para iniciar, empurra para cima para soltar. Desvio lateral do stick = erro de mira (esquerda/direita) | Jogadores avançados — janela de Perfeito +15%, mas mira pode errar |
| **Assistido** | Sem timing; usa resultado equivalente a "Bom" com −0.2 em L | Acessibilidade / casual. Fila ranqueada separada ou desabilitado no ranqueado |

**Pump fake**: toque rápido em X (< 120 ms) ou toque no RS para cima. Pump fake pode ser encadeado em drive/step-through (cancel window, ver doc de animação).

## 5. Medidor e feedback

### 5.1 Medidor (opções do jogador)

1. **Sem medidor** → ler a animação (topo do salto, bola saindo da mão). Janela +10%.
2. **Mínimo** → um ponto que acende acima da cabeça no momento ideal.
3. **Clássico** → barra vertical ao lado do jogador.
4. **Pés** → arco sob o jogador (não tampa a visão do aro).

### 5.2 Feedback pós-arremesso (o que mata a sensação de "RNG do 2K")

Painel compacto que aparece por ~1,2 s (configurável/desligável):

```
[  ▏▏▏▏▏▏▏█▏▏▏  ]  TARDE LEVE (+45ms)
Contestação: CONTESTADO (52%)   Fadiga: ●●●○○   Equilíbrio: OK
Chance final: 31%
```

- No modo treino há um **log detalhado** com o breakdown completo de L.
- No replay instantâneo, o feedback reaparece.

## 6. Criador de arremesso (Jump Shot Creator) com trade-offs

O jogador combina **Base** (parte de baixo do corpo/preparação) + **Soltura** (braços/release) + **Mistura** (blend %) + **Velocidade**. Cada componente tem stats visíveis:

| Stat | Efeito |
|---|---|
| Altura do release | ↑ dificulta contestação (`fator_altura`), ↓ janela levemente |
| Velocidade | ↑ menos tempo para o defensor chegar, ↓ janela Perfeito (×0.85) |
| Consistência | ↑ janela, ↓ velocidade |
| Alcance | arremessos longos (logo, 30+ pés) com menos penalidade de distância |

Orçamento fixo de pontos entre os 4 stats ⇒ não existe "jumper perfeito", existe o **seu** jumper. Restrições físicas: altura do jogador limita algumas bases (pivô de 2,13 m não usa base de armador baixo).

## 7. Finalizações perto do aro

### 7.1 Bandejas

- **Input**: X (ou RS) dentro da "zona de finalização" (≈ 4,5 m do aro, varia com velocidade).
- **Escolha do tipo** pela direção do RS/LS no gather:

| Input no gather | Bandeja |
|---|---|
| Padrão | Bandeja normal (mão forte/fraca automática pelo lado) |
| RS para fora | Euro step |
| RS para dentro | Hop step |
| RS para trás | Reverse / Bandeja por baixo do aro |
| RS para frente | Finger roll / Scoop |
| RS em meia-lua | Spin layup |
| Segurar LT | Bandeja protegida (cradle) — melhor em contato, mais lenta |

- **Timing de bandeja**: janela **larga e opcional** (Perfeito dá +0.6, nada de penalidade forte). Bandeja depende principalmente de rating (Driving Layup/Close Shot), ângulo, contato e contestação.
- **Contato** (ver `07-fisica-colisao.md`): resultado sorteado em tabela por ratings + posicionamento → `limpo`, `and-one`, `erro com falta`, `toco`, `ofensiva (carga)`.

### 7.2 Enterradas

- **Input**: segurar Sprint (RT) + X na zona de enterrada; RS escolhe estilo (1 mão, 2 mãos, flashy, contato).
- **Pré-requisitos**: atributos Driving/Standing Dunk + Vertical + altura. Jogador baixo sem impulsão faz bandeja em vez de enterrar (com fallback automático, sem animação "travada").
- **Enterrada com contato (poster)**: o momento-pico de diversão. Chance:
  ```
  poster = σ( Dunk·0.04 + Vertical·0.02 + Força·0.015 − (Block·0.03 + Vertical_def·0.015 + Força_def·0.015) + bônus_timing_pulo_def + bônus_ângulo )
  ```
  Defensor que **pula na hora certa e está em verticalidade** (mãos para cima, sem ir para frente) vence com frequência — e não toma falta. Defensor que pula atrasado/de lado vira pôster.
- **Alley-oop**: passe com Y; o recebedor tem janela de catch; timing do salto do recebedor decide a qualidade.
- **Sem medidor obrigatório em enterrada.** O 2K27 colocou medidor em todas as enterradas, com a janela mudando do salto até a finalização. O skill gap foi elogiado, mas houve reclamação de que a janela reage tarde demais ao closeout. Aqui o resultado é decidido **no salto** (ratings + contato + posição do defensor). Opcional (P2): um timing de "finalização forte" com janela fixa, que só dá bônus e nunca transforma uma enterrada livre em erro.

## 8. Lance livre (mini-mecânica)

- **Fase 1 — Mira**: um ponto oscila horizontalmente; amplitude ∝ (100 − FT rating) e cresce com pressão (clutch, torcida, fadiga).
- **Fase 2 — Timing**: mesma lógica do jumper, janela maior (lance livre é rotina).
- Ritual personalizável (quicadas, giro de bola) = puramente cosmético.
- Alvo: média de LL próxima de 75–80% com timing médio.

## 9. Rede e latência (o maior problema do 2K online)

- O cliente que arremessa grava `t_input` **no relógio local da animação** (frames desde o início do montage) e calcula `Δt` localmente.
- Envia ao servidor: `{shot_id, anim_start_frame, Δt, input_mode, aim}`.
- O servidor **valida plausibilidade** (o arremesso começou mesmo naquele frame? o Δt é coerente com o histórico de input? padrão de bot/macro?) e calcula `contest` e o resultado com **seu** estado + compensação de lag (rewind das posições dos defensores até o timestamp do cliente, limitado a ~150 ms).
- Resultado: o jogador nunca perde um "Perfeito" por causa de ping. Anti-cheat: perfis estatísticos de Δt (humanos têm distribuição; macros são perfeitos demais).

## 10. Trajetória e física da bola

A decisão **cesta/erro** é tomada na soltura; a física **realiza** essa decisão de forma crível.

1. Decide resultado + **tipo de erro** coerente com o feedback:
   - Cedo → tende a sair **curto** (aro da frente).
   - Tarde → tende a sair **longo** (aro de trás/tabela).
   - Mira lateral (shot stick) → esquerda/direita.
   - Contestação pesada → trajetória mais achatada (o arremessador "puxou" a bola).
   - Erro "Muito" + contestação alta → **airball** possível.
2. Escolhe um ponto-alvo (dentro do aro para cesta, no aro/tabela com offset para erro).
3. Resolve a velocidade inicial com o **ângulo de soltura** do perfil (45–55°; ótimo ≈ 52° no lance livre) para atingir o ponto-alvo. Cestas miram **~5–7 cm atrás do centro do aro**, com ângulo de entrada de ~45° (referências: simulações da NC State e dados da Noah Basketball — "45° de entrada, 11 polegadas de profundidade").
4. Simula com o **solver determinístico de bola** (tick fixo 120 Hz) contra aro (toro analítico), tabela (caixa com teste *swept*, para a bola não atravessar a tabela em alta velocidade), suporte e chão. Erros geram rebotes naturais. Limiares de repouso impedem a bola de "tremer" sobre o aro.
5. Correção sutil: se a simulação real divergir do resultado decidido (ex.: um "erro" que entraria), aplica-se um ajuste mínimo de spin/velocidade no primeiro contato — imperceptível.

Constantes físicas (ponto de partida para tuning):

| Item | Valor |
|---|---|
| Raio da bola (tamanho 7) | 0,119 m |
| Massa | 0,62 kg |
| Altura do aro | 3,05 m |
| Diâmetro interno do aro | 0,457 m |
| Distância aro → tabela | 0,15 m |
| Tabela | 1,83 × 1,07 m |
| Restituição bola–piso | ≈ 0,76 (madeira; regra FIBA: solta de 1,80 m, volta 1,035–1,085 m) · 0,68–0,74 (asfalto/street) |
| Restituição bola–aro | 0,50–0,65 (tuning define "aro macio" vs "aro duro") |
| Backspin típico | ~3 rotações/s (backspin "amortece" o aro e a tabela → mais cestas no rolinho) |

Rede: cloth (Chaos Cloth) puramente cosmética, com estados especiais para "swish" e "rattle in".

## 11. Telemetria e tuning

- Todo arremesso é logado: `{tipo, distância, rating, Δt, faixa, contest, fadiga, L, P, resultado}`.
- **Teste automatizado**: simula 10.000 arremessos por (rating × tipo × contest) e compara com a tabela-alvo; CI falha se sair de ±2 p.p.
- Painel de debug in-game (`F3`): mostra linha de contestação, janelas, L/P em tempo real.

## 12. Checklist de "arremesso gostoso"

- [ ] Do input até a reação visível ≤ 100 ms.
- [ ] Som de swish distinto para Perfeito.
- [ ] Câmera dá micro-zoom/slow-mo opcional em game-winner.
- [ ] Feedback pós-arremesso legível em < 1 s.
- [ ] Nenhum arremesso perfeito e livre erra. Nunca.
- [ ] Defensor bem posicionado se sente recompensado (som de "contest", indicador).
