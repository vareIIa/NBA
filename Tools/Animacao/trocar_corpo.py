# Blender: troca a malha do hoops_player pelo corpo gerado no HY 3D Studio, mantendo esqueleto e clipes.
#
#   blender -b -P Tools/Animacao/trocar_corpo.py -- <hoops_player.glb> <corpo_rig.fbx> <saida.glb> [triangulos] [--sem-regata]
#
# --sem-regata: o corpo veio sem camisa (pele de verdade no tronco); não procura a regata cinza para virar "Uniforme".
#
# O FBX do HY (bone_skinning) traz a malha texturizada em A-pose com pesos num esqueleto próprio (Hips, Spine...,
# LeftArm..., LeftUpLeg...). O jogo precisa da malha no bind pose do hoops_player (braços em T, pernas abertas ~25°,
# esqueleto da CMU de 1,715 m) e com pesos nos 31 ossos dele. Os clipes e o clips.json dependem do comprimento dos
# ossos, então o esqueleto fica como está e a MALHA é que se ajusta:
#  1. escala uniforme do corpo do HY para a altura do boneco;
#  2. cada osso do HY recebe uma transformação que leva suas juntas às juntas do boneco (gira o membro e estica ao longo
#     do osso: braço em T, perna aberta), e a malha é deformada pelos próprios pesos do HY (skinning linear);
#     o tronco estica na vertical para o quadril e o ombro baterem com os do boneco; cabeça e pé só se deslocam;
#  3. os pesos do HY viram pesos dos ossos do boneco (Spine1 -> spine_02, LeftHand -> hand_l...);
#  4. reduz para [triangulos] (padrão 30000), cor em 2048 px e normal em 1024 px (WebP), material "Pele";
#  5. exporta esqueleto + malha nova + os 38 clipes, com as mesmas opções do exportar_glb.py.
#
# O tornozelo do boneco fica a 4,5 cm do chão (o do HY, a ~9 cm): a canela do HY termina 4,5 cm acima da junta do
# boneco e o pé só desce até a sola tocar o chão do bind pose (o pé gira em torno de um ponto dentro do calcanhar).
import bpy, bmesh, sys, math, colorsys
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
FLAGS = {a for a in argv if a.startswith('--')}
argv = [a for a in argv if not a.startswith('--')]
OLD, RIG, OUT = argv[:3]
TRIS = int(argv[3]) if len(argv) > 3 else 30000
# Pele que fica à mostra com o uniforme guarda mais triângulos na redução; tronco e coxas (sob a regata e a bermuda)
# pagam a conta. Com só rosto e mãos protegidos, o braço ficava facetado e o cotovelo dobrava numa ponta.
DETAIL = ('Head', 'Neck', 'LeftHand', 'RightHand', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm',
          'LeftShoulder', 'RightShoulder', 'LeftLeg', 'RightLeg')
SHIRTLESS = '--sem-regata' in FLAGS

bpy.ops.wm.read_factory_settings(use_empty=True)


def set_active(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


# ---------------------------------------------------------------- boneco (esqueleto + clipes)
# Os clipes são de 60 quadros/s (exportar_glb.py): a cena precisa estar a 60 antes de importar, senão o export reamostra.
bpy.context.scene.render.fps = 60
bpy.ops.import_scene.gltf(filepath=OLD, bone_heuristic='BLENDER')
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
old = next(o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers))
# O importador cria uma Icosphere de forma de osso: fora.
for o in [o for o in bpy.data.objects if o.type == 'MESH' and o is not old]:
    bpy.data.objects.remove(o, do_unlink=True)
for pb in arm.pose.bones:
    pb.custom_shape = None
    pb.matrix_basis.identity()
# Os clipes ficam nas trilhas NLA (uma por clipe); a ação ativa sairia duplicada no export.
arm.animation_data.action = None
bpy.context.view_layer.update()

