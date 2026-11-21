import { io } from "socket.io-client";

// Automatically use current origin by default (works with localhost, LAN IP, and tunnels via Vite proxy)
const origin =
  typeof window !== 'undefined' && window.location.origin
    ? window.location.origin
    : "http://localhost:5173";

const urlParams =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const queryServer = urlParams ? urlParams.get('server') : null;
const localServer =
  typeof window !== 'undefined' ? localStorage.getItem('SERVER_URL') : null;

export const SERVER_URL =
  queryServer ||
  import.meta.env.VITE_SERVER_URL ||
  localServer ||
  origin;

export const socket = io(SERVER_URL, {
  path: '/socket.io',
  autoConnect: true,
});
