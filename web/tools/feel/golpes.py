"""Métricas da régua do feel a partir da verdade do motor (docs/27 §2 e §5, Fase 1).

Uso: python -I golpes.py <pasta_motor> <saida.json>

Entrada: os JSON de motor.mjs (um por rodada: quadros de 60 Hz com juntas em metros no referencial do jogador, eventos do
drible e os ossos vigiados no mundo). Saída: as métricas por golpe e por cenário nas unidades da régua do 2K:

- comprimento em S (1 S = 1,45 m num jogador de 1,86 m; escala com a altura do nosso jogador);
- tempo em quadros de 30 fps ("q", 33 ms), como os números do 2K; também em ms quando ajuda;
- ângulos em graus, + = para a direita do jogador (com a câmera atrás, direita da tela, como em derivar.py).

As definições das métricas estão nas docstrings e no README. Tudo aqui é leitura: nada muda o jogo.
"""
import json
import math
import os
import statistics
import sys

S_REGUA_M = 1.45  # 1 S para um jogador de 1,86 m (doc 27 §0)
ALTURA_REGUA_M = 1.86
HZ = 60.0
Q_POR_QUADRO = 30.0 / HZ  # um quadro de 60 Hz = 0,5 q
LIMIAR_POS_M = 0.01  # deslocamento visível de um osso (doc 27 §5): 1 cm
LIMIAR_ANG_GRAUS = 2.0  # ... ou 2°
LIMIAR_BOLA_M = 0.03  # bola começou a cruzar: 3 cm para o lado novo além do contrafactual

# Golpes que trocam a bola de lado (a travessia da bola só existe nesses).
CRUZAM = {'Crossover', 'Crossover de ataque', 'Entre as pernas', 'Por trás', 'Double cross', 'Hesi-cross', 'Spin', 'Half-spin'}


# ----------------------------------------------------------------------------------------- utilidades


