#pragma once

#include "HoopsSimCore/HoopsProStick.h"

#include <cstdint>

// Dribles no modelo 2K23 (docs/05-gameplay-ataque.md §2): gesto do Pro Stick → movimento, com fases
// (commit curto, janela de combo no fim, buffer de 150 ms), troca de mão e ENERGIA (stamina).
// Sem Explosões/Adrenaline Boosts (decisão D13 do diretor): o único limitador é a barra de energia.
// Sem animação aqui: o núcleo diz QUAL movimento, QUANDO e com que impulso; a Unreal escolhe o clipe.
namespace Hoops
{
	enum class BallHand : uint8_t
	{
		Right,
		Left,
	};

	inline BallHand OtherHand(BallHand Hand) { return Hand == BallHand::Right ? BallHand::Left : BallHand::Right; }

	enum class DribbleMove : uint8_t
	{
		None,
		Crossover,
		AttackingCrossover,
		BetweenLegs,
		BehindBack,
		Hesitation,
		EscapeHesitation,
		InAndOut,
		StepBack,
		EscapeStepBack,
		Spin,
		HalfSpin,
		DoubleCross,  // double throw
		HesiCross,    // switchback
		Retreat,
		Count,
	};

	struct DribbleMoveSpec
	{
		double Duration = 0.4;        // s (com playrate 1)
		double CommitSeconds = 0.12;  // não cancela antes disso
		double ComboWindow = 0.15;    // últimos X s: input aqui = combo com ritmo
		int HandSwitches = 0;         // 0, 1 ou 2 (2 = volta à mesma mão)
		double LateralSpeed = 0.0;    // m/s para o lado da NOVA mão (negativo = lado oposto)
		double ForwardSpeed = 0.0;    // m/s para frente (negativo = para trás)
		double EnergyCost = 0.02;     // fração da barra
		double Exposure = 0.3;        // exposição da bola a roubo (0..1) durante o movimento
	};

	HOOPSSIMCORE_API const DribbleMoveSpec& GetDribbleMoveSpec(DribbleMove Move);
	HOOPSSIMCORE_API const char* DribbleMoveLabel(DribbleMove Move);

	struct DribbleContext
	{
		BallHand Hand = BallHand::Right;
		bool bSprint = false;   // RT segurado
		bool bMoving = false;
	};

	// Traduz um gesto (orientação absoluta) no movimento do 2K23. Retorna None se o gesto não é drible
	// (ex.: Hold para baixo = arremesso pelo Pro Stick, tratado fora daqui).
	HOOPSSIMCORE_API DribbleMove ResolveDribbleMove(const StickGesture& Gesture, const DribbleContext& Context);

	struct DribbleEnergyConfig
	{
		double SprintDrainPerSecond = 0.08;   // ~12 s de sprint esvaziam a barra
		double RegenPerSecond = 0.10;         // parado: ~10 s para encher
		double MovingRegenScale = 0.5;        // andando/correndo sem sprint: recupera pela metade
		double ComboEnergyDiscount = 0.8;     // combo no ritmo gasta menos
		double ComboPlayRate = 1.15;          // combo no ritmo é mais rápido
		double InputBufferSeconds = 0.15;
		double LowEnergyThreshold = 0.40;     // abaixo disso a energia começa a pesar
		double LowEnergyMinSpeedScale = 0.82; // velocidade com a barra vazia
		double LowEnergyMinMovePlayRate = 0.85; // dribles mais lentos com a barra vazia
		bool bInfiniteEnergy = false;         // opção de treino do Freestyle
	};

	struct ActiveDribbleMove
	{
		DribbleMove Move = DribbleMove::None;
		double StartTime = 0.0;
		double PlayRate = 1.0;
		bool bInRhythm = false;  // entrou na janela de combo do anterior
		BallHand HandAtStart = BallHand::Right;

		double EndTime() const
		{
			const double Rate = PlayRate > 1e-6 ? PlayRate : 1.0;
			return StartTime + GetDribbleMoveSpec(Move).Duration / Rate;
		}
		bool IsActive(double Now) const { return Move != DribbleMove::None && Now < EndTime(); }
	};

	class HOOPSSIMCORE_API DribbleController
	{
	public:
		explicit DribbleController(const DribbleEnergyConfig& InConfig = DribbleEnergyConfig());

		// Pede um movimento. Se o atual ainda está no commit, guarda no buffer (150 ms). Retorna true se começou agora.
		bool Request(DribbleMove Move, double Now);

		// Avança o tempo: termina movimentos, consome buffer, gasta/regenera energia.
		void Update(double Now, double DeltaSeconds, bool bSprinting, bool bMoving = false);

		void ResetPossession();

		const ActiveDribbleMove& GetActive() const { return Active; }
		bool IsMoveActive(double Now) const { return Active.IsActive(Now); }
		// Pode sair do movimento atual para arremesso/passe (depois do commit)?
		bool CanCancel(double Now) const;
		BallHand GetHand() const { return Hand; }
		void SetHand(BallHand InHand) { Hand = InHand; }
		double GetEnergy() const { return Energy; }
		void SetEnergy(double InEnergy) { Energy = Clamp(InEnergy, 0.0, 1.0); }
		// Efeito da energia baixa: velocidade máxima e velocidade dos dribles.
		double SpeedScale() const;
		double MovePlayRateScale() const;
		int GetComboCount() const { return ComboCount; }
		// Último movimento terminado (para escolher o tipo de arremesso: step-back jumper, spin jumper...).
		DribbleMove GetLastMove() const { return LastMove; }
		double GetLastMoveEndTime() const { return LastMoveEndTime; }

	private:
		void Start(DribbleMove Move, double Now, bool bInRhythm);

		DribbleEnergyConfig Config;
		ActiveDribbleMove Active;
		DribbleMove Buffered = DribbleMove::None;
		double BufferedTime = -1000.0;
		BallHand Hand = BallHand::Right;
		double Energy = 1.0;
		int ComboCount = 0;
		DribbleMove LastMove = DribbleMove::None;
		double LastMoveEndTime = -1000.0;
	};
}
