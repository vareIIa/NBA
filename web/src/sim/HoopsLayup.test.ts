import { describe, expect, test } from 'vitest';
import { Vec3 } from './HoopsMath';
import { ShotType } from './HoopsShotModel';
import {
  LayupFinish,
  LayupGather,
  LayupStyles,
  LayupTuning,
  type LayupPlan,
  type LayupSituation,
  type Side,
  DunkRating,
  DunkTuning,
  allowedDunk,
  dunkAbility,
  chooseDunk,
  chooseLayup,
  dropHang,
  isDunkFinish,
  layupShotType,
  startHang,
  layupCom,
  layupFootState,
  layupHeight,
  layupZoneM,
  planHopStop,
  planLayup,
} from './HoopsLayup';

// Aro no (0, 0), quadra para +x (como no Freestyle). De frente para a cesta (olhando para -x) a direita é -y.
const forward = new Vec3(1, 0, 0);

/** Jogador correndo para o aro a partir de (x, y), com o pé `planted` no chão e o outro no ar, logo atrás. */
function running(x: number, y: number, speed: number, planted: Side, hand: Side = 'r'): LayupSituation {
  const position = new Vec3(x, y, 0);
  const dir = new Vec3(-x, -y, 0).normalized();
  const rightOfDir = new Vec3(0, 0, 1).cross(dir).normalized();
  const at = (s: Side, along: number) => position.add(dir.scale(along)).add(rightOfDir.scale(s === 'r' ? 0.09 : -0.09));
  return {
    position,
    velocity: dir.scale(speed),
    facing: dir,
    rimFloor: new Vec3(0, 0, 0),
    hoopForward: forward,
    ballHand: hand,
    feet: {
      l: { pos: at('l', planted === 'l' ? 0.05 : -0.3), planted: planted === 'l' },
      r: { pos: at('r', planted === 'r' ? 0.05 : -0.3), planted: planted === 'r' },
    },
    heightM: 1.86,
    baselineX: -1.6,
  };
}

const plan = (sit: LayupSituation, gather = LayupGather.Normal, finish = LayupFinish.Overhand, hand: Side = 'r', style = LayupStyles.padrao): LayupPlan => {
  const result = planLayup({ gather, finish, hand, glass: true }, sit, style);
  expect(result.plan, `sem plano: ${JSON.stringify({ tooFarBy: result.tooFarBy, tooClose: result.tooClose })}`).not.toBeNull();
  return result.plan!;
};

describe('bandeja: passadas (zero step, 1 e 2)', () => {
  test('mão direita com o pé esquerdo no chão no gather: 1-2 natural, decola com o esquerdo e o joelho direito sobe', () => {
    const p = plan(running(3.2, -2.2, 3.9, 'l'));
    expect(p.takeoffFoot).toBe('l');
    expect(p.driveKnee).toBe('r');
    expect(p.wrongFoot).toBe(false);
    expect(p.steps).toBe(2);
    const roles = p.contacts.filter((c) => c.role !== 'land').map((c) => `${c.role}:${c.foot}`);
    expect(roles).toEqual(['zero:l', 'step1:r', 'step2:l']);
  });

  test('com o pé da mão no chão, o estilo padrão troca o pé (um passo a mais ou um passo só), sem decolar com o pé errado', () => {
    const p = plan(running(3.6, -2.4, 3.9, 'r'));
    expect(p.takeoffFoot).toBe('l');
    expect(p.wrongFoot).toBe(false);
    expect(p.extraStep || p.steps === 1).toBe(true);
  });

  test('o estilo Kyrie aceita mesmo pé e mesma mão quando a passada cai assim', () => {
    const p = plan(running(3.2, -2.2, 3.9, 'r'), LayupGather.Normal, LayupFinish.FingerRoll, 'r', LayupStyles.kyrie);
    expect(p.takeoffFoot).toBe('r');
    expect(p.wrongFoot).toBe(true);
  });

  test('os pés não andam enquanto estão no chão e um pé não pisa de novo antes de sair', () => {
    const p = plan(running(3.4, -2.0, 4.5, 'l'));
    for (const side of ['l', 'r'] as const) {
      const list = p.contacts.filter((c) => c.foot === side);
      for (let i = 1; i < list.length; i++) expect(list[i].on).toBeGreaterThan(list[i - 1].off);
    }
    // No meio de cada contato o pé está nele.
    for (const c of p.contacts.filter((c) => Number.isFinite(c.off) && c.on >= 0)) {
      const s = layupFootState(p, c.foot, (c.on + c.off) / 2);
      expect(s.contact).toBe(c);
    }
  });

  test('penúltimo passo mais longo que o último (o plant é curto)', () => {
    const p = plan(running(3.6, -1.8, 4.2, 'l'));
    const step1 = p.contacts.find((c) => c.role === 'step1')!;
    const step2 = p.contacts.find((c) => c.role === 'step2')!;
    const zero = p.contacts.find((c) => c.role === 'zero')!;
    const len1 = step1.pos.sub(zero.pos).length2D();
    const len2 = step2.pos.sub(step1.pos).length2D();
    expect(len1).toBeGreaterThan(0.6);
    expect(len2).toBeGreaterThan(0.5);
    expect(len2).toBeLessThan(len1 * 0.9);
  });
});

