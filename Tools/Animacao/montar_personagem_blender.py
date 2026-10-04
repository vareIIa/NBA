"""
Monta o personagem "HoopsDummy" no Blender (rodar com Blender 4.x/5.x ou o módulo bpy):

    blender --background --python montar_personagem_blender.py -- <pasta_bvh> <saida.fbx> [--render <pasta_png>]

  1. Importa os BVH processados (processar_clipes.py) no MESMO esqueleto (sujeito 06 da CMU).
  2. Renomeia os ossos para nomes no padrão da Unreal (pelvis, spine_01, thigh_l, hand_r, ...).
  3. Gera uma malha articulada ("boneco de teste"): cada parte presa 100% ao seu osso, em 3 materiais
     (Pele, Uniforme, Tenis) para a Unreal colorir.
  4. Exporta UM FBX com malha + esqueleto + todas as animações (cada uma vira um AnimSequence).
"""
import math
import os
import sys

import bpy  # noqa: I001 (no módulo bpy, o bmesh só existe depois de importar o bpy)
import bmesh
from mathutils import Matrix, Vector

CLIPS = [
    "Hold_Idle", "Walk", "Run",
    "Dribble_Idle_R", "Dribble_Idle_L",
    "Dribble_Walk_R", "Dribble_Walk_L",
    "Dribble_Run_R", "Dribble_Run_L",
    "Dribble_Back_R", "Dribble_Back_L",
    "Dribble_Side_R", "Dribble_Side_L",
    "JumpShot_R", "JumpShot_L",
    "Cross_R2L", "Cross_L2R",
    "Celebrate_Flex", "Celebrate_Shrug",
]

RENAME = {
    "root": "pelvis",
    "lhipjoint": "hip_l", "lfemur": "thigh_l", "ltibia": "calf_l", "lfoot": "foot_l", "ltoes": "ball_l",
    "rhipjoint": "hip_r", "rfemur": "thigh_r", "rtibia": "calf_r", "rfoot": "foot_r", "rtoes": "ball_r",
    "lowerback": "spine_01", "upperback": "spine_02", "thorax": "spine_03",
    "lowerneck": "neck_01", "upperneck": "neck_02", "head": "head",
    "lclavicle": "clavicle_l", "lhumerus": "upperarm_l", "lradius": "lowerarm_l", "lwrist": "hand_l",
    "lhand": "palm_l", "lfingers": "fingers_l", "lthumb": "thumb_l",
    "rclavicle": "clavicle_r", "rhumerus": "upperarm_r", "rradius": "lowerarm_r", "rwrist": "hand_r",
    "rhand": "palm_r", "rfingers": "fingers_r", "rthumb": "thumb_r",
}

SKIN, UNIFORM, SHOES = 0, 1, 2

