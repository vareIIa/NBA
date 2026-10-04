// Núcleo de simulação do Projeto Garrafão.
// C++ puro, sem dependências da Unreal: compila no módulo HoopsSimCore (UE) e no CMake (testes).
// Unidades SI (metros, segundos, kg), eixo Z para cima, mesmo sentido de eixos da Unreal.
#pragma once

#include <cmath>

// No build modular da Unreal (Editor), a UBT define HOOPSSIMCORE_API=DLLEXPORT/DLLIMPORT, mas os .cpp do núcleo
// não incluem HAL/Platform.h. Definimos aqui exatamente como a engine define (redefinição idêntica é inofensiva).
#ifndef DLLEXPORT
	#if defined(_WIN32)
		#define DLLEXPORT __declspec(dllexport)
		#define DLLIMPORT __declspec(dllimport)
	#else
		#define DLLEXPORT __attribute__((visibility("default")))
		#define DLLIMPORT __attribute__((visibility("default")))
	#endif
#endif

#ifndef HOOPSSIMCORE_API
#define HOOPSSIMCORE_API
#endif

namespace Hoops
{
	inline constexpr double Pi = 3.14159265358979323846;
	inline constexpr double DefaultGravity = 9.81;

	inline constexpr double DegToRad(double Degrees) { return Degrees * (Pi / 180.0); }
	inline constexpr double RadToDeg(double Radians) { return Radians * (180.0 / Pi); }

	inline double Clamp(double Value, double MinValue, double MaxValue)
	{
		return Value < MinValue ? MinValue : (Value > MaxValue ? MaxValue : Value);
	}

	inline double Lerp(double A, double B, double Alpha) { return A + (B - A) * Alpha; }

	struct Vec3
	{
		double X = 0.0;
		double Y = 0.0;
		double Z = 0.0;

		constexpr Vec3() = default;
		constexpr Vec3(double InX, double InY, double InZ) : X(InX), Y(InY), Z(InZ) {}

		constexpr Vec3 operator+(const Vec3& Other) const { return Vec3(X + Other.X, Y + Other.Y, Z + Other.Z); }
		constexpr Vec3 operator-(const Vec3& Other) const { return Vec3(X - Other.X, Y - Other.Y, Z - Other.Z); }
		constexpr Vec3 operator*(double Scale) const { return Vec3(X * Scale, Y * Scale, Z * Scale); }
		constexpr Vec3 operator/(double Scale) const { return Vec3(X / Scale, Y / Scale, Z / Scale); }
		constexpr Vec3 operator-() const { return Vec3(-X, -Y, -Z); }

		Vec3& operator+=(const Vec3& Other) { X += Other.X; Y += Other.Y; Z += Other.Z; return *this; }
		Vec3& operator-=(const Vec3& Other) { X -= Other.X; Y -= Other.Y; Z -= Other.Z; return *this; }
		Vec3& operator*=(double Scale) { X *= Scale; Y *= Scale; Z *= Scale; return *this; }

		constexpr double Dot(const Vec3& Other) const { return X * Other.X + Y * Other.Y + Z * Other.Z; }
		constexpr Vec3 Cross(const Vec3& Other) const
		{
			return Vec3(Y * Other.Z - Z * Other.Y, Z * Other.X - X * Other.Z, X * Other.Y - Y * Other.X);
		}

		double Length() const { return std::sqrt(Dot(*this)); }
		constexpr double LengthSquared() const { return Dot(*this); }
		double Length2D() const { return std::sqrt(X * X + Y * Y); }
		constexpr Vec3 Flat() const { return Vec3(X, Y, 0.0); }

		Vec3 Normalized(const Vec3& Fallback = Vec3(1.0, 0.0, 0.0)) const
		{
			const double Len = Length();
			return Len > 1e-12 ? (*this) / Len : Fallback;
		}
	};

	inline constexpr Vec3 operator*(double Scale, const Vec3& V) { return V * Scale; }

	inline constexpr Vec3 UpVector() { return Vec3(0.0, 0.0, 1.0); }

	inline double Distance(const Vec3& A, const Vec3& B) { return (A - B).Length(); }
	inline double Distance2D(const Vec3& A, const Vec3& B) { return (A - B).Length2D(); }

	inline Vec3 LerpVec(const Vec3& A, const Vec3& B, double Alpha) { return A + (B - A) * Alpha; }

	inline double Sigmoid(double Logit) { return 1.0 / (1.0 + std::exp(-Logit)); }

	inline double LogitOf(double Probability)
	{
		const double P = Clamp(Probability, 1e-6, 1.0 - 1e-6);
		return std::log(P / (1.0 - P));
	}
}
