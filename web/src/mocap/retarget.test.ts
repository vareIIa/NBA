// Pé do Mixamo no nosso esqueleto (Retarget.retargetMixamo, footSlopeRest): com o pé plano na fonte, o nosso também fica
// plano. Sem o desconto, o osso do pé copiava o declive do mixamorig (39°, contra 13–17° do nosso) e o jogador andava e
// corria na ponta do pé (diretor, 2026-10-16). Usa o esqueleto do GLB (só os ossos) e o mixamo_loco.json, que fica fora
// do git (licença do Mixamo): sem ele o teste é pulado.
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type MixamoFile, retargetMixamo } from './Retarget';

interface GltfNode {
  name?: string;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

/** Os ossos do GLB (e os pais deles) como Object3D/Bone, sem malha, num grupo parado. */
function skeletonFromGlb(url: URL): THREE.Group {
  const buf = readFileSync(url);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as { nodes: GltfNode[]; skins: { joints: number[] }[] };
  const joints = new Set(json.skins[0].joints);
  const objects = json.nodes.map((n, i) => {
    const o = joints.has(i) ? new THREE.Bone() : new THREE.Object3D();
    o.name = n.name ?? '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  const hasParent = new Set<number>();
  json.nodes.forEach((n, i) => n.children?.forEach((c) => (objects[i].add(objects[c]), hasParent.add(c))));
  const holder = new THREE.Group();
  json.nodes.forEach((_, i) => {
    if (!hasParent.has(i)) holder.add(objects[i]);
  });
  holder.updateMatrixWorld(true);
  return holder;
}

/** Declive (graus, para baixo) do osso do pé: tornozelo -> metatarso. */
function footSlope(root: THREE.Object3D, side: 'l' | 'r'): number {
  const a = root.getObjectByName(`foot_${side}`)!.getWorldPosition(new THREE.Vector3());
  const b = root.getObjectByName(`ball_${side}`)!.getWorldPosition(new THREE.Vector3());
  const d = b.sub(a);
  return THREE.MathUtils.radToDeg(-Math.atan2(d.y, Math.hypot(d.x, d.z)));
}

const glbUrl = new URL('../../public/assets/hoops_player.glb', import.meta.url);
const mixamoUrl = new URL('../../public/assets/mocap/mixamo_loco.json', import.meta.url);

describe.skipIf(!existsSync(mixamoUrl))('retargetMixamo: pé', () => {
  const file = JSON.parse(readFileSync(mixamoUrl, 'utf8')) as MixamoFile;

  it('com o pé plano na fonte (IdleStand), o nosso fica com o declive do bind (sem ponta para baixo)', () => {
    const holder = skeletonFromGlb(glbUrl);
    const bind = { l: footSlope(holder, 'l'), r: footSlope(holder, 'r') };
    const pose = (footFix: boolean) => {
      const h = skeletonFromGlb(glbUrl);
      const { clip } = retargetMixamo(h, file, 'IdleStand', { loop: true, footFix });
      const mixer = new THREE.AnimationMixer(h);
      mixer.clipAction(clip).play();
      mixer.update(0);
      h.updateMatrixWorld(true);
      return { l: footSlope(h, 'l'), r: footSlope(h, 'r') };
    };
    const fixed = pose(true);
    const raw = pose(false);
    for (const side of ['l', 'r'] as const) {
      expect(Math.abs(fixed[side] - bind[side])).toBeLessThan(4);
      // Sem o desconto, ~39° (o declive do mixamorig): ~22–26° de ponta para baixo.
      expect(raw[side] - bind[side]).toBeGreaterThan(15);
    }
  });
});
