// Lote "arena" do HY 3D Studio: cesta oficial, anel da quadra, arena, pessoas (com rig) e acessórios do jogador.
// Gera um .js por conta para colar na aba hy3d.tencent.ai/robots.txt depois de web/tools/hy3d-fila.js.
//
//   node web/tools/hy3d-lote-arena.mjs <pasta-de-saida>
//
// Cada item: n (arquivo no jogo), p (descrição), tipo: 'prop' | 'pessoa' (A-pose + rig) | 'peca' (vestível).
import fs from 'node:fs';
import path from 'node:path';

const Prop =
  'high quality realistic AAA sports game asset, single object, centered, accurate real-world proportions, clean geometry, PBR materials, plain background, no text, no letters, no numbers, no logos, no brand marks, ';
const Pessoa =
  'high quality realistic AAA sports game character, full body, single person, standing in A-pose, arms down at 45 degrees, feet apart, neutral face, accurate human proportions, plain background, no text, no logos, no brand marks, ';
const Peca = 'high quality realistic AAA sports game wearable asset, single item, centered, hollow inside, clean geometry, plain background, no text, no logos, no brand marks, ';

export const Lote = [
  // ---------------------------------------------------------------- cesta oficial (peças separadas)
  { n: 'cesta_base', tipo: 'prop', p: 'professional arena basketball stanchion base unit only, large heavy rectangular base with thick dark navy blue vinyl foam padding wrapped around the front and sides, sloped padded front face, steel chassis, no arm, no backboard' },
  { n: 'cesta_braco', tipo: 'prop', p: 'professional basketball stanchion support boom arm only, thick steel arm rising diagonally then extending forward horizontally, underside wrapped in dark navy blue foam padding, square mounting plate at the front end, no backboard' },
  { n: 'cesta_tabela', tipo: 'prop', p: 'professional basketball backboard only, rectangular clear tempered glass panel, white painted border and small white target rectangle, thin black aluminum frame, dark navy blue foam padding along the bottom edge and lower corners, no rim' },
  { n: 'cesta_aro', tipo: 'prop', p: 'professional breakaway basketball rim only, orange powder coated steel ring with small net hooks underneath, heavy spring loaded breakaway mounting bracket with flat back plate, no net, no backboard' },
  { n: 'cesta_shot_clock', tipo: 'prop', p: 'basketball shot clock unit that sits on top of a backboard, slim black rectangular housing with two large blank dark red LED seven-segment digit windows, thin red LED light strip along the bottom edge, mounting brackets' },
  { n: 'cesta_completa', tipo: 'prop', p: 'complete professional arena basketball hoop system, padded navy blue stanchion base, padded support arm, glass backboard with shot clock on top, orange breakaway rim with white nylon net' },
  // ---------------------------------------------------------------- anel da quadra
  { n: 'mesa_anotacao', tipo: 'prop', p: 'long courtside scorer table for a professional basketball arena, front face is a continuous blank black LED advertising panel, black tabletop with three slim monitors, keyboards, microphones and a buzzer' },
  { n: 'cadeira_banco_time', tipo: 'prop', p: 'single team bench chair for a professional basketball arena, tall padded backrest, thick cushioned seat, upholstered in dark red leather with white piping, polished chrome legs' },
  { n: 'fileira_banco_time', tipo: 'prop', p: 'row of six connected team bench chairs for a professional basketball arena sideline, tall padded dark red leather backrests, cushioned seats, chrome base' },
  { n: 'cooler_bebida', tipo: 'prop', p: 'large orange sports drink cooler jug with white lid and spout, sitting on a small black stand, stack of white paper cups beside it' },
  { n: 'rack_bolas', tipo: 'prop', p: 'black metal basketball ball rack cart on wheels with two sloped shelves holding ten orange basketballs' },
  { n: 'bola_hd', tipo: 'prop', p: 'official size basketball, orange pebbled leather surface, black rubber channel seams, realistic grip texture' },
  { n: 'cadeira_vip', tipo: 'prop', p: 'courtside VIP chair for a basketball arena front row, padded black leather seat and backrest, slim chrome folding frame, premium look' },
  { n: 'fileira_vip', tipo: 'prop', p: 'front row of five padded black leather courtside VIP chairs on a slim chrome frame, premium basketball arena seating' },
  { n: 'mesa_transmissao', tipo: 'prop', p: 'TV broadcast commentator desk at courtside, black desk with blank front panel, two monitors, two headset microphones, laptop, papers and water bottles on top' },
  { n: 'camera_tv_tripe', tipo: 'prop', p: 'professional broadcast television camera on a heavy fluid head tripod, large zoom lens with lens hood, viewfinder, pan bar handles, cables' },
  { n: 'camera_fotografo', tipo: 'prop', p: 'professional sports photography camera with very long white telephoto lens mounted on a black monopod' },
  { n: 'toalhas_dobradas', tipo: 'prop', p: 'neat stack of five folded white cotton sports towels' },
  { n: 'rodo_quadra', tipo: 'prop', p: 'basketball court floor dust mop with wide flat microfiber head and long aluminum handle' },
  { n: 'prancheta_tecnico', tipo: 'prop', p: 'basketball coach whiteboard clipboard with a half court diagram printed in black lines, dry erase marker clipped to the side' },
  { n: 'microfone_entrevista', tipo: 'prop', p: 'handheld TV interview microphone with a blank square cube flag on the handle, black foam windscreen' },
  { n: 'painel_entrevista', tipo: 'prop', p: 'freestanding press conference backdrop wall, wide flat panel with a blank repeating square pattern, black metal feet' },
  { n: 'pulpito_entrevista', tipo: 'prop', p: 'press conference table with black cloth skirt, several microphones on short stands on top, blank front' },
  // ---------------------------------------------------------------- arena (módulos para instanciar)
  { n: 'bloco_arquibancada', tipo: 'prop', p: 'section of arena stadium seating, three stepped concrete rows each with eight red plastic folding stadium seats with cupholders, metal railing at the front, small staircase on one side' },
  { n: 'camarote_vip', tipo: 'prop', p: 'luxury arena skybox suite front, glass window wall with metal handrail, a row of four padded leather seats in front, warm interior lights' },
  { n: 'telao_central', tipo: 'prop', p: 'arena center hung scoreboard, four large blank black video screens facing four directions, octagonal black frame, glowing LED ring strips above and below, rigging cables at the top' },
  { n: 'faixa_led', tipo: 'prop', p: 'long curved LED ribbon board segment for an arena balcony fascia, black frame with blank dark glowing screen' },
  { n: 'banner_campeao', tipo: 'prop', p: 'hanging championship banner made of fabric, dark navy blue with gold trim and fringe, blank gold trophy silhouette in the middle, hanging bar at the top' },
  { n: 'banner_camisa', tipo: 'prop', p: 'hanging retired jersey banner, fabric banner with a large blank basketball jersey shape in red and white, hanging bar at the top' },
  { n: 'refletor_teto', tipo: 'prop', p: 'arena ceiling moving head stage spotlight fixture, black housing with large lens, yoke mount' },
  { n: 'tunel_jogadores', tipo: 'prop', p: 'arena players tunnel entrance, rectangular opening with black padded walls, black curtain drapes at the sides, floor ramp' },
  // ---------------------------------------------------------------- pessoas (A-pose + rig)
  { n: 'torcedor_camisa', tipo: 'pessoa', p: 'young man basketball fan wearing a red basketball jersey over a white t-shirt, blue jeans, white sneakers, short hair' },
  { n: 'torcedora_moletom', tipo: 'pessoa', p: 'young woman basketball fan wearing an oversized grey hoodie, black leggings, white sneakers, hair in a ponytail' },
  { n: 'torcedor_idoso', tipo: 'pessoa', p: 'older man basketball fan with grey hair and glasses, navy polo shirt, khaki pants, brown shoes' },
  { n: 'torcedora_casual', tipo: 'pessoa', p: 'woman basketball fan with curly hair, denim jacket over a white top, black jeans, ankle boots' },
  { n: 'torcedor_bone', tipo: 'pessoa', p: 'man basketball fan wearing a backwards plain cap, graphic-free black t-shirt, cargo shorts, high top sneakers' },
  { n: 'crianca_torcedor', tipo: 'pessoa', p: 'ten year old kid basketball fan wearing an oversized red basketball jersey, shorts, sneakers' },
  { n: 'vip_terno', tipo: 'pessoa', p: 'celebrity courtside VIP man in a stylish tailored burgundy suit, black turtleneck, sunglasses, designer sneakers' },
  { n: 'vip_elegante', tipo: 'pessoa', p: 'celebrity courtside VIP woman in a fashionable cream blazer, wide leg trousers, gold jewelry, heels' },
  { n: 'torcedor_casaco', tipo: 'pessoa', p: 'man basketball fan in a puffer jacket and beanie, dark jeans, boots, short beard' },
  { n: 'torcedora_universitaria', tipo: 'pessoa', p: 'college student woman basketball fan in a plain white team t-shirt, denim shorts, sneakers, braided hair' },
  { n: 'arbitro_1', tipo: 'pessoa', p: 'professional basketball referee, grey short sleeve shirt with black collar and black side panels, black trousers, black shoes, whistle on a lanyard, short hair' },
  { n: 'arbitro_2', tipo: 'pessoa', p: 'professional basketball referee, bald with goatee, grey short sleeve shirt with black collar and black side panels, black trousers, black shoes, whistle on a lanyard' },
  { n: 'tecnico_terno', tipo: 'pessoa', p: 'basketball head coach in a dark navy suit, white shirt, dark tie, black dress shoes, short grey hair' },
  { n: 'tecnico_assistente', tipo: 'pessoa', p: 'basketball assistant coach in a black quarter zip pullover, grey chinos, black sneakers, glasses' },
  { n: 'dancarina', tipo: 'pessoa', p: 'arena dance team member in a sporty red and white athletic dance uniform with crop jacket and track pants, white sneakers, long hair' },
  { n: 'mascote', tipo: 'pessoa', p: 'friendly furry team mascot costume, cartoon bull character with big head and small horns, wearing a red basketball jersey and shorts, big sneakers' },
  { n: 'fotografo', tipo: 'pessoa', p: 'sports photographer wearing a black photographer vest with pockets, black cargo pants, sneakers, credential lanyard' },
  { n: 'seguranca', tipo: 'pessoa', p: 'arena security staff in a black polo shirt and black cargo pants, black boots, earpiece, muscular build' },
  { n: 'ball_boy', tipo: 'pessoa', p: 'teen ball boy in a plain grey t-shirt, black track pants, black sneakers' },
  { n: 'comentarista', tipo: 'pessoa', p: 'TV basketball commentator in a grey suit and open collar shirt, wearing a broadcast headset with microphone' },
  // ---------------------------------------------------------------- acessórios do jogador (vestir.py)
  { n: 'munhequeira', tipo: 'peca', p: 'single basketball wristband sweatband, thick white terry cloth, ring shape' },
  { n: 'faixa_cabeca', tipo: 'peca', p: 'basketball headband sweatband, black terry cloth, wide ring shape' },
  { n: 'manga_compressao', tipo: 'peca', p: 'single basketball arm compression shooting sleeve, black, full arm length, open tube shape' },
  { n: 'joelheira', tipo: 'peca', p: 'basketball padded knee sleeve, black compression fabric with hexagon padding over the knee, open tube shape' },
  { n: 'meia_calca', tipo: 'peca', p: 'basketball three quarter compression tights, black, waistband, legs ending below the knee, open leg holes' },
  { n: 'meia_cano_alto', tipo: 'peca', p: 'single white crew length basketball sock with cushioned sole and ribbed cuff' },
  { n: 'oculos_protecao', tipo: 'peca', p: 'sports protective goggles with clear polycarbonate lens and black elastic strap' },
  { n: 'cabelo_dreads', tipo: 'peca', p: 'hairpiece only, shoulder length black dreadlocks hairstyle as a wig, no face, no head, hollow inside' },
  { n: 'cabelo_afro', tipo: 'peca', p: 'hairpiece only, large rounded black afro hairstyle as a wig, no face, no head, hollow inside' },
  { n: 'cabelo_trancas', tipo: 'peca', p: 'hairpiece only, black cornrow braids hairstyle as a cap shaped wig, no face, no head, hollow inside' },
];

