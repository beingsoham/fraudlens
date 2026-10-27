import { Router } from 'express';
import { startSimulatorSchema } from '@fraudlens/shared/schemas';
import { PERMISSION } from '@fraudlens/shared/constants';
import { requirePermission } from '../../middleware/authorize.js';
import { validateBody } from '../../middleware/validate.js';
import { start, status, stop } from './simulator.controller.js';

const router = Router();

router.get('/status', requirePermission(PERMISSION.SIMULATOR_READ), status);

router.post(
  '/start',
  requirePermission(PERMISSION.SIMULATOR_MANAGE),
  validateBody(startSimulatorSchema),
  start,
);

router.post('/stop', requirePermission(PERMISSION.SIMULATOR_MANAGE), stop);

export default router;
