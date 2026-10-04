// Testes do núcleo de simulação. Rodar: ver Plugins/HoopsSim/Tests/README.md
#include "HoopsTestFramework.h"

#include "HoopsSimCore/HoopsBallSim.h"
#include "HoopsSimCore/HoopsContest.h"
#include "HoopsSimCore/HoopsCourt.h"
#include "HoopsSimCore/HoopsDribble.h"
#include "HoopsSimCore/HoopsDribbleMoves.h"
#include "HoopsSimCore/HoopsProStick.h"
#include "HoopsSimCore/HoopsShotModel.h"
#include "HoopsSimCore/HoopsShotSolver.h"

#include <cstdio>

using namespace Hoops;

namespace
{
	// Cesta padrão dos testes: aro sobre a origem, tabela atrás (x negativo), quadra para +X.
	HoopSpec TestHoop() { return HoopSpec::FromRimFloorPoint(Vec3(0.0, 0.0, 0.0), Vec3(1.0, 0.0, 0.0)); }

	BallSim TestSim() { return BallSim(BallSimConfig(), TestHoop()); }

	ShotContext ThreeContext(double Rating)
	{
		ShotContext Context;
		Context.Rating = Rating;
		Context.DistanceMeters = 7.3;
		Context.bIsThree = true;
		Context.Type = ShotType::SpotUp;
		return Context;
	}

	// Posição de soltura (altura ~2,55 m) a uma distância e ângulo em volta do aro.
	Vec3 ReleaseAt(double Distance, double AngleDeg, double Height = 2.55)
	{
		const double Rad = DegToRad(AngleDeg);
		return Vec3(Distance * std::cos(Rad), Distance * std::sin(Rad), Height);
	}
}

// ---------------------------------------------------------------- Bola e quadra

HOOPS_TEST(FloorBounceMatchesFibaRule)
{
	// Regra FIBA: solta de 1,80 m (base da bola) deve voltar a 1,20–1,40 m (topo da bola).
	HoopSpec FarHoop = HoopSpec::FromRimFloorPoint(Vec3(100.0, 0.0, 0.0), Vec3(1.0, 0.0, 0.0));
	BallSim Sim(BallSimConfig(), FarHoop);
	const double Radius = Sim.GetConfig().Ball.Radius;

	BallState State;
	State.Position = Vec3(0.0, 0.0, 1.80 + Radius);

	bool bBounced = false;
	double ApexCenterZ = 0.0;
	for (int Tick = 0; Tick < 600; ++Tick)
	{
		const BallTickEvents Events = Sim.Tick(State);
		if (Events.HitFloor && !bBounced)
		{
			bBounced = true;
			continue;
		}
		if (bBounced)
		{
			ApexCenterZ = State.Position.Z > ApexCenterZ ? State.Position.Z : ApexCenterZ;
			if (State.Velocity.Z < 0.0)
			{
				break;
			}
		}
	}
	EXPECT_TRUE(bBounced);
	EXPECT_RANGE(ApexCenterZ + Radius, 1.20, 1.40);
}

HOOPS_TEST(HoopGeometryIsRegulation)
{
	const HoopSpec Hoop = TestHoop();
	const Vec3 Rim = Hoop.RimCenter();
	EXPECT_NEAR(Rim.X, 0.0, 1e-9);
	EXPECT_NEAR(Rim.Z + Hoop.RimTubeRadius, 3.05, 1e-9);
	// Borda interna do aro a 0,151 m da face da tabela.
	EXPECT_NEAR(Rim.X - Hoop.RimInnerRadius - Hoop.BackboardFaceCenter.X, 0.151, 1e-9);
	// Borda inferior da tabela a 2,90 m.
	EXPECT_NEAR(Hoop.BackboardFaceCenter.Z - Hoop.BackboardHeight * 0.5, 2.90, 1e-9);
}

HOOPS_TEST(StraightDropThroughCenterIsSwish)
{
	const BallSim Sim = TestSim();
	BallState State;
	State.Position = Sim.GetHoop().RimCenter() + Vec3(0.0, 0.0, 1.0);
	const FlightSummary Flight = SimulateFlight(Sim, State);
	EXPECT_TRUE(Flight.Scored);
	EXPECT_TRUE(Flight.RimHits == 0);
	EXPECT_TRUE(Flight.BoardHits == 0);
}

HOOPS_TEST(DropOnRimEdgeTouchesRim)
{
	const BallSim Sim = TestSim();
	BallState State;
	const HoopSpec& Hoop = Sim.GetHoop();
	State.Position = Hoop.RimCenter() + Hoop.Forward * Hoop.RimCenterlineRadius() + Vec3(0.0, 0.0, 1.0);
	const FlightSummary Flight = SimulateFlight(Sim, State);
	EXPECT_TRUE(Flight.RimHits > 0);
}

