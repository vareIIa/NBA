# Sessão de captura 01: locomoção com bola e arremessos (Fase 0)

> Objetivo: gravar o material que mais pesa na **sensação do Freestyle**: andar/correr driblando, mudanças de direção, dribles básicos e arremessos (spot-up, pull-up, step-back).
> Pipeline: câmeras comuns + **Pose2Sim + RTMPose** (open-source, uso comercial liberado). Detalhes em `docs/16-pipeline-aberto-visual-e-mocap.md`.
> Duração: ~3 horas de quadra (1 h de montagem/calibração + 2 h de gravação).
>
> **Guia prático, passo a passo: [`Tools/Captura/README.md`](../../Tools/Captura/README.md)** (instalação no Windows,
> 2–4 celulares, configuração do app, calibração com tabuleiro A3 + pontos da quadra, "pulo de sincronia",
> roupa, metrônomo, nomes dos takes e o comando que transforma cada take em BVH do jogo). Onde este plano e o guia
> divergirem, **vale o guia** (ele foi testado de ponta a ponta com o demo do Pose2Sim).

## 1. Pessoas

| Quem | Função |
|---|---|
| **Atleta A** (armador, ~1,80–1,90 m, bom drible) | Drible, pull-ups, step-backs |
| **Atleta B** (ala, ~1,95–2,05 m, bom arremesso) | Spot-ups, arremessos em movimento |
| Operador | Liga/desliga câmeras, fala o "slate" (nome do take), anota |
| Ajudante (opcional) | Rebote, passes, organização |

Todos assinam o **termo de cessão de imagem e movimento** (uso comercial, em jogo e divulgação, com opção de anonimato) antes de gravar.

## 2. Equipamento

| Item | Quantidade | Observação |
|---|---|---|
| Câmeras (celulares ou GoPros) | 6 (mínimo 4) | **120 fps**, 1080p ou 2.7K; lente linear; **estabilização desligada** |
| Tripés / suportes de 2–3 m | 6 | Câmeras no alto, inclinadas para o volume |
| Power banks + cartões | 6 | Cada take gera muito vídeo a 120 fps |
| Tabuleiro de calibração A3 ou A2, rígido | 1 | `python Tools/Captura/gerar_tabuleiro.py tabuleiro_A3.pdf`, imprimir a 100% e colar em placa de espuma/MDF |
| Trena | 1 | Medir cruzamentos das linhas da quadra |
| Luz | — | De dia ao ar livre, ou ginásio bem iluminado **sem flicker** (testar gravando a 120 fps) |
| Bolas | 2 | Bola tamanho 7, cor contrastante com o piso |
| Fita adesiva colorida | 1 | Marcar spots no chão |

Celular: use um app com **obturador manual** (ex.: Blackmagic Camera) em **1/960–1/1000 s**, ISO e balanço de branco travados.

## 3. Montagem (volume de 8 × 8 m)

```
            CESTA
   C1 ┐                 ┌ C2
      │   [ garrafão ]  │
      │                 │
 C6 ──┤   volume 8x8m   ├── C3
      │                 │
   C5 ┘                 └ C4
         (topo do arco)
```

- Câmeras em volta da área entre o garrafão e o topo do arco, a 2–3 m de altura, inclinadas para o centro.
- O atleta deve ocupar **pelo menos 1/3 da altura do quadro** em todas as câmeras.
- Nenhuma câmera de cima (vista de topo).

## 4. Calibração

Detalhes e comandos no guia (`Tools/Captura/README.md` §4).

1. **Intrínseca** (cada câmera, 1 vez por celular): vídeo de ~40 s do tabuleiro A3 (`gerar_tabuleiro.py`) colado em placa rígida, passando por todo o quadro. (ChArUco/caliscope é a alternativa.)
2. **Extrínseca** (a cada sessão, tripés já travados): 5 s da quadra vazia em cada câmera **e** conferir com trena os 12 pontos da quadra do `Config_garrafao.toml` (garrafão, lance livre, linha de 3, tabela); depois clicar neles uma vez no PC.
3. **Sincronismo**: no começo de cada take, o atleta dá o **pulo de sincronia** (aterrissa batendo forte no chão); o `rodar_pose2sim.py` acha esse som em cada vídeo e alinha as câmeras. Palma/flash ficam como reserva visual. Com GoPro: QR de tempo do GoPro Labs no início da sessão.

