# Blender: costura a regata ou a bermuda do jogador a partir do próprio corpo (docs/20, "Roupa costurada").
#
#   blender -b -P Tools/Animacao/costurar.py -- <corpo.glb> <regata|bermuda> <saida.glb> --cores=#principal,#debrum
#           [--por-cima-de=<bermuda.glb>] [--zonas=<pasta das máscaras>]
#
# A peça do HY (vestir.py) vinha com bordas rasgadas, furos e uma textura pintada a pincel que manchava ao trocar de cor;
# a casca da pele do corpo (a primeira versão daqui) copiava o que o HY esculpiu no corpo (um short de compressão com cós
# franzido e dobras, o rego do glúteo, o trapézio com vinco) e a malha dele. Aqui cada peça é uma grade nova:
#  - regata: 128 colunas em volta do tronco; da barra até a axila, anéis horizontais; daí até dentro do pescoço, cones
#    em volta de um ponto no meio do peito. Cada vértice no raio que acha a pele do tronco, por cima dos vales
#    (fechamento) e alisado, caindo reto do peito e das escápulas, com folga (1,2 cm no peito, 2,8 cm na barra, 7 mm nas
#    alças) e longe da pele como uma tenda (mamilo, osso do quadril);
#  - bermuda: uma calça de verdade, em três grades costuradas: a pélvis (anéis, do cós até 3 cm acima do gancho), a
#    costura do gancho (um leque de raios, da frente por baixo do gancho até as costas) e as pernas (cada uma sai da sua
#    metade do último anel mais a costura; por fora cai da pélvis, por dentro fecha até a coxa);
#  - as aberturas são cortes exatos por superfícies suaves: barra num plano, gola num elipsoide (mais funda na frente),
#    cavas num cilindro elíptico em volta de cada ombro (alças de ~5 cm); vértice rente ao corte vai para cima dele (sem
#    lascas); em cada abertura, um debrum enrolado (1,3 cm além do corte, voltando por dentro);
#  - pesos copiados da pele (face mais próxima), filtrados pelos ossos que a peça segue, alisados; na bermuda, a coxa
#    entra pela posição ao longo do fêmur; ossos de pano na barra (o jogo os anima como molas); a barra da regata segue
#    a bermuda onde a cobre;
#  - textura nova: UV por ilhas, sombra das dobras (AO do Cycles) e a cor lisa de cada zona (tecido e debrum), e a
#    máscara de zonas exata (fase 2 da aparência) gravada em --zonas.
import bpy, bmesh, sys, math, os, json
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index('--') + 1:]
opt = {a.split('=', 1)[0][2:]: a.split('=', 1)[1] for a in argv if a.startswith('--') and '=' in a}
argv = [a for a in argv if not a.startswith('--')]
BODY, KIND, OUT = argv[:3]
OVER = opt.get('por-cima-de')
COLORS = opt.get('cores', '#c8202c,#f2f2f2').split(',')
ZONES_DIR = opt.get('zonas')
PIECE = os.path.splitext(os.path.basename(OUT))[0]

bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, bone_heuristic='BLENDER')
    return [o for o in bpy.data.objects if o not in before]


body_objs = import_glb(BODY)
arm = next(o for o in body_objs if o.type == 'ARMATURE')
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


