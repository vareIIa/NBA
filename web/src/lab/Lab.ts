// Laboratório de animação (?lab=1): o jogo para de rodar sozinho e avança quadro a quadro, com entrada programada,
// para inspecionar cada drible ponto a ponto. Desenha 4 câmeras ao mesmo tempo (trás, lado, frente, cima), rastros da
// bola e das palmas, marcas dos pés quando apoiados, e mede a fluidez:
//  - pé deslizando: velocidade horizontal do pé enquanto ele está apoiado no chão (deveria ser ~0);
//  - estalos: aceleração angular dos ossos entre quadros (uma troca de pose brusca aparece como pico);
//  - bola fora da mão: distância entre o centro da bola presa e a palma (deveria ser ~1 raio).
import * as THREE from 'three';
import type { PlayerAnimator } from '../anim/PlayerAnimator';
import type { Freestyle } from '../game/Freestyle';
import type { InputState } from '../game/Input';

export interface LabMetrics {
  frames: number;
  footSlideMax: number; // m/s
  footSlideMean: number; // m/s (média nos quadros apoiados)
  plantedFrames: number;
  angularSpeedMax: number; // graus/s (maior osso)
  popCount: number; // quadros com aceleração angular acima do limiar
  popWorst: { bone: string; frame: number; degPerS2: number } | null;
  popFrames: Record<number, string[]>; // quadro -> ossos que estalaram nele
  ballGapMax: number; // m além de 1 raio, com a bola presa
  bounces: number;
  moves: string[];
  // Perna atravessando perna: menor folga entre as cápsulas das duas pernas (negativo = uma dentro da outra).
  legGapMin: number; // m
  legCrossFrames: number; // quadros com folga < -1 cm
  legCrossWorst: { pair: string; frame: number; depth: number } | null;
  // Base aberta demais (espacate): maior distância horizontal entre os tornozelos.
  stanceMax: number; // m
  // Pé no chão: menor altura dos vértices da sola (malha deformada); negativo = dentro do chão.
  soleMin: number; // m
  soleBelowFrames: number; // quadros com sola abaixo de -1 cm
  ankleMin: number; // m: menor altura do tornozelo
  // Bola no corpo: maior sobreposição da bola com as cápsulas do tronco e das pernas.
  ballBodyMax: number; // m
  ballBodyFrames: number; // quadros com sobreposição > 1 cm
  ballBodyWorst: { part: string; frame: number; depth: number; mode: string } | null;
  ballBodyByMode: Record<string, number>; // quadros com bola no corpo por estado da bola (presa / no ar)
  // Flicks (o que o olho vê como "pulo" ou "sumiço"): segunda diferença da posição entre quadros (m/s²). Um salto de
  // 4 cm num quadro já passa de 140 m/s²; o quadro do quique (a bola inverte no chão) não conta.
  ballKinkFrames: number; // bola mudando de trajetória de repente
  ballKinkMax: number;
  ballKinkWorst: { frame: number; accel: number; mode: string } | null;
  palmKinkFrames: number; // palma da mão da bola saltando
  palmKinkMax: number;
  bodyKinkFrames: number; // pelve (o corpo inteiro) saltando
  bodyKinkMax: number;
  yawKinkFrames: number; // giro do corpo (yaw da malha) mudando de repente
  nanFrames: number; // osso com matriz inválida: a malha some no quadro
  kinkFramesList: number[]; // quadros com qualquer flick (para abrir os prints certos)
  // Saltos (independente da frequência): um ponto do corpo ou a bola sai mais de 3 cm da trajetória num quadro (segunda
  // diferença da posição, em m). É o que o olho vê como "piscar"; o quique da bola não conta.
  snapFrames: number;
  snapMax: number; // m
  snapWorst: { frame: number; part: string; cm: number } | null;
  // Pé na ponta: quadros de apoio (ponta < 4,5 cm do chão) com o calcanhar > 3 cm acima do pé plano. Um passo tem um
  // pouco de calcanhar no ar no fim (heel-off, sequência curta); o errado é a ponta durante o apoio inteiro (sequência longa).
  supportFrames: number; // quadros de apoio (somando os dois pés)
  heelUpFrames: number; // desses, com o calcanhar > 3 cm acima do plano
  heelUpMax: number; // m: maior altura do calcanhar acima do plano no apoio
  heelRunMaxMs: number; // ms: maior sequência contínua de apoio na ponta (por pé)
}

