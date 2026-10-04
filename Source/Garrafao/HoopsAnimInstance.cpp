#include "HoopsAnimInstance.h"

#include "Animation/AnimNodeBase.h"
#include "Animation/AnimSequence.h"
#include "AnimationRuntime.h"

namespace
{
	float StepWeight(float Weight, float Target, float BlendTime, float DeltaSeconds)
	{
		const float Step = BlendTime > UE_KINDA_SMALL_NUMBER ? DeltaSeconds / BlendTime : 1.0f;
		return Weight < Target ? FMath::Min(Target, Weight + Step) : FMath::Max(Target, Weight - Step);
	}

	float SequenceLength(const UAnimSequence* Sequence)
	{
		return Sequence ? static_cast<float>(Sequence->GetPlayLength()) : 0.0f;
	}
}

// ============================================================================ Instância (game thread)

UAnimSequence* UHoopsAnimInstance::GetCurrentBase() const
{
	return Bases.Num() > 0 ? Bases.Last().Sequence.Get() : nullptr;
}

void UHoopsAnimInstance::SetBase(UAnimSequence* Sequence, float PlayRate, float BlendTime, bool bKeepPhase)
{
	if (!Sequence)
	{
		return;
	}
	if (Bases.Num() > 0 && Bases.Last().Sequence == Sequence)
	{
		Bases.Last().PlayRate = PlayRate;
		return;
	}

	FHoopsAnimLayer Layer;
	Layer.Sequence = Sequence;
	Layer.PlayRate = PlayRate;
	Layer.bLooping = true;
	Layer.BlendTime = BlendTime;
	Layer.TargetWeight = 1.0f;
	Layer.Weight = Bases.Num() == 0 ? 1.0f : 0.0f;
	if (bKeepPhase && Bases.Num() > 0)
	{
		const FHoopsAnimLayer& Previous = Bases.Last();
		const float PrevLength = SequenceLength(Previous.Sequence);
		const float Phase = PrevLength > UE_KINDA_SMALL_NUMBER ? Previous.Time / PrevLength : 0.0f;
		Layer.Time = Phase * SequenceLength(Sequence);
	}

	for (FHoopsAnimLayer& Old : Bases)
	{
		Old.TargetWeight = 0.0f;
		Old.BlendTime = BlendTime;
	}
	Bases.Add(Layer);
	// Limita o número de camadas saindo ao mesmo tempo.
	while (Bases.Num() > 3)
	{
		Bases.RemoveAt(0);
	}
}

void UHoopsAnimInstance::PlayAction(UAnimSequence* Sequence, float StartTime, float PlayRate, float BlendIn, float EndTime)
{
	if (!Sequence)
	{
		return;
	}
	Action.Sequence = Sequence;
	Action.Time = FMath::Clamp(StartTime, 0.0f, SequenceLength(Sequence));
	Action.PlayRate = PlayRate;
	Action.bLooping = false;
	Action.BlendTime = BlendIn;
	Action.TargetWeight = 1.0f;
	Action.EndTime = EndTime;
	if (!bActionActive)
	{
		Action.Weight = 0.0f;
	}
	bActionActive = true;
}

void UHoopsAnimInstance::StopAction(float BlendOut)
{
	if (bActionActive)
	{
		Action.TargetWeight = 0.0f;
		Action.BlendTime = BlendOut;
	}
}

void UHoopsAnimInstance::PlayUpperBody(UAnimSequence* Sequence, float StartTime, float PlayRate, float BlendIn, float HoldSeconds, float BlendOut)
{
	if (!Sequence)
	{
		return;
	}
	Upper.Sequence = Sequence;
	Upper.Time = FMath::Clamp(StartTime, 0.0f, SequenceLength(Sequence));
	Upper.PlayRate = PlayRate;
	Upper.bLooping = false;
	Upper.bUpperBodyOnly = true;
	Upper.BlendTime = BlendIn;
	Upper.TargetWeight = 1.0f;
	if (!bUpperActive)
	{
		Upper.Weight = 0.0f;
	}
	UpperElapsed = 0.0f;
	UpperHoldSeconds = HoldSeconds;
	UpperBlendOut = BlendOut;
	bUpperActive = true;
}

void UHoopsAnimInstance::StopUpperBody(float BlendOut)
{
	if (bUpperActive)
	{
		Upper.TargetWeight = 0.0f;
		Upper.BlendTime = BlendOut;
	}
}

