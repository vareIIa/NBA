// BuildSave com dois "navegadores" (cada um com o seu localStorage e a sua chave de dono) e um servidor de mentira que
// roda o mesmo handler do Worker (buildsApi.ts) sobre um catálogo em memória.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CatalogStorage, memoryStorage } from '../net/builds/BuildCatalog';
import { defaultLimits, handleBuildsRequest } from '../net/builds/buildsApi';
import { DefaultBuild, newDraft } from './BuildRules';
import type { PlayerBuild } from './PlayerBuild';

type Save = (typeof import('./BuildSave'))['BuildSave'];

function memoryLocalStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

/** Servidor de mentira: null = sem conexão (fetch falha). */
let server: CatalogStorage | null = null;
const limits = defaultLimits();

vi.stubGlobal('location', { search: '?mp=ws://teste.local/ws', protocol: 'http:', hostname: 'teste.local', host: 'teste.local' });
vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
  if (!server) throw new TypeError('sem conexão');
  const { cache: _cache, signal: _signal, ...rest } = init;
  return handleBuildsRequest(new Request(url, rest), server, { allowOrigin: () => true, clientKey: 'teste', limits });
});

interface Browser {
  storage: Storage;
  save: Save;
}

/** Um navegador novo: localStorage próprio e módulos novos (a chave do dono e o hash ficam em cache no módulo). */
async function openBrowser(storage = memoryLocalStorage()): Promise<Browser> {
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  const { BuildSave } = await import('./BuildSave');
  return { storage, save: BuildSave };
}

/** Volta a usar um navegador já aberto (o localStorage é global). */
function use(b: Browser): Save {
  vi.stubGlobal('localStorage', b.storage);
  return b.save;
}

const draft = (name: string): PlayerBuild => ({ ...newDraft('SF'), firstName: 'Tano', lastName: name });

afterEach(() => {
  server = null;
});

describe('BuildSave', () => {
  it('criar uma build nova não tira a do Cardoso 2K da lista', async () => {
    const a = await openBrowser();
    expect(a.save.list().map((b) => b.id)).toEqual([DefaultBuild.id]);
    const mine = a.save.save(draft('Prestia'));
    const list = a.save.list();
    expect(list.map((b) => b.id)).toEqual([mine.id, DefaultBuild.id]);
    expect(a.save.active().id).toBe(mine.id);
    // Volta para o Cardoso 2K e a sua continua lá.
    a.save.setActive(DefaultBuild.id);
    expect(a.save.active().id).toBe(DefaultBuild.id);
    expect(a.save.list()).toHaveLength(2);
    // A padrão não sai.
    a.save.remove(DefaultBuild.id);
    expect(a.save.list().map((b) => b.id)).toContain(DefaultBuild.id);
    await a.save.sync();
  });

  it('o arquivo de antes do catálogo carrega e marca as builds para subir', async () => {
    const storage = memoryLocalStorage();
    const old = { ...draft('Antiga'), id: 'bantiga1' };
    storage.setItem('garrafao.builds.v1', JSON.stringify({ active: old.id, builds: [old] }));
    server = memoryStorage();
    const a = await openBrowser(storage);
    expect(a.save.list().map((b) => b.id)).toEqual(['bantiga1', DefaultBuild.id]);
    expect(await a.save.sync()).toEqual({ online: true, others: 0 });
    expect((await server.all()).map((e) => e.build.id)).toEqual(['bantiga1']);
  });

  it('a build de um jogador aparece para o outro, que joga com ela ou salva uma cópia sua', async () => {
    server = memoryStorage();
    const a = await openBrowser();
    const built = a.save.save(draft('Prestia'));
    await a.save.sync();

    const b = await openBrowser();
    expect(await b.save.sync()).toEqual({ online: true, others: 1 });
    expect(b.save.list().map((x) => x.id)).toEqual([DefaultBuild.id, built.id]);
    expect(b.save.origin(built.id)).toBe('shared');
    b.save.setActive(built.id);
    expect(b.save.active().lastName).toBe('Prestia');
    // Excluir a de outro não faz nada (nem aqui nem no servidor).
    b.save.remove(built.id);
    expect(b.save.list().map((x) => x.id)).toContain(built.id);
    // Editar e salvar a de outro vira uma cópia sua.
    const copy = b.save.save({ ...built, lastName: 'Copia' });
    expect(copy.id).not.toBe(built.id);
    expect(b.save.origin(copy.id)).toBe('mine');
    await b.save.sync();
    expect((await server.all()).length).toBe(2);

    const sa = use(a);
    expect(await sa.sync()).toEqual({ online: true, others: 1 });
    expect(sa.list().map((x) => x.lastName)).toEqual(['Prestia', '2K', 'Copia']);
    expect(sa.origin(built.id)).toBe('mine');
  });

  it('sem servidor a build fica salva aqui e sobe quando a conexão volta', async () => {
    const a = await openBrowser();
    const built = a.save.save(draft('Offline'));
    expect(await a.save.sync()).toMatchObject({ online: false });
    expect(a.save.list().map((x) => x.id)).toEqual([built.id, DefaultBuild.id]);
    server = memoryStorage();
    expect(await a.save.sync()).toEqual({ online: true, others: 0 });
    expect((await server.all()).map((e) => e.build.id)).toEqual([built.id]);
  });

  it('excluir uma build sua tira do catálogo (também para os outros)', async () => {
    server = memoryStorage();
    const a = await openBrowser();
    const built = a.save.save(draft('Some'));
    await a.save.sync();
    a.save.remove(built.id);
    await a.save.sync();
    expect(await server.all()).toEqual([]);
    const b = await openBrowser();
    expect(await b.save.sync()).toEqual({ online: true, others: 0 });
  });
});
