# Procura quadros em que o jogador some ou pisca num vídeo de gameplay: conta os pixels da camisa azul (e da bola laranja)
# em cada quadro; um quadro com bem menos pixels que os vizinhos é um "sumiço".
#   python tools/sumico.py <pasta_com_png> [limiar=0.5]
import sys
from pathlib import Path

from PIL import Image

folder = Path(sys.argv[1])
limit = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5


def counts(path):
    im = Image.open(path).convert('RGB').resize((320, 180))
    blue = orange = 0
    for r, g, b in im.getdata():
        if b > 120 and b > r * 1.6 and b > g * 1.3:
            blue += 1
        elif r > 170 and 60 < g < 140 and b < 80:
            orange += 1
    return blue, orange


files = sorted(folder.glob('*.png'))
data = [counts(f) for f in files]
bad = []
for i, (blue, orange) in enumerate(data):
    near = [data[j][0] for j in range(max(0, i - 3), min(len(data), i + 4)) if j != i]
    ref = sorted(near)[len(near) // 2] if near else blue
    if ref > 30 and blue < ref * limit:
        bad.append((files[i].name, blue, ref))
print(len(files), 'quadros; camisa (pixels): min', min(d[0] for d in data), 'mediana', sorted(d[0] for d in data)[len(data) // 2])
print('suspeitos:', len(bad))
for name, blue, ref in bad[:40]:
    print(' ', name, 'camisa', blue, 'vizinhos', ref)