def step(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


H = max((body.matrix_world @ v.co).z for v in body.data.vertices) - min((body.matrix_world @ v.co).z for v in body.data.vertices)
bnames = {g.index: g.name for g in body.vertex_groups}

# ---------------------------------------------------------------- pele soldada
skin = bmesh.new()
skin.from_mesh(body.data)
skin.transform(body.matrix_world)
bmesh.ops.remove_doubles(skin, verts=skin.verts, dist=1e-5)
skin.normal_update()
skin_tree = BVHTree.FromBMesh(skin)
deform = skin.verts.layers.deform.active


def dominant(v):
    if deform is None or not v[deform]:
        return ''
    gi, _ = max(v[deform].items(), key=lambda kv: kv[1])
    return bnames.get(gi, '')


# Osso dominante de cada vértice da pele soldada, pelo índice (a cópia da pele, skin.copy(), guarda os índices).
skin.verts.index_update()
DOM = [dominant(v) for v in skin.verts]


def signed(tree, p):
    loc, nrm, _, _ = tree.find_nearest(p)
    if loc is None:
        return None, None, None
    return (p - loc).dot(nrm), loc, nrm


SIDE_DIRS = [Vector(d).normalized() for d in ((0.31, 0.17, 0.935), (-0.42, 0.28, -0.86), (0.12, -0.97, 0.21))]


def skin_clear(p):
    """Distância com sinal até a pele (positiva fora) e a direção para fora a partir do ponto mais perto. O lado sai
    da contagem de cruzamentos de raios (a pele soldada é fechada; três raios, a maioria decide): a normal da face mais
    perto engana onde o HY tem faces viradas (a borda de cueca esculpida na frente da pélvis: um ponto 3 cm à frente
    da pele saía 2,6 cm "dentro", e o empurrão o jogava para dentro do corpo) e nos cantos côncavos (axila)."""
    loc, nrm, _, d = skin_tree.find_nearest(p)
    if loc is None:
        return None, None
    odd = 0
    for sd in SIDE_DIRS:
        n, q = 0, p
        while n < 64:
            h = skin_tree.ray_cast(q, sd)
            if h[0] is None:
                break
            n += 1
            q = h[0] + sd * 1e-5
        odd += n % 2
    out = -1 if odd >= 2 else 1
    away = (p - loc) * out
    return out * d, (away.normalized() if away.length > 1e-7 else nrm)


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


def keep_largest(bm):
    parts = islands(bm)
    parts.sort(key=len)
    bmesh.ops.delete(bm, geom=[x for p in parts[:-1] for x in p], context='VERTS')


CUTS = []


def cut_by(bm, f, name):
    """Corte exato pela superfície f(p) = 0: as arestas que cruzam são divididas no zero (interpolado), as faces
    divididas ao longo dele, e sai o lado f < 0. A borda nova segue a superfície: lisa, sem dentes."""
    CUTS.append((name, f))
    # Vértice a menos de 1/4 da aresta vizinha da superfície vai para cima dela (sem isso o corte passava rente ao
    # vértice e deixava lascas: triângulos finíssimos que dobravam o debrum em dentes).
    h = 1e-4
    ex, ey, ez = Vector((h, 0, 0)), Vector((0, h, 0)), Vector((0, 0, h))
    grad = lambda p: Vector(((f(p + ex) - f(p - ex)) / (2 * h), (f(p + ey) - f(p - ey)) / (2 * h), (f(p + ez) - f(p - ez)) / (2 * h)))
    on = set()
    for v in bm.verts:
        g = grad(v.co)
        if g.length < 1e-9 or not v.link_edges:
            continue
        if abs(f(v.co) / g.length) < 0.25 * min(e.calc_length() for e in v.link_edges):
            for _ in range(4):
                g = grad(v.co)
                v.co = v.co - g * (f(v.co) / g.length_squared)
            on.add(v)
    val = {v: (0.0 if v in on else f(v.co)) for v in bm.verts}
    cross = [e for e in bm.edges if (val[e.verts[0]] < 0) != (val[e.verts[1]] < 0)]
    made = set()
    for e in cross:
        a, b = e.verts
        fa, fb = val[a], val[b]
        t = fa / (fa - fb)
        if t < 1e-4 or t > 1 - 1e-4:
            continue
        _, nv = bmesh.utils.edge_split(e, a, t)
        val[nv] = 0.0
        made.add(nv)
    for face in list(bm.faces):
        vs = [v for v in face.verts if v in made or abs(val[v]) < 1e-12]
        if len(vs) == 2 and not any(e for e in vs[0].link_edges if e.other_vert(vs[0]) is vs[1]):
            bmesh.ops.connect_verts(bm, verts=vs)
    dead = [face for face in bm.faces if all(val[v] <= 1e-9 for v in face.verts) and any(val[v] < -1e-9 for v in face.verts)]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    print('  corte %s: %d faces fora' % (name, len(dead)))


def boundary_loops(bm):
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


def ordered_loop(edges):
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


# ---------------------------------------------------------------- formas de cada peça
pel, sp2, sp3, nk1 = bone_head('pelvis'), bone_head('spine_02'), bone_head('spine_03'), bone_head('neck_01')
Z_HEM = pel.z - 0.06 * H  # barra da regata (a mesma do vestir.py: a bermuda some por baixo dela)
Z_CHEST = bone_head('upperarm_r').z - 0.07 * H / 1.715  # axila: daqui para baixo a regata pende (cortina do peito)
SH_X = 0.20 * H / 1.715  # centro das cavas (um pouco por fora da junta do ombro; a malha do corpo é simétrica)
# Cava: cilindro elíptico de eixo frente-trás em volta de cada ombro (a curva em U vista de frente).
ARM_ZC = bone_head('upperarm_r').z + 0.013 * H / 1.715
ARM_R, ARM_K = 0.065 * H / 1.715, 2.4
# Gola: elipsoide em volta da base do pescoço, deslocado para a frente (decote mais fundo na frente que atrás); nos
# lados a borda fica na base do pescoço (mais estreita, a alça subia pelo pescoço e fazia bico).
NECK_C = Vector((0.003, -0.03 * H / 1.715, nk1.z + 0.163 * H / 1.715))
NECK_A, NECK_B, NECK_Z = 0.085 * H / 1.715, 0.16 * H / 1.715, 0.17 * H / 1.715


def armhole_f(p, sx, s=1.0):
    return ((p.x - sx * SH_X) / (ARM_R * s)) ** 2 + ((p.z - ARM_ZC) / (ARM_K * ARM_R * s)) ** 2 - 1


def neck_f(p, s=1.0):
    return ((p.x - NECK_C.x) / (NECK_A * s)) ** 2 + ((p.y - NECK_C.y) / (NECK_B * s)) ** 2 + ((p.z - NECK_C.z) / (NECK_Z * s)) ** 2 - 1


def torso_center(z):
    return Vector((0.003, 0.0, z))


def hang_grid(prof, na, nb, downward, decay, reach=3):
    """Perfil de caimento numa grade (ângulo × altura): em cada direção, o raio não diminui no sentido em que o pano
    cai (máximo acumulado, com um leve afunilamento `decay` por faixa), depois o máximo numa janela larga (±`reach`
    faixas: ±15° e ±3 cm; o pano passa por cima do ponto mais saliente da vizinhança, e mamilo, gomo do abdome ou
    relevo da coxa não marcam) e uma média leve. Sem degraus: a consulta é interpolada (sample_grid)."""
    import numpy as np
    P = np.zeros((na, nb))
    for (a, b), r in prof.items():
        if 0 <= b < nb:
            P[a % na, b] = max(P[a % na, b], r)
    G = np.zeros_like(P)
    run = np.zeros(na)
    for b in (range(nb - 1, -1, -1) if downward else range(nb)):
        run = np.maximum(run * decay, P[:, b])
        G[:, b] = run
    for _ in range(reach):
        D = G.copy()
        for da in (-1, 1):
            D = np.maximum(D, np.roll(G, da, axis=0))
        D[:, 1:] = np.maximum(D[:, 1:], G[:, :-1])
        D[:, :-1] = np.maximum(D[:, :-1], G[:, 1:])
        G = D
    for _ in range(3):
        A = G.copy()
        for da in (-1, 1):
            A += np.roll(G, da, axis=0)
        G = A / 3
        B = G.copy()
        B[:, 1:-1] = (G[:, :-2] + G[:, 1:-1] + G[:, 2:]) / 3
        G = B
    return G


def sample_grid(G, ang_deg, bpos):
    """Valor da grade no ângulo (graus, −180..180) e na posição de faixa contínua (interpolação bilinear)."""
    na, nb = G.shape
    fa = (ang_deg + 180) / 5 - 0.5
    a0 = math.floor(fa)
    ta = fa - a0
    fb = min(nb - 1, max(0.0, bpos - 0.5))
    b0 = int(math.floor(fb))
    tb = fb - b0
    b1 = min(nb - 1, b0 + 1)
    a0 %= na
    a1 = (a0 + 1) % na
    return float((G[a0, b0] * (1 - ta) + G[a1, b0] * ta) * (1 - tb) + (G[a0, b1] * (1 - ta) + G[a1, b1] * ta) * tb)


def grid_shift(A, dj, di):
    """Grade (coluna em volta do tronco × linha) deslocada: as colunas dão a volta, as linhas param na borda."""
    import numpy as np
    B = np.roll(A, dj, axis=0)
    if di > 0:
        B = np.concatenate([B[:, :1].repeat(di, axis=1), B[:, :-di]], axis=1)
    elif di < 0:
        B = np.concatenate([B[:, -di:], B[:, -1:].repeat(-di, axis=1)], axis=1)
    return B


def grid_fill(F, known):
    """Onde o raio não achou pele que fica: média dos vizinhos, de fora para dentro do buraco."""
    F, known = F.copy(), known.copy()
    N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
    while not known.all():
        S = sum(grid_shift(F * known, dj, di) for dj, di in N4)
        Nn = sum(grid_shift(known.astype(float), dj, di) for dj, di in N4)
        new = ~known & (Nn > 0)
        if not new.any():
            break
        F[new] = S[new] / Nn[new]
        known |= new
    return F


def grid_filt(A, op, rj, ri):
    B = A.copy()
    for dj in range(-rj, rj + 1):
        for di in range(-ri, ri + 1):
            B = op(B, grid_shift(A, dj, di))
    return B


def grid_close(F, rj, ri):
    """Fechamento (máximo e depois mínimo numa janela de ±rj colunas e ±ri linhas): os vales somem (o pano passa por
    cima do sulco do esterno, da coluna, do glúteo), o que é convexo fica."""
    import numpy as np
    return grid_filt(grid_filt(F, np.maximum, rj, ri), np.minimum, rj, ri)


def grid_blur(A, nt, nz):
    """Média leve: `nt` passadas em volta do tronco e `nz` na altura."""
    for _ in range(nt):
        A = (2 * A + grid_shift(A, 1, 0) + grid_shift(A, -1, 0)) / 4
    for _ in range(nz):
        A = (2 * A + grid_shift(A, 0, 1) + grid_shift(A, 0, -1)) / 4
    return A


def grid_tent(F, pos, counts, clear, label, row_w=None):
    """Folga mínima `clear` da pele como uma tenda: o que falta num ponto (mamilo, osso do quadril, a borda de cueca
    esculpida no corpo do HY) levanta o pano em volta com inclinação de 15% (um empurrão vértice a vértice desenhava o
    mamilo no tecido). `pos(F)` dá os pontos da grade; `counts(q)`, se o ponto fica na peça (o que vai ser cortado não
    pede folga); `row_w`, quanto cada linha pode andar."""
    import numpy as np
    n_cols, n_rows = F.shape
    for it in range(3):
        P = pos(F)
        need = np.zeros_like(F)
        for j in range(n_cols):
            for i in range(n_rows):
                q = Vector(P[j, i])
                if not counts(q):
                    continue
                d, _ = skin_clear(q)
                if d is not None and d < clear:
                    need[j, i] = clear - d
        print('  tenda da %s %d: falta até %.1f mm em %d pontos' % (label, it, need.max() * 1000, int((need > 0).sum())))
        if need.max() < 0.0005:
            break
        lift = need.copy()
        for dj in range(-8, 9):
            for di in range(-7, 8):
                if dj or di:
                    Ps = np.stack([grid_shift(P[..., k], dj, di) for k in range(3)], axis=-1)
                    lift = np.maximum(lift, grid_shift(need, dj, di) - 0.15 * np.linalg.norm(P - Ps, axis=-1))
        lift = grid_blur(lift, 2, 2)
        F = F + (lift if row_w is None else lift * np.asarray(row_w)[None, :])
    return F


def build_regata():
    """Uma grade só, sem a casca da pele (a casca herdava o relevo e a malha do HY no ombro: vinco no trapézio, calombo
    no acrômio, abas na emenda com a cortina). 128 colunas em volta do tronco; da barra até a axila, anéis horizontais;
    da axila para cima, cada linha é um cone em volta de um ponto C no meio do peito, até dentro do pescoço. Em cada
    vértice, um raio (horizontal embaixo, saindo de C em cima) acha a pele do tronco (sem braço nem cabeça); onde o
    tecido vai ser cortado (cavas, gola) ou não há pele, o valor vem dos vizinhos. Depois:
     - fechamento (máximo e depois mínimo numa janela de ±4 colunas e ±3 linhas) e uma média leve: o pano passa por
       cima do sulco do esterno, da coluna e da clavícula, e o que é convexo fica;
     - caimento: de cima para baixo, o pano não entra mais que 5 mm a cada 10 cm abaixo do ponto mais saliente acima
       dele (cai reto do peito e das escápulas, não segue a cintura nem a lombar);
     - folga: 7 mm nas alças, 1,2 cm no peito, 2,8 cm na barra.
    Todas as bordas saem dos cortes (barra, gola, cavas)."""
    import numpy as np
    n_cols = 128
    angs = [2 * math.pi * j / n_cols - math.pi for j in range(n_cols)]
    BONES = ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'neck_02', 'clavicle_l', 'clavicle_r', 'hip_l', 'hip_r', 'thigh_l', 'thigh_r')
    tb = skin.copy()
    bmesh.ops.delete(tb, geom=[f for f in tb.faces if not all(DOM[v.index] in BONES for v in f.verts)], context='FACES')
    tree = BVHTree.FromBMesh(tb)
    tb.free()
    z_c = Z_CHEST - 0.02
    C = torso_center(z_c)
    nz = int(round((z_c - (Z_HEM - 0.02)) / 0.008))
    zs = [Z_HEM - 0.02 + (z_c - (Z_HEM - 0.02)) * i / nz for i in range(nz + 1)]
    dphi = math.radians(1.5)
    n_up = int(round(math.radians(78) / dphi))
    phis = [i * dphi for i in range(1, n_up + 1)]
    n_rows = len(zs) + len(phis)
    # Origem e direção do raio de cada vértice: anéis (linhas 0..nz) e cones (linhas nz+1..).
    orig, dirs = [], []
    for z in zs:
        orig.append(torso_center(z))
        dirs.append([Vector((math.cos(a), math.sin(a), 0)) for a in angs])
    for ph in phis:
        orig.append(C)
        dirs.append([Vector((math.cos(a) * math.cos(ph), math.sin(a) * math.cos(ph), math.sin(ph))) for a in angs])
    cut_away = lambda p: armhole_f(p, 1 if p.x > 0 else -1, 0.97) < 0 or neck_f(p, 0.97) < 0
    F = np.zeros((n_cols, n_rows))
    known = np.zeros((n_cols, n_rows), dtype=bool)
    for i in range(n_rows):
        for j in range(n_cols):
            hit = tree.ray_cast(orig[i], dirs[i][j], 0.32)
            if hit[0] is not None and not cut_away(hit[0]):
                F[j, i] = (hit[0] - orig[i]).length
                known[j, i] = True
    print('  raios: %d de %d sem pele que fica (cavas, gola, saída do braço)' % (int((~known).sum()), F.size))
    F = grid_blur(grid_close(grid_fill(F, known), 4, 3), 6, 3)
    # Caimento, coluna a coluna, de cima para baixo (no raio horizontal: o raio do anel; nos cones: a distância
    # horizontal do ponto ao eixo, e o ponto anda no próprio raio).
    cosv = [1.0] * len(zs) + [math.cos(ph) for ph in phis]
    sinv = [0.0] * len(zs) + [math.sin(ph) for ph in phis]
    TAPER = 0.05
    for j in range(n_cols):
        m, zm = -1.0, None
        for i in range(n_rows - 1, -1, -1):
            z = zs[i] if i < len(zs) else z_c + F[j, i] * sinv[i]
            rho = F[j, i] * cosv[i]
            want = m - TAPER * (zm - z) if zm is not None else -1.0
            if want > rho:
                rho = want
                F[j, i] = rho / cosv[i]
            if rho >= want:
                m, zm = rho, z
    # A cortina cai de cada coluna; em volta do tronco ela é uma peça só: média em volta e na altura (sem as listras
    # de cada coluna caindo do seu ponto mais alto). Nos cones, a mesma média some em 30 linhas (45°: peito e costas
    # de cima; as alças ficam com a forma do ombro).
    w = np.array([1.0] * len(zs) + [1 - step(k / 30) for k in range(1, len(phis) + 1)])
    F = F + (grid_blur(F, 10, 4) - F) * w[None, :]
    loose = [0.012 + 0.016 * step((Z_CHEST - z) / (Z_CHEST - Z_HEM)) for z in zs] + [0.012 - 0.005 * step(ph / math.radians(40)) for ph in phis]
    pos = lambda F: np.array([[tuple(orig[i] + dirs[i][j] * (F[j, i] + loose[i])) for i in range(n_rows)] for j in range(n_cols)])
    # O que vai ser cortado (dentro do braço, do pescoço, abaixo da barra) não pede folga.
    F = grid_tent(F, pos, lambda q: not (q.z < Z_HEM - 0.005 or neck_f(q) < 0 or armhole_f(q, 1 if q.x > 0 else -1) < 0), 0.007, 'regata')
    bm = bmesh.new()
    vrows = [[bm.verts.new(orig[i] + dirs[i][j] * (F[j, i] + loose[i])) for j in range(n_cols)] for i in range(n_rows)]
    for a_, b_ in zip(vrows, vrows[1:]):
        for j in range(n_cols):
            j2 = (j + 1) % n_cols
            bm.faces.new((a_[j], a_[j2], b_[j2], b_[j]))
    bm.normal_update()
    print('  regata em grade: %d linhas (%d anéis) x %d colunas' % (n_rows, len(zs), n_cols))
    return bm


