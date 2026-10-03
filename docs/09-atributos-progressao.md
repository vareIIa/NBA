# 09 — Atributos, Estilos (Traits) e Progressão

> Postura contra o 2K: **nada de pay-to-win.** Atributos só sobem jogando. Dinheiro real (se houver) compra apenas cosméticos.

## 1. Corpo (físico) — define o que é possível

| Medida | Faixa | Efeito em jogo |
|---|---|---|
| Altura | 1,75–2,24 m | Alcance, release point, velocidade máxima, quais animações/bases são possíveis |
| Peso | 70–130 kg | Massa no contato, aceleração, energia |
| Envergadura | −10 a +20 cm da altura | Contestação, roubo, toco, rebote (tamanho efetivo das mãos/braços) |

O corpo usa o **mesmo mocap** com retarget por proporção; as diferenças de gameplay são **físicas** (alcance real), não só números.

## 2. Atributos (24)

| Grupo | Atributos |
|---|---|
| **Finalização** | Close Shot, Driving Layup, Driving Dunk, Standing Dunk, Post Control |
| **Arremesso** | Mid-Range, Three-Point, Free Throw, Shot IQ (escolha/equilíbrio) |
| **Criação** | Ball Handle, Speed With Ball, Pass Accuracy, Pass Vision |
| **Defesa** | Perimeter D, Interior D, Steal, Block, Pass Perception, Help IQ |
| **Rebote** | Offensive Rebound, Defensive Rebound (inclui box-out) |
| **Físico** | Speed, Acceleration, Strength, Vertical, Lateral Quickness, Stamina |

- Escala 25–99. Limites máximos (caps) dependem do corpo (ex.: 2,15 m tem teto de Speed menor).
- Cada atributo tem **uma descrição concreta do que faz** na tela de criação ("Ball Handle: aumenta a janela de combo de 120→180 ms e o número de dribles encadeados de 3→6").

## 3. Estilos (substituem badges)

O 2K tem dezenas de badges com níveis e fica difícil entender o que ativa o quê. Nós:

- **~24 Estilos**, cada um com **efeito único, visível e explicado**.
- 3 níveis (I, II, III). Efeitos **pequenos** (somatório máximo ±0.4 em log-odds de arremesso, ver `03-arremessos.md`).
- **Desbloqueados por comportamento**, não comprados: "Especialista de Canto" desbloqueia acertando 3 do canto; "Muralha" desbloqueia com cutoffs bem-sucedidos.
- Limite de **slots equipados** (ex.: 6) → escolhas de identidade, não acúmulo.

Exemplos:

| Estilo | Efeito (nível III) | Como desbloquear |
|---|---|---|
| Especialista de Canto | Janela Perfeito +12% em 3 do canto | 50 cestas de 3 do canto |
| Gatilho Rápido | Release speed +8% sem perder janela em catch & shoot | 100 catch & shoot |
| Quebra-Tornozelo | +15% chance de desequilíbrio após combo na janela | 25 desequilíbrios causados |
| Pôster | +10% chance de enterrada com contato | 15 pôsteres |
| Ladrão | Janela HandActive +20 ms em roubos | 40 roubos limpos |
| Muralha | Vantagem de contato +0.15 em cutoffs com pés plantados | 60 cutoffs |
| Rato de Garrafão | Box-out mais forte, rebote ofensivo | 80 rebotes em disputa |
| Maestro | Passes mais precisos sob pressão | 150 assistências |
| Clutch | Sem penalidade de pressão nos últimos 2 min | Arremessos decisivos convertidos |
| Ritmo de Rua (streetball) | Combos de assinatura mais rápidos | Partidas de streetball |

## 4. Progressão no modo Carreira

- **XP de atributo por uso**: arremessar de 3 e acertar sobe Three-Point; defender bem sobe Perimeter D; treinar no ginásio sobe Físico. (Inspirado em RPG "aprende fazendo".)
- **Treino** (mini-jogos rápidos e opcionais, 1–3 min) para acelerar — e que também **ensinam** a mecânica.
- **Nota de partida** (A+ a F) baseada em impacto real: pontos/posse, defesa (cutoffs, contestações, ajudas corretas), passe para o livre, rebote. Não penaliza arremessar quando livre; penaliza forçar.
- **Sem moeda comprável para atributos.** Se existir moeda, ela é ganha jogando e serve para cosméticos/estética da casa/quadra.
- Ritmo alvo: jogador "médio" atinge overall ~85 em ~40–60 horas, sem grind obrigatório; overall 95+ é longo, opcional e só jogando.

## 5. Builds e balanceamento

- Sem arquétipos travados: o jogador distribui pontos com **caps por corpo** e custo crescente perto do teto.
- Telemetria de builds online: se uma build dominar (> X% de winrate em ranqueado), ajuste em patch **transparente** com notas detalhadas.
- Ranqueado tem opção de **builds niveladas** (todos com o mesmo orçamento) para competitivo puro.

## 6. Monetização (proposta)

| Permitido | Proibido |
|---|---|
| Jogo pago (preço único) ou Early Access | Comprar atributos, XP, Estilos |
| Cosméticos (roupas, tênis, quadras, comemorações) | Loot boxes / pacotes aleatórios pagos |
| Expansões de conteúdo (novas cidades/quadras) | Vantagem competitiva paga |
