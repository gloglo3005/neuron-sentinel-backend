import { HttpError } from '../utils/asyncHandler.js';

// Must be registered last, after all routes.
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message });
  }
  console.error(err);
  res.status(500).json({ message: 'Erreur interne du serveur.' });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ message: 'Route introuvable.' });
}