OJ = {b.name: arm.matrix_world @ b.head_local for b in arm.data.bones}
OT = {b.name: arm.matrix_world @ b.tail_local for b in arm.data.bones}
ow = [old.matrix_world @ v.co for v in old.data.vertices]
OLD_ZMIN, OLD_ZMAX = min(p.z for p in ow), max(p.z for p in ow)
print('boneco: altura %.3f (%.3f a %.3f)' % (OLD_ZMAX - OLD_ZMIN, OLD_ZMIN, OLD_ZMAX))

# ---------------------------------------------------------------- corpo do HY
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=RIG)
new_objs = [o for o in bpy.data.objects if o not in before]
hyarm = next(o for o in new_objs if o.type == 'ARMATURE')
hy = next(o for o in new_objs if o.type == 'MESH')
for m in list(hy.modifiers):
    hy.modifiers.remove(m)
HJ = {b.name: hyarm.matrix_world @ b.head_local for b in hyarm.data.bones}
HT = {b.name: hyarm.matrix_world @ b.tail_local for b in hyarm.data.bones}
# A malha vem em centímetros sob o esqueleto (escala 0,01): leva para o mundo e solta do pai.
mw = hy.matrix_world.copy()
hy.parent = None
hy.data.transform(mw)
hy.matrix_world = Matrix.Identity(4)
hy.data.update()

# Redução antes da deformação (os grupos de vértices são interpolados pelo colapso).
set_active(hy)
tris = sum(len(p.vertices) - 2 for p in hy.data.polygons)
if tris > TRIS:
    # A pele à mostra (DETAIL) guarda mais triângulos (o colapso nas costuras de UV manchava a testa e facetava o braço).
    keep = hy.vertex_groups.new(name='detalhe')
    for v in hy.data.vertices:
        w = sum(g.weight for g in v.groups if hy.vertex_groups[g.group].name in DETAIL)
        if w > 0:
            keep.add([v.index], min(1.0, w), 'REPLACE')
    dec = hy.modifiers.new('dec', 'DECIMATE')
    dec.ratio = TRIS / tris
    dec.use_collapse_triangulate = True
    dec.vertex_group = keep.name
    dec.invert_vertex_group = True  # o grupo do Decimate marca o que reduzir: invertido, protege rosto e mãos
    dec.vertex_group_factor = 1
    bpy.ops.object.modifier_apply(modifier='dec')
    hy.vertex_groups.remove(hy.vertex_groups['detalhe'])
print('triângulos: %d -> %d' % (tris, sum(len(p.vertices) - 2 for p in hy.data.polygons)))

HY_POS = [v.co.copy() for v in hy.data.vertices]
gname = {g.index: g.name for g in hy.vertex_groups}
HY_W = [{gname[g.group]: g.weight for g in v.groups if g.weight > 0} for v in hy.data.vertices]
HY_ZMIN, HY_ZMAX = min(p.z for p in HY_POS), max(p.z for p in HY_POS)


def axis_scale(d, k, r=1.0):
    """Escala k ao longo da direção unitária d e r na seção transversal."""
    m = Matrix.Identity(3) * r
    for i in range(3):
        for j in range(3):
            m[i][j] += (k - r) * d[i] * d[j]
    return m.to_4x4()


def seg_map(a, b, ta, tb, stretch=True, thicken=False):
    """Leva o segmento a->b ao segmento ta->tb: gira pelo menor arco e estica ao longo do osso. `thicken`: a seção
    transversal cresce com a raiz do estiramento (braço esticado 30% sem engrossar virava um macarrão)."""
    d = (b - a).normalized()
    k = (tb - ta).length / (b - a).length if stretch else 1.0
    r = math.sqrt(k) if thicken and k > 1 else 1.0
    rot = (b - a).rotation_difference(tb - ta).to_matrix().to_4x4()
    return Matrix.Translation(ta) @ rot @ axis_scale(d, k, r) @ Matrix.Translation(-a)


