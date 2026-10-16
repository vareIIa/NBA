// Cena do menu: o nosso jogador em pé no meio da tela, como o MyPlayer das telas do 2K. Usa a mesma cena do jogo (arena
// atrás, desfocada pelo CSS do menu) e o mesmo animador, parado no idle. A altura da build escala o boneco (o rascunho
// muda ao vivo na tela de corpo); arrastar com o mouse ou o RS gira o jogador.
import * as THREE from 'three';
import type { PlayerAnimator } from '../anim/PlayerAnimator';

/** Altura do modelo do jogo (hoops_player.glb), em cm: medida na 1ª vez pelo topo da cabeça no idle. */
let modelHeightCm = 0;

export interface ShowroomGear {
  update(dt: number): void;
}

export class Showroom {
  /** Giro do jogador em volta do próprio eixo (rad). 0 = de frente para a câmera. */
  private spin = 0;
  private spinVel = 0;
  private dragging = false;
  private lastX = 0;
  private targetScale = 1;
  private scale = 1;
  /** Deslocamento horizontal do jogador na tela (−1 esquerda … 1 direita): telas com painel largo empurram o boneco. */
  private offset = 0;
  private targetOffset = 0;
  private readonly spot = new THREE.Vector3();
  private readonly onDown = (e: PointerEvent): void => {
    // Só o canvas gira o boneco (os painéis HTML ficam por cima e não repassam o clique).
    if (e.target !== this.canvas) return;
    this.dragging = true;
    this.lastX = e.clientX;
  };
  private readonly onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.spinVel = 0;
    this.spin += (e.clientX - this.lastX) * 0.012;
    this.lastX = e.clientX;
  };
  private readonly onUp = (): void => {
    this.dragging = false;
  };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly animator: PlayerAnimator,
    private readonly gear: ShowroomGear | null,
    /** Onde o jogador fica no showroom (m, mundo do three) e para onde ele olha (a câmera fica desse lado). */
    spot: THREE.Vector3,
    private readonly facing: THREE.Vector3,
    private readonly canvas: HTMLCanvasElement,
    /** Objetos do jogo que somem no showroom (a bola do drible). Voltam no dispose. */
    private readonly hidden: readonly THREE.Object3D[] = [],
  ) {
    this.spot.copy(spot);
    for (const o of hidden) o.visible = false;
    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.camera.clearViewOffset();
    for (const o of this.hidden) o.visible = true;
    // O Freestyle ainda usa o corpo padrão (a física e as animações são da altura do modelo): a escala volta a 1.
    this.animator.root.scale.setScalar(1);
  }

  /** Altura que o boneco deve ter (cm). A escala é uniforme: o jogo de verdade ainda usa o corpo padrão. */
  setHeight(heightCm: number): void {
    if (!modelHeightCm) modelHeightCm = this.measureHeightCm();
    this.targetScale = heightCm / modelHeightCm;
  }

  /** Empurra o jogador para um lado da tela (as telas com painel à esquerda o põem mais à direita). */
  setOffset(offset: number): void {
    this.targetOffset = offset;
  }

  /** Giro pelo RS (−1…1 por quadro). */
  nudge(stickX: number, dt: number): void {
    if (Math.abs(stickX) > 0.2) this.spin += stickX * 2.4 * dt;
  }

  update(dt: number): void {
    const root = this.animator.root;
    const k = 1 - Math.exp(-10 * dt);
    this.scale += (this.targetScale - this.scale) * k;
    this.offset += (this.targetOffset - this.offset) * (1 - Math.exp(-6 * dt));
    // Solto o arraste, o giro volta devagar para a frente (como o 2K faz quando você larga o RS).
    if (!this.dragging) {
      const wrapped = Math.atan2(Math.sin(this.spin), Math.cos(this.spin));
      this.spinVel += (-wrapped * 6 - this.spinVel * 4) * dt;
      this.spin = wrapped + this.spinVel * dt;
    }
    root.position.copy(this.spot);
    root.scale.setScalar(this.scale);
    root.rotation.set(0, Math.atan2(this.facing.x, this.facing.z) + this.spin, 0);
    this.animator.update(dt, { right: 0, forward: 0, ballHand: 'r', hasBall: false, low: false, accelRight: 0, accelForward: 0 });
    this.gear?.update(dt);
    this.frame();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Câmera de frente e parada, enquadrando até 2,45 m (o 7'4" com folga): o jogador cresce e encolhe dentro do quadro
   * quando a altura muda, como no 2K.
   */
  private frame(): void {
    const cam = this.camera;
    const tall = 2.45; // altura visível (m)
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const dist = (tall / 2) / Math.tan(vfov / 2) + 0.6;
    const center = this.spot.y + tall * 0.47;
    cam.position.copy(this.spot).addScaledVector(this.facing, dist);
    cam.position.y = center + 0.05;
    cam.lookAt(this.spot.x, center, this.spot.z);
    const w = window.innerWidth;
    const h = window.innerHeight;
    cam.aspect = w / h;
    // Tela estreita: os painéis viram duas colunas e o jogador vai para a metade direita.
    const offset = w < 1100 ? Math.max(this.offset, 0.55) : this.offset;
    cam.setViewOffset(w, h, -offset * w * 0.25, 0, w, h);
    cam.updateProjectionMatrix();
  }

  /** Mede a altura do boneco no idle pela caixa dos vértices já deformados pelo esqueleto (cabelo e tênis inclusos). */
  private measureHeightCm(): number {
    const root = this.animator.root;
    const saved = root.scale.x;
    root.scale.setScalar(1);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    root.scale.setScalar(saved);
    const top = box.max.y - root.position.y;
    // Sem malha (boneco não carregou), usa a altura do boneco padrão (1,86 m).
    return top > 1 ? top * 100 : 186;
  }
}
