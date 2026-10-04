#include "HoopsAudioSynth.h"

#include <cmath>

// Receitas (ajustadas "de ouvido" e conferidas offline com Tools/Audio/ouvir_sons.cpp: duração, pico, centroide):
// - Quique: corpo grave 106–145 Hz com queda de afinação (como um bumbo) e decaimento de ~30 ms, 2º modo da
//   madeira (2,6x), estalo da borracha (ruído em banda de 600–780 Hz, ~12 ms), clique agudo (~1 ms), o "ping" oco
//   da câmara de ar da bola (~1 kHz, 45 ms) e um resto de sala bem baixo. 160 ms.
// - Rede: ruído em banda que desce de ~5 kHz para ~2,5 kHz (a bola passando), ataque de 10 ms e decaimento de
//   ~250 ms, estalos curtos das cordas e uma cauda de nylon abafada (passa-baixa ~1,7 kHz) com farfalhar. 550 ms.
//   A versão "abafada" (cesta depois do aro) é mais grave, mais lenta e sem estalo forte.
// - Aro: parciais inarmônicos de anel de aço (520/1370/2230/3150/4480 Hz), cada um em par levemente desafinado
//   (batimento), decaimento de 300 ms no grave a 65 ms no agudo, golpe de ruído e "tum" da fixação (165 Hz).
// - Tabela: pancada seca (190/310/520/880 Hz, 20–75 ms), golpe abafado e um pouco de chiado do aro.
// - Tênis: senoide varrendo 3,0→4,2 kHz (ou descendo, conforme a variação) em 65–120 ms, com vibrato de
//   33–44 Hz, 2º e 3º harmônicos e chiado de atrito na mesma frequência.
// - Ding do green: o mesmo de antes (Mi 1318,5 Hz e Si 1975,5 Hz, 0,7 s).
namespace HoopsSynth
{
	namespace Detail
	{
		constexpr float PiF = 3.14159265358979f;
		constexpr float TwoPiF = 6.28318530717959f;
		constexpr float RateF = static_cast<float>(SampleRateHz);
		constexpr float InvRate = 1.0f / RateF;

		inline float ClampF(float Value, float Lo, float Hi)
		{
			return Value < Lo ? Lo : (Value > Hi ? Hi : Value);
		}

		inline float Decay(float T, float Tau)
		{
			return T < 0.0f ? 0.0f : std::exp(-T / Tau);
		}

		// Sobe de 0 a 1 em Seconds (meio cosseno). Antes de T = 0 é zero.
		inline float Rise(float T, float Seconds)
		{
			if (T <= 0.0f)
			{
				return 0.0f;
			}
			return T >= Seconds ? 1.0f : 0.5f - 0.5f * std::cos(PiF * T / Seconds);
		}

		// Ruído branco determinístico (xorshift32) em [-1, 1): a mesma variação soa sempre igual.
		struct NoiseGen
		{
			uint32_t State;

			explicit NoiseGen(uint32_t Seed) : State(Seed != 0u ? Seed : 0x9E3779B9u) {}

			float Next()
			{
				State ^= State << 13;
				State ^= State >> 17;
				State ^= State << 5;
				return static_cast<float>(State) * (1.0f / 2147483648.0f) - 1.0f;
			}
		};

		// Biquad (receitas RBJ), forma direta transposta II.
		struct BiquadFilter
		{
			enum class EType : uint8_t { LowPass, HighPass, BandPass };

			float B0 = 1.0f;
			float B1 = 0.0f;
			float B2 = 0.0f;
			float A1 = 0.0f;
			float A2 = 0.0f;
			float Z1 = 0.0f;
			float Z2 = 0.0f;

			BiquadFilter() = default;
			BiquadFilter(EType Type, float FreqHz, float Q) { Design(Type, FreqHz, Q); }