def regata_cuts(bm):
    # Barra: plano horizontal.
    cut_by(bm, lambda p: p.z - Z_HEM, 'barra')
    cut_by(bm, neck_f, 'gola')
    for sx in (-1, 1):
        cut_by(bm, lambda p, sx=sx: armhole_f(p, sx), 'cava %+d' % sx)


def build_bermuda():
    """Sem casca da pele: o corpo do HY veste um short de compressão esculpido (cós franzido, dobras na braguilha,
    faces viradas na frente, a barra no meio da coxa, o rego do glúteo), e a casca copiava tudo. A bermuda é uma calça
    de verdade, em três grades costuradas:
     - pélvis: anéis em volta do eixo do tronco, do cós até 3 cm acima do gancho (raios até a pele, por cima dos vales,
       caindo da barriga e do glúteo, com folga);
     - costura do gancho: um leque de raios no plano do meio, da frente, por baixo do gancho, até as costas;
     - pernas: cada uma sai da sua metade do último anel mais a costura do gancho; por fora cai da pélvis (não entra),
       por dentro fecha até a coxa em 7 cm; mais abaixo, o perfil da coxa sem afinar (a pele tem a barra de um calção
       esculpida no meio da coxa) e abre até +2,4 cm na barra."""
    import numpy as np
    knee = {s: bone_head('calf_' + s) for s in ('l', 'r')}
    hip = {s: bone_head('thigh_' + s) for s in ('l', 'r')}
    crotch_z = min(hip['l'].z, hip['r'].z) - 0.07 * H / 1.715
    legs = []
    for s in ('l', 'r'):
        A, Bk = hip[s], knee[s]
        ax = (Bk - A).normalized()
        L = (Bk - A).length
        sx = 1 if A.x > 0 else -1
        e1 = Vector((sx, 0, 0))
        e1 = (e1 - ax * e1.dot(ax)).normalized()
        e2 = ax.cross(e1)
        prof = {}
        for v in skin.verts:
            p = v.co
            if (p.x > 0) != (sx > 0) or p.z > crotch_z + 0.03:
                continue
            d = p - A
            t = d.dot(ax) / L
            if not (0.0 < t < 0.7):
                continue
            r = d - ax * d.dot(ax)
            a = int((math.degrees(math.atan2(r.dot(e2), r.dot(e1))) + 180) // 5) % 72
            prof[(a, int(t * 50))] = max(prof.get((a, int(t * 50)), 0.0), r.length)
        G = hang_grid(prof, 72, 50, downward=False, decay=0.998)
        t_crotch = (crotch_z - A.z) / (Bk.z - A.z)
        legs.append((s, A, ax, L, e1, e2, G, t_crotch))
    bm = bmesh.new()
    # Pélvis.
    n_cols = 192
    jf, jb = n_cols // 4, 3 * n_cols // 4  # meio da frente e das costas
    angs = [2 * math.pi * j / n_cols - math.pi for j in range(n_cols)]
    dirs = [Vector((math.cos(a), math.sin(a), 0)) for a in angs]
    z_s = crotch_z + 0.03
    z_hi = pel.z + 0.012
    nz = int(round((z_hi - z_s) / 0.008))
    zs = [z_s + (z_hi - z_s) * i / nz for i in range(nz + 1)]
    F = np.zeros((n_cols, len(zs)))
    known = np.zeros((n_cols, len(zs)), dtype=bool)
    for i, z in enumerate(zs):
        o = torso_center(z)
        for j in range(n_cols):
            hit = skin_tree.ray_cast(o, dirs[j], 0.4)
            if hit[0] is not None:
                F[j, i] = (hit[0] - o).length
                known[j, i] = True
    F = grid_blur(grid_close(grid_fill(F, known), 6, 3), 9, 3)
    # Caimento de cima para baixo: o pano desce da barriga e do glúteo, não entra embaixo deles (5 mm a cada 10 cm).
    for j in range(n_cols):
        m = -1.0
        for i in range(len(zs) - 1, -1, -1):
            if i < len(zs) - 1:
                m -= 0.05 * (zs[i + 1] - zs[i])
            m = max(m, F[j, i])
            F[j, i] = m
    F = grid_blur(F, 9, 2)
    loose = [0.008 + 0.010 * step((pel.z - z) / (pel.z - z_s)) for z in zs]
    pos = lambda F: np.array([[tuple(torso_center(zs[i]) + dirs[j] * (F[j, i] + loose[i])) for i in range(len(zs))] for j in range(n_cols)])
    F = grid_tent(F, pos, lambda q: q.z < pel.z, 0.006, 'pélvis')
    rows = [[bm.verts.new(torso_center(zs[i]) + dirs[j] * (F[j, i] + loose[i])) for j in range(n_cols)] for i in range(len(zs))]
    for a_, b_ in zip(rows, rows[1:]):
        for j in range(n_cols):
            j2 = (j + 1) % n_cols
            bm.faces.new((a_[j], a_[j2], b_[j2], b_[j]))
    # Costura do gancho: leque no plano do meio, de O (entre a frente e as costas do último anel).
    Pf, Pb = rows[0][jf].co, rows[0][jb].co
    O = (Pf + Pb) / 2
    m = 16
    seam = [rows[0][jf]]
    for k in range(1, m):
        beta = math.pi * k / m
        d = Vector((0, -math.cos(beta), -math.sin(beta)))
        hit = skin_tree.ray_cast(O, d, 0.3)
        r_end = (Pf - O).length * (1 - k / m) + (Pb - O).length * k / m
        w = math.sin(beta) ** 2
        r = r_end * (1 - w) + ((hit[0] - O).length + 0.012 if hit[0] is not None else r_end) * w
        seam.append(bm.verts.new(O + d * r))
    seam.append(rows[0][jb])
    # Pernas.
    for s, A, ax, L, e1, e2, G, t_crotch in legs:
        if A.x > 0:  # esquerda: frente -> lado de fora -> costas, e volta pela costura
            mouth = [rows[0][j] for j in range(jf, jb + 1)] + seam[-2:0:-1]
        else:
            mouth = [rows[0][j % n_cols] for j in range(jb, jf + n_cols + 1)] + seam[1:-1]
        nm = len(mouth)
        cols = []
        for v in mouth:
            d = v.co - A
            t = d.dot(ax) / L
            rv = d - ax * d.dot(ax)
            cols.append((t, math.atan2(rv.dot(e2), rv.dot(e1)), rv.length))
        K = int(round((0.9 - min(c[0] for c in cols)) * L / 0.008))

        def leg_r(ang, t, t_c, r_c, G=G, t_crotch=t_crotch):
            inner = step((abs(ang) - math.radians(110)) / math.radians(40))
            loose_ = (0.006 + 0.018 * step((t - t_crotch) / (0.86 - t_crotch))) * (1 - 0.65 * inner)
            want = sample_grid(G, math.degrees(ang), t * 50) + loose_
            target = want + (max(want, r_c) - want) * (1 - inner)
            return r_c + (target - r_c) * step((t - t_c) / 0.18)
        T = np.array([[t_c + (0.9 - t_c) * k / K for k in range(K + 1)] for t_c, _, _ in cols])
        R = np.array([[leg_r(ang, T[c, k], t_c, r_c) for k in range(K + 1)] for c, (t_c, ang, r_c) in enumerate(cols)])
        cdir = [e1 * math.cos(ang) + e2 * math.sin(ang) for _, ang, _ in cols]
        lpos = lambda R: np.array([[tuple(A + ax * (L * T[c, k]) + cdir[c] * R[c, k]) for k in range(K + 1)] for c in range(nm)])
        R = grid_tent(R, lpos, lambda q, A=A, ax=ax, L=L: (q - A).dot(ax) / L < 0.87, 0.006, 'perna ' + s, row_w=[step(k / 4) for k in range(K + 1)])
        lrows = [mouth] + [[bm.verts.new(A + ax * (L * T[c, k]) + cdir[c] * R[c, k]) for c in range(nm)] for k in range(1, K + 1)]
        for a_, b_ in zip(lrows, lrows[1:]):
            for c in range(nm):
                c2 = (c + 1) % nm
                bm.faces.new((a_[c], a_[c2], b_[c2], b_[c]))
        print('  perna %s: %d colunas (boca: meio anel + costura do gancho) x %d linhas' % (s, nm, K + 1))
    bm.normal_update()
    print('  bermuda: pélvis %d anéis x %d colunas (até %.3f m), gancho em %d raios' % (len(zs), n_cols, z_s, m - 1))
    return bm


def bermuda_cuts(bm):
    z_top = pel.z  # cós na altura da pélvis: a regata cobre 10 cm dele (de baixo não se vê a borda)
    cut_by(bm, lambda p: z_top - p.z, 'cós')
    for s in ('l', 'r'):
        A, Bk = bone_head('thigh_' + s), bone_head('calf_' + s)
        ax = (Bk - A).normalized()
        P = A + (Bk - A) * 0.86
        cut_by(bm, lambda p, P=P, ax=ax: (P - p).dot(ax), 'barra ' + s)


# ---------------------------------------------------------------- peça
print('costurando', KIND, '->', OUT)
bm = build_regata() if KIND == 'regata' else build_bermuda()
def diag_dump(stage):
    if os.environ.get('DIAG_ETAPA') != str(stage):
        return
    me_ = bpy.data.meshes.new('diag')
    bm.to_mesh(me_)
    ob_ = bpy.data.objects.new('diag', me_)
    bpy.context.collection.objects.link(ob_)
    set_active(ob_)
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.select_all(action='DESELECT')
    ob_.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True)
    print('DIAG etapa', stage, 'exportada')
    sys.exit(0)


