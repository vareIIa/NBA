// Badges do NBA 2K23 (next gen): os 64, com os mesmos gatilhos, boosts e nerfs (decisão D16, docs/19-badges-2k23.md).
// Números testados pelo 2KLab onde existem (sourced = true); o resto é estimativa marcada no doc.
//
// Como um badge vira número no nosso modelo:
//  - Boost de arremesso do 2K = pontos percentuais de chance ("+5%"). Somamos os pontos dos badges ativos e
//    convertemos UMA vez para log-odds na chance base do arremesso: bonus = logit(p0 + pp) − logit(p0). É o que o
//    ShotContext.badgeBonus recebe. No 2K23 os badges NÃO aumentam a janela green: eles sobem a chance dentro dela.
//  - Badges que tiram uma fração de uma penalidade (Amped, Deadeye, Limitless Range) devolvem log-odds direto.
//  - Drible: multiplicadores do DribbleController (energia, arranque, velocidade dos movimentos).
//  - O resto (passe, rebote, post, roubo, defesa) fica com o valor por nível acessível em value()/tier(), para os
//    sistemas que ainda não existem lerem quando chegarem (status 'pending').
import { clamp, logitOf } from './HoopsMath';
import { ShotType, TimingGrade } from './HoopsShotModel';

export enum BadgeTier {
  None = 0,
  Bronze = 1,
  Silver = 2,
  Gold = 3,
  HallOfFame = 4,
}

export type BadgeCategory = 'Finishing' | 'Shooting' | 'Playmaking' | 'Defense';
/** Comunidade (2KLab, tier lists): meta = todo mundo usava; situational = build/modo certo; useless = ninguém usava. */
export type BadgeUsage = 'meta' | 'situational' | 'useless';
/** Com que frequência ativava numa partida normal (Park/Rec/1x1). */
export type BadgeFrequency = 'high' | 'medium' | 'rare';
/**
 * live = já ativa no Freestyle; ready = lógica pronta no caminho do arremesso/drible, espera o dado (defensor,
 * bandeja, placar); pending = só o valor por nível, o sistema que consome ainda não existe.
 */
export type BadgeStatus = 'live' | 'ready' | 'pending';

/** [Bronze, Prata, Ouro, Hall of Fame]. */
export type Tier4 = readonly [number, number, number, number];

export type BadgeId =
  // Finishing
  | 'Acrobat'
  | 'AerialWizard'
  | 'BackdownPunisher'
  | 'Bully'
  | 'DreamShake'
  | 'Dropstepper'
  | 'FastTwitch'
  | 'FearlessFinisher'
  | 'GiantSlayer'
  | 'LimitlessTakeoff'
  | 'Masher'
  | 'PostSpinTechnician'
  | 'Posterizer'
  | 'ProTouch'
  | 'RiseUp'
  | 'Slithery'
  // Shooting
  | 'Agent3'
  | 'Amped'
  | 'Blinders'
  | 'CatchAndShoot'
  | 'Claymore'
  | 'ClutchShooter'
  | 'ComebackKid'
  | 'CornerSpecialist'
  | 'Deadeye'
  | 'GreenMachine'
  | 'GuardUp'
  | 'LimitlessRange'
  | 'MiddyMagician'
  | 'SlipperyOffBall'
  | 'SpaceCreator'
  | 'VolumeShooter'
  // Playmaking
  | 'AnkleBreaker'
  | 'BailOut'
  | 'BreakStarter'
  | 'ClampBreaker'
  | 'Dimer'
  | 'FloorGeneral'
  | 'HandlesForDays'
  | 'Hyperdrive'
  | 'KillerCombos'
  | 'MismatchExpert'
  | 'NeedleThreader'
  | 'PostPlaymaker'
  | 'QuickFirstStep'
  | 'SpecialDelivery'
  | 'Unpluckable'
  | 'ViceGrip'
  // Defense / Rebounding
  | 'Anchor'
  | 'AnkleBraces'
  | 'BoxoutBeast'
  | 'BrickWall'
  | 'Challenger'
  | 'ChaseDownArtist'
  | 'Clamps'
  | 'Glove'
  | 'Interceptor'
  | 'Menace'
  | 'OffBallPest'
  | 'PickDodger'
  | 'PogoStick'
  | 'PostLockdown'
  | 'ReboundChaser'
  | 'WorkHorse';

export interface BadgeDef {
  readonly id: BadgeId;
  readonly name: string; // como aparece no HUD (inglês, igual ao 2K)
  readonly category: BadgeCategory;
  readonly trigger: string; // pt-BR
  readonly effect: string; // pt-BR, o que values significa
  readonly values: Tier4;
  readonly sourced: boolean; // true = números testados (2KLab); false = estimativa
  readonly usage: BadgeUsage;
  readonly frequency: BadgeFrequency;
  readonly status: BadgeStatus;
  readonly counteredBy?: readonly BadgeId[];
  readonly needs?: string; // o que falta no jogo para ativar (status != live)
}

const def = (d: BadgeDef): BadgeDef => d;

