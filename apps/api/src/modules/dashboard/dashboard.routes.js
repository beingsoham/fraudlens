import { Router } from 'express';
import { z } from 'zod';
import {
  analyticsRangeSchema,
  topRulesQuerySchema,
  transactionSeriesQuerySchema,
} from '@fraudlens/shared/schemas';
import { PERMISSION } from '@fraudlens/shared/constants';
import { requirePermission } from '../../middleware/authorize.js';
import { validateQuery } from '../../middleware/validate.js';
import {
  alertTrend,
  recentAlerts,
  recentTransactions,
  riskDistribution,
  summary,
  topRules,
  transactionSeries,
} from './dashboard.controller.js';

const router = Router();
const read = requirePermission(PERMISSION.DASHBOARD_READ);
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

router.get('/summary', read, validateQuery(analyticsRangeSchema), summary);
router.get(
  '/transaction-series',
  read,
  validateQuery(transactionSeriesQuerySchema),
  transactionSeries,
);
router.get('/risk-distribution', read, validateQuery(analyticsRangeSchema), riskDistribution);
router.get('/top-rules', read, validateQuery(topRulesQuerySchema), topRules);
router.get('/alert-trend', read, validateQuery(transactionSeriesQuerySchema), alertTrend);
router.get('/recent-alerts', read, validateQuery(limitQuery), recentAlerts);
router.get('/recent-transactions', read, validateQuery(limitQuery), recentTransactions);

export default router;
