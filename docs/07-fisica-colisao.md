# 07 — Física, Colisão e Contato

## 1. Visão geral

| Sistema | Implementação | Determinístico? |
|---|---|---|
| Movimento dos jogadores | Movement component próprio, capsule, tick fixo | Sim (server-authoritative + predição) |
| Bola | **Solver próprio** em C++ (esfera vs. aro/tabela/chão/jogadores) | Sim (tick fixo 120 Hz) |
| Contato entre jogadores | Sistema de **resolução de contato** próprio (não física genérica) | Sim |
| Reações visuais de impacto | Physical Animation + ragdoll parcial | Não (cosmético) |
| Rede, roupas, cabelo | Chaos Cloth / Groom | Não (cosmético) |

Por que não usar Chaos para a bola? Precisamos de **determinismo** para rede e para prever rebotes/IA, e de controle fino sobre o "feeling" do aro. Chaos fica para o que é cosmético.

## 2. Solver da bola

- Integração semi-implícita de Euler (ou Verlet) a 120 Hz, gravidade 9,81 m/s², arrasto do ar leve e efeito Magnus opcional (spin muda levemente a trajetória).
- Colisores analíticos (rápidos e exatos):
  - **Aro**: toro (raio interno livre 0,2285 m + tubo de ~0,008 m de raio → raio maior ≈ 0,237 m).
  - **Tabela**: caixa fina (plano com bordas).
  - **Suporte/haste**: cápsulas.
  - **Chão**: plano com material (madeira/asfalto/borracha).
  - **Mãos/braços dos jogadores**: esferas/cápsulas ligadas aos ossos, **ativas só em janelas** (`HandActive`).
- Parâmetros por superfície: restituição, atrito, perda de spin. Valores iniciais em `03-arremessos.md §10`.
- **Sub-stepping** quando a velocidade é alta para não atravessar o aro.

## 3. Movimento e colisão de jogadores

- Cada jogador = capsule (raio ∝ largura do ombro/peso) + "**zona de contato**" maior (raio +15 cm) que antecipa colisões e escolhe animações antes do impacto.
- Jogadores **não se atravessam** e **não são empurrados como caixas**: quando as zonas de contato se cruzam, o **resolvedor de contato** decide o resultado.

### 3.1 Resolvedor de contato

Entradas: velocidades relativas, ângulo de impacto, massa (peso), Força, equilíbrio atual, quem tem **posição legal** (pés plantados, cilindro vertical), ação em andamento (drive, arremesso, corta-luz, box-out).

```
impacto = |v_rel| · massa_relativa · fator_ângulo
vantagem = (Força_A − Força_B)·0.03 + (equilíbrio_A − equilíbrio_B) + bônus_posição_legal
```

| Impacto | Resultado | Animação |
|---|---|---|
| Baixo | Desvio leve, perda de 5–15% de velocidade | Aditiva (não trava) |
| Médio | Bump: perde ~1 passo, quem perde a vantagem recua | Montage curto (≤ 250 ms) |
| Alto | Desequilíbrio forte / queda | Montage + Physical Animation |
| Ilegal | Falta (bloqueio, carga, empurrão, segurar) | Reação de falta + apito |

### 3.2 Árbitro (detecção de falta)

- Regras explícitas, não "sorteio": falta de bloqueio = defensor sem posição legal (em movimento lateral para dentro do caminho) no momento do contato; carga = defensor com posição legal antes do atacante iniciar o movimento de arremesso/bandeja, fora da meia-lua.
- **Tolerância configurável** (slider "Rigor da arbitragem"): streetball deixa o jogo correr; profissional marca mais.
- No 3x3/streetball online: opção "chama a própria falta" (cultura de quadra) — futuro.

## 4. Momentos sincronizados (paired animations)

