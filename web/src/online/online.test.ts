// Boneco remoto (docs/24 §5): serialização, validação do que chega, relógio, interpolação, fila de comandos e gravador.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Vec3 } from '../sim';
import type { AnimInput } from '../anim/PlayerAnimator';
import { AnimRecorder, type RecordableAnimator } from './AnimRecorder';
import { MaxCommands, type PoseSample, decodePayload } from './Payload';
import { CommandQueue, MaxExtrapolate, PoseBuffer, RemoteClock, hermite, lerpAngle, lerpJson } from './Timeline';
import { WireError, fromWire, toWire } from './Wire';

const input = (o: Partial<AnimInput> = {}): AnimInput => ({
  right: 0,
  forward: 0,
  ballHand: 'r',
  hasBall: true,
  low: false,
  accelRight: 0,
  accelForward: 0,
  ...o,
});

const sample = (t: number, p: [number, number, number], o: Partial<PoseSample> = {}): PoseSample => ({
  t,
  p,
  w: [0, 0, 0],
  y: 0,
  a: [0, 0, 0, 0],
  h: 'r',
  b: 1,
  l: 0,
  ball: null,
  ...o,
});

/** Animador falso com os métodos no protótipo (como o PlayerAnimator), anotando o que o jogo chamou. */
class FakeAnimator {
  root = { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 } };
  layupTime = 0;
  ballInHand = true;
  calls: string[] = [];
  update(_dt: number, _input: AnimInput): void {
    this.calls.push('update');
  }
  playMove(kind: string): void {
    this.calls.push(`move:${kind}`);
  }
  playShot(): void {
    this.calls.push('shot');
  }
  releaseShot(): void {
    this.calls.push('release');
  }
  celebrate(): void {
    this.calls.push('celebrate');
  }
  endCelebration(): void {
    this.calls.push('endCelebration');
  }
  playFinish(): void {
    this.calls.push('finish');
  }
  playLayup(): void {
    this.calls.push('layup');
  }
  holdLayup(): void {
    this.calls.push('hold');
  }
  setHoldPose(): void {
    this.calls.push('holdPose');
  }
  playIdleGesture(): boolean {
    this.calls.push('gesture');
    return true;
  }
  df = { handsUp: 0, jump: 0 };
  setHandsUp(up: boolean): void {
    this.calls.push(`hands:${up}`);
  }
  playContest(h: number): boolean {
    this.calls.push(`contest:${h}`);
    return true;
  }
  playSteal(hand: string): void {
    this.calls.push(`steal:${hand}`);
  }
  defenseState(): { handsUp: number; jump: number } {
    return this.df;
  }
  playCatch(target: { x: number; y: number; z: number }, inS: number, jumpM = 0): void {
    this.calls.push(`catch:${target.y}:${inS}:${jumpM}`);
  }
  cancelCatch(): void {
    this.calls.push('uncatch');
  }
}

function recorded(): { fake: FakeAnimator; anim: RecordableAnimator; rec: AnimRecorder; clock: { t: number } } {
  const fake = new FakeAnimator();
  const anim = fake as unknown as RecordableAnimator;
  const clock = { t: 100 };
  const rec = AnimRecorder.attach(anim, () => clock.t);
  return { fake, anim, rec, clock };
}

describe('Wire', () => {
  it('leva Vec3 e números arredondados e volta com Vec3 de verdade', () => {
    const plan = { takeoffPos: new Vec3(1.23456789, -2, 0.5), path: [new Vec3(0, 0, 0), new Vec3(1, 2, 3)], rating: 85, side: 'r', f: () => 1 };
    const json = toWire(plan);
    expect(JSON.stringify(json)).not.toContain('function');
    const back = fromWire(JSON.parse(JSON.stringify(json))) as typeof plan;
    expect(back.takeoffPos).toBeInstanceOf(Vec3);
    expect(back.takeoffPos.x).toBeCloseTo(1.2346, 4);
    expect(back.path[1].z).toBe(3);
    expect(back.side).toBe('r');
  });

  it('recusa números infinitos, árvores fundas, listas enormes e chaves perigosas', () => {
    expect(() => fromWire({ a: 1e9 })).toThrow(WireError);
    let deep: unknown = 1;
    for (let k = 0; k < 12; k++) deep = { d: deep };
    expect(() => fromWire(deep)).toThrow(WireError);
    expect(() => fromWire(new Array(600).fill(0))).toThrow(WireError);
    expect(() => fromWire(JSON.parse('{"__proto__": {"x": 1}}'))).toThrow(WireError);
    expect(() => fromWire({ $v: [1, 2] })).toThrow(WireError);
  });
});