diag_dump(1)
# Alisa as emendas da grade (anéis e cones da regata; pélvis, gancho e pernas da bermuda).
border = {v for e in bm.edges if len(e.link_faces) < 2 for v in e.verts}
inner = [v for v in bm.verts if v not in border]
for _ in range(8 if KIND == 'regata' else 12):
    bmesh.ops.smooth_laplacian_vert(bm, verts=inner, lambda_factor=0.6, lambda_border=0.0, use_x=True, use_y=True, use_z=True, preserve_volume=True)
# Sempre por fora da pele (o alisamento encolhe o convexo: ombro, glúteo).
MARGIN = 0.006 if KIND == 'regata' else 0.005
for _ in range(3):
    for v in bm.verts:
        d, n = skin_clear(v.co)
        if d is not None and d < MARGIN:
            v.co = v.co + n * (MARGIN - d)
    bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if v not in border], factor=0.3, use_axis_x=True, use_axis_y=True, use_axis_z=True)
for v in bm.verts:
    d, n = skin_clear(v.co)
    if d is not None and d < MARGIN:
        v.co = v.co + n * (MARGIN - d)

diag_dump(2)
# Por cima da peça de baixo (a regata sobre a bermuda): a barra fica 6 mm por fora dela.
over = None
if OVER:
    o_objs = import_glb(OVER)
    o_arm = next(o for o in o_objs if o.type == 'ARMATURE')
    o_mesh = next(o for o in o_objs if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers))
    o_arm.animation_data_clear()
    for pb in sorted(o_arm.pose.bones, key=lambda b: len(b.parent_recursive)):
        if pb.name in arm.data.bones:
            pb.matrix = arm.data.bones[pb.name].matrix_local.copy()
            bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ov = [o_mesh.evaluated_get(dg).matrix_world @ v.co for v in o_mesh.evaluated_get(dg).data.vertices]
    over_tree = BVHTree.FromObject(o_mesh, dg)
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
    over = (over_tree, min(p.z for p in ov), max(p.z for p in ov))
    for o in o_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    # Campo suave: cada vértice pede o que falta para ficar 6 mm por fora da bermuda; o pedido se espalha (raio de 5 cm,
    # núcleo plano). Um empurrão vértice a vértice deixava um degrau na altura do cós.
    for _ in range(4):
        pts = [v.co.copy() for v in bm.verts]
        asks = []
        kd = KDTree(len(pts))
        for i, p in enumerate(pts):
            d, loc, n = signed(over_tree, p)
            need = max(0.0, 0.006 - d) if d is not None and p.z < over[2] + 0.02 else 0.0
            asks.append((need, n))
            if need > 0:
                kd.insert(p, i)
        kd.balance()
        if max(a for a, _ in asks) < 0.0005:
            break
        for v, p in zip(bm.verts, pts):
            size, dirv = 0.0, Vector()
            for _, i, dd in kd.find_range(p, 0.05):
                wgt = 1 - step((dd - 0.025) / 0.025)
                size = max(size, asks[i][0] * wgt)
                dirv += asks[i][1] * asks[i][0] * wgt
            if size > 0 and dirv.length > 1e-9:
                v.co = p + dirv.normalized() * size