HOOPS_TEST(FastBallDoesNotTunnelThroughBackboard)
{
	const BallSim Sim = TestSim();
	const HoopSpec& Hoop = Sim.GetHoop();
	BallState State;
	State.Position = Hoop.BackboardFaceCenter + Hoop.Forward * 1.0 + Vec3(0.0, 0.3, 0.2);
	State.Velocity = Hoop.Forward * -25.0; // 25 m/s contra a tabela
	bool bHitBoard = false;
	double MinAlong = 1e9;
	for (int Tick = 0; Tick < 60; ++Tick)
	{
		const BallTickEvents Events = Sim.Tick(State);
		bHitBoard = bHitBoard || Events.HitBackboard;
		const double Along = (State.Position - Hoop.BackboardFaceCenter).Dot(Hoop.Forward);
		MinAlong = Along < MinAlong ? Along : MinAlong;
	}
	EXPECT_TRUE(bHitBoard);
	// O centro nunca passa para trás da face (fica no máximo a ~1 raio de penetração antes da correção).
	EXPECT_TRUE(MinAlong > 0.0);
	EXPECT_TRUE(State.Velocity.Dot(Hoop.Forward) > 0.0);
}

HOOPS_TEST(ThreePointLineClassification)
{
	const CourtSpec Court;
	const Vec3 Rim(0.0, 0.0, 0.0);
	const Vec3 Fwd(1.0, 0.0, 0.0);
	EXPECT_TRUE(Court.IsThreePointer(Vec3(7.3, 0.0, 0.0), Rim, Fwd));     // topo, atrás da linha
	EXPECT_TRUE(!Court.IsThreePointer(Vec3(7.0, 0.0, 0.0), Rim, Fwd));    // topo, dentro
	EXPECT_TRUE(Court.IsThreePointer(Vec3(0.5, 6.8, 0.0), Rim, Fwd));     // canto, atrás da linha (6,71)
	EXPECT_TRUE(!Court.IsThreePointer(Vec3(0.5, 6.6, 0.0), Rim, Fwd));    // canto, dentro
}

// ---------------------------------------------------------------- Modelo de arremesso

HOOPS_TEST(ShotProbabilityMatchesDesignTable)
{
	const ShotModel Model;
	const ShotContext Context = ThreeContext(85.0);
	const TimingWindows Windows = Model.ComputeWindows(Context);
	const double Ideal = Windows.IdealReleaseMs;

	// Valores do exemplo numérico em docs/03-arremessos.md §3.2.
	const ShotEvaluation Good = Model.Evaluate(Context, Windows, Ideal + Windows.PerfectHalfMs + 5.0, 0.0);
	EXPECT_TRUE(Good.Timing == TimingGrade::Good);
	EXPECT_NEAR(Good.Probability, 0.42, 0.005);

	const ShotEvaluation GreenOpen = Model.Evaluate(Context, Windows, Ideal, 0.05);
	EXPECT_TRUE(GreenOpen.Timing == TimingGrade::Green);
	EXPECT_TRUE(GreenOpen.bGuaranteed);
	EXPECT_NEAR(GreenOpen.Probability, 1.0, 1e-9);

	const ShotEvaluation GreenContested = Model.Evaluate(Context, Windows, Ideal, 0.8);
	EXPECT_TRUE(!GreenContested.bGuaranteed);
	EXPECT_NEAR(GreenContested.Probability, 0.677, 0.01);

	const ShotEvaluation GoodSmothered = Model.Evaluate(Context, Windows, Ideal + Windows.PerfectHalfMs + 5.0, 1.0);
	EXPECT_NEAR(GoodSmothered.Probability, 0.107, 0.005);

	const ShotEvaluation SlightLate = Model.Evaluate(Context, Windows, Ideal + Windows.GoodHalfMs + 5.0, 0.0);
	EXPECT_TRUE(SlightLate.Timing == TimingGrade::SlightlyLate);
	EXPECT_NEAR(SlightLate.Probability, 0.35, 0.01);

	const ShotEvaluation VeryEarly = Model.Evaluate(Context, Windows, Ideal - Windows.SlightHalfMs - 10.0, 0.0);
	EXPECT_TRUE(VeryEarly.Timing == TimingGrade::VeryEarly);
	EXPECT_NEAR(VeryEarly.Probability, 0.139, 0.01);
}

