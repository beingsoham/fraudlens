import { Prisma } from '../../generated/prisma/index.js';
import { prisma as defaultClient } from '../../config/prisma.js';
import { RULE_ID } from '@fraudlens/shared/constants';
import { daysBefore, hoursBefore, minutesBefore } from '../../utils/time.js';
import { median, medianAbsoluteDeviation } from '../../utils/stats.js';

/**
 * Historical feature computation.
 *
 * Every feature is derived from transactions already persisted in PostgreSQL.
 * Nothing here reads a statistic supplied by the caller: a client could
 * otherwise lower its own risk score simply by claiming a benign history.
 *
 * ## Window convention
 *
 * All rolling windows are half-open — `(start, end]` — where `end` is the
 * evaluated transaction's own `occurredAt`. The transaction under evaluation is
 * always excluded from its own features: at ingestion time it is not yet
 * persisted, and on re-assessment it is excluded explicitly by id. Applying one
 * convention across every rule is what makes two assessments of the same
 * transaction comparable.
 *
 * ## Cost
 *
 * Features are loaded in one parallel batch of indexed queries. Every predicate
 * below is backed by an index declared in `prisma/schema.prisma` or the
 * constraints migration.
 */

/** Hard cap on how many historical amounts are pulled into memory per sender. */
const MAX_AMOUNT_HISTORY = 500;

/** Reads a rule's config from the active ruleset, falling back to its default. */
function configFor(ruleset, ruleId) {
  return ruleset.rules[ruleId]?.config ?? {};
}

/**
 * Loads every historical feature the rule set needs for one transaction.
 *
 * @param {object} input
 * @param {string} input.senderId
 * @param {string} input.receiverId
 * @param {number} input.amount
 * @param {Date}   input.occurredAt
 * @param {string} input.deviceFingerprint
 * @param {string} [input.excludeTransactionId] Set when re-assessing a
 *   transaction that is already persisted.
 * @param {object} ruleset Active ruleset from `ruleset.service.js`.
 * @param {object} [client] Prisma client or an open transaction client.
 */
