// Catálogo de builds compartilhadas (o "Meu Jogador" online): toda build que qualquer jogador cria aparece para todos.
// Lógica pura, sem rede nem armazenamento: o Durable Object da Cloudflare (web/deploy/builds.ts) e o servidor de
// desenvolvimento (web/server/dev.ts) dão o armazenamento e atendem a API HTTP de buildsApi.ts.
// Dono: cada navegador tem uma chave aleatória (BuildCloud.ts, no localStorage); o servidor guarda só o hash dela.
// Só o dono altera ou exclui a build; os outros jogam com ela ou salvam uma cópia (que vira deles).
// A API fica pública e com escrita aberta: tudo o que chega é validado e limpo aqui, com limites de tamanho, de
// quantidade (por dono e no total) e de ritmo (por IP). Docs: docs/23-myplayer-builder.md §6.
// O servidor de desenvolvimento roda este arquivo no Node sem build (só tira os tipos): imports com .ts e nada de
// sintaxe que precise de transformação (parameter properties, enum).
import { AttrCeil, AttrFloor, AttributeIds, type Attributes, type BodyShape, type PlayerBuild, type Position } from '../../build/PlayerBuild.ts';

export const BuildsPath = '/api/builds';
/** Cabeçalho com a chave do dono (PUT e DELETE). */
export const OwnerHeader = 'x-garrafao-dono';
/** Id da build padrão (Cardoso 2K): é de todos e mora no jogo, nunca no catálogo. */
export const ReservedBuildId = 'padrao';

export const MaxSharedBuilds = 2000;
export const MaxBuildsPerOwner = 60;
/** Uma build em JSON tem ~700 bytes; acima disto é lixo. */
export const MaxBuildBytes = 4096;
export const MaxNameChars = 16;

export interface SharedBuild {
  build: PlayerBuild;
  /** Hash da chave do dono (ownerHash). Público: com ele o navegador sabe quais builds são suas. */
  owner: string;
}

export interface CatalogStorage {
  all(): Promise<SharedBuild[]>;
  get(id: string): Promise<SharedBuild | undefined>;
  put(entry: SharedBuild): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Armazenamento em memória (servidor de desenvolvimento e testes). */
export function memoryStorage(): CatalogStorage {
  const map = new Map<string, SharedBuild>();
  return {
    all: async () => [...map.values()],
    get: async (id) => map.get(id),
    put: async (entry) => void map.set(entry.build.id, entry),
    delete: async (id) => void map.delete(id),
  };
}

// ------------------------------------------------------------------ dono

const KeyPattern = /^[A-Za-z0-9-]{16,128}$/;
export const validOwnerKey = (key: unknown): key is string => typeof key === 'string' && KeyPattern.test(key);

/** Hash da chave do dono (SHA-256, 32 hex). Mesmo cálculo no navegador e no servidor. */
export async function ownerHash(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`garrafao-dono:${key}`));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ------------------------------------------------------------------ validação

