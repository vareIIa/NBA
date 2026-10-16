// Porte para vitest dos 33 testes de Plugins/HoopsSim/Tests/HoopsSimTests.cpp (mesmos nomes, mesmos números).
import { describe, expect, test } from 'vitest';
import {
  BallHand,
  BallSim,
  CourtSpec,
  CoverageGrade,
  DribbleController,
  DribbleMove,
  ExitBurstKind,
  HoopSpec,
  MissType,
  ProStickRecognizer,
  ReleaseSpeed,
  Rng,
  ShotModel,
  ShotType,
  StickDir,
  type StickGesture,
  StickGestureKind,
  TimingGrade,
  Vec3,
  areOpposite,
  computeContest,
  computeGatherCarry,
  defaultBallSimConfig,
  defaultDribbleEnergyConfig,
  defaultGatherCarryTuning,
  defaultProStickConfig,
  defaultShotTuning,
  degToRad,
  dirFromVector,
  distance,
  getDribbleMoveSpec,
  makeBallState,
  makeDefenderPose,
  makeDribbleArc,
  makeDribbleContext,
  makeShotContext,
  makeShotEvaluation,
  makeShotRealizeParams,
  makeStickGesture,
  mirrorDir,
  radToDeg,
  realizeShot,
  resolveDribbleMove,
  simulateFlight,
  solveLaunch,
  type DefenderPose,
  type ShotContext,
  type ShotDecision,
  type TimingWindows,
} from './index';

/** EXPECT_NEAR do framework C++. */
const expectNear = (actual: number, expected: number, tolerance: number): void => {
  expect(Math.abs(actual - expected), `${actual} esperado ${expected} (±${tolerance})`).toBeLessThanOrEqual(tolerance);
};
/** EXPECT_RANGE do framework C++. */
const expectRange = (actual: number, min: number, max: number): void => {
  expect(actual).toBeGreaterThanOrEqual(min);
  expect(actual).toBeLessThanOrEqual(max);
};

// Cesta padrão dos testes: aro sobre a origem, tabela atrás (x negativo), quadra para +X.
const testHoop = (): HoopSpec => HoopSpec.fromRimFloorPoint(new Vec3(0, 0, 0), new Vec3(1, 0, 0));
const testSim = (): BallSim => new BallSim(defaultBallSimConfig(), testHoop());

const threeContext = (rating: number): ShotContext =>
  makeShotContext({ rating, distanceMeters: 7.3, isThree: true, type: ShotType.SpotUp });

/** Posição de soltura (altura ~2,55 m) a uma distância e ângulo em volta do aro. */
const releaseAt = (dist: number, angleDeg: number, height = 2.55): Vec3 => {
  const rad = degToRad(angleDeg);
  return new Vec3(dist * Math.cos(rad), dist * Math.sin(rad), height);
};

// ---------------------------------------------------------------- Bola e quadra

describe('Bola e quadra', () => {
  test('FloorBounceMatchesFibaRule', () => {
    // Regra FIBA: solta de 1,80 m (base da bola) deve voltar a 1,20–1,40 m (topo da bola).
    const farHoop = HoopSpec.fromRimFloorPoint(new Vec3(100, 0, 0), new Vec3(1, 0, 0));
    const sim = new BallSim(defaultBallSimConfig(), farHoop);
    const radius = sim.getConfig().ball.radius;

    const state = makeBallState(new Vec3(0, 0, 1.8 + radius));
    let bounced = false;
    let apexCenterZ = 0;
    for (let tick = 0; tick < 600; ++tick) {
      const events = sim.tick(state);
      if (events.hitFloor && !bounced) {
        bounced = true;
        continue;
      }
      if (bounced) {
        apexCenterZ = Math.max(state.position.z, apexCenterZ);
        if (state.velocity.z < 0) break;
      }
    }
    expect(bounced).toBe(true);
    expectRange(apexCenterZ + radius, 1.2, 1.4);
  });

  test('HoopGeometryIsRegulation', () => {
    const hoop = testHoop();
    const rim = hoop.rimCenter();
    expectNear(rim.x, 0, 1e-9);
    expectNear(rim.z + hoop.rimTubeRadius, 3.05, 1e-9);
    // Borda interna do aro a 0,151 m da face da tabela.
    expectNear(rim.x - hoop.rimInnerRadius - hoop.backboardFaceCenter.x, 0.151, 1e-9);
    // Borda inferior da tabela a 2,90 m.
    expectNear(hoop.backboardFaceCenter.z - hoop.backboardHeight * 0.5, 2.9, 1e-9);
  });

  test('StraightDropThroughCenterIsSwish', () => {
    const sim = testSim();
    const flight = simulateFlight(sim, makeBallState(sim.getHoop().rimCenter().add(new Vec3(0, 0, 1))));
    expect(flight.scored).toBe(true);
    expect(flight.rimHits).toBe(0);
    expect(flight.boardHits).toBe(0);
  });

  test('DropOnRimEdgeTouchesRim', () => {
    const sim = testSim();
    const hoop = sim.getHoop();
    const start = hoop.rimCenter().add(hoop.forward.scale(hoop.rimCenterlineRadius())).add(new Vec3(0, 0, 1));
    const flight = simulateFlight(sim, makeBallState(start));
    expect(flight.rimHits).toBeGreaterThan(0);
  });

  test('FastBallDoesNotTunnelThroughBackboard', () => {
    const sim = testSim();
    const hoop = sim.getHoop();
    const state = makeBallState(
      hoop.backboardFaceCenter.add(hoop.forward.scale(1)).add(new Vec3(0, 0.3, 0.2)),
      hoop.forward.scale(-25), // 25 m/s contra a tabela
    );
    let hitBoard = false;
    let minAlong = 1e9;
    for (let tick = 0; tick < 60; ++tick) {
      const events = sim.tick(state);
      hitBoard = hitBoard || events.hitBackboard;
      minAlong = Math.min(minAlong, state.position.sub(hoop.backboardFaceCenter).dot(hoop.forward));
    }
    expect(hitBoard).toBe(true);
    // O centro nunca passa para trás da face (fica no máximo a ~1 raio de penetração antes da correção).
    expect(minAlong).toBeGreaterThan(0);
    expect(state.velocity.dot(hoop.forward)).toBeGreaterThan(0);
  });

  test('ThreePointLineClassification', () => {
    const court = new CourtSpec();
    const rim = new Vec3(0, 0, 0);
    const fwd = new Vec3(1, 0, 0);
    expect(court.isThreePointer(new Vec3(7.3, 0, 0), rim, fwd)).toBe(true); // topo, atrás da linha
    expect(court.isThreePointer(new Vec3(7.0, 0, 0), rim, fwd)).toBe(false); // topo, dentro
    expect(court.isThreePointer(new Vec3(0.5, 6.8, 0), rim, fwd)).toBe(true); // canto, atrás da linha (6,71)
    expect(court.isThreePointer(new Vec3(0.5, 6.6, 0), rim, fwd)).toBe(false); // canto, dentro
  });
});

