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
  ballGapMax: number; // m além de 1 raio, com a bola presa
  bounces: number;
  moves: string[];
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
  private m: LabMetrics = Lab.emptyMetrics();
  private readonly labels: HTMLDivElement[] = [];
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
      ballGapMax: 0,
      bounces: 0,
      moves: [],
    };
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
  }

  metrics(): LabMetrics {
    return {
      ...this.m,
      footSlideMean: this.m.plantedFrames ? this.m.footSlideMean / this.m.plantedFrames : 0,
      moves: [...this.game.moves],
    };
  }

  /** Avança n quadros de 1/60 s com a entrada dada (campos omitidos = soltos). */
  step(n: number, partial: Partial<InputState> = {}): void {
    const dt = 1 / 60;
    for (let i = 0; i < n; i++) {
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
    // Rastros.
    const push = (list: THREE.Vector3[], p: THREE.Vector3) => {
      list.push(p.clone());
      if (list.length > 90) list.shift();
    };
    push(this.trailBall, this.game.ballMesh.position);
    push(this.trailR, this.animator.palmWorld('r', v));
    push(this.trailL, this.animator.palmWorld('l', v));
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
    const root = this.animator.root;
    const pos = root.position;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion);
    const target = pos.clone().add(new THREE.Vector3(0, 0.8, 0));
    this.renderer.setScissorTest(true);
    Views.forEach((view, i) => {
      const cam = this.cameras[i];
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      const x = (i % 2) * w;
      const y = i < 2 ? h : 0; // three conta o viewport de baixo para cima
      if (view.kind === 'back') cam.position.copy(pos).addScaledVector(fwd, -3.6).add(new THREE.Vector3(0, 1.9, 0));
      if (view.kind === 'side') cam.position.copy(pos).addScaledVector(left, -3.4).add(new THREE.Vector3(0, 1.0, 0));
      if (view.kind === 'front') cam.position.copy(pos).addScaledVector(fwd, 3.6).add(new THREE.Vector3(0, 1.2, 0));
      if (view.kind === 'top') cam.position.copy(pos).add(new THREE.Vector3(0, 5.2, 0)).addScaledVector(fwd, -0.01);
      if (view.kind === 'top') cam.up.copy(fwd);
      cam.lookAt(view.kind === 'top' ? pos : target);
      this.renderer.setViewport(x, y, w, h);
      this.renderer.setScissor(x, y, w, h);
      this.renderer.render(this.scene, cam);
      const label = this.labels[i];
      label.style.left = `${x + 8}px`;
      label.style.top = `${(i < 2 ? 0 : h) + 8}px`;
    });
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, size.x, size.y);
  }
}