Para contato forte de alto impacto visual (pôster, toco em contato, queda após carga), usamos **animações pareadas** (2 atores gravados juntos na sessão S6):
1. O resolvedor decide o resultado.
2. Motion Warping alinha os dois jogadores ao par de animação. Na UE 5.8, os **Pose Search Interaction Assets** (Motion Matching com vários personagens, demonstrado no GASP) fazem essa escolha e esse alinhamento. Começar por eles antes de escrever um sistema próprio.
3. Se o alinhamento exigiria mais que o limite (0,6 m / 45°), cai para animações individuais + Physical Animation.

## 5. Lições de outros jogos

- **Madden (FieldSENSE)**: a física **escolhe** a animação; os corpos não são simulados. É o mesmo princípio do nosso resolvedor.
- **FIFA 12 (Player Impact Engine)**: física em todos os contatos virou meme de bugs. A indústria migrou para "seleção de animação informada por física".
- **NBA The Run (2026)**: criticado por "não ter colisões reais". Contato **é** parte do basquete, e é onde podemos nos diferenciar.
- **NBA 2K27**: reclamações de corpos embolados no garrafão e de bola "atravessando o corpo" no post. A bola tem colisores nos jogadores (§2), e o resolvedor tem um caso especial para 3 ou mais jogadores em contato simultâneo.

## 5.1 Rede da cesta com física (versão three.js)

Pedido do diretor (2026-10-14): a rede precisa reagir como na vida real, e **a bola nunca pode atravessar a rede**.

Código em `web/src/sim/HoopsNet.ts` (física), `web/src/game/NetMesh.ts` (desenho) e `HoopsNet.test.ts` (testes). O
`BallSim`, portado do C++, não mudou.

**Como a rede é montada:**
- Trama em losango, como a rede real: 12 ganchos no aro (FIBA), 6 fileiras de nós, 84 nós e 144 cordões.
- 43 cm de comprimento e 150 g de massa.
- A boca de baixo, em repouso, é mais estreita que a bola. Para passar, a bola abre os losangos, e é isso que faz a
  rede "subir".

**Como a física funciona:**
- Dinâmica por posição (Verlet), com cordões de comprimento fixo e tirantes até o gancho, para a rede não esticar.
- Os ganchos ficam pendurados logo abaixo do tubo do aro, e nenhum nó sobe acima deles. Assim nenhum cordão cruza o
  aro, nem quando a bola levanta a rede. Isso corrigiu um bug do playtest em que, num arremesso real (a ~45°), o
  cordão entrava 1 cm dentro do tubo.
- Contato bola × cordão (cápsula), com massa dos dois lados.
- Na passada final, um nó que chegou no limite do tirante não cede mais, e a correção vai toda para a bola. Com a rede
  esticada, a bola é empurrada para fora e não passa.
- A bola recebe a correção como velocidade, mais um arrasto de atrito (8/s) enquanto encosta na rede. Por isso ela sai
  por baixo mais lenta e com a direção mudada.

**Integração com o jogo:**
- O `Freestyle` chama `onFlightTick` depois de cada tick do `BallSim` (120 Hz).
- Fora do voo, a rede continua balançando sozinha até parar.
- A rede fica abaixo do plano do aro, então não muda a detecção de cesta nem a decisão do arremesso.

**Testes:**

| Situação | O que o teste exige |
|---|---|
| Cesta limpa | A bola sai por baixo, mais de 15% mais lenta do que sem rede. |
| Bola entrando de lado | A bola sai por baixo. |
| Bola batendo na rede por fora | A rede cede e tira mais da metade da velocidade. |
| 60 cestas aleatórias (ângulo e velocidade) | Nenhuma cruza um cordão: a folga entre a bola e qualquer cordão nunca fica abaixo de −12 mm. |
| 40 arremessos reais (40–52°, 6–7 m/s, de todos os lados) e a rede em repouso | Nenhum nó passa do nível dos ganchos e nenhum cordão entra no tubo do aro. |

## 6. Performance

- Até 10 jogadores + bola + árbitros: barato. O custo está em animação (Motion Matching é o mais caro → usar intervalo de busca de 2–4 frames e LOD de busca por distância da câmera).
- Alvo: **60 fps travados** em PC médio (RTX 3060 / PS5-equivalente) em 1440p com upscaling.
