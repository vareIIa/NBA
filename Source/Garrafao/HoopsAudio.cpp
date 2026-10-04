#include "HoopsAudio.h"

#include "Camera/PlayerCameraManager.h"
#include "Components/AudioComponent.h"
#include "Components/CapsuleComponent.h"
#include "Engine/World.h"
#include "Garrafao.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "HoopsPlayerCharacter.h"
#include "HoopsUnits.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/SoundAttenuation.h"
#include "Sound/SoundWaveProcedural.h"
#include "TimerManager.h"

namespace HoopsAudioTuning
{
	struct FSoundTuning
	{
		float MinInterval;  // s entre dois toques do mesmo som
		float PitchJitter;  // ± fração
		float VolumeJitter; // ± fração
	};

	// Índice = EHoopsSound.
	const FSoundTuning Sounds[] = {
		{0.05f, 0.05f, 0.10f}, // quique
		{0.40f, 0.04f, 0.08f}, // rede
		{0.40f, 0.04f, 0.08f}, // rede abafada
		{0.06f, 0.03f, 0.10f}, // aro
		{0.08f, 0.04f, 0.10f}, // tabela
		{0.10f, 0.06f, 0.12f}, // tênis
		{0.20f, 0.00f, 0.00f}, // ding do green (sempre igual)
	};
	static_assert(UE_ARRAY_COUNT(Sounds) == static_cast<int32>(EHoopsSound::Count), "Afinação fora de sincronia com EHoopsSound");

	constexpr int32 MaxVoices = 24;
	constexpr double FullVolumeDistanceCm = 1200.0; // a câmera fica a ~10,5 m do jogador
	constexpr double SoftNetAfterRimSeconds = 1.5;
	constexpr double StopMarginSeconds = 0.1;
	constexpr double LandingFallbackSeconds = 0.25;

	float CategoryVolume(const FHoopsAudioMix& Mix, EHoopsSound Sound)
	{
		switch (Sound)
		{
		case EHoopsSound::Bounce: return Mix.BallVolume;
		case EHoopsSound::Swish:
		case EHoopsSound::NetSoft: return Mix.NetVolume;
		case EHoopsSound::RimClank:
		case EHoopsSound::Backboard: return Mix.RimVolume;
		case EHoopsSound::Squeak: return Mix.ShoesVolume;
		default: return 1.0f; // ding: o volume vem do jogador (GreenSoundVolume)
		}
	}

	// Impacto (m/s) → 0..1, curva suave: batidas fracas ainda se ouvem um pouco. Referências medidas na física do
	// núcleo: aro de frente ~11 m/s de variação, tabela ~6,5, bola caindo do aro no chão 8–9, drible 4,5–6,6.
	float ImpactToIntensity(double Speed, double FullSpeed, float Exponent)
	{
		return FMath::Clamp(FMath::Pow(static_cast<float>(Speed / FullSpeed), Exponent), 0.0f, 1.0f);
	}
}

// ============================================================================ Ciclo de vida

void UHoopsAudioSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	Random.Initialize(static_cast<int32>(FPlatformTime::Cycles() & 0x7FFFFFFF));
	const UWorld* ThisWorld = GetWorld();
	if (ThisWorld && ThisWorld->IsGameWorld())
	{
		BuildBank(); // ~30 ms no começo da partida em vez de um engasgo no primeiro quique
	}
}

void UHoopsAudioSubsystem::Deinitialize()
{
	for (FHoopsAudioVoice& Voice : Voices)
	{
		if (IsValid(Voice.Component.Get()))
		{
			Voice.Component->Stop();
		}
	}
	Voices.Reset();
	Super::Deinitialize();
}

