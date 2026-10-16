import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ClipsFile, HandDwellDefault, contactFrames, dribbleHandShape, framesToNext, handPush, handRise } from './ClipLibrary';
import { SplitStance, WeightShift, scissorSeconds, scissorStep, splitFoot, splitFrontFoot, weightTarget } from './DribbleFootwork';

const clips = (JSON.parse(readFileSync(join(__dirname, '../../public/assets/hoops_player.clips.json'), 'utf8')) as ClipsFile).clips;

describe('Dwell da mão no alto do quique', () => {
  test('SubidaEEmpurraoSemQuinaNasPontas', () => {
    for (const k of [1, 1.6, 2]) {
      expect(handRise(0, k)).toBeCloseTo(0, 9);
      expect(handRise(1, k)).toBeCloseTo(1, 9);
      expect(handPush(0, k)).toBeCloseTo(1, 9);
      expect(handPush(1, k)).toBeCloseTo(0, 9);
      // Velocidade ~0 nas pontas (derivada numérica pequena).
      const e = 1e-3;
      expect(Math.abs(handRise(e, k) - handRise(0, k)) / e).toBeLessThan(0.05);
      expect(Math.abs(handRise(1, k) - handRise(1 - e, k)) / e).toBeLessThan(0.05);
      expect(Math.abs(handPush(e, k) - handPush(0, k)) / e).toBeLessThan(0.05);
    }
  });

  test('MaoFicaMaisTempoNoAltoQueNoMeioCossenoSimetrico', () => {
    // Fração do meio-ciclo a menos de 3% do topo: maior com o dwell.
    const nearTop = (f: (s: number) => number) => {
      let n = 0;
      for (let i = 0; i <= 1000; i++) if (f(i / 1000) > 0.97) n++;
      return n / 1001;
    };
    expect(nearTop((s) => handPush(s, HandDwellDefault.push))).toBeGreaterThan(1.5 * nearTop((s) => handPush(s, 1)));
    expect(nearTop((s) => handRise(s, HandDwellDefault.rise))).toBeGreaterThan(1.5 * nearTop((s) => handRise(s, 1)));
  });

  test('EmpurraoSaiMaisRapidoNaSoltura', () => {
    // Na metade da altura (a soltura do loop parado) a mão desce mais rápido com o dwell: a bola é empurrada.
    const speedAtHalf = (k: number) => {
      const s = Math.pow(0.5, 1 / k); // handPush(s) = 0.5
      const e = 1e-4;
      return (handPush(s - e, k) - handPush(s + e, k)) / (2 * e);
    };
    expect(speedAtHalf(HandDwellDefault.push)).toBeGreaterThan(1.2 * speedAtHalf(1));
  });

  test('ContatoDoLoopCaiNasAlturasPedidasComDwell', () => {
    for (const name of ['Dribble_Idle_R', 'Dribble_Walk_R']) {
      const c = clips[name];
      const n = c.frames - 1;
      const { release, catch: catches } = contactFrames(c, 'r', 0.5, 0.65, HandDwellDefault);
      for (const r of release) {
        expect(dribbleHandShape(c, 'r', r, HandDwellDefault)!).toBeCloseTo(0.5, 3);
        expect(dribbleHandShape(c, 'r', r + 0.5, HandDwellDefault)!).toBeLessThan(0.5);
        const air = framesToNext(catches, r, n)!;
        expect(air / 60).toBeGreaterThan(0.12); // a bola ainda vai ao chão e volta
      }
      for (const k of catches) expect(dribbleHandShape(c, 'r', k, HandDwellDefault)!).toBeCloseTo(0.65, 3);
    }
  });

  test('ContatoMaisLongoComDwell', () => {
    // Mais tempo com a bola na mão (Hirata et al., 2011: o jogador bom fica mais tempo em contato).
    const c = clips['Dribble_Idle_R'];
    const n = c.frames - 1;
    const air = (dwell?: typeof HandDwellDefault) => {
      const { release, catch: catches } = contactFrames(c, 'r', 0.5, 0.65, dwell);
      return framesToNext(catches, release[0], n)!;
    };
    expect(air(HandDwellDefault)).toBeLessThan(air());
  });
});