/** Cápsula de um segmento do corpo: do osso `a` ao osso `b`; o raio sai da malha (mediana dos vértices do osso). */
interface Capsule {
  name: string;
  a: string;
  b: string;
  from: number; // fração do segmento onde a cápsula começa (as coxas se tocam junto ao quadril por anatomia)
  verts?: string[]; // ossos cujos vértices dão o raio (padrão: só `a`)
  r: number;
}
const CapsuleDefs: Omit<Capsule, 'r'>[] = [
  { name: 'coxa_l', a: 'thigh_l', b: 'calf_l', from: 0.3 },
  { name: 'canela_l', a: 'calf_l', b: 'foot_l', from: 0 },
  { name: 'pe_l', a: 'foot_l', b: 'ball_l', from: 0 },
  { name: 'coxa_r', a: 'thigh_r', b: 'calf_r', from: 0.3 },
  { name: 'canela_r', a: 'calf_r', b: 'foot_r', from: 0 },
  { name: 'pe_r', a: 'foot_r', b: 'ball_r', from: 0 },
  { name: 'quadril', a: 'pelvis', b: 'spine_02', from: 0, verts: ['spine_01'] }, // a pelve não tem vértices próprios
  { name: 'tronco', a: 'spine_02', b: 'neck_01', from: 0 },
];
const LegParts = ['coxa', 'canela', 'pe'];
const BodyParts = ['coxa_l', 'canela_l', 'coxa_r', 'canela_r', 'quadril', 'tronco'];
const SoleBones = new Set(['foot_l', 'ball_l', 'foot_r', 'ball_r']);
const LabBallRadius = 0.119;

/** Menor distância entre os segmentos p1-q1 e p2-q2 (Ericson, Real-Time Collision Detection, 5.1.9). */
function segmentDistance(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const c = d1.dot(r);
  const b = d1.dot(d2);
  const denom = a * e - b * b;
  let s = denom > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = THREE.MathUtils.clamp(-c / a, 0, 1);
  } else if (t > 1) {
    t = 1;
    s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

function pointSegmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq()), 0, 1);
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

const Views = [
  { name: 'trás (jogo)', kind: 'back' },
  { name: 'lado', kind: 'side' },
  { name: 'frente', kind: 'front' },
  { name: 'cima', kind: 'top' },
] as const;

const PopThreshold = 20000; // graus/s² num osso: acima disso a pose "salta" (Δω de 330°/s num quadro)
const WatchedBones = [
  'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head',
  'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r',
  'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r',
];

