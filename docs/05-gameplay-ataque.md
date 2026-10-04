# 05 — Gameplay de Ataque

## 1. Movimento base (com e sem bola)

- **Movement component próprio** (derivado do `CharacterMovementComponent`), pensado para basquete:
  - Aceleração e desaceleração por atributo (Speed, Acceleration, Speed With Ball).
  - **Momento**: quanto mais rápido, maior o raio de curva e mais tempo para frear → cortes bruscos em sprint custam um "plant" (pé de apoio, ~120 ms).
  - **Plant-and-cut**: mudar de direção > 90° força um passo de plantar — é aí que o defensor ganha ou perde.
  - Velocidade com bola = 85–95% da sem bola (depende de Speed With Ball).
- **Energia** (stamina): **uma barra só** (decisão D13, sem Explosões). Sprint, dribles e saltos gastam; parado recupera. Afeta velocidade, dribles e arremesso (ver §2.5). No 5x5, o cansaço acumulado ao longo do jogo é um tema para depois (banco/substituições).

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
- **Size-ups gastam pouca energia**: o jogador pode "sondar" o defensor, mas não infinitamente.
- **Sair de qualquer drible para o arremesso**: todo drible tem janela de cancelamento para **pull-up**, **step-back jumper**, **spin jumper** e **hop jumper**. É o padrão "drible lateral → pull-up de 3" dos clipes do diretor (`referencias/2k23/README.md`, padrão 1).
- **Spin → hesitação → pull-up** precisa fluir sem travar: é a sequência-assinatura do estilo do diretor.
- **Cancelar antes do 1º quique** (misdirection), **arranque na saída** do movimento e **pull-up sem frear**: números em §2.7.
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

### 2.4 Sem Explosões (decisão D13)

O 2K23 introduziu os *Adrenaline Boosts* (3 arranques por posse). Para o diretor, **foi aí que o 2K começou a piorar**: o drible fica racionado por um contador escondido. Aqui **não existe Explosão**. O único limitador é a **energia**.

### 2.5 Energia (stamina): o único limitador

| Ação | Efeito na barra |
|---|---|
| Sprint (RT) | −8%/s (~12 s esvaziam a barra) |
| Drible simples (crossover, entre as pernas) | −2,5% cada |
| Dribles fortes (spin, step-back, escapes com RT) | −4% a −5% cada |
| Combo no ritmo | 20% mais barato |
| Arranque na saída do movimento (§2.7) | −1,2% por m/s de arranque (crossover −1,7%, escape −2,2%) |
| Parado / sem driblar | +10%/s |
| Andando/correndo sem sprint | +5%/s |

Abaixo de **40%** a energia pesa: velocidade máxima cai até −18%, dribles ficam até 15% mais lentos e o arremesso perde precisão (fadiga, `03-arremessos.md §3.4`). A barra aparece **embaixo dos pés** do jogador (como no 2K) e no canto da tela, verde → amarela → vermelha.

- No Freestyle há a opção **Energia infinita** (`bInfiniteEnergy`) para treinar combos, desligada por padrão.
- Estilos (badges) relacionados: *Handles for Days* (menos energia por drible), *Amped* (menos penalidade por fadiga e por **se mover muito antes do arremesso**, essencial para o estilo do diretor), *Hyperdrive* (dribles em movimento mais rápidos), *Killer Combos* (encadear size-ups), *Unpluckable*.

### 2.6 Desequilíbrio e ankle-breaker (o momento mais divertido do 1x1)

O defensor tem um vetor de **compromisso** (peso do corpo), ver `06-gameplay-defesa.md`. Quando o atacante executa um movimento na direção **oposta** ao compromisso do defensor:

```
chance_desequilibrio = σ( (BallHandle − LateralQuickness_def)·0.04
                         + compromisso_def·2.0
                         + bônus_janela_combo·0.5
                         − distância_ao_defensor·0.8 )
```

Resultados por intensidade: **tropeço leve** (perde 1 passo) → **desequilíbrio** (perde 2–3 passos) → **ankle-breaker** (queda; raro, exige ≥ 2 movimentos encadeados + compromisso alto). O ankle-breaker dispara replay automático opcional.

### 2.7 Misdirection, arranque de saída e pull-up sem frear (números do protótipo)