// ---------------------------------------------------------------- Modelo de arremesso

describe('Modelo de arremesso', () => {
  test('ShotProbabilityMatchesDesignTable', () => {
    const model = new ShotModel();
    const context = threeContext(85);
    const windows = model.computeWindows(context);
    const ideal = windows.idealReleaseMs;

    // Valores do exemplo numérico em docs/03-arremessos.md §3.2.
    const good = model.evaluate(context, windows, ideal + windows.perfectHalfMs + 5, 0);
    expect(good.timing).toBe(TimingGrade.Good);
    expectNear(good.probability, 0.42, 0.005);

    const greenOpen = model.evaluate(context, windows, ideal, 0.05);
    expect(greenOpen.timing).toBe(TimingGrade.Green);
    expect(greenOpen.guaranteed).toBe(true);
    expectNear(greenOpen.probability, 1, 1e-9);

    const greenContested = model.evaluate(context, windows, ideal, 0.8);
    expect(greenContested.guaranteed).toBe(false);
    expectNear(greenContested.probability, 0.677, 0.01);

    const goodSmothered = model.evaluate(context, windows, ideal + windows.perfectHalfMs + 5, 1);
    expectNear(goodSmothered.probability, 0.107, 0.005);

    const slightLate = model.evaluate(context, windows, ideal + windows.goodHalfMs + 5, 0);
    expect(slightLate.timing).toBe(TimingGrade.SlightlyLate);
    expectNear(slightLate.probability, 0.35, 0.01);

    const veryEarly = model.evaluate(context, windows, ideal - windows.slightHalfMs - 10, 0);
    expect(veryEarly.timing).toBe(TimingGrade.VeryEarly);
    expectNear(veryEarly.probability, 0.139, 0.01);
  });

  test('TimingWindowScalesAndFloor', () => {
    const model = new ShotModel();
    expectNear(ShotModel.basePerfectHalfWindowMs(85), 50, 1e-9);
    expectNear(ShotModel.basePerfectHalfWindowMs(99), 70, 1e-9);
    expectNear(ShotModel.basePerfectHalfWindowMs(50), 30, 1e-9);

    const heave = { ...threeContext(40), type: ShotType.Heave };
    expectNear(model.computeWindows(heave).perfectHalfMs, 25, 1e-9); // piso de 3 frames

    expectNear(model.computeWindows({ ...threeContext(85), meterOff: true }).perfectHalfMs, 55, 1e-9);
    expectNear(model.computeWindows({ ...threeContext(85), fatigue: 1 }).perfectHalfMs, 35, 1e-9);

    const quick = model.computeWindows({ ...threeContext(85), speed: ReleaseSpeed.Quick });
    expectNear(quick.perfectHalfMs, 42.5, 1e-9);

    const wide = new ShotModel(defaultShotTuning({ perfectWindowScale: 1.5 }));
    expectNear(wide.computeWindows(threeContext(85)).perfectHalfMs, 75, 1e-9);
    expect(quick.idealReleaseMs).toBeLessThan(model.computeWindows(threeContext(85)).idealReleaseMs);
  });

  test('TimingGradeBoundaries', () => {
    const model = new ShotModel();
    const windows: TimingWindows = { idealReleaseMs: 560, perfectHalfMs: 30, goodHalfMs: 69, slightHalfMs: 120 };
    expect(model.gradeTiming(0, windows)).toBe(TimingGrade.Green);
    expect(model.gradeTiming(-30, windows)).toBe(TimingGrade.Green);
    expect(model.gradeTiming(31, windows)).toBe(TimingGrade.Good);
    expect(model.gradeTiming(-90, windows)).toBe(TimingGrade.SlightlyEarly);
    expect(model.gradeTiming(90, windows)).toBe(TimingGrade.SlightlyLate);
    expect(model.gradeTiming(-121, windows)).toBe(TimingGrade.VeryEarly);
    expect(model.gradeTiming(200, windows)).toBe(TimingGrade.VeryLate);
  });

  test('DecisionRateMatchesProbability', () => {
    const model = new ShotModel();
    const context = threeContext(85);
    const windows = model.computeWindows(context);
    const evaluation = model.evaluate(context, windows, windows.idealReleaseMs + 50, 0);

    const random = new Rng(12345);
    let makes = 0;
    const trials = 20000;
    for (let index = 0; index < trials; ++index) {
      makes += model.decide(evaluation, random).make ? 1 : 0;
    }
    expectNear(makes / trials, evaluation.probability, 0.015);
  });

  test('EarlyMissesTendShortLateMissesTendLong', () => {
    const model = new ShotModel();
    const early = makeShotEvaluation({ timing: TimingGrade.VeryEarly, probability: 0 });
    const late = makeShotEvaluation({ timing: TimingGrade.VeryLate, probability: 0 });

    const random = new Rng(7);
    let short = 0;
    let long = 0;
    for (let index = 0; index < 2000; ++index) {
      short += model.decide(early, random).miss === MissType.Short ? 1 : 0;
      long += model.decide(late, random).miss === MissType.Long ? 1 : 0;
    }
    expectRange(short / 2000, 0.62, 0.78);
    expectRange(long / 2000, 0.62, 0.78);
  });
});

// ---------------------------------------------------------------- Física realiza a decisão

