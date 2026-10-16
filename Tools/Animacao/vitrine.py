# Blender: vitrine de modelos (GLB/FBX) lado a lado, cada um normalizado para 1 m de altura, em workbench com textura.
#
#   blender -b -P Tools/Animacao/vitrine.py -- <saida.png> <modelo1> [modelo2 ...]
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, *FILES = argv
bpy.ops.wm.read_factory_settings(use_empty=True)
cols = min(5, len(FILES))
for i, f in enumerate(FILES):
    before = set(bpy.data.objects)
    if f.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=f)
    else:
        bpy.ops.import_scene.gltf(filepath=f)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    s = 1.0 / max(hi.z - lo.z, hi.x - lo.x, 1e-6)
    pivot = bpy.data.objects.new('pivo_%d' % i, None)
    bpy.context.collection.objects.link(pivot)
    for o in new:
        if o.parent is None:
            o.parent = pivot
    c = (lo + hi) / 2
    pivot.scale = (s, s, s)
    pivot.location = Vector(((i % cols) * 1.3, 0, -(i // cols) * 1.3)) - Vector((c.x, c.y, lo.z)) * s
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.world = bpy.data.worlds.new('w')
sc.world.color = (0.12, 0.12, 0.14)
rows = math.ceil(len(FILES) / cols)
sc.render.resolution_x, sc.render.resolution_y = 300 * cols, 300 * rows
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 1.3 * max(cols, rows)
cx, cz = (cols - 1) * 1.3 / 2, -(rows - 1) * 1.3 / 2 + 0.5
cam.location = (cx - 4, -8, cz + 2)
cam.rotation_euler = (Vector((cx, 0, cz)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('VITRINE OK', OUT)