SIDES = (('Left', 'l'), ('Right', 'r'))


def shoulder_target(o):
    """Onde a junta do ombro do HY vai: na reta upperarm->lowerarm do lado `o`, à meia-largura do ombro mais largo."""
    cx = OJ['spine_03'].x
    half = max(abs(OJ['upperarm_l'].x - cx), abs(OJ['upperarm_r'].x - cx))
    a, b = OJ['upperarm_' + o], OJ['lowerarm_' + o]
    d = (b - a).normalized()
    want = half - abs(a.x - cx)
    return a + d * (want / max(1e-6, abs(d.x)))
HAND_SCALE = 0.9


def place(s):
    """Escala s e põe o HY de pé no chão do boneco, com o quadril sobre a pelvis."""
    hips = HJ['Hips']
    return Matrix.Translation(Vector((OJ['pelvis'].x, OJ['pelvis'].y, OLD_ZMIN))) @ Matrix.Scale(s, 4) @ Matrix.Translation(-Vector((hips.x, hips.y, HY_ZMIN)))


def build(s):
    """Deforma o corpo do HY (escala s) até o bind pose do boneco. Devolve posições e transformações por osso."""
    G = place(s)
    J = {n: G @ p for n, p in HJ.items()}
    T = {n: G @ p for n, p in HT.items()}
    P = [G @ p for p in HY_POS]
    M = {}
    # Tronco: estica na vertical entre a junta do quadril e a do ombro para baterem com as do boneco; acima do ombro
    # (trapézio, pescoço, cabeça) só desloca, sem esticar.
    hy_hip = (J['LeftUpLeg'].z + J['RightUpLeg'].z) / 2
    hy_sh = (J['LeftArm'].z + J['RightArm'].z) / 2
    old_hip = (OJ['thigh_l'].z + OJ['thigh_r'].z) / 2
    old_sh = (OJ['upperarm_l'].z + OJ['upperarm_r'].z) / 2
    a = (old_sh - old_hip) / (hy_sh - hy_hip)
    # Postura: no HY a linha dos ombros fica ~5 cm atrás do quadril (no boneco, 2 cm). Cisalha o tronco em Y para os
    # ombros do HY caírem sobre os do boneco; senão as costas ficavam atrás do esqueleto e saíam pela regata.
    dy_sh = (OJ['upperarm_l'].y + OJ['upperarm_r'].y) / 2 - (J['LeftArm'].y + J['RightArm'].y) / 2
    dy_hip = (OJ['thigh_l'].y + OJ['thigh_r'].y) / 2 - (J['LeftUpLeg'].y + J['RightUpLeg'].y) / 2

    def torso(p):
        k = min(1.0, max(0.0, (p.z - hy_hip) / (hy_sh - hy_hip)))
        z = old_hip + a * (p.z - hy_hip) if p.z < hy_sh else p.z + old_sh - hy_sh
        return Vector((p.x, p.y + dy_hip + (dy_sh - dy_hip) * k, z))

    for n in ('root', 'Hips', 'Spine', 'Spine1', 'Spine2'):
        M[n] = torso
    head = Matrix.Translation(Vector((0, dy_sh, old_sh - hy_sh)))
    for n in ('Neck', 'Head', 'Head_end'):
        M[n] = head
    for H, o in SIDES:
        # Ombro: a ponta vai à cabeça do upperarm do boneco.
        # Ombro da malha simétrico: no esqueleto da CMU o ombro direito fica 2,6 cm mais para dentro e 1,7 cm mais alto que
        # o esquerdo; levar a junta do HY até ele estreitava o ombro direito e esticava o braço 40%. A malha usa a
        # largura do ombro mais largo, na linha do braço (o osso continua girando na junta da CMU, dentro do deltoide).
        sh = shoulder_target(o)
        M[H + 'Shoulder'] = seg_map(J[H + 'Shoulder'], J[H + 'Arm'], torso(J[H + 'Shoulder']), sh)
        M[H + 'Arm'] = seg_map(J[H + 'Arm'], J[H + 'ForeArm'], sh, OJ['lowerarm_' + o], thicken=True)
        M[H + 'ForeArm'] = seg_map(J[H + 'ForeArm'], J[H + 'Hand'], OJ['lowerarm_' + o], OJ['hand_' + o], thicken=True)
        # Mão rígida, apontando como a do boneco, a 90% (a do HY sai com 21 cm; a do boneco tem 17).
        hand_t = OJ['hand_' + o] + (OT['fingers_' + o] - OJ['hand_' + o]).normalized() * (T[H + 'Hand'] - J[H + 'Hand']).length
        M[H + 'Hand'] = (Matrix.Translation(OJ['hand_' + o]) @ Matrix.Scale(HAND_SCALE, 4) @ Matrix.Translation(-OJ['hand_' + o])
                         @ seg_map(J[H + 'Hand'], T[H + 'Hand'], OJ['hand_' + o], hand_t, stretch=False))
        M[H + 'Hand_end'] = M[H + 'Hand']
        # Pé: só desloca (sola reta, como no bind pose do boneco) até a sola tocar o chão; a canela termina ali.
        sole = min(P[i].z for i, w in enumerate(HY_W) if w.get(H + 'Foot', 0) + w.get(H + 'ToeBase', 0) > 0.5)
        want_z = OLD_ZMIN + (J[H + 'Foot'].z - sole)
        foot_o = OJ['foot_' + o]
        u = (OJ['calf_' + o] - foot_o).normalized()
        ankle = foot_o + u * ((want_z - foot_o.z) / u.z)
        M[H + 'UpLeg'] = seg_map(J[H + 'UpLeg'], J[H + 'Leg'], OJ['thigh_' + o], OJ['calf_' + o])
        M[H + 'Leg'] = seg_map(J[H + 'Leg'], J[H + 'Foot'], OJ['calf_' + o], ankle)
        for n in ('Foot', 'ToeBase', 'ToeBase_end'):
            M[H + n] = Matrix.Translation(ankle - J[H + 'Foot'])
    # Tudo vira função ponto -> ponto.
    M = {n: (m if callable(m) else (lambda p, m=m: m @ p)) for n, m in M.items()}
    out = []
    for p, w in zip(P, HY_W):
        tot = sum(w.values())
        if tot <= 0:
            out.append(torso(p))
            continue
        q = Vector()
        for n, x in w.items():
            q += M[n](p) * x
        out.append(q / tot)
    return out, M, a


