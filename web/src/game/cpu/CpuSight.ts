// O que a cabeça da CPU (CpuBrain) vê num quadro, pelos olhos de um dos lados (docs/25 §2): o próprio jogador (o
// Freestyle dele) e o adversário (o outro Freestyle). Serve à CPU (CpuOpponent) e ao piloto automático do jogador
// (AutoPilot, CPU contra CPU nos testes).
import type { PlayerAnimator } from '../../anim/PlayerAnimator';
import type { Freestyle } from '../Freestyle';
import type { MatchState, Side } from '../../net/protocol';
import { ballExposure } from '../../net/defense';
import { samplePath } from '../../sim/HoopsBlock';
import { fromThree } from '../../units';
import type { CpuView } from './CpuBrain';

export interface SightPlayer {
  game: Freestyle;
  animator: PlayerAnimator;
}

export interface SightArgs {
  now: number;
  dt: number;
  state: MatchState;
  /** Lado de quem vê. */
  side: Side;
  shotClockS: number;
  me: SightPlayer;
  opp: SightPlayer;
  /** Arremesso do adversário (25–99): a distância da marcação. */
  oppShooting: { three: number; mid: number };
  rebound: CpuView['rebound'];
  stealReady: boolean;
  stealReach: number;
}

export function cpuSight(a: SightArgs): CpuView {
  const { state: s, me, opp, now } = a;
  const g = me.game;
  const h = opp.game;
  const ha = opp.animator;
  const oppAttacks = s.offense !== a.side;
  const oppHolds = oppAttacks && (h.phase === 'dribble' || h.phase === 'gather') && h.ballMesh.visible;
  const oppBall = oppHolds ? fromThree(h.ballMesh.position) : null;
  const oppDribbling = oppHolds && h.phase === 'dribble';
  const exposure =
    oppBall && oppDribbling
      ? ballExposure({
          ball: [oppBall.x, oppBall.y, oppBall.z],
          attacker: [h.position.x, h.position.y],
          defender: [g.position.x, g.position.y],
          bouncing: h.dribbler.mode !== 'held',
          protect: ha.baseClip().startsWith('Dribble_Low'),
        })
      : 0;
  const plan = h.layup.plan;
  const layupIn = oppAttacks && plan && !h.layup.released && h.phase === 'gather' ? plan.releaseAt - h.layup.time(now) : null;
  const gathering = g.phase === 'gather' && !g.finishing;
  return {
    now,
    dt: a.dt,
    live: s.phase === 'live',
    offense: s.offense === a.side,
    ball: s.ball,
    needsClear: s.needsClear,
    shotClockS: a.shotClockS,
    rimFloor: g.layout.rimFloorPoint,
    arc: g.layout.spec.threePointRadius,
    isThree: (p) => g.layout.spec.isThreePointer(p, g.layout.rimFloorPoint, g.hoop.forward),
    me: {
      pos: g.position,
      vel: g.velocity,
      facing: g.facing,
      phase: g.phase,
      hand: g.dribbler.ballHand(),
      canAct: g.phase === 'dribble' && !g.finishing && g.dribble.canCancel(now),
      moveBusy: g.dribble.isMoveActive(now),
      gathering,
      shotIdealMs: gathering ? (g.windows?.idealReleaseMs ?? null) : null,
      finishing: g.finishing,
      finishReleased: g.phase === 'flight' || g.layup.released,
      jumping: me.animator.defenseState().jump > 0.01,
      energy: g.dribble.getEnergy(),
    },
    opp: {
      pos: h.position,
      vel: h.velocity,
      facing: h.facing,
      dribbling: oppDribbling,
      gathering: oppAttacks && h.phase === 'gather' && !h.finishing,
      shotAirborne: ha.shotAirborne(),
      finishing: oppAttacks && h.phase === 'gather' && h.finishing,
      layupReleaseIn: layupIn,
      ballPos: oppBall,
      exposure,
      jumping: ha.defenseState().jump > 0.01,
      three: a.oppShooting.three,
      mid: a.oppShooting.mid,
    },
    rebound: s.ball === 'held' ? null : a.rebound,
    stealReady: a.stealReady,
    stealReach: a.stealReach,
  };
}

/**
 * Bola no ar ou solta: o primeiro ponto do caminho dela (a física de verdade) baixo o bastante para pegar. A bola é de
 * quem tem a posse (o Freestyle dele simula o voo e a bola solta).
 */
export function predictRebound(state: MatchState, side: Side, me: Freestyle, opp: Freestyle): CpuView['rebound'] {
  if (state.phase !== 'live' || state.ball === 'held') return null;
  const owner = state.offense === side ? me : opp;
  if (owner.phase !== 'flight' && owner.phase !== 'loose') return null;
  const ball = owner.ball;
  const now = ball.position;
  if (now.z < 1.3) return { spot: now.add(ball.velocity.flat().scale(0.3)).withZ(0), ball: now, landIn: 0 };
  const path = samplePath(me.sim, ball, 2.5);
  for (const p of path) {
    if (p.t > 0.15 && p.v.z < 0 && p.p.z < 2.3) return { spot: p.p.withZ(0), ball: now, landIn: p.t };
  }
  const last = path[path.length - 1]!;
  return { spot: last.p.withZ(0), ball: now, landIn: last.t };
}
