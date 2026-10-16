// Rede da cesta com física (pedido do diretor: a bola nunca atravessa a rede, cai nela, sofre o impacto e muda de
// direção). Fica fora do BallSim (o núcleo portado do C++ continua igual e os testes dele também): o Freestyle chama
// NetSim.step depois de cada tick do BallSim e a rede devolve a correção para a bola.
//
// Modelo (position-based dynamics):
//  - Trama em losango, como a rede de verdade: 12 ganchos no aro (FIBA), 6 fileiras de nós abaixo; cada nó liga em dois
//    nós da fileira de baixo, deslocados meio passo. O losango deixa a rede abrir (raio) encurtando (altura): é por isso
//    que ela "sobe" quando a bola passa.
//  - Integração de Verlet com amortecimento; cordões com comprimento fixo (restrição de distância).
//  - Tirantes: cada nó fica no máximo a um comprimento de caminho (pela trama) do gancho mais próximo. A rede não estica.
//  - Teto: nenhum nó sobe acima dos ganchos (embaixo do tubo do aro). Assim nenhum cordão cruza o aro, nem quando a
//    bola levanta a rede.
//  - Contato bola × cordão (cápsula), com massa dos dois lados. Na última passada, nó que chegou no limite do tirante
//    vira fixo: a correção vai toda para a bola. É isso que garante que ela não atravessa a rede esticada.
//  - A bola recebe a correção de posição e a mesma correção como velocidade (Δx/dt), mais um arrasto de atrito
//    enquanto encosta. Sai mais lenta e desviada, como na vida real.
import { type BallState } from './HoopsBallSim';
import { type HoopSpec, defaultBallSpec } from './HoopsCourt';
import { DefaultGravity, Vec3 } from './HoopsMath';

export interface NetConfig {
  hooks: number; // ganchos no aro (FIBA: 12)
  rows: number; // fileiras de nós abaixo dos ganchos
  length: number; // m, do aro até a ponta (FIBA: 0,40–0,45)
  bottomRadius: number; // m, raio da boca de baixo em repouso (menor que a bola: ela abre a rede)
  mass: number; // kg, a rede inteira
  cordRadius: number; // m, espessura do cordão
  substeps: number;
  iterations: number;
  damping: number; // fração da velocidade perdida por passo (ar + atrito interno)
  ballDrag: number; // 1/s: atrito da rede freando a bola enquanto encosta
  gravity: number;
}

export const defaultNetConfig = (overrides: Partial<NetConfig> = {}): NetConfig => ({
  hooks: 12,
  rows: 6,
  length: 0.43,
  bottomRadius: 0.105,
  mass: 0.15,
  cordRadius: 0.004,
  substeps: 2,
  iterations: 10,
  damping: 0.02,
  ballDrag: 8.0,
  gravity: DefaultGravity,
  ...overrides,
});

export interface NetContact {
  touched: boolean;
  /** Variação de velocidade da bola neste passo (m/s), para som/efeito. */
  deltaV: number;
}

export class NetSim {
  readonly config: NetConfig;
  readonly count: number;
  readonly pos: Float64Array;
  private readonly prev: Float64Array;
  private readonly inv: Float64Array; // 1/massa (0 = gancho fixo no aro)
  /** Pares de índices dos cordões. */
  readonly segments: Int32Array;
  private readonly restLength: Float64Array;
  private readonly anchor: Int32Array; // gancho do tirante de cada nó
  private readonly tether: Float64Array; // comprimento máximo (pela trama) até o gancho
  private readonly axis: Vec3; // centro do aro
  /** Altura máxima dos nós soltos: a dos ganchos, que ficam pendurados logo abaixo do tubo do aro. */
  readonly ceilingZ: number;
  private readonly ballInv: number;

