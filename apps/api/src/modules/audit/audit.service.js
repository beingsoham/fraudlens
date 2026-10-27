import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { clientIp } from '../../utils/http.js';

/**
 * Metadata keys that may be persisted on an audit event.
 *
 * Audit rows are retained indefinitely and visible to administrators, so the
 * allow-list is explicit: anything not named here is dropped rather than
 * stored. This is what stops a password, a token or a whole request body from
 * being written into the audit trail by a careless call site.
 */
const ALLOWED_METADATA_KEYS = new Set([
  'email',
  'role',
  'previousRole',
  'isActive',
  'previousIsActive',
  'name',
  'targetUserId',
  'targetUserEmail',
  'externalId',
  'transactionId',
  'amount',
  'currency',
  'riskScore',
  'riskCategory',
  'rulesetVersion',
  'triggeredRuleIds',
  'alertId',
  'severity',
  'status',
  'previousStatus',
  'outcome',
  'previousOutcome',
  'assignedToId',
  'previousAssignedToId',
  'noteId',
  'noteLength',
  'ruleId',
  'enabled',
  'previousEnabled',
  'weight',
  'previousWeight',
  'configKeys',
  'mediumThreshold',
  'highThreshold',
  'alertThreshold',
  'previousThresholds',
  'reopenReason',
  'reopenCount',
  'dataset',
  'rowCount',
  'from',
  'to',
  'ratePerSecond',
  'seed',
  'scenarioDistribution',
  'maxTransactions',
  'reason',
  'source',
  'duplicateOf',
]);

/** Values longer than this are truncated; audit metadata is not a text store. */
const MAX_STRING_LENGTH = 500;

/**
 * Filters a metadata object down to the allow-listed keys and coerces the
 * values into JSON-safe primitives.
 */
export function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;

  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;

    if (value instanceof Date) {
      safe[key] = value.toISOString();
    } else if (typeof value === 'string') {
      safe[key] = value.slice(0, MAX_STRING_LENGTH);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value;
    } else if (Array.isArray(value)) {
      safe[key] = value
        .slice(0, 50)
        .map((item) => (typeof item === 'string' ? item.slice(0, 120) : item))
        .filter((item) => ['string', 'number', 'boolean'].includes(typeof item));
    } else if (typeof value === 'object') {
      // One level of nesting only, so an accidental deep object cannot bloat
      // the row or smuggle in a disallowed key deeper down.
      const nested = {};
      for (const [nestedKey, nestedValue] of Object.entries(value).slice(0, 20)) {
        if (['string', 'number', 'boolean'].includes(typeof nestedValue)) {
          nested[nestedKey] =
            typeof nestedValue === 'string' ? nestedValue.slice(0, 120) : nestedValue;
        }
      }
      safe[key] = nested;
    }
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

/**
 * Appends an audit event.
 *
 * @param {object} params
 * @param {string|null} params.actorId Acting user, or null for anonymous events.
 * @param {string} params.action One of `AUDIT_ACTION`.
 * @param {string} params.entityType One of `AUDIT_ENTITY_TYPE`.
 * @param {string|null} [params.entityId] Affected record's id.
 * @param {object} [params.metadata] Allow-listed metadata.
 * @param {string} params.requestId Correlation id of the originating request.
 * @param {string|null} [params.ipAddress]
 * @param {object} [params.tx] An open Prisma transaction client, when the audit
 *   event must commit atomically with the change it describes.
 */
export async function recordAudit({
  actorId = null,
  action,
  entityType,
  entityId = null,
  metadata,
  requestId,
  ipAddress = null,
  tx,
}) {
  const client = tx ?? prisma;
  const data = {
    actorId,
    action,
    entityType,
    entityId: entityId ? String(entityId).slice(0, 64) : null,
    metadata: sanitizeMetadata(metadata) ?? undefined,
    requestId: requestId ?? 'internal',
    ipAddress: ipAddress ? String(ipAddress).slice(0, 64) : null,
  };

  if (tx) {
    // Inside a caller's transaction: let a failure roll the whole unit back,
    // because an audit row that is missing for a change that did commit is
    // worse than the change failing outright.
    return client.auditLog.create({ data });
  }

  try {
    return await client.auditLog.create({ data });
  } catch (error) {
    // Outside a transaction the audited action has already happened. Losing the
    // log entry must not turn a successful request into a failed one, so this
    // is logged loudly instead of thrown.
    logger.error({ err: error, action, entityType, entityId }, 'Failed to record audit event');
    return null;
  }
}

/** Convenience wrapper that pulls actor, request id and IP out of `req`. */
export function auditFromRequest(req, params) {
  return recordAudit({
    actorId: req.user?.id ?? null,
    requestId: req.requestId,
    ipAddress: clientIp(req),
    ...params,
  });
}

export { ALLOWED_METADATA_KEYS };