# Escala do HY tal que a altura final (sola ao topo da cabeça) seja a do boneco: a escala do jogo (1,96 m / altura do
# bind) não muda.
s = (OLD_ZMAX - OLD_ZMIN) / (HY_ZMAX - HY_ZMIN)
for it in range(4):
    pos, M, a = build(s)
    h = max(p.z for p in pos) - min(p.z for p in pos)
    print('escala %.4f: altura %.4f (alvo %.4f), tronco x%.3f' % (s, h, OLD_ZMAX - OLD_ZMIN, a))
    if abs(h - (OLD_ZMAX - OLD_ZMIN)) < 5e-4:
        break
    # Acima do ombro a altura cresce com s; abaixo dele as juntas estão presas ao esqueleto.
    above = max(p.z for p in pos) - (OJ['upperarm_l'].z + OJ['upperarm_r'].z) / 2
    s *= 1 + ((OLD_ZMAX - OLD_ZMIN) - h) / above

# ---------------------------------------------------------------- pesos nos ossos do boneco
MAP = {'root': 'pelvis', 'Hips': 'pelvis', 'Spine': 'spine_01', 'Spine1': 'spine_02', 'Spine2': 'spine_03', 'Head': 'head', 'Head_end': 'head'}
for H, o in SIDES:
    MAP.update({H + 'Shoulder': 'clavicle_' + o, H + 'Arm': 'upperarm_' + o, H + 'ForeArm': 'lowerarm_' + o,
                H + 'UpLeg': 'thigh_' + o, H + 'Leg': 'calf_' + o, H + 'Foot': 'foot_' + o, H + 'ToeBase': 'ball_' + o,
                H + 'ToeBase_end': 'ball_' + o, H + 'Hand': 'hand_' + o, H + 'Hand_end': 'hand_' + o})
