"""
Desenha o BVH convertido como "boneco de palitos" (frente e lado) em alguns quadros, para conferir um take
sem abrir o Blender. Opcional: ao lado, os pontos 3D originais do Pose2Sim (.trc), na mesma escala e girados
para a mesma frente, para comparar a conversão.

Uso:  python ver_bvh.py <take.bvh> <saida.png> [--quadros 0,30,60] [--trc pose-3d/take_filt.trc]
Precisa: numpy e matplotlib.
"""
import argparse
import math
import re

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

CENTRO = {"root", "lowerback", "upperback", "thorax", "lowerneck", "upperneck", "head", "Hip", "Neck", "Head", "Nose"}


def rot(eixo, graus):
    c, s = math.cos(math.radians(graus)), math.sin(math.radians(graus))
    return {"X": np.array([[1, 0, 0], [0, c, -s], [0, s, c]]),
            "Y": np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]),
            "Z": np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[eixo]


def ler_bvh(caminho):
    """→ (juntas [{nome, pai, offset, canais, fim}], quadros (N, C), dt). fim = offset do End Site (ou None)."""
    juntas, pilha, atual = [], [], None
    with open(caminho) as arq:
        linhas = [linha.strip() for linha in arq]
    i = 0
    while not linhas[i].startswith("MOTION"):
        tok = linhas[i].split()
        i += 1
        if not tok:
            continue
        if tok[0] in ("ROOT", "JOINT"):
            pai = next((x[1] for x in reversed(pilha) if x[0] == "junta"), None)
            juntas.append({"nome": tok[1], "pai": pai, "fim": None})
            atual = ("junta", len(juntas) - 1)
        elif tok[0] == "End":
            atual = ("fim", pilha[-1][1])
        elif tok[0] == "{":
            pilha.append(atual)
        elif tok[0] == "}":
            pilha.pop()
        elif tok[0] == "OFFSET":
            juntas[atual[1]]["offset" if atual[0] == "junta" else "fim"] = np.array([float(v) for v in tok[1:4]])
        elif tok[0] == "CHANNELS":
            juntas[atual[1]]["canais"] = tok[2:]
    dt = float(linhas[i + 2].split(":")[1])
    quadros = np.array([[float(v) for v in linha.split()] for linha in linhas[i + 3:] if linha])
    return juntas, quadros, dt


def fk_bvh(juntas, quadro):
    """Posições (cm) do início e do fim de cada junta num quadro. A raiz usa a posição absoluta dos canais."""
    pos, glob, segmentos = {}, {}, []
    k = 0
    for j, junta in enumerate(juntas):
        r = np.eye(3)
        t = None
        for canal in junta["canais"]:
            v = quadro[k]
            k += 1
            if canal.endswith("position"):
                t = np.zeros(3) if t is None else t
                t["XYZ".index(canal[0])] = v
            else:
                r = r @ rot(canal[0], v)
        pai = junta["pai"]
        if pai is None:
            pos[j], glob[j] = t, r
        else:
            pos[j] = pos[pai] + glob[pai] @ junta["offset"]
            glob[j] = glob[pai] @ r
            segmentos.append((pos[pai], pos[j], juntas[pai]["nome"]))
        if junta["fim"] is not None:
            segmentos.append((pos[j], pos[j] + glob[j] @ junta["fim"], junta["nome"]))
    return segmentos


def cor(nome):
    """Lado esquerdo em azul, direito em vermelho, centro em preto."""
    if nome in CENTRO:
        return "black"
    return {"l": "tab:blue", "L": "tab:blue", "r": "tab:red", "R": "tab:red"}.get(nome[:1], "black")


LIGACOES = [("Hip", "LHip"), ("Hip", "RHip"), ("Hip", "Neck"), ("Neck", "Head"), ("Neck", "Nose"),
            ("Neck", "LShoulder"), ("Neck", "RShoulder")] + [
    (L + a, L + b) for L in "LR" for a, b in (
        ("Hip", "Knee"), ("Knee", "Ankle"), ("Ankle", "Heel"), ("Heel", "BigToe"), ("Ankle", "BigToe"),
        ("BigToe", "SmallToe"), ("Shoulder", "Elbow"), ("Elbow", "Wrist"), ("Wrist", "Index"), ("Wrist", "Pinky"),
        ("Index", "Middle1"), ("Middle1", "Ring1"), ("Ring1", "Pinky"), ("Index", "Index4"), ("Middle1", "Middle4"),
        ("Pinky", "Pinky4"), ("Wrist", "Thumb1"), ("Thumb1", "Thumb"), ("Thumb", "Thumb4"), ("Ear", "Eye"))]


