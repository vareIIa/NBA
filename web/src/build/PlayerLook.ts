// Aparência do jogador (a tela "Aparência" do MyPlayer, antes do corpo, como no 2K). Doc: docs/26-aparencia.md.
//
// Fase 1: tom de pele (o shader de src/game/SkinTone.ts repinta a pele da textura do HY), uniforme (modelo) e tênis.
// Fase 2: cada jogador tem o uniforme de CASA e o de VISITANTE (modelo + cores por zona) e as cores do tênis. Campo
// ausente numa build antiga sai com o padrão em sanitizeLook; cor ausente numa zona = a cor original da peça.
//
// Sem imports: o servidor de desenvolvimento (Node, sem bundler) e o Worker validam a aparência que chega pela rede com
// este arquivo (BuildCatalog, Hub).

export type KitId = 'vermelha' | 'branca';
export type ShoeId = 'tenis_retro_alto_1' | 'tenis_verniz_11' | 'tenis_cimento_4' | 'tenis_elefante_3' | 'tenis_baixo_moderno';
/** Lado do uniforme: o de casa (o mandante veste) ou o de visitante (o visitante veste, salvo se for parecido com o outro). */
export type Side = 'casa' | 'visitante';

/** Cores por zona de cada peça (0 = zona principal, 1, 2, 3). '' = a cor original da zona. Até 4 zonas (RGBA da máscara). */
export interface LookColors {
  casa?: string[];
  visitante?: string[];
  tenis?: string[];
}

export interface PlayerLook {
  /** Tom de pele, '#rrggbb' (sRGB): a cor média da pele iluminada que o jogador escolheu. */
  skin: string;
  /** Uniforme de casa (regata + bermuda, modelo). */
  kit: KitId;
  /** Uniforme de visitante (regata + bermuda, modelo). Sem ele numa build antiga: o outro modelo (otherKit). */
  kitAway: KitId;
  /** Tênis (nome do GLB em assets/gear). */
  shoes: ShoeId;
  /** Cores escolhidas por zona. Ausente = as cores originais de todas as peças. */
  colors?: LookColors;
}

/**
 * Tom da textura do corpo (o `jogador_branco` do HY): a cor da paleta que corresponde à pele pintada. Escolher este tom
 * deixa a textura exatamente como veio (razão 1); os outros multiplicam a pele por tom / TextureSkin.
 */
export const TextureSkin = '#e9bba9';

/** Paleta de tons de pele, do mais claro ao mais escuro (como os quadradinhos do 2K). O 2º é o do corpo do HY. */
export const SkinTones: readonly string[] = [
  '#f6dccc',
  TextureSkin,
  '#e8bc98',
  '#dcab84',
  '#cf9a72',
  '#c08862',
  '#b07753',
  '#9f6847',
  '#8e5b3c',
  '#7d4e33',
  '#6c422b',
  '#5c3724',
  '#4d2d1e',
  '#3f2418',
  '#321c13',
];

export const Kits: Readonly<Record<KitId, { label: string; sub: string; color: string; trim: string }>> = {
  vermelha: { label: 'Vermelho', sub: 'Kit vermelho', color: '#c8202c', trim: '#f2f2f2' },
  branca: { label: 'Branco', sub: 'Kit branco', color: '#f2f2f2', trim: '#c8202c' },
};
export const KitOrder: readonly KitId[] = ['vermelha', 'branca'];

export const Shoes: Readonly<Record<ShoeId, { label: string; sub: string; colors: readonly string[] }>> = {
  tenis_retro_alto_1: { label: 'Retrô Alto 1', sub: 'Cano alto · vermelho, branco e preto', colors: ['#c8202c', '#f2f2f2', '#111111'] },
  tenis_verniz_11: { label: 'Verniz 11', sub: 'Cano médio · preto e azul-gelo', colors: ['#111111', '#bcd8ec', '#f2f2f2'] },
  tenis_cimento_4: { label: 'Cimento 4', sub: 'Cano médio · branco e cimento', colors: ['#f2f2f2', '#9a9a9a', '#c8202c'] },
  tenis_elefante_3: { label: 'Elefante 3', sub: 'Cano médio · preto, vermelho e cimento', colors: ['#111111', '#c8202c', '#9a9a9a'] },
  tenis_baixo_moderno: { label: 'Baixo Moderno', sub: 'Cano baixo · marinho e verde-neon', colors: ['#1d2a4a', '#9cf03c', '#f2f2f2'] },
};
export const ShoeOrder: readonly ShoeId[] = ['tenis_retro_alto_1', 'tenis_verniz_11', 'tenis_cimento_4', 'tenis_elefante_3', 'tenis_baixo_moderno'];