  constructor(hoop: HoopSpec, config: NetConfig = defaultNetConfig(), ballMass = defaultBallSpec().mass) {
    this.config = config;
    const { hooks, rows } = config;
    this.count = hooks * (rows + 1);
    this.pos = new Float64Array(this.count * 3);
    this.prev = new Float64Array(this.count * 3);
    this.inv = new Float64Array(this.count);
    this.ballInv = 1 / ballMass;
    this.axis = hoop.rimCenter();

    // Ganchos logo abaixo do tubo, na linha do centro dele (as alças da rede): com os nós nunca acima dos ganchos,
    // todo cordão fica abaixo do aro.
    const topRadius = hoop.rimCenterlineRadius();
    const topZ = hoop.rimPlaneZ() - hoop.rimTubeRadius - config.cordRadius - 0.002;
    this.ceilingZ = topZ;
    const knotMass = config.mass / this.count;
    for (let r = 0; r <= rows; r++) {
      const f = r / rows;
      // Afunila mais embaixo, como a rede pendurada.
      const radius = topRadius + (config.bottomRadius - topRadius) * Math.pow(f, 0.85);
      const z = topZ - config.length * f;
      for (let i = 0; i < hooks; i++) {
        const angle = (2 * Math.PI * (i + (r % 2) * 0.5)) / hooks;
        const k = this.index(r, i);
        this.pos[k * 3] = this.axis.x + radius * Math.cos(angle);
        this.pos[k * 3 + 1] = this.axis.y + radius * Math.sin(angle);
        this.pos[k * 3 + 2] = z;
        this.inv[k] = r === 0 ? 0 : 1 / knotMass;
      }
    }
    this.prev.set(this.pos);

    // Losangos: (r, i) liga em (r+1, i) e no vizinho do lado do deslocamento.
    const pairs: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < hooks; i++) {
        const side = r % 2 === 0 ? -1 : 1;
        pairs.push(this.index(r, i), this.index(r + 1, i));
        pairs.push(this.index(r, i), this.index(r + 1, (i + side + hooks) % hooks));
      }
    }
    this.segments = Int32Array.from(pairs);
    this.restLength = new Float64Array(this.segments.length / 2);
    for (let s = 0; s < this.restLength.length; s++) {
      this.restLength[s] = this.distance(this.segments[s * 2], this.segments[s * 2 + 1]);
    }

    // Tirantes: menor caminho pela trama até um gancho (Dijkstra simples; a rede é pequena).
    this.anchor = new Int32Array(this.count).fill(-1);
    this.tether = new Float64Array(this.count).fill(Infinity);
    for (let i = 0; i < hooks; i++) {
      this.anchor[i] = i;
      this.tether[i] = 0;
    }
    const done = new Uint8Array(this.count);
    for (;;) {
      let best = -1;
      for (let k = 0; k < this.count; k++) if (!done[k] && this.tether[k] < Infinity && (best < 0 || this.tether[k] < this.tether[best])) best = k;
      if (best < 0) break;
      done[best] = 1;
      for (let s = 0; s < this.restLength.length; s++) {
        const a = this.segments[s * 2];
        const b = this.segments[s * 2 + 1];
        const other = a === best ? b : b === best ? a : -1;
        if (other < 0 || done[other]) continue;
        const d = this.tether[best] + this.restLength[s];
        if (d < this.tether[other]) {
          this.tether[other] = d;
          this.anchor[other] = this.anchor[best];
        }
      }
    }
  }

  index(row: number, hook: number): number {
    return row * this.config.hooks + hook;
  }

  knot(k: number): Vec3 {
    return new Vec3(this.pos[k * 3], this.pos[k * 3 + 1], this.pos[k * 3 + 2]);
  }

  private distance(a: number, b: number): number {
    const dx = this.pos[a * 3] - this.pos[b * 3];
    const dy = this.pos[a * 3 + 1] - this.pos[b * 3 + 1];
    const dz = this.pos[a * 3 + 2] - this.pos[b * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Avança dt segundos. Com bola (em voo), resolve o contato e corrige a bola no lugar (posição e velocidade).
   * Chamar logo depois do BallSim.tick, com o mesmo dt.
   */
  step(dt: number, ball: BallState | null = null, ballRadius = defaultBallSpec().radius): NetContact {
    const contact: NetContact = { touched: false, deltaV: 0 };
    const steps = Math.max(1, this.config.substeps);
    const h = dt / steps;
    // A bola fica num buffer mutável durante o passo e volta ao BallState no fim.
    const b = ball ? [ball.position.x, ball.position.y, ball.position.z] : null;
    const start = b ? [...b] : null;
    // Só perto da rede vale a pena testar contato.
    const near = b ? this.ballNear(b, ballRadius) : false;

    for (let step = 0; step < steps; step++) {
      this.integrate(h);
      for (let it = 0; it < this.config.iterations; it++) {
        if (b && near && this.solveContacts(b, ballRadius, false)) contact.touched = true;
        this.solveDistances();
        this.solveTethers();
        this.solveCeiling();
      }
      // Passada final: nó no limite do tirante (ou encostado no teto) não cede mais, a bola é que sai.
      if (b && near && this.solveContacts(b, ballRadius, true)) contact.touched = true;
      this.solveCeiling();
    }

    if (ball && b && start) {
      const dx = b[0] - start[0];
      const dy = b[1] - start[1];
      const dz = b[2] - start[2];
      if (dx !== 0 || dy !== 0 || dz !== 0 || contact.touched) {
        let v = ball.velocity.add(new Vec3(dx, dy, dz).scale(1 / dt));
        if (contact.touched) v = v.scale(Math.max(0, 1 - this.config.ballDrag * dt));
        contact.deltaV = v.sub(ball.velocity).length();
        ball.position = new Vec3(b[0], b[1], b[2]);
        ball.velocity = v;
      }
    }
    return contact;
  }

  private ballNear(b: number[], radius: number): boolean {
    const dx = b[0] - this.axis.x;
    const dy = b[1] - this.axis.y;
    const top = this.axis.z + radius;
    const bottom = this.axis.z - this.config.length * 1.6 - radius;
    return b[2] < top && b[2] > bottom && dx * dx + dy * dy < (0.45 + radius) ** 2;
  }

  private integrate(h: number): void {
    const keep = 1 - this.config.damping;
    const g = this.config.gravity * h * h;
    for (let k = 0; k < this.count; k++) {
      if (this.inv[k] === 0) continue;
      for (let c = 0; c < 3; c++) {
        const i = k * 3 + c;
        const x = this.pos[i];
        this.pos[i] += (x - this.prev[i]) * keep - (c === 2 ? g : 0);
        this.prev[i] = x;
      }
    }
  }

  private solveDistances(): void {
    for (let s = 0; s < this.restLength.length; s++) {
      const a = this.segments[s * 2];
      const b = this.segments[s * 2 + 1];
      const wa = this.inv[a];
      const wb = this.inv[b];
      const w = wa + wb;
      if (w === 0) continue;
      const dx = this.pos[b * 3] - this.pos[a * 3];
      const dy = this.pos[b * 3 + 1] - this.pos[a * 3 + 1];
      const dz = this.pos[b * 3 + 2] - this.pos[a * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      // Cordão: não estica; encolher (ficar frouxo) é permitido só um pouco (corda, não haste).
      const rest = this.restLength[s];
      if (d < rest * 0.6 || d > rest) {
        const target = d > rest ? rest : rest * 0.6;
        const k = (d - target) / (d * w);
        this.pos[a * 3] += dx * k * wa;
        this.pos[a * 3 + 1] += dy * k * wa;
        this.pos[a * 3 + 2] += dz * k * wa;
        this.pos[b * 3] -= dx * k * wb;
        this.pos[b * 3 + 1] -= dy * k * wb;
        this.pos[b * 3 + 2] -= dz * k * wb;
      }
    }
  }

  private solveTethers(): void {
    for (let k = 0; k < this.count; k++) {
      if (this.inv[k] === 0) continue;
      const a = this.anchor[k];
      const dx = this.pos[k * 3] - this.pos[a * 3];
      const dy = this.pos[k * 3 + 1] - this.pos[a * 3 + 1];
      const dz = this.pos[k * 3 + 2] - this.pos[a * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const max = this.tether[k];
      if (d > max && d > 1e-9) {
        const f = max / d;
        this.pos[k * 3] = this.pos[a * 3] + dx * f;
        this.pos[k * 3 + 1] = this.pos[a * 3 + 1] + dy * f;
        this.pos[k * 3 + 2] = this.pos[a * 3 + 2] + dz * f;
      }
    }
  }

  /** Teto da rede: nó solto nunca acima dos ganchos (o cordão não pode cruzar o tubo do aro). */
  private solveCeiling(): void {
    for (let k = 0; k < this.count; k++) {
      if (this.inv[k] !== 0 && this.pos[k * 3 + 2] > this.ceilingZ) this.pos[k * 3 + 2] = this.ceilingZ;
    }
  }

  private atTetherLimit(k: number): boolean {
    if (this.inv[k] === 0) return true;
    if (this.pos[k * 3 + 2] >= this.ceilingZ - 1e-4) return true;
    const a = this.anchor[k];
    const dx = this.pos[k * 3] - this.pos[a * 3];
    const dy = this.pos[k * 3 + 1] - this.pos[a * 3 + 1];
    const dz = this.pos[k * 3 + 2] - this.pos[a * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz) >= this.tether[k] * 0.995;
  }

  /** Contato bola × cordões (cápsulas). hard = nós no limite ficam fixos e a bola leva a correção toda. */
  private solveContacts(b: number[], radius: number, hard: boolean): boolean {
    const minD = radius + this.config.cordRadius;
    let touched = false;
    for (let s = 0; s < this.restLength.length; s++) {
      const ia = this.segments[s * 2];
      const ib = this.segments[s * 2 + 1];
      const ax = this.pos[ia * 3];
      const ay = this.pos[ia * 3 + 1];
      const az = this.pos[ia * 3 + 2];
      const ex = this.pos[ib * 3] - ax;
      const ey = this.pos[ib * 3 + 1] - ay;
      const ez = this.pos[ib * 3 + 2] - az;
      const len2 = ex * ex + ey * ey + ez * ez;
      let t = len2 > 1e-12 ? ((b[0] - ax) * ex + (b[1] - ay) * ey + (b[2] - az) * ez) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + ex * t;
      const cy = ay + ey * t;
      const cz = az + ez * t;
      let nx = b[0] - cx;
      let ny = b[1] - cy;
      let nz = b[2] - cz;
      const d = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (d >= minD) continue;
      touched = true;
      if (d > 1e-9) {
        nx /= d;
        ny /= d;
        nz /= d;
      } else {
        // Centro em cima do cordão: empurra para dentro da rede (eixo do aro).
        nx = this.axis.x - cx;
        ny = this.axis.y - cy;
        nz = 0;
        const l = Math.sqrt(nx * nx + ny * ny) || 1;
        nx /= l;
        ny /= l;
      }
      const penetration = minD - d;
      const wa = hard && this.atTetherLimit(ia) ? 0 : this.inv[ia];
      const wb = hard && this.atTetherLimit(ib) ? 0 : this.inv[ib];
      const wBall = this.ballInv;
      const denom = wBall + (1 - t) * (1 - t) * wa + t * t * wb;
      const lambda = penetration / denom;
      b[0] += nx * lambda * wBall;
      b[1] += ny * lambda * wBall;
      b[2] += nz * lambda * wBall;
      const ka = lambda * wa * (1 - t);
      const kb = lambda * wb * t;
      this.pos[ia * 3] -= nx * ka;
      this.pos[ia * 3 + 1] -= ny * ka;
      this.pos[ia * 3 + 2] -= nz * ka;
      this.pos[ib * 3] -= nx * kb;
      this.pos[ib * 3 + 1] -= ny * kb;
      this.pos[ib * 3 + 2] -= nz * kb;
    }
    return touched;
  }

  /** Menor distância do centro da bola a um cordão menos o raio (negativo = a bola está dentro do cordão). */
  clearance(center: Vec3, radius: number): number {
    let best = Infinity;
    for (let s = 0; s < this.restLength.length; s++) {
      const a = this.knot(this.segments[s * 2]);
      const e = this.knot(this.segments[s * 2 + 1]).sub(a);
      const len2 = e.lengthSquared();
      const t = len2 > 1e-12 ? Math.min(1, Math.max(0, center.sub(a).dot(e) / len2)) : 0;
      best = Math.min(best, center.sub(a.add(e.scale(t))).length() - radius - this.config.cordRadius);
    }
    return best;
  }

  /** Altura do nó solto mais alto (nunca passa do teto). */
  highestFreeZ(): number {
    let z = -Infinity;
    for (let k = 0; k < this.count; k++) if (this.inv[k] !== 0) z = Math.max(z, this.pos[k * 3 + 2]);
    return z;
  }

  /**
   * Menor folga entre os cordões e o tubo do aro (m; negativo = cordão dentro do tubo).
   */
  rimClearance(hoop: HoopSpec): number {
    const center = hoop.rimCenter();
    const R = hoop.rimCenterlineRadius();
    let best = Infinity;
    for (let s = 0; s < this.restLength.length; s++) {
      const a = this.knot(this.segments[s * 2]);
      const e = this.knot(this.segments[s * 2 + 1]).sub(a);
      for (let i = 0; i <= 10; i++) {
        const p = a.add(e.scale(i / 10)).sub(center);
        const ring = Math.hypot(Math.hypot(p.x, p.y) - R, p.z);
        best = Math.min(best, ring - hoop.rimTubeRadius - this.config.cordRadius);
      }
    }
    return best;
  }

  /** Altura do nó mais baixo (a rede "sobe" quando a bola passa). */
  lowestZ(): number {
    let z = Infinity;
    for (let k = 0; k < this.count; k++) z = Math.min(z, this.pos[k * 3 + 2]);
    return z;
  }
}
