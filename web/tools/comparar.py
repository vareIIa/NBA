"""Folha de comparação: drible real (vídeo) em cima x nosso boneco (quadros do laboratório) embaixo.

    python tools/comparar.py <video> <t0> <t1> <crop x0,y0,x1,y1 em 0..1> <pasta_do_cenario> <vista 0..3> <n> <saida.jpg>
           [quadro_inicial quadro_final]

Vistas do laboratório: 0 = trás, 1 = lado, 2 = frente, 3 = cima. Os n quadros são espalhados por igual nos dois.
Com COMPARAR_ANTES=<pasta_do_cenario_antes>, entra uma linha do meio com o "antes" (mesmos quadros).
"""
import os
import glob
import sys

import av
from PIL import Image, ImageDraw

video, t0, t1, crop, labdir, view, n, out = sys.argv[1:9]
t0, t1, view, n = float(t0), float(t1), int(view), int(n)
crop = [float(c) for c in crop.split(",")]
f0 = int(sys.argv[9]) if len(sys.argv) > 9 else None
f1 = int(sys.argv[10]) if len(sys.argv) > 10 else None

# Vídeo real.
container = av.open(video)
stream = container.streams.video[0]
times = [t0 + (t1 - t0) * i / (n - 1) for i in range(n)]
real, k = [], 0
for frame in container.decode(video=0):
    t = float(frame.pts * stream.time_base)
    while k < n and t >= times[k]:
        im = frame.to_image()
        w, h = im.size
        real.append((t, im.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))))
        k += 1
    if k >= n:
        break

# Laboratório (quadros 1280x720 com 4 vistas 2x2).
files = sorted(glob.glob(labdir + "/*.png"))
def frame_no(path):
    return int(path.split("_q")[-1].split(".")[0])
if f0 is not None:
    files = [p for p in files if f0 <= frame_no(p) <= f1]
pick = [files[round(i * (len(files) - 1) / (n - 1))] for i in range(n)]
def lab_cells(paths):
    cells = []
    for p in paths:
        im = Image.open(p).convert("RGB")
        W, H = im.size
        x, y = (view % 2) * W // 2, (view // 2) * H // 2
        cell = im.crop((x, y, x + W // 2, y + H // 2))
        # Letreiro das métricas do quadro (centro da imagem): vai para o pé da célula.
        cell.paste(im.crop((W // 2 - 170, H // 2 - 16, W // 2 + 170, H // 2 + 16)), ((W // 2 - 340) // 2, H // 2 - 34))
        cells.append((frame_no(p), cell))
    return cells
ours = lab_cells(pick)
before_dir = os.environ.get("COMPARAR_ANTES")
before = lab_cells([os.path.join(before_dir, os.path.basename(p)) for p in pick]) if before_dir else []

cell_h = 300
def fit(im):
    return im.resize((int(im.width * cell_h / im.height), cell_h))
row1 = [fit(im) for _, im in real]
rows = [("real", real, row1)]
if before:
    rows.append(("antes", before, [fit(im) for _, im in before]))
rows.append(("depois" if before else "nosso", ours, [fit(im) for _, im in ours]))
cw = max(i.width for _, _, r in rows for i in r)
sheet = Image.new("RGB", (cw * n, (cell_h + 4) * len(rows)), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for k, (label, src, row) in enumerate(rows):
    for i, (im, (key, _)) in enumerate(zip(row, src)):
        sheet.paste(im, (i * cw, k * (cell_h + 4)))
        text = f"real {key:.2f}s" if label == "real" else f"{label} q{key}"
        d.text((i * cw + 4, k * (cell_h + 4) + 4), text, fill=(255, 255, 0) if label == "real" else (0, 255, 255))
scale = min(1.0, 2400 / sheet.width)
if scale < 1:
    sheet = sheet.resize((int(sheet.width * scale), int(sheet.height * scale)))
sheet.save(out, quality=88)
print(out, sheet.size)
