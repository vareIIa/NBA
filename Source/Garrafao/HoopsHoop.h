#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "HoopsSimCore/HoopsCourt.h"

#include "HoopsHoop.generated.h"

// Cesta oficial (aro, tabela, rede, poste). Origem = chão sob o centro do aro; +X = da tabela para a quadra.
// A geometria visual é gerada a partir do MESMO Hoops::HoopSpec que a física usa, então o que se vê é o que colide.
UCLASS()
class GARRAFAO_API AHoopsHoop : public AActor
{
	GENERATED_BODY()

public:
	AHoopsHoop();

	// Especificação da cesta no mundo (metros), para o núcleo de simulação.
	Hoops::HoopSpec GetHoopSpec() const;

	FVector GetRimCenterWorld() const;
	FVector GetRimFloorPointWorld() const { return GetActorLocation(); }
	FVector GetForwardWorld() const { return GetActorForwardVector(); }

protected:
	virtual void BeginPlay() override;

private:
	void BuildVisuals();

	UPROPERTY(VisibleAnywhere, Category = "Hoops|Cesta")
	TObjectPtr<USceneComponent> Root;
};
