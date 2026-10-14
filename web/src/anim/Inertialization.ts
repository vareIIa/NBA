// Transições sem crossfade: "dead blending" (D. Holden, 2023), uma variante da inertialization usada em jogos AAA.
// Na troca de animação o clipe novo entra na hora com peso total. A pose antiga continua andando sozinha pela
// velocidade que tinha (extrapolada e freando), e a saída desliza dela para a nova numa curva suave. Não há duas
// animações misturadas ao mesmo tempo (o crossfade mistura passadas e deixa o movimento "mole"), não há salto de pose
// nem de velocidade, e a resposta ao comando é imediata.
import { type Bone, Quaternion, Vector3 } from 'three';

interface Track {
  bone: Bone;
  // Saída dos dois últimos quadros (para a velocidade) e a pose de origem extrapolada.
  prevQ: Quaternion;
  prevP: Vector3;
  velW: Vector3; // velocidade angular (rad/s, eixo*ângulo, no espaço local do osso)
  velP: Vector3; // m/s (espaço do pai)
  srcQ: Quaternion;
  srcP: Vector3;
  srcW: Vector3;
  srcV: Vector3;
}

const q = new Quaternion();
const dq = new Quaternion();
const p = new Vector3();
const axis = new Vector3();

/** Integra uma velocidade angular (eixo*ângulo) por dt num quaternion. */
function integrate(out: Quaternion, w: Vector3, dt: number): void {
  const angle = w.length() * dt;
  if (angle < 1e-9) return;
  axis.copy(w).normalize();
  dq.setFromAxisAngle(axis, angle);
  out.premultiply(dq).normalize();
}

/** Velocidade angular entre duas rotações (de a para b em dt). */
function angularVelocity(a: Quaternion, b: Quaternion, dt: number, out: Vector3): Vector3 {
  dq.copy(b).multiply(q.copy(a).invert());
  if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
  const angle = 2 * Math.acos(Math.min(1, dq.w));
  const s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
  if (s < 1e-6 || dt <= 0) return out.set(0, 0, 0);
  return out.set(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / dt);
}

export class Inertializer {
  private readonly tracks: Track[];
  private elapsed = Infinity;
  private duration = 0.2;
  /** Meia-vida (s) da velocidade da pose antiga enquanto ela é extrapolada. */
  decayHalfLife = 0.06;
  private primed = false;

  constructor(bones: Bone[]) {
    this.tracks = bones.map((bone) => ({
      bone,
      prevQ: bone.quaternion.clone(),
      prevP: bone.position.clone(),
      velW: new Vector3(),
      velP: new Vector3(),
      srcQ: new Quaternion(),
      srcP: new Vector3(),
      srcW: new Vector3(),
      srcV: new Vector3(),
    }));
  }

  /** Começa uma transição a partir da pose que saiu no quadro anterior (com a velocidade dela). */
  trigger(duration = 0.2): void {
    if (!this.primed) return;
    this.duration = duration;
    this.elapsed = 0;
    for (const t of this.tracks) {
      t.srcQ.copy(t.prevQ);
      t.srcP.copy(t.prevP);
      t.srcW.copy(t.velW);
      t.srcV.copy(t.velP);
    }
  }

  get blending(): boolean {
    return this.elapsed < this.duration;
  }

  /**
   * Chamar logo depois do mixer.update(dt), com a pose NOVA nos ossos. Escreve a pose de saída nos ossos e guarda a
   * velocidade para a próxima transição.
   */
  apply(dt: number): void {
    if (this.elapsed < this.duration) {
      this.elapsed += dt;
      const x = Math.min(1, this.elapsed / this.duration);
      const blend = x * x * (3 - 2 * x); // suave nas duas pontas
      const k = Math.exp((-Math.LN2 * dt) / this.decayHalfLife);
      for (const t of this.tracks) {
        // Pose antiga continua pela própria velocidade, freando.
        t.srcW.multiplyScalar(k);
        t.srcV.multiplyScalar(k);
        integrate(t.srcQ, t.srcW, dt);
        t.srcP.addScaledVector(t.srcV, dt);
        if (t.srcQ.dot(t.bone.quaternion) < 0) t.srcQ.set(-t.srcQ.x, -t.srcQ.y, -t.srcQ.z, -t.srcQ.w);
        q.copy(t.srcQ).slerp(t.bone.quaternion, blend);
        t.bone.quaternion.copy(q);
        p.copy(t.srcP).lerp(t.bone.position, blend);
        t.bone.position.copy(p);
      }
    }
    // Velocidade da saída (para a próxima transição).
    for (const t of this.tracks) {
      if (this.primed && dt > 0) {
        angularVelocity(t.prevQ, t.bone.quaternion, dt, t.velW);
        t.velP.copy(t.bone.position).sub(t.prevP).divideScalar(dt);
      }
      t.prevQ.copy(t.bone.quaternion);
      t.prevP.copy(t.bone.position);
    }
    this.primed = true;
  }
}
