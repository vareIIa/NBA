// Bandeja e enterrada no Freestyle, no modo laboratório (?lab=1): o Playwright avança quadro a quadro (1/60 s), então o
// tempo do jogo é exato. Confere o gatilho do X, o clipe certo, o salto visual e o registro do arremesso.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const OUT = 'test-results/finish';

type Vec2 = { x: number; y: number };
type DebugWindow = {
  __debug: {
    game: { position: Vec2; velocity: Vec2; layout: { rimFloorPoint: Vec2 } };
    animator: { root: { position: { y: number } }; active: { clip: string } | null };
  };
};
type GameWindow = {
  __debug: {
    game: {
      layout: { rimFloorPoint: Vec2 };
      placeForLab: (x: number, y: number, hand: 'r' | 'l') => void;
      finishing: boolean;
    };
  };
};
type LabWindow = {
  __lab: {
    place: (x: number, y: number, hand: 'r' | 'l') => void;
    step: (n: number, input: object) => void;
    render: () => void;
  };
};

async function openLab(page: Page): Promise<void> {
  await page.goto('/?lab=1');
  await page.waitForFunction(
    () => window.__garrafao?.ready === true && (window as unknown as { __lab?: unknown }).__lab !== undefined,
    undefined,
    { timeout: 30_000 },
  );
}

async function step(page: Page, frames: number, input: object = {}): Promise<void> {
  await page.evaluate(
    ([n, i]) => (window as unknown as LabWindow).__lab.step(n, i),
    [frames, input] as const,
  );
}

const shotCount = (page: Page): Promise<number> => page.evaluate(() => window.__garrafao!.shots().length);

/** Posiciona o jogador a `distance` metros do aro, do lado da quadra onde o jogo começa (x = 7,4 m no laboratório). */
async function placeNearRim(page: Page, distance: number, hand: 'r' | 'l'): Promise<void> {
  const rim = await page.evaluate(() => (window as unknown as DebugWindow).__debug.game.layout.rimFloorPoint);
  const side = 7.4 >= rim.x ? 1 : -1;
  await page.evaluate(
    ([x, y, h]) => (window as unknown as LabWindow).__lab.place(x, y, h),
    [rim.x + side * distance, rim.y, hand] as const,
  );
}

interface Snapshot {
  dist: number; // distância horizontal ao aro (m)
  approach: number; // velocidade rumo ao aro (m/s)
  speed: number; // velocidade do boneco (m/s)
  lift: number; // altura do boneco (m)
  clip: string | null; // clipe ativo
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const { game, animator } = (window as unknown as DebugWindow).__debug;
    const rim = game.layout.rimFloorPoint;
    const dx = rim.x - game.position.x;
    const dy = rim.y - game.position.y;
    const dist = Math.hypot(dx, dy);
    return {
      dist,
      approach: (game.velocity.x * dx + game.velocity.y * dy) / Math.max(dist, 1e-6),
      speed: Math.hypot(game.velocity.x, game.velocity.y),
      lift: animator.root.position.y,
      clip: animator.active?.clip ?? null,
    };
  });
}

/** Acompanha o salto e a soltura, tira prints em três quadros e devolve as amostras. */
async function followShot(page: Page, name: string): Promise<Snapshot[]> {
  mkdirSync(OUT, { recursive: true });
  const samples: Snapshot[] = [];
  for (let i = 0; i < 45; i++) {
    await step(page, 1);
    samples.push(await snapshot(page));
    if ([8, 18, 28].includes(i)) {
      await page.evaluate(() => (window as unknown as LabWindow).__lab.render());
      await page.screenshot({ path: `${OUT}/${name}-${i + 1}.png` });
    }
  }
  return samples;
}

/** Joga até o arremesso virar registro: a bola cai na tabela ou o voo chega ao limite de 8 s. */
async function untilShotRecorded(page: Page, before: number): Promise<void> {
  for (let i = 0; i < 40 && (await shotCount(page)) <= before; i++) await step(page, 15);
}

