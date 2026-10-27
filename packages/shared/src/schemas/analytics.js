import { z } from 'zod';
import { GROUND_TRUTH_SOURCE } from '../constants/metrics.js';
import { isoDateTimeSchema, seriesIntervalSchema } from './common.js';

/** Shared `?from=&to=` range used by the dashboard and analytics endpoints. */
export const analyticsRangeSchema = z
  .object({
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  });

export const transactionSeriesQuerySchema = z
  .object({
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    interval: seriesIntervalSchema,
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  });

export const topRulesQuerySchema = z
  .object({
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(20).default(8),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  });

export const detectionPerformanceQuerySchema = z
  .object({
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    /**
     * Which ground truth to evaluate against. SIMULATOR uses generator scenario
     * labels; INVESTIGATION uses outcomes a human recorded on resolved alerts.
     */
    source: z.enum(Object.values(GROUND_TRUTH_SOURCE)).default(GROUND_TRUTH_SOURCE.SIMULATOR),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  });

/** Datasets the CSV export endpoint can produce. */
export const EXPORT_DATASETS = ['transactions', 'alerts', 'rule-performance', 'audit-logs'];

export const exportQuerySchema = z
  .object({
    dataset: z.enum(EXPORT_DATASETS).default('transactions'),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50_000).default(10_000),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  });
