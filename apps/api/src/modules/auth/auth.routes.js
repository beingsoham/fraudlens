import { Router } from 'express';
import { loginSchema } from '@fraudlens/shared/schemas';
import { authenticate, authenticateOptional } from '../../middleware/authenticate.js';
import { validateBody } from '../../middleware/validate.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { getCurrentUser, login, logout } from './auth.controller.js';

const router = Router();

router.post('/login', authLimiter, validateBody(loginSchema), login);

// Logout tolerates an expired or absent session so that a stale tab can still
// clear its cookies instead of being stuck on a 401.
router.post('/logout', authenticateOptional, logout);

router.get('/me', authenticate, getCurrentUser);

export default router;
