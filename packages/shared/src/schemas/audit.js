import { z } from 'zod';
import { AUDIT_SORT_FIELDS } from '../constants/pagination.js';
import { isoDateTimeSchema, paginationSchema, searchSchema, uuidSchema } from './common.js';

/** Actions recorded in the audit log. */
export const AUDIT_ACTION = {
  USER_LOGIN: 'user.login',
  USER_LOGIN_FAILED: 'user.login_failed',
  USER_LOGOUT: 'user.logout',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_ACTIVATED: 'user.activated',
  USER_DEACTIVATED: 'user.deactivated',
  USER_PASSWORD_RESET: 'user.password_reset',
  TRANSACTION_INGESTED: 'transaction.ingested',
  TRANSACTION_INGEST_DUPLICATE: 'transaction.ingest_duplicate',
  ALERT_CREATED: 'alert.created',
  ALERT_ASSIGNED: 'alert.assigned',
  ALERT_UNASSIGNED: 'alert.unassigned',
  ALERT_STATUS_CHANGED: 'alert.status_changed',
  ALERT_RESOLVED: 'alert.resolved',
  ALERT_REOPENED: 'alert.reopened',
  ALERT_NOTE_ADDED: 'alert.note_added',
  RULE_UPDATED: 'rule.updated',
  RISK_SETTINGS_UPDATED: 'risk_settings.updated',
  SIMULATOR_STARTED: 'simulator.started',
  SIMULATOR_STOPPED: 'simulator.stopped',
  ANALYTICS_EXPORTED: 'analytics.exported',
};
export const AUDIT_ACTIONS = Object.values(AUDIT_ACTION);

export const AUDIT_ENTITY_TYPE = {
  USER: 'user',
  TRANSACTION: 'transaction',
  ALERT: 'alert',
  INVESTIGATION_NOTE: 'investigation_note',
  FRAUD_RULE: 'fraud_rule',
  RISK_SETTINGS: 'risk_settings',
  SIMULATOR: 'simulator',
  EXPORT: 'export',
};
export const AUDIT_ENTITY_TYPES = Object.values(AUDIT_ENTITY_TYPE);

export const listAuditLogsQuerySchema = paginationSchema
  .extend({
    sortBy: z.enum(AUDIT_SORT_FIELDS).default('createdAt'),
    search: searchSchema.optional(),
    action: z
      .union([z.enum(AUDIT_ACTIONS), z.array(z.enum(AUDIT_ACTIONS))])
      .optional()
      .transform((value) => (value === undefined ? undefined : [].concat(value))),
    entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
    entityId: z.string().trim().min(1).max(64).optional(),
    actorId: uuidSchema.optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  });
