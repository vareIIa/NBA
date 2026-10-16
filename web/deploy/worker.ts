// Worker do Cloudflare (npm run deploy, docs/24): serve o jogo (web/dist) e a sala em tempo real (/ws) na mesma URL.
// O lobby inteiro é um Durable Object só ("hub") rodando o Hub puro de web/src/net/hub, o mesmo do servidor de
// desenvolvimento: fila, salas privadas e os relógios do 1x1, com tick a cada 100 ms enquanto houver alguém conectado.
// Este arquivo não passa pelo tsc do jogo (os tipos do runtime vêm do wrangler, que só empacota).
import { DurableObject } from 'cloudflare:workers';
import { Hub } from '../src/net/hub/Hub.ts';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  HUB: DurableObjectNamespace<HubObject>;
}

const TickMs = 100;
/** Depois que o último sai, o tick continua um pouco (a tolerância de reconexão do Hub depende dele). */
const IdleTickMs = 120_000;
/** Guarda de transporte: só texto e nada absurdo. Tamanho e ritmo de verdade quem cuida é o Hub (64 KB, 120/s). */
const MaxMessageChars = 256 * 1024;

/** Códigos que o close() aceita (1000 e 3000–4999); 1005/1006 são reservados e lançam exceção. */
function closeCode(code: number | undefined): number {
  return code === 1000 || (code !== undefined && code >= 3000 && code <= 4999) ? code : 1000;
}

export class HubObject extends DurableObject<Env> {
  private readonly hub = new Hub({ log: (...args: unknown[]) => console.log(...args) });
  private timer: ReturnType<typeof setInterval> | null = null;
  private live = 0;
  private lastSeen = Date.now();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Esta rota só aceita WebSocket.', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const socket = pair[1];
    socket.accept();

    const id = crypto.randomUUID();
    let open = true;
    let gone = false;
    const leave = (): void => {
      if (gone) return;
      gone = true;
      open = false;
      this.live--;
      this.lastSeen = Date.now();
      this.hub.disconnect(id);
    };
    const close = (code?: number, reason?: string): void => {
      if (!open) return;
      open = false;
      try {
        socket.close(closeCode(code), (reason ?? '').slice(0, 120));
      } catch {
        // já fechado do outro lado
      }
    };

    this.live++;
    this.startTicking();
    this.hub.connect({
      id,
      send: (text: string) => {
        if (!open) return;
        try {
          socket.send(text);
        } catch {
          leave();
        }
      },
      close,
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      if (gone) return;
      if (typeof event.data !== 'string' || event.data.length > MaxMessageChars) {
        close(4008, 'mensagem inválida');
        leave();
        return;
      }
      this.hub.message(id, event.data);
    });
    socket.addEventListener('close', leave);
    socket.addEventListener('error', leave);

    return new Response(null, { status: 101, webSocket: client });
  }

  private startTicking(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.hub.tick();
      if (this.live <= 0 && Date.now() - this.lastSeen > IdleTickMs && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }, TickMs);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      // Um objeto só para o lobby inteiro. Durable Objects ainda não nascem na América do Sul: a dica 'sam' cai no leste
      // dos EUA (docs/24 §3). Vale só na criação; se a Cloudflare abrir a região, um nome novo de objeto nasceria aqui.
      const stub = env.HUB.get(env.HUB.idFromName('hub'), { locationHint: 'sam' });
      try {
        return await stub.fetch(request);
      } catch (error) {
        console.error('sala: falha ao abrir a conexão', error);
        return new Response('Sala indisponível.', { status: 503 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