			// Banda: ganho 0 dB no centro. Pode ser chamado durante o som (varredura); mantém o estado.
			void Design(EType Type, float FreqHz, float Q)
			{
				const float W0 = TwoPiF * ClampF(FreqHz, 10.0f, 0.45f * RateF) * InvRate;
				const float CosW = std::cos(W0);
				const float Alpha = std::sin(W0) / (2.0f * Q);
				const float Norm = 1.0f / (1.0f + Alpha);
				float NB0 = Alpha;
				float NB1 = 0.0f;
				float NB2 = -Alpha;
				if (Type == EType::LowPass)
				{
					NB0 = (1.0f - CosW) * 0.5f;
					NB1 = 1.0f - CosW;
					NB2 = NB0;
				}
				else if (Type == EType::HighPass)
				{
					NB0 = (1.0f + CosW) * 0.5f;
					NB1 = -(1.0f + CosW);
					NB2 = NB0;
				}
				B0 = NB0 * Norm;
				B1 = NB1 * Norm;
				B2 = NB2 * Norm;
				A1 = -2.0f * CosW * Norm;
				A2 = (1.0f - Alpha) * Norm;
			}

			float Process(float In)
			{
				const float Result = B0 * In + Z1;
				Z1 = B1 * In - A1 * Result + Z2;
				Z2 = B2 * In - A2 * Result;
				return Result;
			}
		};

		using EFilter = BiquadFilter::EType;

		int SecondsToSamples(float Seconds)
		{
			return static_cast<int>(Seconds * RateF + 0.5f);
		}

		// ------------------------------------------------------------------ Quique
		struct BounceRecipe
		{
			float BodyHz;  // corpo grave (taco + bola)
			float BodyTau; // s
			float SlapHz;  // estalo da borracha
			float RingHz;  // "ping" da câmara de ar
			uint32_t Seed;
		};

		const BounceRecipe BounceRecipes[] = {
			{118.0f, 0.034f, 650.0f, 960.0f, 11u},
			{132.0f, 0.029f, 720.0f, 1010.0f, 23u},
			{106.0f, 0.038f, 600.0f, 925.0f, 37u},
			{145.0f, 0.027f, 780.0f, 1065.0f, 51u},
		};

		void RenderBounce(int Variant, float* Out, int Count)
		{
			const BounceRecipe& R = BounceRecipes[Variant];
			NoiseGen Noise(R.Seed);
			NoiseGen RoomNoise(R.Seed * 5u + 7u);
			BiquadFilter ClickFilter(EFilter::HighPass, 2500.0f, 0.7f);
			BiquadFilter SlapFilter(EFilter::BandPass, R.SlapHz, 1.0f);
			BiquadFilter RoomFilter(EFilter::LowPass, 900.0f, 0.7f);
			float BodyPhase = 0.0f;
			float WoodPhase = 0.0f;
			for (int Index = 0; Index < Count; ++Index)
			{
				const float T = static_cast<float>(Index) * InvRate;
				// Queda de afinação no impacto: começa 70% acima e assenta no corpo em ~10 ms.
				BodyPhase += TwoPiF * R.BodyHz * (1.0f + 0.7f * Decay(T, 0.010f)) * InvRate;
				WoodPhase += TwoPiF * R.BodyHz * 2.63f * (1.0f + 0.35f * Decay(T, 0.008f)) * InvRate;
				const float Body = std::sin(BodyPhase) * Decay(T, R.BodyTau) + 0.6f * std::sin(WoodPhase) * Decay(T, R.BodyTau * 0.5f);
				const float White = Noise.Next();
				const float Click = ClickFilter.Process(White) * Decay(T, 0.0012f);
				const float Slap = SlapFilter.Process(White) * Decay(T, 0.012f);
				const float Ring = std::sin(TwoPiF * R.RingHz * T) * Decay(T, 0.045f) * (1.0f - Decay(T, 0.002f));
				const float Room = RoomFilter.Process(RoomNoise.Next()) * Rise(T - 0.008f, 0.01f) * Decay(T - 0.008f, 0.05f);
				Out[Index] = Rise(T, 0.0015f) * Body + 0.6f * Click + 4.0f * Slap + 0.22f * Ring + 0.12f * Room;
			}
		}