HOOPS_TEST(TimingWindowScalesAndFloor)
{
	const ShotModel Model;
	EXPECT_NEAR(ShotModel::BasePerfectHalfWindowMs(85.0), 50.0, 1e-9);
	EXPECT_NEAR(ShotModel::BasePerfectHalfWindowMs(99.0), 70.0, 1e-9);
	EXPECT_NEAR(ShotModel::BasePerfectHalfWindowMs(50.0), 30.0, 1e-9);

	ShotContext Heave = ThreeContext(40.0);
	Heave.Type = ShotType::Heave;
	const TimingWindows HeaveWindows = Model.ComputeWindows(Heave);
	EXPECT_NEAR(HeaveWindows.PerfectHalfMs, 25.0, 1e-9); // piso de 3 frames

	ShotContext MeterOff = ThreeContext(85.0);
	MeterOff.bMeterOff = true;
	EXPECT_NEAR(Model.ComputeWindows(MeterOff).PerfectHalfMs, 55.0, 1e-9);

	ShotContext Tired = ThreeContext(85.0);
	Tired.Fatigue = 1.0;
	EXPECT_NEAR(Model.ComputeWindows(Tired).PerfectHalfMs, 35.0, 1e-9);

	ShotContext QuickRelease = ThreeContext(85.0);
	QuickRelease.Speed = ReleaseSpeed::Quick;
	const TimingWindows Quick = Model.ComputeWindows(QuickRelease);
	EXPECT_NEAR(Quick.PerfectHalfMs, 42.5, 1e-9);

	ShotTuning Wide;
	Wide.PerfectWindowScale = 1.5;
	EXPECT_NEAR(ShotModel(Wide).ComputeWindows(ThreeContext(85.0)).PerfectHalfMs, 75.0, 1e-9);
	EXPECT_TRUE(Quick.IdealReleaseMs < Model.ComputeWindows(ThreeContext(85.0)).IdealReleaseMs);
}

HOOPS_TEST(TimingGradeBoundaries)
{
	const ShotModel Model;
	TimingWindows Windows;
	Windows.PerfectHalfMs = 30.0;
	Windows.GoodHalfMs = 69.0;
	Windows.SlightHalfMs = 120.0;
	EXPECT_TRUE(Model.GradeTiming(0.0, Windows) == TimingGrade::Green);
	EXPECT_TRUE(Model.GradeTiming(-30.0, Windows) == TimingGrade::Green);
	EXPECT_TRUE(Model.GradeTiming(31.0, Windows) == TimingGrade::Good);
	EXPECT_TRUE(Model.GradeTiming(-90.0, Windows) == TimingGrade::SlightlyEarly);
	EXPECT_TRUE(Model.GradeTiming(90.0, Windows) == TimingGrade::SlightlyLate);
	EXPECT_TRUE(Model.GradeTiming(-121.0, Windows) == TimingGrade::VeryEarly);
	EXPECT_TRUE(Model.GradeTiming(200.0, Windows) == TimingGrade::VeryLate);
}

HOOPS_TEST(DecisionRateMatchesProbability)
{
	const ShotModel Model;
	const ShotContext Context = ThreeContext(85.0);
	const TimingWindows Windows = Model.ComputeWindows(Context);
	const ShotEvaluation Eval = Model.Evaluate(Context, Windows, Windows.IdealReleaseMs + 50.0, 0.0);

	Rng Random(12345);
	int Makes = 0;
	const int Trials = 20000;
	for (int Index = 0; Index < Trials; ++Index)
	{
		Makes += Model.Decide(Eval, Random).bMake ? 1 : 0;
	}
	EXPECT_NEAR(static_cast<double>(Makes) / Trials, Eval.Probability, 0.015);
}

HOOPS_TEST(EarlyMissesTendShortLateMissesTendLong)
{
	const ShotModel Model;
	ShotEvaluation Early;
	Early.Timing = TimingGrade::VeryEarly;
	Early.Probability = 0.0;
	ShotEvaluation Late = Early;
	Late.Timing = TimingGrade::VeryLate;

	Rng Random(7);
	int Short = 0;
	int Long = 0;
	for (int Index = 0; Index < 2000; ++Index)
	{
		Short += Model.Decide(Early, Random).Miss == MissType::Short ? 1 : 0;
		Long += Model.Decide(Late, Random).Miss == MissType::Long ? 1 : 0;
	}
	EXPECT_RANGE(Short / 2000.0, 0.62, 0.78);
	EXPECT_RANGE(Long / 2000.0, 0.62, 0.78);
}

// ---------------------------------------------------------------- Física realiza a decisão

HOOPS_TEST(GreenOpenAlwaysGoesInPhysically)
{
	const BallSim Sim = TestSim();
	Rng Random(2026);
	ShotDecision Make;
	Make.bMake = true;

	int Failures = 0;
	int Total = 0;
	for (double Distance = 2.0; Distance <= 8.5; Distance += 0.5)
	{
		for (double Angle = -80.0; Angle <= 80.0; Angle += 20.0)
		{
			ShotRealizeParams Params;
			Params.ReleasePosition = ReleaseAt(Distance, Angle);
			Params.LaunchAngleDeg = Distance < 4.0 ? 55.0 : 50.0;
			const RealizedShot Shot = RealizeShot(Sim, Make, Params, Random);
			++Total;
			Failures += Shot.bScored ? 0 : 1;
		}
	}
	std::printf("    green livre: %d/%d cestas na simulação\n", Total - Failures, Total);
	EXPECT_TRUE(Failures == 0);
}

