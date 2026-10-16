// Braço nunca atravessa o tronco nem a roupa (diretor, 2026-10-16: "nenhuma animação deveria fazer isso").
//
// Último passo dos braços, depois de todos os IKs: o tronco, o quadril e (sem bola) as coxas viram cilindros de seção
// elíptica que acompanham os ossos, com o tamanho medido nas malhas que o jogador veste (corpo + regata + bermuda). Se o
// cotovelo ou o meio do braço entra, o braço gira no ombro para fora; se o antebraço, o punho ou a mão entram, o antebraço
// gira no cotovelo. Só age quando há penetração, e a saída é suave (sem degrau quando o braço encosta).
import * as THREE from 'three';

type Side = 'l' | 'r';

export interface ArmClearanceRig {
  bone(name: string): THREE.Bone;
  /** Escala do jogador no mundo (o showroom do menu põe a altura da build): as medidas acompanham. */
  scale(): number;
}

/** Cilindro elíptico preso aos ossos: eixo de a até b; seção no referencial (esquerda, frente) do corpo. */
interface Collider {
  name: string;
  /** Pontas do eixo no mundo, na pose atual. */
  ends(a: THREE.Vector3, b: THREE.Vector3): void;
  /** Esquerda do corpo (mundo); a frente sai de esquerda x eixo. */
  left(out: THREE.Vector3): THREE.Vector3;
  /** Ossos cujos vértices medem a seção (o peso dominante do vértice precisa ser de um deles). */
  fitBones: RegExp;
  /** Só sem bola (as coxas brigariam com a mão do entre as pernas). */
  freeOnly?: boolean;
  // Medidos em fit() (m): centro e semieixos da seção.
  cx: number;
  cz: number;
  rx: number;
  rz: number;
}

/** Raio do próprio membro em cada ponto testado (m): braço, antebraço, punho, mão. */
const LimbRadius = { elbow: 0.05, upperMid: 0.055, forearmMid: 0.045, wrist: 0.035, hand: 0.03 };
/** Folga (fração do semieixo) em que o empurrão começa, para a saída ser suave. */
const Band = 0.12;
/** Constante de tempo (s) com que a correção do braço entra e sai. */
const ArmSmoothTau = 0.06;
/** Fração do comprimento do eixo em que o cilindro some nas pontas (sem degrau ao passar da ponta). */
const EndFade = 0.15;

