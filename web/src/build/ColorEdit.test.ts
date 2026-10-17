import { describe, expect, it } from 'vitest';
import { hexToHsl, hslToHex, shiftHex } from './ColorEdit';
import { UniformPalette } from './PlayerLook';

describe('ajuste de cor (matiz, saturação, brilho)', () => {
  it('ida e volta: cada cor da paleta volta igual (com 1 de folga por canal)', () => {
    for (const hex of UniformPalette) {
      const back = hslToHex(hexToHsl(hex));
      for (let i = 1; i < 7; i += 2) expect(Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16))).toBeLessThanOrEqual(1);
    }
  });

  it('cinzas não têm matiz nem saturação; primárias caem nos matizes certos', () => {
    expect(hexToHsl('#7d8189').s).toBeCloseTo(0.04, 1);
    expect(hexToHsl('#ff0000').h).toBeCloseTo(0, 6);
    expect(hexToHsl('#00ff00').h).toBeCloseTo(120, 6);
    expect(hexToHsl('#0000ff').h).toBeCloseTo(240, 6);
  });

  it('girar o matiz dá a volta (360 = o mesmo), e saturação e brilho ficam entre 0 e 1', () => {
    expect(shiftHex('#c8202c', 360, 0, 0)).toBe('#c8202c');
    expect(shiftHex('#c8202c', -360, 0, 0)).toBe('#c8202c');
    expect(shiftHex('#2f6fd6', 0, 5, 0)).toBe(shiftHex('#2f6fd6', 0, 1, 0));
    expect(shiftHex('#2f6fd6', 0, 0, -5)).toBe('#000000');
    expect(shiftHex('#2f6fd6', 0, 0, 5)).toBe('#ffffff');
  });

  it('o matiz que anda 120° sai da cor de um canal para o próximo', () => {
    expect(shiftHex('#ff0000', 120, 0, 0)).toBe('#00ff00');
    expect(shiftHex('#00ff00', 120, 0, 0)).toBe('#0000ff');
  });
});
