"""
Conversor ASF/AMC (CMU Graphics Lab Motion Capture Database) -> BVH.

Licença dos dados CMU: podem ser usados em produtos comerciais; não podem ser revendidos diretamente,
nem convertidos (http://mocap.cs.cmu.edu/faqs.php). Este script é nosso (sem dependências além do numpy).

Convenção (a mesma de conversores consagrados, ex.: amc_parser):
  G_bone = G_parent · C · M · C⁻¹    (C = rotação "axis" do ASF; M = rotação do AMC; Euler XYZ estático)
No BVH (pose de repouso com orientações identidade), a rotação local de cada junta é C · M · C⁻¹ e o
offset é o vetor do osso pai (direção · comprimento).

Uso: python amc2bvh.py arquivo.asf arquivo.amc saida.bvh [--fps 60] [--scale-cm]
"""
import argparse
import math

import numpy as np


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def euler_xyz_static(rx, ry, rz):
    """Rotações em X, depois Y, depois Z (eixos fixos) = Rz · Ry · Rx."""
    return rot_z(rz) @ rot_y(ry) @ rot_x(rx)


def mat_to_euler_zyx_channels(m):
    """Decompõe R = Rz·Ry·Rx (canais BVH 'Zrotation Yrotation Xrotation'). Retorna graus (z, y, x)."""
    sy = -m[2, 0]
    sy = max(-1.0, min(1.0, sy))
    y = math.asin(sy)
    if abs(sy) < 0.999999:
        x = math.atan2(m[2, 1], m[2, 2])
        z = math.atan2(m[1, 0], m[0, 0])
    else:  # gimbal lock
        x = math.atan2(-m[1, 2], m[1, 1])
        z = 0.0
    return math.degrees(z), math.degrees(y), math.degrees(x)


class Bone:
    def __init__(self, name):
        self.name = name
        self.direction = np.zeros(3)
        self.length = 0.0
        self.axis = np.zeros(3)
        self.dof = []
        self.children = []
        self.parent = None
        self.C = np.eye(3)
        self.Cinv = np.eye(3)


def parse_asf(path):
    bones = {"root": Bone("root")}
    length_unit = 1.0
    with open(path) as handle:
        lines = [line.strip() for line in handle]
    i = 0
    section = None
    current = None
    while i < len(lines):
        line = lines[i]
        i += 1
        if not line or line.startswith("#"):
            continue
        if line.startswith(":"):
            section = line.split()[0]
            if section == ":units":
                pass
            continue
        tokens = line.split()
        if section == ":units" and tokens[0] == "length":
            length_unit = float(tokens[1])
        elif section == ":root" and tokens[0] == "axis":
            pass  # root axis XYZ / orientation 0 0 0 nos dados CMU
        elif section == ":bonedata":
            if tokens[0] == "begin":
                current = None
            elif tokens[0] == "name":
                current = Bone(tokens[1])
                bones[current.name] = current
            elif tokens[0] == "direction":
                current.direction = np.array([float(v) for v in tokens[1:4]])
            elif tokens[0] == "length":
                current.length = float(tokens[1])
            elif tokens[0] == "axis":
                current.axis = np.radians([float(v) for v in tokens[1:4]])
                current.C = euler_xyz_static(*current.axis)
                current.Cinv = current.C.T
            elif tokens[0] == "dof":
                current.dof = tokens[1:]
        elif section == ":hierarchy":
            if tokens[0] in ("begin", "end"):
                continue
            parent = bones[tokens[0]]
            for child_name in tokens[1:]:
                child = bones[child_name]
                child.parent = parent
                parent.children.append(child)
    return bones, length_unit


def parse_amc(path):
    frames = []
    current = None
    with open(path) as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith(":"):
                continue
            tokens = line.split()
            if len(tokens) == 1 and tokens[0].isdigit():
                current = {}
                frames.append(current)
            elif current is not None:
                current[tokens[0]] = [float(v) for v in tokens[1:]]
    return frames


def bone_motion(bone, values):
    rx = ry = rz = 0.0
    for dof, value in zip(bone.dof, values):
        if dof == "rx":
            rx = math.radians(value)
        elif dof == "ry":
            ry = math.radians(value)
        elif dof == "rz":
            rz = math.radians(value)
    return euler_xyz_static(rx, ry, rz)


def write_bvh(bones, frames, out_path, unit_to_cm, step):
    order = []

    def offset_of(bone):
        if bone.parent is None or bone.parent.name == "root":
            return np.zeros(3)
        parent = bone.parent
        return parent.direction * parent.length * unit_to_cm

    lines = ["HIERARCHY"]

    def emit(bone, depth):
        pad = "  " * depth
        if bone.name == "root":
            lines.append(pad + "ROOT root")
            lines.append(pad + "{")
            lines.append(pad + "  OFFSET 0 0 0")
            lines.append(pad + "  CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation")
        else:
            off = offset_of(bone)
            lines.append(pad + "JOINT " + bone.name)
            lines.append(pad + "{")
            lines.append(pad + "  OFFSET {:.6f} {:.6f} {:.6f}".format(*off))
            lines.append(pad + "  CHANNELS 3 Zrotation Yrotation Xrotation")
        order.append(bone)
        if bone.children:
            for child in bone.children:
                emit(child, depth + 1)
        elif bone.name != "root":
            end = bone.direction * bone.length * unit_to_cm
            lines.append(pad + "  End Site")
            lines.append(pad + "  {")
            lines.append(pad + "    OFFSET {:.6f} {:.6f} {:.6f}".format(*end))
            lines.append(pad + "  }")
        lines.append(pad + "}")

    emit(bones["root"], 0)
    used = frames[::step]
    lines.append("MOTION")
    lines.append("Frames: {}".format(len(used)))
    lines.append("Frame Time: {:.8f}".format(step / 120.0))

    for frame in used:
        values = []
        for bone in order:
            if bone.name == "root":
                root = frame["root"]
                pos = np.array(root[0:3]) * unit_to_cm
                rot = euler_xyz_static(*np.radians(root[3:6]))
                values += list(pos)
                values += list(mat_to_euler_zyx_channels(rot))
            else:
                motion = bone_motion(bone, frame.get(bone.name, []))
                local = bone.C @ motion @ bone.Cinv
                values += list(mat_to_euler_zyx_channels(local))
        lines.append(" ".join("{:.5f}".format(v) for v in values))

    with open(out_path, "w") as handle:
        handle.write("\n".join(lines) + "\n")
    return len(used)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("asf")
    parser.add_argument("amc")
    parser.add_argument("out")
    parser.add_argument("--fps", type=int, default=60, choices=[30, 60, 120])
    args = parser.parse_args()

    bones, length_unit = parse_asf(args.asf)
    frames = parse_amc(args.amc)
    # Unidade do ASF: comprimento / length_unit = polegadas.
    unit_to_cm = (1.0 / length_unit) * 2.54
    count = write_bvh(bones, frames, args.out, unit_to_cm, 120 // args.fps)
    print("{} -> {} ({} quadros a {} fps)".format(args.amc, args.out, count, args.fps))


if __name__ == "__main__":
    main()
