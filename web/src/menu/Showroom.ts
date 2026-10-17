// Cena do menu: o nosso jogador em pé no meio da tela, como o MyPlayer das telas do 2K. Usa a mesma cena do jogo (arena
// atrás, desfocada pelo CSS do menu) e o mesmo animador, parado no idle. A altura da build escala o boneco (o rascunho
// muda ao vivo na tela de corpo); arrastar com o mouse ou o RS gira o jogador. Na tela de aparência a roupa e a pele
// mudam ao vivo (PlayerOutfit) e a câmera chega perto do que a aba mexe (rosto, uniforme, tênis).
import * as THREE from 'three';
import type { PlayerAnimator } from '../anim/PlayerAnimator';
import { bodyScaleOf, wingspanOverModelM } from '../build/BuildRatings';
import { type PlayerLook, type Side, sameLook } from '../build/PlayerLook';

export interface ShowroomGear {
  update(dt: number): void;
  /** Veste a aparência (PlayerOutfit), com o uniforme do lado pedido. Sem isso, o showroom só mostra a roupa do jogador. */
  apply?(look: PlayerLook, side?: Side): Promise<void>;
  readonly busy?: boolean;
}

/** O que a câmera enquadra: o corpo inteiro (padrão), o rosto, do quadril para cima (uniforme) ou os pés (tênis). */
export type ShowroomFocus = 'corpo' | 'rosto' | 'tronco' | 'pes';

export class Showroom {
  /** Giro do jogador em volta do próprio eixo (rad). 0 = de frente para a câmera. */
  private spin = 0;
  private spinVel = 0;
  private dragging = false;
  private lastX = 0;
  private targetScale = 1;
  private scale = 1;
  /** Envergadura além da altura (m) do corpo mostrado. */
  private wingOver = 0;
  /** Deslocamento horizontal do jogador na tela (−1 esquerda … 1 direita): telas com painel largo empurram o boneco. */
  private offset = 0;
  private targetOffset = 0;
  private readonly spot = new THREE.Vector3();
  private look: PlayerLook | null = null;
  private side: Side = 'casa';
  private focus: ShowroomFocus = 'corpo';
  /** Enquadramento atual (altura visível e centro, m), suavizado até o do foco. */
  private view: { tall: number; center: number; lift: number } | null = null;
  private readonly headPos = new THREE.Vector3();
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
    // O jogo aplica a escala da build ativa logo depois (main.ts); aqui o boneco volta ao tamanho do modelo.
    this.animator.setBodyScale(1);
  }

  /** Corpo que o boneco mostra: a mesma escala do jogo (bodyScaleOf) e os braços pela envergadura. */
  setBody(body: { heightCm: number; wingspanCm: number }): void {
    this.targetScale = bodyScaleOf(body.heightCm);
    this.wingOver = wingspanOverModelM(body);
  }

  /**
   * Aparência mostrada (a da tela de aparência, ou a da build ativa) e o uniforme que está em foco (casa ou visitante).
   * Só veste de novo quando muda.
   */
  setLook(look: PlayerLook, side: Side = 'casa'): void {
    if (this.look && sameLook(this.look, look) && this.side === side) return;
    this.look = { ...look };
    this.side = side;
    void this.gear?.apply?.(look, side);
  }

  /** Trocando de roupa (a tela mostra "vestindo…"). */
  get dressing(): boolean {
    return !!this.gear?.busy;
  }

  setFocus(focus: ShowroomFocus): void {
    this.focus = focus;
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
    this.animator.setBodyScale(this.scale, this.wingOver);
    root.rotation.set(0, Math.atan2(this.facing.x, this.facing.z) + this.spin, 0);
    this.animator.update(dt, { right: 0, forward: 0, ballHand: 'r', hasBall: false, low: false, accelRight: 0, accelForward: 0 });
    this.gear?.update(dt);
    this.frame(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Enquadramento de cada foco: altura visível e centro (m) e quanto a câmera fica acima do centro (nos pés ela olha de
   * cima, senão via por dentro da bermuda). O rosto e o tronco seguem a altura do jogador.
   */
  private focusView(): { tall: number; center: number; lift: number } {
    const y = this.spot.y;
    if (this.focus === 'corpo') return { tall: 2.45, center: y + 2.45 * 0.47, lift: 0.05 };
    if (this.focus === 'pes') return { tall: 0.8, center: y + 0.22, lift: 0.55 };
    this.animator.bone('head').getWorldPosition(this.headPos);
    if (this.focus === 'rosto') return { tall: 0.62, center: this.headPos.y + 0.04, lift: 0.03 };
    return { tall: 1.8, center: y + (this.headPos.y - y) * 0.64, lift: 0.12 };
  }

  /**
   * Câmera de frente e parada, enquadrando até 2,45 m (o 7'4" com folga): o jogador cresce e encolhe dentro do quadro
   * quando a altura muda, como no 2K. Nas abas da aparência ela desliza até o rosto, o tronco ou os pés.
   */
  private frame(dt: number): void {
    const cam = this.camera;
    const want = this.focusView();
    const k = this.view ? 1 - Math.exp(-6 * dt) : 1;
    const view = (this.view ??= { ...want });
    view.tall += (want.tall - view.tall) * k;
    view.center += (want.center - view.center) * k;
    view.lift += (want.lift - view.lift) * k;
    const tall = view.tall; // altura visível (m)
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const dist = (tall / 2) / Math.tan(vfov / 2) + 0.6;
    const center = view.center;
    cam.position.copy(this.spot).addScaledVector(this.facing, dist);
    cam.position.y = center + view.lift;
    cam.lookAt(this.spot.x, center, this.spot.z);
    const w = window.innerWidth;
    const h = window.innerHeight;
    cam.aspect = w / h;
    // Tela estreita: os painéis viram duas colunas e o jogador vai para a metade direita.
    const offset = w < 1100 ? Math.max(this.offset, 0.55) : this.offset;
    cam.setViewOffset(w, h, -offset * w * 0.25, 0, w, h);
    cam.updateProjectionMatrix();
  }
}
