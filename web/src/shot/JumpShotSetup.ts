// Criador de arremesso (modelo de dados, sem three.js e sem DOM): um arremesso é a base (corpo de baixo), duas camadas de
// cima (Upper Release 1 e 2), a mistura entre elas e a velocidade de soltura. Vários arremessos podem ser salvos; um fica
// equipado e é o que o jogador usa no Freestyle.
import { ReleaseSpeed, defaultShotTuning } from '../sim/HoopsShotModel';
import { type ShotForm, ShotSignatureIds, type ShotSignatureId, shotFormOf } from './ShotForms';

export type ShotHand = 'r' | 'l';

/**
 * Famílias que o criador oferece: os jogadores de referência (src/shot/ShotForms.ts). Cada um tem uma base (corpo de
 * baixo) e uma release (corpo de cima), como no 2K.
 */
export const ShotFamilies = ShotSignatureIds;
export type ShotFamily = ShotSignatureId;
/** Famílias antigas (clipes de mocap da CMU, até 2026-10-15) viram o arremesso padrão ao carregar. */
const LegacyFamilies: readonly string[] = ['JumpShot', 'JumpShot2'];
export const DefaultFamily: ShotFamily = 'Curry';

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

/** Forma pronta para o animador: a base e a mistura das duas releases. */
export function formOf(setup: JumpShotSetup): ShotForm {
  return shotFormOf(setup.lowerBase, setup.upperRelease1, setup.upperRelease2, upperWeights(setup.blendPercent).upper2);
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

/** Arremesso inicial: o do Stephen Curry em tudo, sem mistura. */
export function defaultSetup(id = 'arremesso-1', name = 'Meu arremesso'): JumpShotSetup {
  return {
    id,
    name,
    lowerBase: DefaultFamily,
    upperRelease1: DefaultFamily,
    upperRelease2: DefaultFamily,
    blendPercent: 0,
    releaseSpeed: ReleaseSpeed.Normal,
  };
}

/** Confere um objeto vindo do armazenamento (que pode estar corrompido ou ser de outra versão). */
export function parseSetup(raw: unknown): JumpShotSetup | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const family = (v: unknown): ShotFamily | null =>
    (ShotFamilies as readonly unknown[]).includes(v) ? (v as ShotFamily) : LegacyFamilies.includes(v as string) ? DefaultFamily : null;
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

// ------------------------------------------------------------------------------------------- atributos (tela do 2K)

/** Tempo ideal de soltura (s) de cada velocidade, o mesmo do modelo de arremesso (centro do green). */
export function idealReleaseSeconds(speed: ReleaseSpeed): number {
  const t = defaultShotTuning();
  const ms = speed === ReleaseSpeed.Quick ? t.idealReleaseMsQuick : speed === ReleaseSpeed.Slow ? t.idealReleaseMsSlow : t.idealReleaseMsNormal;
  return ms / 1000;
}

export type Grade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F';
const GradeSteps: readonly Grade[] = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];

/** Nota de 0..1 em letra (F a A+), como no cartão SHOT ATTRIBUTES do 2K. */
export function gradeOf(score: number): Grade {
  const s = Math.min(1, Math.max(0, Number.isFinite(score) ? score : 0));
  return GradeSteps[Math.min(GradeSteps.length - 1, Math.floor(s * GradeSteps.length))];
}

/** Atributos do arremesso (0..1). Por enquanto só a velocidade muda o jogo (janela no modelo); os outros são da tela. */
export interface ShotAttributes {
  releaseHeight: number;
  releaseSpeed: number;
  defensiveImmunity: number;
  timingStability: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const SpeedScore: Record<ReleaseSpeed, number> = { [ReleaseSpeed.Quick]: 0.82, [ReleaseSpeed.Normal]: 0.58, [ReleaseSpeed.Slow]: 0.34 };

export function shotAttributes(setup: JumpShotSetup, heightM = 1.86): ShotAttributes {
  const { base, release } = formOf(setup);
  // Altura da bola na soltura (m): 2,10 = F, 2,50 = A+.
  const releaseY = release.release[1] * heightM + base.jump;
  const releaseHeight = clamp01((releaseY - 2.1) / 0.4);
  // Um tempo só e dip raso soltam mais rápido; parar no set point e dip fundo atrasam.
  const releaseSpeed = clamp01(SpeedScore[setup.releaseSpeed] + 0.12 - release.setHold * 1.2 - (base.dip - 0.05) * 2);
  // Difícil de tocar: soltura alta, fade para trás, perna à frente (Dirk), bola atrás da cabeça.
  const defensiveImmunity = clamp01(
    releaseHeight * 0.6 + Math.max(0, -base.drift) * 0.9 + base.oneLeg * 0.12 + Math.max(0, 0.25 - release.setPoint[2]) * 0.6 + 0.1,
  );
  // Repetível: pouco salto, pouca deriva e chute, cotovelo embaixo da bola; a soltura rápida aperta a janela.
  const quickPenalty = setup.releaseSpeed === ReleaseSpeed.Quick ? 0.08 : setup.releaseSpeed === ReleaseSpeed.Slow ? -0.04 : 0;
  const timingStability = clamp01(
    0.95 - Math.abs(base.drift) * 0.7 - base.kick * 0.15 - Math.max(0, base.jump - 0.12) * 1.2 - release.elbowFlare * 0.25 - base.oneLeg * 0.1 - quickPenalty,
  );
  return { releaseHeight, releaseSpeed, defensiveImmunity, timingStability };
}

/** Atributos de um jogador sozinho (base e as duas releases dele, velocidade normal), para a lista de animações. */
export function signatureAttributes(family: ShotFamily): ShotAttributes {
  return shotAttributes({ ...defaultSetup(), lowerBase: family, upperRelease1: family, upperRelease2: family, blendPercent: 0 });
}
