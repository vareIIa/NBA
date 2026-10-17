// Ajuste de cor da tela de aparência (docs/26, fase 2): matiz, saturação e brilho pelo D-pad sobre a cor de uma zona.
// Puro (sem three nem DOM), para o teste e para o menu. Os valores são HSL de sRGB: h em graus (0–360), s e l em 0–1.

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** A cor com o matiz girado (graus) e a saturação e o brilho somados (0–1, limitados). */
export function shiftHex(hex: string, dh: number, ds: number, dl: number): string {
  const c = hexToHsl(hex);
  return hslToHex({ h: (((c.h + dh) % 360) + 360) % 360, s: Math.min(1, Math.max(0, c.s + ds)), l: Math.min(1, Math.max(0, c.l + dl)) });
}
