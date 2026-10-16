// API HTTP das builds compartilhadas, com Request/Response padrão (roda igual no Worker da Cloudflare e no Node):
//   GET    /api/builds        → { builds: [{ build, owner }] } (todas, da mais recente para a mais antiga)
//   PUT    /api/builds/:id    → cria ou atualiza; corpo = a build em JSON; cabeçalho x-garrafao-dono = chave do dono
//   DELETE /api/builds/:id    → exclui (só o dono); mesmo cabeçalho
// CORS só para as origens do jogo (allowOrigin). Ritmo por IP: leitura e escrita com limites separados.
import {
  BuildsPath,
  type CatalogStorage,
  MaxBuildBytes,
  OwnerHeader,
  RateLimiter,
  listShared,
  removeShared,
  saveShared,
} from './BuildCatalog.ts';

export interface BuildsApiOptions {
  /** A origem (cabeçalho Origin) pode chamar a API pelo navegador? */
  allowOrigin: (origin: string) => boolean;
  /** Quem pediu (IP), para o limite de ritmo. */
  clientKey: string;
  now?: number;
  /** Limites de ritmo (o servidor guarda os mesmos entre pedidos). */
  limits?: { read: RateLimiter; write: RateLimiter };
}

/** Limites padrão: 60 leituras e 20 escritas por minuto por IP. */
export const defaultLimits = (): { read: RateLimiter; write: RateLimiter } => ({
  read: new RateLimiter(60, 60_000),
  write: new RateLimiter(20, 60_000),
});

/** Origens do jogo publicado (docs/24 §4.1). */
export const ProductionOrigins: readonly string[] = ['https://garrafao.vercel.app', 'https://garrafao.garrafao-web.workers.dev'];

const LocalHost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
/** Produção: os dois sites e o desenvolvimento local (localhost/127.0.0.1). */
export const productionOrigin = (origin: string): boolean => ProductionOrigins.includes(origin) || LocalHost.test(origin);
/** Servidor de desenvolvimento: também a rede local (o amigo abre http://<seu IP>:5173). */
export const devOrigin = (origin: string): boolean =>
  LocalHost.test(origin) || /^http:\/\/(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin);

/** O pedido é da API de builds? */
export const isBuildsPath = (pathname: string): boolean => pathname === BuildsPath || pathname.startsWith(`${BuildsPath}/`);

export async function handleBuildsRequest(request: Request, storage: CatalogStorage, options: BuildsApiOptions): Promise<Response> {
  const now = options.now ?? Date.now();
  const limits = options.limits ?? defaultLimits();
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Origin' };
  if (origin && options.allowOrigin(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'GET, PUT, DELETE, OPTIONS';
    headers['access-control-allow-headers'] = `content-type, ${OwnerHeader}`;
    headers['access-control-max-age'] = '86400';
  }
  const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers });

  // Navegador de outra origem: nada de escrita (nem o preflight passa).
  if (origin && !options.allowOrigin(origin)) return reply(403, { error: 'origem não permitida' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const url = new URL(request.url);
  const rest = url.pathname.slice(BuildsPath.length);
  const id = rest.startsWith('/') ? decodeURIComponent(rest.slice(1)) : '';
  if (rest && !id) return reply(404, { error: 'caminho desconhecido' });

  if (request.method === 'GET' && !id) {
    if (!limits.read.allow(options.clientKey, now)) return reply(429, { error: 'muitos pedidos, tente daqui a pouco' });
    return reply(200, { builds: await listShared(storage) });
  }
  if ((request.method !== 'PUT' && request.method !== 'DELETE') || !id) return reply(405, { error: 'método não permitido' });
  if (!limits.write.allow(options.clientKey, now)) return reply(429, { error: 'muitos pedidos, tente daqui a pouco' });
  const key = request.headers.get(OwnerHeader);

  if (request.method === 'DELETE') {
    const r = await removeShared(storage, id, key);
    return r.ok ? reply(200, { ok: true }) : reply(r.status, { error: r.error });
  }

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MaxBuildBytes) return reply(413, { error: 'build grande demais' });
  const text = await request.text();
  if (text.length > MaxBuildBytes) return reply(413, { error: 'build grande demais' });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return reply(400, { error: 'JSON inválido' });
  }
  if (!raw || typeof raw !== 'object' || (raw as { id?: unknown }).id !== id) return reply(400, { error: 'o id da build não bate com o endereço' });
  const r = await saveShared(storage, raw, key, now);
  return r.ok ? reply(200, r.entry) : reply(r.status, { error: r.error });
}