describe('Base escalonada e tesoura', () => {
  test('PeDaMaoQueRecebeVaiAFrente', () => {
    expect(splitFrontFoot('l')).toBe('l');
    const l = splitFoot('l', 'l');
    const r = splitFoot('r', 'l');
    expect(l.z).toBeGreaterThan(0);
    expect(r.z).toBeLessThan(0);
    expect(l.x).toBeGreaterThan(0); // +x = esquerda
    expect(r.x).toBeLessThan(0);
    // Corredor: os pés nunca ficam um na frente do outro na mesma linha (a bola passa entre eles).
    expect(l.x - r.x).toBeGreaterThan(0.3);
  });

  test('ComboInverteABase', () => {
    // R->L: esquerdo à frente; L->R em seguida: direito à frente. Os dois pés trocam de lado em z.
    const a = { l: splitFoot('l', splitFrontFoot('l')), r: splitFoot('r', splitFrontFoot('l')) };
    const b = { l: splitFoot('l', splitFrontFoot('r')), r: splitFoot('r', splitFrontFoot('r')) };
    expect(Math.sign(a.l.z)).toBe(-Math.sign(b.l.z));
    expect(Math.sign(a.r.z)).toBe(-Math.sign(b.r.z));
    // A largura não muda na troca: os pés passam um pelo outro sem cruzar.
    expect(a.l.x).toBeCloseTo(b.l.x, 9);
  });

  test('PassoDaTesouraPousaSemTranco', () => {
    expect(scissorStep(0, 0.07).travel).toBe(0);
    expect(scissorStep(1, 0.07).travel).toBe(1);
    expect(scissorStep(1, 0.07).height).toBeCloseTo(0, 9);
    expect(scissorStep(0.5, 0.07).height).toBeCloseTo(0.07, 9);
    // Velocidade zero nas pontas (smootherstep).
    const e = 1e-3;
    expect(scissorStep(e, 0).travel / e).toBeLessThan(0.01);
    expect((1 - scissorStep(1 - e, 0).travel) / e).toBeLessThan(0.01);
  });

  test('TesouraNoRitmoDoQuique', () => {
    for (const toBounce of [0.1, 0.18, 0.25, 0.4]) {
      const s = scissorSeconds(toBounce);
      expect(s).toBeGreaterThanOrEqual(SplitStance.minSeconds);
      expect(s).toBeLessThanOrEqual(SplitStance.maxSeconds);
      // Os pés se cruzam (meio do passo) antes do quique: a bola passa com o corredor aberto.
      if (toBounce * SplitStance.bounceShare >= SplitStance.minSeconds) expect(s / 2).toBeLessThan(toBounce);
    }
  });

  test('PeNoMeioDaTesouraLongeDoChao', () => {
    // Enquanto o pé anda na horizontal ele está no ar (senão patina): a altura na janela de viagem passa de ~5 cm.
    const [a, b] = SplitStance.travelWindow;
    for (const lift of [SplitStance.liftFront, SplitStance.liftRear]) {
      for (let t = a; t <= b; t += 0.01) expect(scissorStep(t, lift).height).toBeGreaterThan(0.05);
    }
  });
});

describe('Transferência de peso', () => {
  const idle = { kind: null, u: 0, release: 0, catch: 0, fromHand: 'r' as const, toHand: 'r' as const };

  test('BaseEscalonadaLevaOPesoParaOPeDaFrente', () => {
    const t = weightTarget(idle, 'l', 'r');
    expect(t.z).toBeGreaterThan(0);
    expect(t.x).toBeGreaterThan(0); // pé esquerdo à frente: o quadril vai para a esquerda
    expect(t.yaw).toBeLessThan(0); // quadril esquerdo à frente
    const t2 = weightTarget(idle, 'r', 'r');
    expect(t2.yaw).toBeGreaterThan(0);
  });

  test('CrossoverPassaOPesoParaOLadoDaMaoNova', () => {
    const move = { kind: 'Cross', u: 0, release: 0.05, catch: 0.53, fromHand: 'r' as const, toHand: 'l' as const };
    const start = weightTarget(move, null, 'r');
    const end = weightTarget({ ...move, u: 0.9 }, null, 'r');
    expect(start.x).toBeLessThan(0); // carrega na direita (mão que solta)
    expect(end.x).toBeGreaterThan(0); // termina sobre a esquerda
  });

  test('MolaAssentaNoAlvoSemExplodirA144Hz', () => {
    for (const hz of [30, 60, 144]) {
      const w = new WeightShift();
      const target = { x: 0.05, y: -0.02, z: 0.03, yaw: 0.15 };
      let peak = 0;
      for (let i = 0; i < hz * 1.5; i++) {
        w.update(target, 1 / hz);
        peak = Math.max(peak, w.pos.x);
      }
      expect(w.pos.x).toBeCloseTo(0.05, 3);
      expect(w.pos.yaw).toBeCloseTo(0.15, 3);
      expect(peak).toBeLessThan(0.05 * 1.12); // passa pouco do ponto (inércia), sem oscilar
    }
  });
});
