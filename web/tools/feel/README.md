# Régua do feel (nós × NBA 2K27)

Fase 1 do `docs/27-dribles-2k.md` (§5): mede o NOSSO drible com as mesmas métricas extraídas dos tutoriais do NBA 2K27
(§2 do doc 27) e escreve a tabela "nós × 2K" com aprovado/reprovado por tolerância, mais as 10 maiores diferenças
ordenadas pelo impacto no feel. **Só mede: nada aqui muda o jogo.** Toda fase seguinte (resposta imediata, corpo, camada
turbo, golpes novos) é validada rodando a régua antes e depois.

## Comando único

```bash
cd web
python -I tools/feel/preparar.py        # uma vez: baixa o modelo de pose e confere as bibliotecas
node tools/feel/regua.mjs                # ~6 min: motor + vídeo + MediaPipe + calibração + comparação
```

No fim ele diz onde ficou o relatório (padrão: `docs/dev/drible-2k/linha-de-base.md`) e a pasta da rodada
(`Saved/feel/<data>/`, fora do git).

| Opção | O que faz |
|---|---|
| `--sem-video` | Pula a gravação e o MediaPipe (a margem do pipeline vem da última rodada com vídeo em `Saved/feel/`). ~2 min. |
| `--so-comparar <pasta>` | Refaz só golpes.py + comparar.py sobre uma rodada já medida (para mexer na referência ou no relatório). |
| `--saida <pasta>` | Pasta da rodada (padrão `Saved/feel/<data>`). |
| `--relatorio <arquivo.md>` | Onde escrever a linha de base (padrão `docs/dev/drible-2k/linha-de-base.md`). |
| `--dados <pasta>` / `--dados nao` | Cópia dos JSON pequenos da rodada (só números nossos) ao lado do relatório (padrão `docs/dev/drible-2k/dados/`). |
| `--porta 5191` | Porta do Vite próprio. **Nunca 5173** (é do diretor; o script recusa). |
| `LAB_ORIGIN=http://127.0.0.1:NNNN` | Usa um Vite que já está no ar em vez de subir um. |
| `FEEL_PYTHON=<python>` | Python com o MediaPipe (padrão: `tools/feel/.venv`, senão `python`). |

## Preparo (uma vez)

1. Node: as dependências de `web/` (`npm install`) e o Chromium headless do Playwright que já existe na máquina (o mesmo do
   `tools/laboratorio.mjs`; nada é baixado).
2. Python 3.12 num venv próprio (ignorado pelo git):

   ```bash
   python -m venv tools/feel/.venv
   tools/feel/.venv/Scripts/python -m pip install -r tools/feel/requirements.txt
   ```

   (Linux/mac: `tools/feel/.venv/bin/python`.) `faster-whisper` é opcional (só o `transcrever.py`).
3. Modelo de pose: `python -I tools/feel/preparar.py` baixa o `pose_landmarker_heavy.task` (MediaPipe, Google, ~30 MB)
   para `tools/feel/modelos/` (ignorado pelo git: **não versionar o binário**).

Os vídeos do 2K ficam **fora do repositório**, só na máquina do diretor (caminhos no doc 27 §0). **Nunca versionar vídeo,
quadros, folhas ou áudio do 2K.** Python que lê vídeo ou arquivo baixado roda sempre com `python -I`.

## O que cada peça faz

| Arquivo | Papel | Uso |
|---|---|---|
| `regua.mjs` | Orquestra tudo e escreve a linha de base. | `node tools/feel/regua.mjs [...]` |
| `vite-proprio.mjs` | Vite sem HMR e sem vigiar arquivos, com cache próprio (`Saved/feel/.vite-cache`). Várias sessões salvam arquivos em `web/` ao mesmo tempo; com HMR a página recarregava no meio do cenário. | `node tools/feel/vite-proprio.mjs [porta]` |
| `../cenarios-feel.mjs` | Cenários: controles (drible parado, correndo), golpes (um comando em três fases do quique) e sequências (ritmo, encadeamento, arranque). | importado pelo motor |
| `motor.mjs` | **Verdade do motor**: roda os cenários no laboratório (`?lab=1`, passo fixo de 1/60 s) e exporta por quadro o esqueleto e a bola em metros, os eventos do drible e os ossos vigiados. Com `--video` grava os mesmos cenários a 30 fps com a câmera parecida com a do 2K, com os landmarks projetados ("detector perfeito"). | `LAB_ORIGIN=... node tools/feel/motor.mjs <saida> [--cenarios a,b] [--video]` |
| `golpes.py` | Métricas por golpe e por cenário nas unidades da régua (S, q, graus). | `python -I golpes.py <saida>/motor <nos.json>` |
| `medir.py` | Pose (MediaPipe heavy) + bola (cor HSV + raio inscrito) quadro a quadro num vídeo. Os padrões da bola são os do 2K; o `regua.mjs` passa os da nossa bola. | `python -I medir.py <video> <medidas.csv> --modelo modelos/pose_landmarker_heavy.task [--bola-h ...]` |
| `derivar.py` | Métricas normalizadas por S do quadro e quiques. Reproduz byte a byte os CSVs do 2K em `docs/dev/drible-2k/dados/`. | `python -I derivar.py <medidas.csv> <metricas.csv> [--limite-quique 0.15]` |
| `calibrar.py` | Erro do pipeline de vídeo contra a verdade do motor (geometria, detector, total; métricas derivadas; quiques). | `python -I calibrar.py <saida>/video <calibracao.json>` |
| `comparar.py` | Nós × 2K por métrica e por golpe, status, margem, top 10 com hipótese de causa. | `python -I comparar.py referencia-2k.json nos.json saida.md [--calibracao ...]` |
| `referencia-2k.json` | Alvos e tolerâncias do §2 do doc 27, cada um com `fonte` (E-A…E-F), `confianca` (A/M/B), `peso` no feel, como medir e a hipótese de causa. | editável à mão |
| `linha-de-base-anexo.md` | Texto fixo do fim do relatório (o que não deu para medir, como reproduzir). | — |
| `folhas.py` | Folhas de contato (30 quadros por folha) com esqueleto e bola. | `python -I folhas.py <video> <medidas.csv> <pasta>` |
| `transcrever.py` | Narração dos tutoriais (faster-whisper, opcional). | `python -I transcrever.py <audio.wav>...` |
| `preparar.py` | Baixa o modelo e confere as bibliotecas. | `python -I tools/feel/preparar.py` |
| `teste_feel.py` | Testes: quadro sintético -> números esperados (derivação, quiques, latência, status). | `python -I -m unittest discover -s tools/feel -p "teste_*.py"` |