/** A enterrada e a bandeja pelo plano tocam o clipe da bandeja (o corpo é desenhado por cima dele). */
const planClip = (s: Snapshot) => s.clip === 'Layup_R' || s.clip === 'Layup_L';

test('enterrada parada: RT + X perto do aro sobe dos dois pés pelo plano e enterra', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openLab(page);
  await placeNearRim(page, 2.0, 'r');
  await step(page, 30);
  const before = await shotCount(page);
  const head0 = await headY(page);
  await step(page, 1, { sprint: true, shoot: true }); // RT + X
  const samples: Snapshot[] = [];
  const heads: number[] = [];
  for (let i = 0; i < 100; i++) {
    await step(page, 1);
    samples.push(await snapshot(page));
    heads.push(await headY(page));
  }
  await untilShotRecorded(page, before);

  const shots = await page.evaluate(() => window.__garrafao!.shots());
  expect(shots[shots.length - 1]?.type).toBe('Enterrada');
  expect(samples.some(planClip)).toBe(true);
  expect(samples[0].speed).toBeLessThan(1.5); // agacha antes de saltar: não sai do parado a 3 m/s num quadro
  expect(samples[samples.length - 1].speed).toBeLessThan(0.05); // parado depois do pouso
  expect(Math.max(...heads) - head0).toBeGreaterThan(0.6); // sobe até o aro
  for (let i = 1; i < heads.length; i++) expect(Math.abs(heads[i] - heads[i - 1])).toBeLessThan(0.12);
  expect(errors).toEqual([]);
});

test('enterrada correndo com X segurado: fica pendurado no aro e cai quando o X é solto', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openLab(page);
  await driveTo(page, 3.7, { sprint: true });
  const before = await shotCount(page);
  type HangWin = { __debug: { game: { layup: { plan: { hang?: { dropAt: number } } | null; label: string } }; animator: LayupWindow['__debug']['animator'] & { palmWorld: (h: string) => { y: number } } } };
  const state = () =>
    page.evaluate(() => {
      const d = (window as unknown as HangWin).__debug;
      return { hang: !!d.game.layup.plan?.hang, label: d.game.layup.label, palm: Math.max(d.animator.palmWorld('l').y, d.animator.palmWorld('r').y) };
    });
  let hung = 0;
  let palmTop = 0;
  for (let i = 0; i < 150; i++) {
    await step(page, 1, { shoot: true, sprint: true, moveY: 1 });
    const st = await state();
    if (st.hang) {
      hung++;
      if (hung > 30) palmTop = Math.max(palmTop, st.palm);
    }
  }
  expect((await state()).label).toContain('pendurado');
  expect(hung).toBeGreaterThan(60); // segurou o X: ainda pendurado (~1 s depois de agarrar)
  expect(palmTop).toBeGreaterThan(2.98); // a mão está no aro (3,05 m)
  const headHanging = await headY(page);
  await step(page, 70); // solta o X: cai e pousa
  expect(await headY(page)).toBeLessThan(headHanging - 0.5);
  await untilShotRecorded(page, before);
  const shots = await page.evaluate(() => window.__garrafao!.shots());
  expect(shots[shots.length - 1]?.type).toBe('Enterrada');
  expect(errors).toEqual([]);
});

// Bandeja pelo plano (src/sim/HoopsLayup.ts, docs/21-bandejas.md): passadas, decolagem, voo balístico e soltura. A raiz
// fica no chão; quem sobe é a pelve, então o salto é medido pela cabeça.
type LayupWindow = {
  __debug: {
    game: { layup: { plan: unknown; label: string } };
    animator: { root: { position: { clone: () => unknown } }; bone: (n: string) => { getWorldPosition: (v: unknown) => { y: number } } };
  };
};
const headY = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const a = (window as unknown as LayupWindow).__debug.animator;
    return a.bone('head').getWorldPosition(a.root.position.clone()).y;
  });
const layupLabel = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as LayupWindow).__debug.game.layup.label);

