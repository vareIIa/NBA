// Gravador do jogador local para o boneco remoto (docs/24 §5): se pendura no PlayerAnimator e anota os comandos que o
// jogo dá (drible, arremesso, bandeja, comemoração, defesa…) e, a cada quadro, a entrada da locomoção, a posição, a
// direção e o estado da defesa (mãos e pulo, que a contestação do outro lado lê).
// Não lê nem muda o Freestyle. `drain(bola)` devolve o payload do envio (~20 vezes por segundo) e esvazia a fila.
//
// Uso:
//   const rec = AnimRecorder.attach(animator);
//   net.send({ t: 'st', d: rec.drain(bolaOuNull) });
//   rec.detach();
import type { AnimInput, PlayerAnimator } from '../anim/PlayerAnimator';
import { type AnimCommand, type BallTransform, MaxCommands, type Payload, PayloadVersion, type PoseSample, type V3 } from './Payload';
import { type Json, round, toWire } from './Wire';

/** Comandos e o update do animador: o que o Freestyle chama e o boneco precisa repetir. */
const Recorded = [
  'update',
  'playMove',
  'playShot',
  'releaseShot',
  'celebrate',
  'endCelebration',
  'playFinish',
  'playLayup',
  'holdLayup',
  'setHoldPose',
  'playIdleGesture',
  'setHandsUp',
  'playContest',
  'playSteal',
] as const;
type RecordedName = (typeof Recorded)[number];

export type RecordableAnimator = Pick<PlayerAnimator, RecordedName | 'root' | 'layupTime' | 'ballInHand' | 'defenseState'>;

/** Pull-up: a velocidade do carry vai amostrada a cada CarryStep s, por CarrySpan s (o arremesso inteiro). */
const CarryStep = 0.04;
const CarrySpan = 2;
/** Filtro da velocidade da raiz (s). Acima de TeleportSpeed (m/s) foi teletransporte: zera. */
const VelocityTau = 0.04;
const TeleportSpeed = 25;

type Frame = Omit<PoseSample, 'ball'>;

const toV3 = (v: { x: number; y: number; z: number }, digits = 3): V3 => [round(v.x, digits), round(v.y, digits), round(v.z, digits)];

export class AnimRecorder {
  private static readonly busy = new WeakSet<object>();
  private readonly restore: (() => void)[] = [];
  private commands: AnimCommand[] = [];
  private frame: Frame | null = null;
  private lastP: V3 | null = null;
  private lastT = Number.NaN;
  private w: V3 = [0, 0, 0];
  private lastLayupTime = Number.NaN;
  private pendingHold: { pose: Json; t: number } | null = null;
  private attached = true;

  private constructor(
    private readonly animator: RecordableAnimator,
    private readonly clock: () => number,
  ) {}

  /** Começa a gravar. `clock` = relógio em s (o mesmo dos dois lados não importa: o boneco estima a diferença). */
  static attach(animator: RecordableAnimator, clock: () => number = () => performance.now() / 1000): AnimRecorder {
    if (AnimRecorder.busy.has(animator)) throw new Error('este animador já tem um gravador');
    AnimRecorder.busy.add(animator);
    const rec = new AnimRecorder(animator, clock);
    rec.wrap('update', (_dt, input) => rec.captureFrame(input));
    rec.wrap('playMove', (kind, hand, dur) => rec.push({ op: 'move', t: rec.clock(), kind, hand, dur: round(dur) }));
    rec.wrap('playShot', (hand, ideal, setup, wait, pullUp) => {
      const cmd: Extract<AnimCommand, { op: 'shot' }> = { op: 'shot', t: rec.clock(), hand, ideal: round(ideal), wait: wait ? 1 : 0 };
      if (setup) cmd.setup = { ...setup };
      if (pullUp) {
        const sp: number[] = [];
        for (let t = 0; t <= CarrySpan + 1e-9; t += CarryStep) sp.push(round(pullUp.carry.speedAt(t), 3));
        cmd.pull = { m: round(pullUp.momentum), dir: toV3(pullUp.carry.dir, 4), dt: CarryStep, sp };
      }
      rec.push(cmd);
    });
    rec.wrap('releaseShot', () => rec.push({ op: 'release', t: rec.clock() }));
    rec.wrap('celebrate', () => rec.push({ op: 'celebrate', t: rec.clock() }));
    rec.wrap('endCelebration', () => rec.push({ op: 'endCelebration', t: rec.clock() }));
    rec.wrap('playFinish', (dunk, hand, timing, air) =>
      rec.push({ op: 'finish', t: rec.clock(), dunk: dunk ? 1 : 0, hand, timing: [round(timing.gather), round(timing.release), round(timing.end)], air: round(air) }),
    );
    rec.wrap('playLayup', (plan, ball) => rec.push({ op: 'layup', t: rec.clock(), plan: toWire(plan), ball: toV3(ball) }));
    rec.wrap('holdLayup', (pose, ball) => rec.push({ op: 'hold', t: rec.clock(), pose: toWire(pose), ball: toV3(ball) }));
    rec.wrap('setHoldPose', (pose, t) => {
      rec.pendingHold = { pose: toWire(pose, 3), t: round(t) };
    });
    rec.wrap('playIdleGesture', (name) => rec.push({ op: 'gesture', t: rec.clock(), name }));
    rec.wrap('setHandsUp', (up) => rec.push({ op: 'hands', t: rec.clock(), up: up ? 1 : 0 }));
    rec.wrap('playContest', (h) => rec.push({ op: 'contest', t: rec.clock(), h: round(h, 3) }));
    rec.wrap('playSteal', (hand) => rec.push({ op: 'steal', t: rec.clock(), hand }));
    return rec;
  }

