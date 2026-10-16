# Blender: otimiza os modelos do lote "arena" do HY 3D (docs/20) para o jogo: escala real em metros, redução de
# polígonos por categoria, textura WebP e um GLB por item em web/public/assets/arena/ (LFS, como os de gear/).
#
#   blender -b -P Tools/Animacao/arena.py -- <models_raw/arena> <web/public/assets/arena> [nome ...]
#
# Sem nomes, processa a lista inteira. Convenção de saída (Blender, Z para cima): frente do objeto para -Y (no glTF,
# +Z), origem no centro da base (no chão), exceto as peças da cesta (ver CESTA abaixo) e as pessoas sentadas (origem no
# ponto de apoio da coxa no assento, abaixo do quadril).
#
# - Props: 3–8k triângulos, cor + normal em 1024 px; os mapas de metal/rugosidade do HY saem (deixam tudo com cara de
#   plástico molhado) e o material fica fosco.
# - Arquibancada e camarote: instanciados às dezenas, ~2k triângulos e só a cor.
# - Pessoas: vêm do *_rig.fbx (rig do HY) e saem numa pose fixa (sentado, de pé com os braços baixos ou ajoelhado),
#   com a pele aplicada e sem esqueleto. Torcida: 1,5k triângulos e cor em 512 px (são milhares no anel);
#   gente da volta da quadra: 4k e 1024 px.
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, *ONLY = argv
os.makedirs(OUT, exist_ok=True)

# fit: ('h', m) altura | ('w', m) largura em X | ('d', m) fundura em Y
PROPS = {
    'mesa_anotacao': dict(fit=('h', 1.15), tris=6000),
    'mesa_transmissao': dict(fit=('h', 1.30), tris=6000),
    'fileira_banco_time': dict(fit=('w', 3.30), tris=6000),
    'fileira_vip': dict(fit=('w', 3.00), tris=6000),
    'camera_tv_tripe': dict(fit=('h', 1.75), tris=5000),
    'camera_fotografo': dict(fit=('h', 1.20), tris=4000),
    'cooler_bebida': dict(fit=('h', 0.95), tris=3000),
    'rack_bolas': dict(fit=('h', 1.00), tris=5000),
    'toalhas_dobradas': dict(fit=('h', 0.22), tris=3000),
    'rodo_quadra': dict(fit=('h', 1.55), tris=3000),
    'tunel_jogadores': dict(fit=('d', 6.00), tris=5000),
    'banner_campeao': dict(fit=('h', 4.20), tris=3000),
    'banner_camisa': dict(fit=('h', 3.40), tris=3000),
    'refletor_teto': dict(fit=('h', 1.10), tris=3000),
    'bloco_arquibancada': dict(fit=('w', 4.80), tris=2500, maps='cor'),
    'camarote_vip': dict(fit=('w', 4.80), tris=2000, maps='cor'),
}

# Cesta oficial: só visual, alinhada no jogo à física do HoopSpec (aro de 45,7 cm a 3,05 m, tabela de 1,83 x 1,07 m).
# Medidas de corte nas unidades do modelo bruto (o HY normaliza o maior lado em ~1,2), tiradas das vistas ortogonais.
CESTA = ['cesta_estrutura', 'cesta_tabela', 'cesta_aro', 'cesta_shot_clock']