describe('bandeja: decolagem, voo e soltura', () => {
  test('o centro de massa chega ao ponto da decolagem e segue reto no voo, sem parar no ar', () => {
    const p = plan(running(3.2, -2.2, 3.9, 'l'));
    const atTakeoff = layupCom(p, p.takeoffAt).pos;
    expect(atTakeoff.sub(p.takeoffPos).length2D()).toBeLessThan(0.03);
    const mid = layupCom(p, (p.takeoffAt + p.landAt) / 2);
    expect(mid.vel.length2D()).toBeCloseTo(p.takeoffSpeed, 6);
    expect(p.landPos.sub(p.takeoffPos).length2D()).toBeGreaterThan(0.5);
  });

  test('a bola sai perto do ápice, na frente do aro, acima de 2,7 m', () => {
    const p = plan(running(3.2, -2.2, 3.9, 'l'));
    expect(p.releaseAt).toBeGreaterThan(p.takeoffAt);
    expect(Math.abs(p.releaseAt - p.apexAt)).toBeLessThan(0.06);
    expect(p.release.z).toBeGreaterThan(2.7);
    expect(p.releaseDistance).toBeGreaterThan(0.3);
    expect(p.releaseDistance).toBeLessThan(0.9);
    // Na frente da tabela.
    expect(p.release.x).toBeGreaterThan(0.1);
  });

  test('altura: desce no penúltimo passo, sobe no voo e volta a zero de pé', () => {
    const p = plan(running(3.2, -2.2, 3.9, 'l'));
    const step1 = p.contacts.find((c) => c.role === 'step1')!;
    expect(layupHeight(p, (step1.on + step1.off) / 2).z).toBeLessThan(-0.06);
    expect(layupHeight(p, p.apexAt).z).toBeCloseTo(LayupTuning.zTakeoff + p.rise, 2);
    expect(layupHeight(p, p.endAt + 0.1).z).toBe(0);
  });

  test('a altura é contínua na decolagem e no pouso (sem salto de quadro)', () => {
    const p = plan(running(3.4, -2.0, 4.5, 'l'));
    for (const t of [p.takeoffAt, p.landAt]) {
      const a = layupHeight(p, t - 1e-4).z;
      const b = layupHeight(p, t + 1e-4).z;
      expect(Math.abs(a - b)).toBeLessThan(2e-3);
    }
    for (const t of [p.takeoffAt, p.landAt]) {
      const a = layupCom(p, t - 1e-4).pos;
      const b = layupCom(p, t + 1e-4).pos;
      expect(a.sub(b).length2D()).toBeLessThan(5e-3);
    }
  });

  test('correndo mais rápido, decola mais longe do aro', () => {
    const slow = plan(running(3.4, -2.0, 3.0, 'l'));
    const fast = plan(running(4.4, -2.6, 6.2, 'l'));
    const d = (p: LayupPlan) => p.takeoffPos.length2D();
    expect(d(fast)).toBeGreaterThan(d(slow));
  });

  test('perto da linha de fundo o voo não sai da quadra', () => {
    const p = plan(running(-0.5, -3.8, 6.2, 'l'));
    expect(p.landPos.x).toBeGreaterThan(-1.6 + 0.3);
  });
});

