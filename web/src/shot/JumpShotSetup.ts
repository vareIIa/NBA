// Criador de arremesso (modelo de dados, sem three.js e sem DOM): um arremesso é a base (corpo de baixo), duas camadas de
// cima (Upper Release 1 e 2), a mistura entre elas e a velocidade de soltura. Vários arremessos podem ser salvos; um fica
// equipado e é o que o jogador usa no Freestyle.
import { ReleaseSpeed } from '../sim/HoopsShotModel';

export type ShotHand = 'r' | 'l';

/** Famílias de arremesso que o criador oferece. O clipe sai de `${family}_R` ou `${family}_L`, conforme a mão. */
export const ShotFamilies = ['JumpShot', 'JumpShot2'] as const;
export type ShotFamily = (typeof ShotFamilies)[number];

export interface JumpShotSetup {
  id: string;
  name: string;
  /** Corpo de baixo: pernas, quadril e a pelve do arremesso. */
  lowerBase: ShotFamily;
  /** Braços e tronco da primeira camada de cima. */
  upperRelease1: ShotFamily;
  /** Braços e tronco da segunda camada de cima. */
  upperRelease2: ShotFamily;
  /** Quanto da camada 2 entra na mistura, em %: 0 = só a camada 1, 100 = só a camada 2. */
  blendPercent: number;
  /** Velocidade da soltura (vai para o modelo de arremesso, que escolhe as janelas de timing). */
  releaseSpeed: ReleaseSpeed;
}

export const MaxSetups = 12;
export const StorageKey = 'garrafao.jumpshots.v1';

const SpeedValues: readonly ReleaseSpeed[] = [ReleaseSpeed.Quick, ReleaseSpeed.Normal, ReleaseSpeed.Slow];

/** Nome do clipe de uma família na mão dada (ex.: JumpShot2 + 'r' -> 'JumpShot2_R'). */
export function clipNameFor(family: ShotFamily, hand: ShotHand): string {
  return `${family}_${hand === 'r' ? 'R' : 'L'}`;
}

/** Pesos das duas camadas de cima (somam 1). A porcentagem é limitada a 0..100. */
export function upperWeights(blendPercent: number): { upper1: number; upper2: number } {
  const p = clampPercent(blendPercent) / 100;
  return { upper1: 1 - p, upper2: p };
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Arremesso inicial: o mesmo arremesso que o jogo já tinha (JumpShot2 em tudo, sem mistura). */
export function defaultSetup(id = 'arremesso-1', name = 'Meu arremesso'): JumpShotSetup {
  return {
    id,
    name,
    lowerBase: 'JumpShot2',
    upperRelease1: 'JumpShot2',
    upperRelease2: 'JumpShot2',
    blendPercent: 0,
    releaseSpeed: ReleaseSpeed.Normal,
  };
}

/** Confere um objeto vindo do armazenamento (que pode estar corrompido ou ser de outra versão). */
export function parseSetup(raw: unknown): JumpShotSetup | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const family = (v: unknown): ShotFamily | null => (ShotFamilies as readonly unknown[]).includes(v) ? (v as ShotFamily) : null;
  const lowerBase = family(o.lowerBase);
  const upperRelease1 = family(o.upperRelease1);
  const upperRelease2 = family(o.upperRelease2);
  const speed = o.releaseSpeed;
  if (typeof o.id !== 'string' || typeof o.name !== 'string' || !lowerBase || !upperRelease1 || !upperRelease2) return null;
  if (typeof o.blendPercent !== 'number' || !SpeedValues.includes(speed as ReleaseSpeed)) return null;
  return {
    id: o.id,
    name: o.name.slice(0, 32) || 'Arremesso',
    lowerBase,
    upperRelease1,
    upperRelease2,
    blendPercent: clampPercent(o.blendPercent),
    releaseSpeed: speed as ReleaseSpeed,
  };
}

/** Só o necessário do localStorage: no teste entra um objeto em memória. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage quando existe (pode lançar em janela privada ou com dados bloqueados). */
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

interface StoreFile {
  version: 1;
  equippedId: string | null;
  setups: JumpShotSetup[];
}

/**
 * Arremessos salvos. Sempre tem pelo menos um (o padrão). Falhas de armazenamento não quebram o jogo: o estado fica em
 * memória e a próxima gravação tenta de novo.
 */
export class JumpShotStore {
  private setups: JumpShotSetup[] = [];
  private equippedId: string | null = null;

  constructor(private readonly storage: KeyValueStorage | null = browserStorage(), private readonly key = StorageKey) {
    this.load();
    if (this.setups.length === 0) this.setups.push(defaultSetup());
    if (!this.setups.some((s) => s.id === this.equippedId)) this.equippedId = this.setups[0].id;
  }

  list(): JumpShotSetup[] {
    return this.setups.map((s) => ({ ...s }));
  }

  get(id: string): JumpShotSetup | undefined {
    const found = this.setups.find((s) => s.id === id);
    return found ? { ...found } : undefined;
  }

  /** Arremesso equipado (o que o Freestyle usa). */
  equipped(): JumpShotSetup {
    return { ...(this.setups.find((s) => s.id === this.equippedId) ?? this.setups[0]) };
  }

  /** Cria ou atualiza. Um arremesso novo entra no fim; falha se já houver MaxSetups. */
  upsert(setup: JumpShotSetup): boolean {
    const clean = parseSetup(setup);
    if (!clean) return false;
    const index = this.setups.findIndex((s) => s.id === clean.id);
    if (index >= 0) {
      this.setups[index] = clean;
    } else {
      if (this.setups.length >= MaxSetups) return false;
      this.setups.push(clean);
    }
    this.save();
    return true;
  }

  /** Apaga um arremesso. O último não pode ser apagado, e o equipado passa para o primeiro da lista. */
  remove(id: string): boolean {
    if (this.setups.length <= 1) return false;
    const next = this.setups.filter((s) => s.id !== id);
    if (next.length === this.setups.length) return false;
    this.setups = next;
    if (this.equippedId === id) this.equippedId = this.setups[0].id;
    this.save();
    return true;
  }

  equip(id: string): boolean {
    if (!this.setups.some((s) => s.id === id)) return false;
    this.equippedId = id;
    this.save();
    return true;
  }

  /** Próximo id livre (arremesso-1, arremesso-2, ...). */
  nextId(): string {
    for (let n = 1; n <= MaxSetups + 1; n++) {
      const id = `arremesso-${n}`;
      if (!this.setups.some((s) => s.id === id)) return id;
    }
    return `arremesso-${Date.now()}`;
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const text = this.storage.getItem(this.key);
      if (!text) return;
      const file = JSON.parse(text) as Partial<StoreFile>;
      if (file.version !== 1 || !Array.isArray(file.setups)) return;
      this.setups = file.setups.map(parseSetup).filter((s): s is JumpShotSetup => s !== null).slice(0, MaxSetups);
      this.equippedId = typeof file.equippedId === 'string' ? file.equippedId : null;
    } catch {
      this.setups = [];
      this.equippedId = null;
    }
  }

  private save(): void {
    if (!this.storage) return;
    const file: StoreFile = { version: 1, equippedId: this.equippedId, setups: this.setups };
    try {
      this.storage.setItem(this.key, JSON.stringify(file));
    } catch {
      // Sem armazenamento (privado ou bloqueado): segue em memória.
    }
  }
}
