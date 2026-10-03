#include "HoopsSimCore/HoopsProStick.h"

#include <cmath>

namespace Hoops
{
	StickDir DirFromVector(double X, double Y)
	{
		const double AngleDeg = RadToDeg(std::atan2(Y, X)); // 90 = cima
		int Index = static_cast<int>(std::lround((90.0 - AngleDeg) / 45.0));
		Index = ((Index % 8) + 8) % 8;
		return static_cast<StickDir>(Index);
	}

	StickDir MirrorDir(StickDir Dir)
	{
		// Índice i (cima=0, horário) espelhado no eixo vertical: (8 - i) % 8.
		const int Index = static_cast<int>(Dir);
		return static_cast<StickDir>((8 - Index) % 8);
	}

	bool AreOpposite(StickDir A, StickDir B)
	{
		const int Diff = ((static_cast<int>(A) - static_cast<int>(B)) % 8 + 8) % 8;
		return Diff >= 3 && Diff <= 5;
	}

	const char* StickDirLabel(StickDir Dir)
	{
		switch (Dir)
		{
		case StickDir::Up: return "cima";
		case StickDir::UpRight: return "cima-dir";
		case StickDir::Right: return "dir";
		case StickDir::DownRight: return "baixo-dir";
		case StickDir::Down: return "baixo";
		case StickDir::DownLeft: return "baixo-esq";
		case StickDir::Left: return "esq";
		case StickDir::UpLeft: return "cima-esq";
		}
		return "?";
	}

	void ProStickRecognizer::Reset()
	{
		bActive = false;
		bHoldEmitted = false;
		SweepDeg = 0.0;
		PeakMagnitude = 0.0;
		bHasLastFlick = false;
	}

	int ProStickRecognizer::Update(double Time, double X, double Y, StickGesture* Out)
	{
		int Count = 0;
		const double Magnitude = std::sqrt(X * X + Y * Y);
		const double AngleDeg = RadToDeg(std::atan2(Y, X));

		if (!bActive)
		{
			if (Magnitude >= Config.ActiveZone)
			{
				bActive = true;
				bHoldEmitted = false;
				ActiveStartTime = Time;
				LastAngleDeg = AngleDeg;
				SweepDeg = 0.0;
				PeakMagnitude = Magnitude;
				PeakDir = DirFromVector(X, Y);
			}
			return Count;
		}

		// Ativo: acumula a varredura angular enquanto fora da zona morta.
		if (Magnitude > Config.DeadZone)
		{
			double Delta = AngleDeg - LastAngleDeg;
			while (Delta > 180.0) { Delta -= 360.0; }
			while (Delta < -180.0) { Delta += 360.0; }
			SweepDeg += Delta;
			LastAngleDeg = AngleDeg;
			if (Magnitude > PeakMagnitude)
			{
				PeakMagnitude = Magnitude;
				// Para flicks, a direção do pico é a direção "pretendida".
				if (std::fabs(SweepDeg) < Config.QuarterMinDegrees)
				{
					PeakDir = DirFromVector(X, Y);
				}
			}

			const double Elapsed = Time - ActiveStartTime;
			if (!bHoldEmitted && Elapsed >= Config.HoldSeconds && std::fabs(SweepDeg) < Config.HoldMaxSweepDegrees
				&& Magnitude >= Config.ActiveZone)
			{
				bHoldEmitted = true;
				HoldDir = DirFromVector(X, Y);
				StickGesture& Gesture = Out[Count++];
				Gesture = StickGesture();
				Gesture.Kind = StickGestureKind::Hold;
				Gesture.Dir = HoldDir;
				Gesture.Time = Time;
			}
			return Count;
		}

		// Voltou ao centro: classifica.
		bActive = false;
		const double Elapsed = Time - ActiveStartTime;
		const double AbsSweep = std::fabs(SweepDeg);
		const bool bClockwise = SweepDeg < 0.0;

		if (bHoldEmitted)
		{
			StickGesture& Gesture = Out[Count++];
			Gesture = StickGesture();
			Gesture.Kind = StickGestureKind::HoldRelease;
			Gesture.Dir = HoldDir;
			Gesture.Time = Time;
			bHoldEmitted = false;
			return Count;
		}

		if (AbsSweep >= Config.RotationMinDegrees)
		{
			StickGesture& Gesture = Out[Count++];
			Gesture = StickGesture();
			Gesture.Kind = StickGestureKind::Rotation;
			Gesture.bClockwise = bClockwise;
			Gesture.SweepDegrees = AbsSweep;
			Gesture.Dir = PeakDir;
			Gesture.Time = Time;
			return Count;
		}

		if (AbsSweep >= Config.QuarterMinDegrees && AbsSweep <= Config.QuarterMaxDegrees)
		{
			StickGesture& Gesture = Out[Count++];
			Gesture = StickGesture();
			Gesture.Kind = StickGestureKind::QuarterCircle;
			Gesture.bClockwise = bClockwise;
			Gesture.SweepDegrees = AbsSweep;
			Gesture.Dir = PeakDir;
			Gesture.Time = Time;
			return Count;
		}

		if (Elapsed <= Config.FlickMaxSeconds)
		{
			StickGesture& Flick = Out[Count++];
			Flick = StickGesture();
			Flick.Kind = StickGestureKind::Flick;
			Flick.Dir = PeakDir;
			Flick.Time = Time;

			if (bHasLastFlick && (Time - LastFlickTime) <= Config.ComboGapSeconds)
			{
				if (LastFlickDir == PeakDir)
				{
					StickGesture& Combo = Out[Count++];
					Combo = StickGesture();
					Combo.Kind = StickGestureKind::DoubleThrow;
					Combo.Dir = PeakDir;
					Combo.FirstDir = LastFlickDir;
					Combo.Time = Time;
				}
				else if (AreOpposite(LastFlickDir, PeakDir))
				{
					StickGesture& Combo = Out[Count++];
					Combo = StickGesture();
					Combo.Kind = StickGestureKind::Switchback;
					Combo.Dir = PeakDir;
					Combo.FirstDir = LastFlickDir;
					Combo.Time = Time;
				}
				bHasLastFlick = false; // um combo consome o par
			}
			else
			{
				bHasLastFlick = true;
				LastFlickTime = Time;
				LastFlickDir = PeakDir;
			}
		}
		return Count;
	}
}
