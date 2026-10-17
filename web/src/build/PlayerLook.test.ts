import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ClashDeltaE,
  DefaultLook,
  GearZones,
  KitOrder,
  MaxZones,
  ShoeOrder,
  SkinTones,
  TextureSkin,
  UniformPalette,
  colorDistance,
  lookColors,
  lookGear,
  lookWithParams,
  matchWear,
  mainColor,
  otherKit,
  randomLook,
  sameLook,
  sanitizeLook,
  seededRandom,
  wearFor,
  zoneHex,
} from './PlayerLook';
import { DefaultBuild, newDraft, sanitizeBuild } from './BuildRules';
import type { PlayerBuild } from './PlayerBuild';
import { normalizeBuild } from '../net/builds/BuildCatalog';
import { sanitizeCard } from '../net/hub/Hub';
import { CpuRoster, cpuBuild } from '../game/cpu/CpuRoster';

describe('aparência (docs/26)', () => {
  it('padrão = o jogador de antes da tela: textura como veio, kit vermelho em casa, branco de visitante, tênis alto 1', () => {
    expect(DefaultLook).toEqual({ skin: TextureSkin, kit: 'vermelha', kitAway: 'branca', shoes: 'tenis_retro_alto_1' });
    expect(SkinTones).toContain(TextureSkin);
    expect(DefaultBuild.look).toEqual(DefaultLook);
    expect(newDraft('PG').look).toEqual(DefaultLook);
  });

  it('a paleta de pele vai do mais claro ao mais escuro', () => {
    const luma = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    for (let i = 1; i < SkinTones.length; i++) expect(luma(SkinTones[i]!)).toBeLessThan(luma(SkinTones[i - 1]!));
  });

  it('o que vem de fora é limpo: campo errado ou faltando vira o padrão', () => {
    expect(sanitizeLook(undefined)).toEqual(DefaultLook);
    expect(sanitizeLook({ skin: '#ABCDEF', kit: 'branca', shoes: 'tenis_cimento_4' })).toEqual({
      skin: '#abcdef',
      kit: 'branca',
      kitAway: 'vermelha',
      shoes: 'tenis_cimento_4',
    });
    expect(sanitizeLook({ skin: 'red', kit: 'azul', kitAway: 'azul', shoes: '../../segredo' })).toEqual(DefaultLook);
    expect(sanitizeLook({ skin: '#12345', kit: 3 })).toEqual(DefaultLook);
  });

  it('build de antes da fase 2 (sem uniforme de visitante nem cores): visitante é o outro modelo, sem cores', () => {
    const old = sanitizeLook({ skin: '#3f2418', kit: 'branca', shoes: 'tenis_verniz_11' });
    expect(old.kitAway).toBe(otherKit('branca'));
    expect(old).not.toHaveProperty('colors');
    expect(sanitizeLook({ skin: '#3f2418', kit: 'vermelha', shoes: 'tenis_verniz_11' }).kitAway).toBe('branca');
  });

  it('cores: hex minúsculo, até 4 zonas por lado, o que for inválido vira original ("") e o fim vazio some', () => {
    const l = sanitizeLook({
      kit: 'vermelha',
      colors: { casa: ['#ABCDEF', 'nope', 7, '#123456', '#ffffff', '#000000'], visitante: ['', ''], tenis: ['#C8202C'] },
    });
    expect(l.colors).toEqual({ casa: ['#abcdef', '', '', '#123456'], tenis: ['#c8202c'] });
    expect(sanitizeLook({ colors: { casa: ['', ''] } })).not.toHaveProperty('colors');
    expect(sanitizeLook({ colors: 'vermelho' })).not.toHaveProperty('colors');
    expect(sanitizeLook({ colors: { lado: ['#000000'] } })).not.toHaveProperty('colors');
  });

  it('build salva antes da tela de aparência abre com a aparência padrão', () => {
    const old = { ...DefaultBuild, id: 'velha' } as Partial<PlayerBuild>;
    delete old.look;
    expect(sanitizeBuild(old as PlayerBuild).look).toEqual(DefaultLook);
  });

  it('sameLook compara o que o jogador vê (as cores entram)', () => {
    expect(sameLook(DefaultLook, sanitizeLook({ ...DefaultLook, colors: { casa: ['', ''] } }))).toBe(true);
    expect(sameLook(DefaultLook, { ...DefaultLook, colors: { casa: ['#2f6fd6'] } })).toBe(false);
  });

  it('catálogo compartilhado guarda a aparência (com cores) e limpa a inválida; cabe nos 4 KB', () => {
    const raw = {
      ...DefaultBuild,
      id: 'b123abc',
      look: { skin: '#3f2418', kit: 'branca', kitAway: 'vermelha', shoes: 'tenis_verniz_11', colors: { casa: ['#2f6fd6', '#f5f5f4'], visitante: ['#111111'], tenis: ['#2f6fd6', '#f4c430', '#9cf03c', '#6b3fa0'] } },
    };
    expect(normalizeBuild(raw, Date.now())!.look).toEqual(raw.look);
    expect(normalizeBuild({ ...raw, look: { skin: 'x' } }, Date.now())!.look).toEqual(DefaultLook);
    // Cabe no limite do catálogo (4 KB por build), com as 4 zonas de todas as peças escolhidas.
    expect(JSON.stringify(normalizeBuild(raw, Date.now())).length).toBeLessThan(4096);
  });

  it('cartão do online leva a aparência (o oponente monta o boneco com ela)', () => {
    const look = { skin: '#4d2d1e', kit: 'branca', kitAway: 'vermelha', shoes: 'tenis_elefante_3', colors: { visitante: ['#2f6fd6'] } };
    expect(sanitizeCard({ name: 'A', look }).look).toEqual(look);
    // Cliente antigo, sem o campo: a padrão.
    expect(sanitizeCard({ name: 'A' }).look).toEqual(DefaultLook);
  });

  it('cores originais: os números da paleta conferem com as máscaras gravadas (assets/look/zonas)', () => {
    for (const piece of Object.keys(GearZones)) {
      const json = JSON.parse(readFileSync(resolve('public/assets/look/zonas', `${piece}_zonas.json`), 'utf8')) as { cores: (string | null)[] };
      expect(json.cores).toEqual(GearZones[piece]);
      expect(GearZones[piece]).toHaveLength(MaxZones);
    }
    // A zona 0 é a maior de cada peça: a cor principal do uniforme.
    expect(zoneHex(DefaultLook, 'casa', 'regata_vermelha', 0)).toBe('#bd3440');
    expect(zoneHex({ ...DefaultLook, colors: { casa: ['#2f6fd6'] } }, 'casa', 'regata_vermelha', 0)).toBe('#2f6fd6');
    expect(zoneHex({ ...DefaultLook, colors: { casa: ['#2f6fd6'] } }, 'casa', 'regata_vermelha', 1)).toBe('#fcf4f2');
  });

  it('paleta rápida: 16 cores distintas, todas hex', () => {
    expect(UniformPalette).toHaveLength(16);
    expect(new Set(UniformPalette).size).toBe(16);
    for (const c of UniformPalette) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('uniformes da partida: o mandante veste o de casa; o visitante, o de visitante', () => {
    expect(matchWear(DefaultLook, DefaultLook)).toEqual({ host: 'casa', guest: 'visitante' });
    // Visitante vermelho nos dois uniformes e mandante vermelho: os três se confundem, fica o de visitante.
    const red = { ...DefaultLook, kitAway: 'vermelha' as const };
    expect(matchWear(DefaultLook, red)).toEqual({ host: 'casa', guest: 'visitante' });
  });

  it('choque: cor principal parecida troca para o outro uniforme do visitante; se os dois forem parecidos, fica o de visitante', () => {
    // Mandante vermelho; visitante com o de visitante vermelho (choca) e o de casa branco (não choca): veste o de casa.
    const guest = { ...DefaultLook, kit: 'branca' as const, kitAway: 'vermelha' as const };
    expect(matchWear(DefaultLook, guest)).toEqual({ host: 'casa', guest: 'casa' });
    // Os dois de vermelho: nenhum uniforme do visitante escapa, fica o de visitante.
    const bothRed = { ...DefaultLook, kit: 'vermelha' as const, kitAway: 'vermelha' as const };
    expect(matchWear(DefaultLook, bothRed)).toEqual({ host: 'casa', guest: 'visitante' });
    // Cor escolhida no visitante que se confunde com a do mandante: troca pelo de casa (branco, que não choca).
    const picked = { ...DefaultLook, kit: 'branca' as const, colors: { visitante: ['#c8202c'] } };
    expect(matchWear(DefaultLook, picked).guest).toBe('casa');
    expect(matchWear(DefaultLook, { ...DefaultLook, colors: { visitante: ['#2f6fd6'] } }).guest).toBe('visitante');
  });

  it('os dois clientes chegam ao mesmo par de uniformes (wearFor é a visão de cada um)', () => {
    const samples = [DefaultLook, { ...DefaultLook, kit: 'branca' as const, kitAway: 'vermelha' as const }, { ...DefaultLook, colors: { casa: ['#2f6fd6'], visitante: ['#c8202c'] } }];
    for (const a of samples)
      for (const b of samples) {
        const host = wearFor(true, a, b);
        const guest = wearFor(false, b, a);
        expect(host.mine).toBe(guest.theirs);
        expect(host.theirs).toBe(guest.mine);
      }
  });

  it('a distância de cor: parecidas abaixo do limiar, o branco e o vermelho bem longe', () => {
    expect(colorDistance('#c8202c', '#c8202c')).toBeCloseTo(0, 6);
    expect(colorDistance('#c8202c', '#c9202d')).toBeLessThan(ClashDeltaE);
    expect(colorDistance('#c8202c', '#f5f5f4')).toBeGreaterThan(ClashDeltaE * 2);
    expect(mainColor(DefaultLook, 'casa')).toBe('#bd3440');
  });

  it('peças da aparência (pelo lado), as cores escolhidas e os parâmetros de teste da URL', () => {
    expect(lookGear({ skin: TextureSkin, kit: 'branca', kitAway: 'vermelha', shoes: 'tenis_cimento_4' })).toEqual({
      shoes: 'assets/gear/tenis_cimento_4.glb',
      jersey: 'assets/gear/regata_branca.glb',
      shorts: 'assets/gear/bermuda_branca.glb',
    });
    expect(lookGear(DefaultLook, 'assets/', 'visitante').jersey).toBe('assets/gear/regata_branca.glb');
    expect(lookColors({ ...DefaultLook, colors: { casa: ['#2f6fd6'], tenis: ['#111111'] } }, 'casa')).toEqual({
      shoes: ['#111111'],
      jersey: ['#2f6fd6'],
      shorts: ['#2f6fd6'],
    });
    const p = (q: string) => lookWithParams(DefaultLook, new URLSearchParams(q));
    expect(p('').kit).toBe('vermelha');
    expect(p('uniforme=branco').kit).toBe('branca');
    expect(p('tenis=tenis_verniz_11').shoes).toBe('tenis_verniz_11');
    expect(p('tenis=nao_existe').shoes).toBe(DefaultLook.shoes);
    expect(p('pele=14').skin).toBe(SkinTones[14]);
    expect(p('pele=3f2418').skin).toBe('#3f2418');
    expect(p('pele=99').skin).toBe(DefaultLook.skin);
  });

  it('sorteio: só valores da lista, e repetível pela semente (a CPU tem sempre a mesma cara)', () => {
    const r = seededRandom('x');
    for (let i = 0; i < 50; i++) {
      const l = randomLook(r);
      expect(SkinTones).toContain(l.skin);
      expect(KitOrder).toContain(l.kit);
      expect(KitOrder).toContain(l.kitAway);
      expect(ShoeOrder).toContain(l.shoes);
    }
    const entry = CpuRoster[0]!;
    expect(cpuBuild(entry).look).toEqual(cpuBuild(entry).look);
    const looks = new Set(CpuRoster.map((e) => JSON.stringify(cpuBuild(e).look)));
    expect(looks.size).toBeGreaterThan(1);
  });
});
