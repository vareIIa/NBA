// Gravador de vídeo do teste visual: screencast do Chromium (CDP) → ffmpeg → .webm (VP8, 25 fps).
// Não depende do ffmpeg da versão exata do Playwright: usa PW_FFMPEG_PATH, qualquer ffmpeg já baixado pelo
// Playwright (ms-playwright ou /opt/pw-browsers) ou o ffmpeg do sistema. Nunca baixa nada.
import type { CDPSession, Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function findFfmpeg(): string {
  if (process.env.PW_FFMPEG_PATH) return process.env.PW_FFMPEG_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/opt/pw-browsers',
    join(homedir(), 'AppData', 'Local', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
  ].filter((r): r is string => !!r && existsSync(r));
  for (const root of roots) {
    for (const dir of readdirSync(root).filter((d) => d.startsWith('ffmpeg-')).sort().reverse()) {
      for (const exe of ['ffmpeg-win64.exe', 'ffmpeg-linux', 'ffmpeg-mac']) {
        const path = join(root, dir, exe);
        if (existsSync(path)) return path;
      }
    }
  }
  return 'ffmpeg';
}

interface Frame {
  data: Buffer;
  time: number; // s (relógio do navegador)
}

export class Recorder {
  private session: CDPSession | null = null;
  private readonly frames: Frame[] = [];

  constructor(
    private readonly page: Page,
    private readonly width = 1280,
    private readonly height = 720,
  ) {}

  async start(): Promise<void> {
    this.session = await this.page.context().newCDPSession(this.page);
    this.session.on('Page.screencastFrame', (event) => {
      this.frames.push({ data: Buffer.from(event.data, 'base64'), time: event.metadata.timestamp ?? Date.now() / 1000 });
      void this.session?.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    });
    await this.session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 85,
      maxWidth: this.width,
      maxHeight: this.height,
      everyNthFrame: 1,
    });
  }

  /** Para a captura e codifica com taxa constante (repete quadros para manter o tempo real). */
  async stop(outPath: string, fps = 25): Promise<number> {
    if (this.session) {
      await this.session.send('Page.stopScreencast').catch(() => {});
      await this.session.detach().catch(() => {});
      this.session = null;
    }
    if (this.frames.length === 0) throw new Error('screencast sem quadros');

    const ffmpeg = spawn(
      findFfmpeg(),
      [
        '-loglevel', 'error',
        '-f', 'image2pipe', '-c:v', 'mjpeg', '-r', String(fps), '-i', 'pipe:0',
        '-y', '-an', '-c:v', 'vp8', '-qmin', '0', '-qmax', '50', '-crf', '8', '-b:v', '2M',
        '-deadline', 'realtime', '-speed', '8',
        '-vf', `scale=${this.width}:${this.height}:force_original_aspect_ratio=decrease,pad=${this.width}:${this.height}:(ow-iw)/2:(oh-ih)/2`,
        outPath,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let stderr = '';
    ffmpeg.stderr.on('data', (d) => (stderr += String(d)));
    const done = new Promise<void>((resolve, reject) => {
      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg saiu com ${code}: ${stderr}`))));
    });

    const start = this.frames[0].time;
    const end = this.frames[this.frames.length - 1].time + 0.5;
    let index = 0;
    let written = 0;
    for (let t = start; t < end; t += 1 / fps) {
      while (index + 1 < this.frames.length && this.frames[index + 1].time <= t) index++;
      if (!ffmpeg.stdin.write(this.frames[index].data)) {
        await new Promise((r) => ffmpeg.stdin.once('drain', r));
      }
      written++;
    }
    ffmpeg.stdin.end();
    await done;
    return written / fps;
  }
}
