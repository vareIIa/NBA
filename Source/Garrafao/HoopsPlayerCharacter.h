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
#include "HoopsDummyRig.h"

#include "HoopsPlayerCharacter.generated.h"

class AHoopsBall;
class UAnimSequence;
class USoundWaveProcedural;
class UHoopsAnimInstance;
class USkeletalMesh;
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

	// Medidor congelado na soltura (fica ~1 s na tela com a cor do resultado, como no 2K) e o flash do green.
	float ResultFill = 0.0f;
	FLinearColor ResultColor = FLinearColor::White;
	double ResultTime = -100.0;
	double GreenTime = -100.0;
	double Now = 0.0;

	// Jogador.
	float Energy = 1.0f;
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

	// Versão e corpo em uso (para saber na hora se o boneco animado carregou).
	FString BuildLabel;
	FString BodyStatus;
	bool bBodyAnimated = false;

	// Laboratório.
	bool bLabOverlay = false;
	TArray<FString> InputHistory;
	TArray<FString> LabLines;
};

// Jogador do Freestyle: controles do 2K23 (docs/02-controles.md), drible pelo Pro Stick, arremesso com green.
// Corpo: boneco animado (mocap, Tools/Animacao) se importado; senão manequim da Epic; senão um cilindro.
// A lógica vem do núcleo HoopsSimCore.
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

	// --- Green (estilo 2K Park) ---
	// Quanto tempo o jogador segura o follow-through depois de um green (s). Soltura normal segura menos.
	UPROPERTY(EditAnywhere, Category = "Hoops|Green", meta = (ClampMin = "0.2", ClampMax = "3.0"))
	float GreenHoldSeconds = 1.1f;

	// Celebra sozinho quando um green cai (alterna as celebrações). Com ou sem isso, o D-pad celebra por ~2,5 s
	// depois de uma cesta: cima = flex, direita = shrug, esquerda = segura a pose do arremesso.
	UPROPERTY(EditAnywhere, Category = "Hoops|Green")
	bool bAutoCelebrate = true;

	// Feedback do green na hora da soltura (padrão) ou só quando a bola chega ao aro (como no 2K23).
	UPROPERTY(EditAnywhere, Category = "Hoops|Green")
	bool bGreenFeedbackAtRim = false;

	// Som do green (sintetizado, sem asset).
	UPROPERTY(EditAnywhere, Category = "Hoops|Green", meta = (ClampMin = "0.0", ClampMax = "2.0"))
	float GreenSoundVolume = 0.8f;

	// Multiplicador da janela green (1 = padrão do jogo). Dá para mexer durante o Play no painel Details do jogador.
	UPROPERTY(EditAnywhere, Category = "Hoops|Configuracoes", meta = (ClampMin = "0.5", ClampMax = "3.0"))
	float GreenWindowScale = 1.0f;

	// 0 = rápida, 1 = normal, 2 = lenta (velocidade de soltura do jumper).
	UPROPERTY(EditAnywhere, Category = "Hoops|Configuracoes", meta = (ClampMin = "0", ClampMax = "2"))
	int32 JumperReleaseSpeed = 1;

	// Treino: energia infinita (desligado por padrão: a stamina é o único limitador do drible e do sprint).
	UPROPERTY(EditAnywhere, Category = "Hoops|Freestyle")
	bool bInfiniteEnergy = false;

	// --- Movimento com a bola ---
	// Analógico abaixo disso = size-up no lugar (ajustes pequenos encarando a cesta). Acima, o jogador anda/corre
	// virando o corpo para onde vai; recuando (retreat dribble) ou com LT, continua encarando a cesta.
	UPROPERTY(EditAnywhere, Category = "Hoops|Movimento", meta = (ClampMin = "0.1", ClampMax = "1.0"))
	float StrafeStickThreshold = 0.35f;

	// Velocidade máxima (cm/s) encarando a cesta (size-up, retreat dribble, LT).
	UPROPERTY(EditAnywhere, Category = "Hoops|Movimento", meta = (ClampMin = "100", ClampMax = "500"))
	float StrafeSpeedCm = 260.0f;

	// --- Boneco animado (Art/Characters/HoopsDummy, importado por Tools/Editor/importar_personagem.py) ---
	UPROPERTY(EditDefaultsOnly, Category = "Hoops|Visual")
	FString DummyAssetFolder = TEXT("/Game/Hoops/Characters/Dummy");

	// Altura do jogador: o boneco é escalado para ela.
	UPROPERTY(EditAnywhere, Category = "Hoops|Visual", meta = (ClampMin = "160", ClampMax = "230"))
	float BodyHeightCm = 196.0f;

	// Ajuste fino da frente do boneco (graus, somado à frente medida pelos pés).
	UPROPERTY(EditAnywhere, Category = "Hoops|Visual")
	float MeshYawAdjust = 0.0f;

	UPROPERTY(EditAnywhere, Category = "Hoops|Visual")
	FLinearColor SkinColor = FLinearColor(0.36f, 0.22f, 0.14f);

	UPROPERTY(EditAnywhere, Category = "Hoops|Visual")
	FLinearColor JerseyColor = FLinearColor(0.04f, 0.16f, 0.50f);

	UPROPERTY(EditAnywhere, Category = "Hoops|Visual")
	FLinearColor ShoesColor = FLinearColor(0.85f, 0.85f, 0.85f);

	// Velocidade do drible parado (o mocap é lento: 1 quique a cada 0,85 s).
	UPROPERTY(EditAnywhere, Category = "Hoops|Animacao", meta = (ClampMin = "0.5", ClampMax = "2.5"))
	float DribbleIdlePlayRate = 0.9f; // o clipe já tem 2 quiques por loop: ~2,1 quiques/s, ritmo do 2K23 (docs/17 §4.1)

	// Postura atlética do drible (2K: baixo, base larga): quanto o quadril desce parado (cm). Andando desce 75%,
	// correndo 45%; sem a bola e arremessando, nada. 0 desliga.
	UPROPERTY(EditAnywhere, Category = "Hoops|Animacao", meta = (ClampMin = "0", ClampMax = "30"))
	float DribbleCrouchCm = 12.0f;

	// Inclina o tronco nas acelerações e cortes (e para a frente correndo).
	UPROPERTY(EditAnywhere, Category = "Hoops|Animacao")
	bool bBodyLean = true;

	// Centro da bola em relação à palma no drible (cm; X = frente do jogador, Y = para fora, Z = cima).
	UPROPERTY(EditAnywhere, Category = "Hoops|Animacao")
	FVector DribbleBallOffset = FVector(0.0, 2.0, -14.0);

	// Centro da bola em relação à palma da mão do arremesso (cm; X = frente, Y = direita, Z = cima).
	UPROPERTY(EditAnywhere, Category = "Hoops|Animacao")
	FVector ShotBallOffset = FVector(3.0, 0.0, 11.0);

	// Caminhos do manequim (pacote "Third Person" da Epic), usado se o boneco não foi importado.
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
	bool TryLoadDummyRig();
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
	// bAlreadyStarted: o núcleo já começou o movimento (saiu do buffer dentro do Dribble.Update); só aplica os efeitos.
	void StartDribbleMove(Hoops::DribbleMove Move, bool bRedirect = false, bool bAlreadyStarted = false);
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

	// ---------------- Boneco animado
	UHoopsAnimInstance* GetHoopsAnim() const;
	UAnimSequence* GetClip(EHoopsClip Clip) const;
	void UpdateBodyAnimation(float DeltaSeconds);
	void PlayShotAction(float StartSeconds, float SecondsToRelease);
	UAnimSequence* GetActionClip(EHoopsClip Clip) const; // sem cair para a base: nullptr se não houver
	void PlayGreenChime();
	void OnShotReleased(const Hoops::ShotEvaluation& Eval, double HoldMs);
	void FireShotFeedback();          // banner + "GREEN!" + som (na soltura ou no aro)
	void UpdatePendingFeedback();
	void Celebrate();
	bool TryDpadCelebration(int32 Slot); // true = usou o D-pad para celebrar (janela depois da cesta)
	// Bola segura pelo boneco: roda no Tick da bola, depois da animação deste frame.
	void LateUpdateHeldBall(float DeltaSeconds);
	FVector HandBallPoint(Hoops::BallHand Hand) const;
	FVector ShotBallPoint() const;
	void BeginBallFlight(const FVector& Start, Hoops::BallHand ToHand, double Seconds);
	void ResetBallCarry(Hoops::BallHand Hand, double BlendSeconds);
	void TrackHandStroke(Hoops::BallHand Hand, const FVector& HandPoint, float DeltaSeconds);

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

	// ---------------- Boneco animado
	UPROPERTY(Transient)
	TObjectPtr<USkeletalMesh> DummyMesh;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UAnimSequence>> DummyClips; // índice = EHoopsClip

	bool bRigActive = false;
	float MeshYawOffset = 0.0f;   // yaw base do corpo visual (boneco calibrado / manequim -90 / cilindro 0)
	float MeshScale = 1.0f;
	float MeshForwardYaw = 0.0f;  // frente do boneco no espaço da malha (medida pelos pés)
	FVector PrevWorldVelocity = FVector::ZeroVector;
	bool bSizeUpLatched = true;   // histerese do size-up / retreat (não fica trocando de orientação a cada frame)
	bool bRetreatLatched = false;
	FVector SmoothedLocalAccel = FVector::ZeroVector;
	EHoopsClip BaseClip = EHoopsClip::HoldIdle;

	// Bola na mão animada: na mão (sobe e desce com ela) ou em voo (quique até a mão que vai receber).
	enum class EBallCarry : uint8 { Hand, Flight };
	EBallCarry Carry = EBallCarry::Hand;
	Hoops::BallHand CarryHand = Hoops::BallHand::Right;
	Hoops::BallHand FlightHand = Hoops::BallHand::Right;
	Hoops::DribbleArc FlightArc;
	double FlightStart = 0.0;
	double FlightSeconds = 0.3;
	double CarryStart = 0.0;
	double LastPushTime = -10.0;
	double PushPeriod = 0.6;      // intervalo medido entre empurrões (s)
	// Curso da mão (altura relativa ao capsule) para detectar o empurrão do drible na animação.
	bool bHandTrackValid = false;
	Hoops::BallHand TrackedHand = Hoops::BallHand::Right;
	float HandPrevZ = 0.0f;
	float HandVz = 0.0f;
	float StrokeTopZ = 0.0f;
	float StrokePeakVz = 0.0f;
	bool bHasTopRelative = false;
	FVector LastTopRelative = FVector::ZeroVector; // ponto da bola no topo do curso (referencial do jogador)
	// Troca de mão pedida por um drible (crossover etc.).
	bool bSwitchRequested = false;
	bool bDoubleCrossPending = false;
	double SwitchFlightSeconds = 0.3;
	// Green: último arremesso foi green (celebra se cair) e qual celebração vem a seguir.
	bool bLastShotGreen = false;
	double LastDribbleEffectsStart = -1.0; // StartTime do último drible cujos efeitos (impulso, bola, animação) já rodaram
	bool bFeedbackPending = false;   // esperando a bola chegar ao aro (bGreenFeedbackAtRim)
	double LastMakeTime = -100.0;
	FVector ShotDrift = FVector::ZeroVector; // deriva para trás do arremesso com o boneco (fadeaway, step-back)
	Hoops::GatherCarry PullUpCarry;               // pull-up sem frear: embalo do drible no gather (docs/17 §3.4)
	FVector PullUpCarryDir = FVector::ZeroVector; // sentido do embalo no gather (mundo, 2D)
	float CurrentBaseRateAbs = 1.0f;         // playrate do loop de base (ajusta o detector do empurrão)
	int32 CelebrationIndex = 0;

	// Transição suave da bola (recepção, gather, pump fake).
	FVector BallBlendFrom = FVector::ZeroVector;
	double BallBlendStart = -10.0;
	double BallBlendSeconds = 0.0;

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

	UPROPERTY(Transient)
	TObjectPtr<USoundWaveProcedural> GreenChime; // mantém o som vivo enquanto toca
};
