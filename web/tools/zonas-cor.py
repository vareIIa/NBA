"""Zonas de cor das peças (docs/26-aparencia.md, fase 2): o que a cor escolhida no menu repinta em cada peça.

As texturas do HY de cada regata, bermuda e tênis têm poucas cores bem separadas (vermelho e branco na regata da
casa; branco, cimento e vermelho no tênis 4...). O script agrupa os pixels da textura em K cores (k-means no espaço
Lab, com a claridade valendo menos que a cor: a dobra escura do vermelho continua vermelha) e grava, por peça:

  <peça>_zonas.webp   R, G, B, A = peso de cada zona (a soma dá 1; borda macia entre as zonas)
  <peça>_zonas.json   {"cores": ["#rrggbb" | null, ...]}: a cor média de cada zona, na ordem dos canais R, G, B, A
                      (a 1ª é a maior, a "principal"); null = zona vazia nesta peça

O shader (src/game/GearColors.ts) troca a cor média de cada zona pela escolhida, guardando o relevo (dobras, costuras).

Uso:
  python -I web/tools/zonas-cor.py web/public/assets/gear web/public/assets/look [pasta de conferência] [peça ...]
"""

import io
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# Zonas por peça: 4 = os 4 canais da máscara (RGBA). Com 3, o vermelho do tênis cimento 4 sumia (cabiam só 3 grupos).
K = 4