describe('Física realiza a decisão', () => {
  test('GreenOpenAlwaysGoesInPhysically', () => {
    const sim = testSim();
    const random = new Rng(2026);
    const make: ShotDecision = { make: true, miss: MissType.None };

    let failures = 0;
    let total = 0;
    for (let dist = 2.0; dist <= 8.5; dist += 0.5) {
      for (let angle = -80; angle <= 80; angle += 20) {
        const params = makeShotRealizeParams({
          releasePosition: releaseAt(dist, angle),
          launchAngleDeg: dist < 4 ? 55 : 50,
        });
        const shot = realizeShot(sim, make, params, random);
        ++total;
        failures += shot.scored ? 0 : 1;
      }
    }
    console.log(`    green livre: ${total - failures}/${total} cestas na simulação`);
    expect(failures).toBe(0);
  });

  test('RealizedOutcomeMatchesDecision', () => {
    const sim = testSim();
    const random = new Rng(99);

    const misses = [MissType.Short, MissType.Long, MissType.Left, MissType.Right, MissType.Airball];
    let matches = 0;
    let missesThatScored = 0;
    let rimOrBoardOnMiss = 0;
    let nonAirballMisses = 0;
    let totalAttempts = 0;
    const trials = 600;
    for (let index = 0; index < trials; ++index) {
      const dist = random.range(2.0, 8.5);
      const angle = random.range(-85, 85);
      const make = random.chance(0.45);
      const decision: ShotDecision = {
        make,
        miss: make ? MissType.None : misses[Math.trunc(random.nextDouble() * 5) % 5],
      };

      const params = makeShotRealizeParams({ releasePosition: releaseAt(dist, angle, random.range(2.3, 2.8)) });
      params.launchAngleDeg = dist < 4 ? 55 : random.range(46, 54);
      const shot = realizeShot(sim, decision, params, random);

      matches += shot.matchesDecision ? 1 : 0;
      totalAttempts += shot.attempts;
      if (!decision.make) {
        missesThatScored += shot.scored ? 1 : 0;
        if (decision.miss !== MissType.Airball) {
          ++nonAirballMisses;
          rimOrBoardOnMiss += shot.flight.rimHits + shot.flight.boardHits > 0 ? 1 : 0;
        }
      }
    }
    console.log(
      `    decisão realizada: ${matches}/${trials} (${((100 * matches) / trials).toFixed(1)}%), ` +
        `tentativas médias ${(totalAttempts / trials).toFixed(2)}, erros que tocaram aro/tabela ${rimOrBoardOnMiss}/${nonAirballMisses}`,
    );
    expect(matches).toBeGreaterThanOrEqual(Math.trunc((trials * 99) / 100));
    expect(missesThatScored).toBe(0);
    // Erros "de aro" devem parecer erros de aro na maioria das vezes.
    expect(rimOrBoardOnMiss).toBeGreaterThanOrEqual(Math.trunc((nonAirballMisses * 80) / 100));
  });

  test('MakeEntryAngleIsRealistic', () => {
    const sim = testSim();
    const state = makeBallState(releaseAt(7.3, 0, 2.55));
    const target = sim.getHoop().rimCenter().add(new Vec3(-0.03, 0, 0));
    const launch = solveLaunch(state.position, target, degToRad(50));
    expect(launch.valid).toBe(true);
    state.velocity = launch.velocity;

    const planeZ = sim.getHoop().rimPlaneZ();
    let entryDeg = 0;
    for (let tick = 0; tick < 500; ++tick) {
      const prevZ = state.position.z;
      sim.tick(state);
      if (prevZ >= planeZ && state.position.z < planeZ) {
        entryDeg = radToDeg(Math.atan2(-state.velocity.z, state.velocity.length2D()));
        break;
      }
    }
    console.log(`    ângulo de entrada de um 3PT lançado a 50°: ${entryDeg.toFixed(1)}°`);
    expectRange(entryDeg, 42, 50);
  });

  test('RealizationIsDeterministic', () => {
    const sim = testSim();
    const decision: ShotDecision = { make: false, miss: MissType.Long };
    const params = makeShotRealizeParams({ releasePosition: releaseAt(6, 30) });

    const randomA = new Rng(555);
    const randomB = new Rng(555);
    const a = realizeShot(sim, decision, params, randomA);
    const b = realizeShot(sim, decision, params, randomB);
    expect(a.initial.velocity.x).toBe(b.initial.velocity.x);
    expect(a.initial.velocity.y).toBe(b.initial.velocity.y);
    expect(a.initial.velocity.z).toBe(b.initial.velocity.z);
    expect(a.flight.ticks).toBe(b.flight.ticks);
    expect(randomA.getState()).toBe(randomB.getState());
  });
});

// ---------------------------------------------------------------- Drible

describe('Drible', () => {
  test('DribbleArcHitsHandAndFloorExactly', () => {
    const rightHand = new Vec3(0, -0.3, 0.85);
    const leftHand = new Vec3(0, 0.3, 0.85);
    const arc = makeDribbleArc(rightHand, leftHand, new Vec3(3, 0, 0), 0.45, 0.119);

    const start = arc.evaluate(0);
    const floor = arc.evaluate(arc.downSeconds);
    const end = arc.evaluate(arc.totalSeconds());
    expectNear(distance(start, rightHand), 0, 1e-9);
    expectNear(floor.z, 0.119, 1e-9);
    expectNear(distance(end, leftHand), 0, 1e-9);

    // Contínuo e nunca abaixo do chão.
    let minZ = 10;
    let prev = start;
    let maxStep = 0;
    for (let step = 1; step <= 200; ++step) {
      const pos = arc.evaluate((arc.totalSeconds() * step) / 200);
      minZ = Math.min(minZ, pos.z);
      maxStep = Math.max(maxStep, distance(pos, prev));
      prev = pos;
    }
    expect(minZ).toBeGreaterThanOrEqual(0.119 - 1e-9);
    expect(maxStep).toBeLessThan(0.05);
    // Quique plausível: sai do chão com velocidade menor ou parecida com a de chegada.
    expectRange(arc.floorExitSpeed() / arc.floorEntrySpeed(), 0.6, 1.0);
  });
});

// ---------------------------------------------------------------- Pro Stick e dribles

/** Alimenta o reconhecedor com uma sequência (x, y) a 60 Hz e guarda todos os gestos. */
class StickFeed {
  constructor(readonly recognizer = new ProStickRecognizer()) {}
  time = 0;
  readonly all: StickGesture[] = [];

  sample(x: number, y: number, frames = 1): void {
    for (let frame = 0; frame < frames; ++frame) {
      for (const gesture of this.recognizer.update(this.time, x, y)) {
        if (this.all.length < 64) this.all.push(gesture);
      }
      this.time += 1 / 60;
    }
  }

  flick(x: number, y: number): void {
    this.sample(x, y, 4); // ~67 ms fora do centro
    this.sample(0, 0, 1);
  }

  rotate(startDeg: number, sweepDeg: number, frames: number): void {
    for (let frame = 0; frame <= frames; ++frame) {
      const deg = startDeg + (sweepDeg * frame) / frames;
      this.sample(Math.cos(degToRad(deg)), Math.sin(degToRad(deg)), 1);
    }
    this.sample(0, 0, 1);
  }

  has(kind: StickGestureKind, dir: StickDir): boolean {
    return this.all.some((g) => g.kind === kind && g.dir === dir);
  }

  hasKind(kind: StickGestureKind): boolean {
    return this.all.some((g) => g.kind === kind);
  }
}

