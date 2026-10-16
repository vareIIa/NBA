// Servidor de salas para desenvolvimento e rede local: `npm run server` (Node 24 roda o TypeScript direto, sem build).
// O mesmo Hub roda em produção dentro do Durable Object da Cloudflare (web/deploy/). Aqui ele fica num processo só:
//   ws://<máquina>:8790/ws  → o jogo (o cliente acha esse endereço sozinho em `npm run dev`)
//   http://<máquina>:8790/api/builds → builds compartilhadas (docs/23 §6), em memória: somem quando o servidor para
//   http://<máquina>:8790/  → status em JSON (conexões, salas, partidas)
// Para jogar com alguém na mesma rede: rode `npm run dev -- --host` e `npm run server`, e o amigo abre
// http://<seu IP>:5173/?menu=1 (o IP aparece aqui embaixo quando o servidor sobe).
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import { Hub } from '../src/net/hub/Hub.ts';
import { MaxBuildBytes, memoryStorage } from '../src/net/builds/BuildCatalog.ts';
import { defaultLimits, devOrigin, handleBuildsRequest, isBuildsPath } from '../src/net/builds/buildsApi.ts';
import { DevServerPort, MaxFrameBytes, ProtocolVersion, WsPath } from '../src/net/protocol.ts';

const port = Number(process.env.PORT ?? DevServerPort);
const verbose = process.env.MP_LOG !== '0';
const stamp = (): string => new Date().toTimeString().slice(0, 8);
// HUB_SORTE=1 (só testes): todo sorteio do juiz sai a favor de quem tenta (o e2e do roubo não depende da sorte).
const lucky = process.env.HUB_SORTE === '1';
const hub = new Hub({ log: (...args) => verbose && console.log(stamp(), ...args), refereeRandom: lucky ? () => 0 : undefined });

const builds = memoryStorage();
const buildLimits = defaultLimits();

/** /api/builds: o pedido do Node vira um Request padrão e vai para o mesmo handler do Worker. */
async function serveBuilds(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MaxBuildBytes * 2) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const hasBody = req.method === 'PUT' || req.method === 'POST';
  const request = new Request(`http://localhost${req.url ?? '/'}`, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
  const response = await handleBuildsRequest(request, builds, {
    allowOrigin: devOrigin,
    clientKey: req.socket.remoteAddress ?? 'local',
    limits: buildLimits,
  });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const http = createServer((req, res) => {
  if (isBuildsPath((req.url ?? '').split('?')[0]!)) {
    serveBuilds(req, res).catch(() => res.writeHead(500).end());
    return;
  }
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, server: 'garrafao-hub', v: ProtocolVersion, lucky, ...hub.stats() }));
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MaxFrameBytes });
http.on('upgrade', (req, socket, head) => {
  const path = (req.url ?? '').split('?')[0];
  if (path !== WsPath) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

let nextId = 0;
wss.on('connection', (ws: WebSocket) => {
  const id = `n${++nextId}`;
  hub.connect({
    id,
    send: (text) => {
      if (ws.readyState === ws.OPEN) ws.send(text);
    },
    close: (code, reason) => ws.close(code, reason),
  });
  ws.on('message', (data, isBinary) => {
    if (!isBinary) hub.message(id, data.toString());
  });
  ws.on('close', () => hub.disconnect(id));
  ws.on('error', () => hub.disconnect(id));
});

setInterval(() => hub.tick(), 100);

http.listen(port, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address);
  console.log(`Servidor de salas do Garrafão em ws://localhost:${port}${WsPath}`);
  for (const ip of lan) console.log(`  rede local: ws://${ip}:${port}${WsPath}  (jogo: http://${ip}:5173/?menu=1)`);
});