const v = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const ax = new THREE.Vector3();
const lat = new THREE.Vector3();
const fwd = new THREE.Vector3();
const q = new THREE.Quaternion();
const qp = new THREE.Quaternion();

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class ArmClearance {
  private readonly colliders: Collider[];
  /** Quanto cada braço foi empurrado no último quadro (m, diagnóstico do laboratório). */
  readonly pushed = { l: 0, r: 0 };
  /** Escala do jogador quando as medidas foram tiradas. */
  private fitScale = 1;

  constructor(private readonly rig: ArmClearanceRig) {
    const P = (n: string, out: THREE.Vector3) => rig.bone(n).getWorldPosition(out);
    const t = new THREE.Vector3(); // temporário próprio (o `v` do módulo está em uso quando estas funções rodam)
    const shoulders = (out: THREE.Vector3) => P('upperarm_l', out).sub(P('upperarm_r', t));
    const hips = (out: THREE.Vector3) => P('thigh_l', out).sub(P('thigh_r', t));
    this.colliders = [
      {
        // Barriga e peito: da pelve até um pouco acima da spine_03 (abaixo da axila: o ombro fica de fora).
        name: 'tronco',
        ends: (A, B) => {
          P('pelvis', A);
          P('spine_03', B);
          B.lerp(P('neck_01', t), 0.25);
        },
        left: shoulders,
        fitBones: /^(pelvis|spine_0[1-3]|pano_[BFLR]$)/, // pano_F/B/L/R: barra da regata
        cx: 0, cz: 0, rx: 0.17, rz: 0.13,
      },
      {
        // Quadril e a parte de cima da bermuda: do gancho até a pelve.
        name: 'quadril',
        ends: (A, B) => {
          P('thigh_l', A).add(P('thigh_r', t)).multiplyScalar(0.5);
          P('pelvis', B);
          A.addScaledVector(B.clone().sub(A).normalize(), -0.1);
        },
        left: hips,
        fitBones: /^(pelvis|spine_01|thigh_|pano_)/, // todos os panos: barra da regata e pernas da bermuda
        cx: 0, cz: 0, rx: 0.19, rz: 0.14,
      },
      ...(['l', 'r'] as const).map(
        (s): Collider => ({
          // Coxa com a perna da bermuda (até 60% do caminho para o joelho).
          name: `coxa_${s}`,
          ends: (A, B) => {
            P(`thigh_${s}`, A);
            P(`calf_${s}`, B);
            B.lerp(A, 0.4);
          },
          left: hips,
          fitBones: new RegExp(`^(thigh_${s}|pano_[BF]_${s})$`), // a perna da bermuda
          freeOnly: true,
          cx: 0, cz: 0, rx: 0.1, rz: 0.1,
        }),
      ),
    ];
  }

  /**
   * Mede a seção de cada cilindro nas malhas (pose atual): vértices cujo osso dominante é do tronco/quadril/coxa e que
   * caem dentro do comprimento do eixo. Semieixos e centro pelos percentis 3% e 97% (uma ponta solta não manda).
   */
  fit(meshes: THREE.SkinnedMesh[]): void {
    this.fitScale = this.rig.scale();
    for (const c of this.colliders) {
      c.ends(a, b);
      const len = ax.subVectors(b, a).length();
      if (len < 1e-4) continue;
      ax.divideScalar(len);
      c.left(lat);
      lat.addScaledVector(ax, -lat.dot(ax)).normalize();
      fwd.crossVectors(lat, ax);
      const xs: number[] = [];
      const zs: number[] = [];
      for (const mesh of meshes) {
        const idx = mesh.geometry.getAttribute('skinIndex');
        const wts = mesh.geometry.getAttribute('skinWeight');
        if (!idx || !wts) continue;
        const ok = mesh.skeleton.bones.map((bone) => c.fitBones.test(bone.name));
        for (let i = 0; i < idx.count; i++) {
          let best = 0;
          for (let k = 1; k < 4; k++) if (wts.getComponent(i, k) > wts.getComponent(i, best)) best = k;
          if (!ok[idx.getComponent(i, best)]) continue;
          mesh.getVertexPosition(i, v); // já com a pele (three r186)
          v.applyMatrix4(mesh.matrixWorld).sub(a);
          const t = v.dot(ax) / len;
          if (t < 0.05 || t > 0.95) continue;
          v.addScaledVector(ax, -v.dot(ax));
          if (v.length() > 0.4) continue;
          xs.push(v.dot(lat));
          zs.push(v.dot(fwd));
        }
      }
      if (xs.length < 30) continue;
      const pct = (arr: number[], p: number) => arr[Math.round(p * (arr.length - 1))];
      xs.sort((m, n) => m - n);
      zs.sort((m, n) => m - n);
      const x0 = pct(xs, 0.03), x1 = pct(xs, 0.97), z0 = pct(zs, 0.03), z1 = pct(zs, 0.97);
      c.cx = (x0 + x1) / 2;
      c.cz = (z0 + z1) / 2;
      c.rx = (x1 - x0) / 2;
      c.rz = (z1 - z0) / 2;
    }
  }

  /** Medidas (laboratório e testes). */
  sizes(): Record<string, { cx: number; cz: number; rx: number; rz: number }> {
    return Object.fromEntries(this.colliders.map((c) => [c.name, { cx: c.cx, cz: c.cz, rx: c.rx, rz: c.rz }]));
  }

  /**
   * Quanto o ponto `p` (centro de um membro de raio `r`) precisa andar para sair dos cilindros; soma em `out`.
   * Devolve a penetração mais funda (m).
   */
  push(p: THREE.Vector3, r: number, hasBall: boolean, out: THREE.Vector3): number {
    out.set(0, 0, 0);
    let worst = 0;
    const k = this.rig.scale() / this.fitScale;
    r *= k;
    for (const c of this.colliders) {
      if (c.freeOnly && hasBall) continue;
      c.ends(a, b);
      const len = ax.subVectors(b, a).length();
      if (len < 1e-4) continue;
      ax.divideScalar(len);
      v.subVectors(p, a);
      const t = v.dot(ax) / len;
      const w = smooth(-EndFade, 0, t) * (1 - smooth(1, 1 + EndFade, t));
      if (w <= 0) continue;
      c.left(lat);
      lat.addScaledVector(ax, -lat.dot(ax)).normalize();
      fwd.crossVectors(lat, ax);
      v.addScaledVector(ax, -v.dot(ax));
      let dx = v.dot(lat) - c.cx * k;
      let dz = v.dot(fwd) - c.cz * k;
      const Rx = c.rx * k + r;
      const Rz = c.rz * k + r;
      let e = Math.hypot(dx / Rx, dz / Rz);
      if (e >= 1 + Band) continue;
      if (e < 1e-4) {
        // No eixo: sai para o lado (o braço do lado do ponto).
        dx = Math.sign(v.dot(lat) || 1) * 1e-4 * Rx;
        dz = 0;
        e = 1e-4;
      }
      // Saída suave: g(e) = 1 + B·e^((e−1−B)/B) é contínua, com derivada 1 em e = 1+B, e nunca fica abaixo de 1.
      const g = 1 + Band * Math.exp((e - 1 - Band) / Band);
      const m = (g / e - 1) * w;
      out.addScaledVector(lat, dx * m).addScaledVector(fwd, dz * m);
      worst = Math.max(worst, Math.hypot(dx * m, dz * m));
    }
    return worst;
  }

  /** Gira `bone` (no mundo) para o ponto `from` (que ele move) ir para `to`, em torno de `pivot`. */
  private swing(bone: THREE.Bone, pivot: THREE.Vector3, from: THREE.Vector3, to: THREE.Vector3): void {
    const d0 = from.clone().sub(pivot);
    const d1 = to.clone().sub(pivot);
    if (d0.lengthSq() < 1e-8 || d1.lengthSq() < 1e-8) return;
    q.setFromUnitVectors(d0.normalize(), d1.normalize());
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    bone.parent!.getWorldQuaternion(qp).invert();
    bone.quaternion.copy(qp.multiply(q.multiply(world)));
    bone.updateWorldMatrix(false, true);
  }

  /** Correção suavizada de cada osso (rotação local que multiplica a pose de entrada). */
  private readonly smoothed = new Map<string, THREE.Quaternion>();

  /**
   * Quanto o fim do segmento (cotovelo ou punho) precisa andar: soma dos empurrões dos pontos do segmento, cada um
   * escalado para o fim (um ponto a uma fração f do comprimento anda f vezes o que o fim anda). Soma, e não o pior ponto:
   * trocar de ponto entre um quadro e outro mudava o eixo do giro de repente (estalos no laboratório).
   */
  private endPush(pivot: THREE.Vector3, end: THREE.Vector3, points: [THREE.Vector3, number][], hasBall: boolean, out: THREE.Vector3): number {
    out.set(0, 0, 0);
    const len = end.distanceTo(pivot);
    const d = new THREE.Vector3();
    let worst = 0;
    for (const [p, r] of points) {
      const depth = this.push(p, r, hasBall, d);
      if (depth <= 0) continue;
      const f = Math.max(0.3, p.distanceTo(pivot) / Math.max(1e-4, len));
      out.addScaledVector(d, 1 / f);
      worst = Math.max(worst, depth);
    }
    return worst;
  }

  /**
   * Aplica nos dois braços. Ossos com as matrizes do mundo em dia. A correção entra e sai suave no tempo (constante
   * `ArmSmoothTau`): o braço que varre o tronco depressa (behind the back, spin) deslizava pela superfície com um tranco.
   * `free`: braço que fica sem colisão (a correção dele sai suave).
   */
  apply(hasBall: boolean, dt: number, free: Side | null = null): void {
    const bone = (n: string) => this.rig.bone(n);
    const pos = (n: string) => bone(n).getWorldPosition(new THREE.Vector3());
    const d = new THREE.Vector3();
    const k = 1 - Math.exp(-Math.max(0, dt) / ArmSmoothTau);
    for (const s of ['l', 'r'] as Side[]) {
      const upper = bone(`upperarm_${s}`);
      const lower = bone(`lowerarm_${s}`);
      const u0 = upper.quaternion.clone();
      const l0 = lower.quaternion.clone();
      let moved = 0;
      // 1) Braço: cotovelo e meio do braço; gira no ombro.
      for (let pass = 0; pass < (s === free ? 0 : 2); pass++) {
        const sh = pos(`upperarm_${s}`);
        const el = pos(`lowerarm_${s}`);
        const depth = this.endPush(sh, el, [
          [el, LimbRadius.elbow],
          [sh.clone().lerp(el, 0.6), LimbRadius.upperMid],
        ], hasBall, d);
        if (depth < 1e-4) break;
        this.swing(upper, sh, el, el.clone().add(d));
        moved = Math.max(moved, depth);
      }
      // 2) Antebraço e mão: gira no cotovelo.
      for (let pass = 0; pass < (s === free ? 0 : 2); pass++) {
        const el = pos(`lowerarm_${s}`);
        const wr = pos(`hand_${s}`);
        const tip = pos(`fingers_${s}`);
        const depth = this.endPush(el, wr, [
          [el.clone().lerp(wr, 0.5), LimbRadius.forearmMid],
          [wr, LimbRadius.wrist],
          [wr.clone().lerp(tip, 0.6), LimbRadius.hand],
        ], hasBall, d);
        if (depth < 1e-4) break;
        this.swing(lower, el, wr, wr.clone().add(d));
        moved = Math.max(moved, depth);
      }
      this.pushed[s] = moved;
      // Suaviza a correção (rotação local) e reaplica em cima da pose de entrada.
      for (const [b, q0] of [
        [upper, u0],
        [lower, l0],
      ] as const) {
        const want = q0.clone().invert().multiply(b.quaternion);
        const cur = this.smoothed.get(b.name) ?? new THREE.Quaternion();
        cur.slerp(want, k);
        this.smoothed.set(b.name, cur);
        b.quaternion.copy(q0).multiply(cur);
      }
      upper.updateWorldMatrix(false, true);
    }
  }
}
