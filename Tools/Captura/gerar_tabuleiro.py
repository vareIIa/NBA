"""
Gera o tabuleiro de xadrez da calibração das lentes (intrínseca) em PDF, no tamanho real do papel.

Uso:  python gerar_tabuleiro.py tabuleiro_A3.pdf [--papel A3|A2|A4] [--casas 5x8] [--lado-mm 50]

Padrão: A3 paisagem, 5×8 casas de 50 mm → cantos INTERNOS [4, 7] (o que vai no Config_garrafao.toml).
Imprima em "tamanho real / 100%" (sem "ajustar à página"), cole numa placa rígida e plana (MDF, foam board) e
MEÇA uma casa com régua: o valor medido (mm) vai em intrinsics_square_size. A linha de 100 mm na folha confere a
escala da impressora. Número de casas ímpar × par evita que o tabuleiro seja lido de cabeça para baixo.
Precisa: matplotlib.
"""
import argparse

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

PAPEIS = {"A4": (297, 210), "A3": (420, 297), "A2": (594, 420)}  # paisagem, mm


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("saida", help="arquivo .pdf")
    ap.add_argument("--papel", choices=PAPEIS, default="A3")
    ap.add_argument("--casas", default="5x8", help="linhas x colunas de CASAS (não de cantos)")
    ap.add_argument("--lado-mm", type=float, default=None, help="lado da casa; padrão: o maior que cabe")
    args = ap.parse_args()

    largura, altura = PAPEIS[args.papel]
    linhas, colunas = (int(v) for v in args.casas.lower().split("x"))
    margem = 20.0  # borda branca (o detector precisa dela) + espaço para o texto
    lado = args.lado_mm or int(min((largura - 2 * margem) / colunas, (altura - 2 * margem - 10) / linhas))
    x0 = (largura - colunas * lado) / 2
    y0 = (altura - linhas * lado) / 2 + 5

    fig = plt.figure(figsize=(largura / 25.4, altura / 25.4))
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, largura)
    ax.set_ylim(0, altura)
    ax.axis("off")
    for i in range(linhas):
        for j in range(colunas):
            if (i + j) % 2 == 0:
                ax.add_patch(Rectangle((x0 + j * lado, y0 + i * lado), lado, lado, color="black", lw=0))
    ax.plot([margem, margem + 100], [8, 8], color="black", lw=1)
    ax.text(margem + 105, 8, "100 mm", va="center", fontsize=7)
    legenda = "{} · {}×{} casas de {:.0f} mm · cantos internos [{}, {}] · imprimir a 100%".format(
        args.papel, linhas, colunas, lado, linhas - 1, colunas - 1)
    ax.text(largura - margem, 8, legenda, ha="right", va="center", fontsize=7)
    fig.savefig(args.saida)
    print("{}: {}×{} casas de {:.0f} mm → intrinsics_corners_nb = [{}, {}], intrinsics_square_size = {:.0f}".format(
        args.saida, linhas, colunas, lado, linhas - 1, colunas - 1, lado))


if __name__ == "__main__":
    main()