# Mão rígida em hand_*: nos clipes da CMU o palm e o thumb giram até 175-179° (rolam em torno do próprio eixo, dado ruim
# que a mão-tubo do boneco escondia); com dedos de verdade a mão virava do avesso. palm_*/fingers_* seguem no esqueleto
# (o jogo os usa para achar a palma), só sem pele.


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


# Pescoço do HY (juntas Neck e Head já deformadas): a parte de baixo vai para neck_01, a de cima para neck_02.
G = place(s)
neck_a, neck_b = M['Neck'](G @ HJ['Neck']).z, M['Head'](G @ HJ['Head']).z
weights = []
for p, w in zip(pos, HY_W):
    out = {}
    for n, x in w.items():
        if n == 'Neck':
            k = smooth((p.z - neck_a) / max(1e-4, neck_b - neck_a))
            out['neck_01'] = out.get('neck_01', 0) + x * (1 - k)
            out['neck_02'] = out.get('neck_02', 0) + x * k
        else:
            out[MAP[n]] = out.get(MAP[n], 0) + x
    weights.append(out)

# Ombros: a clavícula do HY desce (A-pose) e a do boneco sobe (T-pose); a mistura linear das transformações do tronco,
# da clavícula e do braço dobrava a pele no alto do ombro (uma prega rasgada que furava a alça da regata). Suaviza o
# DESLOCAMENTO (não a forma) na região da clavícula: o relevo do HY fica, a dobra some.
G0 = place(s)
base = [G0 @ p for p in HY_POS]
disp = [q - b for q, b in zip(pos, base)]
mask = [min(1.0, 1.5 * (w.get('LeftShoulder', 0) + w.get('RightShoulder', 0) + 0.5 * (w.get('LeftArm', 0) + w.get('RightArm', 0))) * (1 if (w.get('LeftShoulder', 0) + w.get('RightShoulder', 0)) > 0.02 else 0.5)) for w in HY_W]
nbr = [[] for _ in pos]
for e in hy.data.edges:
    i, j = e.vertices
    nbr[i].append(j)
    nbr[j].append(i)
for _ in range(4):  # espalha a máscara quatro anéis
    mask = [max([m] + [0.7 * mask[j] for j in nbr[i]]) for i, m in enumerate(mask)]
for _ in range(60):
    disp = [d if not nbr[i] or mask[i] <= 0 else d * (1 - 0.6 * mask[i]) + (sum((disp[j] for j in nbr[i]), Vector()) / len(nbr[i])) * 0.6 * mask[i] for i, d in enumerate(disp)]
pos = [b + d for b, d in zip(base, disp)]

# ---------------------------------------------------------------- malha nova no lugar da antiga
for v, p in zip(hy.data.vertices, pos):
    v.co = p
hy.data.update()
hy.vertex_groups.clear()
groups = {b.name: hy.vertex_groups.new(name=b.name) for b in arm.data.bones}
for i, w in enumerate(weights):
    for b, x in w.items():
        if x > 1e-4:
            groups[b].add([i], x, 'REPLACE')
set_active(hy)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.01)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
if hy.data.has_custom_normals:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
bpy.ops.object.shade_smooth()

