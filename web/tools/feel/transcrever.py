"""Transcreve a narração dos tutoriais (os comandos falados) com o faster-whisper (opcional, doc 27 §0).

Uso: python -I transcrever.py <audio.wav> [<audio2.wav> ...] [--modelo small]

Entrada: WAV mono 16 bits (ex.: ffmpeg -i video.mp4 -ac 1 -ar 16000 audio.wav). Saída no terminal: [início-fim] texto.
O áudio de um vídeo do 2K é material local: nunca versionar.
"""
import argparse
import sys
import wave

import numpy as np
from faster_whisper import WhisperModel

p = argparse.ArgumentParser(description='Transcreve WAVs com o faster-whisper.')
p.add_argument('wavs', nargs='+')
p.add_argument('--modelo', default='small', help='tamanho do modelo do Whisper (tiny, base, small, medium...)')
a = p.parse_args()
try:
    sys.stdout.reconfigure(encoding='utf-8')
except (AttributeError, ValueError):
    pass
m = WhisperModel(a.modelo, device='cpu', compute_type='int8')
for path in a.wavs:
    with wave.open(path) as w:
        audio = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768.0
    rms = float(np.sqrt(np.mean(audio * audio)))
    segs, info = m.transcribe(audio, vad_filter=True, beam_size=5)
    print(f'== {path} rms={rms:.4f} lang={info.language} p={info.language_probability:.2f}')
    for s in segs:
        print(f'[{s.start:6.2f}-{s.end:6.2f}] {s.text.strip()}')