HOOPS_TEST(RealizedOutcomeMatchesDecision)
{
	const BallSim Sim = TestSim();
	const ShotModel Model;
	Rng Random(99);

	const MissType Misses[] = {MissType::Short, MissType::Long, MissType::Left, MissType::Right, MissType::Airball};
	int Matches = 0;
	int MissesThatScored = 0;
	int RimOrBoardOnMiss = 0;
	int NonAirballMisses = 0;
	int TotalAttempts = 0;
	const int Trials = 600;
	for (int Index = 0; Index < Trials; ++Index)
	{
		const double Distance = Random.Range(2.0, 8.5);
		const double Angle = Random.Range(-85.0, 85.0);
		ShotDecision Decision;
		Decision.bMake = Random.Chance(0.45);
		Decision.Miss = Decision.bMake ? MissType::None : Misses[static_cast<int>(Random.NextDouble() * 5.0) % 5];

		ShotRealizeParams Params;
		Params.ReleasePosition = ReleaseAt(Distance, Angle, Random.Range(2.3, 2.8));
		Params.LaunchAngleDeg = Distance < 4.0 ? 55.0 : Random.Range(46.0, 54.0);
		const RealizedShot Shot = RealizeShot(Sim, Decision, Params, Random);

		Matches += Shot.bMatchesDecision ? 1 : 0;
		TotalAttempts += Shot.Attempts;
		if (!Decision.bMake)
		{
			MissesThatScored += Shot.bScored ? 1 : 0;
			if (Decision.Miss != MissType::Airball)
			{
				++NonAirballMisses;
				RimOrBoardOnMiss += (Shot.Flight.RimHits + Shot.Flight.BoardHits) > 0 ? 1 : 0;
			}
		}
	}
	std::printf("    decisão realizada: %d/%d (%.1f%%), tentativas médias %.2f, erros que tocaram aro/tabela %d/%d\n",
		Matches, Trials, 100.0 * Matches / Trials, static_cast<double>(TotalAttempts) / Trials, RimOrBoardOnMiss, NonAirballMisses);
	EXPECT_TRUE(Matches >= Trials * 99 / 100);
	EXPECT_TRUE(MissesThatScored == 0);
	// Erros "de aro" devem parecer erros de aro na maioria das vezes.
	EXPECT_TRUE(RimOrBoardOnMiss >= NonAirballMisses * 80 / 100);
}

HOOPS_TEST(MakeEntryAngleIsRealistic)
{
	const BallSim Sim = TestSim();
	BallState State;
	State.Position = ReleaseAt(7.3, 0.0, 2.55);
	const Vec3 Target = Sim.GetHoop().RimCenter() + Vec3(-0.03, 0.0, 0.0);
	const LaunchSolution Launch = SolveLaunch(State.Position, Target, DegToRad(50.0));
	EXPECT_TRUE(Launch.bValid);
	State.Velocity = Launch.Velocity;

	const double PlaneZ = Sim.GetHoop().RimPlaneZ();
	double EntryDeg = 0.0;
	for (int Tick = 0; Tick < 500; ++Tick)
	{
		const double PrevZ = State.Position.Z;
		Sim.Tick(State);
		if (PrevZ >= PlaneZ && State.Position.Z < PlaneZ)
		{
			EntryDeg = RadToDeg(std::atan2(-State.Velocity.Z, State.Velocity.Length2D()));
			break;
		}
	}
	std::printf("    ângulo de entrada de um 3PT lançado a 50°: %.1f°\n", EntryDeg);
	EXPECT_RANGE(EntryDeg, 42.0, 50.0);
}

HOOPS_TEST(RealizationIsDeterministic)
{
	const BallSim Sim = TestSim();
	ShotDecision Decision;
	Decision.bMake = false;
	Decision.Miss = MissType::Long;
	ShotRealizeParams Params;
	Params.ReleasePosition = ReleaseAt(6.0, 30.0);

	Rng RandomA(555);
	Rng RandomB(555);
	const RealizedShot A = RealizeShot(Sim, Decision, Params, RandomA);
	const RealizedShot B = RealizeShot(Sim, Decision, Params, RandomB);
	EXPECT_TRUE(A.Initial.Velocity.X == B.Initial.Velocity.X);
	EXPECT_TRUE(A.Initial.Velocity.Y == B.Initial.Velocity.Y);
	EXPECT_TRUE(A.Initial.Velocity.Z == B.Initial.Velocity.Z);
	EXPECT_TRUE(A.Flight.Ticks == B.Flight.Ticks);
	EXPECT_TRUE(RandomA.GetState() == RandomB.GetState());
}