# Material: cor e normal do HY (WebP no export). Rugosidade/metal do HY deixavam a pele plástica.
src = hy.data.materials[0]
imgs = {n.image.name: n.image for n in src.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image}
base = next(i for k, i in imgs.items() if k.endswith('20250901.png') or ('normal' not in k and 'metal' not in k and 'rough' not in k))
nrm = next((i for k, i in imgs.items() if 'normal' in k), None)

# Rosto com textura própria: a cabeça do HY está espalhada em dezenas de ilhas pelo atlas inteiro (não dá para recortar).
# As faces da cabeça ganham UV nova (smart project) e a cor do atlas original de 4K é passada para uma imagem de
# FACE_PX px só dela (bake de emissão no Cycles). Antes, de perto, o rosto tinha ~60 px de altura no atlas reduzido.
FACE_PX = 1024
gidx = {g.name: g.index for g in hy.vertex_groups}


def wgt(v, name):
    return next((g.weight for g in hy.data.vertices[v].groups if g.group == gidx[name]), 0.0)


head_faces = [f.index for f in hy.data.polygons if sum(wgt(v, 'head') for v in f.vertices) / len(f.vertices) > 0.5]
uv_main = hy.data.uv_layers.active.name
tmp_me = hy.data.copy()
bm = bmesh.new()
bm.from_mesh(tmp_me)
keep = set(head_faces)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(tmp_me)
bm.free()
assert len(tmp_me.polygons) == len(head_faces)
tmp = bpy.data.objects.new('rosto_tmp', tmp_me)
bpy.context.collection.objects.link(tmp)
uv_face = tmp_me.uv_layers.new(name='rosto')
tmp_me.uv_layers.active = uv_face
uv_face.active_render = True
set_active(tmp)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006)
bpy.ops.object.mode_set(mode='OBJECT')
face_img = bpy.data.images.new('rosto', FACE_PX, FACE_PX)
bm_mat = bpy.data.materials.new('bake_rosto')
bm_mat.use_nodes = True
nt = bm_mat.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
uvn = nt.nodes.new('ShaderNodeUVMap')
uvn.uv_map = uv_main
src_tex = nt.nodes.new('ShaderNodeTexImage')
src_tex.image = base
nt.links.new(uvn.outputs['UV'], src_tex.inputs['Vector'])
emi = nt.nodes.new('ShaderNodeEmission')
outn = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(src_tex.outputs['Color'], emi.inputs['Color'])
nt.links.new(emi.outputs['Emission'], outn.inputs['Surface'])
dst = nt.nodes.new('ShaderNodeTexImage')
dst.image = face_img
nt.nodes.active = dst
tmp_me.materials.clear()
tmp_me.materials.append(bm_mat)
scn = bpy.context.scene
scn.render.engine = 'CYCLES'
scn.cycles.device = 'CPU'
scn.cycles.samples = 1
set_active(tmp)
bpy.ops.object.bake(type='EMIT', margin=8)
face_img.pack()
# A UV nova volta para as faces da cabeça no corpo (no mapa principal: o material do rosto usa só ela).
uvm = hy.data.uv_layers[uv_main].data
uvf = tmp_me.uv_layers['rosto'].data
for fi, tf in zip(head_faces, tmp_me.polygons):
    for li, lt in zip(hy.data.polygons[fi].loop_indices, tf.loop_indices):
        uvm[li].uv = uvf[lt].uv
bpy.data.objects.remove(tmp, do_unlink=True)
print('rosto: %d faces com textura própria de %d px' % (len(head_faces), FACE_PX))

