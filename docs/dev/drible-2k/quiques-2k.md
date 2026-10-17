# Quiques do NBA 2K27 re-medidos

> Sessão de 2026-10-17, depois da Fase 1 (`docs/27-dribles-2k.md` §5; `linha-de-base.md` §5 e §6 pediam este passo).
> Os dois vídeos do 2K ficam só na máquina do diretor (doc 27 §0); vídeo, quadros e folhas deste trabalho ficaram no
> scratchpad da sessão e nada deles entrou no repositório.

## Resumo

- **Relaxar o limite de altura sozinho não resolve o 2K.** A calibração no nosso jogo indicou o `--limite-quique 0.35`,
  mas no 2K o problema principal era o **detector de bola**: ele trava em objetos parados longe do jogador (na
  arquibancada, na cabeça) e, quando a bola some, pega o joelho. Só com o limite relaxado, ele acha 5 de 13 quiques do E-D e
  4 de 19 do E-E (tabela abaixo).
- **Com a bola procurada perto do jogador** (`medir.py --bola-perto`) **e as manchas pequenas descartadas**
  (`derivar.py --limite-quique 0.35 --raio-min 0.8`), o detector acha 16 de 19 quiques do E-E, 8 de 13 do E-D, os 7 do
  E-B e 5 de 6 do E-A.
- **Veredito dos alvos de ritmo do doc 27 §2.2:**

| Alvo (§2.2) | Antes | Agora | Veredito |
|---|---|---|---|
| Quique no crossover parado | 10 q (A) | 11 e 8 q na sequência de crossovers (E-E I4); mediana de 11 q em todo o E-E | **confirmado** |
| Quique no BTB duplo | ~7 q (B) | **15 q** (14–18 q, 5 intervalos conferidos à mão; o detector acha os mesmos 7 quiques) | **não se confirma**: o ~7 q veio de quiques falsos no CSV antigo |
| Quique correndo | 15 q (M) | 14, 16 e 15 q nos trechos sem a bola escondida | **confirmado** |
| Drible parado (size-up) | 10–12 q (B) | 11–12 q no drible no lugar com cruzamentos (E-E); não há trecho longo de drible vivo nos vídeos | **consistente**; a confiança segue B |

## 1. Como foi medido

```bash
cd web
python -I tools/feel/medir.py <video-do-2K.mp4> v1.csv --modelo tools/feel/modelos/pose_landmarker_heavy.task --bola-perto
python -I tools/feel/derivar.py v1.csv v1-metricas.csv --limite-quique 0.35 --raio-min 0.8
```

- **Reprodução conferida antes de mudar qualquer coisa.** O `medir.py` sem as opções novas gera um `medidas.csv` idêntico
  ao da sessão do doc 27. O `derivar.py` com os padrões reproduz byte a byte `dados/video1-metricas.csv` e
  `dados/video2-metricas.csv`. As opções novas (`--bola-perto` no `medir.py`, `--raio-min` no `derivar.py`) começam
  desligadas.
- **Quiques confirmados à mão** (a referência da validação):
  - as listas quadro a quadro das evidências: E-A §4, E-C §4, E-D §8 e o texto de E-E §3, inclusive os contatos
    descritos só em texto, como "1563–1565 contato baixo" e "1726–1728 centro-chão";
  - folhas de contato desta sessão, com os candidatos do detector marcados: E-B quadros 382–489, E-E 1555–1590 e E-D
    1130–1165.
- **Intervalo**: entre quiques seguidos da mesma tomada. Um corte de câmera (diff > 25) no meio descarta o intervalo.
  Os intervalos de 5 a 24 q contam como drible contínuo; acima disso há pausa com a bola segurada ou um quique escondido.
- **Tempo**: quadros de 30 fps (q = 33 ms). A fonte tem ~27,5 fps reamostrada, então vale ±1 q.

## 2. Por que o detector antigo errava no 2K

1. **Travado longe do jogador.** Na sequência de crossovers do E-E (I4, quadros 1618–1649), a "bola" ficou 30 quadros
   parada em (121, 481) px, um objeto da arquibancada, com `bola_altura` de 2,3 a 3,0 S. No E-D ela pulou para (785, 590).
   A evidência E-C já sugeria procurar a bola só abaixo do ombro. O `--bola-perto` limita a busca a uma caixa tirada da
   pose do quadro: do ombro (−0,1 S) a 0,4 S abaixo dos tornozelos, e ±1,3 S do quadril.
2. **Joelho quando a bola some.** Atrás do corpo ou entre as pernas, o detector de cor acha o joelho ou a canela
   (`bola_altura` ~0,25–0,3 S). A mancha do joelho tem raio de 15–18 px, contra 28–32 px da bola (mediana de 29 px no
   vídeo 1). O `--raio-min 0.8` descarta as manchas com menos de 80% do raio mediano.
3. **Bola parada no quadril lida como quique.** No double BTB, o CSV antigo marcou quiques a cada 0,13–0,37 s porque a
   bola segurada no quadril e o joelho viravam mínimos locais. Os quiques de verdade são a metade deles (seção 3).
4. **Onde a bola quica muda com o golpe.** Parado, o 2K quica a bola entre os pés: na imagem ela fica a 0–0,15 S acima dos
   tornozelos (quadros 1555, 1564, 1575). Correndo, ela quica à frente: 0,2–0,27 S (quadros 1131, 1147). No nosso vídeo de
   calibração ela quica 0,27 S acima. Por isso o limite fica em 0,35 S e o raio mínimo segura os falsos que isso deixa
   entrar.

