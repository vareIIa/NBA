#include "HoopsSimCore/HoopsShotModel.h"

namespace Hoops
{
	namespace
	{
		struct RatingPoint
		{
			double Rating;
			double Value;
		};

		double InterpolateTable(const RatingPoint* Table, int Count, double Rating)
		{
			if (Rating <= Table[0].Rating)
			{
				return Table[0].Value;
			}
			for (int Index = 1; Index < Count; ++Index)
			{
				if (Rating <= Table[Index].Rating)
				{
					const RatingPoint& A = Table[Index - 1];
					const RatingPoint& B = Table[Index];
					const double Alpha = (Rating - A.Rating) / (B.Rating - A.Rating);
					return Lerp(A.Value, B.Value, Alpha);
				}
			}
			return Table[Count - 1].Value;
		}

		// Chance com soltura "Boa", livre (docs/03 §3.1).
		const RatingPoint ThreePointTable[] = {{40.0, 0.18}, {60.0, 0.28}, {75.0, 0.36}, {85.0, 0.42}, {99.0, 0.50}};
		const RatingPoint MidRangeTable[] = {{40.0, 0.28}, {60.0, 0.38}, {75.0, 0.45}, {85.0, 0.50}, {99.0, 0.56}};
		const RatingPoint CloseTable[] = {{40.0, 0.40}, {60.0, 0.48}, {75.0, 0.55}, {85.0, 0.60}, {99.0, 0.66}};
		const RatingPoint FreeThrowTable[] = {{40.0, 0.50}, {60.0, 0.62}, {75.0, 0.72}, {85.0, 0.80}, {99.0, 0.88}};
		// Bandeja/enterrada livres (sem contato): quase sempre entram, como no 2K23.
		const RatingPoint LayupTable[] = {{40.0, 0.70}, {60.0, 0.80}, {75.0, 0.87}, {85.0, 0.91}, {99.0, 0.96}};
		const RatingPoint DunkTable[] = {{40.0, 0.88}, {60.0, 0.93}, {75.0, 0.96}, {85.0, 0.97}, {99.0, 0.99}};
		const RatingPoint PerfectWindowTable[] = {{50.0, 18.0}, {70.0, 24.0}, {85.0, 30.0}, {99.0, 45.0}};

		constexpr int TableSize = 5;

		double TypeDifficulty(ShotType Type)
		{
			switch (Type)
			{
			case ShotType::SpotUp: return 1.0;
			case ShotType::PullUp: return 0.875;
			case ShotType::StepBack: return 0.80;
			case ShotType::Fadeaway: return 0.75;
			case ShotType::Floater: return 0.80;
			case ShotType::Hook: return 0.85;
			case ShotType::Heave: return 0.25;
			case ShotType::FreeThrow: return 1.0;
			case ShotType::Layup: return 1.0;
			case ShotType::Dunk: return 1.0;
			}
			return 1.0;
		}

		double TypeWindowScale(ShotType Type)
		{
			switch (Type)
			{
			case ShotType::SpotUp: return 1.0;
			case ShotType::PullUp: return 0.85;
			case ShotType::StepBack: return 0.80;
			case ShotType::Fadeaway: return 0.75;
			case ShotType::Floater: return 0.85;
			case ShotType::Hook: return 0.85;
			case ShotType::Heave: return 0.30;
			case ShotType::FreeThrow: return 1.30;
			case ShotType::Layup: return 1.60;
			case ShotType::Dunk: return 1.80;
			}
			return 1.0;
		}

		double SpeedWindowScale(ReleaseSpeed Speed)
		{
			switch (Speed)
			{
			case ReleaseSpeed::Quick: return 0.85;
			case ReleaseSpeed::Normal: return 1.0;
			case ReleaseSpeed::Slow: return 1.15;
			}
			return 1.0;
		}
	}

	double ShotModel::BasePerfectHalfWindowMs(double Rating)
	{
		return InterpolateTable(PerfectWindowTable, 4, Rating);
	}

