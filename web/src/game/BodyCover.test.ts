import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { coveredVertices, rayTriangle, skinnedWorldPositions, triangleSoup } from './BodyCover';

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
});
