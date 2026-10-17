"""Calibração do pipeline de vídeo (medir.py -> derivar.py) contra a verdade do motor (docs/27 §5, Fase 1).

Uso: python -I calibrar.py <pasta_video> <saida.json>

Para cada vídeo listado em <pasta_video>/indice.json (gravados pelo motor.mjs com a câmera atrás e acima, a 30 fps):
  - <cenario>.verdade.json: o motor nos quadros gravados (juntas em metros e os landmarks projetados na imagem);
  - <cenario>.medidas.csv: o medir.py com o MediaPipe nesse vídeo.

Três versões de cada métrica por quadro:
  verdade = o motor em metros / S (1,45 m), nas definições de golpes.corpo();
  ideal   = derivar.py sobre os landmarks PROJETADOS do motor (um detector de pose perfeito);
  video   = derivar.py sobre o MediaPipe (o que o pipeline mediu no 2K).
Erro de geometria = ideal − verdade (perspectiva da câmera e S do próprio quadro); erro do detector = video − ideal;
erro total = video − verdade. O erro total é a margem de confiança dos números do 2K (que saíram do mesmo pipeline).

Também calibra as métricas derivadas que a régua usa (nível do quadril, queda, inclinação máxima, varredura, velocidade
de pico do tronco, base mínima e máxima, cabeça, quiques), calculadas igual nas três versões.
"""
import csv
import json
import math
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from derivar import achar_quiques, derivar_quadro  # noqa: E402
from golpes import S_REGUA_M, corpo, s_do_jogador  # noqa: E402

# (coluna do derivar.py, chave de golpes.corpo, unidade)
PARES = [
    ('quadril_altura', 'quadril', 'S'),
    ('base_largura', 'base', 'S'),
    ('tronco_inclinacao', 'inclinacao', 'graus'),
    ('tronco_rotacao', 'ombros_aparentes', 'S'),
    ('lpunho_altura', 'punho_l_alt', 'S'),
    ('rpunho_altura', 'punho_r_alt', 'S'),
    ('lpunho_lado', 'punho_l_lado', 'S'),
    ('rpunho_lado', 'punho_r_lado', 'S'),
    ('bola_altura', 'bola_alt', 'S'),
    ('bola_lado', 'bola_lado', 'S'),
    ('cabeca', 'cabeca', 'S'),
]
LANDMARKS = ['nose', 'lsh', 'rsh', 'lwr', 'rwr', 'lhip', 'rhip', 'lknee', 'rknee', 'lank', 'rank']


def linha_ideal(f):
    """Quadro do motor -> linha no formato do medir.py com os landmarks projetados (px)."""
    r = {'frame': f['f'], 't': f['t'], 'diff': ''}
    for k in LANDMARKS:
        x, y = f['lm'][k]
        r[k + '_x'], r[k + '_y'] = x, y
    bx, by, br = f['lm']['ball']
    r['ball_x'], r['ball_y'], r['ball_r'] = bx, by, br
    return r


def cabeca_do_video(r):
    """(ombro médio − nariz) / S na imagem: a altura da cabeça (E-C mediu o desvio padrão disso)."""
    try:
        shy = (float(r['lsh_y']) + float(r['rsh_y'])) / 2
        shx = (float(r['lsh_x']) + float(r['rsh_x'])) / 2
        anx = (float(r['lank_x']) + float(r['rank_x'])) / 2
        any_ = (float(r['lank_y']) + float(r['rank_y'])) / 2
        S = math.hypot(shx - anx, shy - any_) or 1
        return (shy - float(r['nose_y'])) / S
    except (KeyError, ValueError, TypeError):
        return None


def plausivel(d, s_med):
    """Filtro de pose-lixo, o mesmo critério que os agentes usaram no 2K (E-B: S_px desabando no corte, inclinação de
    −34° num quadro só): S do quadro a ±25% da mediana do vídeo, |inclinação| ≤ 60° e quadril entre 0,2 e 0,9 S."""
    if 'S_px' not in d or not s_med:
        return False
    return abs(d['S_px'] / s_med - 1) <= 0.25 and abs(d.get('tronco_inclinacao', 0)) <= 60 and 0.2 <= d.get('quadril_altura', 0) <= 0.9


def stats(erros):
    e = [x for x in erros if x is not None]
    if not e:
        return {'n': 0}
    ab = sorted(abs(x) for x in e)
    return {
        'n': len(e),
        'vies': statistics.fmean(e),
        'dp': statistics.pstdev(e) if len(e) > 1 else 0.0,
        'rms': math.sqrt(statistics.fmean(x * x for x in e)),
        'p90_abs': ab[min(len(ab) - 1, int(0.9 * len(ab)))],
        'max_abs': ab[-1],
    }


def serie(rows, key):
    return [r.get(key) for r in rows]


