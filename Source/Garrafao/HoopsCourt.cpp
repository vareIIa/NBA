#include "HoopsCourt.h"

#include "Components/DirectionalLightComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "EngineUtils.h"
#include "HoopsMeshUtil.h"
#include "HoopsSimCore/HoopsCourt.h"

namespace
{
	constexpr float LineWidthCm = 5.0f;
	constexpr float LineThicknessCm = 0.2f;
	constexpr float LineZCm = 0.35f;
	constexpr float PaintZCm = 0.15f;
	constexpr float MarginCm = 150.0f;
}

AHoopsCourt::AHoopsCourt()
{
	PrimaryActorTick.bCanEverTick = false;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	Sun = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("Sun"));
	Sun->SetupAttachment(Root);
	Sun->SetMobility(EComponentMobility::Movable);
	Sun->SetRelativeRotation(FRotator(-48.0f, 35.0f, 0.0f));
	Sun->SetIntensity(7.0f);
	Sun->SetAtmosphereSunLight(true);

	SkyAtmosphere = CreateDefaultSubobject<USkyAtmosphereComponent>(TEXT("SkyAtmosphere"));
	SkyAtmosphere->SetupAttachment(Root);

	SkyLight = CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight"));
	SkyLight->SetupAttachment(Root);
	SkyLight->SetMobility(EComponentMobility::Movable);
	SkyLight->bRealTimeCapture = true;
	SkyLight->SetIntensity(1.0f);
}

void AHoopsCourt::BeginPlay()
{
	Super::BeginPlay();

	// Se o nível já tem um sol (ex.: nível "Basic"), não cria uma segunda iluminação.
	for (TActorIterator<AActor> It(GetWorld()); It && bSpawnLighting; ++It)
	{
		if (*It != this && It->FindComponentByClass<UDirectionalLightComponent>())
		{
			bSpawnLighting = false;
		}
	}

	if (!bSpawnLighting)
	{
		Sun->SetVisibility(false);
		SkyLight->SetVisibility(false);
		SkyAtmosphere->SetVisibility(false);
	}

	BuildCourt();
}

void AHoopsCourt::AddLine(const FVector2D& A, const FVector2D& B)
{
	HoopsMeshUtil::AddStrip(this, Root, A, B, LineWidthCm, LineThicknessCm, LineZCm, LineColor);
}

void AHoopsCourt::AddArc(const FVector2D& Center, float Radius, float StartDeg, float EndDeg, int32 Segments)
{
	FVector2D Prev = Center + FVector2D(FMath::Cos(FMath::DegreesToRadians(StartDeg)), FMath::Sin(FMath::DegreesToRadians(StartDeg))) * Radius;
	for (int32 Index = 1; Index <= Segments; ++Index)
	{
		const float Deg = FMath::Lerp(StartDeg, EndDeg, static_cast<float>(Index) / static_cast<float>(Segments));
		const FVector2D Next = Center + FVector2D(FMath::Cos(FMath::DegreesToRadians(Deg)), FMath::Sin(FMath::DegreesToRadians(Deg))) * Radius;
		AddLine(Prev, Next);
		Prev = Next;
	}
}

void AHoopsCourt::BuildCourt()
{
	const Hoops::CourtSpec Court;
	const float Baseline = static_cast<float>(-Court.RimFromBaseline * 100.0);
	const float HalfCourt = static_cast<float>((Court.HalfCourtLength - Court.RimFromBaseline) * 100.0);
	const float HalfWidth = static_cast<float>(Court.CourtWidth * 50.0);
	const float LaneHalf = 244.0f;                 // garrafão de 4,88 m
	const float FreeThrowX = Baseline + 579.0f;    // linha de lance livre a 5,79 m da linha de fundo
	const float ThreeRadius = static_cast<float>(Court.ThreePointRadius * 100.0);
	const float CornerY = static_cast<float>(Court.CornerThreeDistance * 100.0);
	const float CornerEndX = FMath::Sqrt(ThreeRadius * ThreeRadius - CornerY * CornerY);
	const float ArcDeg = FMath::RadiansToDegrees(FMath::Atan2(CornerY, CornerEndX));

	// Piso de madeira (com colisão), topo em Z = 0.
	const FHoopsBasicShapes& Shapes = FHoopsBasicShapes::Get();
	const float FloorLength = (HalfCourt - Baseline) + 2.0f * MarginCm;
	const float FloorWidth = 2.0f * HalfWidth + 2.0f * MarginCm;
	const FVector FloorCenter((Baseline + HalfCourt) * 0.5f, 0.0f, -5.0f);
	HoopsMeshUtil::AddMesh(this, Root, Shapes.Cube,
		FTransform(FRotator::ZeroRotator, FloorCenter, FVector(FloorLength / 100.0f, FloorWidth / 100.0f, 0.1f)), WoodColor, true);

	// Garrafão pintado.
	HoopsMeshUtil::AddStrip(this, Root, FVector2D(Baseline, 0.0f), FVector2D(FreeThrowX, 0.0f), 2.0f * LaneHalf, 0.1f, PaintZCm, PaintColor);

	// Linhas.
	AddLine(FVector2D(Baseline, -HalfWidth), FVector2D(Baseline, HalfWidth));      // fundo
	AddLine(FVector2D(Baseline, -HalfWidth), FVector2D(HalfCourt, -HalfWidth));    // laterais
	AddLine(FVector2D(Baseline, HalfWidth), FVector2D(HalfCourt, HalfWidth));
	AddLine(FVector2D(HalfCourt, -HalfWidth), FVector2D(HalfCourt, HalfWidth));    // meio da quadra
	AddLine(FVector2D(Baseline, -LaneHalf), FVector2D(FreeThrowX, -LaneHalf));     // garrafão
	AddLine(FVector2D(Baseline, LaneHalf), FVector2D(FreeThrowX, LaneHalf));
	AddLine(FVector2D(FreeThrowX, -LaneHalf), FVector2D(FreeThrowX, LaneHalf));    // lance livre
	AddArc(FVector2D(FreeThrowX, 0.0f), 183.0f, -90.0f, 90.0f, 16);                // círculo do lance livre
	AddArc(FVector2D(0.0f, 0.0f), 122.0f, -90.0f, 90.0f, 12);                      // área restrita
	AddLine(FVector2D(Baseline, -CornerY), FVector2D(CornerEndX, -CornerY));       // 3 do canto
	AddLine(FVector2D(Baseline, CornerY), FVector2D(CornerEndX, CornerY));
	AddArc(FVector2D(0.0f, 0.0f), ThreeRadius, -ArcDeg, ArcDeg, 40);               // arco de 3
	AddArc(FVector2D(HalfCourt, 0.0f), 183.0f, 90.0f, 270.0f, 16);                 // círculo central
}