# Aberturas: cortes exatos e o debrum.
if KIND == 'regata':
    regata_cuts(bm)
else:
    bermuda_cuts(bm)
keep_largest(bm)
if os.environ.get('DIAG_BORDAS'):
    final = CUTS
    cls = {}
    bad = []
    for e in bm.edges:
        if len(e.link_faces) != 1:
            continue
        best, bn = 1e9, 'pele'
        for n, f in final:
            m = 0.0
            for v in e.verts:
                g = Vector([(f(v.co + d) - f(v.co - d)) / 2e-4 for d in (Vector((1e-4, 0, 0)), Vector((0, 1e-4, 0)), Vector((0, 0, 1e-4)))]).length
                m = max(m, abs(f(v.co)) / max(g, 1e-9))
            if m < best:
                best, bn = m, n
        if best > 0.0015:
            bn = 'pele'
            bad.append(e)
        cls[bn] = cls.get(bn, 0) + 1
    print('DIAG bordas:', cls)
    for e in bad[:400]:
        a, b = e.verts
        print('  pele %.3f %.3f %.3f  ->  %.3f %.3f %.3f' % (a.co.x, a.co.y, a.co.z, b.co.x, b.co.y, b.co.z))
    for l in boundary_loops(bm):
        vs = {v for e in l for v in e.verts}
        print('  volta %d arestas  x %.3f..%.3f  y %.3f..%.3f  z %.3f..%.3f' % (len(l), min(v.co.x for v in vs), max(v.co.x for v in vs), min(v.co.y for v in vs), max(v.co.y for v in vs), min(v.co.z for v in vs), max(v.co.z for v in vs)))
