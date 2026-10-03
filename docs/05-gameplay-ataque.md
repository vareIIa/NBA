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

## 2. Sistema de drible (Pro Stick), modelo 2K23

> Referência: o drible do **NBA 2K23** (favorito do diretor) e os clipes em `referencias/2k23/`. O estilo-alvo é jogar **correndo para todo lado**: giros, retreat dribbles, drible lateral em velocidade e pull-ups saindo de qualquer movimento.
> Mapa de inputs completo em `02-controles.md §2`.

### 2.1 Gestos do RS (iguais aos do 2K23)

| Gesto | Movimento | Versão em movimento / sprint |
|---|---|---|
| Toque cima | Crossover | Crossover em velocidade; com RT: **crossover de ataque** |
| Toque esquerda (mão livre) | Entre as pernas | Entre as pernas em corrida |
| Toque baixo-esquerda | Por trás das costas | Por trás em corrida (*momentum behind-the-back*) |
| Toque direita (mão da bola) | Hesitação | Com RT: **escape de hesitação** |
| Cima-direita rápido | In-and-out | — |
| Toque baixo | Step-back | Step-back em movimento ("Asta slide"); com RT: escape step-back |
| Giro completo pela mão da bola | **Spin** | **Spin em movimento**, que "devolve" para a linha de 3 |
| Quarto de círculo | **Half-spin** | Half-spin em corrida |
| Balançar com ritmo | **Size-ups de assinatura** encadeados | — |
| Mesma direção 2× (*double throw*) | Combo de assinatura | — |
| Direção + oposta (*switchback*) | Hesi-cross / double-cross | — |
| RT + RS cima-direita + LS cima-direita, espelhado | **Momentum dribble** (encadeável enquanto segura RT) | — |
| LT segurado | Proteger a bola | — |

Orientação **absoluta** por padrão (direções relativas ao corpo do jogador), com opção relativa à câmera.

### 2.2 Ritmo, combos e cancelamentos

- **Ritmo é a habilidade.** Cada drible abre uma **janela de combo** no fim da animação (≈ 120–180 ms, cresce com Ball Handle). Input dentro da janela → transição suave e mais rápida (playrate +10–20%); fora → transição normal. Isso reproduz o "aprender a velocidade dos flicks e o timing das animações de assinatura" do 2K23.
- **Size-ups não gastam Explosão**, só energia: o jogador pode "sondar" o defensor à vontade, como no 2K23.
- **Sair de qualquer drible para o arremesso**: todo drible tem janela de cancelamento para **pull-up**, **step-back jumper**, **spin jumper** e **hop jumper**. É o padrão "drible lateral → pull-up de 3" dos clipes do diretor (`referencias/2k23/README.md`, padrão 1).
- **Spin → hesitação → pull-up** precisa fluir sem travar: é a sequência-assinatura do estilo do diretor.
- **Spam** sem ritmo: energia cai rápido e a bola fica mais exposta (roubo mais fácil).
- Quantidade de movimentos encadeados por ciclo depende de Ball Handle (3 a 6).

### 2.3 Pacotes (estilo do jogador)

Como no 2K23, a "personalidade" vem de **pacotes** escolhidos por jogador:

| Pacote | Define | Requisito |
|---|---|---|
| **Estilo de drible** | Postura, ritmo e, principalmente, o **arranque** depois de um movimento (primeiro passo / explosão) | Speed With Ball |
| Size-up de assinatura | Sequências de size-up e combos | Ball Handle (até 92) + altura máx. |
| Escape | Movimentos com RT | Ball Handle |
| Crossover em movimento | Variações de crossover/hesi-cross (o 2K23 tinha 28) | Ball Handle + altura |
| Spin / half-spin / step-back / hesitação | Animação de cada movimento | Ball Handle |

Pacotes de jogador baixo exigem altura ≤ 1,93 m (no 2K23: ≤ 6'4").

### 2.4 Explosões (equivalente aos Adrenaline Boosts do 2K23)

- **3 Explosões por posse**, mostradas embaixo da barra de energia.
- Gasta 1 a cada **arranque forte**: primeiro passo explosivo, toque no RT em infiltração, escape.
- Com as 3 gastas, velocidade e aceleração caem bastante até o fim da posse.
- Recarregam quando o relógio de posse zera ou a posse troca. Sem bola, 1 Explosão volta depois de alguns segundos se a energia estiver ≥ 50%.
- **Na defesa**, tentativas de roubo e de toco também gastam (lado defensivo do sistema).
- **No Freestyle**, as Explosões podem ser **infinitas** (opção) para treinar combos.

Por que adotar: no 2K23 isso acabou com o abuso de "speed boost" sem matar o drible fluido. O jogador escolhe **quando** explodir.

### 2.5 Energia

- Energia cai mais rápido com movimentos em sequência ("não brinque com a comida").
- Energia baixa reduz ratings e velocidade do arremesso; ficar sem Explosões pesa mais que energia baixa.
- Estilos (badges) relacionados: *Handles for Days* (menos energia por drible), *Amped* (menos penalidade por fadiga e por **se mover muito antes do arremesso**, essencial para o estilo do diretor), *Quick First Step* (arranques melhores), *Hyperdrive* (dribles em movimento mais rápidos), *Killer Combos* (encadear size-ups), *Unpluckable*.

### 2.6 Desequilíbrio e ankle-breaker (o momento mais divertido do 1x1)

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
