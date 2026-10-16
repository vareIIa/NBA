import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyRadialDeadZone, Input } from './Input';

afterEach(() => vi.unstubAllGlobals());

describe('analógico de movimento', () => {
  it('ignora drift dentro do círculo e começa continuamente na borda', () => {
    expect(applyRadialDeadZone(0.1, -0.1)).toEqual({ x: 0, y: 0 });
    expect(applyRadialDeadZone(0.18, 0)).toEqual({ x: 0, y: 0 });
    const edge = applyRadialDeadZone(0.18001, 0);
    expect(edge.x).toBeGreaterThan(0);
    expect(edge.x).toBeLessThan(0.0001);
  });

  it('responde igualmente em todas as direções, preservando diagonais rasas', () => {
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12;
      const stick = applyRadialDeadZone(0.59 * Math.cos(angle), 0.59 * Math.sin(angle));
      expect(Math.hypot(stick.x, stick.y)).toBeCloseTo(0.5, 10);
      expect(stick.x).toBeCloseTo(0.5 * Math.cos(angle), 10);
      expect(stick.y).toBeCloseTo(0.5 * Math.sin(angle), 10);
    }
  });

  it('limita a velocidade diagonal sem alterar sua direção', () => {
    const stick = applyRadialDeadZone(1, -1);
    expect(Math.hypot(stick.x, stick.y)).toBeCloseTo(1, 10);
    expect(stick.x).toBeCloseTo(-stick.y, 10);
    expect(applyRadialDeadZone(0, 1)).toEqual({ x: 0, y: 1 });
  });

  it('aplica a zona radial ao LS e mantém os eixos originais do Pro Stick', () => {
    vi.stubGlobal('navigator', {
      getGamepads: () => [{ connected: true, axes: [0.6, -0.1, 0.2, -0.3], buttons: [] }],
    });
    const input = new Input(new EventTarget() as unknown as Window);
    const state = input.read();
    expect(state.moveX).toBeGreaterThan(0);
    expect(state.moveY).toBeGreaterThan(0);
    expect(state.moveX / state.moveY).toBeCloseTo(6, 10);
    expect(state.proX).toBe(0.2);
    expect(state.proY).toBe(0.3);
    expect(state.pad?.lx).toBe(state.moveX);
  });

  it('mantém o teclado utilizável com o controle conectado e neutro', () => {
    vi.stubGlobal('navigator', { getGamepads: () => [{ connected: true, axes: [0.02, -0.01, 0, 0], buttons: [] }] });
    const target = new EventTarget();
    const input = new Input(target as unknown as Window);
    for (const code of ['KeyW', 'KeyD']) target.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: false }));
    const moving = input.read();
    expect(moving.moveX).toBeCloseTo(Math.SQRT1_2);
    expect(moving.moveY).toBeCloseTo(Math.SQRT1_2);
    target.dispatchEvent(new Event('blur'));
    expect(input.read().moveX).toBe(0);
    expect(input.read().moveY).toBe(0);
  });
});