diag_dump(3)
if KIND == 'regata':
    # Largura da alça no alto do ombro: menor distância entre a borda da gola e a da cava, em cada lado (meta: 4,5 cm).
    lp = sorted(boundary_loops(bm), key=len, reverse=True)[:4]
    cz = lambda l: sum(v.co.z for e in l for v in e.verts) / (2 * len(l))
    cx = lambda l: sum(v.co.x for e in l for v in e.verts) / (2 * len(l))
    hem = min(lp, key=cz)
    rest = [l for l in lp if l is not hem]
    neck = min(rest, key=lambda l: abs(cx(l)))
    nv = [v.co for e in neck for v in e.verts]
    for l in rest:
        if l is neck:
            continue
        sx = 1 if cx(l) > 0 else -1
        cv = [v.co for e in l for v in e.verts if v.co.z > Z_CHEST + 0.05]
        side_n = [q for q in nv if (q.x > 0) == (sx > 0)]
        if cv and side_n:
            w = min((a - b).length for a in side_n[::2] for b in cv[::2])
            print('  alça %+d: %.1f cm' % (sx, w * 100))
bm.normal_update()
loops = [l for l in boundary_loops(bm) if len(l) > 6]
for small in [l for l in boundary_loops(bm) if len(l) <= 6]:
    bmesh.ops.holes_fill(bm, edges=list(small), sides=0)
# A borda de cima da bermuda (o cós) fica sob a regata: sem debrum.
if KIND == 'bermuda':
    top = max(loops, key=lambda l: sum(v.co.z for e in l for v in e.verts) / (2 * len(l)))
    loops = [l for l in loops if l is not top]
