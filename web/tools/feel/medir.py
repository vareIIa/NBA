"""Mede, quadro a quadro, bola + corpo num vídeo de dribles (2K ou o nosso jogo gravado pelo motor.mjs).

Uso:
  python -I medir.py <video.mp4> <saida.csv> [--modelo modelos/pose_landmarker_heavy.task]
                     [--bola-h 3 17] [--bola-s 80] [--bola-v 50 185] [--topo 0.30] [--raio 14 55] [--area 500 9000]
                     [--fechar 7]

Saída: uma linha por quadro com diff (câmera lenta/congelado), bola (x, y, raio inscrito, em px) e, com o modelo de pose,
os landmarks úteis do MediaPipe (nariz, ombros, punhos, quadris, joelhos, tornozelos, calcanhares) em px, com a
visibilidade. Os padrões da bola são os do vídeo do 2K (bola marrom-alaranjada, piso H~20 S~65 V~205; o topo da tela
tem HUD); para o nosso jogo o regua.mjs passa os da nossa bola.

O vídeo e o modelo são lidos como dados: rode sempre com `python -I`.
"""
import argparse
import csv
import sys

LM = {
    'nose': 0, 'lsh': 11, 'rsh': 12, 'lwr': 15, 'rwr': 16, 'lhip': 23, 'rhip': 24,
    'lknee': 25, 'rknee': 26, 'lank': 27, 'rank': 28, 'lheel': 29, 'rheel': 30,
}


def args_da_linha(argv):
    p = argparse.ArgumentParser(description='Mede bola e pose quadro a quadro.')
    p.add_argument('video')
    p.add_argument('saida')
    p.add_argument('modelo_pos', nargs='?', help='(compatível com a versão antiga: modelo como 3º argumento)')
    p.add_argument('--modelo', help='pose_landmarker_*.task do MediaPipe (sem ele, só bola e diff)')
    p.add_argument('--bola-h', nargs=2, type=int, default=[3, 17], metavar=('MIN', 'MAX'), help='matiz da bola (OpenCV, 0-180)')
    p.add_argument('--bola-s', type=int, default=80, help='saturação mínima da bola')
    p.add_argument('--bola-v', nargs=2, type=int, default=[50, 185], metavar=('MIN', 'MAX'), help='brilho da bola')
    p.add_argument('--topo', type=float, default=0.30, help='fração do topo da tela ignorada (HUD, quadra distante)')
    p.add_argument('--raio', nargs=2, type=float, default=[14, 55], metavar=('MIN', 'MAX'), help='raio inscrito da bola (px)')
    p.add_argument('--area', nargs=2, type=float, default=[500, 9000], metavar=('MIN', 'MAX'), help='área da mancha da bola (px²)')
    p.add_argument('--fechar', type=int, default=7, help='kernel (px) do fechamento da máscara (as costuras escuras da bola cortam a mancha)')
    p.add_argument('--bola-perto', action='store_true',
                   help='procura a bola só perto do jogador (pela pose do quadro: do ombro a 0,4 S abaixo dos tornozelos, '
                        '±1,3 S do quadril). Sem isso o detector trava em objetos parados da arquibancada e na cabeça (E-C)')
    a = p.parse_args(argv)
    a.modelo = a.modelo or a.modelo_pos
    return a


def regiao_do_jogador(lm, w, h):
    """Caixa (x0, y0, x1, y1) em px onde a bola pode estar, a partir dos landmarks do MediaPipe (normalizados)."""
    def p(idx):
        return lm[idx].x * w, lm[idx].y * h

    lsh, rsh, lhip, rhip, lank, rank = (p(LM[k]) for k in ('lsh', 'rsh', 'lhip', 'rhip', 'lank', 'rank'))
    sh = ((lsh[0] + rsh[0]) / 2, (lsh[1] + rsh[1]) / 2)
    ank = ((lank[0] + rank[0]) / 2, (lank[1] + rank[1]) / 2)
    S = max(1.0, ((sh[0] - ank[0]) ** 2 + (sh[1] - ank[1]) ** 2) ** 0.5)
    hip_x = (lhip[0] + rhip[0]) / 2
    return (hip_x - 1.3 * S, sh[1] - 0.1 * S, hip_x + 1.3 * S, max(lank[1], rank[1]) + 0.4 * S)


