"""Compara o nosso jogo com o NBA 2K27 na régua do feel e escreve a linha de base (docs/27 §5, Fase 1).

Uso: python -I comparar.py <referencia-2k.json> <nos.json> <saida.md> [--calibracao calibracao.json] [--json saida.json]
                           [--titulo "..."] [--rodada "texto da rodada (data, commit)"]

<nos.json> sai do golpes.py (verdade do motor); <calibracao.json> do calibrar.py (erro do pipeline de vídeo). A tabela
tem, por métrica e por golpe: nós, 2K, delta (distância até a faixa do 2K), tolerância, margem do pipeline e status.
No fim, as 10 maiores diferenças ordenadas pelo impacto no feel, com a hipótese de causa no código (doc 27 §3).
"""
import argparse
import json
import math
import re
import sys

CONF_FATOR = {'A': 1.0, 'M': 0.85, 'B': 0.6}
MARGEM_TEMPO_Q = 1.0  # amostragem a 30 fps (±0,5 q em cada ponta) e a fonte do 2K a ~27,5 fps reamostrada


def fmt(x, unidade='', casas=None):
    if x is None:
        return '—'
    if isinstance(x, str):
        return x
    if casas is None:
        casas = {'q': 1, 'S': 2, 'graus': 0, 'graus/s': 0, 'razao': 2, 'm': 2}.get(unidade, 2)
    return f'{x:.{casas}f}'


def fmt_alvo(alvo, unidade):
    lo, hi = alvo
    if lo is not None and hi is not None:
        return fmt(lo, unidade) if lo == hi else f'{fmt(lo, unidade)}–{fmt(hi, unidade)}'
    if lo is not None:
        return f'≥ {fmt(lo, unidade)}'
    return f'≤ {fmt(hi, unidade)}'


def delta(v, alvo):
    """Distância com sinal até a faixa do 2K (0 dentro dela)."""
    lo, hi = alvo
    if lo is not None and v < lo:
        return v - lo
    if hi is not None and v > hi:
        return v - hi
    return 0.0


def excesso(v, alvo, tol):
    """Quanto passa da tolerância (> 0 = reprovado)."""
    return abs(delta(v, alvo)) - tol


def gravidade(v, alvo, tol):
    """Chave para escolher o pior valor: o maior excesso; entre os aprovados, o mais perto de sair da faixa."""
    lo, hi = alvo
    folga = min([abs(v - b) for b in (lo, hi) if b is not None] or [0])
    return (excesso(v, alvo, tol), -folga if delta(v, alvo) == 0 else 0)


def margem(m, calib):
    """(margem, viés) do pipeline para a métrica, a partir da calibração."""
    c = m.get('calibracao', {})
    tipo = c.get('tipo')
    if tipo == 'tempo':
        return MARGEM_TEMPO_Q, None
    if tipo == 'quique':
        e = (calib or {}).get('quiques', {}).get('erro_q', {})
        rms = e.get('rms') if e.get('n') else None
        return (math.sqrt(2) * rms if rms is not None else MARGEM_TEMPO_Q), None
    if not calib:
        return None, None
    if tipo == 'derivada':
        t = calib.get('derivadas', {}).get(c.get('chave'), {}).get('total', {})
        return (t.get('rms'), t.get('vies')) if t.get('n') else (None, None)
    if tipo == 'quadro':
        t = calib.get('por_quadro', {}).get(c.get('chave'), {}).get('total', {})
        return (t.get('rms'), t.get('vies')) if t.get('n') else (None, None)
    return None, None