describe('Payload', () => {
  it('aceita o que o gravador produz e recusa lixo', () => {
    const { anim, rec } = recorded();
    anim.update(1 / 60, input({ right: 1.5 }));
    anim.playMove('Cross', 'r', 0.38);
    const d = JSON.parse(JSON.stringify(rec.drain({ p: [1, 0.5, 2], q: [0, 0, 0, 1], s: [1, 1, 1] })));
    const ok = decodePayload(d);
    expect(ok?.c?.[0]).toMatchObject({ op: 'move', kind: 'Cross', hand: 'r' });
    expect(ok?.s.ball?.p).toEqual([1, 0.5, 2]);

    expect(decodePayload({ ...d, v: 99 })).toBeNull();
    expect(decodePayload({ ...d, c: [{ op: 'move', t: 1, kind: 'Teleporte', hand: 'r', dur: 1 }] })).toBeNull();
    expect(decodePayload({ ...d, c: [{ op: 'move', t: 1, kind: 'constructor', hand: 'r', dur: 1 }] })).toBeNull();
    expect(decodePayload({ ...d, s: { ...d.s, p: [Number.NaN, 0, 0] } })).toBeNull();
    expect(decodePayload({ ...d, s: { ...d.s, h: 'x' } })).toBeNull();
    expect(decodePayload({ ...d, c: new Array(MaxCommands + 1).fill({ op: 'release', t: 1 }) })).toBeNull();
    expect(decodePayload({ ...d, c: [{ op: 'shot', t: 1, hand: 'r', ideal: 0.5, wait: 1, setup: { id: 'x' } }] })).toBeNull();
    expect(decodePayload('texto')).toBeNull();
    expect(decodePayload(null)).toBeNull();
  });
});