/** Corre para a cesta (LS para cima) a partir de 5 m até ficar a `dist` m do aro. */
async function driveTo(page: Page, dist: number, extra: object = {}): Promise<Snapshot> {
  await placeNearRim(page, 5.2, 'r');
  await step(page, 10);
  let s = await snapshot(page);
  for (let i = 0; i < 160 && s.dist > dist; i++) {
    await step(page, 1, { moveY: 1, ...extra });
    s = await snapshot(page);
  }
  return s;
}

test('bandeja: X segurado correndo para a cesta vira bandeja (passadas, salto e soltura), com o clipe Layup', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openLab(page);
  const s = await driveTo(page, 3.6);
  expect(s.approach).toBeGreaterThan(1.5);
  const before = await shotCount(page);
  const head0 = await headY(page);
  // X segurado (o toque é hop step): 0,4 s.
  const samples: Snapshot[] = [];
  const heads: number[] = [];
  for (let i = 0; i < 100; i++) {
    await step(page, 1, { shoot: i < 24, moveY: 1 });
    samples.push(await snapshot(page));
    heads.push(await headY(page));
    if ([20, 40, 55].includes(i)) {
      mkdirSync(OUT, { recursive: true });
      await page.evaluate(() => (window as unknown as LabWindow).__lab.render());
      await page.screenshot({ path: `${OUT}/bandeja-${i + 1}.png` });
    }
  }
  await untilShotRecorded(page, before);

  const shots = await page.evaluate(() => window.__garrafao!.shots());
  expect(shots[shots.length - 1]?.type).toBe('Bandeja');
  expect(samples.some((x) => x.clip === 'Layup_R' || x.clip === 'Layup_L')).toBe(true);
  // Sobe de verdade (centro de massa ~0,5 m) e não para no ar: segue andando até pousar.
  expect(Math.max(...heads) - head0).toBeGreaterThan(0.45);
  const top = heads.indexOf(Math.max(...heads));
  expect(samples[top].speed).toBeGreaterThan(1.0);
  // Nenhum salto de quadro na cabeça (> 12 cm em 1/60 s).
  for (let i = 1; i < heads.length; i++) expect(Math.abs(heads[i] - heads[i - 1])).toBeLessThan(0.12);
  expect(errors).toEqual([]);
});

test('bandeja: toque no X é hop step; X duas vezes com o LS para a esquerda é euro step', async ({ page }) => {
  await openLab(page);
  await driveTo(page, 3.6);
  await step(page, 5, { shoot: true, moveY: 1 }); // toque (83 ms)
  await step(page, 30, { moveY: 1 });
  expect(await layupLabel(page)).toContain('Hop step');
  await step(page, 90);

  await driveTo(page, 3.9);
  await step(page, 5, { shoot: true, moveY: 1 });
  await step(page, 5, { moveY: 1, moveX: -0.7 });
  await step(page, 5, { shoot: true, moveY: 1, moveX: -0.7 }); // segundo toque com o LS para a esquerda
  await step(page, 20, { moveY: 1, moveX: -0.7 });
  expect(await layupLabel(page)).toContain('Euro step');
});

test('bandeja: o corpo não congela depois do pouso (volta a driblar e a correr)', async ({ page }) => {
  await openLab(page);
  await driveTo(page, 3.6);
  await step(page, 24, { shoot: true, moveY: 1 });
  await step(page, 110, { moveY: 1 });
  // Bola de volta (A) e corrida de novo: a cabeça tem de se mexer (a pose não ficou presa na última da bandeja).
  await step(page, 60, { call: true });
  const a = await headY(page);
  await step(page, 20, { moveY: -1 });
  const clip = await page.evaluate(() => (window as unknown as DebugWindow).__debug.animator.active?.clip ?? null);
  expect(clip === 'Layup_R' || clip === 'Layup_L').toBe(false);
  expect(Math.abs((await headY(page)) - a)).toBeLessThan(0.6);
});