def valores(m, nos):
    """{golpe: (valor agregado, detalhe por fase ou None, nota)} para a métrica."""
    med = m['medida']
    de, campo = med['de'], med.get('campo')
    so_se = med.get('so_se')
    out = {}
    for g in med.get('golpes', []):
        if de in ('golpes', 'golpes_e_sequencias', 'golpes_e_controles') and g in nos['golpes']:
            fases = {}
            nota = ''
            for fase, res in nos['golpes'][g].items():
                if so_se and (res.get(so_se['campo']) or 0) < so_se['min']:
                    nota = f"sem {so_se['campo'].replace('_', ' ')} (< {so_se['min']})"
                    continue
                v = res.get(campo)
                if v is not None:
                    fases[fase] = v
            if fases:
                pior = max(fases.items(), key=lambda kv: gravidade(kv[1], m['alvo'], m['tolerancia']))
                out[g] = (pior[1], fases, f'pior fase: {pior[0]}' if len(fases) > 1 else '')
            else:
                out[g] = (None, None, nota or 'sem dado')
        elif de in ('sequencias', 'golpes_e_sequencias') and g in nos['sequencias']:
            v = nos['sequencias'][g].get(campo)
            if isinstance(v, list):
                if any(x is None for x in v):
                    out[g] = ('sem vale', None, 'algum golpe entrou a mais de 10 q de um vale da base')
                elif v:
                    pior = max(v, key=lambda x: gravidade(x, m['alvo'], m['tolerancia']))
                    out[g] = (pior, None, f'valores: {", ".join(fmt(x, m["unidade"]) for x in v)}')
                else:
                    out[g] = (None, None, 'sem dado')
            else:
                out[g] = (v, None, '' if v is not None else 'sem dado')
        elif de in ('controles', 'golpes_e_controles') and g in nos['controles']:
            v = nos['controles'][g].get(campo)
            out[g] = (v, None, '' if v is not None else 'sem dado')
        else:
            out[g] = (None, None, 'cenário não rodou')
    return out


def status_de(v, m, marg):
    if v is None:
        return 'sem dado'
    if isinstance(v, str):
        return 'reprovado'
    ex = excesso(v, m['alvo'], m['tolerancia'])
    if ex <= 1e-9:
        return 'aprovado'
    if marg is not None and ex <= marg:
        return 'limítrofe'
    return 'reprovado'


def comparar(ref, nos, calib=None):
    linhas = []
    por_metrica = []
    for m in ref['metricas']:
        marg, vies = margem(m, calib)
        if m['medida']['de'] == 'nao_existe':
            linhas.append({'metrica': m, 'golpe': '—', 'valor': None, 'status': 'não existe', 'nota': m.get('nota', ''), 'margem': None, 'vies': None})
            por_metrica.append({'metrica': m, 'linhas': [], 'nao_existe': True})
            continue
        vals = valores(m, nos)
        lm = []
        for g, (v, fases, nota) in vals.items():
            st = status_de(v, m, marg)
            corr = None
            if vies is not None and isinstance(v, (int, float)):
                alvo_c = [None if a is None else a - vies for a in m['alvo']]
                st_c = 'aprovado' if excesso(v, alvo_c, m['tolerancia']) <= 1e-9 else 'reprovado'
                if (st_c == 'aprovado') != (st == 'aprovado'):
                    corr = f'descontando o viés do pipeline ({vies:+.2f}): {st_c}'
            linha = {'metrica': m, 'golpe': g, 'valor': v, 'fases': fases, 'status': st, 'nota': nota, 'margem': marg, 'vies': vies, 'corrigido': corr,
                     'delta': delta(v, m['alvo']) if isinstance(v, (int, float)) else None}
            linhas.append(linha)
            lm.append(linha)
        por_metrica.append({'metrica': m, 'linhas': lm, 'nao_existe': False})
    return linhas, por_metrica


