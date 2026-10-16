// Arena em volta da quadra, com os modelos do lote "arena" do HY 3D (docs/20, Tools/Animacao/arena.py):
//  - a outra metade da quadra e a cesta do outro lado (só visual; a física é só a da cesta do Freestyle);
//  - a volta da quadra nas posições de uma quadra da NBA: mesa de anotação no meio de uma lateral, bancos dos dois
//    times ao lado dela, mesa de transmissão atrás, fileiras VIP na outra lateral, câmeras de TV, fotógrafos sob as
//    cestas, cooler, rack de bolas, túnel;
//  - arquibancada em anel (bloco_arquibancada instanciado em 6 anéis, com a faixa de LED entre o anel de baixo e o de
//    cima), camarotes, banners, refletores e o telão (o do HY saiu com "antenas": telão e faixa de LED são feitos aqui);
//  - torcida sentada instanciada, com variação de cor por instância (sem animação nesta etapa).
// Tudo em coordenadas do núcleo (game.layout) e convertido por units.ts. ?arena=0 desliga (main.ts).
import * as THREE from 'three';
import { HoopSpec, Vec3 } from '../sim';
import { toThree } from '../units';
import { arenaMesh, preloadArena } from './ArenaModels';
import { FloorBounds, type CourtLayout } from './Court';
import { HoopModelNames, buildModelHoop } from './HoopMesh';
import { NetMesh } from './NetMesh';

const CrowdNames = [
  'torcedor_bone_sentado',
  'torcedor_camisa_sentado',
  'torcedor_casaco_sentado',
  'torcedor_idoso_sentado',
  'torcedora_casual_sentado',
  'torcedora_moletom_sentado',
  'torcedora_universitaria_sentado',
  'crianca_torcedor_sentado',
  'vip_elegante_sentado',
  'vip_terno_sentado',
] as const;
/** Peso de cada modelo na arquibancada e nas fileiras VIP (mesma ordem de CrowdNames). */
const StandWeights = [1, 1, 1, 0.8, 1, 1, 1, 0.5, 0.35, 0.35];
const VipWeights = [0.4, 0.4, 0.5, 0.6, 0.5, 0.3, 0.3, 0.2, 1.4, 1.4];

const PropNames = [
  'mesa_anotacao',
  'mesa_transmissao',
  'fileira_banco_time',
  'fileira_vip',
  'camera_tv_tripe',
  'camera_fotografo',
  'cooler_bebida',
  'rack_bolas',
  'toalhas_dobradas',
  'rodo_quadra',
  'tunel_jogadores',
  'banner_campeao',
  'banner_camisa',
  'refletor_teto',
  'bloco_arquibancada',
  'camarote_vip',
  'comentarista_sentado',
  'tecnico_terno_em_pe',
  'tecnico_assistente_em_pe',
  'seguranca_em_pe',
  'ball_boy_em_pe',
  'fotografo_ajoelhado',
] as const;

export const ArenaModelNames: readonly string[] = [...PropNames, ...CrowdNames, ...HoopModelNames];

/** Bloco de arquibancada (3 fileiras de 8 lugares) na escala do arena.py: 4,79 x 2,60 x 2,32 m. */
const Block = { width: 4.79, depth: 2.6 };
/** Assentos do bloco, no espaço do modelo (three: +Z = frente, para a quadra), medidos nas vistas ortogonais. */
const BlockSeatX = [-1.968, -1.648, -1.255, -0.759, -0.299, 0.147, 0.636, 1.118];
const BlockRows = [
  { z: 0.897, h: 0.536 },
  { z: 0.022, h: 1.066 },
  { z: -0.877, h: 1.528 },
];
/** Um anel = um bloco de profundidade (3 fileiras); sobe 1,49 m. Do 4º anel para cima há um recuo com a faixa de LED. */
const Ring = { depth: 2.62, rise: 1.49, count: 6, upperFrom: 3, gapDepth: 1.3, gapRise: 2.3 };
/** Fileira VIP (5 cadeiras em 3 m): assento a 0,47 m. */
const VipSeatX = [-1.2, -0.6, 0, 0.6, 1.2];
const VipSeatHeight = 0.47;

