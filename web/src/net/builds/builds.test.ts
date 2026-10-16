import { describe, expect, it } from 'vitest';
import {
  BuildsPath,
  MaxBuildBytes,
  MaxBuildsPerOwner,
  OwnerHeader,
  RateLimiter,
  cleanText,
  listShared,
  memoryStorage,
  normalizeBuild,
  ownerHash,
  removeShared,
  saveShared,
} from './BuildCatalog';
import { defaultLimits, devOrigin, handleBuildsRequest, isBuildsPath, productionOrigin } from './buildsApi';
import { AttributeIds } from '../../build/PlayerBuild';
import { DefaultBuild, newDraft } from '../../build/BuildRules';

const KeyA = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const KeyB = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const Now = 1_800_000_000_000;

function sample(id: string, name = 'Prestia') {
  return { ...newDraft('PG'), id, firstName: 'Tano', lastName: name, createdAt: Now - 1000 };
}

describe('validação', () => {
  it('limpa nomes: sem controle, sem <>, espaços juntados e no máximo 16 caracteres', () => {
    expect(cleanText('  <script>Tano\u0000\n  Silva</script> ')).toBe('scriptTano Silva');
    expect(cleanText('Ãbcdefghijklmnopqrstuvwxyz')).toBe('Ãbcdefghijklmnop');
    expect(cleanText(42)).toBe('');
  });

  it('aceita uma build do jogo e prende números nas faixas', () => {
    const raw = { ...sample('b123abc'), jersey: 400, body: { heightCm: 999, weightKg: -5, wingspanCm: 200, shape: 'x' } };
    raw.attrs = { ...raw.attrs, threePoint: 150, block: -3 };
    const b = normalizeBuild(raw, Now)!;
    expect(b.jersey).toBe(99);
    expect(b.body).toEqual({ heightCm: 240, weightKg: 50, wingspanCm: 200, shape: 'atletico' });
    expect(b.attrs.threePoint).toBe(99);
    expect(b.attrs.block).toBe(25);
    expect(b.updatedAt).toBe(Now);
    expect(b.createdAt).toBe(Now - 1000);
  });

  it('recusa o que não é build: id ruim, a build padrão, posição ou atributo faltando', () => {
    expect(normalizeBuild(null, Now)).toBeNull();
    expect(normalizeBuild({ ...sample('a b'), id: 'a b' }, Now)).toBeNull();
    expect(normalizeBuild({ ...DefaultBuild }, Now)).toBeNull();
    expect(normalizeBuild({ ...sample('b1x'), position: 'QB' }, Now)).toBeNull();
    const noAttr = sample('b1y');
    delete (noAttr.attrs as Partial<typeof noAttr.attrs>).stamina;
    expect(normalizeBuild(noAttr, Now)).toBeNull();
    expect(AttributeIds.length).toBe(22);
  });
});

describe('catálogo', () => {
  it('salva, lista da mais recente para a mais antiga e guarda só o hash do dono', async () => {
    const s = memoryStorage();
    expect((await saveShared(s, sample('b1aaa'), KeyA, Now)).ok).toBe(true);
    expect((await saveShared(s, sample('b2bbb'), KeyB, Now + 5)).ok).toBe(true);
    const list = await listShared(s);
    expect(list.map((e) => e.build.id)).toEqual(['b2bbb', 'b1aaa']);
    expect(list[1]!.owner).toBe(await ownerHash(KeyA));
    expect(JSON.stringify(list)).not.toContain(KeyA);
  });

  it('só o dono altera ou exclui; os outros recebem 403', async () => {
    const s = memoryStorage();
    await saveShared(s, sample('b1aaa'), KeyA, Now);
    expect(await saveShared(s, sample('b1aaa', 'Outro'), KeyB, Now + 1)).toMatchObject({ ok: false, status: 403 });
    expect(await removeShared(s, 'b1aaa', KeyB)).toMatchObject({ ok: false, status: 403 });
    const upd = await saveShared(s, sample('b1aaa', 'Novo'), KeyA, Now + 2);
    expect(upd.ok && upd.entry.build.lastName).toBe('Novo');
    expect(upd.ok && upd.entry.build.createdAt).toBe(Now - 1000);
    expect(await removeShared(s, 'b1aaa', KeyA)).toEqual({ ok: true });
    expect(await listShared(s)).toEqual([]);
    expect(await removeShared(s, 'b1aaa', KeyA)).toEqual({ ok: true });
  });

  it('chave do dono obrigatória e com formato', async () => {
    const s = memoryStorage();
    expect(await saveShared(s, sample('b1aaa'), undefined, Now)).toMatchObject({ status: 401 });
    expect(await saveShared(s, sample('b1aaa'), 'curta', Now)).toMatchObject({ status: 401 });
  });

  it('limite de builds por dono', async () => {
    const s = memoryStorage();
    for (let i = 0; i < MaxBuildsPerOwner; i++) expect((await saveShared(s, sample(`bx${i}abc`), KeyA, Now + i)).ok).toBe(true);
    expect(await saveShared(s, sample('bxtoomany'), KeyA, Now)).toMatchObject({ ok: false, status: 409 });
    expect((await saveShared(s, sample('bymine'), KeyB, Now)).ok).toBe(true);
    // Atualizar uma que já existe continua valendo.
    expect((await saveShared(s, sample('bx0abc', 'Editada'), KeyA, Now + 99)).ok).toBe(true);
  });

  it('limite de ritmo por chave, que volta na janela seguinte', () => {
    const r = new RateLimiter(3, 1000);
    expect([r.allow('ip', 0), r.allow('ip', 10), r.allow('ip', 20), r.allow('ip', 30)]).toEqual([true, true, true, false]);
    expect(r.allow('outro', 30)).toBe(true);
    expect(r.allow('ip', 1000)).toBe(true);
  });
});