	double ShotModel::BaseProbability(const ShotContext& Context) const
	{
		double Base;
		if (Context.Type == ShotType::FreeThrow)
		{
			Base = InterpolateTable(FreeThrowTable, TableSize, Context.Rating);
		}
		else if (Context.Type == ShotType::Layup)
		{
			Base = InterpolateTable(LayupTable, TableSize, Context.Rating);
		}
		else if (Context.Type == ShotType::Dunk)
		{
			Base = InterpolateTable(DunkTable, TableSize, Context.Rating);
		}
		else if (Context.bIsThree)
		{
			Base = InterpolateTable(ThreePointTable, TableSize, Context.Rating);
		}
		else if (Context.DistanceMeters < 3.0)
		{
			Base = InterpolateTable(CloseTable, TableSize, Context.Rating);
		}
		else
		{
			Base = InterpolateTable(MidRangeTable, TableSize, Context.Rating);
		}
		return Base * TypeDifficulty(Context.Type);
	}

	TimingWindows ShotModel::ComputeWindows(const ShotContext& Context) const
	{
		TimingWindows Windows;

		switch (Context.Speed)
		{
		case ReleaseSpeed::Quick: Windows.IdealReleaseMs = Tuning.IdealReleaseMsQuick; break;
		case ReleaseSpeed::Normal: Windows.IdealReleaseMs = Tuning.IdealReleaseMsNormal; break;
		case ReleaseSpeed::Slow: Windows.IdealReleaseMs = Tuning.IdealReleaseMsSlow; break;
		}

		double Half = BasePerfectHalfWindowMs(Context.Rating);
		Half *= TypeWindowScale(Context.Type);
		Half *= SpeedWindowScale(Context.Speed);
		Half *= 1.0 - 0.30 * Clamp(Context.Fatigue, 0.0, 1.0);
		if (Context.bMeterOff)
		{
			Half *= Tuning.MeterOffWindowScale;
		}
		if (Half < Tuning.MinPerfectHalfWindowMs)
		{
			Half = Tuning.MinPerfectHalfWindowMs;
		}

		Windows.PerfectHalfMs = Half;
		Windows.GoodHalfMs = Half * Tuning.GoodWindowScale;
		Windows.SlightHalfMs = Half * Tuning.SlightWindowScale;
		return Windows;
	}

	TimingGrade ShotModel::GradeTiming(double TimingOffsetMs, const TimingWindows& Windows) const
	{
		const double Abs = TimingOffsetMs < 0.0 ? -TimingOffsetMs : TimingOffsetMs;
		const bool bEarly = TimingOffsetMs < 0.0;
		if (Abs <= Windows.PerfectHalfMs)
		{
			return TimingGrade::Green;
		}
		if (Abs <= Windows.GoodHalfMs)
		{
			return TimingGrade::Good;
		}
		if (Abs <= Windows.SlightHalfMs)
		{
			return bEarly ? TimingGrade::SlightlyEarly : TimingGrade::SlightlyLate;
		}
		return bEarly ? TimingGrade::VeryEarly : TimingGrade::VeryLate;
	}

	CoverageGrade ShotModel::GradeCoverage(double Contest)
	{
		if (Contest < 0.15)
		{
			return CoverageGrade::WideOpen;
		}
		if (Contest < 0.40)
		{
			return CoverageGrade::Light;
		}
		if (Contest < 0.70)
		{
			return CoverageGrade::Contested;
		}
		return CoverageGrade::Smothered;
	}

	ShotEvaluation ShotModel::Evaluate(const ShotContext& Context, const TimingWindows& Windows, double HoldMs, double Contest) const
	{
		ShotEvaluation Result;
		Result.Contest = Clamp(Contest, 0.0, 1.0);
		Result.TimingOffsetMs = HoldMs - Windows.IdealReleaseMs;
		Result.Timing = GradeTiming(Result.TimingOffsetMs, Windows);
		Result.Coverage = GradeCoverage(Result.Contest);

		double Logit = LogitOf(BaseProbability(Context));

		// Arremesso muito além da linha de 3.
		if (Context.bIsThree && Context.Type != ShotType::Heave)
		{
			const double Beyond = Context.DistanceMeters - (Context.ThreePointDistance + 0.6);
			if (Beyond > 0.0)
			{
				Logit -= Tuning.DeepPenaltyPerMeter * Beyond;
			}
		}

		switch (Result.Timing)
		{
		case TimingGrade::Green: Logit += Tuning.GreenBonus; break;
		case TimingGrade::Good: Logit += Tuning.GoodBonus; break;
		case TimingGrade::SlightlyEarly:
		case TimingGrade::SlightlyLate: Logit += Tuning.SlightPenalty; break;
		case TimingGrade::VeryEarly:
		case TimingGrade::VeryLate: Logit += Tuning.VeryPenalty; break;
		}

		Logit -= Tuning.ContestWeight * Result.Contest;
		Logit -= Tuning.FatigueWeight * Clamp(Context.Fatigue, 0.0, 1.0);
		Logit -= Tuning.BalanceWeight * (1.0 - Clamp(Context.Balance, 0.0, 1.0));
		Logit += Clamp(Context.TraitBonus, -Tuning.MaxTraitBonus, Tuning.MaxTraitBonus);

		Result.Logit = Logit;
		Result.bGuaranteed = Result.Timing == TimingGrade::Green
			&& Result.Contest < Tuning.GuaranteedMaxContest
			&& Context.Type != ShotType::Heave;

		if (Result.bGuaranteed)
		{
			Result.Probability = 1.0;
		}
		else
		{
			const double MaxP = Context.Type == ShotType::Heave ? 0.25 : Tuning.MaxProbability;
			Result.Probability = Clamp(Sigmoid(Logit), Tuning.MinProbability, MaxP);
		}
		return Result;
	}

