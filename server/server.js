import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { setupSocketHandler } from './sockets/socketHandler.js';
import { getSystemStatus } from './services/systemService.js';

const app = express();
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

// API route to provide local network IP address for QR code mobile pairing
app.get('/api/network-info', (req, res) => {
  try {
    const status = getSystemStatus();
    const primaryIp = status.localIps?.[0]?.ip || 'localhost';
    res.json({ ip: primaryIp, localIps: status.localIps });
  } catch (err) {
    res.status(500).json({ error: err.message, ip: 'localhost' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: env.CORS_ORIGIN },
});

// Attach all socket handlers (Touchpad, Remote, Face tracking, AI Agent)
setupSocketHandler(io);

server.listen(env.PORT, () => {
  console.log(`[Server] Assistive System Backend running on http://localhost:${env.PORT}`);
});
