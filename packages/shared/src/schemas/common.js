import { z } from 'zod';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SORT_DIRECTIONS,
} from '../constants/pagination.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A UUID identifier as used by every primary key in the schema. */
export const uuidSchema = z.string().regex(UUID_PATTERN, 'Must be a valid UUID');

/** An ISO-8601 date-time string, coerced to a Date. */
export const isoDateTimeSchema = z.coerce.date();

/** Page / pageSize / sortDir, shared by every list endpoint. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sortDir: z.enum(SORT_DIRECTIONS).default('desc'),
});

/**
 * An optional inclusive date range. Validates that `from` is not after `to` so
 * an inverted range fails fast instead of silently returning nothing.
 */
export const dateRangeSchema = z
  .object({
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  });

/** A monetary amount: positive, at most two decimal places, within NUMERIC(14,2). */
export const amountSchema = z.coerce
  .number()
  .positive({ message: 'Amount must be greater than zero' })
  .max(999_999_999_999.99, { message: 'Amount exceeds the supported range' })
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'Amount must have at most two decimal places',
  });

/** A free-text search term, trimmed and length-limited. */
export const searchSchema = z.string().trim().min(1).max(120);

/** Granularity for time-series endpoints. */
export const seriesIntervalSchema = z.enum(['hour', 'day', 'week']).default('day');
