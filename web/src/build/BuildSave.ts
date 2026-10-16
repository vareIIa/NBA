// Builds do "Meu Jogador": as deste navegador (criadas aqui, no localStorage) e as de todos os outros jogadores (o
// catálogo online, docs/23 §6), mais a build padrão (DefaultBuild, o Cardoso 2K), que é do jogo e está sempre na lista:
// criar uma build nova não tira nenhuma outra. A ativa (a do Freestyle) é escolha deste navegador.
// Sem conexão, tudo funciona com o que está salvo aqui: o que não subiu fica pendente e sobe na próxima sincronia
// (sync, chamada ao abrir o Meu Jogador e depois de salvar). Sem build ativa, o jogo usa a padrão, que reproduz os
// números de antes do builder: os testes do Freestyle (Playwright) não mudam.
import { AttributeIds, type PlayerBuild, newBuildId } from './PlayerBuild';
import { DefaultBuild, sanitizeBuild } from './BuildRules';
import { BuildCloud, myOwnerHash } from '../net/builds/BuildCloud';

const Key = 'garrafao.builds.v1';

interface SaveFile {
  active: string | null;
  /** Builds deste navegador (o dono é a chave daqui). */
  builds: PlayerBuild[];
  /** Ids das próprias que ainda não subiram para o catálogo. */
  pending: string[];
  /** Ids das próprias excluídas aqui que o servidor ainda não soube. */
  deleted: string[];
  /** Cópia das builds dos outros jogadores (a última lista do servidor). */
  shared: PlayerBuild[];
}

export type BuildOrigin = 'mine' | 'default' | 'shared';

/** Resultado da sincronia: online = o servidor respondeu a lista. */
export interface SyncResult {
  online: boolean;
  /** Builds dos outros jogadores na lista. */
  others: number;
}

const isBuild = (b: unknown): b is PlayerBuild =>
  !!b && typeof b === 'object' && typeof (b as PlayerBuild).id === 'string' && !!(b as PlayerBuild).attrs &&
  AttributeIds.every((id) => typeof (b as PlayerBuild).attrs[id] === 'number');

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function read(): SaveFile {
  try {
    const raw = localStorage.getItem(Key);
    if (!raw) return { active: null, builds: [], pending: [], deleted: [], shared: [] };
    const parsed = JSON.parse(raw) as Partial<SaveFile>;
    const builds = (Array.isArray(parsed.builds) ? parsed.builds : []).filter(isBuild).map(sanitizeBuild);
    const mine = new Set(builds.map((b) => b.id));
    const shared = (Array.isArray(parsed.shared) ? parsed.shared : [])
      .filter(isBuild)
      .filter((b) => !mine.has(b.id) && b.id !== DefaultBuild.id)
      .map(sanitizeBuild);
    // Arquivo de antes do catálogo (sem "pending"): as builds daqui ainda não subiram.
    const pending = Array.isArray(parsed.pending) ? ids(parsed.pending).filter((id) => mine.has(id)) : [...mine];
    const known = (id: string): boolean => mine.has(id) || id === DefaultBuild.id || shared.some((b) => b.id === id);
    const active = typeof parsed.active === 'string' && known(parsed.active) ? parsed.active : null;
    return { active, builds, pending, deleted: ids(parsed.deleted), shared };
  } catch {
    return { active: null, builds: [], pending: [], deleted: [], shared: [] };
  }
}

function write(file: SaveFile): void {
  try {
    localStorage.setItem(Key, JSON.stringify(file));
  } catch {
    // Aba privada / sem armazenamento: as builds valem só nesta sessão.
  }
}

const newest = (a: PlayerBuild, b: PlayerBuild): number => b.updatedAt - a.updatedAt;

let syncing: Promise<SyncResult> | null = null;

