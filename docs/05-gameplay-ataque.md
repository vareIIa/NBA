# 05 — Gameplay de Ataque

## 1. Movimento base (com e sem bola)

- **Movement component próprio** (derivado do `CharacterMovementComponent`), pensado para basquete:
  - Aceleração e desaceleração por atributo (Speed, Acceleration, Speed With Ball).
  - **Momento**: quanto mais rápido, maior o raio de curva e mais tempo para frear → cortes bruscos em sprint custam um "plant" (pé de apoio, ~120 ms).
  - **Plant-and-cut**: mudar de direção > 90° força um passo de plantar — é aí que o defensor ganha ou perde.
  - Velocidade com bola = 85–95% da sem bola (depende de Speed With Ball).
- **Energia** (stamina) com 2 barras:
  - **Curta** (explosão): sprint, dribles em sequência, saltos. Recupera em segundos.
  - **Longa** (jogo): cansaço acumulado; afeta arremesso, velocidade e reação. Recupera em pausas/banco.

## 2. Sistema de drible (Pro Stick)

### 2.1 Mapa de movimentos (RS, relativo à câmera ou ao jogador — opção)

| Gesto no RS | Parado | Em movimento |
|---|---|---|
| Flick para o lado oposto da mão da bola | Crossover | Crossover em velocidade |
| Flick para trás (para longe da cesta) | Step-back | Step-back / retreat dribble |
| Flick para o lado da bola | Hesitação / in-and-out | Hesitação em velocidade |
| Segurar para trás + lado | Entre as pernas (recuando) | Entre as pernas |
| Meia-lua (lado → trás → lado oposto) | Por trás das costas | Por trás das costas |
| Meia-lua para frente | Spin | Spin em direção à cesta |
| Flick para frente | Jab / "rocker" | Explosão (burst) |
| Segurar LT + RS | Proteção da bola | — |
| Flick duplo rápido | Combo de assinatura (size-up) | — |

### 2.2 Combos com ritmo

- Cada drible abre uma **janela de combo** (≈ 120–180 ms, cresce com Ball Handle) no fim da animação.
- Input **dentro** da janela → transição suave e mais rápida (playrate +10–20%).
- Input **fora** da janela → transição normal (mais lenta, sem bônus).
- **Spam** sem janela: energia curta cai rápido e o drible fica mais alto/exposto → mais fácil de roubar.
- Quantidade máxima de movimentos encadeados por "ciclo" depende de Ball Handle (3 a 6).

### 2.3 Desequilíbrio e ankle-breaker (o momento mais divertido do 1x1)

O defensor tem um vetor de **compromisso** (peso do corpo), ver `06-gameplay-defesa.md`. Quando o atacante executa um movimento na direção **oposta** ao compromisso do defensor:

```
chance_desequilibrio = σ( (BallHandle − LateralQuickness_def)·0.04
                         + compromisso_def·2.0
                         + bônus_janela_combo·0.5
                         − distância_ao_defensor·0.8 )
```

Resultados por intensidade: **tropeço leve** (perde 1 passo) → **desequilíbrio** (perde 2–3 passos) → **ankle-breaker** (queda; raro, exige ≥ 2 movimentos encadeados + compromisso alto). O ankle-breaker dispara replay automático opcional.

## 3. Drive e finalização

- Drive = LS para a cesta + RT. O **ângulo** do atacante vs. o defensor decide se ele "passa o ombro" (ganha a frente) ou se há **contato de corpo** (ver `07-fisica-colisao.md`).
- **Ganhar o ombro**: atacante com quadril à frente do quadril do defensor → defensor não pode mais cortar sem falta; só pode perseguir (chase-down).
- Finalizações em `03-arremessos.md §7`.

## 4. Passe

### 4.1 Tipos

| Tipo | Velocidade | Risco de interceptação | Melhor uso |
|---|---|---|---|
| Direto (peito) | alta | médio | padrão |
| Quicado | média | baixo contra mãos altas, alto contra mãos baixas | entrada no post, pick & roll |
| Lob / por cima | baixa | baixo contra baixos, alto contra altos | sobre a defesa, alley-oop |
| Flashy (no-look, costas) | alta | alto | arcade/streetball, bônus de "hype" |
| Hand-off | — | baixo | dribble hand-off (DHO) |

### 4.2 Física do passe (sem "passe magnético")

- O passe é uma **bola real** no solver físico, mirada para o **ponto previsto** do receptor (lead pass).
- Precisão = f(Pass Accuracy, pressão no passador, ângulo em relação ao corpo, tipo do passe). Erro de precisão → bola chega alta/baixa/atrás → catch pior ou bola perdida.
- **Interceptação** só acontece se a mão de um defensor (dentro da janela `HandActive`) cruza a trajetória. Rating de Pass Perception aumenta o tamanho efetivo da mão (até +25%) e a reação. Nada de defensor teleportando para a linha do passe.
- **Passe por ícone** e **passe direcional** coexistem.

## 5. Post game

- LT segura o post-up; o atacante "senta" no defensor (contato contínuo).
- **Back-down**: cada empurrão é uma disputa de Força + Post Control vs. Força + Interior Defense; vence quem tem melhor alavanca (posição dos pés).
- Movimentos: drop step, giro, up-and-under, hook, fadeaway, face-up (vira para frente e ataca como perímetro).
- Defesa pode fazer **fronting** (ficar na frente para negar o passe) — abre lob por cima.

## 6. Jogo sem bola e jogadas

### 6.1 Corta-luz (screen)

- O screener é um **obstáculo físico**: o defensor que bate nele perde velocidade/recebe animação de contato.
- Qualidade do corta-luz = Força + ângulo + estar **parado** (corta-luz em movimento = falta de ataque).
- Variações: pick & roll, pick & pop, slip (fingir e cortar), flare, pin-down, back-screen, ghost screen.

### 6.2 Cortes e espaçamento

- **Vagas de espaçamento** (slots): cantos, alas, topo, dunker spot, short corner, elbow, slot.
- Companheiros de IA se movem entre slots para **manter espaçamento** e respondem ao drive (drift para o canto, corte para a cesta quando o defensor olha a bola).
- No modo Carreira, o jogador **controla o próprio corte**; o jogo recompensa (nota de companheiro, ver `10-modos.md`).

### 6.3 Jogadas

- **3x3 / Streetball**: chamadas rápidas pelo D-pad (pick & roll, isolação, hand-off, post, "motion" livre).
- **5x5 (P3)**: playbook por time (Horns, Spain PnR, Floppy, Hammer, etc.).

## 7. Regras de jogo que afetam o ataque

- Relógio de posse: 12 s (3x3 FIBA) · 24 s (5x5) · opção sem relógio no streetball casual.
- Infrações: andada (travel) **só** quando o input do jogador causa — nunca por animação automática; 3 segundos (5x5); volta de quadra (5x5); "clear" obrigatório no 3x3 após rebote defensivo.
- Na dúvida, o jogo **não** marca andada: errar a favor da diversão.