def ranking(por_metrica):
    """As maiores diferenças: peso no feel × severidade do pior golpe × (0,7 + 0,3 × fração de golpes reprovados) ×
    confiança do número do 2K; o pior golpe só limítrofe (dentro da margem do pipeline) conta 0,6. O pior caso pesa mais
    que a fração porque a régua pede o feel "em todo golpe e com a bola em qualquer fase" (doc 27 §5, Fase 2)."""
    itens = []
    for pm in por_metrica:
        m = pm['metrica']
        com_dado = [l for l in pm['linhas'] if l['valor'] is not None]
        falhas = [l for l in com_dado if l['status'] in ('reprovado', 'limítrofe')]
        if not falhas:
            continue
        lo, hi = m['alvo']
        meia = (hi - lo) / 2 if (lo is not None and hi is not None) else 0
        escala = max(m['tolerancia'], meia, 1e-6)

        def sev(l):
            if isinstance(l['valor'], str):
                return 2.0
            return max(0.0, excesso(l['valor'], m['alvo'], m['tolerancia'])) / escala

        pior = max(falhas, key=sev)
        frac = len(falhas) / max(1, len(com_dado))
        limitrofe = 0.6 if pior['status'] == 'limítrofe' else 1.0
        score = m['peso'] * min(sev(pior), 4.0) * (0.7 + 0.3 * frac) * CONF_FATOR.get(m['confianca'], 0.7) * limitrofe
        itens.append({'metrica': m, 'pior': pior, 'falhas': len(falhas), 'total': len(com_dado), 'score': score, 'sev': sev(pior)})
    itens.sort(key=lambda x: -x['score'])
    return itens


GOLPES_LAT = ['cross_parado', 'entre_pernas', 'behind_back', 'hesitacao', 'double_cross', 'hesi_cross', 'step_back', 'btb_correndo', 'cross_correndo']


def tabela_latencia(nos, ref):
    nomes = ref.get('golpes', {})
    out = ['| Golpe (golpes que saíram) | Bola na mão | Descendo | Subindo | Pendente (pior) | Espera da bola no clipe (pior) | Bola começa a cruzar (pior) |',
           '|---|---|---|---|---|---|---|']
    for g in GOLPES_LAT:
        fases = nos['golpes'].get(g)
        if not fases:
            continue
        def cel(f):
            r = fases.get(f)
            if not r or r.get('latencia_corpo_q') is None:
                return '—'
            ms = r.get('latencia_corpo_ms')
            return f"{r['latencia_corpo_q']:.1f} q ({ms:.0f} ms)"
        pend = max((r.get('pendente_q') or 0) for r in fases.values())
        esp = max((r.get('espera_bola_q') or 0) for r in fases.values())
        bolas = [r.get('latencia_bola_q') for r in fases.values() if r.get('latencia_bola_q') is not None]
        golpes_saidos = ' > '.join(next(iter(fases.values())).get('golpes') or [])
        out.append(f"| {nomes.get(g, g)} ({golpes_saidos}) | {cel('mao')} | {cel('descendo')} | {cel('subindo')} | {pend:.1f} q | {esp:.1f} q | {(f'{max(bolas):.1f} q') if bolas else '— (não cruza)'} |")
    return out


