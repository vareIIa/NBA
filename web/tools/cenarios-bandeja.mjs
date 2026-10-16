// Cenários de bandeja (tools/bandeja-video.mjs). Coordenadas do núcleo: aro em (0, 0), quadra para +x, linha de fundo em
// x = -1,6. De frente para a cesta (olhando para -x), a direita do jogador é -y: ala direita = y < 0.
// `at` = [x, y] do começo, `hand` = mão da bola. Entrada por quadro de 1/60 s; moveY = 1 é "para a cesta" (a câmera do
// jogo olha para o aro).
const wait = (n, extra = {}) => [{ n, ...extra }];
/** Corre para a cesta e aperta X (toque) no quadro `press`; continua com o LS e solta o X depois de `hold` quadros. */
const drive = (press, total, extra = {}, hold = 6, shootExtra = {}) => [
  ...wait(press, { moveY: 1, ...extra }),
  ...wait(hold, { moveY: 1, shoot: true, ...extra, ...shootExtra }),
  ...wait(total - press - hold, { moveY: 1, ...extra }),
];
/** Corre para a cesta até `dist` m do aro, aperta X por `hold` quadros (segurado = bandeja; toque = hop) e segue com o LS. */
const driveTo = (dist, after = 90, extra = {}, hold = 30, shootExtra = {}) => [
  { n: 400, until: dist, moveY: 1, ...extra },
  ...wait(hold, { moveY: 1, shoot: true, ...extra, ...shootExtra }),
  ...wait(after, { moveY: 1, ...extra }),
];
/** RS segurado numa direção (bandeja pelo Pro Stick) a partir do quadro `press`. */
const stick = (press, total, proX, proY, extra = {}, hold = 14) => [
  ...wait(press, { moveY: 1, ...extra }),
  ...wait(hold, { moveY: 1, proX, proY, ...extra }),
  ...wait(total - press - hold, { moveY: 1, ...extra }),
];

/** Flick do RS (4 quadros na direção e solta). */
const flick = (proX, proY, extra = {}) => [{ n: 4, proX, proY, ...extra }, { n: 1, ...extra }];
/** Hop step do toque: corre até `dist`, toca o X e espera pousar (bola presa). */
const hopTo = (dist) => [{ n: 400, until: dist, moveY: 1 }, ...wait(5, { moveY: 1, shoot: true }), ...wait(40)];

