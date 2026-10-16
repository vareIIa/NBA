import { describe, expect, it } from 'vitest';
import { ReleaseSpeed } from '../sim/HoopsShotModel';
import { type KeyValueStorage, JumpShotStore, MaxSetups, ShotFamilies, defaultSetup } from '../shot/JumpShotSetup';
import {
  type NavContext,
  FamilyLabels,
  ShotEditor,
  SpeedLabels,
  SpeedSteps,
  blendShares,
  clampIndex,
  draftName,
  navNeighbor,
  sameSetup,
  snapBlend,
  stepBlend,
  stepSpeed,
  withRowPreview,
} from './ShotCreatorView';

function memoryStorage(): KeyValueStorage {
  const data: Record<string, string> = {};
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('rótulos', () => {
  it('cada família tem o nome do jogador, e as velocidades têm nome em português', () => {
    expect(FamilyLabels.Curry).toBe('Stephen Curry');
    expect(FamilyLabels.Oscar).toBe('Oscar Robertson');
    for (const family of ShotFamilies) expect(FamilyLabels[family].length).toBeGreaterThan(3);
    expect(SpeedSteps).toEqual([ReleaseSpeed.Quick, ReleaseSpeed.Normal, ReleaseSpeed.Slow]);
    expect(SpeedSteps.map((s) => SpeedLabels[s])).toEqual(['Rápida', 'Normal', 'Lenta']);
  });

  it('o nome de um arremesso novo numera a partir do segundo', () => {
    expect(draftName('arremesso-1')).toBe('Meu arremesso');
    expect(draftName('arremesso-3')).toBe('Meu arremesso 3');
    expect(draftName('qualquer')).toBe('Meu arremesso');
  });
});

describe('porcentagem da mistura e velocidade', () => {
  it('arredonda para o passo de 5 e limita a 0..100', () => {
    expect(snapBlend(52)).toBe(50);
    expect(snapBlend(53)).toBe(55);
    expect(snapBlend(-10)).toBe(0);
    expect(snapBlend(120)).toBe(100);
    expect(snapBlend(Number.NaN)).toBe(0);
  });

  it('as duas camadas de cima somam 100 em todos os passos', () => {
    for (let p = 0; p <= 100; p += 5) {
      const { layer1, layer2 } = blendShares(p);
      expect(layer1 + layer2).toBe(100);
      expect(layer2).toBe(p);
    }
    expect(blendShares(35)).toEqual({ layer1: 65, layer2: 35 });
  });

  it('a mistura anda de 5 em 5, para na borda ou dá a volta quando pedido', () => {
    expect(stepBlend(50, 1)).toBe(55);
    expect(stepBlend(97, 1)).toBe(100);
    expect(stepBlend(100, 1)).toBe(100);
    expect(stepBlend(100, 1, true)).toBe(0);
    expect(stepBlend(0, -1, true)).toBe(100);
  });

  it('a velocidade para nas pontas ou dá a volta quando pedido', () => {
    expect(stepSpeed(ReleaseSpeed.Quick, -1)).toBe(ReleaseSpeed.Quick);
    expect(stepSpeed(ReleaseSpeed.Normal, 1)).toBe(ReleaseSpeed.Slow);
    expect(stepSpeed(ReleaseSpeed.Slow, 1)).toBe(ReleaseSpeed.Slow);
    expect(stepSpeed(ReleaseSpeed.Slow, 1, true)).toBe(ReleaseSpeed.Quick);
  });
});

describe('navegação', () => {
  const ctx: NavContext = {
    chips: ['chip:a', 'chip:b', 'chip:c'],
    buttons: ['btn:new', 'btn:save', 'btn:back'],
    editing: 'chip:b',
    home: 'card:1',
    current: ['Curry', 'Klay', 'Oscar'],
  };

  it('sobe e desce pelos cartões; descer do último cai no chip em edição', () => {
    expect(navNeighbor('card:0', 'down', ctx)).toBe('card:1');
    expect(navNeighbor('card:0', 'up', ctx)).toBeNull();
    expect(navNeighbor('card:3', 'down', ctx)).toBe('chip:b');
  });

  it('da direita do cartão entra na linha da família atual; o de mistura entra na velocidade', () => {
    expect(navNeighbor('card:1', 'right', ctx)).toBe('opt:Klay');
    expect(navNeighbor('card:3', 'right', ctx)).toBe('speed');
    expect(navNeighbor('card:0', 'left', ctx)).toBeNull();
  });

  it('a tabela anda por linha e a Esquerda ou o Esc voltam ao cartão do slot', () => {
    expect(navNeighbor('opt:Curry', 'up', ctx)).toBeNull();
    expect(navNeighbor('opt:Curry', 'down', ctx)).toBe('opt:Klay');
    expect(navNeighbor('opt:Bird', 'down', ctx)).toBeNull();
    expect(navNeighbor('opt:Klay', 'left', ctx)).toBe('card:1');
    expect(navNeighbor('opt:Klay', 'right', ctx)).toBeNull();
  });

  it('no painel de mistura, velocidade e mistura descem uma para a outra; a mistura desce para a faixa', () => {
    expect(navNeighbor('speed', 'down', ctx)).toBe('blend');
    expect(navNeighbor('blend', 'up', ctx)).toBe('speed');
    expect(navNeighbor('blend', 'down', ctx)).toBe('chip:b');
  });

  it('na faixa anda entre chips e botões, e sobe dos botões para o chip em edição', () => {
    expect(navNeighbor('chip:a', 'right', ctx)).toBe('chip:b');
    expect(navNeighbor('chip:c', 'right', ctx)).toBe('chip:c');
    expect(navNeighbor('chip:a', 'down', ctx)).toBe('btn:new');
    expect(navNeighbor('chip:a', 'up', ctx)).toBe('card:1');
    expect(navNeighbor('btn:save', 'left', ctx)).toBe('btn:new');
    expect(navNeighbor('btn:save', 'up', ctx)).toBe('chip:b');
    expect(navNeighbor('btn:back', 'down', ctx)).toBeNull();
  });

  it('a prévia mostra a família da linha focada, sem mexer na cópia', () => {
    const setup = defaultSetup();
    expect(withRowPreview(setup, 'opt:Kobe', 1).upperRelease1).toBe('Kobe');
    expect(withRowPreview(setup, 'opt:Kobe', 1).lowerBase).toBe(setup.lowerBase);
    expect(withRowPreview(setup, 'speed', 1)).toBe(setup);
    expect(withRowPreview(setup, 'opt:Kobe', 3)).toBe(setup);
  });

  it('limita índices sem dar a volta', () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(0, 0)).toBe(0);
  });
});

