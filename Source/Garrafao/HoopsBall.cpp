#include "HoopsBall.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "HoopsMeshUtil.h"
#include "HoopsUnits.h"
#include "UObject/ConstructorHelpers.h"

AHoopsBall::AHoopsBall()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PostPhysics;

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	SetRootComponent(Mesh);
	static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereMesh(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	if (SphereMesh.Succeeded())
	{
		Mesh->SetStaticMesh(SphereMesh.Object);
	}
	const float Scale = (RadiusCm * 2.0f) / 100.0f;
	Mesh->SetWorldScale3D(FVector(Scale));
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision); // colisão da bola é do núcleo
	Mesh->SetMobility(EComponentMobility::Movable);
}

void AHoopsBall::InitializeSim(const Hoops::HoopSpec& Hoop)
{
	Hoops::BallSimConfig Config;
	Sim = MakeUnique<Hoops::BallSim>(Config, Hoop);
	HoopsMeshUtil::SetColor(this, Mesh, FLinearColor(0.85f, 0.32f, 0.07f));
}

void AHoopsBall::SetControlledLocation(const FVector& WorldLocation)
{
	const UWorld* ThisWorld = GetWorld();
	const float Delta = ThisWorld ? ThisWorld->GetDeltaSeconds() : 0.0f;
	if (Mode == EHoopsBallMode::Controlled && Delta > UE_KINDA_SMALL_NUMBER)
	{
		ControlledVelocity = (WorldLocation - LastControlledLocation) / Delta;
	}
	Mode = EHoopsBallMode::Controlled;
	LastControlledLocation = WorldLocation;
	SetActorLocation(WorldLocation);
}

void AHoopsBall::LaunchFree(const Hoops::BallState& Initial)
{
	Mode = EHoopsBallMode::Free;
	Previous = Initial;
	Current = Initial;
	Accumulator = 0.0;
	bScoredSinceLaunch = false;
	bPendingScoreEvent = false;
	bTouchedFloorSinceLaunch = false;
	SecondsSinceLaunch = 0.0;
	SetActorLocation(HoopsUnits::ToUnreal(Initial.Position));
}

FVector AHoopsBall::GetBallVelocity() const
{
	return Mode == EHoopsBallMode::Free ? HoopsUnits::ToUnreal(Current.Velocity) : ControlledVelocity;
}

bool AHoopsBall::ConsumeScoreEvent()
{
	const bool bHad = bPendingScoreEvent;
	bPendingScoreEvent = false;
	return bHad;
}

void AHoopsBall::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (Mode != EHoopsBallMode::Free || !Sim)
	{
		return;
	}

	SecondsSinceLaunch += DeltaSeconds;
	Accumulator += DeltaSeconds;
	const double TickSeconds = Sim->TickSeconds();
	int32 Guard = 0;
	while (Accumulator >= TickSeconds && Guard < 32)
	{
		Previous = Current;
		const Hoops::BallTickEvents Events = Sim->Tick(Current);
		if (Events.Scored)
		{
			bScoredSinceLaunch = true;
			bPendingScoreEvent = true;
		}
		if (Events.HitFloor && Events.FloorImpactSpeed > 0.5)
		{
			bTouchedFloorSinceLaunch = true;
		}
		Accumulator -= TickSeconds;
		++Guard;
	}

	// Interpola entre os dois últimos ticks fixos.
	const double Alpha = FMath::Clamp(Accumulator / TickSeconds, 0.0, 1.0);
	const Hoops::Vec3 Pos = Hoops::LerpVec(Previous.Position, Current.Position, Alpha);
	SetActorLocation(HoopsUnits::ToUnreal(Pos));

	// Giro visual da bola.
	const FVector Omega = HoopsUnits::DirToUnreal(Current.AngularVelocity);
	const double Speed = Omega.Size();
	if (Speed > UE_KINDA_SMALL_NUMBER)
	{
		const FQuat Spin(Omega / Speed, Speed * DeltaSeconds);
		AddActorWorldRotation(Spin);
	}
}
