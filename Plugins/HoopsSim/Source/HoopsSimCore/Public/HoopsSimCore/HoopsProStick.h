#pragma once

#include "HoopsSimCore/HoopsMath.h"

#include <cstdint>

// Reconhecedor de gestos do Pro Stick (analógico direito), no modelo do NBA 2K23 (docs/02-controles.md §2):
// toque (flick), segurar, giro completo, quarto de círculo, "double throw" (mesma direção 2x) e "switchback".
// Entrada: amostras do stick já na orientação ABSOLUTA (cima = para onde o jogador ataca, X = direita do jogador).
namespace Hoops
{
	enum class StickDir : uint8_t
	{
		Up,
		UpRight,
		Right,
		DownRight,
		Down,
		DownLeft,
		Left,
		UpLeft,
	};

	enum class StickGestureKind : uint8_t
	{
		Flick,         // vai e volta ao centro rápido
		Hold,          // segurou numa direção
		HoldRelease,   // soltou depois de um Hold
		Rotation,      // giro (spin)
		QuarterCircle, // quarto de círculo (half-spin)
		DoubleThrow,   // dois flicks na mesma direção (emitido junto com o 2º Flick)
		Switchback,    // flick e depois o oposto (emitido junto com o 2º Flick)
	};

	struct StickGesture
	{
		StickGestureKind Kind = StickGestureKind::Flick;
		StickDir Dir = StickDir::Up;       // direção principal (no Switchback: a segunda)
		StickDir FirstDir = StickDir::Up;  // no DoubleThrow/Switchback: a primeira
		bool bClockwise = false;           // Rotation/QuarterCircle
		double SweepDegrees = 0.0;
		double Time = 0.0;
	};

	struct ProStickConfig
	{
		double DeadZone = 0.25;
		double ActiveZone = 0.70;
		double FlickMaxSeconds = 0.22;
		double HoldSeconds = 0.20;
		double ComboGapSeconds = 0.30;  // entre dois flicks para virar DoubleThrow/Switchback
		double RotationMinDegrees = 230.0;
		double QuarterMinDegrees = 65.0;
		double QuarterMaxDegrees = 160.0;
		double HoldMaxSweepDegrees = 45.0;
	};

	HOOPSSIMCORE_API StickDir DirFromVector(double X, double Y);
	HOOPSSIMCORE_API StickDir MirrorDir(StickDir Dir); // espelha esquerda/direita (bola na mão esquerda)
	HOOPSSIMCORE_API bool AreOpposite(StickDir A, StickDir B);
	HOOPSSIMCORE_API const char* StickDirLabel(StickDir Dir);

	class HOOPSSIMCORE_API ProStickRecognizer
	{
	public:
		static constexpr int MaxGesturesPerUpdate = 3;

		explicit ProStickRecognizer(const ProStickConfig& InConfig = ProStickConfig()) : Config(InConfig) {}

		// Uma amostra por frame. Escreve até MaxGesturesPerUpdate gestos em Out e retorna quantos.
		int Update(double Time, double X, double Y, StickGesture* Out);

		void Reset();

		bool IsHolding() const { return bActive && bHoldEmitted; }
		StickDir GetHoldDir() const { return HoldDir; }

	private:
		ProStickConfig Config;

		bool bActive = false;
		bool bHoldEmitted = false;
		double ActiveStartTime = 0.0;
		double LastAngleDeg = 0.0;
		double SweepDeg = 0.0;
		double PeakMagnitude = 0.0;
		StickDir PeakDir = StickDir::Up;
		StickDir HoldDir = StickDir::Up;

		bool bHasLastFlick = false;
		double LastFlickTime = -1000.0;
		StickDir LastFlickDir = StickDir::Up;
	};
}
