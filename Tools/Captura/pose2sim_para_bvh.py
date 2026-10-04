"""
Converte a saída do Pose2Sim num BVH no esqueleto do sujeito 06 da CMU, o mesmo de Tools/Animacao
(processar_clipes.py → montar_personagem_blender.py → FBX com nomes da Unreal).

Uso:
  python pose2sim_para_bvh.py <take.trc> <saida.bvh> --asf 06.asf [--fps 60] [--sem-dedos] [--chao auto|nao]
  python pose2sim_para_bvh.py <take.mot> <saida.bvh> --asf 06.asf --osim <modelo.osim> [--maos-de <take.trc>]

Entradas aceitas:
  .trc  pontos 3D triangulados e filtrados (pose-3d/*_filt_*.trc). Melhor com o modelo "Whole_body" (RTMW,
        133 pontos): os 21 pontos de cada mão orientam o punho e dobram os dedos. Com "Body_with_feet" (HALPE 26)
        o punho segue o antebraço.
  .mot  ângulos do OpenSim (kinematics/*.mot) + o modelo escalado (.osim). Os marcadores do modelo são
        recalculados quadro a quadro (utilitário trc_from_mot_osim do Pose2Sim; precisa do pacote opensim) e
        passam pela mesma IK abaixo. Os ossos ficam com comprimento constante (menos tremor), mas o modelo do
        OpenSim não tem dedos: use --maos-de <take.trc> para pegar a mão do .trc.

IK analítica (sem otimização), quadro a quadro:
  - Cada osso ganha uma base ortonormal (eixo do osso + um eixo secundário) montada dos pontos 3D. A MESMA
    construção é feita na pose de repouso do ASF, e a rotação global do osso é G = B_atual · B_repousoᵀ.
    Como o processar_clipes, as rotações locais (G_pai⁻¹·G) ficam em frames alinhados ao mundo.
  - Joelho e cotovelo: o eixo secundário é o eixo da dobradiça (perna/braço dobrado). Com o membro esticado, o
    eixo vem do pé (perna) ou da frente do tronco (braço), com transição suave.
  - Coluna (3 ossos) e pescoço/cabeça (3 ossos): a rotação total é dividida em partes iguais.
  - Punho/mão (RTMW): palma = punho → meio dos nós dos dedos; largura = indicador → mínimo. Dedos: flexão média
    das falanges (limitada a faixas fisiológicas). Polegar: direção MCP → ponta.
  - Pé: calcanhar → meio dos dedos + largura do pé. Os dedos do pé seguem o pé.
  - Proporções: as direções dos ossos são copiadas; a posição da pelve é escalada pela razão entre a perna do
    esqueleto alvo e a do atleta. O chão é ajustado para os pés (opção --chao).
Saída: BVH a 60 fps (o pipeline do jogo é 60 fps), frente do corpo em +Z, começando na origem.
Precisa só de numpy. Mostra no fim: tremor dos ossos, deslize dos pés e os "empurrões" de drible por mão.
"""
import argparse
import contextlib
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Animacao"))
import amc2bvh  # noqa: E402
import processar_clipes as pc  # noqa: E402

CIMA = np.array([0.0, 1.0, 0.0])
FRENTE = np.array([0.0, 0.0, 1.0])
ESQUERDA = np.array([1.0, 0.0, 0.0])  # no ASF da CMU o corpo olha para +Z e a esquerda dele é +X

# Marcadores do modelo do OpenSim com aumento de marcadores (LSTM) → nomes dos pontos do RTMPose/RTMW.
# Usados só quando o nome original não existe (caminho .mot). Tupla = média dos marcadores.
APELIDOS = {
    "RHip": ("RHJC_study",), "LHip": ("LHJC_study",),
    "RKnee": ("r_knee_study", "r_mknee_study"), "LKnee": ("L_knee_study", "L_mknee_study"),
    "RAnkle": ("r_ankle_study", "r_mankle_study"), "LAnkle": ("L_ankle_study", "L_mankle_study"),
    "RHeel": ("r_calc_study",), "LHeel": ("L_calc_study",),
    "RBigToe": ("r_toe_study",), "LBigToe": ("L_toe_study",),
    "RSmallToe": ("r_5meta_study",), "LSmallToe": ("L_5meta_study",),
    "RShoulder": ("r_shoulder_study",), "LShoulder": ("L_shoulder_study",),
    "RElbow": ("r_lelbow_study", "r_melbow_study"), "LElbow": ("L_lelbow_study", "L_melbow_study"),
    "RWrist": ("r_lwrist_study", "r_mwrist_study"), "LWrist": ("L_lwrist_study", "L_mwrist_study"),
}
DEDOS = ("Thumb", "Index", "Middle", "Ring", "Pinky")