void UHoopsAudioSubsystem::BuildBank()
{
	if (bBankReady)
	{
		return;
	}
	bBankReady = true;
	const double StartTime = FPlatformTime::Seconds();
	const int32 NumSounds = static_cast<int32>(EHoopsSound::Count);
	Bank.SetNum(NumSounds * HoopsSynth::MaxVariants);
	LastPlayTime.Init(-100.0, NumSounds);
	LastVariant.Init(INDEX_NONE, NumSounds);

	int32 Built = 0;
	TArray<float> Buffer;
	for (int32 Kind = 0; Kind < NumSounds; ++Kind)
	{
		const EHoopsSound Sound = static_cast<EHoopsSound>(Kind);
		for (int32 Variant = 0; Variant < HoopsSynth::NumVariants(Sound) && Variant < HoopsSynth::MaxVariants; ++Variant)
		{
			const int32 Num = HoopsSynth::NumSamples(Sound, Variant);
			Buffer.SetNumUninitialized(Num);
			HoopsSynth::Render(Sound, Variant, Buffer.GetData(), Num);
			FHoopsAudioPcm& Pcm = Bank[Kind * HoopsSynth::MaxVariants + Variant];
			Pcm.Samples.SetNumUninitialized(Num);
			for (int32 Index = 0; Index < Num; ++Index)
			{
				Pcm.Samples[Index] = static_cast<int16>(FMath::RoundToInt(FMath::Clamp(Buffer[Index], -1.0f, 1.0f) * 32767.0f));
			}
			Pcm.Seconds = static_cast<float>(Num) / static_cast<float>(HoopsSynth::SampleRateHz);
			++Built;
		}
	}

	Attenuation = NewObject<USoundAttenuation>(this);
	Attenuation->Attenuation.bAttenuate = false; // a queda com a distância é a nossa (DistanceGain)
	Attenuation->Attenuation.bSpatialize = true;  // pan esquerda/direita pela posição em relação à câmera
	UE_LOG(LogHoops, Log, TEXT("Som da quadra: %d variacoes sintetizadas em %.0f ms."), Built, (FPlatformTime::Seconds() - StartTime) * 1000.0);
}

// ============================================================================ Ganchos

UHoopsAudioSubsystem* UHoopsAudioSubsystem::Get(const UObject* WorldContext)
{
	const UWorld* ThisWorld = WorldContext ? WorldContext->GetWorld() : nullptr;
	return ThisWorld && ThisWorld->IsGameWorld() ? ThisWorld->GetSubsystem<UHoopsAudioSubsystem>() : nullptr;
}

void UHoopsAudioSubsystem::PlayAt(const UObject* WorldContext, EHoopsSound Sound, const FVector& Location, float Intensity)
{
	if (UHoopsAudioSubsystem* Audio = Get(WorldContext))
	{
		Audio->Play(Sound, &Location, Intensity);
	}
}

void UHoopsAudioSubsystem::Play2D(const UObject* WorldContext, EHoopsSound Sound, float Volume)
{
	if (UHoopsAudioSubsystem* Audio = Get(WorldContext))
	{
		Audio->Play(Sound, nullptr, Volume);
	}
}

float UHoopsAudioSubsystem::BounceIntensity(double ImpactSpeed)
{
	return HoopsAudioTuning::ImpactToIntensity(ImpactSpeed, 8.5, 0.5f);
}

void UHoopsAudioSubsystem::NotifyDribbleArc(const UObject* WorldContext, const Hoops::DribbleArc& Arc, double ElapsedSeconds, double DeltaSeconds)
{
	if (ElapsedSeconds < Arc.DownSeconds || ElapsedSeconds - DeltaSeconds >= Arc.DownSeconds)
	{
		return; // o arco não passou pelo chão neste frame
	}
	// Velocidade no chão da descida de Hoops::DribbleArc::Evaluate (z0 - v0 t - g t²/2, chegando ao chão em Td).
	const double Down = FMath::Max(Arc.DownSeconds, 1e-3);
	const double ImpactSpeed = FMath::Max(0.0, Arc.StartPos.Z - Arc.FloorPos.Z) / Down + 0.5 * Arc.Gravity * Down;
	PlayAt(WorldContext, EHoopsSound::Bounce, HoopsUnits::ToUnreal(Arc.FloorPos), BounceIntensity(ImpactSpeed));
}

void UHoopsAudioSubsystem::PlaySqueak(const ACharacter* Character, float Intensity)
{
	if (!Character)
	{
		return;
	}
	const UCapsuleComponent* Capsule = Character->GetCapsuleComponent();
	const double FeetOffset = Capsule ? static_cast<double>(Capsule->GetScaledCapsuleHalfHeight()) : 90.0;
	PlayAt(Character, EHoopsSound::Squeak, Character->GetActorLocation() - FVector(0.0, 0.0, FeetOffset), FMath::Clamp(Intensity, 0.0f, 1.0f));
}

