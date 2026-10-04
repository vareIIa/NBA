#pragma once

#include "HoopsSimCore/HoopsMath.h"
#include "HoopsSimCore/HoopsRandom.h"

#include <cstdint>

// Modelo de arremesso (docs/03-arremessos.md):
//  - A janela de timing é calculada UMA vez, no gather, e fica travada (não muda no ar).
//  - Green (Perfeito) livre = cesta garantida. Contestação age só no log-odds L.
//  - Tudo é tunável via ShotTuning (sem recompilar na UE: virar DataAsset).
namespace Hoops
{
	enum class ShotType : uint8_t
	{
		SpotUp,    // catch & shoot / parado com os pés posicionados
		PullUp,    // pull-up saindo do drible (inclui dribble pull-up em movimento)
		StepBack,
		Fadeaway,
		Floater,
		Hook,
		Heave,
		FreeThrow,
		Layup,
		Dunk,
	};

	enum class ReleaseSpeed : uint8_t
	{
		Quick,
		Normal,
		Slow,
	};

	enum class TimingGrade : uint8_t
	{
		Green,        // Perfeito
		Good,
		SlightlyEarly,
		SlightlyLate,
		VeryEarly,
		VeryLate,
	};

	enum class CoverageGrade : uint8_t
	{
		WideOpen,  // < 0.15
		Light,     // 0.15–0.40
		Contested, // 0.40–0.70
		Smothered, // > 0.70
	};

	enum class MissType : uint8_t
	{
		None,
		Short,  // aro da frente
		Long,   // aro de trás / tabela
		Left,
		Right,
		Airball,
	};

	struct ShotTuning
	{
		// Faixas de timing em relação à janela Perfeito (meia-largura).
		double GoodWindowScale = 2.3;
		double SlightWindowScale = 4.0;
		double MinPerfectHalfWindowMs = 25.0; // piso rígido: 3 frames a 60 Hz
		double PerfectWindowScale = 1.0;      // multiplicador geral (ajustável no editor pelo jogador/designer)

		// Efeito em log-odds (relativo ao "Bom", que é a referência da tabela base).
		double GreenBonus = 2.5;
		double GoodBonus = 0.0;
		double SlightPenalty = -0.3;
		double VeryPenalty = -1.5;

		double ContestWeight = 1.8;    // K_c
		double FatigueWeight = 0.8;    // K_f
		double BalanceWeight = 0.7;    // K_b
		double MaxTraitBonus = 0.4;    // soma dos Estilos limitada a ±0.4
		double GuaranteedMaxContest = 0.30; // green abaixo disso = cesta garantida

		double MinProbability = 0.01;
		double MaxProbability = 0.97; // teto quando NÃO é garantida

		double DeepPenaltyPerMeter = 0.35; // além da linha de 3
		double MeterOffWindowScale = 1.10;

		// Tempo do gather até o ponto ideal de soltura (ms), por velocidade de soltura.
		double IdealReleaseMsQuick = 480.0;
		double IdealReleaseMsNormal = 560.0;
		double IdealReleaseMsSlow = 640.0;
		// Segurar o botão até aqui depois do ideal => soltura automática (muito tarde).
		double AutoReleaseAfterIdealMs = 250.0;
		// Toque mais curto que isso = pump fake.
		double PumpFakeMaxHoldMs = 120.0;
	};

	// Tudo o que é conhecido no GATHER (antes de sair do chão).
	struct ShotContext
	{
		double Rating = 75.0;          // atributo relevante (3PT, Mid-Range, Close, Free Throw)
		double DistanceMeters = 7.3;   // distância horizontal até o centro do aro
		bool bIsThree = true;
		double ThreePointDistance = 7.24; // para a penalidade de arremesso muito longo
		ShotType Type = ShotType::SpotUp;
		ReleaseSpeed Speed = ReleaseSpeed::Normal;
		double Fatigue = 0.0;          // 0 = descansado, 1 = exausto
		double Balance = 1.0;          // 1 = pés posicionados, 0 = totalmente desequilibrado
		double TraitBonus = 0.0;       // soma dos Estilos (limitada por MaxTraitBonus)
		bool bMeterOff = false;
	};

	// Janela travada no gather (meias-larguras em ms).
	struct TimingWindows
	{
		double IdealReleaseMs = 560.0; // tempo do gather até o ponto ideal
		double PerfectHalfMs = 30.0;
		double GoodHalfMs = 69.0;
		double SlightHalfMs = 120.0;
	};

	struct ShotEvaluation
	{
		TimingGrade Timing = TimingGrade::Good;
		CoverageGrade Coverage = CoverageGrade::WideOpen;
		double TimingOffsetMs = 0.0; // negativo = cedo, positivo = tarde
		double Contest = 0.0;
		double Logit = 0.0;
		double Probability = 0.0;
		bool bGuaranteed = false;
	};

	struct ShotDecision
	{
		bool bMake = false;
		MissType Miss = MissType::None;
	};

	class HOOPSSIMCORE_API ShotModel
	{
	public:
		explicit ShotModel(const ShotTuning& InTuning = ShotTuning()) : Tuning(InTuning) {}

		const ShotTuning& GetTuning() const { return Tuning; }

		// Meia-largura base da janela Perfeito para um rating (99 → 70 ms, 85 → 50, 70 → 40, 50 → 30).
		static double BasePerfectHalfWindowMs(double Rating);

		// Chance base (soltura "Boa", livre) pela tabela de rating, distância e tipo.
		double BaseProbability(const ShotContext& Context) const;

		TimingWindows ComputeWindows(const ShotContext& Context) const;

		TimingGrade GradeTiming(double TimingOffsetMs, const TimingWindows& Windows) const;

		static CoverageGrade GradeCoverage(double Contest);

		// Avalia o arremesso na soltura. HoldMs = tempo do gather até soltar o botão.
		ShotEvaluation Evaluate(const ShotContext& Context, const TimingWindows& Windows, double HoldMs, double Contest) const;

		// Decide cesta/erro (determinístico com a Rng) e o tipo de erro coerente com o feedback.
		ShotDecision Decide(const ShotEvaluation& Evaluation, Rng& Random) const;

		// Fadiga a partir da energia (0..1): começa a doer abaixo de 40%.
		static double FatigueFromEnergy(double Energy) { return Clamp((0.4 - Energy) / 0.4, 0.0, 1.0); }

	private:
		ShotTuning Tuning;
	};

	// Texto curto (pt-BR) para HUD e logs.
	HOOPSSIMCORE_API const char* TimingGradeLabel(TimingGrade Grade);
	HOOPSSIMCORE_API const char* CoverageGradeLabel(CoverageGrade Grade);
	HOOPSSIMCORE_API const char* ShotTypeLabel(ShotType Type);
}