def glb_texture(path: Path) -> Image.Image:
    data = path.read_bytes()
    (json_len,) = struct.unpack_from("<I", data, 12)
    gltf = json.loads(data[20 : 20 + json_len])
    bin_start = 20 + json_len + 8
    mat = gltf["materials"][0]
    t = gltf["textures"][mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
    source = t.get("source", t.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))
    img = gltf["images"][source]
    view = gltf["bufferViews"][img["bufferView"]]
    start = bin_start + view.get("byteOffset", 0)
    return Image.open(io.BytesIO(data[start : start + view["byteLength"]])).convert("RGB")


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def kmeans(x: np.ndarray, k: int, iters: int = 30, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    # k-means++ simples
    c = [x[rng.integers(len(x))]]
    for _ in range(1, k):
        d = np.min(((x[:, None, :] - np.array(c)[None]) ** 2).sum(-1), 1)
        c.append(x[rng.choice(len(x), p=d / d.sum())])
    c = np.array(c)
    for _ in range(iters):
        lab = np.argmin(((x[:, None, :] - c[None]) ** 2).sum(-1), 1)
        c = np.array([x[lab == j].mean(0) if np.any(lab == j) else c[j] for j in range(k)])
    return c


def merge_groups(centers: np.ndarray, area: np.ndarray, k: int) -> list[list[int]]:
    """Junta os grupos que são a mesma cor do desenho: mesmo matiz (o vermelho e a sombra dele) e, entre os sem cor,
    claridade parecida. Depois, enquanto sobrar mais que k, o menor entra no mais parecido."""
    lab = centers / np.array([0.45, 1.0, 1.0])
    chroma = np.hypot(lab[:, 1], lab[:, 2])
    hue = np.degrees(np.arctan2(lab[:, 2], lab[:, 1]))
    groups = [[i] for i in range(len(centers))]

    def same(g: list[int], h: list[int]) -> bool:
        for i in g:
            for j in h:
                # Matiz vizinho (o vermelho e o rosa-claro dele, a sombra da cor) é a mesma zona. 26° e não 22°: o rosa
                # claro do vermelho da regata branca passa de 22°.
                if chroma[i] > 18 and chroma[j] > 18 and abs((hue[i] - hue[j] + 180) % 360 - 180) < 26:
                    return True
                # Cinzas e brancos (sem cor) são uma zona só: a claridade do branco da peça varia pouco na cor do desenho.
                if chroma[i] < 12 and chroma[j] < 12 and abs(lab[i, 0] - lab[j, 0]) < 22:
                    return True
        return False

    merged = True
    while merged:
        merged = False
        for a in range(len(groups)):
            for b in range(a + 1, len(groups)):
                if same(groups[a], groups[b]):
                    groups[a] += groups.pop(b)
                    merged = True
                    break
            if merged:
                break
    while len(groups) > k:
        small = min(range(len(groups)), key=lambda g: area[groups[g]].sum())
        g = groups.pop(small)
        near = min(range(len(groups)), key=lambda h: min(((centers[i] - centers[j]) ** 2).sum() for i in g for j in groups[h]))
        groups[near] += g
    return groups


def zones(img: Image.Image, k: int) -> tuple[np.ndarray, list[str]]:
    rgb = np.asarray(img, dtype=np.float32) / 255
    lab = srgb_to_lab(rgb)
    w = np.array([0.45, 1.0, 1.0])  # claridade vale menos: a sombra da dobra não vira outra zona
    feat = lab * w
    sample = feat.reshape(-1, 3)[::7]
    centers = kmeans(sample, k + 3)
    d_all = ((feat[..., None, :] - centers[None, None]) ** 2).sum(-1)  # H, W, n
    lab_all = np.argmin(d_all, -1)
    area_all = np.array([(lab_all == j).mean() for j in range(len(centers))])
    groups = merge_groups(centers, area_all, k)
    # Distância a uma zona = ao centro mais perto entre os dela. Maior zona primeiro (a cor "principal" da peça).
    groups.sort(key=lambda g: -area_all[g].sum())
    d = np.stack([d_all[..., g].min(-1) for g in groups], -1)
    while d.shape[-1] < k:  # peça de menos cores: zona vazia (peso 0)
        d = np.concatenate([d, np.full(d.shape[:-1] + (1,), 1e9)], -1)
    hard = np.argmin(d, -1)
    # Peso macio: softmin da distância (σ ~ 9 unidades Lab), depois um borrão leve para a costura do UV.
    soft = np.exp(-(d - d.min(-1, keepdims=True)) / (2 * 9.0**2))
    soft /= soft.sum(-1, keepdims=True)
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    colors = []
    for j in range(k):
        # Cor da zona: a média dos pixels mais claros dela (a parte iluminada, sem as dobras), que é a cor que a
        # pessoa reconhece na peça.
        px = lin[hard == j]
        if len(px) == 0:
            colors.append(None)  # zona vazia: o canal fica zerado e o JSON diz null (a tela não oferece a cor)
            continue
        luma = px @ np.array([0.2126, 0.7152, 0.0722])
        mean = px[luma >= np.quantile(luma, 0.4)].mean(0)
        srgb = np.where(mean <= 0.0031308, mean * 12.92, 1.055 * mean ** (1 / 2.4) - 0.055)
        colors.append("#" + "".join(f"{round(float(c) * 255):02x}" for c in np.clip(srgb, 0, 1)))
    return soft, colors


def main() -> None:
    gear = Path(sys.argv[1])
    out = Path(sys.argv[2])
    check = Path(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] != "-" else None
    only = set(sys.argv[4:])
    out.mkdir(parents=True, exist_ok=True)
    for f in sorted(gear.glob("*.glb")):
        if only and f.stem not in only:
            continue
        img = glb_texture(f)
        soft, colors = zones(img, K)
        chans = [Image.fromarray(np.clip(soft[..., j] * 255, 0, 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.7)) for j in range(K)]
        Image.merge("RGBA", chans).save(out / f"{f.stem}_zonas.webp", quality=90, method=6)
        (out / f"{f.stem}_zonas.json").write_text(json.dumps({"cores": colors}), encoding="utf-8")
        area = [round(float((np.argmax(soft, -1) == j).mean()) * 100) for j in range(K)]
        print(f"{f.stem}: {colors} área {area}%")
        if check:
            check.mkdir(parents=True, exist_ok=True)
            # Conferência: cada zona pintada da própria cor média, e a mesma peça repintada (azul, amarelo, preto).
            pal = np.array([[int(c[i : i + 2], 16) for i in (1, 3, 5)] if c else (128, 128, 128) for c in colors], dtype=np.float32)
            flat = (soft @ pal).astype(np.uint8)
            Image.fromarray(flat).resize((384, 384)).save(check / f"{f.stem}_zonas.png")


if __name__ == "__main__":
    main()
