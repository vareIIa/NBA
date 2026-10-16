// 1x1 contra a CPU (docs/25): a sala local (o juiz do online no navegador) e a cabeça da CPU.
import { describe, expect, it } from 'vitest';
import type { MatchState, PlayerCard, ServerMsg } from '../../net/protocol';
import { DribbleMove, ProStickRecognizer, StickDir, StickGestureKind, Vec3, defaultProStickConfig } from '../../sim';
import { CpuBrain, type CpuView, StickScript, exitSide, flickFor, shotQuality } from './CpuBrain';
import { CpuLevels, CpuRoster, cpuBuild, cpuCard } from './CpuRoster';
import { CpuSide, HumanSide, LocalHub } from './LocalHub';

const card = (name: string): PlayerCard => ({
  name,
  heightCm: 196,
  wingspanOverM: 0,
  wingspanCm: 200,
  overall: 70,
  archetype: '',
  position: 'SG',
  perimeterDefense: 70,
  steal: 70,
  block: 60,
  vertical: 70,
  ballHandle: 70,
});

function hub(random?: () => number) {
  const h = new LocalHub({ human: card('Eu'), cpu: card('CPU'), random });
  const human: ServerMsg[] = [];
  const cpu: ServerMsg[] = [];
  h.on('match.state', (m) => human.push(m));
  h.on('match.start', (m) => human.push(m));
  h.onCpu((m) => cpu.push(m));
  const state = (): MatchState => h.state();
  return { h, human, cpu, state };
}

describe('LocalHub', () => {
  it('começa no check do jogador; o relógio só anda com o jogo e a bola fica viva no fim da contagem', () => {
    const { h, human, state } = hub();
    const start = h.startMsg(HumanSide);
    expect(start.you).toBe(HumanSide);
    expect(h.startMsg(CpuSide).you).toBe(CpuSide);
    expect(start.state.phase).toBe('check');
    expect(start.state.offense).toBe(HumanSide);
    expect(start.room.players.map((p) => p.card.name)).toEqual(['Eu', 'CPU']);
    for (let i = 0; i < 40; i++) h.advance(0.1); // 4 s: ainda no check (o primeiro tem 5 s)
    expect(state().phase).toBe('check');
    for (let i = 0; i < 12; i++) h.advance(0.1);
    expect(state().phase).toBe('live');
    // A mensagem não chega no meio de quem relatou: só no flush (a microtarefa, no jogo).
    expect(human.filter((m) => m.t === 'match.state').length).toBe(0);
    h.flush();
    expect(human.at(-1)?.t).toBe('match.state');
  });

  it('cesta do jogador: pontos, pausa e check da CPU; os dois lados recebem cópias (não o objeto do juiz)', () => {
    const { h, human, cpu, state } = hub();
    for (let i = 0; i < 52; i++) h.advance(0.1);
    const seq = state().seq;
    h.send({ t: 'g.release', seq });
    h.send({ t: 'g.result', seq, scored: true, isThree: true });
    h.flush();
    const scored = human.at(-1) as Extract<ServerMsg, { t: 'match.state' }>;
    expect(scored.event).toEqual({ kind: 'score', side: HumanSide, points: 2, isThree: true });
    expect(scored.state.score).toEqual([2, 0]);
    const cpuSaw = cpu.at(-1) as Extract<ServerMsg, { t: 'match.state' }>;
    expect(cpuSaw.state).not.toBe(scored.state);
    expect(cpuSaw.state.score).toEqual([2, 0]);
    for (let i = 0; i < 20; i++) h.advance(0.1);
    expect(state().phase).toBe('check');
    expect(state().offense).toBe(CpuSide);
  });

  it('roubo e toco da CPU passam pelo mesmo juiz do online', () => {
    const { h, human, state } = hub(() => 0); // sorteio sempre sai
    for (let i = 0; i < 52; i++) h.advance(0.1);
    h.fromCpu({ t: 'g.steal', seq: state().seq, exp: 1 });
    h.flush();
    const steal = human.at(-1) as Extract<ServerMsg, { t: 'match.state' }>;
    expect(steal.event).toEqual({ kind: 'steal', side: CpuSide });
    expect(steal.state.offense).toBe(CpuSide);
    expect(steal.state.needsClear).toBe(true);
    // A CPU arremessa e o jogador dá o toco (quem arremessa relata).
    const seq = state().seq;
    h.fromCpu({ t: 'g.release', seq });
    h.fromCpu({ t: 'g.block', seq });
    h.flush();
    const block = human.at(-1) as Extract<ServerMsg, { t: 'match.state' }>;
    expect(block.event).toEqual({ kind: 'block', side: HumanSide });
    expect(block.state.ball).toBe('loose');
  });

  it('revanche: a CPU sempre aceita e o primeiro ataque troca', () => {
    const h = new LocalHub({ human: card('Eu'), cpu: card('CPU'), rules: { target: 1 } });
    const starts: Extract<ServerMsg, { t: 'match.start' }>[] = [];
    h.on('match.start', (m) => starts.push(m));
    for (let i = 0; i < 52; i++) h.advance(0.1);
    const seq = h.state().seq;
    h.send({ t: 'g.release', seq });
    h.send({ t: 'g.result', seq, scored: true, isThree: false });
    h.flush();
    expect(h.state().phase).toBe('over');
    h.send({ t: 'room.rematch', want: true });
    h.flush();
    expect(starts.length).toBe(1);
    expect(starts[0]!.state.offense).toBe(CpuSide);
    expect(starts[0]!.state.score).toEqual([0, 0]);
    expect(starts[0]!.you).toBe(HumanSide);
  });

  it('sem canal direto: stateHz devolve a taxa pedida e o linkStats é neutro', () => {
    const { h } = hub();
    expect(h.stateHz(20)).toBe(20);
    expect(h.linkStats().route).toBe('offline');
  });
});

