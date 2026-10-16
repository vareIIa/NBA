// Footwork procedural do drible (pés, quadril e peso), por cima da base plantada do PlayerAnimator:
//  - BASE ESCALONADA do entre as pernas (split stance): o pé da mão que RECEBE vai à frente e o outro atrás. Abre o
//    corredor por onde a bola cruza (da mão de trás, pela frente da canela de trás, quique entre os pés, sobe por fora do
//    joelho da frente). Kyrie de costas, LZSlFyyCkhk 164,0–165,2 s; o clipe da CMU fazia de cócoras com os pés lado a lado.
//  - TESOURA nos combos: a cada entre as pernas a base inverte (o pé de trás vem à frente e o da frente vai atrás, os dois
//    no ar ao mesmo tempo), no ritmo do quique: os pés se cruzam (lado a lado, corredor aberto) perto do quique e o pé da
//    frente novo pousa antes da recepção por fora do joelho dele.
//  - TRANSFERÊNCIA DE PESO: o quadril vai para cima do pé de apoio (o da frente na base escalonada, o lado da mão nova
//    no crossover), gira junto com a base (quadril do pé da frente à frente) e sobe/desce com o passo. É uma mola
//    (massa-mola-amortecedor) e não um lerp: o corpo tem inércia, passa um pouco do ponto e assenta.
// Referencial do jogador (three): +x = esquerda, +z = frente, +y = cima. Metros (jogador de 1,96 m; o animador escala).
import type { Hand } from './ClipLibrary';
import { sideSign } from './ProceduralMoves';

export const SplitStance = {
  /** m do centro do corpo ao tornozelo, na lateral (a base parada é ~0,3; na escalonada os pés chegam mais perto). */
  halfWidth: 0.2,
  /** m à frente (pé da mão que recebe) e atrás (o outro) do centro do corpo. */
  front: 0.18,
  rear: -0.17,
  /**
   * m que cada pé sai do chão no passo da tesoura (o da frente passa um pouco mais alto). Mais baixo que isso a ponta
   * ficava a menos de 6 cm do chão no meio do passo (a perna de trás esticada pelo IK) e o pé patinava a 5–9 m/s.
   */
  liftFront: 0.1,
  liftRear: 0.09,
  /**
   * Fração do passo em que o pé anda na horizontal (antes: sobe; depois: desce no lugar). Com a ponta a menos de ~6 cm
   * do chão o pé conta como apoiado: andando ali ele patina.
   */
  travelWindow: [0.25, 0.8] as [number, number],
  /** Quique: m à frente do meio dos pés (negativo = atrás: a bola sobe longe da canela da frente). */
  floorAhead: -0.06,
  /** Recepção: m por fora e à frente do tornozelo da frente (joelho 8,6 cm + bola 12 cm + folga). */
  catchOutside: 0.34, // com 0,24 a bola subindo raspava a coxa da frente (laboratório: 36 -> 6 quadros no combo)
  catchAhead: 0.04,
  /**
   * Fração do avanço do pé da mão que o ponto do drible acompanha no loop (a bola à frente do pé da frente). Com 1 a mão
   * ia ~0,55 m à frente do corpo, perto do alcance do braço, e o braço estalava a cada quique depois do entre as pernas
   * (laboratório: 34 -> 18 estalos com 0,5; 0 dá o mesmo, mas a bola fica dentro do joelho da frente).
   */
  handAhead: 0.5,
  /** m que o quadril sobe no meio da tesoura (os dois pés no ar por um instante). */
  hop: 0.018,
  /**
   * Duração do passo (s): esta fração do tempo entre o começo do drible e o quique, dentro dos limites. Passa um pouco
   * do quique: no meio da tesoura os pés estão lado a lado a 2·halfWidth (40 cm, o corredor já existe) e o pé da frente
   * novo pousa logo depois, antes da recepção por fora do joelho dele. Pousando antes do quique (0,85) a tesoura durava
   * ~0,14 s e o pé andava a 9 m/s.
   */
  bounceShare: 1.3,
  minSeconds: 0.12,
  maxSeconds: 0.26,
  /** Velocidade (m/s) para baixo dada ao quadril quando o passo pousa (os joelhos absorvem o peso). */
  landingKick: 0.35,
};

/** Pé à frente na base escalonada do entre as pernas: o da mão que recebe. */
export const splitFrontFoot = (toHand: Hand): Hand => toHand;

/** Tornozelo de um pé na base escalonada (referencial do jogador, chão). */
export function splitFoot(side: Hand, front: Hand): { x: number; z: number } {
  return { x: sideSign(side) * SplitStance.halfWidth, z: side === front ? SplitStance.front : SplitStance.rear };
}

const smootherstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/**
 * Passo da tesoura em t (0..1): quanto do caminho horizontal já andou (smootherstep: sai e pousa com velocidade e
 * aceleração zero, sem tranco) e a altura do pé (seno, no alto no meio do passo). O pé sai do chão ANTES de andar e
 * pousa DEPOIS de chegar (a viagem horizontal fica em `SplitStance.travelWindow`): andando no chão ele patinava.
 */
