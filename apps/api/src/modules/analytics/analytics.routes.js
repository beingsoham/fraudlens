import { Router } from 'express';
import {
  analyticsRangeSchema,
  detectionPerformanceQuerySchema,
  exportQuerySchema,
} from '@fraudlens/shared/schemas';
import { PERMISSION } from '@fraudlens/shared/constants';
import { requirePermission } from '../../middleware/authorize.js';
import { validateQuery } from '../../middleware/validate.js';
import { exportLimiter } from '../../middleware/rateLimit.js';
import {
  datasets,
  detectionPerformance,
  exportCsv,
  overview,
  rulePerformance,
  scoreHistogram,
} from './analytics.controller.js';

const router = Router();
const read = requirePermission(PERMISSION.ANALYTICS_READ);

router.get('/overview', read, validateQuery(analyticsRangeSchema), overview);
router.get(
  '/detection-performance',
  read,
  validateQuery(detectionPerformanceQuerySchema),
  detectionPerformance,
);
router.get('/rule-performance', read, validateQuery(analyticsRangeSchema), rulePerformance);
router.get('/score-histogram', read, validateQuery(analyticsRangeSchema), scoreHistogram);

router.get('/export/datasets', requirePermission(PERMISSION.ANALYTICS_EXPORT), datasets);
router.get(
  '/export',
  exportLimiter,
  requirePermission(PERMISSION.ANALYTICS_EXPORT),
  validateQuery(exportQuerySchema),
  exportCsv,
);

export default router;
