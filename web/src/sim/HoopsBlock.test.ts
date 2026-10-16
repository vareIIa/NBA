// Toco físico (HoopsBlock): o pulo do defensor contra a trajetória real da bola.
import { describe, expect, it } from 'vitest';
import { BallSim, defaultBallSimConfig, makeBallState } from './HoopsBallSim';
import { HoopSpec } from './HoopsCourt';
import { Vec3 } from './HoopsMath';
import { contestJumpAt } from '../anim/DefenseMotion';
import {
  type BlockDefender,
  FinishResist,
  blockDeflection,
  blockKindFor,
  blockSuccess,
  findBlockContact,
  findHandContact,
  jumpLiftAt,
  jumpPeakS,
  samplePath,
} from './HoopsBlock';

const hoop = HoopSpec.fromRimFloorPoint(new Vec3(0, 0, 0), new Vec3(1, 0, 0));
const sim = new BallSim(defaultBallSimConfig(), hoop);
const rim = hoop.rimCenter();

/** Bola que sai de `from` e cai no centro do aro em `flight` s (a mesma conta do arremesso, sem arrasto). */
function shotTo(from: Vec3, flight: number) {
  const to = rim.add(new Vec3(0, 0, 0.1));
  const v = new Vec3((to.x - from.x) / flight, (to.y - from.y) / flight, (to.z - from.z + 0.5 * 9.81 * flight * flight) / flight);
  return makeBallState(from, v);
}

const big = (feet: Vec3, jump: BlockDefender['jump']): BlockDefender => ({ feet, heightM: 2.1, wingspanM: 2.25, block: 85, jump, handsUp: 1 });