describe('cópia em edição', () => {
  it('começa no equipado e sem alterações', () => {
    const store = new JumpShotStore(memoryStorage());
    const editor = new ShotEditor(store);
    expect(editor.id).toBe(store.equipped().id);
    expect(editor.isDirty()).toBe(false);
    expect(editor.isEquipped()).toBe(true);
  });

  it('mexer só suja a cópia: o store muda só ao salvar', () => {
    const store = new JumpShotStore(memoryStorage());
    const editor = new ShotEditor(store);
    const before = store.equipped().blendPercent;
    const changed = before === 80 ? 20 : 80;
    editor.patch({ blendPercent: changed });
    expect(editor.isDirty()).toBe(true);
    expect(store.equipped().blendPercent).toBe(before);
    expect(editor.save()).toBe(true);
    expect(editor.isDirty()).toBe(false);
    expect(store.equipped().blendPercent).toBe(changed);
  });

  it('descartar volta à versão gravada', () => {
    const store = new JumpShotStore(memoryStorage());
    const editor = new ShotEditor(store);
    const before = editor.setup.releaseSpeed;
    editor.patch({ releaseSpeed: before === ReleaseSpeed.Slow ? ReleaseSpeed.Quick : ReleaseSpeed.Slow });
    editor.discard();
    expect(editor.setup.releaseSpeed).toBe(before);
    expect(editor.isDirty()).toBe(false);
  });

  it('um arremesso novo é rascunho até salvar, e entra no fim da lista', () => {
    const store = new JumpShotStore(memoryStorage());
    const editor = new ShotEditor(store);
    expect(editor.newDraft()).toBe(true);
    expect(editor.isStored()).toBe(false);
    expect(editor.isDirty()).toBe(true);
    expect(editor.canDelete()).toBe(false);
    expect(editor.equip()).toBe(false);
    expect(editor.save()).toBe(true);
    expect(store.list().map((s) => s.id)).toEqual(['arremesso-1', 'arremesso-2']);
    expect(editor.isStored()).toBe(true);
    expect(editor.isDirty()).toBe(false);
  });

  it('não cria arremesso novo quando a lista já tem o máximo', () => {
    const store = new JumpShotStore(memoryStorage());
    for (let i = 2; i <= MaxSetups; i++) store.upsert(defaultSetup(`arremesso-${i}`));
    const editor = new ShotEditor(store);
    expect(editor.canCreate()).toBe(false);
    expect(editor.newDraft()).toBe(false);
  });

  it('apaga só um salvo, com outro na lista, e a edição passa para o equipado', () => {
    const store = new JumpShotStore(memoryStorage());
    const editor = new ShotEditor(store);
    expect(editor.canDelete()).toBe(false);
    editor.newDraft();
    editor.save();
    expect(editor.load('arremesso-2')).toBe(true);
    expect(editor.canDelete()).toBe(true);
    expect(editor.remove()).toBe(true);
    expect(store.list().map((s) => s.id)).toEqual(['arremesso-1']);
    expect(editor.id).toBe('arremesso-1');
  });

  it('equipar exige arremesso salvo e sem alterações', () => {
    const store = new JumpShotStore(memoryStorage());
    store.upsert(defaultSetup('b', 'B'));
    const editor = new ShotEditor(store);
    editor.load('b');
    editor.patch({ blendPercent: editor.setup.blendPercent === 35 ? 40 : 35 });
    expect(editor.equip()).toBe(false);
    expect(store.equipped().id).toBe('arremesso-1');
    editor.save();
    expect(editor.equip()).toBe(true);
    expect(store.equipped().id).toBe('b');
    expect(editor.isEquipped()).toBe(true);
  });

  it('comparação de arremessos olha todos os campos editáveis', () => {
    const a = defaultSetup();
    const otherFamily = a.upperRelease2 === 'Klay' ? 'Curry' : 'Klay';
    expect(sameSetup(a, { ...a })).toBe(true);
    expect(sameSetup(a, { ...a, blendPercent: a.blendPercent === 55 ? 60 : 55 })).toBe(false);
    expect(sameSetup(a, { ...a, upperRelease2: otherFamily })).toBe(false);
  });
});