trim_faces = set()
for loop in loops:
    ring = ordered_loop(loop)
    n = len(ring)
    rows = [ring]
    if n != len({v for e in loop for v in e.verts}):
        print('  aviso: borda com %d vértices percorrida em %d' % (len({v for e in loop for v in e.verts}), n))
    # Direção "para fora do tecido" na borda: uma orientação por volta (a maioria decide) e alisada ao longo dela,
    # senão o debrum torcia onde a borda faz curva fechada (manchas escuras na gola).
    tn = []
    votes = 0
    for i, v in enumerate(ring):
        d = (ring[(i + 1) % n].co - ring[i - 1].co).normalized()
        t = d.cross(v.normal).normalized()
        fc = sum((f.calc_center_median() for f in v.link_faces), Vector()) / max(1, len(v.link_faces))
        votes += -1 if (fc - v.co).dot(t) > 0 else 1
        tn.append([t, v.normal.copy()])
    if votes < 0:
        for x in tn:
            x[0] = -x[0]
    for _ in range(4):
        tn = [[(tn[i - 1][0] + 2 * tn[i][0] + tn[(i + 1) % n][0]).normalized(), (tn[i - 1][1] + 2 * tn[i][1] + tn[(i + 1) % n][1]).normalized()] for i in range(n)]
    out_dirs = [(t, nn) for t, nn in tn]
    for (dt, dn) in ((0.006, 0.0006), (0.013, -0.0010), (0.006, -0.0026), (-0.006, -0.0026)):
        rows.append([bm.verts.new(v.co + t * dt + nn * dn) for v, (t, nn) in zip(ring, out_dirs)])
    for a_, b_ in zip(rows, rows[1:]):
        for i in range(n):
            i2 = (i + 1) % n
            f = bm.faces.new((a_[i], a_[i2], b_[i2], b_[i]))
            trim_faces.add(f)
# Orientação: todas as faces para fora (a maioria das faces concorda com a pele mais perto).
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
votes = 0
for f in bm.faces:
    c = f.calc_center_median()
    d, loc, nrm = signed(skin_tree, c)
    if nrm is not None:
        votes += 1 if f.normal.dot(nrm) > 0 else -1
if votes < 0:
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
# O debrum vai no índice de material antes de triangular (as faces novas herdam o índice).
for f in bm.faces:
    f.material_index = 1 if f in trim_faces else 0
bmesh.ops.triangulate(bm, faces=bm.faces)
for f in bm.faces:
    f.smooth = True
print('peça: %d vértices, %d faces, %d aberturas com debrum' % (len(bm.verts), len(bm.faces), len(loops)))
me = bpy.data.meshes.new(KIND)
bm.to_mesh(me)
bm.free()
piece = bpy.data.objects.new(KIND, me)
bpy.context.collection.objects.link(piece)
for name in ('Tecido', 'Debrum'):
    me.materials.append(bpy.data.materials.new(name))


def world_verts(o):
    return [o.matrix_world @ v.co for v in o.data.vertices]


def box(points):
    xs, ys, zs = zip(*points)
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


# ---------------------------------------------------------------- ossos de pano (como no vestir.py)
cloth_bones = []  # (nome, pai, cabeça, cauda)
if KIND == 'regata':
    # Pendurados na pélvis, como a bermuda por baixo: no agachamento a coluna dobra sobre a pélvis, e com os ossos na
    # coluna a barra (que segue a bermuda) descolava dela e o glúteo da bermuda atravessava a regata.
    top = bone_head('spine_02').z
    pmin, pmax = box(world_verts(piece))
    c = (pmin + pmax) / 2
    r = (pmax - pmin) / 2
    for nm, d in (('pano_F', Vector((0, -1, 0))), ('pano_B', Vector((0, 1, 0))), ('pano_L', Vector((1, 0, 0))), ('pano_R', Vector((-1, 0, 0)))):
        off = Vector((d.x * r.x * 0.75, d.y * r.y * 0.75, 0))
        cloth_bones.append((nm, 'pelvis', Vector((c.x, c.y, top)) + off * 0.6, Vector((c.x, c.y, pmin.z)) + off))
else:
    for side in ('l', 'r'):
        hip = bone_head('thigh_' + side)
        pts = [p for p in world_verts(piece) if (p.x > 0) == (hip.x > 0)]
        pmin, pmax = box(pts)
        low = [p for p in pts if p.z < pmin.z + 0.03]
        cx, cy = sum(p.x for p in low) / len(low), sum(p.y for p in low) / len(low)
        ry = (max(p.y for p in low) - min(p.y for p in low)) / 2
        for nm, dy in (('F', -1), ('B', 1)):
            cloth_bones.append(('pano_%s_%s' % (nm, side), 'thigh_' + side, Vector((hip.x, cy + dy * ry * 0.5, hip.z - 0.02 * H)), Vector((cx, cy + dy * ry * 0.8, pmin.z))))
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
# Ossos que a peça segue: a regata só o tronco (a cava não vai atrás do braço: o LimbPush do jogo tira o braço de
# dentro dela); a bermuda o quadril e as coxas (a barra não dobra com o joelho).
ALLOWED = {
    'regata': {'pelvis', 'hip_l', 'hip_r', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'},
    'bermuda': {'pelvis', 'hip_l', 'hip_r', 'spine_01', 'thigh_l', 'thigh_r'},
}[KIND]
OVER_BLEND = []
if KIND == 'regata' and over:
    # Barra sobre a bermuda: em toda a parte que cobre a bermuda os pesos são os dela, e voltam aos da regata nos 6 cm
    # acima do cós (com a rampa abaixo do cós, o glúteo da bermuda atravessava a regata no agachamento fundo).
    for v in piece.data.vertices:
        p = piece.matrix_world @ v.co
        k = step((over[2] + 0.06 - p.z) / 0.06)
        if k <= 0:
            continue
        acc, tot = {}, 0.0
        for _, i, d in over_kd.find_n(p, 4):
            wgt = 1 / (d + 1e-4)
            tot += wgt
            for b, x in over_w[i].items():
                acc[b] = acc.get(b, 0) + x * wgt
        OVER_BLEND.append((v.index, k, {b: x / tot for b, x in acc.items()}))
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
    # Pano solto: a pele mais perto dava a coxa ao painel da frente (que pende 3 cm à frente da virilha) e ao gancho;
    # no arremesso, com o quadril dobrado, o painel girava com a coxa e a bermuda dobrava sobre si mesma (e a barra da
    # regata, que segue a bermuda, abria em balão). A coxa entra pela posição ao longo dela: nada até 2 cm abaixo do quadril
    # (o alto da bermuda, sob a barra da regata, fica com a pélvis: com o joelho dobrado, a coxa da bermuda avançava por
    # cima da barra) e toda a 16 cm (5% a 40% do fêmur); o resto fica com o tronco que a pele mais perto deu (pélvis,
    # spine_01). A pele do alto da coxa sob o painel da frente sai no jogo (PlayerGear.coverBody, até 6 cm do tecido).
    for n in ('pelvis', 'thigh_l', 'thigh_r'):
        if n not in groups:
            groups.new(name=n)
    gname = {g.index: g.name for g in groups}
    femur = {s: (bone_head('thigh_' + s), (bone_head('calf_' + s) - bone_head('thigh_' + s)).normalized(), (bone_head('calf_' + s) - bone_head('thigh_' + s)).length) for s in ('l', 'r')}
    for v in piece.data.vertices:
        p = piece.matrix_world @ v.co
        s = 'l' if (p.x > 0) == (left_x > 0) else 'r'
        A, ax, L = femur[s]
        wt = step(((p - A).dot(ax) / L - 0.05) / 0.35)
        ws = {gname[g.group]: g.weight for g in v.groups}
        trunk = {n: w for n, w in ws.items() if n in ('pelvis', 'spine_01', 'hip_l', 'hip_r')}
        tt = sum(trunk.values())
        new = {n: w / tt * (1 - wt) for n, w in trunk.items()} if tt > 1e-3 else {'pelvis': 1 - wt}
        new['thigh_' + s] = new.get('thigh_' + s, 0.0) + wt
        for n in ws:
            if new.get(n, 0) <= 1e-4:
                groups[n].remove([v.index])
        for n, w in new.items():
            if w > 1e-4:
                groups[n].add([v.index], w, 'REPLACE')
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
vs = [piece.matrix_world @ v.co for v in piece.data.vertices]
for nm, parent, h, t in cloth_bones:
    groups.new(name=nm)
for i, p in enumerate(vs):
    # Quanto mais perto da barra, mais o pano manda: na bermuda até 40% (a perna segue a coxa); na regata só 10%, um
    # balanço leve (a barra cobre a bermuda e segue os pesos dela: com 85% as costas abriam como tampa no agachamento
    # fundo, e com 30% a mola levava a barra para dentro do assento da bermuda). Sempre crescendo até a barra.
    cand = [(nm, h, t) for nm, parent, h, t in cloth_bones if KIND != 'bermuda' or (h.x > 0) == (p.x > 0)]
    ws = []
    for nm, h, t in cand:
        k = step((h.z - p.z) / max(1e-4, h.z - t.z)) * (0.4 if KIND == 'bermuda' else 0.1)
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
# Pesos alisados no espaço (o debrum e o tecido vizinho andam juntos; sem degrau entre faixas de pesos da pele).
gname = {g.index: g.name for g in groups}
cur = [{gname[g.group]: g.weight for g in v.groups if g.weight > 0} for v in piece.data.vertices]
kd = KDTree(len(vs))
for i, p in enumerate(vs):
    kd.insert(p, i)
kd.balance()
Rw = (0.03 if KIND == 'regata' else 0.015) * H
for i, p in enumerate(vs):
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
set_active(piece)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.01)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)

