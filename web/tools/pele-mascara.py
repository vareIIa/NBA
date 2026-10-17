"""Máscara da pele do jogador (docs/26-aparencia.md): o que o tom de pele escolhido no menu pode repintar.

As texturas do corpo do HY (`Pele`, 2048 px) e da cabeça (`Rosto`, 1024 px) trazem pintados, além da pele, o cabelo, as
sobrancelhas, os olhos, os lábios e (no corpo) restos cinza da cueca que o HY desenhou. O shader do tom de pele
(src/game/SkinTone.ts) multiplica a cor pela razão tom escolhido / tom da textura só onde a máscara manda:

  R = pele (1 = repinta inteiro)    G = cabelo pintado (couro cabeludo; o "careca" da fase do cabelo)    B = lábios

Uso (extrai as texturas do GLB, classifica cada pixel pela cor e grava as máscaras ao lado do jogo):
  python -I web/tools/pele-mascara.py web/public/assets/hoops_player.glb web/public/assets/look [pasta-de-conferencia]

Imprime o tom médio da pele (sRGB), que vai em PlayerLook.ts como `TextureSkin`.
"""

import io
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def glb_images(path: Path) -> dict[str, Image.Image]:
    data = path.read_bytes()
    (json_len,) = struct.unpack_from("<I", data, 12)
    gltf = json.loads(data[20 : 20 + json_len])
    bin_start = 20 + json_len + 8
    out: dict[str, Image.Image] = {}
    for mat in gltf["materials"]:
        tex = mat.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        if tex is None:
            continue
        t = gltf["textures"][tex["index"]]
        source = t.get("source", t.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))
        img = gltf["images"][source]
        view = gltf["bufferViews"][img["bufferView"]]
        start = bin_start + view.get("byteOffset", 0)
        out[mat["name"]] = Image.open(io.BytesIO(data[start : start + view["byteLength"]])).convert("RGB")
    return out


def hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn + 1e-6
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    s = np.where(mx > 1e-6, (mx - mn) / (mx + 1e-6), 0)
    return h, s, mx


def smooth(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def classify(img: Image.Image, face: bool) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rgb = np.asarray(img, dtype=np.float32) / 255
    h, s, v = hsv(rgb)
    # Frio (azul, ciano): o branco do olho do HY é branco-azulado, a íris é azul-escura e a cueca pintada é cinza-azulada.
    # A pele, mesmo no brilho da testa e do nariz, é rosada (quente). Sem saturação o matiz não vale: não é frio.
    cool = smooth(h, 150, 170) * (1 - smooth(h, 260, 285)) * smooth(s, 0.04, 0.1)
    # Cabelo pintado: escuro. A pele em sombra (v ~0,25) conta pela metade.
    hair = 1 - smooth(v, 0.18, 0.32)
    skin = (1 - cool) * (1 - hair)
    if face:
        # Brilho do olho (catchlight) e branco puro: só no rosto (no corpo, branco puro é o brilho da pele).
        skin = skin * (1 - (1 - smooth(s, 0.03, 0.07)) * smooth(v, 0.72, 0.86))
    # Lábios e orelhas (vermelho saturado) ficam na pele e escurecem com ela; o canal B guarda os lábios para a cor de
    # boca de uma fase seguinte.
    red = smooth(np.minimum(np.abs(((h + 180) % 360) - 180), 30), 30, 14)
    lip = red * smooth(s, 0.5, 0.62) * smooth(v, 0.35, 0.5)
    return skin, hair, lip


def to_img(a: np.ndarray, blur: float) -> Image.Image:
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8), "L")
    # Abre a pele 2 px para fora da ilha (o filtro bilinear da GPU mistura o fundo nas costuras) e suaviza a borda.
    im = im.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(blur))
    return im


def main() -> None:
    glb = Path(sys.argv[1])
    out = Path(sys.argv[2])
    check = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    out.mkdir(parents=True, exist_ok=True)
    images = glb_images(glb)
    samples = []
    for name, file in (("Pele", "pele_mascara"), ("Rosto", "rosto_mascara")):
        img = images[name]
        skin, hair, lip = classify(img, face=name == "Rosto")
        blur = 1.2 if img.width > 1024 else 0.8
        mask = Image.merge("RGB", (to_img(skin, blur), to_img(hair, blur), to_img(lip, blur)))
        mask.save(out / f"{file}.webp", quality=90, method=6)
        rgb = np.asarray(img, dtype=np.float32) / 255
        sure = skin > 0.9
        samples.append(rgb[sure])
        print(f"{name}: {img.width} px, pele {sure.mean() * 100:.1f}% (certa), cabelo {(hair > 0.5).mean() * 100:.1f}%, lábio {(lip > 0.5).mean() * 100:.1f}%")
        if check:
            check.mkdir(parents=True, exist_ok=True)
            mask.resize((512, 512)).save(check / f"{file}.png")
            # Conferência: a pele repintada de um tom escuro (só a razão, como o shader).
            lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
            m = np.asarray(mask, dtype=np.float32)[..., :1] / 255
            ratio = np.array([0.095, 0.052, 0.034]) / np.array([0.62, 0.36, 0.29])
            dark = lin * (1 - m + m * ratio)
            srgb = np.where(dark <= 0.0031308, dark * 12.92, 1.055 * dark ** (1 / 2.4) - 0.055)
            Image.fromarray(np.clip(srgb * 255, 0, 255).astype(np.uint8)).resize((512, 512)).save(check / f"{file}_escuro.png")
    allskin = np.concatenate(samples)
    lin = np.where(allskin <= 0.04045, allskin / 12.92, ((allskin + 0.055) / 1.055) ** 2.4)
    mean = lin.mean(0)
    srgb = np.where(mean <= 0.0031308, mean * 12.92, 1.055 * mean ** (1 / 2.4) - 0.055)
    print("tom médio da pele (sRGB): #" + "".join(f"{round(c * 255):02x}" for c in srgb), "linear", np.round(mean, 4).tolist())


if __name__ == "__main__":
    main()