test('arremesso parado a 2 m do aro continua sendo arremesso, não bandeja', async ({ page }) => {
  await openLab(page);
  await placeNearRim(page, 2.0, 'r');
  await step(page, 10);
  const before = await shotCount(page);
  await step(page, 150, { shoot: true }); // segura o X: o gather solta sozinho
  await untilShotRecorded(page, before);

  const shots = await page.evaluate(() => window.__garrafao!.shots());
  expect(shots[shots.length - 1]?.type).toBe('Spot-up');
});

test('tolerância do RT: RT logo depois do X ainda vira enterrada', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openLab(page);
  await placeNearRim(page, 2.0, 'r');
  await step(page, 10);
  const before = await shotCount(page);
  await step(page, 1, { shoot: true }); // X sem RT: começa como arremesso parado
  await step(page, 2, { shoot: true, sprint: true }); // RT dois quadros depois do X
  const samples = await followShot(page, 'rt-depois');
  await untilShotRecorded(page, before);

  const shots = await page.evaluate(() => window.__garrafao!.shots());
  expect(shots[shots.length - 1]?.type).toBe('Enterrada');
  expect(samples.some(planClip)).toBe(true);
  expect(errors).toEqual([]);
});

test('tolerância do RT: RT até 100 ms antes do X também conta para a enterrada', async ({ page }) => {
  await openLab(page);
  await placeNearRim(page, 2.0, 'r');
  await step(page, 10);
  const before = await shotCount(page);
  await step(page, 3, { sprint: true }); // RT
  await step(page, 1); // solta o RT
  await step(page, 1, { shoot: true }); // X cerca de 33 ms depois de soltar o RT
  const samples = await followShot(page, 'rt-antes');
  await untilShotRecorded(page, before);

  const shots = await page.evaluate(() => window.__garrafao!.shots());
  expect(shots[shots.length - 1]?.type).toBe('Enterrada');
  expect(samples.some(planClip)).toBe(true);
});

test('controle: o arremesso parado mostra o medidor, então o teste do medidor não é falso', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    const g = (window as unknown as GameWindow).__debug.game;
    const side = 7.4 >= g.layout.rimFloorPoint.x ? 1 : -1;
    g.placeForLab(g.layout.rimFloorPoint.x + side * 2.0, g.layout.rimFloorPoint.y, 'r');
  });
  await page.keyboard.down('Space'); // X sem RT: arremesso parado
  await page.waitForTimeout(150);
  const during = await page.evaluate(() => {
    const g = (window as unknown as GameWindow).__debug.game;
    return { finishing: g.finishing, meter: document.getElementById('meter')?.style.opacity ?? '' };
  });
  await page.keyboard.up('Space');
  expect(during.finishing).toBe(false);
  expect(during.meter).toBe('1');
});

test('bandeja e enterrada não mostram o medidor de timing (jogo em tempo real)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    const g = (window as unknown as GameWindow).__debug.game;
    const side = 7.4 >= g.layout.rimFloorPoint.x ? 1 : -1;
    g.placeForLab(g.layout.rimFloorPoint.x + side * 2.0, g.layout.rimFloorPoint.y, 'r');
  });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('Space'); // RT + X
  await page.waitForTimeout(150);
  const during = await page.evaluate(() => {
    const g = (window as unknown as GameWindow).__debug.game;
    return { finishing: g.finishing, meter: document.getElementById('meter')?.style.opacity ?? '' };
  });
  await page.keyboard.up('Space');
  await page.keyboard.up('ShiftLeft');
  expect(during.finishing).toBe(true);
  expect(during.meter).not.toBe('1');

  await page.waitForFunction(() => window.__garrafao!.shots().length >= 1, undefined, { timeout: 10_000 });
  const shots = await page.evaluate(() => window.__garrafao!.shots());
  expect(shots[shots.length - 1]?.type).toBe('Enterrada');
  expect(shots[shots.length - 1]?.timing).not.toBe('GREEN');
});