# ----------------------------------------------------------------------------- leitura

def ler_trc(caminho):
    """TRC do Pose2Sim (Y para cima) → (fps, {nome: (N, 3) em cm}). Buracos (NaN) são interpolados."""
    with open(caminho) as arq:
        linhas = arq.read().splitlines()
    chaves = linhas[1].split("\t")
    valores = linhas[2].split("\t")
    info = dict(zip(chaves, valores))
    fps = float(info.get("DataRate", 60))
    escala = {"m": 100.0, "mm": 0.1, "cm": 1.0}[info.get("Units", "m").strip()]
    nomes = [n.strip() for n in linhas[3].split("\t")[2:] if n.strip()]
    dados = []
    for linha in linhas[5:]:
        partes = linha.split("\t")
        if len(partes) < 2 + 3 * len(nomes):
            continue
        dados.append([float(v) if v.strip() else np.nan for v in partes[2:2 + 3 * len(nomes)]])
    dados = np.array(dados) * escala
    pontos = {}
    t = np.arange(len(dados))
    for k, nome in enumerate(nomes):
        xyz = dados[:, 3 * k:3 * k + 3].copy()
        bons = ~np.isnan(xyz).any(axis=1)
        if bons.sum() < 2:
            continue
        for c in range(3):
            xyz[:, c] = np.interp(t, t[bons], xyz[bons, c])
        pontos[nome] = xyz
    return fps, pontos


def trc_do_mot(mot, osim):
    """Recalcula os marcadores do modelo (.osim) com os ângulos (.mot) e grava um .trc ao lado do .mot."""
    try:
        import opensim
        from Pose2Sim.Utilities.trc_from_mot_osim import trc_from_mot_osim_func
    except ImportError:
        sys.exit("O caminho .mot precisa do Pose2Sim e do opensim instalados (ver instalar.ps1/instalar.sh).")
    opensim.Logger.setLevelString("error")  # sem os avisos de malhas .vtp ausentes
    saida = os.path.splitext(mot)[0] + "_marcadores.trc"
    with open(os.devnull, "w") as nada, contextlib.redirect_stdout(nada):  # o utilitário imprime cada quadro
        trc_from_mot_osim_func(input_mot_file=mot, input_osim_file=osim, trc_output_file=saida)
    return saida


def completar_apelidos(pontos):
    for nome, origem in APELIDOS.items():
        if nome not in pontos and all(o in pontos for o in origem):
            pontos[nome] = np.mean([pontos[o] for o in origem], axis=0)
    return pontos


def reamostrar(pontos, fps_in, fps_out):
    n = len(next(iter(pontos.values())))
    t_in = np.arange(n) / fps_in
    t_out = np.arange(0.0, t_in[-1] + 1e-9, 1.0 / fps_out)
    return {k: np.stack([np.interp(t_out, t_in, v[:, c]) for c in range(3)], axis=1) for k, v in pontos.items()}


def suavizar(x, sigma):
    """Gaussiana centrada ao longo do tempo (sigma em quadros), com bordas refletidas."""
    if sigma <= 0:
        return x
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.pad(x, ((r, r), (0, 0)), mode="reflect")
    return np.stack([np.convolve(pad[:, c], k, mode="valid") for c in range(x.shape[1])], axis=1)


# ----------------------------------------------------------------------------- álgebra (vetorizada em N quadros)

def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def base(primario, secundario):
    """Colunas: primário, secundário ortogonalizado, primário × secundário. Aceita (3,) ou (N, 3)."""
    p = unit(np.asarray(primario, dtype=float))
    secundario = np.asarray(secundario, dtype=float)
    s = unit(secundario - np.sum(secundario * p, axis=-1, keepdims=True) * p)
    return np.stack([p, s, np.cross(p, s)], axis=-1)


def global_de(atual, repouso):
    """G = B_atual · B_repousoᵀ: leva a base de repouso para a atual."""
    return np.einsum("nij,kj->nik", atual, repouso)


