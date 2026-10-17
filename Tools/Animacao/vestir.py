# Blender: veste uma peça gerada (HY 3D) no hoops_player e exporta um GLB com pele no mesmo esqueleto.
#
#   blender -b -P Tools/Animacao/vestir.py -- <corpo.glb> <peca.glb> <tipo> <saida.glb> [triangulos] [--por-cima-de=<peca.glb>]
#
# --cano=alto|medio|baixo (tênis): altura do colarinho acima do tornozelo, 9,5 / 7 / 4,5 cm (padrão: medio).
#
# --por-cima-de: GLB de uma peça já vestida (a bermuda) que esta (a regata) cobre: a barra da regata vai para fora do
# cós da bermuda, senão as duas se cruzam na cintura.
#
# tipo: regata | bermuda | tenis (o tênis sai em par, cada pé no seu, com a meia: meia_r e meia_l, a casca da pele;
# ver vestir_tenis)
#  - encaixa a caixa da peça na região do corpo (tronco, quadril+coxas ou pé);
#  - transfere os pesos de pele do corpo para a peça (vértice mais próximo, interpolado);
#  - regata/bermuda: cria "ossos de pano" (pêndulos) na barra; o jogo (ClothSprings) os anima com molas;
#  - tenis: encaixado em cada pé, empurrado para fora da meia e com os pesos dela (vestir_tenis);
#  - reduz para [triangulos] (padrão: 9000 regata/bermuda, 5000 por pé) e exporta só a peça + esqueleto.
#
# Bermuda: o bind pose do corpo tem as pernas abertas (~25°); as peças geradas vêm com as pernas retas. A bermuda é
# vestida com as coxas giradas para baixo e essa pose vira o rest do esqueleto exportado. No jogo só importam as
# matrizes de bind de cada malha, então isso não afeta o corpo.
import bpy, bmesh, sys, math, os
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
OVER = next((a.split('=', 1)[1] for a in argv if a.startswith('--por-cima-de=')), None)
# Tênis: altura do cano (alto, medio, baixo): onde fica o colarinho (vestir_tenis).
CANO = next((a.split('=', 1)[1] for a in argv if a.startswith('--cano=')), 'medio')
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

