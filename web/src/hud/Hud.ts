// HUD em HTML/CSS por cima do canvas: medidor de arremesso perto do jogador, banner de timing/cobertura,
// energia e placar do treino.
import type { ShotEvaluation, TimingWindows } from '../sim';
import { TimingGrade, coverageGradeLabel, timingGradeLabel } from '../sim';
import type { ShotRecord } from '../game/Freestyle';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Hud {
  private readonly meter = $('meter');
  private readonly meterFill = $('meter-fill');
  private readonly meterGreen = $('meter-green');
  private readonly meterIdeal = $('meter-ideal');
  private readonly banner = $('banner');
  private readonly bannerMain = $('banner-main');
  private readonly bannerSub = $('banner-sub');
  private readonly energyFill = $('energy-fill');
  private readonly stats = $('stats');
  private readonly pad = $('pad');
  private bannerTimer = 0;
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

  showRelease(evaluation: ShotEvaluation): void {
    const green = evaluation.timing === TimingGrade.Green;
    this.setBanner(
      green ? 'GREEN!' : timingGradeLabel(evaluation.timing),
      `${coverageGradeLabel(evaluation.coverage)} · ${evaluation.timingOffsetMs >= 0 ? '+' : ''}${evaluation.timingOffsetMs.toFixed(0)} ms`,
      green ? 'green' : 'neutral',
    );
  }

  showResult(record: ShotRecord, made: number, total: number): void {
    this.setBanner(record.scored ? (record.isThree ? 'CESTA DE 3!' : 'CESTA!') : 'ERROU', record.timing, record.scored ? 'make' : 'miss');
    this.stats.textContent = `Treino: ${made}/${total}`;
  }

  private setBanner(main: string, sub: string, kind: string): void {
    this.bannerMain.textContent = main;
    this.bannerSub.textContent = sub;
    this.banner.className = `show ${kind}`;
    this.bannerTimer = 1.6;
  }

  update(dt: number, energy: number, gamepad: boolean): void {
    this.energyFill.style.width = `${energy * 100}%`;
    this.pad.textContent = gamepad ? 'Controle conectado' : 'Teclado: WASD move · Shift sprint · Espaço arremessa';
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.className = '';
    }
    if (this.meterFade > 0) {
      this.meterFade -= dt;
      if (this.meterFade <= 0) this.meter.style.opacity = '0';
    }
  }
}
