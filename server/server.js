const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const PORT = 3000;

const app = express();
app.use(cors({ origin: '*' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('handMove', ({ x, y, isPunching }) => {
    socket.broadcast.emit('updateGloves', { x, y, isPunching: !!isPunching });
  });

  socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id}`));
});

server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

