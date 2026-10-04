// Gera os sons da quadra em WAV para ouvir sem a Unreal (mesmo código do jogo: Source/Garrafao/HoopsAudioSynth.cpp)
// e imprime medidas para conferir as receitas (duração, pico, RMS, centroide, frequência dominante, queda de -20 dB).
//
//   g++ -O2 -std=c++17 -I Source/Garrafao Tools/Audio/ouvir_sons.cpp Source/Garrafao/HoopsAudioSynth.cpp -o /tmp/ouvir_sons
//   /tmp/ouvir_sons /tmp/garrafao-sons
//
// Além de cada variação, gera "sequencia_park.wav": uma posse com drible a ~2,3 quiques/s, cortes, gather, ding,
// aterrissagem e rede (linha do tempo de docs/17 §1.1), depois um arremesso no aro e uma bola solta quicando.
// Os WAVs não vão para o repositório.
#include "HoopsAudioSynth.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <random>
#include <string>
#include <vector>

namespace
{
	constexpr double Pi = 3.14159265358979323846;

	std::vector<float> RenderVariant(EHoopsSound Sound, int Variant)
	{
		std::vector<float> Samples(static_cast<size_t>(HoopsSynth::NumSamples(Sound, Variant)));
		HoopsSynth::Render(Sound, Variant, Samples.data(), static_cast<int>(Samples.size()));
		return Samples;
	}

	void Put16(FILE* File, uint16_t Value) { std::fputc(Value & 0xFF, File); std::fputc(Value >> 8, File); }
	void Put32(FILE* File, uint32_t Value) { Put16(File, Value & 0xFFFF); Put16(File, Value >> 16); }

	bool WriteWav(const std::string& Path, const std::vector<float>& Samples)
	{
		FILE* File = std::fopen(Path.c_str(), "wb");
		if (!File)
		{
			return false;
		}
		const uint32_t Bytes = static_cast<uint32_t>(Samples.size() * 2);
		std::fwrite("RIFF", 1, 4, File); Put32(File, 36 + Bytes); std::fwrite("WAVE", 1, 4, File);
		std::fwrite("fmt ", 1, 4, File); Put32(File, 16); Put16(File, 1); Put16(File, 1);
		Put32(File, HoopsSynth::SampleRateHz); Put32(File, HoopsSynth::SampleRateHz * 2); Put16(File, 2); Put16(File, 16);
		std::fwrite("data", 1, 4, File); Put32(File, Bytes);
		for (float Sample : Samples)
		{
			const float Clamped = Sample < -1.0f ? -1.0f : (Sample > 1.0f ? 1.0f : Sample);
			Put16(File, static_cast<uint16_t>(static_cast<int16_t>(std::lround(Clamped * 32767.0f))));
		}
		std::fclose(File);
		return true;
	}

	double Db(double Value) { return Value > 1e-9 ? 20.0 * std::log10(Value) : -180.0; }

	// Ponderação A aproximada (polos da IEC 61672 por transformada bilinear), normalizada em 1 kHz.
	struct AWeight
	{
		struct OnePole { double B0, B1, A1, X1 = 0.0, Y1 = 0.0; double Run(double X) { const double Y = B0 * X + B1 * X1 - A1 * Y1; X1 = X; Y1 = Y; return Y; } };
		std::vector<OnePole> Stages;
		double Norm = 1.0;

