import { Server } from 'socket.io';
import { env } from '../config/env.js';

let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, { cors: { origin: env.corsOrigin } });
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