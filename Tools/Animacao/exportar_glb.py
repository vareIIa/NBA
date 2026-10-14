"""
Exporta o jogador para o jogo three.js (D15): SK_HoopsDummy.fbx (38 clipes) -> GLB com personagem estilizado.

    blender --background --python exportar_glb.py -- <SK_HoopsDummy.fbx> <saida.glb> [--render <pasta_png>]

  1. Importa o FBX gerado por montar_personagem_blender.py (esqueleto da CMU com nomes da Unreal + 38 ações).
  2. Troca o manequim de peças rígidas por um personagem de malha contínua (Skin modifier sobre o esqueleto,
     subdivisão e pesos automáticos por "bone heat"), com cabeça, cabelo, tênis, meias, uniforme e calção.
  3. Analisa cada clipe (altura das palmas quadro a quadro, vales = empurrão/soltura, picos = recepção) e grava
     <saida>.clips.json, que o jogo usa para sincronizar a bola com a mão animada.
  4. Exporta UM GLB com malha, esqueleto e todas as ações (60 fps, amostradas).

Eixos: no Blender o boneco olha para -Y com a mão direita em -X; no glTF/three ele olha para +Z (Y para cima).
"""
import json
import math
import os
import sys

import bpy  # noqa: I001
import bmesh
from mathutils import Vector

FPS = 60

# ----------------------------------------------------------------------------------------------- malha

# Raios (m) nas juntas do esqueleto de repouso (sujeito 06 da CMU, ~1,72 m; o jogo escala para 1,96 m).
# Chave = (osso, "head" | "tail").
JOINT_RADIUS = {
    ("pelvis", "head"): 0.145,
    ("spine_01", "tail"): 0.138,
    ("spine_02", "tail"): 0.172,
    ("spine_03", "tail"): 0.105,
    ("neck_01", "tail"): 0.062,
    ("neck_02", "tail"): 0.056,
    ("thigh_l", "head"): 0.108, ("thigh_r", "head"): 0.108,
    ("calf_l", "head"): 0.066, ("calf_r", "head"): 0.066,
    ("calf_l", "tail"): 0.044, ("calf_r", "tail"): 0.044,
    ("clavicle_l", "tail"): 0.070, ("clavicle_r", "tail"): 0.070,
    ("lowerarm_l", "head"): 0.049, ("lowerarm_r", "head"): 0.049,
    ("hand_l", "head"): 0.035, ("hand_r", "head"): 0.035,
    ("palm_l", "head"): 0.040, ("palm_r", "head"): 0.040,
    ("fingers_l", "head"): 0.037, ("fingers_r", "head"): 0.037,
    ("fingers_l", "tail"): 0.023, ("fingers_r", "tail"): 0.023,
}

# Ossos que viram tubo no Skin modifier (cabeça e pés são peças à parte).
SKIN_BONES = [
    "hip_l", "thigh_l", "calf_l", "hip_r", "thigh_r", "calf_r",
    "spine_01", "spine_02", "spine_03", "neck_01", "neck_02",
    "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l", "palm_l", "fingers_l",
    "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r", "palm_r", "fingers_r",
]

MATERIALS = {
    # nome: (cor base sRGB, rugosidade)
    "Pele": ((0.42, 0.26, 0.17), 0.55),
    "Uniforme": ((0.07, 0.30, 0.85), 0.62),
    "Calcao": ((0.04, 0.16, 0.48), 0.62),
    "Meia": ((0.95, 0.95, 0.95), 0.8),
    "Tenis": ((0.08, 0.08, 0.09), 0.45),
    "Sola": ((0.96, 0.96, 0.96), 0.6),
    "Cabelo": ((0.03, 0.025, 0.02), 0.9),
    "Faixa": ((0.95, 0.95, 0.95), 0.7),
}

TORSO_BONES = {"spine_01", "spine_02", "spine_03", "clavicle_l", "clavicle_r"}
HIP_BONES = {"pelvis", "hip_l", "hip_r"}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def make_material(name):
    color, rough = MATERIALS[name]
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*[srgb_to_linear(c) for c in color], 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    return mat


def rest(arm, bone, end):
    b = arm.data.bones[bone]
    return arm.matrix_world @ (b.head_local if end == "head" else b.tail_local)


