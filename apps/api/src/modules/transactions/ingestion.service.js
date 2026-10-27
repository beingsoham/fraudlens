import { AUDIT_ACTION, AUDIT_ENTITY_TYPE } from '@fraudlens/shared/schemas';
import { LABEL_SOURCE } from '@fraudlens/shared/constants';
import { Prisma } from '../../generated/prisma/index.js';
import { prisma } from '../../config/prisma.js';
import { moduleLogger } from '../../config/logger.js';
import { DuplicateIngestionError, PRISMA_ERROR, isPrismaError } from '../../utils/errors.js';
import { toAmountNumber, toDecimalString } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { assessTransaction } from '../fraud/engine.js';
import { loadTransactionFeatures } from '../fraud/features.js';
import { getActiveRuleset } from '../fraud/ruleset.service.js';
import {
  emitAlertCreated,
  emitTransactionAssessed,
  emitTransactionCreated,
} from '../../realtime/events.js';

const log = moduleLogger('transactions:ingest');

/** Where an ingested transaction came from. Recorded on the audit event. */
export const INGESTION_SOURCE = {
  API: 'API',
  SIMULATOR: 'SIMULATOR',
  SEED: 'SEED',
};

/**
 * Resolves an account reference to an account row, creating it if absent.
 *
 * Accounts are reference data: an account with no transactions is harmless, so
 * this runs outside the main ingestion transaction to keep that transaction
 * short and to avoid lock ordering between two concurrent inserts of the same
 * pair. A concurrent create loses the unique race and is resolved by re-reading.
 */
async function resolveAccount(accountRef, client = prisma) {
  const normalised = accountRef.toLowerCase();
  const existing = await client.account.findUnique({ where: { accountRef: normalised } });
  if (existing) return existing;

  try {
    return await client.account.create({
      data: {
        accountRef: normalised,
        // A readable default derived from the handle; administrators can rename.
        displayName: normalised
          .split('@')[0]
          .replace(/[._-]+/g, ' ')
          .slice(0, 120),
      },
    });
  } catch (error) {
    if (isPrismaError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
      // Another request created it between our read and our write.
      const row = await client.account.findUnique({ where: { accountRef: normalised } });
      if (row) return row;
    }
    throw error;
  }
}

