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
}

export const defaultCameraTuning = (): CameraTuning => ({
  distanceBehind: 6.4,
  height: 3.3,
  lookHeight: 1.6,
  lookTowardRim: 0.42,
  damping: 5,
});

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private position = new Vec3();
  private target = new Vec3();
  private initialized = false;

  constructor(
    aspect: number,
    readonly tuning: CameraTuning = defaultCameraTuning(),
  ) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.05, 200);
  }

  /** Horizontal, da câmera para onde ela olha (núcleo). Base do movimento relativo à câmera. */
  forward(): Vec3 {
    return this.target.sub(this.position).flat().normalized(new Vec3(-1, 0, 0));
  }

  update(dt: number, player: Vec3, rim: Vec3): void {
    const t = this.tuning;
    const toRim = rim.sub(player).flat().normalized(new Vec3(-1, 0, 0));
    const desiredPos = player.sub(toRim.scale(t.distanceBehind)).withZ(t.height);
    const desiredTarget = lerpVec(player, rim, t.lookTowardRim).withZ(t.lookHeight);

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
    this.camera.lookAt(toThree(this.target));
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
