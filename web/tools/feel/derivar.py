"""Deriva métricas de corpo/bola por quadro e lista os quiques da bola no chão.

Uso: python -I derivar.py <medidas.csv> <saida.csv> [--limite-quique 0.15] [--separacao 5] [--raio-min 0.8]

Os padrões reproduzem os CSVs do 2K em docs/dev/drible-2k/dados/. Para os quiques do 2K use o medir.py com
--bola-perto e aqui --limite-quique 0.35 --raio-min 0.8 (validação em docs/dev/drible-2k/quiques-2k.md).

Entrada: o CSV do medir.py (ou qualquer CSV com as mesmas colunas, como os landmarks ideais que o calibrar.py monta
a partir do motor). Unidades: tudo dividido pelo "tamanho do corpo" S = distância ombro-médio -> tornozelo-médio (px)
no próprio quadro, então 1.0 ~= 1,45 m num jogador de 1,86 m. Ângulos em graus.

Colunas: quadril_altura (quadril médio acima do tornozelo médio), base_largura (tornozelos na horizontal da imagem),
base_vs_ombros, tronco_inclinacao (+ = para a direita da tela), tronco_rotacao (largura aparente dos ombros: cai quando
o tronco gira), centro_x, [l|r]punho_altura/_lado, bola_altura/_lado e quique (1 no quadro do quique).
"""
import argparse
import csv
import math
import sys


def num(r, k):
    v = r.get(k)
    if v in (None, ''):
        return None
    return float(v)


def mid(r, a, b):
    ax, ay, bx, by = num(r, a + '_x'), num(r, a + '_y'), num(r, b + '_x'), num(r, b + '_y')
    if None in (ax, ay, bx, by):
        return None
    return ((ax + bx) / 2, (ay + by) / 2)


def derivar_quadro(r):
    """Uma linha do medir.py -> métricas normalizadas por S (dict; vazio de pose se faltar ombro/quadril/tornozelo)."""
    sh, hip, ank = mid(r, 'lsh', 'rsh'), mid(r, 'lhip', 'rhip'), mid(r, 'lank', 'rank')
    d = {'frame': r.get('frame'), 't': r.get('t'), 'diff': r.get('diff')}
    if not (sh and hip and ank):
        return d
    S = math.hypot(sh[0] - ank[0], sh[1] - ank[1]) or 1
    shw = abs(num(r, 'lsh_x') - num(r, 'rsh_x')) or 1
    d['S_px'] = round(S, 1)
    d['quadril_altura'] = round((ank[1] - hip[1]) / S, 3)  # cai quando agacha
    d['base_largura'] = round(abs(num(r, 'lank_x') - num(r, 'rank_x')) / S, 3)
    d['base_vs_ombros'] = round(abs(num(r, 'lank_x') - num(r, 'rank_x')) / shw, 2)
    d['tronco_inclinacao'] = round(math.degrees(math.atan2(sh[0] - hip[0], hip[1] - sh[1])), 1)  # + = p/ direita da tela
    d['tronco_rotacao'] = round(shw / S, 3)  # largura aparente dos ombros: cai quando o tronco gira
    d['centro_x'] = round(hip[0] / S, 3)
    for side in ('l', 'r'):
        wx, wy = num(r, side + 'wr_x'), num(r, side + 'wr_y')
        if wx is not None:
            d[side + 'punho_altura'] = round((ank[1] - wy) / S, 3)
            d[side + 'punho_lado'] = round((wx - hip[0]) / S, 3)
    bx, by = num(r, 'ball_x'), num(r, 'ball_y')
    if bx is not None:
        d['bola_altura'] = round((ank[1] - by) / S, 3)
        d['bola_lado'] = round((bx - hip[0]) / S, 3)
    return d


def achar_quiques(alturas, limite=0.15, separacao=5):
    """Quiques: mínimos locais de bola_altura perto do chão (< limite S), separados por >= `separacao` quadros."""
    bounces = []
    h = alturas
    for i in range(2, len(h) - 2):
        if h[i] is None or h[i] > limite:
            continue
        win = [x for x in h[i - 2:i + 3] if x is not None]
        if h[i] == min(win) and (not bounces or i - bounces[-1] >= separacao):
            bounces.append(i)
    return bounces


def alturas_para_quique(rows, derived, raio_min=None):
    """bola_altura de cada quadro; com raio_min (fração), descarta as manchas com raio < raio_min × o raio mediano da
    bola no vídeo: quando a bola some, o detector de cor pega o joelho ou outro objeto pequeno (docs/dev/drible-2k/quiques-2k.md)."""
    h = [d.get('bola_altura') for d in derived]
    if not raio_min:
        return h
    raios = [num(r, 'ball_r') for r in rows if num(r, 'ball_r') is not None]
    if not raios:
        return h
    corte = raio_min * sorted(raios)[len(raios) // 2]
    return [x if (x is not None and (num(r, 'ball_r') or 0) >= corte) else None for x, r in zip(h, rows)]


def derivar(rows, limite=0.15, separacao=5, raio_min=None):
    """Todas as linhas -> (métricas por quadro com a coluna quique, índices dos quiques)."""
    derived = [derivar_quadro(r) for r in rows]
    bounces = achar_quiques(alturas_para_quique(rows, derived, raio_min), limite, separacao)
    for d in derived:
        d['quique'] = ''
    for i in bounces:
        derived[i]['quique'] = 1
    return derived, bounces


def escrever(derived, out):
    keys = []
    for d in derived:
        for k in d:
            if k not in keys:
                keys.append(k)
    with open(out, 'w', newline='') as fo:
        w = csv.DictWriter(fo, fieldnames=keys)
        w.writeheader()
        w.writerows(derived)


def main(argv=None):
    p = argparse.ArgumentParser(description='Métricas normalizadas por S e quiques.')
    p.add_argument('medidas')
    p.add_argument('saida')
    p.add_argument('--limite-quique', type=float, default=0.15, help='altura máxima (S) de um quique')
    p.add_argument('--separacao', type=int, default=5, help='quadros mínimos entre quiques')
    p.add_argument('--raio-min', type=float, default=None,
                   help='só conta quique com a mancha da bola >= esta fração do raio mediano (ex.: 0.8; o joelho tem metade do raio)')
    a = p.parse_args(argv)
    with open(a.medidas) as f:
        rows = list(csv.DictReader(f))
    derived, bounces = derivar(rows, a.limite_quique, a.separacao, a.raio_min)
    escrever(derived, a.saida)
    ts = [float(derived[i]['t']) for i in bounces]
    gaps = [round(b - a, 3) for a, b in zip(ts, ts[1:])]
    print(f'{len(bounces)} quiques; tempos: {[round(t, 2) for t in ts]}')
    print(f'intervalos (s): {gaps}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
