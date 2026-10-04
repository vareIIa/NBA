#include "HoopsDummyRig.h"

#include "Animation/AnimSequence.h"
#include "AssetRegistry/AssetData.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetRegistry/IAssetRegistry.h"
#include "Engine/SkeletalMesh.h"
#include "Garrafao.h"
#include "Modules/ModuleManager.h"
#include "ReferenceSkeleton.h"

namespace
{
	struct FClipInfo
	{
		const TCHAR* Name;
		FVector2D Velocity; // cm/s: X = frente, Y = direita (Tools/Animacao/README.md)
		EHoopsClip Fallback;
	};

	// Mesma ordem do enum.
	const FClipInfo Clips[] = {
		{TEXT("Hold_Idle"), FVector2D(0.0, 0.0), EHoopsClip::HoldIdle},
		{TEXT("Walk"), FVector2D(105.0, 0.0), EHoopsClip::HoldIdle},
		{TEXT("Run"), FVector2D(414.0, 0.0), EHoopsClip::Walk},
		{TEXT("Dribble_Idle_R"), FVector2D(0.0, 0.0), EHoopsClip::HoldIdle},
		{TEXT("Dribble_Idle_L"), FVector2D(0.0, 0.0), EHoopsClip::DribbleIdleR},
		{TEXT("Dribble_Walk_R"), FVector2D(133.0, 0.0), EHoopsClip::DribbleIdleR},
		{TEXT("Dribble_Walk_L"), FVector2D(142.0, 0.0), EHoopsClip::DribbleIdleL},
		{TEXT("Dribble_Run_R"), FVector2D(414.0, 0.0), EHoopsClip::DribbleWalkR},
		{TEXT("Dribble_Run_L"), FVector2D(414.0, 0.0), EHoopsClip::DribbleWalkL},
		{TEXT("Dribble_Back_R"), FVector2D(-119.0, 26.0), EHoopsClip::DribbleWalkR},
		{TEXT("Dribble_Back_L"), FVector2D(-119.0, -26.0), EHoopsClip::DribbleWalkL},
		{TEXT("Dribble_Side_R"), FVector2D(-20.0, -123.0), EHoopsClip::DribbleIdleR}, // anda para a ESQUERDA
		{TEXT("Dribble_Side_L"), FVector2D(-20.0, 123.0), EHoopsClip::DribbleIdleL},  // anda para a DIREITA
		{TEXT("JumpShot_R"), FVector2D(0.0, 0.0), EHoopsClip::JumpShotR},
		{TEXT("JumpShot_L"), FVector2D(0.0, 0.0), EHoopsClip::JumpShotR},
		{TEXT("Cross_R2L"), FVector2D(0.0, 0.0), EHoopsClip::CrossR2L},
		{TEXT("Cross_L2R"), FVector2D(0.0, 0.0), EHoopsClip::CrossL2R}, // sem substituto: o R2L iria para o lado errado
		{TEXT("Celebrate_Flex"), FVector2D(0.0, 0.0), EHoopsClip::CelebrateFlex},
		{TEXT("Celebrate_Shrug"), FVector2D(0.0, 0.0), EHoopsClip::CelebrateFlex},
		// Sem substituto: os tempos são de cada clipe (sem eles, o jogo usa o Cross_* / o giro procedural / nada).
		{TEXT("EscapeCross_R2L"), FVector2D(0.0, 0.0), EHoopsClip::EscapeCrossR2L},
		{TEXT("EscapeCross_L2R"), FVector2D(0.0, 0.0), EHoopsClip::EscapeCrossL2R},
		{TEXT("Spin_R2L"), FVector2D(0.0, 0.0), EHoopsClip::SpinR2L},
		{TEXT("Spin_L2R"), FVector2D(0.0, 0.0), EHoopsClip::SpinL2R},
		{TEXT("Hesitation_R"), FVector2D(0.0, 0.0), EHoopsClip::HesitationR},
		{TEXT("Hesitation_L"), FVector2D(0.0, 0.0), EHoopsClip::HesitationL},
		// Segunda leva. Sem substituto (sem eles o jogo usa o caminho antigo: arremesso como bandeja, crossover...), menos
		// o drible baixo, que cai no drible parado.
		{TEXT("Layup_R"), FVector2D(0.0, 0.0), EHoopsClip::LayupR},
		{TEXT("Layup_L"), FVector2D(0.0, 0.0), EHoopsClip::LayupL},
		{TEXT("Dunk"), FVector2D(0.0, 0.0), EHoopsClip::Dunk},
		{TEXT("Dribble_Low_R"), FVector2D(0.0, 0.0), EHoopsClip::DribbleIdleR},
		{TEXT("Dribble_Low_L"), FVector2D(0.0, 0.0), EHoopsClip::DribbleIdleL},
		{TEXT("BetweenLegs_R2L"), FVector2D(0.0, 0.0), EHoopsClip::BetweenLegsR2L},
		{TEXT("BetweenLegs_L2R"), FVector2D(0.0, 0.0), EHoopsClip::BetweenLegsL2R},
		{TEXT("JumpShot2_R"), FVector2D(0.0, 0.0), EHoopsClip::JumpShot2R},
		{TEXT("JumpShot2_L"), FVector2D(0.0, 0.0), EHoopsClip::JumpShot2L},
		{TEXT("Celebrate_Bow"), FVector2D(0.0, 0.0), EHoopsClip::CelebrateBow},
		{TEXT("Celebrate_ArmsUp"), FVector2D(0.0, 0.0), EHoopsClip::CelebrateArmsUp},
		{TEXT("Celebrate_HighFive"), FVector2D(0.0, 0.0), EHoopsClip::CelebrateHighFive},
		{TEXT("TurnBack"), FVector2D(0.0, 0.0), EHoopsClip::TurnBack},
	};
	static_assert(UE_ARRAY_COUNT(Clips) == HoopsDummyRig::NumClips, "Tabela de clipes fora de sincronia com EHoopsClip");

