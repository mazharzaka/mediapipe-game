require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { exec } = require('child_process');
const { Server } = require('socket.io');
const { mouse, Point, screen, Button, keyboard, Key } = require('@nut-tree/nut-js');

// Optimize responsiveness for real-time tracking
mouse.config.autoDelayMs = 0;
keyboard.config.autoDelayMs = 0;

const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN } });

// Cached mouse position for instantaneous relative movements without getPosition() lag
let cachedPos = null;
let lastMoveTimestamp = 0;

  async function syncMousePos(force = false) {
    const screenWidth = await screen.width();
    const screenHeight = await screen.height();
        const now = Date.now();

        if(!cachedPos) {
          cachedPos = {
            x: Math.round(screenWidth / 2),
            y: Math.round(screenHeight / 2),
          };
        }

    // Query OS only when touch starts or when idle for over 1 second
    if (force || now - lastMoveTimestamp > 1000) {
      try {
        const rawPos = await mouse.getPosition();
        if (
          typeof rawPos.x === 'number' &&
          rawPos.x >= 0 &&
          rawPos.x <= screenWidth &&
          typeof rawPos.y === 'number' &&
          rawPos.y >= 0 &&
          rawPos.y <= screenHeight
        ) {
          cachedPos = { x: Math.round(rawPos.x), y: Math.round(rawPos.y) };
        }
      } catch (_) { }
      lastMoveTimestamp = now;
    }

    return { screenWidth, screenHeight };
  }

  // Safe URL opener in Windows default browser
  function openUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        console.warn(`[Backend] Refusing to open non-http/https URL: "${rawUrl}"`);
        return;
      }
      const safeUrl = rawUrl.replace(/"/g, '');
      exec(`start "" "${safeUrl}"`, (err) => {
        if (err) {
          console.error('[Backend] Error executing start command for URL:', err);
        } else {
          console.log(`[Backend] Opened URL in default browser: ${safeUrl}`);
        }
      });
    } catch (err) {
      console.error(`[Backend] Invalid URL provided: "${rawUrl}"`, err);
    }
  }

  io.on('connection', (socket) => {
    console.log(`[Backend] Client connected: ${socket.id}`);

    socket.on('handMove', ({ x, y, isPunching }) => {
      socket.broadcast.emit('updateGloves', { x, y, isPunching: !!isPunching });
    });

    // Touch start: Refresh cached mouse position from OS immediately
    socket.on('touch_start', async () => {
      await syncMousePos(true);
    });

    // Absolute positioning (Assistive Head Tracking)
    socket.on('assistiveMove', async ({ x, y }) => {
      try {
        if (typeof x !== 'number' || typeof y !== 'number') return;
        const screenWidth = await screen.width();
        const screenHeight = await screen.height();
        const targetX = Math.round(Math.max(0, Math.min(1, x)) * screenWidth);
        const targetY = Math.round(Math.max(0, Math.min(1, y)) * screenHeight);
        cachedPos = { x: targetX, y: targetY };
        lastMoveTimestamp = Date.now();
        await mouse.setPosition(new Point(targetX, targetY));
      } catch (err) {
        console.error('[Backend] Error in assistiveMove:', err);
      }
    });

    // High-performance relative mouse movement (Touchpad Drag)
    socket.on('mouse_move_relative', async ({ dx, dy }) => {
      try {
        if (typeof dx !== 'number' || typeof dy !== 'number') return;
        const { screenWidth, screenHeight } = await syncMousePos(false);
        const nextX = Math.round(Math.max(0, Math.min(screenWidth - 1, cachedPos.x + dx)));
        const nextY = Math.round(Math.max(0, Math.min(screenHeight - 1, cachedPos.y + dy)));
        cachedPos = { x: nextX, y: nextY };
        lastMoveTimestamp = Date.now();
        await mouse.setPosition(new Point(nextX, nextY));
      } catch (err) {
        console.error('[Backend] Error in mouse_move_relative:', err);
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

    // Type text on PC keyboard
    socket.on('type_text', async ({ text }) => {
      console.log(`[Backend] >>> Received type_text: "${text}" from socket ${socket.id}`);
      try {
        if (typeof text !== 'string' || !text) return;
        await keyboard.type(text);
        console.log(`[Backend] Successfully typed text: "${text}"`);
      } catch (err) {
        console.error('[Backend] Error executing type_text:', err);
      }
    });

    // Key Enter event
    socket.on('key_enter', async () => {
      console.log(`[Backend] >>> Received key_enter from socket ${socket.id}`);
      try {
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
        console.log('[Backend] Successfully pressed Enter');
      } catch (err) {
        console.error('[Backend] Error executing key_enter:', err);
      }
    });

    // Key Backspace event
    socket.on('key_backspace', async () => {
      console.log(`[Backend] >>> Received key_backspace from socket ${socket.id}`);
      try {
        await keyboard.pressKey(Key.Backspace);
        await keyboard.releaseKey(Key.Backspace);
        console.log('[Backend] Successfully pressed Backspace');
      } catch (err) {
        console.error('[Backend] Error executing key_backspace:', err);
      }
    });

    // Voice Search Handler: Opens YouTube or Google search directly in Windows default browser
    socket.on('voice_search', ({ query, platform }) => {
      console.log(`[Backend] >>> Received voice_search: query="${query}", platform="${platform}"`);
      try {
        if (!query || typeof query !== 'string') return;
        const cleanQuery = query.trim();
        if (!cleanQuery) return;

        let targetUrl;
        if (platform === 'google') {
          targetUrl = `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}`;
        } else {
          targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
        }

        openUrl(targetUrl);
      } catch (err) {
        console.error('[Backend] Error handling voice_search:', err);
      }
    });

    // Remote Media & System Actions: YouTube shortcuts, skip ad, and tab controls
    socket.on('remote_action', async ({ action }) => {
      console.log(`[Backend] >>> Received remote_action: "${action}" from socket ${socket.id}`);
      try {
        switch (action) {
          case 'open_youtube':
            console.log('[Backend] Executing open_youtube');
            openUrl('https://www.youtube.com');
            break;

          case 'skip_ad': {
            // YouTube Fullscreen Skip Ad Button: (x: 88%, y: 82%)
            console.log('[Backend] Executing skip_ad on YouTube fullscreen');
            const screenWidth = await screen.width();
            const screenHeight = await screen.height();
            const targetX = Math.round(screenWidth * 0.88);
            const targetY = Math.round(screenHeight * 0.82);
            console.log(`[Backend] Moving mouse to Skip Ad target: (${targetX}, ${targetY}) and clicking`);
            await mouse.setPosition(new Point(targetX, targetY));
            await mouse.click(Button.LEFT);
            cachedPos = { x: targetX, y: targetY };
            lastMoveTimestamp = Date.now();
            break;
          }

          case 'play_pause':
            // YouTube play/pause toggle: Key 'K'
            console.log('[Backend] Executing play_pause (Key.K)');
            await keyboard.pressKey(Key.K);
            await keyboard.releaseKey(Key.K);
            break;

          case 'forward_10':
            // YouTube jump 10s forward: Key 'L'
            console.log('[Backend] Executing forward_10 (Key.L)');
            await keyboard.pressKey(Key.L);
            await keyboard.releaseKey(Key.L);
            break;

          case 'rewind_10':
            // YouTube jump 10s backward: Key 'J'
            console.log('[Backend] Executing rewind_10 (Key.J)');
            await keyboard.pressKey(Key.J);
            await keyboard.releaseKey(Key.J);
            break;

          case 'speed_up':
            // YouTube speed up: Shift + > (Key.LeftShift + Key.Period)
            console.log('[Backend] Executing speed_up (Shift + Period)');
            await keyboard.pressKey(Key.LeftShift);
            await keyboard.pressKey(Key.Period);
            await keyboard.releaseKey(Key.Period);
            await keyboard.releaseKey(Key.LeftShift);
            break;

          case 'speed_down':
            // YouTube speed down: Shift + < (Key.LeftShift + Key.Comma)
            console.log('[Backend] Executing speed_down (Shift + Comma)');
            await keyboard.pressKey(Key.LeftShift);
            await keyboard.pressKey(Key.Comma);
            await keyboard.releaseKey(Key.Comma);
            await keyboard.releaseKey(Key.LeftShift);
            break;

          case 'fullscreen':
            // YouTube toggle fullscreen: Key 'F'
            console.log('[Backend] Executing fullscreen (Key.F)');
            await keyboard.pressKey(Key.F);
            await keyboard.releaseKey(Key.F);
            break;

          case 'mute':
            // YouTube toggle mute: Key 'M'
            console.log('[Backend] Executing mute (Key.M)');
            await keyboard.pressKey(Key.M);
            await keyboard.releaseKey(Key.M);
            break;

          case 'close_tab':
            // Close browser tab: Ctrl + W
            console.log('[Backend] Executing close_tab (Ctrl + W)');
            await keyboard.pressKey(Key.LeftControl);
            await keyboard.pressKey(Key.W);
            await keyboard.releaseKey(Key.W);
            await keyboard.releaseKey(Key.LeftControl);
            break;

          default:
            console.warn(`[Backend] Unknown remote_action received: "${action}"`);
            break;
        }
      } catch (err) {
        console.error(`[Backend] Error executing remote_action "${action}":`, err);
      }
    });

    socket.on('disconnect', () => console.log(`[Backend] Client disconnected: ${socket.id}`));
  });

  server.listen(PORT, () => console.log(`[Backend] Server listening on http://localhost:${PORT}`));