/** Looks for an already-ingested transaction matching this request. */
async function findExisting({ externalId, idempotencyKey }, client = prisma) {
  const or = [{ externalId }];
  if (idempotencyKey) or.push({ idempotencyKey });
  return client.transaction.findFirst({
    where: { OR: or },
    include: {
      sender: { select: { accountRef: true, displayName: true } },
      receiver: { select: { accountRef: true, displayName: true } },
      riskAssessments: { orderBy: { assessedAt: 'desc' }, take: 1 },
      alerts: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
}

/** Shapes the ingestion response. */
function toIngestionResult({ transaction, assessment, alert, duplicate = false }) {
  return {
    duplicate,
    transaction: {
      id: transaction.id,
      externalId: transaction.externalId,
      senderRef: transaction.senderRef,
      receiverRef: transaction.receiverRef,
      amount: toAmountNumber(transaction.amount),
      currency: transaction.currency,
      occurredAt: transaction.occurredAt,
      channel: transaction.channel,
      status: transaction.status,
      isNewDevice: transaction.isNewDevice,
      createdAt: transaction.createdAt,
    },
    assessment: {
      id: assessment.id ?? null,
      riskScore: assessment.riskScore,
      riskCategory: assessment.riskCategory,
      rulesetVersion: assessment.rulesetVersion,
      triggeredRuleIds: assessment.triggeredRuleIds,
      explanations: assessment.explanations,
      assessedAt: assessment.assessedAt ?? null,
    },
    alert: alert
      ? {
          id: alert.id,
          severity: alert.severity,
          status: alert.status,
          outcome: alert.outcome,
          createdAt: alert.createdAt,
        }
      : null,
  };
}

/**
 * Ingests one transaction: validate, score, persist, alert, audit, announce.
 *
 * ## Atomicity
 *
 * The transaction row, its risk assessment, any alert, the ground-truth label
 * and the audit event are written inside a single PostgreSQL transaction. If
 * any step fails, nothing is persisted — there is never a transaction without
 * its assessment, nor an alert pointing at an assessment that was rolled back.
 *
 * ## Why features are computed inside the transaction
 *
 * Historical features are read inside the same transaction, after taking a
 * per-sender advisory lock. Two concurrent payments from one account would
 * otherwise each see a pre-burst history and each under-count the other, so a
 * rapid pair could both score as a first transaction. The lock serialises
 * ingestion per sender while leaving different senders fully concurrent.
 *
 * ## Why events are emitted after commit
 *
 * `emit*` calls happen only after `$transaction` resolves. Announcing from
 * inside would let clients observe a transaction that a rollback then erased.
 *
 * @param {object} input Validated payload (see `ingestTransactionSchema`).
 * @param {object} context
 * @param {string|null} context.actorId Authenticated user, or null for internal callers.
 * @param {string} context.requestId
 * @param {string|null} [context.ipAddress]
 * @param {string} [context.source] One of `INGESTION_SOURCE`.
 * @param {boolean} [context.emitEvents] Set false for bulk seeding.
 */
export async function ingestTransaction(input, context) {
  const {
    actorId = null,
    requestId,
    ipAddress = null,
    source = INGESTION_SOURCE.API,
    emitEvents = true,
  } = context;

  // Fast path: a repeat submission is answered without doing any scoring work.
  const preexisting = await findExisting(input);
  if (preexisting) {
    return duplicateResult(preexisting, input, { actorId, requestId, ipAddress });
  }

  const [sender, receiver] = await Promise.all([
    resolveAccount(input.senderRef),
    resolveAccount(input.receiverRef),
  ]);

  const ruleset = await getActiveRuleset();

  let committed;
  try {
    committed = await prisma.$transaction(
      async (tx) => {
        // Serialise ingestion per sender so concurrent payments from the same
        // account each see the other in their velocity and burst features.
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${sender.id}::text, 0))`,
        );

        // Re-check inside the lock: a concurrent request may have committed the
        // same externalId between the fast-path check and here.
        const raced = await tx.transaction.findFirst({
          where: {
            OR: input.idempotencyKey
              ? [{ externalId: input.externalId }, { idempotencyKey: input.idempotencyKey }]
              : [{ externalId: input.externalId }],
          },
          select: { id: true },
        });
        if (raced) {
          throw new DuplicateIngestionError('This transaction has already been ingested', {
            externalId: input.externalId,
          });
        }

        const features = await loadTransactionFeatures(
          {
            senderId: sender.id,
            receiverId: receiver.id,
            amount: input.amount,
            occurredAt: input.occurredAt,
            deviceFingerprint: input.deviceFingerprint,
          },
          ruleset,
          tx,
        );

        const assessment = assessTransaction({
          transaction: {
            amount: input.amount,
            occurredAt: input.occurredAt,
            senderRef: sender.accountRef,
            receiverRef: receiver.accountRef,
            channel: input.channel,
          },
          features,
          ruleset,
        });

        const transaction = await tx.transaction.create({
          data: {
            externalId: input.externalId,
            senderId: sender.id,
            receiverId: receiver.id,
            amount: new Prisma.Decimal(toDecimalString(input.amount)),
            currency: input.currency,
            occurredAt: input.occurredAt,
            deviceFingerprint: input.deviceFingerprint,
            // Derived from persisted device history, never taken from the client.
            isNewDevice: !features.device.isKnown,
            channel: input.channel,
            status: input.status,
            idempotencyKey: input.idempotencyKey ?? null,
          },
        });

        const riskAssessment = await tx.riskAssessment.create({
          data: {
            transactionId: transaction.id,
            rulesetVersion: assessment.rulesetVersion,
            riskScore: assessment.riskScore,
            riskCategory: assessment.riskCategory,
            triggeredRules: assessment.triggeredRules,
            explanations: assessment.explanations,
            features: {
              windows: features.windows,
              sender: {
                historyCount: features.sender.historyCount,
                amountHistoryCount: features.sender.amountHistoryCount,
                amountMedian: features.sender.amountMedian,
                amountMad: features.sender.amountMad,
                knownDeviceCount: features.sender.knownDeviceCount,
                transactionsInVelocityWindow: features.sender.transactionsInVelocityWindow,
                hourHistoryCount: features.sender.hourHistoryCount,
                recentCount: features.sender.recentCount,
                recentValue: features.sender.recentValue,
                baselineCount: features.sender.baselineCount,
                baselineValue: features.sender.baselineValue,
              },
              pair: features.pair,
              receiver: features.receiver,
              device: { isKnown: features.device.isKnown },
            },
          },
        });

        let alert = null;
        if (assessment.alert.shouldCreate) {
          alert = await tx.alert.create({
            data: {
              transactionId: transaction.id,
              riskAssessmentId: riskAssessment.id,
              severity: assessment.alert.severity,
            },
          });
        }

        // Ground truth, stored in its own table so it can never be mistaken
        // for — or fed back into — a prediction.
        if (input.scenarioLabel) {
          await tx.transactionLabel.create({
            data: {
              transactionId: transaction.id,
              label: input.scenarioLabel,
              source: LABEL_SOURCE.SIMULATOR,
            },
          });
        }

        await recordAudit({
          actorId,
          action: AUDIT_ACTION.TRANSACTION_INGESTED,
          entityType: AUDIT_ENTITY_TYPE.TRANSACTION,
          entityId: transaction.id,
          metadata: {
            externalId: transaction.externalId,
            amount: toAmountNumber(transaction.amount),
            currency: transaction.currency,
            riskScore: assessment.riskScore,
            riskCategory: assessment.riskCategory,
            rulesetVersion: assessment.rulesetVersion,
            triggeredRuleIds: assessment.triggeredRuleIds,
            source,
          },
          requestId,
          ipAddress,
          tx,
        });

        if (alert) {
          await recordAudit({
            actorId,
            action: AUDIT_ACTION.ALERT_CREATED,
            entityType: AUDIT_ENTITY_TYPE.ALERT,
            entityId: alert.id,
            metadata: {
              transactionId: transaction.id,
              severity: alert.severity,
              riskScore: assessment.riskScore,
              source,
            },
            requestId,
            ipAddress,
            tx,
          });
        }

        return { transaction, riskAssessment, alert, assessment };
      },
      {
        // ReadCommitted is sufficient because the advisory lock, not the
        // isolation level, is what serialises same-sender ingestion.
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 20_000,
      },
    );
  } catch (error) {
    if (error instanceof DuplicateIngestionError) {
      const existing = await findExisting(input);
      if (existing) {
        return duplicateResult(existing, input, { actorId, requestId, ipAddress });
      }
      throw error;
    }
    // A unique violation on externalId or idempotencyKey means a concurrent
    // request won the race; treat it as the duplicate it is.
    if (isPrismaError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
      const existing = await findExisting(input);
      if (existing) {
        return duplicateResult(existing, input, { actorId, requestId, ipAddress });
      }
      throw new DuplicateIngestionError('This transaction has already been ingested', {
        externalId: input.externalId,
      });
    }
    throw error;
  }

  const { transaction, riskAssessment, alert, assessment } = committed;

  const enriched = {
    ...transaction,
    senderRef: sender.accountRef,
    receiverRef: receiver.accountRef,
    amount: toAmountNumber(transaction.amount),
  };

  // Only now that the transaction has committed are clients told about it.
  if (emitEvents) {
    emitTransactionCreated(enriched, assessment);
    emitTransactionAssessed(enriched, assessment);
    if (alert) {
      emitAlertCreated({
        ...alert,
        riskScore: assessment.riskScore,
        amount: enriched.amount,
        senderRef: sender.accountRef,
        receiverRef: receiver.accountRef,
      });
    }
  }

  log.debug(
    {
      transactionId: transaction.id,
      riskScore: assessment.riskScore,
      alertId: alert?.id ?? null,
      source,
    },
    'Transaction ingested',
  );

  return toIngestionResult({
    transaction: enriched,
    assessment: {
      ...assessment,
      id: riskAssessment.id,
      assessedAt: riskAssessment.assessedAt,
    },
    alert,
  });
}

/**
 * Builds the response for a duplicate submission and records it in the audit
 * log, so repeated ingestion attempts are visible to an operator.
 */
async function duplicateResult(existing, input, { actorId, requestId, ipAddress }) {
  await recordAudit({
    actorId,
    action: AUDIT_ACTION.TRANSACTION_INGEST_DUPLICATE,
    entityType: AUDIT_ENTITY_TYPE.TRANSACTION,
    entityId: existing.id,
    metadata: { externalId: input.externalId, duplicateOf: existing.id },
    requestId,
    ipAddress,
  });

  const latest = existing.riskAssessments?.[0];
  return toIngestionResult({
    duplicate: true,
    transaction: {
      ...existing,
      senderRef: existing.sender.accountRef,
      receiverRef: existing.receiver.accountRef,
    },
    assessment: {
      id: latest?.id ?? null,
      riskScore: latest?.riskScore ?? null,
      riskCategory: latest?.riskCategory ?? null,
      rulesetVersion: latest?.rulesetVersion ?? null,
      triggeredRuleIds: Array.isArray(latest?.triggeredRules)
        ? latest.triggeredRules.map((rule) => rule.ruleId)
        : [],
      explanations: latest?.explanations ?? [],
      assessedAt: latest?.assessedAt ?? null,
    },
    alert: existing.alerts?.[0] ?? null,
  });
}

export { resolveAccount, findExisting, toIngestionResult };