def segmentos_trc(pontos, quadro):
    p = {k: v[quadro] for k, v in pontos.items()}
    if "LHip" in p and "Hip" not in p:
        p["Hip"] = (p["LHip"] + p["RHip"]) / 2
    if "LShoulder" in p and "Neck" not in p:
        p["Neck"] = (p["LShoulder"] + p["RShoulder"]) / 2
    return [(p[a], p[b], b) for a, b in LIGACOES if a in p and b in p]


def preparar_trc(caminho, escala_alvo):
    """Lê o .trc, gira para o corpo olhar para +Z, centra no 1º quadro e escala para o tamanho do BVH."""
    import pose2sim_para_bvh as conv
    _, pts = conv.ler_trc(caminho)
    lat = np.mean(pts["LHip"] - pts["RHip"], axis=0)
    yaw = math.atan2(lat[2], lat[0])  # leva a largura dos quadris para +X (corpo olhando para +Z)
    r = rot("Y", math.degrees(yaw))
    centro = (pts["LHip"][0] + pts["RHip"][0]) / 2 * np.array([1, 0, 1])
    perna = np.median(np.linalg.norm(pts["LKnee"] - pts["LHip"], axis=1)
                      + np.linalg.norm(pts["LAnkle"] - pts["LKnee"], axis=1))
    s = escala_alvo / perna
    return {k: ((v - centro) @ r.T) * s for k, v in pts.items()}


def desenhar(ax, segmentos, eixo_h, titulo, limites):
    for a, b, nome in segmentos:
        ax.plot([a[eixo_h], b[eixo_h]], [a[1], b[1]], "-", color=cor(nome), lw=2)
        ax.plot([b[eixo_h]], [b[1]], "o", color=cor(nome), ms=2.5)
    ax.axhline(0, color="0.6", lw=1)
    ax.set_xlim(*limites[0])
    ax.set_ylim(*limites[1])
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_title(titulo, fontsize=8)


def centro_mao(segmentos, nome):
    return next(a for a, _, n in segmentos if n == nome)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bvh")
    ap.add_argument("saida")
    ap.add_argument("--quadros", default=None, help="lista separada por vírgula (padrão: 4 quadros espaçados)")
    ap.add_argument("--trc", default=None, help=".trc original do Pose2Sim para comparar")
    ap.add_argument("--mao", choices=["l", "r"], default=None, help="zoom na mão esquerda (l) ou direita (r)")
    args = ap.parse_args()

    juntas, quadros, dt = ler_bvh(args.bvh)
    n = len(quadros)
    if args.quadros:
        lista = [int(q) for q in args.quadros.split(",")]
    else:
        lista = [int(round(x)) for x in np.linspace(0, n - 1, 4)]
    trc = None
    if args.trc:
        nomes = [j["nome"] for j in juntas]
        perna = sum(np.linalg.norm(juntas[nomes.index(o)]["offset"]) for o in ("ltibia", "lfoot"))
        trc = preparar_trc(args.trc, perna)
    linhas = 2 if trc is not None else 1
    fig, axs = plt.subplots(linhas, 2 * len(lista), figsize=(2.0 * 2 * len(lista), 3.6 * linhas), squeeze=False)

    def painel(linha, col, seg, titulo, centro):
        pts = np.array([p for s in seg for p in s[:2]])
        if args.mao:
            r = 18.0
            lim_y = (centro[1] - r, centro[1] + r)
        else:
            r, centro = 90.0, pts.mean(axis=0)
            lim_y = (-10, max(200, pts[:, 1].max() + 10))
        desenhar(axs[linha, col], seg, 0, titulo + " frente", ((centro[0] - r, centro[0] + r), lim_y))
        desenhar(axs[linha, col + 1], seg, 2, "lado", ((centro[2] - r, centro[2] + r), lim_y))

    for c, q in enumerate(lista):
        seg = fk_bvh(juntas, quadros[q])
        centro = centro_mao(seg, args.mao + "wrist") if args.mao else None
        painel(0, 2 * c, seg, "BVH q{} ({:.2f} s)".format(q, q * dt), centro)
        if trc is not None:
            k = min(q, len(next(iter(trc.values()))) - 1)
            centro = trc[args.mao.upper() + "Wrist"][k] if args.mao else None
            painel(1, 2 * c, segmentos_trc(trc, k), "pontos .trc q{}".format(k), centro)
    fig.suptitle("{}  (azul = esquerda, vermelho = direita; frente: de frente para o atleta; "
                 "lado: perfil direito, rosto para a direita)".format(re.split(r"[\\/]", args.bvh)[-1]), fontsize=9)
    fig.tight_layout()
    fig.savefig(args.saida, dpi=80)
    print("PNG gravado:", args.saida)


if __name__ == "__main__":
    main()
