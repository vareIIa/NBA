// Câmera do jogo de referência ("2K"): atrás do jogador, um pouco alta, olhando para a cesta.
import * as THREE from 'three';
import { Vec3, lerpVec } from '../sim';
import { fromThree, toThree } from '../units';

export interface CameraTuning {
  distanceBehind: number; // m atrás do jogador (no sentido oposto à cesta)
  height: number; // m acima do chão
  lookHeight: number; // altura do ponto de mira
  lookTowardRim: number; // 0 = mira no jogador, 1 = mira no aro
  damping: number; // 1/s (quanto maior, mais rígida)
  rimPull: number; // 0 = olha sempre ao longo da quadra, 1 = sempre do jogador para o aro
}

export const defaultCameraTuning = (): CameraTuning => ({
  // Câmera alta do modo de rua do jogo de referência (vídeos do diretor): bem atrás e acima, olhando para baixo.
  distanceBehind: 7.2,
  height: 4.6,
  lookHeight: 1.1,
  lookTowardRim: 0.38,
  damping: 4,
  rimPull: 0.35,
});

/** jogo = câmera do jogo; lado/frente = câmeras de inspeção da animação (?cam=lado na URL). */
export type CameraMode = 'jogo' | 'lado' | 'frente';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'jogo';
  /** Frente do jogador (núcleo), usada pelas câmeras de inspeção. */
  playerFacing = new Vec3(-1, 0, 0);
  private position = new Vec3();
  private target = new Vec3();
  private initialized = false;
  /** Tranco do impacto (m) e o relógio dele. */
  private shake = 0;
  private shakeT = 0;

  constructor(
    aspect: number,
    readonly tuning: CameraTuning = defaultCameraTuning(),
  ) {
    this.camera = new THREE.PerspectiveCamera(46, aspect, 0.05, 200);
  }

  /** Horizontal, da câmera para onde ela olha (núcleo). Base do movimento relativo à câmera. */
  forward(): Vec3 {
    return this.target.sub(this.position).flat().normalized(new Vec3(-1, 0, 0));
  }

  update(dt: number, player: Vec3, rim: Vec3): void {
    const t = this.tuning;
    // Como no modo de rua do jogo de referência: a câmera olha quase sempre ao longo da quadra (para a linha de fundo)
    // e só puxa um pouco para a cesta; perto do aro ou no canto ela não gira em volta do jogador.
    const alongCourt = rim.sub(new Vec3(rim.x + 1, rim.y, rim.z)).flat().normalized(); // da quadra para a tabela
    const towardRim = rim.sub(player).flat().normalized(alongCourt);
    const toRim = alongCourt.add(towardRim.sub(alongCourt).scale(this.tuning.rimPull)).normalized(alongCourt);
    let desiredPos = player.sub(toRim.scale(t.distanceBehind)).withZ(t.height);
    let desiredTarget = lerpVec(player, rim, t.lookTowardRim).withZ(t.lookHeight);
    if (this.mode !== 'jogo') {
      // Inspeção: perto, na altura do quadril, de lado (direita do jogador) ou de frente.
      const f = this.playerFacing.flat().normalized(toRim);
      const right = new Vec3(-f.y, f.x, 0).neg(); // eixos da Unreal: direita = up × frente
      const offset = this.mode === 'lado' ? right.scale(3.4).add(f.scale(0.6)) : f.scale(3.6).add(right.scale(0.8));
      desiredPos = player.add(offset).withZ(1.25);
      desiredTarget = player.withZ(0.85);
    }

    if (!this.initialized) {
      this.position = desiredPos;
      this.target = desiredTarget;
      this.initialized = true;
    } else {
      const alpha = 1 - Math.exp(-t.damping * dt);
      this.position = lerpVec(this.position, desiredPos, alpha);
      this.target = lerpVec(this.target, desiredTarget, alpha);
    }
    toThree(this.position, this.camera.position);
    // Tranco do impacto (kick): só na câmera desenhada, não no caminho suave dela.
    if (this.shake > 1e-3) {
      this.shakeT += dt;
      const s = this.shake;
      this.camera.position.x += Math.sin(this.shakeT * 71) * s;
      this.camera.position.y += Math.sin(this.shakeT * 53 + 1.3) * s * 0.7;
      this.camera.position.z += Math.sin(this.shakeT * 61 + 2.1) * s;
      this.shake *= Math.exp(-dt * 10);
    }
    this.camera.lookAt(toThree(this.target));
  }

  /** Tranco curto da câmera num impacto (toco no aro, tapa na bola): `strength` em metros, some em ~0,3 s. */
  kick(strength: number): void {
    this.shake = Math.max(this.shake, strength);
  }

  /** Projeta um ponto do núcleo na tela (pixels). */
  project(point: Vec3, width: number, height: number): { x: number; y: number; visible: boolean } {
    const v = toThree(point).project(this.camera);
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, visible: v.z < 1 };
  }

  worldPosition(): Vec3 {
    return fromThree(this.camera.position);
  }
}
