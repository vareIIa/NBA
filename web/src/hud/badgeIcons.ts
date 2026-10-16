// Ícones SVG (inline) dos badges, do takeover e do arremesso, no estilo do jogo de referência: escudo com o símbolo
// da categoria, colorido pelo nível (bronze, prata, ouro, Hall of Fame roxo).

export type IconCategory = 'Finishing' | 'Shooting' | 'Playmaking' | 'Defense';
export type IconTier = 'Bronze' | 'Silver' | 'Gold' | 'HallOfFame';

export const TierColor: Record<IconTier, string> = {
  Bronze: '#c9814a',
  Silver: '#cfd6de',
  Gold: '#f2c230',
  HallOfFame: '#8f5cff',
};

const Glyph: Record<IconCategory, string> = {
  // Aro com a bola caindo.
  Finishing:
    '<circle cx="24" cy="17" r="5.5" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M14 27h20M16 27l3 9M32 27l-3 9M24 27v9M20 36h8" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  // Barras subindo (o "volume" do arremessador).
  Shooting:
    '<path d="M15 35v-6M21 35v-10M27 35v-14M33 35v-19" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>',
  // Raio (primeiro passo / handles).
  Playmaking: '<path d="M27 11l-11 15h7l-3 12 12-16h-7z" fill="currentColor"/>',
  // Mão fechando (defesa).
  Defense:
    '<path d="M17 33v-11a2 2 0 0 1 4 0v-5a2 2 0 0 1 4 0v-1a2 2 0 0 1 4 0v3a2 2 0 0 1 4 0v10c0 5-3 8-8 8h-1c-4 0-7-2-7-4z" fill="currentColor"/>',
};

/** Escudo do badge (48x48), colorido pelo nível. */
export function badgeIconSvg(category: IconCategory, tier: IconTier): string {
  const color = TierColor[tier];
  return `<svg viewBox="0 0 48 48" class="gh-icon" style="color:${color}">
    <path d="M24 3l17 6v13c0 11-7 19-17 23C14 41 7 33 7 22V9z" fill="#111" stroke="${color}" stroke-width="2.4"/>
    <path d="M24 7l13 4.6v10.6c0 8.6-5.4 15-13 18.4-7.6-3.4-13-9.8-13-18.4V11.6z" fill="none" stroke="${color}" stroke-opacity=".35" stroke-width="1.2"/>
    ${Glyph[category]}
  </svg>`;
}

/** Ícone de arremesso (jogador no salto) para o aviso de timing. */
export const shotIconSvg = `<svg viewBox="0 0 48 48" class="gh-icon" style="color:#e8fff0">
  <circle cx="30" cy="9" r="4" fill="currentColor"/>
  <circle cx="24" cy="15" r="3.4" fill="currentColor"/>
  <path d="M22 20l-3 11 4 1-2 10M24 20l5 9-2 13M21 22l5-8M26 21l4-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>
</svg>`;

/** Ícones redondos dos takeovers (o "negocinho" com o fundo que enche). */
export const TakeoverGlyph: Record<string, string> = {
  // Asa / velocidade: pressão no aro.
  slasher:
    '<path d="M9 30c8-2 14-8 17-17 1 6-1 11-4 15 4-1 8-4 10-8 0 7-5 13-12 15-4 1-8 0-11-5z" fill="currentColor"/>',
  // Alvo: arremesso.
  shooter:
    '<circle cx="24" cy="24" r="12" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="24" r="6" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="24" r="2" fill="currentColor"/><path d="M24 24l11-11M31 11h5v5" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
  // Raio: criação com a bola.
  handles: '<path d="M27 9l-11 16h7l-3 14 12-17h-7z" fill="currentColor"/>',
  // Escudo: defesa.
  lockdown: '<path d="M24 9l12 4v9c0 8-5 13-12 16-7-3-12-8-12-16v-9z" fill="currentColor"/>',
  // Coroa: team takeover.
  team: '<path d="M10 33l3-16 7 8 4-11 4 11 7-8 3 16z" fill="currentColor"/><path d="M10 37h28" stroke="currentColor" stroke-width="3"/>',
};

export function takeoverIconSvg(glyph: string): string {
  return `<svg viewBox="0 0 48 48" class="gh-icon">${TakeoverGlyph[glyph] ?? TakeoverGlyph.shooter}</svg>`;
}