export class Lab {
  private clock: number;
  private readonly cameras = Views.map(() => new THREE.PerspectiveCamera(42, 16 / 9, 0.05, 100));
  private readonly trailBall: THREE.Vector3[] = [];
  private readonly trailR: THREE.Vector3[] = [];
  private readonly trailL: THREE.Vector3[] = [];
  private readonly lines: THREE.Line[] = [];
  private readonly footMarks = new THREE.Group();
  private prevShoot = false;
  private shootEdge = 0;
  private prevFoot = { l: new THREE.Vector3(), r: new THREE.Vector3() };
  private prevQ = new Map<string, THREE.Quaternion>();
  private prevW = new Map<string, number>();
  /** Últimas posições (mundo) da bola, da palma da bola e da pelve, e o yaw da malha: para os flicks. */
  private readonly hist = { ball: [] as THREE.Vector3[], palm: [] as THREE.Vector3[], body: [] as THREE.Vector3[], yaw: [] as number[], bounce: [] as boolean[] };
  /** Últimas posições (mundo) dos pontos vigiados para os saltos. */
  private readonly snapHist = new Map<string, THREE.Vector3[]>();
  private m: LabMetrics = Lab.emptyMetrics();
  private readonly labels: HTMLDivElement[] = [];
  private readonly flagsLabel = document.createElement('div');
  trails = true;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly game: Freestyle,
    private readonly animator: PlayerAnimator,
    private readonly forward: () => import('../sim').Vec3,
  ) {
    this.clock = performance.now() / 1000;
    const colors = [0xff8a1f, 0x44d4ff, 0xff4fd8];
    for (const color of colors) {
      const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, depthTest: false }));
      line.renderOrder = 10;
      line.frustumCulled = false;
      this.lines.push(line);
      scene.add(line);
    }
    scene.add(this.footMarks);
    for (const view of Views) {
      const label = document.createElement('div');
      label.textContent = view.name;
      label.style.cssText =
        'position:fixed;padding:2px 8px;font:700 12px system-ui;color:#fff;background:rgba(0,0,0,.55);border-radius:4px;z-index:5;pointer-events:none';
      document.body.appendChild(label);
      this.labels.push(label);
    }
    this.flagsLabel.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);padding:3px 10px;font:700 13px system-ui;color:#fff;background:rgba(0,0,0,.7);border-radius:4px;z-index:6;pointer-events:none;white-space:nowrap';
    document.body.appendChild(this.flagsLabel);
  }

  static emptyMetrics(): LabMetrics {
    return {
      frames: 0,
      footSlideMax: 0,
      footSlideMean: 0,
      plantedFrames: 0,
      angularSpeedMax: 0,
      popCount: 0,
      popWorst: null,
      popFrames: {},
      ballGapMax: 0,
      bounces: 0,
      moves: [],
      legGapMin: Infinity,
      legCrossFrames: 0,
      legCrossWorst: null,
      stanceMax: 0,
      soleMin: Infinity,
      soleBelowFrames: 0,
      ankleMin: Infinity,
      ballBodyMax: 0,
      ballBodyFrames: 0,
      ballBodyWorst: null,
      ballBodyByMode: {},
      ballKinkFrames: 0,
      ballKinkMax: 0,
      ballKinkWorst: null,
      palmKinkFrames: 0,
      palmKinkMax: 0,
      bodyKinkFrames: 0,
      bodyKinkMax: 0,
      yawKinkFrames: 0,
      nanFrames: 0,
      kinkFramesList: [],
      snapFrames: 0,
      snapMax: 0,
      snapWorst: null,
      supportFrames: 0,
      heelUpFrames: 0,
      heelUpMax: 0,
      heelRunMaxMs: 0,
    };
  }

  // Malha e cápsulas (montadas no primeiro quadro medido).
  private meshes: THREE.SkinnedMesh[] = [];
  private capsules: Capsule[] = [];
  private soleVerts: [THREE.SkinnedMesh, number][] = [];
  /** Estado do último quadro (para o letreiro do render). */
  private frameFlags = { legGap: 0, sole: 0, ballBody: 0, legPair: '', ballPart: '' };
  /** Quadros seguidos com o pé na ponta, por pé (para a sequência longa). */
  private heelRun = { l: 0, r: 0 };

  /** Vértices cujo maior peso é o osso dado (índices do osso pelo nome). */
  private verticesOf(names: Set<string>): [THREE.SkinnedMesh, number][] {
    return this.meshes.flatMap((mesh) => this.meshVerticesOf(mesh, names).map((v) => [mesh, v] as [THREE.SkinnedMesh, number]));
  }

  private meshVerticesOf(mesh: THREE.SkinnedMesh, names: Set<string>): number[] {
    const idx = mesh.geometry.getAttribute('skinIndex');
    const wts = mesh.geometry.getAttribute('skinWeight');
    const wanted = new Set(mesh.skeleton.bones.map((b, i) => (names.has(b.name) ? i : -1)).filter((i) => i >= 0));
    const out: number[] = [];
    for (let v = 0; v < idx.count; v++) {
      let best = -1;
      let bestW = 0;
      for (let k = 0; k < 4; k++) {
        const w = wts.getComponent(v, k);
        if (w > bestW) {
          bestW = w;
          best = idx.getComponent(v, k);
        }
      }
      if (wanted.has(best)) out.push(v);
    }
    return out;
  }

  private setupBody(): void {
    // O personagem tem várias malhas (cabeça, braços, pernas, pés...): os vértices de cada osso podem estar em qualquer uma.
    this.animator.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) this.meshes.push(o as THREE.SkinnedMesh);
    });
    this.animator.root.updateMatrixWorld(true);
    this.soleVerts = this.verticesOf(SoleBones);
    const p = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    this.capsules = CapsuleDefs.map((def) => {
      this.animator.bone(def.a).getWorldPosition(a);
      this.animator.bone(def.b).getWorldPosition(b);
      const dists = this.verticesOf(new Set(def.verts ?? [def.a]))
        .map(([mesh, v]) => pointSegmentDistance(mesh.localToWorld(mesh.getVertexPosition(v, p)), a, b))
        .sort((x, y) => x - y);
      // Mediana: a seção típica do membro (a ponta da articulação engorda a média).
      return { ...def, r: dists.length ? dists[Math.floor(dists.length / 2)] : 0.05 };
    });
  }

  private capsuleEnds(c: Capsule, a: THREE.Vector3, b: THREE.Vector3): void {
    this.animator.bone(c.a).getWorldPosition(a);
    this.animator.bone(c.b).getWorldPosition(b);
    if (c.from > 0) a.lerp(b, c.from);
  }

  /** Perna cruzando perna, sola abaixo do chão e bola dentro do corpo, neste quadro. */
  private measureBody(): void {
    const m = this.m;
    if (!this.meshes.length) this.setupBody();
    if (!this.meshes.length) return;
    this.animator.root.updateMatrixWorld(true);
    const ends = new Map<string, [THREE.Vector3, THREE.Vector3]>();
    for (const c of this.capsules) {
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      this.capsuleEnds(c, a, b);
      ends.set(c.name, [a, b]);
    }
    const cap = (name: string) => this.capsules.find((c) => c.name === name)!;
    // Pernas: cada parte da esquerda contra cada parte da direita.
    let legGap = Infinity;
    let legPair = '';
    for (const l of LegParts) {
      for (const r of LegParts) {
        const cl = cap(`${l}_l`);
        const cr = cap(`${r}_r`);
        const [al, bl] = ends.get(cl.name)!;
        const [ar, br] = ends.get(cr.name)!;
        const gap = segmentDistance(al, bl, ar, br) - cl.r - cr.r;
        if (gap < legGap) {
          legGap = gap;
          legPair = `${cl.name}/${cr.name}`;
        }
      }
    }
    m.legGapMin = Math.min(m.legGapMin, legGap);
    const ankleL = this.animator.bone('foot_l').getWorldPosition(new THREE.Vector3());
    const ankleR = this.animator.bone('foot_r').getWorldPosition(new THREE.Vector3());
    m.stanceMax = Math.max(m.stanceMax, Math.hypot(ankleL.x - ankleR.x, ankleL.z - ankleR.z));
    if (legGap < -0.01) {
      m.legCrossFrames++;
      if (!m.legCrossWorst || -legGap > m.legCrossWorst.depth)
        m.legCrossWorst = { pair: legPair, frame: m.frames, depth: +(-legGap).toFixed(3) };
    }
    // Sola: vértices do pé na malha deformada.
    const p = new THREE.Vector3();
    let sole = Infinity;
    for (const [mesh, v] of this.soleVerts) sole = Math.min(sole, mesh.localToWorld(mesh.getVertexPosition(v, p)).y);
    m.soleMin = Math.min(m.soleMin, sole);
    if (sole < -0.01) m.soleBelowFrames++;
    for (const side of ['l', 'r']) m.ankleMin = Math.min(m.ankleMin, this.animator.bone(`foot_${side}`).getWorldPosition(p).y);
    // Bola: sobreposição com tronco e pernas.
    const ball = this.game.ballMesh.position;
    let ballBody = 0;
    let ballPart = '';
    for (const name of BodyParts) {
      const c = cap(name);
      const [a, b] = ends.get(name)!;
      const depth = c.r + LabBallRadius - pointSegmentDistance(ball, a, b);
      if (depth > ballBody) {
        ballBody = depth;
        ballPart = name;
      }
    }
    m.ballBodyMax = Math.max(m.ballBodyMax, ballBody);
    if (ballBody > 0.01) {
      m.ballBodyFrames++;
      const mode = this.animator.ballHeldLocal ? 'procedural' : this.game.dribbler.mode;
      m.ballBodyByMode[mode] = (m.ballBodyByMode[mode] ?? 0) + 1;
      if (!m.ballBodyWorst || ballBody > m.ballBodyWorst.depth)
        m.ballBodyWorst = { part: ballPart, frame: m.frames, depth: +ballBody.toFixed(3), mode };
    }
    this.frameFlags = { legGap, sole, ballBody, legPair, ballPart };
  }

  /** Flicks: salto de posição entre quadros (segunda diferença) da bola, da palma da bola, da pelve e do yaw. */
  private measureKinks(dt: number): void {
    const m = this.m;
    const h = this.hist;
    const d = this.game.dribbler;
    const keep = <T>(list: T[], x: T) => {
      list.push(x);
      if (list.length > 3) list.shift();
    };
    keep(h.ball, this.game.ballMesh.position.clone());
    keep(h.palm, this.animator.palmWorld(d.ballHand(), new THREE.Vector3()));
    keep(h.body, this.animator.bone('pelvis').getWorldPosition(new THREE.Vector3()));
    const yawQ = this.animator.model.getWorldQuaternion(new THREE.Quaternion());
    keep(h.yaw, new THREE.Euler().setFromQuaternion(yawQ, 'YXZ').y);
    keep(h.bounce, d.bounces.length > 0);
    let bad = false;
    this.animator.root.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      if (!o.matrixWorld.elements.every(Number.isFinite)) bad = true;
    });
    if (bad) {
      m.nanFrames++;
      m.kinkFramesList.push(m.frames);
    }
    if (h.ball.length < 3) return;
    const accel = (list: THREE.Vector3[]) => list[2].clone().sub(list[1]).sub(list[1]).add(list[0]).length() / (dt * dt);
    let kink = false;
    // A bola no quique (este quadro ou o anterior) inverte de verdade: fica de fora. Só com a bola no drible.
    if (this.game.phase === 'dribble' && !h.bounce[1] && !h.bounce[2]) {
      const a = accel(h.ball);
      m.ballKinkMax = Math.max(m.ballKinkMax, a);
      if (a > 140) {
        m.ballKinkFrames++;
        kink = true;
        const mode = this.animator.ballHeldLocal ? 'procedural' : d.mode;
        if (!m.ballKinkWorst || a > m.ballKinkWorst.accel) m.ballKinkWorst = { frame: m.frames, accel: Math.round(a), mode };
      }
    }
    const pa = accel(h.palm);
    m.palmKinkMax = Math.max(m.palmKinkMax, pa);
    if (pa > 200) {
      m.palmKinkFrames++;
      kink = true;
    }
    const ba = accel(h.body);
    m.bodyKinkMax = Math.max(m.bodyKinkMax, ba);
    if (ba > 60) {
      m.bodyKinkFrames++;
      kink = true;
    }
    const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
    const yawAcc = Math.abs(wrap(h.yaw[2] - h.yaw[1]) - wrap(h.yaw[1] - h.yaw[0])) / (dt * dt);
    if (THREE.MathUtils.radToDeg(yawAcc) > 20000) {
      m.yawKinkFrames++;
      kink = true;
    }
    if (kink && m.kinkFramesList.length < 60) m.kinkFramesList.push(m.frames);
    // Saltos: segunda diferença em metros (não divide por dt²), para pontos que o olho acompanha.
    let snapped = false;
    const points: [string, THREE.Vector3][] = [
      ['pelve', h.body[2]],
      ['cabeça', this.animator.bone('head').getWorldPosition(new THREE.Vector3())],
      ['mão_e', this.animator.palmWorld('l', new THREE.Vector3())],
      ['mão_d', this.animator.palmWorld('r', new THREE.Vector3())],
      ['pé_e', this.animator.bone('foot_l').getWorldPosition(new THREE.Vector3())],
      ['pé_d', this.animator.bone('foot_r').getWorldPosition(new THREE.Vector3())],
      ['joelho_e', this.animator.bone('calf_l').getWorldPosition(new THREE.Vector3())],
      ['joelho_d', this.animator.bone('calf_r').getWorldPosition(new THREE.Vector3())],
    ];
    points.push(['bola', h.ball[2]]);
    // A bola no quique (quadro atual, anterior ou o seguinte ao chão) e fora do drible não conta, mas entra no histórico.
    const ballSkip = this.game.phase !== 'dribble' || h.bounce[1] || h.bounce[2];
    for (const [part, pos] of points) {
      let list = this.snapHist.get(part);
      if (!list) this.snapHist.set(part, (list = []));
      list.push(pos.clone());
      if (list.length > 3) list.shift();
      if (list.length < 3 || (part === 'bola' && ballSkip)) continue;
      const d = list[2].clone().sub(list[1]).sub(list[1]).add(list[0]).length();
      m.snapMax = Math.max(m.snapMax, d);
      if (d > 0.03) {
        snapped = true;
        if (!m.snapWorst || d * 100 > m.snapWorst.cm) m.snapWorst = { frame: m.frames, part, cm: +(d * 100).toFixed(1) };
      }
    }
    if (snapped) m.snapFrames++;
  }

  /** Raios das cápsulas medidos na malha (para conferir). */
  capsuleRadii(): Record<string, number> {
    if (!this.meshes.length) this.setupBody();
    return Object.fromEntries(this.capsules.map((c) => [c.name, +c.r.toFixed(3)]));
  }

  /** Zera métricas e rastros (o jogador continua onde está). */
  resetMetrics(): void {
    this.m = Lab.emptyMetrics();
    this.trailBall.length = 0;
    this.trailR.length = 0;
    this.trailL.length = 0;
    this.footMarks.clear();
    this.prevQ.clear();
    this.prevW.clear();
    for (const list of Object.values(this.hist)) list.length = 0;
    this.snapHist.clear();
    this.heelRun = { l: 0, r: 0 };
  }

  metrics(): LabMetrics {
    return {
      ...this.m,
      footSlideMean: this.m.plantedFrames ? this.m.footSlideMean / this.m.plantedFrames : 0,
      moves: [...this.game.moves],
    };
  }

  /**
   * Frequência da simulação (Hz). Os cenários contam quadros de 1/60 s; com 144 Hz cada um vira 2,4 passos de 1/144 s
   * (monitor de 144 Hz, onde o jogo roda com dt de 7 ms), com 30 Hz meio passo de 1/30 s.
   */
  hz = 60;
  private hzDebt = 0;

  /** Avança n quadros de 1/60 s com a entrada dada (campos omitidos = soltos). */
  step(n: number, partial: Partial<InputState> = {}): void {
    const dt = 1 / this.hz;
    this.hzDebt += (n * this.hz) / 60;
    const steps = Math.floor(this.hzDebt + 1e-9);
    this.hzDebt -= steps;
    for (let i = 0; i < steps; i++) {
      this.clock += dt;
      const shoot = partial.shoot ?? false;
      if (shoot !== this.prevShoot) this.shootEdge = this.clock;
      this.prevShoot = shoot;
      const input: InputState = {
        moveX: 0,
        moveY: 0,
        proX: 0,
        proY: 0,
        shoot,
        shootEdgeTime: this.shootEdge,
        sprint: false,
        protect: false,
        gamepadConnected: false,
        ...partial,
      };
      input.shootEdgeTime = this.shootEdge;
      this.game.update(this.clock, dt, input, this.forward());
      this.measure(dt);
    }
  }

  private measure(dt: number): void {
    const m = this.m;
    m.frames++;
    const v = new THREE.Vector3();
    // Pés apoiados: ponta do pé (ball_*) a menos de 6 cm do chão.
    for (const side of ['l', 'r'] as const) {
      const toe = this.animator.bone(`ball_${side}`).getWorldPosition(new THREE.Vector3());
      const heel = this.animator.bone(`foot_${side}`).getWorldPosition(new THREE.Vector3());
      const planted = toe.y < 0.045 && heel.y < 0.12;
      const prev = this.prevFoot[side];
      if (planted && m.frames > 1) {
        const slide = Math.hypot(toe.x - prev.x, toe.z - prev.z) / dt;
        m.footSlideMax = Math.max(m.footSlideMax, slide);
        m.footSlideMean += slide;
        m.plantedFrames++;
        if (this.trails && m.frames % 3 === 0) {
          const mark = new THREE.Mesh(
            new THREE.CircleGeometry(0.035, 10),
            new THREE.MeshBasicMaterial({ color: slide > 0.5 ? 0xff3030 : side === 'l' ? 0x44d4ff : 0xff4fd8 }),
          );
          mark.rotation.x = -Math.PI / 2;
          mark.position.set(toe.x, 0.004, toe.z);
          this.footMarks.add(mark);
          if (this.footMarks.children.length > 120) this.footMarks.remove(this.footMarks.children[0]);
        }
      }
      prev.copy(toe);
      // Pé na ponta: só conta com o pé de apoio (ponta < 4,5 cm); a sequência zera quando o pé sai do chão ou assenta.
      const support = toe.y < 0.045;
      const rise = support ? this.animator.footHeelRise(side) : 0;
      if (support) {
        m.supportFrames++;
        m.heelUpMax = Math.max(m.heelUpMax, rise);
      }
      if (support && rise > 0.03) {
        m.heelUpFrames++;
        this.heelRun[side]++;
        m.heelRunMaxMs = Math.max(m.heelRunMaxMs, (this.heelRun[side] * dt * 1000));
      } else this.heelRun[side] = 0;
    }
    // Estalos: aceleração angular de cada osso (mundo).
    const q = new THREE.Quaternion();
    for (const name of WatchedBones) {
      this.animator.bone(name).getWorldQuaternion(q);
      const prevQ = this.prevQ.get(name);
      if (prevQ) {
        const angle = 2 * Math.acos(Math.min(1, Math.abs(prevQ.dot(q))));
        const w = THREE.MathUtils.radToDeg(angle) / dt;
        m.angularSpeedMax = Math.max(m.angularSpeedMax, w);
        const prevW = this.prevW.get(name);
        if (prevW !== undefined) {
          const acc = Math.abs(w - prevW) / dt;
          if (acc > PopThreshold) {
            m.popCount++;
            (m.popFrames[m.frames] ??= []).push(name);
            if (!m.popWorst || acc > m.popWorst.degPerS2) m.popWorst = { bone: name, frame: m.frames, degPerS2: Math.round(acc) };
          }
        }
        this.prevW.set(name, w);
        prevQ.copy(q);
      } else {
        this.prevQ.set(name, q.clone());
      }
    }
    // Bola presa: distância até a palma.
    const d = this.game.dribbler;
    if (this.game.phase === 'dribble' && d.mode === 'held' && !this.animator.ballHeldLocal) {
      const palm = this.animator.palmWorld(d.ballHand(), v);
      m.ballGapMax = Math.max(m.ballGapMax, Math.max(0, palm.distanceTo(d.position) - 0.13));
    }
    m.bounces += d.bounces.length;
    this.measureKinks(dt);
    this.measureBody();
    // Rastros.
    const push = (list: THREE.Vector3[], p: THREE.Vector3) => {
      list.push(p.clone());
      if (list.length > 90) list.shift();
    };
    push(this.trailBall, this.game.ballMesh.position);
    push(this.trailR, this.animator.palmWorld('r', v));
    push(this.trailL, this.animator.palmWorld('l', v));
  }

  /**
   * Desenha uma vista só, na tela inteira e sem rastros nem letreiros (vídeos do laboratório: tools/video-lab.mjs).
   * 'jogo' usa a câmera do jogo (a que o diretor vê).
   */
  renderSingle(kind: 'jogo' | 'back' | 'side' | 'front' | 'top', gameCamera: THREE.Camera): void {
    for (const line of this.lines) line.visible = false;
    this.footMarks.visible = false;
    for (const label of this.labels) label.style.display = 'none';
    this.flagsLabel.style.display = 'none';
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, size.x, size.y);
    if (kind === 'jogo') {
      this.renderer.render(this.scene, gameCamera);
      return;
    }
    const cam = this.cameras[0];
    cam.aspect = size.x / size.y;
    cam.updateProjectionMatrix();
    this.placeCamera(cam, kind);
    this.renderer.render(this.scene, cam);
  }

  private placeCamera(cam: THREE.PerspectiveCamera, kind: 'back' | 'side' | 'front' | 'top'): void {
    const root = this.animator.root;
    const pos = root.position;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion);
    const target = pos.clone().add(new THREE.Vector3(0, 0.8, 0));
    cam.up.set(0, 1, 0);
    if (kind === 'back') cam.position.copy(pos).addScaledVector(fwd, -3.6).add(new THREE.Vector3(0, 1.9, 0));
    if (kind === 'side') cam.position.copy(pos).addScaledVector(left, -3.4).add(new THREE.Vector3(0, 1.0, 0));
    if (kind === 'front') cam.position.copy(pos).addScaledVector(fwd, 3.6).add(new THREE.Vector3(0, 1.2, 0));
    if (kind === 'top') cam.position.copy(pos).add(new THREE.Vector3(0, 5.2, 0)).addScaledVector(fwd, -0.01);
    if (kind === 'top') cam.up.copy(fwd);
    cam.lookAt(kind === 'top' ? pos : target);
  }

  /** Desenha as 4 vistas lado a lado (2 x 2) no canvas do jogo. */
  render(): void {
    const lists = [this.trailBall, this.trailR, this.trailL];
    this.lines.forEach((line, i) => {
      line.visible = this.trails;
      line.geometry.setFromPoints(lists[i]);
    });
    const size = this.renderer.getSize(new THREE.Vector2());
    const w = Math.floor(size.x / 2);
    const h = Math.floor(size.y / 2);
    for (const label of this.labels) label.style.display = '';
    this.flagsLabel.style.display = '';
    this.footMarks.visible = true;
    this.renderer.setScissorTest(true);
    Views.forEach((view, i) => {
      const cam = this.cameras[i];
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      const x = (i % 2) * w;
      const y = i < 2 ? h : 0; // three conta o viewport de baixo para cima
      this.placeCamera(cam, view.kind);
      this.renderer.setViewport(x, y, w, h);
      this.renderer.setScissor(x, y, w, h);
      this.renderer.render(this.scene, cam);
      const label = this.labels[i];
      label.style.left = `${x + 8}px`;
      label.style.top = `${(i < 2 ? 0 : h) + 8}px`;
    });
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, size.x, size.y);
    // Letreiro do quadro: vermelho quando a perna cruza, a sola entra no chão ou a bola entra no corpo.
    const f = this.frameFlags;
    const cm = (x: number) => `${(x * 100).toFixed(0)} cm`;
    const tag = (bad: boolean, text: string) => `<span style="color:${bad ? '#ff4040' : '#7dff8a'}">${text}</span>`;
    this.flagsLabel.innerHTML = [
      `q${this.m.frames}`,
      tag(f.legGap < -0.01, `pernas ${cm(f.legGap)}`),
      tag(f.sole < -0.01, `sola ${cm(f.sole)}`),
      tag(f.ballBody > 0.01, `bola-corpo ${cm(f.ballBody)}${f.ballBody > 0.01 ? ` (${f.ballPart})` : ''}`),
    ].join(' &nbsp; ');
  }
}
