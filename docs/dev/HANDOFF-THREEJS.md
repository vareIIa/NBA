# Handoff: migração do Projeto Garrafão para three.js

> Escrito em 2026-10-14 para a próxima sessão. Decisão **D15** do diretor: o jogo inteiro sai da Unreal e vai para **three.js**
> (web, TypeScript). Ler antes: `docs/dev/ESTADO-ATUAL.md`, que diz o que existe hoje, e `docs/15-brief-e-decisoes.md`, que
> registra as decisões D1–D15.

## 1. Contexto em 30 segundos

- **O jogo:** basquete original, liga fictícia, sim-arcade, com a sensação do **NBA 2K23** como referência (vídeos do diretor em `referencias/2k23/`).
- **O diretor decide; o Claude propõe com recomendação e executa.** O diretor joga com controle de Xbox, e os controles têm de ser idênticos aos do 2K23 (`docs/02-controles.md`).
- **Decisões que continuam valendo:**
  - D12: green maior que o do 2K.
  - D13: sem Explosões; a energia é o único limitador.
  - D14: só gratuito e open source.
  - Freestyle primeiro, depois 1x1, depois 3x3.
- **O que a Unreal entregou** (tudo descrito em `ESTADO-ATUAL.md`): drible com a bola presa à mão animada, green estilo 2K Park, sons sintetizados, 38 clipes de mocap.
  - Nunca foi compilada do nosso lado.
  - No último teste do diretor, o drible ainda estava longe de AAA.
- **Por que three.js:** dá para **rodar e testar aqui mesmo**. Chromium com Playwright já está instalado em `/opt/pw-browsers`, então a sessão consegue tirar prints e gravar vídeo do jogo antes de entregar. Menus e HUD ficam em HTML/CSS, e a iteração é rápida.

## 2. Ambiente verificado (2026-10-14)

- Node **22.22**, npm **10.9**. O registro npm funciona pelo proxy.
- Versões disponíveis: three **0.186.1**, vite **8.3.4**, vitest **5.0.4**, @playwright/test **1.64.1**.
- Playwright: os navegadores já estão em `/opt/pw-browsers`, com `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` definido. **Não** rodar `playwright install`. Se a versão não bater, lançar com `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'` (conferir o caminho com `ls`).
- **Não** há emscripten. Por isso o núcleo deve ser portado para TypeScript, e não compilado para WASM.
- Python com bpy 5.0.1, numpy, matplotlib e PIL: `/tmp/.../scratchpad/venv-bpy` (o scratchpad é por sessão). Se não existir, `pip install bpy` num venv novo.
- Os dados brutos da CMU não estão no repositório, por licença. Para baixar, seguir `Tools/Animacao/README.md`.

## 3. O que reaproveitar (e como)