# osso -> (forma, raio inicial m, raio final m, material). Formas: "capsule", "box", "sphere", None (sem malha).
PARTS = {
    "pelvis": None,
    "hip_l": ("capsule", 0.085, 0.085, UNIFORM), "hip_r": ("capsule", 0.085, 0.085, UNIFORM),
    "thigh_l": ("capsule", 0.085, 0.065, UNIFORM), "thigh_r": ("capsule", 0.085, 0.065, UNIFORM),
    "calf_l": ("capsule", 0.058, 0.042, SKIN), "calf_r": ("capsule", 0.058, 0.042, SKIN),
    "foot_l": ("box", 0.050, 0.045, SHOES), "foot_r": ("box", 0.050, 0.045, SHOES),
    "ball_l": ("box", 0.045, 0.040, SHOES), "ball_r": ("box", 0.045, 0.040, SHOES),
    "spine_01": ("capsule", 0.140, 0.140, UNIFORM), "spine_02": ("capsule", 0.150, 0.155, UNIFORM),
    "spine_03": ("capsule", 0.155, 0.120, UNIFORM),
    "neck_01": ("capsule", 0.050, 0.045, SKIN), "neck_02": ("capsule", 0.045, 0.045, SKIN),
    "head": ("sphere", 0.105, 0.105, SKIN),
    "clavicle_l": ("capsule", 0.050, 0.055, UNIFORM), "clavicle_r": ("capsule", 0.050, 0.055, UNIFORM),
    "upperarm_l": ("capsule", 0.052, 0.042, SKIN), "upperarm_r": ("capsule", 0.052, 0.042, SKIN),
    "lowerarm_l": ("capsule", 0.040, 0.032, SKIN), "lowerarm_r": ("capsule", 0.040, 0.032, SKIN),
    "hand_l": ("box", 0.030, 0.040, SKIN), "hand_r": ("box", 0.030, 0.040, SKIN),
    "palm_l": ("box", 0.040, 0.040, SKIN), "palm_r": ("box", 0.040, 0.040, SKIN),
    "fingers_l": ("box", 0.038, 0.030, SKIN), "fingers_r": ("box", 0.038, 0.030, SKIN),
    "thumb_l": ("capsule", 0.014, 0.012, SKIN), "thumb_r": ("capsule", 0.014, 0.012, SKIN),
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    bvh_dir, out_fbx = argv[0], argv[1]
    render_dir = argv[argv.index("--render") + 1] if "--render" in argv else None
    return bvh_dir, out_fbx, render_dir


def import_bvh(path):
    bpy.ops.import_anim.bvh(filepath=path, global_scale=0.01, frame_start=1, use_fps_scale=False,
                            update_scene_fps=True, rotate_mode='QUATERNION', axis_forward='-Z', axis_up='Y')
    return bpy.context.object


def rename_bones(arm):
    for old, new in RENAME.items():
        bone = arm.data.bones.get(old)
        if bone:
            bone.name = new


def add_capsule(bm, head, tail, r0, r1, segments=12):
    axis = tail - head
    length = axis.length
    if length < 1e-5:
        return []
    rot = axis.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    verts = []
    rings = [(0.0, r0 * 0.6, -r0 * 0.6), (0.0, r0, 0.0), (1.0, r1, 0.0), (1.0, r1 * 0.6, r1 * 0.6)]
    ring_verts = []
    for t, radius, extra in rings:
        ring = []
        for k in range(segments):
            a = 2 * math.pi * k / segments
            local = Vector((math.cos(a) * radius, math.sin(a) * radius, t * length + extra))
            v = bm.verts.new(head + (rot @ local))
            ring.append(v)
            verts.append(v)
        ring_verts.append(ring)
    for r in range(len(ring_verts) - 1):
        for k in range(segments):
            a, b = ring_verts[r][k], ring_verts[r][(k + 1) % segments]
            c, d = ring_verts[r + 1][(k + 1) % segments], ring_verts[r + 1][k]
            bm.faces.new((a, b, c, d))
    bm.faces.new(list(reversed(ring_verts[0])))
    bm.faces.new(ring_verts[-1])
    return verts


def add_box(bm, head, tail, w0, w1):
    axis = tail - head
    length = max(axis.length, 0.02)
    rot = axis.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4() if axis.length > 1e-5 else Matrix.Identity(4)
    corners = []
    for z, w in ((0.0, w0), (length, w1)):
        for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            corners.append(bm.verts.new(head + rot @ Vector((x * w, y * w * 0.6, z))))
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    for f in faces:
        bm.faces.new([corners[i] for i in f])
    return corners


def add_sphere(bm, center, radius):
    result = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=radius,
                                       matrix=Matrix.Translation(center))
    return result["verts"]


def build_mesh(arm):
    mesh = bpy.data.meshes.new("SK_HoopsDummy_Mesh")
    obj = bpy.data.objects.new("SK_HoopsDummy", mesh)
    bpy.context.collection.objects.link(obj)
    for name in ("Pele", "Uniforme", "Tenis"):
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        mesh.materials.append(mat)

    bm = bmesh.new()
    deform = bm.verts.layers.deform.verify()
    groups = {}
    bone_parts = []

    for bone in arm.data.bones:
        spec = PARTS.get(bone.name)
        if not spec:
            continue
        shape, r0, r1, material = spec
        head = arm.matrix_world @ bone.head_local
        tail = arm.matrix_world @ bone.tail_local
        if shape == "capsule":
            verts = add_capsule(bm, head, tail, r0, r1)
        elif shape == "box":
            verts = add_box(bm, head, tail, r0, r1)
        else:
            verts = add_sphere(bm, (head + tail) * 0.5 + Vector((0, 0, 0.04)), r0)
        if bone.name not in groups:
            groups[bone.name] = obj.vertex_groups.new(name=bone.name).index
        bone_parts.append((verts, groups[bone.name], material))

    bm.verts.index_update()
    bm.faces.ensure_lookup_table()
    vert_material = {}
    for verts, group, material in bone_parts:
        for v in verts:
            v[deform][group] = 1.0
            vert_material[v.index] = material
    for face in bm.faces:
        face.material_index = vert_material.get(face.verts[0].index, SKIN)
    bm.to_mesh(mesh)
    bm.free()

    obj.parent = arm
    modifier = obj.modifiers.new("Armature", 'ARMATURE')
    modifier.object = arm
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


