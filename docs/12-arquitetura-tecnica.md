# 12 — Arquitetura Técnica (Unreal Engine 5)

## 1. Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Engine | **Unreal Engine 5** (versão estável mais recente no início da produção; travar versão por marco) | Motion Matching, Control Rig, MetaHuman, Lumen, rede pronta |
| Linguagem | **C++ para sistemas** (bola, contato, arremesso, rede, IA) + **Blueprint para conteúdo/tuning** | Performance e determinismo onde importa; iteração rápida no resto |
| Dados | `DataAsset`/`DataTable`/`CurveFloat` para atributos, curvas de arremesso, estilos, jogadores | Tuning sem recompilar |
| Ações | **Gameplay Ability System (GAS)** para ações do jogador (arremesso, drible, passe, roubo, toco) | Tags, cooldowns, custos de energia, predição em rede já resolvidos |
| IA | **StateTree** (execução) + utility scoring próprio (decisão) | Ferramenta moderna do UE5, depurável |
| Input | **Enhanced Input** + buffer próprio | Remapeamento, contexts (ataque/defesa/menu) |
| UI | UMG + CommonUI | Controle/teclado |
| Online | Servidor autoritativo + predição do cliente; **EOS** (Epic Online Services) para contas, lobbies e matchmaking | Gratuito, multiplataforma |
| Versionamento | Git + **Git LFS** (ou Perforce se o time crescer) | Assets binários grandes |

## 2. Módulos (plugins de jogo)

```
Source/
  HoopsCore/          // regras, placar, relógios, estados de partida, árbitro
  HoopsBall/          // solver determinístico da bola, colisores analíticos, estados Held/Dribbling/Free
  HoopsPlayer/        // personagem, movement component de basquete, energia, compromisso defensivo
  HoopsActions/       // GAS: GA_Shoot, GA_Dribble*, GA_Pass, GA_Steal, GA_Block, GA_PostUp, GA_Screen...
  HoopsShooting/      // modelo de probabilidade, janelas, contestação, feedback, telemetria
  HoopsContact/       // resolvedor de contato e faltas
  HoopsAnimation/     // AnimInstance base, notifies, ball sync, choosers, warping helpers
  HoopsAI/            // estrategista, tático (influence maps), agentes (utility + StateTree), controle virtual
  HoopsNet/           // replicação, compensação de lag, validação de timing
  HoopsCareer/        // progressão, estilos, nota de partida, save
  HoopsPresentation/  // câmeras, replays, destaques, áudio dinâmico, MC
  HoopsUI/            // HUD, menus, criação de personagem
  HoopsDebug/         // overlays, galeria de animações, simulação headless
```

> `Hoops` é prefixo provisório até definirmos o nome do jogo.

## 3. Loop de simulação

- **Tick fixo de gameplay a 60 Hz** (bola a 120 Hz com 2 sub-steps), separado do render.
- Ordem por tick:
  1. Input (jogador/IA → controle virtual) + buffer
  2. Decisão de ações (GAS ativa habilidades)
  3. Movimento (movement component) e predição de contato
  4. Resolvedor de contato
  5. Bola (solver)
  6. Regras/árbitro (faltas, violações, placar)
  7. Eventos para animação/apresentação/áudio
- Animação lê o estado de gameplay e **nunca o altera** (exceto root motion de ações autorizadas por GAS).

## 4. Rede

| Modo | Topologia | Fase |
|---|---|---|
| Local (sofá) | — | P1 |
| Online 1x1 / 3x3 | Servidor dedicado (ou host com relay EOS no início para reduzir custo) | P3 |
| Park/hub | Servidores dedicados | P4 |

- **Predição do cliente** para movimento e ações (GAS prediction keys).
- **Arremesso**: timing julgado no cliente e validado no servidor (`03-arremessos.md §9`).
- **Rewind de lag** (até ~150 ms) para contestação, roubo e toco.
- Bola: o servidor simula; clientes simulam em paralelo (determinismo) e corrigem suavemente.
- Rollback completo (estilo jogo de luta) para 1x1 é **pesquisa futura** — interessante para competitivo, mas caro com animação + física.

## 5. Ferramentas internas (desde o dia 1)

| Ferramenta | Para quê |
|---|---|
| Overlay de debug (`F3`) | Janelas de arremesso, contestação, L/P, compromisso, exposição da bola, EP da IA |
| Galeria de animações | Ver tudo em loop com bola |
| Simulação headless | Milhares de partidas IA×IA para validar estatísticas |
| Teste de 10.000 arremessos | Valida curvas de % (CI) |
| Medidor de responsividade | Frames entre input e mudança de pose (CI ≤ 6) |
| Medidor de foot sliding | Qualidade de animação |
| Telemetria de playtest | Log de todos os arremessos/contatos/decisões → planilha/dashboard |
| Editor de jogadores | Criar jogadores fictícios, atributos, aparência |

## 6. Testes e CI

- Testes de unidade (Automation Framework) para o solver da bola, modelo de arremesso e resolvedor de contato.
- Testes funcionais (Functional Testing / Gauntlet) para cenários: "arremesso perfeito livre sempre entra", "toco no ápice da subida é válido", "goaltending marcado".
- Build noturna + empacotamento automático (Win64) para playtesters.

## 7. Requisitos de máquina de desenvolvimento (referência)

- CPU 8+ núcleos, 64 GB RAM, GPU RTX 3070+/equivalente, SSD NVMe 2 TB (UE5 + projeto + mocap ocupam muito).