/** Gerador determinístico (a arena não muda entre execuções). */
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(weights: readonly number[], r: number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x <= 0) return i;
  }
  return weights.length - 1;
}

/** Matriz no núcleo: ponto (x, y, z) e frente do modelo virada para (fx, fy). */
function placeMatrix(x: number, y: number, z: number, fx: number, fy: number, scale = 1, sx = 1): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(fx, fy));
  return new THREE.Matrix4().compose(toThree(new Vec3(x, y, z)), q, new THREE.Vector3(scale * sx, scale, scale));
}

/** Retângulo de cantos arredondados em volta do centro da quadra: ponto e normal para fora pelo comprimento s. */
class RoundedRect {
  readonly length: number;
  private readonly sx: number;
  private readonly sy: number;
  private readonly arc: number;

  constructor(
    readonly cx: number,
    readonly hx: number,
    readonly hy: number,
    readonly r: number,
  ) {
    this.sx = 2 * (hx - r);
    this.sy = 2 * (hy - r);
    this.arc = (Math.PI / 2) * r;
    this.length = 2 * (this.sx + this.sy) + 4 * this.arc;
  }

  /** Começa no fim +x da reta da lateral +y e anda para -x (8 trechos: 4 retas e 4 cantos). */
  at(s: number): { x: number; y: number; nx: number; ny: number } {
    let t = ((s % this.length) + this.length) % this.length;
    const parts = this.parts();
    for (let i = 0; i < parts.length; i++) {
      const [len, f] = parts[i];
      if (t <= len || i === parts.length - 1) return this.point(f(Math.min(t, len)));
      t -= len;
    }
    throw new Error('inalcançável');
  }

  /** Pelo trecho: t em [0, 8), parte inteira = trecho, fração = quanto dele (retângulos concêntricos se correspondem). */
  atSegment(t: number): { x: number; y: number; nx: number; ny: number } {
    const parts = this.parts();
    const i = Math.min(7, Math.floor(t));
    const [len, f] = parts[i];
    return this.point(f((t - i) * len));
  }

  private point([x, y, nx, ny]: [number, number, number, number]): { x: number; y: number; nx: number; ny: number } {
    return { x: this.cx + x, y, nx, ny };
  }

  private parts(): Array<[number, (u: number) => [number, number, number, number]]> {
    const { hx, hy, r, sx, sy, arc } = this;
    // Trechos: lateral +y (x de +sx/2 a -sx/2), canto, fundo -x, canto, lateral -y, canto, fundo +x, canto.
    return [
      [sx, (u) => [sx / 2 - u, hy, 0, 1]],
      [arc, (u) => this.corner(-sx / 2, sy / 2, Math.PI / 2 + u / r)],
      [sy, (u) => [-hx, sy / 2 - u, -1, 0]],
      [arc, (u) => this.corner(-sx / 2, -sy / 2, Math.PI + u / r)],
      [sx, (u) => [-sx / 2 + u, -hy, 0, -1]],
      [arc, (u) => this.corner(sx / 2, -sy / 2, (3 * Math.PI) / 2 + u / r)],
      [sy, (u) => [hx, -sy / 2 + u, 1, 0]],
      [arc, (u) => this.corner(sx / 2, sy / 2, u / r)],
    ];
  }

  private corner(ox: number, oy: number, angle: number): [number, number, number, number] {
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    return [ox + nx * this.r, oy + ny * this.r, nx, ny];
  }
}

