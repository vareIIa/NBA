// Entrada: controle de Xbox pela Gamepad API (mapeamento "standard") + teclado como alternativa.
// Mapa do jogo de referência (docs/02-controles.md): X = arremesso, RT = sprint, LS = movimento, RS = Pro Stick.

export interface InputState {
  moveX: number; // LS: direita +
  moveY: number; // LS: para cima +
  proX: number; // RS (Pro Stick)
  proY: number;
  shoot: boolean; // X (segurar = gather, soltar = soltura)
  /** Instante (s, relógio performance.now) da última vez que o X mudou: o timing do arremesso vem daqui. */
  shootEdgeTime: number;
  sprint: boolean; // RT
  protect: boolean; // LT (drible baixo de proteção)
  gamepadConnected: boolean;
}

// Índices do mapeamento standard (Xbox): 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu.
const ButtonX = 2;
const ButtonLT = 6;
const ButtonRT = 7;
const DeadZone = 0.18;

const applyDeadZone = (v: number): number => (Math.abs(v) < DeadZone ? 0 : v);

const ShootKeys = ['Space', 'KeyJ'];

export class Input {
  private readonly keys = new Set<string>();
  private shootHeld = false;
  private spinFrames = -1; // E no teclado: gira o Pro Stick virtual (o reconhecedor vê um giro de verdade)
  private shootEdgeTime = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyE' && !e.repeat) this.spinFrames = 0;
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
      shootEdgeTime: this.shootEdgeTime,
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      protect: this.keys.has('KeyQ'),
      gamepadConnected: false,
    };

    if (this.spinFrames >= 0) {
      // 300° no sentido horário em 12 quadros, começando em cima, e volta ao centro.
      const frames = 12;
      if (this.spinFrames <= frames) {
        const deg = 90 - (300 * this.spinFrames) / frames;
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
      const lx = applyDeadZone(pad.axes[0] ?? 0);
      const ly = applyDeadZone(pad.axes[1] ?? 0);
      if (lx !== 0 || ly !== 0) {
        state.moveX = lx;
        state.moveY = -ly; // eixo Y do gamepad cresce para baixo
      }
      state.proX = pad.axes[2] ?? 0;
      state.proY = -(pad.axes[3] ?? 0);
      state.shoot ||= pad.buttons[ButtonX]?.pressed ?? false;
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