# Pessoas: (fonte, pose, altura em pé, triângulos, textura)
CROWD = dict(tris=1500, tex=512)
SIDE = dict(tris=4000, tex=1024)
PEOPLE = {
    'torcedor_bone_sentado': ('torcedor_bone', 'sentado', 1.78, CROWD),
    'torcedor_camisa_sentado': ('torcedor_camisa', 'sentado', 1.80, CROWD),
    'torcedor_casaco_sentado': ('torcedor_casaco', 'sentado', 1.80, CROWD),
    'torcedor_idoso_sentado': ('torcedor_idoso', 'sentado', 1.72, CROWD),
    'torcedora_casual_sentado': ('torcedora_casual', 'sentado', 1.66, CROWD),
    'torcedora_moletom_sentado': ('torcedora_moletom', 'sentado', 1.66, CROWD),
    'torcedora_universitaria_sentado': ('torcedora_universitaria', 'sentado', 1.68, CROWD),
    'crianca_torcedor_sentado': ('crianca_torcedor', 'sentado', 1.35, CROWD),
    'vip_elegante_sentado': ('vip_elegante', 'sentado', 1.70, CROWD),
    'vip_terno_sentado': ('vip_terno', 'sentado', 1.82, CROWD),
    'comentarista_sentado': ('comentarista', 'mesa', 1.80, SIDE),
    'tecnico_terno_em_pe': ('tecnico_terno', 'em_pe', 1.88, SIDE),
    'tecnico_assistente_em_pe': ('tecnico_assistente', 'em_pe', 1.80, SIDE),
    'seguranca_em_pe': ('seguranca', 'em_pe', 1.90, SIDE),
    'ball_boy_em_pe': ('ball_boy', 'em_pe', 1.62, SIDE),
    'fotografo_ajoelhado': ('fotografo', 'ajoelhado', 1.78, SIDE),
}

