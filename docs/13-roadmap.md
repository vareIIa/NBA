# 13 — Roadmap (equipe solo / indie pequena)

> Honestidade primeiro: um jogo de basquete no nível visual do 2K levou décadas e centenas de pessoas.
> Nosso caminho é **começar pequeno e perfeito** (**Freestyle → 1x1 → 3x3**) e só crescer quando a base for divertida.
> Prazos abaixo assumem **1–3 pessoas em tempo integral**. Em meio período, multiplique por ~2.

## Fase 0 — Freestyle (2–3 meses)

**Pergunta a responder: "sozinho na quadra, driblar e arremessar já tem a sensação de 2K23?"**

- [x] Projeto UE 5.8, Git LFS, estrutura de módulos (`12-arquitetura-tecnica.md`) — *aguardando 1ª compilação no PC do diretor*
- [x] **Controles idênticos ao 2K23** via Enhanced Input (`02-controles.md`)
- [ ] Movement component de basquete (aceleração, plant-and-cut, energia) — *hoje: CharacterMovement ajustado + energia/Explosões no núcleo*
- [x] Solver da bola (aro, tabela, chão) + arremesso com timing/green + feedback (núcleo testado)
- [x] Drible pelo Pro Stick do 2K23 (crossover, entre as pernas, por trás, hesitação, step-back, spin, half-spin, combos) — *sem animação própria ainda*
- [x] Gather em movimento → dribble pull-up, step-back, fadeaway, bandejas e enterradas básicas
- [x] Defensor manequim + contestação geométrica
- [ ] **Quadra realista** (ginásio indoor) com assets gratuitos/open-source — *iluminação de ginásio + script de piso CC0 prontos; falta arquibancada/paredes*
- [x] **Modo Freestyle** com overlay de laboratório (inputs, janelas, contestação, câmera lenta)
- [ ] Teste de 10.000 arremessos (núcleo: feito) e medidor de latência input→pose (falta)
- [ ] Animações: Motion Matching (GASP) com o personagem do jogo
- [ ] Primeira sessão de captura com os atletas do diretor

**Critério para avançar**: o diretor joga 30 min de Freestyle e reconhece a sensação de drible/arremesso do 2K23.

## Fase 1 — Núcleo 1x1 (3–4 meses)

- [ ] Defesa: postura, compromisso, cutoff, roubo por exposição, contestação, toco físico
- [ ] Resolvedor de contato v1 + faltas básicas
- [ ] Bandejas e enterradas (P0) com Motion Warping
- [ ] Motion Matching na locomoção (bibliotecas + primeira sessão de mocap markerless)
- [ ] IA de 1x1 (utility + StateTree) com 3 níveis de dificuldade
- [ ] Modo 1x1 até 11/21 (regras de rua: 1 e 2 pontos ou 2 e 3) + HORSE
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
| Unreal Engine | Grátis até US$ 1 mi de receita bruta por produto, depois 5% (3,5% no programa "Launch Everywhere with Epic"; vendas na Epic Games Store sem royalty). Conferir termos vigentes |
| MetaHuman, Quixel/Fab gratuitos | Grátis (conferir licença para uso fora do UE se necessário) |
| Bibliotecas de animação para protótipo | US$ 100–1.000 |
| Mocap markerless (Move One/Move Pro) | US$ 15–490/mês (Move One); Move Pro sob consulta |
| Cascadeur (cleanup) | ~US$ 99/ano (licença indie) |
| Diárias de estúdio óptico (drible/arremesso, opcional) | US$ 1,5–3 mil/dia × 2–4 dias |
| Traje inercial + luvas (opcional, Fase 2–3) | ~US$ 3,5 mil (Rokoko com luvas) a ~6,7 mil (com Coil Pro) |
| Atores de mocap (jogadores locais) | diárias |
| Música licenciada (artistas independentes) | US$ 1–5 mil |
| Steam Direct | US$ 100 por jogo |
| Servidores online (Fase 4) | variável — começar com host + relay |

## Concorrência direta

| Jogo | Posição | Nosso espaço |
|---|---|---|
| NBA 2K27 | AAA, licenciado, US$ 70 + VC. Usuários: 3,8/10 | Justo, sem VC, responsivo |
| NBA The Run (2026) | UE5, 3x3 arcade cel-shaded, rollback, US$ 29,99, sem microtransações | Visual realista estilizado, colisão física, feedback claro, Carreira |
| Hoop Land | Indie 2D retrô com liga profunda | 3D, quadra, sensação física |

Preço sugerido para o Early Access: na faixa de US$ 20–30 (a definir).

## Riscos principais

| Risco | Mitigação |
|---|---|
| Escopo explode (querer ser 2K) | Fases com critério de avanço; 5x5 só depois do Early Access |
| Animação parece amadora | Investir em poucos momentos-chave (arremesso, enterrada, drible) + Motion Matching + cleanup no Cascadeur |
| Apostar em tecnologia não provada (lição do NBA Elite 11, cancelado por animação com física) | Usar ferramentas de produção (GASP, Pose Search); física só em reações e quedas |
| Arremesso não é gostoso | Fase 0 inteira dedicada a isso, com testes |
| Rede ruim estraga o timing | Timing no cliente desde o design |
| Problema legal (marcas/atletas) | Liga, times e jogadores fictícios; ver `00-visao-geral.md` |
| Burnout de dev solo | Marcos curtos, playtests frequentes, devlog público para motivação e comunidade |
