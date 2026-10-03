#pragma once

#include "HoopsSimCore/HoopsMath.h"

namespace Hoops
{
	// Trajetória cinemática de UM quique de drible: mão → chão → mão (a mesma ou a outra, num crossover).
	// A bola chega EXATAMENTE no instante do catch (vindo das notifies da animação), então nunca "teleporta".
	// docs/04-animacoes.md §3.1
	struct DribbleArc
	{
		Vec3 StartPos;        // mão que soltou (no instante da soltura)
		Vec3 FloorPos;        // ponto de contato no chão (centro da bola a 1 raio do chão)
		Vec3 EndPos;          // mão que vai receber (no instante do catch)
		double DownSeconds = 0.18;
		double UpSeconds = 0.22;
		double Gravity = DefaultGravity;

		double TotalSeconds() const { return DownSeconds + UpSeconds; }

		// Posição no tempo T desde a soltura (T é limitado a [0, Total]).
		Vec3 Evaluate(double T) const
		{
			if (T <= DownSeconds)
			{
				const double Td = DownSeconds > 1e-6 ? DownSeconds : 1e-6;
				const double Clamped = T < 0.0 ? 0.0 : T;
				// Descida: z(t) = z0 - v0 t - g t²/2, chegando ao chão em Td.
				const double Drop = StartPos.Z - FloorPos.Z;
				const double V0 = (Drop - 0.5 * Gravity * Td * Td) / Td;
				const double Z = StartPos.Z - V0 * Clamped - 0.5 * Gravity * Clamped * Clamped;
				const Vec3 Horizontal = LerpVec(StartPos.Flat(), FloorPos.Flat(), Clamped / Td);
				return Vec3(Horizontal.X, Horizontal.Y, Z);
			}

			const double Tu = UpSeconds > 1e-6 ? UpSeconds : 1e-6;
			const double Local = (T - DownSeconds) > Tu ? Tu : (T - DownSeconds);
			// Subida: z(t) = zf + vu t - g t²/2, chegando na mão em Tu.
			const double Rise = EndPos.Z - FloorPos.Z;
			const double VUp = (Rise + 0.5 * Gravity * Tu * Tu) / Tu;
			const double Z = FloorPos.Z + VUp * Local - 0.5 * Gravity * Local * Local;
			const Vec3 Horizontal = LerpVec(FloorPos.Flat(), EndPos.Flat(), Local / Tu);
			return Vec3(Horizontal.X, Horizontal.Y, Z);
		}

		// Velocidade de saída do chão (para validar que é um quique fisicamente plausível).
		double FloorExitSpeed() const
		{
			const double Tu = UpSeconds > 1e-6 ? UpSeconds : 1e-6;
			return (EndPos.Z - FloorPos.Z + 0.5 * Gravity * Tu * Tu) / Tu;
		}

		double FloorEntrySpeed() const
		{
			const double Td = DownSeconds > 1e-6 ? DownSeconds : 1e-6;
			const double Drop = StartPos.Z - FloorPos.Z;
			const double V0 = (Drop - 0.5 * Gravity * Td * Td) / Td;
			return V0 + Gravity * Td;
		}
	};

	// Monta um quique a partir da posição/velocidade do jogador. Lead = quanto o ponto no chão vai à frente.
	inline DribbleArc MakeDribbleArc(const Vec3& HandRelease, const Vec3& HandCatch, const Vec3& PlayerVelocity,
		double Period, double BallRadius, double FloorZ = 0.0)
	{
		DribbleArc Arc;
		Arc.StartPos = HandRelease;
		Arc.EndPos = HandCatch;
		// A bola desce mais rápido do que sobe (é empurrada para baixo).
		Arc.DownSeconds = Period * 0.42;
		Arc.UpSeconds = Period - Arc.DownSeconds;
		const Vec3 Mid = LerpVec(HandRelease.Flat(), HandCatch.Flat(), 0.5);
		const Vec3 Lead = PlayerVelocity.Flat() * (Arc.DownSeconds * 0.5);
		Arc.FloorPos = Vec3(Mid.X + Lead.X, Mid.Y + Lead.Y, FloorZ + BallRadius);
		return Arc;
	}
}
