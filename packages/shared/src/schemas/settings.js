import { z } from 'zod';
import { MAX_RISK_SCORE, RULE_IDS } from '../constants/rules.js';

/**
 * Body of `PATCH /api/v1/settings/rules/:ruleId`.
 *
 * `config` is validated per rule by `ruleConfigSchemas` below, so an operator
 * cannot store a nonsensical parameter set that would break scoring later.
 */
export const updateFraudRuleSchema = z
  .object({
    enabled: z.boolean().optional(),
    weight: z.coerce.number().min(0).max(MAX_RISK_SCORE).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one of `enabled`, `weight` or `config` must be provided',
  });

const positive = z.coerce.number().positive();
const nonNegativeInt = z.coerce.number().int().nonnegative();
const positiveInt = z.coerce.number().int().positive();

/**
 * Per-rule configuration schemas. Each enforces the orderings the scoring code
 * relies on (threshold below saturation, and so on) so the engine can assume a
 * valid configuration without defensive checks at scoring time.
 */
export const ruleConfigSchemas = {
  HIGH_AMOUNT: z
    .object({ thresholdAmount: positive, saturationAmount: positive })
    .strict()
    .refine((c) => c.thresholdAmount < c.saturationAmount, {
      message: '`thresholdAmount` must be below `saturationAmount`',
      path: ['thresholdAmount'],
    }),
  HISTORICAL_AMOUNT_ANOMALY: z
    .object({
      minHistoryCount: positiveInt,
      zScoreThreshold: positive,
      zScoreSaturation: positive,
      lookbackDays: positiveInt.max(365),
    })
    .strict()
    .refine((c) => c.zScoreThreshold < c.zScoreSaturation, {
      message: '`zScoreThreshold` must be below `zScoreSaturation`',
      path: ['zScoreThreshold'],
    }),
  HIGH_VELOCITY: z
    .object({
      windowMinutes: positiveInt.max(1440),
      countThreshold: positiveInt,
      countSaturation: positiveInt,
    })
    .strict()
    .refine((c) => c.countThreshold < c.countSaturation, {
      message: '`countThreshold` must be below `countSaturation`',
      path: ['countThreshold'],
    }),
  NEW_DEVICE: z
    .object({
      lookbackDays: positiveInt.max(365),
      minHistoryCount: nonNegativeInt,
      newAccountDampening: z.coerce.number().min(0).max(1),
    })
    .strict(),
  RAPID_REPEATED_TRANSFERS: z
    .object({
      windowMinutes: positiveInt.max(1440),
      countThreshold: positiveInt,
      countSaturation: positiveInt,
    })
    .strict()
    .refine((c) => c.countThreshold < c.countSaturation, {
      message: '`countThreshold` must be below `countSaturation`',
      path: ['countThreshold'],
    }),
  SUSPICIOUS_RECEIVER_FANIN: z
    .object({
      windowHours: positiveInt.max(720),
      distinctSenderThreshold: positiveInt,
      distinctSenderSaturation: positiveInt,
    })
    .strict()
    .refine((c) => c.distinctSenderThreshold < c.distinctSenderSaturation, {
      message: '`distinctSenderThreshold` must be below `distinctSenderSaturation`',
      path: ['distinctSenderThreshold'],
    }),
  UNUSUAL_TRANSACTION_TIME: z
    .object({
      minHistoryCount: positiveInt,
      lookbackDays: positiveInt.max(365),
      rareHourShare: z.coerce.number().min(0).max(1),
      quietHoursUtc: z.array(z.coerce.number().int().min(0).max(23)).max(24),
    })
    .strict(),
  SUDDEN_ACTIVITY_INCREASE: z
    .object({
      recentWindowHours: positiveInt.max(168),
      baselineWindowDays: positiveInt.max(365),
      minBaselineCount: positiveInt,
      ratioThreshold: positive,
      ratioSaturation: positive,
    })
    .strict()
    .refine((c) => c.ratioThreshold < c.ratioSaturation, {
      message: '`ratioThreshold` must be below `ratioSaturation`',
      path: ['ratioThreshold'],
    }),
};

/** Validates a rule's configuration object against that rule's own schema. */
export function parseRuleConfig(ruleId, config) {
  const schema = ruleConfigSchemas[ruleId];
  if (!schema) {
    return { success: false, error: `Unknown rule id: ${ruleId}` };
  }
  const result = schema.safeParse(config);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export const ruleIdParamSchema = z.object({
  ruleId: z.enum(RULE_IDS),
});

/**
 * Body of `PATCH /api/v1/settings/risk`.
 *
 * The orderings are enforced here so the category boundaries can never be
 * stored inconsistently (a medium threshold above the high threshold would make
 * the MEDIUM band empty and silently change every score's meaning).
 */
export const updateRiskSettingsSchema = z
  .object({
    mediumThreshold: z.coerce.number().int().min(1).max(MAX_RISK_SCORE).optional(),
    highThreshold: z.coerce.number().int().min(2).max(MAX_RISK_SCORE).optional(),
    alertThreshold: z.coerce.number().int().min(1).max(MAX_RISK_SCORE).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one threshold must be provided',
  });

/** Validates a complete, merged risk-settings object. */
export const riskSettingsSchema = z
  .object({
    mediumThreshold: z.coerce.number().int().min(1).max(MAX_RISK_SCORE),
    highThreshold: z.coerce.number().int().min(2).max(MAX_RISK_SCORE),
    alertThreshold: z.coerce.number().int().min(1).max(MAX_RISK_SCORE),
  })
  .refine((value) => value.mediumThreshold < value.highThreshold, {
    message: '`mediumThreshold` must be below `highThreshold`',
    path: ['mediumThreshold'],
  })
  .refine((value) => value.alertThreshold >= value.mediumThreshold, {
    message: '`alertThreshold` must be at or above `mediumThreshold`',
    path: ['alertThreshold'],
  });