/** Zonas por peça: os 4 canais da máscara (assets/look/zonas, gravadas por web/tools/zonas-cor.py). */
export const MaxZones = 4;

/**
 * Cor original de cada zona (0 = principal), por peça (nome do GLB em assets/gear). A ordem é a dos canais da máscara
 * (R, G, B, A); null = zona que a peça não tem. Os mesmos números estão em assets/look/zonas/<peça>_zonas.json (um teste
 * confere).
 */
export const GearZones: Readonly<Record<string, readonly (string | null)[]>> = {
  bermuda_branca: ['#b9bdce', '#ab868e', '#c84958', null],
  bermuda_vermelha: ['#882e34', '#fdfbfa', '#d6b4b7', null],
  regata_branca: ['#d1d7e0', '#56649b', '#d85359', null],
  regata_vermelha: ['#bd3440', '#fcf4f2', null, null],
  tenis_baixo_moderno: ['#61cb45', '#051d4a', '#132d3e', null],
  tenis_cimento_4: ['#b2b1b0', '#f5f5f4', '#5c5b5c', '#c35f5f'],
  tenis_elefante_3: ['#272525', '#ec4746', '#f8f8f8', null],
  tenis_retro_alto_1: ['#e42929', '#302a29', '#fdfdfc', null],
  tenis_verniz_11: ['#0f191e', '#40d2fb', '#eeefef', '#74797b'],
};

/** Paleta rápida do menu (16 cores, do claro ao escuro e das cores do time). Também sorteia o Aleatório. */
export const UniformPalette: readonly string[] = [
  '#f5f5f4',
  '#c9ccd2',
  '#7d8189',
  '#2b2e35',
  '#111111',
  '#c8202c',
  '#7a1020',
  '#ef6a2b',
  '#f4c430',
  '#9cf03c',
  '#1f7a3e',
  '#16a6a6',
  '#bcd8ec',
  '#2f6fd6',
  '#1d2a4a',
  '#6b3fa0',
];

/** Aparência de antes da tela existir: o corpo do HY como veio, kit vermelho em casa, branco de visitante, tênis alto 1. */
export const DefaultLook: Readonly<PlayerLook> = Object.freeze({ skin: TextureSkin, kit: 'vermelha', kitAway: 'branca', shoes: 'tenis_retro_alto_1' });

const HexColor = /^#[0-9a-f]{6}$/;

export const otherKit = (kit: KitId): KitId => (kit === 'vermelha' ? 'branca' : 'vermelha');

/** Cores por zona saneadas: até 4 por lado, '#rrggbb' minúsculo ou '' (original); sem nenhuma cor escolhida, nada. */
function sanitizeColors(raw: unknown): LookColors | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: LookColors = {};
  for (const side of ['casa', 'visitante', 'tenis'] as const) {
    const list = Array.isArray(r[side]) ? (r[side] as unknown[]).slice(0, MaxZones) : [];
    const hex = list.map((c) => (typeof c === 'string' && HexColor.test(c.toLowerCase()) ? c.toLowerCase() : ''));
    while (hex.length > 0 && hex[hex.length - 1] === '') hex.pop();
    if (hex.length > 0) out[side] = hex;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Aparência que veio de fora (localStorage, rede, URL) → aparência válida; o que faltar ou vier errado é o padrão. */
export function sanitizeLook(raw: unknown): PlayerLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const skin = typeof r['skin'] === 'string' ? r['skin'].toLowerCase() : '';
  const kit = KitOrder.find((k) => k === r['kit']) ?? DefaultLook.kit;
  const colors = sanitizeColors(r['colors']);
  return {
    skin: HexColor.test(skin) ? skin : DefaultLook.skin,
    kit,
    kitAway: KitOrder.find((k) => k === r['kitAway']) ?? otherKit(kit),
    shoes: ShoeOrder.find((s) => s === r['shoes']) ?? DefaultLook.shoes,
    ...(colors ? { colors } : {}),
  };
}

/** Mesma aparência (depois de saneadas): as duas com a mesma ordem de campos, então o JSON compara. */
export const sameLook = (a: PlayerLook, b: PlayerLook): boolean => JSON.stringify(sanitizeLook(a)) === JSON.stringify(sanitizeLook(b));

/** Modelo do uniforme num dos lados. */
export const sideKit = (look: PlayerLook, side: Side): KitId => (side === 'casa' ? look.kit : look.kitAway);

/** A cor escolhida na zona `i` do lado (ou a original da peça `piece`, se não escolheu). */
export function zoneHex(look: PlayerLook, side: Side | 'tenis', piece: string, i: number): string {
  const raw = look.colors?.[side]?.[i] ?? '';
  return HexColor.test(raw) ? raw : (GearZones[piece]?.[i] ?? '#808080');
}

