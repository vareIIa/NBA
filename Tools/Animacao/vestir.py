# Blender: veste uma peça gerada (HY 3D) no hoops_player e exporta um GLB com pele no mesmo esqueleto.
#
#   blender -b -P Tools/Animacao/vestir.py -- <corpo.glb> <peca.glb> <tipo> <saida.glb> [triangulos]
#
# tipo: regata | bermuda | tenis
#  - encaixa a caixa da peça na região do corpo (tronco, quadril+coxas ou pé);
#  - transfere os pesos de pele do corpo para a peça (vértice mais próximo, interpolado);
#  - regata/bermuda: cria "ossos de pano" (pêndulos) na barra; o jogo (ClothSprings) os anima com molas;
#  - tenis: pé direito com pesos em foot_r/ball_r; o esquerdo sai espelhado com foot_l/ball_l;
#  - reduz para [triangulos] (padrão: 9000 regata/bermuda, 5000 por pé) e exporta só a peça + esqueleto.
#
# Bermuda: o bind pose do corpo tem as pernas abertas (~25°); as peças geradas vêm com as pernas retas. A bermuda é
# vestida com as coxas giradas para baixo e essa pose vira o rest do esqueleto exportado. No jogo só importam as
# matrizes de bind de cada malha, então isso não afeta o corpo.
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
BODY, PIECE, KIND, OUT = argv[:4]
TRIS = int(argv[4]) if len(argv) > 4 else (5000 if KIND == 'tenis' else 9000)

bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    before = set(bpy.data.objects)
    # 'BLENDER' mantém os eixos dos ossos do glTF: o GLB exportado tem as mesmas matrizes de bind do jogo.
    bpy.ops.import_scene.gltf(filepath=path, bone_heuristic='BLENDER')
    return [o for o in bpy.data.objects if o not in before]


body_objs = import_glb(BODY)
arm = next(o for o in body_objs if o.type == 'ARMATURE')
# O GLB do jogador também traz uma Icosphere solta: o corpo é a malha com pele no esqueleto.
body = next(o for o in body_objs if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers))
for o in [o for o in body_objs if o.type == 'MESH' and o is not body]:
    bpy.data.objects.remove(o, do_unlink=True)
arm.animation_data_clear()
for b in arm.pose.bones:
    b.rotation_mode = 'QUATERNION'
    b.rotation_quaternion = (1, 0, 0, 0)
    b.location = (0, 0, 0)
    b.scale = (1, 1, 1)
bpy.context.view_layer.update()


def bone_head(name):
    return arm.matrix_world @ arm.pose.bones[name].head