# Cor em 2048 px: o atlas do HY tem o corpo inteiro e, em 1024, o rosto ficava com ~60 px. Normal em 1024.
for img, px_ in ((base, 2048), (nrm, 1024)):
    if img and img.size[0] > px_:
        img.scale(px_, px_ * img.size[1] // img.size[0])


def make_material(name, image=None, color=None, normal=True):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = 0.6
    bsdf.inputs['Metallic'].default_value = 0.0
    if image:
        tb = nt.nodes.new('ShaderNodeTexImage')
        tb.image = image
        nt.links.new(tb.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = color
        m.diffuse_color = color
    if nrm and normal:
        nrm.colorspace_settings.name = 'Non-Color'
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = nrm
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m


# A regata cinza do corpo do HY vira o material "Uniforme", cor de pele lisa (com o relevo do mapa de normal): pelo
# decote e pelas cavas da regata do jogo aparece pele, não uma segunda regata. A bermuda de compressão (cinza mais
# escuro, ~0,47) fica: é comum por baixo do calção. Classe pela cor da textura no centro UV de cada face.
px = np.array(base.pixels[:], dtype=np.float32).reshape(base.size[1], base.size[0], 4)
uvl = hy.data.uv_layers.active.data
neck_top = neck_a + 0.5 * (neck_b - neck_a)
face_cls, skin, greyish = [], [], []
for f in hy.data.polygons:
    u = sum(uvl[li].uv.x for li in f.loop_indices) / f.loop_total
    v = sum(uvl[li].uv.y for li in f.loop_indices) / f.loop_total
    c = px[min(base.size[1] - 1, max(0, int(v * base.size[1]))), min(base.size[0] - 1, max(0, int(u * base.size[0])))][:3]
    h_, s_, v_ = colorsys.rgb_to_hsv(*c)
    z = f.center.z
    # Abaixo de 1,02 m há a bermuda de compressão (cinza ~0,47): lá só o cinza claro é regata; acima, qualquer cinza.
    shirt = not SHIRTLESS and s_ < 0.3 and v_ > (0.53 if z < 1.02 else 0.3) and OJ['thigh_l'].z < z < neck_top and abs(f.center.x) < OJ['upperarm_l'].x + 0.05
    face_cls.append(1 if shirt else 0)
    greyish.append(not SHIRTLESS and s_ < 0.35 and v_ > 0.15 and OJ['thigh_l'].z + 0.1 < z < neck_top + 0.04)
    if s_ > 0.35 and 0.08 < v_ and h_ < 0.12 and OJ['spine_03'].z < z < neck_top + 0.1:
        skin.append(c)
# Suaviza a borda (maioria entre a face e as vizinhas por aresta), para o recorte não sair serrilhado.
edge_faces = {}
for f in hy.data.polygons:
    for ek in f.edge_keys:
        edge_faces.setdefault(ek, []).append(f.index)
nbrs = [set() for _ in hy.data.polygons]
for fs in edge_faces.values():
    for a_ in fs:
        nbrs[a_].update(x for x in fs if x != a_)
for _ in range(2):
    face_cls = [1 if (face_cls[i] + sum(face_cls[j] for j in nbrs[i])) * 2 > len(nbrs[i]) + 1 else 0 for i in range(len(face_cls))]
# Cresce para o cinza vizinho (alças nos ombros, sombra na cava), sem passar para a pele nem para a braçadeira preta.
for _ in range(4):
    face_cls = [1 if face_cls[i] or (greyish[i] and any(face_cls[j] for j in nbrs[i])) else 0 for i in range(len(face_cls))]
# Os pixels da imagem estão em sRGB; a cor do material é linear.
# Cor média da pele do pescoço e dos ombros, sem as sombras e os brilhos (faixa de 40% a 85% do brilho).
if skin:
    sk = np.array(skin)
    lum = sk.mean(axis=1)
    lo_, hi_ = np.percentile(lum, 40), np.percentile(lum, 85)
    skin_rgb = sk[(lum >= lo_) & (lum <= hi_)].mean(axis=0)
else:
    skin_rgb = np.array([0.42, 0.26, 0.17])
skin_rgb = np.where(skin_rgb <= 0.04045, skin_rgb / 12.92, ((skin_rgb + 0.055) / 1.055) ** 2.4)
mat = make_material('Pele', image=base)
under = make_material('Uniforme', color=(float(skin_rgb[0]), float(skin_rgb[1]), float(skin_rgb[2]), 1.0))
# Rosto sem mapa de normal: o da cabeça está nas UVs antigas do atlas.
face_mat = make_material('Rosto', image=face_img, normal=False)
hy.data.materials.clear()
hy.data.materials.append(mat)
hy.data.materials.append(under)
hy.data.materials.append(face_mat)
for f, k in zip(hy.data.polygons, face_cls):
    f.material_index = k
for fi in head_faces:
    hy.data.polygons[fi].material_index = 2
print('regata do HY -> Uniforme: %d faces; pele média %s' % (sum(face_cls), tuple(round(float(x), 3) for x in skin_rgb)))

name = old.name
old_data, old_mats = old.data, list(old.data.materials)
bpy.data.objects.remove(old, do_unlink=True)
bpy.data.meshes.remove(old_data)
for m in old_mats:
    bpy.data.materials.remove(m)
mat.name = 'Pele'
under.name = 'Uniforme'
face_mat.name = 'Rosto'
for o in [hyarm] + [c for c in new_objs if c not in (hy, hyarm)]:
    bpy.data.objects.remove(o, do_unlink=True)
hy.name = name
hy.data.name = name
hy.parent = arm
hy.matrix_parent_inverse = arm.matrix_world.inverted()
mod = hy.modifiers.new('Armature', 'ARMATURE')
mod.object = arm

hw = [hy.matrix_world @ v.co for v in hy.data.vertices]
print('malha nova: %d vértices, %d triângulos, z %.4f a %.4f, x %.3f a %.3f' % (
    len(hw), sum(len(p.vertices) - 2 for p in hy.data.polygons), min(p.z for p in hw), max(p.z for p in hw), min(p.x for p in hw), max(p.x for p in hw)))

# O importador de FBX troca a cena para a taxa do arquivo do HY (24 quadros/s): sem voltar a 60 aqui, o export grava os
# tempos dos clipes divididos por 24 (2,5x mais lentos que o clips.json).
bpy.context.scene.render.fps = 60
bpy.context.scene.render.fps_base = 1
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
hy.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", use_selection=True,
    export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
    export_frame_step=1, export_optimize_animation_size=False, export_anim_single_armature=True,
    export_skins=True, export_all_influences=False, export_def_bones=False,
    export_yup=True, export_apply=False, export_materials="EXPORT", export_image_format='WEBP', export_jpeg_quality=85,
)


def patch_glb(path):
    """Pele no jogo: a arena ilumina de cima, com ambiente azulado e sem mapa de ambiente; a pele saía cinza-arroxeada e
    o rosto, que olha para baixo, escuro. Emissão fraca e quente com a própria cor da textura (imita a luz que atravessa
    a pele), relevo do mapa de normal a 60% e um pouco mais fosca. O exportador do Blender não grava emissão tingida
    junto de textura: o JSON do GLB é ajustado aqui."""
    import json, struct
    raw = open(path, 'rb').read()
    jlen = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + jlen])
    rest = raw[20 + jlen:]
    for m in doc.get('materials', []):
        if m.get('name') not in ('Pele', 'Rosto'):
            continue
        pbr = m.setdefault('pbrMetallicRoughness', {})
        if 'baseColorTexture' in pbr:
            m['emissiveTexture'] = dict(pbr['baseColorTexture'])
            m['emissiveFactor'] = [0.22, 0.187, 0.165]
        pbr['roughnessFactor'] = 0.65
        pbr['metallicFactor'] = 0.0
        if 'normalTexture' in m:
            m['normalTexture']['scale'] = 0.6
    js = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    js += b' ' * (-len(js) % 4)
    out = struct.pack('<I', len(js)) + b'JSON' + js + rest
    open(path, 'wb').write(struct.pack('<4sII', b'glTF', 2, 12 + len(out)) + out)


patch_glb(OUT)
print('TROCAR_CORPO OK', OUT)
