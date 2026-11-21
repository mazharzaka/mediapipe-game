require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { mouse, Point, screen } = require('@nut-tree/nut-js');

// Optimize responsiveness for real-time tracking
mouse.config.autoDelayMs = 0;

const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN } });

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

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
      console.error('Error in assistiveMove:', err);
    }
  });

  socket.on('mouse_click', async ({ button }) => {
    try {
      if (button === 'left') {
        await mouse.leftClick();
      } else if (button === 'right') {
        await mouse.rightClick();
      }
    } catch (err) {
      console.error('Error in mouse_click:', err);
    }
  });

  socket.on('mouse_scroll', async ({ direction, amount, dy }) => {
    try {
      const steps = typeof amount === 'number' && amount > 0 ? Math.min(Math.round(amount), 10) : 2;
      if (direction === 'up' || (typeof dy === 'number' && dy < 0)) {
        await mouse.scrollUp(steps);
      } else if (direction === 'down' || (typeof dy === 'number' && dy > 0)) {
        await mouse.scrollDown(steps);
      }
    } catch (err) {
      console.error('Error in mouse_scroll:', err);
    }
  });

  socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id}`));
});

server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
