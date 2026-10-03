# 10 — Modos de Jogo

Escolhidos para o plano: **Carreira** e **Streetball / 3x3 / Quadra (Park)**. Jogo rápido 5x5, Franquia/GM e online 5x5 ficam para fases posteriores (ver `13-roadmap.md`).

Ideia central: **a Carreira começa no streetball.** O jogador cria o personagem numa quadra de rua e sobe até o profissional. Assim o primeiro modo que construímos (3x3 de rua, barato) já é a base da Carreira.

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