const Positions: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const Shapes: readonly BodyShape[] = ['magro', 'atletico', 'forte', 'pesado'];
const IdPattern = /^[A-Za-z0-9_-]{3,40}$/;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Texto livre (nome): sem caracteres de controle nem '<>', espaços juntados, no máximo `max` caracteres. */
export function cleanText(v: unknown, max = MaxNameChars): string {
  if (typeof v !== 'string') return '';
  return [...v.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();
}

/**
 * Build que chegou pela rede → build limpa, ou null se não dá para aproveitar. Confere a forma e as faixas (corpo
 * plausível, atributos 25–99); os tetos do corpo e o orçamento de pontos o jogo reaplica ao ler (sanitizeBuild).
 */
export function normalizeBuild(raw: unknown, now: number): PlayerBuild | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || !IdPattern.test(r['id']) || r['id'] === ReservedBuildId) return null;
  const position = Positions.find((p) => p === r['position']);
  if (!position) return null;
  const body = (r['body'] ?? {}) as Record<string, unknown>;
  const heightCm = num(body['heightCm']);
  const weightKg = num(body['weightKg']);
  const wingspanCm = num(body['wingspanCm']);
  if (heightCm === null || weightKg === null || wingspanCm === null) return null;
  const rawAttrs = (r['attrs'] ?? {}) as Record<string, unknown>;
  const attrs = {} as Attributes;
  for (const id of AttributeIds) {
    const v = num(rawAttrs[id]);
    if (v === null) return null;
    attrs[id] = Math.round(clamp(v, AttrFloor, AttrCeil));
  }
  const country = cleanText(r['country'], 3).toUpperCase().replace(/[^A-Z]/g, '');
  const createdAt = num(r['createdAt']);
  return {
    version: 1,
    id: r['id'],
    firstName: cleanText(r['firstName']),
    lastName: cleanText(r['lastName']),
    position,
    hand: r['hand'] === 'l' ? 'l' : 'r',
    jersey: Math.round(clamp(num(r['jersey']) ?? 0, 0, 99)),
    country: country || 'BR',
    body: {
      heightCm: clamp(heightCm, 150, 240),
      weightKg: clamp(weightKg, 50, 180),
      wingspanCm: clamp(wingspanCm, 140, 270),
      shape: Shapes.find((s) => s === body['shape']) ?? 'atletico',
    },
    attrs,
    createdAt: createdAt !== null && createdAt > 0 && createdAt <= now ? Math.round(createdAt) : now,
    updatedAt: now,
  };
}

// ------------------------------------------------------------------ operações

export type CatalogError = { ok: false; status: number; error: string };
export type SaveResult = { ok: true; entry: SharedBuild } | CatalogError;

const fail = (status: number, error: string): CatalogError => ({ ok: false, status, error });

/** Todas as builds, da mais recente para a mais antiga. */
export async function listShared(storage: CatalogStorage): Promise<SharedBuild[]> {
  return (await storage.all()).sort((a, b) => b.build.updatedAt - a.build.updatedAt);
}

/** Cria ou atualiza. Atualizar build de outro dono é proibido; criar respeita os limites por dono e no total. */
export async function saveShared(storage: CatalogStorage, raw: unknown, ownerKey: unknown, now: number): Promise<SaveResult> {
  if (!validOwnerKey(ownerKey)) return fail(401, 'chave do dono inválida');
  const build = normalizeBuild(raw, now);
  if (!build) return fail(400, 'build inválida');
  const owner = await ownerHash(ownerKey);
  const existing = await storage.get(build.id);
  if (existing && existing.owner !== owner) return fail(403, 'esta build é de outro jogador');
  if (!existing) {
    const all = await storage.all();
    if (all.length >= MaxSharedBuilds) return fail(507, 'o catálogo de builds está cheio');
    if (all.filter((e) => e.owner === owner).length >= MaxBuildsPerOwner) return fail(409, `limite de ${MaxBuildsPerOwner} builds por jogador`);
  }
  const entry: SharedBuild = { build: existing ? { ...build, createdAt: existing.build.createdAt } : build, owner };
  await storage.put(entry);
  return { ok: true, entry };
}

/** Exclui (só o dono). Excluir o que já não existe dá certo (o pedido pode ter sido repetido). */
export async function removeShared(storage: CatalogStorage, id: string, ownerKey: unknown): Promise<{ ok: true } | CatalogError> {
  if (!validOwnerKey(ownerKey)) return fail(401, 'chave do dono inválida');
  const existing = await storage.get(id);
  if (!existing) return { ok: true };
  if (existing.owner !== (await ownerHash(ownerKey))) return fail(403, 'esta build é de outro jogador');
  await storage.delete(id);
  return { ok: true };
}

// ------------------------------------------------------------------ ritmo

/**
 * Limite de ritmo por chave (IP): `max` pedidos por janela de `windowMs`. Em memória: zera quando o servidor
 * reinicia, o que basta contra spam (os limites de quantidade seguram o resto).
 */
export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  allow(key: string, now: number): boolean {
    const h = this.hits.get(key);
    if (!h || now - h.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      if (this.hits.size > 5000) this.sweep(now);
      return true;
    }
    h.count++;
    return h.count <= this.max;
  }

  private sweep(now: number): void {
    for (const [k, h] of this.hits) if (now - h.start >= this.windowMs) this.hits.delete(k);
  }
}