describe('Pro Stick e dribles', () => {
  test('StickDirectionsAndMirror', () => {
    expect(dirFromVector(0, 1)).toBe(StickDir.Up);
    expect(dirFromVector(1, 0)).toBe(StickDir.Right);
    expect(dirFromVector(-0.7, -0.7)).toBe(StickDir.DownLeft);
    expect(dirFromVector(-1, 0)).toBe(StickDir.Left);
    expect(mirrorDir(StickDir.UpRight)).toBe(StickDir.UpLeft);
    expect(mirrorDir(StickDir.Down)).toBe(StickDir.Down);
    expect(areOpposite(StickDir.Left, StickDir.Right)).toBe(true);
    expect(areOpposite(StickDir.Up, StickDir.UpRight)).toBe(false);
  });

  test('StickFlickHoldRotationRecognized', () => {
    const feed = new StickFeed();
    feed.flick(0, 1);
    expect(feed.has(StickGestureKind.Flick, StickDir.Up)).toBe(true);

    const holdFeed = new StickFeed();
    holdFeed.sample(0, -1, 20); // ~330 ms segurando para baixo
    expect(holdFeed.has(StickGestureKind.Hold, StickDir.Down)).toBe(true);
    expect(holdFeed.recognizer.isHolding()).toBe(true);
    holdFeed.sample(0, 0, 1);
    expect(holdFeed.has(StickGestureKind.HoldRelease, StickDir.Down)).toBe(true);
    expect(holdFeed.hasKind(StickGestureKind.Flick)).toBe(false); // soltar um hold não vira flick

    const spinFeed = new StickFeed();
    spinFeed.rotate(0, -300, 18); // giro horário
    expect(spinFeed.hasKind(StickGestureKind.Rotation)).toBe(true);

    const halfFeed = new StickFeed();
    halfFeed.rotate(0, 100, 8);
    expect(halfFeed.hasKind(StickGestureKind.QuarterCircle)).toBe(true);
  });

  test('StickDoubleThrowAndSwitchback', () => {
    const double = new StickFeed();
    double.flick(1, 0);
    double.sample(0, 0, 3);
    double.flick(1, 0);
    expect(double.has(StickGestureKind.DoubleThrow, StickDir.Right)).toBe(true);

    const sw = new StickFeed();
    sw.flick(1, 0);
    sw.sample(0, 0, 3);
    sw.flick(-1, 0);
    expect(sw.has(StickGestureKind.Switchback, StickDir.Left)).toBe(true);

    const slow = new StickFeed();
    slow.flick(1, 0);
    slow.sample(0, 0, 30); // 500 ms depois: não é combo
    slow.flick(1, 0);
    expect(slow.hasKind(StickGestureKind.DoubleThrow)).toBe(false);
  });

  test('StickEarlyFlickOnTheEdge', () => {
    // Flick na borda: sai ~33 ms depois de o stick chegar à zona ativa, ainda fora do centro, e não sai de novo na volta.
    const feed = new StickFeed();
    feed.sample(0, 1, 3);
    expect(feed.all.filter((g) => g.kind === StickGestureKind.Flick).length).toBe(1);
    expect(feed.has(StickGestureKind.Flick, StickDir.Up)).toBe(true);
    feed.sample(0, 0, 1);
    expect(feed.all.filter((g) => g.kind === StickGestureKind.Flick).length).toBe(1);

    // Segurado (não para baixo): o drible sai na borda uma vez; o Hold continua sendo emitido para quem o usa.
    const held = new StickFeed();
    held.sample(1, 0, 20);
    held.sample(0, 0, 1);
    expect(held.all.filter((g) => g.kind === StickGestureKind.Flick).length).toBe(1);
    expect(held.has(StickGestureKind.Hold, StickDir.Right)).toBe(true);

    // Para baixo espera a volta ao centro (segurar para baixo = arremesso pelo Pro Stick, docs/02 §1).
    const down = new StickFeed();
    down.sample(0, -1, 3);
    expect(down.hasKind(StickGestureKind.Flick)).toBe(false);
    down.sample(0, 0, 1);
    expect(down.has(StickGestureKind.Flick, StickDir.Down)).toBe(true);

    // Giro rápido não dispara o flick na borda; giro lento que parou na borda sai marcado (afterEarlyFlick).
    const spin = new StickFeed();
    spin.rotate(0, -300, 18);
    expect(spin.hasKind(StickGestureKind.Flick)).toBe(false);
    const pause = new StickFeed();
    pause.sample(1, 0, 3);
    pause.rotate(0, 300, 18);
    const rotation = pause.all.find((g) => g.kind === StickGestureKind.Rotation);
    expect(rotation?.afterEarlyFlick).toBe(true);
    expect(pause.has(StickGestureKind.Flick, StickDir.Right)).toBe(true);

    // Giro completo sai no meio do gesto (passou de 230°), uma vez só.
    const midSpin = new StickFeed();
    midSpin.rotate(0, -300, 18);
    const rotations = midSpin.all.filter((g) => g.kind === StickGestureKind.Rotation);
    expect(rotations.length).toBe(1);
    expect(rotations[0].time).toBeLessThan(midSpin.time - 3 / 60);

    // Desligado: volta a ser lido só na volta ao centro.
    const legacy = new StickFeed(new ProStickRecognizer({ ...defaultProStickConfig(), earlyFlick: false }));
    legacy.sample(0, 1, 3);
    expect(legacy.hasKind(StickGestureKind.Flick)).toBe(false);
    legacy.sample(0, 0, 1);
    expect(legacy.has(StickGestureKind.Flick, StickDir.Up)).toBe(true);
  });

  test('RotationAfterEarlyFlickNeverMakesTwoMoves', () => {
    const context = makeDribbleContext();
    const rotation = (time: number, startTime: number) =>
      makeStickGesture({ kind: StickGestureKind.Rotation, time, startTime, afterEarlyFlick: true });

    // O crossover do flick na borda começou em 0,03; o giro chega antes do 1º quique: troca pelo spin.
    const early = new DribbleController();
    early.request(DribbleMove.Crossover, 0.03);
    const swap = early.resolveGesture(rotation(0.1, 0), context, 0.1);
    expect(swap.move).toBe(DribbleMove.Spin);
    expect(swap.redirect).toBe(true);

    // Chega depois do quique: descartado (o toque já virou o crossover).
    const late = new DribbleController();
    late.request(DribbleMove.Crossover, 0.03);
    expect(late.resolveGesture(rotation(0.3, 0), context, 0.3).move).toBe(DribbleMove.None);

    // O drible ativo é de um toque anterior: o giro é um comando novo, como sempre.
    const older = new DribbleController();
    older.request(DribbleMove.Crossover, 0);
    expect(older.resolveGesture(rotation(0.3, 0.1), context, 0.3).move).toBe(DribbleMove.Spin);
  });

  test('GesturesMapToTwoKMoves', () => {
    const right = makeDribbleContext({ hand: BallHand.Right });
    const left = makeDribbleContext({ hand: BallHand.Left });
    const sprint = makeDribbleContext({ hand: BallHand.Right, sprint: true });
    const flick = (dir: StickDir): StickGesture => makeStickGesture({ kind: StickGestureKind.Flick, dir });

    expect(resolveDribbleMove(flick(StickDir.Up), right)).toBe(DribbleMove.Crossover);
    expect(resolveDribbleMove(flick(StickDir.Up), sprint)).toBe(DribbleMove.AttackingCrossover);
    expect(resolveDribbleMove(flick(StickDir.Left), right)).toBe(DribbleMove.BetweenLegs); // mão livre (bola na direita)
    expect(resolveDribbleMove(flick(StickDir.Right), right)).toBe(DribbleMove.Hesitation); // mão da bola (bola na direita)
    expect(resolveDribbleMove(flick(StickDir.Right), left)).toBe(DribbleMove.BetweenLegs); // com a esquerda, direita = mão livre
    expect(resolveDribbleMove(flick(StickDir.DownLeft), right)).toBe(DribbleMove.BehindBack);
    expect(resolveDribbleMove(flick(StickDir.Down), right)).toBe(DribbleMove.StepBack);

    expect(resolveDribbleMove(makeStickGesture({ kind: StickGestureKind.Rotation }), right)).toBe(DribbleMove.Spin);
    // Hold baixo = arremesso.
    const hold = makeStickGesture({ kind: StickGestureKind.Hold, dir: StickDir.Down });
    expect(resolveDribbleMove(hold, right)).toBe(DribbleMove.None);
  });

  test('DribbleControllerCommitBufferAndRhythm', () => {
    const controller = new DribbleController();
    expect(controller.request(DribbleMove.Crossover, 0)).toBe(true);
    expect(controller.getHand()).toBe(BallHand.Left); // crossover troca a mão
    expect(controller.canCancel(0.05)).toBe(false); // dentro do commit (0,12 s)

    // Pedido durante o commit vai para o buffer e sai assim que o commit acaba.
    expect(controller.request(DribbleMove.BehindBack, 0.05)).toBe(false);
    controller.update(0.1, 0.05, false);
    expect(controller.getActive().move).toBe(DribbleMove.Crossover);
    controller.update(0.13, 0.03, false);
    expect(controller.getActive().move).toBe(DribbleMove.BehindBack);
    expect(controller.getHand()).toBe(BallHand.Right);

    // Input na janela de combo do fim = ritmo (mais rápido, conta combo).
    const end = controller.getActive().endTime();
    expect(controller.request(DribbleMove.Crossover, end - 0.05)).toBe(true);
    expect(controller.getActive().inRhythm).toBe(true);
    expectNear(controller.getActive().playRate, 1.15, 1e-9);
    expect(controller.getComboCount()).toBeGreaterThanOrEqual(2);

    // Buffer expira depois de 150 ms.
    const late = new DribbleController();
    late.request(DribbleMove.Spin, 0);
    late.request(DribbleMove.Crossover, 0.01);
    late.update(0.2, 0.2, false); // 190 ms depois do pedido; commit do spin acabou em 0,25
    late.update(0.26, 0.06, false);
    expect(late.getActive().move).toBe(DribbleMove.Spin);
  });

  test('EnergyIsTheOnlyLimiter', () => {
    // Sem Explosões (decisão D13): sprint e dribles gastam energia; energia baixa deixa mais lento.
    const controller = new DribbleController();
    expectNear(controller.getEnergy(), 1, 1e-9);
    expectNear(controller.speedScale(), 1, 1e-9);

    controller.update(5, 5, true, true); // 5 s de sprint
    expectNear(controller.getEnergy(), 0.6, 1e-6);

    const beforeMove = controller.getEnergy();
    expect(controller.request(DribbleMove.Spin, 6)).toBe(true);
    expect(controller.getEnergy()).toBeLessThan(beforeMove);

    controller.setEnergy(0.1);
    expect(controller.speedScale()).toBeLessThan(0.9);
    expect(controller.movePlayRateScale()).toBeLessThan(0.95);

    // Parado recupera mais rápido que andando.
    const standing = new DribbleController();
    standing.setEnergy(0.2);
    standing.update(10, 2, false, false);
    const walking = new DribbleController();
    walking.setEnergy(0.2);
    walking.update(10, 2, false, true);
    expect(standing.getEnergy()).toBeGreaterThan(walking.getEnergy());
    expect(walking.getEnergy()).toBeGreaterThan(0.2);

    const infinite = new DribbleController(defaultDribbleEnergyConfig({ infiniteEnergy: true }));
    infinite.update(5, 5, true, true);
    infinite.request(DribbleMove.Spin, 5.5);
    expectNear(infinite.getEnergy(), 1, 1e-9);
  });

  test('MisdirectionWindowAcceptsAndRejects', () => {
    // Misdirection (docs/17 §4.4): até o 1º quique (fim do commit), um gesto para o lado oposto troca o movimento.
    const controller = new DribbleController();
    const context = makeDribbleContext(); // a mão vem do controlador
    const flick = (dir: StickDir): StickGesture => makeStickGesture({ kind: StickGestureKind.Flick, dir });

    expect(controller.request(DribbleMove.Crossover, 0)).toBe(true); // bola da direita para a esquerda
    expect(controller.canRedirect(0.05)).toBe(true);
    expect(controller.canRedirect(0.119)).toBe(true);
    expect(controller.canRedirect(0.12)).toBe(false); // janela = commit do crossover (0,12 s)

    // Direita (de volta para a mão do início) antes do quique: lido a partir da mão direita = hesitação, troca.
    let intent = controller.resolveGesture(flick(StickDir.Right), context, 0.05);
    expect(intent.redirect).toBe(true);
    expect(intent.move).toBe(DribbleMove.Hesitation);

    // O mesmo gesto depois do quique: lido na mão atual (esquerda) = entre as pernas, sem troca.
    intent = controller.resolveGesture(flick(StickDir.Right), context, 0.13);
    expect(intent.redirect).toBe(false);
    expect(intent.move).toBe(DribbleMove.BetweenLegs);

    // Para o mesmo lado (esquerda, para onde a bola já vai) não é misdirection: lido na mão atual = hesitação com a
    // esquerda, e vai para o buffer de 150 ms como antes.
    intent = controller.resolveGesture(flick(StickDir.Left), context, 0.05);
    expect(intent.redirect).toBe(false);
    expect(intent.move).toBe(DribbleMove.Hesitation);
    expect(controller.request(intent.move, 0.05, intent.redirect)).toBe(false);
    expect(controller.getActive().move).toBe(DribbleMove.Crossover);
    controller.update(0.13, 0.08, false);
    expect(controller.getActive().move).toBe(DribbleMove.Hesitation);
    expect(controller.getHand()).toBe(BallHand.Left);

    // Pedido de troca que chega com a janela já fechada não troca (segue o caminho normal).
    const closed = new DribbleController();
    closed.request(DribbleMove.Crossover, 0);
    expect(closed.request(DribbleMove.Hesitation, 0.2, true)).toBe(true); // depois do commit: encadeia
    expect(closed.getActive().redirected).toBe(false);
    expect(closed.getHand()).toBe(BallHand.Left);

    // Variante mais nova: só com RT segurado.
    const strict = new DribbleController(defaultDribbleEnergyConfig({ misdirectionNeedsSprint: true }));
    strict.request(DribbleMove.Crossover, 0);
    expect(strict.resolveGesture(flick(StickDir.Right), context, 0.05).redirect).toBe(false);
    const sprint = makeDribbleContext({ sprint: true });
    intent = strict.resolveGesture(flick(StickDir.Right), sprint, 0.05);
    expect(intent.redirect).toBe(true);
    expect(intent.move).toBe(DribbleMove.EscapeHesitation);

    // Uma misdirection por movimento: a troca não pode ser trocada de novo (o resto vai para o buffer).
    expect(strict.request(intent.move, 0.05, intent.redirect)).toBe(true);
    expect(strict.canRedirect(0.06)).toBe(false);
    expect(strict.resolveGesture(flick(StickDir.Left), sprint, 0.06).redirect).toBe(false);

    // Sem movimento ativo não há o que trocar.
    const idle = new DribbleController();
    expect(idle.canRedirect(0)).toBe(false);
    expect(idle.resolveGesture(flick(StickDir.Left), context, 0).redirect).toBe(false);
  });

  test('MisdirectionReplacesMoveBeforeBounce', () => {
    const controller = new DribbleController();
    const context = makeDribbleContext();
    expect(controller.request(DribbleMove.Crossover, 0)).toBe(true);
    const afterCross = controller.getEnergy();
    expect(controller.request(DribbleMove.BehindBack, 0.02)).toBe(false); // vai para o buffer

    // Fingiu o crossover e voltou para a direita antes do quique: troca na hora, sem esperar o commit nem o fim.
    const flick = makeStickGesture({ kind: StickGestureKind.Flick, dir: StickDir.Right });
    const intent = controller.resolveGesture(flick, context, 0.06);
    expect(controller.request(intent.move, 0.06, intent.redirect)).toBe(true);
    const active = controller.getActive();
    expect(active.move).toBe(DribbleMove.Hesitation);
    expect(active.redirected).toBe(true);
    expect(active.redirectedFrom).toBe(DribbleMove.Crossover);
    expectNear(active.startTime, 0.06, 1e-9);
    expect(active.handAtStart).toBe(BallHand.Right);
    expect(controller.getHand()).toBe(BallHand.Right); // a bola nem chegou a trocar de mão
    expect(controller.getComboCount()).toBe(1); // troca, não encadeamento
    expect(controller.getLastMove()).toBe(DribbleMove.None); // o crossover não "terminou"
    // Paga os dois movimentos (o fingido e o real).
    expectNear(controller.getEnergy(), afterCross - getDribbleMoveSpec(DribbleMove.Hesitation).energyCost, 1e-9);

    // O buffer antigo (por trás) foi descartado: a troca é o input mais novo.
    controller.update(0.2, 0.14, false);
    expect(controller.getActive().move).toBe(DribbleMove.Hesitation);
    controller.update(0.47, 0.27, false); // hesitação acaba em 0,46
    expect(controller.isMoveActive(0.47)).toBe(false);
    expect(controller.getLastMove()).toBe(DribbleMove.Hesitation);

    // A troca herda o ritmo do movimento trocado (combo no ritmo continua no ritmo, sem contar duas vezes).
    const rhythm = new DribbleController();
    rhythm.request(DribbleMove.Hesitation, 0);
    const end = rhythm.getActive().endTime();
    expect(rhythm.request(DribbleMove.Crossover, end - 0.05)).toBe(true);
    expect(rhythm.getActive().inRhythm).toBe(true);
    const combo = rhythm.getComboCount();
    const fake = rhythm.resolveGesture(flick, context, end - 0.02);
    expect(fake.redirect).toBe(true);
    expect(rhythm.request(fake.move, end - 0.02, fake.redirect)).toBe(true);
    expect(rhythm.getActive().move).toBe(DribbleMove.Hesitation);
    expect(rhythm.getActive().inRhythm).toBe(true);
    expectNear(rhythm.getActive().playRate, 1.15, 1e-9);
    expect(rhythm.getComboCount()).toBe(combo);

    // Double throw: o 2º toque chega junto com o combo, e o combo substitui o crossover do 1º toque.
    const double = new DribbleController();
    const up = makeStickGesture({ kind: StickGestureKind.Flick, dir: StickDir.Up });
    const first = double.resolveGesture(up, context, 0);
    expect(double.request(first.move, 0, first.redirect)).toBe(true); // crossover (direita → esquerda)
    const second = double.resolveGesture(up, context, 0.1);
    expect(second.redirect).toBe(false);
    expect(double.request(second.move, 0.1, second.redirect)).toBe(false); // 2º crossover vai para o buffer
    const thrown = makeStickGesture({ kind: StickGestureKind.DoubleThrow, dir: StickDir.Up, firstDir: StickDir.Up });
    const comboIntent = double.resolveGesture(thrown, context, 0.1);
    expect(comboIntent.redirect).toBe(true);
    expect(comboIntent.move).toBe(DribbleMove.DoubleCross);
    expect(double.request(comboIntent.move, 0.1, comboIntent.redirect)).toBe(true);
    expect(double.getHand()).toBe(BallHand.Right); // direita → esquerda → direita
    double.update(0.3, 0.2, false);
    expect(double.getActive().move).toBe(DribbleMove.DoubleCross); // o crossover do buffer foi descartado
  });

  test('ExitBurstDirectionStrengthAndCost', () => {
    // Arranque na saída (docs/17 §4.4): LS apontado quando o movimento acaba = velocidade extra nessa direção.
    const defaults = defaultDribbleEnergyConfig();
    const crossBurst = getDribbleMoveSpec(DribbleMove.Crossover).exitBurst;
    const controller = new DribbleController();
    expect(controller.request(DribbleMove.Crossover, 0)).toBe(true); // direita → esquerda, acaba em 0,40
    expect(controller.tryExitBurst(0.2, -1, 0).isValid()).toBe(false); // durante o movimento, não
    controller.update(0.41, 0.41, false);
    const before = controller.getEnergy();

    // LS para a esquerda (lado da nova mão) = cross launch cheio, pago com energia.
    const launch = controller.tryExitBurst(0.41, -1, 0);
    expect(launch.isValid()).toBe(true);
    expect(launch.kind).toBe(ExitBurstKind.CrossLaunch);
    expect(launch.fromMove).toBe(DribbleMove.Crossover);
    expectNear(launch.dirX, -1, 1e-9);
    expectNear(launch.dirY, 0, 1e-9);
    expectNear(launch.speed, crossBurst, 1e-9);
    expect(launch.energyCost).toBeGreaterThan(0);
    expectNear(controller.getEnergy(), before - crossBurst * defaults.exitBurstEnergyPerMps, 1e-9);
    expect(controller.tryExitBurst(0.42, -1, 0).isValid()).toBe(false); // um arranque por saída

    // Perfil: cheio no 1º passo (0,15 s), depois cai até zero em 0,30 s.
    expectNear(controller.exitBurstSpeed(0.51), crossBurst, 1e-9);
    expectNear(controller.exitBurstSpeed(0.71), crossBurst * 0.5, 1e-6);
    expectNear(controller.exitBurstSpeed(0.87), 0, 1e-9);

    // Sair contra o movimento (de volta para a direita depois do crossover, ou para trás) vale metade.
    const against = new DribbleController();
    against.request(DribbleMove.Crossover, 0);
    against.update(0.41, 0.41, false);
    const back = against.tryExitBurst(0.41, 1, 0);
    expect(back.kind).toBe(ExitBurstKind.AgainstMove);
    expectNear(back.speed, defaults.againstMoveBurstScale * crossBurst, 1e-9);

    // Speedboost: escape de hesitação (sem troca de mão) e LS para frente na diagonal do lado da bola.
    const escape = new DribbleController();
    escape.request(DribbleMove.EscapeHesitation, 0);
    escape.update(0.5, 0.5, false);
    const boost = escape.tryExitBurst(0.5, 0.6, 0.8);
    expect(boost.kind).toBe(ExitBurstKind.Speedboost);
    expectNear(boost.dirX, 0.6, 1e-9);
    expectNear(boost.dirY, 0.8, 1e-9);
    expectNear(boost.speed, getDribbleMoveSpec(DribbleMove.EscapeHesitation).exitBurst, 1e-9);

    // Tipo de movimento: crossovers e escapes lançam mais.
    expect(getDribbleMoveSpec(DribbleMove.AttackingCrossover).exitBurst).toBeGreaterThan(crossBurst);
    expect(crossBurst).toBeGreaterThan(getDribbleMoveSpec(DribbleMove.BetweenLegs).exitBurst);
    expect(getDribbleMoveSpec(DribbleMove.EscapeHesitation).exitBurst).toBeGreaterThan(
      getDribbleMoveSpec(DribbleMove.Hesitation).exitBurst,
    );
    expect(crossBurst).toBeGreaterThan(getDribbleMoveSpec(DribbleMove.StepBack).exitBurst);

    // Janela: LS fraco não dispara (a janela continua aberta); 0,25 s depois do fim já não vale.
    const late = new DribbleController();
    late.request(DribbleMove.Crossover, 0);
    late.update(0.41, 0.41, false);
    expect(late.tryExitBurst(0.45, -0.3, 0).isValid()).toBe(false);
    expect(late.tryExitBurst(0.55, -0.8, 0.3).isValid()).toBe(true);
    const tooLate = new DribbleController();
    tooLate.request(DribbleMove.Crossover, 0);
    tooLate.update(0.41, 0.41, false);
    expect(tooLate.tryExitBurst(0.65, -1, 0).isValid()).toBe(false);

    // Encadear outro drible fecha a saída: o arranque é do último movimento da sequência.
    const chain = new DribbleController();
    chain.request(DribbleMove.Crossover, 0);
    chain.update(0.41, 0.41, false);
    expect(chain.request(DribbleMove.BehindBack, 0.45)).toBe(true);
    chain.update(0.5, 0.05, false);
    expect(chain.tryExitBurst(0.5, 1, 0).isValid()).toBe(false);
    chain.update(0.91, 0.41, false); // por trás acaba em 0,90 com a bola na direita
    const afterChain = chain.tryExitBurst(0.91, 1, 0);
    expect(afterChain.fromMove).toBe(DribbleMove.BehindBack);
    expect(afterChain.kind).toBe(ExitBurstKind.CrossLaunch);
  });

  test('ExitBurstOnlyLimitedByEnergy', () => {
    // D13: não existe contador de boosts. Energia baixa (< 40%) reduz o arranque; encher a barra devolve tudo.
    const full = getDribbleMoveSpec(DribbleMove.Crossover).exitBurst;
    const burstAt = (energy: number) => {
      const controller = new DribbleController();
      controller.request(DribbleMove.Crossover, 0);
      controller.update(0.41, 0.41, false);
      controller.setEnergy(energy);
      return controller.tryExitBurst(0.41, -1, 0);
    };
    expectNear(burstAt(0.8).speed, full, 1e-9);
    expectNear(burstAt(0.4).speed, full, 1e-9);
    expectNear(burstAt(0.2).speed, full * 0.7, 1e-9); // metade do caminho entre 40% e 100% do arranque
    expectNear(burstAt(0.0).speed, full * 0.4, 1e-9); // barra vazia: ainda sai, mas fraco

    // 30 saídas seguidas: o arranque nunca some por contagem; só cai junto com a energia...
    const spam = new DribbleController();
    let now = 0;
    let lastSpeed = 1e9;
    let allFired = true;
    let neverGrows = true;
    const sideOf = (c: DribbleController): number => (c.getHand() === BallHand.Left ? -1 : 1);
    for (let index = 0; index < 30; ++index) {
      spam.request(DribbleMove.Crossover, now);
      now = spam.getActive().endTime() + 0.01; // cansado, o drible fica mais lento: sai logo depois do fim real
      spam.update(now, 0, false);
      const burst = spam.tryExitBurst(now, sideOf(spam), 0);
      allFired = allFired && burst.isValid() && burst.kind === ExitBurstKind.CrossLaunch;
      neverGrows = neverGrows && burst.speed <= lastSpeed + 1e-12;
      lastSpeed = burst.speed;
      now += 0.5;
    }
    expect(allFired).toBe(true);
    expect(neverGrows).toBe(true);
    expect(spam.getEnergy()).toBeLessThan(0.4);
    expect(lastSpeed).toBeLessThan(full);

    // ...e encher a barra devolve o arranque cheio: não há nada escondido contando arranques.
    spam.setEnergy(1);
    spam.request(DribbleMove.Crossover, now);
    now = spam.getActive().endTime() + 0.01;
    spam.update(now, 0, false);
    expectNear(spam.tryExitBurst(now, sideOf(spam), 0).speed, full, 1e-9);

    // Energia infinita (treino do Freestyle): todos os arranques iguais e a barra não mexe.
    const infinite = new DribbleController(defaultDribbleEnergyConfig({ infiniteEnergy: true }));
    let allFull = true;
    for (let index = 0; index < 30; ++index) {
      infinite.request(DribbleMove.Crossover, now);
      now = infinite.getActive().endTime() + 0.01;
      infinite.update(now, 0, false);
      const burst = infinite.tryExitBurst(now, sideOf(infinite), 0);
      allFull = allFull && Math.abs(burst.speed - full) < 1e-9 && burst.energyCost === 0;
      now += 0.5;
    }
    expect(allFull).toBe(true);
    expectNear(infinite.getEnergy(), 1, 1e-9);
  });

  test('PullUpKeepsMomentumIntoGather', () => {
    // P0-9 (docs/17 §3.4): o gather do pull-up leva o embalo do drible e desacelera no plant até a deriva do salto.
    const tuning = defaultGatherCarryTuning();
    const jog = 4.4; // com bola, correndo (m/s)
    const sprint = 6.7; // com bola, em sprint
    const pullUp = computeGatherCarry(tuning, ShotType.PullUp, jog);
    expectNear(pullUp.speedAt(0), jog * tuning.pullUpKeep, 1e-9);
    expect(pullUp.speedAt(0)).toBeGreaterThan(jog * 0.35 * 2); // antes: 35% e freio do chão na hora

    // Desacelera sem degrau (nunca acelera) e anda no plant o que plantMeters diz.
    let neverGrows = true;
    let previous = pullUp.speedAt(0);
    let walked = 0;
    for (let step = 1; step <= 600; ++step) {
      const t = step * 0.001;
      const speed = pullUp.speedAt(t);
      neverGrows = neverGrows && speed <= previous + 1e-12;
      if (t <= pullUp.plantSeconds) walked += speed * 0.001;
      previous = speed;
    }
    expect(neverGrows).toBe(true);
    expectRange(pullUp.plantSeconds, 0.2, 0.3);
    expectNear(walked, pullUp.plantMeters(), 0.01);
    expect(pullUp.plantMeters()).toBeLessThanOrEqual(tuning.plantMaxMeters + 1e-9);
    expectNear(pullUp.speedAt(pullUp.plantSeconds), pullUp.driftSpeed, 1e-9);
    expectRange(pullUp.driftSpeed * 0.4, 0.1, 0.3 + 1e-9); // pouso 10–30 cm à frente num voo de ~0,4 s

    // Em sprint o plant encurta para não andar mais de 0,6 m, e a deriva para no teto.
    const fast = computeGatherCarry(tuning, ShotType.PullUp, sprint);
    expectNear(fast.plantMeters(), tuning.plantMaxMeters, 1e-9);
    expect(fast.plantSeconds).toBeLessThan(tuning.plantSeconds);
    expectNear(fast.driftSpeed, tuning.pullUpDriftMaxSpeed, 1e-9);

    // Spot-up planta na hora; step-back leva o embalo (para trás) do próprio movimento; fadeaway freia mais.
    const spot = computeGatherCarry(tuning, ShotType.SpotUp, 2);
    expectNear(spot.speedAt(0), 0.2, 1e-9);
    expectNear(spot.driftSpeed, 0, 1e-9);
    const step = computeGatherCarry(tuning, ShotType.StepBack, 3);
    expectNear(step.speedAt(0), 3 * tuning.stepBackKeep, 1e-9);
    expectNear(step.speedAt(1), 0, 1e-9);
    const fade = computeGatherCarry(tuning, ShotType.Fadeaway, 3);
    expect(fade.speedAt(0)).toBeLessThan(step.speedAt(0));
    expectNear(fade.driftSpeed, 0, 1e-9);
    expectNear(computeGatherCarry(tuning, ShotType.PullUp, 0).plantMeters(), 0, 1e-12); // parado: nada

    // O último quique vira o gather: gather → soltura ideal ≈ 0,6 s (docs/17 §0, clipe do diretor).
    expectRange(defaultShotTuning().idealReleaseMsNormal / 1000, 0.5, 0.65);
  });

  test('LayupAndDunkProbabilities', () => {
    const model = new ShotModel();
    const layup = makeShotContext({ rating: 85, distanceMeters: 1, isThree: false, type: ShotType.Layup });
    const windows = model.computeWindows(layup);
    expectNear(windows.perfectHalfMs, 80, 1e-9);
    const good = model.evaluate(layup, windows, windows.idealReleaseMs + windows.perfectHalfMs + 1, 0);
    expectNear(good.probability, 0.91, 0.005);

    const dunk = { ...layup, type: ShotType.Dunk };
    const dunkWindows = model.computeWindows(dunk);
    expect(model.evaluate(dunk, dunkWindows, dunkWindows.idealReleaseMs, 0).guaranteed).toBe(true);
  });

  test('RollingBallComesToRest', () => {
    const farHoop = HoopSpec.fromRimFloorPoint(new Vec3(100, 0, 0), new Vec3(1, 0, 0));
    const sim = new BallSim(defaultBallSimConfig(), farHoop);
    const state = makeBallState(new Vec3(0, 0, sim.getConfig().ball.radius), new Vec3(4, 0, 0));
    for (let tick = 0; tick < 120 * 8; ++tick) {
      sim.tick(state);
    }
    expect(state.velocity.length2D()).toBeLessThan(0.05);
    expectNear(state.position.z, sim.getConfig().ball.radius, 1e-6);
  });
});

