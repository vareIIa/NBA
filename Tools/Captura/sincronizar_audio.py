"""
Sincronismo pelo som: acha, em cada vídeo do take, o instante do "evento de sincronia" (o atleta pula com os dois
pés e aterrissa batendo forte no chão, ou uma palma forte) e devolve esse tempo por câmera.

O rodar_pose2sim.py (--sync audio) passa esses tempos ao Pose2Sim (approx_time_maxspeed), que refina o ajuste
quadro a quadro pela velocidade vertical dos pontos numa janela curta em volta do evento. Isso evita os dois
problemas da sincronização automática no basquete: deslocamentos grandes (celulares ligados à mão) e o drible
periódico (a correlação "acha" um quique errado).

Como funciona: envelope de energia do áudio (1 ms) → "ataques" (subidas bruscas de energia) → a câmera de
referência marca o ataque mais forte nos primeiros --janela segundos; as outras são alinhadas a ela por
correlação cruzada dos ataques (robusto a ruído e a celulares com volumes diferentes).

Uso:  python sincronizar_audio.py <pasta_do_take>/videos [--janela 15]
Precisa: numpy e PyAV (o pacote "av", que já vem com o Pose2Sim).
"""
import argparse
import glob
import os
import sys

import numpy as np

TAXA = 1000  # Hz do envelope (1 amostra por ms)


def inicio(stream):
    """Instante (s) do primeiro pacote da trilha, para alinhar áudio e vídeo do mesmo arquivo."""
    if stream is None or stream.start_time is None:
        return 0.0
    return float(stream.start_time * stream.time_base)


def envelope(caminho):
    """Envelope de energia (TAXA Hz) e o atraso do áudio em relação ao 1º quadro do vídeo (s)."""
    import av
    with av.open(caminho) as arq:
        audio = next((s for s in arq.streams if s.type == "audio"), None)
        video = next((s for s in arq.streams if s.type == "video"), None)
        if audio is None:
            return None, 0.0
        taxa = 16000
        reamostra = av.AudioResampler(format="flt", layout="mono", rate=taxa)
        partes = []
        for quadro in arq.decode(audio):
            for q in reamostra.resample(quadro):
                partes.append(q.to_ndarray().ravel())
        atraso = inicio(audio) - inicio(video)
    sinal = np.concatenate(partes) if partes else np.zeros(1)
    bloco = taxa // TAXA
    n = len(sinal) // bloco
    energia = (sinal[:n * bloco].reshape(n, bloco) ** 2).mean(axis=1)
    return np.log10(energia + 1e-10), atraso


def ataques(env):
    """Subidas de energia (dB/ms), suavizadas em 5 ms; só a parte positiva."""
    d = np.diff(env, prepend=env[0])
    d = np.convolve(d, np.ones(5) / 5, mode="same")
    return np.maximum(d, 0.0)


def defasagem(a, b, max_s):
    """Quanto b está ATRASADO em relação a a (s), por correlação cruzada (FFT), limitada a ±max_s."""
    n = len(a) + len(b)
    tam = 1 << (n - 1).bit_length()
    corr = np.fft.irfft(np.fft.rfft(a - a.mean(), tam) * np.conj(np.fft.rfft(b - b.mean(), tam)), tam)
    lags = np.concatenate([np.arange(0, tam // 2), np.arange(-tam // 2, 0)])
    ok = np.abs(lags) <= max_s * TAXA
    melhor = lags[ok][np.argmax(corr[ok])]
    return -melhor / TAXA


def tempos_do_evento(pasta_videos, janela=15.0):
    """{nome do vídeo: tempo (s) do evento de sincronia, no relógio do vídeo}. Erro se algum vídeo não tem som."""
    videos = sorted(glob.glob(os.path.join(pasta_videos, "*.mp4")) + glob.glob(os.path.join(pasta_videos, "*.mov"))
                    + glob.glob(os.path.join(pasta_videos, "*.MP4")) + glob.glob(os.path.join(pasta_videos, "*.MOV")))
    if not videos:
        raise FileNotFoundError("Nenhum vídeo em " + pasta_videos)
    dados = {}
    for v in videos:
        env, atraso = envelope(v)
        if env is None:
            raise ValueError("Sem áudio: {} (grave com som ou use --sync gui)".format(v))
        dados[v] = (ataques(env[: int(janela * TAXA)]), atraso)
    pico = max(a.max() for a, _ in dados.values())
    fracos = [os.path.basename(v) for v, (a, _) in dados.items() if a.max() < 0.25 * pico]
    if fracos:  # áudio mudo ou sem o "tum": a correlação daria 0 s sem avisar
        raise ValueError("Não achei o pulo de sincronia no áudio de: {} (microfone tapado/mudo?). "
                         "Use --sync gui para esse take.".format(", ".join(fracos)))
    ref = videos[0]
    a_ref, atraso_ref = dados[ref]
    t_ref = np.argmax(a_ref) / TAXA  # ataque mais forte na câmera de referência
    tempos = {}
    for v in videos:
        a, atraso = dados[v]
        d = 0.0 if v == ref else defasagem(a_ref, a, max_s=janela * 0.8)
        # tempo no áudio da câmera v → tempo no vídeo (corrige o início diferente das trilhas)
        tempos[os.path.basename(v)] = round(float(t_ref + d + atraso), 3)
    return tempos


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("videos", help="pasta com um vídeo por câmera")
    ap.add_argument("--janela", type=float, default=15.0, help="procura o evento nos primeiros N segundos")
    args = ap.parse_args()
    try:
        tempos = tempos_do_evento(args.videos, args.janela)
    except (FileNotFoundError, ValueError) as erro:
        sys.exit(str(erro))
    for nome, t in tempos.items():
        print("{:24s} evento em {:7.3f} s".format(nome, t))


if __name__ == "__main__":
    main()