	int32 ClipIndexFromAssetName(const FString& AssetName)
	{
		// Do nome mais longo para o mais curto ("Dribble_Walk_R" antes de "Walk").
		int32 Best = INDEX_NONE;
		int32 BestLength = 0;
		for (int32 Index = 0; Index < HoopsDummyRig::NumClips; ++Index)
		{
			const FString Key(Clips[Index].Name);
			const bool bMatch = AssetName.Equals(Key, ESearchCase::IgnoreCase) ||
				AssetName.EndsWith(TEXT("_") + Key, ESearchCase::IgnoreCase);
			if (bMatch && Key.Len() > BestLength)
			{
				Best = Index;
				BestLength = Key.Len();
			}
		}
		return Best;
	}

	// Curva medida no mocap (Samples pontos iguais de 0 a 1): Alpha 0..1 -> progresso interpolado.
	float CurveAlpha(const float* Table, int32 Samples, float Alpha)
	{
		const float Position = FMath::Clamp(Alpha, 0.0f, 1.0f) * static_cast<float>(Samples - 1);
		const int32 Index = FMath::Min(static_cast<int32>(Position), Samples - 2); // Position >= 0: corta = arredonda para baixo
		return FMath::Lerp(Table[Index], Table[Index + 1], Position - static_cast<float>(Index));
	}

	bool RefComponentSpace(const FReferenceSkeleton& Ref, FName Bone, FVector& OutLocation)
	{
		int32 Index = Ref.FindBoneIndex(Bone);
		if (Index == INDEX_NONE)
		{
			return false;
		}
		const TArray<FTransform>& Pose = Ref.GetRefBonePose();
		FTransform Result = FTransform::Identity;
		while (Index != INDEX_NONE)
		{
			Result = Result * Pose[Index];
			Index = Ref.GetParentIndex(Index);
		}
		OutLocation = Result.GetLocation();
		return true;
	}
}

namespace HoopsDummyRig
{
	const TCHAR* ClipName(EHoopsClip Clip)
	{
		const int32 Index = static_cast<int32>(Clip);
		return Index >= 0 && Index < NumClips ? Clips[Index].Name : TEXT("?");
	}

	FVector2D NativeVelocity(EHoopsClip Clip)
	{
		const int32 Index = static_cast<int32>(Clip);
		return Index >= 0 && Index < NumClips ? Clips[Index].Velocity : FVector2D::ZeroVector;
	}

	EHoopsClip Fallback(EHoopsClip Clip)
	{
		const int32 Index = static_cast<int32>(Clip);
		return Index >= 0 && Index < NumClips ? Clips[Index].Fallback : EHoopsClip::HoldIdle;
	}

	float SpinTurnAlpha(float CoreAlpha)
	{
		return CurveAlpha(SpinTurnProgress, SpinTurnSamples, CoreAlpha);
	}

	float TurnBackAlpha(float CoreAlpha)
	{
		return CurveAlpha(TurnBackProgress, TurnBackSamples, CoreAlpha);
	}

