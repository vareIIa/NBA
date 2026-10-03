# 04 — Plano de Animações

> Regra de ouro: **a jogabilidade decide, a animação obedece.**
> O 2K é bonito porque tem dezenas de milhares de animações; é frustrante porque o jogador fica "preso" nelas.
> Nós queremos 80% da beleza com 20% do conteúdo — e **zero** sensação de perder o controle.

## 1. Arquitetura de animação (Unreal Engine 5)

O Animation Blueprint é organizado em **camadas**, de baixo para cima:

| Camada | Tecnologia UE5 | Responsável por |
|---|---|---|
| 0. Locomoção | **Motion Matching** (Pose Search + Chooser) | Andar, correr, parar, cortar, girar, deslizar na defesa — com e sem bola |
| 1. Ações | **Montages** + **Motion Warping** | Arremessos, dribles especiais, passes, bandejas, enterradas, tocos, roubos |
| 2. Overlays de tronco | Layered Blend per Bone (spine_01 ↑) | Mão da bola, pedir bola, mãos na defesa, contestação de braço |
| 3. Procedural | Control Rig / IK (Two-Bone IK, Full Body IK), Look-At, Foot Placement | Mão grudada na bola, pés travados no chão, cabeça seguindo a bola, inclinação por aceleração |
| 4. Física | Physical Animation Component + ragdoll parcial | Reações de contato, quedas, empurrões |
| 5. Facial | MetaHuman Face (Live Link Face / curvas) | Esforço, respiração, comemorações, piscadas |

### 1.0 Ponto de partida: Game Animation Sample Project (UE 5.8)

O **GASP** (Game Animation Sample Project), atualizado para a UE 5.8 em agosto de 2026, já traz quase tudo de que a camada 0 precisa:
- Motion Matching de produção (Pose Search) + Choosers com coluna de Pose Match (vários bancos ao mesmo tempo).
- **Pose Search Interaction Assets**: Motion Matching com **vários personagens** e warping. Encaixa direto em contato pareado (body-up, post-up, corta-luz).
- Ragdoll guiado pelo **Physics Control Component** (ragdoll "com força") e levantar do chão por Motion Matching.
- Orientation warping, leg IK, Offset Root Bone (experimental), steering.

Estratégia: **começar do GASP**, trocar o personagem e os bancos por animações de basquete e adicionar nossas camadas 1–4.

> Evitar por enquanto: o **Unreal Animation Framework (UAF, ex-AnimNext)** ainda está em desenvolvimento, e o **Mover** é experimental. Ficamos com Animation Blueprint + movement component próprio.

### 1.1 Por que Motion Matching na locomoção

- Locomoção de basquete é **contínua e caótica** (cortes, desacelerações, pivôs). Uma state machine tradicional vira um monstro de transições.
- Motion Matching escolhe, a cada poucos frames, o trecho do banco de mocap que melhor combina com **a pose atual + a trajetória desejada** (que vem do input).
- Gravamos **"dance cards"** (sessões longas de movimento livre cobrindo todas as direções e velocidades) em vez de centenas de clipes curtos.
- Bancos separados (Pose Search Databases) por **postura**:
  - `DB_OffBall` — sem bola (ataque)
  - `DB_Dribble_R` / `DB_Dribble_L` — com bola, mão direita/esquerda (espelháveis)
  - `DB_TripleThreat` — bola presa, ameaça tripla, pivôs
  - `DB_DefStance` — postura defensiva, deslizamentos, closeouts
  - `DB_Post` — costas para a cesta (ataque e defesa)
- Um **Chooser Table** decide qual banco usar a partir do estado de gameplay.

### 1.2 Ações com Motion Warping

Ações de alto impacto (arremesso, enterrada, toco, roubo, catch de passe) são **montages** curados, porque precisam acertar alvos:
- `Warp Target: Rim` → enterradas e bandejas alinham posição/rotação ao aro.
- `Warp Target: Ball` → catch de passe, rebote, toco.
- `Warp Target: Opponent` → contestação, toco, contato de corpo.
- Limite de warp: no máximo ~0,6 m de translação e ~45° de rotação; acima disso, escolhe outra animação (evita "deslizar no gelo").

## 2. Responsividade: fases, janelas de cancelamento e buffer

Toda ação é dividida em fases marcadas por `AnimNotifyState`:

