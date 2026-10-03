#pragma once

#include "HoopsSimCore/HoopsMath.h"

namespace Hoops
{
	// Bola tamanho 7 (masculino).
	struct BallSpec
	{
		double Radius = 0.119;
		double Mass = 0.62;
	};

	// Coeficientes de contato. Restitution = coeficiente de restituição normal; Friction = Coulomb (impulso tangencial).
	struct SurfaceSpec
	{
		double Restitution = 0.76;
		double Friction = 0.25;
	};

	namespace Surfaces
	{
		// Madeira: regra da FIBA (solta de 1,80 m, volta a 1,20–1,40 m medidos no topo da bola) => e ~ 0,73–0,80.
		inline constexpr SurfaceSpec Hardwood{0.76, 0.25};
		inline constexpr SurfaceSpec Asphalt{0.71, 0.35};
		inline constexpr SurfaceSpec Rim{0.55, 0.20};
		inline constexpr SurfaceSpec Backboard{0.60, 0.15};
	}

	// Cesta (aro + tabela). Medidas oficiais; posicionada no mundo pela face frontal da tabela.
	struct HoopSpec
	{
		// Centro da face frontal da tabela (lado da quadra).
		Vec3 BackboardFaceCenter = Vec3(0.0, 0.0, 3.435);
		// Vetor horizontal unitário da tabela para dentro da quadra.
		Vec3 Forward = Vec3(1.0, 0.0, 0.0);

		double RimHeight = 3.05;           // topo do aro
		double RimInnerRadius = 0.2286;    // diâmetro interno de 45,7 cm
		double RimTubeRadius = 0.008;      // tubo de ~16 mm
		double RimInnerEdgeToBoard = 0.151; // borda interna do aro até a face da tabela
		double BackboardWidth = 1.83;
		double BackboardHeight = 1.07;
		double BackboardThickness = 0.03;

		// Cria a cesta a partir do ponto no chão abaixo do centro do aro.
		static HoopSpec FromRimFloorPoint(const Vec3& RimFloorPoint, const Vec3& InForward)
		{
			HoopSpec Spec;
			Spec.Forward = InForward.Flat().Normalized();
			const double RimCenterToBoard = Spec.RimInnerEdgeToBoard + Spec.RimInnerRadius;
			const Vec3 Face = RimFloorPoint.Flat() - Spec.Forward * RimCenterToBoard;
			// Borda inferior da tabela 0,15 m abaixo do topo do aro (2,90 m).
			const double BoardBottom = Spec.RimHeight - 0.15;
			Spec.BackboardFaceCenter = Vec3(Face.X, Face.Y, RimFloorPoint.Z + BoardBottom + Spec.BackboardHeight * 0.5);
			Spec.RimHeight += RimFloorPoint.Z;
			return Spec;
		}

		Vec3 Right() const { return UpVector().Cross(Forward).Normalized(Vec3(0.0, 1.0, 0.0)); }

		// Raio da linha central do toro do aro.
		double RimCenterlineRadius() const { return RimInnerRadius + RimTubeRadius; }

		// Altura do plano que passa pelo centro do tubo do aro.
		double RimPlaneZ() const { return RimHeight - RimTubeRadius; }

		// Centro geométrico do aro (no plano do tubo).
		Vec3 RimCenter() const
		{
			const Vec3 Horizontal = BackboardFaceCenter.Flat() + Forward * (RimInnerEdgeToBoard + RimInnerRadius);
			return Vec3(Horizontal.X, Horizontal.Y, RimPlaneZ());
		}

		// Centro do volume da tabela (atrás da face).
		Vec3 BackboardCenter() const { return BackboardFaceCenter - Forward * (BackboardThickness * 0.5); }
	};

	// Linhas da quadra (padrão "NBA" de medidas; liga fictícia).
	struct CourtSpec
	{
		double ThreePointRadius = 7.24;
		double CornerThreeDistance = 6.71;
		double CornerZoneFromBaseline = 4.27;
		double RimFromBaseline = 1.60;
		double FreeThrowDistance = 4.57;
		double HalfCourtLength = 14.33;
		double CourtWidth = 15.24;

		// Arremesso de 3? Posições horizontais; RimFloorPoint = chão abaixo do aro; Forward da cesta.
		bool IsThreePointer(const Vec3& ShooterFloorPos, const Vec3& RimFloorPoint, const Vec3& HoopForward) const
		{
			const Vec3 Fwd = HoopForward.Flat().Normalized();
			const Vec3 Lateral = UpVector().Cross(Fwd).Normalized();
			const Vec3 Delta = (ShooterFloorPos - RimFloorPoint).Flat();
			const double Along = Delta.Dot(Fwd);
			const double Side = Delta.Dot(Lateral);
			const double CornerZoneEnd = CornerZoneFromBaseline - RimFromBaseline;
			if (Along <= CornerZoneEnd)
			{
				return (Side < 0.0 ? -Side : Side) >= CornerThreeDistance;
			}
			return Delta.Length2D() >= ThreePointRadius;
		}
	};
}
