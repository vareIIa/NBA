#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "HoopsSimCore/HoopsContest.h"

#include "HoopsDummyDefender.generated.h"

class UCapsuleComponent;
class UStaticMeshComponent;

UENUM(BlueprintType)
enum class EHoopsDummyMode : uint8
{
	Off,        // sem defensor
	Standing,   // parado, mãos baixas
	HandsUp,    // parado, mãos para cima
	Contest,    // parado, pula no arremesso (com tempo de reação)
	Guard,      // marca: fica entre o jogador e a cesta, e pula no arremesso
	Count UMETA(Hidden),
};

// Defensor manequim do Freestyle (docs/10-modos.md §0.1). Serve para treinar arremesso contestado
// e para validar a contestação geométrica (o que se vê é o que conta).
UCLASS()
class GARRAFAO_API AHoopsDummyDefender : public AActor
{
	GENERATED_BODY()

public:
	AHoopsDummyDefender();

	virtual void Tick(float DeltaSeconds) override;

	void SetMode(EHoopsDummyMode NewMode, const FVector& PlayerLocation, const FVector& RimFloorPoint);
	EHoopsDummyMode GetMode() const { return Mode; }
	static FString ModeLabel(EHoopsDummyMode InMode);

	// Chamado pelo jogador quando inicia um arremesso (gather).
	void NotifyShotStarted(double WorldTime);

	// Mantém a marcação (modo Guard) e guarda a referência do jogador/cesta.
	void UpdateTargets(const FVector& PlayerLocation, const FVector& RimFloorPoint);

	// Pose atual para o núcleo (metros).
	Hoops::DefenderPose GetPose() const;

	UPROPERTY(EditAnywhere, Category = "Hoops|Defensor")
	float HeightCm = 200.0f;

	UPROPERTY(EditAnywhere, Category = "Hoops|Defensor")
	float WingspanCm = 210.0f;

	UPROPERTY(EditAnywhere, Category = "Hoops|Defensor", meta = (ClampMin = "25", ClampMax = "99"))
	float PerimeterDefense = 75.0f;

	// Distância para o arremessador (closeout).
	UPROPERTY(EditAnywhere, Category = "Hoops|Defensor")
	float GapCm = 120.0f;

	UPROPERTY(EditAnywhere, Category = "Hoops|Defensor")
	float ReactionSeconds = 0.18f;

	UPROPERTY(EditAnywhere, Category = "Hoops|Defensor")
	float JumpHeightCm = 45.0f;

	UPROPERTY(EditAnywhere, Category = "Hoops|Defensor")
	float GuardSpeedCm = 520.0f;

protected:
	virtual void BeginPlay() override;

private:
	FVector DesiredFeetLocation() const;
	double CurrentJumpHeightCm() const;
	double Now() const;

	UPROPERTY(VisibleAnywhere, Category = "Hoops|Defensor")
	TObjectPtr<UCapsuleComponent> Capsule;

	UPROPERTY(VisibleAnywhere, Category = "Hoops|Defensor")
	TObjectPtr<UStaticMeshComponent> Body;

	UPROPERTY(VisibleAnywhere, Category = "Hoops|Defensor")
	TObjectPtr<UStaticMeshComponent> Hand;

	EHoopsDummyMode Mode = EHoopsDummyMode::Off;
	FVector FeetLocation = FVector::ZeroVector;
	FVector LastPlayerLocation = FVector::ZeroVector;
	FVector LastRimFloorPoint = FVector::ZeroVector;
	double JumpStartTime = -100.0;
};
