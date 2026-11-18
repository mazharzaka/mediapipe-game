import { io } from "socket.io-client";

// Read from query param (?server=...), env var, localStorage, or fallback to current host:3000
const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const queryServer = urlParams ? urlParams.get('server') : null;
const localServer = typeof window !== 'undefined' ? localStorage.getItem('SERVER_URL') : null;

export const SERVER_URL =
  queryServer ||
  import.meta.env.VITE_SERVER_URL ||
  localServer ||
  (typeof window !== 'undefined' && window.location.hostname
    ? `http://${window.location.hostname}:3000`
    : "http://localhost:3000");

export const socket = io(SERVER_URL, {
  autoConnect: true,
});