/** Cores escolhidas de cada peça (crus, '' = original): o PlayerGear pinta a zona com elas. */
export function lookColors(look: PlayerLook, side: Side): { shoes: readonly string[]; jersey: readonly string[]; shorts: readonly string[] } {
  return { shoes: look.colors?.tenis ?? [], jersey: look.colors?.[side] ?? [], shorts: look.colors?.[side] ?? [] };
}

/** Luz em Lab (D65), para medir se duas cores são parecidas. */
function toLab(hex: string): [number, number, number] {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const r = lin(parseInt(hex.slice(1, 3), 16) / 255);
  const g = lin(parseInt(hex.slice(3, 5), 16) / 255);
  const b = lin(parseInt(hex.slice(5, 7), 16) / 255);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Diferença de cor (ΔE76 em Lab): ~2 é quase igual, ~25 já se distingue bem de longe. */
export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Limiar do choque: cores principais a menos de 25 de distância se confundem no jogo (o visitante troca). */
export const ClashDeltaE = 25;

/** Cor principal do uniforme num lado: a zona 0 da regata (a maior área do kit). */
export function mainColor(look: PlayerLook, side: Side): string {
  return zoneHex(look, side, `regata_${sideKit(look, side)}`, 0);
}

/**
 * Uniformes da partida (decisão do diretor, 2026-10-16). O mandante (lado 0; contra a CPU, o jogador) veste o de casa.
 * O visitante (lado 1; contra a CPU, a CPU) veste o de visitante; se a cor principal dele se confundir com a do
 * mandante, ele usa o outro uniforme dele (o de casa). Se os dois forem parecidos de qualquer jeito, fica o de visitante.
 */
export function matchWear(host: PlayerLook, guest: PlayerLook): { host: Side; guest: Side } {
  const h = mainColor(host, 'casa');
  if (!clashes(h, mainColor(guest, 'visitante'))) return { host: 'casa', guest: 'visitante' };
  return { host: 'casa', guest: clashes(h, mainColor(guest, 'casa')) ? 'visitante' : 'casa' };
}

/** matchWear do ponto de vista de um jogador: o uniforme que ele veste e o que o outro veste. */
export function wearFor(iAmHost: boolean, mine: PlayerLook, theirs: PlayerLook): { mine: Side; theirs: Side } {
  const w = iAmHost ? matchWear(mine, theirs) : matchWear(theirs, mine);
  return iAmHost ? { mine: w.host, theirs: w.guest } : { mine: w.guest, theirs: w.host };
}

export function clashes(a: string, b: string): boolean {
  return colorDistance(a, b) < ClashDeltaE;
}

/** Aparência sorteada (botão "Aleatório", jogadores da CPU). `random` em [0, 1). Cores: as originais. */
export function randomLook(random: () => number = Math.random): PlayerLook {
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
  return { skin: pick(SkinTones), kit: pick(KitOrder), kitAway: pick(KitOrder), shoes: pick(ShoeOrder) };
}

/** Sorteio repetível a partir de um texto (a CPU "Flash" tem sempre a mesma cara). */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Peças a vestir (o PlayerGear carrega). `base` = pasta dos assets ('assets/'); `side` = o uniforme que se veste. */
export function lookGear(look: PlayerLook, base = 'assets/', side: Side = 'casa'): { shoes: string; jersey: string; shorts: string } {
  const kit = sideKit(look, side);
  return {
    shoes: `${base}gear/${look.shoes}.glb`,
    jersey: `${base}gear/regata_${kit}.glb`,
    shorts: `${base}gear/bermuda_${kit}.glb`,
  };
}

/**
 * Parâmetros de teste na URL por cima da aparência: ?uniforme=branco|vermelho (o de casa), ?tenis=<GLB>, ?pele=<índice da
 * paleta ou rrggbb>. Os antigos (?uniforme, ?tenis) continuam valendo como antes da tela existir.
 */
export function lookWithParams(look: PlayerLook, params: URLSearchParams): PlayerLook {
  const out = { ...look };
  const kit = params.get('uniforme');
  if (kit === 'branco' || kit === 'branca') out.kit = 'branca';
  else if (kit === 'vermelho' || kit === 'vermelha') out.kit = 'vermelha';
  const shoes = ShoeOrder.find((s) => s === params.get('tenis'));
  if (shoes) out.shoes = shoes;
  const skin = params.get('pele');
  if (skin !== null) {
    const i = Number(skin);
    if (/^\d+$/.test(skin) && i < SkinTones.length) out.skin = SkinTones[i]!;
    else if (HexColor.test(`#${skin.toLowerCase()}`)) out.skin = `#${skin.toLowerCase()}`;
  }
  return out;
}