| Hoje | No three.js |
|---|---|
| `Plugins/HoopsSim` (C++20 puro: física da bola/aro/tabela a 120 Hz, modelo de arremesso/green, solucionador, contestação, Pro Stick, dribles + energia, misdirection/arranque/pull-up; 33 testes) | **Portar para TypeScript** em `web/src/sim/`, arquivo por arquivo e com os mesmos nomes. **Portar os 33 testes para vitest**: devem passar antes de qualquer gameplay. Unidades SI, eixo Z para cima (no three.js, Y é para cima: converter numa camada só, `units.ts`) |
| Animações: `Tools/Animacao` (CMU → BVH → Blender), 38 clipes | Adicionar ao `montar_personagem_blender.py` a saída **GLB** (`bpy.ops.export_scene.gltf`, todas as ações) → `web/public/assets/hoops_dummy.glb`. Os quadros-chave (soltura, recepção, giro do spin…) estão em `Source/Garrafao/HoopsDummyRig.h` e no README da animação |
| `HoopsAnimInstance` (base com crossfade, ação, segurar quadro, camada de tronco, postura com IK das pernas) | `THREE.AnimationMixer` com ações e `crossFadeTo`. Camada de tronco: um segundo clipe filtrado só com as faixas dos ossos de spine_02 para baixo na hierarquia. Postura: pós-processar os ossos depois do `mixer.update` (abaixar o quadril e fazer IK de duas articulações à mão, ou com o `CCDIKSolver` dos addons) |
| `HoopsPlayerCharacter.cpp` (≈2000 linhas: input, movimento, orientação, drible com a bola na mão, arremesso/green, bandeja/enterrada, comemorações, HUD) | É a principal fonte da lógica: portar por partes. Em especial `LateUpdateHeldBall`/`BeginBallFlight`/`TrackHandStroke` (bola na mão, com o arco **no referencial do jogador**), `UpdateBodyAnimation`, `UpdateMovement` (orientação com histerese), `StartDribbleMove`, `BeginShot`/`UpdateShot`/`ReleaseShot`, `OnShotReleased`/`Celebrate`/D-pad |
| HUD em Canvas (`HoopsHUD.cpp`) | HTML/CSS por cima do canvas: medidor do 2K23, banner de timing/cobertura, energia, laboratório e status |
| Sons (`HoopsAudioSynth.cpp`, C++ puro) | Portar para TS e tocar com a **WebAudio API** (`AudioBuffer`); a síntese é a mesma |
| Quadra/cesta/luz (`HoopsCourt`, `HoopsHoop`, `setup_quadra_realista.py`) | Geometria three.js; madeira com textura CC0 do Poly Haven; luzes de ginásio |
| Controles (`EnsureInputConfig`, mapa 2K23) | **Gamepad API** (layout padrão do Xbox) + teclado; Pro Stick = analógico direito |
| `Tools/Captura` (celulares → BVH) | Continua igual: o BVH entra no pipeline e sai em GLB |

**Arquivar a Unreal** (não apagar tudo): mover `Source/`, `Config/`, `Content/`, `Garrafao.uproject` e `Tools/Editor/` para `legacy-unreal/`, ou apagar depois de portar. Combinar com o diretor; a recomendação é mover para `legacy-unreal/` num commit separado.

## 4. Plano de execução (ordem recomendada)

1. **Esqueleto** em `web/`: Vite + TypeScript + three, vitest e Playwright.
   - Scripts: `npm run dev`, `npm test`, `npm run e2e` (abre o jogo headless, tira screenshot e grava um vídeo curto).
   - Cena vazia com quadra, cesta e câmera do 2K (atrás do jogador, olhando para a cesta).
2. **Núcleo em TS** com os 33 testes passando (`npm test`).
3. **GLB do boneco** com os 38 clipes, carregado no jogo.
   - Conferir: a frente do boneco é medida pelos pés, e a escala deixa o jogador com 1,96 m.
   - Selecionar a base pela velocidade, como em `UpdateBodyAnimation`.
4. **Bola na mão + drible:** empurrão detectado pela mão animada, arco no referencial do jogador, troca de mão com o atraso do clipe (`SwitchNotBefore`).
5. **Arremesso + green:**
   - medidor do 2K23;
   - a mão chega ao topo no ideal e espera até o X ser solto;
   - follow-through, comemorações e sons.
6. **Menu inicial** (Freestyle; 1x1 e 3x3 bloqueados), pausa e opções: tamanho do green, volume, energia infinita.
7. **Teste visual automático** a cada passo: script Playwright que joga sozinho (input simulado), grava `web/test-results/*.webm` e tira prints. Mandar os prints ou o vídeo ao diretor junto com cada entrega.
8. **Publicar para o diretor testar:** `npm run build` gera `web/dist`. Ele roda `npm run dev` e abre `localhost`. Se der, também um Artifact/página com o build.

## 5. Regras de trabalho (mantidas)

- Commits em português, só na branch `claude/hopeful-einstein-eargc1`. Sem PR a menos que o diretor peça.
- Rodapé dos commits:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: <link da sessão>
  ```
- Nunca commitar ASF/AMC/BVH da CMU. GLB/FBX/vídeos vão pelo Git LFS: adicionar `*.glb` ao `.gitattributes`.
- Sem marcas ou nomes da NBA/2K no jogo. Só assets gratuitos e open source (D14).
- **Testar antes de entregar:** `npm test` verde e prints/vídeo do Playwright conferidos.
