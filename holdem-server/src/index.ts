import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PokerRoom } from './rooms/PokerRoom.js';
import { QueueRoom } from './rooms/QueueRoom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
// Allow cross-origin for dev / tunnel.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// Serve the built React app (holdem-web/dist).
const webDist = process.env.WEB_DIST || path.resolve(__dirname, '../../holdem-web/dist');
app.use(express.static(webDist));
// SPA fallback.
app.get(/^\/(?!matchmake|wsarraysync).*/, (_req, res) => {
  res.sendFile(path.join(webDist, 'index.html'));
});

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('poker', PokerRoom);
gameServer.define('queue', QueueRoom, {
  matchRoomName: 'poker',
  maxPlayers: 6,
  allowIncompleteGroups: true,
  maxWaitingCycles: 5,
  smallBlind: 5,
  bigBlind: 10,
  startingChips: 200,
});

const PORT = Number(process.env.PORT ?? 2567);
gameServer
  .listen(PORT)
  .then(() => {
    console.log(`[holdem-server] listening on http://localhost:${PORT}`);
    console.log(`[holdem-server] serving web dist from: ${webDist}`);
  });