def tabela_calibracao(calib):
    if not calib:
        return ['_Sem calibração nesta rodada (rode o regua.mjs com o vídeo)._']
    d = calib['deteccao']
    out = [
        f"Vídeos: {len(calib['videos'])} cenários do motor gravados a 30 fps com a câmera atrás e acima "
        f"(retrato {calib['camera']['largura']}×{calib['camera']['altura']}, FOV {calib['camera']['fov']}°, {calib['camera']['atras']} m atrás e "
        f"{calib['camera']['altura_m']} m de altura; S mediano no vídeo ≈ {sorted(v['S_px_mediano'] for v in calib['videos'])[len(calib['videos']) // 2]:.0f} px, "
        f"como os ~295 px do 2K). Pose encontrada em {d['pose']}/{d['quadros']} quadros; bola em {d['bola']}/{d['quadros']}. "
        f"Troca esquerda/direita dos punhos pelo MediaPipe: {100 * (calib.get('troca_lr_punhos') or 0):.0f}% dos quadros.",
        '',
        'Erro por quadro (vídeo − verdade). Geometria = landmarks perfeitos (projetados do motor) passados pelo derivar.py, '
        'contra a verdade em metros/1,45; detector = MediaPipe − landmarks perfeitos.',
        '',
        '| Métrica (derivar.py) | Unid. | Viés total | RMS total | p90 \\|erro\\| | Viés da geometria | Viés do detector | RMS do detector | Quadros |',
        '|---|---|---|---|---|---|---|---|---|',
    ]
    for col, s in calib['por_quadro'].items():
        t, g, de = s['total'], s['geometria'], s['detector']
        if not t.get('n'):
            out.append(f"| {col} | {s['unidade']} | — | — | — | {fmt(g.get('vies'))} | — | — | 0 |")
            continue
        c = 1 if s['unidade'] == 'graus' else 3
        out.append(f"| {col} | {s['unidade']} | {t['vies']:+.{c}f} | {t['rms']:.{c}f} | {t['p90_abs']:.{c}f} | {g.get('vies', 0):+.{c}f} | {de.get('vies', 0):+.{c}f} | {de.get('rms', 0):.{c}f} | {t['n']} |")
    out += ['', 'Erro nas métricas derivadas (uma por vídeo; vídeo − verdade):', '',
            '| Métrica derivada | Viés | RMS | Máx. \\|erro\\| | Viés só da geometria | Vídeos |', '|---|---|---|---|---|---|']
    for k, s in calib['derivadas'].items():
        t, g = s['total'], s['geometria']
        if not t.get('n'):
            continue
        c = 1 if ('tronco' in k or 'inclinacao' in k) else 3
        out.append(f"| {k} | {t['vies']:+.{c}f} | {t['rms']:.{c}f} | {t['max_abs']:.{c}f} | {g.get('vies', 0):+.{c}f} | {t['n']} |")
    q = calib['quiques']
    eq = q.get('erro_q', {})
    out += ['', f"Quiques: {q['casados']} de {q['verdade']} achados pelo derivar.py no vídeo (±2 q), {q['falsos']} falsos; "
            f"com landmarks e bola perfeitos, {q['ideal_casados']} de {q['verdade']}. "
            + (f"Erro de tempo dos achados: viés {eq['vies']:+.2f} q, RMS {eq['rms']:.2f} q. " if eq.get('n') else '')
            + (f"A bola no chão aparece a {q.get('bola_no_chao_alt_ideal', 0):.2f} S acima dos tornozelos na imagem (ela quica à frente dos pés e a "
               f"câmera é alta), por isso o limite de 0,15 S do `derivar.py` perde quiques; com `--limite-quique 0.35` o mesmo detector acha "
               f"{q.get('relaxado_casados', 0)} de {q['verdade']} ({q.get('relaxado_falsos', 0)} falso(s)) e, com landmarks perfeitos, "
               f"{q.get('relaxado_ideal_casados', 0)}." if 'relaxado_casados' in q else '')]
    return out


