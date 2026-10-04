#include "HoopsDummyDefender.h"

#include "Components/CapsuleComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "HoopsMeshUtil.h"
#include "HoopsUnits.h"
#include "UObject/ConstructorHelpers.h"

AHoopsDummyDefender::AHoopsDummyDefender()
{
	PrimaryActorTick.bCanEverTick = true;

	Capsule = CreateDefaultSubobject<UCapsuleComponent>(TEXT("Capsule"));
	Capsule->InitCapsuleSize(36.0f, 100.0f);
	Capsule->SetCollisionProfileName(TEXT("Pawn")); // o jogador esbarra no manequim
	SetRootComponent(Capsule);

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CylinderMesh(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereMesh(TEXT("/Engine/BasicShapes/Sphere.Sphere"));

	Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
	Body->SetupAttachment(Capsule);
	Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	if (CylinderMesh.Succeeded())
	{
		Body->SetStaticMesh(CylinderMesh.Object);
	}

	// Esfera = mão mais alta do defensor (o ponto que a contestação usa).
	Hand = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Hand"));
	Hand->SetupAttachment(Capsule);
	Hand->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Hand->SetUsingAbsoluteLocation(true);
	if (SphereMesh.Succeeded())
	{
		Hand->SetStaticMesh(SphereMesh.Object);
	}
	Hand->SetRelativeScale3D(FVector(0.16f));
}

void AHoopsDummyDefender::BeginPlay()
{
	Super::BeginPlay();
	HoopsMeshUtil::SetColor(this, Body, FLinearColor(0.55f, 0.08f, 0.08f));
	HoopsMeshUtil::SetColor(this, Hand, FLinearColor(1.0f, 0.85f, 0.2f));
	SetActorHiddenInGame(true);
	SetActorEnableCollision(false);
}

double AHoopsDummyDefender::Now() const
{
	const UWorld* ThisWorld = GetWorld();
	return ThisWorld ? ThisWorld->GetTimeSeconds() : 0.0;
}

FString AHoopsDummyDefender::ModeLabel(EHoopsDummyMode InMode)
{
	switch (InMode)
	{
	case EHoopsDummyMode::Off: return TEXT("Sem defensor");
	case EHoopsDummyMode::Standing: return TEXT("Parado (maos baixas)");
	case EHoopsDummyMode::HandsUp: return TEXT("Maos para cima");
	case EHoopsDummyMode::Contest: return TEXT("Contesta (pula)");
	case EHoopsDummyMode::Guard: return TEXT("Marca + contesta");
	default: break;
	}
	return TEXT("?");
}

FVector AHoopsDummyDefender::DesiredFeetLocation() const
{
	const FVector ToRim = (LastRimFloorPoint - LastPlayerLocation).GetSafeNormal2D();
	FVector Feet = LastPlayerLocation + ToRim * GapCm;
	Feet.Z = LastRimFloorPoint.Z;
	return Feet;
}

void AHoopsDummyDefender::SetMode(EHoopsDummyMode NewMode, const FVector& PlayerLocation, const FVector& RimFloorPoint)
{
	Mode = NewMode;
	LastPlayerLocation = PlayerLocation;
	LastRimFloorPoint = RimFloorPoint;
	JumpStartTime = -100.0;

	const bool bActive = Mode != EHoopsDummyMode::Off;
	SetActorHiddenInGame(!bActive);
	SetActorEnableCollision(bActive);
	if (bActive)
	{
		FeetLocation = DesiredFeetLocation();
	}
}

void AHoopsDummyDefender::NotifyShotStarted(double WorldTime)
{
	if (Mode == EHoopsDummyMode::Contest || Mode == EHoopsDummyMode::Guard)
	{
		JumpStartTime = WorldTime + ReactionSeconds;
	}
}

void AHoopsDummyDefender::UpdateTargets(const FVector& PlayerLocation, const FVector& RimFloorPoint)
{
	LastPlayerLocation = PlayerLocation;
	LastRimFloorPoint = RimFloorPoint;
}

double AHoopsDummyDefender::CurrentJumpHeightCm() const
{
	const double T = Now() - JumpStartTime;
	if (T <= 0.0)
	{
		return 0.0;
	}
	const double Gravity = 980.0;
	const double V0 = FMath::Sqrt(2.0 * Gravity * JumpHeightCm);
	const double Height = V0 * T - 0.5 * Gravity * T * T;
	return Height > 0.0 ? Height : 0.0;
}

Hoops::DefenderPose AHoopsDummyDefender::GetPose() const
{
	Hoops::DefenderPose Pose;
	Pose.FeetPosition = HoopsUnits::ToSim(FeetLocation);
	Pose.Height = HeightCm / 100.0;
	Pose.Wingspan = WingspanCm / 100.0;
	Pose.PerimeterDefense = PerimeterDefense;
	Pose.JumpHeight = CurrentJumpHeightCm() / 100.0;
	switch (Mode)
	{
	case EHoopsDummyMode::Standing: Pose.HandsUpAmount = 0.0; break;
	case EHoopsDummyMode::Guard: Pose.HandsUpAmount = Pose.JumpHeight > 0.0 ? 1.0 : 0.5; break;
	default: Pose.HandsUpAmount = 1.0; break;
	}
	return Pose;
}

void AHoopsDummyDefender::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (Mode == EHoopsDummyMode::Off)
	{
		return;
	}

	// Marcação: anda até ficar entre o jogador e a cesta (com velocidade máxima, para dar para passar).
	if (Mode == EHoopsDummyMode::Guard)
	{
		const FVector Target = DesiredFeetLocation();
		const FVector Delta = Target - FeetLocation;
		const double MaxStep = GuardSpeedCm * DeltaSeconds;
		FeetLocation += Delta.Size() > MaxStep ? Delta.GetSafeNormal() * MaxStep : Delta;
	}

	const double Jump = CurrentJumpHeightCm();
	const float HalfHeight = HeightCm * 0.5f;
	SetActorLocation(FeetLocation + FVector(0.0, 0.0, HalfHeight + Jump));
	Capsule->SetCapsuleHalfHeight(HalfHeight);
	Body->SetRelativeScale3D(FVector(0.55f, 0.40f, HeightCm / 100.0f));

	// Esfera na mão mais alta, de frente para o jogador.
	const Hoops::Vec3 HandPos = Hoops::DefenderHandPosition(GetPose(), HoopsUnits::ToSim(LastPlayerLocation));
	Hand->SetWorldLocation(HoopsUnits::ToUnreal(HandPos));
	SetActorRotation((LastPlayerLocation - FeetLocation).GetSafeNormal2D().Rotation());
}
