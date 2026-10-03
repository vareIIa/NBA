# 00 — Visão Geral

## 1. Pitch

**Um jogo de basquete bonito como os grandes, mas que respeita o jogador:** controle responsivo, arremesso justo e legível, defesa que importa, e nenhuma vantagem à venda. Começa nas quadras de rua e vai até o profissional.

- **Codinome provisório**: *Projeto Garrafão* (nome final a definir).
- **Gênero**: basquete **sim-arcade** — visual e física realistas; ritmo, controle e recompensas pensados para diversão.
- **Engine**: Unreal Engine 5.8 (partindo do Game Animation Sample Project da Epic).
- **Plataforma inicial**: PC (Steam), Early Access. Consoles depois.
- **Equipe**: solo / indie pequena → escopo em fases (`13-roadmap.md`).
- **Ordem de produção**: **Freestyle** (sozinho na quadra: laboratório de drible e arremesso) → **1x1** → **3x3**. Depois: Carreira e Streetball/Park.
- **Referência de feeling**: NBA 2K23 (drible profundo, green, pull-ups). Clipes do diretor em `referencias/2k23/`.
- **Controles**: idênticos ao 2K (Xbox). Ver `02-controles.md`.
- **Decisões e papéis**: `15-brief-e-decisoes.md`.

## 2. Pilares

| # | Pilar | Na prática |
|---|---|---|
| 1 | **Controle primeiro** | Input → reação em ≤ 100 ms. Nenhuma ação comum trava o jogador > 250 ms. Toda animação tem janela de cancelamento. |
| 2 | **Habilidade legível** | Todo acerto/erro explicado em < 1 s (timing, contestação, fadiga). Arremesso perfeito livre **sempre** entra. |
| 3 | **Defesa é divertida** | Roubo por exposição de bola, toco com física real, cutoff com recompensa sonora/visual. |
| 4 | **Bonito com propósito** | Poucos lugares, lindíssimos; 60 fps travados; juice nos momentos-chave. |
| 5 | **Justo** | Zero pay-to-win. Atributos só jogando. Monetização apenas cosmética (se houver). |
| 6 | **Divertido em 3 minutos** | Partidas curtas de rua, menus rápidos, highlights automáticos. |

## 3. O que pegamos do 2K e o que consertamos

| O 2K faz bem (copiamos a ideia) | O 2K faz mal (consertamos) |
|---|---|
| Visual de transmissão, personagens detalhados | Animações que prendem o jogador (perda de controle) |
| Variedade de dribles e arremessos personalizados | Arremesso que parece aleatório / sem feedback claro |
| Criação de jogador + jogo de rua online | Pay-to-win (VC para atributos) |
| Contestação e timing como habilidade | Latência online roubando arremessos |
| Sistema de estilos/badges dando identidade | 53 badges com tokens e sinergias; grind excessivo |
| Ankle-breakers lendo o momento do defensor | Janela de arremesso que "muda no ar"; contestação visual ≠ número |
| Apresentação, trilha e "cultura" do basquete | Companheiros de IA ruins, histórias longas e forçadas |

> Detalhes da engenharia reversa (análise de design) em `01-engenharia-reversa-2k27.md`.

## 4. Questões legais (importante)

- **"Engenharia reversa" aqui = análise de design**: observar o jogo, ler notas oficiais, analisar vídeos e reviews. **Não** descompilamos, extraímos assets, código ou dados do 2K (viola EULA e direitos autorais).
- **Não usamos** os nomes/marcas "NBA", "2K", nomes/logos de times, nomes, rostos ou números de atletas reais sem licença (NBA, NBPA e atletas licenciam isso separadamente).
- Mecânicas de jogo em geral não são protegidas, mas **expressão** é (arte, UI, textos, sons, nomes). Nossa UI, arte e sons são originais.
- **Liga, times e jogadores fictícios.** Um editor de jogadores pode existir, mas não distribuímos rosters reais.
- Mocap/vídeo de pessoas reais: sempre com **termo de cessão de imagem** assinado.
- O nome do repositório ("NBA") é só interno; o nome do produto será outro.

## 5. Mapa dos documentos

| Doc | Conteúdo |
|---|---|
| `00-visao-geral.md` | Este documento |
| `01-engenharia-reversa-2k27.md` | Análise de design do NBA 2K27 (e 2K26): sistemas, problemas, nossa resposta |
| `02-controles.md` | Layout de controle, teclado, acessibilidade |
| `03-arremessos.md` | Modelo de arremesso, timing, contestação, bandejas, enterradas, lance livre, física da bola |
| `04-animacoes.md` | Arquitetura de animação, responsividade, sincronização da bola, mocap, catálogo completo |
| `05-gameplay-ataque.md` | Movimento, dribles, combos, passe, post, corta-luz, jogadas |
| `06-gameplay-defesa.md` | Postura, compromisso, roubo, toco, rebote, defesa coletiva |
| `07-fisica-colisao.md` | Solver da bola, contato entre jogadores, árbitro |
| `08-ia.md` | IA em camadas, decisão por pontos esperados, dificuldade justa |
| `09-atributos-progressao.md` | Corpo, atributos, Estilos, progressão sem pay-to-win |
| `10-modos.md` | Streetball/3x3/Quadra e Carreira |
| `11-apresentacao.md` | Direção de arte, render, câmeras, áudio, UI |
| `12-arquitetura-tecnica.md` | Módulos UE5, loop de simulação, rede, ferramentas, CI |
| `13-roadmap.md` | Fases, critérios, orçamento, riscos |
| `14-perguntas-abertas.md` | Decisões pendentes |
| `15-brief-e-decisoes.md` | Brief do produto, papéis e registro de decisões |
| `16-pipeline-aberto-visual-e-mocap.md` | Ferramentas/assets abertos para o visual realista e a captura de movimento, armadilhas de licença |
| `../referencias/2k23/` | Clipes de gameplay do diretor no 2K23 + análise |
