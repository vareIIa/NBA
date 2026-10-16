import { describe, expect, it } from 'vitest';
import { ReleaseSpeed } from '../sim/HoopsShotModel';
import {
  JumpShotStore,
  MaxSetups,
  defaultSetup,
  formOf,
  gradeOf,
  shotAttributes,
  signatureAttributes,
  parseSetup,
  upperWeights,
  type KeyValueStorage,
  StorageKey,
} from './JumpShotSetup';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('forma e mistura das camadas', () => {
  it('o padrão é o Curry e a mistura das releases vai para a forma', () => {
    const s = defaultSetup();
    expect([s.lowerBase, s.upperRelease1, s.upperRelease2]).toEqual(['Curry', 'Curry', 'Curry']);
    const half = formOf({ ...s, upperRelease2: 'Oscar', blendPercent: 50 });
    const curry = formOf(s).release.setPoint[1];
    const oscar = formOf({ ...s, upperRelease1: 'Oscar' }).release.setPoint[1];
    expect(half.release.setPoint[1]).toBeCloseTo((curry + oscar) / 2, 9);
  });

  it('arremessos salvos com as famílias antigas (clipes da CMU) viram o padrão', () => {
    const old = { ...defaultSetup(), lowerBase: 'JumpShot2', upperRelease1: 'JumpShot', upperRelease2: 'JumpShot2' };
    const parsed = parseSetup(old);
    expect(parsed?.lowerBase).toBe('Curry');
    expect(parsed?.upperRelease1).toBe('Curry');
  });

  it('as duas camadas de cima somam 1 e a porcentagem é limitada a 0..100', () => {
    expect(upperWeights(20)).toEqual({ upper1: 0.8, upper2: 0.2 });
    const high = upperWeights(250);
    expect(high.upper2).toBe(1);
    expect(high.upper1 + high.upper2).toBeCloseTo(1, 9);
    expect(upperWeights(Number.NaN).upper2).toBe(0);
  });
});

describe('validação de arremesso', () => {
  it('aceita um arremesso bem formado e arredonda a porcentagem', () => {
    const parsed = parseSetup({ ...defaultSetup(), blendPercent: 33.6 });
    expect(parsed?.blendPercent).toBe(34);
  });

  it('recusa família, velocidade ou campos desconhecidos', () => {
    expect(parseSetup({ ...defaultSetup(), lowerBase: 'Layup' })).toBeNull();
    expect(parseSetup({ ...defaultSetup(), releaseSpeed: 9 })).toBeNull();
    expect(parseSetup(null)).toBeNull();
    expect(parseSetup('x')).toBeNull();
  });

  it('corta nome longo', () => {
    expect(parseSetup({ ...defaultSetup(), name: 'a'.repeat(60) })?.name).toHaveLength(32);
  });
});

describe('JumpShotStore', () => {
  it('começa com o arremesso padrão equipado', () => {
    const store = new JumpShotStore(memoryStorage());
    expect(store.list()).toHaveLength(1);
    expect(store.equipped().id).toBe(defaultSetup().id);
  });

  it('salva, equipa e persiste entre instâncias', () => {
    const storage = memoryStorage();
    const first = new JumpShotStore(storage);
    const id = first.nextId();
    expect(first.upsert({ ...defaultSetup(id, 'Curry-ish'), releaseSpeed: ReleaseSpeed.Quick })).toBe(true);
    expect(first.equip(id)).toBe(true);

    const second = new JumpShotStore(storage);
    expect(second.list()).toHaveLength(2);
    expect(second.equipped().id).toBe(id);
    expect(second.equipped().releaseSpeed).toBe(ReleaseSpeed.Quick);
    expect(storage.data[StorageKey]).toBeDefined();
  });

  it('respeita o limite de arremessos salvos', () => {
    const store = new JumpShotStore(memoryStorage());
    for (let i = 2; i <= MaxSetups; i++) expect(store.upsert(defaultSetup(`arremesso-${i}`))).toBe(true);
    expect(store.list()).toHaveLength(MaxSetups);
    expect(store.upsert(defaultSetup('extra'))).toBe(false);
  });

  it('não apaga o último e, ao apagar o equipado, equipa o primeiro', () => {
    const store = new JumpShotStore(memoryStorage());
    expect(store.remove(defaultSetup().id)).toBe(false);
    store.upsert(defaultSetup('b', 'B'));
    store.equip('b');
    expect(store.remove('b')).toBe(true);
    expect(store.equipped().id).toBe(defaultSetup().id);
  });

  it('usa o padrão quando o armazenamento está corrompido ou falha', () => {
    expect(new JumpShotStore(memoryStorage({ [StorageKey]: '{não é json' })).equipped().id).toBe(defaultSetup().id);
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('cheio');
      },
    };
    const store = new JumpShotStore(broken);
    expect(store.upsert(defaultSetup('x'))).toBe(true);
    expect(store.list()).toHaveLength(2);
  });

  it('ignora entradas inválidas no arquivo salvo', () => {
    const file = JSON.stringify({ version: 1, equippedId: 'ok', setups: [{ nada: true }, { ...defaultSetup('ok') }] });
    const store = new JumpShotStore(memoryStorage({ [StorageKey]: file }));
    expect(store.list().map((s) => s.id)).toEqual(['ok']);
    expect(store.equipped().id).toBe('ok');
  });
});

describe('atributos (tela do 2K)', () => {
  it('notas de F a A+ e ordem coerente entre jogadores', () => {
    expect(gradeOf(0)).toBe('F');
    expect(gradeOf(1)).toBe('A+');
    expect(gradeOf(0.5)).toBe('C+');
    const oscar = signatureAttributes('Oscar');
    const bird = signatureAttributes('Bird');
    expect(oscar.releaseHeight).toBeGreaterThan(bird.releaseHeight);
    expect(signatureAttributes('Dirk').defensiveImmunity).toBeGreaterThan(signatureAttributes('Klay').defensiveImmunity);
  });

  it('a velocidade rápida sobe a velocidade de soltura e baixa a estabilidade', () => {
    const normal = shotAttributes(defaultSetup());
    const quick = shotAttributes({ ...defaultSetup(), releaseSpeed: ReleaseSpeed.Quick });
    expect(quick.releaseSpeed).toBeGreaterThan(normal.releaseSpeed);
    expect(quick.timingStability).toBeLessThan(normal.timingStability);
  });
});