def main():
    bvh_dir, out_fbx, render_dir = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 60

    arm = import_bvh(os.path.join(bvh_dir, CLIPS[0] + ".bvh"))
    arm.name = "HoopsDummy"
    arm.data.name = "HoopsDummy_Skeleton"
    rename_bones(arm)
    arm.animation_data.action.name = CLIPS[0]

    actions = [arm.animation_data.action]
    for clip in CLIPS[1:]:
        other = import_bvh(os.path.join(bvh_dir, clip + ".bvh"))
        rename_bones(other)  # renomear com a ação atribuída atualiza os caminhos das F-curves
        action = other.animation_data.action
        action.name = clip
        action.use_fake_user = True
        actions.append(action)
        other.animation_data.action = None
        bpy.data.objects.remove(other, do_unlink=True)

    for action in actions:
        action.use_fake_user = True

    dummy = build_mesh(arm)
    print("Malha: {} vértices, {} faces".format(len(dummy.data.vertices), len(dummy.data.polygons)))

    if render_dir:
        render_preview(arm, render_dir)

    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    dummy.select_set(True)
    bpy.context.view_layer.objects.active = arm
    arm.animation_data.action = actions[0]
    os.makedirs(os.path.dirname(out_fbx), exist_ok=True)
    bpy.ops.export_scene.fbx(
        filepath=out_fbx, use_selection=True, object_types={'ARMATURE', 'MESH'},
        apply_unit_scale=True, global_scale=1.0, axis_forward='-Z', axis_up='Y',
        add_leaf_bones=False, primary_bone_axis='Y', secondary_bone_axis='X', armature_nodetype='NULL',
        mesh_smooth_type='FACE', use_armature_deform_only=False,
        bake_anim=True, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False,
        bake_anim_force_startend_keying=True, bake_anim_simplify_factor=0.0)
    print("Exportado:", out_fbx, "com", len(actions), "animações:", ", ".join(a.name for a in actions))


def render_preview(arm, render_dir):
    """Renderiza quadros de cada clipe (Cycles na CPU, sem GPU) para conferência."""
    os.makedirs(render_dir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 6
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 240
    scene.render.resolution_y = 300
    colors = {"Pele": (0.55, 0.36, 0.25, 1), "Uniforme": (0.05, 0.05, 0.6, 1), "Tenis": (0.9, 0.9, 0.9, 1)}
    for name, color in colors.items():
        material = bpy.data.materials[name]
        material.use_nodes = True
        material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", 'SUN'))
    sun.data.energy = 4.0
    sun.rotation_euler = (math.radians(40), 0, math.radians(30))
    bpy.context.collection.objects.link(sun)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (1.6, -3.4, 1.4)
    cam.rotation_euler = (math.radians(82), 0, math.radians(25))
    scene.camera = cam
    floor = bpy.data.meshes.new("Floor")
    floor.from_pydata([(-2, -2, 0), (2, -2, 0), (2, 2, 0), (-2, 2, 0)], [], [(0, 1, 2, 3)])
    floor_obj = bpy.data.objects.new("Floor", floor)
    bpy.context.collection.objects.link(floor_obj)
    for action in bpy.data.actions:
        arm.animation_data.action = action
        start, end = int(action.frame_range[0]), int(action.frame_range[1])
        for k, frame in enumerate(range(start, end + 1, max(1, (end - start) // 5))):
            scene.frame_set(frame)
            scene.render.filepath = os.path.join(render_dir, "{}_{:02d}.png".format(action.name, k))
            bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(floor_obj, do_unlink=True)
    bpy.data.objects.remove(sun, do_unlink=True)


main()