describe('API HTTP', () => {
  const url = (path = '') => `https://garrafao.garrafao-web.workers.dev${BuildsPath}${path}`;
  const call = (req: Request, s = memoryStorage(), limits = defaultLimits()) =>
    handleBuildsRequest(req, s, { allowOrigin: productionOrigin, clientKey: '1.2.3.4', now: Now, limits });
  const put = (id: string, body: unknown, key = KeyA, origin = 'https://garrafao.vercel.app') =>
    new Request(url(`/${id}`), { method: 'PUT', headers: { origin, [OwnerHeader]: key, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('PUT, GET e DELETE de ponta a ponta, com CORS só para a origem do jogo', async () => {
    const s = memoryStorage();
    const limits = defaultLimits();
    const created = await call(put('b1aaa', sample('b1aaa')), s, limits);
    expect(created.status).toBe(200);
    expect(created.headers.get('access-control-allow-origin')).toBe('https://garrafao.vercel.app');
    const list = await call(new Request(url(), { headers: { origin: 'http://localhost:5173' } }), s, limits);
    expect(list.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const body = (await list.json()) as { builds: Array<{ build: { id: string } }> };
    expect(body.builds.map((e) => e.build.id)).toEqual(['b1aaa']);
    const del = await call(new Request(url('/b1aaa'), { method: 'DELETE', headers: { [OwnerHeader]: KeyA } }), s, limits);
    expect(del.status).toBe(200);
    expect(((await (await call(new Request(url()), s, limits)).json()) as { builds: unknown[] }).builds).toEqual([]);
  });

  it('origem de fora não lê nem escreve (nem o preflight)', async () => {
    const evil = 'https://malicioso.example';
    const pre = await call(new Request(url('/b1aaa'), { method: 'OPTIONS', headers: { origin: evil } }));
    expect(pre.status).toBe(403);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    expect((await call(put('b1aaa', sample('b1aaa'), KeyA, evil))).status).toBe(403);
    const ok = await call(new Request(url('/b1aaa'), { method: 'OPTIONS', headers: { origin: 'https://garrafao.vercel.app' } }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-headers')).toContain(OwnerHeader);
  });

  it('recusa corpo grande, JSON quebrado, id diferente do endereço e método errado', async () => {
    const big = { ...sample('b1aaa'), lastName: 'x'.repeat(MaxBuildBytes) };
    expect((await call(put('b1aaa', big))).status).toBe(413);
    const broken = new Request(url('/b1aaa'), { method: 'PUT', headers: { [OwnerHeader]: KeyA }, body: '{nope' });
    expect((await call(broken)).status).toBe(400);
    expect((await call(put('b2bbb', sample('b1aaa')))).status).toBe(400);
    expect((await call(new Request(url('/b1aaa')))).status).toBe(405);
    expect((await call(new Request(url(), { method: 'POST', body: '{}' }))).status).toBe(405);
  });

  it('limite de escrita por IP devolve 429', async () => {
    const s = memoryStorage();
    const limits = defaultLimits();
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await call(put(`bq${i}abc`, sample(`bq${i}abc`)), s, limits)).status;
    expect(last).toBe(429);
    expect((await listShared(s)).length).toBe(20);
  });

  it('origens: produção, local e rede local (só no servidor de desenvolvimento)', () => {
    expect(productionOrigin('https://garrafao.vercel.app')).toBe(true);
    expect(productionOrigin('http://127.0.0.1:5183')).toBe(true);
    expect(productionOrigin('http://192.168.0.10:5173')).toBe(false);
    expect(productionOrigin('https://garrafao.vercel.app.evil.com')).toBe(false);
    expect(devOrigin('http://192.168.0.10:5173')).toBe(true);
    expect(devOrigin('https://garrafao.vercel.app')).toBe(false);
    expect(isBuildsPath('/api/builds')).toBe(true);
    expect(isBuildsPath('/api/builds/b1')).toBe(true);
    expect(isBuildsPath('/api/buildsx')).toBe(false);
    expect(isBuildsPath('/ws')).toBe(false);
  });
});
