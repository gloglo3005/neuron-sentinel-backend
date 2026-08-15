import { Router } from 'express';
import { login, me, logout } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Deliberately the ONLY unauthenticated route in this whole API.
router.post('/login', loginLimiter, login);

router.get('/me', requireAuth, me);
router.post('/logout', requireAuth, logout);

export default router;