void UHoopsAudioSubsystem::PlayLandingSqueak(const ACharacter* Character, float Intensity)
{
	UHoopsAudioSubsystem* Audio = Character ? Get(Character) : nullptr;
	UWorld* ThisWorld = Audio ? Audio->GetWorld() : nullptr;
	if (!ThisWorld)
	{
		return;
	}

	double Delay = HoopsAudioTuning::LandingFallbackSeconds;
	const UCharacterMovementComponent* Movement = Character->GetCharacterMovement();
	const UCapsuleComponent* Capsule = Character->GetCapsuleComponent();
	if (Movement && Capsule && Movement->IsFalling())
	{
		// Capsule no ar: tempo até os pés chegarem ao chão (Z = 0, o mesmo chão da física da bola).
		const double Gravity = FMath::Max(1.0, -static_cast<double>(Movement->GetGravityZ()));
		const double Height = FMath::Max(0.0, Character->GetActorLocation().Z - static_cast<double>(Capsule->GetScaledCapsuleHalfHeight()));
		const double Vz = Movement->Velocity.Z;
		Delay = FMath::Clamp((Vz + FMath::Sqrt(Vz * Vz + 2.0 * Gravity * Height)) / Gravity, 0.05, 1.5);
	}

	TWeakObjectPtr<const ACharacter> WeakCharacter(Character);
	FTimerHandle Handle;
	ThisWorld->GetTimerManager().SetTimer(Handle, FTimerDelegate::CreateWeakLambda(Audio, [WeakCharacter, Intensity]()
	{
		PlaySqueak(WeakCharacter.Get(), Intensity);
	}), static_cast<float>(Delay), false);
}

// ============================================================================ Tocar

const FHoopsAudioMix& UHoopsAudioSubsystem::CurrentMix() const
{
	static const FHoopsAudioMix Defaults;
	const AHoopsPlayerCharacter* Player = Cast<AHoopsPlayerCharacter>(UGameplayStatics::GetPlayerPawn(this, 0));
	return Player ? Player->AudioMix : Defaults;
}

float UHoopsAudioSubsystem::DistanceGain(const FVector& Location, float Falloff) const
{
	const APlayerCameraManager* CameraManager = UGameplayStatics::GetPlayerCameraManager(this, 0);
	if (!CameraManager || Falloff <= 0.0f)
	{
		return 1.0f;
	}
	const double Distance = FVector::Dist(CameraManager->GetCameraLocation(), Location);
	const float Ratio = static_cast<float>(HoopsAudioTuning::FullVolumeDistanceCm / FMath::Max(Distance, HoopsAudioTuning::FullVolumeDistanceCm));
	return FMath::Max(0.25f, FMath::Pow(Ratio, Falloff));
}

void UHoopsAudioSubsystem::PruneVoices(double AudioNow, int32 MaxActive)
{
	for (int32 Index = Voices.Num() - 1; Index >= 0; --Index)
	{
		UAudioComponent* Component = Voices[Index].Component.Get();
		const bool bValid = IsValid(Component);
		if (!bValid || AudioNow >= Voices[Index].StopTime)
		{
			if (bValid)
			{
				Component->Stop(); // a onda procedural nem sempre termina sozinha: para no fim do PCM
			}
			Voices.RemoveAt(Index);
		}
	}
	// Sons demais ao mesmo tempo: corta os mais antigos.
	while (Voices.Num() > FMath::Max(0, MaxActive))
	{
		UAudioComponent* Oldest = Voices[0].Component.Get();
		if (IsValid(Oldest))
		{
			Oldest->Stop();
		}
		Voices.RemoveAt(0);
	}
}

