import { io } from 'socket.io-client';

export const SERVER_URL = 'https://kh6fr8qd-3000.euw.devtunnels.ms/';

export const socket = io(SERVER_URL);
