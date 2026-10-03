// Mini framework de testes (sem dependências externas).
#pragma once

#include <cmath>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

namespace HoopsTest
{
	struct TestCase
	{
		const char* Name;
		std::function<void()> Body;
	};

	inline std::vector<TestCase>& Registry()
	{
		static std::vector<TestCase> Tests;
		return Tests;
	}

	inline int& FailureCount()
	{
		static int Count = 0;
		return Count;
	}

	struct Registrar
	{
		Registrar(const char* Name, std::function<void()> Body) { Registry().push_back({Name, std::move(Body)}); }
	};

	inline void ReportFailure(const char* File, int Line, const std::string& Message)
	{
		++FailureCount();
		std::printf("    FALHOU %s:%d: %s\n", File, Line, Message.c_str());
	}
}

#define HOOPS_CONCAT_INNER(A, B) A##B
#define HOOPS_CONCAT(A, B) HOOPS_CONCAT_INNER(A, B)

#define HOOPS_TEST(Name) \
	static void Name(); \
	static HoopsTest::Registrar HOOPS_CONCAT(Name, _Registrar)(#Name, &Name); \
	static void Name()

#define EXPECT_TRUE(Condition) \
	do { if (!(Condition)) { HoopsTest::ReportFailure(__FILE__, __LINE__, "esperado verdadeiro: " #Condition); } } while (0)

#define EXPECT_NEAR(Actual, Expected, Tolerance) \
	do { \
		const double HoopsActual_ = static_cast<double>(Actual); \
		const double HoopsExpected_ = static_cast<double>(Expected); \
		if (std::fabs(HoopsActual_ - HoopsExpected_) > static_cast<double>(Tolerance)) { \
			char HoopsBuffer_[256]; \
			std::snprintf(HoopsBuffer_, sizeof(HoopsBuffer_), "%s = %.6f, esperado %.6f (±%.6f)", #Actual, HoopsActual_, HoopsExpected_, static_cast<double>(Tolerance)); \
			HoopsTest::ReportFailure(__FILE__, __LINE__, HoopsBuffer_); \
		} \
	} while (0)

#define EXPECT_RANGE(Actual, MinValue, MaxValue) \
	do { \
		const double HoopsActual_ = static_cast<double>(Actual); \
		if (HoopsActual_ < static_cast<double>(MinValue) || HoopsActual_ > static_cast<double>(MaxValue)) { \
			char HoopsBuffer_[256]; \
			std::snprintf(HoopsBuffer_, sizeof(HoopsBuffer_), "%s = %.6f fora de [%.6f, %.6f]", #Actual, HoopsActual_, static_cast<double>(MinValue), static_cast<double>(MaxValue)); \
			HoopsTest::ReportFailure(__FILE__, __LINE__, HoopsBuffer_); \
		} \
	} while (0)