void UHoopsAudioSubsystem::Play(EHoopsSound Sound, const FVector* Location, float Volume)
{
	UWorld* ThisWorld = GetWorld();
	if (!ThisWorld || Sound >= EHoopsSound::Count || Volume <= 0.0f)
	{
		return;
	}
	const FHoopsAudioMix& Mix = CurrentMix();
	if (Mix.bMute)
	{
		return;
	}
	BuildBank();

	// Cesta logo depois de tocar o aro: rede abafada (a bola perdeu velocidade e cai mexendo a rede).
	if (Sound == EHoopsSound::RimClank)
	{
		LastRimTime = ThisWorld->GetTimeSeconds();
	}
	else if (Sound == EHoopsSound::Swish && ThisWorld->GetTimeSeconds() - LastRimTime < HoopsAudioTuning::SoftNetAfterRimSeconds)
	{
		Sound = EHoopsSound::NetSoft;
	}

	const int32 Kind = static_cast<int32>(Sound);
	const HoopsAudioTuning::FSoundTuning& Tuning = HoopsAudioTuning::Sounds[Kind];
	const double AudioNow = ThisWorld->GetAudioTimeSeconds();
	if (AudioNow - LastPlayTime[Kind] < Tuning.MinInterval)
	{
		return;
	}

	float Gain = Mix.MasterVolume * HoopsAudioTuning::CategoryVolume(Mix, Sound) * Volume;
	if (Location)
	{
		Gain *= DistanceGain(*Location, Mix.DistanceFalloff);
	}
	Gain *= 1.0f + Random.FRandRange(-Tuning.VolumeJitter, Tuning.VolumeJitter);
	if (Gain < 0.01f)
	{
		return;
	}

	// Variação sorteada, sem repetir a anterior (o mesmo som duas vezes seguidas soa como "metralhadora").
	const int32 NumVariants = FMath::Min(HoopsSynth::NumVariants(Sound), HoopsSynth::MaxVariants);
	if (NumVariants <= 0)
	{
		return;
	}
	int32 Variant = Random.RandRange(0, NumVariants - 1);
	if (NumVariants > 1 && Variant == LastVariant[Kind])
	{
		Variant = (Variant + 1 + Random.RandRange(0, NumVariants - 2)) % NumVariants;
	}
	const FHoopsAudioPcm& Pcm = Bank[Kind * HoopsSynth::MaxVariants + Variant];
	if (Pcm.Samples.Num() == 0)
	{
		return;
	}
	const float Pitch = 1.0f + Random.FRandRange(-Tuning.PitchJitter, Tuning.PitchJitter);

	PruneVoices(AudioNow, HoopsAudioTuning::MaxVoices - 1);

	// Onda nova por toque: o áudio enfileirado é consumido uma vez só.
	USoundWaveProcedural* Wave = NewObject<USoundWaveProcedural>(this);
	Wave->SetSampleRate(HoopsSynth::SampleRateHz);
	Wave->NumChannels = 1;
	Wave->Duration = Pcm.Seconds;
	Wave->SoundGroup = SOUNDGROUP_Default;
	Wave->bLooping = false;
	Wave->QueueAudio(reinterpret_cast<const uint8*>(Pcm.Samples.GetData()), Pcm.Samples.Num() * static_cast<int32>(sizeof(int16)));

	UAudioComponent* Component = Location
		? UGameplayStatics::SpawnSoundAtLocation(this, Wave, *Location, FRotator::ZeroRotator, Gain, Pitch, 0.0f, Attenuation)
		: UGameplayStatics::SpawnSound2D(this, Wave, Gain, Pitch);
	if (!Component)
	{
		return; // sem áudio (servidor, -nosound)
	}
	FHoopsAudioVoice& Voice = Voices.AddDefaulted_GetRef();
	Voice.Component = Component;
	Voice.Wave = Wave;
	Voice.StopTime = AudioNow + static_cast<double>(Pcm.Seconds / Pitch) + HoopsAudioTuning::StopMarginSeconds;
	LastPlayTime[Kind] = AudioNow;
	LastVariant[Kind] = Variant;
}

// ============================================================================ Bola livre

void FHoopsBallContactAudio::Add(const Hoops::BallTickEvents& Events, const Hoops::BallState& Before, const Hoops::BallState& After, double TickSeconds, double Gravity)
{
	if (Events.HitFloor)
	{
		FloorSpeed = FMath::Max(FloorSpeed, Events.FloorImpactSpeed);
	}
	if (Events.HitRim || Events.HitBackboard)
	{
		// Variação de velocidade do tick sem a gravidade = impulso do contato.
		const Hoops::Vec3 Change = After.Velocity - Before.Velocity + Hoops::Vec3(0.0, 0.0, Gravity * TickSeconds);
		const double Impulse = Change.Length();
		RimImpulse = Events.HitRim ? FMath::Max(RimImpulse, Impulse) : RimImpulse;
		BoardImpulse = Events.HitBackboard ? FMath::Max(BoardImpulse, Impulse) : BoardImpulse;
	}
	bScored = bScored || Events.Scored;
}

void FHoopsBallContactAudio::Play(const UObject* WorldContext, const FVector& Location) const
{
	// Bola rolando/assentando no aro dá impulsos pequenos a cada tick: só batidas de verdade fazem som.
	if (RimImpulse > 0.6)
	{
		UHoopsAudioSubsystem::PlayAt(WorldContext, EHoopsSound::RimClank, Location, HoopsAudioTuning::ImpactToIntensity(RimImpulse, 10.0, 0.75f));
	}
	if (BoardImpulse > 0.6)
	{
		UHoopsAudioSubsystem::PlayAt(WorldContext, EHoopsSound::Backboard, Location, HoopsAudioTuning::ImpactToIntensity(BoardImpulse, 8.0, 0.75f));
	}
	if (bScored)
	{
		UHoopsAudioSubsystem::PlayAt(WorldContext, EHoopsSound::Swish, Location); // depois do aro vira rede abafada
	}
	if (FloorSpeed > 0.5)
	{
		UHoopsAudioSubsystem::PlayAt(WorldContext, EHoopsSound::Bounce, Location, UHoopsAudioSubsystem::BounceIntensity(FloorSpeed));
	}
}