def build_body(arm):
    """Tubo contínuo do corpo: Skin modifier sobre as juntas, subdivisão e pesos automáticos."""
    verts, index_of, edges = [], {}, []

    def joint(bone, end):
        p = rest(arm, bone, end)
        key = (round(p.x, 4), round(p.y, 4), round(p.z, 4))
        if key not in index_of:
            index_of[key] = len(verts)
            verts.append((p, JOINT_RADIUS.get((bone, end))))
        elif JOINT_RADIUS.get((bone, end)):
            i = index_of[key]
            verts[i] = (verts[i][0], JOINT_RADIUS[(bone, end)])
        return index_of[key]

    for bone in SKIN_BONES:
        edges.append((joint(bone, "head"), joint(bone, "tail")))

    mesh = bpy.data.meshes.new("Corpo")
    mesh.from_pydata([v[0] for v in verts], edges, [])
    obj = bpy.data.objects.new("Corpo", mesh)
    bpy.context.collection.objects.link(obj)
    skin = obj.modifiers.new("Skin", "SKIN")
    skin.branch_smoothing = 0.6
    skin.use_smooth_shade = True
    data = mesh.skin_vertices[0].data
    pelvis = index_of[tuple(round(c, 4) for c in rest(arm, "pelvis", "head"))]
    for i, (p, r) in enumerate(verts):
        r = r if r else 0.05
        data[i].radius = (r, r)
        data[i].use_root = i == pelvis
    sub = obj.modifiers.new("Sub", "SUBSURF")
    sub.levels = 2
    sub.render_levels = 2

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier="Skin")
    bpy.ops.object.modifier_apply(modifier="Sub")

    # Tronco mais largo que fundo (o Skin faz seções redondas) e peito/ombros um pouco mais cheios.
    for v in obj.data.vertices:
        co = v.co
        if 0.85 < co.z < 1.36 and abs(co.x) < 0.24:
            co.y *= 0.78
        if 1.12 < co.z < 1.33 and abs(co.x) < 0.22:
            co.x *= 1.08
    obj.select_set(False)
    return obj


