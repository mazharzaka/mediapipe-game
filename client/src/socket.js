import { io } from "socket.io-client";

// Read configuration from environment variables or query param (?server=...)
const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const queryServer = urlParams ? urlParams.get('server') : null;

// VITE_API_URL: defaults to empty string so fetch uses relative '/api' via Vite proxy
export const API_URL = import.meta.env.VITE_API_URL || '';

// VITE_SOCKET_URL: if empty, defaults to window.location.origin (for Vite proxy / same-origin tunnel)
const envSocketUrl = import.meta.env.VITE_SOCKET_URL?.trim();

export const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL || '';

export const SERVER_URL =
  queryServer ||
  (envSocketUrl && envSocketUrl.length > 0
    ? envSocketUrl
    : (typeof window !== 'undefined' && window.location.origin
        ? window.location.origin
        : 'http://localhost:5173'));

export const socket = io(SERVER_URL, {
  autoConnect: true,
});