def resumo_derivado(s):
    """Métricas derivadas de uma série (dict de listas a 30 fps) — iguais para verdade, ideal e vídeo."""
    def ok(xs):
        return [x for x in xs if x is not None]

    q, b, inc, omb, cab = ok(s['quadril']), ok(s['base']), s['inclinacao'], ok(s['ombros']), ok(s['cabeca'])
    out = {}
    if q:
        out['nivel_quadril'] = statistics.median(q)
        out['queda_quadril'] = statistics.median(q[:6]) - min(q)
    if b:
        out['nivel_base'] = statistics.median(b)
        out['base_min'] = min(b)
        out['base_max'] = max(b)
    inc_ok = ok(inc)
    if inc_ok:
        out['inclinacao_max_abs'] = max(abs(x) for x in inc_ok)
        out['varredura_tronco'] = max(inc_ok) - min(inc_ok)
        vel = [abs(b2 - a2) * 30 for a2, b2 in zip(inc, inc[1:]) if a2 is not None and b2 is not None]
        out['vel_tronco_pico'] = max(vel) if vel else None
    if omb:
        out['ombros_min'] = min(omb)
    if len(cab) > 1:
        out['cabeca_desvio'] = statistics.pstdev(cab)
    return out


def casar_quiques(verdade, medidos, tol=2):
    """Casa quiques (índices de quadro) com tolerância de `tol` quadros: (pares, perdidos, falsos)."""
    usados = set()
    pares = []
    for t in verdade:
        cand = [m for m in medidos if abs(m - t) <= tol and m not in usados]
        if cand:
            m = min(cand, key=lambda x: abs(x - t))
            usados.add(m)
            pares.append((t, m))
    return pares, len(verdade) - len(pares), len([m for m in medidos if m not in usados])