const prefix = { prop: Prop, pessoa: Pessoa, peca: Peca };
const items = Lote.map((it) => ({
  n: it.n,
  geo: prefix[it.tipo] + it.p,
  col: it.p + ', realistic PBR materials, no logos, no text',
  apose: it.tipo === 'pessoa',
  rig: it.tipo === 'pessoa',
}));

// Divide entre as contas equilibrando créditos (pessoa = 3, resto = 2).
const contas = [[], [], []];
const custo = (it) => (it.rig ? 3 : 2);
for (const it of [...items].sort((a, b) => custo(b) - custo(a))) {
  contas.sort((a, b) => a.reduce((s, x) => s + custo(x), 0) - b.reduce((s, x) => s + custo(x), 0))[0].push(it);
}

const out = process.argv[2] ?? '.';
fs.mkdirSync(out, { recursive: true });
contas.forEach((lista, i) => {
  // Versão compacta (prefixos montados na aba): cabe colada no javascript da extensão.
  const compact = lista.map((it) => {
    const src = Lote.find((x) => x.n === it.n);
    return [src.n, src.tipo, src.p];
  });
  const js =
    `const P=${JSON.stringify(prefix)};const L=${JSON.stringify(compact)};\n` +
    `localStorage.fila=JSON.stringify(L.map(([n,t,p])=>({n,geo:P[t]+p,col:p+', realistic PBR materials, no logos, no text',apose:t==='pessoa',rig:t==='pessoa'})));\n`;
  fs.writeFileSync(path.join(out, `conta${i + 1}.js`), js);
  console.log(`conta${i + 1}: ${lista.length} itens, ${lista.reduce((s, x) => s + custo(x), 0)} créditos`);
});
const maior = Math.max(...items.map((i) => i.geo.length));
console.log(`total ${items.length} itens; maior prompt ${maior} caracteres`);
