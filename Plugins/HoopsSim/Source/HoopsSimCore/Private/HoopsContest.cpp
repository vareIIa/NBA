#include "HoopsSimCore/HoopsContest.h"

namespace Hoops
{
	namespace
	{
		// Alcance em pé (chão até a ponta dos dedos com o braço esticado). Calibrado com medidas de combine:
		// 2,01 m de altura e 2,11 m de envergadura => ~2,66 m.
		double StandingReach(const DefenderPose& Defender)
		{
			return Defender.Height * 0.80 + Defender.Wingspan * 0.5;
		}

		double SmoothStep01(double Value)
		{
			const double T = Clamp(Value, 0.0, 1.0);
			return T * T * (3.0 - 2.0 * T);
		}

		Vec3 ClosestPointOnSegment(const Vec3& Point, const Vec3& A, const Vec3& B)
		{
			const Vec3 AB = B - A;
			const double LenSq = AB.LengthSquared();
			if (LenSq < 1e-12)
			{
				return A;
			}
			const double T = Clamp((Point - A).Dot(AB) / LenSq, 0.0, 1.0);
			return A + AB * T;
		}
	}

	Vec3 DefenderHandPosition(const DefenderPose& Defender, const Vec3& ShooterPosition, const ContestConfig& Config)
	{
		const double Reach = StandingReach(Defender);
		// Mãos baixas ~ altura do ombro; mãos para cima = alcance em pé.
		const double ShoulderHeight = Defender.Height * 0.82;
		const double HandZ = Lerp(ShoulderHeight, Reach, Clamp(Defender.HandsUpAmount, 0.0, 1.0)) + Defender.JumpHeight;
		const Vec3 ToShooter = (ShooterPosition - Defender.FeetPosition).Flat().Normalized();
		const Vec3 Horizontal = Defender.FeetPosition.Flat() + ToShooter * Config.ArmReachForward;
		return Vec3(Horizontal.X, Horizontal.Y, Defender.FeetPosition.Z + HandZ);
	}

	ContestBreakdown ComputeContest(const DefenderPose& Defender, const Vec3& ShooterFeet,
		const Vec3& ReleasePosition, const Vec3& RimCenter, const ContestConfig& Config)
	{
		ContestBreakdown Result;
		Result.HandPosition = DefenderHandPosition(Defender, ShooterFeet, Config);

		// Trecho inicial da trajetória (subida da bola): reta da soltura em direção ao aro, inclinada para cima.
		const Vec3 ToRim = RimCenter - ReleasePosition;
		const Vec3 FlatDir = ToRim.Flat().Normalized();
		const Vec3 PathDir = (FlatDir + UpVector() * 1.0).Normalized(); // ~45° de subida no início
		const Vec3 PathEnd = ReleasePosition + PathDir * Config.PathLength;
		Result.ClosestPathPoint = ClosestPointOnSegment(Result.HandPosition, ReleasePosition, PathEnd);
		Result.HandToPathMeters = Distance(Result.HandPosition, Result.ClosestPathPoint);

		const double Span = Config.ZeroContestDistance - Config.FullContestDistance;
		Result.Proximity = 1.0 - SmoothStep01((Result.HandToPathMeters - Config.FullContestDistance) / (Span > 1e-6 ? Span : 1e-6));

		// Cobertura angular: defensor entre o arremessador e o aro cobre mais que vindo de lado ou de trás.
		const Vec3 ShotDir = (RimCenter - ShooterFeet).Flat().Normalized();
		const Vec3 ToDefender = (Defender.FeetPosition - ShooterFeet).Flat().Normalized();
		const double Facing = ShotDir.Dot(ToDefender); // 1 = de frente, 0 = lado, -1 = atrás
		Result.Angular = Facing >= 0.0 ? Lerp(0.6, 1.0, Facing) : Lerp(0.6, 0.3, -Facing);

		// Altura: mão acima do ponto de soltura cobre bem; bem abaixo, pouco.
		const double HandAboveRelease = Result.HandPosition.Z - ReleasePosition.Z;
		Result.HeightFactor = Lerp(0.3, 1.0, Clamp((HandAboveRelease + 0.5) / 0.7, 0.0, 1.0));

		Result.RatingFactor = 0.85 + 0.30 * Clamp((Defender.PerimeterDefense - 25.0) / 74.0, 0.0, 1.0);

		Result.Contest = Clamp(Result.Proximity * Result.Angular * Result.HeightFactor * Result.RatingFactor, 0.0, 1.0);
		return Result;
	}
}
