// Cesta visual (tabela, aro, rede e suporte) gerada a partir do HoopSpec do núcleo: a mesma geometria que a física usa.
import * as THREE from 'three';
import { type HoopSpec, Vec3 } from '../sim';
import { toThree } from '../units';

function backboardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 732;
  canvas.height = 428;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 20;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
  // Quadrado de 59 x 45 cm acima do aro (escala: 400 px/m).
  const w = 0.59 * 400;
  const h = 0.45 * 400;
  ctx.lineWidth = 20;
  ctx.strokeRect((canvas.width - w) / 2, canvas.height - 0.15 * 400 - h + 2, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function buildHoop(scene: THREE.Scene, hoop: HoopSpec): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cesta';
  const yaw = Math.atan2(-hoop.forward.y, hoop.forward.x); // forward do núcleo → rotação em torno do Y do three

  // Tabela de vidro com a pintura branca na face.
  const boardCenter = toThree(hoop.backboardCenter());
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(hoop.backboardThickness, hoop.backboardHeight, hoop.backboardWidth),
    new THREE.MeshPhysicalMaterial({
      color: 0xdde8f0,
      roughness: 0.05,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  );
  glass.position.copy(boardCenter);
  glass.rotation.y = yaw;
  group.add(glass);

  const paint = new THREE.Mesh(
    new THREE.PlaneGeometry(hoop.backboardWidth, hoop.backboardHeight),
    new THREE.MeshBasicMaterial({ map: backboardTexture(), transparent: true }),
  );
  paint.position.copy(toThree(hoop.backboardFaceCenter.add(hoop.forward.scale(0.002))));
  paint.rotation.y = yaw + Math.PI / 2;
  group.add(paint);

  // Aro (toro) e a placa que o prende na tabela.
  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xff4a12, metalness: 0.6, roughness: 0.35 });
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(hoop.rimCenterlineRadius(), hoop.rimTubeRadius, 12, 48),
    rimMaterial,
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.copy(toThree(hoop.rimCenter()));
  rim.castShadow = true;
  group.add(rim);

  const bracketLength = hoop.rimInnerEdgeToBoard;
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(bracketLength, 0.03, 0.18), rimMaterial);
  bracket.position.copy(
    toThree(hoop.backboardFaceCenter.flat().add(hoop.forward.scale(bracketLength / 2)).withZ(hoop.rimPlaneZ() - 0.01)),
  );
  bracket.rotation.y = yaw;
  group.add(bracket);

  // Rede: cone aberto em malha (cosmética, fora do núcleo).
  const net = new THREE.Mesh(
    new THREE.CylinderGeometry(hoop.rimInnerRadius, hoop.rimInnerRadius * 0.6, 0.42, 16, 5, true),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.75 }),
  );
  net.position.copy(toThree(hoop.rimCenter().add(new Vec3(0, 0, -0.21))));
  net.name = 'rede';
  group.add(net);

  // Suporte: braço até o poste atrás da linha de fundo e a base acolchoada.
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.5, roughness: 0.5 });
  const pad = new THREE.MeshStandardMaterial({ color: 0x0f3d7a, roughness: 0.8 });
  const poleBase = hoop.backboardFaceCenter.flat().sub(hoop.forward.scale(1.9));
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.3, 0.25), pad);
  pole.position.copy(toThree(poleBase.withZ(1.65)));
  pole.castShadow = true;
  group.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.12), steel);
  arm.position.copy(toThree(poleBase.add(hoop.forward.scale(0.95)).withZ(hoop.backboardFaceCenter.z)));
  arm.rotation.y = yaw;
  group.add(arm);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1.3), pad);
  base.position.copy(toThree(poleBase.sub(hoop.forward.scale(0.4)).withZ(0.45)));
  base.castShadow = true;
  group.add(base);

  scene.add(group);
  return group;
}
