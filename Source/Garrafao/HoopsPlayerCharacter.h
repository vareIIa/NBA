#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "HoopsSimCore/HoopsContest.h"
#include "HoopsSimCore/HoopsCourt.h"
#include "HoopsSimCore/HoopsDribble.h"
#include "HoopsSimCore/HoopsDribbleMoves.h"
#include "HoopsSimCore/HoopsProStick.h"
#include "HoopsSimCore/HoopsRandom.h"
#include "HoopsSimCore/HoopsShotModel.h"

#include "HoopsPlayerCharacter.generated.h"

class AHoopsBall;
class AHoopsDummyDefender;
class AHoopsHoop;
class UCameraComponent;
class UInputAction;
class UInputMappingContext;
class USpringArmComponent;
class UStaticMeshComponent;
struct FInputActionValue;

// Dados que o HUD desenha (sem lógica).
struct FHoopsHudData
{
	// Medidor de arremesso (2K23: enche até o ponto ideal).
	bool bShowMeter = false;
	float MeterFill = 0.0f;         // 0..1+ (1 = ponto ideal)
	float GreenStart = 0.0f;        // faixa green em unidades do medidor
	float GreenEnd = 0.0f;
	float GoodStart = 0.0f;
	float GoodEnd = 0.0f;
	FVector MeterWorldAnchor = FVector::ZeroVector;

	// Feedback do último arremesso.
	bool bShowFeedback = false;
	FString FeedbackTiming;
	FString FeedbackCoverage;
	FString FeedbackDetail;
	FLinearColor FeedbackColor = FLinearColor::White;
	double FeedbackTime = -100.0;

	// Jogador.
	float Energy = 1.0f;
	int32 Explosions = 3;
	FString CurrentMove;
	int32 ComboCount = 0;
	bool bBallInRightHand = true;
	FVector PlayerWorldLocation = FVector::ZeroVector;
	float HalfHeight = 96.0f;

	// Sessão.
	int32 Attempts = 0;
	int32 Makes = 0;
	int32 Greens = 0;
	int32 Streak = 0;
	int32 BestStreak = 0;
	FString SpotName;
	FString DummyLabel;
	float TimeScale = 1.0f;

	// Laboratório.
	bool bLabOverlay = false;
	TArray<FString> InputHistory;
	TArray<FString> LabLines;
};

// Jogador do Freestyle: controles do 2K23 (docs/02-controles.md), drible pelo Pro Stick, arremesso com green.
// Fase 0: sem animações próprias ainda (manequim/placeholder); a lógica vem do núcleo HoopsSimCore.
UCLASS()
class GARRAFAO_API AHoopsPlayerCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	AHoopsPlayerCharacter();

	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
	virtual void PawnClientRestart() override;

	const FHoopsHudData& GetHudData() const { return Hud; }

	// --- Atributos (Fase 0: fixos; depois vêm da criação de jogador) ---
	UPROPERTY(EditAnywhere, Category = "Hoops|Atributos", meta = (ClampMin = "25", ClampMax = "99"))
	float ThreePointRating = 85.0f;

	UPROPERTY(EditAnywhere, Category = "Hoops|Atributos", meta = (ClampMin = "25", ClampMax = "99"))
	float MidRangeRating = 85.0f;

	UPROPERTY(EditAnywhere, Category = "Hoops|Atributos", meta = (ClampMin = "25", ClampMax = "99"))
	float CloseShotRating = 80.0f;

	UPROPERTY(EditAnywhere, Category = "Hoops|Atributos", meta = (ClampMin = "25", ClampMax = "99"))
	float LayupRating = 85.0f;

	UPROPERTY(EditAnywhere, Category = "Hoops|Atributos", meta = (ClampMin = "25", ClampMax = "99"))
	float DunkRating = 80.0f;

	// --- Configurações iguais às do 2K23 ---
	UPROPERTY(EditAnywhere, Category = "Hoops|Configuracoes")
	bool bShotMeterEnabled = true;

	UPROPERTY(EditAnywhere, Category = "Hoops|Configuracoes")
	bool bShotFeedbackEnabled = true;

	// Multiplicador da janela green (1 = padrão do jogo). Dá para mexer durante o Play no painel Details do jogador.
	UPROPERTY(EditAnywhere, Category = "Hoops|Configuracoes", meta = (ClampMin = "0.5", ClampMax = "3.0"))
	float GreenWindowScale = 1.0f;

	// 0 = rápida, 1 = normal, 2 = lenta (velocidade de soltura do jumper).
	UPROPERTY(EditAnywhere, Category = "Hoops|Configuracoes", meta = (ClampMin = "0", ClampMax = "2"))
	int32 JumperReleaseSpeed = 1;

	// Freestyle: Explosões infinitas para treinar combos.
	UPROPERTY(EditAnywhere, Category = "Hoops|Freestyle")
	bool bInfiniteExplosions = true;

	// Caminhos do manequim (pacote "Third Person" da Epic). Se não existir, usa um corpo placeholder.
	UPROPERTY(EditDefaultsOnly, Category = "Hoops|Visual")
	TArray<FString> MannequinMeshPaths;

	UPROPERTY(EditDefaultsOnly, Category = "Hoops|Visual")
	TArray<FString> MannequinAnimClassPaths;

protected:
	virtual void BeginPlay() override;

