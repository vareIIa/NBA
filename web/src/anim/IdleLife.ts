// Vida do jogador parado sem bola (em cima do IdleStand do Mixamo): braços soltos e um pouco afastados do corpo, a
// respiração, e de tempos em tempos um gesto de jogador esperando a bola — mãos na cintura, sacudir os braços, bater
// palmas, esfregar as mãos, ajustar a bermuda, alongar o braço, olhar em volta. Parado com os braços colados ao corpo o
// boneco parecia um manequim (diretor, 2026-10-16).
// Mãos por IK (o reachPalm do animador) para alvos no referencial do corpo; cabeça por rotação no mundo.
import * as THREE from 'three';

type Side = 'l' | 'r';

export interface IdleRig {
  bone(name: string): THREE.Bone;
  reachPalm(hand: Side, target: THREE.Vector3, weight: number, pole: THREE.Vector3): void;
  /** Gira a mão no punho para os dedos apontarem para `dir` (mundo), com peso. */
  aimHand(hand: Side, dir: THREE.Vector3, weight: number): void;
  readonly root: THREE.Object3D;
}

/** Alvo de uma mão no referencial do corpo: x = para fora (lado da mão), y = altura (m), z = frente (m). */
type Palm = [number, number, number];
interface Pose {
  l: Palm;
  r: Palm;
  /** Cotovelo: 'back' (braço solto), 'out' (mãos na cintura), 'down' (mãos à frente do corpo). */
  elbow: 'back' | 'out' | 'down';
  /** Cabeça (graus): giro para a esquerda (+) e para cima (+). */
  headYaw?: number;
  headPitch?: number;
}

interface Gesture {
  name: string;
  duration: number;
  /** Pose no instante u (s desde o começo do gesto). */
  pose(u: number): Pose;
}

/**
 * Braços soltos: mãos ao lado das coxas, por fora da bermuda e um pouco à frente (cotovelo levemente dobrado). Com 0,3 m
 * para o lado e 6 cm à frente a mão sumia dentro da perna da bermuda (que é mais larga que a coxa do boneco).
 */
const Rest = { x: 0.33, y: 0.82, z: 0.08 };
const rest = (dx = 0, dy = 0, dz = 0): Palm => [Rest.x + dx, Rest.y + dy, Rest.z + dz];

const Gestures: Gesture[] = [
  {
    name: 'mãos na cintura',
    duration: 3.4,
    // Na cintura (crista do quadril, ~56% da altura), não na barra da regata: a 1,0 m a mão ficava pendurada no pano com o
    // punho caído. A colisão dos braços (ArmClearance) encosta a mão na regata; os dedos apontam para a frente e para baixo.
    pose: () => ({ l: [0.2, 1.1, -0.01], r: [0.2, 1.1, -0.01], elbow: 'out' }),
  },
  {
    name: 'sacudir os braços',
    duration: 1.5,
    pose: (u) => {
      const s = Math.sin(u * Math.PI * 2 * 6.5) * 0.045;
      const c = Math.cos(u * Math.PI * 2 * 5.5) * 0.035;
      return { l: rest(0.02 + c, 0.02, s), r: rest(0.02 - c, 0.02, -s), elbow: 'back' };
    },
  },
  {
    name: 'bater palmas',
    duration: 1.7,
    pose: (u) => {
      // Três palmas: as mãos se encontram na frente do peito (1,34 m; a 1,18 m batiam na frente do umbigo).
      const open = 0.5 + 0.5 * Math.cos(Math.min(1, u / 1.3) * Math.PI * 2 * 3);
      const x = 0.035 + 0.13 * open;
      return { l: [x, 1.34, 0.34], r: [x, 1.34, 0.34], elbow: 'down', headPitch: -4 };
    },
  },
  {
    name: 'esfregar as mãos',
    duration: 1.9,
    pose: (u) => {
      const a = u * Math.PI * 2 * 2.2;
      return { l: [0.04 + 0.02 * Math.sin(a), 1.3, 0.32 + 0.03 * Math.cos(a)], r: [0.04 - 0.02 * Math.sin(a), 1.3, 0.32 - 0.03 * Math.cos(a)], elbow: 'down', headPitch: -6 };
    },
  },
  {
    name: 'ajustar a bermuda',
    duration: 1.6,
    pose: (u) => {
      const tug = Math.max(0, Math.sin(Math.min(1, u / 1.2) * Math.PI * 2 * 2)) * 0.035;
      return { l: [0.21, 1.0 + tug, 0.12], r: [0.21, 1.0 + tug, 0.12], elbow: 'out', headPitch: -10 };
    },
  },
  {
    name: 'alongar o braço',
    duration: 2.6,
    pose: (u) => {
      // Braço direito cruzado na frente do peito, a mão esquerda puxando pelo cotovelo; na segunda metade, o outro.
      const right = u < 1.3;
      // Na altura do peito e à frente dele: com o braço a 1,28 m e 16 cm à frente, o antebraço entrava 4 cm no peito.
      const cross: Palm = [-0.2, 1.38, 0.27];
      const pull: Palm = [0, 1.3, 0.36];
      return right ? { r: cross, l: pull, elbow: 'down' } : { l: cross, r: pull, elbow: 'down' };
    },
  },
  {
    name: 'olhar em volta',
    duration: 3.2,
    pose: (u) => ({ l: rest(), r: rest(), elbow: 'back', headYaw: 32 * Math.sin((u / 3.2) * Math.PI * 2), headPitch: 3 }),
  },
];

