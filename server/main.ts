// DormKartz online server: serves the built game (dist/) and runs room races
// over WebSockets at /ws. One process, one port, so players only need a URL.
//
//   npm run build && npm run server        # PORT defaults to 8787

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { DT } from '../src/sim/config';
import { RoomServer } from './rooms';

const PORT = Number(process.env.PORT) || 8787;
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? 'dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const rooms = new RoomServer();

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size }));
    return;
  }
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const file = join(STATIC_DIR, rel);
  if (!file.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    // Vite fingerprints everything in assets/, so those can be cached forever.
    const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(rel === 'index.html' ? 'Game not built yet: run `npm run build` first.' : 'Not found');
  }
});

// Snapshots are repetitive JSON; compression cuts mobile data use a lot.
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 4096, perMessageDeflate: { threshold: 256 } });
const alive = new WeakSet<WebSocket>();

wss.on('connection', (ws) => {
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
  const client = rooms.connect({ send: (d) => ws.send(d), close: () => ws.close() });
  ws.on('message', (data, isBinary) => {
    if (!isBinary) client.message(data.toString());
  });
  ws.on('close', () => client.close());
  ws.on('error', () => ws.terminate());
});

// Drop sockets that stop answering pings (phones that lost signal).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, 10000);

// Fixed 60 Hz simulation clock for every room.
let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= DT) {
    rooms.advance();
    acc -= DT;
  }
}, 4);

http.listen(PORT, () => {
  console.log(`DormKartz server on http://localhost:${PORT} (serving ${STATIC_DIR})`);
});
