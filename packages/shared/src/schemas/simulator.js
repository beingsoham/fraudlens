import { z } from 'zod';
import { SCENARIO_LABEL } from '../constants/enums.js';

/**
 * Scenario mix for the simulator. Weights are relative, not percentages: the
 * generator normalises them, so `{ NORMAL: 70, HIGH_VALUE: 10 }` and
 * `{ NORMAL: 7, HIGH_VALUE: 1 }` describe the same distribution.
 */
export const scenarioDistributionSchema = z
  .object({
    [SCENARIO_LABEL.NORMAL]: z.coerce.number().min(0).max(1000).optional(),
    [SCENARIO_LABEL.HIGH_VALUE]: z.coerce.number().min(0).max(1000).optional(),
    [SCENARIO_LABEL.RAPID_TRANSFER]: z.coerce.number().min(0).max(1000).optional(),
    [SCENARIO_LABEL.NEW_DEVICE]: z.coerce.number().min(0).max(1000).optional(),
    [SCENARIO_LABEL.SUSPICIOUS_RECEIVER]: z.coerce.number().min(0).max(1000).optional(),
    [SCENARIO_LABEL.VOLUME_SPIKE]: z.coerce.number().min(0).max(1000).optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((weight) => typeof weight === 'number' && weight > 0),
    { message: 'At least one scenario must have a weight above zero' },
  );

/** Body of `POST /api/v1/simulator/start`. */
export const startSimulatorSchema = z
  .object({
    /** Transactions generated per second. The server also enforces its own cap. */
    ratePerSecond: z.coerce.number().min(0.1).max(100).optional(),
    /** RNG seed. The same seed and distribution reproduce the same stream. */
    seed: z.coerce
      .number()
      .int()
      .min(0)
      .max(2 ** 31 - 1)
      .optional(),
    scenarioDistribution: scenarioDistributionSchema.optional(),
    /** Stop automatically after this many transactions. Omit to run until stopped. */
    maxTransactions: z.coerce.number().int().min(1).max(1_000_000).optional(),
  })
  .strict();