def escrever_md(ref, nos, calib, linhas, por_metrica, rank, titulo, rodada):
    L = [f'# {titulo}', '']
    L += [
        '> Gerado por `node tools/feel/regua.mjs` (Fase 1 do `docs/27-dribles-2k.md`). Não edite à mão: rode de novo.',
        f'> Rodada: {rodada}.',
        '',
        '**Como ler.** "Nós" é a verdade do motor: o laboratório roda o jogo em passo fixo de 1/60 s e lê o esqueleto e a bola '
        'em metros (`tools/feel/motor.mjs`, cenários em `tools/cenarios-feel.mjs`), convertidos para a régua do 2K: '
        f"1 S = {nos['S_m']:.2f} m, tempo em quadros de 30 fps (q = 33 ms). \"2K\" é a faixa do doc 27 §2 "
        '(`tools/feel/referencia-2k.json`, com fonte E-x e confiança). Delta = distância até a faixa do 2K (0 = dentro). '
        'Aprovado se o delta cabe na tolerância; **limítrofe** = reprovado por menos que a margem do pipeline de vídeo (o '
        'número do 2K pode estar errado nessa medida); a margem vem da calibração (seção 5). Golpe com várias fases do quique: '
        'vale a pior fase.',
        '',
    ]
    cont = {}
    for l in linhas:
        cont[l['status']] = cont.get(l['status'], 0) + 1
    L += ['## 1. Resumo', '',
          f"{len(linhas)} linhas (métrica × golpe): " + ', '.join(f'**{v} {k}**' for k, v in sorted(cont.items(), key=lambda kv: -kv[1])) + '.', '']
    for sec, nome in (('2.1', 'Resposta e encadeamento'), ('2.2', 'Ritmo e bola'), ('2.3', 'Corpo'), ('2.4', 'Duração por golpe')):
        ls = [l for l in linhas if l['metrica']['secao'] == sec]
        ap = sum(1 for l in ls if l['status'] == 'aprovado')
        com = sum(1 for l in ls if l['status'] in ('aprovado', 'reprovado', 'limítrofe'))
        L.append(f'- §{sec} {nome}: {ap} de {com} aprovadas.')
    L += ['', '## 2. As 10 maiores diferenças (ordem de impacto no feel)', '',
          'Impacto = peso da métrica no feel (doc 27 §2.1 pesa mais) × o quanto o pior golpe passa da tolerância × '
          '(0,7 + 0,3 × fração dos golpes reprovados) × confiança do número do 2K; limítrofe conta 0,6.', '',
          '| # | Métrica | Pior golpe | Nós | 2K | Golpes reprovados | Hipótese de causa no código (doc 27 §3) |', '|---|---|---|---|---|---|---|']
    nomes = ref.get('golpes', {})
    for i, it in enumerate(rank[:10], 1):
        m, p = it['metrica'], it['pior']
        u = m['unidade']
        L.append(f"| {i} | {m['nome']} (§{m['secao']}) | {nomes.get(p['golpe'], p['golpe'])} | {fmt(p['valor'], u)} {u} | {fmt_alvo(m['alvo'], u)} {u} | {it['falhas']} de {it['total']} | {m.get('hipotese', '—')} |")
    L += ['', '## 3. Latência por golpe e fase do quique', '',
          'Do quadro em que o stick chega à zona ativa (0,7) até o primeiro quadro em que um osso do tronco ou da mão sai '
          '> 1 cm ou > 2° do mesmo cenário sem o comando (o laboratório é determinístico). 1 quadro de 60 Hz = 0,5 q = 17 ms; '
          'o mínimo possível é 0,5 q. 2K: 0–3 q. "Pendente" = tempo com o comando guardado esperando a bola (Freestyle); '
          '"espera da bola no clipe" = o clipe parado antes da soltura (PlayerAnimator.holdMoveForBall).', '']
    L += tabela_latencia(nos, ref)
    L += ['', '## 4. Tabela por métrica e por golpe', '']
    for sec, nome in (('2.1', 'Resposta e encadeamento'), ('2.2', 'Ritmo e bola'), ('2.3', 'Corpo'), ('2.4', 'Duração por golpe')):
        L += [f'### §{sec} {nome}', '', '| Métrica | Golpe | Nós | 2K | Delta | Tol. | Margem do pipeline | Status | Conf. | Fonte | Nota |', '|---|---|---|---|---|---|---|---|---|---|---|']
        for l in linhas:
            m = l['metrica']
            if m['secao'] != sec:
                continue
            u = m['unidade']
            nota = l.get('nota') or ''
            if l.get('fases') and len(l['fases']) > 1:
                nota = (nota + '; ' if nota else '') + 'fases: ' + ', '.join(f'{k} {fmt(v, u)}' for k, v in l['fases'].items())
            if l.get('corrigido'):
                nota = (nota + '; ' if nota else '') + l['corrigido']
            st = {'aprovado': '✅ aprovado', 'reprovado': '❌ reprovado', 'limítrofe': '⚠️ limítrofe', 'não existe': '— não existe', 'sem dado': '— sem dado'}.get(l['status'], l['status'])
            marg = fmt(l['margem'], u) if l.get('margem') is not None else '—'
            L.append(f"| {m['nome']} | {nomes.get(l['golpe'], l['golpe'])} | {fmt(l['valor'], u)} | {fmt_alvo(m['alvo'], u)} | {fmt(l.get('delta'), u)} | {fmt(m['tolerancia'], u)} | {marg} | {st} | {m['confianca']} | {', '.join(m['fonte'])} | {nota} |")
        L.append('')
    L += ['## 5. Calibração do pipeline de vídeo (margem dos números do 2K)', '']
    L += tabela_calibracao(calib)
    return L


