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
	// Segunda leva da CMU (Tools/Animacao/README.md).
	LayupR,
	LayupL,
	Dunk,
	DribbleLowR,
	DribbleLowL,
	BetweenLegsR2L,
	BetweenLegsL2R,
	JumpShot2R,
	JumpShot2L,
	CelebrateBow,
	CelebrateArmsUp,
	CelebrateHighFive,
	TurnBack,
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
	constexpr float JumpShotTakeoffSeconds = 100.0f / 60.0f; // bandeja/enterrada sem os clipes delas (FBX antigo) começam aqui
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

	// ---------------- Segunda leva (quadros do clipe a 60 fps; o _L / L2R é o espelho)

	// Clipe de arremesso e seus quadros-chave. O jogo começa no Dip e acerta o Release no tempo ideal (centro da janela
	// green), então trocar de clipe não muda o timing do green.
	struct FJumpShotTiming
	{
		EHoopsClip Clip;
		float Dip;
		float Release;
		float End;
		float FollowThrough;
	};
	// Clássico (JumpShot_R, 06_15): soltura com os dedos ~12 cm acima da cabeça.
	constexpr FJumpShotTiming JumpShotClassic = {EHoopsClip::JumpShotR, JumpShotDipSeconds, JumpShotReleaseSeconds,
		JumpShotEndSeconds, JumpShotFollowThroughSeconds};
	// Alto (JumpShot2_R, 124_05): arremesso de um tempo, bola da cintura à soltura com o braço todo estendido (dedos ~50 cm
	// acima da cabeça), pés ~33 cm do chão, mão de apoio sai primeiro. Gather/dip 18 (início no jogo), quadril no mais
	// baixo 33, decolagem 41, soltura 55, ápice 57, follow-through 61, aterrissagem 72, fim 88. Dip -> soltura = 37
	// quadros, como no clássico.
	constexpr FJumpShotTiming JumpShotHigh = {EHoopsClip::JumpShot2R, 18.0f / 60.0f, 55.0f / 60.0f, 88.0f / 60.0f, 61.0f / 60.0f};

	// Bandeja (Layup_R, 124_06: salto de dois pés com a mão direita no alto; _L = espelho) e enterrada de duas mãos (Dunk,
	// o mesmo salto com o braço esquerdo espelhando o direito). O jogo começa no Gather e acerta a soltura em
	// LayupReleaseSeconds/DunkReleaseSeconds; o capsule decola no Takeoff com o ápice no Apex do clipe (o clipe guarda
	// só 30% / 45% do arco da pelve; o resto do pulo é do capsule), então os pés saem e voltam ao chão junto com o mocap.
	struct FFinishTiming
	{
		float Gather;
		float Takeoff;
		float Apex;
		float Release;
		float End;
	};
	// Gather 18 (bola no peito, quadril no mais baixo), decolagem 25, ápice e soltura 45, aterrissagem ~66, fim 82.
	constexpr FFinishTiming LayupTiming = {18.0f / 60.0f, 25.0f / 60.0f, 45.0f / 60.0f, 45.0f / 60.0f, 82.0f / 60.0f};
	// Começa mais perto da decolagem (mais tempo de subida = pulo mais alto, mãos acima do aro); soltura 49, já descendo
	// as mãos na "martelada".
	constexpr FFinishTiming DunkTiming = {22.0f / 60.0f, 25.0f / 60.0f, 45.0f / 60.0f, 49.0f / 60.0f, 82.0f / 60.0f};

	// Entre as pernas (BetweenLegs_L2R, 06_13; o R2L é o espelho): base escalonada e baixa, a mão empurra a bola entre os
	// pés e a outra recebe subindo pela frente. Início 12, solta ~23, recebe 40, fim 48.
	constexpr float BetweenLegsStartSeconds = 12.0f / 60.0f;
	constexpr float BetweenLegsReleaseSeconds = 23.0f / 60.0f;
	constexpr float BetweenLegsCatchSeconds = 40.0f / 60.0f;
	constexpr float BetweenLegsEndSeconds = 48.0f / 60.0f;

	// Vira e volta depois do green (TurnBack, 69_39): últimos passos de costas, para e gira no lugar para a ESQUERDA. O giro
	// (166° no mocap) saiu do clipe: o jogo gira o ATOR 180° pela curva medida, de TurnBackTurnStart a TurnBackTurnEnd.
	constexpr float TurnBackStartSeconds = 4.0f / 60.0f;
	constexpr float TurnBackTurnStartSeconds = 14.0f / 60.0f;
	constexpr float TurnBackTurnEndSeconds = 112.0f / 60.0f;
	constexpr float TurnBackEndSeconds = 118.0f / 60.0f;
	constexpr int32 TurnBackSamples = 9;
	constexpr float TurnBackProgress[TurnBackSamples] = {0.0f, 0.072f, 0.218f, 0.386f, 0.562f, 0.733f, 0.861f, 0.959f, 1.0f};
	float TurnBackAlpha(float CoreAlpha); // CoreAlpha 0..1 do giro -> progresso (interpolado)

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
