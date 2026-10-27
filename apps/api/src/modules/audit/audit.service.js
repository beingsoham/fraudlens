import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { clientIp } from '../../utils/http.js';
import { sanitizeMetadata } from './audit.metadata.js';

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

// Re-exported so the audit module presents one surface; both are defined in
// the pure `audit.metadata.js`.
export { ALLOWED_METADATA_KEYS, sanitizeMetadata } from './audit.metadata.js';