```
|-- Startup --|-- Commit --|-- Active --|-- Recovery --|
   cancelável    travado      resultado    cancelável em
   em quase       (curto)                  ações da lista
   tudo
```

- **Startup**: pode cancelar em qualquer outra ação (ex.: começar um crossover e virar hesitação).
- **Commit**: curto e **com teto rígido** — nenhuma ação comum trava o jogador por mais de **250 ms** (exceções: enterradas com contato, quedas).
- **Recovery**: cancela em uma lista de ações permitidas (ex.: recovery do step-back → arremesso, pump fake, passe).
- **Input buffer** de 150 ms: um comando dado durante o commit é executado no primeiro frame cancelável.

### 2.1 Metas de tempo (60 fps)

| Ação | Duração total | Commit máx. | Cancela em |
|---|---|---|---|
| Crossover | 350–450 ms | 120 ms | outro drible, arremesso, passe, drive |
| Hesitação | 300–500 ms | 80 ms | drive, arremesso, crossover |
| Step-back | 450–550 ms | 200 ms | arremesso, pump fake, passe |
| Spin | 500–650 ms | 250 ms | bandeja, arremesso, passe |
| Jumper (normal) | 500–700 ms até soltura | — (após sair do chão, só passe/pump-fake se ainda no gather) | — |
| Passe direto | 250–350 ms | 120 ms | — |
| Roubo (alcance) | 300–400 ms | 200 ms | deslize defensivo |
| Toco (pulo) | 600–900 ms | até aterrissar | — (no ar, sem controle: é o risco do toco) |

### 2.2 Regras anti-frustração

- **Nada de animação "fantasma"**: se o jogador soltou o stick, o personagem para em ≤ 2 passos.
- **Turn-in-place** rápido (≤ 200 ms para 90°) com a bola.
- **Sem sucção** (suction): defensores não são "puxados" para a frente do atacante. Contato só ocorre se os capsules realmente se cruzam.
- Toda animação de contato tem **variante leve** (aditiva, não trava) e só vira animação completa se o impacto for alto.

## 3. Sincronização da bola (o detalhe que separa amador de profissional)

A bola tem **3 estados de autoridade**:

| Estado | Quem controla a posição | Quando |
|---|---|---|
| `Held` | Socket da mão (`hand_r_ball`), com curva de offset na animação | Ameaça tripla, gather, catch, preparação de arremesso |
| `Dribbling` | **Trajetória cinemática** calculada entre contatos | Durante o drible |
| `Free` | **Solver físico** determinístico | Arremesso no ar, passe, rebote, bola solta |

### 3.1 Drible

1. Cada animação com bola tem `AnimNotify_BallRelease(mão)` e `AnimNotify_BallCatch(mão)` + curva `BallFloorContactTime`.
2. Na soltura, calculamos a parábola mão → ponto no chão → mão (de destino, que pode ser a outra mão em um crossover), resolvida para chegar **exatamente** no frame do catch.
3. **Hand IK** corrige até ~8 cm de desalinhamento entre mão e bola no catch.
4. Se a animação muda no meio (cancelamento), a trajetória é recalculada a partir do ponto atual da bola → a bola nunca "teletransporta".
5. Som da quicada = evento de contato com o piso (varia por superfície: madeira, asfalto, quadra de borracha).

### 3.2 Passe e recepção

- O receptor **prevê** ponto e tempo de chegada da bola e escolhe uma animação de catch (alto/baixo/lado/atrás/em movimento/fumble) por um Chooser; Motion Warping ajusta o último trecho.
- Passe ruim (baixo, atrás) → catch ruim → penalidade de equilíbrio no arremesso seguinte (ver `03-arremessos.md`).

## 4. Variedade sem explodir o orçamento

| Técnica | Ganho |
|---|---|
| **Espelhamento** (Mirror Data Table) | Toda animação de mão direita vira mão esquerda: ~2× conteúdo |
| **Escala de playrate** por atributo | Jogador rápido executa drible 10–15% mais rápido |
| **Aditivos de postura** | Corcunda, ereto, "swag" — personalidade com o mesmo mocap |
| **Pacotes** (estilos) | Estilo de drible, arremesso (base+soltura), bandeja, enterrada, comemoração → combinações únicas por jogador |
| **Retarget em runtime por proporção** | Mesmo mocap em armador de 1,80 m e pivô de 2,15 m (IK Retargeter + ajuste de alcance via Control Rig) |
| **Procedural** | Look-at, inclinação em curvas, respiração com fadiga, suor/brilho de pele |