		// ------------------------------------------------------------------ Rede
		struct NetRecipe
		{
			float StartHz;  // centro da banda no início da passagem
			float EndHz;    // ... e no fim
			float SweepTau; // s
			float BodyTau;  // decaimento do "swish"
			float SnapGain; // estalos das cordas
			float Snap2;    // instante do 2º estalo (s)
			float Snap3;    // ... e do 3º
			float TailGain; // cauda de nylon
			uint32_t Seed;
		};

		const NetRecipe SwishRecipes[] = {
			{5200.0f, 2400.0f, 0.070f, 0.085f, 0.7f, 0.030f, 0.064f, 0.9f, 101u},
			{4700.0f, 2200.0f, 0.080f, 0.095f, 0.6f, 0.026f, 0.057f, 1.0f, 211u},
			{5600.0f, 2700.0f, 0.065f, 0.080f, 0.75f, 0.034f, 0.070f, 0.85f, 307u},
		};

		const NetRecipe NetSoftRecipes[] = {
			{3000.0f, 1600.0f, 0.060f, 0.070f, 0.25f, 0.040f, 0.090f, 1.3f, 401u},
			{2700.0f, 1500.0f, 0.070f, 0.075f, 0.2f, 0.046f, 0.100f, 1.4f, 503u},
		};

		void RenderNet(const NetRecipe& R, float* Out, int Count)
		{
			// Uma fonte de ruído por camada: versões filtradas do mesmo ruído somadas se cancelam em algumas
			// frequências (entalhe estreito perto de 1,3 kHz).
			NoiseGen Noise(R.Seed);
			NoiseGen AirNoise(R.Seed * 17u + 9u);
			NoiseGen TailSource(R.Seed * 13u + 3u);
			NoiseGen FlutterNoise(R.Seed * 7u + 1u);
			BiquadFilter Whoosh(EFilter::BandPass, R.StartHz, 0.9f);
			BiquadFilter WhooshTop(EFilter::LowPass, 8000.0f, 0.7f); // tira o chiado acima da banda
			BiquadFilter AirHigh(EFilter::HighPass, 1200.0f, 0.7f);
			BiquadFilter AirLow(EFilter::LowPass, 6500.0f, 0.7f);
			BiquadFilter SnapFilter(EFilter::HighPass, 4000.0f, 0.7f);
			BiquadFilter TailLow1(EFilter::LowPass, 1700.0f, 0.7f);
			BiquadFilter TailLow2(EFilter::LowPass, 1700.0f, 0.7f);
			BiquadFilter TailHigh(EFilter::HighPass, 300.0f, 0.7f);
			const float SnapTimes[3] = {0.0f, R.Snap2, R.Snap3};
			const float SnapGains[3] = {1.0f, 0.7f, 0.45f};
			float Flutter = 0.0f;
			for (int Index = 0; Index < Count; ++Index)
			{
				const float T = static_cast<float>(Index) * InvRate;
				// Filtro redesenhado a cada amostra (em blocos, a troca periódica vira um tom de 44100/bloco Hz).
				Whoosh.Design(EFilter::BandPass, R.EndHz + (R.StartHz - R.EndHz) * Decay(T, R.SweepTau), 0.9f);
				const float White = Noise.Next();
				const float Body = Rise(T, 0.010f) * (T < 0.03f ? 1.0f : Decay(T - 0.03f, R.BodyTau));

				float Snaps = 0.0f;
				for (int SnapIndex = 0; SnapIndex < 3; ++SnapIndex)
				{
					Snaps += SnapGains[SnapIndex] * Decay(T - SnapTimes[SnapIndex], 0.003f);
				}

				// Farfalhar: ruído lento (~30 Hz) modulando a cauda.
				Flutter += (FlutterNoise.Next() - Flutter) * 0.004f;
				const float Rustle = ClampF(1.0f + 8.0f * Flutter, 0.3f, 1.7f);
				const float Tail = Rise(T - 0.03f, 0.04f) * Decay(T - 0.03f, 0.17f) * Rustle;
				const float TailNoise = TailHigh.Process(TailLow2.Process(TailLow1.Process(TailSource.Next())));

				Out[Index] = 2.2f * WhooshTop.Process(Whoosh.Process(White)) * Body + 0.25f * AirLow.Process(AirHigh.Process(AirNoise.Next())) * Body
					+ R.SnapGain * SnapFilter.Process(White) * Snaps + R.TailGain * TailNoise * Tail;
			}
		}

