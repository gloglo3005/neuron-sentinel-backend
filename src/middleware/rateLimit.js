import rateLimit from 'express-rate-limit';

// General API traffic.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Login is the highest-value target in this system (it gates access to
// alert validation/dispatch) — throttled far more strictly than the rest
// of the API, independently of the per-account lockout in authController.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de tentatives de connexion. Réessayez plus tard.' },
});