def detectar_bola(frame, a, prev_ball, regiao=None):
    """Bola por cor (HSV) + raio inscrito (aguenta a mão tapando parte). Devolve (x, y, r) ou None."""
    import cv2
    import numpy as np

    h, w = frame.shape[:2]
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    ball = cv2.inRange(hsv, (a.bola_h[0], a.bola_s, a.bola_v[0]), (a.bola_h[1], 255, a.bola_v[1]))
    ball[: int(h * a.topo)] = 0
    if regiao is not None:
        x0, y0, x1, y1 = (int(round(v)) for v in regiao)
        fora = np.ones_like(ball, dtype=bool)
        fora[max(0, y0):max(0, min(h, y1)), max(0, x0):max(0, min(w, x1))] = False
        ball[fora] = 0
    ball = cv2.morphologyEx(ball, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    ball = cv2.morphologyEx(ball, cv2.MORPH_CLOSE, np.ones((a.fechar, a.fechar), np.uint8))
    dist = cv2.distanceTransform(ball, cv2.DIST_L2, 5)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(ball)
    best = None
    for k in range(1, n):
        area = stats[k, cv2.CC_STAT_AREA]
        if area < a.area[0] or area > a.area[1]:
            continue
        m = lab == k
        r_in = float(dist[m].max())
        if r_in < a.raio[0] or r_in > a.raio[1]:
            continue
        ys, xs = np.nonzero(m & (dist >= r_in * 0.8))
        cx, cy = float(xs.mean()), float(ys.mean())
        fill = area / (np.pi * r_in * r_in)
        if fill > 2.6:  # mancha comprida (braço/sombra), não bola
            continue
        score = r_in / 30 - abs(fill - 1.3) * 0.5
        if prev_ball is not None:
            score -= np.hypot(cx - prev_ball[0], cy - prev_ball[1]) / 250
        if best is None or score > best[0]:
            best = (score, cx, cy, r_in)
    return None if best is None else best[1:]


def medir(a):
    import cv2
    import numpy as np

    landmarker = None
    if a.modelo:
        import mediapipe as mp
        from mediapipe.tasks import python as mpt
        from mediapipe.tasks.python import vision

        opts = vision.PoseLandmarkerOptions(
            base_options=mpt.BaseOptions(model_asset_path=a.modelo),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.4,
            min_tracking_confidence=0.4,
        )
        landmarker = vision.PoseLandmarker.create_from_options(opts)

    cap = cv2.VideoCapture(a.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    prev_gray = None
    prev_ball = None
    regiao = None
    rows = []
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        h, w = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, (w // 4, h // 4))
        diff = float(np.mean(cv2.absdiff(small, prev_gray))) if prev_gray is not None else 0.0
        prev_gray = small
        lm = None
        if landmarker is not None:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(i * 1000 / fps))
            if res.pose_landmarks:
                lm = res.pose_landmarks[0]
        if a.bola_perto and lm is not None:
            regiao = regiao_do_jogador(lm, w, h)
        elif not a.bola_perto:
            regiao = None
        # (com --bola-perto e sem pose neste quadro, vale a região do último quadro com pose)
        bx = by = br = ''
        best = detectar_bola(frame, a, prev_ball, regiao if a.bola_perto else None) if (not a.bola_perto or regiao is not None) else None
        if best:
            prev_ball = best[:2]
            bx, by, br = (round(v, 1) for v in best)
        row = {'frame': i, 't': round(i / fps, 4), 'diff': round(diff, 3), 'ball_x': bx, 'ball_y': by, 'ball_r': br}
        if lm is not None:
            for k, idx in LM.items():
                row[k + '_x'] = round(lm[idx].x * w, 1)
                row[k + '_y'] = round(lm[idx].y * h, 1)
                row[k + '_v'] = round(lm[idx].visibility, 2)
        rows.append(row)
        i += 1

    keys = []
    for r in rows:
        for k in r:
            if k not in keys:
                keys.append(k)
    with open(a.saida, 'w', newline='') as f:
        wr = csv.DictWriter(f, fieldnames=keys)
        wr.writeheader()
        wr.writerows(rows)
    print(f'{i} quadros @ {fps:.2f} fps -> {a.saida}')
    return rows


if __name__ == '__main__':
    medir(args_da_linha(sys.argv[1:]))
