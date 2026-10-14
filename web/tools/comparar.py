"""Folha de comparação: drible real (vídeo) em cima x nosso boneco (quadros do laboratório) embaixo.

    python tools/comparar.py <video> <t0> <t1> <crop x0,y0,x1,y1 em 0..1> <pasta_do_cenario> <vista 0..3> <n> <saida.jpg>
           [quadro_inicial quadro_final]

Vistas do laboratório: 0 = trás, 1 = lado, 2 = frente, 3 = cima. Os n quadros são espalhados por igual nos dois.
"""
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
ours = []
for p in pick:
    im = Image.open(p).convert("RGB")
    W, H = im.size
    x, y = (view % 2) * W // 2, (view // 2) * H // 2
    ours.append((frame_no(p), im.crop((x, y, x + W // 2, y + H // 2))))

cell_h = 300
def fit(im):
    return im.resize((int(im.width * cell_h / im.height), cell_h))
row1 = [fit(im) for _, im in real]
row2 = [fit(im) for _, im in ours]
cw = max(max(i.width for i in row1), max(i.width for i in row2))
sheet = Image.new("RGB", (cw * n, cell_h * 2 + 4), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for i, (im, (t, _)) in enumerate(zip(row1, real)):
    sheet.paste(im, (i * cw, 0))
    d.text((i * cw + 4, 4), f"real {t:.2f}s", fill=(255, 255, 0))
for i, (im, (q, _)) in enumerate(zip(row2, ours)):
    sheet.paste(im, (i * cw, cell_h + 4))
    d.text((i * cw + 4, cell_h + 8), f"nosso q{q}", fill=(0, 255, 255))
scale = min(1.0, 2400 / sheet.width)
if scale < 1:
    sheet = sheet.resize((int(sheet.width * scale), int(sheet.height * scale)))
sheet.save(out, quality=88)
print(out, sheet.size)
