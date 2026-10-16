// Mixamo -> juntas por quadro (Fase 2 da fluidez).
//   node tools/mixamo-bake.mjs <saída.json> <arquivo.fbx>=<nome> [<arquivo.fbx>=<nome> ...] [--extra <juntas.json>]
// --extra: clipes que o FBXLoader não abre (algumas diagonais do Soccer Game Pack), extraídos pelo Blender com
// Tools/Animacao/mixamo_juntas_blender.py (mesma ordem de juntas, cm, Y para cima, 60 Hz).
//
// Lê cada FBX (esqueleto mixamorig, sem malha), toca a animação a 60 quadros/s e grava a posição no mundo das juntas que
// o retarget usa (Retarget.ts: só direções, as proporções continuam as do nosso jogador). Também grava a altura da
// perna do esqueleto de origem (para escalar a altura do quadril) e o deslocamento do quadril (velocidade nativa).
// O FBX bruto não sai daqui: o que vai para o jogo é este JSON derivado (a licença do Mixamo proíbe redistribuir o bruto).
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const Fps = 60;
// Papel -> osso do mixamorig (sem o prefixo; o FBXLoader tira o ':').
export const Joints = {
  hips: 'Hips', spine: 'Spine', spine1: 'Spine1', spine2: 'Spine2', neck: 'Neck', head: 'Head', headTop: 'HeadTop_End',
  shL: 'LeftArm', elL: 'LeftForeArm', wrL: 'LeftHand', handL: 'LeftHandMiddle1',
  shR: 'RightArm', elR: 'RightForeArm', wrR: 'RightHand', handR: 'RightHandMiddle1',
  hipL: 'LeftUpLeg', kneeL: 'LeftLeg', ankL: 'LeftFoot', ballL: 'LeftToeBase', toeL: 'LeftToe_End',
  hipR: 'RightUpLeg', kneeR: 'RightLeg', ankR: 'RightFoot', ballR: 'RightToeBase', toeR: 'RightToe_End',
};

const argv = process.argv.slice(2);
const extraAt = argv.indexOf('--extra');
const extraFile = extraAt >= 0 ? argv.splice(extraAt, 2)[1] : null;
const [out, ...specs] = argv;
if (!out || (specs.length === 0 && !extraFile)) {
  console.error('uso: node tools/mixamo-bake.mjs <saída.json> <arquivo.fbx>=<nome> ...');
  process.exit(1);
}
const loader = new FBXLoader();
const result = { fonte: 'Mixamo (Adobe), retarget por direções; ver docs/18', fps: Fps, juntas: Object.keys(Joints), clipes: {} };
for (const spec of specs) {
  const eq = spec.lastIndexOf('=');
  const file = spec.slice(0, eq);
  const name = spec.slice(eq + 1);
  const buf = readFileSync(file);
  const group = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const clip = group.animations[0];
  if (!clip) throw new Error(`${file}: sem animação`);
  const bones = new Map();
  group.traverse((o) => {
    const short = o.name.replace(/^mixamorig\d*/, '');
    if (!bones.has(short)) bones.set(short, o);
  });
  for (const [role, b] of Object.entries(Joints)) if (!bones.has(b)) throw new Error(`${file}: falta ${b} (${role})`);
  const mixer = new THREE.AnimationMixer(group);
  const action = mixer.clipAction(clip);
  action.play();
  const n = Math.max(2, Math.round(clip.duration * Fps) + 1);
  const frames = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    action.time = Math.min(clip.duration, i / Fps);
    mixer.update(0);
    group.updateMatrixWorld(true);
    frames.push(Object.values(Joints).map((b) => bones.get(b).getWorldPosition(v).toArray().map((x) => Math.round(x * 1e4) / 1e4)));
  }
  // Comprimento da perna (quadril -> joelho -> tornozelo) no primeiro quadro: escala da altura do quadril.
  const J = Object.keys(Joints);
  const p = (f, role) => new THREE.Vector3(...frames[f][J.indexOf(role)]);
  const leg = p(0, 'hipL').distanceTo(p(0, 'kneeL')) + p(0, 'kneeL').distanceTo(p(0, 'ankL'));
  const d = p(n - 1, 'hips').sub(p(0, 'hips'));
  result.clipes[name] = { arquivo: file.split(/[\\/]/).pop(), duracao: clip.duration, perna: leg, desloc: [d.x, d.z], quadros: frames };
  console.log(`${name}: ${n} quadros, ${clip.duration.toFixed(2)} s, perna ${leg.toFixed(1)}, anda ${Math.hypot(d.x, d.z).toFixed(1)} (unidades do FBX)`);
}
if (extraFile) {
  const J = Object.keys(Joints);
  for (const [name, c] of Object.entries(JSON.parse(readFileSync(extraFile, 'utf8')))) {
    const f = c.quadros;
    const p = (i, role) => new THREE.Vector3(...f[i][J.indexOf(role)]);
    const leg = p(0, 'hipL').distanceTo(p(0, 'kneeL')) + p(0, 'kneeL').distanceTo(p(0, 'ankL'));
    const d = p(f.length - 1, 'hips').sub(p(0, 'hips'));
    result.clipes[name] = { arquivo: 'blender', duracao: c.duracao, perna: leg, desloc: [d.x, d.z], quadros: f };
    console.log(`${name} (Blender): ${f.length} quadros, ${c.duracao.toFixed(2)} s, anda ${Math.hypot(d.x, d.z).toFixed(1)}`);
  }
}
writeFileSync(out, JSON.stringify(result));
console.log('ok', out);
