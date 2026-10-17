"""Testes da régua do feel: quadro sintético -> números esperados (derivação de métricas, quiques, latência, status).

Rodar (de web/):  python -I -m unittest discover -s tools/feel -p "teste_*.py"
(o pytest também acha: python -I -m pytest tools/feel)
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import calibrar  # noqa: E402
import comparar  # noqa: E402
import derivar  # noqa: E402
import golpes  # noqa: E402


def linha_medir(**pts):
    """Linha no formato do medir.py a partir de pontos {nome: (x, y)}."""
    r = {'frame': '0', 't': '0.0', 'diff': '0.0', 'ball_x': '', 'ball_y': '', 'ball_r': ''}
    for k, (x, y) in pts.items():
        if k == 'ball':
            r['ball_x'], r['ball_y'], r['ball_r'] = str(x), str(y), '10'
        else:
            r[k + '_x'], r[k + '_y'] = str(x), str(y)
    return r


# Jogador de frente para a câmera de trás: ombros a 40 px, quadril a 20 px, tornozelos a 40 px; S = 200 px.
BASE = dict(lsh=(100, 100), rsh=(140, 100), lhip=(110, 200), rhip=(130, 200), lank=(100, 300), rank=(140, 300),
            lwr=(90, 220), rwr=(160, 230), ball=(160, 280))


class DerivarQuadro(unittest.TestCase):
    def test_quadro_sintetico(self):
        d = derivar.derivar_quadro(linha_medir(**BASE))
        self.assertEqual(d['S_px'], 200.0)
        self.assertAlmostEqual(d['quadril_altura'], 0.5)
        self.assertAlmostEqual(d['base_largura'], 0.2)
        self.assertAlmostEqual(d['base_vs_ombros'], 1.0)
        self.assertAlmostEqual(d['tronco_inclinacao'], 0.0)
        self.assertAlmostEqual(d['tronco_rotacao'], 0.2)
        self.assertAlmostEqual(d['lpunho_altura'], 0.4)
        self.assertAlmostEqual(d['lpunho_lado'], -0.6 / 4)  # (90 - 120) / 200
        self.assertAlmostEqual(d['rpunho_lado'], 0.2)
        self.assertAlmostEqual(d['bola_altura'], 0.1)
        self.assertAlmostEqual(d['bola_lado'], 0.2)

    def test_inclinacao_para_a_direita(self):
        dx = 100 * math.tan(math.radians(20))  # ombros 20° para a direita da tela em relação ao quadril
        pts = dict(BASE, lsh=(100 + dx, 100), rsh=(140 + dx, 100))
        d = derivar.derivar_quadro(linha_medir(**pts))
        self.assertAlmostEqual(d['tronco_inclinacao'], 20.0, places=1)

    def test_sem_pose_nao_inventa(self):
        d = derivar.derivar_quadro(linha_medir(ball=(10, 10)))
        self.assertNotIn('quadril_altura', d)
        self.assertNotIn('bola_altura', d)  # sem tornozelo não há referência de chão

    def test_quiques(self):
        h = [0.6, 0.4, 0.2, 0.05, 0.2, 0.4, 0.6, 0.4, 0.1, 0.12, 0.3, 0.5, None, 0.5, 0.3, 0.08, 0.3, 0.5]
        self.assertEqual(derivar.achar_quiques(h), [3, 8, 15])
        self.assertEqual(derivar.achar_quiques(h, separacao=6), [3, 15])  # 8 fica a 5 quadros do 3
        self.assertEqual(derivar.achar_quiques([0.3, 0.25, 0.2, 0.25, 0.3]), [])  # longe do chão


def quadro_motor(**over):
    """Quadro do motor (juntas [lado, alt, frente] em m) com o jogador de pé."""
    f = {
        'hip_l': [-0.1, 0.80, 0.0], 'hip_r': [0.1, 0.80, 0.0], 'ank_l': [-0.2, 0.075, 0.0], 'ank_r': [0.2, 0.075, 0.0],
        'sh_l': [-0.2, 1.30, 0.0], 'sh_r': [0.2, 1.30, 0.0], 'head': [0.0, 1.50, 0.0],
        'wr_l': [-0.4, 0.80, 0.1], 'wr_r': [0.45, 0.70, 0.3], 'ball': [0.45, 0.58, 0.35],
    }
    f.update(over)
    return f


class CorpoDoMotor(unittest.TestCase):
    S = 1.45

    def test_metricas(self):
        c = golpes.corpo(quadro_motor(), self.S)
        self.assertAlmostEqual(c['quadril'], 0.725 / 1.45)
        self.assertAlmostEqual(c['base'], 0.4 / 1.45)
        self.assertAlmostEqual(c['inclinacao'], 0.0)
        self.assertAlmostEqual(c['giro'], 0.0)
        self.assertAlmostEqual(c['ombros_aparentes'], 0.4 / 1.45)
        self.assertAlmostEqual(c['cabeca'], 0.2 / 1.45)
        self.assertAlmostEqual(c['punho_l_lado'], -0.4 / 1.45)
        self.assertAlmostEqual(c['bola_alt'], 0.505 / 1.45)

    def test_inclinacao_e_giro(self):
        dx = 0.5 * math.tan(math.radians(15))
        c = golpes.corpo(quadro_motor(sh_l=[-0.2 + dx, 1.30, 0.0], sh_r=[0.2 + dx, 1.30, 0.0]), self.S)
        self.assertAlmostEqual(c['inclinacao'], 15.0, places=6)
        # Ombro direito 0,2 m à frente do esquerdo, 0,4 m ao lado: giro de atan(0,2/0,4).
        c = golpes.corpo(quadro_motor(sh_l=[-0.2, 1.30, -0.1], sh_r=[0.2, 1.30, 0.1]), self.S)
        self.assertAlmostEqual(c['giro'], math.degrees(math.atan2(0.2, 0.4)))

    def test_s_escala_com_a_altura(self):
        self.assertAlmostEqual(golpes.s_do_jogador(1.86), 1.45)
        self.assertAlmostEqual(golpes.s_do_jogador(2.046), 1.595)


def rodada(n, cmd_reage=None, bola_cruza=None, lado_novo=-1):
    """Rodada sintética: ossos parados; a partir de cmd_reage a mão sai 2 cm, a partir de bola_cruza a bola anda."""
    frames = []
    for i in range(n):
        w = [[0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0] for _ in range(6)]
        ball = [0.4, 0.7, 0.4]
        if cmd_reage is not None and i >= cmd_reage:
            w[4][0] += 0.02
        if bola_cruza is not None and i >= bola_cruza:
            ball = [0.4 + 0.05 * lado_novo * (i - bola_cruza + 1), 0.7, 0.4]
        frames.append({'w': w, 'ball': ball, 'bq': 1 if i in (10, 30, 50) else 0})
    return {'frames': frames}


class Latencia(unittest.TestCase):
    def test_reacao_contra_o_controle(self):
        ctrl = rodada(40)
        run = rodada(40, cmd_reage=23, bola_cruza=26)
        quadro, osso, motivo = golpes.reacao_visivel(run, ctrl, 20)
        self.assertEqual((quadro, osso, motivo), (23, 'hand_l', 'pos'))
        self.assertEqual(golpes.latencia_q(20, quadro), 2.0)  # 4 quadros de 60 Hz = 2 q
        self.assertEqual(golpes.bola_reage(run, ctrl, 20, -1), 26)  # 5 cm para o lado novo no 1º quadro
        self.assertIsNone(golpes.bola_reage(run, ctrl, 20, +1))  # para o lado velho não conta

    def test_angulo(self):
        ctrl = rodada(10)
        run = rodada(10)
        a = math.radians(3) / 2
        for i in range(5, 10):
            run['frames'][i]['w'][0][3:] = [0.0, math.sin(a), 0.0, math.cos(a)]  # 3° em torno de y
        self.assertEqual(golpes.reacao_visivel(run, ctrl, 0)[:2], (5, 'spine_02'))

    def test_intervalo_de_quique(self):
        self.assertEqual(golpes.intervalos_de_quique(rodada(60)['frames']), [10.0, 10.0])


class Comparacao(unittest.TestCase):
    def test_delta_e_status(self):
        m = {'alvo': [0, 3], 'tolerancia': 0.5}
        self.assertEqual(comparar.delta(1.5, m['alvo']), 0.0)
        self.assertEqual(comparar.delta(6.0, m['alvo']), 3.0)
        self.assertEqual(comparar.status_de(3.5, m, None), 'aprovado')
        self.assertEqual(comparar.status_de(4.0, m, 1.0), 'limítrofe')
        self.assertEqual(comparar.status_de(6.0, m, 1.0), 'reprovado')
        self.assertEqual(comparar.status_de(0.95, {'alvo': [0.9, None], 'tolerancia': 0.03}, None), 'aprovado')

    def test_pior_fase(self):
        alvo, tol = [0, 3], 0.5
        fases = {'mao': 1.5, 'descendo': 2.5, 'subindo': 1.5}
        pior = max(fases.items(), key=lambda kv: comparar.gravidade(kv[1], alvo, tol))
        self.assertEqual(pior[0], 'descendo')

    def test_casar_quiques(self):
        pares, perdidos, falsos = calibrar.casar_quiques([10, 30, 50], [11, 29, 70])
        self.assertEqual((pares, perdidos, falsos), ([(10, 11), (30, 29)], 1, 1))


if __name__ == '__main__':
    unittest.main()
