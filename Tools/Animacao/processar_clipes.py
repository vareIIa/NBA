"""
Processa clipes CMU (ASF/AMC) em animações de jogo, prontas para o Blender/Unreal:
  - recorta trechos, fecha loops com crossfade (busca o melhor ponto de emenda pela pose),
  - deixa locomoção "no lugar" (o capsule do jogo é quem anda), alinha a frente do personagem,
  - espelha direita ↔ esquerda (drible com a outra mão),
  - grava BVH (mesmo esqueleto do sujeito 06 para todos os clipes).

Uso:  python processar_clipes.py <pasta_cmu> <pasta_saida>
Precisa: numpy. Usa o parser do amc2bvh.py (mesma pasta).
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import amc2bvh  # noqa: E402

FPS_SOURCE = 120
STEP = 2  # 120 -> 60 fps
FPS = FPS_SOURCE // STEP


# ----------------------------------------------------------------------------- rotações

def mat_to_quat(m):
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        return np.array([0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s])
    if m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        return np.array([(m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s])
    if m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        return np.array([(m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s])
    s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
    return np.array([(m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s])


def quat_to_mat(q):
    w, x, y, z = q / np.linalg.norm(q)
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def slerp(q0, q1, t):
    d = float(np.dot(q0, q1))
    if d < 0:
        q1 = -q1
        d = -d
    if d > 0.9995:
        q = q0 + t * (q1 - q0)
        return q / np.linalg.norm(q)
    theta = math.acos(d)
    return (math.sin((1 - t) * theta) * q0 + math.sin(t * theta) * q1) / math.sin(theta)


def rot_y(angle):
    c, s = math.cos(angle), math.sin(angle)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def angle_between(r0, r1):
    rel = r0.T @ r1
    return math.acos(max(-1.0, min(1.0, (np.trace(rel) - 1) / 2)))


# ----------------------------------------------------------------------------- clipe

class Clip:
    """root_pos (N,3) cm, root_rot (N,3,3), local[nome] (N,3,3) = C·M·C⁻¹ (frames globais alinhados)."""

    def __init__(self, bones, root_pos, root_rot, local):
        self.bones = bones
        self.root_pos = root_pos
        self.root_rot = root_rot
        self.local = local

    @property
    def count(self):
        return len(self.root_pos)

    def copy(self, a=0, b=None):
        b = self.count if b is None else b
        return Clip(self.bones, self.root_pos[a:b].copy(), self.root_rot[a:b].copy(),
                    {k: v[a:b].copy() for k, v in self.local.items()})


def load_clip(asf, amc, unit_to_cm=None):
    bones, length_unit = amc2bvh.parse_asf(asf)
    frames = amc2bvh.parse_amc(amc)[::STEP]
    unit = unit_to_cm or (1.0 / length_unit) * 2.54
    n = len(frames)
    root_pos = np.zeros((n, 3))
    root_rot = np.zeros((n, 3, 3))
    local = {name: np.zeros((n, 3, 3)) for name in bones if name != "root"}
    for i, frame in enumerate(frames):
        r = frame["root"]
        root_pos[i] = np.array(r[0:3]) * unit
        root_rot[i] = amc2bvh.euler_xyz_static(*np.radians(r[3:6]))
        for name, bone in bones.items():
            if name == "root":
                continue
            motion = amc2bvh.bone_motion(bone, frame.get(name, []))
            local[name][i] = bone.C @ motion @ bone.Cinv
    return Clip(bones, root_pos, root_rot, local), unit


def global_joint_positions(clip, unit, frame):
    """FK simples (cm) para medir direção do corpo e emendas."""
    positions = {}

    def visit(bone, parent_rot, start):
        if bone.name == "root":
            rot = clip.root_rot[frame]
            pos = clip.root_pos[frame]
        else:
            rot = parent_rot @ clip.local[bone.name][frame]
            pos = start
        positions[bone.name] = pos
        end = pos + rot @ (bone.direction * bone.length * unit)
        for child in bone.children:
            visit(child, rot, end if bone.name != "root" else pos)

    visit(clip.bones["root"], np.eye(3), clip.root_pos[frame])
    return positions


def facing_yaw(clip, unit, frame):
    """Ângulo (rad, em torno de Y) da frente do corpo: perpendicular à linha dos quadris."""
    p = global_joint_positions(clip, unit, frame)
    right = p["rfemur"] - p["lfemur"]
    right[1] = 0.0
    forward = np.cross(np.array([0.0, 1.0, 0.0]), right)  # cima × direita (sistema destro, Y para cima)
    return math.atan2(forward[0], forward[2])


# ----------------------------------------------------------------------------- operações

def align_heading(clip, unit, target_yaw=0.0, frames=None):
    """Gira o clipe em torno do eixo vertical para a frente média apontar para target_yaw (+Z = 0).
    frames = (a, b): mede a frente só nesse trecho (p.ex. o arremesso, para a soltura sair "para a frente")."""
    a, b = frames if frames else (0, clip.count)
    yaws = [facing_yaw(clip, unit, i) for i in range(a, b, max(1, (b - a) // 30))]
    mean = math.atan2(np.mean(np.sin(yaws)), np.mean(np.cos(yaws)))
    r = rot_y(target_yaw - mean)
    clip.root_rot = np.einsum("ij,njk->nik", r, clip.root_rot)
    clip.root_pos = clip.root_pos @ r.T
    return clip


NATIVE = {}


def in_place(clip, keep_vertical=True):
    """Remove o deslocamento horizontal líquido (tendência linear de X/Z) e centraliza em 0.
    Guarda a velocidade nativa (m/s, no referencial do personagem: +Z = frente, +X = esquerda/direita) em NATIVE."""
    n = clip.count
    disp = (clip.root_pos[-1] - clip.root_pos[0]) / 100.0
    seconds = max(1e-6, (n - 1) / FPS)
    in_place.last_velocity = (disp[0] / seconds, disp[2] / seconds)
    t = np.linspace(0.0, 1.0, n)[:, None]
    start = clip.root_pos[0, [0, 2]]
    end = clip.root_pos[-1, [0, 2]]
    trend = start + (end - start) * t
    clip.root_pos[:, [0, 2]] -= trend
    clip.root_pos[:, [0, 2]] -= clip.root_pos[:, [0, 2]].mean(axis=0)
    return clip


def pose_distance(clip, i, j, bones=None):
    """Distância entre duas poses. bones = só esses ossos (sem a raiz), p.ex. só o tronco/braços."""
    d = 0.0
    if bones is None:
        d += angle_between(clip.root_rot[i], clip.root_rot[j]) * 2.0
        d += abs(clip.root_pos[i, 1] - clip.root_pos[j, 1]) * 0.05
    for name, rots in clip.local.items():
        if bones is None or name in bones:
            d += angle_between(rots[i], rots[j])
    return d


def best_loop(clip, start_range, min_len, max_len, window=(0,), bones=None):
    """Melhor emenda i -> j. window = deslocamentos de quadro comparados juntos (p.ex. (-4, 0, 4)): além da
    pose, casa a DIREÇÃO do movimento, para o ritmo do drible não "engasgar" na emenda."""
    best = (1e9, None, None)
    for i in range(*start_range):
        for j in range(i + min_len, min(i + max_len, clip.count - 1)):
            d = 0.0
            for k in window:
                a, b = i + k, j + k
                if 0 <= a < clip.count and 0 <= b < clip.count:
                    d += pose_distance(clip, a, b, bones)
            if d < best[0]:
                best = (d, i, j)
    return best


def make_loop(clip, i, j, blend):
    """Loop [i, j): os últimos `blend` quadros se fundem com os quadros logo antes de i."""
    loop = clip.copy(i, j)
    n = loop.count
    blend = min(blend, i, n // 2)
    for t in range(blend):
        w = (t + 1) / (blend + 1)
        dst = n - blend + t
        src = i - blend + t
        loop.root_rot[dst] = quat_to_mat(slerp(mat_to_quat(loop.root_rot[dst]), mat_to_quat(clip.root_rot[src]), w))
        loop.root_pos[dst, 1] = (1 - w) * loop.root_pos[dst, 1] + w * clip.root_pos[src, 1]
        for name in loop.local:
            loop.local[name][dst] = quat_to_mat(slerp(mat_to_quat(loop.local[name][dst]), mat_to_quat(clip.local[name][src]), w))
    return loop


UPPER_BODY = {
    "lowerneck", "upperneck", "head",
    "lclavicle", "lhumerus", "lradius", "lwrist", "lhand", "lfingers", "lthumb",
    "rclavicle", "rhumerus", "rradius", "rwrist", "rhand", "rfingers", "rthumb",
}
SPINE = {"lowerback", "upperback", "thorax"}


def retarget(clip, src_unit, bones, unit):
    """Passa um clipe de outro sujeito da CMU para o esqueleto `bones` (sujeito 06). As rotações locais já estão
    em frames alinhados ao mundo (C·M·C⁻¹), então valem para qualquer sujeito; só a altura da pelve é escalada."""
    scale = rest_pelvis_height(bones, unit) / rest_pelvis_height(clip.bones, src_unit)
    return Clip(bones, clip.root_pos * scale, clip.root_rot.copy(), {k: v.copy() for k, v in clip.local.items()})


def resample(clip, n):
    """Reamostra um LOOP para n quadros (slerp), mantendo o fechamento (o quadro n emenda no 0)."""
    m = clip.count
    out = clip.copy(0, 1)
    out.root_pos = np.zeros((n, 3))
    out.root_rot = np.zeros((n, 3, 3))
    out.local = {k: np.zeros((n, 3, 3)) for k in clip.local}
    for k in range(n):
        s = k * m / n
        a = int(math.floor(s)) % m
        b = (a + 1) % m
        w = s - math.floor(s)
        out.root_pos[k] = (1 - w) * clip.root_pos[a] + w * clip.root_pos[b]
        out.root_rot[k] = quat_to_mat(slerp(mat_to_quat(clip.root_rot[a]), mat_to_quat(clip.root_rot[b]), w))
        for name, rots in clip.local.items():
            out.local[name][k] = quat_to_mat(slerp(mat_to_quat(rots[a]), mat_to_quat(rots[b]), w))
    return out


def repeat(clip, times):
    out = clip.copy()
    out.root_pos = np.concatenate([clip.root_pos] * times)
    out.root_rot = np.concatenate([clip.root_rot] * times)
    out.local = {k: np.concatenate([v] * times) for k, v in clip.local.items()}
    return out


def layer_upper(lower, upper, spine_weight=0.5):
    """Pernas/pelve de `lower` + braços/cabeça de `upper` (mesmo número de quadros). O tronco mistura os dois."""
    out = lower.copy()
    for name in out.local:
        if name in UPPER_BODY:
            out.local[name] = upper.local[name].copy()
        elif name in SPINE:
            out.local[name] = np.array([quat_to_mat(slerp(mat_to_quat(a), mat_to_quat(b), spine_weight))
                                        for a, b in zip(lower.local[name], upper.local[name])])
    return out


def speed_up_upper(clip, factor, bones=None):
    """Braços (e o que mais estiver em `bones`) `factor` vezes mais rápidos DENTRO do mesmo loop, pernas intactas.
    O mocap da CMU dribla a ~1-1,5 quique/s; o 2K23 a ~2,1-2,7 (docs/17 §4.1): com factor 2 o braço faz dois
    ciclos de drible por ciclo das pernas."""
    bones = UPPER_BODY if bones is None else bones
    n = clip.count
    out = clip.copy()
    for name in bones:
        rots = clip.local[name]
        new = np.zeros_like(rots)
        for k in range(n):
            pos = (k * factor) % n
            a = int(math.floor(pos)) % n
            b = (a + 1) % n
            new[k] = quat_to_mat(slerp(mat_to_quat(rots[a]), mat_to_quat(rots[b]), pos - math.floor(pos)))
        out.local[name] = new
    return out


MIRROR = np.diag([-1.0, 1.0, 1.0])  # depois de alinhar a frente em +Z, o eixo lateral é X


def mirror(clip):
    out = clip.copy()
    out.root_rot = np.einsum("ij,njk,kl->nil", MIRROR, clip.root_rot, MIRROR)
    out.root_pos = clip.root_pos * np.array([-1.0, 1.0, 1.0])
    for name, rots in clip.local.items():
        other = "r" + name[1:] if name.startswith("l") and ("r" + name[1:]) in clip.local else (
            "l" + name[1:] if name.startswith("r") and ("l" + name[1:]) in clip.local else name)
        out.local[name] = np.einsum("ij,njk,kl->nil", MIRROR, clip.local[other], MIRROR)
    return out


# ----------------------------------------------------------------------------- BVH

def rest_pelvis_height(bones, unit):
    """Distância (cm) da pelve até o ponto mais baixo do esqueleto em repouso (ponta do pé)."""
    lowest = [0.0]

    def visit(bone, start):
        end = start + (bone.direction * bone.length * unit if bone.name != "root" else 0.0)
        lowest[0] = min(lowest[0], end[1] if bone.name != "root" else 0.0)
        for child in bone.children:
            visit(child, end if bone.name != "root" else start)

    visit(bones["root"], np.zeros(3))
    return -lowest[0]


def write_bvh(clip, unit, path):
    """Mesmo formato do amc2bvh (offsets do sujeito do clipe)."""
    bones = clip.bones
    order = []
    lines = ["HIERARCHY"]

    def offset_of(bone):
        if bone.parent is None or bone.parent.name == "root":
            return np.zeros(3)
        return bone.parent.direction * bone.parent.length * unit

    def emit(bone, depth):
        pad = "  " * depth
        if bone.name == "root":
            # OFFSET do root = altura da pelve na pose de repouso (pés no chão no bind pose).
            lines.extend([pad + "ROOT root", pad + "{", pad + "  OFFSET 0 {:.6f} 0".format(rest_pelvis_height(bones, unit)),
                          pad + "  CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation"])
        else:
            lines.extend([pad + "JOINT " + bone.name, pad + "{",
                          pad + "  OFFSET {:.6f} {:.6f} {:.6f}".format(*offset_of(bone)),
                          pad + "  CHANNELS 3 Zrotation Yrotation Xrotation"])
        order.append(bone.name)
        if bone.children:
            for child in bone.children:
                emit(child, depth + 1)
        elif bone.name != "root":
            end = bone.direction * bone.length * unit
            lines.extend([pad + "  End Site", pad + "  {", pad + "    OFFSET {:.6f} {:.6f} {:.6f}".format(*end), pad + "  }"])
        lines.append(pad + "}")

    emit(bones["root"], 0)
    lines += ["MOTION", "Frames: {}".format(clip.count), "Frame Time: {:.8f}".format(1.0 / FPS)]
    for i in range(clip.count):
        values = list(clip.root_pos[i]) + list(amc2bvh.mat_to_euler_zyx_channels(clip.root_rot[i]))
        for name in order[1:]:
            values += list(amc2bvh.mat_to_euler_zyx_channels(clip.local[name][i]))
        lines.append(" ".join("{:.5f}".format(v) for v in values))
    with open(path, "w") as handle:
        handle.write("\n".join(lines) + "\n")


def dribble_pushes(clip, unit, bone, travel_cm=10.0):
    """Quadros em que a mão do drible (dedos) chega ao ponto mais baixo (fim do empurrão): vales com histerese de
    travel_cm (o mesmo detector que o jogo usa em tempo real). Considera o loop (o fim emenda no começo)."""
    z = np.array([global_joint_positions(clip, unit, i)[bone][1] for i in range(clip.count)])
    n = len(z)
    ext = np.concatenate([z, z, z])
    pushes = []
    seeking_min, best_i, best_v = True, 0, ext[0]
    for k in range(1, 3 * n):
        v = ext[k]
        if seeking_min:
            if v < best_v:
                best_i, best_v = k, v
            elif v > best_v + travel_cm:
                if n <= best_i < 2 * n:
                    pushes.append(best_i - n)
                seeking_min, best_v = False, v
        else:
            if v > best_v:
                best_v = v
            elif v < best_v - travel_cm:
                seeking_min, best_i, best_v = True, k, v
    return sorted(set(pushes))


# ----------------------------------------------------------------------------- receita

def main():
    cmu, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    asf = os.path.join(cmu, "06.asf")

    def load(trial):
        return load_clip(asf, os.path.join(cmu, "06_{}.amc".format(trial)))

    results = []

    def emit(name, clip, unit, note):
        write_bvh(clip, unit, os.path.join(out, name + ".bvh"))
        velocity = getattr(in_place, "last_velocity", (0.0, 0.0))
        if note == "espelho":
            velocity = (-velocity[0], velocity[1])
        if name.startswith("Dribble"):
            fingers = "rfingers" if name.endswith("_R") else "lfingers"
            note += "  empurroes {}".format(dribble_pushes(clip, unit, fingers))
        elif not name.startswith("JumpShot"):
            note += "  v(lado={:+.2f}, frente={:+.2f}) m/s".format(*velocity)
        results.append((name, clip.count, note))

    # Parado segurando a bola (ameaça tripla): 06_02, antes de começar a andar.
    clip, unit = load("02")
    d, i, j = best_loop(clip, (8, 20), 50, 85)
    hold = in_place(align_heading(make_loop(clip, i, j, 12), unit))
    emit("Hold_Idle", hold, unit, "loop {}-{} (dist {:.2f})".format(i, j, d))

    # Drible parado, mão direita: 06_12, trecho parado com drible rápido.
    clip, unit = load("12")
    seg = clip.copy(230, 540)
    d, i, j = best_loop(seg, (20, 60), 50, 110)
    idle_r = in_place(align_heading(make_loop(seg, i, j, 10), unit))
    idle_r = speed_up_upper(idle_r, 2, UPPER_BODY | SPINE)  # 2 quiques por loop (pernas quase paradas)
    emit("Dribble_Idle_R", idle_r, unit, "06_12 loop {}-{} (dist {:.2f}), braço 2x".format(i + 230, j + 230, d))
    emit("Dribble_Idle_L", mirror(idle_r), unit, "espelho")

    # Andando e driblando: direita (06_05) e esquerda nativa (06_04). A janela (-4, 0, 4) casa também a direção do
    # movimento na emenda, para o ritmo do drible não "engasgar".
    walks = {}
    for trial, name in (("05", "Dribble_Walk_R"), ("04", "Dribble_Walk_L")):
        clip, unit = load(trial)
        seg = clip.copy(30, clip.count)
        d, i, j = best_loop(seg, (15, 45), 80, 140, window=(-4, 0, 4))
        walk = in_place(align_heading(make_loop(seg, i, j, 12), unit))
        walks[name] = walk
        emit(name, speed_up_upper(walk, 2), unit, "06_{} loop {}-{} (dist {:.2f}), braço 2x".format(trial, i + 30, j + 30, d))

    # Driblando de costas (06_06) e de lado (06_08), direita + espelho.
    for trial, name in (("06", "Dribble_Back"), ("08", "Dribble_Side")):
        clip, unit = load(trial)
        seg = clip.copy(20, clip.count)
        d, i, j = best_loop(seg, (10, 40), 70, 130)
        loop = in_place(align_heading(make_loop(seg, i, j, 12), unit))
        emit(name + "_R", loop, unit, "06_{} loop {}-{} (dist {:.2f})".format(trial, i + 20, j + 20, d))
        emit(name + "_L", mirror(loop), unit, "espelho")

    # Sem bola: parado e andando (06_01).
    clip, unit = load("01")

    # (06_01 já começa andando: o parado sem bola usa o Hold_Idle.)
    seg = clip.copy(60, clip.count)
    d, i, j = best_loop(seg, (15, 45), 60, 140)
    emit("Walk", in_place(align_heading(make_loop(seg, i, j, 12), unit)), unit, "06_01 loop {}-{} (dist {:.2f})".format(i + 60, j + 60, d))

    # Correndo (sem bola): sujeito 16 (16_45, ~4 m/s), passado para o esqueleto do 06. A CMU não tem drible
    # correndo; o "Dribble_Run" junta as pernas dessa corrida com tronco/braços de UM drible do Dribble_Walk_R.
    bones06 = hold.bones
    src, src_unit = load_clip(os.path.join(cmu, "16.asf"), os.path.join(cmu, "16_45.amc"))
    run = retarget(src, src_unit, bones06, unit)
    d, i, j = best_loop(run, (3, 20), 30, 48, window=(-3, 0, 3))
    run = in_place(align_heading(make_loop(run, i, j, 8), unit))
    emit("Run", run, unit, "16_45 (retarget) loop {}-{} (dist {:.2f})".format(i, j, d))

    walk_r = walks["Dribble_Walk_R"]
    upper_bones = UPPER_BODY | SPINE
    d, i, j = best_loop(walk_r, (12, walk_r.count - 64), 42, 60, window=(-3, 0, 3), bones=upper_bones)
    upper = speed_up_upper(resample(make_loop(walk_r, i, j, 8), run.count), 2)  # 2 quiques por passada
    dribble_run = layer_upper(run, upper, spine_weight=0.5)
    emit("Dribble_Run_R", dribble_run, unit, "Run + drible do Dribble_Walk_R {}-{} (dist {:.2f}), 2 por passada".format(i, j, d))
    emit("Dribble_Run_L", mirror(dribble_run), unit, "espelho")

    # Crossover direita -> esquerda: 06_14 (crossover e arremesso), do último drible com a direita até o
    # primeiro com a esquerda. Tocado como ação no drible "crossover" do Pro Stick; o espelho faz esquerda -> direita.
    clip, unit = load("14")
    cross = clip.copy(8, 61)
    align_heading(cross, unit)
    cross = in_place(cross)
    emit("Cross_R2L", cross, unit, "06_14 quadros 8-60 (ação)")
    emit("Cross_L2R", mirror(cross), unit, "espelho")

    # Celebrações (o jogo toca só o tronco/braços, por cima da locomoção): "flex" (79_94) e "shrug" (141_21).
    for subj, trial, a, b, name in (("79", "94", 295, 371, "Celebrate_Flex"), ("141", "21", 25, 91, "Celebrate_Shrug")):
        src, src_unit = load_clip(os.path.join(cmu, subj + ".asf"), os.path.join(cmu, "{}_{}.amc".format(subj, trial)))
        celebration = retarget(src.copy(a, b), src_unit, bones06, unit)
        align_heading(celebration, unit)
        emit(name, in_place(celebration), unit, "{}_{} quadros {}-{} (retarget, só tronco no jogo)".format(subj, trial, a, b - 1))

    # Arremesso saindo do drible (pull-up): 06_15, do último drible até a aterrissagem. A frente e o centro do
    # clipe são medidos no "dip" (quadro 80 = início da ação no jogo), para o corpo não escorregar no blend.
    clip, unit = load("15")
    shot = clip.copy(55, clip.count)
    align_heading(shot, unit, frames=(80, 120))
    shot.root_pos[:, [0, 2]] -= shot.root_pos[80, [0, 2]]
    emit("JumpShot_R", shot, unit, "06_15 quadros 55-fim (one-shot; dip 80, soltura 117)")
    emit("JumpShot_L", mirror(shot), unit, "espelho")

    for name, count, note in results:
        print("{:16s} {:4d} quadros ({:.2f} s)  {}".format(name, count, count / FPS, note))


if __name__ == "__main__":
    main()
