#pragma once

#include "HoopsSimCore/HoopsBallSim.h"
#include "HoopsSimCore/HoopsShotModel.h"

namespace Hoops
{
	struct LaunchSolution
	{
		bool bValid = false;
		Vec3 Velocity;
	};

	// Velocidade inicial para a bola sair de From e passar por To com o ângulo de lançamento dado
	// (acima da horizontal), sem arrasto. Inválida se o ângulo for baixo demais para alcançar o alvo.
	HOOPSSIMCORE_API LaunchSolution SolveLaunch(const Vec3& From, const Vec3& To, double LaunchAngleRad, double Gravity = DefaultGravity);

	struct ShotRealizeParams
	{
		Vec3 ReleasePosition;
		double LaunchAngleDeg = 50.0; // 45–55° é a faixa realista; o timing muda o arco (cedo = alto, tarde = achatado)
		double BackspinRevPerSec = 3.0;
		int MaxAttempts = 10;
	};

	struct RealizedShot
	{
		BallState Initial;     // estado da bola na soltura
		bool bScored = false;  // resultado verificado na simulação
		bool bMatchesDecision = false;
		int Attempts = 0;
		FlightSummary Flight;
	};

	// Transforma a decisão (cesta/erro + tipo de erro) numa trajetória física crível,
	// verificando com a simulação determinística e ajustando o alvo se preciso.
	HOOPSSIMCORE_API RealizedShot RealizeShot(const BallSim& Sim, const ShotDecision& Decision, const ShotRealizeParams& Params, Rng& Random);

	// Ângulo de lançamento sugerido pelo timing (arco como leitura do timing, igual ao 2K23).
	HOOPSSIMCORE_API double LaunchAngleForTiming(double BaseAngleDeg, TimingGrade Grade);
}
