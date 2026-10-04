#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"

#include "HoopsFreestyleGameMode.generated.h"

class AHoopsBall;
class AHoopsHoop;

// Modo Freestyle (docs/10-modos.md §0): jogador sozinho, quadra, cesta e bola com "rebotedor".
// Funciona num nível VAZIO: se a quadra/cesta/bola não existirem no nível, são criadas aqui.
UCLASS()
class GARRAFAO_API AHoopsFreestyleGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AHoopsFreestyleGameMode();

	// Encontra (ou cria) quadra, cesta e bola no mundo e inicializa a física da bola.
	static void EnsureEnvironment(UWorld* World, AHoopsHoop*& OutHoop, AHoopsBall*& OutBall);
};
