# Blender: veste uma peça gerada (HY 3D) no hoops_player e exporta um GLB com pele no mesmo esqueleto.
#
#   blender -b -P Tools/Animacao/vestir.py -- <corpo.glb> <peca.glb> <tipo> <saida.glb> [triangulos] [--por-cima-de=<peca.glb>]
#
# --por-cima-de: GLB de uma peça já vestida (a bermuda) que esta (a regata) cobre: a barra da regata vai para fora do
# cós da bermuda, senão as duas se cruzam na cintura.
#
# tipo: regata | bermuda | tenis (o tenis sai com a meia: meia_r e meia_l, a pele do pé e da canela inflada 3,5 mm)
#  - encaixa a caixa da peça na região do corpo (tronco, quadril+coxas ou pé);
#  - transfere os pesos de pele do corpo para a peça (vértice mais próximo, interpolado);
#  - regata/bermuda: cria "ossos de pano" (pêndulos) na barra; o jogo (ClothSprings) os anima com molas;
#  - tenis: pesos copiados da pele do pé (vizinhos no corpo, bind); o esquerdo sai espelhado com os ossos _l;
#  - reduz para [triangulos] (padrão: 9000 regata/bermuda, 5000 por pé) e exporta só a peça + esqueleto.
#
# Bermuda: o bind pose do corpo tem as pernas abertas (~25°); as peças geradas vêm com as pernas retas. A bermuda é
# vestida com as coxas giradas para baixo e essa pose vira o rest do esqueleto exportado. No jogo só importam as
# matrizes de bind de cada malha, então isso não afeta o corpo.
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
OVER = next((a.split('=', 1)[1] for a in argv if a.startswith('--por-cima-de=')), None)
argv = [a for a in argv if not a.startswith('--')]
BODY, PIECE, KIND, OUT = argv[:4]
TRIS = int(argv[4]) if len(argv) > 4 else (5000 if KIND == 'tenis' else 9000)
SMOOTH_ITER = int(next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--alisar=')), 12 if KIND == 'regata' else 60))

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
# Ossos que cada peça segue. A regata acompanha só o tronco (a cava não vai atrás do braço; senão o ombro esticava e
# quebrava); a bermuda só quadril e coxas (a barra não dobra com o joelho).
ALLOWED = {
    'regata': {'pelvis', 'hip_l', 'hip_r', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'},
    'bermuda': {'pelvis', 'hip_l', 'hip_r', 'spine_01', 'thigh_l', 'thigh_r'},
}.get(KIND)
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
    # Topo da alça = topo do ombro na pele (trapézio, onde a alça passa), não a junta do ombro: no corpo do HY o trapézio
    # fica ~5 cm acima da junta e a alça nascia dentro dele (o empurrão para fora inflava um calombo no ombro).
    cx0 = bone_head('spine_03').x
    strap = [v for v in bv if 0.095 * H / 1.715 < abs(v.x - cx0) < 0.15 * H / 1.715 and bone_head('upperarm_r').z - 0.05 * H < v.z < bone_head('head').z]
    neck = max([bone_head('upperarm_r').z + 0.02 * H] + [v.z + 0.006 * H for v in strap])
    print('topo da alça: %.3f (junta do ombro %.3f)' % (neck, bone_head('upperarm_r').z))
    hem = bone_head('pelvis').z - 0.06 * H
    # Caixa do tronco até a altura do peito (o corpo do HY tem peito e costas bem mais fundos que a cintura).
    lo, hi = region(bone_head('pelvis').z, bone_head('upperarm_r').z - 0.03 * H, shoulder)
    depth = (hi.y - lo.y) * 1.3
    cy = (hi.y + lo.y) / 2
    half = max(shoulder * 1.2, max(-lo.x, hi.x) * 1.25)
    fit(Vector((-half, cy - depth / 2, hem)), Vector((half, cy + depth / 2, neck)))
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
    # Encaixe pelo pé de verdade (corpo descalço): comprimento = pé + folga, largura = pé + folga, o calcanhar do tênis
    # um pouco atrás do calcanhar do pé e a sola na altura da sola (o jogo prega a sola do corpo no chão). A altura segue
    # a média das duas escalas.
    side = forward.cross(Vector((0, 0, 1))).normalized()
    def ext(points, axis):
        vals = [p.dot(axis) for p in points]
        return min(vals), max(vals)
    sole = [v for v in foot if v.z <= fmin.z + 0.03 * H]
    f_lo, f_hi = ext(sole, forward)
    w_lo, w_hi = ext(sole, side)
    pts = world_verts(piece)
    p_lo, p_hi = ext(pts, forward)
    q_lo, q_hi = ext(pts, side)
    s_len = ((f_hi - f_lo) * 1.06 + 0.012 * H) / (p_hi - p_lo)
    s_wid = ((w_hi - w_lo) * 1.15 + 0.008 * H) / (q_hi - q_lo)
    s_up = (s_len + s_wid) / 2
    sc = Matrix.Identity(4)
    for i in range(3):
        for j in range(3):
            sc[i][j] = forward[i] * forward[j] * s_len + side[i] * side[j] * s_wid + (1 if i == j == 2 else 0) * s_up
    piece.data.transform(sc)
    piece.data.update()
    pts = world_verts(piece)
    p_lo, p_hi = ext(pts, forward)
    q_lo, q_hi = ext(pts, side)
    pmin, pmax = box(pts)
    heel_gap = 0.006 * H
    shift = forward * ((f_lo - heel_gap) - p_lo) + side * ((w_lo + w_hi) / 2 - (q_lo + q_hi) / 2)
    shift.z = fmin.z - pmin.z
    piece.data.transform(Matrix.Translation(shift))
    piece.data.update()
    print('tênis: escala comprimento %.3f largura %.3f' % (s_len, s_wid))

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


def radial_dir(p):
    """Direção horizontal "para fora" no ponto p: do eixo da coxa (bermuda, abaixo do quadril) ou da coluna."""
    if KIND == 'bermuda' and p.z < bone_head('thigh_l').z:
        side = 'l' if (p.x > 0) == (bone_head('thigh_l').x > 0) else 'r'
        a_, b_ = bone_head('thigh_' + side), bone_head('calf_' + side)
        seg = b_ - a_
        k = max(0.0, min(1.0, (p - a_).dot(seg) / seg.length_squared))
        d = p - (a_ + seg * k)
        d -= seg.normalized() * d.dot(seg.normalized())
    else:
        d = Vector((p.x - bone_head('spine_02').x, p.y - bone_head('spine_02').y, 0))
    return d.normalized() if d.length > 1e-6 else Vector((0, -1, 0))


if KIND in ('regata', 'bermuda'):
    # Só o tecido, sem o avesso: o HY gera a peça com duas camadas a milímetros e, depois da redução e do encaixe, o
    # avesso furava o tecido em lascas (azuis no kit branco). Fica a camada de fora; o jogo desenha a roupa dos dois
    # lados, então pela cava e pelo decote aparece o verso do próprio tecido.
    # "Para fora" = do eixo interno mais próximo (coluna e linha clavícula-ombro na regata; quadril e coxas na bermuda)
    # até a face. No alto do ombro aponta para cima (com a direção radial horizontal, o pano deitado sobre o ombro ficava
    # sem lado e as duas camadas da alça sobravam, amassadas); e vale mesmo onde a peça ainda está dentro da pele.
    from mathutils.geometry import intersect_point_line
    if KIND == 'regata':
        core = [(bone_head('pelvis'), bone_head('neck_01'))] + [(bone_head('clavicle_' + s), bone_head('upperarm_' + s)) for s in ('l', 'r')]
    else:
        core = [(bone_head('thigh_l'), bone_head('thigh_r'))] + [(bone_head('thigh_' + s), bone_head('calf_' + s)) for s in ('l', 'r')]

    def outward(p):
        best, bd = None, 1e9
        for a_, b_ in core:
            q, k = intersect_point_line(p, a_, b_)
            q = a_ if k < 0 else b_ if k > 1 else q
            d = (p - q).length
            if d < bd:
                best, bd = (p - q), d
        return best.normalized() if bd > 1e-6 else radial_dir(p)

    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(piece.data)
    mw3 = piece.matrix_world.to_3x3()
    inner = [f for f in bm.faces if (mw3 @ f.normal).normalized().dot(outward(piece.matrix_world @ f.calc_center_median())) < -0.1]
    bmesh.ops.delete(bm, geom=inner, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bmesh.update_edit_mesh(piece.data)
    bpy.ops.object.mode_set(mode='OBJECT')
    print('faces do avesso removidas:', len(inner))

def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------- bermuda: só o que fica à mostra
if KIND == 'bermuda':
    # A regata cobre o cós e a braguilha. Era justamente ali que as pregas franzidas da bermuda do HY se atravessavam ao
    # levantar a coxa (e alisar ou assentar só amassava). Corta a bermuda ~1,5 cm acima da barra da regata (vestir.py
    # encaixa a barra em pelvis - 6% da altura), abaixo das pregas mais fundas (as pontas furavam a barra); nessa faixa
    # as duas peças ficam presas ao quadril e andam juntas.
    z_cut = bone_head('pelvis').z - 0.06 * H + 0.008 * H
    set_active(piece)
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(piece.data)
    mw = piece.matrix_world
    above = [f for f in bm.faces if all((mw @ v.co).z > z_cut for v in f.verts)]
    bmesh.ops.delete(bm, geom=above, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.update_edit_mesh(piece.data)
    bpy.ops.object.mode_set(mode='OBJECT')
    print('bermuda cortada acima de %.3f m: %d faces fora' % (z_cut, len(above)))


# ---------------------------------------------------------------- redução
set_active(piece)
tris = sum(len(p.vertices) - 2 for p in piece.data.polygons)
if tris > TRIS:
    dec = piece.modifiers.new('dec', 'DECIMATE')
    dec.ratio = TRIS / tris
    bpy.ops.object.modifier_apply(modifier='dec')
bpy.ops.object.shade_smooth()

if KIND == 'regata':
    # Pregas mais rasas: as dobras fundas do modelo do HY, com a coxa girando para a frente, atravessavam umas às outras
    # (o verso do pano aparecia em bordas serrilhadas). A textura do HY já traz a sombra das dobras pintada, então o
    # pano continua parecendo franzido. O empurrão para fora da pele vem depois e corrige o encolhimento.
    sm = piece.modifiers.new('pregas', 'SMOOTH')
    sm.factor = 0.6 if KIND == 'regata' else 1.0
    sm.iterations = SMOOTH_ITER
    bpy.ops.object.modifier_apply(modifier='pregas')

# Pano sempre por fora da pele: a caixa não segue o relevo do corpo (peitoral e coxa do corpo do HY) e a pele furava o
# tecido no decote. Cada vértice da peça dentro do corpo ou a menos de `margin` dele pede um empurrão ao longo da normal
# da pele. O empurrão vira um campo suave: em cada vértice, a direção é a média (ponderada) dos pedidos num raio R e o
# tamanho é o maior pedido com queda suave. O tecido e o avesso (o HY gera as duas camadas, a poucos mm) recebem quase o
# mesmo vetor, então o avesso não passa à frente do tecido.
if KIND in ('regata', 'bermuda'):
    from mathutils.bvhtree import BVHTree
    from mathutils.kdtree import KDTree
    margin = 0.004 * H
    # Assentamento: alça e decote da regata deitam no ombro e no peito; o cós da bermuda deita no quadril. A camada de
    # dentro da peça (a mais perto da pele num raio de 1,5 cm) vai para `margin` da pele; a de fora vem junto, com a
    # mesma espessura. Alvo = só a pele que segue os ossos da peça (a alça não gruda no deltoide, que é do braço).
    bnames = {g.index: g.name for g in body.vertex_groups}
    # A gola de trás deita na base do pescoço (pele do neck_01): ela entra no alvo, mas não nos pesos da regata.
    seat_bones = ALLOWED | ({'neck_01'} if KIND == 'regata' else set())
    own = [sum(g.weight for g in v.groups if bnames[g.group] in seat_bones) for v in body.data.vertices]
    seat_tree = BVHTree.FromPolygons(bv, [f.vertices[:] for f in body.data.polygons if min(own[i] for i in f.vertices) > 0.5])
    # Só alças e decote da regata. Na bermuda, puxar o pano franzido contra a pele amassava as pregas em pontas.
    if KIND == 'regata':
        z0, z1 = bone_head('upperarm_r').z - 0.09 * H, bone_head('upperarm_r').z - 0.04 * H
    else:
        z0, z1 = 1e9, 2e9
    pts = [piece.matrix_world @ v.co for v in piece.data.vertices]
    seat = []
    kd = KDTree(len(pts))
    for i, p in enumerate(pts):
        loc, nrm, _, _ = seat_tree.find_nearest(p)
        seat.append(((p - loc).dot(nrm), nrm) if loc is not None else (None, None))
        kd.insert(p, i)
    kd.balance()
    inv = piece.matrix_world.inverted()
    pulled = 0
    for j, p in enumerate(pts):
        zw = smooth((p.z - z0) / (z1 - z0))
        if zw <= 0 or seat[j][0] is None:
            continue
        inner = min(seat[i][0] for _, i, _ in kd.find_range(p, 0.009 * H) if seat[i][0] is not None)
        gap = inner - margin
        if 0 < gap < (0.03 if KIND == 'regata' else 0.06) * H:
            piece.data.vertices[j].co = inv @ (p - seat[j][1] * gap * zw)
            pulled += 1
    piece.data.update()
    print('assentados no corpo:', pulled)

    tree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    R = 0.025 * H
    over = None
    if OVER:
        # A peça de baixo vem com o rest dela (a bermuda: coxas retas); posa o esqueleto dela no rest do corpo.
        o_objs = import_glb(OVER)
        o_arm = next(o for o in o_objs if o.type == 'ARMATURE')
        o_mesh = next(o for o in o_objs if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers))
        o_arm.animation_data_clear()
        bones = sorted(o_arm.pose.bones, key=lambda b: len(b.parent_recursive))
        for pb in bones:
            if pb.name in arm.data.bones:
                pb.matrix = arm.data.bones[pb.name].matrix_local.copy()
                bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        over_tree = BVHTree.FromObject(o_mesh, dg)
        ov = [o_mesh.evaluated_get(dg).matrix_world @ v.co for v in o_mesh.evaluated_get(dg).data.vertices]
        over = (over_tree, min(p.z for p in ov), max(p.z for p in ov))
        # Pesos da peça de baixo por vértice (pano_* conta como o osso pai: thigh_l/thigh_r).
        o_names = {g.index: g.name for g in o_mesh.vertex_groups}
        def bone_of(n):
            return o_arm.data.bones[n].parent.name if n.startswith('pano_') and n in o_arm.data.bones and o_arm.data.bones[n].parent else n
        over_w = []
        for v in o_mesh.data.vertices:
            w = {}
            for g in v.groups:
                b = bone_of(o_names[g.group])
                w[b] = w.get(b, 0) + g.weight
            over_w.append(w)
        over_kd = KDTree(len(ov))
        for i, p in enumerate(ov):
            over_kd.insert(p, i)
        over_kd.balance()
        for o in o_objs:  # a árvore guarda a própria cópia; a peça de baixo não pode ir no export
            bpy.data.objects.remove(o, do_unlink=True)
        axis = Vector((bone_head('pelvis').x, bone_head('pelvis').y, 0))

    def over_need(p):
        """Quanto falta (e a direção) para o ponto ficar por fora da peça de baixo: raio horizontal a partir do eixo da
        pelve, comparado com a superfície mais externa da peça nessa direção (raio lançado de fora para dentro)."""
        if not over or not (over[1] <= p.z <= over[2] + 0.01 * H):
            return 0.0, None
        d = Vector((p.x, p.y, 0)) - axis
        if d.length < 1e-6:
            return 0.0, None
        d.normalize()
        start = Vector((axis.x, axis.y, p.z)) + d * 0.6
        hit, _, _, dist = over[0].ray_cast(start, -d, 0.6)
        if hit is None:
            return 0.0, None
        r_out = 0.6 - dist
        r_p = (Vector((p.x, p.y, 0)) - axis).length
        return max(0.0, r_out + margin - r_p), d
    inv = piece.matrix_world.inverted()
    # Repete: no côncavo (trapézio junto do pescoço) a direção média não aponta direto para fora e um passe não basta.
    def push_out(passes):
        for it in range(passes):
            pts = [piece.matrix_world @ v.co for v in piece.data.vertices]
            asks = []
            kd = KDTree(len(pts))
            for i, p in enumerate(pts):
                loc, nrm, _, _ = tree.find_nearest(p)
                need = max(0.0, margin - (p - loc).dot(nrm)) if loc is not None else 0.0
                o_need, o_dir = over_need(p)
                if o_need > need:
                    need, nrm = o_need, o_dir
                asks.append((need, nrm))
                if need > 0:
                    kd.insert(p, i)
            kd.balance()
            worst = max(a for a, _ in asks)
            if worst < 0.001 * H:
                break
            moved = 0
            for j, p in enumerate(pts):
                size, dirv = 0.0, Vector()
                for _, i, d in kd.find_range(p, R):
                    # Núcleo plano: até R/2 o peso é 1, então o tecido e o avesso (a milímetros) recebem o mesmo empurrão.
                    # Com queda desde 0, a camada de dentro (que pede mais) andava um pouco mais a cada passe e cruzava.
                    w = 1 - smooth((d - 0.5 * R) / (0.5 * R))
                    size = max(size, asks[i][0] * w)
                    dirv += asks[i][1] * asks[i][0] * w
                if size > 0 and dirv.length > 1e-9:
                    piece.data.vertices[j].co = inv @ (p + dirv.normalized() * size)
                    moved += 1
            piece.data.update()
            print('empurrados para fora da pele (passe %d): %d de %d (maior pedido %.3f m)' % (it + 1, moved, len(pts), worst / H * 1.715))

    push_out(4)
    if KIND == 'regata':
        # Alças: o empurrão no ombro curvo (normais da pele divergindo) deixava a alça do ombro mais alto do esqueleto
        # amassada. Alisa só a faixa das alças e empurra de novo.
        grp = piece.vertex_groups.new(name='alcas')
        zs = bone_head('upperarm_r').z - 0.05 * H
        for v in piece.data.vertices:
            w = smooth(((piece.matrix_world @ v.co).z - zs) / (0.03 * H))
            if w > 0:
                grp.add([v.index], w, 'REPLACE')
        sm = piece.modifiers.new('alcas', 'SMOOTH')
        sm.factor = 0.8
        sm.iterations = 15
        sm.vertex_group = 'alcas'
        set_active(piece)
        bpy.ops.object.modifier_apply(modifier='alcas')
        piece.vertex_groups.remove(piece.vertex_groups['alcas'])
        push_out(2)

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


groups = piece.vertex_groups
OVER_BLEND = None
if KIND == 'regata' and OVER and over:
    # Barra da regata por cima da bermuda: do alto do cós para baixo, os pesos viram os da bermuda (rampa de 4 cm). As
    # duas peças se movem juntas ao agachar e a coxa não leva a bermuda através da regata. Guardado para depois do filtro
    # de ossos (a coxa entra aqui de propósito).
    OVER_BLEND = []
    for v in piece.data.vertices:
        p = piece.matrix_world @ v.co
        k = smooth((over[2] - p.z) / (0.04 * H))
        if k <= 0:
            continue
        near = over_kd.find_n(p, 4)
        acc, tot = {}, 0.0
        for _, i, d in near:
            wgt = 1 / (d + 1e-4)
            tot += wgt
            for b, x in over_w[i].items():
                acc[b] = acc.get(b, 0) + x * wgt
        OVER_BLEND.append((v.index, k, {b: x / tot for b, x in acc.items()}))
if ALLOWED:
    gname = {g.index: g.name for g in groups}
    left_x = bone_head('thigh_l').x
    for v in piece.data.vertices:
        ws = {gname[g.group]: g.weight for g in v.groups}
        keep = {n: w for n, w in ws.items() if n in ALLOWED and w > 0}
        if sum(keep.values()) < 1e-3:
            side = 'l' if ((piece.matrix_world @ v.co).x > 0) == (left_x > 0) else 'r'
            keep = {'spine_03': 1.0} if KIND == 'regata' else {'thigh_' + side: 1.0}
        for n in ws:
            if n not in keep:
                groups[n].remove([v.index])
        tot = sum(keep.values())
        for n, w in keep.items():
            if n not in groups:
                groups.new(name=n)
            groups[n].add([v.index], w / tot, 'REPLACE')
if KIND == 'bermuda':
    # Pesos próprios: acima da barra da regata (pelvis - 6% da altura) só o quadril, como a barra da regata que fica por
    # cima; daí para baixo, rampa longa (20 cm) até a coxa, com esquerda/direita em meio a meio na virilha. Com os pesos
    # copiados da pele (fronteira curta, coxas opostas ao correr) as pernas largas se atravessavam na braguilha e a perna
    # levantada furava a regata.
    z0 = bone_head('pelvis').z - 0.06 * H
    z1 = z0 - 0.12 * H
    cx = bone_head('pelvis').x
    left_sign = 1 if bone_head('thigh_l').x > cx else -1
    for g in list(groups):
        groups.remove(g)
    gp, gl, gr = groups.new(name='pelvis'), groups.new(name='thigh_l'), groups.new(name='thigh_r')
    for v in piece.data.vertices:
        p = piece.matrix_world @ v.co
        tt = smooth((z0 - p.z) / (z0 - z1))
        wl = smooth(left_sign * (p.x - cx) / (0.1 * H) + 0.5)
        gp.add([v.index], max(1e-4, 1 - tt), 'REPLACE')
        gl.add([v.index], max(1e-4, tt * wl), 'REPLACE')
        gr.add([v.index], max(1e-4, tt * (1 - wl)), 'REPLACE')
OVER_K = {}
if OVER_BLEND:
    gname = {g.index: g.name for g in groups}
    for idx, k, wb in OVER_BLEND:
        v = piece.data.vertices[idx]
        wj = {gname[g.group]: g.weight for g in v.groups}
        new = {b: (1 - k) * wj.get(b, 0) + k * wb.get(b, 0) for b in set(wj) | set(wb)}
        for b, x in new.items():
            if b not in groups:
                groups.new(name=b)
                gname = {g.index: g.name for g in groups}
            if x > 1e-4:
                groups[b].add([idx], x, 'REPLACE')
            elif b in wj:
                groups[b].remove([idx])
        OVER_K[idx] = k
    print('barra com os pesos da peça de baixo:', len(OVER_BLEND))
if KIND == 'tenis':
    # Pesos copiados da pele do pé do corpo: cada vértice do tênis pega a média de 4 vértices mais próximos da pele
    # (no bind, com peso pela distância), do mesmo pé. Assim o tênis segue o que a pele segue: o cano gira com a canela
    # (calf_r, a pele acima do tornozelo), o calcanhar e a sola com foot_r, a biqueira com ball_r. Antes era rígido em
    # foot_r/ball_r: ao flexionar o tornozelo a canela saía do cano e a pele aparecia por cima da borda (docs/20).
    from mathutils.kdtree import KDTree
    bnames = {g.index: g.name for g in body.vertex_groups}
    ztop = max((piece.matrix_world @ v.co).z for v in piece.data.vertices) + 0.03
    skin = [i for i, p in enumerate(bv) if (p.x > 0) == (side_x > 0) and p.z <= ztop]
    kd = KDTree(len(skin))
    for i in skin:
        kd.insert(bv[i], i)
    kd.balance()
    bw = {i: {bnames[g.group]: g.weight for g in body.data.vertices[i].groups if g.weight > 0} for i in skin}
    for g in list(groups):
        groups.remove(g)
    for v in piece.data.vertices:
        acc, tot = {}, 0.0
        for _, i, d in kd.find_n(piece.matrix_world @ v.co, 4):
            wgt = 1 / (d + 1e-4)
            tot += wgt
            for b, x in bw[i].items():
                acc[b] = acc.get(b, 0) + x * wgt
        for b, x in acc.items():
            if b not in groups:
                groups.new(name=b)
            groups[b].add([v.index], x / tot, 'REPLACE')
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
            # Sobre a bermuda o pano quase não balança (senão a barra entra no cós).
            k *= 1 - 0.8 * OVER_K.get(i, 0)
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

if KIND in ('regata', 'bermuda'):
    # Pesos suavizados no espaço (média gaussiana num raio de ~2 cm): o tecido e o avesso da peça, a milímetros um do
    # outro, ficavam com pesos um pouco diferentes (cada camada pega o vizinho mais próximo do seu lado) e, com a coxa
    # girando 60-90° ao agachar, a diferença virava centímetros: o avesso atravessava o tecido em lascas.
    from mathutils.kdtree import KDTree
    gname = {g.index: g.name for g in groups}
    pos = [piece.matrix_world @ v.co for v in piece.data.vertices]
    cur = [{gname[g.group]: g.weight for g in v.groups if g.weight > 0} for v in piece.data.vertices]
    kd = KDTree(len(pos))
    for i, p in enumerate(pos):
        kd.insert(p, i)
    kd.balance()
    # Regata: raio largo (~5 cm), a passagem do tronco para a barra (sobre a bermuda) fica espalhada. Bermuda: ~2,5 cm.
    Rw = (0.03 if KIND == 'regata' else 0.015) * H
    for i, p in enumerate(pos):
        acc, tot = {}, 0.0
        for _, j, d in kd.find_range(p, Rw):
            k = math.exp(-(d / (0.5 * Rw)) ** 2)
            tot += k
            for b, x in cur[j].items():
                acc[b] = acc.get(b, 0) + x * k
        for b in cur[i]:
            if b not in acc:
                groups[b].remove([i])
        for b, x in acc.items():
            if x / tot > 1e-4:
                groups[b].add([i], x / tot, 'REPLACE')
            elif b in cur[i]:
                groups[b].remove([i])

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

# ---------------------------------------------------------------- meia
# Meia: envelope fechado e procedural (não copia faces do corpo, que têm furos). Tubo em anéis de 1 cm ao longo do
# eixo da perna (do topo da meia até o tornozelo), curvando no tornozelo e seguindo o pé até a ponta (ankle → ball →
# ponta). Cada setor de cada anel (24 setores) tem o maior raio da pele do corpo ali + 3,5 mm, suavizado entre setores
# e anéis: a pele fica dentro por construção. Ponta fechada, a sola é o fundo do tubo, topo aberto com faixa mais
# grossa (ribana). Pesos por trecho: calf na perna, foot no pé, ball na frente do pé; sem copiar da pele.
def sock_envelope(side, top, mat):
    N = 24
    A = bone_head('foot_' + side)
    K = bone_head('calf_' + side)
    Bh = bone_head('ball_' + side)
    B = Vector((Bh.x, Bh.y, 0.035))
    u = (top - A.z) / (K.z - A.z)
    P = A + (K - A) * u
    up_dir = (P - A).normalized()
    fwd = Vector((B.x - A.x, B.y - A.y, 0)).normalized()
    Q1 = A + up_dir * 0.05
    Q2 = A + fwd * 0.05
    T = B + fwd * 0.035
    dense = []

    def seg(p0, p1):
        n = max(2, int((p1 - p0).length / 0.002))
        for k in range(n):
            dense.append(p0 + (p1 - p0) * (k / n))
    seg(P, Q1)
    m0 = len(dense)
    for k in range(20):
        t = k / 20
        dense.append((1 - t) ** 2 * Q1 + 2 * (1 - t) * t * A + t * t * Q2)
    m1 = len(dense)
    seg(Q2, B)
    iB = len(dense)
    seg(B, T)
    dense.append(T)
    S = [0.0]
    for k in range(1, len(dense)):
        S.append(S[-1] + (dense[k] - dense[k - 1]).length)
    sA = S[(m0 + m1) // 2]
    sB = S[iB]
    # Pele do lado (bind): é ela que a meia tem de cercar.
    bpts = [q for q in bv if (q.x > 0) == (A.x > 0) and q.z <= top + 0.03]
    ring_s = [k * 0.01 for k in range(int(S[-1] / 0.01) + 1)]
    rings = []
    for s_ in ring_s:
        j = min(range(len(S)), key=lambda q: abs(S[q] - s_))
        c = dense[j]
        t = (dense[min(j + 1, len(dense) - 1)] - dense[max(j - 1, 0)]).normalized()
        e1 = t.cross(Vector((0, 0, 1)))
        if e1.length < 1e-3:
            e1 = t.cross(Vector((1, 0, 0)))
        e1.normalize()
        e2 = t.cross(e1)
        rmax = [0.0] * N
        for q in bpts:
            d = q - c
            if abs(d.dot(t)) > 0.006:
                continue
            x_, y_ = d.dot(e1), d.dot(e2)
            kk = int(((math.atan2(y_, x_) + math.pi) / (2 * math.pi)) * N) % N
            rmax[kk] = max(rmax[kk], math.hypot(x_, y_))
        if max(rmax) == 0:
            rmax = [0.03] * N
        for k in range(N):
            if rmax[k] == 0:
                rmax[k] = max(rmax[(k - 1) % N], rmax[(k + 1) % N])
        rs = [max(rmax[k], 0.5 * rmax[k] + 0.25 * (rmax[(k - 1) % N] + rmax[(k + 1) % N])) for k in range(N)]
        rings.append([c, t, e1, e2, rs, s_])
    # Suaviza entre anéis (máximo com a média dos vizinhos): sem degraus, e a pele continua dentro.
    raw = [r[4] for r in rings]
    for i, r in enumerate(rings):
        nb = [raw[max(0, i - 1)], raw[i], raw[min(len(rings) - 1, i + 1)]]
        r[4] = [max(raw[i][k], sum(x[k] for x in nb) / 3) + 0.0035 for k in range(N)]
    # Ribana: 1,5 cm do topo um pouco mais grossa; ponta que fecha em três anéis.
    for i, r in enumerate(rings):
        if r[5] < 0.015:
            r[4] = [x + 0.002 for x in r[4]]
    last = len(rings) - 1
    for i, f in zip(range(last - 2, last + 1), (0.5, 0.2, 0.02)):
        rings[i][4] = [x * f for x in rings[i][4]]
    total = S[-1]

    def weights(s_):
        # calf até 4 cm antes do tornozelo, depois foot; ball nos 2 cm em volta da junta da bola; ponta em ball.
        if s_ < sA - 0.04:
            return {'calf': 1.0}
        if s_ < sA + 0.04:
            fw = smooth((s_ - (sA - 0.04)) / 0.08)
            return {'calf': 1 - fw, 'foot': fw}
        if s_ < sB - 0.02:
            return {'foot': 1.0}
        if s_ < sB + 0.02:
            bw = smooth((s_ - (sB - 0.02)) / 0.04)
            return {'foot': 1 - bw, 'ball': bw}
        return {'ball': 1.0}
    bm = bmesh.new()
    rows, wts = [], []
    for c, t, e1, e2, rs, s_ in rings:
        row = []
        for k in range(N):
            ang = (k + 0.5) / N * 2 * math.pi - math.pi
            q = c + (e1 * math.cos(ang) + e2 * math.sin(ang)) * rs[k]
            q.z = max(q.z, 0.002)
            row.append(bm.verts.new(q))
        rows.append(row)
        wts.append(weights(s_))
    for i in range(len(rows) - 1):
        for k in range(N):
            k2 = (k + 1) % N
            bm.faces.new((rows[i][k], rows[i][k2], rows[i + 1][k2], rows[i + 1][k]))
    tip = bm.verts.new(rings[-1][0] + rings[-1][1] * 0.001)
    for k in range(N):
        k2 = (k + 1) % N
        bm.faces.new((rows[-1][k], rows[-1][k2], tip))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    for f in bm.faces:
        f.smooth = True  # normais suaves: sem isso o exportador separa os vértices por face (a casca abria)
    me = bpy.data.meshes.new('meia_' + side)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new('meia_' + side, me)
    bpy.context.collection.objects.link(ob)
    groups = {n: ob.vertex_groups.new(name=n + '_' + side) for n in ('calf', 'foot', 'ball')}
    for i, w in enumerate(wts):
        for k in range(N):
            for n, x in w.items():
                if x > 1e-4:
                    groups[n].add([i * N + k], x, 'REPLACE')
    for n, x in wts[-1].items():
        groups[n].add([len(rings) * N], x, 'REPLACE')
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    print('meia', side, 'anéis', len(rings), 'vértices', len(me.vertices), 'comprimento %.3f' % total)
    return ob


if KIND == 'tenis':
    top = max((piece.matrix_world @ v.co).z for v in piece.data.vertices) + 0.05
    mat = bpy.data.materials.new('Meia')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.94, 0.94, 0.94, 1)
    bsdf.inputs['Roughness'].default_value = 0.9
    for side in ('r', 'l'):
        sock_envelope(side, top, mat)
    keep_socks = {'meia_r', 'meia_l'}
else:
    keep_socks = set()

# ---------------------------------------------------------------- exporta só a peça
# Texturas do HY vêm em 4K (GLB de 25–45 MB): 1024 px em WebP basta para uma peça vista de longe.
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024 * img.size[1] // img.size[0])
keep = {piece.name} | ({'tenis_l'} | keep_socks if KIND == 'tenis' else set())
print('objetos antes do export:', [(o.name, o.type) for o in bpy.data.objects])
for o in [o for o in bpy.data.objects if o.type == 'MESH' and o.name not in keep]:
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    o.select_set(o.type in ('MESH', 'ARMATURE'))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=False,
                          export_skins=True, export_yup=True, export_image_format='WEBP', export_jpeg_quality=85)
print('VESTIR OK', KIND, OUT, 'tris', sum(len(p.vertices) - 2 for p in piece.data.polygons))
