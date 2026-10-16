// Cesta visual (tabela, aro, rede e suporte) gerada a partir do HoopSpec do núcleo: a mesma geometria que a física usa.
// Com a arena ligada, a cesta vem dos modelos do HY 3D (buildModelHoop), alinhados à mesma física; buildHoop fica para
// ?arena=0 e para quando os GLBs não carregam.
import * as THREE from 'three';
import type { HoopSpec } from '../sim';
import { toThree } from '../units';
import { arenaMesh } from './ArenaModels';

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

  // A rede tem física própria e é desenhada pelo NetMesh (game/NetMesh.ts).

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

/** Peças da cesta oficial (assets/arena/, Tools/Animacao/arena.py). */
export const HoopModelNames = ['cesta_estrutura', 'cesta_tabela', 'cesta_aro', 'cesta_shot_clock'] as const;

/** Atrás da face do vidro até as costas da tabela do modelo, onde o braço da estrutura encosta (m). */
const ModelBoardDepth = 0.069;
/** Vidro do modelo (dentro da moldura e do acolchoado), centrado na tabela (m). */
const ModelGlass = { width: 1.557, height: 0.906 };

/** Pintura do vidro: faixa da borda e o quadrado de 59 x 45 cm com a base na altura do topo do aro. */
function glassPaintTexture(hoop: HoopSpec): THREE.CanvasTexture {
  const ppm = 400;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(ModelGlass.width * ppm);
  canvas.height = Math.round(ModelGlass.height * ppm);
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.05 * ppm;
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, canvas.width - ctx.lineWidth, canvas.height - ctx.lineWidth);
  const glassBottom = hoop.backboardFaceCenter.z - ModelGlass.height / 2;
  const w = 0.59 * ppm;
  const h = 0.45 * ppm;
  const bottom = canvas.height - (hoop.rimHeight - glassBottom) * ppm;
  ctx.strokeRect((canvas.width - w) / 2, bottom - h, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Cesta com os modelos do HY 3D, só visual: tabela na face da física (backboardFaceCenter), aro no centro do aro da
 * física (rimCenter), relógio de 24 s em cima da tabela e a estrutura (base, poste e braço) encostada nas costas da
 * tabela. A rede continua sendo a do NetMesh. Rejeita se algum GLB não carregar (o chamador cai no buildHoop).
 */
export async function buildModelHoop(scene: THREE.Scene, hoop: HoopSpec): Promise<THREE.Group> {
  const [frame, board, rim, clock] = await Promise.all(HoopModelNames.map((n) => arenaMesh(n)));
  const group = new THREE.Group();
  group.name = 'cesta';
  const fwd = toThree(hoop.forward);
  const yaw = Math.atan2(fwd.x, fwd.z); // frente dos modelos (+Z) para dentro da quadra

  const place = (mesh: THREE.Mesh, at: THREE.Vector3): THREE.Mesh => {
    const m = mesh.clone();
    m.position.copy(at);
    m.rotation.y = yaw;
    m.castShadow = true;
    group.add(m);
    return m;
  };

  const face = hoop.backboardFaceCenter;
  const tabela = place(board, toThree(face));
  // O vidro do modelo vira vidro de verdade (o HY pintou um cinza opaco).
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xdde8f0,
    roughness: 0.05,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const boardMaterials = (Array.isArray(tabela.material) ? tabela.material : [tabela.material]).map((m) =>
    m.name === 'Vidro' ? glassMaterial : m,
  );
  tabela.material = boardMaterials.length === 1 ? boardMaterials[0] : boardMaterials;
  tabela.renderOrder = 1;

  const paint = new THREE.Mesh(
    new THREE.PlaneGeometry(ModelGlass.width, ModelGlass.height),
    new THREE.MeshBasicMaterial({ map: glassPaintTexture(hoop), transparent: true, depthWrite: false }),
  );
  paint.position.copy(toThree(face.add(hoop.forward.scale(0.002))));
  paint.rotation.y = yaw;
  paint.renderOrder = 2;
  group.add(paint);

  place(rim, toThree(hoop.rimCenter()));
  place(clock, toThree(face.sub(hoop.forward.scale(0.05)).withZ(face.z + hoop.backboardHeight / 2)));
  place(frame, toThree(face.flat().sub(hoop.forward.scale(ModelBoardDepth))));

  scene.add(group);
  return group;
}
