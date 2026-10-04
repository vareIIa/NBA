// Conversão entre a Unreal (centímetros) e o núcleo HoopsSimCore (metros). Os eixos são os mesmos (Z para cima).
#pragma once

#include "CoreMinimal.h"
#include "HoopsSimCore/HoopsMath.h"

namespace HoopsUnits
{
	inline Hoops::Vec3 ToSim(const FVector& Cm) { return Hoops::Vec3(Cm.X / 100.0, Cm.Y / 100.0, Cm.Z / 100.0); }
	inline FVector ToUnreal(const Hoops::Vec3& Meters) { return FVector(Meters.X * 100.0, Meters.Y * 100.0, Meters.Z * 100.0); }
	// Direção/velocidade sem escala de posição (para vetores unitários).
	inline Hoops::Vec3 DirToSim(const FVector& Dir) { return Hoops::Vec3(Dir.X, Dir.Y, Dir.Z); }
	inline FVector DirToUnreal(const Hoops::Vec3& Dir) { return FVector(Dir.X, Dir.Y, Dir.Z); }
}
