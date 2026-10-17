// Cabeça da CPU no 1x1 (docs/25-1x1-cpu-e-defesa.md §2). Não mexe no jogo: lê uma "vista" (CpuView, montada pelo
// CpuOpponent a cada quadro) e devolve o controle que um jogador apertaria (CpuCommand: LS, RT, LT, X, Y, RS). A CPU
// joga pelos mesmos caminhos que o jogador: dribles saem de gestos de verdade no Pro Stick, o arremesso é X segurado e
// solto com erro de timing, a bandeja é X dirigindo, o toco é o Y na hora certa.
//
// Defesa: vê o atacante com atraso (reactionS do nível) e antecipa pela velocidade; fica entre ele e a cesta numa
// distância que depende de onde ele está (respeita o arremesso, cola perto do aro); batido, corre (RT) para recuperar.
// Contestação: mãos para cima no arremesso e o pulo no tempo do lance (o pulo cedo morde o pump fake, mas é como sai o
// toco; o disciplinado espera o atacante sair do chão e só contesta). Bandeja: pula no tempo da soltura. Roubo: tapa
// quando a bola fica exposta perto dele (e fica desequilibrado um instante depois de cada tapa).
// Ataque: limpa a bola quando precisa; lê o defensor (distância, se está na frente, no ar, batido) e escolhe entre
// arremessar, infiltrar, driblar para criar espaço ou fazer pump fake, pelo estilo do jogador e com ruído do nível.
import type { BallStatus } from '../../net/protocol';
import { DribbleMove, StickDir, Vec3, clamp, mirrorDir } from '../../sim';
import { jumpPeakS } from '../../sim/HoopsBlock';
import { LowPickupZ } from '../ReboundCatch';
import type { CpuLevelSpec, CpuStyle } from './CpuRoster';

export type CpuPhase = 'dribble' | 'gather' | 'flight' | 'loose' | 'return';

export interface CpuRatings {
  three: number;
  mid: number;
  close: number;
  layup: number;
  dunk: number;
  canDunk: boolean;
  perimeterDefense: number;
  steal: number;
  block: number;
  /** Altura do pulo de contestação (m). */
  jumpM: number;
  heightM: number;
}

export interface CpuSelfView {
  pos: Vec3;
  vel: Vec3;
  facing: Vec3;
  phase: CpuPhase;
  hand: 'l' | 'r';
  /** Pode começar um drible ou o arremesso agora (drible fora do commit, bola na mão). */
  canAct: boolean;
  /** Um drible está em andamento. */
  moveBusy: boolean;
  /** Arremesso (não bandeja) em andamento e a janela dele (ms do gather à soltura ideal). */
  gathering: boolean;
  shotIdealMs: number | null;
  /** Bandeja ou enterrada em andamento, e se a bola já saiu. */
  finishing: boolean;
  finishReleased: boolean;
  /** No ar pelo pulo da defesa. */
  jumping: boolean;
  /** Energia do drible (0..1). */
  energy: number;
}

export interface CpuOppView {
  pos: Vec3;
  vel: Vec3;
  facing: Vec3;
  /** Driblando (bola na mão, sem arremesso). */
  dribbling: boolean;
  /** Arremesso em andamento (gather, ainda no chão ou no ar), saiu do chão, bandeja e quanto falta para a soltura. */
  gathering: boolean;
  shotAirborne: boolean;
  finishing: boolean;
  layupReleaseIn: number | null;
  /** Bola dele agora (núcleo) e a exposição dela para mim (net/defense ballExposure). */
  ballPos: Vec3 | null;
  exposure: number;
  /** Pulo dele (defendendo) e mãos para cima. */
  jumping: boolean;
  /** Arremesso de 3 e de meia dele (25–99): a distância da marcação. */
  three: number;
  mid: number;
}

export interface CpuView {
  /** Relógio do jogo (s) e o quadro (s). */
  now: number;
  dt: number;
  /** Bola em jogo (fora do check, da pausa depois da cesta e do fim). */
  live: boolean;
  /** A posse é minha. */
  offense: boolean;
  ball: BallStatus;
  needsClear: boolean;
  /** s no relógio de posse (Infinity sem relógio). */
  shotClockS: number;
  rimFloor: Vec3;
  /** Raio da linha de 3 (m). */
  arc: number;
  isThree: (p: Vec3) => boolean;
  me: CpuSelfView;
  opp: CpuOppView;
  /** Bola no ar ou solta: onde ela vai dar para pegar (núcleo), a bola agora e em quanto tempo (s). */
  rebound: { spot: Vec3; ball: Vec3; landIn: number } | null;
  /** O tapa do roubo está liberado (um a cada StealCooldownMs) e o alcance dele (m). */
  stealReady: boolean;
  stealReach: number;
}

