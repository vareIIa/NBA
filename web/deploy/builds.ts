// Builds compartilhadas no Cloudflare (docs/23 §6): um Durable Object só ("builds"), separado da sala, guarda o
// catálogo no armazenamento dele (SQLite) e atende /api/builds com a lógica pura de web/src/net/builds.
// O índice fica em memória enquanto o objeto vive (todo pedido passa por esta instância, então ele não fica velho).
// Como o worker.ts, este arquivo não passa pelo tsc do jogo (os tipos do runtime vêm do wrangler).
import { DurableObject } from 'cloudflare:workers';
import type { CatalogStorage, SharedBuild } from '../src/net/builds/BuildCatalog.ts';
import { defaultLimits, handleBuildsRequest, productionOrigin } from '../src/net/builds/buildsApi.ts';

const Prefix = 'build:';

export class BuildsObject extends DurableObject {
  private cache: Map<string, SharedBuild> | null = null;
  private readonly limits = defaultLimits();

  async fetch(request: Request): Promise<Response> {
    const ip = request.headers.get('cf-connecting-ip') ?? 'sem-ip';
    try {
      return await handleBuildsRequest(request, this.catalog(), { allowOrigin: productionOrigin, clientKey: ip, limits: this.limits });
    } catch (error) {
      console.error('builds: falha', error);
      return new Response(JSON.stringify({ error: 'falha no servidor de builds' }), { status: 500 });
    }
  }

  private catalog(): CatalogStorage {
    const storage = this.ctx.storage;
    const load = async (): Promise<Map<string, SharedBuild>> => {
      if (!this.cache) {
        const stored = await storage.list<SharedBuild>({ prefix: Prefix });
        this.cache = new Map([...stored.values()].map((e) => [e.build.id, e]));
      }
      return this.cache;
    };
    return {
      all: async () => [...(await load()).values()],
      get: async (id) => (await load()).get(id),
      put: async (entry) => {
        await storage.put(Prefix + entry.build.id, entry);
        (await load()).set(entry.build.id, entry);
      },
      delete: async (id) => {
        await storage.delete(Prefix + id);
        (await load()).delete(id);
      },
    };
  }
}