def rodrigues(eixo, angulo):
    eixo = unit(eixo)
    x, y, z = eixo[..., 0], eixo[..., 1], eixo[..., 2]
    zero = np.zeros_like(x)
    k = np.stack([np.stack([zero, -z, y], -1), np.stack([z, zero, -x], -1), np.stack([-y, x, zero], -1)], -2)
    a = np.asarray(angulo)[..., None, None]
    return np.eye(3) + np.sin(a) * k + (1 - np.cos(a)) * (k @ k)


def alinhar(a, b):
    """Menor rotação que leva a direção a até b."""
    a, b = unit(a), unit(b)
    return rodrigues(np.cross(a, b) + 1e-12, np.arctan2(np.linalg.norm(np.cross(a, b), axis=-1), np.sum(a * b, -1)))


def fracao(rots, t):
    """R^t (mesmo eixo, ângulo × t) para dividir uma rotação entre vários ossos."""
    out = np.empty_like(rots)
    for i, r in enumerate(rots):
        q = pc.mat_to_quat(r)
        q = -q if q[0] < 0 else q
        ang = 2 * math.acos(min(1.0, q[0]))
        out[i] = np.eye(3) if ang < 1e-8 else rodrigues(q[1:], ang * t)
    return out


def suave(x, a, b):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def angulo(a, b):
    return np.arccos(np.clip(np.sum(unit(a) * unit(b), -1), -1.0, 1.0))


# ----------------------------------------------------------------------------- esqueleto alvo

class Repouso:
    """Pose de repouso do ASF (cm): início/fim de cada osso, como em processar_clipes.write_bvh."""

    def __init__(self, asf):
        self.bones, length_unit = amc2bvh.parse_asf(asf)
        self.unit = (1.0 / length_unit) * 2.54
        self.ini, self.fim = {}, {}

        def visita(osso, inicio):
            if osso.name == "root":
                self.ini["root"] = self.fim["root"] = np.zeros(3)
            else:
                self.ini[osso.name] = inicio
                self.fim[osso.name] = inicio + osso.direction * osso.length * self.unit
            for filho in osso.children:
                visita(filho, self.fim[osso.name])

        visita(self.bones["root"], np.zeros(3))

    def dir(self, nome):
        return unit(self.bones[nome].direction)

    def dobradica(self, nome):
        """Eixo de flexão do ASF (eixo x do 'axis' C do osso) no mundo, na pose de repouso."""
        return self.bones[nome].C[:, 0]

    def comprimento(self, nome):
        return self.bones[nome].length * self.unit


# ----------------------------------------------------------------------------- IK

