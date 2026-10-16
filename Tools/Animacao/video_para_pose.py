# Prova de video->mocap com MediaPipe Pose (CPU).
# uso: python mp_pose.py <video> <t0> <t1> <model> <saida_dir> [crop x0,y0,x1,y1 em fracao]
import sys, json, os
import av
import numpy as np
from PIL import Image, ImageDraw
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

video, t0, t1, model, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4], sys.argv[5]
crop = [float(x) for x in sys.argv[6].split(',')] if len(sys.argv) > 6 else None
os.makedirs(out, exist_ok=True)
opts = vision.PoseLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.VIDEO, num_poses=3)
det = vision.PoseLandmarker.create_from_options(opts)
c = av.open(video); st = c.streams.video[0]
c.seek(int(max(0, t0 - 1) / st.time_base), stream=st)
frames = []
CONN = [(11,12),(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),(23,24),(23,25),(25,27),(24,26),(26,28),(27,31),(28,32)]
prev_center = None
for fr in c.decode(st):
    t = float(fr.time)
    if t < t0: continue
    if t > t1: break
    im = fr.to_image()
    if crop:
        W, H = im.size; im = im.crop((int(crop[0]*W), int(crop[1]*H), int(crop[2]*W), int(crop[3]*H)))
    arr = np.asarray(im.convert('RGB'))
    res = det.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=arr), int(t * 1000))
    rec = {'t': t, 'img': None, 'world': None}
    if res.pose_landmarks:
        # pessoa mais perto da anterior (ou a maior)
        def center(lm): return np.mean([[p.x, p.y] for p in lm], axis=0)
        def size(lm): ys = [p.y for p in lm]; return max(ys) - min(ys)
        idx = min(range(len(res.pose_landmarks)), key=lambda i: np.linalg.norm(center(res.pose_landmarks[i]) - prev_center)) if prev_center is not None else max(range(len(res.pose_landmarks)), key=lambda i: size(res.pose_landmarks[i]))
        lm = res.pose_landmarks[idx]; prev_center = center(lm)
        rec['img'] = [[p.x, p.y, p.visibility] for p in lm]
        rec['world'] = [[p.x, p.y, p.z] for p in res.pose_world_landmarks[idx]]
    frames.append((im, rec))
json.dump([r for _, r in frames], open(os.path.join(out, 'pose.json'), 'w'))
# folha: 8 quadros com o esqueleto 2D por cima + vista lateral 3D (world) embaixo
pick = np.linspace(0, len(frames) - 1, 8).astype(int)
tw = 300
tiles = []
for i in pick:
    im, rec = frames[i]
    im = im.copy(); W, H = im.size; d = ImageDraw.Draw(im)
    side = Image.new('RGB', (W, H), (25, 25, 25)); ds = ImageDraw.Draw(side)
    if rec['img']:
        P = rec['img']
        for a, b in CONN: d.line([(P[a][0]*W, P[a][1]*H), (P[b][0]*W, P[b][1]*H)], fill=(0, 255, 0), width=3)
        Wd = rec['world']
        # vista lateral: z (profundidade) no eixo x, y para baixo
        for a, b in CONN:
            col = (80, 160, 255) if (a % 2 == 1) else (255, 100, 180)
            ds.line([(W/2 + Wd[a][2]*W*0.6, H/2 + Wd[a][1]*H*0.6), (W/2 + Wd[b][2]*W*0.6, H/2 + Wd[b][1]*H*0.6)], fill=col, width=3)
    col = Image.new('RGB', (W, H*2)); col.paste(im, (0, 0)); col.paste(side, (0, H))
    col.thumbnail((tw, tw*4)); tiles.append(col)
sheet = Image.new('RGB', (sum(t.size[0] for t in tiles), max(t.size[1] for t in tiles)))
x = 0
for t in tiles: sheet.paste(t, (x, 0)); x += t.size[0]
sheet.save(os.path.join(out, 'folha.jpg'))
ok = sum(1 for _, r in frames if r['img'])
print(f'quadros {len(frames)} detectados {ok}')
