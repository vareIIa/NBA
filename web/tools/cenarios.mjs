// Cenários do laboratório (usados por laboratorio.mjs e rastro-lab.mjs).
// Entrada por quadro: {n: quadros, ...InputState parcial}. Flick = 4 quadros com o stick e solta.
const flick = (proX, proY, extra = {}) => [{ n: 4, proX, proY, ...extra }, { n: 1, ...extra }];
const sweep = (degrees, frames, extra = {}) =>
  Array.from({ length: frames + 1 }, (_, i) => {
    const deg = 90 - (degrees * i) / frames;
    return { n: 1, proX: Math.cos((deg * Math.PI) / 180), proY: Math.sin((deg * Math.PI) / 180), ...extra };
  }).concat([{ n: 1, ...extra }]);
const wait = (n, extra = {}) => [{ n, ...extra }];

export const Cenarios = {
  parado: { hand: 'r', steps: wait(60) },
  baixo_lt: { hand: 'r', steps: wait(60, { protect: true }) },
  andando: { hand: 'r', steps: wait(80, { moveY: 1 }) },
  correndo_rt: { hand: 'r', steps: wait(70, { moveY: 1, sprint: true }) },
  lado_esquerda: { hand: 'r', steps: wait(60, { moveX: -1 }) },
  lado_direita: { hand: 'r', steps: wait(60, { moveX: 1 }) },
  de_costas: { hand: 'r', steps: wait(70, { moveY: -1 }) },
  crossover: { hand: 'r', steps: [...flick(0, 1), ...wait(50)] },
  crossover_andando: { hand: 'r', steps: [...wait(25, { moveY: 1 }), ...flick(0, 1, { moveY: 1 }), ...wait(45, { moveY: 1 })] },
  crossover_ataque: { hand: 'r', steps: [...wait(25, { moveY: 1, sprint: true }), ...flick(0, 1, { moveY: 1, sprint: true }), ...wait(45, { moveX: -1, sprint: true })] },
  entre_pernas: { hand: 'r', steps: [...flick(-1, 0), ...wait(50)] },
  behind_back: { hand: 'r', steps: [...flick(-0.71, -0.71), ...wait(50)] },
  hesitacao: { hand: 'r', steps: [...flick(1, 0), ...wait(45)] },
  spin: { hand: 'r', steps: [...sweep(300, 12), ...wait(60)] },
  half_spin: { hand: 'r', steps: [...sweep(110, 6), ...wait(55)] },
  step_back: { hand: 'r', steps: [...flick(0, -1), ...wait(55)] },
  size_up: { hand: 'r', steps: [...flick(0, 1), ...wait(22), ...flick(0, 1), ...wait(22), ...flick(1, 0), ...wait(22), ...flick(0, 1), ...wait(40)] },
  troca_auto: { hand: 'l', steps: wait(70, { moveX: 1 }) },
  retreat: { hand: 'r', steps: [...wait(20, { moveY: 1 }), ...wait(60, { moveY: -1 })] },
};
