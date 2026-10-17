## 6. O que não deu para medir (e por quê)

- **Golpes que não existem no jogo** (Fase 4): rocker/momentum (C2), escape entre as pernas com passo cruzado e arranque
  (C1), hesi-cross de duas batidas (C3), double cross lento → rápido (C4), sai e volta (C5), double BTB como golpe próprio
  (C6), breakdown + step-back do SGA (C7), hold/pausa com a bola segurada e push ao ombro. As métricas que só existem
  nesses golpes (ápice do rocker, giro do tronco no rocker, duração do hold, punho a 0,9 S) aparecem como "não existe".
  Onde há um equivalente medimos o equivalente: double BTB = dois BTB em sequência (`btb_btb`); hesi-cross e double cross
  = os nossos (switchback e double throw do Pro Stick); a pausa = a hesitação.
- **Latência real do 2K.** O overlay de setas dos tutoriais foi montado na edição e não é relógio de input (doc 27 §0 e
  §9). O alvo de 0–3 q é a leitura visual "o corpo inverte no próprio flick". A nossa latência é exata (contrafactual no
  laboratório determinístico), mas o número do 2K tem confiança média.
- **Comandos com RT parados.** A camada turbo (D1) não existe: com RT os toques parados viram escapes genéricos. Os golpes
  parados foram medidos sem RT (os size-ups que existem); os correndo, com RT, como no 2K.
- **Velocidades correndo do 2K** vêm de um proxy (deslocamento do fundo da quadra, E-D), não de medida direta; o arranque e
  a parada têm confiança média.
- **Quiques do 2K pelo CSV.** O detector de quique do `derivar.py` com os padrões (limite de 0,15 S acima dos
  tornozelos) perde a maior parte dos quiques numa câmera alta, porque a bola à frente dos pés aparece acima deles na
  imagem (seção 5). No 2K o problema maior era o detector de bola, que travava longe do jogador e no joelho. A re-medição
  com `medir.py --bola-perto` e `derivar.py --limite-quique 0.35 --raio-min 0.8` está em
  `docs/dev/drible-2k/quiques-2k.md`: confirma os alvos de crossover (10 q), correndo (15 q) e drible parado, e corrigiu o
  BTB duplo de ~7 q para 15 q.
- **A calibração usa a nossa câmera e o nosso boneco**, parecidos com os do 2K (atrás e acima, retrato, S ≈ 270–300 px),
  mas não iguais: proporções, roupa e lente diferem. A margem do pipeline é a ordem de grandeza do erro dos números do 2K,
  não uma correção exata. O viés medido só é mostrado (coluna Nota), não descontado do alvo.
- **Pernas e pés no vídeo** (joelhos, calcanhares, passada correndo) não entram na régua: o MediaPipe de costas é instável
  neles (E-D) e não há alvo do 2K confiável.
- **Lateralidade (mão direita × esquerda)** de parte dos trechos do 2K continua incerta (doc 27 §9). A régua compara a
  inclinação "para o lado da bola", sem depender da mão.
- **Spin, half spin, in-and-out e retreat** ficaram fora: não há número do 2K para eles nos vídeos.

## 7. Como reproduzir

```bash
cd web
python -I tools/feel/preparar.py
node tools/feel/regua.mjs
```

O `regua.mjs` sobe um Vite próprio sem HMR na porta 5191 (nunca a 5173 do diretor), roda os cenários de
`tools/cenarios-feel.mjs` no laboratório em passo fixo, grava os vídeos de calibração, roda o MediaPipe e escreve este
arquivo. Os dados por quadro e os vídeos do nosso jogo ficam em `Saved/feel/<data>/` (fora do git). Detalhes em
`web/tools/feel/README.md`.
