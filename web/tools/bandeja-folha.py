"""Folha de contato de um vídeo do bandeja-video.mjs: os quadros da finalização (do gather até o pouso) lado a lado.

  python tools/bandeja-folha.py <video.mp4> <saida.png> [cenario] [colunas=6] [linhas=4] [recorte=x0,y0,x1,y1]

Lê o <video>.json (gravado junto) para achar os quadros em que a bandeja/enterrada está em curso.
"""
import json
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg
from PIL import Image

video = Path(sys.argv[1])
out = Path(sys.argv[2])
log = json.loads(video.with_suffix(".json").read_text())
name = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != "-" else next(iter(log))
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 6
rows = int(sys.argv[5]) if len(sys.argv) > 5 else 4
crop = [int(v) for v in sys.argv[6].split(",")] if len(sys.argv) > 6 else None

offset = 0
for key, frames in log.items():
    if key == name:
        break
    offset += len(frames)
frames = log[name]
active = [i for i, f in enumerate(frames) if f["layup"]]
first, last = (active[0], min(len(frames) - 1, active[-1] + 12)) if active else (0, len(frames) - 1)
# FOLHA_TRECHO=0.4,0.8 mostra só essa fração do intervalo (para ampliar o voo).
import os

if os.environ.get("FOLHA_TRECHO"):
    a, b = (float(v) for v in os.environ["FOLHA_TRECHO"].split(","))
    first, last = first + round((last - first) * a), first + round((last - first) * b)
count = cols * rows
picks = [first + round((last - first) * k / (count - 1)) for k in range(count)]
tmp = out.with_suffix("")
tmp.mkdir(parents=True, exist_ok=True)
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
select = "+".join(f"eq(n,{offset + p})" for p in picks).replace(",", chr(92) + ",")
subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(video), "-vf", f"select='{select}'", "-fps_mode", "passthrough", str(tmp / "q%03d.png")], check=True)
tiles = [Image.open(p) for p in sorted(tmp.glob("q*.png"))]
if crop:
    tiles = [t.crop(crop) for t in tiles]
w, h = tiles[0].size
scale = min(1.0, 2400 / (w * cols))
tw, th = int(w * scale), int(h * scale)
sheet = Image.new("RGB", (tw * cols, th * rows))
for i, t in enumerate(tiles[:count]):
    sheet.paste(t.resize((tw, th)), ((i % cols) * tw, (i // cols) * th))
sheet.save(out)
for p in tmp.glob("q*.png"):
    p.unlink()
tmp.rmdir()
print(out, "quadros", picks[0], "a", picks[-1], "de", name)
