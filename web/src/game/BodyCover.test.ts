import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ArmBones, coveredVertices, rayTriangle, skinnedWorldPositions, triangleSoup } from './BodyCover';

describe('BodyCover', () => {
  it('raio acerta o triângulo à frente e erra o de trás', () => {
    const tri = new Float32Array([-1, -1, 1, 1, -1, 1, 0, 1, 1]);
    expect(rayTriangle([0, 0, 0], [0, 0, 1], tri, 0)).toBeCloseTo(1);
    expect(rayTriangle([0, 0, 0], [0, 0, -1], tri, 0)).toBe(-1);
  });

  it('tronco dentro da regata fica coberto; o que passa da barra, não', () => {
    // "Corpo": cilindro de raio 0,15 de y=0 a y=1. "Regata": tubo aberto de raio 0,2 de y=0,5 a y=1,1.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1, 24, 10, true).translate(0, 0.5, 0));
    const shirt = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 24, 4, true).translate(0, 0.8, 0));
    body.updateMatrixWorld();
    shirt.updateMatrixWorld();
    const p = skinnedWorldPositions(body);
    const covered = coveredVertices(p, body.geometry.getIndex()!.array, triangleSoup([shirt]), 0.12);
    for (let i = 0; i < covered.length; i++) {
      const y = p[i * 3 + 1];
      if (y > 0.55 && y < 1.05) expect(covered[i]).toBe(1);
      if (y < 0.45) expect(covered[i]).toBe(0);
    }
  });

  it('pele que furou o tecido também sai (raio para dentro)', () => {
    // "Corpo": cilindro de raio 0,2. "Bermuda": tubo de raio 0,18 (mais justo que o corpo): o corpo fura a peça.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1, 24, 10, true).translate(0, 0.5, 0));
    const shorts = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.4, 24, 4, true).translate(0, 0.5, 0));
    body.updateMatrixWorld();
    shorts.updateMatrixWorld();
    const p = skinnedWorldPositions(body);
    const idx = body.geometry.getIndex()!.array;
    const covered = coveredVertices(p, idx, triangleSoup([shorts]), 0.12);
    const legacy = coveredVertices(p, idx, triangleSoup([shorts]), 0.12, 0);
    for (let i = 0; i < covered.length; i++) {
      const y = p[i * 3 + 1];
      if (y > 0.35 && y < 0.65) {
        expect(covered[i]).toBe(1);
        expect(legacy[i]).toBe(0);
      }
      if (y < 0.25 || y > 0.75) expect(covered[i]).toBe(0);
    }
  });

  it('pele de braço sob uma peça que não segue o braço continua (o deltoide sai de baixo da alça)', () => {
    // "Corpo": cilindro de raio 0,15; a metade de cima é "braço" (upperarm_l), a de baixo, tronco. "Regata": tubo de raio
    // 0,2 que cobre tudo e só segue o tronco.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1, 24, 10, true).translate(0, 0.5, 0));
    const shirt = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.2, 24, 4, true).translate(0, 0.5, 0));
    body.updateMatrixWorld();
    shirt.updateMatrixWorld();
    const p = skinnedWorldPositions(body);
    const bone = (v: number) => (p[v * 3 + 1] > 0.5 ? 'upperarm_l' : 'spine_02');
    const shirtBones = new Set(['spine_02', 'spine_03']);
    const accept = (v: number) => !ArmBones.test(bone(v)) || shirtBones.has(bone(v));
    const covered = coveredVertices(p, body.geometry.getIndex()!.array, triangleSoup([shirt]), 0.12, 0.04, 0, accept);
    for (let i = 0; i < covered.length; i++) {
      const y = p[i * 3 + 1];
      if (y > 0.55) expect(covered[i]).toBe(0);
      if (y < 0.45) expect(covered[i]).toBe(1);
    }
  });
});