export interface CpuCommand {
  moveX: number;
  moveY: number;
  /** Frente da "câmera" da CPU (núcleo): o LS é relativo a ela, como o do jogador à câmera dele. */
  camForward: Vec3;
  sprint: boolean;
  protect: boolean;
  shoot: boolean;
  shootEdgeTime: number;
  proX: number;
  proY: number;
  contest: boolean;
}

/** Gesto do Pro Stick no tempo (o reconhecedor do jogo vê um gesto de verdade). */
export class StickScript {
  private start = 0;
  private kind: 'none' | 'flick' | 'turn' = 'none';
  private dir = new Vec3();
  private from = 0;
  private sweep = 0;
  private dur = 0;

  /** Toque numa direção: vai à borda, fica `holdS` s e volta ao centro. */
  flick(now: number, dir: StickDir, holdS = 0.07): void {
    const a = ((90 - 45 * dir) * Math.PI) / 180;
    this.kind = 'flick';
    this.start = now;
    this.dir = new Vec3(Math.cos(a), Math.sin(a), 0);
    this.dur = holdS;
  }

  /** Giro (spin: ~300°, meio giro: ~110°) começando em cima; horário = sweep negativo. */
  turn(now: number, sweepDeg: number, durS: number): void {
    this.kind = 'turn';
    this.start = now;
    this.from = 90;
    this.sweep = sweepDeg;
    this.dur = durS;
  }

  busy(now: number): boolean {
    return this.kind !== 'none' && now - this.start <= this.dur + 0.05;
  }

  sample(now: number): { x: number; y: number } {
    const t = now - this.start;
    if (this.kind === 'none' || t < 0 || t > this.dur) {
      if (this.kind !== 'none' && t > this.dur + 0.05) this.kind = 'none';
      return { x: 0, y: 0 };
    }
    if (this.kind === 'flick') return { x: this.dir.x, y: this.dir.y };
    const a = ((this.from + (this.sweep * t) / this.dur) * Math.PI) / 180;
    return { x: Math.cos(a), y: Math.sin(a) };
  }
}

/** Direção do flick para o drible com a bola na mão `hand` (o núcleo resolve tudo como se a bola estivesse na direita). */
export function flickFor(move: DribbleMove, hand: 'l' | 'r'): StickDir | null {
  let dir: StickDir | null = null;
  switch (move) {
    case DribbleMove.Crossover:
    case DribbleMove.AttackingCrossover:
      dir = StickDir.Up;
      break;
    case DribbleMove.BetweenLegs:
      dir = StickDir.Left;
      break;
    case DribbleMove.BehindBack:
      dir = StickDir.DownLeft;
      break;
    case DribbleMove.Hesitation:
    case DribbleMove.EscapeHesitation:
      dir = StickDir.Right;
      break;
    case DribbleMove.InAndOut:
      dir = StickDir.UpRight;
      break;
    case DribbleMove.StepBack:
    case DribbleMove.EscapeStepBack:
      dir = StickDir.Down;
      break;
    case DribbleMove.Retreat:
      dir = StickDir.DownRight;
      break;
    default:
      return null;
  }
  return hand === 'r' ? dir : mirrorDir(dir);
}

/** O drible troca a bola de mão (a saída é para o lado da mão nova). */
const switchesHand = (move: DribbleMove): boolean =>
  move === DribbleMove.Crossover ||
  move === DribbleMove.AttackingCrossover ||
  move === DribbleMove.BetweenLegs ||
  move === DribbleMove.BehindBack ||
  move === DribbleMove.Spin;

/** Lado da saída do drible (+1 = direita de quem olha a cesta): o da mão nova, ou o da mesma mão se ela não troca. */
export const exitSide = (move: DribbleMove, hand: 'l' | 'r'): 1 | -1 => {
  const right = hand === 'r';
  return (switchesHand(move) ? !right : right) ? 1 : -1;
};

const rating01 = (r: number): number => clamp((r - 25) / 74, 0, 1);

/** Chance aproximada de cesta de um arremesso livre e "Bom" (o ShotModel decide de verdade; isto é só a leitura da IA). */
export function shotQuality(r: CpuRatings, distM: number, isThree: boolean): number {
  if (distM > 8.6) return 0.04;
  if (isThree) return clamp(0.16 + 0.36 * rating01(r.three) - 0.06 * Math.max(0, distM - 7.3), 0.02, 0.6);
  if (distM < 3.05) return 0.3 + 0.35 * rating01(r.close);
  return 0.22 + 0.38 * rating01(r.mid);
}

