#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"

#include "HoopsCourt.generated.h"

class UDirectionalLightComponent;
class USkyAtmosphereComponent;
class USkyLightComponent;

// Meia-quadra graybox com medidas oficiais (linhas, garrafão, arco de 3) + iluminação básica.
// Origem do ator = ponto no chão sob o centro do aro; +X do ator = da tabela para dentro da quadra.
UCLASS()
class GARRAFAO_API AHoopsCourt : public AActor
{
	GENERATED_BODY()

public:
	AHoopsCourt();

	UPROPERTY(EditAnywhere, Category = "Hoops|Quadra")
	bool bSpawnLighting = true;

	UPROPERTY(EditAnywhere, Category = "Hoops|Quadra")
	FLinearColor WoodColor = FLinearColor(0.60f, 0.38f, 0.20f);

	UPROPERTY(EditAnywhere, Category = "Hoops|Quadra")
	FLinearColor PaintColor = FLinearColor(0.42f, 0.10f, 0.07f);

	UPROPERTY(EditAnywhere, Category = "Hoops|Quadra")
	FLinearColor LineColor = FLinearColor(0.95f, 0.95f, 0.95f);

protected:
	virtual void BeginPlay() override;

private:
	void BuildCourt();
	void AddLine(const FVector2D& A, const FVector2D& B);
	void AddArc(const FVector2D& Center, float Radius, float StartDeg, float EndDeg, int32 Segments);

	UPROPERTY(VisibleAnywhere, Category = "Hoops|Quadra")
	TObjectPtr<USceneComponent> Root;

	UPROPERTY(VisibleAnywhere, Category = "Hoops|Luz")
	TObjectPtr<UDirectionalLightComponent> Sun;

	UPROPERTY(VisibleAnywhere, Category = "Hoops|Luz")
	TObjectPtr<USkyLightComponent> SkyLight;

	UPROPERTY(VisibleAnywhere, Category = "Hoops|Luz")
	TObjectPtr<USkyAtmosphereComponent> SkyAtmosphere;
};
