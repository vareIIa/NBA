#pragma once

#include "CoreMinimal.h"
#include "HoopsAudioSynth.h"
#include "HoopsSimCore/HoopsBallSim.h"
#include "HoopsSimCore/HoopsDribble.h"
#include "Engine/TimerHandle.h"
#include "Subsystems/WorldSubsystem.h"

#include "HoopsAudio.generated.h"

class ACharacter;
class UAudioComponent;
class USoundAttenuation;
class USoundWaveProcedural;

// Volumes do som da quadra. Ficam no jogador (Hoops|Audio) e dá para mexer durante o Play.
USTRUCT()
struct FHoopsAudioMix
{
	GENERATED_BODY()

	// Desliga todos os sons sintetizados (quique, rede, aro/tabela, tênis e o "ding" do green).
	UPROPERTY(EditAnywhere, Category = "Hoops|Audio")
	bool bMute = false;

	UPROPERTY(EditAnywhere, Category = "Hoops|Audio", meta = (ClampMin = "0.0", ClampMax = "2.0"))
	float MasterVolume = 1.0f;

	// Quique da bola (drible e bola solta). O volume também segue a velocidade do impacto.
	UPROPERTY(EditAnywhere, Category = "Hoops|Audio", meta = (ClampMin = "0.0", ClampMax = "2.0"))
	float BallVolume = 1.0f;

	// Rede (cesta limpa ou depois do aro).
	UPROPERTY(EditAnywhere, Category = "Hoops|Audio", meta = (ClampMin = "0.0", ClampMax = "2.0"))
	float NetVolume = 0.8f;

	// Aro e tabela.
	UPROPERTY(EditAnywhere, Category = "Hoops|Audio", meta = (ClampMin = "0.0", ClampMax = "2.0"))
	float RimVolume = 0.8f;

	// Chiado do tênis (gather, cortes do drible, aterrissagem).
	UPROPERTY(EditAnywhere, Category = "Hoops|Audio", meta = (ClampMin = "0.0", ClampMax = "2.0"))
	float ShoesVolume = 0.7f;

	// Queda com a distância até a câmera, a partir de 12 m: 0 = nenhuma, 1 = -6 dB cada vez que a distância dobra.
	UPROPERTY(EditAnywhere, Category = "Hoops|Audio", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float DistanceFalloff = 0.6f;
};

// Um som tocando. As referências seguram a onda e o componente até o som acabar (sem o GC no meio).
USTRUCT()
struct FHoopsAudioVoice
{
	GENERATED_BODY()

	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> Component;

	UPROPERTY(Transient)
	TObjectPtr<USoundWaveProcedural> Wave;

	double StopTime = 0.0; // tempo de áudio do mundo em que o som já terminou
};

// PCM pronto de uma variação (mono, 16 bits, 44,1 kHz).
struct FHoopsAudioPcm
{
	TArray<int16> Samples;
	float Seconds = 0.0f;
};

// Sons da quadra sintetizados em código, sem assets nem áudio de terceiros (docs/17 §1.4, §6.1 P0-3).
// Os PCMs saem de HoopsAudioSynth no começo da partida. Cada toque cria uma USoundWaveProcedural nova com
// esse PCM (o áudio enfileirado numa onda procedural é consumido uma vez só) e a para no fim da duração.
// Os ganchos são estáticos: uma linha em quem chama, e sem mundo de jogo não fazem nada.
UCLASS()
class GARRAFAO_API UHoopsAudioSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	// Som no mundo. Intensity (0..1) multiplica o volume da categoria.
	static void PlayAt(const UObject* WorldContext, EHoopsSound Sound, const FVector& Location, float Intensity = 1.0f);
	// Som sem posição (o "ding" do green). Volume é o multiplicador (o de categoria vem de quem chama).
	static void Play2D(const UObject* WorldContext, EHoopsSound Sound, float Volume = 1.0f);
	// Quique do drible: toca no frame em que o arco passa pelo chão (DownSeconds entre Elapsed - Delta e Elapsed).
	// ArcToWorld: o arco do drible com o boneco é calculado no referencial do jogador (passe GetActorTransform()).
	static void NotifyDribbleArc(const UObject* WorldContext, const Hoops::DribbleArc& Arc, double ElapsedSeconds, double DeltaSeconds,
		const FTransform& ArcToWorld = FTransform::Identity);
	// Chiado do tênis nos pés do jogador, agora.
	static void PlaySqueak(const ACharacter* Character, float Intensity);
	// ... na aterrissagem prevista: capsule no ar = queda balística até o chão; no chão (o pulo do jumper com o
	// boneco está na animação) = 0,25 s depois da soltura (docs/17 §1.1: +150 a +300 ms).
	static void PlayLandingSqueak(const ACharacter* Character, float Intensity);
	// Volume (0..1) pela velocidade do impacto no chão (m/s): ~0,7–0,9 no drible, 1 numa bola caindo do aro.
	static float BounceIntensity(double ImpactSpeed);

private:
	static UHoopsAudioSubsystem* Get(const UObject* WorldContext);
	void BuildBank();
	void Play(EHoopsSound Sound, const FVector* Location, float Volume);
	void PruneVoices(double AudioNow, int32 MaxActive);
	const FHoopsAudioMix& CurrentMix() const;
	float DistanceGain(const FVector& Location, float Falloff) const;

	TArray<FHoopsAudioPcm> Bank; // índice = som * HoopsSynth::MaxVariants + variação
	bool bBankReady = false;

	UPROPERTY(Transient)
	TArray<FHoopsAudioVoice> Voices;

	// Só espacializa (pan pela posição em relação à câmera); a queda com a distância é a de DistanceGain.
	UPROPERTY(Transient)
	TObjectPtr<USoundAttenuation> Attenuation;

	FRandomStream Random;
	FTimerHandle PruneTimer;
	TArray<double> LastPlayTime; // por som (tempo de áudio): evita metralhadora
	TArray<int32> LastVariant;   // por som: não repete a mesma variação duas vezes seguidas
	double LastRimTime = -100.0; // tempo do mundo do último toque no aro (cesta logo depois = rede abafada)
};

// Batidas da bola livre num frame (vários ticks fixos do núcleo). Toca no fim do frame, no máximo uma de cada.
struct FHoopsBallContactAudio
{
	double FloorSpeed = 0.0;   // m/s, a batida mais forte no chão
	double RimImpulse = 0.0;   // m/s: variação de velocidade no contato (o núcleo só diz que bateu)
	double BoardImpulse = 0.0;
	bool bScored = false;

	void Add(const Hoops::BallTickEvents& Events, const Hoops::BallState& Before, const Hoops::BallState& After, double TickSeconds, double Gravity);
	void Play(const UObject* WorldContext, const FVector& Location) const;
};
