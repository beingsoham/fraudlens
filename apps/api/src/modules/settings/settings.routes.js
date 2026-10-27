import { Router } from 'express';
import {
  ruleIdParamSchema,
  updateFraudRuleSchema,
  updateRiskSettingsSchema,
} from '@fraudlens/shared/schemas';
import { PERMISSION } from '@fraudlens/shared/constants';
import { requirePermission } from '../../middleware/authorize.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { getRules, patchRiskSettings, patchRule } from './settings.controller.js';

const router = Router();

// Reading the ruleset is broadly available so investigators can see why a score
// came out as it did. Changing it requires `settings:write`, which only an
// administrator holds.
router.get('/rules', requirePermission(PERMISSION.SETTINGS_READ), getRules);

router.patch(
  '/rules/:ruleId',
  requirePermission(PERMISSION.SETTINGS_WRITE),
  validateParams(ruleIdParamSchema),
  validateBody(updateFraudRuleSchema),
  patchRule,
);

router.patch(
  '/risk',
  requirePermission(PERMISSION.SETTINGS_WRITE),
  validateBody(updateRiskSettingsSchema),
  patchRiskSettings,
);

export default router;