// prettier-ignore
export const Badges: Readonly<Record<BadgeId, BadgeDef>> = {
  // ------------------------------------------------------------------ Finishing
  Acrobat: def({ id: 'Acrobat', name: 'Acrobat', category: 'Finishing', trigger: 'Bandeja de spin, hop step, euro, cradle, reverse ou troca de mão no ar', effect: '+pp na bandeja acrobática', values: [3, 6, 10, 12], sourced: false, usage: 'situational', frequency: 'medium', status: 'ready', counteredBy: ['Anchor'], needs: 'bandejas com estilo' }),
  AerialWizard: def({ id: 'AerialWizard', name: 'Aerial Wizard', category: 'Finishing', trigger: 'Ponte aérea e putback de rebote ofensivo', effect: '% a mais na janela do alley-oop', values: [10, 20, 30, 40], sourced: false, usage: 'situational', frequency: 'rare', status: 'pending', needs: 'passe e alley-oop' }),
  BackdownPunisher: def({ id: 'BackdownPunisher', name: 'Backdown Punisher', category: 'Finishing', trigger: 'Backdown no garrafão (post up)', effect: '+% de vencer o backdown', values: [8, 15, 22, 30], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', counteredBy: ['BrickWall', 'PostLockdown'], needs: 'jogo de costas (post)' }),
  Bully: def({ id: 'Bully', name: 'Bully', category: 'Finishing', trigger: 'Infiltração com contato, bandeja do Pro Stick no corpo do defensor', effect: '+% de vencer o contato', values: [10, 18, 22, 30], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', counteredBy: ['BrickWall'], needs: 'contato com defensor' }),
  DreamShake: def({ id: 'DreamShake', name: 'Dream Shake', category: 'Finishing', trigger: 'Fintas, shimmy e pump fake no post', effect: '+% de deixar o defensor parado', values: [10, 20, 30, 40], sourced: false, usage: 'useless', frequency: 'rare', status: 'pending', needs: 'post e defensor' }),
  Dropstepper: def({ id: 'Dropstepper', name: 'Dropstepper', category: 'Finishing', trigger: 'Drop step e hop step no post', effect: '+% de passar pelo defensor', values: [5, 10, 15, 20], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', counteredBy: ['PostLockdown'], needs: 'post' }),
  FastTwitch: def({ id: 'FastTwitch', name: 'Fast Twitch', category: 'Finishing', trigger: 'Bandeja/enterrada parado embaixo do aro', effect: '% mais rápida a animação', values: [5, 9, 13, 17], sourced: false, usage: 'meta', frequency: 'high', status: 'pending', counteredBy: ['Anchor', 'PogoStick'], needs: 'finalização parada' }),
  FearlessFinisher: def({ id: 'FearlessFinisher', name: 'Fearless Finisher', category: 'Finishing', trigger: 'Bandeja com contato', effect: '+pp na bandeja contestada com contato (HOF +14 testado)', values: [4, 8, 11, 14], sourced: true, usage: 'meta', frequency: 'high', status: 'ready', needs: 'bandeja com contato' }),
  GiantSlayer: def({ id: 'GiantSlayer', name: 'Giant Slayer', category: 'Finishing', trigger: 'Bandeja contra defensor mais alto', effect: '+pp na bandeja (e menos toco)', values: [3, 5, 8, 10], sourced: false, usage: 'situational', frequency: 'medium', status: 'ready', needs: 'defensor' }),
  LimitlessTakeoff: def({ id: 'LimitlessTakeoff', name: 'Limitless Takeoff', category: 'Finishing', trigger: 'Enterrada na infiltração: sai do chão mais longe', effect: 'pés a mais de distância do salto', values: [0.5, 1, 2, 3], sourced: false, usage: 'meta', frequency: 'medium', status: 'pending', needs: 'enterrada' }),
  Masher: def({ id: 'Masher', name: 'Masher', category: 'Finishing', trigger: 'Finalização no aro sendo 3–4" mais alto que o defensor', effect: '+pp no aro', values: [3, 5, 7, 9], sourced: false, usage: 'useless', frequency: 'rare', status: 'ready', needs: 'defensor' }),
  PostSpinTechnician: def({ id: 'PostSpinTechnician', name: 'Post Spin Technician', category: 'Finishing', trigger: 'Spin no post e spin na infiltração', effect: '+% de passar pelo defensor', values: [5, 10, 15, 25], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', counteredBy: ['PostLockdown'], needs: 'post' }),
  Posterizer: def({ id: 'Posterizer', name: 'Posterizer', category: 'Finishing', trigger: 'Enterrada com contato', effect: '+% de pôster', values: [5, 10, 15, 20], sourced: false, usage: 'meta', frequency: 'medium', status: 'pending', counteredBy: ['Anchor'], needs: 'enterrada com contato' }),
  ProTouch: def({ id: 'ProTouch', name: 'Pro Touch', category: 'Finishing', trigger: 'Bandeja solta Slightly Early, Slightly Late ou Excellent', effect: '+pp contra contestação vermelha (HOF +6 testado; amarela é metade)', values: [2, 3, 4, 6], sourced: true, usage: 'situational', frequency: 'high', status: 'ready', needs: 'bandeja' }),
  RiseUp: def({ id: 'RiseUp', name: 'Rise Up', category: 'Finishing', trigger: 'Enterrada parado no garrafão', effect: '+% de enterrada/pôster', values: [6, 12, 18, 24], sourced: false, usage: 'meta', frequency: 'medium', status: 'pending', counteredBy: ['Anchor'], needs: 'enterrada parada' }),
  Slithery: def({ id: 'Slithery', name: 'Slithery', category: 'Finishing', trigger: 'Gather e finalização no meio do tráfego', effect: '+% de escapar do contato (e −% de roubo no gather)', values: [10, 20, 30, 40], sourced: false, usage: 'meta', frequency: 'high', status: 'pending', needs: 'contato e roubo no gather' }),

  // ------------------------------------------------------------------ Shooting
  Agent3: def({ id: 'Agent3', name: 'Agent 3', category: 'Shooting', trigger: 'Bola de 3 saindo do drible: pull-up, stop-and-pop, de 3 andando, depois de um drible do Pro Stick (não step-back)', effect: '+pp no centro da janela (Ouro/HOF sobem mais nas bordas)', values: [1, 5, 5, 7], sourced: true, usage: 'meta', frequency: 'high', status: 'live', counteredBy: ['Challenger'] }),
  Amped: def({ id: 'Amped', name: 'Amped', category: 'Shooting', trigger: 'Arremesso com menos de 50% de energia', effect: '% da penalidade de cansaço removida (a soltura lenta continua)', values: [25, 50, 75, 100], sourced: false, usage: 'situational', frequency: 'medium', status: 'live' }),
  Blinders: def({ id: 'Blinders', name: 'Blinders', category: 'Shooting', trigger: 'Defensor fechando pela visão periférica (lado ou costas)', effect: '+pp (empilha com Deadeye)', values: [2, 4, 6, 9], sourced: false, usage: 'meta', frequency: 'high', status: 'ready', counteredBy: ['Challenger'], needs: 'defensor' }),
  CatchAndShoot: def({ id: 'CatchAndShoot', name: 'Catch and Shoot', category: 'Shooting', trigger: 'Arremesso logo depois de receber o passe (~1,5 s), parado', effect: '+pp (testado: +2,5 / +5 / +8 / +10)', values: [2.5, 5, 8, 10], sourced: true, usage: 'situational', frequency: 'high', status: 'live', counteredBy: ['Challenger'] }),
  Claymore: def({ id: 'Claymore', name: 'Claymore', category: 'Shooting', trigger: 'Spot-up parado: cresce quanto mais tempo parado (1 s → 3 s)', effect: '+pp no máximo', values: [2, 4, 6, 8], sourced: false, usage: 'situational', frequency: 'medium', status: 'live' }),
  ClutchShooter: def({ id: 'ClutchShooter', name: 'Clutch Shooter', category: 'Shooting', trigger: 'Fim de jogo apertado (Park: um time com 15+ e diferença ≤ 8)', effect: '+pp (testado: Bronze ~+2, HOF ~+5)', values: [2, 3, 4, 5], sourced: true, usage: 'useless', frequency: 'rare', status: 'ready', needs: 'placar contra adversário' }),
  ComebackKid: def({ id: 'ComebackKid', name: 'Comeback Kid', category: 'Shooting', trigger: 'Seu time perdendo por 7 ou mais', effect: '+pp', values: [2, 4, 6, 8], sourced: false, usage: 'useless', frequency: 'rare', status: 'ready', needs: 'placar contra adversário' }),
  CornerSpecialist: def({ id: 'CornerSpecialist', name: 'Corner Specialist', category: 'Shooting', trigger: 'Bola de 3 do canto (fundo da quadra)', effect: '+pp', values: [2, 4, 6, 8], sourced: false, usage: 'situational', frequency: 'rare', status: 'live' }),
  Deadeye: def({ id: 'Deadeye', name: 'Deadeye', category: 'Shooting', trigger: 'Defensor fechando o arremesso', effect: '% da penalidade de contestação removida', values: [15, 30, 45, 60], sourced: false, usage: 'situational', frequency: 'high', status: 'ready', counteredBy: ['Challenger'], needs: 'defensor' }),
  GreenMachine: def({ id: 'GreenMachine', name: 'Green Machine', category: 'Shooting', trigger: '2 solturas Excellent seguidas: vale a partir do 3º arremesso até errar', effect: '+pp (testado: ~+15 no Ouro)', values: [5, 10, 15, 17], sourced: true, usage: 'meta', frequency: 'medium', status: 'live' }),
  GuardUp: def({ id: 'GuardUp', name: 'Guard Up', category: 'Shooting', trigger: 'Defensor perto que não contesta (mão baixa, sem pular)', effect: '+pp', values: [3, 5, 7, 9], sourced: false, usage: 'situational', frequency: 'rare', status: 'ready', needs: 'defensor' }),
  LimitlessRange: def({ id: 'LimitlessRange', name: 'Limitless Range', category: 'Shooting', trigger: 'Bola de 3 bem atrás da linha (~26 pés / 7,9 m ou mais)', effect: '% da penalidade de distância removida', values: [25, 50, 75, 90], sourced: false, usage: 'meta', frequency: 'high', status: 'live' }),
  MiddyMagician: def({ id: 'MiddyMagician', name: 'Middy Magician', category: 'Shooting', trigger: 'Meia distância saindo do drible: pull-up, spin, fadeaway (não perto do aro)', effect: '+pp', values: [3, 5, 7, 9], sourced: false, usage: 'situational', frequency: 'medium', status: 'live' }),
  SlipperyOffBall: def({ id: 'SlipperyOffBall', name: 'Slippery Off-Ball', category: 'Shooting', trigger: 'Correndo sem a bola por bloqueios e tráfego', effect: '−% de ser segurado/trombado', values: [15, 30, 45, 60], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', counteredBy: ['OffBallPest'], needs: 'jogo sem a bola (5x5)' }),
  SpaceCreator: def({ id: 'SpaceCreator', name: 'Space Creator', category: 'Shooting', trigger: 'Arremesso de step-back (e mais desequilíbrio no defensor)', effect: '+pp no step-back', values: [3, 5, 7, 10], sourced: false, usage: 'situational', frequency: 'medium', status: 'live', counteredBy: ['AnkleBraces'] }),
  VolumeShooter: def({ id: 'VolumeShooter', name: 'Volume Shooter', category: 'Shooting', trigger: 'Cresce desde o 1º arremesso do jogo (cesta ou erro); máximo no 5º–6º', effect: '+pp no máximo (testado: HOF ~+10)', values: [4, 6, 8, 10], sourced: true, usage: 'situational', frequency: 'high', status: 'live' }),

  // ------------------------------------------------------------------ Playmaking
  AnkleBreaker: def({ id: 'AnkleBreaker', name: 'Ankle Breaker', category: 'Playmaking', trigger: 'Step-back e dribles quando o defensor cai na finta', effect: '+% de desequilibrar/derrubar', values: [10, 20, 30, 40], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', counteredBy: ['AnkleBraces'], needs: 'defensor' }),
  BailOut: def({ id: 'BailOut', name: 'Bail Out', category: 'Playmaking', trigger: 'Passe no meio do arremesso/bandeja ou saindo da dobra', effect: '−% de passe errado', values: [30, 45, 60, 75], sourced: false, usage: 'situational', frequency: 'rare', status: 'pending', needs: 'passe' }),
  BreakStarter: def({ id: 'BreakStarter', name: 'Break Starter', category: 'Playmaking', trigger: 'Passe longo de saída logo depois do rebote defensivo', effect: '% de recepção limpa (sem badge ~50%)', values: [65, 75, 85, 95], sourced: true, usage: 'meta', frequency: 'medium', status: 'pending', needs: 'rebote e passe' }),
  ClampBreaker: def({ id: 'ClampBreaker', name: 'Clamp Breaker', category: 'Playmaking', trigger: 'Defensor trombando ou no hip ride', effect: 'níveis de Clamps que vence (HOF vence todos)', values: [1, 3, 3, 4], sourced: true, usage: 'meta', frequency: 'high', status: 'pending', needs: 'contato com defensor' }),
  Dimer: def({ id: 'Dimer', name: 'Dimer', category: 'Playmaking', trigger: 'Passe para arremessador livre na meia quadra', effect: '+pp para quem recebe', values: [2, 4, 6, 8], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', needs: 'companheiros' }),
  FloorGeneral: def({ id: 'FloorGeneral', name: 'Floor General', category: 'Playmaking', trigger: 'Em quadra (o dono não ganha nada)', effect: '+atributos ofensivos dos companheiros', values: [1, 2, 3, 4], sourced: true, usage: 'situational', frequency: 'high', status: 'pending', needs: 'companheiros' }),
  HandlesForDays: def({ id: 'HandlesForDays', name: 'Handles for Days', category: 'Playmaking', trigger: 'Dribles seguidos', effect: 'dribles até cansar (sem badge: 4)', values: [4.5, 5, 6.5, 8], sourced: true, usage: 'meta', frequency: 'high', status: 'live' }),
  Hyperdrive: def({ id: 'Hyperdrive', name: 'Hyperdrive', category: 'Playmaking', trigger: 'Dribles do Pro Stick em movimento, atacando', effect: '% mais rápidos', values: [3, 6, 9, 12], sourced: false, usage: 'situational', frequency: 'high', status: 'live', counteredBy: ['Clamps'] }),
  KillerCombos: def({ id: 'KillerCombos', name: 'Killer Combos', category: 'Playmaking', trigger: 'Combos de drible no size-up (parado)', effect: 'desequilíbrios por posse (HOF 2–3; sem badge 0). Não acelera', values: [0.5, 1, 2, 2.5], sourced: true, usage: 'situational', frequency: 'medium', status: 'pending', counteredBy: ['AnkleBraces'], needs: 'defensor' }),
  MismatchExpert: def({ id: 'MismatchExpert', name: 'Mismatch Expert', category: 'Playmaking', trigger: 'Armador marcado por defensor mais alto, 1x1', effect: '+% de passar', values: [5, 10, 15, 20], sourced: false, usage: 'useless', frequency: 'rare', status: 'pending', needs: 'defensor' }),
  NeedleThreader: def({ id: 'NeedleThreader', name: 'Needle Threader', category: 'Playmaking', trigger: 'Passe entre dois defensores (principalmente quicado)', effect: '−% de roubo/desvio', values: [15, 25, 35, 45], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', counteredBy: ['Interceptor'], needs: 'passe' }),
  PostPlaymaker: def({ id: 'PostPlaymaker', name: 'Post Playmaker', category: 'Playmaking', trigger: 'Passe saindo do post ou depois do rebote ofensivo', effect: '+pp para quem recebe', values: [2, 4, 6, 8], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', needs: 'post e passe' }),
  QuickFirstStep: def({ id: 'QuickFirstStep', name: 'Quick First Step', category: 'Playmaking', trigger: 'Arrancada saindo do triple threat ou do size-up', effect: '% menos tempo até a velocidade máxima (testado: 71 → 68/66/65/62 quadros)', values: [4, 7, 8, 12], sourced: true, usage: 'meta', frequency: 'high', status: 'live', counteredBy: ['Clamps'] }),
  SpecialDelivery: def({ id: 'SpecialDelivery', name: 'Special Delivery', category: 'Playmaking', trigger: 'Depois de passes de efeito', effect: '+% de acerto do alley-oop', values: [5, 10, 15, 20], sourced: false, usage: 'situational', frequency: 'rare', status: 'pending', needs: 'passe e alley-oop' }),
  Unpluckable: def({ id: 'Unpluckable', name: 'Unpluckable', category: 'Playmaking', trigger: 'Tentativa de roubo de tapa/alcance do defensor (não de corpo)', effect: '× chance de roubo do defensor', values: [0.85, 0.7, 0.5, 0.4], sourced: false, usage: 'meta', frequency: 'high', status: 'pending', needs: 'roubo de bola' }),
  ViceGrip: def({ id: 'ViceGrip', name: 'Vice Grip', category: 'Playmaking', trigger: 'Logo depois do rebote, da recepção ou de pegar bola solta (~1 s)', effect: '−% de roubo', values: [20, 35, 50, 65], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', needs: 'roubo de bola' }),

  // ------------------------------------------------------------------ Defense / Rebounding
  Anchor: def({ id: 'Anchor', name: 'Anchor', category: 'Defense', trigger: 'Arremessos no aro ou perto dele', effect: '−pp de acerto do atacante no garrafão', values: [-4, -7, -10, -14], sourced: false, usage: 'meta', frequency: 'high', status: 'ready', needs: 'defensor no garrafão' }),
  AnkleBraces: def({ id: 'AnkleBraces', name: 'Ankle Braces', category: 'Defense', trigger: 'Dribles do atacante', effect: '−% de ser desequilibrado', values: [15, 30, 45, 60], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', needs: 'defensor' }),
  BoxoutBeast: def({ id: 'BoxoutBeast', name: 'Boxout Beast', category: 'Defense', trigger: 'Box out nos dois lados da quadra', effect: '+% de vencer o box out', values: [10, 20, 30, 40], sourced: false, usage: 'meta', frequency: 'high', status: 'pending', counteredBy: ['ReboundChaser'], needs: 'rebote disputado' }),
  BrickWall: def({ id: 'BrickWall', name: 'Brick Wall', category: 'Defense', trigger: 'Corta-luz, defesa de post e contato', effect: '% a mais de resistência no backdown (HOF +100)', values: [25, 50, 75, 100], sourced: true, usage: 'meta', frequency: 'high', status: 'pending', counteredBy: ['PickDodger'], needs: 'contato e corta-luz' }),
  Challenger: def({ id: 'Challenger', name: 'Challenger', category: 'Defense', trigger: 'Contestação no tempo certo num arremesso do perímetro', effect: '−pp de acerto do arremessador', values: [-2, -4, -6, -9], sourced: false, usage: 'meta', frequency: 'high', status: 'ready', needs: 'defensor' }),
  ChaseDownArtist: def({ id: 'ChaseDownArtist', name: 'Chase Down Artist', category: 'Defense', trigger: 'Perseguindo o atacante por trás para o toco', effect: '+% de velocidade/salto', values: [3, 6, 9, 12], sourced: false, usage: 'useless', frequency: 'rare', status: 'pending', needs: 'toco' }),
  Clamps: def({ id: 'Clamps', name: 'Clamps', category: 'Defense', trigger: 'Defesa na bola: cut-off, trombada, hip ride', effect: 'quadros do cut-off (Bronze 38 → HOF 31)', values: [38, 36, 34, 31], sourced: true, usage: 'meta', frequency: 'high', status: 'pending', counteredBy: ['ClampBreaker'], needs: 'defesa na bola' }),
  Glove: def({ id: 'Glove', name: 'Glove', category: 'Defense', trigger: 'Roubo no drible, no tapa e no gather', effect: '× chance de roubo', values: [1.1, 1.3, 1.6, 1.65], sourced: false, usage: 'meta', frequency: 'high', status: 'pending', counteredBy: ['Unpluckable', 'Slithery', 'ViceGrip'], needs: 'roubo de bola' }),
  Interceptor: def({ id: 'Interceptor', name: 'Interceptor', category: 'Defense', trigger: 'Linhas de passe', effect: '× desvios e interceptações', values: [1.2, 1.4, 1.6, 1.8], sourced: false, usage: 'meta', frequency: 'medium', status: 'pending', counteredBy: ['NeedleThreader', 'BreakStarter'], needs: 'passe' }),
  Menace: def({ id: 'Menace', name: 'Menace', category: 'Defense', trigger: 'Defesa colada de frente (fora do garrafão)', effect: '−atributos do atacante', values: [-1, -2, -3, -4], sourced: false, usage: 'useless', frequency: 'medium', status: 'pending', needs: 'defensor' }),
  OffBallPest: def({ id: 'OffBallPest', name: 'Off-Ball Pest', category: 'Defense', trigger: 'Marcando sem a bola', effect: '−% de separação do atacante', values: [10, 20, 30, 40], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', needs: 'jogo sem a bola' }),
  PickDodger: def({ id: 'PickDodger', name: 'Pick Dodger', category: 'Defense', trigger: 'Passando pelo corta-luz (LT segurado)', effect: '% de sucesso (testado: +6/+4/+4/+18 por nível; HOF 72% sem Brick Wall)', values: [30, 34, 38, 72], sourced: true, usage: 'meta', frequency: 'high', status: 'pending', counteredBy: ['BrickWall'], needs: 'corta-luz' }),
  PogoStick: def({ id: 'PogoStick', name: 'Pogo Stick', category: 'Defense', trigger: 'Pousando depois de rebote, toco ou arremesso', effect: '−% de espera para o 2º salto', values: [10, 20, 30, 40], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', needs: 'salto e rebote' }),
  PostLockdown: def({ id: 'PostLockdown', name: 'Post Lockdown', category: 'Defense', trigger: 'Roubo no início do movimento de post do atacante', effect: '+% de roubo no post', values: [5, 10, 15, 20], sourced: false, usage: 'situational', frequency: 'medium', status: 'pending', needs: 'post' }),
  ReboundChaser: def({ id: 'ReboundChaser', name: 'Rebound Chaser', category: 'Defense', trigger: 'Arremessos errados', effect: '+% de raio de busca do rebote', values: [10, 20, 30, 40], sourced: false, usage: 'meta', frequency: 'high', status: 'pending', counteredBy: ['BoxoutBeast'], needs: 'rebote' }),
  WorkHorse: def({ id: 'WorkHorse', name: 'Work Horse', category: 'Defense', trigger: 'Bolas soltas', effect: '+% de velocidade e de recuperar a bola', values: [5, 10, 15, 20], sourced: false, usage: 'situational', frequency: 'rare', status: 'pending', needs: 'bola solta' }),
};

export const AllBadgeIds = Object.keys(Badges) as BadgeId[];

export const badgeTierName = (tier: BadgeTier): 'Bronze' | 'Silver' | 'Gold' | 'HallOfFame' =>
  tier >= BadgeTier.HallOfFame ? 'HallOfFame' : tier === BadgeTier.Gold ? 'Gold' : tier === BadgeTier.Silver ? 'Silver' : 'Bronze';

/** Badges equipados e o nível de cada um. */
export type BadgeLoadout = Partial<Record<BadgeId, BadgeTier>>;

// ------------------------------------------------------------------ situações

export type LayupStyle = 'normal' | 'spin' | 'euro' | 'hop' | 'cradle' | 'reverse';

/** O que o arremessador sabe na soltura (os campos do defensor ficam neutros quando não há defensor). */
export interface ShotSituation {
  type: ShotType;
  timing: TimingGrade;
  isThree: boolean;
  isCorner: boolean;
  distanceMeters: number;
  threePointDistance: number;
  baseProbability: number; // chance base do modelo (p0), para converter pontos percentuais em log-odds
  energy: number; // 0..1
  fatigue: number; // 0..1 (ShotModel.fatigueFromEnergy)
  /** Saiu do drible: pull-up, ou arremessou até ~1 s depois de um drible do Pro Stick. */
  offDribble: boolean;
  /** Step-back (tipo do arremesso ou o último drible foi um step-back/escape step-back). */
  stepBack: boolean;
  /** Segundos desde a recepção do passe (Infinity = não recebeu). */
  secondsSinceCatch: number;
  /** Segundos parado antes do gather (Claymore). */
  stillSeconds: number;
  // Defensor (0/false sem defensor).
  contest: number;
  contestFromSide: boolean; // fechando pelo lado/costas (Blinders)
  defenderNearNoContest: boolean; // perto e de mão baixa (Guard Up)
  defenderHeightDiff: number; // m, defensor − arremessador
  contact: boolean;
  layupStyle: LayupStyle;
  defender: BadgeLoadout | null; // badges do defensor (Challenger, Anchor)
  defenderPerimeterBadgeDrop: boolean; // takeover do defensor: seus badges de arremesso caem um nível
  // Placar.
  clutch: boolean;
  trailingBy: number;
}

export const makeShotSituation = (overrides: Partial<ShotSituation> = {}): ShotSituation => ({
  type: ShotType.SpotUp,
  timing: TimingGrade.Good,
  isThree: false,
  isCorner: false,
  distanceMeters: 5,
  threePointDistance: 7.24,
  baseProbability: 0.45,
  energy: 1,
  fatigue: 0,
  offDribble: false,
  stepBack: false,
  secondsSinceCatch: Infinity,
  stillSeconds: 0,
  contest: 0,
  contestFromSide: false,
  defenderNearNoContest: false,
  defenderHeightDiff: 0,
  contact: false,
  layupStyle: 'normal',
  defender: null,
  defenderPerimeterBadgeDrop: false,
  clutch: false,
  trailingBy: 0,
  ...overrides,
});

/** Pesos do ShotModel que alguns badges devolvem em parte (Amped, Deadeye, Limitless Range). */
export interface ShotWeights {
  fatigueWeight: number;
  contestWeight: number;
  deepPenaltyPerMeter: number;
}

export interface BadgeContribution {
  id: BadgeId;
  owner: 'shooter' | 'defender';
  pp: number; // pontos percentuais (sinal: + ajuda o arremessador)
  logit: number; // log-odds direto
}

export interface ShotBadgeResult {
  /** Vai para ShotContext.badgeBonus (log-odds, já com os nerfs do defensor). */
  badgeBonus: number;
  /** Vai para ShotContext.badgeContestScale. */
  contestScale: number;
  /** Badges do arremessador que ativaram (para o HUD), na ordem de importância. */
  activated: BadgeId[];
  contributions: BadgeContribution[];
}

export interface DribbleSituation {
  sprinting: boolean;
  moving: boolean; // velocidade > ~1 m/s
  /** O drible atual (ou o último) começou parado: size-up / triple threat (Quick First Step). */
  sizeUp: boolean;
}

/** Mesmo formato do DribbleModifiers do núcleo do drible (sem importar o módulo, para não criar ciclo). */
export interface BadgeDribbleModifiers {
  moveEnergyScale: number;
  burstEnergyScale: number;
  sprintDrainScale: number;
  movePlayRate: number;
  burstScale: number;
  speedScale: number;
}

const DeepRangeExtraMeters = 0.6; // igual ao ShotModel: a penalidade de distância começa na linha + 0,6 m
const LimitlessRangeStartMeters = 7.9; // ~26 pés
const CatchWindowSeconds = 1.5;
const OffDribbleClose = 3.0; // abaixo disso é "perto do aro" (Middy Magician não vale)

/** Converte pontos percentuais somados em log-odds na chance p0. */
export function ppToLogit(baseProbability: number, pp: number): number {
  const p0 = clamp(baseProbability, 0.02, 0.98);
  const p1 = clamp(p0 + pp / 100, 0.01, 0.99);
  return logitOf(p1) - logitOf(p0);
}

// ------------------------------------------------------------------ motor

export class BadgeEngine {
  loadout: BadgeLoadout;
  /** Team Badge Boost (takeover de time): +1 nível em tudo enquanto ativo. */
  tierBoost = 0;
  private jumperAttempts = 0;
  private greenStreak = 0;
  private greenMachineArmed = false;

  constructor(loadout: BadgeLoadout = {}) {
    this.loadout = { ...loadout };
  }

  /** Nível efetivo (com o boost do takeover e a queda causada pelo defensor). */
  tier(id: BadgeId, drop = 0): BadgeTier {
    const base = this.loadout[id] ?? BadgeTier.None;
    if (base === BadgeTier.None) return BadgeTier.None;
    return clamp(base + this.tierBoost - drop, BadgeTier.None, BadgeTier.HallOfFame) as BadgeTier;
  }

  has(id: BadgeId): boolean {
    return this.tier(id) !== BadgeTier.None;
  }

  /** Valor do badge no nível efetivo (0 sem o badge). É o que os sistemas futuros leem (status pending). */
  value(id: BadgeId, drop = 0): number {
    const tier = this.tier(id, drop);
    return tier === BadgeTier.None ? 0 : Badges[id].values[tier - 1];
  }

  // ---------------------------------------------------------------- arremesso

  /** Chamar na soltura, depois do timing ser conhecido e antes do ShotModel.evaluate. */
  shotModifiers(s: ShotSituation, w: ShotWeights): ShotBadgeResult {
    const out: BadgeContribution[] = [];
    let contestScale = 1;
    const finishing = s.type === ShotType.Layup || s.type === ShotType.Dunk;
    const jumper = !finishing && s.type !== ShotType.FreeThrow && s.type !== ShotType.Heave;
    const drop = s.defenderPerimeterBadgeDrop && jumper ? 1 : 0;
    const v = (id: BadgeId) => this.value(id, drop);
    const add = (id: BadgeId, pp: number, logit = 0, owner: 'shooter' | 'defender' = 'shooter') => {
      if (pp !== 0 || logit !== 0) out.push({ id, owner, pp, logit });
    };
    const edge = s.timing === TimingGrade.SlightlyEarly || s.timing === TimingGrade.SlightlyLate;
    const usable = s.timing !== TimingGrade.VeryEarly && s.timing !== TimingGrade.VeryLate;
    const beyond = s.distanceMeters - (s.threePointDistance + DeepRangeExtraMeters);

    if (jumper && usable) {
      // Agent 3: 3 saindo do drible (não step-back). Bronze quase nada no centro; Ouro/HOF sobem nas bordas.
      if (s.isThree && s.offDribble && !s.stepBack && this.has('Agent3')) {
        const tier = this.tier('Agent3', drop);
        const center = v('Agent3');
        const edges: Tier4 = [2, 5, 10, 12];
        add('Agent3', edge ? edges[tier - 1] : center);
      }
      // Catch and Shoot: até 1,5 s depois da recepção, parado; não junta com o Limitless Range.
      const deep = s.isThree && s.distanceMeters >= LimitlessRangeStartMeters;
      if (s.secondsSinceCatch <= CatchWindowSeconds && !s.offDribble && !(deep && this.has('LimitlessRange'))) {
        add('CatchAndShoot', v('CatchAndShoot'));
      }
      // Claymore: parado de 1 s (nada) a 3 s (máximo).
      if (!s.offDribble && s.stillSeconds > 1) add('Claymore', v('Claymore') * clamp((s.stillSeconds - 1) / 2, 0, 1));
      if (s.isThree && s.isCorner) add('CornerSpecialist', v('CornerSpecialist'));
      if (!s.isThree && s.distanceMeters >= OffDribbleClose && (s.offDribble || s.type === ShotType.Fadeaway)) {
        add('MiddyMagician', v('MiddyMagician'));
      }
      if (s.stepBack) add('SpaceCreator', v('SpaceCreator'));
      // Volume Shooter: cresce do 1º ao 5º arremesso do jogo.
      add('VolumeShooter', v('VolumeShooter') * clamp(this.jumperAttempts / 5, 0, 1));
      if (this.greenMachineArmed) add('GreenMachine', v('GreenMachine'));
      if (s.clutch) add('ClutchShooter', v('ClutchShooter'));
      if (s.trailingBy >= 7) add('ComebackKid', v('ComebackKid'));
      if (s.contest > 0.02 && s.contestFromSide) add('Blinders', v('Blinders'));
      if (s.defenderNearNoContest && s.contest < 0.1) add('GuardUp', v('GuardUp'));
      if (s.contest > 0.02 && this.has('Deadeye')) {
        const removed = v('Deadeye') / 100;
        contestScale *= 1 - removed;
        add('Deadeye', 0, w.contestWeight * s.contest * removed);
      }
      // Limitless Range: devolve parte da penalidade de distância a partir de ~26 pés.
      if (s.isThree && beyond > 0 && s.distanceMeters >= LimitlessRangeStartMeters) {
        add('LimitlessRange', 0, w.deepPenaltyPerMeter * beyond * (v('LimitlessRange') / 100));
      }
      // Badge do defensor: Challenger num arremesso contestado.
      if (s.defender && s.contest > 0.1) {
        const challenger = tierValue(s.defender, 'Challenger');
        if (challenger) add('Challenger', challenger, 0, 'defender');
      }
    }

    // Amped: arremesso com menos de 50% de energia tira parte da penalidade de cansaço.
    if (!finishing && s.energy < 0.5 && s.fatigue > 0) {
      add('Amped', 0, w.fatigueWeight * s.fatigue * (v('Amped') / 100));
    }

    if (finishing) {
      const heightGap = s.defenderHeightDiff; // + = defensor mais alto
      if (s.type === ShotType.Layup && s.layupStyle !== 'normal') add('Acrobat', v('Acrobat'));
      if (s.contact) add('FearlessFinisher', v('FearlessFinisher'));
      if (s.type === ShotType.Layup && heightGap >= 0.05) add('GiantSlayer', v('GiantSlayer'));
      if (heightGap <= -0.08) add('Masher', v('Masher'));
      if (s.type === ShotType.Layup && s.contest > 0.2 && s.timing !== TimingGrade.VeryEarly && s.timing !== TimingGrade.VeryLate) {
        add('ProTouch', v('ProTouch') * (s.contest > 0.65 ? 1 : 0.5));
      }
      if (s.defender && s.distanceMeters < 3) {
        const anchor = tierValue(s.defender, 'Anchor');
        if (anchor) add('Anchor', anchor, 0, 'defender');
      }
    }

    const pp = out.reduce((sum, c) => sum + c.pp, 0);
    const logit = out.reduce((sum, c) => sum + c.logit, 0);
    const activated = out
      .filter((c) => c.owner === 'shooter' && (c.pp > 0.5 || c.logit > 0.02))
      .sort((a, b) => b.pp + b.logit * 25 - (a.pp + a.logit * 25))
      .map((c) => c.id);
    return { badgeBonus: ppToLogit(s.baseProbability, pp) + logit, contestScale, activated, contributions: out };
  }

  /**
   * Soltura feita (green ou não). Conta a tentativa do Volume Shooter e a sequência do Green Machine. Os dois são de
   * arremesso: bandeja e enterrada (jumper = false) não contam nem quebram a sequência.
   */
  onRelease(green: boolean, jumper = true): void {
    if (!jumper) return;
    this.jumperAttempts++;
    this.greenStreak = green ? this.greenStreak + 1 : 0;
    if (this.greenStreak >= 2) this.greenMachineArmed = true;
  }

  /** Resultado do arremesso: o Green Machine vale até errar um arremesso (bandeja perdida não conta). */
  onShotResult(made: boolean, jumper = true): void {
    if (jumper && !made) {
      this.greenMachineArmed = false;
      this.greenStreak = 0;
    }
  }

  greenMachineActive(): boolean {
    return this.greenMachineArmed && this.has('GreenMachine');
  }

  jumpers(): number {
    return this.jumperAttempts;
  }

  // ---------------------------------------------------------------- drible

  /**
   * Multiplicadores do drible agora. Handles for Days: o custo cai na proporção dos dribles até cansar
   * (4 sem badge → 8 no HOF = metade). Quick First Step: menos quadros até a velocidade máxima = arranque mais forte.
   * Hyperdrive: dribles em movimento mais rápidos.
   */
  dribbleModifiers(s: DribbleSituation): BadgeDribbleModifiers {
    const hfd = this.value('HandlesForDays');
    const qfs = this.value('QuickFirstStep') / 100;
    const hyper = s.moving ? this.value('Hyperdrive') / 100 : 0;
    return {
      moveEnergyScale: hfd > 0 ? 4 / hfd : 1,
      burstEnergyScale: hfd > 0 ? Math.sqrt(4 / hfd) : 1,
      sprintDrainScale: 1,
      movePlayRate: 1 + hyper,
      burstScale: s.sizeUp ? 1 / (1 - qfs) : 1,
      speedScale: 1,
    };
  }

  /** Um drible começou: quais badges agiram nele (para o aviso do HUD). */
  onDribbleMove(s: DribbleSituation & { comboCount: number }): BadgeId[] {
    const ids: BadgeId[] = [];
    if (s.moving && this.has('Hyperdrive')) ids.push('Hyperdrive');
    if (s.comboCount >= 2 && this.has('HandlesForDays')) ids.push('HandlesForDays');
    return ids;
  }

  /** Arranque de saída: o Quick First Step age quando ele sai do size-up / triple threat (parado). */
  onExitBurst(fromSizeUp: boolean): BadgeId[] {
    return fromSizeUp && this.has('QuickFirstStep') ? ['QuickFirstStep'] : [];
  }
}

function tierValue(loadout: BadgeLoadout, id: BadgeId): number {
  const tier = loadout[id] ?? BadgeTier.None;
  return tier === BadgeTier.None ? 0 : Badges[id].values[tier - 1];
}
