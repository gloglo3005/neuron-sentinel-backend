import { Router } from 'express';
import { register, login, me } from '../controllers/citizenAuthController.js';
import {
  updateLocation, getCurrentZone, listAlertsForCitizen, createReport, listMyReports,
} from '../controllers/citizenController.js';
import { requireAuth, requireCitizenAccess } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { validate, registerSchema, loginSchema, locationSchema, createReportSchema } from '../validators/citizenValidators.js';

const router = Router();

// Public — no SMS/OTP for now (hackathon), same account-lockout protection
// as the dashboard login (see citizenAuthController.js).
router.post('/auth/register', loginLimiter, validate(registerSchema), register);
router.post('/auth/login', loginLimiter, validate(loginSchema), login);

// Everything below requires a citizen session.
router.use(requireAuth, requireCitizenAccess);

router.get('/auth/me', me);
router.post('/location', validate(locationSchema), updateLocation);
router.get('/zone/current', getCurrentZone);
router.get('/alerts', listAlertsForCitizen);
router.post('/reports', validate(createReportSchema), createReport);
router.get('/reports/mine', listMyReports);

export default router;
