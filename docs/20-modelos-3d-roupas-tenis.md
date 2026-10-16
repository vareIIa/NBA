# 20 — Modelos 3D: tênis, uniforme e partes do jogador (HY 3D Studio)

Gerados no Tencent HY 3D Studio (Hunyuan3D v3.1) pela skill `hy3d-studio`, em 15/10/2026, com 3 contas em paralelo
(30 créditos no total). **Uso interno, sem fins comerciais.** Os tênis seguem silhuetas de Jordans conhecidos e, mesmo
com `no logos` no prompt, a textura do HY **pintou swoosh e Jumpman** em vários deles (e um swoosh grande na bermuda
branca). Para vender o jogo, todos os tênis e essas texturas precisam ser trocados por desenhos próprios.

![vitrine](img/vitrine-hy3d.png)

## O que está no jogo

| Arquivo (`web/public/assets/gear/`) | Base | Triângulos |
|---|---|---|
| `tenis_retro_alto_1.glb` | AJ1 High "Chicago" | 5k por pé |
| `tenis_verniz_11.glb` | AJ11 (saiu mais genérico: preto e azul-gelo) | 5k por pé |
| `tenis_cimento_4.glb` | AJ4 "Cement" | 5k por pé |
| `tenis_elefante_3.glb` | AJ3/AJ4 preto, vermelho e cimento | 5k por pé |
| `tenis_baixo_moderno.glb` | low-top atual, marinho e verde-neon | 5k por pé |
| `regata_vermelha.glb`, `bermuda_vermelha.glb` | kit da casa | 9k cada |
| `regata_branca.glb`, `bermuda_branca.glb` | kit visitante | 9k cada |

URL: padrão = kit vermelho + AJ1. `?uniforme=branco`, `?tenis=tenis_cimento_4` (nome do arquivo), `?roupa=0` (boneco liso).

Gerados, ainda **não usados** (em `models_raw/`): `jogador_armador` e `jogador_pivo` (corpo inteiro em A-pose, com rig do
HY em `*_rig.fbx`), `cabeca_jogador` (busto realista) e `mao_aberta`. Para trocar o boneco por eles é preciso retargetar os
clipes para o esqueleto do HY (ou transferir os pesos do `hoops_player` para a malha nova no Blender).

## Pipeline

1. **HY 3D** (`web/tools/hy3d-fila.js`, colado numa aba `hy3d.tencent.ai/robots.txt` logada): `text2geometry` 50k faces →
   `text2texture_v31` (PBR) [→ `bone_skinning` nos corpos]. A retopologia do site foi pulada: vivia em "servidor lotado"
   e o Blender reduz os polígonos. Uma conta roda até 5 tarefas; com 3 contas, as 13 peças saíram em ~25 min.
2. Baixar o GLB texturizado (22–45 MB, textura 4K) para `web/public/assets/models_raw/` (fora do git).
3. **Blender** (`Tools/Animacao/vestir.py`):
   ```bash
   blender -b -P Tools/Animacao/vestir.py -- web/public/assets/hoops_player.glb web/public/assets/models_raw/<peca>.glb <regata|bermuda|tenis> web/public/assets/gear/<peca>.glb
   ```
   - solda as costuras de UV e tira pedaços soltos pequenos (cordão, etiqueta);
   - encaixa a caixa da peça no corpo: regata do alto do ombro ao quadril, bermuda da cintura ao joelho (com as coxas
     endireitadas, como a peça gerada), tênis orientado pelo cano mais alto (calcanhar) e pelo comprimento do pé;
   - transfere os pesos de pele do corpo (vértice mais próximo) e cria os ossos de pano `pano_*`; o tênis usa `foot`/`ball`
     (a ponta dobra com o pé) e sai em par, com o esquerdo espelhado;
   - reduz para 9k (roupa) / 5k (tênis), sombreamento suave, textura 1024 px em WebP: 0,5–1 MB por GLB.
4. Conferência: `Tools/Animacao/ver_vestido.py` (corpo + peças, frente/lado/pé) e `Tools/Animacao/vitrine.py`.

## No jogo (`web/src/game/PlayerGear.ts`)

- A malha da peça é religada aos ossos do `PlayerAnimator` pelo nome. As matrizes de bind vêm do próprio GLB da peça
  (o importador do Blender usa `bone_heuristic='BLENDER'`, que preserva os eixos dos ossos do glTF).
- **Física do pano**: cada `pano_*` é um pêndulo verlet a 60 Hz (inércia, gravidade, mola de volta ao repouso, ângulo
  máximo). Regata solta (mola 55, até 55°), bermuda presa à coxa (pano com até 40% do peso, mola 140, até 28°). As pontas
  colidem com cápsulas das coxas, das canelas e do tronco, e a barra não entra na outra perna.
- **O corpo nunca atravessa a roupa** (`BodyCover.ts`): ao vestir, cada vértice do corpo lança um raio para fora; se bater
  numa peça a menos de 12 cm, o vértice está coberto, e os triângulos com 2+ vértices cobertos saem do índice (~1.600 dos
  ~7.000). Sem pele por baixo, nenhuma pose empurra o corpo através do tecido. A roupa é dupla face (pela cava aparece o
  avesso) e o tênis do boneco some sob o calçado novo.
- O PBR do HY deixa o tecido com cara de plástico molhado: os mapas de rugosidade e de metal são descartados no pano.

## Pendências
- Trocar o boneco pelo corpo/cabeça gerados (retarget ou transferência de pesos).
- Barra da bermuda branca um pouco serrilhada na redução: subir o limite de triângulos dessa peça (`vestir.py ... 14000`).
- Texturas próprias, sem marca, antes de qualquer distribuição.