def resolver(p, rep, dedos=True):
    """p: {nome do ponto: (N, 3) cm}. Retorna (G {osso: (N,3,3)}, posição da raiz (N,3) cm, escala)."""
    n = len(p["LHip"])
    tem = lambda *nomes: all(k in p for k in nomes)  # noqa: E731
    G = {}

    quadril = (p["LHip"] + p["RHip"]) / 2
    ombros = (p["LShoulder"] + p["RShoulder"]) / 2
    tronco = unit(ombros - quadril)
    r_quadril = (rep.fim["lhipjoint"] + rep.fim["rhipjoint"]) / 2
    r_tronco = unit(rep.fim["thorax"] - r_quadril)

    # Pelve: largura dos quadris + "cima" entre a vertical e o tronco (a inclinação se divide pelve/coluna).
    G["root"] = global_de(base(p["LHip"] - p["RHip"], CIMA + tronco),
                          base(rep.fim["lhipjoint"] - rep.fim["rhipjoint"], CIMA + r_tronco))
    for osso in ("lhipjoint", "rhipjoint"):
        G[osso] = G["root"]

    # Coluna: tronco (quadril → ombros, linha dos ombros), dividido em 3.
    g_tronco = global_de(base(tronco, p["LShoulder"] - p["RShoulder"]),
                         base(r_tronco, rep.fim["lclavicle"] - rep.fim["rclavicle"]))
    passo = fracao(np.einsum("nji,njk->nik", G["root"], g_tronco), 1.0 / 3)
    anterior = G["root"]
    for osso in ("lowerback", "upperback", "thorax"):
        G[osso] = anterior = anterior @ passo
    G["lclavicle"] = G["rclavicle"] = G["thorax"]
    frente_tronco = G["thorax"] @ FRENTE
    cima_tronco = G["thorax"] @ CIMA

    # Cabeça: orelhas (RTMW) > topo da cabeça (HALPE) > olhos (modelo do OpenSim). Dividida em 3.
    cabeca = None
    if tem("LEar", "REar", "Nose"):
        cabeca = (base(p["LEar"] - p["REar"], p["Nose"] - (p["LEar"] + p["REar"]) / 2),
                  base(ESQUERDA, [0.0, -math.sin(math.radians(12)), math.cos(math.radians(12))]))
    elif tem("Head", "Nose"):
        cabeca = (base(p["Head"] - ombros, p["Nose"] - p["Head"]), base(CIMA, np.array([0.0, -0.77, 0.64])))
    elif tem("LEye", "REye", "Nose"):
        cabeca = (base(p["LEye"] - p["REye"], p["Nose"] - (p["LEye"] + p["REye"]) / 2),
                  base(ESQUERDA, [0.0, -math.sin(math.radians(42)), math.cos(math.radians(42))]))
    if cabeca:
        passo = fracao(np.einsum("nji,njk->nik", G["thorax"], global_de(*cabeca)), 1.0 / 3)
    else:
        passo = np.broadcast_to(np.eye(3), (n, 3, 3))
    anterior = G["thorax"]
    for osso in ("lowerneck", "upperneck", "head"):
        G[osso] = anterior = anterior @ passo

    for lado, L in (("l", "L"), ("r", "R")):
        # Braço: dobradiça do cotovelo (braço dobrado) ou "frente + cima" do tronco (braço esticado).
        sup = unit(p[L + "Elbow"] - p[L + "Shoulder"])
        ant = unit(p[L + "Wrist"] - p[L + "Elbow"])
        w = suave(np.degrees(angulo(sup, ant)), 15.0, 35.0)[:, None]
        eixo = unit(w * unit(np.cross(sup, ant)) + (1 - w) * unit(np.cross(sup, frente_tronco + cima_tronco)))
        r_eixo = rep.dobradica(lado + "radius")
        G[lado + "humerus"] = global_de(base(sup, eixo), base(rep.dir(lado + "humerus"), r_eixo))
        G[lado + "radius"] = global_de(base(ant, eixo), base(rep.dir(lado + "radius"), r_eixo))

        # Mão: palma (punho → meio dos nós dos dedos) e largura (indicador → mínimo). Repouso: palma para baixo,
        # polegar para a frente (+Z), como no ASF.
        g_punho = G[lado + "radius"]
        if tem(L + "Index", L + "Pinky"):
            palma = (p[L + "Index"] + p[L + "Pinky"]) / 2 - p[L + "Wrist"]
            g_punho = global_de(base(palma, p[L + "Index"] - p[L + "Pinky"]), base(rep.dir(lado + "wrist"), FRENTE))
        G[lado + "wrist"] = G[lado + "hand"] = G[lado + "fingers"] = G[lado + "thumb"] = g_punho

        nomes = [(L + "Index", L + "Index2", L + "Index4"), (L + "Middle1", L + "Middle2", L + "Middle4"),
                 (L + "Ring1", L + "Ring2", L + "Ring4"), (L + "Pinky", L + "Pinky2", L + "Pinky4")]
        if dedos and all(tem(*trio) for trio in nomes):
            dir_palma = g_punho @ rep.dir(lado + "wrist")
            largura = g_punho @ FRENTE
            normal = np.cross(dir_palma, largura) * (1.0 if lado == "l" else -1.0)  # lado da palma
            prox = unit(sum(unit(p[b] - p[a]) for a, b, _ in nomes))
            dist = unit(sum(unit(p[c] - p[b]) for _, b, c in nomes))
            dobra = lambda v: np.arctan2(np.sum(v * normal, -1), np.sum(v * dir_palma, -1))  # noqa: E731
            a1 = np.clip(dobra(prox), math.radians(-20), math.radians(95))
            a2 = np.clip(dobra(dist) - a1, 0.0, math.radians(110))
            eixo_dedos = np.cross(dir_palma, normal)
            G[lado + "hand"] = rodrigues(eixo_dedos, a1) @ g_punho
            G[lado + "fingers"] = rodrigues(eixo_dedos, a1 + a2) @ g_punho
        if dedos and tem(L + "Thumb", L + "Thumb4"):
            atual = g_punho @ rep.dir(lado + "thumb")
            G[lado + "thumb"] = alinhar(atual, p[L + "Thumb4"] - p[L + "Thumb"]) @ g_punho

        # Perna: dobradiça do joelho (dobrado) ou a partir do pé (esticado).
        coxa = unit(p[L + "Knee"] - p[L + "Hip"])
        canela = unit(p[L + "Ankle"] - p[L + "Knee"])
        if tem(L + "BigToe", L + "SmallToe", L + "Heel"):
            dedos_pe = (p[L + "BigToe"] + p[L + "SmallToe"]) / 2
            frente_pe = unit(dedos_pe - p[L + "Heel"])
            lateral = p[L + "SmallToe"] - p[L + "BigToe"]  # aponta para a ESQUERDA do corpo nos dois pés
            lateral = lateral if lado == "l" else -lateral
        else:
            frente_pe, lateral = G["root"] @ FRENTE, None
        w = suave(np.degrees(angulo(coxa, canela)), 10.0, 30.0)[:, None]
        eixo = unit(w * unit(np.cross(coxa, canela)) + (1 - w) * unit(np.cross(frente_pe, coxa)))
        r_eixo = rep.dobradica(lado + "tibia")
        G[lado + "femur"] = global_de(base(coxa, eixo), base(rep.dir(lado + "femur"), r_eixo))
        G[lado + "tibia"] = global_de(base(canela, eixo), base(rep.dir(lado + "tibia"), r_eixo))
        if lateral is not None:  # repouso: sola para a frente (+Z), largura para a esquerda (+X)
            G[lado + "foot"] = global_de(base(frente_pe, lateral), base(FRENTE, ESQUERDA))
        else:
            G[lado + "foot"] = G[lado + "tibia"]
        G[lado + "toes"] = G[lado + "foot"]

    # Raiz: o quadril do atleta, escalado pela razão das pernas (alvo / atleta).
    perna_atleta = np.median([np.linalg.norm(p[L + "Knee"] - p[L + "Hip"], axis=1)
                              + np.linalg.norm(p[L + "Ankle"] - p[L + "Knee"], axis=1) for L in "LR"])
    perna_alvo = np.mean([rep.comprimento(s + "femur") + rep.comprimento(s + "tibia") for s in "lr"])
    escala = perna_alvo / perna_atleta
    raiz = escala * quadril - G["root"] @ r_quadril
    return G, raiz, escala


