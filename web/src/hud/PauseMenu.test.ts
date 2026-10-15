import { describe, expect, it } from 'vitest';
import { RepeatDelay, holdRepeats, keyToAction } from './PauseMenu';

describe('teclas do menu', () => {
  it('setas e WASD andam, Enter e Espaço escolhem, Esc volta', () => {
    expect(keyToAction('ArrowUp')).toBe('up');
    expect(keyToAction('KeyW')).toBe('up');
    expect(keyToAction('KeyS')).toBe('down');
    expect(keyToAction('KeyA')).toBe('left');
    expect(keyToAction('ArrowRight')).toBe('right');
    expect(keyToAction('Enter')).toBe('confirm');
    expect(keyToAction('Space')).toBe('confirm');
    expect(keyToAction('Escape')).toBe('back');
    expect(keyToAction('KeyP')).toBeNull();
  });
});

describe('direção segurada', () => {
  it('repete depois do atraso e depois a cada intervalo', () => {
    const hold = { wait: RepeatDelay };
    expect(holdRepeats(hold, 0.3)).toBe(0);
    expect(holdRepeats(hold, 0.2)).toBe(1);
    expect(holdRepeats(hold, 0.11)).toBe(1);
    expect(holdRepeats(hold, 0.005)).toBe(0);
  });

  it('um quadro muito longo não dispara uma avalanche', () => {
    expect(holdRepeats({ wait: 0 }, 60)).toBe(8);
  });
});
