// Boneco animado "HoopsDummy" (Art/Characters/HoopsDummy/SK_HoopsDummy.fbx, ver Tools/Animacao/README.md):
// lista de clipes, dados medidos no mocap e busca dos assets importados.
#pragma once

#include "CoreMinimal.h"

class UAnimSequence;
class USkeletalMesh;

// A ordem é o índice no array de clipes.
enum class EHoopsClip : uint8
{
	HoldIdle,
	Walk,
	Run,
	DribbleIdleR,
	DribbleIdleL,
	DribbleWalkR,
	DribbleWalkL,
	DribbleRunR,
	DribbleRunL,
	DribbleBackR,
	DribbleBackL,
	DribbleSideR,
	DribbleSideL,
	JumpShotR,
	JumpShotL,
	CrossR2L,
	CrossL2R,
	CelebrateFlex,
	CelebrateShrug,
	Count
};

namespace HoopsDummyRig
{
	constexpr int32 NumClips = static_cast<int32>(EHoopsClip::Count);

	// Nome do clipe no FBX. O asset na Unreal termina com ele ("A_Hoops_Dribble_Idle_R", "SK_..._Dribble_Idle_R").
	const TCHAR* ClipName(EHoopsClip Clip);

	// Velocidade nativa do clipe (cm/s, medida no mocap) no referencial do jogador: X = frente, Y = direita.
	FVector2D NativeVelocity(EHoopsClip Clip);

	// Clipe substituto quando um clipe não foi importado (HoldIdle não tem substituto).
	EHoopsClip Fallback(EHoopsClip Clip);

	// Arremesso (quadros do clipe JumpShot a 60 fps): o jogo começa no "dip" e acerta a soltura no tempo ideal.
	constexpr float JumpShotDipSeconds = 80.0f / 60.0f;
	constexpr float JumpShotTakeoffSeconds = 100.0f / 60.0f; // bandeja/enterrada (provisório) começam aqui
	constexpr float JumpShotReleaseSeconds = 117.0f / 60.0f;
	constexpr float JumpShotEndSeconds = 150.0f / 60.0f;     // depois da aterrissagem: volta para a base
	constexpr float JumpShotFollowThroughSeconds = 123.0f / 60.0f; // pose segurada depois da soltura (green)

	// Crossover (clipe Cross_R2L; o L2R é o espelho): a mão de origem solta a bola ~quadro 9, a outra recebe ~30.
	constexpr float CrossStartSeconds = 7.0f / 60.0f;
	constexpr float CrossCatchSeconds = 30.0f / 60.0f;
	constexpr float CrossEndSeconds = 50.0f / 60.0f;

	// Procura a malha e os clipes em Folder (Asset Registry). OutClips tem NumClips entradas (nullptr = faltando).
	// Retorna false se não houver malha ou se faltar o drible parado / segurar a bola.
	bool FindAssets(const FString& Folder, USkeletalMesh*& OutMesh, TArray<UAnimSequence*>& OutClips);

	// Medidas da pose de referência: yaw (graus, espaço da malha) para onde os pés apontam, altura e Z mais baixo
	// (cm), e se a mão direita fica à direita depois de girar (false = importação espelhada). false se faltar osso.
	struct FMeshMeasure
	{
		float ForwardYaw = 0.0f;
		float Height = 0.0f;
		float BottomZ = 0.0f;
		bool bRightHandOnRight = true;
	};
	bool MeasureMesh(const USkeletalMesh* Mesh, FMeshMeasure& Out);
}
