import { Router } from 'express';
import { listAuditLogsQuerySchema } from '@fraudlens/shared/schemas';
import { PERMISSION } from '@fraudlens/shared/constants';
import { requirePermission } from '../../middleware/authorize.js';
import { validateQuery } from '../../middleware/validate.js';
import { getAuditFacets, listAuditLogs } from './audit.controller.js';

const router = Router();

// The audit trail is append-only: this router deliberately exposes no write,
// update or delete route. A database trigger enforces the same rule.
router.get(
  '/',
  requirePermission(PERMISSION.AUDIT_READ),
  validateQuery(listAuditLogsQuerySchema),
  listAuditLogs,
);

router.get('/facets', requirePermission(PERMISSION.AUDIT_READ), getAuditFacets);

export default router;