# ---------------------------------------------------------------- textura: UV, sombra (AO) e cor por zona
import numpy as np
set_active(piece)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 48
world = bpy.data.worlds.new('mundo')
scene.world = world
world.light_settings.distance = 0.12  # alcance da sombra de contato (dobras, sob o braço, entre as pernas)
SIZE = 1024


def bake_into(kind, emit=None):
    img = bpy.data.images.new('bake_' + kind, SIZE, SIZE, float_buffer=True)
    for i, m in enumerate(me.materials):
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        if emit is not None:
            em = nt.nodes.new('ShaderNodeEmission')
            em.inputs['Color'].default_value = emit[i]
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
        else:
            bs = nt.nodes.new('ShaderNodeBsdfDiffuse')
            nt.links.new(bs.outputs['BSDF'], out.inputs['Surface'])
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.nodes.active = tex
    set_active(piece)
    bpy.ops.object.bake(type=kind, margin=16, use_clear=True, target='IMAGE_TEXTURES')
    px = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(SIZE, SIZE, 4)


ao = bake_into('AO')[..., 0]
mask = bake_into('EMIT', emit=[(1, 0, 0, 1), (0, 1, 0, 1)])[..., :3]
s = mask[..., 0] + mask[..., 1]
# Fora das ilhas (e da margem) a sombra é a média: de longe a textura reduzida mistura o fundo com a borda das ilhas.
ao = np.where(s > 1e-3, ao, float(ao[s > 1e-3].mean()))
m0 = np.where(s > 1e-3, mask[..., 0] / np.maximum(s, 1e-3), 1.0)
m1 = 1.0 - m0


def lin(hexc):
    c = [int(hexc[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return np.array([x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c], dtype=np.float32)


c0, c1 = lin(COLORS[0]), lin(COLORS[1] if len(COLORS) > 1 else COLORS[0])
shade = 0.42 + 0.58 * np.clip(ao, 0, 1) ** 0.8
col = (m0[..., None] * c0 + m1[..., None] * c1) * shade[..., None]
srgb = np.where(col <= 0.0031308, col * 12.92, 1.055 * np.power(np.clip(col, 0, None), 1 / 2.4) - 0.055)
final = bpy.data.images.new(PIECE + '_cor', SIZE, SIZE, alpha=False)
rgba = np.concatenate([np.clip(srgb, 0, 1), np.ones((SIZE, SIZE, 1), dtype=np.float32)], axis=2)
final.pixels.foreach_set(rgba.reshape(-1).astype(np.float32))
final.pack()
mat = bpy.data.materials.new('Uniforme')
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = 0.85
bsdf.inputs['Metallic'].default_value = 0.0
tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
tex.image = final
mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
me.materials.clear()
me.materials.append(mat)
for p_ in me.polygons:
    p_.material_index = 0
if ZONES_DIR:
    os.makedirs(ZONES_DIR, exist_ok=True)
    np.save(os.path.join(ZONES_DIR, PIECE + '_zonas.npy'), np.stack([m0, m1], axis=-1).astype(np.float16))
    with open(os.path.join(ZONES_DIR, PIECE + '_zonas.json'), 'w', encoding='utf-8') as fh:
        json.dump({'cores': [COLORS[0], COLORS[1] if len(COLORS) > 1 else COLORS[0], None, None]}, fh)
print('textura: AO médio %.2f, %.0f%% debrum' % (float(ao.mean()), 100 * float((m1 > 0.5).mean())))

# ---------------------------------------------------------------- exporta a peça e o esqueleto
bpy.ops.object.select_all(action='DESELECT')
piece.select_set(True)
arm.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=False,
                          export_skins=True, export_yup=True, export_image_format='WEBP', export_jpeg_quality=88)
print('COSTURA OK', KIND, OUT, 'tris', sum(len(p_.vertices) - 2 for p_ in me.polygons))