## 5. Pipeline de mocap para equipe indie (solo/pequena)

### 5.1 Equipamento (opções, do mais barato ao mais caro)

| Opção | Custo aprox. | Prós | Contras |
|---|---|---|---|
| **Markerless por vídeo** (Move.ai: Move One com 1 câmera, Move Pro multicâmera a 120 fps; Rokoko Vision) | US$ 15–490/mês (Move One) | Barato, grava numa quadra real, com bola real | Pés deslizam, mãos fracas, oclusão; muito cleanup |
| **Traje inercial** (Rokoko Smartsuit Pro II ≈ US$ 2 mil; kit com luvas ≈ US$ 3,5 mil; com Coil Pro, sem drift, ≈ US$ 6,7 mil · Xsens/Movella US$ 15–35 mil) | US$ 2–35 mil | Funciona em qualquer quadra, dedos com luvas | Drift de posição, pulos/contato precisam de correção |
| **Estúdio óptico por diária** | US$ 1,5–3 mil/dia (faixa média); cleanup leva 2–8× o tempo gravado | Melhor qualidade, várias pessoas ao mesmo tempo | Caro, espaço limitado (quadra inteira é difícil) |
| **Bibliotecas prontas** (Fab/Marketplace, pacotes de esportes) | por pacote | Imediato para protótipo | Há **poucos** pacotes específicos de basquete; drible e arremesso quase sempre precisam ser gravados por nós |

**Recomendação para começar**:
1. Protótipo com bibliotecas prontas + o **Game Animation Sample Project (GASP)** da Epic, atualizado para a UE 5.8.
2. Primeira sessão própria com **markerless multicâmera** numa quadra real (barato e com bola de verdade) para a locomoção.
3. Quando a vertical slice for aprovada: traje inercial para volume (locomoção, defesa, sem bola) **+ 2 a 4 diárias de estúdio óptico** só para drible e arremesso. Traje inercial e markerless perdem os dedos e a bola, e o sincronismo mão–bola é o que vende o drible.

> Ferramenta descartada: o **Radical** encerrou os serviços web em 2026 (a tecnologia foi comprada pela Autodesk). Ainda sem avaliação: a captura de corpo com uma câmera do MetaHuman Animator (UE 5.8), cuja qualidade para movimento atlético é desconhecida.

### 5.2 Cleanup e ferramentas

- **Cascadeur** (licença indie ≈ US$ 99/ano abaixo de US$ 100 mil de receita): *animation unbaking* (transforma mocap em keys editáveis), AutoPhysics para corrigir pulos e aterrissagens, posing assistido.
- **Blender** ou **MotionBuilder**: edição, corte, loops.
- **UE5 IK Retargeter**: retarget para o esqueleto padrão (UE5 Manny/MetaHuman).
- **Ferramenta própria (Editor Utility)**: marcar contatos da bola, ponto de soltura, fases de cancelamento em lote.

### 5.3 "ProPLAY caseiro" (vídeo → animação)

O 2K converte imagens de transmissões da NBA em animação. Não podemos usar transmissões (direitos autorais), mas podemos:
1. Filmar **jogos locais/peladas** com 3–6 celulares (com termo de cessão de imagem assinado por todos).
2. Rodar em ferramenta de vídeo → mocap.
3. Usar como **referência** e como material bruto para Motion Matching (após cleanup).

### 5.4 Plano de sessões de captura

| Sessão | Conteúdo | Duração de gravação | Prioridade |
|---|---|---|---|
| S1 — Locomoção | Dance cards sem bola, com bola (D/E), defesa, ameaça tripla | 45–60 min úteis | P0 |
| S2 — Arremessos | Spot-up (5 bases), pull-ups, step-backs, fades, lances livres, floaters | 40 min | P0 |
| S3 — Drible | Crossovers, entre as pernas, por trás, spin, hesitação, in-and-out, combos, size-ups | 40 min | P0 |
| S4 — Finalização | Bandejas (todos os tipos), enterradas (atleta que enterra!) | 30 min | P0/P1 |
| S5 — Defesa | Contestação, roubos, tocos, closeouts, box-out | 30 min | P1 |
| S6 — Duplas | Contato, corta-luz, post-up, falta, toco sincronizado (2 atores) | 40 min | P1 |
| S7 — Personalidade | Comemorações, reações, gestos de streetball, provocações (leves) | 30 min | P2 |