# ---------------------------------------------------------------- tênis e meia (docs/20, "Pé e tênis")
# Os dois pés saem daqui, cada um encaixado no próprio pé do corpo (o esquerdo é a peça espelhada; o esqueleto não é
# simétrico, então copiar o direito espelhado deixava o pé esquerdo fora do lugar).
#
# Meia = casca da própria pele do pé e da canela: a pele soldada nas costuras de UV (fechada), cortada por um plano
# perpendicular à canela 4,5 cm acima da boca do tênis, afastada 2,5 mm pela normal e alisada. Os pesos são os da pele
# vértice a vértice (a casca tem a topologia dela), então a meia dobra exatamente como a pele em qualquer pose e a pele
# nunca a atravessa. Na boca, uma ribana (a faixa de cima um pouco mais grossa) e um lábio que dobra para dentro até
# encostar na pele: não fica fresta para ver o corte da pele por baixo.
#
# Tênis = a peça do HY encaixada no pé e empurrada para fora da meia (campo suave, o forro e o tecido de fora andam
# juntos), com os pesos copiados da meia (interpolados na face mais próxima): o tênis segue a meia, que segue a pele.
# No HY a parede de trás do cano ficava 1–3 cm dentro da canela: é esse empurrão que a leva para fora.
#
# No fim, o script posa o esqueleto com os 38 clipes do jogo e mede a meia contra a pele e o tênis contra a meia.
def vestir_tenis():
    from mathutils.bvhtree import BVHTree
    from mathutils.kdtree import KDTree

    def step(x):
        x = max(0.0, min(1.0, x))
        return x * x * (3 - 2 * x)

    SOCK_OFF = 0.0025  # meia: distância da pele (m)
    SOCK_RIB = 0.0008  # ribana: a faixa de cima, um pouco mais grossa
    SOCK_ABOVE = 0.05  # topo da meia acima do colarinho
    # Colarinho acima da junta do tornozelo, por altura de cano. O HY fazia canos de 10 a 15 cm (cara de bota).
    CANO_CAP = {'alto': 0.095, 'medio': 0.07, 'baixo': 0.045}[CANO]
    SHOE_GAP = 0.0015  # tênis: folga mínima por fora da meia

    # Pé esquerdo: a peça espelhada (mesma UV e mesma textura: as máscaras de cor valem para os dois).
    raw = {'r': piece}
    left = piece.copy()
    left.data = piece.data.copy()
    bpy.context.collection.objects.link(left)
    left.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
    bm = bmesh.new()
    bm.from_mesh(left.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(left.data)
    bm.free()
    raw['l'] = left

    def fit_shoe(obj, s):
        """Bico para a frente do pé e encaixe pelo pé descalço (comprimento +6%, largura +15%, calcanhar 1 cm atrás,
        sola na altura da sola: o jogo prega a sola do corpo no chão)."""
        fb, bb = 'foot_' + s, 'ball_' + s
        side_x = bone_head(fb).x
        foot = [v for v in bv if v.z <= bone_head(fb).z + 0.04 * H and (v.x > 0) == (side_x > 0)]
        fmin, fmax = box(foot)
        forward = bone_head(bb) - bone_head(fb)
        forward.z = 0
        forward.normalize()
        pts = world_verts(obj)
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
        obj.data.transform(want @ rot.inverted())
        obj.data.update()
        side = forward.cross(Vector((0, 0, 1))).normalized()

        def ext(points, axis):
            vals = [p.dot(axis) for p in points]
            return min(vals), max(vals)
        sole = [v for v in foot if v.z <= fmin.z + 0.03 * H]
        f_lo, f_hi = ext(sole, forward)
        w_lo, w_hi = ext(sole, side)
        pts = world_verts(obj)
        p_lo, p_hi = ext(pts, forward)
        q_lo, q_hi = ext(pts, side)
        s_len = ((f_hi - f_lo) * 1.06 + 0.012 * H) / (p_hi - p_lo)
        s_wid = ((w_hi - w_lo) * 1.15 + 0.008 * H) / (q_hi - q_lo)
        s_up = (s_len + s_wid) / 2
        sc = Matrix.Identity(4)
        for i in range(3):
            for j in range(3):
                sc[i][j] = forward[i] * forward[j] * s_len + side[i] * side[j] * s_wid + (1 if i == j == 2 else 0) * s_up
        obj.data.transform(sc)
        obj.data.update()
        pts = world_verts(obj)
        p_lo, p_hi = ext(pts, forward)
        q_lo, q_hi = ext(pts, side)
        pmin, pmax = box(pts)
        shift = forward * ((f_lo - 0.006 * H) - p_lo) + side * ((w_lo + w_hi) / 2 - (q_lo + q_hi) / 2)
        shift.z = fmin.z - pmin.z
        obj.data.transform(Matrix.Translation(shift))
        obj.data.update()
        print('tênis %s: escala comprimento %.3f largura %.3f' % (s, s_len, s_wid))

    def cleanup(obj):
        """Solda as costuras de UV e tira pedaços soltos pequenos (cordão, etiqueta): < 2% dos vértices."""
        bm = bmesh.new()
        bm.from_mesh(obj.data)
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
        bm.to_mesh(obj.data)
        bm.free()

    def decimate(obj, tris_max):
        set_active(obj)
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if tris > tris_max:
            dec = obj.modifiers.new('dec', 'DECIMATE')
            dec.ratio = tris_max / tris
            bpy.ops.object.modifier_apply(modifier='dec')
        bpy.ops.object.shade_smooth()

    # Pele soldada (as costuras de UV do GLB viram uma superfície fechada) e a árvore dela, no bind.
    skin = bmesh.new()
    skin.from_mesh(body.data)
    skin.transform(body.matrix_world)
    bmesh.ops.remove_doubles(skin, verts=skin.verts, dist=1e-5)
    skin.normal_update()
    skin_tree = BVHTree.FromBMesh(skin)
    # As faces do corpo apontam para fora? (confere na canela direita: a normal contra a direção radial)
    A, K = bone_head('foot_r'), bone_head('calf_r')
    ax = (K - A).normalized()
    votes = 0
    for f in skin.faces:
        c = f.calc_center_median()
        h = (c - A).dot(ax)
        if 0.12 < h < 0.3 and (c.x > 0) == (A.x > 0):
            r = (c - A) - ax * h
            votes += 1 if r.dot(f.normal) > 0 else -1
    outward = 1 if votes >= 0 else -1
    print('pele: normais %s (votos %d)' % ('para fora' if outward > 0 else 'para dentro', votes))

    def signed(tree, p, flip=1):
        loc, nrm, _, _ = tree.find_nearest(p)
        if loc is None:
            return None, None, None
        n = nrm * flip
        return (p - loc).dot(n), loc, n

    def build_sock(s, top_h, mat):
        A, K = bone_head('foot_' + s), bone_head('calf_' + s)
        ax = (K - A).normalized()
        sx = A.x > 0
        bm = skin.copy()
        # Pé e canela deste lado: toda face com algum vértice abaixo do topo fica (o plano corta o resto). As faces da
        # canela do corpo do HY são compridas (a malha foi esticada até o esqueleto, trocar_corpo.py): tirar a face que
        # passa do topo abria buracos de vários centímetros na boca da meia.
        def leg_face(f):
            hs = [(v.co - A).dot(ax) for v in f.verts]
            radial = max(((v.co - A) - ax * h).length for v, h in zip(f.verts, hs))
            return all((v.co.x > 0) == sx for v in f.verts) and min(hs) < top_h and radial < 0.2
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if not leg_face(f)], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-7, plane_co=A + ax * top_h, plane_no=ax, clear_outer=True)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        # Só o pedaço grande (o plano não deixa ilhas, mas a garantia é barata).
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
        parts.sort(key=len)
        bmesh.ops.delete(bm, geom=[x for part in parts[:-1] for x in part], context='VERTS')
        if outward < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.normal_update()
        border = {v for e in bm.edges if len(e.link_faces) < 2 for v in e.verts}
        # Afasta da pele e alisa o relevo fino (veias, tendões, dedos): meia é tecido esticado.
        for v in bm.verts:
            v.co = v.co + v.normal * SOCK_OFF
        inner = [v for v in bm.verts if v not in border]
        for _ in range(8):
            bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        # O alisamento encolhe o convexo (tornozelo, calcanhar): volta para fora da pele onde precisar.
        for v in bm.verts:
            h = (v.co - A).dot(ax)
            want = SOCK_OFF + SOCK_RIB * step((h - (top_h - 0.022)) / 0.01)
            d, loc, n = signed(skin_tree, v.co, outward)
            if d is not None and d < want:
                v.co = v.co + n * (want - d)
        bm.normal_update()
        # Lábio da boca: a borda dobra para dentro até 0,6 mm da pele e desce 1,5 mm.
        edges = [e for e in bm.edges if len(e.link_faces) < 2]
        ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
        lip = [x for x in ret['geom'] if isinstance(x, bmesh.types.BMVert)]
        for v in lip:
            d, loc, n = signed(skin_tree, v.co, outward)
            if loc is not None:
                v.co = loc + n * 0.0006 - ax * 0.0015
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        # recalc_face_normals pode virar tudo numa malha aberta: a canela tem de apontar para fora.
        votes = 0
        for f in bm.faces:
            c = f.calc_center_median()
            h = (c - A).dot(ax)
            if 0.03 < h < top_h - 0.02:
                votes += 1 if ((c - A) - ax * h).dot(f.normal) > 0 else -1
        if votes < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bmesh.ops.triangulate(bm, faces=bm.faces)  # o corte do plano deixa quadriláteros e n-ágonos na boca
        for f in bm.faces:
            f.smooth = True
        me = bpy.data.meshes.new('meia_' + s)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        ob = bpy.data.objects.new('meia_' + s, me)
        bpy.context.collection.objects.link(ob)
        print('meia %s: %d vértices, %d faces, topo a %.3f m da junta do tornozelo' % (s, len(me.vertices), len(me.polygons), top_h))
        return ob

    def push_out_of(obj, tree, margin, R=0.012, passes=12):
        """Campo suave: cada vértice pede para sair até `margin` por fora da superfície; o pedido se espalha num raio R
        (núcleo plano até R/2), então o forro e o tecido de fora andam juntos e não se cruzam."""
        mw = obj.matrix_world
        inv = mw.inverted()
        for it in range(passes):
            pts = [mw @ v.co for v in obj.data.vertices]
            asks = []
            kd = KDTree(len(pts))
            for i, p in enumerate(pts):
                d, loc, n = signed(tree, p)
                need = max(0.0, margin - d) if d is not None else 0.0
                asks.append((need, n))
                if need > 0:
                    kd.insert(p, i)
            kd.balance()
            worst = max(a for a, _ in asks)
            if worst < 0.0002:
                break
            moved = 0
            for j, p in enumerate(pts):
                size, dirv = 0.0, Vector()
                for _, i, d in kd.find_range(p, R):
                    w = 1 - step((d - 0.5 * R) / (0.5 * R))
                    size = max(size, asks[i][0] * w)
                    dirv += asks[i][1] * asks[i][0] * w
                if size > 0 and dirv.length > 1e-9:
                    obj.data.vertices[j].co = inv @ (p + dirv.normalized() * size)
                    moved += 1
            obj.data.update()
            print('  %s: passe %d, %d vértices empurrados (maior pedido %.1f mm)' % (obj.name, it + 1, moved, worst * 1000))
        # O que o campo não resolveu (vizinhos pedindo em direções opostas: forro dentro do bico) sai vértice a vértice.
        fixed = 0
        for v in obj.data.vertices:
            p = mw @ v.co
            d, loc, n = signed(tree, p)
            if d is not None and d < margin - 0.0002:
                v.co = inv @ (loc + n * margin)
                fixed += 1
        obj.data.update()
        if fixed:
            print('  %s: %d vértices postos direto para fora' % (obj.name, fixed))

    def finish_weights(obj, src=None):
        """Pesos: copiados de `src` (face mais próxima, interpolados) ou os que o objeto já tem; no máximo 4 por
        vértice, normalizados; e o objeto preso ao esqueleto."""
        set_active(obj)
        obj.parent = arm
        mod = obj.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm
        if src is not None:
            dt = obj.modifiers.new('dt', 'DATA_TRANSFER')
            dt.object = src
            dt.use_vert_data = True
            dt.data_types_verts = {'VGROUP_WEIGHTS'}
            dt.vert_mapping = 'POLYINTERP_NEAREST'
            dt.layers_vgroup_select_src = 'ALL'
            dt.layers_vgroup_select_dst = 'NAME'
            bpy.ops.object.datalayout_transfer(modifier='dt')
            bpy.ops.object.modifier_move_to_index(modifier='dt', index=0)
            bpy.ops.object.modifier_apply(modifier='dt')
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        bpy.ops.object.vertex_group_limit_total(limit=4)
        bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.01)
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        for g in [g for g in obj.vertex_groups if not any(g.index in [x.group for x in v.groups] for v in obj.data.vertices)]:
            obj.vertex_groups.remove(g)


    def orient_new(bm, new_faces):
        """Faces criadas por extrusão: mesma volta (sentido) das vizinhas já orientadas, propagando pela malha."""
        new = set(new_faces)
        fixed = {f for f in bm.faces if f not in new}

        def edge_dir(face, edge):
            for l in face.loops:
                if l.edge == edge:
                    return (l.vert, l.link_loop_next.vert)
        todo = list(new)
        while todo:
            rest = []
            for f in todo:
                ref = next(((e, g) for e in f.edges for g in e.link_faces if g is not f and g in fixed), None)
                if ref is None:
                    rest.append(f)
                    continue
                if edge_dir(f, ref[0]) == edge_dir(ref[1], ref[0]):
                    f.normal_flip()
                fixed.add(f)
            if len(rest) == len(todo):
                break
            todo = rest

    # ---------------------------------------------------------------- cano e colarinho (boca do tênis)
    # O tênis do HY é um sólido fechado: a boca do cano é uma tampa amassada que a perna atravessa, e o cano fica para a
    # frente da perna. O cano é refeito acima da altura em que começa a entrar na perna (rebuild_shaft).
    def leg_frame(s):
        A, K = bone_head('foot_' + s), bone_head('calf_' + s)
        ax = (K - A).normalized()
        fwd = bone_head('ball_' + s) - A
        fwd = (fwd - ax * fwd.dot(ax)).normalized()
        return A, ax, fwd, ax.cross(fwd)

    def polar(s, p):
        A, ax, fwd, side = leg_frame(s)
        d = p - A
        h = d.dot(ax)
        r = d - ax * h
        return h, r.length, math.atan2(r.dot(side), r.dot(fwd))

    def sock_radius(s, tree, h, ang):
        A, ax, fwd, side = leg_frame(s)
        o = A + ax * h
        d = fwd * math.cos(ang) + side * math.sin(ang)
        hit = tree.ray_cast(o, d, 0.3)
        return (hit[0] - o).length if hit[0] is not None else None

    def islands(bm):
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
        return parts

    def ordered_loop(edges):
        """Vértices de uma volta fechada de arestas, em ordem."""
        adj = {}
        for e in edges:
            a, b = e.verts
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
        start = next(iter(adj))
        order, prev, cur = [start], None, start
        while len(order) <= len(adj):
            nxt = [x for x in adj[cur] if x is not prev]
            if not nxt or nxt[0] is start:
                break
            prev, cur = cur, nxt[0]
            order.append(cur)
        return order

    def palette_uvs(shoe, s, h_ref, n=3):
        """As `n` cores mais frequentes do tênis perto de `h_ref`, cada uma com a UV do meio de uma área lisa dela na
        textura (vizinhança de 11×11 texels: a mipmap de longe não mistura a cor do lado). O cano novo é pintado com
        elas; a máscara de zonas (fase 2) vale nesses pontos, então o cano muda de cor junto com as zonas."""
        import numpy as np
        img = None
        for m in shoe.data.materials:
            for nd in (m.node_tree.nodes if m and m.node_tree else []):
                if nd.type == 'TEX_IMAGE' and nd.image and not any(k in nd.image.name.lower() for k in ('normal', 'metal', 'rough')):
                    img = img or nd.image
        uv = shoe.data.uv_layers.active
        if img is None or uv is None:
            return [((0.5, 0.5), (0.5, 0.5, 0.5))]
        w, hh = img.size
        px = np.empty(w * hh * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(hh, w, 4)[..., :3]
        R = max(5, w // 200)
        cand = []
        for poly in shoe.data.polygons:
            for li in poly.loop_indices:
                p = shoe.data.vertices[shoe.data.loops[li].vertex_index].co
                if abs(polar(s, p)[0] - h_ref) < 0.03:
                    u, v = uv.data[li].uv
                    cand.append((min(w - R - 1, max(R, int(u * w))), min(hh - R - 1, max(R, int(v * hh)))))
        if not cand:
            return [((0.5, 0.5), (0.5, 0.5, 0.5))]
        cols = np.array([px[y, x] for x, y in cand])
        q = np.floor(np.clip(cols, 0, 0.999) * 4).astype(int)
        keys, counts = np.unique(q, axis=0, return_counts=True)
        out = []
        for key in keys[np.argsort(-counts)][:n]:
            sel = (q == key).all(1)
            target = cols[sel].mean(0)
            best, best_score = None, 1e9
            for (x, y), ok in zip(cand, sel):
                if not ok:
                    continue
                patch = px[y - R:y + R + 1, x - R:x + R + 1].reshape(-1, 3)
                score = float(np.abs(patch.mean(0) - target).sum() + 6 * patch.std(0).sum())
                if score < best_score:
                    best, best_score = (x, y), score
            out.append((((best[0] + 0.5) / w, (best[1] + 0.5) / hh), tuple(float(c) for c in target)))
        return out

    def rebuild_shaft(shoe, s, sock_tree, h_col):
        """Cano novo. O cano do HY fica deslocado para a frente da perna (a parede de trás atravessa a canela), amassado
        e fechado por uma tampa no topo. Ele sai a partir da altura em que começa a entrar na perna (atrás e nos lados;
        a frente pode encostar: é a língua), e no lugar entra uma superfície em anéis que parte da seção do HY nessa
        altura e sobe numa curva suave até o colarinho, que abraça a meia a 1 cm. Em cima, o rolo do acolchoado e o
        forro que desce por dentro. O pé, o bico e o desenho de baixo continuam os do HY."""
        A, ax, fwd, side = leg_frame(s)
        dirv = lambda a: fwd * math.cos(a) + side * math.sin(a)
        bm = bmesh.new()
        bm.from_mesh(shoe.data)
        bm.normal_update()
        # Folga entre a parede do HY (faces em pé) e a meia, por faixa de 5 mm, atrás e nos lados.
        nb = int(h_col / 0.005) + 1
        clear = [1.0] * nb
        for f in bm.faces:
            if abs(f.normal.dot(ax)) > 0.5:
                continue
            h, r, a = polar(s, f.calc_center_median())
            b = int(h / 0.005)
            if h <= 0 or b >= nb or abs(a) < math.radians(60):
                continue
            rs = sock_radius(s, sock_tree, h, a)
            if rs is not None:
                clear[b] = min(clear[b], r - rs)
        first_bad = next((b for b in range(nb) if clear[b] < 0.004), nb)
        h_low = min(h_col - 0.03, max(0.015, first_bad * 0.005 - 0.01))
        pal = palette_uvs(shoe, s, h_low)
        uv_main = pal[0][0]
        uv_trim = pal[1][0] if len(pal) > 1 else uv_main
        # Corte do HY em h_low; o que fica acima sai.
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=A + ax * h_low, plane_no=ax, clear_outer=True)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        parts = islands(bm)
        big = max(len(p) for p in parts)
        bmesh.ops.delete(bm, geom=[x for p in parts if len(p) < 0.05 * big for x in p], context='VERTS')
        loops = boundary_loops(bm)
        on_plane = lambda comp: sum(1 for e in comp if all(abs(polar(s, v.co)[0] - h_low) < 0.0015 for v in e.verts))
        loops.sort(key=on_plane)
        mouth = loops[-1]
        for comp in loops[:-1]:
            bmesh.ops.holes_fill(bm, edges=list(comp), sides=0)
        ring_hy = ordered_loop(mouth)
        # Seção do HY no corte, reamostrada em 72 ângulos (raio da volta em cada direção; buraco = vizinho).
        N = 72
        pts2 = [(polar(s, v.co)[1] * math.cos(polar(s, v.co)[2]), polar(s, v.co)[1] * math.sin(polar(s, v.co)[2])) for v in ring_hy]
        r0 = []
        for j in range(N):
            t = 2 * math.pi * j / N - math.pi
            dx, dy = math.cos(t), math.sin(t)
            best = None
            for i in range(len(pts2)):
                (x1, y1), (x2, y2) = pts2[i], pts2[(i + 1) % len(pts2)]
                den = dx * (y2 - y1) - dy * (x2 - x1)
                if abs(den) < 1e-12:
                    continue
                k = (x1 * (y2 - y1) - y1 * (x2 - x1)) / den  # distância ao longo do raio
                m = (x1 * dy - y1 * dx) / den  # posição no segmento (0..1)
                if k > 0 and 0 <= m <= 1:
                    best = k if best is None else max(best, k)
            r0.append(best)
        for j in range(N):
            if r0[j] is None:
                r0[j] = next((r0[(j + d) % N] for d in range(1, N) if r0[(j + d) % N] is not None), 0.05)
        thetas = [2 * math.pi * j / N - math.pi for j in range(N)]
        rc = [(sock_radius(s, sock_tree, h_col, t) or r0[j]) + 0.010 for j, t in enumerate(thetas)]
        K = max(4, int((h_col - h_low) / 0.006))
        uvl = bm.loops.layers.uv.active
        new_faces, rings = [], []
        trim_faces = set()  # faixa de trás (reforço do calcanhar) e colarinho: a 2ª cor
        for k in range(K + 1):
            u = k / K
            h = h_low + 0.001 + (h_col - h_low - 0.001) * u
            row = []
            for j, t in enumerate(thetas):
                rs = sock_radius(s, sock_tree, h, t)
                r = r0[j] + (rc[j] - r0[j]) * step(u)
                if rs is not None:
                    r = max(r, rs + 0.005)
                row.append(bm.verts.new(A + ax * h + dirv(t) * r))
            rings.append(row)
        # Rolo do acolchoado e forro, por cima do último anel.
        r_in = [(sock_radius(s, sock_tree, h_col, t) or rc[j] - 0.01) + 0.0015 for j, t in enumerate(thetas)]
        for dh, frac in ((0.003, 0.65), (0.004, 0.25), (0.0015, 0.0)):
            rings.append([bm.verts.new(A + ax * (h_col + dh) + dirv(t) * (r_in[j] + (rc[j] - r_in[j]) * frac)) for j, t in enumerate(thetas)])
        rings.append([bm.verts.new(A + ax * (h_col - 0.02) + dirv(t) * ((sock_radius(s, sock_tree, h_col - 0.02, t) or r_in[j]) + 0.0015)) for t in thetas])
        for k, (a_, b_) in enumerate(zip(rings, rings[1:])):
            for j in range(N):
                j2 = (j + 1) % N
                f = bm.faces.new((a_[j], a_[j2], b_[j2], b_[j]))
                new_faces.append(f)
                ang = 2 * math.pi * (j + 0.5) / N - math.pi
                if k >= K or (k >= 1 and abs(ang) > math.radians(155)):
                    trim_faces.add(f)
        ring0_edges = [bm.edges.get((rings[0][j], rings[0][(j + 1) % N])) for j in range(N)]
        ret = bmesh.ops.bridge_loops(bm, edges=list(mouth) + ring0_edges)
        new_faces += list(ret['faces'])
        for f in new_faces:
            f.smooth = True
            f.material_index = 0
            if uvl is not None:
                for l in f.loops:
                    l[uvl].uv = uv_trim if f in trim_faces else uv_main
        orient_new(bm, new_faces)
        # Emenda: o HY logo abaixo do corte e os dois primeiros anéis se alisam juntos (sem degrau de sombreado na frente).
        seam = [v for v in bm.verts if h_low - 0.012 < polar(s, v.co)[0] < h_low + 0.008 and v not in set(rings[-1] + rings[-2] + rings[-3] + rings[-4])]
        for _ in range(4):
            bmesh.ops.smooth_vert(bm, verts=seam, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bm.to_mesh(shoe.data)
        bm.free()
        shoe.data.update()
        print('  %s: cano novo de %.0f a %.0f mm (HY entrava na perna a partir de %.0f mm), %d anéis, cores %s' % (shoe.name, h_low * 1000, h_col * 1000, first_bad * 5, K + 1, ['#%02x%02x%02x' % tuple(int(255 * min(1, max(0, c)) ** (1 / 2.2)) for c in col) for _, col in pal]))
        return h_col

    def boundary_loops(bm):
        """Bordas abertas agrupadas em voltas (componentes ligadas)."""
        edges = {e for e in bm.edges if len(e.link_faces) == 1}
        loops = []
        while edges:
            e = edges.pop()
            comp, stack = {e}, [e]
            while stack:
                x = stack.pop()
                for v in x.verts:
                    for y in v.link_edges:
                        if y in edges:
                            edges.discard(y)
                            comp.add(y)
                            stack.append(y)
            loops.append(comp)
        return loops

    def copy_normals(dst, src):
        """Normais da pele na meia: a meia é a casca da pele, e com as normais dela o sombreado fica liso (as do próprio
        alisamento, nos triângulos compridos da canela, faziam listras em ponta abaixo da boca)."""
        set_active(dst)
        nt = dst.modifiers.new('nt', 'DATA_TRANSFER')
        nt.object = src
        nt.use_loop_data = True
        nt.data_types_loops = {'CUSTOM_NORMAL'}
        nt.loop_mapping = 'POLYINTERP_NEAREST'
        bpy.ops.object.modifier_move_to_index(modifier='nt', index=0)
        bpy.ops.object.modifier_apply(modifier='nt')

    sock_mat = bpy.data.materials.new('Meia')
    bsdf = sock_mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.93, 0.93, 0.93, 1)
    bsdf.inputs['Roughness'].default_value = 0.92

    out = {}
    for s in ('r', 'l'):
        shoe = raw[s]
        shoe.name = 'tenis_' + s
        fit_shoe(shoe, s)
        cleanup(shoe)
        decimate(shoe, TRIS)
        A, K = bone_head('foot_' + s), bone_head('calf_' + s)
        ax = (K - A).normalized()
        cuff = max((shoe.matrix_world @ v.co - A).dot(ax) for v in shoe.data.vertices)
        if os.environ.get('FATIAS'):
            A_, ax_ = bone_head('foot_' + s), (bone_head('calf_' + s) - bone_head('foot_' + s)).normalized()
            for hh in [x / 100 for x in range(2, int(cuff * 100) + 1)]:
                bm = bmesh.new()
                bm.from_mesh(shoe.data)
                res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=A_ + ax_ * hh, plane_no=ax_)
                cut = {e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)}
                comps = []
                while cut:
                    e = cut.pop(); comp = {e}; st = [e]
                    while st:
                        x = st.pop()
                        for v in x.verts:
                            for y in v.link_edges:
                                if y in cut:
                                    cut.discard(y); comp.add(y); st.append(y)
                    comps.append(comp)
                desc = []
                for comp in sorted(comps, key=len, reverse=True)[:4]:
                    rs = []
                    for e in comp:
                        for v in e.verts:
                            d = v.co - A_
                            rs.append((d - ax_ * d.dot(ax_)).length)
                    desc.append('%d arestas r=%.0f..%.0f mm' % (len(comp), min(rs) * 1000, max(rs) * 1000))
                print('FATIA %s h=%3.0f mm: %d voltas: %s' % (s, hh * 1000, len(comps), '; '.join(desc)))
                bm.free()
            continue
        h_col = min(cuff - 0.02, CANO_CAP)
        sock = build_sock(s, h_col + SOCK_ABOVE, sock_mat)
        sock_tree = BVHTree.FromObject(sock, bpy.context.evaluated_depsgraph_get())
        rebuild_shaft(shoe, s, sock_tree, h_col)
        push_out_of(shoe, sock_tree, SHOE_GAP)
        # Normais da forma nova (as do GLB do HY ficavam erradas onde a parede andou e no cano refeito).
        set_active(shoe)
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
        bpy.ops.object.shade_smooth()
        # Pesos da meia: os da pele logo abaixo de cada vértice já alisado (o alisamento escorrega o vértice alguns mm
        # pela pele; com os pesos do vértice de origem a meia entrava na pele no tornozelo dobrado).
        for g in list(sock.vertex_groups):
            sock.vertex_groups.remove(g)
        finish_weights(sock, body)
        copy_normals(sock, body)
        finish_weights(shoe, sock)
        out[s] = (shoe, sock, h_col)

    # Exporta: os dois tênis e as duas meias, no esqueleto.
    for img in bpy.data.images:
        if img.size[0] > 1024:
            img.scale(1024, 1024 * img.size[1] // img.size[0])
    # Só os tênis, as meias e o esqueleto (o corpo fica na cena para a conferência abaixo).
    keep = {o.name for pair in out.values() for o in pair[:2]}
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects:
        o.select_set(o.name in keep or o.type == 'ARMATURE')
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=False,
                              export_skins=True, export_yup=True, export_image_format='WEBP', export_jpeg_quality=85)
    print('VESTIR OK tenis', OUT, {s: sum(len(p.vertices) - 2 for p in v[0].data.polygons) for s, v in out.items()})

    # ---------------------------------------------------------------- conferência nas poses dos clipes
    # Cada vértice da meia fica preso ao ponto da pele logo abaixo dele (no bind, coordenadas baricêntricas no triângulo
    # da pele) e cada vértice do tênis perto da meia, ao ponto da meia abaixo dele. Em cada pose dos 38 clipes do jogo
    # (o Blender faz a mesma conta de pele do three.js: soma linear das 4 influências), a distância com sinal até esse
    # ponto, pela normal do triângulo posado: negativa = atravessou. Mede a peça contra a superfície que ela veste, sem
    # confundir com outra parte do corpo que passe perto (perna cruzando).
    def tri_mesh(obj):
        me = obj.data
        return [v.co.copy() for v in me.vertices], [tuple(pl.vertices) for pl in me.polygons]

    def anchors(src, pts):
        verts, tris = tri_mesh(src)
        tree = BVHTree.FromPolygons(verts, tris)
        res = []
        for p in pts:
            loc, _, fi, dist = tree.find_nearest(p)
            a, b, c = (verts[k] for k in tris[fi])
            v0, v1, v2 = b - a, c - a, loc - a
            d00, d01, d11, d20, d21 = v0.dot(v0), v0.dot(v1), v1.dot(v1), v2.dot(v0), v2.dot(v1)
            den = d00 * d11 - d01 * d01 or 1e-12
            wb = (d11 * d20 - d01 * d21) / den
            wc = (d00 * d21 - d01 * d20) / den
            res.append((tris[fi], (1 - wb - wc, wb, wc)))
        return res

    def gap(anc, posed_src, flip, p):
        (i0, i1, i2), (w0, w1, w2) = anc
        a, b, c = posed_src[i0], posed_src[i1], posed_src[i2]
        n = (b - a).cross(c - a)
        if n.length < 1e-12:
            return 1.0
        n = n.normalized() * flip
        return (p - (a * w0 + b * w1 + c * w2)).dot(n)

    bind = {s: (bone_head('foot_' + s), bone_head('calf_' + s), bone_head('ball_' + s)) for s in out}

    def where(s, p_bind):
        A, K, Bl = bind[s]
        ax = (K - A).normalized()
        h = (p_bind - A).dot(ax)
        r = (p_bind - A) - ax * h
        fwd = Bl - A
        fwd = (fwd - ax * fwd.dot(ax)).normalized()
        side = ax.cross(fwd)
        ang = math.degrees(math.atan2(r.dot(side), r.dot(fwd)))
        part = 'frente' if abs(ang) < 45 else 'trás' if abs(ang) > 135 else ('lado ' + ('+' if ang > 0 else '-'))
        return 'h=%.0f mm %s' % (h * 1000, part)

    # A pele do corpo tem a mesma orientação da pele soldada (outward); a meia aponta para fora (conferido ao criar).
    probe = {}
    for s, (shoe, sock, _) in out.items():
        sock_pts = [v.co.copy() for v in sock.data.vertices]
        st = BVHTree.FromPolygons(*tri_mesh(sock))
        near = [i for i, v in enumerate(shoe.data.vertices) if (lambda r: r[0] is not None and (v.co - r[0]).dot(r[1]) < 0.012)(st.find_nearest(v.co))]
        probe[s] = (anchors(body, sock_pts), near, anchors(sock, [shoe.data.vertices[i].co.copy() for i in near]))
    rows = {s: {'meia_pele': [], 'meia_pele_vista': [], 'tenis_meia': []} for s in out}
    # A parte da meia que aparece: acima de 1 cm abaixo da boca do tênis (o resto fica dentro do calçado).
    shown = {}
    for s, (shoe, sock, cuff) in out.items():
        A, K, _ = bind[s]
        ax = (K - A).normalized()
        shown[s] = [i for i, v in enumerate(sock.data.vertices) if (v.co - A).dot(ax) > cuff - 0.01]
    if not arm.animation_data:
        arm.animation_data_create()
    scene = bpy.context.scene
    poses = [(None, None)] + [(a, k) for a in bpy.data.actions for k in range(7)]
    for act, k in poses:
        if act is None:
            arm.animation_data.action = None
            tag = 'bind'
        else:
            arm.animation_data.action = act
            if getattr(act, 'slots', None) and hasattr(arm.animation_data, 'action_slot'):
                arm.animation_data.action_slot = act.slots[0]
            f0, f1 = act.frame_range
            scene.frame_set(int(round(f0 + (f1 - f0) * k / 6)))
            tag = '%s@%d' % (act.name, scene.frame_current)
        dg = bpy.context.evaluated_depsgraph_get()
        be = body.evaluated_get(dg)
        bverts = [be.matrix_world @ v.co for v in be.data.vertices]
        for s, (shoe, sock, _) in out.items():
            a_sock, near, a_shoe = probe[s]
            se = sock.evaluated_get(dg)
            sverts = [se.matrix_world @ v.co for v in se.data.vertices]
            d, i = min((gap(a_sock[i], bverts, outward, sverts[i]), i) for i in range(len(sverts)))
            rows[s]['meia_pele'].append((d, tag, where(s, sock.data.vertices[i].co)))
            d, i = min((gap(a_sock[i], bverts, outward, sverts[i]), i) for i in shown[s])
            rows[s]['meia_pele_vista'].append((d, tag, where(s, sock.data.vertices[i].co)))
            he = shoe.evaluated_get(dg)
            if near:
                d, i = min((gap(a_shoe[j], sverts, 1, he.matrix_world @ he.data.vertices[near[j]].co), j) for j in range(len(near)))
                rows[s]['tenis_meia'].append((d, tag, where(s, shoe.data.vertices[near[i]].co)))
    for s, r in rows.items():
        for key in ('meia_pele', 'meia_pele_vista', 'tenis_meia'):
            r[key].sort()
            bad = sum(1 for d, _, _ in r[key] if d < 0)
            print('CONFERE %s %s: %d de %d poses com atravessamento; piores: %s' % (s, key, bad, len(r[key]), '; '.join('%.1f mm %s (%s)' % (d * 1000, t, w) for d, t, w in r[key][:5])))
    sys.exit(0)


if KIND == 'tenis':
    vestir_tenis()



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
if cloth_bones:
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

# ---------------------------------------------------------------- exporta só a peça
# Texturas do HY vêm em 4K (GLB de 25–45 MB): 1024 px em WebP basta para uma peça vista de longe.
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024 * img.size[1] // img.size[0])
keep = {piece.name}
print('objetos antes do export:', [(o.name, o.type) for o in bpy.data.objects])
for o in [o for o in bpy.data.objects if o.type == 'MESH' and o.name not in keep]:
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    o.select_set(o.type in ('MESH', 'ARMATURE'))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=False,
                          export_skins=True, export_yup=True, export_image_format='WEBP', export_jpeg_quality=85)
print('VESTIR OK', KIND, OUT, 'tris', sum(len(p.vertices) - 2 for p in piece.data.polygons))
