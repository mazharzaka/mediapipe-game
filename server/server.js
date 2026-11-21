require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { mouse, Point, screen, Button } = require('@nut-tree/nut-js');

// Optimize responsiveness for real-time tracking
mouse.config.autoDelayMs = 0;

const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN } });

io.on('connection', (socket) => {
  console.log(`[Backend] Client connected: ${socket.id}`);

  socket.on('handMove', ({ x, y, isPunching }) => {
    socket.broadcast.emit('updateGloves', { x, y, isPunching: !!isPunching });
  });

  socket.on('assistiveMove', async ({ x, y }) => {
    try {
      if (typeof x !== 'number' || typeof y !== 'number') return;
      const screenWidth = await screen.width();
      const screenHeight = await screen.height();
      const targetX = Math.round(Math.max(0, Math.min(1, x)) * screenWidth);
      const targetY = Math.round(Math.max(0, Math.min(1, y)) * screenHeight);
      await mouse.setPosition(new Point(targetX, targetY));
    } catch (err) {
      console.error('[Backend] Error in assistiveMove:', err);
    }
  });

  socket.on('mouse_click', async ({ button }) => {
    console.log(`[Backend] >>> Received mouse_click event for button: "${button}" from socket ${socket.id}`);
    try {
      if (button === 'left') {
        await mouse.click(Button.LEFT);
        console.log('[Backend] Successfully executed mouse.click(Button.LEFT)');
      } else if (button === 'right') {
        await mouse.click(Button.RIGHT);
        console.log('[Backend] Successfully executed mouse.click(Button.RIGHT)');
      } else {
        console.warn(`[Backend] Unknown mouse button received: "${button}"`);
      }
    } catch (err) {
      console.error('[Backend] Error executing mouse_click:', err);
    }
  });

  socket.on('mouse_scroll', async ({ direction, amount, dy }) => {
    console.log(`[Backend] >>> Received mouse_scroll: direction="${direction}", amount=${amount}, dy=${dy} from socket ${socket.id}`);
    try {
      // 150 steps default for clearly visible WHEEL_DELTA on OS
      const scrollSteps = typeof amount === 'number' && amount > 0 ? Math.round(amount) : 150;
      if (direction === 'up' || (typeof dy === 'number' && dy < 0)) {
        await mouse.scrollUp(scrollSteps);
        console.log(`[Backend] Successfully executed mouse.scrollUp(${scrollSteps})`);
      } else if (direction === 'down' || (typeof dy === 'number' && dy > 0)) {
        await mouse.scrollDown(scrollSteps);
        console.log(`[Backend] Successfully executed mouse.scrollDown(${scrollSteps})`);
      } else {
        console.warn('[Backend] Unknown scroll parameters:', { direction, dy });
      }
    } catch (err) {
      console.error('[Backend] Error executing mouse_scroll:', err);
    }
  });

  socket.on('disconnect', () => console.log(`[Backend] Client disconnected: ${socket.id}`));
});

server.listen(PORT, () => console.log(`[Backend] Server listening on http://localhost:${PORT}`));