ALL = list(PROPS) + CESTA + list(PEOPLE)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def set_active(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def import_mesh(path):
    """Importa e devolve uma malha só, com as transformações aplicadas nos vértices."""
    before = set(bpy.data.objects)
    if path.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    return new, meshes


def bake_world(o):
    o.data.transform(o.matrix_world)
    o.parent = None
    o.matrix_world = Matrix.Identity(4)


def verts_world(o):
    return [o.matrix_world @ v.co for v in o.data.vertices]


def bbox(o):
    pts = verts_world(o)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def weld(o):
    # A malha texturizada vem cortada nas costuras de UV: solda antes de reduzir (o UV fica nos cantos das faces e
    # não se perde; sem isso a redução abre rasgos nas costuras).
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(o.data)
    bm.free()


def delete_faces(o, pred):
    """Apaga as faces cujo centro/normal satisfaz pred(centro, normal); some com vértices soltos."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    doomed = [f for f in bm.faces if pred(f.calc_center_median(), f.normal)]
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    return len(doomed)


def decimate(o, tris):
    n = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if n > tris:
        set_active(o)
        dec = o.modifiers.new('dec', 'DECIMATE')
        dec.ratio = tris / n
        bpy.ops.object.modifier_apply(modifier='dec')
    set_active(o)
    bpy.ops.object.shade_smooth()
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def simplify_materials(o, maps, tex):
    """maps: 'cor+normal' ou 'cor'. Tira metal/rugosidade (fosco) e, em 'cor', o mapa de normal; reduz as imagens."""
    for mat in o.data.materials:
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        drop = ['Metallic', 'Roughness'] + (['Normal'] if maps == 'cor' else [])
        for name in drop:
            for link in list(bsdf.inputs[name].links):
                nt.links.remove(link)
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.72
        # Nós órfãos (a imagem de metal/rugosidade) não vão para o GLB, mas a imagem fica no arquivo: sai daqui.
        used = set()
        stack = [bsdf]
        while stack:
            n = stack.pop()
            used.add(n)
            for i in n.inputs:
                for l in i.links:
                    stack.append(l.from_node)
        for n in [n for n in nt.nodes if n not in used and n.type != 'OUTPUT_MATERIAL']:
            nt.nodes.remove(n)
    for img in bpy.data.images:
        if img.users and img.size[0] > tex:
            img.scale(tex, tex * img.size[1] // img.size[0])


def export(o, name):
    for x in [x for x in bpy.data.objects if x is not o]:
        bpy.data.objects.remove(x, do_unlink=True)
    o.name = name
    set_active(o)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=False,
                              export_skins=False, export_yup=True, export_image_format='WEBP',
                              export_jpeg_quality=85)
    lo, hi = bbox(o)
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    print('ARENA OK %-34s tris %5d  tam %.2f x %.2f x %.2f m  %4.0f KB' % (
        name, tris, hi.x - lo.x, hi.y - lo.y, hi.z - lo.z, os.path.getsize(path) / 1024), flush=True)


def to_floor(o, fit):
    """Escala uniforme para a medida real e origem no centro da base."""
    lo, hi = bbox(o)
    axis, meters = fit
    size = {'h': hi.z - lo.z, 'w': hi.x - lo.x, 'd': hi.y - lo.y}[axis]
    s = meters / size
    c = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    o.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-c))


# ---------------------------------------------------------------- props
def do_prop(name):
    spec = PROPS[name]
    reset()
    _, meshes = import_mesh(os.path.join(SRC, name + '.glb'))
    o = meshes[0]
    bake_world(o)
    weld(o)
    to_floor(o, spec['fit'])
    decimate(o, spec['tris'])
    simplify_materials(o, spec.get('maps', 'cor+normal'), 1024)
    export(o, name)


# ---------------------------------------------------------------- cesta
def do_cesta(name):
    reset()
    if name == 'cesta_estrutura':
        # Base, poste e braço da cesta completa (a "base" e o "braço" do lote vieram como a estrutura inteira). Sai a
        # tabela, o aro e a rede (tudo à frente da ponta do braço, y < -0,238) — o jogo põe a tabela e o aro gerados no
        # lugar exato da física. O braço é esticado 0,5 m: na escala do modelo a base ficava encostada na linha de
        # fundo (a NBA pede o acolchoado ~0,6 m atrás dela). Origem: centro da ponta do braço, no chão.
        _, meshes = import_mesh(os.path.join(SRC, 'cesta_completa.glb'))
        o = meshes[0]
        bake_world(o)
        weld(o)
        y_cut = -0.238
        print('estrutura: %d faces da tabela/aro fora' % delete_faces(o, lambda c, n: c.y < y_cut))
        s = 4.72  # a borda de baixo da tabela do modelo (z 0,614) a 2,90 m
        stretch = 0.5 / s
        for v in o.data.vertices:
            t = min(1.0, max(0.0, (v.co.y - y_cut) / (0.0 - y_cut)))
            v.co.y += stretch * t
        o.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(Vector((0, -y_cut, 0))))
        lo, hi = bbox(o)
        o.data.transform(Matrix.Translation(Vector((-(lo.x + hi.x) / 2, 0, -lo.z))))
        decimate(o, 8000)
        simplify_materials(o, 'cor+normal', 1024)
        export(o, name)
    elif name == 'cesta_tabela':
        # Tabela com moldura e acolchoado. O HY desenhou um aro de cada lado da tabela: saem as faces fora da espessura
        # da tabela. O vidro (faces chapadas dentro da moldura) vira o material "Vidro", que o jogo troca por vidro
        # transparente. Escala não uniforme para a caixa da física: 1,83 x 1,07 m, espessura na escala do modelo.
        # Origem: centro da face do vidro (o jogo a põe em backboardFaceCenter).
        _, meshes = import_mesh(os.path.join(SRC, 'cesta_tabela.glb'))
        o = meshes[0]
        bake_world(o)
        weld(o)
        print('tabela: %d faces dos aros fora' % delete_faces(o, lambda c, n: c.y < -0.025 or c.y > 0.078))
        lo, hi = bbox(o)
        glass_y = 0.003  # face do vidro (o acolchoado fica ~2 cm à frente)
        mat = bpy.data.materials.new('Vidro')
        o.data.materials.append(mat)
        gi = len(o.data.materials) - 1
        x0, x1, z0, z1 = -0.43, 0.43, 0.05, 0.615
        n_glass = 0
        for p in o.data.polygons:
            c = p.center
            if abs(p.normal.y) > 0.9 and x0 < c.x < x1 and z0 < c.z < z1:
                p.material_index = gi
                n_glass += 1
        print('tabela: %d faces de vidro' % n_glass)
        sx = 1.83 / (hi.x - lo.x)
        sz = 1.07 / (hi.z - lo.z)
        cx, cz = (lo.x + hi.x) / 2, (lo.z + hi.z) / 2
        o.data.transform(Matrix.Diagonal((sx, 1.0, sz, 1.0)) @ Matrix.Translation(Vector((-cx, -glass_y, -cz))))
        decimate(o, 4000)
        simplify_materials(o, 'cor+normal', 1024)
        export(o, name)
    elif name == 'cesta_aro':
        # Só o aro e a placa que o prende: sai a moldura/braço (x > -0,016) e a rede (abaixo de z 0,392; o jogo tem a
        # rede com física). Gira para o aro ficar à frente (-Y), escala para o diâmetro externo da física e põe a
        # origem no centro do aro, no plano do tubo (o jogo a põe em rimCenter()).
        _, meshes = import_mesh(os.path.join(SRC, 'cesta_aro.glb'))
        o = meshes[0]
        bake_world(o)
        weld(o)
        print('aro: %d faces fora' % delete_faces(o, lambda c, n: c.x > -0.016 or c.z < 0.392))
        o.data.transform(Matrix.Rotation(math.radians(90), 4, 'Z'))
        lo, hi = bbox(o)
        outer = hi.x - lo.x
        tube_r, inner_r, to_board = 0.008, 0.2286, 0.151
        s = (2 * (inner_r + 2 * tube_r)) / outer
        cx = (lo.x + hi.x) / 2
        cy = lo.y + outer / 2
        o.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-cx, -cy, -hi.z))))
        o.data.transform(Matrix.Translation(Vector((0, 0, tube_r))))
        lo, hi = bbox(o)
        face = inner_r + to_board
        print('aro: placa vai até y=%.3f (face da tabela em %.3f), tubo %.3f m' % (hi.y, face, (hi.z - lo.z)))
        # A placa do modelo é curta para os 15,1 cm da física entre o aro e a tabela: estica só ela (atrás do aro).
        ring_back = inner_r + 2 * tube_r
        k = (face - 0.002 - ring_back) / max(hi.y - ring_back, 1e-6)
        for v in o.data.vertices:
            if v.co.y > ring_back:
                v.co.y = ring_back + (v.co.y - ring_back) * k
        decimate(o, 3000)
        simplify_materials(o, 'cor+normal', 1024)
        export(o, name)
    elif name == 'cesta_shot_clock':
        # Relógio de 24 s que fica em cima da tabela: 0,95 m de largura. Origem no centro da base.
        _, meshes = import_mesh(os.path.join(SRC, 'cesta_shot_clock.glb'))
        o = meshes[0]
        bake_world(o)
        weld(o)
        to_floor(o, ('w', 0.95))
        decimate(o, 4000)
        simplify_materials(o, 'cor+normal', 1024)
        export(o, name)


# ---------------------------------------------------------------- pessoas
def body_axes(arm):
    # Cima = Z da armadura (o FBX do HY vem em pé, sem rotação; o pescoço fica ~8° atrás do quadril e não serve).
    b = arm.data.bones
    up = Vector((0, 0, 1))
    left = (b['LeftUpLeg'].head_local - b['RightUpLeg'].head_local)
    left = (left - up * left.dot(up)).normalized()
    fwd = up.cross(left).normalized()  # direita × cima = frente (o pé aponta para cá)
    toe = b['LeftToeBase_end'].head_local - b['LeftFoot'].head_local
    if toe.dot(fwd) < 0:
        fwd = -fwd
    return up, left, fwd


NEXT = {'UpLeg': 'Leg', 'Leg': 'Foot', 'Foot': 'ToeBase', 'Arm': 'ForeArm', 'ForeArm': 'Hand'}


def aim(arm, bone, direction):
    """Gira o osso (em torno da cabeça, no espaço da armadura) para apontar na direção dada; os filhos acompanham.
    A direção atual vai da cabeça do osso à do filho (a cauda do FBX importado não aponta para a junta seguinte)."""
    pb = arm.pose.bones[bone]
    M = pb.matrix.copy()
    head = M.to_translation()
    side = 'Left' if bone.startswith('Left') else 'Right'
    child = arm.pose.bones[side + NEXT[bone[len(side):]]]
    cur = (child.head - pb.head).normalized()
    q = cur.rotation_difference(direction.normalized())
    pb.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ M
    bpy.context.view_layer.update()


def pose(arm, kind):
    U, L, F = body_axes(arm)
    for side, s in (('Left', 1), ('Right', -1)):
        if kind in ('sentado', 'mesa'):
            aim(arm, side + 'UpLeg', F * 0.97 - U * 0.12 + L * s * 0.14)
            aim(arm, side + 'Leg', -U * 0.98 + F * 0.08 + L * s * 0.03)
            if kind == 'mesa':
                # Braços sobre a mesa: antebraço para a frente, na altura do cotovelo.
                aim(arm, side + 'Arm', -U * 0.85 + F * 0.45 + L * s * 0.2)
                aim(arm, side + 'ForeArm', F * 0.95 - U * 0.05 - L * s * 0.25)
            else:
                # Mãos no colo.
                aim(arm, side + 'Arm', -U * 0.9 + F * 0.35 + L * s * 0.22)
                aim(arm, side + 'ForeArm', F * 0.85 - U * 0.4 - L * s * 0.3)
        elif kind == 'em_pe':
            aim(arm, side + 'Arm', -U * 0.97 + L * s * 0.2 + F * 0.03)
            aim(arm, side + 'ForeArm', -U * 0.92 + F * 0.3 + L * s * 0.05)
        elif kind == 'ajoelhado':
            # De joelhos no chão, sentado nos calcanhares não: tronco ereto, canelas para trás no chão.
            aim(arm, side + 'UpLeg', -U + F * 0.05 + L * s * 0.1)
            aim(arm, side + 'Leg', -F * 0.98 - U * 0.15)
            aim(arm, side + 'Foot', -F - U * 0.25)
            # Câmera na altura do peito.
            aim(arm, side + 'Arm', -U * 0.8 + F * 0.5 + L * s * 0.25)
            aim(arm, side + 'ForeArm', F * 0.75 + U * 0.55 - L * s * 0.4)


def do_person(name):
    src, kind, height, q = PEOPLE[name]
    reset()
    new, meshes = import_mesh(os.path.join(SRC, src + '_rig.fbx'))
    arm = next(x for x in new if x.type == 'ARMATURE')
    o = meshes[0]
    for x in meshes[1:]:
        bpy.data.objects.remove(x, do_unlink=True)
    bpy.context.view_layer.update()
    lo, hi = bbox(o)
    rest_h = hi.z - lo.z
    hips = arm.matrix_world @ arm.data.bones['Hips'].head_local
    pose(arm, kind)
    U, L, F = body_axes(arm)
    set_active(o)
    mod = next(m for m in o.modifiers if m.type == 'ARMATURE')
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bake_world(o)
    o.vertex_groups.clear()
    bpy.data.objects.remove(arm, do_unlink=True)
    weld(o)
    s = height / rest_h
    pts = [v.co for v in o.data.vertices]
    if kind in ('sentado', 'mesa'):
        # Apoio no assento: o ponto mais baixo da coxa (entre o quadril e o joelho), abaixo do quadril.
        Fw = F.normalized()  # a armadura não tem rotação: os eixos dela são os do mundo
        thigh = [p for p in pts if 0.0 < (p - hips).dot(Fw) < 0.28 and abs((p - hips).dot(L)) < 0.22
                 and p.z < hips.z]
        base = Vector((hips.x, hips.y, min(p.z for p in thigh)))
    else:
        base = Vector((hips.x, hips.y, min(p.z for p in pts)))
    o.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-base))
    decimate(o, q['tris'])
    simplify_materials(o, 'cor', q['tex'])
    export(o, name)


for name in (ONLY or ALL):
    if name in PROPS:
        do_prop(name)
    elif name in CESTA:
        do_cesta(name)
    elif name in PEOPLE:
        do_person(name)
    else:
        print('ARENA ?? nome desconhecido:', name)
print('ARENA FIM')