test('hop step em fases: pousa com a bola presa, jab com pé de pivô, pump fake e X segurado finaliza', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openLab(page);
  await driveTo(page, 3.8);
  await step(page, 5, { shoot: true, moveY: 1 }); // toque = hop step
  await step(page, 45);
  type HoldWin = { __debug: { game: { phase: string; layup: { hold: { pivot: string | null; moveKind: () => number | null } | null; plan: unknown } } } };
  const hold = () => page.evaluate(() => {
    const L = (window as unknown as HoldWin).__debug.game.layup;
    return { holding: L.hold !== null, pivot: L.hold?.pivot ?? null, plan: L.plan !== null };
  });
  expect((await hold()).holding).toBe(true); // pousou e ficou com a bola
  expect((await hold()).pivot).toBeNull(); // pivô livre depois do jump stop
  await step(page, 4, { proX: 1 }); // RS direita = jab
  await step(page, 30);
  expect((await hold()).pivot).toBe('l'); // o pé direito pisou: o esquerdo é o pivô
  await step(page, 5, { shoot: true }); // toque = pump fake
  await step(page, 35);
  expect((await hold()).holding).toBe(true);
  const before = await shotCount(page);
  await step(page, 24, { shoot: true }); // X segurado = finaliza
  await step(page, 20);
  expect((await hold()).holding).toBe(false);
  await untilShotRecorded(page, before);
  expect(await shotCount(page)).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

// RS dirigindo para a cesta (2K23, docs/21-bandejas.md §9): a finalização sai do Pro Stick, como no X.
type FinishWin = {
  __debug: {
    game: {
      layup: { plan: { hang?: unknown } | null; label: string };
      ratings: Record<string, unknown> & { dunk: Record<string, unknown> };
      setRatings: (r: unknown) => void;
    };
  };
};
const finishState = (page: Page) =>
  page.evaluate(() => {
    const L = (window as unknown as FinishWin).__debug.game.layup;
    return { label: L.label, plan: L.plan !== null, hang: !!L.plan?.hang };
  });

test('RS com RT dirigindo para a cesta: cima = enterrada de duas mãos; baixo segurado = fica pendurado', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openLab(page);
  await driveTo(page, 3.7, { sprint: true });
  await step(page, 14, { sprint: true, moveY: 1, proY: 1 }); // RT + RS cima
  expect((await finishState(page)).label).toBe('Enterrada de duas mãos');
  await step(page, 120, { moveY: 1 });

  await driveTo(page, 3.7, { sprint: true });
  let hung = false;
  for (let i = 0; i < 110; i++) {
    await step(page, 1, { sprint: true, moveY: 1, proY: -1 }); // RT + RS baixo segurado
    if ((await finishState(page)).hang) hung = true;
  }
  expect(hung).toBe(true);
  expect((await finishState(page)).label).toContain('pendurado');
  expect(errors).toEqual([]);
});

test('RS sem RT dirigindo para a cesta: baixo = floater; lado = scoop (e o X solto não vira hop)', async ({ page }) => {
  await openLab(page);
  await driveTo(page, 4.2);
  await step(page, 14, { moveY: 1, proY: -1 });
  expect((await finishState(page)).label).toContain('floater');
  await step(page, 110, { moveY: 1 });

  await driveTo(page, 3.6);
  await step(page, 14, { moveY: 1, proX: 1 });
  await step(page, 10, { moveY: 1 });
  expect((await finishState(page)).label).toContain('scoop');
});

test('build sem enterrada (Driving Dunk baixo): RT + X perto do aro vira bandeja', async ({ page }) => {
  await openLab(page);
  await page.evaluate(() => {
    const g = (window as unknown as FinishWin).__debug.game;
    const r = g.ratings;
    g.setRatings({ ...r, canDunk: false, dunk: { ...r.dunk, driving: false, standing: false, hang: false } });
  });
  await driveTo(page, 3.6, { sprint: true });
  const before = await shotCount(page);
  await step(page, 24, { shoot: true, sprint: true, moveY: 1 });
  expect((await finishState(page)).label).not.toMatch(/Enterrada|Tomahawk|Moinho|Cock-back/);
  await step(page, 100, { moveY: 1 });
  await untilShotRecorded(page, before);
  const shots = await page.evaluate(() => window.__garrafao!.shots());
  expect(shots[shots.length - 1]?.type).toBe('Bandeja');
});
