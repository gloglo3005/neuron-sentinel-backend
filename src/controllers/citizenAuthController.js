import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// Same signing logic as authController.js's dashboard login — same secret,
// same shape ({ sub, role }). requireAuth doesn't care which controller
// issued the token, only requireDashboardAccess vs requireCitizenAccess
// decide what it's allowed to reach afterwards.
function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

function publicUser(user) {
  const { passwordHash, twoFactorSecret, failedLoginAttempts, ...safe } = user;
  return safe;
}

// POST /api/citizen/auth/register  { name, phone, password }
// Unlike the dashboard (no self-registration at all — accounts are
// provisioned by seed/admin), the PWA needs open sign-up. Deliberately
// simple for the hackathon: no SMS/OTP verification of the phone number —
// see conversation notes. Always creates role: CITIZEN; there is no way to
// self-register as anything else through this endpoint.
export const register = asyncHandler(async (req, res) => {
  const { name, phone, password } = req.body;
  if (!name || !phone || !password) {
    throw new HttpError(400, 'Nom, téléphone et mot de passe sont requis.');
  }
  if (password.length < 6) {
    throw new HttpError(400, 'Le mot de passe doit contenir au moins 6 caractères.');
  }

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    throw new HttpError(409, 'Un compte existe déjà avec ce numéro de téléphone.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, phone, passwordHash, role: 'CITIZEN' },
  });

  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

// POST /api/citizen/auth/login  { phone, password }
// Same account-lockout behaviour as the dashboard's login (5 failed
// attempts -> 15 min lock) — no reason a citizen-facing endpoint should be
// less resistant to brute force than the authority one.
export const login = asyncHandler(async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) throw new HttpError(400, 'Téléphone et mot de passe requis.');

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || !user.isActive || user.role !== 'CITIZEN') {
    return res.status(401).json({ message: 'Identifiants invalides.' });
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return res.status(423).json({ message: `Compte temporairement verrouillé. Réessayez après ${user.lockedUntil.toLocaleTimeString('fr-FR')}.` });
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
    return res.status(401).json({ message: 'Identifiants invalides.' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

// GET /api/citizen/auth/me
export const me = asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user) });
});
