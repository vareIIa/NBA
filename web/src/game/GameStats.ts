// Box score do jogador (o cartão do HUD: PTS, REB, AST, 3P%) e as contagens que os badges e o takeover leem
// (tentativas, sequências de acerto/green). Sem DOM nem three.js.

export interface ShotTally {
  scored: boolean;
  isThree: boolean;
  green: boolean;
}

export class GameStats {
  points = 0;
  rebounds = 0;
  assists = 0;
  fga = 0;
  fgm = 0;
  threePa = 0;
  threePm = 0;
  /** Cestas seguidas (zera no erro). */
  makeStreak = 0;
  /** Erros seguidos (zera na cesta). */
  missStreak = 0;
  /** Solturas green seguidas (zera em qualquer soltura que não seja green). */
  greenStreak = 0;
  greens = 0;

  recordShot(shot: ShotTally): void {
    this.fga++;
    if (shot.isThree) this.threePa++;
    if (shot.scored) {
      this.fgm++;
      this.points += shot.isThree ? 3 : 2;
      if (shot.isThree) this.threePm++;
      this.makeStreak++;
      this.missStreak = 0;
    } else {
      this.missStreak++;
      this.makeStreak = 0;
    }
  }

  /** Chamado na soltura (antes do resultado): o green é conhecido na hora, como no medidor. */
  recordRelease(green: boolean): void {
    if (green) {
      this.greens++;
      this.greenStreak++;
    } else {
      this.greenStreak = 0;
    }
  }

  /** 3P% inteiro (0 sem tentativas), como no cartão do jogo de referência. */
  threePct(): number {
    return this.threePa > 0 ? Math.round((100 * this.threePm) / this.threePa) : 0;
  }
}