def virgula_decimal(texto):
    """1.45 -> 1,45 no texto, como nos docs do projeto, sem tocar em blocos e trechos de código (`...`)."""
    out = []
    for i, bloco in enumerate(re.split(r'(```.*?```)', texto, flags=re.S)):
        if i % 2:
            out.append(bloco)
            continue
        partes = re.split(r'(`[^`\n]*`)', bloco)
        # Números de seção (§2.1) e versões ficam como estão.
        out.append(''.join(pt if j % 2 else re.sub(r'(?<![§\d.])(\d+)\.(\d+)', r'\1,\2', pt) for j, pt in enumerate(partes)))
    return ''.join(out)


def main(argv=None):
    p = argparse.ArgumentParser(description='Compara nós × 2K e escreve a linha de base.')
    p.add_argument('referencia')
    p.add_argument('nos')
    p.add_argument('saida_md')
    p.add_argument('--calibracao')
    p.add_argument('--json')
    p.add_argument('--titulo', default='Linha de base do feel: nós × NBA 2K27')
    p.add_argument('--rodada', default='—')
    p.add_argument('--anexo', help='arquivo Markdown acrescentado no fim (o que não deu para medir, reprodução)')
    a = p.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass
    ref = json.load(open(a.referencia, encoding='utf-8'))
    nos = json.load(open(a.nos, encoding='utf-8'))
    calib = json.load(open(a.calibracao, encoding='utf-8')) if a.calibracao else None
    linhas, por_metrica = comparar(ref, nos, calib)
    rank = ranking(por_metrica)
    L = escrever_md(ref, nos, calib, linhas, por_metrica, rank, a.titulo, a.rodada)
    if a.anexo:
        L += ['', open(a.anexo, encoding='utf-8').read().rstrip()]
    with open(a.saida_md, 'w', encoding='utf-8', newline='\n') as f:
        f.write(virgula_decimal('\n'.join(L)) + '\n')
    if a.json:
        def limpo(l):
            return {'metrica': l['metrica']['id'], 'golpe': l['golpe'], 'valor': l['valor'], 'fases': l.get('fases'), 'status': l['status'],
                    'delta': l.get('delta'), 'margem': l.get('margem'), 'vies': l.get('vies'), 'alvo': l['metrica']['alvo'], 'tolerancia': l['metrica']['tolerancia']}
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump({'linhas': [limpo(l) for l in linhas], 'top10': [{'metrica': i['metrica']['id'], 'golpe': i['pior']['golpe'], 'valor': i['pior']['valor'], 'score': i['score']} for i in rank[:10]]},
                      f, ensure_ascii=False, indent=1)
    cont = {}
    for l in linhas:
        cont[l['status']] = cont.get(l['status'], 0) + 1
    print('linha de base:', ', '.join(f'{v} {k}' for k, v in cont.items()), '->', a.saida_md)
    return 0


if __name__ == '__main__':
    sys.exit(main())