Dicas de captura: gravar a 60–120 fps · bola real sempre · aro em altura oficial no espaço de captura (se possível) · cada movimento em **3 velocidades** e **2 lados** · slate falado ("S3, take 12, crossover direita-esquerda, rápido").

## 6. Catálogo de animações

Prioridades: **P0** = vertical slice 1x1 · **P1** = 3x3 · **P2** = carreira/polimento · **P3** = 5x5 profissional.
Contagens são de **clipes finais** após espelhamento (dance cards de Motion Matching contados à parte).

### 6.1 Locomoção (Motion Matching)

| Banco | Conteúdo | Prioridade |
|---|---|---|
| Sem bola | idle, starts (8 direções), stops, pivôs, cortes 45°/90°/135°/180°, jog, sprint, backpedal, V-cut, backdoor | P0 |
| Com bola | o mesmo + drible alto/baixo, proteção, retreat dribble, mudança de ritmo | P0 |
| Defesa | postura, slide lateral, drop step, cruzar pés (sprint de recuperação), closeout curto/longo, backpedal | P0 |
| Post | back-down, pivô, reposicionamento, seal | P1 |
| Transição | sprint de contra-ataque, recuo defensivo, desaceleração para meia-quadra | P1 |

### 6.2 Drible e ameaça tripla (~120 clipes no P1)

| Grupo | Clipes | Prior. |
|---|---|---|
| Crossover (alto, baixo, rápido, "killer") | 8 | P0 |
| Entre as pernas (parado, em movimento, recuando) | 6 | P0 |
| Por trás das costas | 4 | P0 |
| Hesitação / in-and-out | 6 | P0 |
| Spin (drible) | 4 | P0 |
| Step-back (com drible) / side-step | 6 | P0 |
| Size-ups / combos de assinatura | 12 | P1 |
| Proteção de bola (contra pressão) | 4 | P1 |
| Ameaça tripla: jab step, rip-through, pump fake, step-through | 10 | P1 |
| Gather (para arremesso/bandeja/passe) | 8 | P0 |
| Perda de bola (bola batendo no pé, roubada) | 6 | P1 |

### 6.3 Arremessos (~100 clipes no P1)

| Grupo | Clipes | Prior. |
|---|---|---|
| Spot-up — 5 bases × 3 velocidades | 15 | P0 |
| Catch-and-shoot em movimento (esq./dir./relocation) | 8 | P0 |
| Pull-up (reto, drift E/D) | 6 | P0 |
| Step-back jumper | 4 | P0 |
| Fadeaway / turnaround / one-leg fade | 6 | P1 |
| Floater / runner / teardrop | 6 | P1 |
| Hooks (jump, baby, sky) | 4 | P1 |
| Lance livre (ritual + arremesso) | 4 | P1 |
| Heave / buzzer-beater | 3 | P2 |
| Tip-in / putback | 4 | P1 |
| Reações pós-arremesso (follow-through, olhar, recuar) | 10 | P1 |
| Arremesso bloqueado / bola tocada | 4 | P1 |

### 6.4 Finalização (~90 clipes no P1)

| Grupo | Clipes | Prior. |
|---|---|---|
| Bandeja padrão (mão forte/fraca, 1 e 2 passos) | 6 | P0 |
| Euro step / hop step | 6 | P0 |
| Reverse / por baixo do aro | 4 | P1 |
| Finger roll / scoop / cradle | 6 | P1 |
| Bandeja com contato (and-one, desequilibrada) | 8 | P1 |
| Enterrada parada (1 e 2 mãos) | 4 | P0 |
| Enterrada em movimento (1 mão, 2 mãos, tomahawk) | 6 | P0 |
| Enterrada flashy (360, moinho, entre as pernas, reverse) | 8 | P2 |
| Enterrada com contato (pôster, bloqueada, desequilibrada) | 8 | P1 |
| Alley-oop (receber e finalizar: bandeja/enterrada) | 6 | P1 |
| Pendurar no aro / aterrissagem | 6 | P1 |

### 6.5 Passes (~50 clipes no P1)

