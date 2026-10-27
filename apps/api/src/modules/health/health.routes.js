import { Router } from 'express';
import { authenticateOptional } from '../../middleware/authenticate.js';
import { health, liveness, readiness } from './health.controller.js';

const router = Router();

// Optional authentication: an anonymous caller gets the pass/fail summary, and
// an authenticated operator gets the detail. Requiring authentication would
// make the endpoint useless to a container orchestrator.
router.get('/', authenticateOptional, health);
router.get('/live', liveness);
router.get('/ready', readiness);

export default router;
