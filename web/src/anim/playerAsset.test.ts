// Guarda do GLB do jogador (public/assets/hoops_player.glb, gerado por Tools/Animacao/trocar_corpo.py): trocar a malha
// não pode mexer no esqueleto, na altura do bind nem nos tempos dos clipes, que o clips.json e o PlayerAnimator usam.
// Em 16/10/2026 um export saiu com a cena do Blender a 24 quadros/s e todos os clipes ficaram 2,5x mais lentos (o
// arremesso soltava a bola com o braço na cintura): este teste pega isso.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface GltfAccessor {
  count: number;
  min?: number[];
  max?: number[];
}
interface Gltf {
  accessors: GltfAccessor[];
  animations: { name: string; samplers: { input: number }[] }[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  nodes: { name: string }[];
  skins: { joints: number[] }[];
  materials: { name: string }[];
}

function readGlbJson(url: URL): Gltf {
  const buf = readFileSync(url);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as Gltf;
}

const glb = readGlbJson(new URL('../../public/assets/hoops_player.glb', import.meta.url));
const clips = JSON.parse(readFileSync(new URL('../../public/assets/hoops_player.clips.json', import.meta.url), 'utf8')) as {
  fps: number;
  clips: Record<string, { frames: number; duration: number }>;
};

const Bones = [
  'pelvis', 'hip_l', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'hip_r', 'thigh_r', 'calf_r', 'foot_r', 'ball_r',
  'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'palm_l', 'fingers_l', 'thumb_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'palm_r', 'fingers_r', 'thumb_r', 'neck_01', 'neck_02', 'head',
];

describe('hoops_player.glb', () => {
  it('tem os 31 ossos do esqueleto do boneco', () => {
    const names = glb.skins[0].joints.map((j) => glb.nodes[j].name).sort();
    expect(names).toEqual([...Bones].sort());
  });

  it('cada clipe tem os quadros e a duração do clips.json (60 quadros/s)', () => {
    expect(clips.fps).toBe(60);
    const names = new Set(glb.animations.map((a) => a.name));
    expect([...names].sort()).toEqual(Object.keys(clips.clips).sort());
    for (const anim of glb.animations) {
      const info = clips.clips[anim.name];
      const time = glb.accessors[anim.samplers[0].input];
      expect(time.count, anim.name).toBe(info.frames);
      expect(time.max![0] - time.min![0], anim.name).toBeCloseTo(info.duration, 2);
    }
  });

  it('altura do bind de 1,715 m (a escala do jogo, 1,96 m / altura, não muda)', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const prim of glb.meshes.flatMap((m) => m.primitives)) {
      const pos = glb.accessors[prim.attributes.POSITION];
      lo = Math.min(lo, pos.min![1]);
      hi = Math.max(hi, pos.max![1]);
    }
    expect(hi - lo).toBeGreaterThan(1.705);
    expect(hi - lo).toBeLessThan(1.725);
  });

  it('a pele do corpo se chama "Pele" (o PlayerGear procura por esse nome)', () => {
    expect(glb.materials.map((m) => m.name)).toContain('Pele');
  });
});
