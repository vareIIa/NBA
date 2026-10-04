#pragma once

#include "HoopsSimCore/HoopsCourt.h"

namespace Hoops
{
	struct BallState
	{
		Vec3 Position;
		Vec3 Velocity;
		// Velocidade angular (rad/s). Hoje é usada para o visual (giro da bola); o contato usa só restituição e atrito.
		Vec3 AngularVelocity;
	};

	struct BallSimConfig
	{
		double Gravity = DefaultGravity;
		double TickRate = 120.0; // ticks por segundo (fixo)
		int SubSteps = 4;        // sub-passos por tick (evita atravessar aro/tabela)
		BallSpec Ball;
		SurfaceSpec Floor = Surfaces::Hardwood;
		SurfaceSpec Rim = Surfaces::Rim;
		SurfaceSpec Board = Surfaces::Backboard;
		double FloorZ = 0.0;
		double RestSpeed = 0.15; // abaixo disso, quiques no chão param (evita "tremer")
		double RollingDamping = 0.9; // 1/s: bola rolando no chão perde velocidade
	};

	// O que aconteceu durante um tick.
	struct BallTickEvents
	{
		bool HitFloor = false;
		double FloorImpactSpeed = 0.0; // m/s na batida mais forte do tick (para som/efeitos)
		bool HitRim = false;
		bool HitBackboard = false;
		bool Scored = false; // centro da bola cruzou o plano do aro para baixo, por dentro do aro
	};

	// Simulação determinística da bola livre (arremesso, passe, rebote, bola solta).
	// Colisores analíticos: chão (plano), tabela (caixa), aro (toro). Rede é cosmética (fora do núcleo).
	class HOOPSSIMCORE_API BallSim
	{
	public:
		BallSim(const BallSimConfig& InConfig, const HoopSpec& InHoop);

		// Avança exatamente 1 tick (1 / TickRate segundos).
		BallTickEvents Tick(BallState& State) const;

		double TickSeconds() const { return 1.0 / Config.TickRate; }
		const BallSimConfig& GetConfig() const { return Config; }
		const HoopSpec& GetHoop() const { return Hoop; }

	private:
		void SubStep(BallState& State, double Dt, BallTickEvents& Events) const;
		// Retorna a velocidade de impacto (0 se não bateu descendo).
		double CollideFloor(BallState& State) const;
		bool CollideBackboard(BallState& State) const;
		bool CollideRim(BallState& State) const;

		BallSimConfig Config;
		HoopSpec Hoop;
	};

	// Resultado de um voo simulado até se resolver (cesta, chão ou tempo esgotado).
	struct FlightSummary
	{
		bool Scored = false;
		int RimHits = 0;
		int BoardHits = 0;
		bool HitFloor = false;
		int Ticks = 0;
	};

	// Simula até: cesta + bola abaixo do aro, ou primeiro toque no chão, ou MaxSeconds.
	HOOPSSIMCORE_API FlightSummary SimulateFlight(const BallSim& Sim, BallState State, double MaxSeconds = 4.0);
}