def add_part(bm_parts, center, scale, segments=24, rings=14):
    """Esfera deformada (cabeça, cabelo, tênis) num bmesh próprio."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2])) + center
    bm_parts.append(bm)
    return bm


def mesh_from_bmesh(name, bm, material):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def rigid_to(obj, bone):
    group = obj.vertex_groups.new(name=bone)
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")


def build_character(arm):
    mats = {name: make_material(name) for name in MATERIALS}

    body = build_body(arm)
    for name in ("Pele", "Uniforme", "Calcao", "Meia"):
        body.data.materials.append(mats[name])

    # Cabeça (um pouco alongada), cabelo curto e faixa.
    neck_top = rest(arm, "neck_02", "tail")
    head_center = neck_top + Vector((0.0, 0.0, 0.085))
    head = mesh_from_bmesh("Cabeca", add_part([], head_center, (0.088, 0.098, 0.112)), mats["Pele"])
    hair = mesh_from_bmesh("Cabelo", add_part([], head_center + Vector((0, 0.008, 0.022)), (0.092, 0.101, 0.102)),
                           mats["Cabelo"])
    # O cabelo só cobre o alto e a nuca: apaga a metade de baixo e a frente do rosto.
    bm = bmesh.new()
    bm.from_mesh(hair.data)
    kill = [v for v in bm.verts if (v.co.z < head_center.z + 0.01) or (v.co.y < head_center.y - 0.055 and v.co.z < head_center.z + 0.06)]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(hair.data)
    bm.free()
    band = mesh_from_bmesh("Faixa", add_part([], head_center + Vector((0, 0, 0.035)), (0.094, 0.103, 0.022), rings=6), mats["Faixa"])

    # Tênis: corpo do tênis preso ao pé (foot) e bico preso à ponta (ball), com sola branca.
    shoes = []
    for side in ("l", "r"):
        ankle = rest(arm, "foot_" + side, "head")
        toe = rest(arm, "ball_" + side, "tail")
        mid = rest(arm, "ball_" + side, "head")
        heel_center = Vector((ankle.x, ankle.y + 0.01, 0.045))
        body_shoe = mesh_from_bmesh("Tenis_" + side, add_part([], (heel_center + Vector((mid.x, mid.y, 0.045))) * 0.5,
                                                         (0.052, 0.085, 0.048)), mats["Tenis"])
        rigid_to(body_shoe, "foot_" + side)
        toe_part = mesh_from_bmesh("Bico_" + side, add_part([], Vector(((mid.x + toe.x) / 2, (mid.y + toe.y) / 2, 0.032)),
                                                      (0.050, 0.075, 0.034)), mats["Tenis"])
        rigid_to(toe_part, "ball_" + side)
        sole = mesh_from_bmesh("Sola_" + side, add_part([], Vector(((heel_center.x + toe.x) / 2, (heel_center.y + toe.y) / 2 + 0.01, 0.014)),
                                                   (0.056, 0.15, 0.016)), mats["Sola"])
        rigid_to(sole, "foot_" + side)
        shoes += [body_shoe, toe_part, sole]

    for obj in (head, hair, band):
        rigid_to(obj, "head")

    # Pesos automáticos do corpo (bone heat).
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    unweighted = sum(1 for v in body.data.vertices if not v.groups)
    print("Corpo: {} vértices, {} sem peso".format(len(body.data.vertices), unweighted))

    # Materiais do corpo pelo osso dominante de cada face e pela altura.
    group_name = {g.index: g.name for g in body.vertex_groups}
    knee_z = rest(arm, "calf_l", "head").z
    for poly in body.data.polygons:
        weights = {}
        z = 0.0
        for vi in poly.vertices:
            v = body.data.vertices[vi]
            z += v.co.z
            for g in v.groups:
                weights[group_name[g.group]] = weights.get(group_name[g.group], 0.0) + g.weight
        z /= len(poly.vertices)
        bone = max(weights, key=weights.get) if weights else "pelvis"
        if bone in TORSO_BONES:
            mat = "Uniforme"
        elif bone in HIP_BONES or (bone.startswith("thigh") and z > knee_z + 0.12):
            mat = "Calcao"
        elif bone.startswith("calf") and z < 0.19:
            mat = "Meia"
        else:
            mat = "Pele"
        poly.material_index = list(body.data.materials.keys()).index(mat)
        poly.use_smooth = True

    # Junta tudo numa malha só (um SkinnedMesh no three.js).
    parts = [head, hair, band] + shoes
    for p in parts:
        p.parent = arm
        mod = p.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
    bpy.ops.object.select_all(action="DESELECT")
    for p in [body] + parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body.name = "Jogador"
    body.data.name = "Jogador"
    print("Jogador: {} vértices, {} faces, materiais {}".format(
        len(body.data.vertices), len(body.data.polygons), [m.name for m in body.data.materials]))
    return body


# ----------------------------------------------------------------------------------------------- análise

def to_gltf(p):
    """Blender (Z para cima, frente -Y) -> glTF/three (Y para cima, frente +Z)."""
    return [round(p.x, 4), round(p.z, 4), round(-p.y, 4)]


def extrema(values, hysteresis=0.10):
    """Vales e picos com histerese (o mesmo detector de empurrão do jogo na Unreal)."""
    valleys, peaks = [], []
    if not values:
        return valleys, peaks
    looking_down = True
    best_i, best_v = 0, values[0]
    for i, v in enumerate(values):
        if looking_down:
            if v < best_v:
                best_i, best_v = i, v
            elif v > best_v + hysteresis:
                valleys.append(best_i)
                looking_down = False
                best_i, best_v = i, v
        else:
            if v > best_v:
                best_i, best_v = i, v
            elif v < best_v - hysteresis:
                peaks.append(best_i)
                looking_down = True
                best_i, best_v = i, v
    return valleys, peaks


def loop_extrema(values, is_loop):
    """Extremos sem efeito de borda. Loop: roda sobre o clipe repetido 3x (o último quadro = o primeiro) e fica com os
    da cópia do meio. Ação: ignora os extremos no primeiro e no último quadro (são só o começo/fim da série)."""
    if is_loop and len(values) > 2:
        n = len(values) - 1
        tiled = values[:n] * 3 + values[:1]
        valleys, peaks = extrema(tiled)
        pick = lambda idx: sorted({i - n for i in idx if n <= i < 2 * n})
        return pick(valleys), pick(peaks)
    valleys, peaks = extrema(values)
    last = len(values) - 1
    return [i for i in valleys if 0 < i < last], [i for i in peaks if 0 < i < last]


def analyze(arm, actions):
    scene = bpy.context.scene
    clips = {}
    pb = arm.pose.bones
    for action in actions:
        arm.animation_data.action = action
        start, end = int(action.frame_range[0]), int(action.frame_range[1])
        palms = {"r": [], "l": []}
        feet = {"r": [], "l": []}
        pelvis = []
        for f in range(start, end + 1):
            scene.frame_set(f)
            for side in ("r", "l"):
                palm = arm.matrix_world @ ((pb["palm_" + side].head + pb["palm_" + side].tail) * 0.5)
                palms[side].append(to_gltf(palm))
                feet[side].append(to_gltf(arm.matrix_world @ pb["ball_" + side].head))
            pelvis.append(to_gltf(arm.matrix_world @ pb["pelvis"].head))
        info = {
            "frames": end - start + 1,
            "duration": round((end - start) / FPS, 4),
            "palm_r": palms["r"], "palm_l": palms["l"],
            "ball_r": feet["r"], "ball_l": feet["l"],
            "pelvis": pelvis,
        }
        is_loop = action.name.startswith("Dribble_") or action.name in ("Walk", "Run", "Hold_Idle")
        for side in ("r", "l"):
            valleys, peaks = loop_extrema([p[1] for p in palms[side]], is_loop)
            info["valleys_" + side] = valleys
            info["peaks_" + side] = peaks
        clips[action.name] = info
        print("{:20s} {:4d} quadros  vales R {} picos R {}  vales L {} picos L {}".format(
            action.name, info["frames"], info["valleys_r"], info["peaks_r"], info["valleys_l"], info["peaks_l"]))
    return clips


# ----------------------------------------------------------------------------------------------- principal

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:]
    fbx, out = argv[0], argv[1]
    render = argv[argv.index("--render") + 1] if "--render" in argv else None
    return fbx, out, render


def main():
    fbx, out_glb, render_dir = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    bpy.ops.import_scene.fbx(filepath=fbx, automatic_bone_orientation=False)

    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    arm.name = "Jogador_Rig"
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        bpy.data.objects.remove(o, do_unlink=True)  # o manequim antigo sai

    # O importador de FBX pode criar a mesma ação duas vezes ("Rig|X" e "Rig|Rig|X"): fica uma por nome.
    by_name = {}
    for action in list(bpy.data.actions):
        name = action.name.split("|")[-1]
        if name in by_name:
            bpy.data.actions.remove(action)
            continue
        by_name[name] = action
    actions = []
    for name, action in by_name.items():
        action.name = name
        action.use_fake_user = True
        actions.append(action)
    actions.sort(key=lambda a: a.name)
    if arm.animation_data is None:
        arm.animation_data_create()

    # Pose de repouso para montar a malha.
    arm.animation_data.action = None
    for pbone in arm.pose.bones:
        pbone.location = (0, 0, 0)
        pbone.rotation_quaternion = (1, 0, 0, 0)
        pbone.rotation_euler = (0, 0, 0)
    scene.frame_set(1)

    player = build_character(arm)
    clips = analyze(arm, actions)

    if render_dir:
        render_preview(arm, actions, render_dir)

    # Cada ação vira uma faixa NLA para o exportador glTF levar todas.
    arm.animation_data.action = None
    for action in actions:
        track = arm.animation_data.nla_tracks.new()
        track.name = action.name
        strip = track.strips.new(action.name, int(action.frame_range[0]), action)
        strip.name = action.name
        track.mute = True

    os.makedirs(os.path.dirname(os.path.abspath(out_glb)), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    player.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out_glb, export_format="GLB", use_selection=True,
        export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
        export_frame_step=1, export_optimize_animation_size=False, export_anim_single_armature=True,
        export_skins=True, export_all_influences=False, export_def_bones=False,
        export_yup=True, export_apply=False, export_materials="EXPORT",
    )
    meta = {"fps": FPS, "source": os.path.basename(fbx), "clips": clips}
    with open(os.path.splitext(out_glb)[0] + ".clips.json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, separators=(",", ":"))
    print("Exportado:", out_glb, "com", len(actions), "ações")


def render_preview(arm, actions, out_dir):
    """Folha de contato rápida (Eevee) de alguns clipes, para conferir a malha deformando."""
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 480, 640
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (-2.2, -3.6, 1.4)
    cam.rotation_euler = (math.radians(84), 0, math.radians(-31))
    scene.camera = cam
    light = bpy.data.objects.new("sol", bpy.data.lights.new("sol", "SUN"))
    light.data.energy = 3.0
    light.rotation_euler = (math.radians(40), 0, math.radians(-30))
    scene.collection.objects.link(light)
    world = bpy.data.worlds.new("w")
    world.color = (0.2, 0.2, 0.22)
    scene.world = world
    for name, frame in (("Dribble_Idle_R", 1), ("Dribble_Walk_R", 20), ("Cross_R2L", 20), ("Spin_R2L", 30),
                        ("JumpShot2_R", 55), ("Layup_R", 45)):
        action = next((a for a in actions if a.name == name), None)
        if not action:
            continue
        arm.animation_data.action = action
        scene.frame_set(frame)
        scene.render.filepath = os.path.join(out_dir, "{}_{}.png".format(name, frame))
        bpy.ops.render.render(write_still=True)
    arm.animation_data.action = None


if __name__ == "__main__":
    main()
