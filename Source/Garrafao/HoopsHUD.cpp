#include "HoopsHUD.h"

#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "HoopsPlayerCharacter.h"

namespace
{
	const FLinearColor PanelColor(0.0f, 0.0f, 0.0f, 0.55f);
	const FLinearColor GreenColor(0.20f, 1.0f, 0.35f, 1.0f);
	const FLinearColor GoodColor(1.0f, 0.85f, 0.2f, 0.85f);
	const FLinearColor DimText(0.8f, 0.8f, 0.8f, 1.0f);

	// Escala do medidor: a barra cheia vale 1,3 (o ponto ideal fica em 1/1,3 da altura).
	constexpr float MeterScale = 1.3f;
}

void AHoopsHUD::DrawHUD()
{
	Super::DrawHUD();

	const AHoopsPlayerCharacter* HoopsPlayer = Cast<AHoopsPlayerCharacter>(GetOwningPawn());
	if (!HoopsPlayer || !Canvas)
	{
		return;
	}
	const FHoopsHudData& Data = HoopsPlayer->GetHudData();

	UFont* Small = GEngine->GetSmallFont();
	UFont* Medium = GEngine->GetMediumFont();
	UFont* Large = GEngine->GetLargeFont();
	const float W = static_cast<float>(Canvas->SizeX);
	const float H = static_cast<float>(Canvas->SizeY);

	// ---------------- Medidor de arremesso (ao lado do jogador)
	// Durante o arremesso enche até o ponto ideal (2K23). Depois da soltura fica ~1 s congelado onde você soltou,
	// com a cor do resultado; no green pisca em verde forte e aparece "GREEN!".
	const double SinceResult = Data.Now - Data.ResultTime;
	const bool bShowResult = !Data.bShowMeter && SinceResult >= 0.0 && SinceResult < 1.0;
	if (Data.bShowMeter || bShowResult)
	{
		const FVector Screen = Project(Data.MeterWorldAnchor);
		const float BarW = 12.0f;
		const float BarH = 150.0f;
		const float X = static_cast<float>(Screen.X);
		const float Bottom = static_cast<float>(Screen.Y) + BarH * 0.5f;

		auto YFor = [Bottom, BarH](float Fill) { return Bottom - FMath::Clamp(Fill / MeterScale, 0.0f, 1.0f) * BarH; };

		const bool bGreenFlash = bShowResult && Data.Now - Data.GreenTime < 1.0;
		const float Pulse = bGreenFlash ? 0.5f + 0.5f * FMath::Cos(static_cast<float>(SinceResult) * 18.0f) : 0.0f;
		const FLinearColor Frame = bGreenFlash ? FLinearColor(0.2f, 1.0f, 0.35f, 0.35f + 0.5f * Pulse) : PanelColor;
		const float Grow = bGreenFlash ? 4.0f * Pulse : 0.0f;
		DrawRect(Frame, X - 3.0f - Grow, Bottom - BarH - 3.0f - Grow, BarW + 6.0f + 2.0f * Grow, BarH + 6.0f + 2.0f * Grow);
		// Faixa "boa" e faixa green.
		DrawRect(GoodColor, X, YFor(Data.GoodEnd), BarW, YFor(Data.GoodStart) - YFor(Data.GoodEnd));
		DrawRect(GreenColor, X, YFor(Data.GreenEnd), BarW, FMath::Max(2.0f, YFor(Data.GreenStart) - YFor(Data.GreenEnd)));
		// Preenchimento: ao vivo durante o arremesso; congelado (cor do resultado) depois da soltura.
		const float Fill = Data.bShowMeter ? Data.MeterFill : Data.ResultFill;
		const FLinearColor FillColor = Data.bShowMeter ? FLinearColor(1.0f, 1.0f, 1.0f, 0.9f) : Data.ResultColor;
		const float FillTop = YFor(Fill);
		DrawRect(FillColor, X + 3.0f, FillTop, BarW - 6.0f, Bottom - FillTop);
		// Marca do ponto ideal.
		DrawRect(FLinearColor::White, X - 6.0f, YFor(1.0f) - 1.0f, BarW + 12.0f, 2.0f);

		if (bGreenFlash)
		{
			// "GREEN!" subindo e sumindo ao lado do medidor.
			const float Rise = static_cast<float>(SinceResult) * 40.0f;
			const float Alpha = FMath::Clamp(1.4f - static_cast<float>(SinceResult) * 1.4f, 0.0f, 1.0f);
			const float TextScale = 1.6f + 0.25f * Pulse;
			DrawText(TEXT("GREEN!"), FLinearColor(0.0f, 0.0f, 0.0f, 0.6f * Alpha), X + 24.0f, YFor(1.0f) - 22.0f - Rise, Large, TextScale);
			DrawText(TEXT("GREEN!"), FLinearColor(0.25f, 1.0f, 0.4f, Alpha), X + 22.0f, YFor(1.0f) - 24.0f - Rise, Large, TextScale);
		}
	}

	// ---------------- Feedback do arremesso (canto superior direito, como no 2K23)
	if (Data.bShowFeedback)
	{
		const float PanelW = 430.0f;
		const float X = W - PanelW - 30.0f;
		const float Y = 30.0f;
		DrawRect(PanelColor, X, Y, PanelW, 92.0f);
		DrawText(Data.FeedbackTiming, Data.FeedbackColor, X + 14.0f, Y + 8.0f, Large, 1.0f);
		DrawText(Data.FeedbackCoverage, FLinearColor::White, X + 14.0f, Y + 44.0f, Medium, 1.0f);
		DrawText(Data.FeedbackDetail, DimText, X + 14.0f, Y + 68.0f, Small, 1.0f);
	}

	// ---------------- Sessão (topo esquerdo)
	const float Pct = Data.Attempts > 0 ? 100.0f * static_cast<float>(Data.Makes) / static_cast<float>(Data.Attempts) : 0.0f;
	DrawRect(PanelColor, 20.0f, 20.0f, 560.0f, 74.0f);
	DrawText(FString::Printf(TEXT("FREESTYLE  |  %s"), *Data.SpotName), FLinearColor::White, 32.0f, 26.0f, Medium, 1.0f);
	DrawText(FString::Printf(TEXT("Cestas %d/%d (%.0f%%)   Greens %d   Sequencia %d (melhor %d)"),
		Data.Makes, Data.Attempts, Pct, Data.Greens, Data.Streak, Data.BestStreak), DimText, 32.0f, 50.0f, Small, 1.0f);
	const FString TimeLabel = Data.TimeScale < 0.99f ? FString::Printf(TEXT("   |   CAMERA LENTA %.0f%%"), Data.TimeScale * 100.0f) : FString();
	DrawText(FString::Printf(TEXT("Defensor: %s%s"), *Data.DummyLabel, *TimeLabel), DimText, 32.0f, 70.0f, Small, 1.0f);

	// ---------------- Versão e corpo (topo, centro): mostra na hora se o boneco animado carregou.
	{
		const FString Status = FString::Printf(TEXT("%s  |  %s"), *Data.BuildLabel, *Data.BodyStatus);
		float StatusW = 0.0f;
		float StatusH = 0.0f;
		GetTextSize(Status, StatusW, StatusH, Small, 1.0f);
		const FLinearColor StatusColor = Data.bBodyAnimated ? DimText : FLinearColor(1.0f, 0.75f, 0.2f, 1.0f);
		if (!Data.bBodyAnimated)
		{
			DrawRect(PanelColor, (W - StatusW) * 0.5f - 10.0f, 6.0f, StatusW + 20.0f, StatusH + 8.0f);
		}
		DrawText(Status, StatusColor, (W - StatusW) * 0.5f, 10.0f, Small, 1.0f);
	}

	// ---------------- Energia (stamina) e drible (embaixo à esquerda)
	// Sem Explosões (D13): a barra de energia é o único limitador. Verde > 60%, amarelo > 40%, vermelho abaixo.
	const FLinearColor EnergyColor = Data.Energy > 0.6f ? FLinearColor(0.25f, 0.9f, 0.35f, 1.0f)
		: (Data.Energy > 0.4f ? FLinearColor(1.0f, 0.85f, 0.2f, 1.0f) : FLinearColor(1.0f, 0.3f, 0.25f, 1.0f));
	const float BaseY = H - 90.0f;
	DrawRect(PanelColor, 20.0f, BaseY, 360.0f, 70.0f);
	DrawText(TEXT("ENERGIA"), DimText, 32.0f, BaseY + 8.0f, Small, 1.0f);
	DrawRect(FLinearColor(0.15f, 0.15f, 0.15f, 1.0f), 110.0f, BaseY + 10.0f, 250.0f, 12.0f);
	DrawRect(EnergyColor, 110.0f, BaseY + 10.0f, 250.0f * Data.Energy, 12.0f);
	DrawText(FString::Printf(TEXT("Mao: %s   Combo: %d   %s"),
		Data.bBallInRightHand ? TEXT("direita") : TEXT("esquerda"), Data.ComboCount, *Data.CurrentMove),
		FLinearColor::White, 32.0f, BaseY + 38.0f, Small, 1.0f);

	// Barra de energia embaixo dos pés do jogador (como no 2K).
	const FVector FeetScreen = Project(Data.PlayerWorldLocation - FVector(0.0, 0.0, Data.HalfHeight));
	if (FeetScreen.Z > 0.0)
	{
		const float BarWidth = 70.0f;
		const float X = static_cast<float>(FeetScreen.X) - BarWidth * 0.5f;
		const float Y = static_cast<float>(FeetScreen.Y) + 12.0f;
		DrawRect(FLinearColor(0.0f, 0.0f, 0.0f, 0.6f), X - 2.0f, Y - 2.0f, BarWidth + 4.0f, 8.0f);
		DrawRect(EnergyColor, X, Y, BarWidth * Data.Energy, 4.0f);
	}

	// ---------------- Dica de controles (embaixo à direita)
	const FString Hint = TEXT("X arremesso | RS dribles (segurar baixo = arremesso) | RT sprint | RT+RS cima = enterrada | D-pad: bola / reset / spots | Menu: defensor | L3: camera lenta | View: laboratorio");
	float HintW = 0.0f;
	float HintH = 0.0f;
	GetTextSize(Hint, HintW, HintH, Small, 1.0f);
	DrawText(Hint, DimText, W - HintW - 24.0f, H - 34.0f, Small, 1.0f);

	// ---------------- Laboratório (overlay ligável com View/Tab)
	if (Data.bLabOverlay)
	{
		const float X = 20.0f;
		const float Y = 90.0f;
		const int32 Lines = Data.InputHistory.Num() + Data.LabLines.Num() + 3;
		DrawRect(PanelColor, X, Y, 560.0f, 20.0f * static_cast<float>(Lines) + 16.0f);
		float LineY = Y + 8.0f;
		DrawText(TEXT("LABORATORIO - inputs (mais recente primeiro)"), GreenColor, X + 12.0f, LineY, Small, 1.0f);
		LineY += 20.0f;
		for (const FString& Line : Data.InputHistory)
		{
			DrawText(Line, FLinearColor::White, X + 12.0f, LineY, Small, 1.0f);
			LineY += 20.0f;
		}
		LineY += 10.0f;
		DrawText(TEXT("Ultimo arremesso"), GreenColor, X + 12.0f, LineY, Small, 1.0f);
		LineY += 20.0f;
		for (const FString& Line : Data.LabLines)
		{
			DrawText(Line, DimText, X + 12.0f, LineY, Small, 1.0f);
			LineY += 20.0f;
		}
	}
}