def calibrar(pasta):
    idx = json.load(open(os.path.join(pasta, 'indice.json'), encoding='utf-8'))
    por_quadro = {k: {'geometria': [], 'detector': [], 'total': []} for k, _, _ in PARES}
    derivadas = {}
    quiques = {'verdade': 0, 'casados': 0, 'perdidos': 0, 'falsos': 0, 'erro_q': [], 'ideal_casados': 0}
    troca_lr = [0, 0]
    det = {'quadros': 0, 'pose': 0, 'bola': 0}
    videos = []
    for v in idx['videos']:
        nome = v['cenario']
        ver = json.load(open(os.path.join(pasta, v['verdade']), encoding='utf-8'))
        caminho = os.path.join(pasta, nome + '.medidas.csv')
        if not os.path.exists(caminho):
            continue
        med = list(csv.DictReader(open(caminho)))
        frames = ver['frames']
        n = min(len(frames), len(med))
        S = s_do_jogador(ver.get('alturaJogador') or 1.86)
        tru = [corpo(f, S) for f in frames[:n]]
        ide_rows = [linha_ideal(f) for f in frames[:n]]
        ide = [derivar_quadro(r) for r in ide_rows]
        vid = [derivar_quadro(r) for r in med[:n]]
        for i in range(n):
            ide[i]['cabeca'] = cabeca_do_video(ide_rows[i])
            vid[i]['cabeca'] = cabeca_do_video(med[i])
        s_med = statistics.median([d['S_px'] for d in vid if 'S_px' in d] or [0])
        lixo = 0
        for i in range(n):
            if 'S_px' in vid[i] and not plausivel(vid[i], s_med):
                lixo += 1
                bola = {k: vid[i][k] for k in ('bola_altura', 'bola_lado') if k in vid[i]}
                vid[i] = {'frame': vid[i].get('frame'), **bola}  # descarta a pose; a bola fica (vem do detector de cor)
        det['descartados'] = det.get('descartados', 0) + lixo
        det['quadros'] += n
        det['pose'] += sum(1 for d in vid if 'S_px' in d)
        det['bola'] += sum(1 for r in med[:n] if r.get('ball_x'))
        for col, key, _ in PARES:
            for i in range(n):
                t, a, b = tru[i].get(key), ide[i].get(col), vid[i].get(col)
                if t is not None and a is not None:
                    por_quadro[col]['geometria'].append(a - t)
                if a is not None and b is not None:
                    por_quadro[col]['detector'].append(b - a)
                if t is not None and b is not None:
                    por_quadro[col]['total'].append(b - t)
        # Troca esquerda/direita do MediaPipe nos punhos (comum de costas, E-A/E-D).
        for i in range(n):
            r, p = med[i], ide_rows[i]
            try:
                lx, ly, rx, ry = (float(r[k]) for k in ('lwr_x', 'lwr_y', 'rwr_x', 'rwr_y'))
            except (KeyError, ValueError):
                continue
            certo = math.hypot(lx - p['lwr_x'], ly - p['lwr_y']) + math.hypot(rx - p['rwr_x'], ry - p['rwr_y'])
            trocado = math.hypot(lx - p['rwr_x'], ly - p['rwr_y']) + math.hypot(rx - p['lwr_x'], ry - p['lwr_y'])
            troca_lr[1] += 1
            if trocado < certo * 0.7:
                troca_lr[0] += 1
        # Derivadas por vídeo.
        def montar(rows, mapa):
            return {nome_s: [r.get(k) for r in rows] for nome_s, k in mapa.items()}

        s_tru = montar(tru, {'quadril': 'quadril', 'base': 'base', 'inclinacao': 'inclinacao', 'ombros': 'ombros_aparentes', 'cabeca': 'cabeca'})
        s_ide = montar(ide, {'quadril': 'quadril_altura', 'base': 'base_largura', 'inclinacao': 'tronco_inclinacao', 'ombros': 'tronco_rotacao', 'cabeca': 'cabeca'})
        s_vid = montar(vid, {'quadril': 'quadril_altura', 'base': 'base_largura', 'inclinacao': 'tronco_inclinacao', 'ombros': 'tronco_rotacao', 'cabeca': 'cabeca'})
        r_tru, r_ide, r_vid = resumo_derivado(s_tru), resumo_derivado(s_ide), resumo_derivado(s_vid)
        for k in r_tru:
            d = derivadas.setdefault(k, {'geometria': [], 'total': [], 'por_video': {}})
            if k in r_ide:
                d['geometria'].append(r_ide[k] - r_tru[k])
            if k in r_vid and r_vid[k] is not None and r_tru[k] is not None:
                d['total'].append(r_vid[k] - r_tru[k])
            d['por_video'][nome] = {'verdade': r_tru[k], 'ideal': r_ide.get(k), 'video': r_vid.get(k)}
        # Quiques: verdade (evento do motor) x derivar.py no MediaPipe+detector de bola e nos landmarks ideais.
        q_tru = [i for i in range(n) if frames[i]['bq'] > 0]
        q_vid = achar_quiques([d.get('bola_altura') for d in vid])
        q_ide = achar_quiques([d.get('bola_altura') for d in ide])
        # O mesmo detector com o limite de altura relaxado (a bola à frente dos pés aparece acima deles na câmera alta).
        pares_r, _, falsos_r = casar_quiques(q_tru, achar_quiques([d.get('bola_altura') for d in vid], limite=0.35))
        pares_ri, _, _ = casar_quiques(q_tru, achar_quiques([d.get('bola_altura') for d in ide], limite=0.35))
        quiques['relaxado_casados'] = quiques.get('relaxado_casados', 0) + len(pares_r)
        quiques['relaxado_falsos'] = quiques.get('relaxado_falsos', 0) + falsos_r
        quiques['relaxado_ideal_casados'] = quiques.get('relaxado_ideal_casados', 0) + len(pares_ri)
        quiques['bola_no_chao_alt'] = quiques.get('bola_no_chao_alt', []) + [ide[i]['bola_altura'] for i in q_tru if ide[i].get('bola_altura') is not None]
        pares, perdidos, falsos = casar_quiques(q_tru, q_vid)
        pares_i, _, _ = casar_quiques(q_tru, q_ide)
        quiques['verdade'] += len(q_tru)
        quiques['casados'] += len(pares)
        quiques['perdidos'] += perdidos
        quiques['falsos'] += falsos
        quiques['ideal_casados'] += len(pares_i)
        quiques['erro_q'] += [m - t for t, m in pares]
        videos.append({'cenario': nome, 'quadros': n, 'pose': sum(1 for d in vid if 'S_px' in d), 'bola': sum(1 for r in med[:n] if r.get('ball_x')),
                       'S_px_mediano': statistics.median([d['S_px'] for d in vid if 'S_px' in d] or [0]),
                       'quiques_verdade': q_tru, 'quiques_video': q_vid})
    out = {
        'S_regua_m': S_REGUA_M,
        'camera': idx.get('camera'),
        'videos': videos,
        'deteccao': det,
        'troca_lr_punhos': troca_lr[0] / troca_lr[1] if troca_lr[1] else None,
        'por_quadro': {col: {k: stats(v) for k, v in d.items()} | {'unidade': u} for (col, _, u), d in zip(PARES, por_quadro.values())},
        'derivadas': {k: {'geometria': stats(d['geometria']), 'total': stats(d['total']), 'por_video': d['por_video']} for k, d in derivadas.items()},
        'quiques': {**{k: v for k, v in quiques.items() if k not in ('erro_q', 'bola_no_chao_alt')}, 'erro_q': stats(quiques['erro_q']),
                    'bola_no_chao_alt_ideal': statistics.median(quiques.get('bola_no_chao_alt') or [0])},
    }
    return out


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) < 2:
        print(__doc__)
        return 2
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass
    res = calibrar(argv[0])
    with open(argv[1], 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print(f"calibração: {len(res['videos'])} vídeos, pose em {res['deteccao']['pose']}/{res['deteccao']['quadros']} quadros, bola em {res['deteccao']['bola']}")
    for col, d in res['por_quadro'].items():
        t = d['total']
        if t.get('n'):
            print(f"  {col:18s} viés {t['vies']:+.3f}  rms {t['rms']:.3f}  p90 {t['p90_abs']:.3f} {d['unidade']}  (geometria {d['geometria'].get('vies', 0):+.3f}, detector {d['detector'].get('vies', 0):+.3f})")
    print('->', argv[1])
    return 0


if __name__ == '__main__':
    sys.exit(main())