/** Entrada e saída de cada gesto (s). */
const GestureBlend = 0.38;
/** Quanto a mão sai para a frente (m) no meio da ida e da volta dos gestos à frente do corpo. */
const TransitionArc = 0.14;
/** Intervalo entre gestos (s). */
const GapMin = 1.2;
const GapMax = 3.2;

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export class IdleLife {
  /** Peso da camada (sobe parado sem bola, desce ao andar ou pegar a bola). */
  private w = 0;
  private clock = 0;
  private gesture: Gesture | null = null;
  private gestureT = 0;
  private nextAt = 2;
  private lastIndex = -1;
  private seed = 12345;
  /** Último gesto (para o laboratório). */
  current = '';

  /**
   * Eixos da mão no espaço local do hand_*, tirados do bind (braços em T, palmas para baixo): dedos = para fora do corpo,
   * palma = para baixo. A malha da mão inteira segue o hand_*; o osso fingers_* é filho do palm_*, que nos clipes da CMU
   * gira até 175° (dado ruim), e o thumb_* fica quase na linha dos dedos: mirar por eles entortava a mão visível.
   */
  private readonly handAxes: Record<Side, { fingers: THREE.Vector3; palm: THREE.Vector3 }>;

  constructor(private readonly rig: IdleRig) {
    rig.root.updateMatrixWorld(true);
    const rootQ = rig.root.getWorldQuaternion(new THREE.Quaternion());
    const axes = (side: Side) => {
      const inv = rig.bone(`hand_${side}`).getWorldQuaternion(new THREE.Quaternion()).invert();
      const out = new THREE.Vector3(side === 'l' ? 1 : -1, 0, 0).applyQuaternion(rootQ); // +x do jogador = esquerda
      const down = new THREE.Vector3(0, -1, 0);
      return { fingers: out.applyQuaternion(inv).normalize(), palm: down.applyQuaternion(inv).normalize() };
    };
    this.handAxes = { l: axes('l'), r: axes('r') };
  }

  /**
   * Orienta a mão inteira (não só a direção dos dedos): dedos para `fingersDir` e palma para `palmDir` (mundo), com
   * peso. Sem o giro em volta dos dedos a palma ficava virada para fora e a mão parecia quebrada no punho.
   */
  private orientHand(side: Side, fingersDir: THREE.Vector3, palmDir: THREE.Vector3, weight: number): void {
    if (weight <= 1e-3) return;
    const hand = this.rig.bone(`hand_${side}`);
    const ax = this.handAxes[side];
    const basis = (f: THREE.Vector3, t: THREE.Vector3) => {
      const x = f.clone().normalize();
      const y = t.clone().addScaledVector(x, -t.dot(x)).normalize();
      return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y));
    };
    const local = basis(ax.fingers, ax.palm);
    const world = basis(fingersDir, palmDir);
    // R leva os eixos locais da mão aos alvos no mundo: R = W · Lᵀ (bases ortonormais).
    const want = new THREE.Quaternion().setFromRotationMatrix(world.multiply(local.transpose()));
    const cur = hand.getWorldQuaternion(new THREE.Quaternion());
    cur.slerp(want, Math.min(1, weight));
    hand.quaternion.copy(hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(cur));
    hand.updateWorldMatrix(false, true);
  }

  private random(): number {
    // LCG: determinístico (o laboratório repete igual), sem depender do Math.random.
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Avança o tempo e o peso; `active` = parado sem bola, sem ação. */
  update(dt: number, active: boolean): void {
    this.w += ((active ? 1 : 0) - this.w) * (1 - Math.exp(-(active ? 4 : 10) * dt));
    if (this.w < 1e-3) {
      // Saiu do parado: o próximo começa sem gesto e espera um pouco.
      this.gesture = null;
      this.current = '';
      this.nextAt = this.clock + 1.5;
    }
    this.clock += dt;
    if (!active) return;
    if (this.gesture) {
      this.gestureT += dt;
      if (this.gestureT >= this.gesture.duration) {
        this.gesture = null;
        this.current = '';
        this.nextAt = this.clock + GapMin + (GapMax - GapMin) * this.random();
      }
    } else if (this.clock >= this.nextAt) {
      let i = Math.floor(this.random() * Gestures.length);
      if (i === this.lastIndex) i = (i + 1) % Gestures.length;
      this.lastIndex = i;
      this.gesture = Gestures[i];
      this.gestureT = 0;
      this.current = this.gesture.name;
    }
  }

  /** Nomes dos gestos (laboratório). */
  static gestureNames(): string[] {
    return Gestures.map((g) => g.name);
  }

  /** Começa o gesto `name` agora (laboratório: validar um por um). Falso se o nome não existe. */
  start(name: string): boolean {
    const i = Gestures.findIndex((g) => g.name === name);
    if (i < 0) return false;
    this.lastIndex = i;
    this.gesture = Gestures[i];
    this.gestureT = 0;
    this.current = name;
    return true;
  }

  /** Aplica braços e cabeça. Chamar por último entre os IKs dos braços. */
  apply(): void {
    if (this.w < 1e-3) return;
    const rig = this.rig;
    const q = rig.root.quaternion;
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0);
    // Respiração e um balanço lento dos braços: nunca parado de todo.
    const breath = Math.sin(this.clock * Math.PI * 2 * 0.24);
    const sway = Math.sin(this.clock * Math.PI * 2 * 0.13);
    const base: Pose = { l: rest(0.005 * sway, 0.008 * breath, 0.012 * sway), r: rest(-0.005 * sway, 0.008 * breath, -0.012 * sway), elbow: 'back' };
    let pose = base;
    let k = 0;
    if (this.gesture) {
      const u = this.gestureT;
      k = smooth(u / GestureBlend) * smooth((this.gesture.duration - u) / GestureBlend);
      pose = this.gesture.pose(u);
    }
    for (const side of ['l', 'r'] as const) {
      const out = side === 'l' ? 1 : -1; // +x do jogador = esquerda
      const a = base[side];
      const b = pose[side];
      const p = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      // Mãos que vão para a frente do corpo fazem um arco para a frente na ida e na volta: em linha reta, a mão que ia da
      // coxa para o ombro oposto (alongar o braço) cortava a frente do quadril.
      if (pose.elbow === 'down') p[2] += TransitionArc * 4 * k * (1 - k);
      // Alvos medidos no boneco (1,86 m): a altura da build escala o root (setBodyScale) e eles acompanham, senão num
      // jogador de 2,24 m as palmas batiam na frente da barriga.
      const scale = rig.root.scale.y;
      const target = rig.root.position.clone().addScaledVector(left, out * p[0] * scale).addScaledVector(up, p[1] * scale).addScaledVector(fwd, p[2] * scale);
      const elbow = k > 0.5 ? pose.elbow : 'back';
      const side3 = left.clone().multiplyScalar(out);
      const pole =
        elbow === 'out'
          ? side3.clone().multiplyScalar(0.85).addScaledVector(fwd, -0.45).normalize()
          : elbow === 'down'
            ? up.clone().multiplyScalar(-0.75).addScaledVector(side3, 0.55).normalize()
            : fwd.clone().multiplyScalar(-0.85).addScaledVector(side3, 0.35).addScaledVector(up, -0.2).normalize();
      rig.reachPalm(side, target, this.w, pole);
      if (pose.elbow === 'out' && k > 0) {
        // Mão na cintura: palma apoiada no quadril (virada para o corpo), dedos para a frente e para baixo.
        const fingers = fwd.clone().multiplyScalar(0.75).addScaledVector(up, -0.6).addScaledVector(side3, -0.1).normalize();
        const palm = side3.clone().negate();
        this.orientHand(side, fingers, palm, this.w * k);
      }
    }
    // Cabeça: gira e inclina no mundo (pescoço e cabeça dividem o movimento).
    const yaw = THREE.MathUtils.degToRad(((pose.headYaw ?? 0) * k) / 2) * this.w;
    const pitch = THREE.MathUtils.degToRad(((pose.headPitch ?? 0) * k - 1.5 * breath) / 2) * this.w;
    if (Math.abs(yaw) + Math.abs(pitch) < 1e-5) return;
    const turn = new THREE.Quaternion().setFromAxisAngle(up, yaw).multiply(new THREE.Quaternion().setFromAxisAngle(left, -pitch));
    for (const name of ['neck_01', 'head']) {
      const bone = rig.bone(name);
      const world = bone.getWorldQuaternion(new THREE.Quaternion());
      const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(parent.invert().multiply(turn.clone().multiply(world)));
      bone.updateWorldMatrix(false, true);
    }
  }
}