export async function loadTransactionFeatures(input, ruleset, client = defaultClient) {
  const { senderId, receiverId, occurredAt, deviceFingerprint, excludeTransactionId } = input;

  const amountConfig = configFor(ruleset, RULE_ID.HISTORICAL_AMOUNT_ANOMALY);
  const velocityConfig = configFor(ruleset, RULE_ID.HIGH_VELOCITY);
  const deviceConfig = configFor(ruleset, RULE_ID.NEW_DEVICE);
  const pairConfig = configFor(ruleset, RULE_ID.RAPID_REPEATED_TRANSFERS);
  const fanInConfig = configFor(ruleset, RULE_ID.SUSPICIOUS_RECEIVER_FANIN);
  const timeConfig = configFor(ruleset, RULE_ID.UNUSUAL_TRANSACTION_TIME);
  const surgeConfig = configFor(ruleset, RULE_ID.SUDDEN_ACTIVITY_INCREASE);

  const amountLookbackDays = amountConfig.lookbackDays ?? 30;
  const deviceLookbackDays = deviceConfig.lookbackDays ?? 90;
  const timeLookbackDays = timeConfig.lookbackDays ?? 30;
  const velocityWindowMinutes = velocityConfig.windowMinutes ?? 10;
  const pairWindowMinutes = pairConfig.windowMinutes ?? 30;
  const fanInWindowHours = fanInConfig.windowHours ?? 24;
  const surgeRecentHours = surgeConfig.recentWindowHours ?? 24;
  const surgeBaselineDays = surgeConfig.baselineWindowDays ?? 14;

  // The widest window any rule asks for; used for the "does this account have
  // any history at all?" count that the abstention checks rely on.
  const widestLookbackDays = Math.max(
    amountLookbackDays,
    deviceLookbackDays,
    timeLookbackDays,
    surgeBaselineDays + Math.ceil(surgeRecentHours / 24),
  );

  const excludeClause = excludeTransactionId ? { id: { not: excludeTransactionId } } : {};
  // Raw-SQL counterpart of `excludeClause`. Built as a parameterised fragment
  // so the id is never interpolated as text into the statement.
  const excludeSql = excludeTransactionId
    ? Prisma.sql`AND "id" <> CAST(${excludeTransactionId} AS uuid)`
    : Prisma.empty;

  /** `(start, end]` on `occurredAt`, excluding the transaction being assessed. */
  const senderWindow = (start) => ({
    senderId,
    occurredAt: { gt: start, lte: occurredAt },
    ...excludeClause,
  });

  const surgeRecentStart = hoursBefore(occurredAt, surgeRecentHours);
  const surgeBaselineStart = daysBefore(surgeRecentStart, surgeBaselineDays);

  const [
    senderHistoryCount,
    amountRows,
    deviceRows,
    velocityCount,
    pairAggregate,
    fanInRows,
    hourRows,
    surgeRecent,
    surgeBaseline,
    firstTransaction,
    receiverAccount,
  ] = await Promise.all([
    // 1. Total prior transactions for the sender inside the widest window.
    client.transaction.count({
      where: senderWindow(daysBefore(occurredAt, widestLookbackDays)),
    }),

    // 2. Prior amounts, for the robust amount-anomaly comparison.
    client.transaction.findMany({
      where: senderWindow(daysBefore(occurredAt, amountLookbackDays)),
      select: { amount: true },
      orderBy: { occurredAt: 'desc' },
      take: MAX_AMOUNT_HISTORY,
    }),

    // 3. Devices this sender has used before.
    client.transaction.findMany({
      where: senderWindow(daysBefore(occurredAt, deviceLookbackDays)),
      select: { deviceFingerprint: true },
      distinct: ['deviceFingerprint'],
      take: 200,
    }),

    // 4. Short-window velocity.
    client.transaction.count({
      where: senderWindow(minutesBefore(occurredAt, velocityWindowMinutes)),
    }),

    // 5. Repeated transfers on this exact sender -> receiver pair.
    client.transaction.aggregate({
      where: {
        ...senderWindow(minutesBefore(occurredAt, pairWindowMinutes)),
        receiverId,
      },
      _count: { _all: true },
      _sum: { amount: true },
    }),

    // 6. Distinct senders paying this receiver in the fan-in window. Needs a
    //    raw query because Prisma cannot express COUNT(DISTINCT ...).
    client.$queryRaw(Prisma.sql`
      SELECT COUNT(DISTINCT "sender_id")::int AS "distinct_senders",
             COUNT(*)::int AS "total_transactions"
      FROM "transactions"
      WHERE "receiver_id" = CAST(${receiverId} AS uuid)
        AND "occurred_at" > ${hoursBefore(occurredAt, fanInWindowHours)}
        AND "occurred_at" <= ${occurredAt}
        ${excludeSql}
    `),

    // 7. Hour-of-day histogram for the sender, in UTC.
    client.$queryRaw(Prisma.sql`
      SELECT EXTRACT(HOUR FROM "occurred_at" AT TIME ZONE 'UTC')::int AS "hour",
             COUNT(*)::int AS "count"
      FROM "transactions"
      WHERE "sender_id" = CAST(${senderId} AS uuid)
        AND "occurred_at" > ${daysBefore(occurredAt, timeLookbackDays)}
        AND "occurred_at" <= ${occurredAt}
        ${excludeSql}
      GROUP BY 1
    `),

    // 8a. Recent activity window for the surge comparison.
    client.transaction.aggregate({
      where: senderWindow(surgeRecentStart),
      _count: { _all: true },
      _sum: { amount: true },
    }),

    // 8b. Baseline window immediately preceding the recent window.
    client.transaction.aggregate({
      where: {
        senderId,
        occurredAt: { gt: surgeBaselineStart, lte: surgeRecentStart },
        ...excludeClause,
      },
      _count: { _all: true },
      _sum: { amount: true },
    }),

    // 9. When this account was first seen, to recognise genuinely new accounts.
    client.transaction.findFirst({
      where: { senderId, occurredAt: { lte: occurredAt }, ...excludeClause },
      select: { occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    }),

    // 10. Merchant flag: merchants legitimately collect from many senders.
    client.account.findUnique({
      where: { id: receiverId },
      select: { isMerchant: true, status: true, createdAt: true },
    }),
  ]);

  const amountHistory = amountRows.map((row) => Number(row.amount.toString()));
  const amountMedian = median(amountHistory);
  const amountMad = medianAbsoluteDeviation(amountHistory, amountMedian);

  const knownDevices = deviceRows.map((row) => row.deviceFingerprint);

  const hourHistogram = Array.from({ length: 24 }, () => 0);
  let hourHistoryCount = 0;
  for (const row of hourRows) {
    hourHistogram[row.hour] = row.count;
    hourHistoryCount += row.count;
  }

  const toNumber = (value) =>
    value === null || value === undefined ? 0 : Number(value.toString());

  return {
    /** Echoed back so an assessment records exactly which windows were used. */
    windows: {
      amountLookbackDays,
      deviceLookbackDays,
      timeLookbackDays,
      velocityWindowMinutes,
      pairWindowMinutes,
      fanInWindowHours,
      surgeRecentHours,
      surgeBaselineDays,
      convention: '(start, end] on occurredAt, excluding the assessed transaction',
    },
    sender: {
      historyCount: senderHistoryCount,
      amountHistory,
      amountHistoryCount: amountHistory.length,
      amountMedian,
      amountMad,
      knownDevices,
      knownDeviceCount: knownDevices.length,
      transactionsInVelocityWindow: velocityCount,
      hourHistogram,
      hourHistoryCount,
      firstSeenAt: firstTransaction?.occurredAt ?? null,
      recentCount: surgeRecent._count._all,
      recentValue: toNumber(surgeRecent._sum.amount),
      baselineCount: surgeBaseline._count._all,
      baselineValue: toNumber(surgeBaseline._sum.amount),
    },
    pair: {
      transfersInWindow: pairAggregate._count._all,
      totalAmountInWindow: toNumber(pairAggregate._sum.amount),
    },
    receiver: {
      distinctSendersInWindow: fanInRows[0]?.distinct_senders ?? 0,
      transactionsInWindow: fanInRows[0]?.total_transactions ?? 0,
      isMerchant: receiverAccount?.isMerchant ?? false,
      status: receiverAccount?.status ?? null,
    },
    device: {
      fingerprint: deviceFingerprint,
      isKnown: knownDevices.includes(deviceFingerprint),
    },
  };
}

/**
 * Feature set for an account with no history at all.
 *
 * Used by the unit tests and as the documented shape of the contract between
 * `loadTransactionFeatures` and the pure engine.
 */
export function emptyFeatures(overrides = {}) {
  return {
    windows: {
      amountLookbackDays: 30,
      deviceLookbackDays: 90,
      timeLookbackDays: 30,
      velocityWindowMinutes: 10,
      pairWindowMinutes: 30,
      fanInWindowHours: 24,
      surgeRecentHours: 24,
      surgeBaselineDays: 14,
      convention: '(start, end] on occurredAt, excluding the assessed transaction',
    },
    sender: {
      historyCount: 0,
      amountHistory: [],
      amountHistoryCount: 0,
      amountMedian: null,
      amountMad: null,
      knownDevices: [],
      knownDeviceCount: 0,
      transactionsInVelocityWindow: 0,
      hourHistogram: Array.from({ length: 24 }, () => 0),
      hourHistoryCount: 0,
      firstSeenAt: null,
      recentCount: 0,
      recentValue: 0,
      baselineCount: 0,
      baselineValue: 0,
      ...(overrides.sender ?? {}),
    },
    pair: { transfersInWindow: 0, totalAmountInWindow: 0, ...(overrides.pair ?? {}) },
    receiver: {
      distinctSendersInWindow: 0,
      transactionsInWindow: 0,
      isMerchant: false,
      status: 'ACTIVE',
      ...(overrides.receiver ?? {}),
    },
    device: { fingerprint: 'device-unknown', isKnown: false, ...(overrides.device ?? {}) },
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([key]) => !['sender', 'pair', 'receiver', 'device'].includes(key),
      ),
    ),
  };
}

export { Prisma, MAX_AMOUNT_HISTORY };