// ---------------------------------------------------------------- Drible

HOOPS_TEST(DribbleArcHitsHandAndFloorExactly)
{
	const Vec3 RightHand(0.0, -0.30, 0.85);
	const Vec3 LeftHand(0.0, 0.30, 0.85);
	const DribbleArc Arc = MakeDribbleArc(RightHand, LeftHand, Vec3(3.0, 0.0, 0.0), 0.45, 0.119);

	const Vec3 Start = Arc.Evaluate(0.0);
	const Vec3 Floor = Arc.Evaluate(Arc.DownSeconds);
	const Vec3 End = Arc.Evaluate(Arc.TotalSeconds());
	EXPECT_NEAR(Distance(Start, RightHand), 0.0, 1e-9);
	EXPECT_NEAR(Floor.Z, 0.119, 1e-9);
	EXPECT_NEAR(Distance(End, LeftHand), 0.0, 1e-9);

	// Contínuo e nunca abaixo do chão.
	double MinZ = 10.0;
	Vec3 Prev = Start;
	double MaxStep = 0.0;
	for (int Step = 1; Step <= 200; ++Step)
	{
		const Vec3 Pos = Arc.Evaluate(Arc.TotalSeconds() * Step / 200.0);
		MinZ = Pos.Z < MinZ ? Pos.Z : MinZ;
		const double StepLen = Distance(Pos, Prev);
		MaxStep = StepLen > MaxStep ? StepLen : MaxStep;
		Prev = Pos;
	}
	EXPECT_TRUE(MinZ >= 0.119 - 1e-9);
	EXPECT_TRUE(MaxStep < 0.05);
	// Quique plausível: sai do chão com velocidade menor ou parecida com a de chegada.
	EXPECT_RANGE(Arc.FloorExitSpeed() / Arc.FloorEntrySpeed(), 0.6, 1.0);
}


// ---------------------------------------------------------------- Pro Stick e dribles (2K23)

namespace
{
	// Alimenta o reconhecedor com uma sequência (x, y) a 60 Hz e devolve todos os gestos.
	struct StickFeed
	{
		ProStickRecognizer Recognizer;
		double Time = 0.0;
		StickGesture All[64];
		int Count = 0;

		void Sample(double X, double Y, int Frames = 1)
		{
			for (int Frame = 0; Frame < Frames; ++Frame)
			{
				StickGesture Out[ProStickRecognizer::MaxGesturesPerUpdate];
				const int N = Recognizer.Update(Time, X, Y, Out);
				for (int Index = 0; Index < N && Count < 64; ++Index)
				{
					All[Count++] = Out[Index];
				}
				Time += 1.0 / 60.0;
			}
		}

		void Flick(double X, double Y)
		{
			Sample(X, Y, 4);   // ~67 ms fora do centro
			Sample(0.0, 0.0, 1);
		}

		void Rotate(double StartDeg, double SweepDeg, int Frames)
		{
			for (int Frame = 0; Frame <= Frames; ++Frame)
			{
				const double Deg = StartDeg + SweepDeg * Frame / Frames;
				Sample(std::cos(DegToRad(Deg)), std::sin(DegToRad(Deg)), 1);
			}
			Sample(0.0, 0.0, 1);
		}

		bool Has(StickGestureKind Kind, StickDir Dir) const
		{
			for (int Index = 0; Index < Count; ++Index)
			{
				if (All[Index].Kind == Kind && All[Index].Dir == Dir) { return true; }
			}
			return false;
		}

		bool HasKind(StickGestureKind Kind) const
		{
			for (int Index = 0; Index < Count; ++Index)
			{
				if (All[Index].Kind == Kind) { return true; }
			}
			return false;
		}
	};
}

HOOPS_TEST(StickDirectionsAndMirror)
{
	EXPECT_TRUE(DirFromVector(0.0, 1.0) == StickDir::Up);
	EXPECT_TRUE(DirFromVector(1.0, 0.0) == StickDir::Right);
	EXPECT_TRUE(DirFromVector(-0.7, -0.7) == StickDir::DownLeft);
	EXPECT_TRUE(DirFromVector(-1.0, 0.0) == StickDir::Left);
	EXPECT_TRUE(MirrorDir(StickDir::UpRight) == StickDir::UpLeft);
	EXPECT_TRUE(MirrorDir(StickDir::Down) == StickDir::Down);
	EXPECT_TRUE(AreOpposite(StickDir::Left, StickDir::Right));
	EXPECT_TRUE(!AreOpposite(StickDir::Up, StickDir::UpRight));
}

