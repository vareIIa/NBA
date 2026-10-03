# 10 — Modos de Jogo

**Ordem de produção (decisão D4, out/2026): Freestyle → 1x1 → 3x3.** Carreira e Streetball/Park vêm depois, sobre essa base. Jogo rápido 5x5, Franquia/GM e online 5x5 ficam para fases posteriores (ver `13-roadmap.md`).

Ideia central (para depois): **a Carreira começa no streetball.** O jogador cria o personagem numa quadra de rua e sobe até o profissional.

---

## 0. Freestyle (modo nº 1: o laboratório do jogo)

Um jogador **sozinho** numa **quadra realista**, com bola infinita, treinando tudo: drible, arremesso (green), bandejas, enterradas, fadeaways, dribble pull-ups de meia distância, step-backs, floaters. É o modo que construímos **primeiro** e onde fazemos a maior parte dos testes de gameplay. Precisa ser divertido sozinho (como o treino livre do 2K) e ser uma ferramenta de laboratório (como o modo treino de jogos de luta).

### 0.1 Funções de jogo

| Função | Detalhe |
|---|---|
| Bola volta sozinha | Depois do arremesso, a bola volta para o jogador (passe automático do "rebotedor") ou fica livre para pegar o rebote, à escolha |
| Spots e desafios | Marcadores no chão (cantos, alas, topo, cotovelos, garrafão): "acerte 5 greens seguidos de cada spot", "10 dribble pull-ups de meia distância", "mikan drill" de bandejas |
| Defensor manequim | Manequim posicionável com **contestação ajustável** (nenhuma / leve / forte, mão alta, altura do defensor). Pode "seguir" o jogador em modo simples |
| Cones | Cones posicionáveis para treinar trajetos de drible (rotas, zigue-zague, spin em volta do cone) |
| Placar de sessão | % de green, % de acerto por zona, combos de drible, maior sequência de greens |
| Troca rápida de jogador | Trocar de corpo/atributos/pacote de animação sem sair do modo (testar armador × pivô) |

### 0.2 Funções de laboratório (overlay ligável)

| Função | Para quê |
|---|---|
| **Histórico de inputs** (estilo jogo de luta) | Ver cada flick do RS, botão e gatilho, com timestamp; reproduzir combos exatos |
| **Janela de timing desenhada** | Barra com Perfeito/Green, Bom e Leve, e onde o input caiu (ms) |
| **Breakdown do arremesso** | `L`, contestação, fadiga, equilíbrio, P final (`03-arremessos.md`) |
| **Estado da animação** | Nome do clipe/banco de Motion Matching, fase (startup/commit/active/recovery), janela de cancelamento, buffer |
| **Câmera lenta** (25/50%) e **pausa quadro a quadro** | Avaliar transições de drible e o ponto de soltura |
| **Gravar e repetir** (replay determinístico) | Reproduzir uma sequência de inputs para comparar versões do jogo |
| **Medidores de qualidade** | Foot sliding, latência input→pose, desalinhamento mão–bola |

### 0.3 Critério de pronto do Freestyle

- [ ] Driblar parado e em velocidade encadeando ≥ 4 movimentos sem perder o controle
- [ ] Dribble pull-up de meia distância saindo de uma corrida, com gather em movimento
- [ ] Green consistente e legível para quem tem timing, com feedback claro
- [ ] Bandejas (5 tipos) e enterradas (3 tipos) a partir de infiltração
- [ ] Fadeaway e step-back funcionando
- [ ] O diretor joga 30 min e reconhece a "sensação de 2K23" no drible

---

## 1. Streetball / 3x3 / Quadra

### 1.1 Formatos

| Formato | Regras | Fase |
|---|---|---|
| **1x1** | Até 11 (cestas de 1 e 2), "make it take it" opcional, check-ball | P0 |
| **21** | Todos contra todos (3–5 jogadores), lance livre após cesta, regra de estourar 21 volta para 13/15 | P1 |
| **2x2 / 3x3 de rua** | Até 15 ou 21 (1 e 2 pontos), clear após rebote defensivo, check-ball | P1 |
| **3x3 FIBA** | Até 21 ou 10 min, relógio de 12 s, 1 e 2 pontos, regras oficiais FIBA 3x3 | P1 |
| **Rei da Quadra** | Quem vence fica; fila de times (online/local) | P2 |
| **HORSE (CAVALO)** | Desafio de arremessos | P1 |
| **Desafios de enterrada / skills** | Modo de "highlight" | P2 |

### 1.2 Quadras (ambientação)

Quadras **fictícias inspiradas em lugares reais**, poucas e lindas (é aqui que o jogo fica "bonito" sem orçamento de arena):

| Quadra (proposta) | Clima | Diferencial |
|---|---|---|
| Quadra embaixo do viaduto (SP) | concreto, grafite, luz de poste | Ícone urbano brasileiro |
| Quadra da praia (Rio) | pôr do sol, areia, vento | Luz dourada, "cartão postal" |
| Quadra de comunidade com vista da cidade | noite, luzes da cidade | Vibe de evento, torcida em volta |
| Ginásio de escola/clube | madeira velha, arquibancada pequena | Transição para o semi-pro |
| Quadra de Nova York (inspiração Rucker/West 4th) | verão, grade alta | Lenda do streetball mundial |

