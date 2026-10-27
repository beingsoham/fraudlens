import { SOCKET_EVENT, SOCKET_ROOM } from '@fraudlens/shared/constants';
import { moduleLogger } from '../config/logger.js';

const log = moduleLogger('realtime');

/**
 * Real-time event emission.
 *
 * The Socket.IO server is registered here at startup. Until it is — in unit
 * tests, or in the seed script — every emit is a no-op, so the ingestion
 * pipeline needs no knowledge of whether a socket layer exists.
 *
 * Two rules hold for every emitter below:
 *
 *  1. **Emit only after commit.** Callers invoke these functions *after* their
 *     database transaction has committed. Emitting from inside a transaction
 *     would announce work that a later rollback could undo, leaving clients
 *     showing transactions that do not exist.
 *  2. **Emit to a room, never to everyone.** Each room corresponds to a
 *     permission, so a VIEWER's socket is never in the investigator room and
 *     cannot receive assignment or note metadata.
 */

let io = null;

export function registerSocketServer(server) {
  io = server;
}

export function getSocketServer() {
  return io;
}

/** Test and shutdown helper. */
export function clearSocketServer() {
  io = null;
}

/**
 * Emits to a room, optionally excluding another.
 *
 * `except` matters whenever two rooms overlap and carry different detail
 * levels: an investigator belongs to both the alerts room and the investigator
 * room, so without it they would receive the same event twice — once redacted
 * and once enriched — and a client listening for one event would process it
 * twice.
 */
function emit(room, event, payload, { except } = {}) {
  if (!io) return false;
  try {
    const target = except ? io.to(room).except(except) : io.to(room);
    target.emit(event, payload);
    return true;
  } catch (error) {
    // A failed broadcast must never fail the request that caused it: the
    // authoritative data is already committed and the client will pick it up
    // from the REST API on its next fetch or reconnect.
    log.error({ err: error, event, room }, 'Failed to emit realtime event');
    return false;
  }
}

/**
 * Transaction summary visible to anyone who may read transactions. Device
 * fingerprints and per-rule evidence are deliberately excluded.
 */
export function transactionPayload(transaction, assessment) {
  return {
    id: transaction.id,
    externalId: transaction.externalId,
    senderRef: transaction.senderRef,
    receiverRef: transaction.receiverRef,
    amount: transaction.amount,
    currency: transaction.currency,
    occurredAt:
      transaction.occurredAt instanceof Date
        ? transaction.occurredAt.toISOString()
        : transaction.occurredAt,
    channel: transaction.channel,
    status: transaction.status,
    isNewDevice: transaction.isNewDevice,
    riskScore: assessment?.riskScore ?? null,
    riskCategory: assessment?.riskCategory ?? null,
  };
}

export function emitTransactionCreated(transaction, assessment) {
  return emit(
    SOCKET_ROOM.TRANSACTIONS,
    SOCKET_EVENT.TRANSACTION_CREATED,
    transactionPayload(transaction, assessment),
  );
}

/**
 * Assessment summary. Carries the triggered rule ids and the score, but not the
 * full evidence payload — a client that needs it fetches the transaction detail
 * endpoint, which applies its own authorization.
 */
export function emitTransactionAssessed(transaction, assessment) {
  return emit(SOCKET_ROOM.TRANSACTIONS, SOCKET_EVENT.TRANSACTION_ASSESSED, {
    transactionId: transaction.id,
    externalId: transaction.externalId,
    riskScore: assessment.riskScore,
    riskCategory: assessment.riskCategory,
    rulesetVersion: assessment.rulesetVersion,
    triggeredRuleIds: assessment.triggeredRuleIds,
    assessedAt: new Date().toISOString(),
  });
}

export function emitAlertCreated(alert) {
  return emit(SOCKET_ROOM.ALERTS, SOCKET_EVENT.ALERT_CREATED, {
    id: alert.id,
    transactionId: alert.transactionId,
    severity: alert.severity,
    status: alert.status,
    outcome: alert.outcome,
    riskScore: alert.riskScore ?? null,
    amount: alert.amount ?? null,
    senderRef: alert.senderRef ?? null,
    receiverRef: alert.receiverRef ?? null,
    createdAt:
      alert.createdAt instanceof Date ? alert.createdAt.toISOString() : (alert.createdAt ?? null),
  });
}

/**
 * Alert change notification.
 *
 * The public payload omits assignment details; the investigator room receives a
 * second, richer event carrying the assignee so an investigator's queue can
 * update without a refetch.
 */
export function emitAlertUpdated(alert, { assignedToId = null, assignedToName = null } = {}) {
  const base = {
    id: alert.id,
    transactionId: alert.transactionId,
    severity: alert.severity,
    status: alert.status,
    outcome: alert.outcome,
    updatedAt:
      alert.updatedAt instanceof Date ? alert.updatedAt.toISOString() : (alert.updatedAt ?? null),
    resolvedAt:
      alert.resolvedAt instanceof Date
        ? alert.resolvedAt.toISOString()
        : (alert.resolvedAt ?? null),
    reopenCount: alert.reopenCount ?? 0,
  };

  // Everyone who may read alerts, except investigators, gets the redacted form.
  const delivered = emit(SOCKET_ROOM.ALERTS, SOCKET_EVENT.ALERT_UPDATED, base, {
    except: SOCKET_ROOM.INVESTIGATORS,
  });
  // Investigators get the one enriched copy instead, never both.
  emit(SOCKET_ROOM.INVESTIGATORS, SOCKET_EVENT.ALERT_UPDATED, {
    ...base,
    assignedToId,
    assignedToName,
    resolutionSummary: alert.resolutionSummary ?? null,
  });
  return delivered;
}

export function emitSimulatorStatus(status) {
  return emit(SOCKET_ROOM.SIMULATOR, SOCKET_EVENT.SIMULATOR_STATUS, status);
}
