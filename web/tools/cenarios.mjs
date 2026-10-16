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
  // Escape (RT + comando do size-up, parado): sai para o lado da mão nova em passos.
  escape_cross: { hand: 'r', steps: [...flick(0, 1, { sprint: true }), ...wait(50, { sprint: true })] },
  escape_entre_pernas: { hand: 'r', steps: [...flick(-1, 0, { sprint: true }), ...wait(50, { sprint: true })] },
  escape_combo: { hand: 'r', steps: [...flick(-1, 0, { sprint: true }), ...wait(26, { sprint: true }), ...flick(1, 0, { sprint: true }), ...wait(26, { sprint: true }), ...flick(-1, 0, { sprint: true }), ...wait(40, { sprint: true })] },
  troca_auto: { hand: 'l', steps: wait(70, { moveX: 1 }) },
  retreat: { hand: 'r', steps: [...wait(20, { moveY: 1 }), ...wait(60, { moveY: -1 })] },

  // Combos com LS + RS juntos, no ritmo de quem joga 2K: o próximo comando entra perto do fim do anterior.
  // Bola na direita: cima = crossover, esquerda = entre as pernas, baixo-esquerda = por trás, direita = hesitação.
  // Na esquerda tudo espelha (direita = entre as pernas, baixo-direita = por trás, esquerda = hesitação).
  combo_size_up: { hand: 'r', steps: [...flick(0, 1), ...wait(20), ...flick(1, 0), ...wait(20), ...flick(-0.71, -0.71), ...wait(20), ...flick(0, 1), ...wait(40)] },
  combo_rapido: { hand: 'r', steps: [...flick(0, 1), ...wait(6), ...flick(1, 0), ...wait(6), ...flick(0, 1), ...wait(6), ...flick(-1, 0), ...wait(50)] },
  corre_cross_corre: { hand: 'r', steps: [...wait(30, { moveY: 1 }), ...flick(0, 1, { moveY: 1 }), ...wait(50, { moveX: -0.7, moveY: 0.7 })] },
  corre_cross_volta: { hand: 'r', steps: [...wait(30, { moveY: 1 }), ...flick(0, 1, { moveY: 1 }), ...wait(18, { moveX: -0.7, moveY: 0.7 }), ...flick(0, 1, { moveX: -0.7, moveY: 0.7 }), ...wait(40, { moveX: 0.7, moveY: 0.7 })] },
  corre_spin: { hand: 'r', steps: [...wait(30, { moveY: 1 }), ...sweep(300, 12, { moveY: 1 }), ...wait(45, { moveY: 1 })] },
  corre_hesi_arranca: { hand: 'r', steps: [...wait(30, { moveY: 1, sprint: true }), ...flick(1, 0, { moveY: 1, sprint: true }), ...wait(45, { moveY: 1, sprint: true })] },
  corre_por_tras: { hand: 'r', steps: [...wait(30, { moveY: 1 }), ...flick(-0.71, -0.71, { moveY: 1 }), ...wait(45, { moveX: -0.7, moveY: 0.7 })] },
  corre_step_back: { hand: 'r', steps: [...wait(30, { moveY: 1 }), ...flick(0, -1, { moveY: 1 }), ...wait(50)] },
  // Entre as pernas em sequência (spam): direita -> esquerda -> direita... A cada troca a base escalonada inverte
  // (tesoura): o pé da mão que recebe vai à frente.
  entre_pernas_combo: { hand: 'r', steps: [...flick(-1, 0), ...wait(18), ...flick(1, 0), ...wait(18), ...flick(-1, 0), ...wait(18), ...flick(1, 0), ...wait(45)] },
  anda_entre_pernas: { hand: 'r', steps: [...wait(30, { moveY: 0.5 }), ...flick(-1, 0, { moveY: 0.5 }), ...wait(45, { moveY: 0.5 })] },
  lado_cross_lado: { hand: 'r', steps: [...wait(30, { moveX: 1 }), ...flick(0, 1, { moveX: 1 }), ...wait(45, { moveX: -1 })] },
  zigue_zague: { hand: 'r', steps: [...wait(25, { moveX: 0.6, moveY: 0.8 }), ...wait(35, { moveX: -0.8, moveY: 0.6 }), ...wait(35, { moveX: 0.8, moveY: 0.6 }), ...wait(35, { moveX: -0.8, moveY: 0.6 })] },
  // Como no jogo: spin correndo e, logo depois, RT (disparo).
  spin_e_dispara: { hand: 'r', steps: [...wait(30, { moveY: 1 }), ...sweep(300, 12, { moveY: 1 }), ...wait(45, { moveY: 1 }), ...wait(60, { moveY: 1, sprint: true })] },
  para_e_cruza: { hand: 'r', steps: [...wait(35, { moveY: 1 }), ...wait(10), ...flick(0, 1), ...wait(45)] },
  // Correndo para a cesta até a linha de fundo (o jogador passa por baixo do aro e para na linha): no jogo, depois do
  // spin correndo, a mão e a bola saltaram até 114 cm aqui. place = posição inicial (núcleo, m; o aro está em 0,0).
  linha_de_fundo: { hand: 'l', place: [2.2, 0.4], steps: wait(110, { moveY: 1, sprint: true }) },
  // Sem bola (fase 'loose' no laboratório): o boneco anda e corre livre. noBall = a bola fica no chão, longe.
  sem_bola_parado: { hand: 'r', noBall: true, steps: wait(60) },
  sem_bola_andando: { hand: 'r', noBall: true, steps: wait(80, { moveY: 1 }) },
  sem_bola_correndo: { hand: 'r', noBall: true, steps: wait(70, { moveY: 1, sprint: true }) },
  sem_bola_lado: { hand: 'r', noBall: true, steps: wait(60, { moveX: 1 }) },
  spin_na_linha: { hand: 'r', place: [2.6, 0.3], steps: [...wait(15, { moveY: 1 }), ...sweep(300, 12, { moveY: 1 }), ...wait(80, { moveY: 1, sprint: true })] },
  // Drible parado e sai correndo (diretor, 2026-10-16: depois do escape e do por trás, um pé ficava preso no chão
  // enquanto o corpo corria). O LS entra no meio do drible (o jogador já quer sair) ou logo depois dele.
  escape_e_corre: { hand: 'r', steps: [...flick(0, 1, { sprint: true }), ...wait(10, { sprint: true }), ...wait(55, { moveY: 1, sprint: true })] },
  escape_e_corre_lado: { hand: 'r', steps: [...flick(0, 1, { sprint: true }), ...wait(10, { sprint: true }), ...wait(55, { moveX: -0.7, moveY: 0.7, sprint: true })] },
  por_tras_e_corre: { hand: 'r', steps: [...flick(-0.71, -0.71), ...wait(10), ...wait(55, { moveY: 1, sprint: true })] },
  por_tras_e_corre_depois: { hand: 'r', steps: [...flick(-0.71, -0.71), ...wait(28), ...wait(50, { moveY: 1, sprint: true })] },
  // Deslize lateral para o lado da mão da bola (o espelho de lado_direita) e um crossover no meio do deslize: os clipes
  // Dribble_Side só quicam com a mão do outro lado (a bola ficava presa na mão).
  lado_esquerda_mao_esq: { hand: 'l', steps: wait(60, { moveX: -1 }) },
  lado_bola_cruza: { hand: 'r', steps: [...wait(30, { moveX: 1 }), ...flick(0, 1, { moveX: 1 }), ...wait(40, { moveX: 1 })] },
  // Física da corrida sem bola (diretor, 2026-10-16: "o pé jogar um pouco pro lado e dar um impulso dele se jogando pro
  // outro lado"): andar devagar, arrancar, parar, virar 180°/150° (a plantada do PlayerAnimator.playPlantTurn), vai-e-volta,
  // zigue-zague e corte de 90°.
  sb_anda_devagar: { hand: 'r', noBall: true, steps: wait(90, { moveY: 0.45 }) },
  sb_arranca: { hand: 'r', noBall: true, steps: [...wait(10), ...wait(60, { moveY: 1, sprint: true })] },
  sb_para: { hand: 'r', noBall: true, steps: [...wait(50, { moveY: 1, sprint: true }), ...wait(50)] },
  sb_vira_180: { hand: 'r', noBall: true, steps: [...wait(55, { moveX: 1 }), ...wait(70, { moveX: -1 })] },
  sb_vira_150: { hand: 'r', noBall: true, steps: [...wait(55, { moveX: 1 }), ...wait(70, { moveX: -0.87, moveY: 0.5 })] },
  sb_vira_dispara: { hand: 'r', noBall: true, steps: [...wait(50, { moveY: 1, sprint: true }), ...wait(80, { moveY: -1, sprint: true })] },
  sb_vai_volta: { hand: 'r', noBall: true, steps: [...wait(50, { moveX: 1 }), ...wait(60, { moveX: -1 }), ...wait(60, { moveX: 1 }), ...wait(40)] },
  sb_zigue: { hand: 'r', noBall: true, steps: [...wait(40, { moveX: 0.7, moveY: 0.7 }), ...wait(35, { moveX: -0.7, moveY: 0.7 }), ...wait(35, { moveX: 0.7, moveY: 0.7 }), ...wait(30, { moveX: -0.7, moveY: 0.7 })] },
  sb_corte_90: { hand: 'r', noBall: true, steps: [...wait(45, { moveY: 1 }), ...wait(55, { moveX: 1 })] },
  // Hesitação correndo sem RT (a de parada: freia, o corpo sobe e arranca); com RT é a escape (corre_hesi_arranca).
  corre_hesi_freia: { hand: 'r', steps: [...wait(30, { moveY: 1 }), ...flick(1, 0, { moveY: 1 }), ...wait(55, { moveY: 1 })] },
};
