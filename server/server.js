import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { Server } from 'socket.io';
import qrcode from 'qrcode-terminal';
import { env } from './config/env.js';
import { setupSocketHandler } from './sockets/socketHandler.js';
import { getSystemStatus } from './services/systemService.js';
import { registerSocketIo } from './ai/llmClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(__dirname, '../client/dist');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.use(express.json());

// Serve built frontend assets in production mode
app.use(express.static(clientDist));

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

// SPA fallback for client-side routing (Express 5 compatible)
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(path.join(clientDist, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: env.CORS_ORIGIN },
});

// Attach all socket handlers (Touchpad, Remote, Face tracking, AI Agent)
registerSocketIo(io);
setupSocketHandler(io);

server.listen(env.PORT, '0.0.0.0', () => {
  const status = getSystemStatus();
  const primaryIp = status.localIps?.[0]?.ip || 'localhost';
  const networkUrl = `http://${primaryIp}:${env.PORT}`;

  console.log(`\n==================================================`);
  console.log(`[Server] Assistive System Backend running:`);
  console.log(`Local:   http://localhost:${env.PORT}`);
  console.log(`Network: ${networkUrl}`);
  console.log(`==================================================\n`);

  try {
    qrcode.generate(networkUrl, { small: true });
    console.log(`📱 امسح الـ QR Code من كاميرا الموبايل لفتح التطبيق على الشبكة:\n`);
  } catch (err) {
    console.error('[Server] QR code generation error:', err.message);
  }
});
