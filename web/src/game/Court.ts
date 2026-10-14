// Quadra (meia quadra do Freestyle): piso de madeira e linhas desenhados num canvas (sem arquivos de textura),
// ginásio escuro e luzes. Tudo posicionado em coordenadas do núcleo e convertido por units.ts.
import * as THREE from 'three';
import { CourtSpec, Vec3 } from '../sim';
import { toThree } from '../units';

/** Limites do piso em coordenadas do núcleo (m). O aro fica sobre a origem e a quadra cresce para +X. */
export const FloorBounds = { minX: -3.2, maxX: 14.4, minY: -9.4, maxY: 9.4 };

export interface CourtLayout {
  spec: CourtSpec;
  rimFloorPoint: Vec3;
  baselineX: number;
  halfCourtX: number;
  halfWidth: number;
}

export function makeCourtLayout(): CourtLayout {
  const spec = new CourtSpec();
  return {
    spec,
    rimFloorPoint: new Vec3(0, 0, 0),
    baselineX: -spec.rimFromBaseline,
    halfCourtX: spec.halfCourtLength - spec.rimFromBaseline,
    halfWidth: spec.courtWidth / 2,
  };
}

const PixelsPerMeter = 128;

/** Gerador simples e determinístico para a variação das tábuas (o visual não muda entre execuções). */
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawFloorTexture(layout: CourtLayout): HTMLCanvasElement {
  const b = FloorBounds;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((b.maxX - b.minX) * PixelsPerMeter);
  canvas.height = Math.round((b.maxY - b.minY) * PixelsPerMeter);
  const ctx = canvas.getContext('2d')!;
  // Topo do canvas = Y mínimo do núcleo (ver units.ts e a rotação do plano em buildCourt).
  const px = (x: number) => (x - b.minX) * PixelsPerMeter;
  const py = (y: number) => (y - b.minY) * PixelsPerMeter;
  const m = (meters: number) => meters * PixelsPerMeter;
  const rand = makePrng(1946);

  // Tábuas de bordo correndo no comprimento da quadra.
  const plankWidth = 0.057;
  for (let y = b.minY; y < b.maxY; y += plankWidth) {
    let x = b.minX - rand() * 2;
    while (x < b.maxX) {
      const length = 1.2 + rand() * 2.4;
      const tone = rand();
      const r = 196 + tone * 26;
      const g = 140 + tone * 22;
      const bl = 84 + tone * 18;
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${bl | 0})`;
      ctx.fillRect(px(x), py(y), m(length), m(plankWidth) + 1);
      // Veio da madeira.
      ctx.strokeStyle = `rgba(120,70,30,${0.05 + rand() * 0.07})`;
      ctx.lineWidth = 1;
      for (let k = 0; k < 2; ++k) {
        const gy = py(y) + rand() * m(plankWidth);
        ctx.beginPath();
        ctx.moveTo(px(x), gy);
        ctx.bezierCurveTo(px(x + length * 0.3), gy + 2, px(x + length * 0.7), gy - 2, px(x + length), gy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(70,40,15,0.35)';
      ctx.fillRect(px(x + length) - 1, py(y), 1.5, m(plankWidth));
      x += length;
    }
    ctx.fillStyle = 'rgba(80,45,20,0.25)';
    ctx.fillRect(0, py(y), canvas.width, 1);
  }

  const { baselineX, halfCourtX, halfWidth, spec } = layout;

  // Fora da quadra: madeira mais escura.
  ctx.fillStyle = 'rgba(60,25,10,0.38)';
  ctx.fillRect(0, 0, canvas.width, py(-halfWidth));
  ctx.fillRect(0, py(halfWidth), canvas.width, canvas.height - py(halfWidth));
  ctx.fillRect(0, py(-halfWidth), px(baselineX), m(spec.courtWidth));
  ctx.fillRect(px(halfCourtX), py(-halfWidth), canvas.width - px(halfCourtX), m(spec.courtWidth));

  // Garrafão pintado.
  const laneHalf = 2.44;
  const freeThrowX = baselineX + 5.79;
  ctx.fillStyle = 'rgba(150,30,25,0.82)';
  ctx.fillRect(px(baselineX), py(-laneHalf), m(freeThrowX - baselineX), m(laneHalf * 2));

  // Círculo central (metade visível).
  ctx.fillStyle = 'rgba(150,30,25,0.82)';
  ctx.beginPath();
  ctx.arc(px(halfCourtX), py(0), m(1.83), Math.PI / 2, (3 * Math.PI) / 2);
  ctx.fill();

  ctx.strokeStyle = '#f4f1ea';
  ctx.lineWidth = m(0.05);
  ctx.lineCap = 'butt';
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.beginPath();
    ctx.moveTo(px(x0), py(y0));
    ctx.lineTo(px(x1), py(y1));
    ctx.stroke();
  };

  // Limites e meio da quadra.
  ctx.strokeRect(px(baselineX), py(-halfWidth), m(halfCourtX - baselineX), m(spec.courtWidth));
  line(halfCourtX, -halfWidth, halfCourtX, halfWidth);
  ctx.beginPath();
  ctx.arc(px(halfCourtX), py(0), m(1.83), Math.PI / 2, (3 * Math.PI) / 2);
  ctx.stroke();

  // Linha de 3: retas do canto até onde encontram o arco.
  const cornerY = spec.cornerThreeDistance;
  const arcStart = Math.asin(cornerY / spec.threePointRadius);
  const cornerEndX = spec.threePointRadius * Math.cos(arcStart);
  line(baselineX, -cornerY, cornerEndX, -cornerY);
  line(baselineX, cornerY, cornerEndX, cornerY);
  ctx.beginPath();
  ctx.arc(px(0), py(0), m(spec.threePointRadius), -arcStart, arcStart);
  ctx.stroke();

  // Garrafão, lance livre e área restrita.
  ctx.strokeRect(px(baselineX), py(-laneHalf), m(freeThrowX - baselineX), m(laneHalf * 2));
  ctx.beginPath();
  ctx.arc(px(freeThrowX), py(0), m(1.83), -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.setLineDash([m(0.38), m(0.38)]);
  ctx.beginPath();
  ctx.arc(px(freeThrowX), py(0), m(1.83), Math.PI / 2, (3 * Math.PI) / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(px(0), py(0), m(1.22), -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  line(0, -1.22, -0.4, -1.22);
  line(0, 1.22, -0.4, 1.22);

  // Marcas do garrafão.
  for (const x of [baselineX + 2.13, baselineX + 3.0, baselineX + 3.87, baselineX + 4.74]) {
    line(x, -laneHalf, x, -laneHalf - 0.2);
    line(x, laneHalf, x, laneHalf + 0.2);
  }

  // Logo central fictício.
  ctx.save();
  ctx.translate(px(halfCourtX - 0.8), py(0));
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'rgba(244,241,234,0.85)';
  ctx.font = `bold ${m(0.42)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GARRAFÃO', 0, 0);
  ctx.restore();

  return canvas;
}

export function buildCourt(scene: THREE.Scene, renderer: THREE.WebGLRenderer, layout: CourtLayout): void {
  const b = FloorBounds;
  const width = b.maxX - b.minX;
  const depth = b.maxY - b.minY;

  const texture = new THREE.CanvasTexture(drawFloorTexture(layout));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.32, metalness: 0.0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.copy(toThree(new Vec3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0)));
  floor.receiveShadow = true;
  floor.name = 'piso';
  scene.add(floor);

  // Ginásio: caixa escura em volta, arquibancada sugerida por faixas e luzes de teto.
  const hall = new THREE.Mesh(
    new THREE.BoxGeometry(60, 22, 50),
    new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.9, side: THREE.BackSide }),
  );
  hall.position.set(5, 10.99, 0);
  scene.add(hall);

  const standMaterial = new THREE.MeshStandardMaterial({ color: 0x1d2330, roughness: 0.85 });
  for (let row = 0; row < 8; ++row) {
    for (const side of [-1, 1]) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(24, 0.45, 0.8), standMaterial);
      step.position.set(5, 0.25 + row * 0.45, side * (11 + row * 0.8));
      step.receiveShadow = true;
      scene.add(step);
    }
  }

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a2412, 0.55));

  const key = new THREE.DirectionalLight(0xfff3e0, 1.6);
  key.position.set(8, 16, 6);
  key.target.position.set(4, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -12;
  key.shadow.bias = -0.0004;
  scene.add(key, key.target);

  // Refletores sobre a quadra (dão o brilho no piso).
  for (const [x, z] of [
    [0, -5],
    [0, 5],
    [7, -5],
    [7, 5],
    [12, 0],
  ] as const) {
    const spot = new THREE.SpotLight(0xffffff, 140, 30, Math.PI / 5, 0.6, 1.6);
    spot.position.set(x, 14, z);
    spot.target.position.set(x, 0, z * 0.6);
    scene.add(spot, spot.target);
  }
}
