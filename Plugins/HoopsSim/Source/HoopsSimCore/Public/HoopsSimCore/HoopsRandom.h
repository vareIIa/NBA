#pragma once

#include <cstdint>

namespace Hoops
{
	// Gerador determinístico (SplitMix64). Mesma semente => mesma sequência em qualquer plataforma.
	// O dono da semente é a autoridade da partida (servidor/host), para replays e rede.
	class Rng
	{
	public:
		explicit Rng(uint64_t Seed = 0x6A09E667F3BCC909ull) : State(Seed) {}

		uint64_t NextU64()
		{
			uint64_t Z = (State += 0x9E3779B97F4A7C15ull);
			Z = (Z ^ (Z >> 30)) * 0xBF58476D1CE4E5B9ull;
			Z = (Z ^ (Z >> 27)) * 0x94D049BB133111EBull;
			return Z ^ (Z >> 31);
		}

		// Uniforme em [0, 1).
		double NextDouble() { return static_cast<double>(NextU64() >> 11) * (1.0 / 9007199254740992.0); }

		double Range(double MinValue, double MaxValue) { return MinValue + (MaxValue - MinValue) * NextDouble(); }

		bool Chance(double Probability) { return NextDouble() < Probability; }

		uint64_t GetState() const { return State; }

	private:
		uint64_t State;
	};
}
