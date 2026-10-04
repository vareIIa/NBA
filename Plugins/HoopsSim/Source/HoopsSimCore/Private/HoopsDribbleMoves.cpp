#include "HoopsSimCore/HoopsDribbleMoves.h"

namespace Hoops
{
	namespace
	{
		DribbleMoveSpec MakeSpec(double Duration, double Commit, int Switches, double Lateral, double Forward,
			double Energy, double Exposure)
		{
			DribbleMoveSpec Spec;
			Spec.Duration = Duration;
			Spec.CommitSeconds = Commit;
			Spec.HandSwitches = Switches;
			Spec.LateralSpeed = Lateral;
			Spec.ForwardSpeed = Forward;
			Spec.EnergyCost = Energy;
			Spec.Exposure = Exposure;
			return Spec;
		}

		struct SpecTable
		{
			DribbleMoveSpec Specs[static_cast<int>(DribbleMove::Count)];

			SpecTable()
			{
				//                                                        dur   commit sw  lat   fwd   energia  expos.
				Specs[static_cast<int>(DribbleMove::None)] =               MakeSpec(0.00, 0.00, 0, 0.0,  0.0,  0.000, 0.2);
				Specs[static_cast<int>(DribbleMove::Crossover)] =          MakeSpec(0.40, 0.12, 1, 2.2,  0.0,  0.025, 0.8);
				Specs[static_cast<int>(DribbleMove::AttackingCrossover)] = MakeSpec(0.42, 0.15, 1, 2.6,  2.2,  0.045, 0.7);
				Specs[static_cast<int>(DribbleMove::BetweenLegs)] =        MakeSpec(0.42, 0.12, 1, 1.2,  0.0,  0.025, 0.3);
				Specs[static_cast<int>(DribbleMove::BehindBack)] =         MakeSpec(0.45, 0.15, 1, 1.8,  0.0,  0.030, 0.3);
				Specs[static_cast<int>(DribbleMove::Hesitation)] =         MakeSpec(0.40, 0.08, 0, 0.0, -0.6,  0.015, 0.5);
				Specs[static_cast<int>(DribbleMove::EscapeHesitation)] =   MakeSpec(0.42, 0.10, 0, 0.0,  3.0,  0.045, 0.5);
				Specs[static_cast<int>(DribbleMove::InAndOut)] =           MakeSpec(0.38, 0.10, 0, -1.5, 0.0,  0.020, 0.6);
				Specs[static_cast<int>(DribbleMove::StepBack)] =           MakeSpec(0.50, 0.20, 0, 0.0, -3.2,  0.040, 0.4);
				Specs[static_cast<int>(DribbleMove::EscapeStepBack)] =     MakeSpec(0.50, 0.20, 0, 0.0, -3.6,  0.050, 0.4);
				Specs[static_cast<int>(DribbleMove::Spin)] =               MakeSpec(0.60, 0.25, 1, 0.0,  2.4,  0.045, 0.4);
				Specs[static_cast<int>(DribbleMove::HalfSpin)] =           MakeSpec(0.45, 0.18, 1, 0.0,  1.8,  0.030, 0.4);
				Specs[static_cast<int>(DribbleMove::DoubleCross)] =        MakeSpec(0.70, 0.15, 2, 1.5,  0.0,  0.040, 0.8);
				Specs[static_cast<int>(DribbleMove::HesiCross)] =          MakeSpec(0.60, 0.12, 1, 2.4,  0.0,  0.040, 0.7);
				Specs[static_cast<int>(DribbleMove::Retreat)] =            MakeSpec(0.45, 0.10, 0, 0.0, -2.0,  0.015, 0.3);
			}
		};

		const SpecTable& Table()
		{
			static const SpecTable Instance;
			return Instance;
		}

		// Direção relativa à mão da bola: tudo é resolvido como se a bola estivesse na mão direita.
		StickDir ToBallHandFrame(StickDir Dir, BallHand Hand) { return Hand == BallHand::Right ? Dir : MirrorDir(Dir); }
	}

	const DribbleMoveSpec& GetDribbleMoveSpec(DribbleMove Move)
	{
		const int Index = static_cast<int>(Move);
		return Table().Specs[(Index >= 0 && Index < static_cast<int>(DribbleMove::Count)) ? Index : 0];
	}

	const char* DribbleMoveLabel(DribbleMove Move)
	{
		switch (Move)
		{
		case DribbleMove::None: return "-";
		case DribbleMove::Crossover: return "Crossover";
		case DribbleMove::AttackingCrossover: return "Crossover de ataque";
		case DribbleMove::BetweenLegs: return "Entre as pernas";
		case DribbleMove::BehindBack: return "Por tras";
		case DribbleMove::Hesitation: return "Hesitacao";
		case DribbleMove::EscapeHesitation: return "Escape (hesitacao)";
		case DribbleMove::InAndOut: return "In-and-out";
		case DribbleMove::StepBack: return "Step-back";
		case DribbleMove::EscapeStepBack: return "Escape (step-back)";
		case DribbleMove::Spin: return "Spin";
		case DribbleMove::HalfSpin: return "Half-spin";
		case DribbleMove::DoubleCross: return "Double cross";
		case DribbleMove::HesiCross: return "Hesi-cross";
		case DribbleMove::Retreat: return "Retreat";
		case DribbleMove::Count: break;
		}
		return "?";
	}

