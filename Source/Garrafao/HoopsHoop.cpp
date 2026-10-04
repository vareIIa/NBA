#include "HoopsHoop.h"

#include "HoopsMeshUtil.h"
#include "HoopsUnits.h"

namespace
{
	// Cesta no espaço LOCAL do ator (origem no chão sob o aro, +X para a quadra).
	Hoops::HoopSpec LocalSpec()
	{
		return Hoops::HoopSpec::FromRimFloorPoint(Hoops::Vec3(0.0, 0.0, 0.0), Hoops::Vec3(1.0, 0.0, 0.0));
	}

	const FLinearColor RimColor(0.95f, 0.30f, 0.05f);
	const FLinearColor BoardColor(0.85f, 0.90f, 0.95f);
	const FLinearColor BoardLineColor(0.95f, 0.95f, 0.95f);
	const FLinearColor SteelColor(0.12f, 0.12f, 0.14f);
	const FLinearColor NetColor(0.97f, 0.97f, 0.97f);
}

AHoopsHoop::AHoopsHoop()
{
	PrimaryActorTick.bCanEverTick = false;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);
}

Hoops::HoopSpec AHoopsHoop::GetHoopSpec() const
{
	return Hoops::HoopSpec::FromRimFloorPoint(HoopsUnits::ToSim(GetActorLocation()), HoopsUnits::DirToSim(GetActorForwardVector()));
}

FVector AHoopsHoop::GetRimCenterWorld() const
{
	return HoopsUnits::ToUnreal(GetHoopSpec().RimCenter());
}

void AHoopsHoop::BeginPlay()
{
	Super::BeginPlay();
	BuildVisuals();
}

void AHoopsHoop::BuildVisuals()
{
	const Hoops::HoopSpec Spec = LocalSpec();
	const FHoopsBasicShapes& Shapes = FHoopsBasicShapes::Get();

	const FVector RimCenter = HoopsUnits::ToUnreal(Spec.RimCenter());
	const float CenterlineCm = static_cast<float>(Spec.RimCenterlineRadius() * 100.0);
	const float TubeDiameterCm = static_cast<float>(Spec.RimTubeRadius * 200.0);

	// Aro: anel de cilindros tangentes (mesmo raio da linha central do toro da física).
	const int32 RimSegments = 32;
	for (int32 Index = 0; Index < RimSegments; ++Index)
	{
		const float A0 = 2.0f * PI * static_cast<float>(Index) / RimSegments;
		const float A1 = 2.0f * PI * static_cast<float>(Index + 1) / RimSegments;
		const FVector P0 = RimCenter + FVector(FMath::Cos(A0), FMath::Sin(A0), 0.0f) * CenterlineCm;
		const FVector P1 = RimCenter + FVector(FMath::Cos(A1), FMath::Sin(A1), 0.0f) * CenterlineCm;
		HoopsMeshUtil::AddRod(this, Root, P0, P1, TubeDiameterCm, RimColor);
	}

	// Tabela (caixa) e retângulo de mira.
	const FVector BoardCenter = HoopsUnits::ToUnreal(Spec.BackboardCenter());
	const FVector BoardScale(
		static_cast<float>(Spec.BackboardThickness),
		static_cast<float>(Spec.BackboardWidth),
		static_cast<float>(Spec.BackboardHeight));
	HoopsMeshUtil::AddMesh(this, Root, Shapes.Cube, FTransform(FRotator::ZeroRotator, BoardCenter, BoardScale), BoardColor, false);

	const float FaceX = static_cast<float>(Spec.BackboardFaceCenter.X * 100.0) + 0.3f;
	const float BoxBottom = static_cast<float>(Spec.RimHeight * 100.0) + 1.0f;
	const float BoxTop = BoxBottom + 45.0f;
	const float BoxHalf = 30.5f;
	auto BoardLine = [this, FaceX](const FVector& A, const FVector& B)
	{
		HoopsMeshUtil::AddRod(this, Root, FVector(FaceX, A.Y, A.Z), FVector(FaceX, B.Y, B.Z), 5.0f, BoardLineColor);
	};
	BoardLine(FVector(0.0f, -BoxHalf, BoxBottom), FVector(0.0f, BoxHalf, BoxBottom));
	BoardLine(FVector(0.0f, -BoxHalf, BoxTop), FVector(0.0f, BoxHalf, BoxTop));
	BoardLine(FVector(0.0f, -BoxHalf, BoxBottom), FVector(0.0f, -BoxHalf, BoxTop));
	BoardLine(FVector(0.0f, BoxHalf, BoxBottom), FVector(0.0f, BoxHalf, BoxTop));

	// Suporte do aro até a tabela.
	const FVector RimBack = RimCenter - FVector(CenterlineCm, 0.0f, 0.0f);
	HoopsMeshUtil::AddRod(this, Root, RimBack, FVector(static_cast<float>(Spec.BackboardFaceCenter.X * 100.0), 0.0f, RimBack.Z - 4.0f), 3.0f, RimColor);

	// Poste atrás da linha de fundo e braço até a tabela.
	const float PoleX = -250.0f;
	const float ArmZ = 340.0f;
	HoopsMeshUtil::AddRod(this, Root, FVector(PoleX, 0.0f, 0.0f), FVector(PoleX, 0.0f, ArmZ + 10.0f), 22.0f, SteelColor);
	const float BoardBackX = static_cast<float>((Spec.BackboardFaceCenter.X - Spec.BackboardThickness) * 100.0);
	HoopsMeshUtil::AddRod(this, Root, FVector(PoleX, 0.0f, ArmZ), FVector(BoardBackX, 0.0f, ArmZ), 12.0f, SteelColor);

	// Rede (cosmética): fios do aro até um anel menor ~42 cm abaixo.
	const int32 Strands = 14;
	const float NetBottomRadius = 13.0f;
	const float NetDepth = 42.0f;
	for (int32 Index = 0; Index < Strands; ++Index)
	{
		const float Angle = 2.0f * PI * static_cast<float>(Index) / Strands;
		const float Twist = 2.0f * PI / Strands * 0.5f;
		const FVector Top = RimCenter + FVector(FMath::Cos(Angle), FMath::Sin(Angle), 0.0f) * CenterlineCm;
		const FVector Bottom = RimCenter + FVector(FMath::Cos(Angle + Twist), FMath::Sin(Angle + Twist), 0.0f) * NetBottomRadius
			- FVector(0.0f, 0.0f, NetDepth);
		HoopsMeshUtil::AddRod(this, Root, Top, Bottom, 0.7f, NetColor);
	}
}
