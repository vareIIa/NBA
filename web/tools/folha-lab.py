# Folha de quadros do laboratório: recorta uma das 4 vistas dos prints de laboratorio.mjs e monta uma grade com o
# número do quadro, para ver um drible inteiro numa imagem só.
#   python tools/folha-lab.py <pasta_do_cenario> <vista: tras|lado|frente|cima> <saida.jpg> [colunas=8] [q0] [q1] [zoom=1]
import sys
from pathlib import Path

from PIL import Image, ImageDraw

folder, view, out = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 8
q0 = int(sys.argv[5]) if len(sys.argv) > 5 else 0
q1 = int(sys.argv[6]) if len(sys.argv) > 6 else 10**9
zoom = float(sys.argv[7]) if len(sys.argv) > 7 else 1.0
files = sorted(f for f in folder.glob('*_q*.png') if q0 <= int(f.stem.split('_q')[1]) <= q1)
if not files:
    raise SystemExit('sem quadros em ' + str(folder))
first = Image.open(files[0])
w, h = first.width // 2, first.height // 2
box = {'tras': (0, 0), 'lado': (w, 0), 'frente': (0, h), 'cima': (w, h)}[view]
# Só o miolo da vista (o jogador fica no centro): 60% da largura e 85% da altura.
cw, ch = int(w * 0.6 / zoom), int(h * 0.85 / zoom)
cx, cy = box[0] + (w - cw) // 2, box[1] + (h - ch) // 2
rows = (len(files) + cols - 1) // cols
tw, th = (int(cw * zoom), int(ch * zoom)) if zoom != 1.0 else (cw, ch)
sheet = Image.new('RGB', (cols * tw, rows * th), (20, 20, 24))
draw = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    tile = Image.open(f).crop((cx, cy, cx + cw, cy + ch))
    if zoom != 1.0:
        tile = tile.resize((int(cw * zoom), int(ch * zoom)))
    x, y = (i % cols) * tw, (i // cols) * th
    sheet.paste(tile, (x, y))
    draw.rectangle((x, y, x + 52, y + 18), fill=(0, 0, 0))
    draw.text((x + 4, y + 3), 'q' + f.stem.split('_q')[1], fill=(255, 255, 255))
scale = min(1.0, 2400 / sheet.width)
if scale < 1:
    sheet = sheet.resize((int(sheet.width * scale), int(sheet.height * scale)))
sheet.save(out, quality=88)
print(out, sheet.size, len(files), 'quadros')