Quiques achados (±2 quadros) entre os confirmados à mão; entre parênteses, os extras do detector que não estão na lista
(a lista à mão é parcial, então parte dos extras é quique de verdade).

| Configuração | E-A (6) | E-B (7) | E-C (2) | E-D (13) | E-E (19) |
|---|---|---|---|---|---|
| Detector antigo, limite 0,15 S (o do doc 27) | 4 (+0) | 4 (+0) | 0 | 3 (+0) | 1 (+2) |
| Detector antigo, limite 0,35 S | 4 (+3) | 4 (+1) | 0 | 5 (+2) | 4 (+3) |
| `--bola-perto`, limite 0,35 S | 5 (+8) | 7 (+1) | 1 | 10 (+19) | 17 (+12) |
| `--bola-perto`, limite 0,35 S, `--raio-min 0.8` (**final**) | 5 (+4) | **7 (+0)** | 1 | 8 (+6) | **16 (+4)** |

O que o final ainda perde é a bola sobre a pintura vermelha do garrafão (a cor da bola se funde com a pintura, como no
quique de 1162) e os quiques escondidos atrás do corpo.

## 3. Intervalos por trecho

| Trecho (doc 27 §8) | Quadros | Intervalos dos quiques confirmados à mão (q) | Detector final: intervalos contínuos (q) | Mediana | Alvo §2.2 | Veredito | Confiança |
|---|---|---|---|---|---|---|---|
| E-A momentum (rocker) | v1 120–381 | 30, 8, 25 (a lista à mão é esparsa) | 17, 15, 15, 12, 21 | 15 | — | Apoia a hipótese de E-A de um quique por passagem, a ~0,5 s na fase 1. Sem alvo no §2.2. | B |
| E-B double BTB | v1 386–720 | **18, 14, 15** (tomada até 440) e **15, 14** (de 441) | 18, 14, 15, 15, 14, 8, 16 | **15** | ~7 q | **Não se confirma.** O ritmo é de 15 q (0,5 s), com uma trava de pé por quique, não uma a cada dois. | M |
| E-C breakdown + step-back | v1 690–1103 | 3 (dois contatos do breakdown, 713 e 716) | 16, 15, 10, 14, 14, 11, 18, 21, 15, 5, 21 | 15 | — | Só informativo: o detector não foi validado aqui. | B |
| E-D BTB correndo | v1 1080–1530 | **14, 16, 15** (os de ~30 q têm um quique escondido no meio) | 16, 12, 24, 21, 24 | 15 à mão (21 no detector, que perde quiques na pintura) | 15 q | **Confirmado** | M |
| E-E crossovers e pausas | v1 1500–1739 | 5, 9, 11, 20, 12, 19, **11, 8**, 10 (os em negrito são a sequência I4) | 17, 10, 9, 11, 20, 12, 19, 12, 8, 12, 14 | 11 à mão, 12 no detector | 10 q (cross); 10–12 q (parado) | **Confirmado** (cross) e **consistente** (parado) | A (cross); B (parado) |
| E-E final (personagem "24") | v1 1770–1857 | 29, 12, 15 | 10, 18, 12, 14 | 13 | — | Informativo | B |
| E-F (vídeo 2) | v2 0–584 | — | (15 q no detector, sem validação) | — | — | **Não medível.** Uma faixa de propaganda do vídeo cobre os pés e o quique, e há cortes em 164, 295 e 455. | — |

## 4. O que mudou na régua (aplicado em 2026-10-17)

- `web/tools/feel/referencia-2k.json`, métrica `quique_btb_duplo`: alvo `[15, 15]` (era `[7, 7]`), tolerância 2,
  confiança "M", fontes E-B e este arquivo. O nosso BTB → BTB (9,5 q) passou de limítrofe a **reprovado** na
  `linha-de-base.md` (refeita com `--so-comparar`, mesma rodada de medição): o nosso double BTB quica mais rápido que o do
  2K, não mais devagar. Total da linha de base: 54 aprovadas, 31 reprovadas, 21 limítrofes; o top 10 não mudou.
- Doc 27 §2.2, "Quique no BTB duplo": ~15 q (0,5 s), 14–18 q, nós 9,5 q, confiança M. §2.4, "Double BTB": um quique a
  cada ~0,5 s e uma trava de pé por quique.
- `quique_cross` (10 q, A), `quique_correndo` (15 q, M) e `quique_parado` (10–12 q, B) ficaram como estavam.
- `web/tools/feel/linha-de-base-anexo.md` (seção 6 da linha de base) e a linha da Fase 1 no doc 27 §5 agora citam
  este arquivo.

## 5. Limites

- As listas à mão são parciais. Parte dos "extras" do detector é quique de verdade (ex.: 1595 e 1672 no E-E aparecem no
  texto de E-E, mas não como quique), então a precisão do detector é melhor do que a tabela da seção 2 sugere.
- A bola sobre a pintura vermelha não é detectada (a cor se funde), e a bola atrás do corpo some. Os dois casos alongam
  os intervalos do detector, por isso a mediana do E-D no detector (21 q) fica acima da leitura à mão (15 q).
- A seção 3 só mede o ritmo dos trechos. A latência e o resto da régua não mudam.
- 30 fps com a fonte a ~27,5 fps: ±1 q em cada intervalo.