	DribbleMove ResolveDribbleMove(const StickGesture& Gesture, const DribbleContext& Context)
	{
		const StickDir Dir = ToBallHandFrame(Gesture.Dir, Context.Hand);
		switch (Gesture.Kind)
		{
		case StickGestureKind::Rotation:
			return DribbleMove::Spin;
		case StickGestureKind::QuarterCircle:
			return DribbleMove::HalfSpin;
		case StickGestureKind::DoubleThrow:
			return DribbleMove::DoubleCross;
		case StickGestureKind::Switchback:
			return DribbleMove::HesiCross;
		case StickGestureKind::Flick:
			switch (Dir)
			{
			case StickDir::Up:
			case StickDir::UpLeft:
				return Context.bSprint ? DribbleMove::AttackingCrossover : DribbleMove::Crossover;
			case StickDir::Left:
				return DribbleMove::BetweenLegs;
			case StickDir::DownLeft:
				return DribbleMove::BehindBack;
			case StickDir::Right:
				return Context.bSprint ? DribbleMove::EscapeHesitation : DribbleMove::Hesitation;
			case StickDir::UpRight:
				return DribbleMove::InAndOut;
			case StickDir::Down:
				return Context.bSprint ? DribbleMove::EscapeStepBack : DribbleMove::StepBack;
			case StickDir::DownRight:
				return DribbleMove::Retreat;
			}
			return DribbleMove::None;
		case StickGestureKind::Hold:
		case StickGestureKind::HoldRelease:
			return DribbleMove::None; // Hold = arremesso/bandeja pelo Pro Stick (fora do drible)
		}
		return DribbleMove::None;
	}

	DribbleController::DribbleController(const DribbleEnergyConfig& InConfig)
		: Config(InConfig)
	{
	}

	bool DribbleController::CanCancel(double Now) const
	{
		if (!Active.IsActive(Now))
		{
			return true;
		}
		const double Rate = Active.PlayRate > 1e-6 ? Active.PlayRate : 1.0;
		return Now >= Active.StartTime + GetDribbleMoveSpec(Active.Move).CommitSeconds / Rate;
	}

	void DribbleController::Start(DribbleMove Move, double Now, bool bInRhythm)
	{
		const DribbleMoveSpec& Spec = GetDribbleMoveSpec(Move);
		Active.Move = Move;
		Active.StartTime = Now;
		Active.bInRhythm = bInRhythm;
		Active.PlayRate = (bInRhythm ? Config.ComboPlayRate : 1.0) * MovePlayRateScale();
		Active.HandAtStart = Hand;

		ComboCount = bInRhythm ? ComboCount + 1 : 1;
		if (!Config.bInfiniteEnergy)
		{
			Energy = Clamp(Energy - Spec.EnergyCost * (bInRhythm ? Config.ComboEnergyDiscount : 1.0), 0.0, 1.0);
		}
		if (Spec.HandSwitches % 2 == 1)
		{
			Hand = OtherHand(Hand);
		}
	}

	bool DribbleController::Request(DribbleMove Move, double Now)
	{
		if (Move == DribbleMove::None)
		{
			return false;
		}

		if (!Active.IsActive(Now))
		{
			// Ritmo: o input caiu logo depois do fim do anterior (dentro da janela) também conta.
			const bool bInRhythm = LastMove != DribbleMove::None
				&& (Now - LastMoveEndTime) <= GetDribbleMoveSpec(LastMove).ComboWindow;
			Start(Move, Now, bInRhythm);
			return true;
		}

		if (!CanCancel(Now))
		{
			Buffered = Move;
			BufferedTime = Now;
			return false;
		}

		// Depois do commit: cancela no próximo. Na janela de combo do fim = combo no ritmo.
		const double ComboStart = Active.EndTime() - GetDribbleMoveSpec(Active.Move).ComboWindow;
		const bool bInRhythm = Now >= ComboStart;
		LastMove = Active.Move;
		LastMoveEndTime = Now;
		Start(Move, Now, bInRhythm);
		return true;
	}

	void DribbleController::Update(double Now, double DeltaSeconds, bool bSprinting, bool bMoving)
	{
		if (Active.Move != DribbleMove::None && Now >= Active.EndTime())
		{
			LastMove = Active.Move;
			LastMoveEndTime = Active.EndTime();
			Active.Move = DribbleMove::None;
		}

		if (Buffered != DribbleMove::None)
		{
			if (Now - BufferedTime > Config.InputBufferSeconds)
			{
				Buffered = DribbleMove::None; // expirou
			}
			else if (CanCancel(Now))
			{
				const DribbleMove Next = Buffered;
				Buffered = DribbleMove::None;
				Request(Next, Now);
			}
		}

		if (Config.bInfiniteEnergy)
		{
			Energy = 1.0;
		}
		else if (bSprinting)
		{
			Energy = Clamp(Energy - Config.SprintDrainPerSecond * DeltaSeconds, 0.0, 1.0);
		}
		else if (!Active.IsActive(Now))
		{
			const double Regen = Config.RegenPerSecond * (bMoving ? Config.MovingRegenScale : 1.0);
			Energy = Clamp(Energy + Regen * DeltaSeconds, 0.0, 1.0);
		}
	}

	void DribbleController::ResetPossession()
	{
		Active = ActiveDribbleMove();
		Buffered = DribbleMove::None;
		ComboCount = 0;
	}

	double DribbleController::SpeedScale() const
	{
		if (Energy >= Config.LowEnergyThreshold || Config.LowEnergyThreshold <= 0.0)
		{
			return 1.0;
		}
		return Lerp(Config.LowEnergyMinSpeedScale, 1.0, Energy / Config.LowEnergyThreshold);
	}

	double DribbleController::MovePlayRateScale() const
	{
		if (Energy >= Config.LowEnergyThreshold || Config.LowEnergyThreshold <= 0.0)
		{
			return 1.0;
		}
		return Lerp(Config.LowEnergyMinMovePlayRate, 1.0, Energy / Config.LowEnergyThreshold);
	}
}
