# Junta os quadros do tools/defesa-folha.mjs numa grade (uma linha por vista), com o número do quadro.
#   python tools/defesa-folha.py <pasta> <saida.jpg> [vistas=front,side] [colunas=10]
import sys
from pathlib import Path

from PIL import Image, ImageDraw

folder, out = Path(sys.argv[1]), sys.argv[2]
views = (sys.argv[3] if len(sys.argv) > 3 else 'front,side').split(',')
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 10
rows = []
for v in views:
    files = sorted(folder.glob(f'{v}_q*.png'))
    if files:
        rows.append((v, files))
if not rows:
    raise SystemExit('sem quadros em ' + str(folder))
first = Image.open(rows[0][1][0])
# Recorte do miolo (o jogador no centro).
cw, ch = int(first.width * 0.62), int(first.height * 0.9)
cx, cy = (first.width - cw) // 2, int(first.height * 0.04)
lines = []
for v, files in rows:
    for i in range(0, len(files), cols):
        lines.append((v, files[i : i + cols]))
sheet = Image.new('RGB', (cols * cw, len(lines) * ch), (20, 20, 24))
draw = ImageDraw.Draw(sheet)
for r, (v, files) in enumerate(lines):
    for c, f in enumerate(files):
        x, y = c * cw, r * ch
        sheet.paste(Image.open(f).crop((cx, cy, cx + cw, cy + ch)), (x, y))
        draw.rectangle((x, y, x + 86, y + 18), fill=(0, 0, 0))
        draw.text((x + 4, y + 3), f'{v} q{f.stem.split("_q")[1]}', fill=(255, 255, 255))
scale = min(1.0, 2600 / sheet.width)
if scale < 1:
    sheet = sheet.resize((int(sheet.width * scale), int(sheet.height * scale)))
sheet.save(out, quality=88)
print(out, sheet.size)