def media(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def mediana(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def desvio(xs):
    xs = [x for x in xs if x is not None]
    return statistics.pstdev(xs) if len(xs) > 1 else None


def arred(x, n=3):
    return None if x is None else round(x, n)


def s_do_jogador(altura_m):
    """S do nosso jogador: a régua vale para 1,86 m; outra altura escala na mesma proporção."""
    return S_REGUA_M * (altura_m or ALTURA_REGUA_M) / ALTURA_REGUA_M


def q_de_quadros(n):
    """Quadros de 60 Hz -> quadros de 30 fps (q)."""
    return None if n is None else n * Q_POR_QUADRO


def angulo_quat(a, b):
    dot = abs(sum(x * y for x, y in zip(a, b)))
    return math.degrees(2 * math.acos(min(1.0, dot)))


def mid(a, b):
    return [(x + y) / 2 for x, y in zip(a, b)]


# ----------------------------------------------------------------------------------------- corpo por quadro


def corpo(f, S):
    """Métricas do corpo num quadro do motor (juntas [lado, alt, frente] em m), nas definições de derivar.py.

    quadril = altura do meio dos quadris acima do meio dos tornozelos (S); base = distância lateral entre os tornozelos
    (S, o que a câmera atrás vê); inclinação = ângulo do ombro médio em relação ao quadril médio no plano lado-alt
    (graus, + = direita); giro = rotação da linha dos ombros em relação à frente do jogador (graus); ombros_aparentes =
    largura lateral dos ombros (S, cai quando o tronco gira); cabeça = altura da cabeça acima do ombro médio (S);
    punhos e bola: altura acima dos tornozelos e lado em relação ao quadril (S).
    """
    hip = mid(f['hip_l'], f['hip_r'])
    ank = mid(f['ank_l'], f['ank_r'])
    sh = mid(f['sh_l'], f['sh_r'])
    d = {
        'quadril': (hip[1] - ank[1]) / S,
        'base': abs(f['ank_l'][0] - f['ank_r'][0]) / S,
        'base_3d': math.hypot(f['ank_l'][0] - f['ank_r'][0], f['ank_l'][2] - f['ank_r'][2]) / S,
        'inclinacao': math.degrees(math.atan2(sh[0] - hip[0], sh[1] - hip[1])),
        'giro': math.degrees(math.atan2(f['sh_r'][2] - f['sh_l'][2], f['sh_r'][0] - f['sh_l'][0])),
        'giro_quadril': math.degrees(math.atan2(f['hip_r'][2] - f['hip_l'][2], f['hip_r'][0] - f['hip_l'][0])),
        'ombros_aparentes': abs(f['sh_r'][0] - f['sh_l'][0]) / S,
        'cabeca': (f['head'][1] - sh[1]) / S,
        'bola_alt': (f['ball'][1] - ank[1]) / S,
        'bola_lado': (f['ball'][0] - hip[0]) / S,
        'bola_lado_m': f['ball'][0] - hip[0],
    }
    for side in ('l', 'r'):
        d['punho_%s_alt' % side] = (f['wr_' + side][1] - ank[1]) / S
        d['punho_%s_lado' % side] = (f['wr_' + side][0] - hip[0]) / S
    return d


# ----------------------------------------------------------------------------------------- eventos


def eventos_bola(frames, ini, fim):
    """Solturas (bola presa -> no ar), quiques e recepções (no ar -> presa) entre os quadros ini e fim."""
    sol, qui, rec = [], [], []
    for i in range(max(1, ini), min(fim, len(frames))):
        a, b = frames[i - 1], frames[i]
        if a['bm'] == 1 and b['bm'] == 0:
            sol.append(i)
        if b['bq'] > 0:
            qui.append(i)
        if a['bm'] == 0 and b['bm'] == 1:
            rec.append(i)
    return sol, qui, rec


def inicios_de_golpe(frames, ini=1):
    """Quadros em que o núcleo começou um golpe (game.moves cresceu) e o rótulo."""
    out = []
    for i in range(max(1, ini), len(frames)):
        if frames[i]['nmov'] > frames[i - 1]['nmov']:
            out.append((i, frames[i]['mvn'] or '?'))
    return out


def fim_da_acao(frames, ini):
    """Primeiro quadro, a partir de ini, em que o animador não tem ação de drible ativa (fim visível do golpe)."""
    for i in range(ini, len(frames)):
        if not frames[i]['ak']:
            return i
    return len(frames) - 1


def intervalos_de_quique(frames, ini=0, fim=None):
    """Intervalos (q) entre quiques consecutivos no trecho."""
    fim = len(frames) if fim is None else fim
    qs = [i for i in range(ini, fim) if frames[i]['bq'] > 0]
    return [q_de_quadros(b - a) for a, b in zip(qs, qs[1:])]


# ----------------------------------------------------------------------------------------- latência


def reacao_visivel(run, ctrl, cmd):
    """Primeiro quadro >= cmd em que um osso vigiado (tronco ou mão) difere do controle > 1 cm ou > 2°.

    O laboratório é determinístico: o controle é o mesmo cenário sem o comando, então a diferença é a reação ao comando.
    Devolve (quadro, osso, motivo) ou (None, None, None).
    """
    nomes = run.get('vigiados') or ['spine_02', 'spine_03', 'neck_01', 'head', 'hand_l', 'hand_r']
    for i in range(cmd, min(len(run['frames']), len(ctrl['frames']))):
        a, b = run['frames'][i]['w'], ctrl['frames'][i]['w']
        for k, (pa, pb) in enumerate(zip(a, b)):
            if math.dist(pa[:3], pb[:3]) > LIMIAR_POS_M:
                return i, nomes[k], 'pos'
            if angulo_quat(pa[3:], pb[3:]) > LIMIAR_ANG_GRAUS:
                return i, nomes[k], 'ang'
    return None, None, None


def bola_reage(run, ctrl, cmd, lado_novo=None):
    """Primeiro quadro >= cmd em que a bola sai do contrafactual: > 3 cm para o lado novo (golpes que cruzam) ou > 3 cm
    em qualquer direção (lado_novo None)."""
    for i in range(cmd, min(len(run['frames']), len(ctrl['frames']))):
        a, b = run['frames'][i]['ball'], ctrl['frames'][i]['ball']
        if lado_novo is None:
            if math.dist(a, b) > LIMIAR_BOLA_M:
                return i
        elif (a[0] - b[0]) * lado_novo > LIMIAR_BOLA_M:
            return i
    return None


def latencia_q(cmd, quadro):
    """Quadros de 60 Hz do comando até o quadro em que a mudança aparece (inclusive) -> q. O primeiro desenho possível é
    o do próprio quadro do comando (1 quadro = 0,5 q = 17 ms)."""
    return None if quadro is None else q_de_quadros(quadro - cmd + 1)


# ----------------------------------------------------------------------------------------- análise de um golpe


def travessia(frames, corpo_q, sol, rec_novo, lado_novo):
    """Travessia da bola de um quadril ao outro: do primeiro quadro com 15% do caminho lateral até 85% (entre o extremo
    do lado velho antes da soltura e o extremo do lado novo depois da recepção). Devolve (q, quadros extremo a extremo)."""
    if sol is None or rec_novo is None:
        return None, None
    ini = max(0, sol - 12)
    velho = [corpo_q[i]['bola_lado'] for i in range(ini, sol + 1)]
    novo = [corpo_q[i]['bola_lado'] for i in range(rec_novo, min(len(frames), rec_novo + 10))]
    if not velho or not novo:
        return None, None
    a = max(velho, key=lambda x: -x * lado_novo)  # extremo do lado velho
    b = max(novo, key=lambda x: x * lado_novo)  # extremo do lado novo
    span = (b - a) * lado_novo
    if span < 0.1:
        return None, None
    i15 = i85 = None
    ia = ini + velho.index(a)
    ib = rec_novo + novo.index(b)
    for i in range(ia, ib + 1):
        prog = (corpo_q[i]['bola_lado'] - a) * lado_novo / span
        if i15 is None and prog >= 0.15:
            i15 = i
        if i85 is None and prog >= 0.85:
            i85 = i
    if i15 is None or i85 is None:
        return None, None
    return q_de_quadros(i85 - i15), q_de_quadros(ib - ia)


def serie_30fps(xs):
    """Amostra a série de 60 Hz a 30 fps (um sim, um não), como o vídeo do 2K."""
    return xs[::2]


def vel_pico(xs_30):
    """Maior |Δ| por quadro de 30 fps, convertido para unidade/s."""
    return max((abs(b - a) * 30 for a, b in zip(xs_30, xs_30[1:])), default=None)


def analisar_golpe(run, ctrl, S):
    """Todas as métricas de um golpe disparado no quadro run['cmd'] (comparando com o controle)."""
    fr = run['frames']
    cmd = run['cmd']
    cq = [corpo(f, S) for f in fr]
    inicios = [(i, l) for i, l in inicios_de_golpe(fr, cmd) if i >= cmd]
    out = {'id': run['id'], 'cenario': run['cenario'], 'fase': run.get('fase'), 'cmd': cmd, 'golpes': [l for _, l in inicios]}
    if not inicios:
        out['erro'] = 'nenhum golpe começou'
        return out
    ini_nucleo, rotulo = inicios[0]
    ultimo_ini, ultimo = inicios[-1]
    fim = fim_da_acao(fr, ultimo_ini)
    out['golpe'] = ultimo if len(inicios) > 1 else rotulo
    mao_ini = fr[cmd - 1]['bh']
    lado_velho = 1 if mao_ini == 'r' else -1
    cruza = any(l in CRUZAM for _, l in inicios)
    lado_novo = -lado_velho if cruza else None

    # Resposta.
    reac, osso, motivo = reacao_visivel(run, ctrl, cmd)
    out['latencia_corpo_q'] = latencia_q(cmd, reac)
    out['latencia_corpo_ms'] = None if reac is None else (reac - cmd + 1) * 1000 / HZ
    out['latencia_corpo_osso'] = osso and f'{osso} ({motivo})'
    out['latencia_nucleo_q'] = latencia_q(cmd, ini_nucleo)
    pend = sum(1 for i in range(cmd, ini_nucleo + 1) if fr[i]['pend'])
    out['pendente_q'] = q_de_quadros(pend)
    out['espera_bola_q'] = q_de_quadros(sum(1 for i in range(cmd, fim + 1) if fr[i]['wait']))
    breage = bola_reage(run, ctrl, cmd, lado_novo)
    out['latencia_bola_q'] = latencia_q(cmd, breage) if cruza else None
    out['bola_reage_q'] = latencia_q(cmd, bola_reage(run, ctrl, cmd, None))

    # Bola: solturas, quiques e recepções do golpe.
    sol, qui, rec = eventos_bola(fr, cmd, min(len(fr), fim + 20))
    s1 = next((s for s in sol if s >= ini_nucleo - 1), None)
    q1 = next((q for q in qui if s1 is not None and q > s1), None)
    r1 = next((r for r in rec if q1 is not None and r > q1), None)
    rec_golpe = [r for r in rec if r <= fim + 6]
    r_fim = max(rec_golpe) if rec_golpe else None
    out['eventos'] = {'nucleo': [i for i, _ in inicios], 'solturas': sol, 'quiques': qui, 'recepcoes': rec, 'fim_acao': fim}
    out['duracao_bola_q'] = q_de_quadros(r1 - s1) if (s1 is not None and r1 is not None) else None
    # Bola em movimento: do primeiro quadro em que ela sai do contrafactual até a última recepção do golpe (no BTB a bola
    # começa a andar ainda presa, levada por trás do quadril).
    b_any = bola_reage(run, ctrl, cmd, None)
    out['bola_em_movimento_q'] = q_de_quadros(r_fim - b_any) if (b_any is not None and r_fim is not None and r_fim > b_any) else None
    if len(inicios) > 1:
        out['pose_neutra_q'] = q_de_quadros(sum(1 for i in range(ini_nucleo, ultimo_ini) if not fr[i]['ak']))
    out['cmd_a_recepcao_q'] = latencia_q(cmd, r_fim) if r_fim is not None else None
    out['duracao_acao_q'] = q_de_quadros(fim - ini_nucleo)
    a = fr[ultimo_ini]
    out['duracao_nucleo_q'] = (a['mve'] - fr[ini_nucleo]['mvs']) * 30
    if reac is not None and r_fim is not None and cruza:
        out['corpo_antes_da_bola_q'] = q_de_quadros(r_fim - reac)
    if cruza and s1 is not None:
        r_novo = next((r for r in rec if r > s1 and fr[r]['bh'] != mao_ini), r1)
        out['travessia_q'], out['extremo_a_extremo_q'] = travessia(fr, cq, s1, r_novo, lado_novo)
        # Altura da bola quando cruza o meio do corpo (entre as pernas: a 2K passa a ~0,3 S).
        meio = next((i for i in range(s1, (r_novo or s1) + 1) if cq[i]['bola_lado'] * lado_novo >= 0), None)
        out['bola_alt_no_meio'] = cq[meio]['bola_alt'] if meio is not None else None

    # Corpo.
    pre = range(max(0, cmd - 15), cmd)
    janela = range(cmd, min(len(fr), fim + 20))
    quad_neutro = media(cq[i]['quadril'] for i in pre)
    i_min = min(janela, key=lambda i: cq[i]['quadril'])
    out['quadril_neutro'] = quad_neutro
    out['quadril_min'] = cq[i_min]['quadril']
    out['queda_quadril'] = quad_neutro - cq[i_min]['quadril']
    out['queda_quadril_rel'] = out['queda_quadril'] / quad_neutro if quad_neutro else None
    out['queda_quadril_tempo_q'] = latencia_q(cmd, i_min)
    volta = next((i for i in range(i_min, len(fr)) if cq[i]['quadril'] >= quad_neutro - 0.02), None)
    out['volta_quadril_q'] = q_de_quadros(volta - i_min) if volta is not None else None
    bases = [cq[i]['base'] for i in range(cmd, fim + 1)]
    out['base_min'] = min(bases)
    out['base_max'] = max(bases)
    out['base_neutra'] = media(cq[i]['base'] for i in pre)
    out['passo_cruzado_q'] = q_de_quadros(sum(1 for b in bases if b < 0.2))
    incl = [cq[i]['inclinacao'] for i in range(max(0, cmd - 10), min(len(fr), fim + 20))]
    lado_bola = [1 if cq[i]['bola_lado'] >= 0 else -1 for i in range(max(0, cmd - 10), min(len(fr), fim + 20))]
    out['inclinacao_lado_bola_max'] = max(x * s for x, s in zip(incl, lado_bola))
    out['inclinacao_abs_max'] = max(abs(x) for x in incl)
    out['varredura_tronco'] = max(incl) - min(incl)
    out['vel_tronco_pico'] = vel_pico(serie_30fps(incl))
    giros = [cq[i]['giro'] for i in range(cmd, fim + 1)]
    out['giro_tronco_max'] = max(abs(g - cq[cmd - 1]['giro']) for g in giros)
    out['cabeca_desvio'] = desvio(cq[i]['cabeca'] for i in range(cmd, fim + 1))
    # Overshoot do tronco: passa do alvo e volta (E-F: de +34 para −34, assenta em −10 em 12 quadros).
    if lado_novo is not None:
        ini_l = media(cq[i]['inclinacao'] for i in range(max(0, cmd - 10), cmd))
        jan = list(range(cmd, min(len(fr), cmd + 50)))
        i_pk = max(jan, key=lambda i: cq[i]['inclinacao'] * lado_novo)
        pico = cq[i_pk]['inclinacao']
        assenta = media(cq[i]['inclinacao'] for i in range(i_pk + 24, min(len(fr), i_pk + 41)))
        if assenta is not None and abs(pico - ini_l) > 5:
            out['overshoot_tronco'] = (pico - assenta) * lado_novo / ((pico - ini_l) * lado_novo)
    # Antecipação: da primeira reação do corpo ao empurrão (soltura da bola no golpe).
    if reac is not None and s1 is not None and s1 >= reac:
        out['antecipacao_q'] = q_de_quadros(s1 - reac)
        out['antecipacao_quadril'] = quad_neutro - cq[s1]['quadril']
        mao = 'punho_%s_alt' % mao_ini
        out['antecipacao_mao'] = cq[s1][mao] - media(cq[i][mao] for i in pre)
    # Movimento do corpo (step-back, correndo).
    root0 = fr[cmd - 1]['root']
    yaw = root0[2]
    fx, fz = math.sin(yaw), math.cos(yaw)
    # root = [x, z] do three.js; a frente do jogador é (sen yaw, cos yaw) nesse plano.
    frente = [((f['root'][0] - root0[0]) * fx + (f['root'][1] - root0[1]) * fz) for f in fr]
    i_tras = min(range(cmd, len(fr)), key=lambda i: frente[i])
    out['recuo_m'] = -frente[i_tras]
    out['recuo_q'] = latencia_q(cmd, i_tras)
    v_pre = media(fr[i]['vel'] for i in pre)
    out['vel_pre'] = v_pre
    if v_pre and v_pre > 1.0:
        out['vel_retida'] = min(fr[i]['vel'] for i in range(cmd, min(len(fr), fim + 1))) / v_pre
    return out


# ----------------------------------------------------------------------------------------- controles e sequências


def analisar_controle(run, S):
    fr = run['frames']
    cq = [corpo(f, S) for f in fr]
    ini = 30
    mao = fr[ini]['bh']
    livre = 'l' if mao == 'r' else 'r'
    lado_livre = -1 if livre == 'l' else 1
    ints = intervalos_de_quique(fr, ini)
    out = {
        'id': run['id'],
        'quadril': media(c['quadril'] for c in cq[ini:]),
        'quadril_amplitude': max(c['quadril'] for c in cq[ini:]) - min(c['quadril'] for c in cq[ini:]),
        'base': media(c['base'] for c in cq[ini:]),
        'base_amplitude': max(c['base'] for c in cq[ini:]) - min(c['base'] for c in cq[ini:]),
        'inclinacao': media(c['inclinacao'] for c in cq[ini:]),
        'inclinacao_amplitude': max(c['inclinacao'] for c in cq[ini:]) - min(c['inclinacao'] for c in cq[ini:]),
        'cabeca_desvio': desvio(c['cabeca'] for c in cq[ini:]),
        'braco_livre_lado': media(c['punho_%s_lado' % livre] * lado_livre for c in cq[ini:]),
        'braco_livre_alt': media(c['punho_%s_alt' % livre] for c in cq[ini:]),
        'mao_bola_alt_max': max(c['punho_%s_alt' % mao] for c in cq[ini:]),
        'quique_q': mediana(ints),
        'quiques': len(ints) + 1 if ints else 0,
        'vel': media(f['vel'] for f in fr[ini:]),
        'ombros_aparentes': media(c['ombros_aparentes'] for c in cq[ini:]),
    }
    return out


def analisar_sequencia(run, S):
    fr = run['frames']
    cq = [corpo(f, S) for f in fr]
    ini = inicios_de_golpe(fr)
    out = {'id': run['id'], 'golpes': [l for _, l in ini]}
    if run['cenario'] == 'arranque_parada':
        ls = [i for i, f in enumerate(fr) if f['i'][3] > 0.5]
        if ls:
            a, b = ls[0], ls[-1]
            vmax = max(f['vel'] for f in fr[a:b + 1])
            t90 = next(i for i in range(a, b + 1) if fr[i]['vel'] >= 0.9 * vmax)
            t10 = next((i for i in range(b + 1, len(fr)) if fr[i]['vel'] <= 0.1 * vmax), None)
            out.update({'vel_max': vmax, 'arranque_q': latencia_q(a, t90), 'parada_q': latencia_q(b + 1, t10) if t10 is not None else None})
        return out
    if not ini:
        return out
    a, b = ini[0][0], ini[-1][0]
    fim = fim_da_acao(fr, b)
    out['intervalo_golpes_q'] = [q_de_quadros(y - x) for (x, _), (y, _) in zip(ini, ini[1:])]
    out['pose_neutra_q'] = q_de_quadros(sum(1 for i in range(a, b) if not fr[i]['ak']))
    out['nucleo_parado_q'] = q_de_quadros(sum(1 for i in range(a, b) if not fr[i]['mv']))
    out['quique_q'] = mediana(intervalos_de_quique(fr, a, fim + 1))
    out['quiques_q'] = intervalos_de_quique(fr, a, fim + 1)
    # Entrada no vale da base: distância (q) do início de cada golpe ao mínimo de base mais próximo.
    base = [c['base'] for c in cq]
    vales = [i for i in range(1, len(base) - 1) if base[i] <= base[i - 1] and base[i] < base[i + 1]]
    amp = max(base[a:fim + 1]) - min(base[a:fim + 1])
    out['base_amplitude'] = amp
    if vales and amp > 0.05:
        dist = [q_de_quadros(min((x - v for v in vales), key=abs)) for x, _ in ini[1:]]
        out['entrada_no_vale_q'] = [d if abs(d) <= 10 else None for d in dist]  # sem vale a até 10 q = não entrou no vale
    return out


# ----------------------------------------------------------------------------------------- agregação


def carregar(pasta):
    idx = json.load(open(os.path.join(pasta, 'indice.json'), encoding='utf-8'))
    runs = {}
    for r in idx['rodadas']:
        runs[r['id']] = json.load(open(os.path.join(pasta, r['id'] + '.json'), encoding='utf-8'))
    return idx, runs


def analisar(pasta):
    idx, runs = carregar(pasta)
    altura = next(iter(runs.values())).get('alturaJogador', ALTURA_REGUA_M)
    S = s_do_jogador(altura)
    out = {'S_m': S, 'altura_m': altura, 'hz': HZ, 'fases': idx.get('fases', {}), 'controles': {}, 'golpes': {}, 'sequencias': {}}
    for rid, run in runs.items():
        if run['tipo'] == 'controle':
            out['controles'][rid] = analisar_controle(run, S)
    for rid, run in runs.items():
        if run['tipo'] == 'golpe':
            ctrl = runs.get(run['controle'])
            out['golpes'].setdefault(run['cenario'], {})[run['fase']] = analisar_golpe(run, ctrl, S)
        elif run['tipo'] == 'sequencia':
            out['sequencias'][rid] = analisar_sequencia(run, S)
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
    res = analisar(argv[0])
    with open(argv[1], 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    for nome, fases in res['golpes'].items():
        lat = [fases[k].get('latencia_corpo_q') for k in fases]
        print(f"{nome:16s} latência corpo (q): {lat}  golpes: {[fases[k].get('golpes') for k in fases][0]}")
    print('->', argv[1])
    return 0


if __name__ == '__main__':
    sys.exit(main())
