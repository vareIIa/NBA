#pragma once

#include "HoopsSimCore/HoopsProStick.h"

#include <cstdint>

// Dribles no modelo 2K23 (docs/05-gameplay-ataque.md §2): gesto do Pro Stick → movimento, com fases
// (commit curto, janela de combo no fim, buffer de 150 ms), troca de mão e ENERGIA (stamina).
// Ramificação (docs/17 §4.4, P0-8): misdirection antes do 1º quique e arranque na saída do movimento.
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
		double ExitBurst = 0.0;       // m/s extras no arranque de saída (speedboost / cross launch)
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

		// Misdirection (docs/17 §4.4): até o 1º quique, um gesto que leva a bola para o lado oposto troca o
		// movimento na hora (a bola nem chega a trocar de mão). Um por movimento; o resto vai para o buffer.
		double MisdirectionWindowScale = 1.0; // janela = CommitSeconds × isto (o commit acaba no 1º quique)
		bool bMisdirectionNeedsSprint = false; // true = como o 2K26 (só com RT segurado)

		// Arranque na saída do movimento (speedboost / cross launch): LS apontado quando o movimento acaba.
		// Pago com energia, sem contador de boosts (D13).
		double ExitBurstWindowSeconds = 0.20; // o LS pode apontar até X s depois do fim do movimento
		double ExitBurstMinStick = 0.5;       // LS pelo menos pela metade
		double ExitBurstHoldSeconds = 0.15;   // velocidade extra cheia (1º passo)...
		double ExitBurstFadeSeconds = 0.30;   // ...e depois cai até zero (2º passo)
		double SpeedboostScale = 1.0;         // sair para o lado da bola ou em frente (estilo de drible, docs/05 §2.3)
		double CrossLaunchScale = 1.0;        // sair para o lado da nova mão depois de uma troca de mão
		double AgainstMoveBurstScale = 0.5;   // sair contra o movimento (para trás ou para o lado da mão livre)
		double ExitBurstEnergyPerMps = 0.012; // fração da barra por m/s de arranque
		double LowEnergyMinBurstScale = 0.40; // arranque com a barra vazia (abaixo de 40% começa a cair)
	};

	// Gesto lido pelo controlador: qual movimento e se ele troca o atual antes do 1º quique.
	struct DribbleIntent
	{
		DribbleMove Move = DribbleMove::None;
		bool bRedirect = false;
	};

	enum class ExitBurstKind : uint8_t
	{
		None,
		Speedboost,  // saiu para o lado da bola (sem troca de mão) ou em frente
		CrossLaunch, // saiu para o lado da nova mão depois de uma troca (crossover, entre as pernas, spin...)
		AgainstMove, // saiu contra o movimento: arranque menor
	};

	HOOPSSIMCORE_API const char* ExitBurstKindLabel(ExitBurstKind Kind);

	struct DribbleExitBurst
	{
		ExitBurstKind Kind = ExitBurstKind::None;
		DribbleMove FromMove = DribbleMove::None;
		double DirX = 0.0;       // direção (unitária) no referencial do ataque: X = direita, Y = para a cesta
		double DirY = 0.0;
		double Speed = 0.0;      // m/s extras no início (depois cai até zero)
		double StartTime = 0.0;
		double EnergyCost = 0.0; // fração da barra que custou

		bool IsValid() const { return Kind != ExitBurstKind::None && Speed > 0.0; }
	};

	struct ActiveDribbleMove
	{
		DribbleMove Move = DribbleMove::None;
		double StartTime = 0.0;
		double PlayRate = 1.0;
		bool bInRhythm = false;  // entrou na janela de combo do anterior
		BallHand HandAtStart = BallHand::Right;
		bool bRedirected = false; // misdirection: trocou outro movimento antes do 1º quique
		DribbleMove RedirectedFrom = DribbleMove::None;

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

		// Lê um gesto do Pro Stick na mão certa (Context.Hand é ignorado: a mão vem do controlador). Na janela de
		// misdirection o gesto é lido a partir da mão do início do movimento (a bola ainda não quicou): se ele leva a
		// bola para o lado oposto, ou é um combo (double throw/switchback), bRedirect = true.
		DribbleIntent ResolveGesture(const StickGesture& Gesture, const DribbleContext& Context, double Now) const;

		// Pede um movimento. Se o atual ainda está no commit, guarda no buffer (150 ms). Retorna true se começou agora.
		// bRedirect (vindo de ResolveGesture): troca o movimento atual na hora, sem esperar o commit.
		bool Request(DribbleMove Move, double Now, bool bRedirect = false);

		// Avança o tempo: termina movimentos, consome buffer, gasta/regenera energia.
		void Update(double Now, double DeltaSeconds, bool bSprinting, bool bMoving = false);

		void ResetPossession();

		const ActiveDribbleMove& GetActive() const { return Active; }
		bool IsMoveActive(double Now) const { return Active.IsActive(Now); }
		// Pode sair do movimento atual para arremesso/passe (depois do commit)?
		bool CanCancel(double Now) const;
		// Ainda dá para trocar o movimento atual (misdirection, antes do 1º quique)?
		bool CanRedirect(double Now) const;
		BallHand GetHand() const { return Hand; }
		void SetHand(BallHand InHand) { Hand = InHand; }
		double GetEnergy() const { return Energy; }
		void SetEnergy(double InEnergy) { Energy = Clamp(InEnergy, 0.0, 1.0); }
		// Efeito da energia baixa: velocidade máxima e velocidade dos dribles.
		double SpeedScale() const;
		double MovePlayRateScale() const;
		double ExitBurstEnergyScale() const;

		// Arranque na saída: chamar a cada frame com o LS no referencial do ataque (X = direita, Y = para a cesta,
		// módulo 0..1). Dispara uma vez por movimento terminado, se o LS apontar dentro da janela, e cobra a energia.
		DribbleExitBurst TryExitBurst(double Now, double StickX, double StickY);
		// Velocidade extra (m/s) do arranque agora: cheia no 1º passo, depois cai até zero.
		double ExitBurstSpeed(double Now) const;
		const DribbleExitBurst& GetExitBurst() const { return ExitBurst; }
		int GetComboCount() const { return ComboCount; }
		// Último movimento terminado (para escolher o tipo de arremesso: step-back jumper, spin jumper...).
		DribbleMove GetLastMove() const { return LastMove; }
		double GetLastMoveEndTime() const { return LastMoveEndTime; }

	private:
		void Start(DribbleMove Move, double Now, bool bInRhythm);
		void Redirect(DribbleMove Move, double Now);
		bool IsMisdirection(DribbleMove Move) const;

		DribbleEnergyConfig Config;
		ActiveDribbleMove Active;
		DribbleMove Buffered = DribbleMove::None;
		double BufferedTime = -1000.0;
		BallHand Hand = BallHand::Right;
		double Energy = 1.0;
		int ComboCount = 0;
		DribbleMove LastMove = DribbleMove::None;
		double LastMoveEndTime = -1000.0;
		DribbleMove ExitMove = DribbleMove::None; // movimento que acabou e ainda pode dar o arranque
		double ExitTime = -1000.0;
		DribbleExitBurst ExitBurst;
	};
}