		// ------------------------------------------------------------------ Aro e tabela
		struct ModalRecipe
		{
			float FreqScale;
			float TauScale;
			float BeatHz; // separação dos pares de modos (batimento do anel)
			uint32_t Seed;
		};

		const ModalRecipe RimRecipes[] = {
			{1.00f, 1.00f, 1.7f, 601u},
			{0.94f, 0.85f, 2.3f, 607u},
			{1.07f, 1.15f, 1.2f, 613u},
		};

		void RenderRim(int Variant, float* Out, int Count)
		{
			const ModalRecipe& R = RimRecipes[Variant];
			const float ModeHz[5] = {520.0f, 1370.0f, 2230.0f, 3150.0f, 4480.0f};
			const float ModeAmp[5] = {1.0f, 0.75f, 0.55f, 0.32f, 0.2f};
			const float ModeTau[5] = {0.30f, 0.21f, 0.15f, 0.10f, 0.065f};
			NoiseGen Noise(R.Seed);
			BiquadFilter StrikeFilter(EFilter::BandPass, 2600.0f, 0.8f);
			for (int Index = 0; Index < Count; ++Index)
			{
				const float T = static_cast<float>(Index) * InvRate;
				float Ring = 0.0f;
				for (int Mode = 0; Mode < 5; ++Mode)
				{
					const float Hz = ModeHz[Mode] * R.FreqScale;
					const float Split = R.BeatHz * static_cast<float>(Mode + 1);
					const float Pair = std::sin(TwoPiF * Hz * T) + std::sin(TwoPiF * (Hz + Split) * T + 0.9f * static_cast<float>(Mode));
					Ring += 0.5f * ModeAmp[Mode] * Pair * Decay(T, ModeTau[Mode] * R.TauScale);
				}
				const float Strike = StrikeFilter.Process(Noise.Next()) * Decay(T, 0.004f);
				const float Thunk = std::sin(TwoPiF * 165.0f * T) * Decay(T, 0.05f);
				Out[Index] = Rise(T, 0.0007f) * (Ring + 0.55f * Thunk) + 2.5f * Strike;
			}
		}

		const ModalRecipe BoardRecipes[] = {
			{1.00f, 1.0f, 0.0f, 701u},
			{1.09f, 0.9f, 0.0f, 709u},
		};

		void RenderBoard(int Variant, float* Out, int Count)
		{
			const ModalRecipe& R = BoardRecipes[Variant];
			const float ModeHz[4] = {190.0f, 310.0f, 520.0f, 880.0f};
			const float ModeAmp[4] = {1.0f, 0.6f, 0.35f, 0.2f};
			const float ModeTau[4] = {0.075f, 0.05f, 0.035f, 0.02f};
			NoiseGen Noise(R.Seed);
			BiquadFilter StrikeFilter(EFilter::LowPass, 1800.0f, 0.7f);
			BiquadFilter RattleFilter(EFilter::BandPass, 2200.0f, 2.0f);
			float Phases[4] = {0.0f, 0.0f, 0.0f, 0.0f};
			for (int Index = 0; Index < Count; ++Index)
			{
				const float T = static_cast<float>(Index) * InvRate;
				const float Glide = 1.0f + 0.15f * Decay(T, 0.006f); // impacto: afinação cai rápido
				float Panel = 0.0f;
				for (int Mode = 0; Mode < 4; ++Mode)
				{
					Phases[Mode] += TwoPiF * ModeHz[Mode] * R.FreqScale * Glide * InvRate;
					Panel += ModeAmp[Mode] * std::sin(Phases[Mode]) * Decay(T, ModeTau[Mode] * R.TauScale);
				}
				const float White = Noise.Next();
				const float Strike = StrikeFilter.Process(White) * Decay(T, 0.006f);
				const float Rattle = RattleFilter.Process(White) * Decay(T, 0.03f);
				Out[Index] = Rise(T, 0.001f) * Panel + 1.6f * Strike + 0.9f * Rattle;
			}
		}