def para_clip(G, raiz, rep):
    """Rotações globais → Clip do processar_clipes (rotações locais = G_pai⁻¹ · G)."""
    local = {}
    for nome, osso in rep.bones.items():
        if nome == "root":
            continue
        pai = osso.parent.name
        local[nome] = np.einsum("nji,njk->nik", G[pai], G[nome])
    return pc.Clip(rep.bones, raiz.copy(), G["root"].copy(), local)


def fk(clip, rep):
    """Início e fim de cada osso (cm) em todos os quadros."""
    n = clip.count
    rot = {"root": clip.root_rot}
    ini, fim = {"root": clip.root_pos}, {"root": clip.root_pos}

    def visita(osso):
        for filho in osso.children:
            rot[filho.name] = rot[osso.name] @ clip.local[filho.name]
            ini[filho.name] = fim[osso.name] if osso.name != "root" else clip.root_pos
            fim[filho.name] = ini[filho.name] + rot[filho.name] @ (filho.direction * filho.length * rep.unit)
            visita(filho)

    visita(rep.bones["root"])
    assert all(len(v) == n for v in fim.values())
    return ini, fim


# ----------------------------------------------------------------------------- relatório

def relatorio(p, clip, rep, fps, escala):
    print("Quadros: {} a {:.0f} fps ({:.2f} s); escala atleta → alvo: {:.3f}".format(
        clip.count, fps, clip.count / fps, escala))
    pares = {"coxa": ("Hip", "Knee"), "canela": ("Knee", "Ankle"), "braço": ("Shoulder", "Elbow"),
             "antebraço": ("Elbow", "Wrist")}
    textos = []
    for nome, (a, b) in pares.items():
        comp = [np.linalg.norm(p[L + b] - p[L + a], axis=1) for L in "LR"]
        textos.append("{} {:.1f}±{:.1f}".format(nome, np.median(comp), np.mean([c.std() for c in comp])))
    print("Comprimentos medidos no atleta (cm, mediana±desvio = tremor da triangulação): " + ", ".join(textos))
    _, fim = fk(clip, rep)
    for lado in "lr":
        pe = fim[lado + "toes"]
        apoio = pe[:, 1] < np.percentile(pe[:, 1], 5) + 3.0  # ponta do pé a menos de 3 cm da sua altura mínima
        vel = np.linalg.norm(np.diff(pe[:, [0, 2]], axis=0), axis=1) * fps
        apoiado = apoio[1:] & apoio[:-1]
        desl = np.median(vel[apoiado]) if apoiado.any() else float("nan")
        print("Pé {}: apoiado {:.0f}% do tempo, deslize mediano no apoio {:.1f} cm/s".format(
            "esquerdo" if lado == "l" else "direito", 100 * apoio.mean(), desl))
    for lado, nome in (("r", "direita"), ("l", "esquerda")):
        empurroes = pc.dribble_pushes(clip, rep.unit, lado + "fingers")
        print("Empurrões de drible, mão {} (quadros): {}".format(nome, empurroes))