void UHoopsAnimInstance::NativeUpdateAnimation(float DeltaSeconds)
{
	Super::NativeUpdateAnimation(DeltaSeconds);

	for (FHoopsAnimLayer& Layer : Bases)
	{
		const float Length = SequenceLength(Layer.Sequence);
		if (Length > UE_KINDA_SMALL_NUMBER)
		{
			Layer.Time = FMath::Fmod(Layer.Time + DeltaSeconds * Layer.PlayRate, Length);
			if (Layer.Time < 0.0f)
			{
				Layer.Time += Length;
			}
		}
		Layer.Weight = StepWeight(Layer.Weight, Layer.TargetWeight, Layer.BlendTime, DeltaSeconds);
	}
	Bases.RemoveAll([](const FHoopsAnimLayer& Layer) { return Layer.TargetWeight <= 0.0f && Layer.Weight <= 0.001f; });

	if (bActionActive)
	{
		const float Length = SequenceLength(Action.Sequence);
		const float End = Action.EndTime > 0.0f ? FMath::Min(Action.EndTime, Length) : Length;
		Action.Time = FMath::Min(Action.Time + DeltaSeconds * Action.PlayRate, Length);
		if (Action.Time >= End - Action.BlendTime * Action.PlayRate && Action.TargetWeight > 0.0f)
		{
			Action.TargetWeight = 0.0f; // sai sozinho no fim
		}
		Action.Weight = StepWeight(Action.Weight, Action.TargetWeight, Action.BlendTime, DeltaSeconds);
		if (Action.TargetWeight <= 0.0f && Action.Weight <= 0.001f)
		{
			bActionActive = false;
		}
	}

	if (bUpperActive)
	{
		const float Length = SequenceLength(Upper.Sequence);
		Upper.Time = FMath::Clamp(Upper.Time + DeltaSeconds * Upper.PlayRate, 0.0f, Length);
		UpperElapsed += DeltaSeconds;
		if (UpperElapsed >= UpperHoldSeconds && Upper.TargetWeight > 0.0f)
		{
			Upper.TargetWeight = 0.0f;
			Upper.BlendTime = UpperBlendOut;
		}
		Upper.Weight = StepWeight(Upper.Weight, Upper.TargetWeight, Upper.BlendTime, DeltaSeconds);
		if (Upper.TargetWeight <= 0.0f && Upper.Weight <= 0.001f)
		{
			bUpperActive = false;
		}
	}

	// Entrega as camadas deste frame ao proxy (a avaliação roda depois, possivelmente em outra thread).
	TArray<FHoopsAnimLayer> Layers;
	GetEvaluationLayers(Layers);
	GetProxyOnGameThread<FHoopsAnimInstanceProxy>().SetLayers(MoveTemp(Layers));
}

void UHoopsAnimInstance::GetEvaluationLayers(TArray<FHoopsAnimLayer>& OutLayers) const
{
	OutLayers.Reset();
	const float ActionWeight = bActionActive ? Action.Weight : 0.0f;

	float BaseSum = 0.0f;
	for (const FHoopsAnimLayer& Layer : Bases)
	{
		BaseSum += Layer.Weight;
	}
	for (const FHoopsAnimLayer& Layer : Bases)
	{
		if (Layer.Weight <= 0.001f || BaseSum <= UE_KINDA_SMALL_NUMBER)
		{
			continue;
		}
		FHoopsAnimLayer& Copy = OutLayers.Add_GetRef(Layer);
		Copy.Weight = (Layer.Weight / BaseSum) * (1.0f - ActionWeight);
	}
	if (ActionWeight > 0.001f)
	{
		FHoopsAnimLayer& Copy = OutLayers.Add_GetRef(Action);
		Copy.Weight = ActionWeight;
	}
	if (bUpperActive && Upper.Weight > 0.001f)
	{
		OutLayers.Add(Upper); // bUpperBodyOnly: o proxy aplica por cima, só do tronco para cima
	}
}

FAnimInstanceProxy* UHoopsAnimInstance::CreateAnimInstanceProxy()
{
	return new FHoopsAnimInstanceProxy(this);
}

void UHoopsAnimInstance::DestroyAnimInstanceProxy(FAnimInstanceProxy* InProxy)
{
	delete static_cast<FHoopsAnimInstanceProxy*>(InProxy);
}