export const CenariosBandeja = {
  // Reprodução do teste do diretor (2026-10-15): LS para frente o tempo todo, toque no X, espera e X segurado.
  diretor_andando: {
    at: [7.4, -0.6],
    hand: 'r',
    steps: [{ n: 400, until: 3.8, moveY: 0.55 }, ...wait(5, { moveY: 0.55, shoot: true }), ...wait(60, { moveY: 0.55 }), ...wait(30, { moveY: 0.55, shoot: true }), ...wait(100, { moveY: 0.55 })],
  },
  diretor_correndo: {
    at: [7.4, -0.6],
    hand: 'r',
    steps: [{ n: 400, until: 3.8, moveY: 1 }, ...wait(5, { moveY: 1, shoot: true }), ...wait(60, { moveY: 1 }), ...wait(30, { moveY: 1, shoot: true }), ...wait(100, { moveY: 1 })],
  },
  // Toque (hop) e o X apertado de novo no ar, segurado: pousa e sobe direto (2K24: aperta e segura de novo depois do hop).
  hop_segura_de_novo: {
    at: [7.4, -0.6],
    hand: 'r',
    steps: [{ n: 400, until: 4.2, moveY: 1 }, ...wait(5, { moveY: 1, shoot: true }), ...wait(12, { moveY: 1 }), ...wait(40, { moveY: 1, shoot: true }), ...wait(100, { moveY: 1 })],
  },
  // Hop lateral: LS para a direita da tela no toque.
  hop_lateral: {
    at: [7.4, -0.6],
    hand: 'r',
    steps: [{ n: 400, until: 4.0, moveY: 1 }, ...wait(5, { moveX: 1, moveY: 0.3, shoot: true }), ...wait(60, { moveX: 1, moveY: 0.3 }), ...wait(30)],
  },
  diretor_longe: {
    at: [8.4, -0.6],
    hand: 'r',
    steps: [{ n: 400, until: 5.2, moveY: 1 }, ...wait(5, { moveY: 1, shoot: true }), ...wait(60, { moveY: 1 }), ...wait(30, { moveY: 1, shoot: true }), ...wait(100, { moveY: 1 })],
  },
  // Bola presa (hop step em fases): jab, jab grande, pump fake e bandeja parada (X segurado).
  hop_jab_bandeja: {
    at: [6.0, -1.2],
    hand: 'r',
    steps: [...hopTo(3.8), ...flick(1, 0), ...wait(32), ...flick(0.71, 0.71), ...wait(40), ...wait(5, { shoot: true }), ...wait(36), ...wait(24, { shoot: true }), ...wait(90)],
  },
  // Pump fake e step-through (X segurado logo depois do fake).
  hop_fake_step: {
    at: [6.0, -1.2],
    hand: 'r',
    steps: [...hopTo(3.8), ...wait(5, { shoot: true }), ...wait(8), ...wait(26, { shoot: true }), ...wait(110)],
  },
  // Pivô reverso (baixo-esquerda) e finalização.
  hop_pivo: {
    at: [6.0, -1.2],
    hand: 'r',
    steps: [...hopTo(3.8), ...flick(-0.71, -0.71), ...wait(45), ...flick(1, 0), ...wait(30), ...wait(24, { shoot: true }), ...wait(90)],
  },
  // Enterradas (RT + X): X curto = enterra e solta; X segurado = fica pendurado no aro até soltar.
  dunk_ala: { at: [5.6, -4.0], hand: 'r', steps: driveTo(4.4, 100, { sprint: true }, 12) },
  dunk_frente: { at: [7.4, -0.4], hand: 'r', steps: driveTo(4.4, 100, { sprint: true }, 12) },
  dunk_pendurado: { at: [5.6, -4.0], hand: 'r', steps: driveTo(4.4, 60, { sprint: true }, 130) },
  dunk_pendurado_frente: { at: [7.4, -0.4], hand: 'l', steps: driveTo(4.4, 60, { sprint: true }, 110) },
  // Cada variação forçada (LayupFinish: 7 uma mão, 8 duas mãos, 9 tomahawk, 10 cock-back, 11 moinho).
  dunk_uma_mao: { at: [5.6, -4.0], hand: 'r', dunk: 7, steps: driveTo(4.4, 90, { sprint: true }, 12) },
  dunk_duas_maos: { at: [5.6, -4.0], hand: 'r', dunk: 8, steps: driveTo(4.4, 90, { sprint: true }, 12) },
  dunk_tomahawk: { at: [5.6, -4.0], hand: 'r', dunk: 9, steps: driveTo(4.4, 90, { sprint: true }, 12) },
  dunk_cockback: { at: [5.6, -4.0], hand: 'r', dunk: 10, steps: driveTo(4.4, 90, { sprint: true }, 12) },
  dunk_moinho: { at: [5.6, -4.0], hand: 'r', dunk: 11, steps: driveTo(4.4, 90, { sprint: true }, 12) },
  dunk_pendurado_duas: { at: [7.4, -0.4], hand: 'r', dunk: 8, steps: driveTo(4.4, 60, { sprint: true }, 120) },
  // Pelo RS (2K23): RT + RS cima = duas mãos; RT + RS baixo segurado = pendura; RS baixo sem RT = floater.
  rs_dunk_cima: { at: [5.6, -4.0], hand: 'r', steps: [{ n: 400, until: 4.0, moveY: 1, sprint: true }, ...wait(14, { moveY: 1, sprint: true, proY: 1 }), ...wait(100, { moveY: 1 })] },
  rs_dunk_pendura: { at: [7.4, -0.4], hand: 'r', steps: [{ n: 400, until: 4.0, moveY: 1, sprint: true }, ...wait(120, { moveY: 1, sprint: true, proY: -1 }), ...wait(70)] },
  rs_dunk_tomahawk: { at: [5.6, -4.0], hand: 'r', steps: [{ n: 400, until: 4.0, moveY: 1, sprint: true }, ...wait(14, { moveY: 1, sprint: true, proX: 0.71, proY: -0.71 }), ...wait(100, { moveY: 1 })] },
  // De frente (topo do garrafão), mão direita, sem RT.
  frente_x: { at: [6.6, -0.4], hand: 'r', steps: driveTo(3.6) },
  // Ala direita (45°) correndo com RT, X no meio do caminho.
  ala_direita_rt: { at: [5.6, -4.0], hand: 'r', steps: driveTo(4.4, 90, { sprint: true }) },
  ala_direita: { at: [5.0, -3.6], hand: 'r', steps: driveTo(3.6) },
  // Ala esquerda (45°), mão esquerda.
  ala_esquerda: { at: [5.0, 3.6], hand: 'l', steps: driveTo(3.6) },
  // Toque no X (hop step) e toque duplo com o LS para a esquerda (euro step).
  hop_toque: { at: [5.6, -2.4], hand: 'r', steps: driveTo(3.5, 90, {}, 6) },
  hop_frente: { at: [5.2, 0], hand: 'r', steps: driveTo(3.6, 90, {}, 5) },
  euro_x2: {
    at: [6.4, -1.0],
    hand: 'r',
    steps: [{ n: 400, until: 3.9, moveY: 1 }, ...wait(5, { moveY: 1, shoot: true }), ...wait(5, { moveY: 1, moveX: -0.7 }), ...wait(5, { moveY: 1, moveX: -0.7, shoot: true }), ...wait(90, { moveY: 1, moveX: -0.7 })],
  },
  // LT segurado: cradle.
  cradle_lt: { at: [5.0, -3.6], hand: 'r', steps: driveTo(3.6, 90, { protect: true }) },
  // Linha de fundo pela direita (corre rente à linha de fundo).
  fundo_direita: { at: [-0.6, -5.5], hand: 'r', steps: driveTo(3.6, 90, { sprint: true }) },
  // Pro Stick: RS segurado para cima (bandeja normal), para baixo (floater), para os lados (scoop), switchback (euro).
  rs_cima: { at: [5.6, -1.8], hand: 'r', steps: [{ n: 400, until: 3.6, moveY: 1 }, ...wait(14, { moveY: 1, proY: 1 }), ...wait(100, { moveY: 1 })] },
  rs_baixo_floater: { at: [6.4, -0.8], hand: 'r', steps: stick(30, 125, 0, -1) },
  rs_lado_scoop: { at: [5.6, -1.8], hand: 'r', steps: [{ n: 400, until: 3.6, moveY: 1 }, ...wait(14, { moveY: 1, proX: 1 }), ...wait(100, { moveY: 1 })] },
};
