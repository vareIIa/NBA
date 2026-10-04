// Síntese dos sons da quadra (docs/17 §1.4 e §6.1, P0-3). C++ puro, sem Unreal: o jogo (HoopsAudio) e a
// ferramenta offline (Tools/Audio/ouvir_sons.cpp, gera WAVs para ouvir sem a engine) usam o mesmo código.
// Tudo sai de fórmulas: nenhuma amostra gravada, nenhum som de terceiros. Mono, 44,1 kHz, float em [-1, 1].
#pragma once

#include <cstdint>

// Sons da quadra. Cada um tem 1 a 4 variações (o jogo sorteia e varia um pouco o pitch e o volume).
enum class EHoopsSound : uint8_t
{
	Bounce,     // quique da bola no taco (drible e bola solta)
	Swish,      // rede: cesta limpa
	NetSoft,    // rede: cesta depois de tocar o aro (mais abafada)
	RimClank,   // aro (metal)
	Backboard,  // tabela (pancada seca)
	Squeak,     // chiado do tênis (plant do gather, corte, aterrissagem)
	GreenChime, // "ding" do green
	Count
};

namespace HoopsSynth
{
	inline constexpr int SampleRateHz = 44100;
	inline constexpr int MaxVariants = 4;
	// Silêncio no fim de cada som: a onda procedural pode deixar de tocar um bloco final incompleto.
	inline constexpr float TailPadSeconds = 0.05f;

	int NumVariants(EHoopsSound Sound);
	// Duração do som em si (sem o silêncio do fim).
	float ContentSeconds(EHoopsSound Sound, int Variant);
	// Amostras a gerar (som + silêncio do fim).
	int NumSamples(EHoopsSound Sound, int Variant);
	// Gera a variação em Out (Num amostras; o que passar do som fica em zero). Pico normalizado por som.
	void Render(EHoopsSound Sound, int Variant, float* Out, int Num);
	const char* Name(EHoopsSound Sound);
}