Itens **P0-8** e **P0-9** de `17-park-green-e-feel.md §6.1`, no núcleo (`HoopsDribbleMoves`, `ComputeGatherCarry` em `HoopsShotModel`) e ligados no `AHoopsPlayerCharacter`. Tudo tunável em `DribbleEnergyConfig` / `GatherCarryTuning`.

**Misdirection: cancelar antes do 1º quique**
- Janela = o **commit** do movimento, que acaba no 1º quique (`CommitSeconds × MisdirectionWindowScale`, padrão 1,0, dividido pelo playrate): de 0,08 s (hesitação) a 0,25 s (spin); crossover 0,12 s.
- Na janela, o gesto é lido a partir da mão do **início** do movimento (a bola ainda não trocou de mão). Se o novo movimento leva a bola para o **lado oposto** (termina na outra mão: crossover → hesitação, escape, in-and-out, step-back...), ele **substitui** o atual na hora: a mão volta e o novo começa do zero, sem esperar o fim.
- Combo do Pro Stick (double throw, switchback) na janela substitui o movimento que o toque acabou de começar: dois toques para cima = double cross, e não crossover + crossover.
- Para o **mesmo lado**, nada muda: buffer de 150 ms e sai no fim do commit. **Uma** misdirection por movimento (a troca não pode ser trocada de novo).
- A troca herda o **ritmo** do movimento trocado (combo no ritmo continua +15% e não conta duas vezes) e **paga a energia dos dois** (o fingido e o real).
- RT não é obrigatório; `bMisdirectionNeedsSprint` liga a variante do 2K26 (só com RT).

**Arranque de saída (speedboost / cross launch)**

| Movimento | Arranque (m/s extras) |
|---|---|
| Crossover de ataque, escape de hesitação | 1,8 |
| Hesi-cross | 1,7 |
| Double cross | 1,5 |
| Crossover, in-and-out | 1,4 |
| Por trás, spin | 1,3 |
| Hesitação | 1,2 |
| Entre as pernas | 1,1 |
| Half-spin | 1,0 |
| Escape de step-back | 0,9 |
| Step-back, retreat | 0,6 |

- Dispara quando o movimento **termina sem encadear** e o LS aponta (≥ 50%) até **0,20 s** depois do fim; direção = LS, um por movimento. Encadear outro drible passa a saída para o último da sequência.
- Perfil: velocidade extra **cheia por 0,15 s**, depois cai a zero em **0,30 s** (≈ 2 passos). Ganho ≈ 0,3 × arranque: 0,42 m no crossover, 0,54 m no escape de hesitação.
- **Cross launch** (movimento com troca de mão, LS para o lado da nova mão ou em frente) e **speedboost** (sem troca, LS para o lado da bola ou em frente) valem 100% (`CrossLaunchScale`/`SpeedboostScale` = 1,0, ganchos para o pacote de estilo de drible, §2.3). **Contra o movimento** (LS para trás ou para o lado da mão livre): 50%.
- Custo: **1,2% da barra por m/s**. Abaixo de **40%** de energia o arranque cai em linha reta até **40%** do valor com a barra vazia. **Sem contador** (D13): arranques seguidos só enfraquecem porque a energia cai; encher a barra devolve o arranque cheio.
- Na Unreal: a velocidade vira para a direção do LS (mantém o que já ia nesse sentido + o arranque) e o `MaxWalkSpeed` sobe junto enquanto o arranque dura (também solta o limite do size-up).

**Pull-up sem frear**
- Antes: o gather cortava a velocidade para 35% (pull-up) e o atrito do chão parava o corpo em ~0,1 s.
- Agora: o pull-up (saindo do drible ou em movimento) mantém **85%** da velocidade no gather e desacelera em linha reta no **plant** (até 0,30 s, nunca mais que **0,6 m**) até a **deriva do salto**: 12% da entrada, no máximo 0,75 m/s (pouso 10–30 cm à frente). Correndo com bola (4,4 m/s): 3,7 → 0,53 m/s em 0,28 s; em sprint (6,7 m/s) o plant encurta para 0,19 s.
- Step-back mantém 85% (o embalo para trás do próprio movimento) e fadeaway 35%; nenhum dos dois deriva para frente, e a deriva para trás depois do commit (1,6 m/s) continua. Spot-up: 10%.
- O último quique vira o gather: gather → soltura ideal 0,56 s (velocidade normal), o ≈ 0,6 s do clipe do diretor. A janela continua travada no gather.

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
