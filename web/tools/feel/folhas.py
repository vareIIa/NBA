"""Folhas de contato: 1 segundo por folha (30 quadros, 6x5), recortadas no jogador, com bola e esqueleto desenhados.

Uso: python -I folhas.py <video.mp4> <medidas.csv> <pasta_saida>

<medidas.csv> é a saída do medir.py. As folhas de um vídeo do 2K são material de análise local: nunca versionar.
"""
import argparse
import csv
import os

import cv2
import numpy as np

_p = argparse.ArgumentParser(description='Folhas de contato com esqueleto e bola.')
_p.add_argument('video')
_p.add_argument('medidas')
_p.add_argument('pasta_saida')
_a = _p.parse_args()
video, medidas, outdir = _a.video, _a.medidas, _a.pasta_saida
os.makedirs(outdir, exist_ok=True)
rows = list(csv.DictReader(open(medidas)))

BONES = [('lsh', 'rsh'), ('lsh', 'lhip'), ('rsh', 'rhip'), ('lhip', 'rhip'), ('lhip', 'lknee'), ('lknee', 'lank'),
         ('rhip', 'rknee'), ('rknee', 'rank'), ('lsh', 'lwr'), ('rsh', 'rwr')]


def pt(r, k):
    x, y = r.get(k + '_x'), r.get(k + '_y')
    return (float(x), float(y)) if x and y else None


cap = cv2.VideoCapture(video)
frames = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    frames.append(f)
h, w = frames[0].shape[:2]
TW, TH = 300, 340  # tile
COLS, ROWS = 6, 5
per = COLS * ROWS
for s in range(0, len(frames), per):
    sheet = np.zeros((TH * ROWS, TW * COLS, 3), np.uint8)
    for j, i in enumerate(range(s, min(s + per, len(frames)))):
        f = frames[i].copy()
        r = rows[i]
        for a, b in BONES:
            pa, pb = pt(r, a), pt(r, b)
            if pa and pb:
                cv2.line(f, tuple(map(int, pa)), tuple(map(int, pb)), (0, 255, 0), 3)
        if r['ball_x']:
            cv2.circle(f, (int(float(r['ball_x'])), int(float(r['ball_y']))), int(float(r['ball_r'])) + 6, (255, 255, 0), 3)
        # recorte centrado no quadril (ou no centro), cobrindo o corpo inteiro e a bola
        hip = pt(r, 'lhip')
        cx = int(hip[0]) if hip else w // 2
        cy = int(hip[1]) if hip else int(h * 0.65)
        cw, ch = 560, 640
        x0 = max(0, min(w - cw, cx - cw // 2))
        y0 = max(0, min(h - ch, cy - int(ch * 0.55)))
        crop = cv2.resize(f[y0:y0 + ch, x0:x0 + cw], (TW, TH))
        tag = f"#{i} {i / 30:.3f}s"
        cv2.rectangle(crop, (0, 0), (TW, 22), (0, 0, 0), -1)
        cv2.putText(crop, tag, (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 1, cv2.LINE_AA)
        if float(r['diff']) < 0.4:
            cv2.putText(crop, 'PARADO', (TW - 80, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1, cv2.LINE_AA)
        rr, cc = divmod(j, COLS)
        sheet[rr * TH:(rr + 1) * TH, cc * TW:(cc + 1) * TW] = crop
    cv2.imwrite(os.path.join(outdir, f's_{s // per:03d}.jpg'), sheet, [cv2.IMWRITE_JPEG_QUALITY, 82])
print('ok', len(frames))
