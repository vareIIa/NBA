// Nota de teammate (o losango "B-" do HUD do jogo de referência). Uma pontuação 0..100 que sobe e desce com os
// eventos da jogada; cada evento vira um aviso dourado ("EXCELLENT SHOT RELEASE", "GOOD SHOT SELECTION"...).
// Começa em C, como uma partida nova.
import { clamp } from './HoopsMath';

export enum GradeEvent {
  ExcellentShotRelease, // green
  GoodShotSelection, // arremesso livre/leve dentro da faixa do jogador
  BadShotSelection, // forçado: contestado, muito longe, ou com a posse quase no fim
  MadeShot,
  MadeThree,
  AndOne,
  Assist,
  Rebound,
  Turnover,
  ShotClockViolation,
  VeryLateRelease,
  GoodDefense, // contestação boa / defesa que força erro
  Steal,
  Block,
  AllowedScore, // o seu marcador pontuou
  HeldBallTooLong, // segurou muito tempo sem atacar (fominha)
}

interface GradeEventSpec {
  delta: number; // pontos na escala 0..100
  text: string | null; // aviso no HUD (null = sem aviso)
}

// Peso dos eventos do 2K23 (Dexerto/Diamond Lobby): baixo ±0,5, médio ±1, alto ±2. O 2K não publica os números.
const Specs: Record<GradeEvent, GradeEventSpec> = {
  [GradeEvent.ExcellentShotRelease]: { delta: 0.5, text: 'Excellent Shot Release' },
  [GradeEvent.GoodShotSelection]: { delta: 1.0, text: 'Good Shot Selection' },
  [GradeEvent.BadShotSelection]: { delta: -1.5, text: 'Bad Shot Selection' },
  [GradeEvent.MadeShot]: { delta: 0.3, text: null },
  [GradeEvent.MadeThree]: { delta: 0.4, text: null },
  [GradeEvent.AndOne]: { delta: 1.0, text: 'And One' },
  [GradeEvent.Assist]: { delta: 2.0, text: 'Assist' },
  [GradeEvent.Rebound]: { delta: 1.0, text: 'Rebound' },
  [GradeEvent.Turnover]: { delta: -2.0, text: 'Turnover' },
  [GradeEvent.ShotClockViolation]: { delta: -2.0, text: 'Shot Clock Violation' },
  [GradeEvent.VeryLateRelease]: { delta: -0.3, text: null },
  [GradeEvent.GoodDefense]: { delta: 1.0, text: 'Good Shot Contest' },
  [GradeEvent.Steal]: { delta: 2.0, text: 'Steal' },
  [GradeEvent.Block]: { delta: 2.0, text: 'Block' },
  [GradeEvent.AllowedScore]: { delta: -1.0, text: 'Bad Defense' },
  [GradeEvent.HeldBallTooLong]: { delta: -0.5, text: 'Hold Ball Too Long' },
};

// Limiares da escala (pontuação mínima de cada letra), do maior para o menor.
const Letters: ReadonlyArray<readonly [min: number, letter: string]> = [
  [95, 'A+'],
  [90, 'A'],
  [85, 'A-'],
  [80, 'B+'],
  [75, 'B'],
  [70, 'B-'],
  [65, 'C+'],
  [60, 'C'],
  [55, 'C-'],
  [50, 'D+'],
  [45, 'D'],
  [40, 'D-'],
  [0, 'F'],
];

export const gradeLetterFor = (score: number): string => (Letters.find(([min]) => score >= min) ?? Letters[Letters.length - 1])[1];

export interface GradeChange {
  event: GradeEvent;
  delta: number;
  text: string | null;
  letter: string;
  letterChanged: boolean;
}

export class TeammateGrade {
  score: number;

  constructor(start = 62) {
    this.score = start;
  }

  letter(): string {
    return gradeLetterFor(this.score);
  }

  /** Aplica um evento. As subidas encolhem perto do A+ (é difícil manter A+), as descidas não. */
  apply(event: GradeEvent): GradeChange {
    const spec = Specs[event];
    const before = this.letter();
    const delta = spec.delta > 0 ? spec.delta * clamp((100 - this.score) / 40, 0.25, 1) : spec.delta;
    this.score = clamp(this.score + delta, 0, 100);
    const letter = this.letter();
    return { event, delta, text: spec.text, letter, letterChanged: letter !== before };
  }
}
