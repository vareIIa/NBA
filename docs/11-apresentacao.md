# 11 — Apresentação: Visual, Câmera e Áudio

> O 2K é bonito. Para ser bonito com orçamento indie: **poucos lugares, iluminação incrível, personagens convincentes de perto e muito "juice" nos momentos-chave.**

## 1. Direção de arte

- **Realista** (decisão D7): proporções, materiais e luz realistas (MetaHuman, piso de madeira brilhante, iluminação de ginásio), com grading de cor cuidadoso. Nada de cel-shading ou estilo arcade.
- Risco conhecido: perseguir o fotorrealismo do 2K com equipe pequena foi parte do que derrubou o NBA Live. Mitigação: **poucos ambientes** (começando por um ginásio indoor no Freestyle), personagens MetaHuman e foco em luz e piso, onde o realismo rende mais por hora de trabalho.
- Cada quadra tem uma **paleta e horário** marcantes (pôr do sol na praia, sódio/laranja sob o viaduto, azul neon da noite na comunidade).
- Referências: fotografia de streetball (quadras de rua no pôr do sol), transmissões de 3x3 FIBA, jogos de esporte com forte identidade visual.

> **Decisão D7**: realista, com ferramentas e assets gratuitos/open-source. Stack, licenças e receita do piso brilhante em `16-pipeline-aberto-visual-e-mocap.md §1–3`.

## 2. Tecnologia de render (UE5)

| Elemento | Solução |
|---|---|
| Iluminação | **Lumen** (GI dinâmica), ótimo para quadras ao ar livre com horário do dia. **Lumen Lite** (UE 5.8, ~2× mais rápido) para PCs fracos. **MegaLights** (pronto para produção na 5.8) para centenas de luzes com sombra: postes, refletores de ginásio, neon |
| Geometria | Nanite para cenário (prédios, grades, arquibancadas); personagens com malha tradicional (skinned) |
| Personagens | **MetaHuman** como base (rostos, corpo, LODs) + roupas/tênis próprios. Desde a UE 5.6, MetaHumans podem ser vendidos e usados em qualquer engine |
| Piso | **Reflexo brilhante da quadra** é a assinatura visual do basquete: orçar cedo (Lumen reflections / SSR / planar em replays). Na rua, o asfalto molhado depois da chuva também é um "momento bonito" barato |
| Pele/suor | Material com máscara de suor que cresce com a fadiga; brilho especular dinâmico |
| Cabelo | Groom (strand) em close-up, cards em gameplay |
| Roupas | Cloth sim leve em camiseta/shorts (Chaos Cloth), simplificado em LOD |
| Público | Poucos NPCs completos perto da quadra + **MetaHuman Crowd** (UE 5.8, experimental, baseado em Mass) ou **Vertex Animation Textures** (plugin AnimToTexture + instancing; ~6 mil espectadores em ~280 draw calls em um exemplo publicado). Em quadras de rua o público é pequeno, o que é uma vantagem |
| Upscaling | TSR / DLSS / FSR, alvo 60 fps |

### 2.1 Orçamento de performance (alvo PC médio, 1440p com upscaling)

| Sistema | ms/frame |
|---|---|
| Animação (10 jogadores + Motion Matching) | ≤ 3,0 |
| Gameplay + IA + bola | ≤ 1,5 |
| Render (Lumen + personagens + cenário) | ≤ 10,5 |
| **Total** | **≤ 16,6 (60 fps)** |

## 3. Câmeras

| Câmera | Uso |
|---|---|
| **Transmissão** (lateral, alta) | Padrão 5x5 |
| **Rua** (mais baixa e próxima, meia-quadra) | Padrão streetball/3x3 |
| **Jogador** (travada no seu personagem) | Carreira |
| **Atrás da cesta** | Opcional |
| **Replay** | Cinematográfica: lentes, profundidade de campo, câmera lenta |

Regras: nunca perder o aro de vista no ataque; zoom suave em arremessos decisivos; shake mínimo (opcional) em enterradas. Câmera de transmissão = posição lateral elevada, acompanhando com amortecimento um centróide ponderado (bola + ação), com pan/zoom limitados; um "diretor" de replay corta por evento. Usar a palestra "50 Game Camera Mistakes" (John Nesky, GDC) como checklist.

## 4. Áudio (metade da sensação de "jogo bom")

- **Foley de quadra**: chiado de tênis (varia por piso e velocidade de corte), quique (madeira x asfalto), rede (swish, aro, tabela), contato de corpo, respiração com fadiga.
- **Swish perfeito** com som assinatura.
- **MC de quadra** (streetball) com falas de hype em português (e inglês/espanhol depois). Narração de TV completa só na fase profissional.
- **Música**: trilha licenciada de artistas independentes (rap, funk, trap, boom bap) — licenças diretas, mais baratas e com identidade brasileira.
- Áudio dinâmico do público: reage a sequências, ankle-breakers, pôsteres, game-winners.

## 5. "Juice" (momentos de recompensa)

- Câmera lenta curta (opcional) em pôster/ankle-breaker/game-winner.
- Público reage (gritos, "uuuh"), MC grita, câmera mostra o banco/torcida.
- Indicador de **"Em chamas"** visível após sequência.
- Replays automáticos curtos e puláveis.

## 6. Interface

- **UMG + CommonUI** (suporte a controle/teclado).
- HUD mínimo: placar, relógio, energia, feedback de arremesso. Tudo configurável.
- Menus rápidos: da tela inicial até jogar em **≤ 3 cliques**. Sem telas de carregamento longas, sem propaganda dentro do jogo.
