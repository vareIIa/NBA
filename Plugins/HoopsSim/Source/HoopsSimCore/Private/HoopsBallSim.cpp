#include "HoopsSimCore/HoopsBallSim.h"

namespace Hoops
{
	namespace
	{
		// Resolve contato esfera-superfície: tira a penetração, aplica restituição normal e atrito de Coulomb.
		void ResolveContact(BallState& State, const Vec3& Normal, double Penetration, const SurfaceSpec& Surface)
		{
			State.Position += Normal * Penetration;

			const double NormalSpeed = State.Velocity.Dot(Normal);
			if (NormalSpeed >= 0.0)
			{
				return; // já se afastando
			}

			const Vec3 NormalVel = Normal * NormalSpeed;
			const Vec3 TangentVel = State.Velocity - NormalVel;
			const double NormalImpulse = -(1.0 + Surface.Restitution) * NormalSpeed;

			const double TangentSpeed = TangentVel.Length();
			Vec3 NewTangent = TangentVel;
			if (TangentSpeed > 1e-9)
			{
				const double FrictionDelta = Surface.Friction * NormalImpulse;
				const double Reduced = TangentSpeed > FrictionDelta ? TangentSpeed - FrictionDelta : 0.0;
				NewTangent = TangentVel * (Reduced / TangentSpeed);
			}

			State.Velocity = NewTangent + Normal * (-NormalSpeed * Surface.Restitution);
		}
	}

	BallSim::BallSim(const BallSimConfig& InConfig, const HoopSpec& InHoop)
		: Config(InConfig)
		, Hoop(InHoop)
	{
	}

	BallTickEvents BallSim::Tick(BallState& State) const
	{
		BallTickEvents Events;
		const int Steps = Config.SubSteps > 0 ? Config.SubSteps : 1;
		const double Dt = TickSeconds() / static_cast<double>(Steps);
		for (int Index = 0; Index < Steps; ++Index)
		{
			SubStep(State, Dt, Events);
		}
		return Events;
	}

	void BallSim::SubStep(BallState& State, double Dt, BallTickEvents& Events) const
	{
		const double PrevZ = State.Position.Z;

		// Euler semi-implícito: estável e determinístico.
		State.Velocity.Z -= Config.Gravity * Dt;
		State.Position += State.Velocity * Dt;

		if (CollideBackboard(State))
		{
			Events.HitBackboard = true;
		}
		if (CollideRim(State))
		{
			Events.HitRim = true;
		}
		const double FloorImpact = CollideFloor(State);
		// Rolando no chão: resistência ao rolamento.
		if (State.Velocity.Z == 0.0 && State.Position.Z <= Config.FloorZ + Config.Ball.Radius + 1e-6)
		{
			const double Keep = 1.0 - Config.RollingDamping * Dt;
			const double Factor = Keep > 0.0 ? Keep : 0.0;
			State.Velocity.X *= Factor;
			State.Velocity.Y *= Factor;
		}
		if (FloorImpact > 0.0)
		{
			Events.HitFloor = true;
			Events.FloorImpactSpeed = FloorImpact > Events.FloorImpactSpeed ? FloorImpact : Events.FloorImpactSpeed;
		}

		// Cesta: o centro cruzou o plano do aro descendo, por dentro do aro.
		const double PlaneZ = Hoop.RimPlaneZ();
		if (PrevZ >= PlaneZ && State.Position.Z < PlaneZ && State.Velocity.Z < 0.0)
		{
			const double Radial = Distance2D(State.Position, Hoop.RimCenter());
			if (Radial < Hoop.RimInnerRadius)
			{
				Events.Scored = true;
			}
		}
	}

	double BallSim::CollideFloor(BallState& State) const
	{
		const double Radius = Config.Ball.Radius;
		const double Penetration = (Config.FloorZ + Radius) - State.Position.Z;
		if (Penetration <= 0.0)
		{
			return 0.0;
		}

		const double ImpactSpeed = State.Velocity.Z < 0.0 ? -State.Velocity.Z : 0.0;
		ResolveContact(State, UpVector(), Penetration, Config.Floor);
		if (State.Velocity.Z < Config.RestSpeed)
		{
			State.Velocity.Z = 0.0; // assenta no chão (sem micro-quiques)
		}
		return ImpactSpeed;
	}