describe('HoopsBlock', () => {
  it('a subida do pulo é a mesma do DefenseMotion', () => {
    for (const h of [0.4, 0.6, 0.75]) {
      for (const t of [0, 0.05, 0.12, 0.25, 0.4, 0.6, 0.9]) expect(jumpLiftAt(t, h)).toBeCloseTo(contestJumpAt(t, h).lift, 9);
    }
    expect(jumpLiftAt(jumpPeakS(0.6), 0.6)).toBeCloseTo(0.6, 6);
  });

  it('pivô que pula na hora toca a bandeja na subida, sem interferência', () => {
    // Bandeja soltando a 1 m do aro, a 2,9 m de altura; o defensor entre a bola e o aro, no alto do pulo na soltura.
    const ball = shotTo(new Vec3(1.0, 0.25, 2.9), 0.55);
    const path = samplePath(sim, ball, 1.2);
    const contact = findBlockContact(big(new Vec3(0.55, 0.1, 0), { t: jumpPeakS(0.6) - 0.05, h: 0.6 }), path, rim);
    expect(contact).not.toBeNull();
    expect(contact!.goaltend).toBe(false);
    expect(contact!.t).toBeLessThan(0.25);
  });

  it('sem pulo e longe, nada; pulo cedo demais (já pousou), nada', () => {
    const ball = shotTo(new Vec3(6.5, 0, 2.6), 1.0);
    const path = samplePath(sim, ball, 1.5);
    expect(findBlockContact({ ...big(new Vec3(4.5, 1.2, 0), null), handsUp: 0 }, path, rim)).toBeNull();
    // Colado no arremessador, mas o pulo começou 1,2 s antes da soltura: já está no chão quando a bola passa.
    expect(findBlockContact({ ...big(new Vec3(5.7, 0, 0), { t: 1.2, h: 0.6 }), heightM: 1.9, wingspanM: 1.95 }, path, rim)).toBeNull();
  });

  it('jump shot de longe: o alto, colado e no tempo certo pega em cheio; o baixo, no máximo de raspão', () => {
    const ball = shotTo(new Vec3(6.5, 0, 2.55), 1.05);
    const path = samplePath(sim, ball, 1.5);
    const onTime = findBlockContact(big(new Vec3(5.75, 0, 0), { t: jumpPeakS(0.65), h: 0.65 }), path, rim);
    expect(onTime).not.toBeNull();
    expect(onTime!.clean).toBeGreaterThan(0.4);
    const small: BlockDefender = { feet: new Vec3(5.75, 0, 0), heightM: 1.85, wingspanM: 1.88, block: 50, jump: { t: jumpPeakS(0.45), h: 0.45 }, handsUp: 1 };
    const graze = findBlockContact(small, path, rim);
    expect(graze === null || graze.clean < 0.2).toBe(true);
    // Um passo mais longe (1,3 m) o baixo já não alcança.
    expect(findBlockContact({ ...small, feet: new Vec3(5.2, 0, 0) }, path, rim)).toBeNull();
  });

  it('tocar na bola descendo acima do aro é interferência; depois que ela passou pelo aro, nada', () => {
    const ball = shotTo(new Vec3(4.0, 0, 2.5), 0.9);
    const path = samplePath(sim, ball, 1.5);
    // Defensor na frente do aro que aperta o Y 0,37 s depois da soltura (t negativo = o pulo ainda vai começar): no alto
    // do pulo a bola já desce sobre o aro.
    const late = findBlockContact(big(new Vec3(0.5, 0, 0), { t: -(0.85 - jumpPeakS(0.7)), h: 0.7 }), path, rim, 1.2);
    expect(late).not.toBeNull();
    expect(late!.goaltend).toBe(true);
    // Pulando bem depois: a bola já entrou; tocar nela embaixo do aro não conta.
    expect(findBlockContact(big(new Vec3(0.35, 0, 0), { t: -(1.3 - jumpPeakS(0.7)), h: 0.7 }), path, rim, 1.6)).toBeNull();
  });

  it('toco no aro: o pivô no ar alcança a bola na mão de quem sobe para a enterrada; no chão, ou baixo, não', () => {
    // Bola na mão da enterrada a 2,9 m, a 0,6 m do aro; o pivô entre ela e o aro.
    const ball = new Vec3(0.6, 0.1, 2.9);
    const up = findHandContact(big(new Vec3(0.2, 0, 0), { t: jumpPeakS(0.6), h: 0.6 }), ball);
    expect(up).not.toBeNull();
    expect(up!.clean).toBeGreaterThan(0.5);
    expect(findHandContact({ ...big(new Vec3(0.2, 0, 0), null), handsUp: 1 }, ball.withZ(3.4))).toBeNull();
    const small: BlockDefender = { feet: new Vec3(0.2, 0, 0), heightM: 1.85, wingspanM: 1.85, block: 40, jump: { t: jumpPeakS(0.4), h: 0.4 }, handsUp: 1 };
    expect(findHandContact(small, ball.withZ(3.35))).toBeNull();
    // Mesmo em cheio, o aro pega bem menos que o voo: quem finaliza protege a bola (enterrada mais ainda).
    expect(FinishResist.dunk).toBeLessThan(FinishResist.layup);
    expect(FinishResist.layup).toBeLessThan(1);
  });

  it('tapa em cheio leva a bola para longe da cesta; chance sobe com o rating e com o contato em cheio', () => {
    const contact = { t: 0.1, ball: new Vec3(1.2, 0.3, 3.2), hand: new Vec3(1.1, 0.25, 3.15), shoulder: new Vec3(0.6, 0.1, 2.3), dist: 0.05, goaltend: false, clean: 0.8 };
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 20; i++) {
      const { velocity } = blockDeflection('swat', contact, new Vec3(-3, 0, 4), rim, new Vec3(0.5, 0, 0), 80, rand);
      expect(velocity.flat().dot(contact.ball.sub(rim).flat().normalized())).toBeGreaterThan(3);
      expect(velocity.length2D()).toBeGreaterThan(5);
    }
    expect(blockSuccess(99, 1)).toBeGreaterThan(blockSuccess(40, 1));
    expect(blockSuccess(70, 1)).toBeGreaterThan(blockSuccess(70, 0));
    expect(blockSuccess(99, 1)).toBeLessThanOrEqual(0.95);
    expect(blockSuccess(40, 0.05)).toBeLessThan(0.35); // raspão de defensor fraco: quase nunca
    expect(blockKindFor(0.9)).toBe('swat');
    expect(blockKindFor(0.1)).toBe('tip');
  });
});
