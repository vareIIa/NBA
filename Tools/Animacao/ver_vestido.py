# Blender: render de conferência do jogador vestido (corpo + peças do vestir.py), no bind pose.
#
#   blender -b -P Tools/Animacao/ver_vestido.py -- <saida.png> <corpo.glb> <peca1.glb> [peca2.glb ...] [--pose=<clipe>@<frame>]
#
# Faz 3 vistas (frente, lado e 3/4 dos pés) em workbench com a cor da textura, lado a lado num PNG só.
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, BODY, *PIECES = argv
bpy.ops.wm.read_factory_settings(use_empty=True)


def imp(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, bone_heuristic='BLENDER')
    return [o for o in bpy.data.objects if o not in before]


body_objs = imp(BODY)
for o in body_objs:
    if o.type == 'MESH' and not any(m.type == 'ARMATURE' for m in o.modifiers):
        bpy.data.objects.remove(o, do_unlink=True)
for o in bpy.data.objects:
    if o.type == 'ARMATURE':
        o.animation_data_clear()
for p in PIECES:
    for o in imp(p):
        if o.type == 'ARMATURE':
            o.animation_data_clear()
for o in bpy.data.objects:
    if o.type == 'ARMATURE':
        for b in o.pose.bones:
            b.rotation_mode = 'QUATERNION'
            b.rotation_quaternion = (1, 0, 0, 0)
            b.location = (0, 0, 0)

sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.display.shading.show_cavity = True
sc.render.resolution_x, sc.render.resolution_y = 640, 900
sc.render.film_transparent = False
sc.world = bpy.data.worlds.new('w')
sc.world.color = (0.18, 0.19, 0.22)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = 'ORTHO'

views = [  # (posição, alvo, escala ortográfica)
    (Vector((0, -5, 1.0)), Vector((0, 0, 0.9)), 2.0),
    (Vector((5, 0, 1.0)), Vector((0, 0, 0.9)), 2.0),
    (Vector((-1.6, -1.6, 0.9)), Vector((-0.38, 0.0, 0.08)), 0.55),
]
paths = []
for i, (pos, tgt, scale) in enumerate(views):
    cam.location = pos
    cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = scale
    sc.render.filepath = OUT.replace('.png', '_%d.png' % i)
    bpy.ops.render.render(write_still=True)
    paths.append(sc.render.filepath)

# junta as 3 vistas
imgs = [bpy.data.images.load(p) for p in paths]
w, h = imgs[0].size
big = bpy.data.images.new('grade', w * len(imgs), h)
px = [0.0] * (w * len(imgs) * h * 4)
for k, im in enumerate(imgs):
    src = list(im.pixels)
    for y in range(h):
        row = src[y * w * 4:(y + 1) * w * 4]
        start = (y * w * len(imgs) + k * w) * 4
        px[start:start + w * 4] = row
big.pixels = px
big.filepath_raw = OUT
big.file_format = 'PNG'
big.save()
print('VER OK', OUT)