		// ------------------------------------------------------------------ Tênis
		struct SqueakRecipe
		{
			float StartHz;
			float EndHz;
			float Seconds;
			float VibratoHz;
			float VibratoDepthHz;
			uint32_t Seed;
		};

		const SqueakRecipe SqueakRecipes[] = {
			{3000.0f, 4200.0f, 0.085f, 38.0f, 50.0f, 801u},
			{3300.0f, 4000.0f, 0.065f, 44.0f, 40.0f, 809u},
			{3550.0f, 3050.0f, 0.100f, 33.0f, 55.0f, 811u},
			{2900.0f, 3900.0f, 0.120f, 41.0f, 45.0f, 821u},
		};

		void RenderSqueak(int Variant, float* Out, int Count)
		{
			const SqueakRecipe& R = SqueakRecipes[Variant];
			NoiseGen Noise(R.Seed);
			NoiseGen JitterNoise(R.Seed * 3u + 5u);
			BiquadFilter Hiss(EFilter::BandPass, R.StartHz, 4.0f);
			float Phase = 0.0f;
			float Jitter = 0.0f;
			for (int Index = 0; Index < Count; ++Index)
			{
				const float T = static_cast<float>(Index) * InvRate;
				const float X = ClampF(T / R.Seconds, 0.0f, 1.0f);
				const float Ease = 1.0f - (1.0f - X) * (1.0f - X); // varre rápido no começo e assenta
				Jitter += (JitterNoise.Next() - Jitter) * 0.01f;    // aspereza da borracha (FM lenta)
				const float Hz = R.StartHz + (R.EndHz - R.StartHz) * Ease
					+ R.VibratoDepthHz * std::sin(TwoPiF * R.VibratoHz * T) + 400.0f * Jitter;
				Phase += TwoPiF * Hz * InvRate;
				Hiss.Design(EFilter::BandPass, Hz, 4.0f);
				const float Tone = std::sin(Phase) + 0.25f * std::sin(2.0f * Phase) + 0.08f * std::sin(3.0f * Phase);
				const float Grain = 0.85f + 0.15f * std::sin(TwoPiF * 2.0f * R.VibratoHz * T); // stick-slip
				const float Env = Rise(T, 0.008f) * (1.0f - Rise(T - (R.Seconds - 0.02f), 0.02f));
				Out[Index] = Env * Grain * (Tone + 1.2f * Hiss.Process(Noise.Next()));
			}
		}

		// ------------------------------------------------------------------ Ding do green
		void RenderChime(float* Out, int Count)
		{
			for (int Index = 0; Index < Count; ++Index)
			{
				const float T = static_cast<float>(Index) * InvRate;
				const float Attack = T / 0.004f < 1.0f ? T / 0.004f : 1.0f;
				const float First = std::sin(TwoPiF * 1318.5f * T) * std::exp(-T * 7.0f);
				const float Second = T > 0.07f ? std::sin(TwoPiF * 1975.5f * (T - 0.07f)) * std::exp(-(T - 0.07f) * 6.0f) : 0.0f;
				// Mesmo nível de antes (o int16 era gerado com escala 32000).
				Out[Index] = Attack * (0.45f * First + 0.4f * Second) * (32000.0f / 32767.0f);
			}
		}

		// Pico depois da normalização (0 = mantém o nível da receita).
		float PeakTarget(EHoopsSound Sound)
		{
			switch (Sound)
			{
			case EHoopsSound::Bounce: return 0.88f; // +10% de variação de volume ainda cabe sem clipar
			case EHoopsSound::Swish: return 0.85f;
			case EHoopsSound::NetSoft: return 0.75f;
			case EHoopsSound::RimClank: return 0.8f;
			case EHoopsSound::Backboard: return 0.85f;
			case EHoopsSound::Squeak: return 0.32f;
			default: return 0.0f;
			}
		}
	}