type Action =
  | { kind: 'idle'; until: number }
  | { kind: 'clear' }
  | { kind: 'drive'; side: 1 | -1; since: number; dunk: boolean }
  | { kind: 'move'; move: DribbleMove; then: 'drive' | 'shoot' | 'idle'; at: number; exit: 1 | -1 }
  | { kind: 'shoot' }
  | { kind: 'pump' };

interface Sample {
  t: number;
  pos: Vec3;
  vel: Vec3;
}

/** Erro normal (Box-Muller). */
function gauss(rand: () => number): number {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export class CpuBrain {
  private readonly stick = new StickScript();
  private readonly seen: Sample[] = [];
  private action: Action = { kind: 'idle', until: 0 };
  private decideAt = 0;
  /** Arremesso em andamento: quando apertou, o erro de timing (ms) e se é pump fake. */
  private shot: { pressAt: number; errMs: number; pump: boolean } | null = null;
  /** Bandeja: quando apertou o X (segura até a bola sair; na enterrada, pendura um pouco). */
  private finish: { pressAt: number; releasedAt: number } | null = null;
  /** Defesa: o arremesso visto (quando), o pulo marcado, se já pulou e quando o arremesso acabou sem a bola sair. */
  private defShot: { seenAt: number; bite: boolean; jumpAt: number; jumped: boolean; endedAt: number } | null = null;
  private layupJump: { jumpAt: number; jumped: boolean } | null = null;
  private stealPress = false;
  private stealRecoverUntil = 0;
  private contestPress = false;
  private reboundJumpAt = -Infinity;
  private reboundGrabAt = -Infinity;
  /** Para o debug: a última decisão do ataque. */
  lastDecision = '';

  constructor(
    private readonly ratings: CpuRatings,
    private readonly style: CpuStyle,
    private readonly level: CpuLevelSpec,
    private readonly rand: () => number = Math.random,
  ) {}

  /** Testes e laboratório: a próxima ação do ataque (arremesso, infiltração, pump fake ou esperar). */
  force(kind: 'shoot' | 'drive' | 'pump' | 'idle', now: number): void {
    if (kind === 'shoot') this.action = { kind: 'shoot' };
    else if (kind === 'pump') this.action = { kind: 'pump' };
    else if (kind === 'drive') this.action = { kind: 'drive', side: 1, since: now, dunk: this.wantsDunk() };
    else this.action = { kind: 'idle', until: now + 60 };
    this.decideAt = kind === 'idle' ? now + 60 : now + 0.5;
  }

  think(v: CpuView): CpuCommand {
    this.remember(v);
    const toRim = v.rimFloor.sub(v.me.pos).flat().normalized(v.me.facing);
    const cmd: CpuCommand = {
      moveX: 0,
      moveY: 0,
      camForward: toRim,
      sprint: false,
      protect: false,
      shoot: false,
      shootEdgeTime: v.now,
      proX: 0,
      proY: 0,
      contest: false,
    };
    if (!v.live) {
      this.resetPlay();
      return cmd;
    }
    if (v.offense && v.ball === 'held') this.offense(v, cmd);
    else if (!v.offense && v.ball === 'held') this.defense(v, cmd);
    else this.chaseBall(v, cmd);
    // Bordas de um quadro (tapa e pulo): o jogo lê o aperto, então solta no quadro seguinte.
    if (cmd.contest && this.contestPress) cmd.contest = false;
    this.contestPress = cmd.contest;
    return cmd;
  }

  // ------------------------------------------------------------------------------------------- percepção

  private remember(v: CpuView): void {
    this.seen.push({ t: v.now, pos: v.opp.pos, vel: v.opp.vel });
    while (this.seen.length > 2 && this.seen[1]!.t < v.now - 1) this.seen.shift();
  }

  /** O atacante como a CPU o vê: reactionS atrás, antecipado pela velocidade de então. */
  private perceived(v: CpuView, lookahead = 0.18): { pos: Vec3; vel: Vec3 } {
    const t = v.now - this.level.reactionS;
    let s = this.seen[0]!;
    for (const x of this.seen) {
      if (x.t > t) break;
      s = x;
    }
    return { pos: s.pos.add(s.vel.flat().scale(lookahead + this.level.reactionS * 0.5)), vel: s.vel };
  }

  private resetPlay(): void {
    this.shot = null;
    this.finish = null;
    this.defShot = null;
    this.layupJump = null;
    this.action = { kind: 'idle', until: 0 };
    this.decideAt = 0;
  }

  // ------------------------------------------------------------------------------------------- movimento

  /** LS para ir até `target` (núcleo), no referencial da câmera da CPU. `gain` = 1/m (perto, devagar). */
  private steer(cmd: CpuCommand, from: Vec3, target: Vec3, gain = 1.8, scale = 1): number {
    const err = target.sub(from).flat();
    const d = err.length2D();
    const wish = d > 1e-3 ? err.scale(Math.min(1, d * gain) / d) : new Vec3();
    this.setLS(cmd, wish.scale(scale));
    return d;
  }

  private setLS(cmd: CpuCommand, wish: Vec3): void {
    const f = cmd.camForward;
    const r = new Vec3(0, 0, 1).cross(f).normalized(); // eixos da Unreal: direita = cima × frente
    cmd.moveX = clamp(wish.dot(r), -1, 1);
    cmd.moveY = clamp(wish.dot(f), -1, 1);
  }

  // ------------------------------------------------------------------------------------------- ataque

  private offense(v: CpuView, cmd: CpuCommand): void {
    const me = v.me;
    this.defShot = null;
    this.layupJump = null;
    if (this.shot || me.gathering) {
      this.holdShot(v, cmd);
      return;
    }
    if (this.finish || me.finishing) {
      this.holdFinish(v, cmd);
      return;
    }
    if (me.phase !== 'dribble') return;
    const s = this.stick.sample(v.now);
    cmd.proX = s.x;
    cmd.proY = s.y;
    const dirRim = v.rimFloor.sub(me.pos).flat().normalized(me.facing);
    const dRim = v.rimFloor.sub(me.pos).length2D();

    if (v.needsClear && this.action.kind !== 'clear' && !v.isThree(me.pos)) this.action = { kind: 'clear' };

    switch (this.action.kind) {
      case 'clear': {
        if (v.isThree(me.pos) && !v.needsClear) {
          this.action = { kind: 'idle', until: v.now + 0.2 + 0.4 * this.rand() };
          break;
        }
        // Sai pela linha de 3 do lado em que já está, 1 m além dela.
        const out = me.pos.sub(v.rimFloor).flat().normalized(new Vec3(1, 0, 0));
        const target = v.rimFloor.add(out.scale(v.arc + 1.0));
        const d = this.steer(cmd, me.pos, target, 1.2);
        cmd.sprint = d > 3;
        cmd.protect = !cmd.sprint && v.opp.pos.sub(me.pos).length2D() < 1.4;
        return;
      }
      case 'drive':
        this.drive(v, cmd, dRim, dirRim);
        return;
      case 'move': {
        const a = this.action;
        // Saída do drible: com o LS para o lado da mão nova (o embalo do drible leva o corpo).
        if (a.then === 'drive') {
          const right = new Vec3(0, 0, 1).cross(dirRim).normalized();
          this.setLS(cmd, dirRim.scale(0.75).add(right.scale(0.65 * a.exit)).normalized());
          cmd.sprint = a.move === DribbleMove.AttackingCrossover;
        }
        if (v.now - a.at < 0.12 || me.moveBusy || this.stick.busy(v.now)) return;
        if (a.then === 'drive') this.action = { kind: 'drive', side: a.exit, since: v.now, dunk: this.wantsDunk() };
        else if (a.then === 'shoot') this.action = { kind: 'shoot' };
        else this.action = { kind: 'idle', until: v.now + 0.15 + 0.3 * this.rand() };
        this.decideAt = v.now;
        return;
      }
      case 'shoot':
        if (me.canAct) this.pressShot(v, cmd, false);
        return;
      case 'pump':
        if (me.canAct) this.pressShot(v, cmd, true);
        return;
      case 'idle':
        break;
    }
    // Size-up: parado de frente para a cesta, drible no lugar; decide quando der.
    if (v.now >= this.decideAt && me.canAct) this.decide(v, dRim, dirRim);
  }

  /** Lê o defensor e escolhe a próxima ação (utilidade + ruído do nível). */
  private decide(v: CpuView, dRim: number, dirRim: Vec3): void {
    const me = v.me;
    const opp = v.opp;
    const st = this.style;
    const toDef = opp.pos.sub(me.pos).flat();
    const dDef = toDef.length2D();
    const ahead = toDef.dot(dirRim); // + = defensor entre mim e a cesta
    const beaten = ahead < 0.25;
    const isThree = v.isThree(me.pos);
    const quality = shotQuality(this.ratings, dRim, isThree);
    const open = Math.max(clamp((dDef - 0.9) / 1.9, 0, 1), beaten ? 0.85 : 0, opp.jumping ? 1 : 0);
    const closing = -opp.vel.flat().dot(toDef.normalized()) > 2.2 && dDef < 3;
    const urgency = v.shotClockS < 3.5 ? 2 : v.shotClockS < 6 ? 0.4 : 0;
    const noise = (): number => (this.rand() - 0.5) * this.level.noise;
    const options: { u: number; go: () => void; name: string }[] = [];

    const shootU = st.shoot * (0.2 + 0.8 * open) * quality * 2.4 + urgency + (dRim > 8.6 ? -1 : 0);
    options.push({ u: shootU + noise(), name: 'arremesso', go: () => (this.action = { kind: 'shoot' }) });

    const lane = beaten || opp.jumping ? 1 : dDef > 2.6 ? 0.55 : clamp(1 - (ahead - 0.3) / 1.4, 0.1, 0.6);
    const finishQ = 0.5 + 0.5 * rating01(this.ratings.canDunk ? Math.max(this.ratings.layup, this.ratings.dunk) : this.ratings.layup);
    const driveU = st.drive * lane * finishQ * (dRim > 2.2 ? 1 : 0.3) * (me.energy > 0.15 ? 1 : 0.6);
    options.push({ u: driveU + noise(), name: 'infiltra', go: () => this.startDrive(v, dirRim) });

    if (dDef < 2.2 && ahead > 0.3 && me.energy > 0.2) {
      const moveU = st.moves * 0.55 + (dDef < 1.3 ? 0.15 : 0);
      options.push({ u: moveU + noise(), name: 'drible', go: () => this.startMove(v, dDef) });
    }
    if (closing && st.shoot > 0.4) {
      options.push({ u: 0.45 * st.shoot + 0.3 * st.drive + noise(), name: 'pump fake', go: () => (this.action = { kind: 'pump' }) });
    }
    options.push({ u: 0.18 + noise(), name: 'espera', go: () => (this.action = { kind: 'idle', until: v.now + 0.25 + 0.45 * this.rand() }) });

    let best = options[0]!;
    for (const o of options) if (o.u > best.u) best = o;
    this.lastDecision = best.name;
    best.go();
    this.decideAt = v.now + 0.22 + 0.25 * this.rand();
  }

  private wantsDunk(): boolean {
    return this.ratings.canDunk && this.rand() < this.style.dunk;
  }

  private startDrive(v: CpuView, dirRim: Vec3): void {
    // Ataca o lado em que o defensor não está (do ponto de vista de quem olha a cesta).
    const right = new Vec3(0, 0, 1).cross(dirRim).normalized();
    const lean = v.opp.pos.sub(v.me.pos).flat().dot(right);
    const side: 1 | -1 = Math.abs(lean) < 0.15 ? (v.me.hand === 'r' ? 1 : -1) : lean > 0 ? -1 : 1;
    this.action = { kind: 'drive', side, since: v.now, dunk: this.wantsDunk() };
  }

  /** Drible para criar: step-back colado (arremessador), crossover/por trás/entre as pernas para atacar o outro lado, spin. */
  private startMove(v: CpuView, dDef: number): void {
    const me = v.me;
    const r = this.rand();
    let move: DribbleMove;
    let then: 'drive' | 'shoot' | 'idle' = 'drive';
    if (dDef < 1.35 && this.style.shoot > 0.6 && r < 0.5) {
      move = DribbleMove.StepBack;
      then = 'shoot';
    } else if (r < 0.45) {
      move = this.rand() < 0.45 ? DribbleMove.AttackingCrossover : DribbleMove.Crossover;
    } else if (r < 0.65) {
      move = DribbleMove.BehindBack;
    } else if (r < 0.8) {
      move = DribbleMove.BetweenLegs;
      then = this.rand() < 0.5 ? 'drive' : 'idle';
    } else if (r < 0.9) {
      move = DribbleMove.Hesitation;
    } else {
      move = DribbleMove.Spin;
    }
    if (move === DribbleMove.Spin) this.stick.turn(v.now, me.hand === 'r' ? -300 : 300, 0.18);
    else {
      const dir = flickFor(move, me.hand);
      if (dir === null) return;
      this.stick.flick(v.now, dir);
    }
    this.action = { kind: 'move', move, then, at: v.now, exit: exitSide(move, me.hand) };
  }

  private drive(v: CpuView, cmd: CpuCommand, dRim: number, dirRim: Vec3): void {
    const a = this.action as Extract<Action, { kind: 'drive' }>;
    const me = v.me;
    const opp = v.opp;
    const right = new Vec3(0, 0, 1).cross(dirRim).normalized();
    // Longe: entra pelo lado escolhido (passa pelo ombro do defensor); perto, direto no aro.
    const lateral = clamp((dRim - 2) / 3, 0, 1) * 1.1 * a.side;
    const aim = v.rimFloor.add(right.scale(lateral)).sub(dirRim.scale(clamp(dRim - 1.2, 0, 0.9)));
    this.steer(cmd, me.pos, aim, 3);
    const speed = me.vel.length2D();
    const approach = me.vel.flat().dot(dirRim);
    // Bandeja: RT solto um pouco antes do X; enterrada: RT segurado (o jogo decide pelo RT no aperto).
    const zone = a.dunk ? clamp(2.8 + 0.42 * speed, 2.8, 4.6) : clamp(2.6 + 0.36 * speed, 2.6, 4.4);
    cmd.sprint = a.dunk || dRim > zone + 0.9;
    if (dRim < zone - 0.15 && approach > 1.2 && me.canAct) {
      this.finish = { pressAt: v.now, releasedAt: -1 };
      cmd.shoot = true;
      cmd.shootEdgeTime = v.now;
      cmd.sprint = a.dunk;
      this.lastDecision = a.dunk ? 'enterrada' : 'bandeja';
      return;
    }
    // Cortado: defensor plantado na frente, perto. Spin/crossover para o outro lado, ou pull-up de quem arremessa.
    const toDef = opp.pos.sub(me.pos).flat();
    const blocked = toDef.dot(dirRim) > 0.2 && toDef.length2D() < 1.25 && dRim > 2.4;
    if (blocked && me.canAct && !this.stick.busy(v.now) && v.now - a.since > 0.35) {
      const r = this.rand();
      if (this.style.shoot > 0.5 && r < 0.45 * this.style.shoot) {
        this.action = { kind: 'shoot' };
      } else if (r < 0.7) {
        this.stick.turn(v.now, me.hand === 'r' ? -300 : 300, 0.18);
        this.action = { kind: 'move', move: DribbleMove.Spin, then: 'drive', at: v.now, exit: exitSide(DribbleMove.Spin, me.hand) };
      } else {
        const dir = flickFor(DribbleMove.Crossover, me.hand);
        if (dir !== null) this.stick.flick(v.now, dir);
        this.action = { kind: 'move', move: DribbleMove.Crossover, then: 'drive', at: v.now, exit: exitSide(DribbleMove.Crossover, me.hand) };
      }
      return;
    }
    if (v.now - a.since > 3 || dRim < 0.6) this.action = { kind: 'idle', until: v.now + 0.3 };
  }

  private pressShot(v: CpuView, cmd: CpuCommand, pump: boolean): void {
    // σ do timing pelo rating do arremesso daqui (o nível multiplica): 25 → 150 ms, 99 → 75 ms.
    const isThree = v.isThree(v.me.pos);
    const dRim = v.rimFloor.sub(v.me.pos).length2D();
    const rating = isThree ? this.ratings.three : dRim < 3.05 ? this.ratings.close : this.ratings.mid;
    const sigma = (150 - 75 * rating01(rating)) * this.level.timingScale;
    this.shot = { pressAt: v.now, errMs: gauss(this.rand) * sigma, pump };
    this.lastDecision = pump ? 'pump fake' : 'arremesso';
    cmd.shoot = true;
    cmd.shootEdgeTime = v.now;
  }

  private holdShot(v: CpuView, cmd: CpuCommand): void {
    const s = this.shot;
    const me = v.me;
    if (!s) {
      // Gather sem o aperto da CPU (não acontece): solta na janela ideal.
      cmd.shoot = false;
      return;
    }
    if (s.pump) {
      // Toque curto (< 120 ms): pump fake. Depois, se o defensor subiu, ataca.
      if (v.now - s.pressAt < 0.07) {
        cmd.shoot = true;
        return;
      }
      cmd.shoot = false;
      cmd.shootEdgeTime = v.now;
      this.shot = null;
      this.action = { kind: 'idle', until: v.now + 0.2 };
      this.decideAt = v.now + 0.12;
      return;
    }
    // O aperto não pegou (drible no commit): desiste depois de um tempo.
    if (!me.gathering && v.now - s.pressAt > 0.25) {
      this.shot = null;
      this.action = { kind: 'idle', until: v.now + 0.2 };
      return;
    }
    const ideal = me.shotIdealMs ?? 560;
    const releaseAt = s.pressAt + (ideal + s.errMs) / 1000;
    if (v.now >= releaseAt) {
      cmd.shoot = false;
      cmd.shootEdgeTime = Math.max(s.pressAt + 0.13, releaseAt);
      this.shot = null;
      this.action = { kind: 'idle', until: v.now + 0.5 };
    } else {
      cmd.shoot = true;
    }
  }

  private holdFinish(v: CpuView, cmd: CpuCommand): void {
    const f = this.finish ?? { pressAt: v.now, releasedAt: -1 };
    this.finish = f;
    const me = v.me;
    if (me.finishReleased && f.releasedAt < 0) f.releasedAt = v.now;
    // X segurado do aperto até a soltura (nunca um toque: o toque é o hop step); na enterrada, pendura ~0,3 s.
    const hang = this.style.dunk > 0.5 ? 0.3 : 0.05;
    cmd.shoot = f.releasedAt < 0 || v.now - f.releasedAt < hang;
    if (!cmd.shoot) cmd.shootEdgeTime = v.now;
    if (!me.finishing && (f.releasedAt >= 0 || v.now - f.pressAt > 0.9)) {
      this.finish = null;
      this.action = { kind: 'idle', until: v.now + 0.4 };
    }
  }

  // ------------------------------------------------------------------------------------------- defesa

  private defense(v: CpuView, cmd: CpuCommand): void {
    const me = v.me;
    const opp = v.opp;
    this.shot = null;
    this.finish = null;
    const seen = this.perceived(v);
    const toRimFromA = v.rimFloor.sub(seen.pos).flat();
    const dAR = toRimFromA.length2D();
    const dirAR = toRimFromA.normalized(me.facing.neg());
    const dOpp = opp.pos.sub(me.pos).length2D();

    // Marcação: entre o atacante e a cesta, mais longe dele onde o arremesso é pior.
    let cushion: number;
    if (dAR > 8.8) cushion = 2.2;
    else if (v.isThree(seen.pos)) cushion = 1.75 - 0.75 * rating01(opp.three);
    else if (dAR > 3.2) cushion = 1.5 - 0.55 * rating01(opp.mid);
    else cushion = 0.75;
    let spot = seen.pos.add(dirAR.scale(cushion));
    // Protetor de aro: com o atacante infiltrando perto, fica entre ele e o aro, mais perto do aro.
    if (this.style.rimProtect > 0.6 && dAR < 4.5) spot = v.rimFloor.add(dirAR.neg().scale(Math.max(0.9, dAR * 0.45)));
    // Batido: o atacante passou do meu ombro indo para a cesta. Corre para a frente dele (RT).
    const ahead = me.pos.sub(opp.pos).flat().dot(v.rimFloor.sub(opp.pos).flat().normalized());
    const beaten = ahead < 0.1 && opp.vel.flat().dot(v.rimFloor.sub(opp.pos).flat().normalized()) > 1.5;
    if (beaten) spot = opp.pos.add(v.rimFloor.sub(opp.pos).flat().normalized().scale(1.1)).add(opp.vel.flat().scale(0.3));

    // Contestação do arremesso e da bandeja (pode trocar o lugar: fecha no arremessador).
    const closeout = this.contest(v, cmd, dOpp);
    if (closeout) spot = opp.pos.add(opp.pos.sub(v.rimFloor).flat().normalized().scale(-0.75));

    const recovering = v.now < this.stealRecoverUntil;
    const d = this.steer(cmd, me.pos, spot, 2.4, recovering ? 0.35 : 1);
    cmd.sprint = !recovering && (beaten || d > 1.6 || (closeout && dOpp > 2.2));

    // Roubo: tapa quando a bola dele fica exposta perto de mim.
    if (this.stealPress) {
      this.stealPress = false;
    } else if (opp.dribbling && opp.ballPos && v.stealReady && !closeout && !me.jumping) {
      const reach = opp.ballPos.sub(me.pos).length2D();
      const rate = 3.2 * this.style.gamble * this.level.stealAppetite * clamp((opp.exposure - 0.3) / 0.6, 0, 1);
      if (reach < v.stealReach && this.rand() < 1 - Math.exp(-rate * v.dt)) {
        cmd.shoot = true;
        this.stealPress = true;
        this.stealRecoverUntil = v.now + 0.35;
      }
    }
  }

  /** Mãos e pulo no arremesso/bandeja do atacante. true = fechar nele (closeout). */
  private contest(v: CpuView, cmd: CpuCommand, dOpp: number): boolean {
    const opp = v.opp;
    const L = this.level;
    // Arremesso: visto com o atraso de reação.
    if (opp.gathering) {
      if (!this.defShot || this.defShot.endedAt >= 0) {
        // Tenta o toco (pula cedo, pelo começo do arremesso) quem tem rating de toco, colado; o nível só põe a mordida a
        // mais (o calouro pula em tudo) e o erro do tempo do pulo.
        const tryBlock = clamp(0.08 + 0.42 * rating01(this.ratings.block) + 0.3 * L.biteChance - (dOpp > 1.3 ? 0.25 : 0), 0, 0.85);
        this.defShot = { seenAt: v.now, bite: this.rand() < tryBlock, jumpAt: Infinity, jumped: false, endedAt: -1 };
      }
      const s = this.defShot;
      const since = v.now - s.seenAt;
      if (since < L.reactionS) return false;
      cmd.proY = 1; // mãos para cima
      if (!s.jumped && s.jumpAt === Infinity && dOpp < 1.9) {
        // Pula cedo (pelo começo do arremesso: dá toco, morde o pump fake) ou espera ele sair do chão (contesta).
        const lead = 0.56 + 0.06 - jumpPeakS(this.ratings.jumpM);
        if (s.bite) s.jumpAt = s.seenAt + Math.max(L.reactionS, lead) + gauss(this.rand) * L.jumpSigmaS;
        else if (opp.shotAirborne) s.jumpAt = v.now + 0.04 + Math.abs(gauss(this.rand)) * L.jumpSigmaS;
      }
      if (!s.jumped && v.now >= s.jumpAt) {
        s.jumped = true;
        cmd.contest = true;
      }
      return dOpp > 0.9;
    }
    // Pump fake: o arremesso acabou sem a bola sair. Quem marcou o pulo para antes de perceber o fake (o atraso de reação)
    // pula mesmo assim: mordeu. Percebeu antes, fica no chão.
    const s = this.defShot;
    if (s) {
      if (s.endedAt < 0) s.endedAt = v.now;
      if (!s.jumped && v.now >= s.jumpAt && s.jumpAt <= s.endedAt + L.reactionS) {
        s.jumped = true;
        cmd.contest = true;
      }
      if (v.now - s.endedAt > 0.8) this.defShot = null;
    }
    // Bandeja/enterrada: pula no tempo da soltura, se está perto do caminho.
    if (opp.finishing && opp.layupReleaseIn !== null) {
      if (!this.layupJump && dOpp < 2.6) {
        const at = v.now + Math.max(0, opp.layupReleaseIn - jumpPeakS(this.ratings.jumpM) + 0.07) + gauss(this.rand) * L.jumpSigmaS;
        this.layupJump = { jumpAt: Math.max(v.now + L.reactionS * 0.4, at), jumped: false };
      }
      const j = this.layupJump;
      if (j) {
        cmd.proY = 1;
        if (!j.jumped && v.now >= j.jumpAt) {
          j.jumped = true;
          cmd.contest = true;
        }
      }
      return false;
    }
    if (!opp.finishing) this.layupJump = null;
    return false;
  }

  // ------------------------------------------------------------------------------------------- bola solta

  private chaseBall(v: CpuView, cmd: CpuCommand): void {
    this.shot = null;
    this.finish = null;
    this.defShot = null;
    this.layupJump = null;
    const me = v.me;
    const r = v.rebound;
    if (!r) {
      // Sem previsão (bola na mão de ninguém e parada longe): vai para perto do aro.
      this.steer(cmd, me.pos, v.rimFloor.add(me.pos.sub(v.rimFloor).flat().normalized().scale(1.6)), 1.5);
      return;
    }
    const d = this.steer(cmd, me.pos, r.spot, 2.5);
    cmd.sprint = d > 1.2;
    // Rebote no ar: a bola alta chegando perto, pula (um pulo por bola).
    const near = r.ball.sub(me.pos).length2D();
    if (r.ball.z > 2.1 && r.ball.z < 3.6 && near < 1.1 && !me.jumping && v.now - this.reboundJumpAt > 1) {
      this.reboundJumpAt = v.now;
      cmd.contest = true;
    } else if (r.ball.z > LowPickupZ && r.ball.z <= 2.1 && near < 0.9 && !me.jumping && v.now - this.reboundGrabAt > 0.7) {
      // Bola na altura do peito chegando: pega parado com as duas mãos (X).
      this.reboundGrabAt = v.now;
      cmd.shoot = true;
    }
  }
}
