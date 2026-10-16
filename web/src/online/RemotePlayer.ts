// O adversário na tela (docs/24 §5): um boneco com o próprio PlayerAnimator, a roupa do outro time e a própria bola,
// que toca os comandos de animação que chegam pela rede (AnimRecorder do outro lado) na linha do tempo do outro
// jogador, ~100 ms no passado (Timeline).
//
// Bola: com a bola em jogo na mão do outro (AnimInput.hasBall), ela fica presa à mão DO BONECO pelo BallDribbler, como
// no Freestyle: a rede nunca tira a bola da mão dele. No voo e solta, mostra a bola que veio pela rede (quem arremessou
// manda nela). Sem bola (null), não mostra nada.
//
// Uso:
//   const remote = await RemotePlayer.load(scene, { heightCm, wingspanOverM, kit: 'branca' });
//   remote.push(d, performance.now() / 1000);   // a cada mensagem 'st'
//   remote.update(dt, performance.now() / 1000); // a cada quadro
import * as THREE from 'three';
import { type AnimInput, PlayerAnimator } from '../anim/PlayerAnimator';
import type { ShotCarry } from '../anim/JumpShotMotion';
import { bodyScaleOf } from '../build/BuildRatings';
import { BallDribbler } from '../game/BallDribbler';
import { buildBall } from '../game/BallMesh';
import { PlayerGear } from '../game/PlayerGear';
import { defaultBallSimConfig } from '../sim';
import type { HoldPose } from '../sim/HoopsHold';
import type { LayupPlan } from '../sim/HoopsLayup';
import { type AnimCommand, type V3, decodePayload } from './Payload';
import { CommandQueue, PoseBuffer, RemoteClock } from './Timeline';
import { fromWire } from './Wire';

export interface RemotePlayerOptions {
  heightCm: number;
  /** Envergadura além do modelo (m): o 2º argumento de PlayerAnimator.setBodyScale. */
  wingspanOverM: number;
  /** Uniforme do outro time (cada um se vê de vermelho e vê o adversário de branco). */
  kit: 'branca' | 'vermelha';
  /** Tênis (nome do GLB em assets/gear). */
  shoes?: string;
  /** Pasta dos assets (padrão 'assets/'). */
  assetsBase?: string;
  /** Quique da bola do boneco no chão (velocidade de chegada, m/s), para o som. */
  onFloorBounce?: (speed: number) => void;
}

type BallMode = 'none' | 'hand' | 'net';

/** Depois de tanto tempo com a mão da bola diferente da do outro jogador (sem drible tocando), o boneco troca. */
const HandFixSeconds = 0.3;
/** Raiz andou mais que isto num quadro: teletransporte (a bola gruda na mão de novo). */
const TeleportM = 1.5;

const IdleInput: AnimInput = { right: 0, forward: 0, ballHand: 'r', hasBall: false, low: false, accelRight: 0, accelForward: 0 };

/** Carry do pull-up de volta: velocidade amostrada, interpolada (a última vale depois do fim). */
function carryFrom(pull: { dir: V3; dt: number; sp: number[] }): ShotCarry {
  const { sp, dt } = pull;
  return {
    dir: new THREE.Vector3(...pull.dir).normalize(),
    speedAt: (t: number) => {
      const x = t / dt;
      if (!(x > 0)) return sp[0];
      const k = Math.floor(x);
      if (k >= sp.length - 1) return sp[sp.length - 1];
      return sp[k] + (sp[k + 1] - sp[k]) * (x - k);
    },
  };
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m) continue;
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
      m.dispose();
    }
  });
}

export class RemotePlayer {
  private readonly clock = new RemoteClock();
  private readonly buffer = new PoseBuffer();
  private readonly queue = new CommandQueue();
  private readonly ballMesh: THREE.Mesh;
  private readonly dribbler: BallDribbler;
  private readonly radius: number;
  private mode: BallMode = 'none';
  private squash = 0;
  private handMismatch = 0;
  private disposed = false;
  /** Diagnóstico: payloads recusados na validação e comandos que falharam ao tocar. */
  rejected = 0;
  failed = 0;

  private constructor(
    private readonly scene: THREE.Scene,
    readonly animator: PlayerAnimator,
    private readonly gear: PlayerGear | null,
    private readonly opts: RemotePlayerOptions,
  ) {
    this.radius = defaultBallSimConfig().ball.radius;
    this.ballMesh = buildBall(this.radius);
    this.ballMesh.name = 'bola do adversário';
    this.ballMesh.visible = false;
    this.dribbler = new BallDribbler(this.radius);
    animator.setBodyScale(bodyScaleOf(opts.heightCm), opts.wingspanOverM);
    animator.root.name = 'adversário';
    animator.root.visible = false; // aparece com a primeira amostra
    scene.add(animator.root);
    scene.add(this.ballMesh);
    animator.update(0, IdleInput);
  }

