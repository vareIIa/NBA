// Desenho da rede com física (HoopsNet): um cilindro fino por cordão (InstancedMesh), atualizado a cada quadro com as
// posições da simulação. Também avança a rede quando a bola não está em voo (para ela balançar até parar).
import * as THREE from 'three';
import { type BallState, type HoopSpec, NetSim } from '../sim';

const CordRadius = 0.0065; // um pouco mais grosso que o cordão real, para ler de longe
const FixedStep = 1 / 120;

export class NetMesh {
  readonly sim: NetSim;
  readonly mesh: THREE.InstancedMesh;
  private accumulator = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  /** Velocidade que a bola perdeu na rede no último tick (som do "swish"). */
  lastHit = 0;

  constructor(scene: THREE.Scene, hoop: HoopSpec) {
    this.sim = new NetSim(hoop);
    for (let i = 0; i < 240; i++) this.sim.step(FixedStep); // assenta pendurada
    const geometry = new THREE.CylinderGeometry(CordRadius, CordRadius, 1, 5, 1, true);
    const material = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.9, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.sim.segments.length / 2);
    this.mesh.name = 'rede';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.sync();
  }

  /** Um tick de física com a bola em voo (chamado pelo Freestyle.onFlightTick). */
  stepWithBall(ball: BallState, dt: number, radius: number): void {
    const contact = this.sim.step(dt, ball, radius);
    this.lastHit = contact.touched ? Math.max(this.lastHit, contact.deltaV) : this.lastHit;
  }

  /** Sem bola em voo: a rede continua balançando até parar. */
  advance(dt: number): void {
    this.accumulator = Math.min(this.accumulator + dt, 0.1);
    while (this.accumulator >= FixedStep) {
      this.accumulator -= FixedStep;
      this.sim.step(FixedStep);
    }
  }

  /** Núcleo (Z para cima) → three.js (Y para cima), um cilindro por cordão. */
  sync(): void {
    const p = this.sim.pos;
    const segments = this.sim.segments;
    for (let s = 0; s < segments.length / 2; s++) {
      const i = segments[s * 2] * 3;
      const j = segments[s * 2 + 1] * 3;
      this.a.set(p[i], p[i + 2], p[i + 1]);
      this.b.set(p[j], p[j + 2], p[j + 1]);
      this.dir.subVectors(this.b, this.a);
      const length = this.dir.length();
      this.quat.setFromUnitVectors(this.up, this.dir.normalize());
      this.scale.set(1, length, 1);
      this.matrix.compose(this.a.add(this.b).multiplyScalar(0.5), this.quat, this.scale);
      this.mesh.setMatrixAt(s, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
