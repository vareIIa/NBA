// HUD de apoio em HTML/CSS por cima do canvas: medidor de arremesso perto do jogador, nome do drible, dica de
// controles e tela de carregamento. Timing/coverage, nota, box score, takeover, placar e energia ficam no GameHud.
import type { ShotEvaluation, TimingWindows } from '../sim';
import { TimingGrade } from '../sim';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Hud {
  private readonly meter = $('meter');
  private readonly meterFill = $('meter-fill');
  private readonly meterGreen = $('meter-green');
  private readonly meterIdeal = $('meter-ideal');
  private readonly pad = $('pad');
  private readonly move = $('move');
  private readonly loading = $('loading');
  private moveTimer = 0;
  private meterFade = 0;

  /** Escala do medidor: o topo é o ideal + a faixa "leve"; o ideal fica a 80% da altura. */
  private meterScale(windows: TimingWindows): number {
    return 0.8 / windows.idealReleaseMs;
  }

  showMeter(x: number, y: number, holdMs: number, windows: TimingWindows): void {
    const scale = this.meterScale(windows);
    this.meter.style.opacity = '1';
    this.meter.style.transform = `translate(${x + 46}px, ${y - 40}px)`;
    this.meterFill.style.height = `${Math.min(1, holdMs * scale) * 100}%`;
    const greenLow = (windows.idealReleaseMs - windows.perfectHalfMs) * scale;
    const greenHigh = Math.min(1, (windows.idealReleaseMs + windows.perfectHalfMs) * scale);
    this.meterGreen.style.bottom = `${greenLow * 100}%`;
    this.meterGreen.style.height = `${(greenHigh - greenLow) * 100}%`;
    this.meterIdeal.style.bottom = `${windows.idealReleaseMs * scale * 100}%`;
    this.meter.classList.remove('green', 'early', 'late');
    this.meterFade = 0;
  }

  freezeMeter(evaluation: ShotEvaluation): void {
    this.meter.classList.add(
      evaluation.timing === TimingGrade.Green ? 'green' : evaluation.timingOffsetMs < 0 ? 'early' : 'late',
    );
    this.meterFade = 1.2;
  }

  /** Nome do drible que acabou de começar (embaixo, discreto, como o feedback de movimento do jogo de referência). */
  showMove(label: string, detail: string): void {
    this.move.textContent = detail ? `${label} · ${detail}` : label;
    this.move.className = 'show';
    this.moveTimer = 0.9;
  }

  setLoading(text: string | null): void {
    this.loading.textContent = text ?? '';
    this.loading.style.display = text ? 'flex' : 'none';
  }

  update(dt: number, gamepad: boolean): void {
    this.pad.textContent = gamepad
      ? 'Controle: LS move · RT sprint · RS dribles · LT protege · X arremessa · View badges'
      : 'Teclado: WASD move · Shift sprint · setas = Pro Stick · Q protege · Espaço arremessa · B badges';
    if (this.moveTimer > 0) {
      this.moveTimer -= dt;
      if (this.moveTimer <= 0) this.move.className = '';
    }
    if (this.meterFade > 0) {
      this.meterFade -= dt;
      if (this.meterFade <= 0) this.meter.style.opacity = '0';
    }
  }
}
