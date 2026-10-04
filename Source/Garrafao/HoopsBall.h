#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "HoopsSimCore/HoopsBallSim.h"

#include "HoopsBall.generated.h"

class UStaticMeshComponent;

UENUM(BlueprintType)
enum class EHoopsBallMode : uint8
{
	Controlled, // posição definida pelo jogador (segurando/driblando)
	Free,       // física do núcleo (arremesso, passe, rebote, bola solta)
};

// Bola. Em modo Free, roda a simulação determinística do núcleo a 120 Hz fixo e interpola para o render.
UCLASS()
class GARRAFAO_API AHoopsBall : public AActor
{
	GENERATED_BODY()

public:
	AHoopsBall();

	virtual void Tick(float DeltaSeconds) override;

	void InitializeSim(const Hoops::HoopSpec& Hoop);
	const Hoops::BallSim* GetSim() const { return Sim.Get(); }

	// Controle pelo jogador.
	void SetControlledLocation(const FVector& WorldLocation);

	// Solta na física com o estado inicial (metros).
	void LaunchFree(const Hoops::BallState& Initial);

	EHoopsBallMode GetMode() const { return Mode; }
	bool IsFree() const { return Mode == EHoopsBallMode::Free; }
	FVector GetBallVelocity() const; // cm/s
	Hoops::BallState GetSimState() const { return Current; }

	// Eventos desde o último lançamento.
	bool HasScoredSinceLaunch() const { return bScoredSinceLaunch; }
	bool HasTouchedFloorSinceLaunch() const { return bTouchedFloorSinceLaunch; }
	double GetSecondsSinceLaunch() const { return SecondsSinceLaunch; }
	// Consome o evento de cesta (true uma única vez por cesta).
	bool ConsumeScoreEvent();

	static constexpr float RadiusCm = 11.9f;

private:
	UPROPERTY(VisibleAnywhere, Category = "Hoops|Bola")
	TObjectPtr<UStaticMeshComponent> Mesh;

	TUniquePtr<Hoops::BallSim> Sim;
	Hoops::BallState Previous;
	Hoops::BallState Current;
	double Accumulator = 0.0;
	EHoopsBallMode Mode = EHoopsBallMode::Controlled;

	FVector LastControlledLocation = FVector::ZeroVector;
	FVector ControlledVelocity = FVector::ZeroVector;

	bool bScoredSinceLaunch = false;
	bool bPendingScoreEvent = false;
	bool bTouchedFloorSinceLaunch = false;
	double SecondsSinceLaunch = 0.0;
};
