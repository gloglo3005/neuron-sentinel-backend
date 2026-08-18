import { Server } from 'socket.io';
import { isAllowedOrigin } from '../config/corsOrigins.js';

let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
      },
      credentials: true,
    },
  });
  io.on('connection', (socket) => {
    // No per-user rooms yet — every connected dashboard client gets every
    // event. Fine for a handful of concurrent authorities in the MVP;
    // room-per-zone would be the first scaling step.
    socket.on('disconnect', () => {});
  });
  return io;
}

// Events emitted so far: alert.created, alert.updated, alert.dispatched,
// incident.created, intervention.updated, prediction.updated — matches
// spec section 30. Call sites are in the relevant controllers.
export function emit(event, payload) {
  if (!io) return; // socket not initialized (e.g. during tests) — no-op rather than throw
  io.emit(event, payload);
}