export const BuildSave = {
  /** Lista do Meu Jogador: as suas (a mais recente primeiro), a padrão e as dos outros jogadores. */
  list(): PlayerBuild[] {
    const file = read();
    return [...[...file.builds].sort(newest), DefaultBuild, ...[...file.shared].sort(newest)];
  },
  /** Só as builds deste navegador. */
  mine(): PlayerBuild[] {
    return read().builds;
  },
  origin(id: string): BuildOrigin {
    if (id === DefaultBuild.id) return 'default';
    return read().builds.some((b) => b.id === id) ? 'mine' : 'shared';
  },
  /** Build ativa (a do Freestyle). Sem nenhuma escolhida, a mais antiga das suas; sem nenhuma sua, a padrão. */
  active(): PlayerBuild {
    const file = read();
    const all = [...file.builds, ...file.shared, DefaultBuild];
    return all.find((b) => b.id === file.active) ?? file.builds[0] ?? DefaultBuild;
  },
  activeId(): string | null {
    return read().active;
  },
  /**
   * Salva (cria ou atualiza pelo id) e sobe para o catálogo. Build da padrão ou de outro jogador vira uma cópia sua
   * (id novo). `activate` = vira a build do Freestyle. Devolve a build como ficou salva.
   */
  save(build: PlayerBuild, activate = true): PlayerBuild {
    const file = read();
    const own = file.builds.some((b) => b.id === build.id);
    const fork = !own && (build.id === DefaultBuild.id || file.shared.some((b) => b.id === build.id));
    const now = Date.now();
    const next = { ...sanitizeBuild(fork ? { ...build, id: newBuildId(), createdAt: now } : build), updatedAt: now };
    const i = file.builds.findIndex((b) => b.id === next.id);
    if (i >= 0) file.builds[i] = next;
    else file.builds.push(next);
    if (!file.pending.includes(next.id)) file.pending.push(next.id);
    file.deleted = file.deleted.filter((id) => id !== next.id);
    if (activate || !file.active) file.active = next.id;
    write(file);
    void BuildSave.sync();
    return next;
  },
  setActive(id: string): void {
    const file = read();
    const known = id === DefaultBuild.id || file.builds.some((b) => b.id === id) || file.shared.some((b) => b.id === id);
    if (known) write({ ...file, active: id });
  },
  /** Exclui uma build sua (aqui e no catálogo). As dos outros e a padrão não saem. */
  remove(id: string): void {
    const file = read();
    if (!file.builds.some((b) => b.id === id)) return;
    const builds = file.builds.filter((b) => b.id !== id);
    write({
      ...file,
      builds,
      pending: file.pending.filter((p) => p !== id),
      deleted: file.deleted.includes(id) ? file.deleted : [...file.deleted, id],
      active: file.active === id ? (builds[0]?.id ?? null) : file.active,
    });
    void BuildSave.sync();
  },
  /**
   * Sincroniza com o catálogo: sobe as pendentes, avisa as exclusões e baixa a lista de todos. Nunca falha nem trava:
   * sem servidor, devolve online=false e a lista local continua valendo. Chamadas juntas viram uma só.
   */
  sync(): Promise<SyncResult> {
    return (syncing ??= runSync().finally(() => (syncing = null)));
  },
};

async function runSync(): Promise<SyncResult> {
  let online = true;
  // 1. Sobe as pendentes (relendo o arquivo a cada passo: o jogador pode salvar no meio).
  for (const id of read().pending) {
    const build = read().builds.find((b) => b.id === id);
    const r = build ? await BuildCloud.push(build) : 'refused';
    if (r === 'offline') {
      online = false;
      break;
    }
    const f = read();
    write({ ...f, pending: f.pending.filter((p) => p !== id) });
  }
  // 2. Exclusões que o servidor ainda não soube.
  if (online) {
    for (const id of read().deleted) {
      if (!(await BuildCloud.remove(id))) {
        online = false;
        break;
      }
      const f = read();
      write({ ...f, deleted: f.deleted.filter((d) => d !== id) });
    }
  }
  // 3. A lista de todos.
  const list = online ? await BuildCloud.list() : null;
  const file = read();
  if (!list) return { online: false, others: file.shared.length };
  const me = await myOwnerHash();
  const f = read();
  const mineIds = new Set(f.builds.map((b) => b.id));
  const gone = new Set(f.deleted);
  const shared: PlayerBuild[] = [];
  for (const entry of list) {
    if (!entry || typeof entry.owner !== 'string' || !isBuild(entry.build) || entry.build.id === DefaultBuild.id) continue;
    if (mineIds.has(entry.build.id) || gone.has(entry.build.id)) continue;
    const build = sanitizeBuild(entry.build);
    // Sua, criada em outra aba deste navegador: entra nas suas.
    if (entry.owner === me) f.builds.push(build);
    else shared.push(build);
  }
  write({ ...f, shared });
  return { online: true, others: shared.length };
}
