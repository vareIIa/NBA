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
	EscapeCrossR2L,
	EscapeCrossL2R,
	SpinR2L,
	SpinL2R,
	HesitationR,
	HesitationL,
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
	constexpr float CrossReleaseSeconds = 9.0f / 60.0f;
	constexpr float CrossCatchSeconds = 30.0f / 60.0f;
	constexpr float CrossEndSeconds = 50.0f / 60.0f;

	// Clipes do sujeito 102 da CMU (quadros do clipe a 60 fps; o _L / L2R é o espelho). Nos que trocam de mão, a bola
	// sai no início da ação e a outra mão recebe no Catch, como no crossover.

	// Escape/attacking crossover (EscapeCross_R2L, 102_14): crossover em corrida que planta baixo e sai acelerando para
	// o outro lado. O corte foi tirado do clipe (quem vira é o capsule). Topo da mão 6, soltura ~16, recebe 30, fim 42.
	constexpr float EscapeCrossStartSeconds = 6.0f / 60.0f;
	constexpr float EscapeCrossReleaseSeconds = 16.0f / 60.0f;
	constexpr float EscapeCrossCatchSeconds = 30.0f / 60.0f;
	constexpr float EscapeCrossEndSeconds = 42.0f / 60.0f;

	// Spin (Spin_R2L = bola na direita, giro horário visto de cima; 102_11). O giro foi tirado do clipe (o corpo fica
	// de frente) e o jogo gira a malha pela curva medida, de SpinStart a SpinEnd. Topo da mão direita 6 (a bola sai),
	// empurrão até ~16, a esquerda recebe 43 e empurra ~55, fim 68.
	constexpr float SpinStartSeconds = 6.0f / 60.0f;
	constexpr float SpinReleaseSeconds = 16.0f / 60.0f;
	constexpr float SpinCatchSeconds = 43.0f / 60.0f;
	constexpr float SpinEndSeconds = 68.0f / 60.0f;
	constexpr float SpinMeasuredDegrees = 211.0f; // giro do mocap entre SpinStart e SpinEnd (o jogo gira 360 / 180)
	// Progresso do giro (0..1) em 8 trechos iguais de SpinStart a SpinEnd: rápido no começo, assenta no fim.
	constexpr int32 SpinTurnSamples = 9;
	constexpr float SpinTurnProgress[SpinTurnSamples] = {0.0f, 0.230f, 0.431f, 0.578f, 0.682f, 0.779f, 0.873f, 0.956f, 1.0f};
	float SpinTurnAlpha(float CoreAlpha); // CoreAlpha 0..1 do miolo -> progresso do giro (interpolado)

	// Hesitação (Hesitation_R, 102_18): bola na cintura, finta baixa e arranque com o drible da mesma mão.
	// Início 5, empurrão ~26, fim 34; o miolo é tocado na duração do movimento.
	constexpr float HesitationStartSeconds = 5.0f / 60.0f;
	constexpr float HesitationPushSeconds = 26.0f / 60.0f;
	constexpr float HesitationEndSeconds = 34.0f / 60.0f;

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
