// Bola visual: esfera com gomos desenhados num canvas. A posição e o giro vêm do núcleo.
import * as THREE from 'three';

function ballTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#c4561c');
  gradient.addColorStop(0.5, '#d9692a');
  gradient.addColorStop(1, '#c4561c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Pontinhos do couro.
  for (let i = 0; i < 6000; ++i) {
    ctx.fillStyle = `rgba(90,30,5,${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1.5, 1.5);
  }
  ctx.strokeStyle = '#1a0c05';
  ctx.lineWidth = 5;
  // Equador e meridianos (projeção equiretangular).
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();
  for (const u of [0, 0.25, 0.5, 0.75]) {
    ctx.beginPath();
    ctx.moveTo(u * canvas.width, 0);
    ctx.lineTo(u * canvas.width, canvas.height);
    ctx.stroke();
  }
  // Curvas laterais.
  for (const center of [0.125, 0.625]) {
    ctx.beginPath();
    for (let v = 0; v <= 1.0001; v += 0.02) {
      const lat = (v - 0.5) * Math.PI;
      const u = center + 0.11 * Math.cos(lat) * (center < 0.5 ? 1 : -1);
      const x = u * canvas.width;
      const y = v * canvas.height;
      if (v === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function buildBall(radius: number): THREE.Mesh {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 40, 24),
    new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.75 }),
  );
  ball.castShadow = true;
  ball.name = 'bola';
  return ball;
}
