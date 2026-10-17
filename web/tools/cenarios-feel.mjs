// Cenários da régua do feel (docs/27 §5, Fase 1): sequências de input equivalentes aos trechos do NBA 2K27, só com os
// golpes que já existem. Usados por tools/feel/motor.mjs (verdade do motor) e, através dele, por tools/feel/regua.mjs.
//
// Entrada por quadro de 1/60 s, como em tools/cenarios.mjs: {n: quadros, ...InputState parcial}.
//
// Três tipos:
//  - controle: drible sem comando (parado ou correndo). É a linha de base do corpo e o contrafactual da latência: o
//    laboratório é determinístico, então o mesmo cenário com o comando no quadro k difere do controle só depois de k.
//  - golpe: um comando (flick do Pro Stick) disparado em três fases do quique da bola, escolhidas no controle (na mão,
//    descendo, subindo). `antes`/`depois` = input mantido antes e depois do comando (LS, RT).
//  - sequencia: cadeia fixa de comandos (ritmo, encadeamento, arranque), medida uma vez.
//
// Bola na mão DIREITA em todos (com a esquerda é o espelho). Mapa do Pro Stick (docs/27 §1): cima = crossover,
// esquerda = entre as pernas, baixo-esquerda = behind the back, direita = hesitação, baixo = step-back; dois toques
// iguais = double cross; toque e o oposto = hesi-cross (switchback). Com RT, cima vira o crossover de ataque.

/** Flick: o stick vai à borda por `n` quadros e volta ao centro (um toque de polegar de ~67 ms). */
export const flick = (proX, proY, extra = {}, n = 4) => [{ n, proX, proY, ...extra }, { n: 1, ...extra }];
export const wait = (n, extra = {}) => [{ n, ...extra }];

const parado = {};
const correndo = { moveY: 1, sprint: true };
// Correndo, o jogador começa mais longe da cesta para não chegar ao aro no meio do cenário (núcleo, m; aro em 0,0).
const longe = [12.0, -0.6];

export const FeelCenarios = {
  // ---------------------------------------------------------------- controles
  drible_parado: { tipo: 'controle', hand: 'r', input: parado, quadros: 260 },
  correndo: { tipo: 'controle', hand: 'r', input: correndo, quadros: 200, place: longe },

  // ---------------------------------------------------------------- golpes (um comando, três fases do quique)
  cross_parado: { tipo: 'golpe', hand: 'r', controle: 'drible_parado', comando: flick(0, 1), depois: 75, trecho2k: 'E-E I1/I4 (crossover parado)' },
  entre_pernas: { tipo: 'golpe', hand: 'r', controle: 'drible_parado', comando: flick(-1, 0), depois: 75, trecho2k: 'E-F §2.1 / E-A (passe entre as pernas)' },
  behind_back: { tipo: 'golpe', hand: 'r', controle: 'drible_parado', comando: flick(-0.71, -0.71), depois: 75, trecho2k: 'E-B / E-D M0 (BTB parado)' },
  hesitacao: { tipo: 'golpe', hand: 'r', controle: 'drible_parado', comando: flick(1, 0), depois: 75, trecho2k: 'E-E I1/I8 (pausa/hesitação)' },
  // Dois toques para cima em ~83 ms = DoubleThrow -> DoubleCross (troca o crossover do 1º toque antes do 1º quique).
  double_cross: { tipo: 'golpe', hand: 'r', controle: 'drible_parado', comando: [...flick(0, 1), ...flick(0, 1)], depois: 90, trecho2k: 'E-F §2.3 (double cross combo)' },
  // Direita e logo a esquerda = Switchback -> HesiCross.
  hesi_cross: { tipo: 'golpe', hand: 'r', controle: 'drible_parado', comando: [...flick(1, 0), ...flick(-1, 0)], depois: 90, trecho2k: 'E-F §2.2 (hesi-cross combo)' },
  step_back: { tipo: 'golpe', hand: 'r', controle: 'drible_parado', comando: flick(0, -1), depois: 80, trecho2k: 'E-C (step-back do SGA)' },
  // Correndo com RT (como no 2K: tudo com turbo). Com RT o toque para cima é o crossover de ataque; o BTB ignora o RT.
  btb_correndo: { tipo: 'golpe', hand: 'r', controle: 'correndo', input: correndo, comando: flick(-0.71, -0.71, correndo), depois: 60, place: longe, trecho2k: 'E-D (BTB correndo)' },
  cross_correndo: { tipo: 'golpe', hand: 'r', controle: 'correndo', input: correndo, comando: flick(0, 1, correndo), depois: 60, place: longe, trecho2k: 'E-D (cruzamento correndo)' },

  // ---------------------------------------------------------------- sequências (ritmo e encadeamento)
  // Crossovers em sequência no ritmo de I4 no 2K: um cruzamento a cada 10 q de 30 fps = um toque a cada 20 quadros de
  // 60 Hz. Mais rápido que isso dois toques iguais em 0,3 s viram double cross (HoopsProStick.comboGapSeconds).
  cross_seguidos: {
    tipo: 'sequencia',
    hand: 'r',
    steps: [...wait(40), ...[0, 1, 2, 3, 4, 5].flatMap(() => [...flick(0, 1), ...wait(15)]), ...wait(60)],
    trecho2k: 'E-E I4 (crossover em sequência)',
  },
  // Double BTB (C6 no 2K): BTB e logo o BTB da outra mão (baixo-esquerda, depois baixo-direita), sem pausa: o 2º toque
  // chega 13 quadros depois do 1º, com a bola ainda no 1º (espera como pendente até ela voltar à mão).
  btb_btb: { tipo: 'sequencia', hand: 'r', steps: [...wait(40), ...flick(-0.71, -0.71), ...wait(8), ...flick(0.71, -0.71), ...wait(80)], trecho2k: 'E-B (double BTB)' },
  // Arranque e parada com a bola: parado, LS + RT para a frente por 1,2 s, solta.
  arranque_parada: { tipo: 'sequencia', hand: 'r', steps: [...wait(30), ...wait(72, correndo), ...wait(60)], place: longe, trecho2k: 'E-D (arranque e parada correndo)' },
};

/** Fases do quique em que cada golpe é disparado (escolhidas no controle; ver motor.mjs). */
export const FasesDoQuique = ['mao', 'descendo', 'subindo'];
