#include "HoopsAnimInstance.h"

#include "Animation/AnimNodeBase.h"
#include "Animation/AnimSequence.h"
#include "AnimationRuntime.h"
#include "TwoBoneIK.h"

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
	// A ação que estava tocando sai por crossfade em vez de ser trocada de uma vez.
	if (bActionActive && Action.Weight > 0.01f)
	{
		FadingAction = Action;
		FadingAction.TargetWeight = 0.0f;
		FadingAction.BlendTime = FMath::Max(0.05f, BlendIn);
		bFadingActive = true;
		Action.Weight = 0.0f;
	}
	ActionHoldTime = -1.0f;
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

void UHoopsAnimInstance::SetStanceTarget(float CrouchCm, float LeanForwardDeg, float LeanRightDeg, const FVector& MeshForward)
{
	StanceTarget.CrouchCm = CrouchCm;
	StanceTarget.LeanForwardDeg = LeanForwardDeg;
	StanceTarget.LeanRightDeg = LeanRightDeg;
	StanceTarget.MeshForward = MeshForward.GetSafeNormal2D();
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
		float NextTime = Action.Time + DeltaSeconds * Action.PlayRate;
		if (ActionHoldTime >= 0.0f)
		{
			NextTime = FMath::Min(NextTime, ActionHoldTime); // segurando (ex.: mão no topo até soltar o X)
		}
		Action.Time = FMath::Min(NextTime, Length);
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

	if (bFadingActive)
	{
		FadingAction.Time = FMath::Min(FadingAction.Time + DeltaSeconds * FadingAction.PlayRate, SequenceLength(FadingAction.Sequence));
		FadingAction.Weight = StepWeight(FadingAction.Weight, 0.0f, FadingAction.BlendTime, DeltaSeconds);
		bFadingActive = FadingAction.Weight > 0.001f;
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

	// Postura: segue o alvo suavemente (sem trancos ao trocar de drible/corrida).
	Stance.CrouchCm = FMath::FInterpTo(Stance.CrouchCm, StanceTarget.CrouchCm, DeltaSeconds, 8.0f);
	Stance.LeanForwardDeg = FMath::FInterpTo(Stance.LeanForwardDeg, StanceTarget.LeanForwardDeg, DeltaSeconds, 6.0f);
	Stance.LeanRightDeg = FMath::FInterpTo(Stance.LeanRightDeg, StanceTarget.LeanRightDeg, DeltaSeconds, 6.0f);
	Stance.MeshForward = StanceTarget.MeshForward.IsNearlyZero() ? FVector::ForwardVector : StanceTarget.MeshForward;

	// Entrega as camadas deste frame ao proxy (a avaliação roda depois, possivelmente em outra thread).
	TArray<FHoopsAnimLayer> Layers;
	GetEvaluationLayers(Layers);
	GetProxyOnGameThread<FHoopsAnimInstanceProxy>().SetLayers(MoveTemp(Layers), Stance);
}

void UHoopsAnimInstance::GetEvaluationLayers(TArray<FHoopsAnimLayer>& OutLayers) const
{
	OutLayers.Reset();
	const float CurrentWeight = bActionActive ? Action.Weight : 0.0f;
	const float FadingWeight = bFadingActive ? FadingAction.Weight : 0.0f;
	const float ActionWeight = FMath::Min(1.0f, CurrentWeight + FadingWeight);

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
	if (FadingWeight > 0.001f)
	{
		OutLayers.Add(FadingAction);
	}
	if (CurrentWeight > 0.001f)
	{
		OutLayers.Add(Action);
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
	const FName BonePelvis(TEXT("pelvis"));
	const FName BoneSpine01(TEXT("spine_01"));
	const FName BoneThighL(TEXT("thigh_l"));
	const FName BoneCalfL(TEXT("calf_l"));
	const FName BoneFootL(TEXT("foot_l"));
	const FName BoneThighR(TEXT("thigh_r"));
	const FName BoneCalfR(TEXT("calf_r"));
	const FName BoneFootR(TEXT("foot_r"));
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

	// 3) Postura atlética (quadril baixo + IK das pernas + inclinação do tronco).
	ApplyStance(Output);
	return true;
}

void FHoopsAnimInstanceProxy::ApplyStance(FPoseContext& Output) const
{
	if (Stance.CrouchCm < 0.1f && FMath::Abs(Stance.LeanForwardDeg) < 0.1f && FMath::Abs(Stance.LeanRightDeg) < 0.1f)
	{
		return;
	}
	const FBoneContainer& Bones = Output.Pose.GetBoneContainer();
	const auto FindBone = [&Bones](const FName& Name)
	{
		const int32 MeshIndex = Bones.GetReferenceSkeleton().FindBoneIndex(Name);
		return MeshIndex == INDEX_NONE ? FCompactPoseBoneIndex(INDEX_NONE) : Bones.MakeCompactPoseIndex(FMeshPoseBoneIndex(MeshIndex));
	};
	const FCompactPoseBoneIndex Pelvis = FindBone(BonePelvis);
	const FCompactPoseBoneIndex Spine = FindBone(BoneSpine01);
	const FCompactPoseBoneIndex Legs[2][3] = {
		{FindBone(BoneThighL), FindBone(BoneCalfL), FindBone(BoneFootL)},
		{FindBone(BoneThighR), FindBone(BoneCalfR), FindBone(BoneFootR)},
	};
	if (!Pelvis.IsValid() || !Spine.IsValid())
	{
		return;
	}
	for (const auto& Leg : Legs)
	{
		if (!Leg[0].IsValid() || !Leg[1].IsValid() || !Leg[2].IsValid())
		{
			return;
		}
	}

	FCSPose<FCompactPose> CSPose;
	CSPose.InitPose(Output.Pose);
	const FVector Up = FVector::UpVector;
	const FVector Forward = Stance.MeshForward;
	const FVector Right = FVector::CrossProduct(Up, Forward);

	// Onde os pés estavam (ficam plantados).
	const FTransform FeetBefore[2] = {CSPose.GetComponentSpaceTransform(Legs[0][2]), CSPose.GetComponentSpaceTransform(Legs[1][2])};

	// Quadril desce.
	if (Stance.CrouchCm >= 0.1f)
	{
		FTransform PelvisCS = CSPose.GetComponentSpaceTransform(Pelvis);
		PelvisCS.AddToTranslation(FVector(0.0, 0.0, -Stance.CrouchCm));
		const FBoneTransform PelvisChange[] = {FBoneTransform(Pelvis, PelvisCS)};
		CSPose.SafeSetCSBoneTransforms(MakeArrayView(PelvisChange));
	}

	// Tronco inclina (gira o spine_01 em torno de si, no espaço da malha; braços e cabeça vão junto).
	if (FMath::Abs(Stance.LeanForwardDeg) >= 0.1f || FMath::Abs(Stance.LeanRightDeg) >= 0.1f)
	{
		// Girar em torno de Right com ângulo positivo leva o "cima" para a frente; em torno de Forward, para a esquerda.
		const FQuat Lean = FQuat(Right, FMath::DegreesToRadians(static_cast<double>(Stance.LeanForwardDeg))) *
			FQuat(Forward, FMath::DegreesToRadians(-static_cast<double>(Stance.LeanRightDeg)));
		FTransform SpineCS = CSPose.GetComponentSpaceTransform(Spine);
		SpineCS.SetRotation(Lean * SpineCS.GetRotation());
		const FBoneTransform SpineChange[] = {FBoneTransform(Spine, SpineCS)};
		CSPose.SafeSetCSBoneTransforms(MakeArrayView(SpineChange));
	}

	// IK das pernas: com o quadril mais baixo, os joelhos dobram para os pés voltarem ao lugar.
	if (Stance.CrouchCm >= 0.1f)
	{
		for (int32 Side = 0; Side < 2; ++Side)
		{
			FTransform Thigh = CSPose.GetComponentSpaceTransform(Legs[Side][0]);
			FTransform Calf = CSPose.GetComponentSpaceTransform(Legs[Side][1]);
			FTransform Foot = CSPose.GetComponentSpaceTransform(Legs[Side][2]);
			// Joelho segue a dobra que a animação já tem (alinhado com a ponta do pé), puxado para a frente e um pouco
			// para fora (base larga).
			const FVector HipToFoot = (Foot.GetLocation() - Thigh.GetLocation()).GetSafeNormal();
			const FVector AnimBend = FVector::VectorPlaneProject(Calf.GetLocation() - Thigh.GetLocation(), HipToFoot);
			const FVector BendDir = AnimBend.SizeSquared() > 4.0 ? AnimBend.GetSafeNormal() : Forward;
			const FVector KneeTarget = Calf.GetLocation() + (BendDir + Forward) * 30.0 + Right * (Side == 0 ? -15.0 : 15.0);
			AnimationCore::SolveTwoBoneIK(Thigh, Calf, Foot, KneeTarget, FeetBefore[Side].GetLocation(), false, 1.0, 1.0);
			Foot.SetRotation(FeetBefore[Side].GetRotation());
			const FBoneTransform LegChange[] = {
				FBoneTransform(Legs[Side][0], Thigh), FBoneTransform(Legs[Side][1], Calf), FBoneTransform(Legs[Side][2], Foot)};
			CSPose.SafeSetCSBoneTransforms(MakeArrayView(LegChange));
		}
	}

	FCSPose<FCompactPose>::ConvertComponentPosesToLocalPosesSafe(CSPose, Output.Pose);
}
