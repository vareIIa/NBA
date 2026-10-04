#pragma once

#include "HoopsSimCore/HoopsMath.h"

// Contestação geométrica (docs/03-arremessos.md §3.3): o que o defensor PARECE fazer é o que conta.
// contest = proximidade(mão → linha da bola) × cobertura angular × fator de altura × fator de rating, em [0, 1].
// A camada do jogo amostra isso numa janela em torno da soltura e usa o maior valor.
namespace Hoops
{
	struct DefenderPose
	{
		Vec3 FeetPosition;           // chão sob o defensor (m)
		double Height = 2.00;        // m
		double Wingspan = 2.08;      // m
		double HandsUpAmount = 0.0;  // 0 = mãos baixas, 1 = braço todo esticado para cima
		double JumpHeight = 0.0;     // m acima do chão neste instante
		double PerimeterDefense = 75.0; // rating (25–99)
	};

	struct ContestBreakdown
	{
		double Contest = 0.0;
		double Proximity = 0.0;
		double Angular = 0.0;
		double HeightFactor = 0.0;
		double RatingFactor = 1.0;
		double HandToPathMeters = 0.0;
		Vec3 HandPosition;      // mão mais alta do defensor (para o debug do laboratório)
		Vec3 ClosestPathPoint;  // ponto da trajetória mais perto da mão
	};

	struct ContestConfig
	{
		double FullContestDistance = 0.25; // mão a até 25 cm da trajetória = contestação máxima
		double ZeroContestDistance = 1.50; // além disso, não contesta
		double PathLength = 1.40;          // trecho inicial da trajetória considerado (m)
		double ArmReachForward = 0.30;     // mão vai até 30 cm à frente do corpo na direção do arremessador
	};

	// Ponto mais alto que a mão do defensor alcança agora (m).
	HOOPSSIMCORE_API Vec3 DefenderHandPosition(const DefenderPose& Defender, const Vec3& ShooterPosition, const ContestConfig& Config = ContestConfig());

	// Contestação para uma soltura em ReleasePosition em direção a RimCenter, com o arremessador em ShooterFeet.
	HOOPSSIMCORE_API ContestBreakdown ComputeContest(const DefenderPose& Defender, const Vec3& ShooterFeet,
		const Vec3& ReleasePosition, const Vec3& RimCenter, const ContestConfig& Config = ContestConfig());
}
