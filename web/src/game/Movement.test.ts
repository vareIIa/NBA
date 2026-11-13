import { describe, expect, it } from 'vitest';
import { Vec3 } from '../sim/HoopsMath';
import { approachVelocity, canArcTurn, driveResponse, steerVelocity, turnFacing } from './Movement';

describe('resposta da locomoção', () => {
  it('preserva a arrancada e não ultrapassa a velocidade desejada', () => {
    const target = new Vec3(3.9, 0);
    expect(approachVelocity(new Vec3(), target, 0.1, 6.5, 14).x).toBeCloseTo(0.65);
    expect(approachVelocity(new Vec3(), target, 1, 6.5, 14)).toEqual(target);
  });

  it('usa a mesma frenagem ao soltar o stick, reduzi-lo ou inverter a direção', () => {
    const running = new Vec3(3.9, 0);
    for (const target of [new Vec3(), new Vec3(1, 0), new Vec3(-3.9, 0)]) {
      expect(approachVelocity(running, target, 0.1, 6.5, 14).x).toBeCloseTo(2.5);
    }
    expect(approachVelocity(running, new Vec3(), 1, 6.5, 14)).toEqual(new Vec3());
  });

  it('freia e começa a voltar no mesmo quadro, sem aplicar o freio como aceleração', () => {
    const velocity = approachVelocity(new Vec3(1.4, 0), new Vec3(-3.9, 0), 0.2, 6.5, 14);
    expect(velocity.x).toBeCloseTo(-0.65);
  });

  it('mantém a resposta da velocidade entre 30, 60, 120 e 144 Hz para o mesmo alvo', () => {
    for (const target of [new Vec3(), new Vec3(-3.9, 0), new Vec3(0, 3.9)]) {
      const expected = approachVelocity(new Vec3(3.9, 0), target, 0.5, 6.5, 14);
      for (const hz of [30, 60, 120, 144]) {
        let velocity = new Vec3(3.9, 0);
        for (let frame = 0; frame < hz / 2; frame++) velocity = approachVelocity(velocity, target, 1 / hz, 6.5, 14);
        expect(velocity.sub(expected).length()).toBeLessThan(1e-9);
      }
    }
  });

  it('preserva o impulso dos dribles quando aceleração e freio são iguais', () => {
    const target = new Vec3(0, 3);
    const velocity = approachVelocity(new Vec3(4, 0), target, 0.1, 30, 30);
    expect(velocity.x).toBeCloseTo(1.6);
    expect(velocity.y).toBeCloseTo(1.8);
  });
});

describe('arranque e parada com a bola (régua do 2K: 1–3 q de 30 fps, tolerância de 1 q)', () => {
  /** Quadros de 30 fps até `done(velocidade)`, simulando a 60 Hz. */
  const quadros = (from: Vec3, target: Vec3, accel: number, brake: number, done: (speed: number) => boolean): number => {
    let velocity = from;
    for (let frame = 1; frame <= 240; frame++) {
      velocity = approachVelocity(velocity, target, 1 / 60, accel, brake);
      if (done(velocity.length())) return frame / 2;
    }
    return Infinity;
  };

  it('com RT chega a 90% do sprint em até 4 q; antes levava mais de 20', () => {
    const sprint = new Vec3(6.2, 0);
    const now = driveResponse(true, true);
    expect(quadros(new Vec3(), sprint, now.accel, now.brake, (s) => s >= 0.9 * 6.2)).toBeLessThanOrEqual(4);
    const old = driveResponse(true, true, true);
    expect(quadros(new Vec3(), sprint, old.accel, old.brake, (s) => s >= 0.9 * 6.2)).toBeGreaterThan(20);
  });

  it('soltando o LS no sprint cai a menos de 10% em até 4 q', () => {
    const now = driveResponse(true, true);
    expect(quadros(new Vec3(6.2, 0), new Vec3(), now.accel, now.brake, (s) => s < 0.62)).toBeLessThanOrEqual(4);
  });

  it('sem RT o primeiro passo é mais lento que com RT, e sem a bola nada muda', () => {
    expect(driveResponse(true, false).accel).toBeLessThan(driveResponse(true, true).accel);
    expect(driveResponse(false, true)).toEqual({ accel: 6.5, brake: 14 });
    expect(driveResponse(true, true, true)).toEqual({ accel: 6.5, brake: 14 });
  });
});

describe('orientação do jogador', () => {
  it('começa a girar mesmo com o destino exatamente a 180 graus', () => {
    for (const sign of [-1, 1]) {
      const from = new Vec3(sign, 0);
      const target = from.neg();
      const first = turnFacing(from, target, 7, 1 / 60);
      expect(Math.abs(first.y)).toBeGreaterThan(0.1);
      let facing = from;
      for (let i = 0; i < 60; i++) facing = turnFacing(facing, target, 7, 1 / 60);
      expect(facing.dot(target)).toBeGreaterThan(0.999);
    }
  });

  it('atravessa a emenda de -180/180 graus pelo caminho curto', () => {
    const direction = (degrees: number) => new Vec3(Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180));
    const facing = turnFacing(direction(179), direction(-179), 7, 0.1);
    expect(facing.dot(new Vec3(-1, 0))).toBeGreaterThan(0.999);
    expect(facing.length()).toBeCloseTo(1, 12);
  });

  it('produz a mesma orientação nos quatro FPS e mantém a pose com dt zero', () => {
    const from = new Vec3(1, 0);
    const target = new Vec3(0, -1);
    const expected = turnFacing(from, target, 7, 0.5);
    expect(turnFacing(from, target, 7, 0)).toEqual(from);
    for (const hz of [30, 60, 120, 144]) {
      let facing = from;
      for (let frame = 0; frame < hz / 2; frame++) facing = turnFacing(facing, target, 7, 1 / hz);
      expect(facing.sub(expected).length()).toBeLessThan(1e-9);
    }
  });
});

describe('curva em arco em disparada', () => {
  it('gira o rumo sem perder velocidade e chega ao alvo', () => {
    let v = new Vec3(0, 6.2, 0);
    const target = new Vec3(6.2 * Math.sin(1.2), 6.2 * Math.cos(1.2), 0); // 69° para a direita
    let min = Infinity;
    let frames = 0;
    while (v.sub(target).length() > 1e-6 && frames < 200) {
      v = steerVelocity(v, target, 1 / 60, 46, 46);
      min = Math.min(min, v.length());
      frames++;
    }
    expect(min).toBeGreaterThan(6.19);
    expect(frames).toBeGreaterThanOrEqual(15); // 69° a 270°/s = 0,25 s
    expect(frames).toBeLessThanOrEqual(17);
  });

  it('não vale devagar nem para voltar para trás', () => {
    expect(canArcTurn(new Vec3(0, 2, 0), new Vec3(4, 0, 0))).toBe(false);
    expect(canArcTurn(new Vec3(0, 6, 0), new Vec3(0, -6, 0))).toBe(false);
    expect(canArcTurn(new Vec3(0, 6, 0), new Vec3(4, 4, 0))).toBe(true);
  });

  it('é igual a 60 e a 144 Hz', () => {
    const run = (hz: number) => {
      let v = new Vec3(0, 6.2, 0);
      const target = new Vec3(5, 3, 0);
      for (let i = 0; i < hz / 12; i++) v = steerVelocity(v, target, 1 / hz, 46, 46);
      return v;
    };
    expect(run(60).sub(run(144)).length()).toBeLessThan(0.05);
  });
});
