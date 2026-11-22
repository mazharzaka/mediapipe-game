import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.VITE_BACKEND_URL || "http://localhost:3000";

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 5173,
      host: true,
      allowedHosts: true,
      proxy: {
        "/socket.io": {
          target: backendUrl,
          ws: true,
          changeOrigin: true,
        },
        "/api": {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