def set_active(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def bake_body_pose():
    """Aplica a pose atual no corpo e a torna o rest do esqueleto."""
    set_active(body)
    mod = next(m for m in body.modifiers if m.type == 'ARMATURE')
    bpy.ops.object.modifier_copy(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    set_active(arm)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')


if KIND == 'bermuda':
    # Coxas apontando para baixo (pernas retas, um pouco abertas), como a bermuda gerada.
    for side in ('l', 'r'):
        pb = arm.pose.bones['thigh_' + side]
        head = bone_head('thigh_' + side)
        tail = arm.matrix_world @ pb.tail
        cur = (tail - head).normalized()
        want = Vector((0.06 if side == 'l' else -0.06, 0, -1)).normalized()
        if (head.x > 0) != (side == 'l'):
            want.x = -want.x
        rot = cur.rotation_difference(want)
        # rotação no espaço do mundo -> espaço local do osso
        m = pb.matrix.copy()
        loc = m.to_translation()
        new = Matrix.Translation(loc) @ rot.to_matrix().to_4x4() @ Matrix.Translation(-loc) @ m
        pb.matrix = new
        bpy.context.view_layer.update()
    bake_body_pose()

# ---------------------------------------------------------------- peça
piece_objs = [o for o in import_glb(PIECE) if o.type == 'MESH']
for o in piece_objs:
    o.parent = None
set_active(piece_objs[0])
for o in piece_objs:
    o.select_set(True)
if len(piece_objs) > 1:
    bpy.ops.object.join()
piece = bpy.context.view_layer.objects.active
piece.name = KIND
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in [o for o in bpy.data.objects if o.type == 'EMPTY']:
    bpy.data.objects.remove(o)


def world_verts(o):
    return [o.matrix_world @ v.co for v in o.data.vertices]


def box(points):
    xs, ys, zs = zip(*points)
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


bv = world_verts(body)
bmin, bmax = box(bv)
H = bmax.z - bmin.z


def fit(lo, hi):
    """Escala (não uniforme) e move a peça para ocupar a caixa lo..hi."""
    pmin, pmax = box(world_verts(piece))
    s = Vector(((hi.x - lo.x) / (pmax.x - pmin.x), (hi.y - lo.y) / (pmax.y - pmin.y), (hi.z - lo.z) / (pmax.z - pmin.z)))
    pc, tc = (pmin + pmax) / 2, (lo + hi) / 2
    m = Matrix.Translation(tc) @ Matrix.Diagonal((s.x, s.y, s.z, 1)) @ Matrix.Translation(-pc)
    piece.data.transform(m)
    piece.data.update()


def region(zlo, zhi, xmax=None):
    pts = [v for v in bv if zlo <= v.z <= zhi and (xmax is None or abs(v.x) <= xmax)]
    return box(pts)


if KIND == 'regata':
    shoulder = abs(bone_head('upperarm_r').x)
    # No boneco o neck_01 fica abaixo da linha dos ombros: o topo da regata (alças) vai até o alto do ombro.
    neck = bone_head('upperarm_r').z + 0.02 * H
    hem = bone_head('pelvis').z - 0.06 * H
    lo, hi = region(bone_head('pelvis').z, bone_head('spine_03').z, shoulder)
    depth = (hi.y - lo.y) * 1.35
    cy = (hi.y + lo.y) / 2
    fit(Vector((-shoulder * 1.2, cy - depth / 2, hem)), Vector((shoulder * 1.2, cy + depth / 2, neck)))
elif KIND == 'bermuda':
    waist = bone_head('pelvis').z + 0.045 * H
    knee = min(bone_head('calf_l').z, bone_head('calf_r').z) + 0.02 * H
    lo, hi = region(knee, waist)
    pad = Vector((0.035 * H, 0.03 * H, 0))
    fit(Vector((lo.x - pad.x, lo.y - pad.y, knee)), Vector((hi.x + pad.x, hi.y + pad.y, waist)))
else:  # tenis: orienta (bico para a frente do corpo) e encaixa no pé direito
    side_x = bone_head('foot_r').x
    foot = [v for v in bv if v.z <= bone_head('foot_r').z + 0.04 * H and (v.x > 0) == (side_x > 0)]
    fmin, fmax = box(foot)
    forward = (bone_head('ball_r') - bone_head('foot_r'))
    forward.z = 0
    forward.normalize()
    # Eixo comprido da peça vira o eixo para a frente; o calcanhar é o lado com o cano mais alto.
    pts = world_verts(piece)
    pmin, pmax = box(pts)
    size = pmax - pmin
    long_axis = 0 if size.x >= size.y else 1
    mid = (pmin[long_axis] + pmax[long_axis]) / 2
    zcut = pmin.z + 0.6 * size.z
    tall = [p for p in pts if p.z > zcut]
    heel_sign = 1 if sum(p[long_axis] for p in tall) / max(1, len(tall)) > mid else -1
    toe_dir = Vector((0, 0, 0))
    toe_dir[long_axis] = -heel_sign
    rot = toe_dir.to_track_quat('Y', 'Z').to_matrix().to_4x4()
    want = forward.to_track_quat('Y', 'Z').to_matrix().to_4x4()
    piece.data.transform(want @ rot.inverted())
    piece.data.update()
    length = (fmax - fmin).length if False else max(fmax.x - fmin.x, fmax.y - fmin.y) * 1.12
    pmin, pmax = box(world_verts(piece))
    s = length / max(pmax.x - pmin.x, pmax.y - pmin.y)
    piece.data.transform(Matrix.Scale(s, 4))
    piece.data.update()
    pmin, pmax = box(world_verts(piece))
    c = (fmin + fmax) / 2
    piece.data.transform(Matrix.Translation(Vector((c.x - (pmin.x + pmax.x) / 2, c.y - (pmin.y + pmax.y) / 2, fmin.z - 0.004 * H - pmin.z))))
    piece.data.update()

# ---------------------------------------------------------------- limpeza
# Some com pedaços soltos pequenos (cordão do calção, etiqueta da gola): < 2% dos vértices da peça.
set_active(piece)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
bm = bmesh.from_edit_mesh(piece.data)
# A malha texturizada vem cortada nas costuras de UV: solda antes (o UV fica nos cantos das faces e não se perde).
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
seen, parts = set(), []
for v in bm.verts:
    if v in seen:
        continue
    stack, part = [v], []
    seen.add(v)
    while stack:
        x = stack.pop()
        part.append(x)
        for e in x.link_edges:
            o = e.other_vert(x)
            if o not in seen:
                seen.add(o)
                stack.append(o)
    parts.append(part)
small = [x for part in parts if len(part) < 0.02 * len(bm.verts) for x in part]
bmesh.ops.delete(bm, geom=small, context='VERTS')
bmesh.update_edit_mesh(piece.data)
bpy.ops.object.mode_set(mode='OBJECT')
print('pedaços soltos removidos:', len([p for p in parts if len(p) < 0.02 * sum(map(len, parts))]))

# ---------------------------------------------------------------- redução
set_active(piece)
tris = sum(len(p.vertices) - 2 for p in piece.data.polygons)
if tris > TRIS:
    dec = piece.modifiers.new('dec', 'DECIMATE')
    dec.ratio = TRIS / tris
    bpy.ops.object.modifier_apply(modifier='dec')
bpy.ops.object.shade_smooth()

# ---------------------------------------------------------------- ossos de pano
cloth_bones = []  # (nome, pai, cabeça, cauda)
if KIND == 'regata':
    top = bone_head('spine_02').z
    pmin, pmax = box(world_verts(piece))
    c = (pmin + pmax) / 2
    r = (pmax - pmin) / 2
    for nm, d in (('pano_F', Vector((0, -1, 0))), ('pano_B', Vector((0, 1, 0))), ('pano_L', Vector((1, 0, 0))), ('pano_R', Vector((-1, 0, 0)))):
        off = Vector((d.x * r.x * 0.75, d.y * r.y * 0.75, 0))
        cloth_bones.append((nm, 'spine_01', Vector((c.x, c.y, top)) + off * 0.6, Vector((c.x, c.y, pmin.z)) + off))
elif KIND == 'bermuda':
    for side in ('l', 'r'):
        hip = bone_head('thigh_' + side)
        pmin, pmax = box([p for p in world_verts(piece) if (p.x > 0) == (hip.x > 0)])
        r = (pmax - pmin) / 2
        cx, cy = (pmin.x + pmax.x) / 2, (pmin.y + pmax.y) / 2
        for nm, dy in (('F', -1), ('B', 1)):
            cloth_bones.append(('pano_%s_%s' % (nm, side), 'thigh_' + side, Vector((cx, cy + dy * r.y * 0.5, hip.z - 0.02 * H)), Vector((cx, cy + dy * r.y * 0.8, pmin.z))))

if cloth_bones:
    set_active(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    inv = arm.matrix_world.inverted()
    for nm, parent, h, t in cloth_bones:
        eb = arm.data.edit_bones.new(nm)
        eb.head, eb.tail = inv @ h, inv @ t
        eb.parent = arm.data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- pesos
set_active(piece)
piece.parent = arm
pm = piece.modifiers.new('Armature', 'ARMATURE')
pm.object = arm
dt = piece.modifiers.new('dt', 'DATA_TRANSFER')
dt.object = body
dt.use_vert_data = True
dt.data_types_verts = {'VGROUP_WEIGHTS'}
dt.vert_mapping = 'POLYINTERP_NEAREST'
dt.layers_vgroup_select_src = 'ALL'
dt.layers_vgroup_select_dst = 'NAME'
bpy.ops.object.datalayout_transfer(modifier='dt')
bpy.ops.object.modifier_move_to_index(modifier='dt', index=0)
bpy.ops.object.modifier_apply(modifier='dt')


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


groups = piece.vertex_groups
if KIND == 'tenis':
    # Rígido no pé; a ponta dobra com ball_r (mesma divisão do corpo).
    for g in list(groups):
        groups.remove(g)
    gf, gb = groups.new(name='foot_r'), groups.new(name='ball_r')
    a, b = bone_head('foot_r'), bone_head('ball_r')
    axis = (b - a)
    axis.z = 0
    L = axis.length
    axis.normalize()
    for v in piece.data.vertices:
        t = smooth(((piece.matrix_world @ v.co - b).dot(axis)) / (0.35 * L) + 0.3)
        gf.add([v.index], 1 - t, 'REPLACE')
        gb.add([v.index], t, 'REPLACE')
elif cloth_bones:
    vs = [piece.matrix_world @ v.co for v in piece.data.vertices]
    for nm, parent, h, t in cloth_bones:
        groups.new(name=nm)
    for i, p in enumerate(vs):
        # Quanto mais perto da barra, mais o pano manda (até 85%); o resto segue o corpo.
        cand = [(nm, h, t) for nm, parent, h, t in cloth_bones if KIND != 'bermuda' or (h.x > 0) == (p.x > 0)]
        ws = []
        for nm, h, t in cand:
            # Regata: a barra solta manda até 85%. Bermuda: a perna segue a coxa; o pano só balança por cima (40%).
            k = smooth((h.z - p.z) / max(1e-4, h.z - t.z)) * (0.4 if KIND == 'bermuda' else 0.85)
            d = (Vector((p.x, p.y, 0)) - Vector((t.x, t.y, 0))).length
            ws.append((nm, k, 1 / (d + 0.02)))
        tot = sum(w for _, _, w in ws)
        k = max(kk for _, kk, _ in ws) if ws else 0
        if k <= 0:
            continue
        for g in groups:
            if g.name.startswith('pano_'):
                continue
            try:
                g.add([i], g.weight(i) * (1 - k), 'REPLACE')
            except RuntimeError:
                pass
        for nm, _, w in ws:
            groups[nm].add([i], k * w / tot, 'REPLACE')

bpy.ops.object.vertex_group_normalize_all(lock_active=False)
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.01)

# Pé esquerdo espelhado.
if KIND == 'tenis':
    left = piece.copy()
    left.data = piece.data.copy()
    left.name = 'tenis_l'
    bpy.context.collection.objects.link(left)
    left.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
    bm = bmesh.new()
    bm.from_mesh(left.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(left.data)
    bm.free()
    for g in left.vertex_groups:
        g.name = g.name.replace('_r', '_l')
    piece.name = 'tenis_r'

# ---------------------------------------------------------------- exporta só a peça
# Texturas do HY vêm em 4K (GLB de 25–45 MB): 1024 px em WebP basta para uma peça vista de longe.
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024 * img.size[1] // img.size[0])
keep = {piece.name} | ({'tenis_l'} if KIND == 'tenis' else set())
print('objetos antes do export:', [(o.name, o.type) for o in bpy.data.objects])
for o in [o for o in bpy.data.objects if o.type == 'MESH' and o.name not in keep]:
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    o.select_set(o.type in ('MESH', 'ARMATURE'))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=False,
                          export_skins=True, export_yup=True, export_image_format='WEBP', export_jpeg_quality=85)
print('VESTIR OK', KIND, OUT, 'tris', sum(len(p.vertices) - 2 for p in piece.data.polygons))
