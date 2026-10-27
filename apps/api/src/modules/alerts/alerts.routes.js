import { Router } from 'express';
import { z } from 'zod';
import {
  createInvestigationNoteSchema,
  listAlertsQuerySchema,
  listNotesQuerySchema,
  updateAlertAssignmentSchema,
  updateAlertStatusSchema,
  uuidSchema,
} from '@fraudlens/shared/schemas';
import { PERMISSION } from '@fraudlens/shared/constants';
import { requirePermission } from '../../middleware/authorize.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import {
  createNote,
  detail,
  investigators,
  list,
  listNotes,
  patchAssignment,
  patchStatus,
} from './alerts.controller.js';

const router = Router();
const idParams = z.object({ id: uuidSchema });

router.get(
  '/',
  requirePermission(PERMISSION.ALERTS_READ),
  validateQuery(listAlertsQuerySchema),
  list,
);

// Declared before `/:id` so the literal path is not captured by the parameter.
router.get('/investigators', requirePermission(PERMISSION.ALERTS_READ), investigators);

router.get('/:id', requirePermission(PERMISSION.ALERTS_READ), validateParams(idParams), detail);

router.patch(
  '/:id/assignment',
  requirePermission(PERMISSION.ALERTS_ASSIGN),
  validateParams(idParams),
  validateBody(updateAlertAssignmentSchema),
  patchAssignment,
);

router.patch(
  '/:id/status',
  requirePermission(PERMISSION.ALERTS_UPDATE_STATUS),
  validateParams(idParams),
  validateBody(updateAlertStatusSchema),
  patchStatus,
);

router.post(
  '/:id/notes',
  requirePermission(PERMISSION.ALERTS_NOTE_CREATE),
  validateParams(idParams),
  validateBody(createInvestigationNoteSchema),
  createNote,
);

router.get(
  '/:id/notes',
  requirePermission(PERMISSION.ALERTS_READ),
  validateParams(idParams),
  validateQuery(listNotesQuerySchema),
  listNotes,
);

export default router;
