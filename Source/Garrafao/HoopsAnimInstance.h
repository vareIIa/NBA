#pragma once

#include "CoreMinimal.h"
#include "Animation/AnimInstance.h"
#include "Animation/AnimInstanceProxy.h"

#include "HoopsAnimInstance.generated.h"

class UAnimSequence;

// Uma camada de animação: loop de base (locomoção/drible) ou ação one-shot (arremesso).
USTRUCT()
struct FHoopsAnimLayer
{
	GENERATED_BODY()

	UPROPERTY(Transient)
	TObjectPtr<UAnimSequence> Sequence = nullptr;

	float Time = 0.0f;
	float PlayRate = 1.0f;
	float Weight = 0.0f;       // peso atual (já normalizado na avaliação)
	float TargetWeight = 1.0f;
	float BlendTime = 0.2f;    // segundos para ir de 0 a 1
	float EndTime = -1.0f;     // ações: quando começar a sair (-1 = fim do clipe)
	bool bLooping = true;
};

// Proxy que avalia as camadas na thread de animação: amostra cada sequência e mistura por peso.
// É um "anim graph em código": sem Animation Blueprint, para o projeto não depender de assets binários.
USTRUCT()
struct FHoopsAnimInstanceProxy : public FAnimInstanceProxy
{
	GENERATED_BODY()

public:
	FHoopsAnimInstanceProxy() = default;
	explicit FHoopsAnimInstanceProxy(UAnimInstance* InAnimInstance) : FAnimInstanceProxy(InAnimInstance) {}

	// Chamado na game thread (fim do NativeUpdateAnimation), antes da avaliação deste frame.
	void SetLayers(TArray<FHoopsAnimLayer>&& InLayers) { EvalLayers = MoveTemp(InLayers); }

	virtual bool Evaluate(FPoseContext& Output) override;

private:
	TArray<FHoopsAnimLayer> EvalLayers;
};

// AnimInstance nativa do jogador (usada com o boneco SK_HoopsDummy). O personagem decide QUAL animação e
// a que velocidade; aqui só se cuida de tempo, crossfade e mistura.
UCLASS(Transient, NotBlueprintable)
class GARRAFAO_API UHoopsAnimInstance : public UAnimInstance
{
	GENERATED_BODY()

public:
	// Troca o loop de base com crossfade. bKeepPhase mantém a fase do ciclo (ex.: drible direita → esquerda).
	void SetBase(UAnimSequence* Sequence, float PlayRate, float BlendTime, bool bKeepPhase);

	// Toca uma ação (one-shot) por cima da base, a partir de StartTime. EndTime < 0 = até o fim do clipe.
	void PlayAction(UAnimSequence* Sequence, float StartTime, float PlayRate, float BlendIn, float EndTime = -1.0f);
	void StopAction(float BlendOut);

	bool IsActionActive() const { return bActionActive; }
	float GetActionTime() const { return Action.Time; }
	UAnimSequence* GetCurrentBase() const;

	// Pesos finais (ação por cima, bases normalizadas no resto), lidos pelo proxy.
	void GetEvaluationLayers(TArray<FHoopsAnimLayer>& OutLayers) const;

protected:
	virtual void NativeUpdateAnimation(float DeltaSeconds) override;
	virtual FAnimInstanceProxy* CreateAnimInstanceProxy() override;
	virtual void DestroyAnimInstanceProxy(FAnimInstanceProxy* InProxy) override;

private:
	UPROPERTY(Transient)
	TArray<FHoopsAnimLayer> Bases; // a última é a atual; as anteriores saem por crossfade

	UPROPERTY(Transient)
	FHoopsAnimLayer Action;

	bool bActionActive = false;
};
