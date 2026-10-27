import { z } from 'zod';
import {
  DEFAULT_CURRENCY,
  CURRENCIES,
  RISK_CATEGORIES,
  SCENARIO_LABELS,
  TRANSACTION_CHANNEL,
  TRANSACTION_CHANNELS,
  TRANSACTION_STATUS,
  TRANSACTION_STATUSES,
} from '../constants/enums.js';
import { TRANSACTION_SORT_FIELDS } from '../constants/pagination.js';
import { amountSchema, isoDateTimeSchema, paginationSchema, searchSchema } from './common.js';

/**
 * A synthetic account reference, e.g. `priya@fraudlens`. Deliberately not a
 * real VPA format: FraudLens never handles live payment identifiers.
 */
export const accountRefSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9._-]+@[a-z0-9-]+$/i, 'Must look like `handle@provider`');

/** Synthetic device fingerprint supplied by the ingesting client. */
export const deviceFingerprintSchema = z
  .string()
  .trim()
  .min(6)
  .max(128)
  .regex(/^[A-Za-z0-9_:-]+$/, 'Device fingerprint may contain letters, digits, _ : and -');

/**
 * Payload accepted by `POST /api/v1/transactions/ingest`.
 *
 * Note what is *absent*: the client may not supply a risk score, risk
 * category, triggered rules, or any historical statistic. All of those are
 * derived server-side from persisted data. `isNewDevice` is likewise computed
 * by the server, not trusted from the caller.
 */
export const ingestTransactionSchema = z
  .object({
    externalId: z
      .string()
      .trim()
      .min(6, 'externalId must be at least 6 characters')
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, 'externalId may contain letters, digits, _ and -'),
    senderRef: accountRefSchema,
    receiverRef: accountRefSchema,
    amount: amountSchema,
    currency: z.enum(CURRENCIES).default(DEFAULT_CURRENCY),
    occurredAt: isoDateTimeSchema,
    deviceFingerprint: deviceFingerprintSchema,
    channel: z.enum(TRANSACTION_CHANNELS).default(TRANSACTION_CHANNEL.UPI_P2P),
    status: z.enum(TRANSACTION_STATUSES).default(TRANSACTION_STATUS.COMPLETED),
    /**
     * Optional idempotency key. When omitted the unique `externalId` still
     * guarantees at-most-once ingestion.
     */
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
    /**
     * Ground-truth scenario label. Only accepted from trusted internal callers
     * (the simulator); the HTTP route strips it from untrusted request bodies.
     */
    scenarioLabel: z.enum(SCENARIO_LABELS).optional(),
  })
  .strict()
  .refine((value) => value.senderRef.toLowerCase() !== value.receiverRef.toLowerCase(), {
    message: 'A transaction cannot have the same sender and receiver',
    path: ['receiverRef'],
  })
  .refine((value) => value.occurredAt.getTime() <= Date.now() + 5 * 60 * 1000, {
    message: 'occurredAt may not be more than 5 minutes in the future',
    path: ['occurredAt'],
  });

/** Shape the public HTTP route accepts: no ground-truth label from the outside. */
export const ingestTransactionRequestSchema = ingestTransactionSchema;

/** Query parameters for `GET /api/v1/transactions`. */
export const listTransactionsQuerySchema = paginationSchema
  .extend({
    sortBy: z.enum(TRANSACTION_SORT_FIELDS).default('occurredAt'),
    search: searchSchema.optional(),
    riskCategory: z
      .union([z.enum(RISK_CATEGORIES), z.array(z.enum(RISK_CATEGORIES))])
      .optional()
      .transform((value) => (value === undefined ? undefined : [].concat(value))),
    status: z
      .union([z.enum(TRANSACTION_STATUSES), z.array(z.enum(TRANSACTION_STATUSES))])
      .optional()
      .transform((value) => (value === undefined ? undefined : [].concat(value))),
    channel: z
      .union([z.enum(TRANSACTION_CHANNELS), z.array(z.enum(TRANSACTION_CHANNELS))])
      .optional()
      .transform((value) => (value === undefined ? undefined : [].concat(value))),
    minAmount: z.coerce.number().nonnegative().optional(),
    maxAmount: z.coerce.number().positive().optional(),
    minRiskScore: z.coerce.number().int().min(0).max(100).optional(),
    maxRiskScore: z.coerce.number().int().min(0).max(100).optional(),
    accountRef: accountRefSchema.optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  })
  .refine(
    (value) =>
      value.minAmount === undefined ||
      value.maxAmount === undefined ||
      value.minAmount <= value.maxAmount,
    { message: '`minAmount` must not exceed `maxAmount`', path: ['minAmount'] },
  )
  .refine(
    (value) =>
      value.minRiskScore === undefined ||
      value.maxRiskScore === undefined ||
      value.minRiskScore <= value.maxRiskScore,
    { message: '`minRiskScore` must not exceed `maxRiskScore`', path: ['minRiskScore'] },
  );

/** Query parameters for the account relationship graph. */
export const accountGraphQuerySchema = z
  .object({
    accountRef: accountRefSchema.optional(),
    /** How many relationship hops to expand from the focus account. */
    depth: z.coerce.number().int().min(1).max(3).default(1),
    /** Maximum number of nodes returned, to keep the graph renderable. */
    limit: z.coerce.number().int().min(5).max(300).default(60),
    minAmount: z.coerce.number().nonnegative().optional(),
    minTransferCount: z.coerce.number().int().min(1).max(100).default(1),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  });

export const relatedTransactionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
