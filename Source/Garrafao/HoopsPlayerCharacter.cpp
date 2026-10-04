#include "HoopsPlayerCharacter.h"

#include "Animation/AnimInstance.h"
#include "Animation/AnimSequence.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/LocalPlayer.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "Garrafao.h"
#include "DrawDebugHelpers.h"
#include "HoopsAudio.h"
#include "HoopsBall.h"
#include "HoopsDummyDefender.h"
#include "HoopsAnimInstance.h"
#include "HoopsFreestyleGameMode.h"
#include "HoopsHoop.h"
#include "HoopsMeshUtil.h"
#include "HoopsSimCore/HoopsShotSolver.h"
#include "HoopsUnits.h"
#include "InputAction.h"
#include "InputActionValue.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "Kismet/GameplayStatics.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	constexpr float CapsuleRadiusCm = 38.0f;
	constexpr float CapsuleHalfHeightCm = 98.0f;  // jogador de ~1,96 m
	constexpr float HandHeightCm = 80.0f;          // centro da bola na mão, acima do chão
	constexpr float JogSpeedCm = 470.0f;
	constexpr float SprintSpeedCm = 720.0f;
	constexpr float WithBallSpeedScale = 0.93f;
	constexpr double RunningCrossSpeedCm = 300.0;  // crossover acima disso (correndo, fora do size-up) = o de corrida
	constexpr double CatchRadiusCm = 85.0;
	constexpr double LayupReleaseSeconds = 0.42;
	constexpr double DunkReleaseSeconds = 0.48;
	constexpr double LayupStopShortCm = 60.0;  // a bandeja solta a 60 cm do aro; a enterrada, com as mãos acima da cabeça, a 35
	constexpr double DunkStopShortCm = 35.0;
	constexpr double TurnBackDelaySeconds = 1.3; // soltura -> vira e volta (docs/17 §1.1: +1300 a +1500 ms)
	constexpr float TurnBackPlayRate = 1.8f;     // giro do clipe (1,6 s no mocap) em ~0,9 s (gesto #3: 0,6-0,9 s)

	struct FFreestyleSpot
	{
		const TCHAR* Name;
		double DistanceM;
		double AngleDeg; // 0 = topo; positivo = lado direito de quem olha para a cesta (eixo +Y local)
	};

	const FFreestyleSpot Spots[] = {
		{TEXT("Topo (3)"), 7.6, 0.0},
		{TEXT("Ala direita (3)"), 7.5, 45.0},
		{TEXT("Canto direito (3)"), 6.95, 86.0},
		{TEXT("Ala esquerda (3)"), 7.5, -45.0},
		{TEXT("Canto esquerdo (3)"), 6.95, -86.0},
		{TEXT("Cotovelo direito"), 4.6, 32.0},
		{TEXT("Cotovelo esquerdo"), 4.6, -32.0},
		{TEXT("Linha de lance livre"), 4.19, 0.0},
		{TEXT("Logo (longe)"), 9.5, 0.0},
	};
	constexpr int32 NumSpots = static_cast<int32>(UE_ARRAY_COUNT(Spots));

	FString Ansi(const char* Text) { return FString(ANSI_TO_TCHAR(Text)); }

	// Medidor do 2K23: enche até o topo no ponto ideal e, segurando além, volta a descer (lado "tarde").
	float FoldMeter(double Fraction)
	{
		return static_cast<float>(Fraction <= 1.0 ? Fraction : FMath::Max(0.0, 2.0 - Fraction));
	}
}

AHoopsPlayerCharacter::AHoopsPlayerCharacter()
{
	PrimaryActorTick.bCanEverTick = true;

	bUseControllerRotationPitch = false;
	bUseControllerRotationYaw = false;
	bUseControllerRotationRoll = false;

	GetCapsuleComponent()->InitCapsuleSize(CapsuleRadiusCm, CapsuleHalfHeightCm);

	UCharacterMovementComponent* Movement = GetCharacterMovement();
	Movement->bOrientRotationToMovement = true;
	Movement->RotationRate = FRotator(0.0f, 900.0f, 0.0f);
	Movement->MaxWalkSpeed = JogSpeedCm;
	Movement->MaxAcceleration = 2600.0f;
	Movement->BrakingDecelerationWalking = 2800.0f;
	Movement->GroundFriction = 9.0f;
	Movement->JumpZVelocity = 430.0f;
	Movement->AirControl = 0.15f;

	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(RootComponent);
	CameraBoom->SetUsingAbsoluteRotation(true);
	CameraBoom->TargetArmLength = 1050.0f;
	CameraBoom->bDoCollisionTest = false;
	CameraBoom->bUsePawnControlRotation = false;
	CameraBoom->bEnableCameraLag = true;
	CameraBoom->CameraLagSpeed = 6.0f;
	CameraBoom->SetRelativeLocation(FVector(0.0f, 0.0f, 60.0f));

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	Camera->bUsePawnControlRotation = false;
	Camera->SetFieldOfView(55.0f);

	// Corpo placeholder (cilindro) enquanto não houver manequim/MetaHuman.
	PlaceholderBody = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("PlaceholderBody"));
	PlaceholderBody->SetupAttachment(RootComponent);
	static ConstructorHelpers::FObjectFinder<UStaticMesh> CylinderMesh(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	if (CylinderMesh.Succeeded())
	{
		PlaceholderBody->SetStaticMesh(CylinderMesh.Object);
	}
	PlaceholderBody->SetRelativeScale3D(FVector(0.32f, 0.50f, 1.94f)); // profundidade x largura dos ombros
	PlaceholderBody->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	MannequinMeshPaths = {
		TEXT("/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple.SKM_Manny_Simple"),
		TEXT("/Game/Characters/Mannequins/Meshes/SKM_Manny.SKM_Manny"),
		TEXT("/Game/Characters/Mannequins/Meshes/SKM_Quinn_Simple.SKM_Quinn_Simple"),
	};
	MannequinAnimClassPaths = {
		TEXT("/Game/Characters/Mannequins/Anims/Unarmed/ABP_Unarmed.ABP_Unarmed_C"),
		TEXT("/Game/Characters/Mannequins/Animations/ABP_Manny.ABP_Manny_C"),
		TEXT("/Game/Characters/Mannequins/Animations/ABP_Quinn.ABP_Quinn_C"),
	};
}

// ============================================================================ Setup

void AHoopsPlayerCharacter::BeginPlay()
{
	Super::BeginPlay();

	Random = Hoops::Rng(static_cast<uint64>(FPlatformTime::Cycles64()));
	Hoops::DribbleEnergyConfig EnergyConfig;
	EnergyConfig.bInfiniteEnergy = bInfiniteEnergy;
	Dribble = Hoops::DribbleController(EnergyConfig);

	HoopsMeshUtil::SetColor(this, PlaceholderBody, FLinearColor(0.08f, 0.08f, 0.09f));
	Hud.DummyLabel = TEXT("Sem defensor");
	Hud.BuildLabel = TEXT("Garrafao Freestyle v0.5");
	if (!TryLoadDummyRig())
	{
		TryLoadMannequin();
	}
	Hud.bBodyAnimated = bRigActive;
	EnsureWorldRefs();
	ResetToSpot(0);
}

void AHoopsPlayerCharacter::TryLoadMannequin()
{
	const ELoadFlags Quiet = static_cast<ELoadFlags>(LOAD_NoWarn | LOAD_Quiet);
	USkeletalMesh* MeshAsset = nullptr;
	for (const FString& Path : MannequinMeshPaths)
	{
		MeshAsset = LoadObject<USkeletalMesh>(nullptr, *Path, nullptr, Quiet);
		if (MeshAsset)
		{
			break;
		}
	}
	if (!MeshAsset)
	{
		UE_LOG(LogHoops, Log, TEXT("Manequim nao encontrado: usando corpo placeholder. (Adicione o pacote Third Person para ver o Manny.)"));
		return;
	}

	MeshYawOffset = -90.0f;
	GetMesh()->SetSkeletalMeshAsset(MeshAsset);
	GetMesh()->SetRelativeLocationAndRotation(FVector(0.0f, 0.0f, -CapsuleHalfHeightCm), FRotator(0.0f, MeshYawOffset, 0.0f));
	for (const FString& Path : MannequinAnimClassPaths)
	{
		if (UClass* AnimClass = LoadClass<UAnimInstance>(nullptr, *Path, nullptr, Quiet))
		{
			GetMesh()->SetAnimInstanceClass(AnimClass);
			break;
		}
	}
	PlaceholderBody->SetVisibility(false);
}

void AHoopsPlayerCharacter::EnsureWorldRefs()
{
	if (Ball && Hoop)
	{
		return;
	}
	AHoopsHoop* FoundHoop = nullptr;
	AHoopsBall* FoundBall = nullptr;
	AHoopsFreestyleGameMode::EnsureEnvironment(GetWorld(), FoundHoop, FoundBall);
	Hoop = FoundHoop;
	Ball = FoundBall;
	if (Ball)
	{
		Ball->AddTickPrerequisiteActor(this); // a bola se move depois do jogador no mesmo frame
		if (bRigActive)
		{
			// ... e depois da animação do boneco: a bola segue a mão animada deste frame.
			Ball->AddTickPrerequisiteComponent(GetMesh());
			Ball->OnHeldUpdate.BindUObject(this, &AHoopsPlayerCharacter::LateUpdateHeldBall);
		}
	}
}

void AHoopsPlayerCharacter::EnsureInputConfig()
{
	if (MappingContext)
	{
		return;
	}

	MappingContext = NewObject<UInputMappingContext>(this, TEXT("IMC_Hoops2K"));

	auto MakeAction = [this](const TCHAR* Name, EInputActionValueType Type) -> UInputAction*
	{
		UInputAction* Action = NewObject<UInputAction>(this, Name);
		Action->ValueType = Type;
		Actions.Add(FName(Name), Action);
		return Action;
	};
	auto MapKey = [this](UInputAction* Action, const FKey& Key, bool bSwizzle = false, bool bNegate = false)
	{
		FEnhancedActionKeyMapping& Mapping = MappingContext->MapKey(Action, Key);
		if (Key.IsAxis2D())
		{
			// Enhanced Input lê o valor cru: sem zona morta, o analógico "anda sozinho".
			Mapping.Modifiers.Add(NewObject<UInputModifierDeadZone>(MappingContext));
		}
		if (bSwizzle)
		{
			Mapping.Modifiers.Add(NewObject<UInputModifierSwizzleAxis>(MappingContext));
		}
		if (bNegate)
		{
			Mapping.Modifiers.Add(NewObject<UInputModifierNegate>(MappingContext));
		}
	};

	// Mapa do NBA 2K23 (Xbox) — docs/02-controles.md. Teclado é provisório.
	UInputAction* Move = MakeAction(TEXT("IA_Move"), EInputActionValueType::Axis2D);
	MapKey(Move, EKeys::Gamepad_Left2D);
	MapKey(Move, EKeys::W, true);
	MapKey(Move, EKeys::S, true, true);
	MapKey(Move, EKeys::A, false, true);
	MapKey(Move, EKeys::D);

	UInputAction* ProStickAction = MakeAction(TEXT("IA_ProStick"), EInputActionValueType::Axis2D);
	MapKey(ProStickAction, EKeys::Gamepad_Right2D);
	MapKey(ProStickAction, EKeys::Up, true);
	MapKey(ProStickAction, EKeys::Down, true, true);
	MapKey(ProStickAction, EKeys::Left, false, true);
	MapKey(ProStickAction, EKeys::Right);

	struct FButton { const TCHAR* Name; FKey Pad; FKey Key; };
	const FButton Buttons[] = {
		{TEXT("IA_Shoot"), EKeys::Gamepad_FaceButton_Left, EKeys::SpaceBar},       // X
		{TEXT("IA_Pass"), EKeys::Gamepad_FaceButton_Bottom, EKeys::E},             // A
		{TEXT("IA_BouncePass"), EKeys::Gamepad_FaceButton_Right, EKeys::Q},        // B
		{TEXT("IA_Lob"), EKeys::Gamepad_FaceButton_Top, EKeys::R},                 // Y (Y Y = alley-oop)
		{TEXT("IA_Sprint"), EKeys::Gamepad_RightTrigger, EKeys::LeftShift},        // RT
		{TEXT("IA_LeftTrigger"), EKeys::Gamepad_LeftTrigger, EKeys::LeftControl},  // LT
		{TEXT("IA_IconPass"), EKeys::Gamepad_RightShoulder, EKeys::F},             // RB
		{TEXT("IA_PlayCall"), EKeys::Gamepad_LeftShoulder, EKeys::C},              // LB
		{TEXT("IA_RequestBall"), EKeys::Gamepad_DPad_Up, EKeys::G},                // Freestyle
		{TEXT("IA_ResetSpot"), EKeys::Gamepad_DPad_Down, EKeys::BackSpace},
		{TEXT("IA_PrevSpot"), EKeys::Gamepad_DPad_Left, EKeys::One},
		{TEXT("IA_NextSpot"), EKeys::Gamepad_DPad_Right, EKeys::Two},
		{TEXT("IA_ToggleLab"), EKeys::Gamepad_Special_Left, EKeys::Tab},           // View
		{TEXT("IA_DummyMode"), EKeys::Gamepad_Special_Right, EKeys::M},            // Menu: defensor manequim
		{TEXT("IA_SlowMotion"), EKeys::Gamepad_LeftThumbstick, EKeys::T},          // L3: câmera lenta (laboratório)
	};
	for (const FButton& Button : Buttons)
	{
		UInputAction* Action = MakeAction(Button.Name, EInputActionValueType::Boolean);
		MapKey(Action, Button.Pad);
		MapKey(Action, Button.Key);
	}
}

void AHoopsPlayerCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);
	EnsureInputConfig();

	UEnhancedInputComponent* Input = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!Input)
	{
		UE_LOG(LogHoops, Error, TEXT("Enhanced Input nao esta ativo (Config/DefaultInput.ini)."));
		return;
	}

	auto Get = [this](const TCHAR* Name) -> UInputAction* { return Actions.FindRef(FName(Name)); };

	Input->BindAction(Get(TEXT("IA_Move")), ETriggerEvent::Triggered, this, &AHoopsPlayerCharacter::OnMove);
	Input->BindAction(Get(TEXT("IA_Move")), ETriggerEvent::Completed, this, &AHoopsPlayerCharacter::OnMoveReleased);
	Input->BindAction(Get(TEXT("IA_ProStick")), ETriggerEvent::Triggered, this, &AHoopsPlayerCharacter::OnProStick);
	Input->BindAction(Get(TEXT("IA_ProStick")), ETriggerEvent::Completed, this, &AHoopsPlayerCharacter::OnProStickReleased);
	Input->BindAction(Get(TEXT("IA_Shoot")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnShootPressed);
	Input->BindAction(Get(TEXT("IA_Shoot")), ETriggerEvent::Completed, this, &AHoopsPlayerCharacter::OnShootReleased);
	Input->BindAction(Get(TEXT("IA_Sprint")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnSprintPressed);
	Input->BindAction(Get(TEXT("IA_Sprint")), ETriggerEvent::Completed, this, &AHoopsPlayerCharacter::OnSprintReleased);
	Input->BindAction(Get(TEXT("IA_LeftTrigger")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnLeftTriggerPressed);
	Input->BindAction(Get(TEXT("IA_LeftTrigger")), ETriggerEvent::Completed, this, &AHoopsPlayerCharacter::OnLeftTriggerReleased);
	Input->BindAction(Get(TEXT("IA_Pass")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnPassPressed);
	Input->BindAction(Get(TEXT("IA_BouncePass")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnBouncePassPressed);
	Input->BindAction(Get(TEXT("IA_Lob")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnLobPressed);
	Input->BindAction(Get(TEXT("IA_IconPass")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnIconPassPressed);
	Input->BindAction(Get(TEXT("IA_PlayCall")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnPlayCallPressed);
	Input->BindAction(Get(TEXT("IA_RequestBall")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnRequestBall);
	Input->BindAction(Get(TEXT("IA_ResetSpot")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnResetSpot);
	Input->BindAction(Get(TEXT("IA_PrevSpot")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnPrevSpot);
	Input->BindAction(Get(TEXT("IA_NextSpot")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnNextSpot);
	Input->BindAction(Get(TEXT("IA_ToggleLab")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnToggleLab);
	Input->BindAction(Get(TEXT("IA_DummyMode")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnCycleDummy);
	Input->BindAction(Get(TEXT("IA_SlowMotion")), ETriggerEvent::Started, this, &AHoopsPlayerCharacter::OnSlowMotion);
}

void AHoopsPlayerCharacter::PawnClientRestart()
{
	Super::PawnClientRestart();
	EnsureInputConfig();

	if (const APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (UEnhancedInputLocalPlayerSubsystem* Subsystem = ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			Subsystem->ClearAllMappings();
			Subsystem->AddMappingContext(MappingContext, 0);
		}
	}
}

void AHoopsPlayerCharacter::ResetToSpot(int32 SpotIndex)
{
	EnsureWorldRefs();
	if (!Hoop || !Ball)
	{
		return;
	}

	CurrentSpot = ((SpotIndex % NumSpots) + NumSpots) % NumSpots;
	const FFreestyleSpot& Spot = Spots[CurrentSpot];
	const FVector Forward = HoopForward();
	// Direita de quem olha para a cesta (de frente para -Forward).
	const FVector Right = FVector::CrossProduct(FVector::UpVector, -Forward);
	const double Rad = FMath::DegreesToRadians(Spot.AngleDeg);
	const FVector Offset = (Forward * FMath::Cos(Rad) + Right * FMath::Sin(Rad)) * (Spot.DistanceM * 100.0);
	const FVector Location = Hoop->GetRimFloorPointWorld() + Offset + FVector(0.0, 0.0, CapsuleHalfHeightCm + 2.0);

	SetActorLocation(Location, false, nullptr, ETeleportType::TeleportPhysics);
	SetActorRotation((Hoop->GetRimFloorPointWorld() - Location).GetSafeNormal2D().Rotation());
	GetCharacterMovement()->StopMovementImmediately();

	ShotPhase = EShotPhase::None;
	bAwaitingShotResult = false;
	bFeedbackPending = false;
	bFinishLaunchPending = false;
	bTurnBackPending = false;
	bTurnBackActive = false;
	ReturnBallAt = -1.0;
	bHasBall = true;
	Dribble.ResetPossession();
	Dribble.SetHand(Hoops::BallHand::Right);
	bArcValid = false;
	Ball->SetControlledLocation(HandWorldLocation(Dribble.GetHand(), 0.0));
	if (bRigActive)
	{
		if (UHoopsAnimInstance* Anim = GetHoopsAnim())
		{
			Anim->StopAction(0.1f);
		}
		ResetBallCarry(Dribble.GetHand(), 0.0);
	}
	Hud.SpotName = Spot.Name;
	LogInput(FString::Printf(TEXT("Spot: %s"), Spot.Name));
}

// ============================================================================ Helpers

double AHoopsPlayerCharacter::Now() const
{
	const UWorld* ThisWorld = GetWorld();
	return ThisWorld ? ThisWorld->GetTimeSeconds() : 0.0;
}

FVector AHoopsPlayerCharacter::HoopForward() const
{
	return Hoop ? Hoop->GetForwardWorld().GetSafeNormal2D() : FVector::ForwardVector;
}

FVector AHoopsPlayerCharacter::CameraForwardFlat() const
{
	// A câmera olha para a cesta (contra o Forward da cesta).
	return -HoopForward();
}

FVector AHoopsPlayerCharacter::HandWorldLocation(Hoops::BallHand Hand, double SecondsAhead) const
{
	const FVector Base = GetActorLocation() + GetVelocity().GetSafeNormal2D() * FMath::Min(GetVelocity().Size2D(), 900.0) * SecondsAhead;
	const FVector Forward = GetActorForwardVector();
	const FVector Right = GetActorRightVector();
	const double Side = Hand == Hoops::BallHand::Right ? 1.0 : -1.0;
	return Base + Forward * 16.0 + Right * (29.0 * Side) + FVector(0.0, 0.0, HandHeightCm - CapsuleHalfHeightCm);
}

FVector AHoopsPlayerCharacter::SetPointWorldLocation() const
{
	// Bola acima da cabeça, levemente à frente (ponto de soltura do jumper).
	return GetActorLocation() + GetActorForwardVector() * 18.0 + FVector(0.0, 0.0, CapsuleHalfHeightCm + 55.0);
}

void AHoopsPlayerCharacter::LogInput(const FString& Label)
{
	Hud.InputHistory.Insert(FString::Printf(TEXT("%7.2f  %s"), Now(), *Label), 0);
	if (Hud.InputHistory.Num() > 16)
	{
		Hud.InputHistory.SetNum(16);
	}
}

// ============================================================================ Input

void AHoopsPlayerCharacter::OnMove(const FInputActionValue& Value) { MoveInput = Value.Get<FVector2D>(); }
void AHoopsPlayerCharacter::OnMoveReleased(const FInputActionValue& Value) { MoveInput = FVector2D::ZeroVector; }
void AHoopsPlayerCharacter::OnProStick(const FInputActionValue& Value) { StickInput = Value.Get<FVector2D>(); }
void AHoopsPlayerCharacter::OnProStickReleased(const FInputActionValue& Value) { StickInput = FVector2D::ZeroVector; }

void AHoopsPlayerCharacter::OnShootPressed(const FInputActionValue& Value)
{
	LogInput(TEXT("X (arremesso) pressionado"));
	BeginShot(false);
}

void AHoopsPlayerCharacter::OnShootReleased(const FInputActionValue& Value)
{
	LogInput(TEXT("X solto"));
	if (ShotPhase == EShotPhase::Jumper && !bShotFromProStick)
	{
		const double HoldMs = (Now() - GatherTime) * 1000.0;
		if (!bJumpCommitted && HoldMs < ShotModel.GetTuning().PumpFakeMaxHoldMs)
		{
			CancelShotAsPumpFake();
		}
		else
		{
			ReleaseShot();
		}
	}
}

void AHoopsPlayerCharacter::OnSprintPressed(const FInputActionValue& Value)
{
	bSprintHeld = true;
	LogInput(TEXT("RT (sprint)"));
}

void AHoopsPlayerCharacter::OnSprintReleased(const FInputActionValue& Value) { bSprintHeld = false; }
void AHoopsPlayerCharacter::OnLeftTriggerPressed(const FInputActionValue& Value) { bLeftTriggerHeld = true; LogInput(TEXT("LT (proteger / post)")); }
void AHoopsPlayerCharacter::OnLeftTriggerReleased(const FInputActionValue& Value) { bLeftTriggerHeld = false; }

void AHoopsPlayerCharacter::OnPassPressed(const FInputActionValue& Value)
{
	LogInput(TEXT("A (passe) - sem companheiro no Freestyle"));
}

void AHoopsPlayerCharacter::OnBouncePassPressed(const FInputActionValue& Value)
{
	const double T = Now();
	LogInput(T - LastBPressTime < 0.30 ? TEXT("B B (passe flashy)") : TEXT("B (passe quicado)"));
	LastBPressTime = T;
}

void AHoopsPlayerCharacter::OnLobPressed(const FInputActionValue& Value)
{
	const double T = Now();
	LogInput(T - LastYPressTime < 0.30 ? TEXT("Y Y (alley-oop)") : TEXT("Y (lob)"));
	LastYPressTime = T;
}

void AHoopsPlayerCharacter::OnIconPassPressed(const FInputActionValue& Value) { LogInput(TEXT("RB (passe por icone)")); }
void AHoopsPlayerCharacter::OnPlayCallPressed(const FInputActionValue& Value) { LogInput(TEXT("LB (jogadas / corta-luz)")); }

void AHoopsPlayerCharacter::OnRequestBall(const FInputActionValue& Value)
{
	if (TryDpadCelebration(0))
	{
		return;
	}
	LogInput(TEXT("D-pad cima: pedir a bola"));
	if (!bHasBall && Ball && Ball->IsFree())
	{
		PassBallToPlayer();
	}
}

void AHoopsPlayerCharacter::OnResetSpot(const FInputActionValue& Value)
{
	if (!TryDpadCelebration(3))
	{
		ResetToSpot(CurrentSpot);
	}
}
void AHoopsPlayerCharacter::OnPrevSpot(const FInputActionValue& Value)
{
	if (!TryDpadCelebration(2))
	{
		ResetToSpot(CurrentSpot - 1);
	}
}

void AHoopsPlayerCharacter::OnNextSpot(const FInputActionValue& Value)
{
	if (!TryDpadCelebration(1))
	{
		ResetToSpot(CurrentSpot + 1);
	}
}

void AHoopsPlayerCharacter::OnToggleLab(const FInputActionValue& Value)
{
	Hud.bLabOverlay = !Hud.bLabOverlay;
}

void AHoopsPlayerCharacter::OnCycleDummy(const FInputActionValue& Value)
{
	EnsureWorldRefs();
	if (!Hoop)
	{
		return;
	}
	if (!Dummy)
	{
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		Dummy = GetWorld()->SpawnActor<AHoopsDummyDefender>(AHoopsDummyDefender::StaticClass(), FTransform::Identity, Params);
	}
	if (!Dummy)
	{
		return;
	}
	const int32 Count = static_cast<int32>(EHoopsDummyMode::Count);
	const EHoopsDummyMode Next = static_cast<EHoopsDummyMode>((static_cast<int32>(Dummy->GetMode()) + 1) % Count);
	const FVector Feet = GetActorLocation() - FVector(0.0, 0.0, CapsuleHalfHeightCm);
	Dummy->SetMode(Next, Feet, Hoop->GetRimFloorPointWorld());
	Hud.DummyLabel = AHoopsDummyDefender::ModeLabel(Next);
	LogInput(FString::Printf(TEXT("Menu: defensor = %s"), *Hud.DummyLabel));
}

void AHoopsPlayerCharacter::OnSlowMotion(const FInputActionValue& Value)
{
	// 100% -> 50% -> 25% -> 100%. O timing do arremesso usa o tempo do jogo, então a janela "estica" junto.
	const float Next = Hud.TimeScale > 0.75f ? 0.5f : (Hud.TimeScale > 0.375f ? 0.25f : 1.0f);
	Hud.TimeScale = Next;
	UGameplayStatics::SetGlobalTimeDilation(this, Next);
	LogInput(FString::Printf(TEXT("L3: velocidade %.0f%%"), Next * 100.0f));
}

// ============================================================================ Tick

void AHoopsPlayerCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	EnsureWorldRefs();
	if (!Hoop || !Ball)
	{
		return;
	}

	const bool bMoving = GetVelocity().Size2D() > 50.0;
	Dribble.Update(Now(), DeltaSeconds, bSprintHeld && bMoving, bMoving);
	// Drible que estava no buffer começou agora (dentro do Update): aplica impulso, troca de mão e animação.
	if (bHasBall && ShotPhase == EShotPhase::None && Dribble.IsMoveActive(Now()) && Dribble.GetActive().StartTime != LastDribbleEffectsStart)
	{
		StartDribbleMove(Dribble.GetActive().Move, false, true);
	}

	UpdateProStick();
	UpdateMovement(DeltaSeconds);

	if (ShotPhase == EShotPhase::Jumper)
	{
		UpdateShot(DeltaSeconds);
	}
	else if (ShotPhase == EShotPhase::Finish)
	{
		UpdateFinish(DeltaSeconds);
	}
	else if (bHasBall && !bRigActive)
	{
		UpdateDribbleBall(DeltaSeconds); // sem boneco: quique procedural (com boneco, a bola segue a mão: LateUpdateHeldBall)
	}

	if (bRigActive)
	{
		UpdateBodyAnimation(DeltaSeconds);
		UpdateTurnBack();
	}

	UpdateBallPossession(DeltaSeconds);
	UpdatePendingFeedback();

	if (Dummy)
	{
		Dummy->UpdateTargets(GetActorLocation() - FVector(0.0, 0.0, CapsuleHalfHeightCm), Hoop->GetRimFloorPointWorld());
	}

	// Câmera estilo 2K: olhando para a cesta, alta, seguindo o jogador.
	const float CameraYaw = static_cast<float>(CameraForwardFlat().Rotation().Yaw);
	CameraBoom->SetWorldRotation(FRotator(-21.0f, CameraYaw, 0.0f));

	// Giro visual do spin: o corpo gira aqui (o clipe Spin_* do boneco não gira, o giro foi tirado dele).
	const double SpinElapsed = Now() - SpinVisualStart;
	USceneComponent* Body = PlaceholderBody->IsVisible() ? static_cast<USceneComponent*>(PlaceholderBody) : static_cast<USceneComponent*>(GetMesh());
	const float BaseYaw = PlaceholderBody->IsVisible() ? 0.0f : MeshYawOffset;
	if (SpinVisualDuration > 0.0 && SpinElapsed < SpinVisualDuration)
	{
		float Alpha = static_cast<float>(SpinElapsed / SpinVisualDuration);
		if (bSpinVisualCurve)
		{
			// Curva medida no mocap (rápido no começo, assenta no fim). Half-spin: vai pela curva e volta suave.
			Alpha = !bSpinVisualReturns ? HoopsDummyRig::SpinTurnAlpha(Alpha)
				: (Alpha < 0.5f ? HoopsDummyRig::SpinTurnAlpha(2.0f * Alpha) : 1.0f - FMath::SmoothStep(0.5f, 1.0f, Alpha));
		}
		Body->SetRelativeRotation(FRotator(0.0f, BaseYaw + SpinVisualDegrees * Alpha, 0.0f));
	}
	else
	{
		Body->SetRelativeRotation(FRotator(0.0f, BaseYaw, 0.0f));
	}

	UpdateHud();
}

void AHoopsPlayerCharacter::UpdateMovement(float DeltaSeconds)
{
	UCharacterMovementComponent* Movement = GetCharacterMovement();

	// Como no 2K23 (referencias/2k23): parado/size-up e recuando (retreat dribble) o jogador encara a cesta; andando
	// para o lado ou para a frente ele VIRA o corpo para onde vai (de perfil no drible lateral). LT = protege
	// encarando a cesta.
	const bool bShooting = ShotPhase != EShotPhase::None;
	const FVector CamFwdFlat = CameraForwardFlat();
	const FVector Wish = (CamFwdFlat * MoveInput.Y + FVector::CrossProduct(FVector::UpVector, CamFwdFlat) * MoveInput.X).GetSafeNormal2D();
	const FVector ToHoop = Hoop ? (Hoop->GetRimFloorPointWorld() - GetActorLocation()).GetSafeNormal2D() : GetActorForwardVector();
	// Com histerese, para o corpo e a velocidade não ficarem piscando perto dos limites.
	const double Stick = MoveInput.Size();
	bSizeUpLatched = Wish.IsNearlyZero() || Stick < StrafeStickThreshold + (bSizeUpLatched ? 0.06 : -0.06);
	bRetreatLatched = !Wish.IsNearlyZero() && FVector::DotProduct(Wish, ToHoop) < (bRetreatLatched ? -0.5 : -0.64); // > ~130° da cesta
	const bool bStrafe = bHasBall && !bSprintHeld && (bLeftTriggerHeld || bRetreatLatched || bSizeUpLatched);

	// Arranque na saída do drible (docs/17 §4.4, P0-8): LS apontado quando o movimento acaba = speedboost ou cross
	// launch na direção do LS, pago com energia (sem contador de boosts, D13). Corta a curva: sai reto para o LS.
	if (bHasBall && !bShooting && Hoop)
	{
		const FVector StickWorld = CamFwdFlat * MoveInput.Y + FVector::CrossProduct(FVector::UpVector, CamFwdFlat) * MoveInput.X;
		const FVector AttackRight = FVector::CrossProduct(FVector::UpVector, ToHoop);
		const Hoops::DribbleExitBurst Burst = Dribble.TryExitBurst(Now(),
			FVector::DotProduct(StickWorld, AttackRight), FVector::DotProduct(StickWorld, ToHoop));
		if (Burst.IsValid())
		{
			const FVector Current2D(Movement->Velocity.X, Movement->Velocity.Y, 0.0);
			const double Along = FMath::Max(0.0, FVector::DotProduct(Current2D, Wish));
			const FVector Launch2D = Wish * (Along + Burst.Speed * 100.0);
			Movement->Velocity = FVector(Launch2D.X, Launch2D.Y, Movement->Velocity.Z);
			LogInput(FString::Printf(TEXT("  arranque: %s +%.1f m/s (energia -%.1f%%)"),
				*Ansi(Hoops::ExitBurstKindLabel(Burst.Kind)), Burst.Speed, Burst.EnergyCost * 100.0));
		}
	}

	// Durante um drible (crossover, hesitação...) ou o arranque de saída, o limite do size-up não segura o impulso.
	const float BurstCm = static_cast<float>(Dribble.ExitBurstSpeed(Now()) * 100.0);
	const bool bMoveBurst = Dribble.IsMoveActive(Now()) || BurstCm > 0.0f;
	const float BaseSpeed = bSprintHeld ? SprintSpeedCm : ((bStrafe && !bMoveBurst) ? StrafeSpeedCm : JogSpeedCm);
	const float BallScale = bHasBall ? WithBallSpeedScale : 1.0f;
	Movement->MaxWalkSpeed = BaseSpeed * BallScale * static_cast<float>(Dribble.SpeedScale()) + BurstCm;

	if (!bShooting && !MoveInput.IsNearlyZero())
	{
		const FVector Fwd = CameraForwardFlat();
		const FVector Right = FVector::CrossProduct(FVector::UpVector, Fwd);
		AddMovementInput(Fwd, static_cast<float>(MoveInput.Y));
		AddMovementInput(Right, static_cast<float>(MoveInput.X));
	}

	// Arremessando ou no size-up: corpo de frente para a cesta. Correndo/sprint/sem bola: vira para onde corre.
	const bool bFaceHoop = bShooting || bStrafe;
	Movement->bOrientRotationToMovement = !bFaceHoop;
	if (bFaceHoop && Hoop)
	{
		const FRotator Target = (Hoop->GetRimFloorPointWorld() - GetActorLocation()).GetSafeNormal2D().Rotation();
		SetActorRotation(FMath::RInterpTo(GetActorRotation(), Target, DeltaSeconds, bShooting ? 18.0f : 9.0f));
	}
}

// ============================================================================ Pro Stick e drible

void AHoopsPlayerCharacter::UpdateProStick()
{
	// Orientação ABSOLUTA do 2K23: "cima" = direção do ataque (para a cesta), X = direita do jogador.
	const FVector CamFwd = CameraForwardFlat();
	const FVector CamRight = FVector::CrossProduct(FVector::UpVector, CamFwd);
	const FVector StickWorld = CamFwd * StickInput.Y + CamRight * StickInput.X;

	const FVector AttackFwd = Hoop ? (Hoop->GetRimFloorPointWorld() - GetActorLocation()).GetSafeNormal2D() : GetActorForwardVector();
	const FVector AttackRight = FVector::CrossProduct(FVector::UpVector, AttackFwd);
	const double LocalX = FVector::DotProduct(StickWorld, AttackRight);
	const double LocalY = FVector::DotProduct(StickWorld, AttackFwd);

	Hoops::StickGesture Gestures[Hoops::ProStickRecognizer::MaxGesturesPerUpdate];
	const int Count = ProStick.Update(Now(), LocalX, LocalY, Gestures);
	for (int Index = 0; Index < Count; ++Index)
	{
		HandleGesture(Gestures[Index]);
	}
}

void AHoopsPlayerCharacter::HandleGesture(const Hoops::StickGesture& Gesture)
{
	const TCHAR* KindLabel = TEXT("?");
	switch (Gesture.Kind)
	{
	case Hoops::StickGestureKind::Flick: KindLabel = TEXT("toque"); break;
	case Hoops::StickGestureKind::Hold: KindLabel = TEXT("segurar"); break;
	case Hoops::StickGestureKind::HoldRelease: KindLabel = TEXT("soltar"); break;
	case Hoops::StickGestureKind::Rotation: KindLabel = TEXT("giro"); break;
	case Hoops::StickGestureKind::QuarterCircle: KindLabel = TEXT("1/4 de giro"); break;
	case Hoops::StickGestureKind::DoubleThrow: KindLabel = TEXT("double throw"); break;
	case Hoops::StickGestureKind::Switchback: KindLabel = TEXT("switchback"); break;
	}
	LogInput(FString::Printf(TEXT("RS %s %s"), KindLabel, *Ansi(Hoops::StickDirLabel(Gesture.Dir))));

	// Arremesso pelo Pro Stick: segurar para baixo inicia, soltar arremessa.
	if (ShotPhase == EShotPhase::Jumper && bShotFromProStick && Gesture.Kind == Hoops::StickGestureKind::HoldRelease)
	{
		const double HoldMs = (Now() - GatherTime) * 1000.0;
		if (!bJumpCommitted && HoldMs < ShotModel.GetTuning().PumpFakeMaxHoldMs)
		{
			CancelShotAsPumpFake();
		}
		else
		{
			ReleaseShot();
		}
		return;
	}
	if (ShotPhase != EShotPhase::None || !bHasBall)
	{
		return;
	}

	if (Gesture.Kind == Hoops::StickGestureKind::Hold)
	{
		if (Gesture.Dir == Hoops::StickDir::Down)
		{
			BeginShot(true);
		}
		else if (Gesture.Dir == Hoops::StickDir::Up || Gesture.Dir == Hoops::StickDir::Left || Gesture.Dir == Hoops::StickDir::Right)
		{
			// Bandeja/enterrada pelo RS em infiltração (RT + RS cima = enterrada).
			const double DistM = FVector::Dist2D(GetActorLocation(), Hoop->GetRimFloorPointWorld()) / 100.0;
			if (DistM <= 3.0)
			{
				BeginFinish(bSprintHeld && Gesture.Dir == Hoops::StickDir::Up);
			}
		}
		return;
	}

	Hoops::DribbleContext Context;
	Context.Hand = Dribble.GetHand();
	Context.bSprint = bSprintHeld;
	Context.bMoving = GetVelocity().Size2D() > 80.0;
	// Misdirection (docs/17 §4.4): antes do 1º quique o núcleo lê o gesto a partir da mão do início do movimento e,
	// se ele leva a bola para o outro lado (ou é um combo), troca o movimento na hora.
	const Hoops::DribbleIntent Intent = Dribble.ResolveGesture(Gesture, Context, Now());
	StartDribbleMove(Intent.Move, Intent.bRedirect);
}

void AHoopsPlayerCharacter::StartDribbleMove(Hoops::DribbleMove Move, bool bRedirect, bool bAlreadyStarted)
{
	if (Move == Hoops::DribbleMove::None)
	{
		return;
	}

	if (!bAlreadyStarted && !Dribble.Request(Move, Now(), bRedirect))
	{
		LogInput(FString::Printf(TEXT("  (buffer) %s"), *Ansi(Hoops::DribbleMoveLabel(Move))));
		return;
	}
	LastDribbleEffectsStart = Dribble.GetActive().StartTime;

	const Hoops::DribbleMoveSpec& Spec = Hoops::GetDribbleMoveSpec(Move);
	const Hoops::ActiveDribbleMove& Active = Dribble.GetActive();
	// Mão de onde o movimento sai (numa misdirection, a do movimento trocado: a bola não chegou a trocar).
	const Hoops::BallHand HandBefore = Active.HandAtStart;
	const double Duration = Spec.Duration / Active.PlayRate;
	LogInput(FString::Printf(TEXT("  -> %s%s%s"), *Ansi(Hoops::DribbleMoveLabel(Move)), Active.bInRhythm ? TEXT(" (ritmo!)") : TEXT(""),
		Active.bRedirected ? TEXT(" (misdirection)") : TEXT("")));
	UHoopsAudioSubsystem::PlaySqueak(this, static_cast<float>(0.25 + 0.15 * (FMath::Abs(Spec.LateralSpeed) + FMath::Abs(Spec.ForwardSpeed)))); // tênis no corte

	const double SpeedBeforeMove = GetVelocity().Size2D(); // antes do impulso abaixo (crossover já correndo)

	// Impulso do movimento no referencial do ataque.
	const FVector AttackFwd = (Hoop->GetRimFloorPointWorld() - GetActorLocation()).GetSafeNormal2D();
	const FVector AttackRight = FVector::CrossProduct(FVector::UpVector, AttackFwd);
	const Hoops::BallHand HandAfter = Dribble.GetHand();
	const double NewHandSide = HandAfter == Hoops::BallHand::Right ? 1.0 : -1.0;
	const double Lateral = Spec.LateralSpeed * 100.0 * NewHandSide;
	FVector Impulse = AttackRight * Lateral + AttackFwd * (Spec.ForwardSpeed * 100.0);

	// Spin/half-spin seguem a direção do LS (girando para onde o jogador quer ir).
	if (Move == Hoops::DribbleMove::Spin || Move == Hoops::DribbleMove::HalfSpin)
	{
		const FVector CamFwd = CameraForwardFlat();
		const FVector CamRight = FVector::CrossProduct(FVector::UpVector, CamFwd);
		const FVector Wish = (CamFwd * MoveInput.Y + CamRight * MoveInput.X).GetSafeNormal2D();
		Impulse = (Wish.IsNearlyZero() ? AttackFwd : Wish) * (Spec.ForwardSpeed * 100.0);
		SpinVisualStart = Now();
		SpinVisualDuration = Duration;
		// Mesmo sentido do clipe do spin (bola na direita = horário visto de cima), com ou sem o boneco.
		SpinVisualDegrees = (Move == Hoops::DribbleMove::Spin ? 360.0f : 180.0f) * (HandBefore == Hoops::BallHand::Right ? 1.0f : -1.0f);
		bSpinVisualCurve = false; // giro linear; com o clipe do boneco, a curva medida (abaixo)
		bSpinVisualReturns = false;
	}

	if (!Impulse.IsNearlyZero())
	{
		UCharacterMovementComponent* Movement = GetCharacterMovement();
		const FVector Current2D(Movement->Velocity.X, Movement->Velocity.Y, 0.0);
		const FVector New2D = (Move == Hoops::DribbleMove::Hesitation) ? Current2D * 0.35 : Current2D * 0.25 + Impulse;
		Movement->Velocity = FVector(New2D.X, New2D.Y, Movement->Velocity.Z);
	}

	// Bola: drible baixo e rápido. 1 troca: o controlador já trocou a mão, o quique vai para a nova.
	// 2 trocas (double cross): vai para a outra mão agora e o próximo quique normal volta.
	const bool bDoubleSwitch = Spec.HandSwitches == 2;
	if (bRigActive)
	{
		// Com o boneco, a troca acontece no Tick da bola (LateUpdateHeldBall), a partir da mão animada.
		// Misdirection: a bola já pode estar indo para a outra mão; pede a troca de novo para ela seguir a mão certa.
		bSwitchRequested = Spec.HandSwitches > 0 || Active.bRedirected;
		bDoubleCrossPending = bDoubleSwitch;
		SwitchFlightSeconds = FMath::Clamp(Duration * (bDoubleSwitch ? 0.4 : 0.6), 0.18, 0.6);
		SwitchNotBefore = Now();
		// Com clipe: a bola só sai no quadro em que a mão do mocap solta, e o voo encurta para chegar no mesmo Catch.
		const auto DelaySwitch = [this](float ReleaseSeconds, float StartSeconds, float Rate)
		{
			const double Delay = FMath::Max(0.0, static_cast<double>(ReleaseSeconds - StartSeconds) / FMath::Max(0.1f, Rate));
			SwitchNotBefore = Now() + Delay;
			SwitchFlightSeconds = FMath::Max(0.12, SwitchFlightSeconds - Delay);
		};

		// Clipes do mocap (Tools/Animacao/README.md). Troca de mão: a bola sai no início da ação e a mão que recebe
		// chega junto com ela (Catch no fim do voo de SwitchFlightSeconds). Sem troca: o miolo cabe na duração.
		const bool bSpin = Move == Hoops::DribbleMove::Spin || Move == Hoops::DribbleMove::HalfSpin;
		const bool bFromRight = HandBefore == Hoops::BallHand::Right;
		const bool bSingleSwitch = Spec.HandSwitches == 1 && !bSpin;
		// Crossover de ataque (RT) ou troca de mão já correndo: o crossover em corrida, que planta e sai acelerando.
		const bool bEscapeCross = bSingleSwitch &&
			(Move == Hoops::DribbleMove::AttackingCrossover || SpeedBeforeMove > RunningCrossSpeedCm);
		const bool bHesitation = Move == Hoops::DribbleMove::Hesitation || Move == Hoops::DribbleMove::EscapeHesitation ||
			Move == Hoops::DribbleMove::InAndOut;
		const float SwitchSeconds = FMath::Max(0.12f, static_cast<float>(SwitchFlightSeconds));
		UHoopsAnimInstance* Anim = GetHoopsAnim();
		UAnimSequence* SpinClip = bSpin ? GetActionClip(bFromRight ? EHoopsClip::SpinR2L : EHoopsClip::SpinL2R) : nullptr;
		UAnimSequence* EscapeClip = bEscapeCross ? GetActionClip(bFromRight ? EHoopsClip::EscapeCrossR2L : EHoopsClip::EscapeCrossL2R) : nullptr;
		UAnimSequence* HesitationClip = bHesitation ? GetActionClip(bFromRight ? EHoopsClip::HesitationR : EHoopsClip::HesitationL) : nullptr;
		// Entre as pernas parado / no size-up (correndo, a troca de mão vira o crossover de escape).
		const bool bBetweenLegs = Move == Hoops::DribbleMove::BetweenLegs && bSingleSwitch && !bEscapeCross;
		UAnimSequence* BetweenLegsClip = bBetweenLegs ? GetActionClip(bFromRight ? EHoopsClip::BetweenLegsR2L : EHoopsClip::BetweenLegsL2R) : nullptr;
		UAnimSequence* Cross = GetActionClip(bFromRight ? EHoopsClip::CrossR2L : EHoopsClip::CrossL2R);
		if (!Anim)
		{
			return;
		}
		if (Active.bRedirected && Spec.HandSwitches == 0 && !HesitationClip)
		{
			Anim->StopAction(0.1f); // misdirection: o crossover trocado não continua tocando
		}
		if (SpinClip)
		{
			// Spin/half-spin: a outra mão recebe no fim do voo. O clipe não gira: a malha gira no Tick pela curva medida,
			// no sentido do mocap (bola na direita = horário visto de cima), só durante o miolo do clipe.
			const float Rate = (HoopsDummyRig::SpinCatchSeconds - HoopsDummyRig::SpinStartSeconds) / SwitchSeconds;
			Anim->PlayAction(SpinClip, HoopsDummyRig::SpinStartSeconds, Rate, 0.06f, HoopsDummyRig::SpinEndSeconds);
			DelaySwitch(HoopsDummyRig::SpinReleaseSeconds, HoopsDummyRig::SpinStartSeconds, Rate);
			SpinVisualDuration = (HoopsDummyRig::SpinEndSeconds - HoopsDummyRig::SpinStartSeconds) / Rate;
			SpinVisualDegrees = (Move == Hoops::DribbleMove::Spin ? 360.0f : 180.0f) * (bFromRight ? 1.0f : -1.0f);
			bSpinVisualCurve = true;
			bSpinVisualReturns = Move == Hoops::DribbleMove::HalfSpin; // vira de costas e volta (sem estalo de 180°)
		}
		else if (EscapeClip)
		{
			// O corte foi tirado do clipe: quem vira para o novo lado é o capsule (orientado ao movimento).
			const float Rate = (HoopsDummyRig::EscapeCrossCatchSeconds - HoopsDummyRig::EscapeCrossStartSeconds) / SwitchSeconds;
			Anim->PlayAction(EscapeClip, HoopsDummyRig::EscapeCrossStartSeconds, Rate, 0.08f, HoopsDummyRig::EscapeCrossEndSeconds);
			DelaySwitch(HoopsDummyRig::EscapeCrossReleaseSeconds, HoopsDummyRig::EscapeCrossStartSeconds, Rate);
		}
		else if (BetweenLegsClip)
		{
			// Entre as pernas (06_13): base escalonada e baixa, a mão empurra a bola entre os pés e a outra recebe pela frente.
			const float Rate = (HoopsDummyRig::BetweenLegsCatchSeconds - HoopsDummyRig::BetweenLegsStartSeconds) / SwitchSeconds;
			Anim->PlayAction(BetweenLegsClip, HoopsDummyRig::BetweenLegsStartSeconds, Rate, 0.08f, HoopsDummyRig::BetweenLegsEndSeconds);
			DelaySwitch(HoopsDummyRig::BetweenLegsReleaseSeconds, HoopsDummyRig::BetweenLegsStartSeconds, Rate);
		}
		else if (bSingleSwitch && Cross)
		{
			// Troca de mão parado / no size-up (crossover, por trás, hesi-cross; entre as pernas sem o clipe dele). Double
			// cross sem clipe.
			const float Rate = (HoopsDummyRig::CrossCatchSeconds - HoopsDummyRig::CrossStartSeconds) / SwitchSeconds;
			Anim->PlayAction(Cross, HoopsDummyRig::CrossStartSeconds, Rate, 0.08f, HoopsDummyRig::CrossEndSeconds);
			DelaySwitch(HoopsDummyRig::CrossReleaseSeconds, HoopsDummyRig::CrossStartSeconds, Rate);
		}
		else if (HesitationClip)
		{
			// Hesitação / in-and-out: finta baixa com a bola na cintura e arranque com o drible da mesma mão.
			const float Rate = (HoopsDummyRig::HesitationEndSeconds - HoopsDummyRig::HesitationStartSeconds) /
				FMath::Max(0.12f, static_cast<float>(Duration));
			Anim->PlayAction(HesitationClip, HoopsDummyRig::HesitationStartSeconds, Rate, 0.08f, HoopsDummyRig::HesitationEndSeconds);
		}
		return;
	}
	PlanDribbleArc(bDoubleSwitch, Duration * (bDoubleSwitch ? 0.4 : 0.6));
}

void AHoopsPlayerCharacter::PlanDribbleArc(bool bToOtherHand, double PeriodOverride)
{
	const double Speed = GetVelocity().Size2D();
	const double DefaultPeriod = FMath::Lerp(0.52, 0.38, FMath::Clamp(Speed / 650.0, 0.0, 1.0));
	const double Period = PeriodOverride > 0.0 ? PeriodOverride : DefaultPeriod;

	const Hoops::BallHand TargetHand = bToOtherHand ? Hoops::OtherHand(Dribble.GetHand()) : Dribble.GetHand();
	const FVector Start = Ball->GetActorLocation();
	const FVector End = HandWorldLocation(TargetHand, Period);
	const double FloorZ = (GetActorLocation().Z - CapsuleHalfHeightCm) / 100.0;

	CurrentArc = Hoops::MakeDribbleArc(HoopsUnits::ToSim(Start), HoopsUnits::ToSim(End), HoopsUnits::ToSim(GetVelocity()),
		Period, AHoopsBall::RadiusCm / 100.0, FloorZ);
	ArcStartTime = Now();
	bArcValid = true;
}

void AHoopsPlayerCharacter::UpdateDribbleBall(float DeltaSeconds)
{
	const double Elapsed = Now() - ArcStartTime;
	if (!bArcValid || Elapsed >= CurrentArc.TotalSeconds())
	{
		// Parado e protegendo (LT) ou sem se mexer: drible mais baixo e lento.
		PlanDribbleArc(false, bLeftTriggerHeld ? 0.36 : 0.0);
	}
	const Hoops::Vec3 Pos = CurrentArc.Evaluate(Now() - ArcStartTime);
	UHoopsAudioSubsystem::NotifyDribbleArc(this, CurrentArc, Now() - ArcStartTime, DeltaSeconds); // quique no chão
	Ball->SetControlledLocation(HoopsUnits::ToUnreal(Pos));
}

// ============================================================================ Arremesso (jumper)

Hoops::ShotContext AHoopsPlayerCharacter::BuildJumperContext() const
{
	Hoops::ShotContext Context;
	const FVector Feet = GetActorLocation() - FVector(0.0, 0.0, CapsuleHalfHeightCm);
	const Hoops::Vec3 FeetM = HoopsUnits::ToSim(Feet);
	const Hoops::Vec3 RimFloor = HoopsUnits::ToSim(Hoop->GetRimFloorPointWorld());
	const Hoops::Vec3 Fwd = HoopsUnits::DirToSim(Hoop->GetForwardWorld());

	Context.DistanceMeters = Hoops::Distance2D(FeetM, RimFloor);
	Context.bIsThree = Court.IsThreePointer(FeetM, RimFloor, Fwd);
	Context.ThreePointDistance = Court.ThreePointRadius;

	const double Speed = GetVelocity().Size2D();
	const double SinceMove = Now() - Dribble.GetLastMoveEndTime();
	const bool bMoveActive = Dribble.IsMoveActive(Now());
	const Hoops::DribbleMove RecentMove = bMoveActive ? Dribble.GetActive().Move : (SinceMove < 0.45 ? Dribble.GetLastMove() : Hoops::DribbleMove::None);

	// Fadeaway: LS puxado para longe da cesta perto do garrafão.
	const FVector CamFwd = CameraForwardFlat();
	const FVector CamRight = FVector::CrossProduct(FVector::UpVector, CamFwd);
	const FVector Wish = (CamFwd * MoveInput.Y + CamRight * MoveInput.X).GetSafeNormal2D();
	const FVector ToRim = (Hoop->GetRimFloorPointWorld() - GetActorLocation()).GetSafeNormal2D();
	const bool bFadingAway = !Wish.IsNearlyZero() && FVector::DotProduct(Wish, ToRim) < -0.5;

	if (Context.DistanceMeters > 12.0)
	{
		Context.Type = Hoops::ShotType::Heave;
	}
	else if (RecentMove == Hoops::DribbleMove::StepBack || RecentMove == Hoops::DribbleMove::EscapeStepBack)
	{
		Context.Type = Hoops::ShotType::StepBack;
	}
	else if (bFadingAway && Context.DistanceMeters < 6.0)
	{
		Context.Type = Hoops::ShotType::Fadeaway;
	}
	else if (RecentMove != Hoops::DribbleMove::None || Speed > 250.0)
	{
		Context.Type = Hoops::ShotType::PullUp; // dribble pull-up / momentum pull-up
	}
	else
	{
		Context.Type = Hoops::ShotType::SpotUp;
	}

	if (Context.bIsThree)
	{
		Context.Rating = ThreePointRating;
	}
	else
	{
		Context.Rating = Context.DistanceMeters < 3.0 ? CloseShotRating : MidRangeRating;
	}

	Context.Speed = static_cast<Hoops::ReleaseSpeed>(FMath::Clamp(JumperReleaseSpeed, 0, 2));
	Context.Fatigue = Hoops::ShotModel::FatigueFromEnergy(Dribble.GetEnergy());
	Context.Balance = bMoveActive ? 0.85 : (Speed > 500.0 ? 0.9 : 1.0);
	Context.bMeterOff = !bShotMeterEnabled;
	return Context;
}

Hoops::ContestBreakdown AHoopsPlayerCharacter::SampleContest() const
{
	Hoops::ContestBreakdown Result;
	if (!Dummy || Dummy->GetMode() == EHoopsDummyMode::Off || !Hoop)
	{
		return Result; // Freestyle sem defensor: livre
	}
	const FVector Feet = GetActorLocation() - FVector(0.0, 0.0, CapsuleHalfHeightCm);
	// Antes da bola chegar ao set point, usa o set point como ponto de soltura previsto.
	const FVector Release = ShotPhase == EShotPhase::Jumper ? SetPointWorldLocation() : Ball->GetActorLocation();
	return Hoops::ComputeContest(Dummy->GetPose(), HoopsUnits::ToSim(Feet), HoopsUnits::ToSim(Release), HoopsUnits::ToSim(Hoop->GetRimCenterWorld()));
}

double AHoopsPlayerCharacter::ContestAtRelease()
{
	// Janela em torno da soltura (docs/03 §3.3): maior contestação nos últimos ~100 ms.
	const double ReleaseTime = Now();
	LastContest = SampleContest();
	for (const TPair<double, double>& Sample : ContestSamples)
	{
		if (ReleaseTime - Sample.Key <= 0.10 && Sample.Value > LastContest.Contest)
		{
			LastContest.Contest = Sample.Value;
		}
	}
	ContestSamples.Reset();
	return LastContest.Contest;
}

void AHoopsPlayerCharacter::DrawContestDebug() const
{
	if (!Hud.bLabOverlay || !Dummy || Dummy->GetMode() == EHoopsDummyMode::Off)
	{
		return;
	}
	const FVector HandPos = HoopsUnits::ToUnreal(LastContest.HandPosition);
	const FVector PathPoint = HoopsUnits::ToUnreal(LastContest.ClosestPathPoint);
	const FColor LineColor = LastContest.Contest < 0.15 ? FColor::Green : (LastContest.Contest < 0.4 ? FColor::Yellow : FColor::Red);
	DrawDebugLine(GetWorld(), HandPos, PathPoint, LineColor, false, 2.5f, 0, 2.0f);
	DrawDebugSphere(GetWorld(), HandPos, 8.0f, 8, LineColor, false, 2.5f);
}

void AHoopsPlayerCharacter::BeginShot(bool bFromProStick)
{
	EnsureWorldRefs();
	if (!Hoop || !Ball || !bHasBall || ShotPhase != EShotPhase::None || GetCharacterMovement()->IsFalling())
	{
		return;
	}

	const double DistM = FVector::Dist2D(GetActorLocation(), Hoop->GetRimFloorPointWorld()) / 100.0;
	const FVector ToRim = (Hoop->GetRimFloorPointWorld() - GetActorLocation()).GetSafeNormal2D();
	const double SpeedToRim = FVector::DotProduct(GetVelocity(), ToRim);
	if (DistM <= 2.6 && (SpeedToRim > 150.0 || bSprintHeld))
	{
		BeginFinish(bSprintHeld && DistM <= 2.4);
		return;
	}

	Hoops::ShotTuning Tuning;
	Tuning.PerfectWindowScale = GreenWindowScale;
	ShotModel = Hoops::ShotModel(Tuning);
	ShotContext = BuildJumperContext();
	ShotWindows = ShotModel.ComputeWindows(ShotContext); // travada no gather
	ContestSamples.Reset();
	if (Dummy)
	{
		Dummy->NotifyShotStarted(Now());
	}
	GatherTime = Now();
	bJumpCommitted = false;
	bFeedbackPending = false;
	ShotDrift = FVector::ZeroVector;
	bShotFromProStick = bFromProStick;
	bShotLeftHand = false;
	ShotPhase = EShotPhase::Jumper;
	UHoopsAudioSubsystem::PlaySqueak(this, 0.35f + static_cast<float>(GetVelocity().Size2D()) / 800.0f); // tênis no plant do gather
	if (bRigActive)
	{
		// A mão chega ao topo (soltura do clipe) exatamente no tempo ideal = centro da janela green, com qualquer clipe.
		const HoopsDummyRig::FJumpShotTiming Timing = JumperTiming();
		PlayShotAction(Timing, Timing.Dip, static_cast<float>(ShotWindows.IdealReleaseMs / 1000.0));
		if (UHoopsAnimInstance* Anim = GetHoopsAnim())
		{
			// Soltura atrasada: a mão espera no topo até o X ser solto (não sai do follow-through/aterrissagem).
			Anim->HoldActionAt(Timing.Release);
		}
	}

	// Pull-up sem frear (docs/17 §3.4, P0-9): o gather leva o embalo do drible (o último quique vira o gather) e o
	// UpdateShot desacelera no plant até a deriva do salto. Spot-up planta na hora.
	UCharacterMovementComponent* Movement = GetCharacterMovement();
	const FVector Entry2D(Movement->Velocity.X, Movement->Velocity.Y, 0.0);
	PullUpCarryDir = Entry2D.GetSafeNormal2D();
	PullUpCarry = Hoops::ComputeGatherCarry(Hoops::GatherCarryTuning(), ShotContext.Type, Entry2D.Size2D() / 100.0);
	const double KeepCm = PullUpCarry.SpeedAt(0.0) * 100.0;
	Movement->Velocity = FVector(PullUpCarryDir.X * KeepCm, PullUpCarryDir.Y * KeepCm, Movement->Velocity.Z);

	LogInput(FString::Printf(TEXT("Gather: %s %.1f m (%s) janela green +-%.0f ms"),
		*Ansi(Hoops::ShotTypeLabel(ShotContext.Type)), ShotContext.DistanceMeters,
		ShotContext.bIsThree ? TEXT("3PT") : TEXT("2PT"), ShotWindows.PerfectHalfMs));
}

void AHoopsPlayerCharacter::CancelShotAsPumpFake()
{
	ShotPhase = EShotPhase::None;
	bArcValid = false;
	if (bRigActive)
	{
		if (UHoopsAnimInstance* Anim = GetHoopsAnim())
		{
			Anim->ReleaseActionHold();
			Anim->StopAction(0.15f);
		}
		ResetBallCarry(Dribble.GetHand(), 0.18);
	}
	LogInput(TEXT("Pump fake"));
}

void AHoopsPlayerCharacter::UpdateShot(float DeltaSeconds)
{
	const double HoldMs = (Now() - GatherTime) * 1000.0;
	const Hoops::ShotTuning& Tuning = ShotModel.GetTuning();

	ContestSamples.Add(TPair<double, double>(Now(), SampleContest().Contest));

	// Bola sobe até o set point (com o boneco, ela fica nas mãos animadas: LateUpdateHeldBall).
	if (!bRigActive)
	{
		const FVector Target = SetPointWorldLocation();
		Ball->SetControlledLocation(FMath::VInterpTo(Ball->GetActorLocation(), Target, DeltaSeconds, 22.0f));
	}

	// Passou do tempo de pump fake: sai do chão, com ápice perto do ponto ideal de soltura.
	if (!bJumpCommitted && HoldMs >= Tuning.PumpFakeMaxHoldMs)
	{
		bJumpCommitted = true;
		const double AirSeconds = FMath::Max(0.25, (ShotWindows.IdealReleaseMs - Tuning.PumpFakeMaxHoldMs) / 1000.0);
		const double JumpZ = FMath::Abs(GetCharacterMovement()->GetGravityZ()) * AirSeconds;
		// Deriva no ar: o que sobra do embalo do drible (pull-up: pouso 10–30 cm à frente) + step-back/fadeaway
		// para trás.
		FVector BackDrift = FVector::ZeroVector;
		if (ShotContext.Type == Hoops::ShotType::Fadeaway || ShotContext.Type == Hoops::ShotType::StepBack)
		{
			BackDrift = -(Hoop->GetRimFloorPointWorld() - GetActorLocation()).GetSafeNormal2D() * 160.0;
		}
		if (bRigActive)
		{
			// O pulo está na animação; o capsule só leva o embalo horizontal (aplicado abaixo a cada frame).
			ShotDrift = FVector(BackDrift.X, BackDrift.Y, 0.0);
		}
		else
		{
			const FVector Horizontal = PullUpCarryDir * (PullUpCarry.DriftSpeed * 100.0) + BackDrift;
			LaunchCharacter(FVector(Horizontal.X, Horizontal.Y, JumpZ), true, true);
		}
	}

	// Embalo horizontal no chão (docs/17 §3.4, P0-9): no plant cai da velocidade do drible até a deriva do salto; depois
	// do commit soma a deriva do step-back/fadeaway. Velocidade direta + input igual, senão o atrito do chão freia
	// o corpo no mesmo frame.
	UCharacterMovementComponent* Movement = GetCharacterMovement();
	if (!Movement->IsFalling() && (bRigActive || !bJumpCommitted))
	{
		const FVector PlantVelocity = PullUpCarryDir * (PullUpCarry.SpeedAt(HoldMs / 1000.0) * 100.0);
		const FVector Desired = bJumpCommitted ? PlantVelocity + ShotDrift : PlantVelocity;
		if (!Desired.IsNearlyZero())
		{
			Movement->MaxWalkSpeed = FMath::Max(Movement->MaxWalkSpeed, static_cast<float>(Desired.Size2D()));
			Movement->Velocity = FVector(Desired.X, Desired.Y, Movement->Velocity.Z);
			AddMovementInput(Desired.GetSafeNormal2D(), FMath::Min(1.0f, static_cast<float>(Desired.Size2D()) / Movement->MaxWalkSpeed));
		}
	}

	// Segurou demais: soltura automática (muito tarde).
	if (HoldMs >= ShotWindows.IdealReleaseMs + ShotWindows.SlightHalfMs + Tuning.AutoReleaseAfterIdealMs)
	{
		ReleaseShot();
	}
}

void AHoopsPlayerCharacter::ReleaseShot()
{
	if (ShotPhase != EShotPhase::Jumper)
	{
		return;
	}

	const double HoldMs = (Now() - GatherTime) * 1000.0;
	const Hoops::ShotEvaluation Eval = ShotModel.Evaluate(ShotContext, ShotWindows, HoldMs, ContestAtRelease());
	const Hoops::ShotDecision Decision = ShotModel.Decide(Eval, Random);
	DrawContestDebug();

	Hoops::ShotRealizeParams Params;
	Params.ReleasePosition = HoopsUnits::ToSim(Ball->GetActorLocation());
	const double BaseAngle = ShotContext.DistanceMeters < 4.0 ? 54.0 : 50.0;
	Params.LaunchAngleDeg = Hoops::LaunchAngleForTiming(BaseAngle, Eval.Timing);
	const Hoops::RealizedShot Realized = Hoops::RealizeShot(*Ball->GetSim(), Decision, Params, Random);

	Ball->LaunchFree(Realized.Initial);
	bHasBall = false;
	ShotPhase = EShotPhase::None;
	bAwaitingShotResult = true;
	ReturnBallAt = -1.0;

	++Hud.Attempts;
	if (Eval.Timing == Hoops::TimingGrade::Green)
	{
		++Hud.Greens;
	}
	ShowFeedback(Eval, ShotContext);
	if (UHoopsAnimInstance* Anim = bRigActive ? GetHoopsAnim() : nullptr)
	{
		Anim->ReleaseActionHold();
	}
	OnShotReleased(Eval, HoldMs);
	UHoopsAudioSubsystem::PlayLandingSqueak(this, bLastShotGreen ? 0.85f : 0.65f); // tênis na aterrissagem

	Hud.LabLines.Reset();
	Hud.LabLines.Add(FString::Printf(TEXT("Ultimo: %s | %.2f m | rating %.0f"), *Ansi(Hoops::ShotTypeLabel(ShotContext.Type)), ShotContext.DistanceMeters, ShotContext.Rating));
	Hud.LabLines.Add(FString::Printf(TEXT("Segurou %.0f ms | ideal %.0f ms | offset %+.0f ms"), HoldMs, ShotWindows.IdealReleaseMs, Eval.TimingOffsetMs));
	Hud.LabLines.Add(FString::Printf(TEXT("Janelas +-: green %.0f | bom %.0f | leve %.0f ms"), ShotWindows.PerfectHalfMs, ShotWindows.GoodHalfMs, ShotWindows.SlightHalfMs));
	Hud.LabLines.Add(FString::Printf(TEXT("L=%.2f  P=%.0f%%  garantida=%s  contest=%.2f"), Eval.Logit, Eval.Probability * 100.0, Eval.bGuaranteed ? TEXT("sim") : TEXT("nao"), Eval.Contest));
	Hud.LabLines.Add(FString::Printf(TEXT("Contest: mao a %.2f m | prox %.2f | angulo %.2f | altura %.2f | rating %.2f"),
		LastContest.HandToPathMeters, LastContest.Proximity, LastContest.Angular, LastContest.HeightFactor, LastContest.RatingFactor));
	Hud.LabLines.Add(FString::Printf(TEXT("Fisica: %s em %d tentativa(s)"), Realized.bScored ? TEXT("cesta") : TEXT("erro"), Realized.Attempts));
}

// ============================================================================ Bandeja / enterrada

void AHoopsPlayerCharacter::BeginFinish(bool bDunk)
{
	if (!Hoop || !Ball || !bHasBall || ShotPhase != EShotPhase::None)
	{
		return;
	}
	ShotPhase = EShotPhase::Finish;
	bFinishIsDunk = bDunk && DunkRating >= 60.0f;
	GatherTime = Now();
	bShotLeftHand = false;
	bFinishLaunchPending = false;

	const FVector ToRim = (Hoop->GetRimFloorPointWorld() - GetActorLocation()).GetSafeNormal2D();
	const double DistCm = FVector::Dist2D(Hoop->GetRimFloorPointWorld(), GetActorLocation());
	const double Airtime = bFinishIsDunk ? DunkReleaseSeconds : LayupReleaseSeconds;

	// Boneco com os clipes da bandeja/enterrada (124_06). Bandeja do lado do aro por onde entra (perto do meio, a mão do
	// drible); a da esquerda é o espelho.
	UHoopsAnimInstance* Anim = bRigActive ? GetHoopsAnim() : nullptr;
	UAnimSequence* FinishClip = nullptr;
	if (Anim)
	{
		const FVector AttackRight = FVector::CrossProduct(FVector::UpVector, -HoopForward()); // direita de quem olha para a cesta
		const double Side = FVector::DotProduct(GetActorLocation() - Hoop->GetRimFloorPointWorld(), AttackRight);
		bool bLeftLayup = Side < -40.0 || (Side <= 40.0 && Dribble.GetHand() == Hoops::BallHand::Left);
		FinishClip = bFinishIsDunk ? GetActionClip(EHoopsClip::Dunk) : GetActionClip(bLeftLayup ? EHoopsClip::LayupL : EHoopsClip::LayupR);
		if (!FinishClip && !bFinishIsDunk && bLeftLayup)
		{
			bLeftLayup = false;
			FinishClip = GetActionClip(EHoopsClip::LayupR);
		}
		bShotLeftHand = FinishClip && bLeftLayup && !bFinishIsDunk;
	}

	// Velocidade para o aro: chega a StopShort cm dele na soltura.
	const double StopShortCm = (FinishClip && bFinishIsDunk) ? DunkStopShortCm : LayupStopShortCm;
	FinishForwardCm = FMath::Clamp((DistCm - StopShortCm) / Airtime, 0.0, 450.0);
	if (FinishClip)
	{
		// O clipe vai do gather à soltura em Airtime. O capsule fica no chão no gather (UpdateFinish mantém o embalo) e decola
		// no quadro da decolagem do clipe, com o ápice no ápice do clipe: os pés saem e voltam ao chão junto com o mocap.
		const HoopsDummyRig::FFinishTiming& Timing = bFinishIsDunk ? HoopsDummyRig::DunkTiming : HoopsDummyRig::LayupTiming;
		const float Rate = (Timing.Release - Timing.Gather) / static_cast<float>(Airtime);
		Anim->StopUpperBody(0.12f); // sai do follow-through/celebração anterior
		Anim->PlayAction(FinishClip, Timing.Gather, Rate, 0.1f, Timing.End);
		bFinishLaunchPending = true;
		FinishLaunchTime = GatherTime + (Timing.Takeoff - Timing.Gather) / Rate;
		FinishApexDelay = (Timing.Apex - Timing.Takeoff) / Rate;
		// A bola vai da mão do drible para as mãos da bandeja/enterrada.
		BallBlendFrom = Ball->GetActorLocation();
		BallBlendStart = GatherTime;
		BallBlendSeconds = 0.15;
	}
	else
	{
		// Sem boneco (ou FBX sem os clipes): decola na hora. Com o boneco, parte da subida está no clipe do arremesso.
		const double RigJumpScale = bRigActive ? 0.55 : 1.0;
		const double JumpZ = FMath::Abs(GetCharacterMovement()->GetGravityZ()) * Airtime * (bFinishIsDunk ? 1.15 : 1.0) * RigJumpScale;
		LaunchCharacter(FVector(ToRim.X * FinishForwardCm, ToRim.Y * FinishForwardCm, JumpZ), true, true);
		if (bRigActive)
		{
			PlayShotAction(HoopsDummyRig::JumpShotClassic, HoopsDummyRig::JumpShotTakeoffSeconds, static_cast<float>(Airtime));
		}
	}

	ShotContext = Hoops::ShotContext();
	ShotContext.Type = bFinishIsDunk ? Hoops::ShotType::Dunk : Hoops::ShotType::Layup;
	ShotContext.Rating = bFinishIsDunk ? DunkRating : LayupRating;
	ShotContext.DistanceMeters = DistCm / 100.0;
	ShotContext.bIsThree = false;
	ShotWindows = ShotModel.ComputeWindows(ShotContext);
	LogInput(bFinishIsDunk ? TEXT("Enterrada") : TEXT("Bandeja"));
}

void AHoopsPlayerCharacter::UpdateFinish(float DeltaSeconds)
{
	const double Elapsed = Now() - GatherTime;
	const FVector ToRim = (Hoop->GetRimFloorPointWorld() - GetActorLocation()).GetSafeNormal2D();
	if (!bRigActive)
	{
		const FVector CarryPoint = GetActorLocation() + ToRim * 35.0 + FVector(0.0, 0.0, CapsuleHalfHeightCm + (bFinishIsDunk ? 75.0 : 60.0));
		Ball->SetControlledLocation(FMath::VInterpTo(Ball->GetActorLocation(), CarryPoint, DeltaSeconds, 20.0f));
	}

	// Clipe da bandeja/enterrada: no chão até o quadro da decolagem (gather, mantendo o embalo para o aro); aí o capsule
	// decola com a subida que leva ao ápice do clipe. Velocidade direta + input igual, senão o atrito do chão freia o corpo.
	if (bFinishLaunchPending)
	{
		UCharacterMovementComponent* Movement = GetCharacterMovement();
		const FVector ToRimVelocity = ToRim * FinishForwardCm;
		if (Now() >= FinishLaunchTime)
		{
			bFinishLaunchPending = false;
			const double JumpZ = FMath::Abs(Movement->GetGravityZ()) * FinishApexDelay;
			LaunchCharacter(FVector(ToRimVelocity.X, ToRimVelocity.Y, JumpZ), true, true);
		}
		else if (!ToRimVelocity.IsNearlyZero())
		{
			Movement->MaxWalkSpeed = FMath::Max(Movement->MaxWalkSpeed, static_cast<float>(FinishForwardCm));
			Movement->Velocity = FVector(ToRimVelocity.X, ToRimVelocity.Y, Movement->Velocity.Z);
			AddMovementInput(ToRim, 1.0f);
		}
	}

	if (Elapsed >= (bFinishIsDunk ? DunkReleaseSeconds : LayupReleaseSeconds))
	{
		ReleaseFinish();
	}
}

void AHoopsPlayerCharacter::ReleaseFinish()
{
	bLastShotGreen = false; // bandeja/enterrada não têm green (timing desligado)
	bFinishLaunchPending = false;
	// Timing de bandeja desligado por padrão (como "Shot Timing: Shots Only" do 2K23): conta como soltura "Boa".
	const double HoldMs = bFinishIsDunk ? ShotWindows.IdealReleaseMs : ShotWindows.IdealReleaseMs + ShotWindows.PerfectHalfMs + 1.0;
	ContestSamples.Reset();
	const Hoops::ShotEvaluation Eval = ShotModel.Evaluate(ShotContext, ShotWindows, HoldMs, ContestAtRelease());
	const Hoops::ShotDecision Decision = ShotModel.Decide(Eval, Random);

	Hoops::BallState Initial;
	if (bFinishIsDunk && Decision.bMake)
	{
		// Enterrada: a bola entra de cima, pelo centro do aro.
		const Hoops::Vec3 Rim = Ball->GetSim()->GetHoop().RimCenter();
		Initial.Position = Rim + Hoops::Vec3(0.0, 0.0, 0.22);
		Initial.Velocity = Hoops::Vec3(0.0, 0.0, -4.0);
	}
	else
	{
		Hoops::ShotRealizeParams Params;
		Params.ReleasePosition = HoopsUnits::ToSim(Ball->GetActorLocation());
		Params.LaunchAngleDeg = 62.0;
		Params.BackspinRevPerSec = 1.5;
		Initial = Hoops::RealizeShot(*Ball->GetSim(), Decision, Params, Random).Initial;
	}

	Ball->LaunchFree(Initial);
	bHasBall = false;
	ShotPhase = EShotPhase::None;
	bAwaitingShotResult = true;
	ReturnBallAt = -1.0;
	++Hud.Attempts;
	ShowFeedback(Eval, ShotContext);
	UHoopsAudioSubsystem::PlayLandingSqueak(this, 0.8f); // tênis na aterrissagem
}

// ============================================================================ Bola livre, rebotedor, recepção

void AHoopsPlayerCharacter::UpdateBallPossession(float DeltaSeconds)
{
	if (bHasBall || !Ball->IsFree())
	{
		return;
	}

	if (bAwaitingShotResult)
	{
		if (Ball->ConsumeScoreEvent())
		{
			LastMakeTime = Now();
			UpdatePendingFeedback(); // modo "no aro": a cesta também dispara o feedback
			if (bLastShotGreen && bAutoCelebrate)
			{
				Celebrate();
			}
			bAwaitingShotResult = false;
			++Hud.Makes;
			++Hud.Streak;
			Hud.BestStreak = FMath::Max(Hud.BestStreak, Hud.Streak);
			ReturnBallAt = Now() + (bLastShotGreen ? 1.8 : 0.9); // green: tempo para segurar a pose e celebrar
		}
		else if (Ball->HasTouchedFloorSinceLaunch() || Ball->GetSecondsSinceLaunch() > 4.0)
		{
			bAwaitingShotResult = false;
			Hud.Streak = 0;
			ReturnBallAt = Now() + 0.7;
		}
	}
	else if (ReturnBallAt < 0.0 && Ball->HasTouchedFloorSinceLaunch())
	{
		ReturnBallAt = Now() + 0.7;
	}

	if (ReturnBallAt > 0.0 && Now() >= ReturnBallAt)
	{
		ReturnBallAt = -1.0;
		PassBallToPlayer();
	}

	// Recepção.
	const FVector Chest = GetActorLocation() + FVector(0.0, 0.0, 30.0);
	if (Ball->GetSecondsSinceLaunch() > 0.25 && FVector::Dist(Ball->GetActorLocation(), Chest) < CatchRadiusCm)
	{
		CatchBall();
	}
}

void AHoopsPlayerCharacter::PassBallToPlayer()
{
	Hoops::Vec3 From = Ball->GetSimState().Position;
	if (From.Z < 0.4)
	{
		From.Z = 0.4; // o "rebotedor" pega a bola do chão
	}
	const FVector Target = GetActorLocation() + FVector(0.0, 0.0, 30.0) + GetVelocity() * 0.5;
	const Hoops::Vec3 To = HoopsUnits::ToSim(Target);

	const double Angles[] = {18.0, 30.0, 45.0, 60.0};
	for (double AngleDeg : Angles)
	{
		const Hoops::LaunchSolution Launch = Hoops::SolveLaunch(From, To, Hoops::DegToRad(AngleDeg), Ball->GetSim()->GetConfig().Gravity);
		if (Launch.bValid)
		{
			Hoops::BallState State;
			State.Position = From;
			State.Velocity = Launch.Velocity;
			Ball->LaunchFree(State);
			LogInput(TEXT("Rebotedor: passe"));
			return;
		}
	}
}

void AHoopsPlayerCharacter::CatchBall()
{
	bHasBall = true;
	bAwaitingShotResult = false;
	ReturnBallAt = -1.0;
	Dribble.ResetPossession();
	bArcValid = false;
	if (bRigActive)
	{
		if (UHoopsAnimInstance* Anim = GetHoopsAnim())
		{
			Anim->StopUpperBody(0.15f); // mãos de volta para a bola
			if (bTurnBackActive)
			{
				Anim->StopAction(0.15f); // recebeu no meio do vira e volta: as pernas voltam para o drible
				bTurnBackActive = false;
			}
		}
		Ball->SetControlledLocation(Ball->GetActorLocation()); // a bola vai da posição atual para a mão
		ResetBallCarry(Dribble.GetHand(), 0.15);
	}
	else
	{
		Ball->SetControlledLocation(HandWorldLocation(Dribble.GetHand(), 0.0));
	}
	LogInput(TEXT("Recebeu a bola"));
}

// ============================================================================ HUD

void AHoopsPlayerCharacter::ShowFeedback(const Hoops::ShotEvaluation& Eval, const Hoops::ShotContext& Context)
{
	if (!bShotFeedbackEnabled)
	{
		return;
	}
	// No modo "no aro", o banner só aparece quando a bola chega na cesta (FireShotFeedback).
	Hud.bShowFeedback = !bGreenFeedbackAtRim;
	Hud.FeedbackTime = Now();
	Hud.FeedbackTiming = FString::Printf(TEXT("TIMING: %s"), *Ansi(Hoops::TimingGradeLabel(Eval.Timing)));
	Hud.FeedbackCoverage = FString::Printf(TEXT("COBERTURA: %s"), *Ansi(Hoops::CoverageGradeLabel(Eval.Coverage)));
	Hud.FeedbackDetail = FString::Printf(TEXT("%s | %+.0f ms | cobertura %.0f%% | chance %.0f%%"),
		*Ansi(Hoops::ShotTypeLabel(Context.Type)), Eval.TimingOffsetMs, Eval.Contest * 100.0, Eval.Probability * 100.0);

	switch (Eval.Timing)
	{
	case Hoops::TimingGrade::Green: Hud.FeedbackColor = FLinearColor(0.20f, 1.0f, 0.35f); break;
	case Hoops::TimingGrade::Good: Hud.FeedbackColor = FLinearColor::White; break;
	case Hoops::TimingGrade::SlightlyEarly:
	case Hoops::TimingGrade::SlightlyLate: Hud.FeedbackColor = FLinearColor(1.0f, 0.85f, 0.2f); break;
	default: Hud.FeedbackColor = FLinearColor(1.0f, 0.3f, 0.25f); break;
	}
}

void AHoopsPlayerCharacter::UpdateHud()
{
	Hud.Energy = static_cast<float>(Dribble.GetEnergy());
	Hud.ComboCount = Dribble.GetComboCount();
	Hud.bBallInRightHand = Dribble.GetHand() == Hoops::BallHand::Right;
	Hud.CurrentMove = Dribble.IsMoveActive(Now()) ? Ansi(Hoops::DribbleMoveLabel(Dribble.GetActive().Move)) : FString();
	Hud.PlayerWorldLocation = GetActorLocation();
	Hud.HalfHeight = CapsuleHalfHeightCm;

	Hud.Now = Now();
	Hud.bShowMeter = bShotMeterEnabled && ShotPhase == EShotPhase::Jumper;
	if (Hud.bShowMeter)
	{
		const double Ideal = ShotWindows.IdealReleaseMs;
		const double HoldMs = (Now() - GatherTime) * 1000.0;
		Hud.MeterFill = FoldMeter(HoldMs / Ideal);
		Hud.GreenStart = static_cast<float>((Ideal - ShotWindows.PerfectHalfMs) / Ideal);
		Hud.GreenEnd = static_cast<float>((Ideal + ShotWindows.PerfectHalfMs) / Ideal);
		Hud.GoodStart = static_cast<float>((Ideal - ShotWindows.GoodHalfMs) / Ideal);
		Hud.GoodEnd = static_cast<float>((Ideal + ShotWindows.GoodHalfMs) / Ideal);
	}
	Hud.MeterWorldAnchor = GetActorLocation() + GetActorRightVector() * 70.0; // segue o jogador (também no resultado)

	if (Hud.bShowFeedback && Now() - Hud.FeedbackTime > 2.8)
	{
		Hud.bShowFeedback = false;
	}
}

// ============================================================================ Boneco animado

namespace
{
	const FName BonePalmR(TEXT("palm_r"));
	const FName BonePalmL(TEXT("palm_l"));
	const FName BoneFingersR(TEXT("fingers_r"));
	const FName BoneFingersL(TEXT("fingers_l"));

	bool IsRunClip(EHoopsClip Clip)
	{
		return Clip == EHoopsClip::Run || Clip == EHoopsClip::DribbleRunR || Clip == EHoopsClip::DribbleRunL;
	}

	bool IsLowDribbleClip(EHoopsClip Clip)
	{
		return Clip == EHoopsClip::DribbleLowR || Clip == EHoopsClip::DribbleLowL;
	}

	bool IsIdleClip(EHoopsClip Clip)
	{
		return Clip == EHoopsClip::HoldIdle || Clip == EHoopsClip::DribbleIdleR || Clip == EHoopsClip::DribbleIdleL || IsLowDribbleClip(Clip);
	}

	// Mesmo clipe com a outra mão (Dribble_X_R <-> Dribble_X_L): troca mantendo a fase do ciclo.
	bool IsHandPair(EHoopsClip A, EHoopsClip B)
	{
		if (IsLowDribbleClip(A) && IsLowDribbleClip(B))
		{
			return A != B;
		}
		const int32 First = static_cast<int32>(EHoopsClip::DribbleIdleR);
		const int32 Last = static_cast<int32>(EHoopsClip::DribbleSideL);
		const int32 IndexA = static_cast<int32>(A);
		const int32 IndexB = static_cast<int32>(B);
		return IndexA != IndexB && IndexA >= First && IndexA <= Last && IndexB >= First && IndexB <= Last &&
			(IndexA - First) / 2 == (IndexB - First) / 2;
	}
}

bool AHoopsPlayerCharacter::TryLoadDummyRig()
{
	USkeletalMesh* MeshAsset = nullptr;
	TArray<UAnimSequence*> FoundClips;
	if (!HoopsDummyRig::FindAssets(DummyAssetFolder, MeshAsset, FoundClips))
	{
		Hud.BodyStatus = MeshAsset
			? TEXT("Boneco animado: faltam animacoes (feche e abra o editor ou rode Tools/Editor/importar_personagem.py)")
			: TEXT("Boneco animado: NAO IMPORTADO - feche e abra o editor (importa sozinho) ou rode Tools/Editor/importar_personagem.py");
		UE_LOG(LogHoops, Warning, TEXT("%s"), *Hud.BodyStatus);
		return false;
	}
	HoopsDummyRig::FMeshMeasure Measure;
	if (!HoopsDummyRig::MeasureMesh(MeshAsset, Measure))
	{
		Hud.BodyStatus = TEXT("Boneco animado: esqueleto sem os ossos esperados (foot_l, ball_l, hand_r...). Reimporte o FBX.");
		UE_LOG(LogHoops, Warning, TEXT("%s"), *Hud.BodyStatus);
		return false;
	}
	if (!Measure.bRightHandOnRight)
	{
		UE_LOG(LogHoops, Warning, TEXT("Boneco: a mao direita ficou do lado esquerdo (importacao espelhada?). Ajuste MeshYawAdjust ou reimporte."));
	}

	DummyMesh = MeshAsset;
	DummyClips.Reset();
	for (UAnimSequence* Clip : FoundClips)
	{
		DummyClips.Add(Clip);
	}

	// Frente medida pelos pés -> +X do ator; altura -> BodyHeightCm; pés no fundo do capsule.
	MeshScale = BodyHeightCm / Measure.Height;
	MeshForwardYaw = Measure.ForwardYaw;
	MeshYawOffset = -Measure.ForwardYaw + MeshYawAdjust;

	USkeletalMeshComponent* Body = GetMesh();
	Body->SetSkeletalMeshAsset(MeshAsset);
	Body->SetRelativeScale3D(FVector(MeshScale));
	Body->SetRelativeLocationAndRotation(FVector(0.0, 0.0, -CapsuleHalfHeightCm - Measure.BottomZ * MeshScale), FRotator(0.0f, MeshYawOffset, 0.0f));
	Body->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones; // a bola lê a mão
	Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Body->SetAnimationMode(EAnimationMode::AnimationBlueprint);
	Body->SetAnimInstanceClass(UHoopsAnimInstance::StaticClass());
	Body->SetVisibility(true);

	// Cores por slot de material (Pele / Uniforme / Tenis, nomes do FBX). Só com o M_HoopsSolid do projeto (marcado
	// para malha com esqueleto); sem ele, ficam os materiais importados do FBX, que já têm essas cores.
	const TArray<FName> Slots = HoopsMeshUtil::GetProjectMaterial(TEXT("M_HoopsSolid")) ? Body->GetMaterialSlotNames() : TArray<FName>();
	for (int32 Index = 0; Index < Slots.Num(); ++Index)
	{
		const FString Slot = Slots[Index].ToString();
		if (Slot.Contains(TEXT("Pele")))
		{
			HoopsMeshUtil::SetSlotColor(this, Body, Index, SkinColor, 0.6f);
		}
		else if (Slot.Contains(TEXT("Tenis")))
		{
			HoopsMeshUtil::SetSlotColor(this, Body, Index, ShoesColor, 0.45f);
		}
		else
		{
			HoopsMeshUtil::SetSlotColor(this, Body, Index, JerseyColor, 0.8f);
		}
	}

	PlaceholderBody->SetVisibility(false);
	bRigActive = true;
	BaseClip = EHoopsClip::DribbleIdleR;
	if (UHoopsAnimInstance* Anim = GetHoopsAnim())
	{
		Anim->SetBase(GetClip(BaseClip), DribbleIdlePlayRate, 0.0f, false);
	}
	ResetBallCarry(Hoops::BallHand::Right, 0.0);
	int32 ClipCount = 0;
	for (const TObjectPtr<UAnimSequence>& Clip : DummyClips)
	{
		ClipCount += Clip ? 1 : 0;
	}
	Hud.BodyStatus = FString::Printf(TEXT("Boneco animado: ATIVO (%d/%d clipes)"), ClipCount, HoopsDummyRig::NumClips);
	UE_LOG(LogHoops, Log, TEXT("Boneco animado ativo: escala %.2f, yaw %.0f, %d clipes."), MeshScale, MeshYawOffset, ClipCount);
	return true;
}

UHoopsAnimInstance* AHoopsPlayerCharacter::GetHoopsAnim() const
{
	return Cast<UHoopsAnimInstance>(GetMesh()->GetAnimInstance());
}

UAnimSequence* AHoopsPlayerCharacter::GetClip(EHoopsClip Clip) const
{
	for (int32 Step = 0; Step < HoopsDummyRig::NumClips; ++Step)
	{
		const int32 Index = static_cast<int32>(Clip);
		if (DummyClips.IsValidIndex(Index) && DummyClips[Index])
		{
			return DummyClips[Index];
		}
		const EHoopsClip Next = HoopsDummyRig::Fallback(Clip);
		if (Next == Clip)
		{
			break;
		}
		Clip = Next;
	}
	const int32 HoldIndex = static_cast<int32>(EHoopsClip::HoldIdle);
	return DummyClips.IsValidIndex(HoldIndex) ? DummyClips[HoldIndex].Get() : nullptr;
}

void AHoopsPlayerCharacter::UpdateBodyAnimation(float DeltaSeconds)
{
	UHoopsAnimInstance* Anim = GetHoopsAnim();
	if (!Anim)
	{
		return;
	}

	// Velocidade no referencial do corpo: X = frente, Y = direita.
	const FVector Local = GetActorRotation().UnrotateVector(FVector(GetVelocity().X, GetVelocity().Y, 0.0));
	const float Speed = static_cast<float>(Local.Size2D());
	const bool bRight = Dribble.GetHand() == Hoops::BallHand::Right;
	const bool bDribbling = bHasBall && ShotPhase == EShotPhase::None;

	// Histerese: não fica piscando entre parado/andar/correr perto dos limites.
	const float IdleThreshold = IsIdleClip(BaseClip) ? 45.0f : 30.0f;
	const float RunThreshold = IsRunClip(BaseClip) ? 190.0f : 230.0f;
	// Faixas de direção com histerese (diagonal não fica trocando de clipe a cada frame).
	const bool bWasForward = BaseClip == EHoopsClip::DribbleWalkR || BaseClip == EHoopsClip::DribbleWalkL ||
		BaseClip == EHoopsClip::DribbleRunR || BaseClip == EHoopsClip::DribbleRunL;
	const bool bWasBack = BaseClip == EHoopsClip::DribbleBackR || BaseClip == EHoopsClip::DribbleBackL;
	const float ForwardLimit = bWasForward ? 65.0f : 45.0f;
	const float BackLimit = bWasBack ? 115.0f : 135.0f;
	// A passada do boneco cresce com a escala: a velocidade nativa também.
	const auto RateFor = [Speed, Scale = MeshScale](EHoopsClip Clip, float MaxRate)
	{
		const float Native = static_cast<float>(HoopsDummyRig::NativeVelocity(Clip).Size()) * Scale;
		return Native > 1.0f ? FMath::Clamp(Speed / Native, 0.6f, MaxRate) : 1.0f;
	};

	EHoopsClip Clip = EHoopsClip::HoldIdle;
	float Rate = 1.0f;
	if (Speed < IdleThreshold)
	{
		Clip = bDribbling ? (bRight ? EHoopsClip::DribbleIdleR : EHoopsClip::DribbleIdleL) : EHoopsClip::HoldIdle;
		Rate = bDribbling ? DribbleIdlePlayRate : 1.0f;
		const EHoopsClip LowClip = bRight ? EHoopsClip::DribbleLowR : EHoopsClip::DribbleLowL;
		const int32 LowIndex = static_cast<int32>(LowClip);
		if (bDribbling && bLeftTriggerHeld && DummyClips.IsValidIndex(LowIndex) && DummyClips[LowIndex])
		{
			// LT (proteger): drible baixo e rápido, base escalonada e o braço livre de escudo (06_13).
			Clip = LowClip;
			Rate = DribbleLowPlayRate;
		}
	}
	else
	{
		const float Angle = FMath::RadiansToDegrees(FMath::Atan2(static_cast<float>(Local.Y), static_cast<float>(Local.X))); // 0 = frente, +90 = direita
		const float AbsAngle = FMath::Abs(Angle);
		const bool bRun = Speed > RunThreshold;
		if (!bDribbling)
		{
			Clip = bRun ? EHoopsClip::Run : EHoopsClip::Walk;
			Rate = RateFor(Clip, 1.8f);
		}
		else if (AbsAngle <= ForwardLimit)
		{
			Clip = bRun ? (bRight ? EHoopsClip::DribbleRunR : EHoopsClip::DribbleRunL) : (bRight ? EHoopsClip::DribbleWalkR : EHoopsClip::DribbleWalkL);
			Rate = RateFor(Clip, 1.8f);
		}
		else if (AbsAngle >= BackLimit)
		{
			Clip = bRight ? EHoopsClip::DribbleBackR : EHoopsClip::DribbleBackL;
			Rate = RateFor(Clip, 2.0f);
		}
		else
		{
			// De lado: Side_R anda para a esquerda e Side_L para a direita; o outro sentido toca o clipe ao contrário.
			Clip = bRight ? EHoopsClip::DribbleSideR : EHoopsClip::DribbleSideL;
			const bool bClipGoesRight = HoopsDummyRig::NativeVelocity(Clip).Y > 0.0;
			Rate = RateFor(Clip, 2.0f) * (bClipGoesRight == (Angle > 0.0f) ? 1.0f : -1.0f);
		}
	}
	if (bDribbling)
	{
		Rate *= static_cast<float>(Dribble.MovePlayRateScale()); // cansado: drible mais lento (docs/05 §2.5)
	}

	CurrentBaseRateAbs = FMath::Abs(Rate);
	const bool bKeepPhase = IsHandPair(Clip, BaseClip);
	Anim->SetBase(GetClip(Clip), Rate, bKeepPhase ? 0.15f : 0.22f, bKeepPhase);
	BaseClip = Clip;

	// Postura atlética + inclinação pela aceleração (no referencial do corpo).
	// Aceleração no mundo, depois girada para o corpo (derivar a velocidade local inventaria aceleração quando ele gira).
	const FVector WorldVelocity(GetVelocity().X, GetVelocity().Y, 0.0);
	if (DeltaSeconds > UE_KINDA_SMALL_NUMBER)
	{
		const FVector Accel = GetActorRotation().UnrotateVector((WorldVelocity - PrevWorldVelocity) / DeltaSeconds);
		SmoothedLocalAccel = FMath::Lerp(SmoothedLocalAccel, Accel, FMath::Min(1.0f, DeltaSeconds * 10.0f));
	}
	PrevWorldVelocity = WorldVelocity;
	float Crouch = 0.0f;
	if (bDribbling)
	{
		// O drible baixo do LT já é ~14 cm mais baixo no mocap: só um pouco da postura por cima.
		Crouch = DribbleCrouchCm * (IsLowDribbleClip(Clip) ? 0.4f : (IsIdleClip(Clip) ? 1.0f : (IsRunClip(Clip) ? 0.45f : 0.75f)));
	}
	float LeanForward = 0.0f;
	float LeanRight = 0.0f;
	if (bBodyLean && ShotPhase == EShotPhase::None)
	{
		const float ForwardSpeed = FMath::Max(0.0f, static_cast<float>(Local.X)); // de costas/de lado não inclina para a frente
		LeanForward = FMath::Clamp(ForwardSpeed / 600.0f * 6.0f + static_cast<float>(SmoothedLocalAccel.X) / 1500.0f * 5.0f, -6.0f, 12.0f);
		LeanRight = FMath::Clamp(static_cast<float>(SmoothedLocalAccel.Y) / 1500.0f * 9.0f, -12.0f, 12.0f);
	}
	Anim->SetStanceTarget(Crouch / FMath::Max(0.1f, MeshScale), LeanForward, LeanRight, FRotator(0.0, MeshForwardYaw - MeshYawAdjust, 0.0).Vector());
}

HoopsDummyRig::FJumpShotTiming AHoopsPlayerCharacter::JumperTiming() const
{
	// Jump shot alto (124_05) se escolhido e importado; senão o clássico (06_15).
	const int32 HighIndex = static_cast<int32>(HoopsDummyRig::JumpShotHigh.Clip);
	const bool bHigh = JumpShotStyle == 1 && DummyClips.IsValidIndex(HighIndex) && DummyClips[HighIndex];
	return bHigh ? HoopsDummyRig::JumpShotHigh : HoopsDummyRig::JumpShotClassic;
}

void AHoopsPlayerCharacter::PlayShotAction(const HoopsDummyRig::FJumpShotTiming& Timing, float StartSeconds, float SecondsToRelease)
{
	UHoopsAnimInstance* Anim = GetHoopsAnim();
	const int32 ShotIndex = static_cast<int32>(Timing.Clip); // destro (o _L fica para canhotos)
	UAnimSequence* Shot = DummyClips.IsValidIndex(ShotIndex) ? DummyClips[ShotIndex].Get() : nullptr;
	if (!Anim || !Shot)
	{
		return;
	}
	Anim->StopUpperBody(0.12f); // sai do follow-through/celebração anterior
	// A mão chega ao topo (quadro de soltura do clipe) em SecondsToRelease.
	const float Rate = (Timing.Release - StartSeconds) / FMath::Max(0.15f, SecondsToRelease);
	Anim->PlayAction(Shot, StartSeconds, Rate, 0.12f, Timing.End);

	// A bola vai da posição atual para as mãos do arremesso.
	BallBlendFrom = Ball ? Ball->GetActorLocation() : FVector::ZeroVector;
	BallBlendStart = Now();
	BallBlendSeconds = 0.15;
}

FVector AHoopsPlayerCharacter::HandBallPoint(Hoops::BallHand Hand) const
{
	const bool bRight = Hand == Hoops::BallHand::Right;
	const USkeletalMeshComponent* Body = GetMesh();
	const FVector Palm = Body->GetBoneLocation(bRight ? BonePalmR : BonePalmL);
	const FVector Fingers = Body->GetBoneLocation(bRight ? BoneFingersR : BoneFingersL);
	FVector Offset = DribbleBallOffset;
	if (!bRight)
	{
		Offset.Y = -Offset.Y; // "para fora" é o outro lado
	}
	// Frente do corpo visual (inclui o giro do spin).
	const FRotator BodyRotation(0.0, Body->GetComponentRotation().Yaw - MeshYawOffset, 0.0);
	return (Palm + Fingers) * 0.5 + BodyRotation.RotateVector(Offset);
}

FVector AHoopsPlayerCharacter::ShotBallPoint() const
{
	const USkeletalMeshComponent* Body = GetMesh();
	// Mão do arremesso: a direita, ou a esquerda na bandeja do lado esquerdo do aro.
	const FVector ShootPalm = Body->GetBoneLocation(bShotLeftHand ? BonePalmL : BonePalmR);
	const FVector SupportPalm = Body->GetBoneLocation(bShotLeftHand ? BonePalmR : BonePalmL);
	const FVector Hand = (ShootPalm + Body->GetBoneLocation(bShotLeftHand ? BoneFingersL : BoneFingersR)) * 0.5;
	const FRotator BodyRotation(0.0, Body->GetComponentRotation().Yaw - MeshYawOffset, 0.0);
	FVector Offset = ShotBallOffset;
	if (bShotLeftHand)
	{
		Offset.Y = -Offset.Y; // "para a direita" vira "para a esquerda"
	}
	// Bola apoiada na mão do arremesso, encostada na mão de apoio.
	return Hand + (SupportPalm - ShootPalm).GetSafeNormal() * (AHoopsBall::RadiusCm * 0.5) + BodyRotation.RotateVector(Offset);
}

void AHoopsPlayerCharacter::ResetBallCarry(Hoops::BallHand Hand, double BlendSeconds)
{
	if (UHoopsAnimInstance* Anim = GetHoopsAnim())
	{
		Anim->StopUpperBody(FMath::Max(0.1f, static_cast<float>(BlendSeconds))); // mãos de volta para a bola
	}
	Carry = EBallCarry::Hand;
	CarryHand = Hand;
	FlightHand = Hand;
	CarryStart = Now();
	bHandTrackValid = false;
	bHasTopRelative = false;
	bSwitchRequested = false;
	bDoubleCrossPending = false;
	BallBlendFrom = Ball ? Ball->GetActorLocation() : FVector::ZeroVector;
	BallBlendStart = Now();
	BallBlendSeconds = BlendSeconds;
}

void AHoopsPlayerCharacter::TrackHandStroke(Hoops::BallHand Hand, const FVector& HandPoint, float DeltaSeconds)
{
	// Altura relativa ao capsule: o curso da mão na animação, sem o movimento do jogador.
	const float RelZ = static_cast<float>(HandPoint.Z - GetActorLocation().Z);
	if (!bHandTrackValid || Hand != TrackedHand)
	{
		bHandTrackValid = true;
		bHasTopRelative = Hand == TrackedHand && bHasTopRelative; // o topo guardado era da outra mão
		TrackedHand = Hand;
		HandPrevZ = RelZ;
		HandVz = 0.0f;
		StrokeTopZ = RelZ;
		StrokePeakVz = 0.0f;
		return;
	}

	const float PrevVz = HandVz;
	HandVz = FMath::Lerp(HandVz, (RelZ - HandPrevZ) / DeltaSeconds, 0.5f);
	HandPrevZ = RelZ;
	if (HandVz > 0.0f)
	{
		// Subindo: o curso recomeça; o topo é o ponto mais alto até agora.
		StrokeTopZ = RelZ;
		StrokePeakVz = 0.0f;
	}
	else
	{
		if (PrevVz > 0.0f)
		{
			// Passou do topo: é aí que a bola deve encontrar a mão no próximo quique.
			LastTopRelative = GetActorTransform().InverseTransformPosition(HandPoint);
			bHasTopRelative = true;
		}
		StrokePeakVz = FMath::Min(StrokePeakVz, HandVz);
	}
}

void AHoopsPlayerCharacter::BeginBallFlight(const FVector& Start, Hoops::BallHand ToHand, double Seconds)
{
	// O quique é calculado no referencial do jogador (como a mão): se ele freia, vira ou leva o impulso de um
	// drible no meio do voo, a bola vai junto e nunca "foge" para onde ele estaria (como no 2K, a bola é do corpo).
	const FTransform Body = GetActorTransform();
	// Só para o quique cair um pouco à frente correndo (recuando ou de lado, não puxa a bola para os pés/através do corpo).
	const FVector LocalVelocity(FMath::Clamp(Body.InverseTransformVector(GetVelocity()).X, 0.0, 500.0), 0.0, 0.0);
	// Recepção prevista: o topo do curso da mesma mão (medido no ciclo anterior) ou, trocando de mão, um pouco
	// acima da outra mão agora. O fim do voo encosta na mão animada de qualquer jeito.
	const bool bSameHand = Carry == EBallCarry::Hand && ToHand == CarryHand && bHasTopRelative;
	const FVector EndLocal = bSameHand ? LastTopRelative : Body.InverseTransformPosition(HandBallPoint(ToHand) + FVector(0.0, 0.0, 10.0 * MeshScale));
	const double FloorZ = -CapsuleHalfHeightCm / 100.0; // chão no referencial do capsule (o ator fica no centro dele)

	FlightArc = Hoops::MakeDribbleArc(HoopsUnits::ToSim(Body.InverseTransformPosition(Start)), HoopsUnits::ToSim(EndLocal),
		HoopsUnits::ToSim(LocalVelocity), Seconds, AHoopsBall::RadiusCm / 100.0, FloorZ);
	Carry = EBallCarry::Flight;
	FlightHand = ToHand;
	FlightStart = Now();
	FlightSeconds = Seconds;
}

void AHoopsPlayerCharacter::LateUpdateHeldBall(float DeltaSeconds)
{
	if (!bRigActive || !Ball || !bHasBall || DeltaSeconds <= UE_KINDA_SMALL_NUMBER)
	{
		return;
	}
	const double T = Now();
	FVector Target;

	if (ShotPhase != EShotPhase::None)
	{
		Target = ShotBallPoint();
	}
	else
	{
		// Troca de mão pedida por um drible (crossover, entre as pernas, por trás...).
		const Hoops::BallHand HeldHand = Carry == EBallCarry::Hand ? CarryHand : FlightHand;
		const FVector BallNow = Carry == EBallCarry::Hand ? HandBallPoint(CarryHand) : Ball->GetActorLocation();
		if (bSwitchRequested && T >= SwitchNotBefore)
		{
			bSwitchRequested = false;
			const Hoops::BallHand To = bDoubleCrossPending ? Hoops::OtherHand(HeldHand) : Dribble.GetHand();
			const double Seconds = FMath::Clamp(SwitchFlightSeconds, 0.12, 0.6); // 0,12: o DelaySwitch já encurtou o voo
			if (To != HeldHand)
			{
				if (Carry == EBallCarry::Flight && T - FlightStart > FlightArc.DownSeconds)
				{
					FlightHand = To; // já subindo do quique: o fim do voo leva a bola para a outra mão
				}
				else
				{
					BeginBallFlight(BallNow, To, Seconds);
				}
			}
		}
		else if (Carry == EBallCarry::Hand && CarryHand != Dribble.GetHand() && !bDoubleCrossPending && !bSwitchRequested)
		{
			BeginBallFlight(BallNow, Dribble.GetHand(), 0.3); // bola na mão errada (ex.: depois de receber): troca
		}

		if (Carry == EBallCarry::Flight)
		{
			const FVector Live = HandBallPoint(FlightHand);
			TrackHandStroke(FlightHand, Live, DeltaSeconds);
			const double Elapsed = T - FlightStart;
			UHoopsAudioSubsystem::NotifyDribbleArc(this, FlightArc, Elapsed, DeltaSeconds, GetActorTransform()); // quique no chão
			Target = GetActorTransform().TransformPosition(HoopsUnits::ToUnreal(FlightArc.Evaluate(Elapsed)));
			// No fim do voo, encosta na mão animada (a previsão do ponto de recepção nunca é exata).
			const double SteerFrom = FlightSeconds * 0.6;
			if (Elapsed > SteerFrom)
			{
				const float Alpha = FMath::SmoothStep(0.0f, 1.0f, static_cast<float>((Elapsed - SteerFrom) / (FlightSeconds - SteerFrom)));
				Target = FMath::Lerp(Target, Live, Alpha);
			}
			if (Elapsed >= FlightSeconds)
			{
				Carry = EBallCarry::Hand;
				CarryHand = FlightHand;
				CarryStart = T;
				Target = Live;
				StrokeTopZ = HandPrevZ;
				StrokePeakVz = 0.0f;
				if (bDoubleCrossPending)
				{
					// Double cross: chegou na outra mão, volta na hora.
					bDoubleCrossPending = false;
					if (CarryHand != Dribble.GetHand())
					{
						BeginBallFlight(Target, Dribble.GetHand(), FMath::Clamp(SwitchFlightSeconds, 0.12, 0.6));
					}
				}
			}
		}
		else
		{
			// Na mão: a bola desce com a mão e sai no fim do empurrão (a mão desacelera descendo).
			Target = HandBallPoint(CarryHand);
			TrackHandStroke(CarryHand, Target, DeltaSeconds);
			const float Drop = StrokeTopZ - HandPrevZ;
			// Limiar de velocidade acompanha o playrate (clipe lento ou de lado ao contrário desce devagar).
			const float PushSpeed = -70.0f * FMath::Clamp(CurrentBaseRateAbs, 0.4f, 1.0f);
			// (Esperando a troca de mão de um drible: a bola fica na mão até o quadro em que o clipe solta.)
			const bool bPush = !bSwitchRequested && Drop > 7.0f * MeshScale && StrokePeakVz < PushSpeed && HandVz > StrokePeakVz * 0.55f && T - CarryStart > 0.1;
			const bool bStuck = T - CarryStart > FMath::Max(1.2, PushPeriod * 2.0); // segurança: nunca fica presa na mão
			if (bPush || bStuck)
			{
				const double Interval = T - LastPushTime;
				if (bPush && Interval > 0.25 && Interval < 1.6)
				{
					PushPeriod = FMath::Lerp(PushPeriod, Interval, 0.5);
				}
				LastPushTime = T;
				// A mão leva pouco mais de meio ciclo para voltar ao topo, onde recebe a bola.
				BeginBallFlight(Target, CarryHand, FMath::Clamp(PushPeriod * 0.6, 0.2, 0.55));
			}
		}
	}

	// Transição suave (recepção, gather, pump fake).
	if (BallBlendSeconds > 0.0 && T - BallBlendStart < BallBlendSeconds)
	{
		const float Alpha = FMath::SmoothStep(0.0f, 1.0f, static_cast<float>((T - BallBlendStart) / BallBlendSeconds));
		Target = FMath::Lerp(BallBlendFrom, Target, Alpha);
	}
	Ball->SetControlledLocation(Target);
}

// ============================================================================ Green (estilo 2K Park)

UAnimSequence* AHoopsPlayerCharacter::GetActionClip(EHoopsClip Clip) const
{
	const int32 Index = static_cast<int32>(Clip);
	if (DummyClips.IsValidIndex(Index) && DummyClips[Index])
	{
		return DummyClips[Index];
	}
	const int32 FallbackIndex = static_cast<int32>(HoopsDummyRig::Fallback(Clip));
	return DummyClips.IsValidIndex(FallbackIndex) && FallbackIndex != static_cast<int32>(EHoopsClip::HoldIdle) ? DummyClips[FallbackIndex].Get() : nullptr;
}

void AHoopsPlayerCharacter::OnShotReleased(const Hoops::ShotEvaluation& Eval, double HoldMs)
{
	const bool bGreen = Eval.Timing == Hoops::TimingGrade::Green;
	bLastShotGreen = bGreen;

	// Medidor congelado na soltura, com a cor do resultado.
	Hud.ResultFill = FoldMeter(HoldMs / FMath::Max(1.0, ShotWindows.IdealReleaseMs));
	Hud.ResultTime = Now();
	switch (Eval.Timing)
	{
	case Hoops::TimingGrade::Green: Hud.ResultColor = FLinearColor(0.20f, 1.0f, 0.35f); break;
	case Hoops::TimingGrade::Good: Hud.ResultColor = FLinearColor::White; break;
	case Hoops::TimingGrade::SlightlyEarly:
	case Hoops::TimingGrade::SlightlyLate: Hud.ResultColor = FLinearColor(1.0f, 0.85f, 0.2f); break;
	default: Hud.ResultColor = FLinearColor(1.0f, 0.3f, 0.25f); break;
	}
	bFeedbackPending = bGreenFeedbackAtRim;
	if (!bFeedbackPending)
	{
		FireShotFeedback();
	}

	// Segura o follow-through (braço do arremesso no alto, "pulso quebrado") enquanto as pernas aterrissam.
	// No green segura mais, como no 2K.
	UHoopsAnimInstance* Anim = GetHoopsAnim();
	const HoopsDummyRig::FJumpShotTiming Timing = JumperTiming();
	UAnimSequence* Shot = GetActionClip(Timing.Clip);
	if (bRigActive && Anim && Shot)
	{
		Anim->PlayUpperBody(Shot, Timing.FollowThrough, 0.0f, 0.18f, bGreen ? GreenHoldSeconds : 0.45f, 0.35f);
	}

	// Green: ~1,3 s depois, parado e sem a bola, vira e volta (UpdateTurnBack).
	ShotReleaseTime = Now();
	bTurnBackPending = bGreen && bTurnBackAfterGreen && bRigActive;
}

void AHoopsPlayerCharacter::Celebrate()
{
	UHoopsAnimInstance* Anim = GetHoopsAnim();
	if (!bRigActive || !Anim)
	{
		return;
	}
	// Alterna entre as celebrações importadas (o "toca aqui" fica só no D-pad: pede um companheiro).
	const EHoopsClip Options[] = {EHoopsClip::CelebrateFlex, EHoopsClip::CelebrateShrug, EHoopsClip::CelebrateBow, EHoopsClip::CelebrateArmsUp};
	const int32 NumOptions = static_cast<int32>(UE_ARRAY_COUNT(Options));
	UAnimSequence* Clip = nullptr;
	for (int32 Try = 0; Try < NumOptions && !Clip; ++Try)
	{
		const int32 Index = CelebrationIndex % NumOptions;
		++CelebrationIndex;
		// Sem substituto: uma celebração que não foi importada é pulada (não repete a anterior).
		const int32 ClipIndex = static_cast<int32>(Options[Index]);
		Clip = DummyClips.IsValidIndex(ClipIndex) ? DummyClips[ClipIndex].Get() : nullptr;
	}
	if (Clip)
	{
		const float Length = static_cast<float>(Clip->GetPlayLength());
		Anim->PlayUpperBody(Clip, 0.0f, 1.0f, 0.25f, FMath::Max(0.3f, Length - 0.3f), 0.3f);
		LogInput(FString::Printf(TEXT("Celebracao: %s"), *Clip->GetName()));
	}
}

void AHoopsPlayerCharacter::PlayGreenChime()
{
	// "Ding" de duas notas (Mi e Si agudos), sintetizado em HoopsAudio (sem asset).
	UHoopsAudioSubsystem::Play2D(this, EHoopsSound::GreenChime, GreenSoundVolume);
}

void AHoopsPlayerCharacter::FireShotFeedback()
{
	bFeedbackPending = false;
	if (bShotFeedbackEnabled)
	{
		Hud.bShowFeedback = true;
		Hud.FeedbackTime = Now();
	}
	if (bLastShotGreen)
	{
		Hud.GreenTime = Now();
		PlayGreenChime();
	}
}

void AHoopsPlayerCharacter::UpdatePendingFeedback()
{
	if (!bFeedbackPending || !Ball || !Hoop)
	{
		return;
	}
	// Modo 2K23: dispara quando a bola chega ao aro (ou cai, ou demora demais).
	const bool bAtRim = FVector::Dist(Ball->GetActorLocation(), Hoop->GetRimCenterWorld()) < 60.0;
	const bool bDone = Now() - LastMakeTime < 0.05 || Ball->HasTouchedFloorSinceLaunch() || Ball->GetSecondsSinceLaunch() > 3.0;
	if (bAtRim || bDone)
	{
		FireShotFeedback();
	}
}

bool AHoopsPlayerCharacter::TryDpadCelebration(int32 Slot)
{
	// Janela de ~2,5 s depois de uma cesta, sem a bola na mão (docs/17 §2.1). Fora dela o D-pad faz o de sempre.
	if (!bRigActive || bHasBall || Now() - LastMakeTime > 2.5)
	{
		return false;
	}
	UHoopsAnimInstance* Anim = GetHoopsAnim();
	if (!Anim)
	{
		return false;
	}
	// A mesma direção de novo, depois da mesma cesta, passa para a próxima celebração do slot.
	if (DpadCelebrationMake != LastMakeTime || DpadCelebrationSlot != Slot)
	{
		DpadCelebrationMake = LastMakeTime;
		DpadCelebrationSlot = Slot;
		DpadCelebrationPresses = 0;
	}
	const int32 Press = DpadCelebrationPresses++;
	if (Slot == 2)
	{
		// Segura a pose do arremesso (pulso quebrado no alto).
		const HoopsDummyRig::FJumpShotTiming Timing = JumperTiming();
		if (UAnimSequence* Shot = GetActionClip(Timing.Clip))
		{
			Anim->PlayUpperBody(Shot, Timing.FollowThrough, 0.0f, 0.2f, 1.4f, 0.35f);
			LogInput(TEXT("Celebracao: segura a pose"));
		}
		return true;
	}
	// Cima: bíceps / braços para o alto. Direita: ombros / toca aqui. Baixo: arco e flecha (docs/17 §2.3).
	const EHoopsClip UpOptions[] = {EHoopsClip::CelebrateFlex, EHoopsClip::CelebrateArmsUp};
	const EHoopsClip RightOptions[] = {EHoopsClip::CelebrateShrug, EHoopsClip::CelebrateHighFive};
	EHoopsClip Choice = EHoopsClip::CelebrateBow;
	if (Slot == 0)
	{
		Choice = UpOptions[Press % 2];
	}
	else if (Slot == 1)
	{
		Choice = RightOptions[Press % 2];
	}
	UAnimSequence* Clip = GetActionClip(Choice);
	if (!Clip && Slot != 3)
	{
		Clip = GetActionClip(Slot == 0 ? UpOptions[0] : RightOptions[0]); // FBX sem a segunda celebração do slot
	}
	if (!Clip)
	{
		return false;
	}
	const float Length = static_cast<float>(Clip->GetPlayLength());
	Anim->PlayUpperBody(Clip, 0.0f, 1.0f, 0.2f, FMath::Max(0.3f, Length - 0.3f), 0.3f);
	LogInput(FString::Printf(TEXT("Celebracao (D-pad): %s"), *Clip->GetName()));
	return true;
}

void AHoopsPlayerCharacter::UpdateTurnBack()
{
	// Vira e volta (docs/17 §1.1, gesto #3): ~1,3 s depois de um green, parado e sem a bola, o jogador dá os últimos passos
	// de costas e gira 180° no lugar para a esquerda (clipe TurnBack, 69_39), com o braço do arremesso ou a celebração
	// ainda no alto (camada do tronco por cima). O giro saiu do clipe: aqui o ATOR gira pela curva medida no mocap.
	UHoopsAnimInstance* Anim = GetHoopsAnim();
	const double T = Now();
	if (bTurnBackPending && T - ShotReleaseTime >= TurnBackDelaySeconds)
	{
		bTurnBackPending = false;
		const bool bMissed = !bAwaitingShotResult && LastMakeTime < ShotReleaseTime; // a bola já caiu fora
		const bool bIdle = MoveInput.IsNearlyZero() && GetVelocity().Size2D() < 60.0 && !GetCharacterMovement()->IsFalling();
		UAnimSequence* Clip = GetActionClip(EHoopsClip::TurnBack);
		if (Anim && Clip && bIdle && !bMissed && !bHasBall && ShotPhase == EShotPhase::None)
		{
			Anim->PlayAction(Clip, HoopsDummyRig::TurnBackStartSeconds, TurnBackPlayRate, 0.2f, HoopsDummyRig::TurnBackEndSeconds);
			TurnBackStart = T + (HoopsDummyRig::TurnBackTurnStartSeconds - HoopsDummyRig::TurnBackStartSeconds) / TurnBackPlayRate;
			TurnBackDuration = (HoopsDummyRig::TurnBackTurnEndSeconds - HoopsDummyRig::TurnBackTurnStartSeconds) / TurnBackPlayRate;
			TurnBackStartYaw = GetActorRotation().Yaw;
			bTurnBackActive = true;
			LogInput(TEXT("Green: vira e volta"));
		}
	}
	if (!bTurnBackActive)
	{
		return;
	}
	// Qualquer comando cancela: receber a bola (CatchBall já parou o clipe; o que vier depois é ação do drible) ou andar
	// (as pernas voltam para o jogador na hora).
	if (bHasBall || ShotPhase != EShotPhase::None)
	{
		bTurnBackActive = false;
		return;
	}
	if (!MoveInput.IsNearlyZero())
	{
		bTurnBackActive = false;
		if (Anim)
		{
			Anim->StopAction(0.15f);
		}
		return;
	}
	const float Alpha = FMath::Clamp(static_cast<float>((T - TurnBackStart) / FMath::Max(0.1, TurnBackDuration)), 0.0f, 1.0f);
	// Para a esquerda, como no mocap (yaw da Unreal cresce para a direita).
	SetActorRotation(FRotator(0.0, TurnBackStartYaw - 180.0 * HoopsDummyRig::TurnBackAlpha(Alpha), 0.0));
	bTurnBackActive = Alpha < 1.0f;
}
