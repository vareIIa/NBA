#include "HoopsFreestyleGameMode.h"

#include "EngineUtils.h"
#include "Garrafao.h"
#include "HoopsBall.h"
#include "HoopsCourt.h"
#include "HoopsHUD.h"
#include "HoopsHoop.h"
#include "HoopsPlayerCharacter.h"

AHoopsFreestyleGameMode::AHoopsFreestyleGameMode()
{
	DefaultPawnClass = AHoopsPlayerCharacter::StaticClass();
	HUDClass = AHoopsHUD::StaticClass();
}

void AHoopsFreestyleGameMode::EnsureEnvironment(UWorld* World, AHoopsHoop*& OutHoop, AHoopsBall*& OutBall)
{
	OutHoop = nullptr;
	OutBall = nullptr;
	if (!World)
	{
		return;
	}

	AHoopsCourt* Court = nullptr;
	for (TActorIterator<AHoopsCourt> It(World); It; ++It)
	{
		Court = *It;
		break;
	}
	for (TActorIterator<AHoopsHoop> It(World); It; ++It)
	{
		OutHoop = *It;
		break;
	}
	for (TActorIterator<AHoopsBall> It(World); It; ++It)
	{
		OutBall = *It;
		break;
	}

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	// Quadra e cesta compartilham a origem: chão sob o centro do aro, +X para dentro da quadra.
	const FTransform Origin = OutHoop ? OutHoop->GetActorTransform() : FTransform::Identity;
	if (!Court)
	{
		Court = World->SpawnActor<AHoopsCourt>(AHoopsCourt::StaticClass(), Origin, Params);
		UE_LOG(LogHoops, Log, TEXT("Freestyle: quadra criada."));
	}
	if (!OutHoop)
	{
		OutHoop = World->SpawnActor<AHoopsHoop>(AHoopsHoop::StaticClass(), Origin, Params);
		UE_LOG(LogHoops, Log, TEXT("Freestyle: cesta criada."));
	}
	if (!OutBall)
	{
		const FTransform BallTransform(FRotator::ZeroRotator, Origin.TransformPosition(FVector(500.0, 0.0, 100.0)));
		OutBall = World->SpawnActor<AHoopsBall>(AHoopsBall::StaticClass(), BallTransform, Params);
	}

	if (OutBall && OutHoop && !OutBall->GetSim())
	{
		OutBall->InitializeSim(OutHoop->GetHoopSpec());
	}
}
