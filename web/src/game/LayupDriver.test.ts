import { describe, expect, test } from 'vitest';
import { Vec3 } from '../sim/HoopsMath';
import { LayupFinish, type LayupSituation, type Side } from '../sim/HoopsLayup';
import { StickDir, StickGestureKind, makeStickGesture } from '../sim/HoopsProStick';
import { LayupDriver } from './LayupDriver';

// Aro no (0, 0), quadra para +x. De frente para a cesta (olhando para -x) a direita do jogador é -y.
function driving(x: number, y: number, speed: number, hand: Side = 'r'): LayupSituation {
  const position = new Vec3(x, y, 0);
  const dir = new Vec3(-x, -y, 0).normalized();
  return {
    position,
    velocity: dir.scale(speed),
    facing: dir,
    rimFloor: new Vec3(0, 0, 0),
    hoopForward: new Vec3(1, 0, 0),
    ballHand: hand,
    feet: { l: { pos: position, planted: true }, r: { pos: position.add(dir.scale(-0.3)), planted: false } },
    heightM: 1.86,
    baselineX: -1.6,
  };
}

const flick = (dir: StickDir) => makeStickGesture({ kind: StickGestureKind.Flick, dir });

describe('RS dirigindo para a cesta (2K23): bandeja e enterrada pelo Pro Stick', () => {
  const L = new LayupDriver();
  const sit = driving(3.0, -0.6, 4.2);

  test('sem RT: cima = bandeja, baixo = floater, lado = scoop com aquela mão', () => {
    expect(L.stickRequest(flick(StickDir.Up), sit, false, true)?.command).toBe('auto');
    expect(L.stickRequest(flick(StickDir.Down), sit, false, true)?.command).toBe('floater');
    const scoop = L.stickRequest(flick(StickDir.Left), sit, false, true);
    expect(scoop?.command).toBe('scoop');
    expect(scoop?.side).toBe('l');
  });

  test('com RT: cima = duas mãos, lado = uma mão daquele lado, diagonais = tomahawk/moinho e cock-back, baixo = pendurar', () => {
    expect(L.stickRequest(flick(StickDir.Up), sit, true, true)).toMatchObject({ command: 'dunk', finish: LayupFinish.DunkTwoHand });
    expect(L.stickRequest(flick(StickDir.Right), sit, true, true)).toMatchObject({ command: 'dunk', finish: LayupFinish.DunkOneHand, side: 'r' });
    expect(L.stickRequest(flick(StickDir.UpLeft), sit, true, true)).toMatchObject({ finish: LayupFinish.CockBack });
    expect(L.stickRequest(flick(StickDir.DownRight), sit, true, true)).toMatchObject({ finish: LayupFinish.Windmill, side: 'r' });
    expect(L.stickRequest(flick(StickDir.DownRight), driving(3.0, -0.6, 3.5), true, true)).toMatchObject({ finish: LayupFinish.Tomahawk });
    const down = L.stickRequest(flick(StickDir.Down), sit, true, true);
    expect(down?.command).toBe('dunk');
    expect(down?.finish).toBeUndefined();
  });

  test('com RT mas sem enterrada na build: é bandeja', () => {
    expect(L.stickRequest(flick(StickDir.Up), sit, true, false)?.command).toBe('auto');
  });

  test('vindo pela linha de fundo, o lado da linha de fundo é a reversa', () => {
    // Quase na linha do aro (de lado), correndo para dentro do garrafão.
    const side = driving(0.25, -2.6, 4.0);
    const toBaseline = L.stickRequest(flick(StickDir.Right), side, false, true);
    const other = L.stickRequest(flick(StickDir.Left), side, false, true);
    expect([toBaseline?.command, other?.command].sort()).toEqual(['reverse', 'scoop']);
  });

  test('longe do aro, parado ou indo para longe: não é finalização (segue o drible)', () => {
    expect(L.stickRequest(flick(StickDir.Up), driving(8.5, -0.6, 4.2), false, true)).toBeNull();
    expect(L.stickRequest(flick(StickDir.Up), driving(3.0, -0.6, 0.5), false, true)).toBeNull();
    expect(L.stickRequest(makeStickGesture({ kind: StickGestureKind.Rotation }), sit, false, true)).toBeNull();
  });
});
