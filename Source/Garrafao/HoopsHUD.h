#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"

#include "HoopsHUD.generated.h"

// HUD do Freestyle desenhado com Canvas (sem assets): medidor de arremesso no estilo 2K23,
// feedback de timing/cobertura, energia e Explosões, estatísticas da sessão e overlay de laboratório.
UCLASS()
class GARRAFAO_API AHoopsHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;
};