describe('bandeja: variações', () => {
  test('hop step: pousa nos dois pés juntos e decola com os dois', () => {
    const p = plan(running(3.0, -1.6, 3.9, 'l'), LayupGather.Hop, LayupFinish.Power);
    expect(p.takeoffFoot).toBe('both');
    const hop = p.contacts.filter((c) => c.role === 'hop');
    expect(hop.map((c) => c.foot).sort()).toEqual(['l', 'r']);
    expect(hop[0].on).toBe(hop[1].on);
  });

  test('euro step: o passo 2 cruza para o lado da mão da soltura', () => {
    const sit = running(3.6, -0.6, 4.0, 'l', 'r');
    const choice = chooseLayup({ command: 'euro', sprint: false }, sit);
    expect(choice.gather).toBe(LayupGather.Euro);
    expect(choice.hand).toBe('l');
    const p = planLayup(choice, sit).plan!;
    const step1 = p.contacts.find((c) => c.role === 'step1' || (c.role === 'step2' && p.extraStep))!;
    const step2 = p.contacts.find((c) => c.role === 'step2')!;
    // Para a esquerda de quem ataca (+y) do passo 1 para o 2.
    expect(step2.pos.y - step1.pos.y).toBeGreaterThan(0.3);
  });

  test('floater: solta subindo e longe do aro, com salto menor', () => {
    const p = plan(running(5.0, -0.8, 3.9, 'l'), LayupGather.OneStep, LayupFinish.Floater);
    expect(p.releaseAt).toBeLessThan(p.apexAt - 0.05);
    expect(p.releaseDistance).toBeGreaterThan(1.6);
    expect(p.rise).toBeLessThan(0.4);
  });

  test('X longe demais: o plano diz quanto falta andar', () => {
    const r = planLayup({ gather: LayupGather.Normal, finish: LayupFinish.Overhand, hand: 'r', glass: true }, running(8, -2, 3.9, 'l'));
    expect(r.plan).toBeNull();
    expect(r.tooFarBy).toBeGreaterThan(0.5);
  });

  test('a zona da bandeja cresce com a velocidade', () => {
    expect(layupZoneM(6.2, 'auto')).toBeGreaterThan(layupZoneM(3.9, 'auto'));
    expect(layupZoneM(0, 'auto')).toBeCloseTo(2.6, 6);
  });
});

describe('bandeja: escolha pelo contexto', () => {
  test('de lado (45°) a bandeja é com tabela, pela mão do lado', () => {
    const c = chooseLayup({ command: 'auto', sprint: false }, running(2.5, -2.5, 4, 'l', 'l'));
    expect(c.glass).toBe(true);
    expect(c.hand).toBe('r');
  });

  test('cruzando por baixo do aro pela linha de fundo, sai a reversa', () => {
    const sit = running(-0.4, -2.5, 4, 'l');
    sit.velocity = new Vec3(0, 4, 0);
    sit.facing = new Vec3(0, 1, 0);
    const c = chooseLayup({ command: 'auto', sprint: false }, sit);
    expect(c.finish).toBe(LayupFinish.Reverse);
  });

  test('scoop pelo RS: a mão é a do lado do stick', () => {
    const c = chooseLayup({ command: 'scoop', side: 'l', sprint: false }, running(2.5, -2.5, 4, 'l'));
    expect(c.finish).toBe(LayupFinish.Scoop);
    expect(c.hand).toBe('l');
  });
});

describe('hop step do toque (jump stop com parada)', () => {
  const landing = (p: LayupPlan) => p.contacts.filter((c) => c.role === 'hop');

  test('pousa nos dois pés juntos e para (vale andando, longe do aro)', () => {
    for (const [x, speed] of [[5.0, 2.1], [4.4, 3.9], [3.6, 5.5]] as const) {
      const p = planHopStop(running(x, -0.4, speed, 'l'));
      const land = landing(p);
      expect(land).toHaveLength(2);
      expect(land[0].on).toBe(land[1].on);
      expect(land.every((c) => c.off === Infinity)).toBe(true);
      expect(layupCom(p, p.stopAt!).vel.length2D()).toBeLessThan(0.05);
      // Base larga: mais que os ombros.
      expect(land[0].pos.sub(land[1].pos).length2D()).toBeGreaterThan(0.45);
    }
  });

  test('voo curto e baixo: os dois pés no ar ~0,15 s (2K27: ~0,13 s)', () => {
    const p = planHopStop(running(4.4, -0.4, 3.9, 'l'));
    const push = p.contacts.filter((c) => c.role === 'zero').reduce((a, c) => Math.max(a, c.off), 0);
    const on = landing(p)[0].on;
    expect(on - push).toBeGreaterThan(0.1);
    expect(on - push).toBeLessThan(0.2);
    const top = layupHeight(p, (push + on) / 2).z;
    expect(top - layupHeight(p, push).z).toBeLessThan(0.06);
  });

  test('anda ~0,7–1,2 m andando e mais correndo, sem parar embaixo do aro', () => {
    const walk = planHopStop(running(5.0, -0.4, 2.1, 'l'));
    const dWalk = walk.landPos.sub(new Vec3(5.0, -0.4, 0)).length2D();
    expect(dWalk).toBeGreaterThan(0.6);
    expect(dWalk).toBeLessThan(1.3);
    const run = planHopStop(running(5.0, -0.4, 4.5, 'l'));
    expect(run.landPos.sub(new Vec3(5.0, -0.4, 0)).length2D()).toBeGreaterThan(dWalk);
    const close = planHopStop(running(2.4, -0.2, 4.5, 'l'));
    expect(close.landPos.length2D()).toBeGreaterThan(1.45);
  });

  test('LS para o lado: o hop abre para aquele lado', () => {
    const sit = running(5.0, 0, 3.9, 'l');
    const straight = planHopStop(sit).landPos;
    // A direita do jogador: do pé esquerdo para o direito no pouso.
    const right = planHopStop(sit, 'r');
    const rFoot = landing(right).find((c) => c.foot === 'r')!.pos;
    const lFoot = landing(right).find((c) => c.foot === 'l')!.pos;
    const rightSide = rFoot.sub(lFoot).normalized();
    expect(right.landPos.sub(straight).dot(rightSide)).toBeGreaterThan(0.2);
  });
});