		static OnePole HighPass(double Hz)
		{
			const double K = std::tan(Pi * Hz / HoopsSynth::SampleRateHz);
			return OnePole{1.0 / (1.0 + K), -1.0 / (1.0 + K), (K - 1.0) / (K + 1.0)};
		}
		static OnePole LowPass(double Hz)
		{
			const double K = std::tan(Pi * Hz / HoopsSynth::SampleRateHz);
			return OnePole{K / (1.0 + K), K / (1.0 + K), (K - 1.0) / (K + 1.0)};
		}
		void Reset()
		{
			Stages = {HighPass(20.6), HighPass(20.6), HighPass(107.7), HighPass(737.9), LowPass(12194.0), LowPass(12194.0)};
		}
		AWeight()
		{
			Reset();
			double Peak = 0.0;
			for (int Index = 0; Index < HoopsSynth::SampleRateHz; ++Index)
			{
				const double Y = Run(std::sin(2.0 * Pi * 1000.0 * Index / HoopsSynth::SampleRateHz));
				if (Index > HoopsSynth::SampleRateHz / 2) Peak = std::fmax(Peak, std::fabs(Y));
			}
			Norm = 1.0 / Peak;
			Reset();
		}
		double Run(double X) { for (OnePole& Stage : Stages) X = Stage.Run(X); return X * Norm; }
	};

	struct Stats
	{
		double Seconds, PeakDb, RmsDb, MaxRms50Db, MaxRmsA50Db, CentroidHz, DominantHz, Fall20Ms;
	};

	Stats Measure(const std::vector<float>& Samples, double ContentSeconds)
	{
		Stats Result{};
		const int Count = static_cast<int>(std::lround(ContentSeconds * HoopsSynth::SampleRateHz));
		Result.Seconds = ContentSeconds;
		double Peak = 0.0, Sum = 0.0;
		int PeakIndex = 0;
		for (int Index = 0; Index < Count; ++Index)
		{
			const double V = std::fabs(Samples[Index]);
			if (V > Peak) { Peak = V; PeakIndex = Index; }
			Sum += V * V;
		}
		Result.PeakDb = Db(Peak);
		Result.RmsDb = Db(std::sqrt(Sum / Count));

		// RMS máximo em janela de 50 ms (sem e com ponderação A).
		const int Window = HoopsSynth::SampleRateHz / 20;
		AWeight Weight;
		std::vector<double> Weighted(Samples.size());
		for (size_t Index = 0; Index < Samples.size(); ++Index) Weighted[Index] = Weight.Run(Samples[Index]);
		double Best = 0.0, BestA = 0.0;
		for (int Start = 0; Start + Window <= static_cast<int>(Samples.size()); Start += 64)
		{
			double S = 0.0, SA = 0.0;
			for (int Index = Start; Index < Start + Window; ++Index) { S += Samples[Index] * Samples[Index]; SA += Weighted[Index] * Weighted[Index]; }
			Best = std::fmax(Best, S / Window);
			BestA = std::fmax(BestA, SA / Window);
		}
		Result.MaxRms50Db = Db(std::sqrt(Best));
		Result.MaxRmsA50Db = Db(std::sqrt(BestA));

		// Espectro (DFT direta, janela de Hann) para centroide e pico.
		const int N = Count < 8192 ? Count : 8192;
		double Weighted1 = 0.0, Total = 0.0, BestMag = 0.0;
		Result.DominantHz = 0.0;
		for (int Bin = 1; Bin < N / 2; ++Bin)
		{
			double Re = 0.0, Im = 0.0;
			for (int Index = 0; Index < N; ++Index)
			{
				const double W = 0.5 - 0.5 * std::cos(2.0 * Pi * Index / (N - 1));
				const double Angle = 2.0 * Pi * Bin * Index / N;
				Re += Samples[Index] * W * std::cos(Angle);
				Im -= Samples[Index] * W * std::sin(Angle);
			}
			const double Mag = std::sqrt(Re * Re + Im * Im);
			const double Hz = static_cast<double>(Bin) * HoopsSynth::SampleRateHz / N;
			Weighted1 += Mag * Hz;
			Total += Mag;
			if (Mag > BestMag) { BestMag = Mag; Result.DominantHz = Hz; }
		}
		Result.CentroidHz = Total > 0.0 ? Weighted1 / Total : 0.0;

		// Queda de -20 dB: último instante em que o envelope (máximo em 5 ms) passa de 10% do pico.
		const int Hop = HoopsSynth::SampleRateHz / 200;
		int Last = PeakIndex;
		for (int Start = PeakIndex; Start < Count; Start += Hop)
		{
			double Local = 0.0;
			for (int Index = Start; Index < Start + Hop && Index < Count; ++Index) Local = std::fmax(Local, std::fabs(Samples[Index]));
			if (Local >= Peak * 0.1) Last = Start;
		}
		Result.Fall20Ms = 1000.0 * (Last - PeakIndex) / HoopsSynth::SampleRateHz;
		return Result;
	}

