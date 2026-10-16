// Piloto automático do jogador no 1x1 contra a CPU (?autoplay=<nível>, docs/25 §6): a mesma cabeça da CPU (CpuBrain) no
// lugar do controle. É a CPU contra ela mesma: calibra níveis e estilos com números (aproveitamento, tocos, roubos) e
// serve de "assistir" CPU x CPU. Lê o jogo pelos olhos do jogador (cpuSight) e devolve o InputState que o controle
// daria, com o LS no referencial da câmera do jogo (o Pro Stick já é absoluto: cima = para a cesta).
import type { InputState } from '../Input';
import type { Freestyle } from '../Freestyle';
import type { PlayerAnimator } from '../../anim/PlayerAnimator';
import type { PlayerBuild } from '../../build/PlayerBuild';
import { playRatings } from '../../build/BuildRatings';
import { StealCooldownMs, StealLungeM, contestJumpM } from '../../net/defense';
import { shotClockLeft } from '../../net/protocol';
import { Vec3 } from '../../sim';
import { CpuBrain, type CpuView } from './CpuBrain';
import { type CpuLevel, CpuLevels, type CpuStyle } from './CpuRoster';
import { cpuSight, predictRebound } from './CpuSight';
import { HumanSide, type LocalHub } from './LocalHub';

export interface AutoPilotOptions {
  hub: LocalHub;
  me: { game: Freestyle; animator: PlayerAnimator; build: PlayerBuild };
  opp: { game: Freestyle; animator: PlayerAnimator; three: number; mid: number };
  level: CpuLevel;
  style: CpuStyle;
  /** Frente da câmera do jogo (núcleo): o LS do jogador é relativo a ela. */
  cameraForward: () => Vec3;
  rand?: () => number;
}

/** Estilo do piloto: o meio-termo (arremessa, infiltra e dribla por igual). */
export const PilotStyle: CpuStyle = { shoot: 0.6, drive: 0.6, moves: 0.55, gamble: 0.4, dunk: 0.5, rimProtect: 0.3 };

export class AutoPilot {
  private readonly brain: CpuBrain;
  private prevShoot = false;
  private edgeTime = 0;
  private lastStealMs = -Infinity;
  private rebound: CpuView['rebound'] = null;
  private frame = 0;
  private lastNow = 0;

  constructor(private readonly o: AutoPilotOptions) {
    const r = playRatings(o.me.build);
    const a = o.me.build.attrs;
    this.brain = new CpuBrain(
      {
        three: r.threePoint,
        mid: r.midRange,
        close: r.closeShot,
        layup: a.drivingLayup,
        dunk: a.drivingDunk,
        canDunk: r.canDunk,
        perimeterDefense: a.perimeterDefense,
        steal: a.steal,
        block: a.block,
        jumpM: contestJumpM(a.vertical),
        heightM: o.me.build.body.heightCm / 100,
      },
      o.style,
      CpuLevels[o.level],
      o.rand ?? Math.random,
    );
  }

  /** O controle do jogador neste quadro (o de verdade só passa o Start/P, para sair da partida). */
  input(raw: InputState): InputState {
    const now = performance.now() / 1000;
    const dt = this.lastNow > 0 ? Math.min(0.1, now - this.lastNow) : 1 / 60;
    this.lastNow = now;
    const { hub, me, opp } = this.o;
    const state = hub.state();
    if (++this.frame % 3 === 0 || !this.rebound) this.rebound = predictRebound(state, HumanSide, me.game, opp.game);
    const nowMs = hub.serverNow();
    const view = cpuSight({
      now,
      dt,
      state,
      side: HumanSide,
      shotClockS: hub.rules.shotClock > 0 ? shotClockLeft(state, nowMs) / 1000 : Infinity,
      me: { game: me.game, animator: me.animator },
      opp: { game: opp.game, animator: opp.animator },
      oppShooting: { three: opp.three, mid: opp.mid },
      rebound: this.rebound,
      stealReady: nowMs - this.lastStealMs >= StealCooldownMs,
      stealReach: me.build.body.wingspanCm / 200 + StealLungeM,
    });
    const c = this.brain.think(view);
    // O LS da cabeça (referencial dela: para a cesta) no referencial da câmera do jogo.
    const fb = c.camForward;
    const rb = new Vec3(0, 0, 1).cross(fb).normalized();
    const wish = fb.scale(c.moveY).add(rb.scale(c.moveX));
    const fc = this.o.cameraForward().flat().normalized(new Vec3(-1, 0, 0));
    const rc = new Vec3(0, 0, 1).cross(fc).normalized();
    if (c.shoot !== this.prevShoot) {
      this.edgeTime = c.shootEdgeTime;
      this.prevShoot = c.shoot;
      if (c.shoot && !view.offense) this.lastStealMs = nowMs;
    }
    return {
      moveX: wish.dot(rc),
      moveY: wish.dot(fc),
      proX: c.proX,
      proY: c.proY,
      shoot: c.shoot,
      call: false,
      contest: c.contest,
      pause: raw.pause,
      pad: raw.pad,
      shootEdgeTime: this.edgeTime,
      sprint: c.sprint,
      protect: c.protect,
      gamepadConnected: raw.gamepadConnected,
    };
  }

  /** Para o debug: a última decisão do ataque. */
  get decision(): string {
    return this.brain.lastDecision;
  }
}

/** Monta o piloto do lado do jogador contra a CPU (o CpuOpponent chama ao receber a partida). */
export function makeAutoPilot(o: Omit<AutoPilotOptions, 'style'> & { style?: CpuStyle }): AutoPilot {
  return new AutoPilot({ ...o, style: o.style ?? PilotStyle });
}

export type { CpuLevel };