describe('enterrada pelo plano e pendurado no aro', () => {
  const dunk = (sit: LayupSituation, finish = LayupFinish.DunkOneHand, gather = LayupGather.Normal): LayupPlan => {
    const r = planLayup({ gather, finish, hand: 'r', glass: false }, sit, LayupStyles.padrao, DunkRating);
    expect(r.plan, `sem plano: ${JSON.stringify(r)}`).not.toBeNull();
    return r.plan!;
  };

  test('correndo: decola a 1,4–2,4 m do aro e a bola sai acima do aro, na frente do centro', () => {
    const p = dunk(running(3.6, -2.4, 4.4, 'l'));
    expect(p.takeoffPos.length2D()).toBeGreaterThan(1.4);
    expect(p.takeoffPos.length2D()).toBeLessThan(2.4);
    expect(p.release.z).toBeGreaterThan(3.08);
    expect(p.release.length2D()).toBeLessThan(0.15);
    expect(p.rise).toBeGreaterThan(0.6);
    expect(p.rise).toBeLessThanOrEqual(DunkTuning.riseMax);
    expect(layupShotType(p)).toBe(ShotType.Dunk);
  });

  test('sem pendurar: a mão no aro freia o corpo e ele pousa na frente da tabela', () => {
    const p = dunk(running(3.6, -2.4, 4.4, 'l'));
    // A tabela fica 0,38 m atrás do centro do aro (x < -0,38).
    expect(p.landPos.x).toBeGreaterThan(-0.3);
    for (let t = p.takeoffAt; t <= p.endAt; t += 0.01) expect(layupCom(p, t).pos.x).toBeGreaterThan(-0.3);
  });

  test('pendurado: fica no alto embaixo das mãos até soltar o X e então cai e pousa', () => {
    const p = dunk(running(3.6, -2.4, 4.4, 'l'), LayupFinish.DunkTwoHand);
    startHang(p, 1.86);
    const h = p.hang!;
    expect(h.grips).toHaveLength(2);
    expect(h.twoHands).toBe(true);
    // Assenta pendurado: o centro de massa fica perto da altura do pendurado durante o balanço.
    for (let t = h.grabAt + DunkTuning.settle; t < h.grabAt + 1.5; t += 0.05) {
      expect(Math.abs(layupHeight(p, t).z - h.z)).toBeLessThan(0.02);
      expect(layupCom(p, t).pos.sub(h.pos).length2D()).toBeLessThan(DunkTuning.swing.amp + 0.01);
    }
    // Solta o X: cai em queda livre e pousa.
    const drop = h.grabAt + 1.2;
    dropHang(p, drop);
    expect(h.dropAt).toBeCloseTo(drop, 6);
    expect(p.landAt).toBeGreaterThan(drop + 0.25);
    expect(p.landAt).toBeLessThan(drop + 0.6);
    expect(layupHeight(p, p.landAt - 1e-3).z).toBeCloseTo(LayupTuning.zTouchdown, 1);
    expect(layupHeight(p, p.endAt).z).toBeCloseTo(0, 3);
    const land = p.contacts.filter((c) => c.role === 'land');
    expect(land).toHaveLength(2);
    expect(land[0].on).toBeCloseTo(p.landAt, 6);
    // Altura contínua (sem salto) do voo ao pendurado e à queda.
    let prev = layupHeight(p, p.takeoffAt).z;
    for (let t = p.takeoffAt; t <= p.endAt; t += 1 / 120) {
      const z = layupHeight(p, t).z;
      expect(Math.abs(z - prev)).toBeLessThan(0.06);
      prev = z;
    }
  });

  test('o pendurado solta sozinho no tempo máximo e respeita o mínimo', () => {
    const p = dunk(running(3.6, -2.4, 4.4, 'l'));
    startHang(p, 1.86);
    const h = p.hang!;
    expect(h.dropAt).toBeCloseTo(h.grabAt + DunkTuning.hangMax, 6);
    dropHang(p, h.grabAt + 0.05);
    expect(h.dropAt).toBeCloseTo(h.grabAt + DunkTuning.hangMin, 6);
  });

  test('o contexto varia a enterrada: devagar sobe dos dois pés com as duas mãos, em velocidade entra o moinho', () => {
    const slow = chooseDunk(running(1.6, -0.8, 1.2, 'l'), { command: 'dunk', sprint: false }, 0.1);
    expect(slow.gather).toBe(LayupGather.Hop);
    expect(slow.finish).toBe(LayupFinish.DunkTwoHand);
    const seen = new Set<LayupFinish>();
    for (let r = 0; r < 1; r += 0.02) seen.add(chooseDunk(running(4, -2, 5, 'l'), { command: 'dunk', sprint: true }, r).finish);
    expect(seen.size).toBe(5);
    expect(seen.has(LayupFinish.Windmill)).toBe(true);
  });

  test('todas as enterradas cabem correndo de 45°', () => {
    for (const f of [LayupFinish.DunkOneHand, LayupFinish.DunkTwoHand, LayupFinish.Tomahawk, LayupFinish.CockBack, LayupFinish.Windmill]) {
      const p = dunk(running(3.6, -2.4, 4.4, 'l'), f);
      expect(isDunkFinish(p.choice.finish)).toBe(true);
    }
  });
});

