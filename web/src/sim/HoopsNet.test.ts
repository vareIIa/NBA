// Rede com física (HoopsNet): a bola nunca atravessa um cordão, cai na rede, perde velocidade e sai por baixo.
import { describe, expect, test } from 'vitest';
import { BallSim, HoopSpec, NetSim, Rng, Vec3, defaultBallSimConfig, makeBallState } from './index';

const hoop = HoopSpec.fromRimFloorPoint(new Vec3(0, 0, 0), new Vec3(1, 0, 0));
const radius = defaultBallSimConfig().ball.radius;
const dt = 1 / 120;

function settle(net: NetSim): void {
  for (let i = 0; i < 240; i++) net.step(dt);
}

/** Roda bola + rede; devolve a pior folga (bola × cordão) e o estado no fim. */
function run(start: Vec3, velocity: Vec3, seconds: number, withNet = true) {
  const sim = new BallSim(defaultBallSimConfig(), hoop);
  const net = new NetSim(hoop);
  settle(net);
  const ball = makeBallState(start, velocity);
  let worst = Infinity;
  let rimWorst = Infinity;
  let highest = -Infinity;
  let touched = 0;
  let exitSpeed = NaN;
  const bottom = net.lowestZ();
  for (let t = 0; t < seconds / dt; t++) {
    sim.tick(ball);
    if (withNet) {
      if (net.step(dt, ball, radius).touched) touched++;
      worst = Math.min(worst, net.clearance(ball.position, radius));
      rimWorst = Math.min(rimWorst, net.rimClearance(hoop));
      highest = Math.max(highest, net.highestFreeZ());
    }
    if (Number.isNaN(exitSpeed) && ball.position.z < bottom - radius - 0.05) exitSpeed = ball.velocity.length();
  }
  return { ball, worst, rimWorst, highest, touched, exitSpeed, net };
}

describe('rede', () => {
  test('pendurada em repouso: 12 ganchos, losangos, rede para baixo do aro', () => {
    const net = new NetSim(hoop);
    settle(net);
    expect(net.count).toBe(84);
    const rim = hoop.rimCenter();
    expect(net.lowestZ()).toBeLessThan(rim.z - 0.38);
    expect(net.lowestZ()).toBeGreaterThan(rim.z - 0.47);
  });

  test('cesta limpa no meio: a bola passa pela rede, freia e não atravessa nenhum cordão', () => {
    const rim = hoop.rimCenter();
    const withNet = run(rim.withZ(rim.z + 0.4), new Vec3(0.3, 0, -4.5), 1.2);
    const free = run(rim.withZ(rim.z + 0.4), new Vec3(0.3, 0, -4.5), 1.2, false);
    expect(withNet.touched).toBeGreaterThan(3);
    expect(withNet.worst).toBeGreaterThan(-0.012);
    expect(withNet.exitSpeed).toBeLessThan(free.exitSpeed * 0.85); // a rede segura a bola
    expect(withNet.ball.position.z).toBeLessThan(rim.z - 0.6); // e ela sai por baixo
  });

  test('cesta raspando o aro (entra de lado): ainda sai por baixo e sem atravessar', () => {
    const rim = hoop.rimCenter();
    const r = run(rim.add(new Vec3(-0.09, 0.05, 0.35)), new Vec3(1.4, -0.3, -3.8), 1.3);
    expect(r.worst).toBeGreaterThan(-0.012);
    expect(r.ball.position.z).toBeLessThan(rim.z - 0.6);
  });

  test('bola batendo na rede por fora: a rede cede e segura, sem a bola cruzar cordão', () => {
    const rim = hoop.rimCenter();
    const r = run(rim.add(new Vec3(0.6, 0, -0.2)), new Vec3(-4, 0, 0), 0.6);
    expect(r.touched).toBeGreaterThan(0);
    expect(r.worst).toBeGreaterThan(-0.012);
    expect(Math.abs(r.ball.velocity.x)).toBeLessThan(2); // perdeu mais da metade da velocidade na rede
  });

  test('60 cestas de ângulos e velocidades variados: nenhuma cruza um cordão e todas saem por baixo', () => {
    const rim = hoop.rimCenter();
    const random = new Rng(23);
    for (let i = 0; i < 60; i++) {
      const offset = new Vec3((random.nextDouble() - 0.5) * 0.16, (random.nextDouble() - 0.5) * 0.16, 0.3);
      const velocity = new Vec3((random.nextDouble() - 0.5) * 3, (random.nextDouble() - 0.5) * 2, -3 - random.nextDouble() * 3);
      const r = run(rim.add(offset), velocity, 1.2);
      expect(r.worst, `cesta ${i}`).toBeGreaterThan(-0.012);
      expect(r.ball.position.z, `cesta ${i}`).toBeLessThan(rim.z - 0.6);
      // A rede sobe com a bola, mas nunca passa dos ganchos nem atravessa o tubo do aro.
      expect(r.highest, `cesta ${i}`).toBeLessThanOrEqual(r.net.ceilingZ + 1e-9);
      expect(r.rimWorst, `cesta ${i}`).toBeGreaterThan(-0.001);
    }
  });

  test('arremesso de verdade (entra a ~45°, 6–7 m/s, de vários lados): a rede não passa do aro', () => {
    const rim = hoop.rimCenter();
    const random = new Rng(7);
    for (let i = 0; i < 40; i++) {
      const heading = random.nextDouble() * Math.PI * 2;
      const speed = 6 + random.nextDouble();
      const angle = ((40 + random.nextDouble() * 12) * Math.PI) / 180;
      const dir = new Vec3(Math.cos(heading), Math.sin(heading), 0);
      const velocity = dir.scale(speed * Math.cos(angle)).withZ(-speed * Math.sin(angle));
      // Começa 0,35 m acima do aro, na linha que leva a bola perto do centro.
      const back = 0.35 / Math.tan(angle);
      const aim = new Vec3((random.nextDouble() - 0.5) * 0.1, (random.nextDouble() - 0.5) * 0.1, 0);
      const r = run(rim.add(aim).sub(dir.scale(back)).withZ(rim.z + 0.35), velocity, 1.0);
      expect(r.worst, `arremesso ${i}`).toBeGreaterThan(-0.012);
      expect(r.highest, `arremesso ${i}`).toBeLessThanOrEqual(r.net.ceilingZ + 1e-9);
      expect(r.rimWorst, `arremesso ${i}`).toBeGreaterThan(-0.001);
    }
  });

  test('em repouso nenhum cordão encosta dentro do tubo do aro', () => {
    const net = new NetSim(hoop);
    settle(net);
    expect(net.rimClearance(hoop)).toBeGreaterThan(-0.001);
  });
});
