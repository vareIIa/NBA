import { describe, expect, it } from 'vitest';
import { PauseItems, nextHubIndex } from './PauseMenu';

describe('lista inicial do menu de pausa', () => {
  it('a primeira opção abre o criador de arremessos', () => {
    expect(PauseItems[0].id).toBe('shots');
    expect(PauseItems[0].label).toBe('Arremessos');
  });

  it('cima e baixo andam pela lista e dão a volta nas pontas', () => {
    const n = PauseItems.length;
    expect(nextHubIndex(0, 'down', n)).toBe(1);
    expect(nextHubIndex(n - 1, 'down', n)).toBe(0);
    expect(nextHubIndex(0, 'up', n)).toBe(n - 1);
    expect(nextHubIndex(1, 'confirm', n)).toBe(1);
    expect(nextHubIndex(0, 'down', 0)).toBe(0);
  });
});