Cada quadra tem: **horário do dia/clima** (afeta só visual), piso que muda o som e o quique da bola, público local com animações simples, **MC/locutor de quadra** com falas de hype.

### 1.3 Online (fases)

1. **Local** (mesmo sofá) + bots — P1.
2. **Online 1x1 e 3x3 por matchmaking** (ranqueado e casual) — P3.
3. **Quadra social (Park)**: hub com várias quadras, fila, "chama o próximo" — P4 (só se a base de jogadores justificar; é caro de manter).

Princípios online: servidores/host com timing de arremesso julgado no cliente (`03-arremessos.md §9`), **sem VC**, reputação por comportamento (não por quanto jogou), filtro de quem abandona partida.

---

### 1.4 Hype da quadra (proposta, opcional)

Duas ideias clássicas juntas: o medidor de torcida do *College Hoops 2K8* (atmosfera como sistema) e o *Gamebreaker* do *NBA Street* (estilo vira placar).

- Jogadas de estilo enchem o **Hype** do time: ankle-breaker, pôster, toco, passe flashy que vira cesta, sequência de cestas.
- O público da quadra reage em tempo real (som, câmera, MC).
- Hype cheio = **"A quadra é sua"** por 2 posses: a cesta seguinte vale +1 ponto **ou** o time ganha um efeito pequeno e visível (ex.: janela Perfeito +10%).
- Regra de partida: **Liga/Desliga** (desligado por padrão no ranqueado competitivo).
- Diferença para o Takeover do 2K27 (5 medidores, 6 níveis, ativação automática): **um medidor só**, visível, do time, e por estilo, não por volume.

### 1.5 Jogadoras e jogadores

O 2K27 fez a Cidade **co-ed**, com o mesmo sistema de atributos para todos. Proposta: no streetball, **partidas mistas** com o mesmo sistema; corpo (altura, peso, envergadura) define as diferenças físicas, como para qualquer jogador. Ligas profissionais da Carreira: a definir (ver `14-perguntas-abertas.md`).

## 2. Carreira

### 2.1 Arco de história (proposta)

| Ato | Onde | Objetivo de gameplay | Destrava |
|---|---|---|---|
| **1. Rua** | Quadras de rua da sua cidade | 1x1 e 21 → ganhar respeito | Criação de personagem, primeiros Estilos |
| **2. Circuito** | Torneios 3x3 em várias cidades | Formar time de 3, ganhar o circuito, ser notado por olheiro | 3x3 FIBA, companheiros fixos (com química) |
| **3. Semi-pro / Seleção 3x3** | Ginásios, liga regional | 5x5 em quadra menor, adaptar-se a sistema de jogo | 5x5 (P3), técnico, jogadas |
| **4. Profissional** | Liga fictícia profissional | Draft, temporadas, playoffs, legado | Arenas, apresentação de TV (P3+) |

- **Narrativa leve e pulável**: cenas curtas, o foco é jogar. O 2K é criticado por histórias longas e forçadas; no 2K27, o companheiro de carreira obrigatório ("Running Mate") foi um dos pontos mais criticados. Aqui não há personagem obrigatório grudado no jogador.
- **Escolhas com consequência pequena e clara** (com quem treinar, qual torneio disputar, rivalidade).
- **Rivais recorrentes** com estilo próprio (o "rei" da quadra do viaduto, o arremessador da praia).

### 2.2 Loop de uma semana na Carreira

```
Escolher evento (torneio / pelada / desafio / treino)
  → Jogar (3–12 min por partida)
  → Nota + XP de atributo por uso + Estilos progredindo
  → Reputação (local → regional → nacional)
  → Recompensas cosméticas + convites para eventos maiores
```

### 2.3 Criação do personagem

- Rosto: presets + escultura (sistema baseado em MetaHuman ou similar; ver `11-apresentacao.md`). Escaneamento por foto do celular: **P3** (custo/privacidade a avaliar).
- Corpo: altura, peso, envergadura (com efeitos explicados, `09-atributos-progressao.md`).
- **Jogadores e jogadoras**: criação aberta para qualquer gênero (pergunta em aberto se 3x3 misto ou ligas separadas).
- Pacotes de animação: drible, arremesso (Jump Shot Creator), bandeja, enterrada, comemorações.

### 2.4 Câmera da Carreira

- Padrão: câmera de transmissão aproximada, travada no seu jogador quando sem bola.
- Opção: câmera "atrás do jogador" (estilo terceira pessoa).

---

## 3. Modos de suporte (baratos e essenciais)

| Modo | Fase | Por quê |
|---|---|---|
| **Treino livre** com overlay de debug (janelas, contestação, %) | P0 | Ensina o sistema de arremesso e ajuda nossos testes |
| **Tutorial interativo** (5 min) | P1 | O 2K quase não ensina; nós ensinamos tudo |
| **Replay + modo foto** | P2 | Compartilhamento = marketing gratuito |
| **Destaques automáticos** (pôster, ankle-breaker, game-winner) com exportação de clipe | P2 | Viralização |
