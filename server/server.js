const express = require("express");
const http = require("http");
const os = require("os");
const cors = require("cors");
const { Server } = require("socket.io");
const { mouse, Point, screen } = require("@nut-tree/nut-js");

// Optimize responsiveness for real-time tracking
mouse.config.autoDelayMs = 0;

const PORT = process.env.PORT || 3000;

// Extract local WiFi / Ethernet IPv4 address for mobile QR Code access
function getLocalNetworkIp() {
  const interfaces = os.networkInterfaces();
  let fallbackIp = null;

  for (const name of Object.keys(interfaces)) {
    const isWifi = /wi-?fi|wlan/i.test(name);
    for (const iface of interfaces[name]) {
      const isIPv4 = iface.family === "IPv4" || iface.family === 4;
      if (isIPv4 && !iface.internal) {
        if (isWifi) {
          return iface.address;
        }
        if (!fallbackIp) {
          fallbackIp = iface.address;
        }
      }
    }
  }

  return fallbackIp || "192.168.100";
}

const app = express();
app.use(cors({ origin: "*" }));

// API Endpoint to get local network IP
app.get("/api/network-info", (req, res) => {
  res.json({ ip: getLocalNetworkIp() });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on("handMove", ({ x, y, isPunching }) => {
    socket.broadcast.emit("updateGloves", { x, y, isPunching: !!isPunching });
  });

  socket.on("assistiveMove", async ({ x, y }) => {
    try {
      if (typeof x !== "number" || typeof y !== "number") return;
      const screenWidth = await screen.width();
      const screenHeight = await screen.height();
      const targetX = Math.round(Math.max(0, Math.min(1, x)) * screenWidth);
      const targetY = Math.round(Math.max(0, Math.min(1, y)) * screenHeight);
      await mouse.setPosition(new Point(targetX, targetY));
    } catch (err) {
      console.error("Error in assistiveMove:", err);
    }
  });

  socket.on("disconnect", () =>
    console.log(`Client disconnected: ${socket.id}`),
  );
});

server.listen(PORT, () =>
  console.log(`Server listening on http://localhost:${PORT}`),
);