HOOPS_TEST(StickFlickHoldRotationRecognized)
{
	StickFeed Feed;
	Feed.Flick(0.0, 1.0);
	EXPECT_TRUE(Feed.Has(StickGestureKind::Flick, StickDir::Up));

	StickFeed HoldFeed;
	HoldFeed.Sample(0.0, -1.0, 20); // ~330 ms segurando para baixo
	EXPECT_TRUE(HoldFeed.Has(StickGestureKind::Hold, StickDir::Down));
	EXPECT_TRUE(HoldFeed.Recognizer.IsHolding());
	HoldFeed.Sample(0.0, 0.0, 1);
	EXPECT_TRUE(HoldFeed.Has(StickGestureKind::HoldRelease, StickDir::Down));
	EXPECT_TRUE(!HoldFeed.HasKind(StickGestureKind::Flick)); // soltar um hold não vira flick

	StickFeed SpinFeed;
	SpinFeed.Rotate(0.0, -300.0, 18); // giro horário
	EXPECT_TRUE(SpinFeed.HasKind(StickGestureKind::Rotation));

	StickFeed HalfFeed;
	HalfFeed.Rotate(0.0, 100.0, 8);
	EXPECT_TRUE(HalfFeed.HasKind(StickGestureKind::QuarterCircle));
}

HOOPS_TEST(StickDoubleThrowAndSwitchback)
{
	StickFeed Double;
	Double.Flick(1.0, 0.0);
	Double.Sample(0.0, 0.0, 3);
	Double.Flick(1.0, 0.0);
	EXPECT_TRUE(Double.Has(StickGestureKind::DoubleThrow, StickDir::Right));

	StickFeed Switch;
	Switch.Flick(1.0, 0.0);
	Switch.Sample(0.0, 0.0, 3);
	Switch.Flick(-1.0, 0.0);
	EXPECT_TRUE(Switch.Has(StickGestureKind::Switchback, StickDir::Left));

	StickFeed Slow;
	Slow.Flick(1.0, 0.0);
	Slow.Sample(0.0, 0.0, 30); // 500 ms depois: não é combo
	Slow.Flick(1.0, 0.0);
	EXPECT_TRUE(!Slow.HasKind(StickGestureKind::DoubleThrow));
}

HOOPS_TEST(GesturesMapToTwoKMoves)
{
	DribbleContext Right;
	Right.Hand = BallHand::Right;
	DribbleContext Left;
	Left.Hand = BallHand::Left;
	DribbleContext Sprint = Right;
	Sprint.bSprint = true;

	StickGesture Flick;
	Flick.Kind = StickGestureKind::Flick;

	Flick.Dir = StickDir::Up;
	EXPECT_TRUE(ResolveDribbleMove(Flick, Right) == DribbleMove::Crossover);
	EXPECT_TRUE(ResolveDribbleMove(Flick, Sprint) == DribbleMove::AttackingCrossover);
	Flick.Dir = StickDir::Left; // mão livre (bola na direita)
	EXPECT_TRUE(ResolveDribbleMove(Flick, Right) == DribbleMove::BetweenLegs);
	Flick.Dir = StickDir::Right; // mão da bola (bola na direita)
	EXPECT_TRUE(ResolveDribbleMove(Flick, Right) == DribbleMove::Hesitation);
	EXPECT_TRUE(ResolveDribbleMove(Flick, Left) == DribbleMove::BetweenLegs); // com a esquerda, direita = mão livre
	Flick.Dir = StickDir::DownLeft;
	EXPECT_TRUE(ResolveDribbleMove(Flick, Right) == DribbleMove::BehindBack);
	Flick.Dir = StickDir::Down;
	EXPECT_TRUE(ResolveDribbleMove(Flick, Right) == DribbleMove::StepBack);

	StickGesture Spin;
	Spin.Kind = StickGestureKind::Rotation;
	EXPECT_TRUE(ResolveDribbleMove(Spin, Right) == DribbleMove::Spin);

	StickGesture Hold;
	Hold.Kind = StickGestureKind::Hold;
	Hold.Dir = StickDir::Down;
	EXPECT_TRUE(ResolveDribbleMove(Hold, Right) == DribbleMove::None); // hold baixo = arremesso
}

