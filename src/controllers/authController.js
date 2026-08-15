import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { DASHBOARD_ROLES } from '../utils/permissions.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

function publicUser(user) {
  const { passwordHash, twoFactorSecret, failedLoginAttempts, ...safe } = user;
  return safe;
}

async function audit(userId, action, req, metadata) {
  await prisma.auditLog.create({
    data: { userId, action, entityType: 'User', entityId: userId, metadata, ipAddress: req.ip },
  });
}

// POST /api/auth/login
// Hardened on purpose: this is the sole entry point into a dashboard used
// by people making life-safety decisions.
//  - No public self-registration exists anywhere in this API — accounts are
//    provisioned only via the seed script or a future ADMIN interface.
//  - Only AUTHORITY / CIVIL_PROTECTION / EMERGENCY_SERVICE may authenticate
//    here at all, even with a correct password — ADMIN and CITIZEN accounts
//    are rejected outright (spec: "le dashboard est réservé aux autorités").
//  - Failed attempts are counted per-account; 5 failures locks the account
//    for 15 minutes regardless of the requester's IP.
//  - Every attempt (success, bad password, wrong role, locked) is written
//    to AuditLog with the source IP.
export const login = asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) throw new HttpError(400, 'Identifiant et mot de passe requis.');

  const user = await prisma.user.findFirst({ where: { OR: [{ phone: identifier }, { email: identifier }] } });
  if (!user || !user.isActive) {
    return res.status(401).json({ message: 'Identifiants invalides.' });
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit(user.id, 'LOGIN_BLOCKED_LOCKED', req);
    return res.status(423).json({ message: `Compte verrouillé suite à plusieurs échecs. Réessayez après ${user.lockedUntil.toLocaleTimeString('fr-FR')}.` });
  }

  if (!DASHBOARD_ROLES.includes(user.role)) {
    await audit(user.id, 'LOGIN_BLOCKED_ROLE', req, { role: user.role });
    return res.status(403).json({ message: "Ce compte n'a pas accès à ce tableau de bord." });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    const locked = attempts >= MAX_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: locked ? 0 : attempts,
        lockedUntil: locked ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    await audit(user.id, locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', req, { attempts });
    return res.status(401).json({ message: 'Identifiants invalides.' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await audit(user.id, 'LOGIN_SUCCESS', req);

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

// GET /api/auth/me
export const me = asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// POST /api/auth/logout — stateless JWT, so this only exists to produce an
// audit trail; the client is responsible for discarding the token.
export const logout = asyncHandler(async (req, res) => {
  await audit(req.user.id, 'LOGOUT', req);
  res.status(204).end();
});
