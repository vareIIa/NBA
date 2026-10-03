# 13 — Roadmap (equipe solo / indie pequena)

> Honestidade primeiro: um jogo de basquete no nível visual do 2K levou décadas e centenas de pessoas.
> Nosso caminho é **começar pequeno e perfeito** (1x1 → 3x3 de rua) e só crescer quando a base for divertida.
> Prazos abaixo assumem **1–3 pessoas em tempo integral**. Em meio período, multiplique por ~2.

## Fase 0 — Pré-produção e protótipo cinza (1–2 meses)

**Pergunta a responder: "arremessar e driblar já é gostoso com cubos e animações emprestadas?"**

- [ ] Projeto UE5, Git LFS, estrutura de módulos (`12-arquitetura-tecnica.md`)
- [ ] Movement component de basquete (aceleração, plant-and-cut, energia)
- [ ] Solver da bola (aro, tabela, chão) + arremesso com timing + feedback
- [ ] Drible básico (crossover, hesitação, step-back) com animações de biblioteca
- [ ] Meia-quadra cinza, 1x1 contra um defensor que só segue
- [ ] Overlay de debug e teste de 10.000 arremessos

**Critério para avançar**: 5 pessoas jogam 15 min e pedem para jogar de novo.

## Fase 1 — Núcleo 1x1 (3–4 meses)

- [ ] Defesa: postura, compromisso, cutoff, roubo por exposição, contestação, toco físico
- [ ] Resolvedor de contato v1 + faltas básicas
- [ ] Bandejas e enterradas (P0) com Motion Warping
- [ ] Motion Matching na locomoção (bibliotecas + primeira sessão de mocap markerless)
- [ ] IA de 1x1 (utility + StateTree) com 3 níveis de dificuldade
- [ ] Modo 1x1 até 11 + HORSE + treino
- [ ] Primeiro playtest externo (10–20 pessoas)

**Critério**: ankle-breaker, pôster e toco acontecem de forma "merecida" e as pessoas comemoram.

## Fase 2 — 3x3 e vertical slice bonita (3–5 meses)

- [ ] Passe físico, corta-luz, cortes, espaçamento, rebote/box-out
- [ ] IA de time (tático + companheiros que passam a bola)
- [ ] Regras 3x3 (clear, check-ball, 12 s, 1 e 2 pontos)
- [ ] **Uma quadra linda**: viaduto ou praia no pôr do sol (arte final, Lumen, áudio completo, MC)
- [ ] 2 sessões de mocap próprias (arremessos + drible), personagens MetaHuman
- [ ] Replays e destaques automáticos
- [ ] **Trailer + página na Steam (wishlist)** + devlogs

**Critério**: vídeo de gameplay de 60 s que faz gente de fora querer jogar.

## Fase 3 — Carreira (Ato 1–2) e conteúdo (4–6 meses)

- [ ] Criação de personagem, Jump Shot Creator, pacotes de animação
- [ ] Progressão por uso, Estilos, nota de partida
- [ ] Atos 1 (Rua) e 2 (Circuito 3x3) da Carreira
- [ ] +3 quadras, 21, Rei da Quadra
- [ ] Tutorial interativo, acessibilidade, opções de câmera/medidor
- [ ] Mocap completo P1 (finalização, defesa, duplas)

## Fase 4 — Online e Early Access (4–6 meses)

- [ ] Rede: predição, timing no cliente, rewind de lag
- [ ] Matchmaking 1x1/3x3 (EOS), ranqueado, anti-cheat de timing
- [ ] Polimento, performance (60 fps travados), localização PT/EN/ES
- [ ] **Lançamento em Early Access na Steam** (PC)

**Total até Early Access: ~15–23 meses (equipe pequena, tempo integral).**

## Fase 5+ — Expansão (pós-lançamento, conforme tração)

- [ ] 5x5 meia e quadra inteira, playbooks, transição
- [ ] Atos 3–4 da Carreira (semi-pro e liga profissional fictícia)
- [ ] Arenas, público grande, apresentação de TV, narração
- [ ] Park (hub social online)
- [ ] Consoles
- [ ] Editor de jogadores/times compartilhável pela comunidade
- [ ] Franquia/GM

## Orçamento indicativo (fora salários)

| Item | Custo aprox. |
|---|---|
| Unreal Engine | Grátis até US$ 1 mi de receita bruta, depois 5% de royalty (conferir termos vigentes) |
| MetaHuman, Quixel/Fab gratuitos | Grátis (conferir licença para uso fora do UE se necessário) |
| Bibliotecas de animação para protótipo | US$ 100–1.000 |
| Mocap markerless (assinatura, alguns meses) | US$ 50–300/mês |
| Traje inercial + luvas (opcional, Fase 2–3) | US$ 3–15 mil |
| Atores de mocap (jogadores locais) | diárias |
| Música licenciada (artistas independentes) | US$ 1–5 mil |
| Steam Direct | US$ 100 por jogo |
| Servidores online (Fase 4) | variável — começar com host + relay |

## Riscos principais

| Risco | Mitigação |
|---|---|
| Escopo explode (querer ser 2K) | Fases com critério de avanço; 5x5 só depois do Early Access |
| Animação parece amadora | Investir em poucos momentos-chave (arremesso, enterrada, drible) + Motion Matching + cleanup no Cascadeur |
| Arremesso não é gostoso | Fase 0 inteira dedicada a isso, com testes |
| Rede ruim estraga o timing | Timing no cliente desde o design |
| Problema legal (marcas/atletas) | Liga, times e jogadores fictícios; ver `00-visao-geral.md` |
| Burnout de dev solo | Marcos curtos, playtests frequentes, devlog público para motivação e comunidade |