describe('Pro Stick da CPU', () => {
  /** Toca o roteiro no reconhecedor de verdade a 60 Hz e devolve os gestos. */
  function play(script: StickScript, seconds = 0.4) {
    const rec = new ProStickRecognizer(defaultProStickConfig());
    const out = [];
    for (let t = 0; t <= seconds; t += 1 / 60) {
      const s = script.sample(t);
      out.push(...rec.update(t, s.x, s.y));
    }
    return out;
  }

  it('flick sai como Flick na direção pedida (na borda, sem esperar a volta)', () => {
    for (const dir of [StickDir.Up, StickDir.Left, StickDir.Right, StickDir.DownLeft, StickDir.UpRight]) {
      const s = new StickScript();
      s.flick(0, dir);
      const g = play(s);
      expect(g.length).toBe(1);
      expect(g[0]!.kind).toBe(StickGestureKind.Flick);
      expect(g[0]!.dir).toBe(dir);
    }
    // Para baixo espera a volta ao centro (o segurar para baixo é arremesso), mas sai.
    const down = new StickScript();
    down.flick(0, StickDir.Down);
    const g = play(down);
    expect(g.map((x) => [x.kind, x.dir])).toEqual([[StickGestureKind.Flick, StickDir.Down]]);
  });

  it('giro de 300° vira Rotation (spin); 110° vira QuarterCircle (meio giro)', () => {
    const spin = new StickScript();
    spin.turn(0, -300, 0.18);
    expect(play(spin).some((g) => g.kind === StickGestureKind.Rotation)).toBe(true);
    const half = new StickScript();
    half.turn(0, 110, 0.1);
    expect(play(half).map((g) => g.kind)).toContain(StickGestureKind.QuarterCircle);
  });

  it('a direção do drible segue a mão da bola (espelha na esquerda) e a saída vai para a mão nova', () => {
    expect(flickFor(DribbleMove.Crossover, 'r')).toBe(StickDir.Up);
    expect(flickFor(DribbleMove.Crossover, 'l')).toBe(StickDir.Up);
    expect(flickFor(DribbleMove.BetweenLegs, 'r')).toBe(StickDir.Left);
    expect(flickFor(DribbleMove.BetweenLegs, 'l')).toBe(StickDir.Right);
    expect(flickFor(DribbleMove.BehindBack, 'r')).toBe(StickDir.DownLeft);
    expect(flickFor(DribbleMove.BehindBack, 'l')).toBe(StickDir.DownRight);
    expect(flickFor(DribbleMove.StepBack, 'l')).toBe(StickDir.Down);
    expect(exitSide(DribbleMove.Crossover, 'r')).toBe(-1);
    expect(exitSide(DribbleMove.Crossover, 'l')).toBe(1);
    expect(exitSide(DribbleMove.Hesitation, 'r')).toBe(1);
  });
});

