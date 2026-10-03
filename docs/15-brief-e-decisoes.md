# 15 — Brief do Produto e Registro de Decisões

## 1. Papéis

| Quem | Papel |
|---|---|
| **Diretor do projeto** (usuário, *cardoso2k*) | Visão e **todas as decisões finais**. Referência de "feeling": jogador avançado de 2K23, estilo de drible fluido (giros, correr para todo lado, pull-ups). Fornece atletas e quadra para captura de movimento |
| **Claude** (líder técnico e de design) | Propõe opções **com uma recomendação**, implementa, documenta e testa. Pede decisão só quando ela muda o rumo do projeto |

## 2. Brief (versão melhorada do pedido original)

> Estamos criando um jogo de basquete **sim-arcade** em **Unreal Engine 5.8**. A sensação de **drible e arremesso** tem como referência principal o **NBA 2K23**: drible profundo e fluido, encadeado em movimento, e arremesso por timing em que acertar o **green** é a habilidade central.
>
> Os **controles são idênticos aos do 2K** no controle de Xbox (X arremessa com timing, A passe, B passe quicado, Y lob, Y Y alley-oop; o resto segue o mapeamento do 2K).
>
> O visual deve ser **o mais realista possível**, usando as melhores ferramentas e assets **gratuitos/open-source**. Nada de visual arcade/cartoon.
>
> **Primeira entrega: Freestyle.** Um jogador sozinho numa **quadra realista**, treinando drible, arremesso (green), bandejas, enterradas, fadeaways e dribble pull-ups. É o laboratório onde testamos e afinamos toda a jogabilidade. Depois vêm o **1x1** e o **3x3**.
>
> Sem pay-to-win. Liga, times e jogadores fictícios.
>
> Referências de gameplay do diretor em `referencias/2k23/`.

## 3. Registro de decisões

| # | Data | Decisão | Origem |
|---|---|---|---|
| D1 | 2026-10-03 | Gênero **sim-arcade** (visual realista, controle responsivo, diversão primeiro) | Diretor |
| D2 | 2026-10-03 | Engine **Unreal Engine 5** (versão 5.8) | Diretor |
| D3 | 2026-10-03 | Equipe **solo/indie**; o diretor decide, Claude propõe e executa | Diretor |
| D4 | 2026-10-03 | Ordem de modos: **Freestyle → 1x1 → 3x3**. Carreira e Streetball/Park ficam depois | Diretor |
| D5 | 2026-10-03 | **Identidade brasileira adiada.** Primeiro: quadra realista e o jogo rodando | Diretor |
| D6 | 2026-10-03 | **Controles idênticos ao 2K** (Xbox): X arremesso/green, A passe, B quicado, Y lob, Y Y alley-oop; restante mapeado do 2K (`02-controles.md`) | Diretor |
| D7 | 2026-10-03 | Visual **realista** com as melhores ferramentas/assets **gratuitos/open-source**; descartado o estilo arcade/cel-shading (NBA The Run "arcade demais") | Diretor |
| D8 | 2026-10-03 | **Referência de feeling: NBA 2K23** (drible profundo, green, pull-ups) | Diretor |
| D9 | 2026-10-03 | Captura de movimento **com atletas e quadra fornecidos pelo diretor** | Diretor |
| D10 | 2026-10-03 | Vocabulário do jogo usa **"green"** para a soltura perfeita (termo que os jogadores de 2K já conhecem) | Proposta Claude, a confirmar |
| D11 | 2026-10-03 | Mídias de referência versionadas com **Git LFS** | Claude |

## 4. Decisões pendentes (propostas com recomendação)

| Tema | Recomendação | Alternativa |
|---|---|---|
| Quadra realista do Freestyle | **Ginásio indoor de madeira** (piso brilhante, luz controlada: o "momento bonito" mais fácil de acertar) | Quadra externa de asfalto |
| Medidor de arremesso no Freestyle | Ligado por padrão, com opção de desligar (+10% de janela) | Desligado por padrão |
| Green livre = cesta garantida | **Sim** (igual ao 2K23–2K27) | Green com chance alta, mas não garantida |
| Nome do jogo | Escolher antes da página da Steam (Fase 2) | — |