describe('RemoteClock', () => {
  it('acha a diferença dos relógios pelo menor atraso e toca um buffer atrás', () => {
    const c = new RemoteClock();
    expect(c.ready).toBe(false);
    // O outro relógio está 1000 s à frente; a rede leva 30–60 ms.
    const delays = [0.06, 0.03, 0.05, 0.04, 0.035, 0.055];
    delays.forEach((lag, k) => c.observe(1000 + k * 0.05, k * 0.05 + lag));
    expect(c.ready).toBe(true);
    const now = 0.3;
    const render = c.renderTime(now);
    // Mostra o instante now − 30 ms de rede − buffer, no relógio do outro.
    expect(render).toBeCloseTo(1000 + now - 0.03 - c.delay, 6);
    expect(c.delay).toBeGreaterThanOrEqual(0.06);
    expect(c.delay).toBeLessThanOrEqual(0.35);
  });

  it('nunca volta para trás e cresce o buffer com jitter', () => {
    const c = new RemoteClock();
    let t = 0;
    for (let k = 0; k < 200; k++) {
      t += 0.05;
      c.observe(t, t + 0.03 + (k % 3 === 0 ? 0.12 : 0));
    }
    expect(c.delay).toBeGreaterThan(0.1);
    const a = c.renderTime(10);
    const b = c.renderTime(9.9);
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe('PoseBuffer', () => {
  it('interpola a raiz pela Hermite (velocidade constante = reta) e o yaw pelo menor caminho', () => {
    const buf = new PoseBuffer();
    buf.push(sample(0, [0, 0, 0], { w: [2, 0, 0], y: 3.0 }));
    buf.push(sample(0.1, [0.2, 0, 0], { w: [2, 0, 0], y: -3.0 }));
    const s = buf.at(0.05)!;
    expect(s.p[0]).toBeCloseTo(0.1, 6);
    // 3.0 → −3.0 passa por π (o caminho curto tem 0,28 rad), não por 0.
    expect(Math.abs(s.y)).toBeGreaterThan(3.0);
    expect(lerpAngle(3.0, -3.0, 0.5)).toBeCloseTo(Math.PI, 2);
  });

  it('a Hermite passa pelas pontas e respeita as velocidades', () => {
    const p = hermite([0, 0, 0], [0, 0, 0], [1, 0, 0], [0, 0, 0], 1, 0.5);
    expect(p[0]).toBeCloseTo(0.5, 6);
    expect(hermite([0, 0, 0], [5, 0, 0], [1, 0, 0], [5, 0, 0], 0.2, 0)[0]).toBe(0);
    expect(hermite([0, 0, 0], [5, 0, 0], [1, 0, 0], [5, 0, 0], 0.2, 1)[0]).toBeCloseTo(1, 6);
  });

  it('teletransporte: segura a amostra anterior e pula, sem atravessar a quadra', () => {
    const buf = new PoseBuffer();
    buf.push(sample(0, [0, 0, 0]));
    buf.push(sample(0.05, [6, 0, 0]));
    const s = buf.at(0.03)!;
    expect(s.snapped).toBe(true);
    expect(s.p[0]).toBe(0);
    expect(buf.at(0.05)!.p[0]).toBe(6);
  });

  it('extrapola pela velocidade no máximo MaxExtrapolate e recusa amostra velha', () => {
    const buf = new PoseBuffer();
    buf.push(sample(1, [0, 0, 0], { w: [3, 0, 0] }));
    expect(buf.push(sample(0.9, [9, 9, 9]))).toBe(false);
    const s = buf.at(2)!;
    expect(s.extrapolated).toBe(true);
    expect(s.p[0]).toBeCloseTo(3 * MaxExtrapolate, 6);
  });

  it('bola: interpola entre duas posições e some/aparece na hora da amostra', () => {
    const ball = (x: number) => ({ p: [x, 1, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], s: [1, 1, 1] as [number, number, number] });
    const buf = new PoseBuffer();
    buf.push(sample(0, [0, 0, 0], { ball: ball(0) }));
    buf.push(sample(0.1, [0, 0, 0], { ball: ball(1) }));
    buf.push(sample(0.2, [0, 0, 0], { ball: null }));
    expect(buf.at(0.05)!.ball!.p[0]).toBeCloseTo(0.5, 6);
    expect(buf.at(0.15)!.ball!.p[0]).toBe(1);
    expect(buf.at(0.2)!.ball).toBeNull();
  });

  it('mistura a pose da bola presa (JSON de mesmo formato)', () => {
    const a = { com: { $v: [0, 0, 0] }, crouch: 0.1, ball: 'chin' };
    const b = { com: { $v: [1, 0, 0] }, crouch: 0.3, ball: 'low' };
    expect(lerpJson(a, b, 0.5)).toEqual({ com: { $v: [0.5, 0, 0] }, crouch: 0.2, ball: 'chin' });
  });
});

describe('CommandQueue', () => {
  it('solta em ordem os comandos cuja hora chegou', () => {
    const q = new CommandQueue();
    q.push([{ op: 'release', t: 2 }, { op: 'celebrate', t: 1 }]);
    q.push([{ op: 'endCelebration', t: 1.5 }]);
    expect(q.due(0.5)).toEqual([]);
    expect(q.due(1.6).map((c) => c.op)).toEqual(['celebrate', 'endCelebration']);
    expect(q.size).toBe(1);
    expect(q.due(5).map((c) => c.op)).toEqual(['release']);
  });
});

describe('AnimRecorder', () => {
  it('anota os comandos com o relógio e o original continua rodando', () => {
    const { fake, anim, rec, clock } = recorded();
    anim.playMove('Spin', 'l', 0.6);
    clock.t = 100.5;
    anim.releaseShot();
    anim.endCelebration();
    anim.playFinish(true, 'r', { gather: 0.1, release: 0.4, end: 0.9 }, 0.55);
    expect(fake.calls).toEqual(['move:Spin', 'release', 'endCelebration', 'finish']);
    const d = rec.drain(null);
    expect(d.c?.map((c) => c.op)).toEqual(['move', 'release', 'endCelebration', 'finish']);
    expect(d.c?.[0]).toMatchObject({ t: 100, kind: 'Spin', hand: 'l', dur: 0.6 });
    expect(d.c?.[1].t).toBe(100.5);
    expect(rec.drain(null).c).toBeUndefined();
  });

  it('o quadro leva a entrada exata da locomoção, a velocidade da raiz e a pose presa', () => {
    const { fake, anim, rec, clock } = recorded();
    anim.update(1 / 60, input({ right: 1, forward: 2.5, low: true, ballHand: 'l' }));
    for (let k = 1; k <= 30; k++) {
      clock.t = 100 + k / 60;
      fake.root.position.x = 3 * (k / 60); // 3 m/s para a direita
      anim.update(1 / 60, input({ right: 1, forward: 2.5, low: true, ballHand: 'l' }));
    }
    anim.setHoldPose({ crouch: 0.2 } as never, 0.4);
    anim.update(1 / 60, input());
    const s = rec.drain(null).s;
    expect(s.w[0]).toBeCloseTo(3, 1);
    expect(s.hp).toEqual({ pose: { crouch: 0.2 }, t: 0.4 });
    const prev = JSON.parse(JSON.stringify(s));
    expect(prev.b).toBe(1);
  });

  it('pull-up: o carry vira amostras que o boneco consegue interpolar', () => {
    const { anim, rec } = recorded();
    anim.playShot('r', 0.55, undefined, true, { momentum: 0.8, carry: { dir: { x: 0, y: 0, z: 1 } as never, speedAt: (t: number) => Math.max(0, 4 - 8 * t) } });
    const shot = rec.drain(null).c![0];
    expect(shot.op).toBe('shot');
    if (shot.op !== 'shot') return;
    expect(shot.wait).toBe(1);
    expect(shot.pull!.sp[0]).toBe(4);
    expect(shot.pull!.sp.at(-1)).toBe(0);
  });

  it('detach devolve os métodos do protótipo; não dá para gravar duas vezes o mesmo animador', () => {
    const { fake, anim, rec } = recorded();
    expect(() => AnimRecorder.attach(anim)).toThrow();
    expect(Object.hasOwn(fake, 'playMove')).toBe(true);
    rec.detach();
    expect(Object.hasOwn(fake, 'playMove')).toBe(false);
    anim.playMove('Cross', 'r', 0.4);
    expect(fake.calls).toEqual(['move:Cross']);
    expect(() => AnimRecorder.attach(anim).detach()).not.toThrow();
  });

  it('um erro ao anotar nunca quebra o jogo local', () => {
    const { fake, anim } = recorded();
    let deep: Record<string, unknown> = {};
    const top = deep;
    for (let k = 0; k < 20; k++) deep = deep.d = {};
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      anim.playLayup(top as never, { x: 0, y: 0, z: 0 } as never);
    } finally {
      console.warn = warn;
    }
    expect(fake.calls).toEqual(['layup']);
  });
});

describe('Defesa no gravador e no payload', () => {
  it('anota mãos para cima, pulo e tapa; a amostra leva o estado da defesa só quando há', () => {
    const { fake, anim, rec } = recorded();
    anim.setHandsUp(true);
    anim.playContest(0.5512);
    anim.playSteal('l');
    expect(fake.calls).toEqual(['hands:true', 'contest:0.5512', 'steal:l']);
    fake.df = { handsUp: 0.8, jump: 0.31 };
    anim.update(1 / 60, input({ hasBall: false }));
    const d = JSON.parse(JSON.stringify(rec.drain(null)));
    const ok = decodePayload(d)!;
    expect(ok.c).toEqual([
      { op: 'hands', t: 100, up: 1 },
      { op: 'contest', t: 100, h: 0.551 },
      { op: 'steal', t: 100, hand: 'l' },
    ]);
    expect(ok.s.df).toEqual([0.8, 0.31]);
    fake.df = { handsUp: 0, jump: 0 };
    anim.update(1 / 60, input({ hasBall: false }));
    expect(decodePayload(JSON.parse(JSON.stringify(rec.drain(null))))!.s.df).toBeUndefined();
  });

  it('recusa defesa estragada', () => {
    const { anim, rec } = recorded();
    anim.update(1 / 60, input());
    const d = JSON.parse(JSON.stringify(rec.drain(null)));
    expect(decodePayload({ ...d, c: [{ op: 'steal', t: 1, hand: 'x' }] })).toBeNull();
    expect(decodePayload({ ...d, c: [{ op: 'contest', t: 1, h: 9 }] })).toBeNull();
    expect(decodePayload({ ...d, s: { ...d.s, df: [0.5] } })).toBeNull();
    expect(decodePayload({ ...d, s: { ...d.s, df: [0.5, Number.POSITIVE_INFINITY] } })).toBeNull();
    expect(decodePayload({ ...d, c: [{ op: 'hands', t: 1, up: 1 }] })?.c).toEqual([{ op: 'hands', t: 1, up: 1 }]);
  });
});

describe('Rebote com as duas mãos no gravador e no payload', () => {
  it('anota a pegada (alvo no mundo, contato, pulo) e o cancelamento; o decode valida', () => {
    const { fake, anim, rec } = recorded();
    anim.playCatch(new THREE.Vector3(1.23456, 2.5, -0.5), 0.4321, 0.55);
    anim.cancelCatch();
    expect(fake.calls).toEqual(['catch:2.5:0.4321:0.55', 'uncatch']);
    anim.update(1 / 60, input({ hasBall: false }));
    const d = JSON.parse(JSON.stringify(rec.drain(null)));
    expect(decodePayload(d)!.c).toEqual([
      { op: 'catch', t: 100, p: [1.235, 2.5, -0.5], at: 0.432, h: 0.55 },
      { op: 'uncatch', t: 100 },
    ]);
    expect(decodePayload({ ...d, c: [{ op: 'catch', t: 1, p: [0, 1], at: 0.2, h: 0 }] })).toBeNull();
    expect(decodePayload({ ...d, c: [{ op: 'catch', t: 1, p: [0, 1, 2], at: 9, h: 0 }] })).toBeNull();
  });
});