# ----------------------------------------------------------------------------- principal

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entrada", help=".trc (pose-3d) ou .mot (kinematics, com --osim)")
    ap.add_argument("saida", help="BVH de saída")
    ap.add_argument("--asf", required=True, help="06.asf da CMU (esqueleto alvo do pipeline)")
    ap.add_argument("--osim", help="modelo escalado do OpenSim (obrigatório com .mot)")
    ap.add_argument("--maos-de", help=".trc de onde copiar os pontos das mãos (útil com .mot)")
    ap.add_argument("--fps", type=float, default=60.0, help="fps do BVH (o pipeline do jogo usa 60)")
    ap.add_argument("--sem-dedos", action="store_true", help="dedos e polegar retos (mão segue o punho)")
    ap.add_argument("--suavizar-maos", type=float, default=0.025,
                    help="desvio (s) da gaussiana extra nos pontos das mãos (0 desliga)")
    ap.add_argument("--chao", choices=["auto", "nao"], default="auto",
                    help="auto: desloca na vertical para os pés apoiados ficarem em Y=0")
    ap.add_argument("--manter-posicao", action="store_true",
                    help="não gira para +Z nem leva o 1º quadro para a origem")
    args = ap.parse_args()

    entrada = args.entrada
    if entrada.lower().endswith(".mot"):
        if not args.osim:
            sys.exit("Com .mot, passe também --osim <modelo escalado .osim>.")
        entrada = trc_do_mot(entrada, args.osim)
    fps_in, pontos = ler_trc(entrada)
    pontos = completar_apelidos(pontos)
    if args.maos_de:
        # A mão vem do .trc, transladada para o punho do modelo (o antebraço continua com comprimento fixo).
        _, maos = ler_trc(args.maos_de)
        n = min(len(next(iter(pontos.values()))), len(next(iter(maos.values()))))
        pontos = {k: v[:n] for k, v in pontos.items()}
        for L in "LR":
            delta = pontos[L + "Wrist"] - maos[L + "Wrist"][:n]
            pontos.update({k: v[:n] + delta for k, v in maos.items() if k[0] == L and any(d in k for d in DEDOS)})
    faltam = [k for L in "LR" for k in (L + "Hip", L + "Knee", L + "Ankle", L + "Shoulder", L + "Elbow", L + "Wrist")
              if k not in pontos]
    if faltam:
        sys.exit("Faltam pontos essenciais no arquivo: " + ", ".join(faltam))

    sigma = args.suavizar_maos * fps_in
    for k in pontos:
        if any(d in k for d in DEDOS):
            pontos[k] = suavizar(pontos[k], sigma)
    if abs(fps_in - args.fps) > 1e-6:
        pontos = reamostrar(pontos, fps_in, args.fps)

    rep = Repouso(args.asf)
    G, raiz, escala = resolver(pontos, rep, dedos=not args.sem_dedos)
    clip = para_clip(G, raiz, rep)

    if args.chao == "auto":
        _, fim = fk(clip, rep)
        baixo = np.min([fim[o][:, 1] for o in ("ltoes", "rtoes", "lfoot", "rfoot", "ltibia", "rtibia")], axis=0)
        clip.root_pos[:, 1] -= np.percentile(baixo, 5)
    if not args.manter_posicao:
        pc.align_heading(clip, rep.unit)
        clip.root_pos[:, [0, 2]] -= clip.root_pos[0, [0, 2]]

    pc.FPS = args.fps  # write_bvh grava "Frame Time" a partir desta constante do módulo
    pc.write_bvh(clip, rep.unit, args.saida)
    relatorio(pontos, clip, rep, args.fps, escala)
    print("BVH gravado:", args.saida)


if __name__ == "__main__":
    main()
