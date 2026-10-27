import { Router } from 'express';
import { z } from 'zod';
import {
  accountGraphQuerySchema,
  ingestTransactionRequestSchema,
  listTransactionsQuerySchema,
  relatedTransactionsQuerySchema,
  uuidSchema,
} from '@fraudlens/shared/schemas';
import { PERMISSION } from '@fraudlens/shared/constants';
import { requirePermission } from '../../middleware/authorize.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { ingestLimiter } from '../../middleware/rateLimit.js';
import {
  accountGraph,
  accountSearch,
  accountSummary,
  detail,
  ingest,
  list,
  related,
} from './transactions.controller.js';

const router = Router();
const idParams = z.object({ id: uuidSchema });

router.get(
  '/',
  requirePermission(PERMISSION.TRANSACTIONS_READ),
  validateQuery(listTransactionsQuerySchema),
  list,
);

router.post(
  '/ingest',
  ingestLimiter,
  requirePermission(PERMISSION.TRANSACTIONS_INGEST),
  validateBody(ingestTransactionRequestSchema),
  ingest,
);

// Account routes are declared before `/:id` so that `/accounts/...` is not
// captured by the UUID parameter route.
router.get(
  '/accounts/graph',
  requirePermission(PERMISSION.ACCOUNTS_READ),
  validateQuery(accountGraphQuerySchema),
  accountGraph,
);

router.get(
  '/accounts/search',
  requirePermission(PERMISSION.ACCOUNTS_READ),
  validateQuery(
    z.object({
      search: z.string().trim().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  ),
  accountSearch,
);

router.get(
  '/accounts/:accountRef',
  requirePermission(PERMISSION.ACCOUNTS_READ),
  validateParams(
    z.object({
      accountRef: z
        .string()
        .trim()
        .min(3)
        .max(64)
        .regex(/^[a-z0-9._-]+@[a-z0-9-]+$/i, 'Must look like `handle@provider`'),
    }),
  ),
  validateQuery(accountGraphQuerySchema),
  accountSummary,
);

router.get(
  '/:id',
  requirePermission(PERMISSION.TRANSACTIONS_READ),
  validateParams(idParams),
  detail,
);

router.get(
  '/:id/related',
  requirePermission(PERMISSION.TRANSACTIONS_READ),
  validateParams(idParams),
  validateQuery(relatedTransactionsQuerySchema),
  related,
);

export default router;