HOOPS_TEST(DribbleControllerCommitBufferAndRhythm)
{
	DribbleController Controller;
	EXPECT_TRUE(Controller.Request(DribbleMove::Crossover, 0.0));
	EXPECT_TRUE(Controller.GetHand() == BallHand::Left); // crossover troca a mão
	EXPECT_TRUE(!Controller.CanCancel(0.05));             // dentro do commit (0,12 s)

	// Pedido durante o commit vai para o buffer e sai assim que o commit acaba.
	EXPECT_TRUE(!Controller.Request(DribbleMove::BehindBack, 0.05));
	Controller.Update(0.10, 0.05, false);
	EXPECT_TRUE(Controller.GetActive().Move == DribbleMove::Crossover);
	Controller.Update(0.13, 0.03, false);
	EXPECT_TRUE(Controller.GetActive().Move == DribbleMove::BehindBack);
	EXPECT_TRUE(Controller.GetHand() == BallHand::Right);

	// Input na janela de combo do fim = ritmo (mais rápido, conta combo).
	const double End = Controller.GetActive().EndTime();
	EXPECT_TRUE(Controller.Request(DribbleMove::Crossover, End - 0.05));
	EXPECT_TRUE(Controller.GetActive().bInRhythm);
	EXPECT_NEAR(Controller.GetActive().PlayRate, 1.15, 1e-9);
	EXPECT_TRUE(Controller.GetComboCount() >= 2);

	// Buffer expira depois de 150 ms.
	DribbleController Late;
	Late.Request(DribbleMove::Spin, 0.0);
	Late.Request(DribbleMove::Crossover, 0.01);
	Late.Update(0.2, 0.2, false); // 190 ms depois do pedido; commit do spin acabou em 0,25
	Late.Update(0.26, 0.06, false);
	EXPECT_TRUE(Late.GetActive().Move == DribbleMove::Spin);
}

HOOPS_TEST(EnergyIsTheOnlyLimiter)
{
	// Sem Explosões (decisão D13): sprint e dribles gastam energia; energia baixa deixa mais lento.
	DribbleController Controller;
	EXPECT_NEAR(Controller.GetEnergy(), 1.0, 1e-9);
	EXPECT_NEAR(Controller.SpeedScale(), 1.0, 1e-9);

	Controller.Update(5.0, 5.0, true, true); // 5 s de sprint
	EXPECT_NEAR(Controller.GetEnergy(), 0.6, 1e-6);

	const double BeforeMove = Controller.GetEnergy();
	EXPECT_TRUE(Controller.Request(DribbleMove::Spin, 6.0));
	EXPECT_TRUE(Controller.GetEnergy() < BeforeMove);

	Controller.SetEnergy(0.1);
	EXPECT_TRUE(Controller.SpeedScale() < 0.9);
	EXPECT_TRUE(Controller.MovePlayRateScale() < 0.95);

	// Parado recupera mais rápido que andando.
	DribbleController Standing;
	Standing.SetEnergy(0.2);
	Standing.Update(10.0, 2.0, false, false);
	DribbleController Walking;
	Walking.SetEnergy(0.2);
	Walking.Update(10.0, 2.0, false, true);
	EXPECT_TRUE(Standing.GetEnergy() > Walking.GetEnergy());
	EXPECT_TRUE(Walking.GetEnergy() > 0.2);

	DribbleEnergyConfig Training;
	Training.bInfiniteEnergy = true;
	DribbleController Infinite(Training);
	Infinite.Update(5.0, 5.0, true, true);
	Infinite.Request(DribbleMove::Spin, 5.5);
	EXPECT_NEAR(Infinite.GetEnergy(), 1.0, 1e-9);
}

HOOPS_TEST(LayupAndDunkProbabilities)
{
	const ShotModel Model;
	ShotContext Layup;
	Layup.Rating = 85.0;
	Layup.DistanceMeters = 1.0;
	Layup.bIsThree = false;
	Layup.Type = ShotType::Layup;
	const TimingWindows Windows = Model.ComputeWindows(Layup);
	EXPECT_NEAR(Windows.PerfectHalfMs, 80.0, 1e-9);
	const ShotEvaluation Good = Model.Evaluate(Layup, Windows, Windows.IdealReleaseMs + Windows.PerfectHalfMs + 1.0, 0.0);
	EXPECT_NEAR(Good.Probability, 0.91, 0.005);

	ShotContext Dunk = Layup;
	Dunk.Type = ShotType::Dunk;
	const ShotEvaluation DunkOpen = Model.Evaluate(Dunk, Model.ComputeWindows(Dunk), Model.ComputeWindows(Dunk).IdealReleaseMs, 0.0);
	EXPECT_TRUE(DunkOpen.bGuaranteed);
}

HOOPS_TEST(RollingBallComesToRest)
{
	HoopSpec FarHoop = HoopSpec::FromRimFloorPoint(Vec3(100.0, 0.0, 0.0), Vec3(1.0, 0.0, 0.0));
	BallSim Sim(BallSimConfig(), FarHoop);
	BallState State;
	State.Position = Vec3(0.0, 0.0, Sim.GetConfig().Ball.Radius);
	State.Velocity = Vec3(4.0, 0.0, 0.0);
	for (int Tick = 0; Tick < 120 * 8; ++Tick)
	{
		Sim.Tick(State);
	}
	EXPECT_TRUE(State.Velocity.Length2D() < 0.05);
	EXPECT_NEAR(State.Position.Z, Sim.GetConfig().Ball.Radius, 1e-6);
}


