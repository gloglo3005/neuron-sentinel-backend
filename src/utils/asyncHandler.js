// Wraps an async Express handler so a rejected promise reaches the error
// middleware instead of crashing the process (no try/catch boilerplate in
// every controller).
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Small typed error so controllers can throw with an intended HTTP status
// instead of always producing a generic 500.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