## 5. Lista de takes

Cada take começa com o operador falando: **"Sessão 01, take NN, [nome], [lado]"** + o pulo de sincronia do atleta. Dribles com **metrônomo** (120 bpm = 2 quiques/s; repetir a 140–150 bpm).
Gravar cada movimento com a **mão direita e a esquerda** (ou espelhamos depois) e em **3 velocidades** quando indicado.

### Bloco A — Locomoção com bola ("dance cards" para Motion Matching), atleta A

| Take | Conteúdo | Duração |
|---|---|---|
| A01 | Drible parado: alto, baixo, troca de mão no lugar (size-ups livres) | 60 s |
| A02 | Andar driblando em todas as direções (frente, trás, lados, diagonais), parar e recomeçar | 90 s |
| A03 | Correr driblando: largadas, paradas bruscas, cortes de 45°, 90°, 135°, 180° | 90 s |
| A04 | **Retreat dribble** e drible lateral pelo arco, de ala a ala (o estilo do diretor) | 90 s |
| A05 | Livre: o atleta joga sozinho "contra um defensor imaginário" | 120 s |

### Bloco B — Dribles do 2K23 (atleta A), cada um 5× parado e 5× em movimento

| Take | Movimento |
|---|---|
| B01 | Crossover (baixo, rápido, "killer") |
| B02 | Entre as pernas (frente e recuando) |
| B03 | Por trás das costas |
| B04 | Hesitação e in-and-out |
| B05 | Step-back (com e sem drible antes) |
| B06 | Spin e half-spin (parado e correndo) |
| B07 | Combos: crossover → entre as pernas, hesi → crossover (double cross), spin → hesitação |

### Bloco C — Arremessos (atletas A e B), cada um 8–10×

| Take | Arremesso | Observação |
|---|---|---|
| C01 | Spot-up de 3 (canto, ala, topo) | Pés posicionados; marcar spots com fita |
| C02 | Catch & shoot recebendo passe (esquerda, direita) | Ajudante passa a bola |
| C03 | **Dribble pull-up de meia distância** saindo de drible lateral | O padrão do diretor |
| C04 | **Pull-up de 3 em movimento** (drible lateral → subida) | Padrão dos clipes 2K23 |
| C05 | Step-back jumper | |
| C06 | Fadeaway (cotovelo/linha de fundo) | |
| C07 | Lance livre (com ritual) | 10× |

### Bloco D — Finalizações (se der tempo)

| Take | Conteúdo |
|---|---|
| D01 | Bandeja normal mão forte/fraca (1 e 2 passos) |
| D02 | Euro step e hop step |
| D03 | Enterrada (só se algum atleta enterrar) |

## 6. Checklist do dia

- [ ] Termos assinados
- [ ] Câmeras: 120 fps, obturador 1/960+, estabilização OFF, lente linear, foco/exposição travados
- [ ] Teste de flicker (gravar 5 s e conferir)
- [ ] Calibração intrínseca de todas as câmeras
- [ ] Calibração extrínseca (placa no chão + medidas das linhas)
- [ ] Pulo de sincronia (e palma/flash de reserva) em todo take
- [ ] Planilha de takes preenchida (take, conteúdo, atleta, observações, "bom/ruim")
- [ ] Backup dos cartões no mesmo dia (organizar por take: `S01_A03_cam1.mp4` ...)

## 7. Depois da sessão

Organize as pastas como no guia (`T<nn>_<movimento>\videos\camNN.mp4`) e rode `rodar_pose2sim.py` em cada take (guia §6): sai um BVH por take, já no esqueleto do jogo. Suba os vídeos, os BVH e a planilha (Google Drive ou similar) e me passe o link; eu recorto/loopo os clipes (`processar_clipes.py`), monto o FBX e devolvo as primeiras animações para o Freestyle.