  /**
   * Payload do envio: o último quadro, a bola (null se este cliente não tem a bola; senão a que ele desenhou neste
   * quadro) e os comandos desde o envio anterior.
   */
  drain(ball: BallTransform | null): Payload {
    const f = this.frame ?? this.frameFromRoot();
    const s: PoseSample = {
      ...f,
      ball: ball && {
        p: [round(ball.p[0], 3), round(ball.p[1], 3), round(ball.p[2], 3)],
        q: [round(ball.q[0]), round(ball.q[1]), round(ball.q[2]), round(ball.q[3])],
        s: [round(ball.s[0], 3), round(ball.s[1], 3), round(ball.s[2], 3)],
      },
    };
    const out: Payload = { v: PayloadVersion, s };
    if (this.commands.length > 0) {
      out.c = this.commands.slice(-MaxCommands);
      this.commands = [];
    }
    return out;
  }

  /** Para de gravar e devolve o animador como era. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    for (const undo of this.restore.reverse()) undo();
    this.restore.length = 0;
    AnimRecorder.busy.delete(this.animator);
  }

  // ------------------------------------------------------------------------------------------- interno

  /** Troca o método por um que anota antes e chama o original. Anotar nunca pode quebrar o jogo local. */
  private wrap<K extends RecordedName>(name: K, note: (...args: Parameters<PlayerAnimator[K]>) => void): void {
    const target = this.animator as unknown as Record<string, unknown>;
    const own = Object.hasOwn(target, name);
    const original = target[name] as (...args: unknown[]) => unknown;
    if (typeof original !== 'function') return; // animador sem esse comando (falso dos testes): nada a anotar
    target[name] = (...args: unknown[]): unknown => {
      try {
        note(...(args as Parameters<PlayerAnimator[K]>));
      } catch (error) {
        console.warn(`gravador: ${name} não anotado`, error);
      }
      return original.apply(this.animator, args);
    };
    this.restore.push(() => {
      if (own) target[name] = original;
      else delete target[name];
    });
  }

  private push(cmd: AnimCommand): void {
    this.commands.push(cmd);
    if (this.commands.length > MaxCommands) this.commands.shift();
  }

  private captureFrame(input: AnimInput): void {
    const t = this.clock();
    const r = this.animator.root;
    const p: V3 = [r.position.x, r.position.y, r.position.z];
    if (this.lastP && t > this.lastT) {
      const dt = t - this.lastT;
      const raw: V3 = [(p[0] - this.lastP[0]) / dt, (p[1] - this.lastP[1]) / dt, (p[2] - this.lastP[2]) / dt];
      if (Math.hypot(...raw) > TeleportSpeed) {
        this.w = [0, 0, 0];
      } else {
        const k = 1 - Math.exp(-dt / VelocityTau);
        this.w = [this.w[0] + (raw[0] - this.w[0]) * k, this.w[1] + (raw[1] - this.w[1]) * k, this.w[2] + (raw[2] - this.w[2]) * k];
      }
    }
    if (!this.lastP || t > this.lastT) {
      this.lastP = p;
      this.lastT = t;
    }
    const frame: Frame = {
      t: round(t, 4),
      p: [round(p[0], 3), round(p[1], 3), round(p[2], 3)],
      w: [round(this.w[0], 2), round(this.w[1], 2), round(this.w[2], 2)],
      y: round(r.rotation.y, 4),
      a: [round(input.right, 2), round(input.forward, 2), round(input.accelRight, 2), round(input.accelForward, 2)],
      h: input.ballHand,
      b: input.hasBall ? 1 : 0,
      l: input.low ? 1 : 0,
      i: this.animator.ballInHand ? 1 : 0,
    };
    // O Freestyle só mexe no layupTime durante a bandeja: vai junto só quando mudou.
    const lt = this.animator.layupTime;
    if (Number.isFinite(lt) && lt !== this.lastLayupTime) frame.lt = round(lt, 4);
    this.lastLayupTime = lt;
    if (this.pendingHold) {
      frame.hp = this.pendingHold;
      this.pendingHold = null;
    }
    // Defesa: só quando há alguma (o resto do tempo a amostra não cresce).
    const d = typeof this.animator.defenseState === 'function' ? this.animator.defenseState() : null;
    if (d && (d.handsUp > 0.01 || d.jump > 0.005)) frame.df = [round(d.handsUp, 2), round(d.jump, 3)];
    this.frame = frame;
  }

  private frameFromRoot(): Frame {
    const r = this.animator.root;
    return {
      t: round(this.clock(), 4),
      p: toV3(r.position),
      w: [0, 0, 0],
      y: round(r.rotation.y, 4),
      a: [0, 0, 0, 0],
      h: 'r',
      b: 0,
      l: 0,
      i: this.animator.ballInHand ? 1 : 0,
    };
  }
}
