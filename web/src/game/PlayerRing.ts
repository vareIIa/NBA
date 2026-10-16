// Indicador no chão embaixo do jogador controlado (o disco vermelho do jogo de referência): anel vermelho, aro
// branco fino por dentro e uma seta apontando para onde ele olha. Com o takeover aceso, o anel vira fogo (laranja
// pulsando). Desenhado como textura de canvas num plano rente ao piso.
import * as THREE from 'three';

function makeTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const c = size / 2;
  g.clearRect(0, 0, size, size);
  // Disco translúcido.
  const fill = g.createRadialGradient(c, c, 40, c, c, 118);
  fill.addColorStop(0, 'rgba(255,60,50,0.05)');
  fill.addColorStop(1, 'rgba(255,40,30,0.35)');
  g.fillStyle = fill;
  g.beginPath();
  g.arc(c, c, 118, 0, Math.PI * 2);
  g.fill();
  // Anel principal.
  g.lineWidth = 16;
  g.strokeStyle = '#ffffff';
  g.beginPath();
  g.arc(c, c, 108, 0, Math.PI * 2);
  g.stroke();
  // Aro branco interno, aberto na frente.
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.arc(c, c, 82, -Math.PI / 2 + 0.5, (3 * Math.PI) / 2 - 0.5);
  g.stroke();
  // Seta (frente = topo da textura).
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(c, 6);
  g.lineTo(c - 16, 30);
  g.lineTo(c + 16, 30);
  g.closePath();
  g.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class PlayerRing {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private time = 0;
  private fire = false;

  constructor(scene: THREE.Scene, radius = 0.62) {
    this.material = new THREE.MeshBasicMaterial({
      map: makeTexture(),
      color: new THREE.Color('#e3262b'),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  setFire(on: boolean): void {
    this.fire = on;
  }

  /** position = pés do jogador (three.js); yaw = rotação do corpo (root.rotation.y). */
  update(dt: number, position: THREE.Vector3, yaw: number): void {
    this.time += dt;
    this.mesh.position.set(position.x, 0.012, position.z);
    // O plano está deitado: a rotação em torno do Y do mundo vira rotação em Z do plano.
    this.mesh.rotation.z = yaw + Math.PI;
    if (this.fire) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 14);
      this.material.color.setRGB(1, 0.45 + 0.25 * pulse, 0.1);
      this.mesh.scale.setScalar(1 + 0.05 * pulse);
    } else {
      this.material.color.set('#e3262b');
      this.mesh.scale.setScalar(1);
    }
  }
}
