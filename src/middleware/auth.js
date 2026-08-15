import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/db.js';
import { DASHBOARD_ROLES, CITIZEN_ROLES, can } from '../utils/permissions.js';

/**
 * Verifies the Bearer JWT, loads the corresponding active user, and attaches
 * it to req.user. Protected routes should list this before requireDashboardAccess().
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentification requise.' });

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    return res.status(401).json({ message: 'Token invalide ou expiré.' });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) {
    return res.status(401).json({ message: 'Compte introuvable ou désactivé.' });
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return res.status(423).json({ message: 'Compte temporairement verrouillé.' });
  }

  req.user = user;
  next();
}

/**
 * Hard gate applied to every /api route except /api/auth/login: only the
 * three "terrain" authority roles may use this dashboard's API at all.
 * ADMIN and CITIZEN accounts exist in the data model (zone assignment,
 * future citizen reports) but this backend never issues them a usable
 * session here — they belong to separate interfaces not built in this pass.
 */
export function requireDashboardAccess(req, res, next) {
  if (!req.user || !DASHBOARD_ROLES.includes(req.user.role)) {
    return res.status(403).json({ message: 'Accès réservé aux autorités habilitées.' });
  }
  next();
}

/**
 * Hard gate for every /api/citizen route except register/login: only
 * CITIZEN accounts may use this API. Mirrors requireDashboardAccess above
 * but for the opposite audience — a dashboard authority's token is valid
 * (requireAuth passes) but must never unlock citizen-only data either, so
 * this is a real symmetric split, not just "not blocked by the other gate".
 */
export function requireCitizenAccess(req, res, next) {
  if (!req.user || !CITIZEN_ROLES.includes(req.user.role)) {
    return res.status(403).json({ message: 'Accès réservé aux comptes citoyens.' });
  }
  next();
}

/**
 * Fine-grained action gate, e.g. requireCapability('canDispatch'). Checked
 * server-side against src/utils/permissions.js — the frontend button being
 * hidden is a UX nicety, this is the actual authorization boundary.
 */
export function requireCapability(capability) {
  return (req, res, next) => {
    if (!can(req.user, capability)) {
      return res.status(403).json({ message: "Vous n'avez pas la permission d'effectuer cette action." });
    }
    next();
  };
}

/** Generic role gate, kept for any future ADMIN-only route mounted on this same API. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Authentification requise.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Vous n'avez pas la permission d'effectuer cette action." });
    }
    next();
  };
}
