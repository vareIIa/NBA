// Entrada: controle de Xbox pela Gamepad API (mapeamento "standard") + teclado como alternativa.
// Mapa do jogo de referência (docs/02-controles.md): X = arremesso, RT = sprint, LS = movimento, RS = Pro Stick.

/** Controle puro, para os menus (sem o teclado, que o menu já lê sozinho). */
export interface PadState {
  lx: number; // LS (com zona morta)
  ly: number; // LS para cima +
  up: boolean; // D-pad
  down: boolean;
  left: boolean;
  right: boolean;
  a: boolean;
  b: boolean;
  start: boolean;
}

export interface InputState {
  moveX: number; // LS: direita +
  moveY: number; // LS: para cima +
  proX: number; // RS (Pro Stick)
  proY: number;
  shoot: boolean; // X (segurar = gather, soltar = soltura)
  call?: boolean; // A (pedir a bola): com a bola solta, ela voa até a mão
  /** Y no controle, K no teclado: na defesa do online, pulo de contestação/toco (e de rebote). */
  contest?: boolean;
  /** P no teclado ou Start no controle: abre o menu de pausa (criador de arremesso). */
  pause?: boolean;
  pad?: PadState;
  /** Instante (s, relógio performance.now) da última vez que o X mudou: o timing do arremesso vem daqui. */
  shootEdgeTime: number;
  sprint: boolean; // RT
  protect: boolean; // LT (drible baixo de proteção)
  gamepadConnected: boolean;
}

// Índices do mapeamento standard (Xbox): 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu.
const ButtonA = 0;
const ButtonB = 1;
const ButtonX = 2;
const ButtonY = 3;
const ButtonStart = 9;
const PadDpad = { up: 12, down: 13, left: 14, right: 15 };
const ButtonLT = 6;
const ButtonRT = 7;
const DeadZone = 0.18;

/** Zona morta circular: conserva a direção e remapeia a amplitude restante para 0..1. */
export function applyRadialDeadZone(x: number, y: number, deadZone = DeadZone): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (length <= deadZone) return { x: 0, y: 0 };
  const scale = (Math.min(length, 1) - deadZone) / ((1 - deadZone) * length);
  return { x: x * scale, y: y * scale };
}

const ShootKeys = ['Space', 'KeyJ'];
const CallKeys = ['KeyF']; // teclado para o A (pedir a bola)
const ContestKeys = ['KeyK']; // teclado para o Y (pulo da defesa), ao lado do J do arremesso
const PauseKeys = ['KeyP']; // Esc fica com os menus (badges e pausa), então a pausa usa P

export class Input {
  private readonly keys = new Set<string>();
  private shootHeld = false;
  private spinFrames = -1; // E no teclado: gira o Pro Stick virtual (o reconhecedor vê um giro de verdade)
  private spinSweep = 300; // E = giro (300°); R = meio giro (110°, half spin)
  private shootEdgeTime = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if ((e.code === 'KeyE' || e.code === 'KeyR') && !e.repeat) {
        this.spinFrames = 0;
        this.spinSweep = e.code === 'KeyE' ? 300 : 110;
      }
      if (ShootKeys.includes(e.code) && !e.repeat && !this.keys.has(e.code)) this.shootEdgeTime = e.timeStamp / 1000;
      this.keys.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      if (ShootKeys.includes(e.code)) this.shootEdgeTime = e.timeStamp / 1000;
      this.keys.delete(e.code);
    });
    target.addEventListener('blur', () => this.keys.clear());
  }

  read(): InputState {
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    const state: InputState = {
      moveX: k('KeyD') - k('KeyA'),
      moveY: k('KeyW') - k('KeyS'),
      proX: k('ArrowRight') - k('ArrowLeft'),
      proY: k('ArrowUp') - k('ArrowDown'),
      shoot: ShootKeys.some((code) => this.keys.has(code)),
      call: CallKeys.some((code) => this.keys.has(code)),
      contest: ContestKeys.some((code) => this.keys.has(code)),
      pause: PauseKeys.some((code) => this.keys.has(code)),
      shootEdgeTime: this.shootEdgeTime,
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      protect: this.keys.has('KeyQ'),
      gamepadConnected: false,
    };

    if (this.spinFrames >= 0) {
      // Giro no sentido horário começando em cima (12 quadros no spin, 6 no meio giro) e volta ao centro.
      const frames = this.spinSweep > 200 ? 12 : 6;
      if (this.spinFrames <= frames) {
        const deg = 90 - (this.spinSweep * this.spinFrames) / frames;
        state.proX = Math.cos((deg * Math.PI) / 180);
        state.proY = Math.sin((deg * Math.PI) / 180);
        this.spinFrames++;
      } else {
        state.proX = 0;
        state.proY = 0;
        this.spinFrames = -1;
      }
    }

    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      state.gamepadConnected = true;
      const { x: lx, y: ly } = applyRadialDeadZone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
      if (lx !== 0 || ly !== 0) {
        state.moveX = lx;
        state.moveY = -ly; // eixo Y do gamepad cresce para baixo
      }
      state.proX = pad.axes[2] ?? 0;
      state.proY = -(pad.axes[3] ?? 0);
      state.shoot ||= pad.buttons[ButtonX]?.pressed ?? false;
      state.call ||= pad.buttons[ButtonA]?.pressed ?? false;
      state.contest ||= pad.buttons[ButtonY]?.pressed ?? false;
      state.pad = {
        lx,
        ly,
        up: pad.buttons[PadDpad.up]?.pressed ?? false,
        down: pad.buttons[PadDpad.down]?.pressed ?? false,
        left: pad.buttons[PadDpad.left]?.pressed ?? false,
        right: pad.buttons[PadDpad.right]?.pressed ?? false,
        a: pad.buttons[ButtonA]?.pressed ?? false,
        b: pad.buttons[ButtonB]?.pressed ?? false,
        start: pad.buttons[ButtonStart]?.pressed ?? false,
      };
      state.pause ||= state.pad.start;
      state.sprint ||= (pad.buttons[ButtonRT]?.value ?? 0) > 0.3;
      state.protect ||= (pad.buttons[ButtonLT]?.value ?? 0) > 0.3;
      break;
    }

    // Controle: a Gamepad API só é lida por quadro, então a borda do X é o instante da leitura.
    if (state.shoot !== this.shootHeld) {
      if (state.gamepadConnected && Math.abs(this.shootEdgeTime - performance.now() / 1000) > 0.05) {
        this.shootEdgeTime = performance.now() / 1000;
      }
      this.shootHeld = state.shoot;
    }
    state.shootEdgeTime = this.shootEdgeTime;

    const len = Math.hypot(state.moveX, state.moveY);
    if (len > 1) {
      state.moveX /= len;
      state.moveY /= len;
    }
    return state;
  }
}