	bool FindAssets(const FString& Folder, USkeletalMesh*& OutMesh, TArray<UAnimSequence*>& OutClips)
	{
		OutMesh = nullptr;
		OutClips.Init(nullptr, NumClips);

		IAssetRegistry& Registry = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get();
#if WITH_EDITOR
		// No editor, garante que a pasta já foi escaneada (Play logo depois de abrir o projeto).
		Registry.ScanPathsSynchronous({Folder}, false);
#endif
		TArray<FAssetData> Assets;
		Registry.GetAssetsByPath(FName(*Folder), Assets, true);

		const FTopLevelAssetPath MeshClass = USkeletalMesh::StaticClass()->GetClassPathName();
		const FTopLevelAssetPath SequenceClass = UAnimSequence::StaticClass()->GetClassPathName();
		for (const FAssetData& Asset : Assets)
		{
			const FString Name = Asset.AssetName.ToString();
			if (Asset.AssetClassPath == MeshClass)
			{
				if (!OutMesh || Name.Contains(TEXT("HoopsDummy")))
				{
					OutMesh = Cast<USkeletalMesh>(Asset.GetAsset());
				}
			}
			else if (Asset.AssetClassPath == SequenceClass)
			{
				const int32 Index = ClipIndexFromAssetName(Name);
				// Prefere o nome canônico (A_Hoops_<Clipe>) se houver duplicatas de importações antigas.
				if (Index != INDEX_NONE && (!OutClips[Index] || Name.StartsWith(TEXT("A_Hoops_"))))
				{
					OutClips[Index] = Cast<UAnimSequence>(Asset.GetAsset());
				}
			}
		}
		if (!OutMesh)
		{
			return false;
		}

		// Só vale animação do mesmo esqueleto da malha.
		int32 Found = 0;
		for (int32 Index = 0; Index < NumClips; ++Index)
		{
			UAnimSequence*& Sequence = OutClips[Index];
			if (Sequence && Sequence->GetSkeleton() != OutMesh->GetSkeleton())
			{
				UE_LOG(LogHoops, Warning, TEXT("Animacao %s usa outro esqueleto; ignorada (reimporte o FBX inteiro)."), *Sequence->GetName());
				Sequence = nullptr;
			}
			if (Sequence)
			{
				++Found;
			}
			else
			{
				UE_LOG(LogHoops, Log, TEXT("Boneco: clipe %s nao encontrado em %s (usa substituto)."), Clips[Index].Name, *Folder);
			}
		}
		UE_LOG(LogHoops, Log, TEXT("Boneco: malha %s, %d/%d clipes."), *OutMesh->GetName(), Found, NumClips);
		return OutClips[static_cast<int32>(EHoopsClip::HoldIdle)] && OutClips[static_cast<int32>(EHoopsClip::DribbleIdleR)];
	}

	bool MeasureMesh(const USkeletalMesh* Mesh, FMeshMeasure& Out)
	{
		if (!Mesh)
		{
			return false;
		}
		const FReferenceSkeleton& Ref = Mesh->GetRefSkeleton();
		FVector FootL, BallL, FootR, BallR, HandL, HandR, PalmL, PalmR, FingersL, FingersR;
		if (!RefComponentSpace(Ref, TEXT("foot_l"), FootL) || !RefComponentSpace(Ref, TEXT("ball_l"), BallL) ||
			!RefComponentSpace(Ref, TEXT("foot_r"), FootR) || !RefComponentSpace(Ref, TEXT("ball_r"), BallR) ||
			!RefComponentSpace(Ref, TEXT("hand_l"), HandL) || !RefComponentSpace(Ref, TEXT("hand_r"), HandR) ||
			// A bola é posicionada pela palma e pelos dedos: sem eles, ela iria para a origem do mundo.
			!RefComponentSpace(Ref, TEXT("palm_l"), PalmL) || !RefComponentSpace(Ref, TEXT("palm_r"), PalmR) ||
			!RefComponentSpace(Ref, TEXT("fingers_l"), FingersL) || !RefComponentSpace(Ref, TEXT("fingers_r"), FingersR))
		{
			return false;
		}

		// Os pés apontam para a frente do corpo.
		FVector Forward = (BallL - FootL) + (BallR - FootR);
		Forward.Z = 0.0;
		if (Forward.IsNearlyZero())
		{
			return false;
		}
		Out.ForwardYaw = static_cast<float>(Forward.Rotation().Yaw);

		// Depois de girar a frente para +X, a mão direita deve ficar em +Y (direita na Unreal).
		const FVector Across = FRotator(0.0, -Out.ForwardYaw, 0.0).RotateVector(HandR - HandL);
		Out.bRightHandOnRight = Across.Y > 0.0;

		const FBoxSphereBounds Bounds = Mesh->GetBounds();
		Out.BottomZ = static_cast<float>(Bounds.Origin.Z - Bounds.BoxExtent.Z);
		Out.Height = static_cast<float>(Bounds.BoxExtent.Z * 2.0);
		return Out.Height > 10.0f;
	}
}
