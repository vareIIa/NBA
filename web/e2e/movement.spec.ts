import { expect, test } from '@playwright/test';
import type { Freestyle } from '../src/game/Freestyle';
import { DribbleMove } from '../src/sim/HoopsDribbleMoves';

type LabWindow = {
  __debug: { game: Freestyle };
  __lab: {
    lab: { hz: number; clock: number };
    step: (frames: number, input?: object) => void;
    place: (x: number, y: number, hand: 'r' | 'l') => void;
    metrics: () => { nanFrames: number };
    render: () => void;
  };
};

for (const hz of [30, 60, 120, 144]) {
  test(`movimento a ${hz} Hz: giro de 180°, escape imediato e crossover andando`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    // Evita reload por edições de outras sessões durante o roteiro determinístico.
    await page.routeWebSocket('**', () => {});
    await page.goto('/?lab=1&menu=0&arena=0');
    await page.waitForFunction(() => window.__garrafao?.ready === true, undefined, { timeout: 30_000 });

    const result = await page.evaluate(({ hz, escape }) => {
      const { __debug: { game }, __lab: lab } = window as unknown as LabWindow;
      lab.lab.hz = hz;
      lab.step(60);
      lab.place(7.4, 0, 'r');
      const desired = game.facing;
      game.facing = desired.neg();
      lab.step(2);
      const firstTurn = game.facing.dot(desired.neg());
      lab.step(58);
      const facing = game.facing.dot(desired);

      // RT e o início do drible chegam no mesmo update, sem um quadro prévio de sprint.
      lab.place(7.4, 0, 'r');
      const start = game.position;
      game.dribble.request(escape, lab.lab.clock);
      lab.step(20, { sprint: true });
      const escapeDistance = game.position.sub(start).length2D();
      lab.step(70);

      lab.place(7.4, 0, 'r');
      lab.step(27, { moveY: 1 });
      lab.step(4, { moveY: 1, proY: 1 });
      lab.step(60, { moveY: 1 });
      lab.step(30);
      lab.render();
      return {
        firstTurn, facing, escapeDistance,
        hand: game.dribbler.ballHand(),
        moves: window.__garrafao!.moves(),
        nanFrames: lab.metrics().nanFrames,
      };
    }, { hz, escape: DribbleMove.AttackingCrossover });

    expect(result.firstTurn).toBeLessThan(0.95);
    expect(result.facing).toBeGreaterThan(0.999);
    expect(result.escapeDistance).toBeGreaterThan(0.15);
    expect(result.moves).toContain('Crossover de ataque');
    expect(result.moves).toContain('Crossover');
    expect(result.hand).toBe('l');
    expect(result.nanFrames).toBe(0);
    expect(errors).toEqual([]);
  });
}
