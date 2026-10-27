import { z } from 'zod';
import {
  ALERT_SEVERITIES,
  ALERT_STATUS,
  ALERT_STATUSES,
  INVESTIGATION_OUTCOME,
  INVESTIGATION_OUTCOMES,
} from '../constants/enums.js';
import { ALERT_SORT_FIELDS } from '../constants/pagination.js';
import { isoDateTimeSchema, paginationSchema, searchSchema, uuidSchema } from './common.js';

/** Query parameters for `GET /api/v1/alerts`. */
export const listAlertsQuerySchema = paginationSchema
  .extend({
    sortBy: z.enum(ALERT_SORT_FIELDS).default('createdAt'),
    search: searchSchema.optional(),
    status: z
      .union([z.enum(ALERT_STATUSES), z.array(z.enum(ALERT_STATUSES))])
      .optional()
      .transform((value) => (value === undefined ? undefined : [].concat(value))),
    severity: z
      .union([z.enum(ALERT_SEVERITIES), z.array(z.enum(ALERT_SEVERITIES))])
      .optional()
      .transform((value) => (value === undefined ? undefined : [].concat(value))),
    outcome: z
      .union([z.enum(INVESTIGATION_OUTCOMES), z.array(z.enum(INVESTIGATION_OUTCOMES))])
      .optional()
      .transform((value) => (value === undefined ? undefined : [].concat(value))),
    /** `me` resolves to the authenticated user; `unassigned` matches a null assignee. */
    assignedTo: z.union([uuidSchema, z.literal('me'), z.literal('unassigned')]).optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  });

/** Body of `PATCH /api/v1/alerts/:id/assignment`. `null` unassigns. */
export const updateAlertAssignmentSchema = z
  .object({
    assignedToId: uuidSchema.nullable(),
  })
  .strict();

/**
 * Body of `PATCH /api/v1/alerts/:id/status`.
 *
 * Workflow status and investigation outcome are stored separately but are
 * validated together, because the combinations that make sense are limited:
 *  - moving to RESOLVED requires a conclusive outcome and a resolution summary;
 *  - moving back to OPEN or IN_REVIEW resets the outcome to PENDING.
 */
export const updateAlertStatusSchema = z
  .object({
    status: z.enum(ALERT_STATUSES),
    outcome: z.enum(INVESTIGATION_OUTCOMES).optional(),
    resolutionSummary: z.string().trim().min(10).max(2000).optional(),
    /** Required when reopening a resolved alert, and recorded in the audit log. */
    reopenReason: z.string().trim().min(10).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === ALERT_STATUS.RESOLVED) {
      if (!value.outcome || value.outcome === INVESTIGATION_OUTCOME.PENDING) {
        ctx.addIssue({
          code: 'custom',
          path: ['outcome'],
          message:
            'Resolving an alert requires a conclusive outcome: CONFIRMED_FRAUD, LEGITIMATE or INCONCLUSIVE',
        });
      }
      if (!value.resolutionSummary) {
        ctx.addIssue({
          code: 'custom',
          path: ['resolutionSummary'],
          message: 'Resolving an alert requires a resolution summary of at least 10 characters',
        });
      }
    } else if (value.outcome && value.outcome !== INVESTIGATION_OUTCOME.PENDING) {
      ctx.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'An unresolved alert may only carry the PENDING outcome',
      });
    }
  });

/** Body of `POST /api/v1/alerts/:id/notes`. Notes are append-only. */
export const createInvestigationNoteSchema = z
  .object({
    body: z.string().trim().min(3, 'A note needs at least 3 characters').max(4000),
  })
  .strict();

export const listNotesQuerySchema = paginationSchema.extend({
  sortBy: z.literal('createdAt').default('createdAt'),
});