	ShotDecision ShotModel::Decide(const ShotEvaluation& Evaluation, Rng& Random) const
	{
		ShotDecision Decision;
		// Sorteio sempre consumido, para a sequência da Rng não depender do resultado.
		const double Roll = Random.NextDouble();
		const double SideRoll = Random.NextDouble();

		Decision.bMake = Evaluation.bGuaranteed || Roll < Evaluation.Probability;
		if (Decision.bMake)
		{
			return Decision;
		}

		const bool bVeryBad = Evaluation.Timing == TimingGrade::VeryEarly || Evaluation.Timing == TimingGrade::VeryLate;
		if (bVeryBad && Evaluation.Contest > 0.70 && SideRoll < 0.35)
		{
			Decision.Miss = MissType::Airball;
			return Decision;
		}

		switch (Evaluation.Timing)
		{
		case TimingGrade::SlightlyEarly:
		case TimingGrade::VeryEarly:
			// Cedo: arco alto, tende a sair curto.
			Decision.Miss = SideRoll < 0.70 ? MissType::Short : (SideRoll < 0.85 ? MissType::Left : MissType::Right);
			break;
		case TimingGrade::SlightlyLate:
		case TimingGrade::VeryLate:
			// Tarde: arco achatado, tende a sair longo.
			Decision.Miss = SideRoll < 0.70 ? MissType::Long : (SideRoll < 0.85 ? MissType::Left : MissType::Right);
			break;
		default:
			// Bom (ou green contestado) que não caiu: erro "de aro" variado.
			if (SideRoll < 0.30) { Decision.Miss = MissType::Short; }
			else if (SideRoll < 0.60) { Decision.Miss = MissType::Long; }
			else if (SideRoll < 0.80) { Decision.Miss = MissType::Left; }
			else { Decision.Miss = MissType::Right; }
			break;
		}
		return Decision;
	}

	const char* TimingGradeLabel(TimingGrade Grade)
	{
		switch (Grade)
		{
		case TimingGrade::Green: return "GREEN";
		case TimingGrade::Good: return "BOM";
		case TimingGrade::SlightlyEarly: return "LEVE CEDO";
		case TimingGrade::SlightlyLate: return "LEVE TARDE";
		case TimingGrade::VeryEarly: return "MUITO CEDO";
		case TimingGrade::VeryLate: return "MUITO TARDE";
		}
		return "?";
	}

	const char* CoverageGradeLabel(CoverageGrade Grade)
	{
		switch (Grade)
		{
		case CoverageGrade::WideOpen: return "LIVRE";
		case CoverageGrade::Light: return "LEVE";
		case CoverageGrade::Contested: return "CONTESTADO";
		case CoverageGrade::Smothered: return "SUFOCADO";
		}
		return "?";
	}

	const char* ShotTypeLabel(ShotType Type)
	{
		switch (Type)
		{
		case ShotType::SpotUp: return "Spot-up";
		case ShotType::PullUp: return "Pull-up";
		case ShotType::StepBack: return "Step-back";
		case ShotType::Fadeaway: return "Fadeaway";
		case ShotType::Floater: return "Floater";
		case ShotType::Hook: return "Hook";
		case ShotType::Heave: return "Heave";
		case ShotType::FreeThrow: return "Lance livre";
		case ShotType::Layup: return "Bandeja";
		case ShotType::Dunk: return "Enterrada";
		}
		return "?";
	}
}
