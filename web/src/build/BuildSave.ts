// Builds salvas no navegador (localStorage): a lista de builds do "Meu Jogador" e qual delas está ativa (a que o
// Freestyle usa). Sem build salva, o jogo usa a build padrão (DefaultBuild), que reproduz os números de antes do
// builder: os testes do Freestyle (Playwright) não mudam.
import { AttributeIds, type PlayerBuild } from './PlayerBuild';
import { DefaultBuild, sanitizeBuild } from './BuildRules';

const Key = 'garrafao.builds.v1';

interface SaveFile {
  active: string | null;
  builds: PlayerBuild[];
}

function read(): SaveFile {
  try {
    const raw = localStorage.getItem(Key);
    if (!raw) return { active: null, builds: [] };
    const parsed = JSON.parse(raw) as Partial<SaveFile>;
    const builds = (Array.isArray(parsed.builds) ? parsed.builds : [])
      .filter((b): b is PlayerBuild => !!b && typeof b === 'object' && typeof (b as PlayerBuild).id === 'string')
      .filter((b) => b.attrs && AttributeIds.every((id) => typeof b.attrs[id] === 'number'))
      .map(sanitizeBuild);
    const active = typeof parsed.active === 'string' && builds.some((b) => b.id === parsed.active) ? parsed.active : null;
    return { active, builds };
  } catch {
    return { active: null, builds: [] };
  }
}

function write(file: SaveFile): void {
  try {
    localStorage.setItem(Key, JSON.stringify(file));
  } catch {
    // Aba privada / sem armazenamento: as builds valem só nesta sessão.
  }
}

export const BuildSave = {
  list(): PlayerBuild[] {
    return read().builds;
  },
  /** Build ativa (a do Freestyle). Sem nenhuma salva, a padrão. */
  active(): PlayerBuild {
    const file = read();
    return file.builds.find((b) => b.id === file.active) ?? file.builds[0] ?? DefaultBuild;
  },
  activeId(): string | null {
    return read().active;
  },
  /** Salva (cria ou atualiza pelo id). `activate` = vira a build do Freestyle. */
  save(build: PlayerBuild, activate = true): void {
    const file = read();
    const next = { ...sanitizeBuild(build), updatedAt: Date.now() };
    const i = file.builds.findIndex((b) => b.id === next.id);
    if (i >= 0) file.builds[i] = next;
    else file.builds.push(next);
    if (activate || !file.active) file.active = next.id;
    write(file);
  },
  setActive(id: string): void {
    const file = read();
    if (file.builds.some((b) => b.id === id)) write({ ...file, active: id });
  },
  remove(id: string): void {
    const file = read();
    const builds = file.builds.filter((b) => b.id !== id);
    write({ builds, active: file.active === id ? (builds[0]?.id ?? null) : file.active });
  },
};