## Unidades e definições

- **S** = tamanho do corpo. No 2K é a distância ombro médio -> tornozelo médio na imagem, em cada quadro; 1 S ≈ 1,45 m num
  jogador de 1,86 m (doc 27 §0). No motor: metros / 1,45 (escala com a altura do nosso jogador, hoje 1,86 m).
- **q** = quadro de 30 fps (33 ms), como os números do 2K. O laboratório roda a 60 Hz: 1 quadro = 0,5 q = 17 ms.
- **Referencial do motor**: `lado` = para a direita do jogador (+), `alt` = acima do chão, `frente` = para onde ele olha.
  Com a câmera atrás, `lado` + = direita da tela, a mesma convenção do `derivar.py`.
- **Quadril** = meio dos quadris (cabeças do fêmur, `thigh_l/r`) acima do meio dos tornozelos (`foot_l/r`).
  **Base** = distância lateral entre os tornozelos. **Inclinação do tronco** = ângulo do ombro médio em relação ao quadril
  médio no plano lado-altura. **Giro** = rotação da linha dos ombros. **Cabeça** = altura da cabeça acima do ombro médio.
- **Latência do corpo**: do quadro em que o stick chega à zona ativa do Pro Stick (0,7) ao primeiro quadro em que um osso do
  tronco (`spine_02`, `spine_03`, `neck_01`, `head`) ou da mão (`hand_l/r`) sai > 1 cm ou > 2° do mesmo cenário **sem** o
  comando. O laboratório é determinístico (diferença 0 entre recargas), então o controle é o contrafactual exato. Cada golpe
  é disparado com a bola na mão, descendo e subindo (fases escolhidas no controle); vale a pior fase.
- **Latência da bola**: até a bola sair 3 cm para o lado novo em relação ao controle (só golpes que cruzam).
- **Travessia**: do 15% ao 85% do caminho lateral da bola entre os dois extremos ("de um quadril ao outro").
- **Antecipação**: da primeira reação do corpo à soltura da bola no golpe (o empurrão).
- **Pose neutra**: quadros, entre dois golpes encadeados, em que o animador não tem ação de drible (volta ao loop base).
- As demais estão nas docstrings de `golpes.py` e nos nomes da `referencia-2k.json`.

## Câmera do vídeo de calibração

Retrato 822×1506 (como os tutoriais), FOV 40°, 8,5 m atrás e 3,1 m acima do jogador, olhando quase na horizontal para a
cesta: o jogador fica no terço de baixo com S ≈ 270–300 px (no 2K, ~295 px), como na evidência E-A/E-C/E-D. Ajuste em
`CameraVideo` (`motor.mjs`).

## Status e margem

`aprovado` se o valor fica na faixa do 2K ± tolerância; `limítrofe` se reprova por menos que a margem do pipeline (o número
do 2K pode estar errado nessa medida); `reprovado` no resto. A margem vem da calibração: métricas de tempo, 1 q (amostragem a
30 fps e a fonte do 2K a ~27,5 fps); quiques, o erro de tempo dos quiques achados no vídeo; níveis e amplitudes, o RMS do
erro total (vídeo − verdade) da métrica derivada correspondente. O viés do pipeline aparece na coluna Nota quando
descontá-lo mudaria o veredito.

## Acrescentar uma métrica

1. Calcule o campo em `golpes.py` (`analisar_golpe`, `analisar_controle` ou `analisar_sequencia`).
2. Acrescente a entrada em `referencia-2k.json` (alvo, tolerância, fonte, confiança, peso, `medida.campo`, golpes, hipótese).
3. Se o número do 2K saiu do vídeo, ligue a `calibracao` à métrica derivada certa (`calibrar.py`).
4. `node tools/feel/regua.mjs --so-comparar <pasta da última rodada>` refaz a tabela sem medir de novo.

## Regras do projeto que a régua segue

- Só arquivos novos (`web/tools/feel/*`, `web/tools/cenarios-feel.mjs`); o estado do jogo é lido por `window.__debug` e
  `window.__lab` (e `HoopsDribbleMoves.ts` importado só para ler as Specs).
- Vite próprio sem HMR noutra porta; o painel de navegador do app roda o jogo a ~1 fps, a verificação é o laboratório
  headless.
- O Playwright apaga `test-results/`: as medições ficam em `Saved/feel/`.
- O REA não é usado no binário do 2K (licença); a régua aplica o método de evidência dele.