	// Mistura um som na posição Seconds com pitch (reamostragem linear) e ganho, como o jogo faz.
	void MixInto(std::vector<float>& Mix, const std::vector<float>& Sound, double Seconds, double Pitch, double Gain)
	{
		const double Start = Seconds * HoopsSynth::SampleRateHz;
		for (size_t Out = 0;; ++Out)
		{
			const double Source = Out * Pitch;
			const size_t Index = static_cast<size_t>(Source);
			if (Index + 1 >= Sound.size()) break;
			const size_t Target = static_cast<size_t>(Start) + Out;
			if (Target >= Mix.size()) break;
			const double Frac = Source - Index;
			Mix[Target] += static_cast<float>(Gain * (Sound[Index] * (1.0 - Frac) + Sound[Index + 1] * Frac));
		}
	}
}

int main(int Argc, char** Argv)
{
	const std::string Dir = Argc > 1 ? Argv[1] : "/tmp/garrafao-sons";
	if (std::system(("mkdir -p '" + Dir + "'").c_str()) != 0)
	{
		std::fprintf(stderr, "nao consegui criar %s\n", Dir.c_str());
		return 1;
	}

	// Custo da síntese de todas as variações (o jogo faz isso uma vez, no início da partida).
	const auto Start = std::chrono::steady_clock::now();
	size_t TotalSamples = 0;
	for (int Kind = 0; Kind < static_cast<int>(EHoopsSound::Count); ++Kind)
	{
		for (int Variant = 0; Variant < HoopsSynth::NumVariants(static_cast<EHoopsSound>(Kind)); ++Variant)
		{
			TotalSamples += RenderVariant(static_cast<EHoopsSound>(Kind), Variant).size();
		}
	}
	const double Ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - Start).count();
	std::printf("sintese: %zu amostras (%.0f KB em int16) em %.1f ms\n\n", TotalSamples, TotalSamples * 2 / 1024.0, Ms);

	std::vector<std::vector<float>> Bank[static_cast<int>(EHoopsSound::Count)];
	std::printf("%-14s %3s %6s %7s %7s %8s %9s %9s %9s %8s\n", "som", "var", "dur_s", "pico_dB", "rms_dB", "max50_dB", "max50A_dB", "centr_Hz", "domin_Hz", "-20dB_ms");
	for (int Kind = 0; Kind < static_cast<int>(EHoopsSound::Count); ++Kind)
	{
		const EHoopsSound Sound = static_cast<EHoopsSound>(Kind);
		for (int Variant = 0; Variant < HoopsSynth::NumVariants(Sound); ++Variant)
		{
			std::vector<float> Samples = RenderVariant(Sound, Variant);
			const Stats S = Measure(Samples, HoopsSynth::ContentSeconds(Sound, Variant));
			std::printf("%-14s %3d %6.3f %7.1f %7.1f %8.1f %9.1f %9.0f %9.0f %8.0f\n", HoopsSynth::Name(Sound), Variant, S.Seconds,
				S.PeakDb, S.RmsDb, S.MaxRms50Db, S.MaxRmsA50Db, S.CentroidHz, S.DominantHz, S.Fall20Ms);
			WriteWav(Dir + "/" + HoopsSynth::Name(Sound) + "_" + std::to_string(Variant + 1) + ".wav", Samples);
			Bank[Kind].push_back(std::move(Samples));
		}
	}

	// Posse de exemplo, com os volumes padrão do jogo (FHoopsAudioMix) e o sorteio de variação/pitch/volume.
	std::mt19937 Rng(7);
	std::uniform_real_distribution<double> Unit(-1.0, 1.0);
	int LastVariant[static_cast<int>(EHoopsSound::Count)];
	for (int& Value : LastVariant) Value = -1;
	auto Play = [&](std::vector<float>& Mix, EHoopsSound Sound, double Seconds, double Volume, double PitchJitter)
	{
		const int Kind = static_cast<int>(Sound);
		const int Count = static_cast<int>(Bank[Kind].size());
		int Pick = static_cast<int>(Rng() % Count);
		if (Count > 1 && Pick == LastVariant[Kind]) Pick = (Pick + 1) % Count;
		LastVariant[Kind] = Pick;
		MixInto(Mix, Bank[Kind][Pick], Seconds, 1.0 + PitchJitter * Unit(Rng), Volume * (1.0 + 0.1 * Unit(Rng)));
	};
	std::vector<float> Mix(static_cast<size_t>(10.0 * HoopsSynth::SampleRateHz), 0.0f);
	// Volumes padrão (FHoopsAudioMix) x intensidade típica x queda com a distância (aro a ~17 m da câmera = 0,81).
	const double Ball = 1.0 * 0.8, Net = 0.8, Rim = 0.8 * 0.81, Shoes = 0.7, Green = 0.8;
	double Time = 0.2;
	for (int Bounce = 0; Bounce < 8; ++Bounce, Time += 0.43)
	{
		Play(Mix, EHoopsSound::Bounce, Time, Ball, 0.05);
		if (Bounce == 3 || Bounce == 5) Play(Mix, EHoopsSound::Squeak, Time - 0.12, Shoes * 0.6, 0.06); // cortes
	}
	const double Release = Time + 0.55;                                                       // último quique → soltura ≈ 0,6 s
	Play(Mix, EHoopsSound::Squeak, Time - 0.05, Shoes * 0.8, 0.06);                          // plant do gather
	Play(Mix, EHoopsSound::GreenChime, Release, Green, 0.0);                                  // green instantâneo
	Play(Mix, EHoopsSound::Squeak, Release + 0.25, Shoes * 0.9, 0.06);                       // aterrissagem
	Play(Mix, EHoopsSound::Swish, Release + 1.0, Net * 0.81, 0.04);                           // rede ~1 s depois
	Play(Mix, EHoopsSound::Bounce, Release + 1.55, 1.0, 0.05);                                // bola cai do aro no chão
	Play(Mix, EHoopsSound::Bounce, Release + 2.15, 0.84, 0.05);
	const double Miss = Release + 3.2;                                                        // aro e entra
	Play(Mix, EHoopsSound::RimClank, Miss, Rim * 0.8, 0.03);
	Play(Mix, EHoopsSound::NetSoft, Miss + 0.35, Net * 0.81, 0.04);
	Play(Mix, EHoopsSound::Backboard, Miss + 1.6, Rim * 0.9, 0.04);                           // tabela e fora
	Play(Mix, EHoopsSound::RimClank, Miss + 1.85, Rim * 0.6, 0.03);
	double Fall = Miss + 2.5, Gap = 0.62, Speed = 1.0;
	for (int Bounce = 0; Bounce < 6; ++Bounce, Fall += Gap, Gap *= 0.76, Speed *= 0.76)
	{
		Play(Mix, EHoopsSound::Bounce, Fall, std::pow(std::fmin(1.0, 9.0 * Speed / 8.5), 0.5), 0.05);
	}
	float Peak = 0.0f;
	for (float Sample : Mix) Peak = std::fmax(Peak, std::fabs(Sample));
	WriteWav(Dir + "/sequencia_park.wav", Mix);
	std::printf("\nsequencia_park.wav: %.1f s, pico %.1f dBFS\nWAVs em %s\n", Mix.size() / double(HoopsSynth::SampleRateHz), Db(Peak), Dir.c_str());
	return 0;
}