// ---------------------------------------------------------------- Contestação (defensor)

namespace
{
	struct ContestScene
	{
		Vec3 ShooterFeet = Vec3(7.3, 0.0, 0.0);
		Vec3 Release = Vec3(7.12, 0.0, 2.75);
		Vec3 Rim = Vec3(0.0, 0.0, 3.042);

		DefenderPose InFront(double Gap) const
		{
			DefenderPose Pose;
			Pose.FeetPosition = Vec3(ShooterFeet.X - Gap, 0.0, 0.0); // entre o arremessador e o aro
			return Pose;
		}
	};
}

HOOPS_TEST(ContestWideOpenWhenFar)
{
	const ContestScene Scene;
	DefenderPose Far = Scene.InFront(4.0);
	Far.HandsUpAmount = 1.0;
	const ContestBreakdown Result = ComputeContest(Far, Scene.ShooterFeet, Scene.Release, Scene.Rim);
	EXPECT_TRUE(Result.Contest < 0.15);
	EXPECT_TRUE(ShotModel::GradeCoverage(Result.Contest) == CoverageGrade::WideOpen);
}

HOOPS_TEST(ContestCloseoutJumpSmothers)
{
	const ContestScene Scene;
	DefenderPose Close = Scene.InFront(1.0);
	Close.HandsUpAmount = 1.0;
	Close.JumpHeight = 0.40;
	const ContestBreakdown Jump = ComputeContest(Close, Scene.ShooterFeet, Scene.Release, Scene.Rim);
	std::printf("    closeout com salto a 1 m: contest %.2f (mao a %.2f m da trajetoria)\n", Jump.Contest, Jump.HandToPathMeters);
	EXPECT_TRUE(Jump.Contest > 0.70);

	Close.JumpHeight = 0.0;
	const ContestBreakdown HandsUp = ComputeContest(Close, Scene.ShooterFeet, Scene.Release, Scene.Rim);
	Close.HandsUpAmount = 0.0;
	const ContestBreakdown HandsDown = ComputeContest(Close, Scene.ShooterFeet, Scene.Release, Scene.Rim);
	EXPECT_TRUE(Jump.Contest > HandsUp.Contest);
	EXPECT_TRUE(HandsUp.Contest > HandsDown.Contest);
}

HOOPS_TEST(ContestFromBehindIsWeak)
{
	const ContestScene Scene;
	DefenderPose Front = Scene.InFront(1.0);
	Front.HandsUpAmount = 1.0;
	DefenderPose Behind = Front;
	Behind.FeetPosition = Vec3(Scene.ShooterFeet.X + 1.0, 0.0, 0.0); // atrás do arremessador
	const double FrontContest = ComputeContest(Front, Scene.ShooterFeet, Scene.Release, Scene.Rim).Contest;
	const double BehindContest = ComputeContest(Behind, Scene.ShooterFeet, Scene.Release, Scene.Rim).Contest;
	EXPECT_TRUE(BehindContest < FrontContest * 0.5);
}

HOOPS_TEST(ContestHeightAndReleaseMatter)
{
	const ContestScene Scene;
	DefenderPose Guard = Scene.InFront(1.0);
	Guard.HandsUpAmount = 1.0;
	Guard.Height = 1.85;
	Guard.Wingspan = 1.90;
	DefenderPose Big = Guard;
	Big.Height = 2.13;
	Big.Wingspan = 2.25;
	const double GuardContest = ComputeContest(Guard, Scene.ShooterFeet, Scene.Release, Scene.Rim).Contest;
	const double BigContest = ComputeContest(Big, Scene.ShooterFeet, Scene.Release, Scene.Rim).Contest;
	EXPECT_TRUE(BigContest > GuardContest);

	// Soltura mais alta (arremessador alto / fadeaway) é mais difícil de contestar.
	ContestScene HighRelease = Scene;
	HighRelease.Release.Z = 3.10;
	EXPECT_TRUE(ComputeContest(Guard, HighRelease.ShooterFeet, HighRelease.Release, HighRelease.Rim).Contest < GuardContest);
}

int main()
{
	int Index = 0;
	for (const HoopsTest::TestCase& Test : HoopsTest::Registry())
	{
		const int Before = HoopsTest::FailureCount();
		std::printf("[%2d] %s\n", ++Index, Test.Name);
		Test.Body();
		std::printf("     %s\n", HoopsTest::FailureCount() == Before ? "ok" : "FALHOU");
	}
	const int Failures = HoopsTest::FailureCount();
	std::printf("\n%zu testes, %d falha(s)\n", HoopsTest::Registry().size(), Failures);
	return Failures == 0 ? 0 : 1;
}
