"""
Máscaras de zona da roupa costurada (Tools/Animacao/costurar.py, docs/20 "Roupa costurada") para o jogo.

O costurar.py grava, com --zonas, `<peça>_zonas.npy` (peso do tecido e do debrum em cada texel, float16, linhas de baixo
para cima como no Blender) e `<peça>_zonas.json` (as cores lisas). Aqui sai o que o shader de zonas lê
(game/GearColors.ts):

  <peça>_zonas.webp   R = tecido, G = debrum, B = A = 0 (sem perda, com o RGB guardado onde A = 0)
  <peça>_zonas.json   copiado

A máscara sai na orientação da textura gravada no GLB da peça, e confere: a cor da textura dividida pela cor da zona
tem de dar cinza (só a sombra) em cada texel; o erro da orientação certa fica bem abaixo do da virada.

  python -I web/tools/zonas-costura.py <pasta dos npy> <pasta dos GLB> <pasta de saída>
  ex.: python -I web/tools/zonas-costura.py %TEMP%/zonas web/public/assets/gear web/public/assets/look/zonas
"""
import io
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def glb_image(path: Path) -> Image.Image:
    """A primeira imagem embutida no GLB (a textura da peça)."""
    data = path.read_bytes()
    n = struct.unpack_from("<I", data, 12)[0]
    js = json.loads(data[20 : 20 + n])
    bin_off = 20 + n + 8
    bv = js["bufferViews"][js["images"][0]["bufferView"]]
    start = bin_off + bv.get("byteOffset", 0)
    return Image.open(io.BytesIO(data[start : start + bv["byteLength"]])).convert("RGB")


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def main() -> None:
    src, gear, out = map(Path, sys.argv[1:4])
    out.mkdir(parents=True, exist_ok=True)
    for f in sorted(src.glob("*_zonas.npy")):
        piece = f.name[: -len("_zonas.npy")]
        m = np.flipud(np.load(f).astype(np.float32))  # linhas de cima para baixo, como a imagem do GLB
        cores = json.loads((src / f"{piece}_zonas.json").read_text(encoding="utf-8"))["cores"]
        tex = srgb_to_linear(np.asarray(glb_image(gear / f"{piece}.glb").resize((m.shape[1], m.shape[0]))).astype(np.float32) / 255)
        zone = [srgb_to_linear(np.array([int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)])) for h in cores[:2]]

        def gray_error(mm: np.ndarray) -> float:
            ratio = tex / np.maximum(mm[..., :1] * zone[0] + mm[..., 1:2] * zone[1], 1e-3)
            return float(np.abs(ratio - ratio.mean(-1, keepdims=True)).mean())

        ok, flipped = gray_error(m), gray_error(np.flipud(m))
        if ok >= flipped:
            sys.exit(f"{piece}: a máscara não bate com a textura do GLB (erro {ok:.3f}, virada {flipped:.3f})")
        rgba = np.zeros(m.shape[:2] + (4,), dtype=np.uint8)
        rgba[..., 0] = np.clip(m[..., 0] * 255 + 0.5, 0, 255)
        rgba[..., 1] = np.clip(m[..., 1] * 255 + 0.5, 0, 255)
        Image.fromarray(rgba, "RGBA").save(out / f"{piece}_zonas.webp", lossless=True, exact=True, method=6)
        (out / f"{piece}_zonas.json").write_text(json.dumps({"cores": cores}), encoding="utf-8")
        size = (out / f"{piece}_zonas.webp").stat().st_size // 1024
        print(f"{piece:18s} erro de cor {ok:.3f} (virada {flipped:.3f})  {size} KB")


if __name__ == "__main__":
    main()
