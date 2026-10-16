// Teste de eco do boneco remoto (ferramenta, fora do jogo): o boneco repete o próprio jogador local, como se ele fosse o
// adversário do outro lado da rede, com atraso e jitter simulados e deslocado para o lado. Serve para ver a animação
// replicada sem precisar de dois navegadores. tools/eco-boneco.mjs abre o jogo, chama startEcho e joga sozinho.
//
// No console do jogo: const { startEcho } = await import('/src/online/EchoTest.ts'); await startEcho(__debug);
import * as THREE from 'three';
import type { PlayerAnimator } from '../anim/PlayerAnimator';
import type { Freestyle } from '../game/Freestyle';
import { AnimRecorder } from './AnimRecorder';
import type { Payload, V3 } from './Payload';
import { RemotePlayer } from './RemotePlayer';

export interface EchoOptions {
  /** Atraso da rede (ms, só ida) e variação aleatória somada a ele. */
  delayMs?: number;
  jitterMs?: number;
  /** Envios por segundo (o 1x1 manda 20). */
  rateHz?: number;
  /** Deslocamento do boneco (three.js, m) para não ficar em cima do jogador. */
  offset?: V3;
  /** Esconde o jogador local (para ver só o boneco). */
  hideLocal?: boolean;
  heightCm?: number;
}

export interface EchoMetrics {
  frames: number;
  sent: number;
  bytesMax: number;
  bytesAvg: number;
  commands: number;
  /** Maior distância entre a raiz do boneco (sem o deslocamento) e o caminho do jogador no último 1,5 s (m). */
  pathErrMax: number;
  pathErrAvg: number;
  /** Bola presa (drible do boneco): maior e média distância do centro da bola à palma mais perto (m). */
  ballPalmMax: number;
  ballPalmAvg: number;
  /** A mesma medida no jogador local, para comparar. */
  localBallPalmMax: number;
  localBallPalmAvg: number;
  stats: ReturnType<RemotePlayer['stats']>;
}

interface Debug {
  animator: PlayerAnimator;
  game: Freestyle;
}

export async function startEcho(debug: Debug, opts: EchoOptions = {}) {
  const { animator, game } = debug;
  const scene = animator.root.parent as THREE.Scene;
  const delay = (opts.delayMs ?? 60) / 1000;
  const jitter = (opts.jitterMs ?? 25) / 1000;
  const offset = opts.offset ?? [0, 0, 2.2];
  const remote = await RemotePlayer.load(scene, { heightCm: opts.heightCm ?? 196, wingspanOverM: 0, kit: 'branca' });
  const rec = AnimRecorder.attach(animator);
  if (opts.hideLocal) animator.root.visible = false;

  const inFlight: { at: number; text: string }[] = [];
  let lastDeliver = 0;
  const m = { frames: 0, sent: 0, bytes: 0, bytesMax: 0, commands: 0, pathErr: 0, pathErrMax: 0, pathN: 0, palm: 0, palmMax: 0, palmN: 0, lpalm: 0, lpalmMax: 0, lpalmN: 0 };
  const history: { t: number; p: THREE.Vector3 }[] = [];
  const shift = (p: V3): V3 => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];

  const send = (): void => {
    const b = game.ballMesh;
    const d: Payload = rec.drain({
      p: [b.position.x, b.position.y, b.position.z],
      q: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
      s: [b.scale.x, b.scale.y, b.scale.z],
    });
    d.s.p = shift(d.s.p);
    if (d.s.ball) d.s.ball.p = shift(d.s.ball.p);
    m.commands += d.c?.length ?? 0;
    const text = JSON.stringify(d);
    m.sent++;
    m.bytes += text.length;
    m.bytesMax = Math.max(m.bytesMax, text.length);
    // WebSocket entrega em ordem: a chegada nunca passa a anterior.
    lastDeliver = Math.max(lastDeliver, performance.now() / 1000 + delay + Math.random() * jitter);
    inFlight.push({ at: lastDeliver, text });
  };
  const timer = setInterval(send, 1000 / (opts.rateHz ?? 20));

  const palmDist = (anim: PlayerAnimator, ball: THREE.Vector3): number =>
    Math.min(anim.palmWorld('r', new THREE.Vector3()).distanceTo(ball), anim.palmWorld('l', new THREE.Vector3()).distanceTo(ball));
  const off = new THREE.Vector3(...offset);
  let last = performance.now();
  let running = true;
  const frame = (): void => {
    if (!running) return;
    const nowMs = performance.now();
    const now = nowMs / 1000;
    const dt = Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    while (inFlight.length && inFlight[0].at <= now) remote.push(JSON.parse(inFlight.shift()!.text), now);
    remote.update(dt, now);
    m.frames++;

    history.push({ t: now, p: animator.root.position.clone() });
    while (history.length && history[0].t < now - 1.5) history.shift();
    const rp = remote.rootPosition().sub(off);
    if (remote.animator.root.visible && history.length) {
      const err = Math.min(...history.map((h) => h.p.distanceTo(rp)));
      m.pathErr += err;
      m.pathErrMax = Math.max(m.pathErrMax, err);
      m.pathN++;
    }
    if (remote.stats().ball === 'hand') {
      const ball = remote.ballWorld()!;
      const d = palmDist(remote.animator, ball);
      m.palm += d;
      m.palmMax = Math.max(m.palmMax, d);
      m.palmN++;
    }
    if (game.phase === 'dribble') {
      const d = palmDist(animator, game.ballMesh.position);
      m.lpalm += d;
      m.lpalmMax = Math.max(m.lpalmMax, d);
      m.lpalmN++;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    remote,
    rec,
    metrics: (): EchoMetrics => ({
      frames: m.frames,
      sent: m.sent,
      bytesMax: m.bytesMax,
      bytesAvg: Math.round(m.bytes / Math.max(1, m.sent)),
      commands: m.commands,
      pathErrMax: +m.pathErrMax.toFixed(3),
      pathErrAvg: +(m.pathErr / Math.max(1, m.pathN)).toFixed(3),
      ballPalmMax: +m.palmMax.toFixed(3),
      ballPalmAvg: +(m.palm / Math.max(1, m.palmN)).toFixed(3),
      localBallPalmMax: +m.lpalmMax.toFixed(3),
      localBallPalmAvg: +(m.lpalm / Math.max(1, m.lpalmN)).toFixed(3),
      stats: remote.stats(),
    }),
    stop: (): void => {
      running = false;
      clearInterval(timer);
      rec.detach();
      remote.dispose();
      animator.root.visible = true;
    },
  };
}