// ---------------------------------------------------------------- Contestação (defensor)

const contestScene = {
  shooterFeet: new Vec3(7.3, 0, 0),
  release: new Vec3(7.12, 0, 2.75),
  rim: new Vec3(0, 0, 3.042),
};
/** Defensor entre o arremessador e o aro, a `gap` metros. */
const inFront = (gap: number, overrides: Partial<DefenderPose> = {}): DefenderPose =>
  makeDefenderPose({ feetPosition: new Vec3(contestScene.shooterFeet.x - gap, 0, 0), ...overrides });
const contestOf = (pose: DefenderPose, release = contestScene.release) =>
  computeContest(pose, contestScene.shooterFeet, release, contestScene.rim);

describe('Contestação (defensor)', () => {
  test('ContestWideOpenWhenFar', () => {
    const result = contestOf(inFront(4, { handsUpAmount: 1 }));
    expect(result.contest).toBeLessThan(0.15);
    expect(ShotModel.gradeCoverage(result.contest)).toBe(CoverageGrade.WideOpen);
  });

  test('ContestCloseoutJumpSmothers', () => {
    const jump = contestOf(inFront(1, { handsUpAmount: 1, jumpHeight: 0.4 }));
    console.log(
      `    closeout com salto a 1 m: contest ${jump.contest.toFixed(2)} (mão a ${jump.handToPathMeters.toFixed(2)} m da trajetória)`,
    );
    expect(jump.contest).toBeGreaterThan(0.7);

    const handsUp = contestOf(inFront(1, { handsUpAmount: 1 }));
    const handsDown = contestOf(inFront(1, { handsUpAmount: 0 }));
    expect(jump.contest).toBeGreaterThan(handsUp.contest);
    expect(handsUp.contest).toBeGreaterThan(handsDown.contest);
  });

  test('ContestFromBehindIsWeak', () => {
    const front = inFront(1, { handsUpAmount: 1 });
    const behind = { ...front, feetPosition: new Vec3(contestScene.shooterFeet.x + 1, 0, 0) }; // atrás do arremessador
    expect(contestOf(behind).contest).toBeLessThan(contestOf(front).contest * 0.5);
  });

  test('ContestHeightAndReleaseMatter', () => {
    const guard = inFront(1, { handsUpAmount: 1, height: 1.85, wingspan: 1.9 });
    const big = { ...guard, height: 2.13, wingspan: 2.25 };
    const guardContest = contestOf(guard).contest;
    expect(contestOf(big).contest).toBeGreaterThan(guardContest);

    // Soltura mais alta (arremessador alto / fadeaway) é mais difícil de contestar.
    expect(contestOf(guard, contestScene.release.withZ(3.1)).contest).toBeLessThan(guardContest);
  });
});

// ---------------------------------------------------------------- Paridade com o C++ (extra, fora dos 33)

describe('Paridade com o núcleo C++', () => {
  test('RngMatchesSplitMix64Reference', () => {
    // Saída conhecida do SplitMix64 de referência (Vigna) com semente 0: mesma sequência do HoopsRandom.h.
    expect(new Rng(0).nextU64()).toBe(0xe220a8397b1dcdafn);
    // nextDouble usa os 53 bits altos, como o C++.
    const a = new Rng(0);
    expect(a.nextDouble()).toBe(Number(0xe220a8397b1dcdafn >> 11n) / 9007199254740992);
  });
});
