# Projeto Garrafão (codinome)

Jogo de basquete **sim-arcade** em **Unreal Engine 5**: bonito como os grandes, responsivo, justo e sem pay-to-win. Começa nas quadras de rua (1x1, 21, 3x3) e evolui para uma Carreira até o profissional.

> Liga, times e jogadores são **fictícios**. "NBA" é apenas o nome interno deste repositório.

## Documentação de design

| | Documento |
|---|---|
| 🎯 | [Visão geral, pilares e questões legais](docs/00-visao-geral.md) |
| 🔍 | [Engenharia reversa (análise de design) do NBA 2K27](docs/01-engenharia-reversa-2k27.md) |
| 🎮 | [Controles](docs/02-controles.md) |
| 🏀 | [Sistema de arremessos](docs/03-arremessos.md) |
| 🕺 | [Plano de animações](docs/04-animacoes.md) |
| ⚡ | [Gameplay de ataque](docs/05-gameplay-ataque.md) |
| 🛡️ | [Gameplay de defesa](docs/06-gameplay-defesa.md) |
| 🧲 | [Física, colisão e contato](docs/07-fisica-colisao.md) |
| 🧠 | [Inteligência artificial](docs/08-ia.md) |
| 📈 | [Atributos, estilos e progressão](docs/09-atributos-progressao.md) |
| 🏙️ | [Modos: Freestyle, 1x1, 3x3, Streetball e Carreira](docs/10-modos.md) |
| 🎨 | [Apresentação: visual, câmera, áudio](docs/11-apresentacao.md) |
| 🛠️ | [Arquitetura técnica (UE5)](docs/12-arquitetura-tecnica.md) |
| 🗺️ | [Roadmap, orçamento e riscos](docs/13-roadmap.md) |
| ❓ | [Perguntas em aberto](docs/14-perguntas-abertas.md) |
| ✅ | [Brief do produto e registro de decisões](docs/15-brief-e-decisoes.md) |
| 🎥 | [Pipeline aberto: visual realista e mocap](docs/16-pipeline-aberto-visual-e-mocap.md) |
| 🎬 | [Referências: clipes do diretor no 2K23 + análise](referencias/2k23/README.md) |

## Rodar o jogo

👉 **[Como rodar o Freestyle no seu PC (UE 5.8)](docs/dev/COMO-RODAR.md)** · 🎥 **[Pauta da 1ª sessão de captura](docs/dev/SESSAO-CAPTURA-01.md)**

| Pasta | O que é |
|---|---|
| `Plugins/HoopsSim/Source/HoopsSimCore` | Núcleo de simulação em C++ puro (bola, aro, arremesso/green, drible, Pro Stick) |
| `Plugins/HoopsSim/Tests` | Testes do núcleo (24 passando) |
| `Source/Garrafao` | Camada Unreal: jogador, bola, cesta, quadra, HUD, modo Freestyle |

## Status

**Fase 0 — Freestyle em desenvolvimento.** Primeiro jogável: quadra graybox com medidas oficiais, bola com física própria, arremesso com green (timing travado no gather), dribles do 2K23 pelo Pro Stick, bandeja/enterrada, rebotedor, HUD com medidor e laboratório.

> Os vídeos de referência usam **Git LFS**: rode `git lfs pull` depois de clonar.
