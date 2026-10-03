# 06 — Gameplay de Defesa

> Problema clássico dos jogos de basquete: defender é chato e impotente.
> Meta: **defender bem é uma habilidade tão expressiva quanto atacar**, com recompensas visíveis (sons, indicadores, replays de toco).

## 1. Postura e movimento

- **Correndo** (sem LT): velocidade normal, pior reação lateral.
- **Postura** (LT): deslize lateral, centro de massa baixo, reação melhor, gasta energia curta. Velocidade de deslize = Lateral Quickness.
- **Cruzar os pés** (deslize → sprint): quando o atacante ganha o ombro, o defensor precisa virar e correr — transição custa ~150 ms (menos com Lateral Quickness alto).

## 2. Vetor de compromisso (o "peso do corpo")

Cada defensor tem um vetor `compromisso` (direção + intensidade 0..1):
- Cresce quando o defensor **se move** ou **antecipa** numa direção (LS forte para um lado).
- Cresce com fintas do atacante (hesitação, jab, pump fake) que o defensor "morde" (ou seja: o jogador/IA reagiu ao movimento).
- Decai rápido quando o defensor fica parado em postura equilibrada.
- **Visível** de forma sutil: inclinação do corpo do defensor. Atacantes atentos leem isso.

O compromisso é o que gera desequilíbrio/ankle-breaker (`05-gameplay-ataque.md §2.3`). Defensor equilibrado e bem posicionado **não cai** com spam de drible.

## 3. Cortar o caminho (cutoff) e contato

- Se o defensor está **na frente** da linha de drive (ângulo < ~35°) e com pés plantados → contato de corpo com vantagem para a defesa: o atacante é desviado/desacelerado.
- Se o defensor chega **atrasado** (ângulo grande, em movimento lateral) → falta de bloqueio possível ou atacante passa.
- Detalhes em `07-fisica-colisao.md`.

## 4. Roubo de bola (baseado em exposição)

A bola tem um valor de **exposição** ao longo do drible:

| Fase do drible | Exposição |
|---|---|
| Bola na mão, protegida pelo corpo | 0.0–0.1 |
| Bola na mão, lado do defensor | 0.3–0.5 |
| Bola no ar a caminho do chão (lado do defensor) | 0.6–0.9 |
| Crossover em frente ao defensor | 0.8–1.0 |
| Gather / pump fake baixo | 0.5–0.7 |

```
chance_roubo = exposição × alcance_mão(Steal, envergadura) × timing(janela HandActive)
chance_falta = f(contato com corpo/braço do atacante, ângulo por trás, Steal baixo)
```

- Apertar no momento de exposição alta = **roubo limpo** satisfatório.
- Apertar com bola protegida = sem chance e risco de **falta**.
- Spam de roubo: cada tentativa tem recovery (≈ 300 ms) → o atacante passa.
- **Interceptação de passe**: ver `05-gameplay-ataque.md §4.2`.

## 5. Contestação e toco

### 5.1 Contestação
- Automática ao estar perto e virado para o arremessador; **manual** com RS (mão alta) ou Y (salto).
- Valor final calculado na soltura (`03-arremessos.md §3.3`).
- Sons/indicador de "boa contestação" mesmo quando a bola entra — o jogador sabe que fez o certo.

### 5.2 Toco (física real de mão × bola)
- O toco acontece quando o **volume da mão** do defensor (dentro da janela `HandActive` da animação) intercepta a **trajetória real** da bola antes do ápice/goaltending.
- Block rating aumenta o volume efetivo da mão (até +30%) e a **qualidade** (toco para fora vs. toco controlado que vira posse).
- Tipos: frontal, lateral, chase-down (por trás em transição), weak-side (ajuda), segurar a bola.
- **Goaltending** aplicado pelas regras (bola descendo / acima do aro). Interferência no aro também.
- Falta no toco: contato do corpo/braço com o arremessador antes do contato com a bola.

## 6. Rebote

1. Na hora do arremesso, o servidor já sabe a **trajetória do rebote** (solver determinístico) — a IA usa a previsão com ruído proporcional ao atributo de rebote/IQ.
2. **Box-out** (LT perto do adversário): disputa contínua de posição (Força + Box Out vs. Força + Rebote Ofensivo). Quem tiver o quadril entre o adversário e a bola tem vantagem.
3. **Salto**: timing do Y vs. chegada da bola. Melhor timing + mais alcance (altura+envergadura+Vertical) ganha. Disputas próximas → bola tocada/solta (tip).
4. Rebote ofensivo pode virar **putback** (bandeja/enterrada/tapinha) por contexto.

## 7. Defesa coletiva

- **Esquemas** (3x3 e 5x5): marcação individual, troca em tudo, drop coverage no pick & roll, hedge, blitz/dobra, ice (forçar para a lateral).
- **Ajuda e rotação**: IA (ou o jogador, no modo Carreira) decide ajudar no drive e recuperar no arremessador. No modo Carreira, a nota de defesa considera ajuda correta e recuperação, não só "não sair do homem".
- **Navegar corta-luz**: por cima (seguir), por baixo (gap), troca (switch). Bater no screener = animação de contato + atraso.

## 8. Feedback para o defensor

- Indicador de contestação no HUD pós-arremesso (o mesmo do atacante).
- Som de "trava" quando o cutoff dá certo.
- Replays automáticos de tocos e roubos importantes.
- Estatística "pontos permitidos como defensor principal" visível no pós-jogo.
