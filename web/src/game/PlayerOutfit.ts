/**
 * Aparência aplicada num jogador (docs/26-aparencia.md): tom de pele (SkinTone) e roupa (PlayerGear) a partir de um
 * PlayerLook. No menu a aparência muda ao vivo: a pele troca no mesmo quadro (só uniforms); trocar de uniforme ou de
 * tênis baixa as peças novas em segundo plano e veste num quadro só (tira as velhas e põe as novas juntas, sem o
 * jogador aparecer pelado). Mudar só a cor das zonas pinta na hora, sem revestir (GearColors). Pedidos seguidos (o
 * jogador passando pelos tênis com o D-pad) não se acumulam: vale o último.
 *
 * `side` é o uniforme que se veste (casa ou visitante); no 1x1 quem decide é matchWear (PlayerLook.ts).
 */
import type { PlayerAnimator } from '../anim/PlayerAnimator';
import { type PlayerLook, type Side, lookColors, lookGear, sanitizeLook, sideKit } from '../build/PlayerLook';
import { PlayerGear } from './PlayerGear';
import { applySkinTone } from './SkinTone';

export interface OutfitOptions {
  /** Pasta dos assets (padrão 'assets/'). */
  base?: string;
  /** false = sem roupa (?roupa=0): só a pele. */
  clothes?: boolean;
  /** Uniforme que se veste (padrão: o de casa). */
  side?: Side;
}

/** Modelo do uniforme do lado + tênis: o que muda a roupa de lugar (a cor não entra aqui). */
const gearKey = (look: PlayerLook, side: Side): string => `${sideKit(look, side)}|${look.shoes}`;

export class PlayerOutfit {
  /** A roupa vestida agora (null = sem roupa ou não carregou). */
  gear: PlayerGear | null = null;
  private target: PlayerLook;
  private side: Side;
  private skinShown: string | null = null;
  private skinTask: Promise<void> = Promise.resolve();
  private dressedKey = '';
  private running: Promise<void> | null = null;

  private constructor(
    private readonly animator: PlayerAnimator,
    look: PlayerLook,
    private readonly opts: OutfitOptions,
  ) {
    this.target = sanitizeLook(look);
    this.side = opts.side ?? 'casa';
  }

  static async create(animator: PlayerAnimator, look: PlayerLook, opts: OutfitOptions = {}): Promise<PlayerOutfit> {
    const outfit = new PlayerOutfit(animator, look, opts);
    await outfit.apply(look, outfit.side);
    return outfit;
  }

  /** A aparência que o jogador está mostrando (a última pedida, mesmo que a roupa ainda esteja baixando). */
  get look(): PlayerLook {
    return this.target;
  }

  /** O uniforme que está vestido (casa ou visitante). */
  get wearing(): Side {
    return this.side;
  }

  /** Trocando de roupa agora (o menu mostra "vestindo…"). */
  get busy(): boolean {
    return this.running !== null;
  }

  update(dt: number): void {
    this.gear?.update(dt);
  }

  /** Aplica a aparência; resolve quando o jogador estiver com ela (ou com uma pedida depois dela). */
  apply(look: PlayerLook, side: Side = this.side): Promise<void> {
    this.target = sanitizeLook(look);
    this.side = side;
    // Pele: já no mesmo quadro (com o shader instalado, applySkinTone só troca uniforms, sem esperar nada).
    if (this.target.skin !== this.skinShown) {
      this.skinShown = this.target.skin;
      this.skinTask = applySkinTone(this.animator.root, this.target.skin, this.opts.base ?? 'assets/').catch((e: unknown) =>
        console.warn('tom de pele não aplicou', e),
      );
    }
    // Só a cor mudou (mesmo modelo, mesmo tênis): pinta a roupa vestida na hora, sem baixar nem revestir.
    if (this.gear && this.dressedKey === gearKey(this.target, side)) this.gear.paint(lookColors(this.target, side));
    if (!this.running) this.running = this.drain().finally(() => (this.running = null));
    return this.running;
  }

  private async drain(): Promise<void> {
    const base = this.opts.base ?? 'assets/';
    for (;;) {
      const want = this.target;
      const side = this.side;
      const key = gearKey(want, side);
      await this.skinTask; // a 1ª vez baixa as máscaras da pele
      if (this.opts.clothes !== false && key !== this.dressedKey) {
        try {
          const scenes = await PlayerGear.fetch(lookGear(want, base, side));
          // Chegou outra troca enquanto baixava: veste a mais nova (a próxima volta do laço).
          if (gearKey(this.target, this.side) === key) {
            this.gear?.dispose();
            this.gear = PlayerGear.dress(this.animator, scenes, lookColors(this.target, this.side));
            this.dressedKey = key;
          }
        } catch (e) {
          console.warn('roupa não carregou', e);
          this.dressedKey = key; // não tenta de novo em laço; a próxima troca tenta
        }
      }
      if (this.target === want && this.side === side) return;
    }
  }
}