  /** Carrega o boneco (jogador + roupa). Sem a roupa, segue com o boneco liso. */
  static async load(scene: THREE.Scene, opts: RemotePlayerOptions): Promise<RemotePlayer> {
    const base = opts.assetsBase ?? 'assets/';
    const animator = await PlayerAnimator.load(`${base}hoops_player.glb`, `${base}hoops_player.clips.json`);
    const gear = await PlayerGear.load(animator, {
      shoes: `${base}gear/${opts.shoes ?? 'tenis_retro_alto_1'}.glb`,
      jersey: `${base}gear/regata_${opts.kit}.glb`,
      shorts: `${base}gear/bermuda_${opts.kit}.glb`,
    }).catch((e: unknown) => (console.warn('roupa do adversário não carregou', e), null));
    return new RemotePlayer(scene, animator, gear, opts);
  }

  /** Uma mensagem do outro jogador. `recvTimeS` = performance.now()/1000 na chegada. false se o payload não presta. */
  push(d: unknown, recvTimeS: number): boolean {
    if (this.disposed) return false;
    const payload = decodePayload(d);
    if (!payload) {
      this.rejected++;
      return false;
    }
    const s = payload.s;
    const last = this.buffer.latest();
    // O relógio do outro voltou (recarregou a página): começa de novo.
    if (last && s.t < last.t - 1) {
      this.buffer.clear();
      this.queue.clear();
      this.clock.reset();
    }
    this.clock.observe(s.t, recvTimeS);
    this.buffer.push(s);
    if (payload.c) this.queue.push(payload.c);
    return true;
  }

  update(dt: number, nowS: number): void {
    if (this.disposed || !this.clock.ready) return;
    const renderT = this.clock.renderTime(nowS);
    const A = this.animator;
    // Comandos antes do estado, como no Freestyle (o drible começa no quadro em que o jogo o pediu).
    for (const cmd of this.queue.due(renderT)) this.apply(cmd);
    const st = this.buffer.at(renderT);
    if (!st) return;

    const root = A.root;
    const jumped = !root.visible || Math.hypot(root.position.x - st.p[0], root.position.y - st.p[1], root.position.z - st.p[2]) > TeleportM;
    root.visible = true;
    root.position.set(st.p[0], st.p[1], st.p[2]);
    root.rotation.y = st.y;
    root.updateMatrixWorld(true);
    // Root motion do spin e deriva do arremesso já estão na posição que chegou: o boneco descarta as dele.
    A.takeRootMotion();
    A.takeShotDrift();
    if (st.hp) {
      try {
        A.setHoldPose(fromWire(st.hp.pose) as HoldPose, st.hp.t);
      } catch {
        this.failed++;
      }
    }
    if (st.lt !== undefined) A.layupTime = st.lt;

    // Bola: na mão (dribbler do boneco), pela rede ou nenhuma.
    const mode: BallMode = st.ball === null ? 'none' : st.b === 1 ? 'hand' : 'net';
    if (mode === 'hand' && (this.mode !== 'hand' || jumped)) {
      if (this.mode === 'net') this.dribbler.position.copy(this.ballMesh.position);
      else this.dribbler.position.set(st.ball!.p[0], st.ball!.p[1], st.ball!.p[2]);
      this.dribbler.take(st.h, this.mode === 'none' || jumped);
      this.handMismatch = 0;
    }
    this.mode = mode;
    if (mode === 'hand' && A.actionKind() === null && this.dribbler.mode === 'held' && this.dribbler.ballHand() !== st.h) {
      this.handMismatch += dt;
      if (this.handMismatch > HandFixSeconds) {
        this.dribbler.take(st.h);
        this.handMismatch = 0;
      }
    } else {
      this.handMismatch = 0;
    }

    // Como o Freestyle: o animador recebe a bola do dribbler, que fica parada no ponto da soltura durante o voo (o
    // follow-through depende disso; dar a bola voando mudava a pose dos braços).
    A.ballInHand = mode === 'hand' ? this.dribbler.mode === 'held' : st.i === 1;
    A.ballWorld.copy(this.dribbler.position);
    A.update(dt, {
      right: st.a[0],
      forward: st.a[1],
      ballHand: mode === 'hand' ? this.dribbler.ballHand() : st.h,
      hasBall: st.b === 1,
      low: st.l === 1,
      accelRight: st.a[2],
      accelForward: st.a[3],
    });
    this.gear?.update(dt);

    const ball = this.ballMesh;
    ball.visible = mode !== 'none';
    if (mode === 'hand') {
      this.dribbler.setGrip(A.actionKind() === 'Shot' ? 'shot' : 'dribble');
      this.dribbler.update(dt, A);
      for (const speed of this.dribbler.bounces) {
        this.opts.onFloorBounce?.(speed);
        this.squash = 0.07;
      }
      ball.position.copy(this.dribbler.position);
      ball.rotation.x += dt * 9;
      // Achatamento no quique, igual ao do Freestyle.
      this.squash = Math.max(0, this.squash - dt);
      const sq = this.squash > 0 ? Math.sin((Math.PI * this.squash) / 0.07) * 0.15 : 0;
      ball.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
      if (sq > 0) ball.position.y -= sq * this.radius;
    } else if (mode === 'net') {
      const b = st.ball!;
      ball.position.set(b.p[0], b.p[1], b.p[2]);
      ball.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      ball.scale.set(b.s[0], b.s[1], b.s[2]);
    }
  }