	bool BallSim::CollideBackboard(BallState& State) const
	{
		const double Radius = Config.Ball.Radius;
		const Vec3 Center = Hoop.BackboardCenter();
		const Vec3 AxisF = Hoop.Forward;
		const Vec3 AxisR = Hoop.Right();
		const Vec3 AxisU = UpVector();
		const double HalfF = Hoop.BackboardThickness * 0.5;
		const double HalfR = Hoop.BackboardWidth * 0.5;
		const double HalfU = Hoop.BackboardHeight * 0.5;

		const Vec3 Local = State.Position - Center;
		const double LocalF = Local.Dot(AxisF);
		const double LocalR = Local.Dot(AxisR);
		const double LocalU = Local.Dot(AxisU);

		// Ponto da caixa mais próximo do centro da bola.
		const double ClosestF = Clamp(LocalF, -HalfF, HalfF);
		const double ClosestR = Clamp(LocalR, -HalfR, HalfR);
		const double ClosestU = Clamp(LocalU, -HalfU, HalfU);
		const Vec3 Closest = Center + AxisF * ClosestF + AxisR * ClosestR + AxisU * ClosestU;

		const Vec3 Delta = State.Position - Closest;
		const double Dist = Delta.Length();
		if (Dist >= Radius)
		{
			return false;
		}

		Vec3 Normal;
		double Penetration;
		if (Dist > 1e-9)
		{
			Normal = Delta / Dist;
			Penetration = Radius - Dist;
		}
		else
		{
			// Centro dentro da caixa: empurra pela face da quadra (ou de trás, se veio por trás).
			Normal = LocalF >= 0.0 ? AxisF : -AxisF;
			Penetration = Radius + (HalfF - (LocalF >= 0.0 ? LocalF : -LocalF));
		}

		ResolveContact(State, Normal, Penetration, Config.Board);
		return true;
	}

	bool BallSim::CollideRim(BallState& State) const
	{
		const double Radius = Config.Ball.Radius;
		const Vec3 RimCenter = Hoop.RimCenter();
		const double CenterlineRadius = Hoop.RimCenterlineRadius();
		const double ContactDist = Radius + Hoop.RimTubeRadius;

		const Vec3 Rel = State.Position - RimCenter;
		// Descarta rápido se está longe do aro.
		if (Rel.Z > ContactDist || Rel.Z < -ContactDist)
		{
			return false;
		}

		Vec3 Radial = Rel.Flat();
		const double RadialLen = Radial.Length();
		Radial = RadialLen > 1e-9 ? Radial / RadialLen : Hoop.Forward;

		// Ponto mais próximo na linha central do toro.
		const Vec3 Nearest = RimCenter + Radial * CenterlineRadius;
		const Vec3 Delta = State.Position - Nearest;
		const double Dist = Delta.Length();
		if (Dist >= ContactDist || Dist <= 1e-9)
		{
			return false;
		}

		ResolveContact(State, Delta / Dist, ContactDist - Dist, Config.Rim);
		return true;
	}

	FlightSummary SimulateFlight(const BallSim& Sim, BallState State, double MaxSeconds)
	{
		FlightSummary Summary;
		const int MaxTicks = static_cast<int>(MaxSeconds * Sim.GetConfig().TickRate);
		const double BelowRimZ = Sim.GetHoop().RimPlaneZ() - 0.6;

		for (int TickIndex = 0; TickIndex < MaxTicks; ++TickIndex)
		{
			const BallTickEvents Events = Sim.Tick(State);
			Summary.Ticks = TickIndex + 1;
			Summary.RimHits += Events.HitRim ? 1 : 0;
			Summary.BoardHits += Events.HitBackboard ? 1 : 0;
			Summary.Scored = Summary.Scored || Events.Scored;

			if (Events.HitFloor)
			{
				Summary.HitFloor = true;
				break;
			}
			if (Summary.Scored && State.Position.Z < BelowRimZ)
			{
				break;
			}
		}
		return Summary;
	}
}