describe('CpuBrain', () => {
  const rim = new Vec3(0, 0, 0);
  const ratings = { three: 80, mid: 80, close: 80, layup: 80, dunk: 80, canDunk: true, perimeterDefense: 80, steal: 70, block: 70, jumpM: 0.6, heightM: 1.98 };
  const style = { shoot: 0.6, drive: 0.6, moves: 0.5, gamble: 0, dunk: 0.5, rimProtect: 0 };

  function view(over: Omit<Partial<CpuView>, 'me' | 'opp'> & { me?: Partial<CpuView['me']>; opp?: Partial<CpuView['opp']> }): CpuView {
    const { me, opp, ...rest } = over;
    return {
      now: 10,
      dt: 1 / 60,
      live: true,
      offense: false,
      ball: 'held',
      needsClear: false,
      shotClockS: 20,
      rimFloor: rim,
      arc: 7.24,
      isThree: (p) => p.length2D() > 7.24,
      rebound: null,
      stealReady: true,
      stealReach: 1.3,
      ...rest,
      me: {
        pos: new Vec3(6, 0, 0),
        vel: new Vec3(),
        facing: new Vec3(1, 0, 0),
        phase: 'loose',
        hand: 'r',
        canAct: false,
        moveBusy: false,
        gathering: false,
        shotIdealMs: null,
        finishing: false,
        finishReleased: false,
        jumping: false,
        energy: 1,
        ...me,
      },
      opp: {
        pos: new Vec3(8, 0, 0),
        vel: new Vec3(),
        facing: new Vec3(-1, 0, 0),
        dribbling: true,
        gathering: false,
        shotAirborne: false,
        finishing: false,
        layupReleaseIn: null,
        ballPos: new Vec3(8, 0.4, 0.6),
        exposure: 0,
        jumping: false,
        three: 80,
        mid: 80,
        ...opp,
      },
    };
  }

  /** LS da CPU no mundo (a câmera dela olha para a cesta). */
  const lsWorld = (c: ReturnType<CpuBrain['think']>): Vec3 => {
    const f = c.camForward;
    const r = new Vec3(0, 0, 1).cross(f).normalized();
    return f.scale(c.moveY).add(r.scale(c.moveX));
  };

  it('defesa: vai para entre o atacante e a cesta (não para cima dele)', () => {
    const brain = new CpuBrain(ratings, style, CpuLevels.allstar, () => 0.5);
    // Atacante parado no topo (8, 0); a CPU de lado, em (8, 3): tem de ir para perto de (6,7, 0).
    let c = brain.think(view({ me: { pos: new Vec3(8, 3, 0) } }));
    for (let i = 0; i < 30; i++) c = brain.think(view({ now: 10 + i / 60, me: { pos: new Vec3(8, 3, 0) } }));
    const w = lsWorld(c);
    expect(w.y).toBeLessThan(-0.5); // desce para a linha atacante-cesta
    expect(w.x).toBeLessThan(0.1); // e um pouco para o lado da cesta
  });

  it('contestação: mãos para cima depois da reação; o pulo cedo sai no tempo do arremesso', () => {
    const level = { ...CpuLevels.allstar, biteChance: 1, jumpSigmaS: 0 };
    const brain = new CpuBrain(ratings, style, level, () => 0.5);
    const near = { me: { pos: new Vec3(7.1, 0, 0) } };
    let c = brain.think(view({ ...near, now: 10, opp: { gathering: true, dribbling: false } }));
    expect(c.proY).toBe(0); // ainda não reagiu
    let jumpedAt = -1;
    for (let i = 1; i < 60 && jumpedAt < 0; i++) {
      c = brain.think(view({ ...near, now: 10 + i / 60, opp: { gathering: true, dribbling: false } }));
      if (i / 60 > level.reactionS + 0.02) expect(c.proY).toBe(1);
      if (c.contest) jumpedAt = i / 60;
    }
    // Pula cedo o bastante para estar no alto do pulo perto da soltura (~0,56 s).
    expect(jumpedAt).toBeGreaterThan(0.1);
    expect(jumpedAt).toBeLessThan(0.35);
  });

  it('pump fake: o disciplinado (sem pulo cedo) não pula se o arremesso acaba no chão', () => {
    const level = { ...CpuLevels.hof, biteChance: 0 };
    const brain = new CpuBrain(ratings, style, level, () => 0.5);
    const near = { me: { pos: new Vec3(7.1, 0, 0) } };
    let jumped = false;
    for (let i = 0; i < 12; i++) jumped ||= brain.think(view({ ...near, now: 10 + i / 60, opp: { gathering: true, dribbling: false } })).contest;
    for (let i = 12; i < 60; i++) jumped ||= brain.think(view({ ...near, now: 10 + i / 60 })).contest;
    expect(jumped).toBe(false);
  });

  it('ataque: precisando limpar, sai para fora da linha de 3', () => {
    const brain = new CpuBrain(ratings, style, CpuLevels.pro, () => 0.5);
    const c = brain.think(
      view({ offense: true, needsClear: true, me: { pos: new Vec3(4, 1, 0), phase: 'dribble', canAct: true, facing: new Vec3(-1, 0, 0) }, opp: { pos: new Vec3(2, 0, 0), dribbling: false } }),
    );
    const w = lsWorld(c);
    expect(w.dot(new Vec3(4, 1, 0).normalized())).toBeGreaterThan(0.5); // para longe do aro
  });

  it('a chance que a IA lê cai com a distância e sobe com o rating', () => {
    expect(shotQuality(ratings, 6, false)).toBeGreaterThan(shotQuality(ratings, 7.5, true));
    expect(shotQuality({ ...ratings, three: 95 }, 7.5, true)).toBeGreaterThan(shotQuality({ ...ratings, three: 60 }, 7.5, true));
    expect(shotQuality(ratings, 10, true)).toBeLessThan(0.05);
  });
});

describe('CpuRoster', () => {
  it('cada adversário é uma build válida do builder, com o cartão do online', () => {
    for (const e of CpuRoster) {
      const b = cpuBuild(e);
      const c = cpuCard(e, b);
      expect(b.body.heightCm).toBe(e.heightCm);
      expect(c.overall).toBeGreaterThan(50);
      expect(c.block).toBe(b.attrs.block);
      for (const v of Object.values(b.attrs)) expect(v).toBeLessThanOrEqual(99);
    }
    // O protetor de aro dá mais toco que o armador; o arremessador arremessa melhor de 3.
    const by = (id: string) => cpuBuild(CpuRoster.find((e) => e.id === id)!).attrs;
    expect(by('muralha').block).toBeGreaterThan(by('maestro').block);
    expect(by('bala').threePoint).toBeGreaterThan(by('muralha').threePoint);
  });
});