  /** Raiz do boneco (mundo three.js). */
  rootPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.animator.root.position);
  }

  /** Yaw da raiz (rad), como animator.root.rotation.y. */
  facingYaw(): number {
    return this.animator.root.rotation.y;
  }

  get heightMeters(): number {
    return this.animator.heightMeters;
  }

  /**
   * Defesa do outro jogador na amostra MAIS NOVA que chegou (sem o buffer da linha do tempo): mãos para cima (0..1) e
   * altura do pulo (m). A contestação e o toco na soltura leem isto (o boneco na tela está ~100 ms atrás).
   */
  defenseLatest(): { handsUp: number; jump: number } {
    const df = this.buffer.latest()?.df;
    return df ? { handsUp: df[0], jump: df[1] } : { handsUp: 0, jump: 0 };
  }

  /** Defesa como o boneco está mostrando agora (o comando repetido no animador dele). */
  defenseShown(): { handsUp: number; jump: number } {
    return this.animator.defenseState();
  }

  /** A bola do outro está na mão dele, no drible (nem no arremesso nem na bandeja), e se está no quique agora. */
  dribbleState(): { dribbling: boolean; bouncing: boolean; protect: boolean } {
    const dribbling = this.mode === 'hand' && this.animator.actionKind() !== 'Shot';
    return { dribbling, bouncing: dribbling && this.dribbler.mode !== 'held', protect: this.buffer.latest()?.l === 1 };
  }

  /** Bola do boneco como está desenhada, ou null quando o outro não tem a bola. */
  ballWorld(out = new THREE.Vector3()): THREE.Vector3 | null {
    return this.mode === 'none' ? null : out.copy(this.ballMesh.position);
  }

  /** Para o HUD de rede e os testes: buffer (s), amostras e comandos na fila, recusas e falhas. */
  stats(): { delayMs: number; samples: number; queued: number; rejected: number; failed: number; ball: BallMode } {
    return {
      delayMs: Math.round(this.clock.delay * 1000),
      samples: this.buffer.size,
      queued: this.queue.size,
      rejected: this.rejected,
      failed: this.failed,
      ball: this.mode,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.animator.root);
    this.scene.remove(this.ballMesh);
    disposeTree(this.animator.root);
    disposeTree(this.ballMesh);
  }

  /** Um comando do outro jogador. Se falhar (dado estranho), é descartado: o boneco segue com o que tem. */
  private apply(cmd: AnimCommand): void {
    const A = this.animator;
    const holding = this.mode === 'hand';
    try {
      switch (cmd.op) {
        case 'move':
          A.playMove(cmd.kind, cmd.hand, cmd.dur);
          break;
        case 'shot':
          A.playShot(cmd.hand, cmd.ideal, cmd.setup, cmd.wait === 1, cmd.pull && { momentum: cmd.pull.m, carry: carryFrom(cmd.pull) });
          if (holding) this.dribbler.take(this.dribbler.ballHand());
          break;
        case 'release':
          A.releaseShot();
          break;
        case 'celebrate':
          A.celebrate();
          break;
        case 'endCelebration':
          A.endCelebration();
          break;
        case 'finish':
          if (holding) this.dribbler.take(cmd.hand);
          A.playFinish(cmd.dunk === 1, cmd.hand, { gather: cmd.timing[0], release: cmd.timing[1], end: cmd.timing[2] }, cmd.air);
          break;
        case 'layup': {
          const plan = fromWire(cmd.plan) as LayupPlan;
          if (holding && (plan.choice?.hand === 'r' || plan.choice?.hand === 'l')) this.dribbler.take(plan.choice.hand);
          A.playLayup(plan, new THREE.Vector3(...cmd.ball));
          break;
        }
        case 'hold':
          A.holdLayup(fromWire(cmd.pose) as HoldPose, new THREE.Vector3(...cmd.ball));
          break;
        case 'gesture':
          A.playIdleGesture(cmd.name);
          break;
        case 'hands':
          A.setHandsUp(cmd.up === 1);
          break;
        case 'contest':
          A.playContest(cmd.h);
          break;
        case 'steal':
          A.playSteal(cmd.hand);
          break;
      }
    } catch (error) {
      this.failed++;
      console.warn(`boneco remoto: comando ${cmd.op} descartado`, error);
    }
  }
}