private:
	// ---------------- Setup
	void EnsureInputConfig();
	void EnsureWorldRefs();
	void TryLoadMannequin();
	void ResetToSpot(int32 SpotIndex);

	// ---------------- Input (Enhanced Input, mapa do 2K23)
	void OnMove(const FInputActionValue& Value);
	void OnMoveReleased(const FInputActionValue& Value);
	void OnProStick(const FInputActionValue& Value);
	void OnProStickReleased(const FInputActionValue& Value);
	void OnShootPressed(const FInputActionValue& Value);
	void OnShootReleased(const FInputActionValue& Value);
	void OnSprintPressed(const FInputActionValue& Value);
	void OnSprintReleased(const FInputActionValue& Value);
	void OnLeftTriggerPressed(const FInputActionValue& Value);
	void OnLeftTriggerReleased(const FInputActionValue& Value);
	void OnPassPressed(const FInputActionValue& Value);
	void OnBouncePassPressed(const FInputActionValue& Value);
	void OnLobPressed(const FInputActionValue& Value);
	void OnIconPassPressed(const FInputActionValue& Value);
	void OnPlayCallPressed(const FInputActionValue& Value);
	void OnRequestBall(const FInputActionValue& Value);
	void OnResetSpot(const FInputActionValue& Value);
	void OnPrevSpot(const FInputActionValue& Value);
	void OnNextSpot(const FInputActionValue& Value);
	void OnToggleLab(const FInputActionValue& Value);
	void OnCycleDummy(const FInputActionValue& Value);
	void OnSlowMotion(const FInputActionValue& Value);

	void LogInput(const FString& Label);

	// ---------------- Gameplay
	void UpdateMovement(float DeltaSeconds);
	void UpdateProStick();
	void HandleGesture(const Hoops::StickGesture& Gesture);
	void StartDribbleMove(Hoops::DribbleMove Move);
	void UpdateDribbleBall(float DeltaSeconds);
	void PlanDribbleArc(bool bSwitchHand, double PeriodOverride);
	FVector HandWorldLocation(Hoops::BallHand Hand, double SecondsAhead) const;
	FVector SetPointWorldLocation() const;

	void BeginShot(bool bFromProStick);
	void UpdateShot(float DeltaSeconds);
	void ReleaseShot();
	void CancelShotAsPumpFake();
	void BeginFinish(bool bDunk);
	void UpdateFinish(float DeltaSeconds);
	void ReleaseFinish();
	Hoops::ShotContext BuildJumperContext() const;
	// Contestação agora (uma amostra) e na soltura (maior valor na janela de ~100 ms antes da soltura).
	Hoops::ContestBreakdown SampleContest() const;
	double ContestAtRelease();
	void DrawContestDebug() const;

	void UpdateBallPossession(float DeltaSeconds);
	void PassBallToPlayer();
	void CatchBall();
	void ShowFeedback(const Hoops::ShotEvaluation& Eval, const Hoops::ShotContext& Context);
	void UpdateHud();

	double Now() const;
	FVector HoopForward() const;
	FVector CameraForwardFlat() const;

	// ---------------- Componentes
	UPROPERTY(VisibleAnywhere, Category = "Hoops|Camera")
	TObjectPtr<USpringArmComponent> CameraBoom;

	UPROPERTY(VisibleAnywhere, Category = "Hoops|Camera")
	TObjectPtr<UCameraComponent> Camera;

	UPROPERTY(VisibleAnywhere, Category = "Hoops|Visual")
	TObjectPtr<UStaticMeshComponent> PlaceholderBody;

	// ---------------- Input (criado em runtime: sem assets binários)
	UPROPERTY(Transient)
	TObjectPtr<UInputMappingContext> MappingContext;

	UPROPERTY(Transient)
	TMap<FName, TObjectPtr<UInputAction>> Actions;

	// ---------------- Mundo
	UPROPERTY(Transient)
	TObjectPtr<AHoopsBall> Ball;

	UPROPERTY(Transient)
	TObjectPtr<AHoopsHoop> Hoop;

	UPROPERTY(Transient)
	TObjectPtr<AHoopsDummyDefender> Dummy;

	// ---------------- Estado (núcleo)
	Hoops::ShotModel ShotModel;
	Hoops::Rng Random;
	Hoops::ProStickRecognizer ProStick;
	Hoops::DribbleController Dribble;
	Hoops::CourtSpec Court;

	FVector2D MoveInput = FVector2D::ZeroVector;
	FVector2D StickInput = FVector2D::ZeroVector;
	bool bSprintHeld = false;
	bool bLeftTriggerHeld = false;
	bool bHasBall = true;

	// Drible.
	Hoops::DribbleArc CurrentArc;
	double ArcStartTime = 0.0;
	bool bArcValid = false;
	double SpinVisualStart = -100.0;
	double SpinVisualDuration = 0.0;
	float SpinVisualDegrees = 0.0f;

	// Arremesso.
	enum class EShotPhase : uint8 { None, Jumper, Finish };
	EShotPhase ShotPhase = EShotPhase::None;
	bool bShotFromProStick = false;
	bool bJumpCommitted = false;
	bool bFinishIsDunk = false;
	double GatherTime = 0.0;
	Hoops::ShotContext ShotContext;
	Hoops::TimingWindows ShotWindows;
	bool bAwaitingShotResult = false;
	TArray<TPair<double, double>> ContestSamples; // (tempo, contestação) durante o arremesso
	Hoops::ContestBreakdown LastContest;

	// Rebotedor do Freestyle.
	double ReturnBallAt = -1.0;

	// Spots do Freestyle.
	int32 CurrentSpot = 0;

	// Duplo toque (Y Y alley-oop, B B passe flashy, X X spin gather).
	double LastYPressTime = -10.0;
	double LastBPressTime = -10.0;

	FHoopsHudData Hud;
};