	int NumVariants(EHoopsSound Sound)
	{
		switch (Sound)
		{
		case EHoopsSound::Bounce: return 4;
		case EHoopsSound::Swish: return 3;
		case EHoopsSound::NetSoft: return 2;
		case EHoopsSound::RimClank: return 3;
		case EHoopsSound::Backboard: return 2;
		case EHoopsSound::Squeak: return 4;
		case EHoopsSound::GreenChime: return 1;
		default: return 0;
		}
	}

	float ContentSeconds(EHoopsSound Sound, int Variant)
	{
		switch (Sound)
		{
		case EHoopsSound::Bounce: return 0.16f;
		case EHoopsSound::Swish: return 0.55f;
		case EHoopsSound::NetSoft: return 0.45f;
		case EHoopsSound::RimClank: return 0.6f;
		case EHoopsSound::Backboard: return 0.32f;
		case EHoopsSound::Squeak:
			return Variant >= 0 && Variant < NumVariants(Sound) ? Detail::SqueakRecipes[Variant].Seconds + 0.005f : 0.1f;
		case EHoopsSound::GreenChime: return 0.7f;
		default: return 0.0f;
		}
	}

	int NumSamples(EHoopsSound Sound, int Variant)
	{
		return Detail::SecondsToSamples(ContentSeconds(Sound, Variant) + TailPadSeconds);
	}

	void Render(EHoopsSound Sound, int Variant, float* Out, int Num)
	{
		if (!Out || Num <= 0)
		{
			return;
		}
		for (int Index = 0; Index < Num; ++Index)
		{
			Out[Index] = 0.0f;
		}
		const int Variants = NumVariants(Sound);
		if (Variants <= 0)
		{
			return;
		}
		const int Safe = Variant < 0 ? 0 : (Variant >= Variants ? Variants - 1 : Variant);
		const int Content = Detail::SecondsToSamples(ContentSeconds(Sound, Safe));
		const int Count = Content < Num ? Content : Num;

		switch (Sound)
		{
		case EHoopsSound::Bounce: Detail::RenderBounce(Safe, Out, Count); break;
		case EHoopsSound::Swish: Detail::RenderNet(Detail::SwishRecipes[Safe], Out, Count); break;
		case EHoopsSound::NetSoft: Detail::RenderNet(Detail::NetSoftRecipes[Safe], Out, Count); break;
		case EHoopsSound::RimClank: Detail::RenderRim(Safe, Out, Count); break;
		case EHoopsSound::Backboard: Detail::RenderBoard(Safe, Out, Count); break;
		case EHoopsSound::Squeak: Detail::RenderSqueak(Safe, Out, Count); break;
		case EHoopsSound::GreenChime: Detail::RenderChime(Out, Count); break;
		default: break;
		}

		// Fade de 10 ms no fim (a cauda cortada não estala).
		const int Fade = Detail::SecondsToSamples(0.01f);
		for (int Index = 0; Index < Fade && Index < Count; ++Index)
		{
			const float Gain = static_cast<float>(Index) / static_cast<float>(Fade);
			Out[Count - 1 - Index] *= Gain;
		}

		const float Target = Detail::PeakTarget(Sound);
		float Peak = 0.0f;
		for (int Index = 0; Index < Count; ++Index)
		{
			const float Magnitude = std::fabs(Out[Index]);
			Peak = Magnitude > Peak ? Magnitude : Peak;
		}
		const float Scale = Target > 0.0f && Peak > 1e-6f ? Target / Peak : 1.0f;
		for (int Index = 0; Index < Count; ++Index)
		{
			Out[Index] = Detail::ClampF(Out[Index] * Scale, -1.0f, 1.0f);
		}
	}

	const char* Name(EHoopsSound Sound)
	{
		switch (Sound)
		{
		case EHoopsSound::Bounce: return "quique";
		case EHoopsSound::Swish: return "rede";
		case EHoopsSound::NetSoft: return "rede_abafada";
		case EHoopsSound::RimClank: return "aro";
		case EHoopsSound::Backboard: return "tabela";
		case EHoopsSound::Squeak: return "tenis";
		case EHoopsSound::GreenChime: return "ding_green";
		default: return "?";
		}
	}
}
