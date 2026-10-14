// Porte de HoopsCourt.h: bola, superfícies, cesta (aro + tabela) e linhas da quadra.
import { Vec3, upVector } from './HoopsMath';

/** Bola tamanho 7 (masculino). */
export interface BallSpec {
  radius: number;
  mass: number;
}
export const defaultBallSpec = (): BallSpec => ({ radius: 0.119, mass: 0.62 });

/** Coeficientes de contato. restitution = restituição normal; friction = Coulomb (impulso tangencial). */
export interface SurfaceSpec {
  readonly restitution: number;
  readonly friction: number;
}

export const Surfaces = {
  // Madeira: regra da FIBA (solta de 1,80 m, volta a 1,20–1,40 m medidos no topo da bola) => e ~ 0,73–0,80.
  Hardwood: { restitution: 0.76, friction: 0.25 },
  Asphalt: { restitution: 0.71, friction: 0.35 },
  Rim: { restitution: 0.55, friction: 0.2 },
  Backboard: { restitution: 0.6, friction: 0.15 },
} as const satisfies Record<string, SurfaceSpec>;

/** Cesta (aro + tabela). Medidas oficiais; posicionada no mundo pela face frontal da tabela. */
export class HoopSpec {
  /** Centro da face frontal da tabela (lado da quadra). */
  backboardFaceCenter = new Vec3(0, 0, 3.435);
  /** Vetor horizontal unitário da tabela para dentro da quadra. */
  forward = new Vec3(1, 0, 0);

  rimHeight = 3.05; // topo do aro
  rimInnerRadius = 0.2286; // diâmetro interno de 45,7 cm
  rimTubeRadius = 0.008; // tubo de ~16 mm
  rimInnerEdgeToBoard = 0.151; // borda interna do aro até a face da tabela
  backboardWidth = 1.83;
  backboardHeight = 1.07;
  backboardThickness = 0.03;

  /** Cria a cesta a partir do ponto no chão abaixo do centro do aro. */
  static fromRimFloorPoint(rimFloorPoint: Vec3, inForward: Vec3): HoopSpec {
    const spec = new HoopSpec();
    spec.forward = inForward.flat().normalized();
    const rimCenterToBoard = spec.rimInnerEdgeToBoard + spec.rimInnerRadius;
    const face = rimFloorPoint.flat().sub(spec.forward.scale(rimCenterToBoard));
    // Borda inferior da tabela 0,15 m abaixo do topo do aro (2,90 m).
    const boardBottom = spec.rimHeight - 0.15;
    spec.backboardFaceCenter = new Vec3(face.x, face.y, rimFloorPoint.z + boardBottom + spec.backboardHeight * 0.5);
    spec.rimHeight += rimFloorPoint.z;
    return spec;
  }

  right(): Vec3 {
    return upVector().cross(this.forward).normalized(new Vec3(0, 1, 0));
  }

  /** Raio da linha central do toro do aro. */
  rimCenterlineRadius(): number {
    return this.rimInnerRadius + this.rimTubeRadius;
  }

  /** Altura do plano que passa pelo centro do tubo do aro. */
  rimPlaneZ(): number {
    return this.rimHeight - this.rimTubeRadius;
  }

  /** Centro geométrico do aro (no plano do tubo). */
  rimCenter(): Vec3 {
    const horizontal = this.backboardFaceCenter
      .flat()
      .add(this.forward.scale(this.rimInnerEdgeToBoard + this.rimInnerRadius));
    return horizontal.withZ(this.rimPlaneZ());
  }

  /** Centro do volume da tabela (atrás da face). */
  backboardCenter(): Vec3 {
    return this.backboardFaceCenter.sub(this.forward.scale(this.backboardThickness * 0.5));
  }
}

/** Linhas da quadra (medidas do padrão profissional; liga fictícia). */
export class CourtSpec {
  threePointRadius = 7.24;
  cornerThreeDistance = 6.71;
  cornerZoneFromBaseline = 4.27;
  rimFromBaseline = 1.6;
  freeThrowDistance = 4.57;
  halfCourtLength = 14.33;
  courtWidth = 15.24;

  /** Arremesso de 3? Posições horizontais; rimFloorPoint = chão abaixo do aro; hoopForward da cesta. */
  isThreePointer(shooterFloorPos: Vec3, rimFloorPoint: Vec3, hoopForward: Vec3): boolean {
    const fwd = hoopForward.flat().normalized();
    const lateral = upVector().cross(fwd).normalized();
    const delta = shooterFloorPos.sub(rimFloorPoint).flat();
    const along = delta.dot(fwd);
    const side = delta.dot(lateral);
    const cornerZoneEnd = this.cornerZoneFromBaseline - this.rimFromBaseline;
    if (along <= cornerZoneEnd) {
      return Math.abs(side) >= this.cornerThreeDistance;
    }
    return delta.length2D() >= this.threePointRadius;
  }
}
