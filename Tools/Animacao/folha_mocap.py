# Folha comparativa da Fase 1: vídeo real (linha de cima) x prints do mocap.html (CMU à esquerda, Kyrie à direita).
# uso: python folha_mocap.py <video> <pose.json> <pasta_prints> <saida.jpg> [cams=lado,frente]
import sys, os, json, glob
import av
from PIL import Image, ImageDraw

video, pose_path, prints, out = sys.argv[1:5]
cams = (sys.argv[5] if len(sys.argv) > 5 else 'lado,frente').split(',')
info = json.load(open(os.path.join(prints, 'info.json')))
n = info['n']
pose = json.load(open(pose_path))
valid = [q['t'] for q in pose['quadros'] if q['w']]
t0, t1 = valid[0], valid[-1]
times = [t0 + (t1 - t0) * i / n for i in range(n)]

c = av.open(video); st = c.streams.video[0]
c.seek(int(max(0, t0 - 1) / st.time_base), stream=st)
frames = []
want = list(times)
for fr in c.decode(st):
    if not want: break
    if fr.time >= want[0]:
        frames.append(fr.to_image()); want.pop(0)

TW = 420
def fit(im, w=TW):
    im = im.copy(); h = int(im.size[1] * w / im.size[0]); return im.resize((w, h))
rows = [[fit(f) for f in frames]]
for cam in cams:
    rows.append([fit(Image.open(os.path.join(prints, f'{cam}_{i:02d}.png'))) for i in range(n)])
H = sum(r[0].size[1] for r in rows) + 24 * len(rows)
sheet = Image.new('RGB', (TW * n, H), (20, 20, 20)); d = ImageDraw.Draw(sheet)
y = 0
titles = ['Vídeo real (Kyrie)'] + [f'Jogo: CMU (esq.) x Kyrie retargetado (dir.) — câmera {cam}' for cam in cams]
for title, row in zip(titles, rows):
    d.text((6, y + 5), title, fill=(255, 255, 255)); y += 24
    for i, im in enumerate(row): sheet.paste(im, (i * TW, y))
    y += row[0].size[1]
sheet.save(out, quality=88)
print('ok', out)