// ============================================================================ Proxy (thread de animação)

namespace
{
	// Amostra uma camada numa pose (mesmos ossos de Output).
	void SampleLayer(const FHoopsAnimLayer& Layer, FPoseContext& Context)
	{
		if (Layer.Sequence)
		{
			FAnimationPoseData PoseData(Context);
			const FAnimExtractContext Extract(static_cast<double>(Layer.Time), false, FDeltaTimeRecord(), Layer.bLooping);
			Layer.Sequence->GetAnimationPose(PoseData, Extract);
		}
		else
		{
			Context.ResetToRefPose();
		}
	}

	const FName UpperBodyRootBone(TEXT("spine_02"));
}

bool FHoopsAnimInstanceProxy::Evaluate(FPoseContext& Output)
{
	// 1) Corpo inteiro: bases + ação, misturadas por peso.
	TArray<const FHoopsAnimLayer*, TInlineAllocator<4>> FullBody;
	TArray<const FHoopsAnimLayer*, TInlineAllocator<4>> UpperBody;
	for (const FHoopsAnimLayer& Layer : EvalLayers)
	{
		(Layer.bUpperBodyOnly ? UpperBody : FullBody).Add(&Layer);
	}

	const int32 Count = FullBody.Num();
	float WeightSum = 0.0f;
	for (const FHoopsAnimLayer* Layer : FullBody)
	{
		WeightSum += Layer->Weight;
	}
	if (Count == 0 || WeightSum <= UE_KINDA_SMALL_NUMBER)
	{
		Output.ResetToRefPose();
	}
	else if (Count == 1)
	{
		SampleLayer(*FullBody[0], Output);
	}
	else
	{
		TArray<FCompactPose, TInlineAllocator<4>> Poses;
		TArray<FBlendedCurve, TInlineAllocator<4>> Curves;
		TArray<UE::Anim::FStackAttributeContainer, TInlineAllocator<4>> Attributes;
		TArray<float, TInlineAllocator<4>> Weights;
		Poses.SetNum(Count);
		Curves.SetNum(Count);
		Attributes.SetNum(Count);
		Weights.SetNum(Count);
		for (int32 Index = 0; Index < Count; ++Index)
		{
			FPoseContext LayerContext(Output);
			SampleLayer(*FullBody[Index], LayerContext);
			Poses[Index].MoveBonesFrom(LayerContext.Pose);
			Curves[Index].MoveFrom(LayerContext.Curve);
			Attributes[Index].MoveFrom(LayerContext.CustomAttributes);
			Weights[Index] = FullBody[Index]->Weight / WeightSum;
		}
		FAnimationPoseData OutData(Output);
		FAnimationRuntime::BlendPosesTogether(Poses, Curves, Attributes, Weights, OutData);
	}

	// 2) Tronco/braços por cima (spine_02 e tudo abaixo dele na hierarquia), em espaço local.
	if (UpperBody.Num() > 0)
	{
		const FBoneContainer& Bones = Output.Pose.GetBoneContainer();
		const int32 MeshRoot = Bones.GetReferenceSkeleton().FindBoneIndex(UpperBodyRootBone);
		if (MeshRoot != INDEX_NONE)
		{
			const FCompactPoseBoneIndex Root = Bones.MakeCompactPoseIndex(FMeshPoseBoneIndex(MeshRoot));
			TArray<bool, TInlineAllocator<64>> IsUpper;
			IsUpper.SetNumZeroed(Output.Pose.GetNumBones());
			for (const FHoopsAnimLayer* Layer : UpperBody)
			{
				FPoseContext UpperContext(Output);
				SampleLayer(*Layer, UpperContext);
				for (const FCompactPoseBoneIndex BoneIndex : Output.Pose.ForEachBoneIndex())
				{
					const FCompactPoseBoneIndex Parent = Bones.GetParentBoneIndex(BoneIndex);
					const bool bUpper = BoneIndex == Root || (Parent.IsValid() && IsUpper[Parent.GetInt()]);
					IsUpper[BoneIndex.GetInt()] = bUpper;
					if (bUpper)
					{
						Output.Pose[BoneIndex].BlendWith(UpperContext.Pose[BoneIndex], Layer->Weight);
					}
				}
			}
		}
	}
	return true;
}