| Grupo | Clipes | Prior. |
|---|---|---|
| Peito, quicado, por cima da cabeça | 6 | P0 |
| Em movimento / após drible / kick-out | 6 | P0 |
| Lob / alley-oop (lançar) | 4 | P1 |
| No-look, por trás das costas, bounce flashy | 6 | P2 |
| Hand-off (entregar/receber) | 4 | P1 |
| Recepções (alta, baixa, lateral, em movimento, fumble) | 12 | P0 |
| Passe de saída (outlet) / passe longo | 3 | P1 |

### 6.6 Post (~30 clipes no P1)

Back-down, drop step, up-and-under, giro (spin), hook de post, fadeaway de post, face-up, dream shake (combo), defesa de post (empurrar, bracear, fronting).

### 6.7 Defesa (~70 clipes no P1)

| Grupo | Clipes | Prior. |
|---|---|---|
| Contestação (mão alta, salto, lateral, atrasada) | 8 | P0 |
| Roubo (alcance direto, tapa por baixo, poke, interceptação de passe) | 8 | P0 |
| Toco (frente, lateral, chase-down, weak-side, segurar a bola) | 10 | P1 |
| Toco sofrido / reação | 4 | P1 |
| Tomar carga (charge) / flop leve | 4 | P2 |
| Box-out (iniciar, manter, perder) | 6 | P1 |
| Navegar corta-luz (por cima, por baixo, trocar) | 6 | P1 |
| Ajuda / rotação / recuperação | 6 | P1 |
| Reações de ser driblado (desequilíbrio, tropeço, **ankle-breaker**, queda) | 8 | P0 |

### 6.8 Rebote (~20 clipes no P1)

Salto 1 mão, 2 mãos, tapinha, rebote em disputa, rebote ofensivo + putback, mergulho por bola solta.

### 6.9 Contato e física (~40 clipes no P1)

Bump leve/médio/forte (frente/lado/trás), quadril, ombro, corta-luz recebido, queda e levantar, falta (reação), empurrão de post, mãos no rosto (reação leve).

### 6.10 Personalidade, cerimônia e streetball (~60 clipes no P2)

Comemorações (cesta, enterrada, game-winner, trash talk leve), reações (frustração, cansaço, mãos no joelho), check-ball (streetball), cumprimentos, intros, banco/tempo técnico (P3), gestos de pedir bola, apontar jogada.

### 6.11 Resumo de volume

| Fase | Clipes finais | Dance cards (min) |
|---|---|---|
| P0 — vertical slice 1x1 | ~180 | ~30 |
| P1 — 3x3 completo | ~550 | ~60 |
| P2 — carreira/polimento | ~900 | ~80 |
| P3 — 5x5 profissional | 2.000+ | ~120 |

(Para comparação: jogos AAA do gênero trabalham com dezenas de milhares de animações. Não vamos competir em quantidade; vamos competir em **resposta** e **qualidade dos momentos-chave**.)

## 7. Convenções

- Nome: `A_<Categoria>_<Ação>_<Variação>_<Lado>_<Velocidade>` → `A_Shot_SpotUp_Base03_R_Normal`, `A_Drib_Cross_Low_RtoL_Fast`.
- Montages: `AM_` · Pose Search DB: `PSD_` · Chooser: `CHT_` · Blend Space: `BS_`.
- Notifies obrigatórios por tipo:
  - Arremessos: `ReleasePoint`, `Gather`, `Takeoff`, `Land`, fases de cancelamento.
  - Dribles: `BallRelease(mão)`, `BallCatch(mão)`, curva `BallFloorContactTime`, fases.
  - Bandejas/enterradas: `Gather`, `Takeoff`, `BallRelease`/`RimContact`, `Land`.
  - Roubo/toco: `HandActiveStart`/`HandActiveEnd` (janela em que a mão pode tocar a bola).
- Root motion **ligado** em ações; locomoção dirigida pelo capsule (Motion Matching segue a trajetória do movement component).

## 8. Validação

- **Galeria de animações** (mapa de debug): todas as animações em grade, com bola, em loop.
- **Medidor de deslize de pé** (foot sliding) automatizado: alerta se o pé de apoio se move > 2 cm durante contato com o chão.
- **Teste de resposta**: script mede frames entre input e primeira mudança visível de pose; CI falha se > 6 frames (100 ms).
