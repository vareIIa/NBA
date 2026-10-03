#include "HoopsSimCore/HoopsShotSolver.h"

#include <cmath>

namespace Hoops
{
	LaunchSolution SolveLaunch(const Vec3& From, const Vec3& To, double LaunchAngleRad, double Gravity)
	{
		LaunchSolution Solution;
		const Vec3 Delta = To - From;
		const double HorizontalDist = Delta.Length2D();
		if (HorizontalDist < 1e-6)
		{
			return Solution;
		}

		const double CosA = std::cos(LaunchAngleRad);
		const double TanA = std::tan(LaunchAngleRad);
		const double Rise = HorizontalDist * TanA - Delta.Z;
		if (Rise <= 1e-6 || CosA <= 1e-6)
		{
			return Solution;
		}

		const double SpeedSq = Gravity * HorizontalDist * HorizontalDist / (2.0 * CosA * CosA * Rise);
		const double Speed = std::sqrt(SpeedSq);
		const Vec3 Dir2D = Delta.Flat() / HorizontalDist;

		Solution.bValid = true;
		Solution.Velocity = Dir2D * (Speed * CosA) + UpVector() * (Speed * std::sin(LaunchAngleRad));
		return Solution;
	}

	double LaunchAngleForTiming(double BaseAngleDeg, TimingGrade Grade)
	{
		switch (Grade)
		{
		case TimingGrade::SlightlyEarly: return BaseAngleDeg + 3.0;
		case TimingGrade::VeryEarly: return BaseAngleDeg + 6.0;
		case TimingGrade::SlightlyLate: return BaseAngleDeg - 3.0;
		case TimingGrade::VeryLate: return BaseAngleDeg - 6.0;
		default: return BaseAngleDeg;
		}
	}

	namespace
	{
		struct ShotFrame
		{
			Vec3 RimCenter;
			Vec3 Dir;     // horizontal, do arremessador para o aro
			Vec3 Lateral; // horizontal, à direita do arremessador
			double CenterlineRadius;
		};

		ShotFrame MakeFrame(const HoopSpec& Hoop, const Vec3& Release)
		{
			ShotFrame Frame;
			Frame.RimCenter = Hoop.RimCenter();
			Frame.Dir = (Frame.RimCenter - Release).Flat().Normalized(-Hoop.Forward);
			Frame.Lateral = Frame.Dir.Cross(UpVector()).Normalized();
			Frame.CenterlineRadius = Hoop.RimCenterlineRadius();
			return Frame;
		}

		// Alvo (no plano do aro) para cada tentativa. Attempt 0 = alvo "ideal"; os seguintes variam.
		Vec3 TargetFor(const ShotFrame& Frame, const ShotDecision& Decision, int Attempt, double Jitter)
		{
			const double Rc = Frame.CenterlineRadius;
			if (Decision.bMake)
			{
				// Profundidade ideal: um pouco atrás do centro (referência "45° / 11 polegadas").
				static const double MakeOffsets[] = {0.03, 0.0, 0.045, -0.02, 0.015, 0.06, -0.035, 0.075, -0.05, 0.09};
				const double Along = MakeOffsets[Attempt % 10];
				return Frame.RimCenter + Frame.Dir * Along + Frame.Lateral * (Jitter * 0.02);
			}

			// Erros: empurra para fora a cada tentativa até a simulação confirmar o erro.
			const double Push = 1.0 + 0.25 * static_cast<double>(Attempt);
			switch (Decision.Miss)
			{
			case MissType::Short:
				return Frame.RimCenter - Frame.Dir * ((Rc - 0.035) * Push) + Frame.Lateral * (Jitter * 0.03);
			case MissType::Long:
				return Frame.RimCenter + Frame.Dir * ((Rc - 0.025) * Push) + Frame.Lateral * (Jitter * 0.03);
			case MissType::Left:
				return Frame.RimCenter - Frame.Lateral * ((Rc - 0.03) * Push) + Frame.Dir * (Jitter * 0.03);
			case MissType::Right:
				return Frame.RimCenter + Frame.Lateral * ((Rc - 0.03) * Push) + Frame.Dir * (Jitter * 0.03);
			case MissType::Airball:
			case MissType::None:
			default:
				return Frame.RimCenter - Frame.Dir * (0.75 * Push) + Frame.Lateral * (Jitter * 0.25);
			}
		}
	}

	RealizedShot RealizeShot(const BallSim& Sim, const ShotDecision& Decision, const ShotRealizeParams& Params, Rng& Random)
	{
		RealizedShot Result;
		const ShotFrame Frame = MakeFrame(Sim.GetHoop(), Params.ReleasePosition);
		const double Jitter = Random.Range(-1.0, 1.0);
		const double Gravity = Sim.GetConfig().Gravity;

		// Backspin: gira em torno do eixo lateral, com o topo da bola indo para trás (contra a direção do arremesso).
		const Vec3 Spin = Frame.Lateral * (Params.BackspinRevPerSec * 2.0 * Pi);

		bool bHaveFallback = false;
		RealizedShot Fallback;

		const int MaxAttempts = Params.MaxAttempts > 0 ? Params.MaxAttempts : 1;
		for (int Attempt = 0; Attempt < MaxAttempts; ++Attempt)
		{
			const Vec3 Target = TargetFor(Frame, Decision, Attempt, Jitter);
			// Se o alvo exige, sobe o arco um pouco em tentativas posteriores.
			const double AngleDeg = Params.LaunchAngleDeg + (Decision.bMake ? static_cast<double>(Attempt / 4) * 3.0 : 0.0);
			const LaunchSolution Launch = SolveLaunch(Params.ReleasePosition, Target, DegToRad(AngleDeg), Gravity);
			if (!Launch.bValid)
			{
				continue;
			}

			BallState Initial;
			Initial.Position = Params.ReleasePosition;
			Initial.Velocity = Launch.Velocity;
			Initial.AngularVelocity = Spin;

			const FlightSummary Flight = SimulateFlight(Sim, Initial, 5.0);

			RealizedShot Candidate;
			Candidate.Initial = Initial;
			Candidate.bScored = Flight.Scored;
			Candidate.bMatchesDecision = Flight.Scored == Decision.bMake;
			Candidate.Attempts = Attempt + 1;
			Candidate.Flight = Flight;

			if (Candidate.bMatchesDecision)
			{
				return Candidate;
			}
			if (!bHaveFallback)
			{
				Fallback = Candidate;
				bHaveFallback = true;
			}
		}

		if (bHaveFallback)
		{
			Fallback.Attempts = MaxAttempts;
			return Fallback;
		}
		return Result;
	}
}