/** Material da torcida: cor das roupas girada no matiz por instância (a pele fica), tecido cinza clareado/escurecido. */
function crowdMaterial(source: THREE.Material): THREE.MeshStandardMaterial {
  const m = (source as THREE.MeshStandardMaterial).clone();
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aTint;\nvarying vec2 vTint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = aTint;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vTint;
vec3 crowdTint(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = (mx - mn) / max(mx, 1e-3);
  float hueRatio = (c.g - c.b) / max(c.r - c.b, 1e-3);
  bool skin = c.r >= c.g && c.g >= c.b && sat > 0.2 && sat < 0.92 && hueRatio > 0.16 && hueRatio < 0.78;
  if (skin) return c;
  vec3 axis = vec3(0.57735);
  float ca = cos(vTint.x);
  vec3 rotated = c * ca + cross(axis, c) * sin(vTint.x) + axis * dot(axis, c) * (1.0 - ca);
  // Cor girada um pouco menos saturada: sem isso a arquibancada vira um arco-íris de neon.
  rotated = mix(vec3(dot(rotated, vec3(0.2126, 0.7152, 0.0722))), rotated, 0.7);
  return mix(c * vTint.y, rotated * vTint.y, smoothstep(0.15, 0.35, sat));
}`,
      )
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = crowdTint(diffuseColor.rgb);')
      // A arquibancada fica na penumbra: um pouco de luz própria na cor da roupa (sem o mapa de emissão do material).
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += diffuseColor.rgb * 0.16;');
  };
  m.customProgramCacheKey = () => 'torcida';
  return m;
}

/** Faixa de LED: anúncios fictícios num canvas que corre (offset da textura a cada quadro). */
function ledTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const ads: Array<[string, string, string]> = [
    ['#0b1d4f', '#ffffff', 'GARRAFÃO'],
    ['#d7262e', '#ffffff', 'CESTA DE 3!'],
    ['#101010', '#ffcc1a', 'PRO STICK'],
    ['#0f6b3a', '#ffffff', 'DEFENSE  DEFENSE'],
    ['#ffcc1a', '#101010', 'CARDOSO2K'],
    ['#4b1c80', '#ffffff', 'NOITE DE JOGO'],
  ];
  const w = canvas.width / ads.length;
  ads.forEach(([bg, fg, text], i) => {
    ctx.fillStyle = bg;
    ctx.fillRect(i * w, 0, w, canvas.height);
    ctx.fillStyle = fg;
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, i * w + w / 2, canvas.height / 2 + 2);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Tela do telão: placar e marca. */
function scoreboardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 576;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#0d1a3a');
  g.addColorStop(1, '#050811');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffcc1a';
  ctx.font = 'bold 110px system-ui, sans-serif';
  ctx.fillText('GARRAFÃO', 512, 110);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 60px system-ui, sans-serif';
  ctx.fillText('CPU', 250, 260);
  ctx.fillText('CARDOSO2K', 774, 260);
  ctx.font = 'bold 170px system-ui, sans-serif';
  ctx.fillStyle = '#ff4a3a';
  ctx.fillText('00', 250, 410);
  ctx.fillText('00', 774, 410);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 80px system-ui, sans-serif';
  ctx.fillText('4º  12:00', 512, 410);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Lote de instâncias de um modelo (uma chamada de desenho por modelo). */
class Batch {
  private readonly items = new Map<string, THREE.Matrix4[]>();

  add(name: string, m: THREE.Matrix4): void {
    let list = this.items.get(name);
    if (!list) this.items.set(name, (list = []));
    list.push(m);
  }

  async build(group: THREE.Group, shadows: ReadonlySet<string>): Promise<void> {
    for (const [name, matrices] of this.items) {
      const src = await arenaMesh(name);
      const mesh = new THREE.InstancedMesh(src.geometry, src.material, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.computeBoundingSphere();
      mesh.castShadow = shadows.has(name);
      mesh.receiveShadow = true;
      mesh.name = name;
      group.add(mesh);
    }
  }
}

export class ArenaDressing {
  readonly group = new THREE.Group();
  private led: THREE.CanvasTexture | null = null;
  private time = 0;

  /** Começa a baixar os GLBs (chamado no início do boot). */
  static preload(): void {
    preloadArena(ArenaModelNames);
  }

  static async build(scene: THREE.Scene, layout: CourtLayout): Promise<ArenaDressing> {
    const arena = new ArenaDressing();
    await arena.assemble(scene, layout);
    return arena;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.led) this.led.offset.x = (this.time * 0.035) % 1;
  }

  private async assemble(scene: THREE.Scene, layout: CourtLayout): Promise<void> {
    await Promise.all(ArenaModelNames.map((n) => arenaMesh(n)));
    const g = this.group;
    g.name = 'arena';
    const C = layout.halfCourtX;
    const BL = layout.baselineX;
    const FBL = 2 * C - BL;
    const HW = layout.halfWidth;
    const rand = makePrng(2026);
    const batch = new Batch();
    const crowd = new Map<string, Array<{ m: THREE.Matrix4; tint: [number, number] }>>();
    const addPerson = (chunk: string, variant: number, m: THREE.Matrix4): void => {
      const key = `${chunk}|${variant}`;
      let list = crowd.get(key);
      if (!list) crowd.set(key, (list = []));
      // Matiz: 40% com a roupa original, o resto girado em ângulos poucos (as cores do time da casa se repetem).
      const hues = [0, 0, 0, 0, 0.5, -0.5, 1.6, Math.PI, -2.2, 2.6];
      list.push({ m, tint: [hues[Math.floor(rand() * hues.length)], 0.72 + rand() * 0.4] });
    };

    // A quadra do jogo é meia quadra: some o ginásio simples do Court.ts.
    for (const name of ['ginasio', 'arquibancada_simples']) {
      const old = scene.getObjectByName(name);
      if (old) old.visible = false;
    }

    // ---------------------------------------------------------------- piso
    // Outra metade: o mesmo canvas do piso girado 180° em torno do centro da quadra (como uma quadra de verdade, o
    // logo lê certo dos dois lados). Cobre do meio da quadra em diante, por cima da parte "fora" do piso original.
    const floor = scene.getObjectByName('piso') as THREE.Mesh | undefined;
    if (floor) {
      const b = FloorBounds;
      const x0 = C;
      const x1 = 2 * C - b.minX;
      const geo = new THREE.PlaneGeometry(x1 - x0, b.maxY - b.minY);
      geo.rotateX(-Math.PI / 2);
      geo.translate((x0 + x1) / 2, 0, (b.minY + b.maxY) / 2);
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getZ(i); // núcleo y = three z
        uv.setXY(i, (2 * C - x - b.minX) / (b.maxX - b.minX), (b.maxY + y) / (b.maxY - b.minY));
      }
      const mat = (floor.material as THREE.MeshStandardMaterial).clone();
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -1;
      mat.polygonOffsetUnits = -1;
      const far = new THREE.Mesh(geo, mat);
      far.receiveShadow = true;
      far.name = 'piso_outro_lado';
      g.add(far);
    }
    // Chão escuro em volta da madeira, até a arquibancada.
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(FBL - BL + 40, 2 * HW + 40),
      new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.85 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(C, -0.03, 0); // abaixo do piso com folga: de longe (vista de cima) os dois brigavam
    apron.receiveShadow = true;
    g.add(apron);

    // ---------------------------------------------------------------- cesta do outro lado (só visual)
    const farHoop = HoopSpec.fromRimFloorPoint(new Vec3(2 * C, 0, 0), new Vec3(-1, 0, 0));
    const farGroup = await buildModelHoop(scene, farHoop);
    scene.remove(farGroup);
    g.add(farGroup);
    const farNet = new NetMesh(scene, farHoop); // assenta pendurada e fica parada
    scene.remove(farNet.mesh);
    g.add(farNet.mesh);

    // ---------------------------------------------------------------- volta da quadra
    // Lateral -y: mesa de anotação (3 módulos) no meio, transmissão atrás, bancos dos dois times dos lados.
    const tableY = -(HW + 2.1);
    for (const dx of [-2.65, 0, 2.65]) batch.add('mesa_anotacao', placeMatrix(C + dx, tableY, 0, 0, 1));
    const castY = -(HW + 3.4);
    for (const dx of [-1.3, 1.3]) {
      batch.add('mesa_transmissao', placeMatrix(C + dx, castY, 0, 0, 1));
      // Comentaristas num banco alto atrás da mesa (a origem do modelo é o apoio no assento).
      for (const sx of [-0.5, 0.5]) batch.add('comentarista_sentado', placeMatrix(C + dx + sx, castY - 0.78, 0.66, 0, 1));
    }
    // Bancos: duas fileiras de 2 módulos por time, do lado da mesa até perto da linha de fundo.
    for (const side of [-1, 1]) {
      const mx = (x: number) => (side < 0 ? x : 2 * C - x);
      for (const [x, y] of [
        [C - 6.4, -(HW + 2.7)],
        [C - 9.7, -(HW + 2.7)],
        [C - 6.4, -(HW + 3.7)],
        [C - 9.7, -(HW + 3.7)],
      ]) {
        batch.add('fileira_banco_time', placeMatrix(mx(x), y, 0, 0, 1));
      }
      batch.add('tecnico_terno_em_pe', placeMatrix(mx(C - 7.6), -(HW + 1.5), 0, side * 0.35, 1));
      batch.add('tecnico_assistente_em_pe', placeMatrix(mx(BL + 3.0), -(HW + 1.9), 0, side * 0.2, 1));
      batch.add('cooler_bebida', placeMatrix(mx(BL + 2.1), -(HW + 2.75), 0, 0, 1));
      batch.add('toalhas_dobradas', placeMatrix(mx(BL + 2.75), -(HW + 2.55), 0, 0, 1));
      batch.add('toalhas_dobradas', placeMatrix(mx(BL + 2.75), -(HW + 2.55), 0.22, 0.2, 1));
    }

    // Lateral +y: três fileiras VIP (a 2ª e a 3ª num degrau), com gente em ~75% dos lugares.
    const vipX = Array.from({ length: 8 }, (_, i) => C + (i - 3.5) * 3.05);
    const risers = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.9 });
    for (let row = 0; row < 3; row++) {
      const y = HW + 2.0 + row * 0.95;
      const z = row * 0.3;
      if (row > 0) {
        const riser = new THREE.Mesh(new THREE.BoxGeometry(8 * 3.05 + 0.4, z, 0.95), risers);
        riser.position.copy(toThree(new Vec3(C, y, z / 2)));
        riser.receiveShadow = true;
        g.add(riser);
      }
      for (const x of vipX) {
        batch.add('fileira_vip', placeMatrix(x, y, z, 0, -1));
        for (const sx of VipSeatX) {
          if (rand() > 0.75) continue;
          const variant = pick(VipWeights, rand());
          const s = variant === 7 ? 1 : 0.96 + rand() * 0.08;
          addPerson('vip', variant, placeMatrix(x - sx, y + 0.06, z + VipSeatHeight, (rand() - 0.5) * 0.3, -1, s));
        }
      }
    }

    // Sob as cestas: fotógrafos ajoelhados fora do garrafão, câmeras remotas no tripé, gente do apoio nos cantos.
    for (const end of [-1, 1]) {
      const bx = end < 0 ? BL : FBL;
      const inward = -end; // para dentro da quadra
      for (const y of [-5.6, -4.3, -3.0, 3.0, 4.3, 5.6]) {
        batch.add('fotografo_ajoelhado', placeMatrix(bx - inward * 0.9, y + (rand() - 0.5) * 0.2, 0, inward, -y * 0.04));
      }
      for (const y of [-6.8, 6.8]) batch.add('camera_fotografo', placeMatrix(bx - inward * 1.2, y, 0, inward, -y * 0.05));
      for (const y of [-(HW - 0.4), HW - 0.4]) {
        batch.add('camera_tv_tripe', placeMatrix(bx - inward * 2.2, y, 0, inward, -Math.sign(y) * 0.5));
      }
      batch.add('rack_bolas', placeMatrix(bx - inward * 1.4, -end * (HW + 1.0), 0, inward, 0));
      batch.add('ball_boy_em_pe', placeMatrix(bx - inward * 1.1, -end * (HW + 0.3), 0, inward, end * 0.3));
      batch.add('rodo_quadra', placeMatrix(bx - inward * 1.3, end * (HW + 0.7), 0, inward, 0));
      batch.add('seguranca_em_pe', placeMatrix(bx - inward * 3.6, HW + 3.2, 0, inward, -0.6));
      batch.add('seguranca_em_pe', placeMatrix(bx - inward * 3.6, -(HW + 3.4), 0, inward, 0.6));
    }
    for (const dx of [-13.4, 13.4]) batch.add('camera_tv_tripe', placeMatrix(C + dx, HW + 2.3, 0, -Math.sign(dx) * 0.4, -1));
    // Túnel dos jogadores: sai da arquibancada no canto do lado dos bancos.
    const tunnel = { x: BL - 4.9, y: -(HW + 2.6) };
    batch.add('tunel_jogadores', placeMatrix(tunnel.x, tunnel.y, 0, 1, 0));

    // ---------------------------------------------------------------- arquibancada
    // Anéis de blocos em volta da quadra, cada um um bloco mais para fora e 1,49 m mais alto. A frente do 1º anel fica
    // a 4,6 m das linhas de fundo e 5 m das laterais (cabe a volta da quadra).
    const hx0 = FBL + 4.6 - C;
    const hy0 = HW + 5.0;
    const r0 = 3.5;
    const blocks = new Map<string, THREE.Matrix4[]>();
    const chunkOf = (x: number, y: number): string => {
      const nx = (x - C) / (hx0 + 10);
      const ny = y / (hy0 + 10);
      return Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 'leste' : 'oeste') : ny > 0 ? 'norte' : 'sul';
    };
    const ringOffset = (k: number) => k * Ring.depth + (k >= Ring.upperFrom ? Ring.gapDepth : 0);
    const ringHeight = (k: number) => k * Ring.rise + (k >= Ring.upperFrom ? Ring.gapRise : 0);
    for (let k = 0; k < Ring.count; k++) {
      const off = ringOffset(k) + Block.depth / 2;
      const path = new RoundedRect(C, hx0 + off, hy0 + off, r0 + off);
      const n = Math.round(path.length / Block.width);
      const sx = path.length / n / Block.width;
      const z = ringHeight(k);
      const occupancy = k >= Ring.upperFrom ? 0.72 : 0.88;
      for (let i = 0; i < n; i++) {
        const p = path.at((i + 0.5) * (path.length / n));
        if (k === 0 && Math.hypot(p.x - tunnel.x, p.y - tunnel.y) < 4.2) continue; // o túnel passa por baixo
        const m = placeMatrix(p.x, p.y, z, -p.nx, -p.ny, 1, sx);
        const chunk = chunkOf(p.x, p.y);
        let list = blocks.get(chunk);
        if (!list) blocks.set(chunk, (list = []));
        list.push(m);
        // Torcida: cada lugar do bloco, no ponto do assento (a escala em X do bloco só afasta as cadeiras).
        const yaw = Math.atan2(-p.nx, -p.ny);
        const right = new Vec3(-p.ny, p.nx, 0); // eixo X do bloco no núcleo
        for (const row of BlockRows) {
          for (const seatX of BlockSeatX) {
            if (rand() > occupancy) continue;
            const along = seatX * sx;
            const depth = row.z - 0.06; // assento → quadril, um pouco para trás
            const wx = p.x + right.x * along - p.nx * depth;
            const wy = p.y + right.y * along - p.ny * depth;
            const variant = pick(StandWeights, rand());
            const s = variant === 7 ? 1 : 0.94 + rand() * 0.1;
            const jitter = (rand() - 0.5) * 0.35;
            addPerson(chunk, variant, placeMatrix(wx, wy, z + row.h, Math.sin(yaw + jitter), Math.cos(yaw + jitter), s));
          }
        }
      }
    }
    const blockSrc = await arenaMesh('bloco_arquibancada');
    for (const [chunk, list] of blocks) {
      const mesh = new THREE.InstancedMesh(blockSrc.geometry, blockSrc.material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      mesh.name = `arquibancada_${chunk}`;
      g.add(mesh);
    }

    // Recuo entre o anel de baixo e o de cima: passarela escura e a parede com a faixa de LED.
    const fasciaOff = ringOffset(Ring.upperFrom);
    const walkway = ringHeight(Ring.upperFrom - 1) + 3 * 0.5 + 0.02;
    const top = ringHeight(Ring.upperFrom);
    this.led = ledTexture();
    const ribbon = this.ringStrip(
      new RoundedRect(C, hx0 + fasciaOff, hy0 + fasciaOff, r0 + fasciaOff),
      top - 1.15,
      top - 0.05,
      new THREE.MeshBasicMaterial({ map: this.led, color: 0xb8b8b8, toneMapped: false }),
      12,
    );
    ribbon.name = 'faixa_led';
    g.add(ribbon);
    const wall = this.ringStrip(
      new RoundedRect(C, hx0 + fasciaOff + 0.02, hy0 + fasciaOff + 0.02, r0 + fasciaOff + 0.02),
      walkway,
      top,
      new THREE.MeshStandardMaterial({ color: 0x0c0d11, roughness: 0.9 }),
    );
    g.add(wall);
    const walkwayRing = this.ringFloor(C, hx0, hy0, r0, ringOffset(Ring.upperFrom - 1) + Block.depth, fasciaOff, walkway);
    g.add(walkwayRing);

    // Camarotes em cima do último anel, nas retas das laterais.
    const lastOff = ringOffset(Ring.count) + 1.4;
    for (const side of [-1, 1]) {
      const y = side * (hy0 + lastOff);
      for (let i = -3; i <= 3; i++) {
        batch.add('camarote_vip', placeMatrix(C + i * 4.9, y, ringHeight(Ring.count - 1) + 2.0, 0, -side));
      }
    }

    // Banners pendurados atrás das duas linhas de fundo, acima do último anel.
    const backX = hx0 + ringOffset(Ring.count) + 0.8;
    const bannerZ = ringHeight(Ring.count) + 0.9;
    for (const end of [-1, 1]) {
      [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5].forEach((y, i) => {
        const name = i % 2 === 0 ? 'banner_campeao' : 'banner_camisa';
        batch.add(name, placeMatrix(C + end * backX, y, bannerZ + (i % 2 === 0 ? 0 : 0.6), -end, 0));
      });
    }

    // Refletores no teto, virados para a quadra.
    const tilt = new THREE.Matrix4().makeRotationX(Math.PI * 0.36);
    for (const x of [-6, 2, 10, 18, 26, 32]) {
      for (const y of [-11, 11]) batch.add('refletor_teto', placeMatrix(x, y, 21, 0, -Math.sign(y)).multiply(tilt));
    }

    await batch.build(
      g,
      new Set(['mesa_anotacao', 'mesa_transmissao', 'fileira_banco_time', 'fileira_vip', 'cooler_bebida', 'rack_bolas',
        'tecnico_terno_em_pe', 'tecnico_assistente_em_pe', 'fotografo_ajoelhado', 'ball_boy_em_pe', 'comentarista_sentado']),
    );

    // ---------------------------------------------------------------- torcida
    for (const [key, list] of crowd) {
      const [chunk, variantText] = key.split('|');
      const src = await arenaMesh(CrowdNames[Number(variantText)]);
      const geometry = new THREE.BufferGeometry();
      geometry.index = src.geometry.index;
      for (const [name, attr] of Object.entries(src.geometry.attributes)) geometry.setAttribute(name, attr);
      const tints = new Float32Array(list.length * 2);
      list.forEach((p, i) => tints.set(p.tint, i * 2));
      geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 2));
      const material = (src.userData.crowdMaterial ??= crowdMaterial(src.material as THREE.Material));
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((p, i) => mesh.setMatrixAt(i, p.m));
      mesh.computeBoundingSphere();
      mesh.castShadow = chunk === 'vip';
      mesh.name = `torcida_${chunk}_${variantText}`;
      g.add(mesh);
    }

    // ---------------------------------------------------------------- telão central e o teto
    const screenTex = scoreboardTexture();
    const screen = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 0.6, metalness: 0.3 });
    const telao = new THREE.Group();
    telao.name = 'telao';
    const body = new THREE.Mesh(new THREE.BoxGeometry(8.4, 4.8, 6.4), [screen, screen, dark, dark, screen, screen]);
    telao.add(body);
    const bandTex = this.led.clone();
    bandTex.repeat.set(3, 1);
    const band = new THREE.MeshBasicMaterial({ map: bandTex, toneMapped: false });
    for (const y of [-2.75, 2.75]) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.6, 6.6), [band, band, dark, dark, band, band]);
      ring.position.y = y;
      telao.add(ring);
    }
    telao.position.set(C, 17, 0);
    g.add(telao);
    // Cabos do telão até o teto.
    const cable = new THREE.MeshBasicMaterial({ color: 0x050506 });
    for (const [x, z] of [[-3.8, -2.8], [3.8, -2.8], [-3.8, 2.8], [3.8, 2.8]] as const) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6.5, 4), cable);
      c.position.set(x, 3.05 + 3.25, z);
      telao.add(c);
    }

    // Ginásio: caixa escura grande (paredes e teto) no lugar da do Court.ts.
    const hall = new THREE.Mesh(
      new THREE.BoxGeometry(2 * (backX + 12), 27, 2 * (hy0 + ringOffset(Ring.count) + 12)),
      new THREE.MeshStandardMaterial({ color: 0x101218, roughness: 0.95, side: THREE.BackSide }),
    );
    hall.position.set(C, 13.49, 0);
    g.add(hall);

    // Luz na outra metade da quadra (o Court.ts só ilumina a do jogo).
    for (const [x, z] of [[19, -5], [19, 5], [25.5, 0]] as const) {
      const spot = new THREE.SpotLight(0xffffff, 140, 30, Math.PI / 5, 0.6, 1.6);
      spot.position.set(x, 14, z);
      spot.target.position.set(x, 0, z * 0.6);
      g.add(spot, spot.target);
    }

    scene.add(g);
  }

  /** Faixa vertical que acompanha o retângulo arredondado, virada para dentro (u = comprimento / tile). */
  private ringStrip(path: RoundedRect, z0: number, z1: number, material: THREE.Material, tile = 0): THREE.Mesh {
    const n = 220;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * path.length;
      const p = path.at(s);
      const a = toThree(new Vec3(p.x, p.y, z0));
      const b = toThree(new Vec3(p.x, p.y, z1));
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const u = tile > 0 ? s / tile : i / n;
      uv.push(u, 0, u, 1);
      if (i < n) {
        const k = i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    (material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
    return new THREE.Mesh(geo, material);
  }

  /** Anel horizontal entre dois afastamentos do retângulo arredondado (a passarela do recuo). */
  private ringFloor(cx: number, hx: number, hy: number, r: number, off0: number, off1: number, z: number): THREE.Mesh {
    const inner = new RoundedRect(cx, hx + off0, hy + off0, r + off0);
    const outer = new RoundedRect(cx, hx + off1, hy + off1, r + off1);
    const n = 400;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = inner.atSegment((i / n) * 8);
      const b = outer.atSegment((i / n) * 8);
      const pa = toThree(new Vec3(a.x, a.y, z));
      const pb = toThree(new Vec3(b.x, b.y, z));
      pos.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
      if (i < n) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.9, side: THREE.DoubleSide }));
  }
}
