import { describe, expect, test } from 'vitest';
import { HoldMove, HoldMoveSpecs, HoldState, holdFinishFor, holdMoveForGesture } from './HoopsHold';
import { Vec3 } from './HoopsMath';
import { StickDir, StickGestureKind, makeStickGesture } from './HoopsProStick';

// De frente para a cesta (olhando para -x): direita = -y. Pés da base do jump stop, 0,5 m de largura.
const facing = new Vec3(-1, 0, 0);
const base = () => new HoldState({ feet: { l: new Vec3(3, 0.25, 0), r: new Vec3(3, -0.25, 0) }, facing }, 'r', 0);
const flick = (dir: StickDir) => makeStickGesture({ kind: StickGestureKind.Flick, dir });

describe('bola presa: comandos do RS (ameaça tripla do 2K24)', () => {
  test('bola na direita: direita = jab, cima-direita = jab grande, cima = stepover, baixo = pump fake', () => {
    expect(holdMoveForGesture(flick(StickDir.Right), 'r')).toBe(HoldMove.Jab);
    expect(holdMoveForGesture(flick(StickDir.UpRight), 'r')).toBe(HoldMove.JabBig);
    expect(holdMoveForGesture(flick(StickDir.Up), 'r')).toBe(HoldMove.StepOver);
    expect(holdMoveForGesture(flick(StickDir.Down), 'r')).toBe(HoldMove.PumpFake);
    expect(holdMoveForGesture(flick(StickDir.DownLeft), 'r')).toBe(HoldMove.StepOverBack);
  });

  test('bola na esquerda: tudo espelha (esquerda = jab)', () => {
    expect(holdMoveForGesture(flick(StickDir.Left), 'l')).toBe(HoldMove.Jab);
    expect(holdMoveForGesture(flick(StickDir.UpLeft), 'l')).toBe(HoldMove.JabBig);
  });
});

describe('bola presa: pé de pivô', () => {
  test('depois do jump stop o pivô é livre (Hakeem); o primeiro passo fixa o outro pé', () => {
    const h = base();
    expect(h.pivot).toBeNull();
    h.start(HoldMove.PumpFake, 0);
    expect(h.pivot).toBeNull(); // pump fake não pisa
    h.update(1);
    h.start(HoldMove.Jab, 1);
    expect(h.pivot).toBe('l'); // bola na direita: o pé direito pisa, o esquerdo é o pivô
  });

  test('o pé de pivô não sai do lugar durante nenhum movimento', () => {
    for (const kind of [HoldMove.Jab, HoldMove.JabBig, HoldMove.JabCross, HoldMove.StepOver, HoldMove.StepOverBack, HoldMove.SpinOut, HoldMove.StepThrough]) {
      const h = base();
      h.start(kind, 0);
      const d = HoldMoveSpecs[kind].duration;
      for (let u = 0; u <= 1.0001; u += 0.1) {
        const p = h.pose(u * d);
        expect(p.feet.l.pos.sub(new Vec3(3, 0.25, 0)).length2D(), `${kind} u=${u}`).toBeLessThan(1e-9);
        expect(p.feet.l.planted).toBe(true);
      }
    }
  });

  test('jab: o pé livre vai ~35 cm à frente e volta para a base; o peso fica mais no pivô', () => {
    const h = base();
    h.start(HoldMove.Jab, 0);
    const spec = HoldMoveSpecs[HoldMove.Jab];
    const peak = h.pose(spec.peak * spec.duration + 0.02);
    const r0 = new Vec3(3, -0.25, 0);
    expect(r0.x - peak.feet.r.pos.x).toBeGreaterThan(0.3); // para a frente (para a cesta, -x)
    const mid = new Vec3(3, 0, 0);
    expect(peak.com.sub(mid).length2D()).toBeLessThan(peak.feet.r.pos.sub(mid).length2D());
    h.update(spec.duration + 0.01);
    expect(h.stance.feet.r.sub(r0).length2D()).toBeLessThan(1e-6);
  });

  test('pivô reverso: o lado do pé livre vai para trás e o corpo gira ~110°', () => {
    const h = base();
    h.start(HoldMove.StepOverBack, 0);
    h.update(1);
    const f = h.stance.facing;
    const angle = (Math.acos(Math.max(-1, Math.min(1, f.dot(facing)))) * 180) / Math.PI;
    expect(angle).toBeGreaterThan(100);
    expect(h.stance.feet.r.x).toBeGreaterThan(3); // o pé direito foi para trás (para longe da cesta)
  });

  test('pump fake: a bola vai à testa e volta; os pés não mexem', () => {
    const h = base();
    h.start(HoldMove.PumpFake, 0);
    const spec = HoldMoveSpecs[HoldMove.PumpFake];
    const p = h.pose(spec.peak * spec.duration);
    expect(p.ball).toBe('forehead');
    expect(p.ballWeight).toBeGreaterThan(0.9);
    expect(p.feet.r.planted && p.feet.l.planted).toBe(true);
    expect(h.pose(spec.duration).ballWeight).toBeLessThan(0.05);
  });

  test('finalização: perto do aro bandeja, longe arremesso', () => {
    expect(holdFinishFor(1.8)).toBe('layup');
    expect(holdFinishFor(2.9)).toBe('layup');
    expect(holdFinishFor(4)).toBe('floater');
    expect(holdFinishFor(5.2)).toBe('shot');
  });
});
