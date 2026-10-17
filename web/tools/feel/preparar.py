"""Prepara a régua do feel: baixa o modelo de pose do MediaPipe (se faltar) e confere as bibliotecas.

Uso (de web/):  python -I tools/feel/preparar.py [--sem-baixar]

O modelo vai para tools/feel/modelos/ (ignorado pelo git: nunca versionar o binário). Fonte oficial do Google
(MediaPipe Pose Landmarker, variante heavy, float16, ~30 MB). As bibliotecas ficam num venv próprio (ver README):

  python -m venv tools/feel/.venv
  tools/feel/.venv/Scripts/python -m pip install -r tools/feel/requirements.txt     (Windows; no Linux/mac: .venv/bin/python)
"""
import argparse
import importlib
import os
import sys
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
MODELO = os.path.join(AQUI, 'modelos', 'pose_landmarker_heavy.task')
URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task'


def baixar_modelo():
    if os.path.exists(MODELO) and os.path.getsize(MODELO) > 1_000_000:
        print(f'modelo ok: {MODELO} ({os.path.getsize(MODELO) / 1e6:.1f} MB)')
        return True
    os.makedirs(os.path.dirname(MODELO), exist_ok=True)
    tmp = MODELO + '.parcial'
    print(f'baixando {URL}\n  -> {MODELO}')
    with urllib.request.urlopen(URL, timeout=120) as r, open(tmp, 'wb') as f:
        total = 0
        while True:
            bloco = r.read(1 << 20)
            if not bloco:
                break
            f.write(bloco)
            total += len(bloco)
    if total < 1_000_000:
        os.remove(tmp)
        print(f'download pequeno demais ({total} bytes): confira a conexão e a URL')
        return False
    os.replace(tmp, MODELO)
    print(f'modelo baixado ({total / 1e6:.1f} MB)')
    return True


def conferir_bibliotecas():
    ok = True
    for nome in ('numpy', 'cv2', 'mediapipe'):
        try:
            mod = importlib.import_module(nome)
            print(f'{nome:10s} {getattr(mod, "__version__", "?")}')
        except ImportError:
            ok = False
            print(f'{nome:10s} FALTA (pip install -r tools/feel/requirements.txt)')
    try:
        importlib.import_module('faster_whisper')
        print('faster_whisper ok (opcional: transcrever.py)')
    except ImportError:
        print('faster_whisper não instalado (opcional: só para transcrever.py)')
    return ok


def main(argv=None):
    p = argparse.ArgumentParser(description='Baixa o modelo de pose e confere as bibliotecas da régua do feel.')
    p.add_argument('--sem-baixar', action='store_true', help='só confere, não baixa o modelo')
    a = p.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass
    print(f'python: {sys.executable}')
    libs = conferir_bibliotecas()
    modelo = os.path.exists(MODELO) if a.sem_baixar else baixar_modelo()
    if not modelo:
        print(f'sem o modelo em {MODELO}')
    if libs and modelo:
        print('pronto: node tools/feel/regua.mjs')
        return 0
    print('a régua roda mesmo assim com --sem-video (sem a calibração do pipeline de vídeo)')
    return 1


if __name__ == '__main__':
    sys.exit(main())