export function scissorStep(t: number, lift: number): { travel: number; height: number } {
  const x = Math.min(1, Math.max(0, t));
  const [a, b] = SplitStance.travelWindow;
  return { travel: smootherstep((x - a) / (b - a)), height: lift * Math.sin(Math.PI * x) };
}

/** Duração do passo da tesoura (s), para pousar antes do quique que está a `toBounce` s. */
export function scissorSeconds(toBounce: number): number {
  return Math.min(SplitStance.maxSeconds, Math.max(SplitStance.minSeconds, toBounce * SplitStance.bounceShare));
}

/** Para onde o peso vai (referencial do jogador): deslocamento do quadril (m) e giro dele em torno da vertical (rad). */
export interface WeightTarget {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export const WeightShiftTuning = {
  /** Base escalonada: o quadril vai esta fração do caminho até o pé da frente (lunge) e gira com a base. */
  splitForward: 0.035,
  splitLateral: 0.02,
  splitYawDeg: 9,
  splitDrop: 0.015,
  /** Crossover parado: carrega no lado da mão que solta e passa para o lado da mão que recebe. */
  crossLoad: 0.025,
  crossShift: 0.055,
  crossDip: 0.02,
  /** Hesitação: o corpo sobe e recua (vende a parada) e no fim vai à frente (o arranque). */
  hesiRise: 0.025,
  hesiBack: 0.03,
  hesiGo: 0.04,
  /** Loop parado: o quadril fica um pouco sobre o lado da bola. */
  loopBallSide: 0.012,
};

/** Fração (0..1) do drible ativo em que a bola sai e é recebida, para desenhar o peso no tempo do quique. */
export interface MovePhase {
  kind: string | null;
  u: number;
  release: number;
  catch: number;
  fromHand: Hand;
  toHand: Hand;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Alvo do peso. `front`: pé da frente da base escalonada (null = pés lado a lado); `ballHand`: mão da bola no loop.
 * Só os dribles no lugar (size-up) e o loop parado: os de movimento têm o peso da locomoção.
 */
export function weightTarget(move: MovePhase, front: Hand | null, ballHand: Hand): WeightTarget {
  const W = WeightShiftTuning;
  const out: WeightTarget = { x: 0, y: 0, z: 0, yaw: 0 };
  if (front) {
    const s = sideSign(front);
    out.x += s * W.splitLateral;
    out.z += W.splitForward;
    out.y -= W.splitDrop;
    // Girar em torno de +y leva o +x (esquerda) para -z: o quadril do pé da frente vai à frente com yaw = -lado.
    out.yaw += (-s * W.splitYawDeg * Math.PI) / 180;
  }
  const k = move.kind;
  if (!k) {
    out.x += sideSign(ballHand) * W.loopBallSide;
    return out;
  }
  if (k === 'Cross' || k === 'EscapeCross') {
    const pass = smoothstep(0, Math.max(0.05, move.catch), move.u);
    out.x += sideSign(move.fromHand) * W.crossLoad * (1 - pass) + sideSign(move.toHand) * W.crossShift * pass;
    out.y -= W.crossDip * Math.sin(Math.PI * Math.min(1, move.u / Math.max(0.05, move.catch)));
  } else if (k === 'Hesitation') {
    const sell = Math.sin(Math.PI * Math.min(1, move.u / 0.7));
    out.y += W.hesiRise * sell;
    out.z += -W.hesiBack * sell + W.hesiGo * smoothstep(0.65, 1, move.u);
  } else if (k === 'BetweenLegs') {
    // Durante a troca o peso passa pelo centro (a tesoura) e cai no pé da frente novo quando ele pousa (o `front` já
    // é o novo): nada a somar além da base.
  } else {
    out.x = 0;
    out.z = 0;
    out.yaw = 0;
    out.y = 0;
  }
  return out;
}

/** Mola amortecida por componente (x, y, z, yaw): a transferência de peso tem inércia e assenta sem quina. */
export class WeightShift {
  readonly pos: WeightTarget = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly vel: WeightTarget = { x: 0, y: 0, z: 0, yaw: 0 };
  /** rad/s e amortecimento (abaixo de 1: passa um pouco do ponto, como o corpo indo para o pé de apoio). */
  omega = 13;
  zeta = 0.78;
  /** A altura é mais rápida (joelhos). */
  omegaY = 18;

  update(target: WeightTarget, dt: number): WeightTarget {
    // Sub-passos de até 1/120 s: estável com qualquer dt (o jogo limita o dt, o laboratório roda a 60 e a 144 Hz).
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      for (const key of ['x', 'y', 'z', 'yaw'] as const) {
        const w = key === 'y' ? this.omegaY : this.omega;
        const a = w * w * (target[key] - this.pos[key]) - 2 * this.zeta * w * this.vel[key];
        this.vel[key] += a * h;
        this.pos[key] += this.vel[key] * h;
      }
    }
    return this.pos;
  }

  /** Impulso vertical (m/s; negativo = para baixo): o pouso de um passo. */
  kick(vy: number): void {
    this.vel.y += vy;
  }

  reset(): void {
    for (const key of ['x', 'y', 'z', 'yaw'] as const) {
      this.pos[key] = 0;
      this.vel[key] = 0;
    }
  }
}