describe('enterrada pela build (Driving Dunk, Standing Dunk, Impulsão)', () => {
  test('a build padrão (DD 80, SD 45, Vert 70) enterra de tudo com a subida de sempre', () => {
    const a = dunkAbility(80, 45, 70);
    expect(a).toMatchObject({ driving: true, standing: true, flashy: true, windmill: true, hang: true });
    expect(a.riseMax).toBeCloseTo(DunkTuning.riseMax, 6);
  });

  test('pouca enterrada troca os chamativos pelos simples; pouca impulsão não alcança o aro e vira bandeja', () => {
    const weak = dunkAbility(60, 30, 40);
    expect(weak.flashy).toBe(false);
    expect(weak.standing).toBe(false);
    expect(allowedDunk(LayupFinish.Windmill, weak)).toBe(LayupFinish.DunkOneHand);
    expect(allowedDunk(LayupFinish.CockBack, weak)).toBe(LayupFinish.DunkTwoHand);
    expect(allowedDunk(LayupFinish.Windmill, dunkAbility(75, 45, 70))).toBe(LayupFinish.Tomahawk);
    const sit = { ...running(3.6, -2.4, 4.4, 'l'), dunk: weak };
    const r = planLayup({ gather: LayupGather.Normal, finish: LayupFinish.DunkOneHand, hand: 'r', glass: false }, sit, LayupStyles.padrao, DunkRating);
    expect(r.plan).toBeNull();
    expect(dunkAbility(99, 99, 99).riseMax).toBeGreaterThan(DunkTuning.riseMax);
  });

  test('a enterrada pedida pelo RS vale (ou a mais simples que a build permite)', () => {
    const sit = running(4, -2, 5, 'l');
    expect(chooseDunk(sit, { command: 'dunk', sprint: true, finish: LayupFinish.CockBack }).finish).toBe(LayupFinish.CockBack);
    expect(chooseDunk({ ...sit, dunk: dunkAbility(60, 45, 70) }, { command: 'dunk', sprint: true, finish: LayupFinish.CockBack }).finish).toBe(LayupFinish.DunkTwoHand);
    expect(chooseDunk(sit, { command: 'dunk', sprint: true, finish: LayupFinish.DunkOneHand, side: 'l' }).hand).toBe('l');
  });
});
