import { METRIC_DEFINITIONS, RISK_CATEGORIES } from '@fraudlens/shared/constants';
import { Prisma } from '../../generated/prisma/index.js';
import { prisma } from '../../config/prisma.js';
import { toAmountNumber } from '../../utils/money.js';
import {
  SERIES_INTERVALS,
  enumerateBuckets,
  resolveRange,
  startOfNextUtcDay,
  startOfUtcDay,
} from '../../utils/time.js';
import { getActiveRuleset } from '../fraud/ruleset.service.js';

/**
 * Dashboard aggregation.
 *
 * Every figure here is computed from persisted rows at request time. Nothing is
 * cached, precomputed or hardcoded, and each one is returned alongside the
 * documented definition from `METRIC_DEFINITIONS` so the UI can show exactly
 * what it means.
 *
 * The distinction the whole dashboard rests on: *high-risk* and *flagged* count
 * transactions the engine scored as warranting review, while *confirmed fraud*
 * counts only alerts a human investigator resolved as CONFIRMED_FRAUD. A risk
 * score is never reported as fraud.
 */

/**
 * Subquery giving each transaction its latest risk assessment.
 *
 * Several metrics need it, and inlining it keeps them consistent — they all
 * agree on what "the" score of a transaction is.
 */
const LATEST_ASSESSMENT = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT ra."risk_score", ra."risk_category"
    FROM "risk_assessments" ra
    WHERE ra."transaction_id" = t."id"
    ORDER BY ra."assessed_at" DESC
    LIMIT 1
  ) a ON TRUE
`;

/** Headline figures for the overview dashboard. */
export async function getDashboardSummary(rangeInput, client = prisma) {
  const { from, to } = resolveRange(rangeInput, { defaultDays: 30 });
  const todayStart = startOfUtcDay();
  const tomorrowStart = startOfNextUtcDay();

  const [totals, rangeStats, alertStats, fraudStats, ruleset] = await Promise.all([
    // Lifetime totals, deliberately unaffected by the date filter.
    client.$queryRaw(Prisma.sql`
      SELECT
        (SELECT COUNT(*)::int FROM "transactions") AS "total_transactions",
        (SELECT COUNT(*)::int FROM "transactions"
          WHERE "occurred_at" >= ${todayStart} AND "occurred_at" < ${tomorrowStart}) AS "transactions_today",
        (SELECT COUNT(*)::int FROM "accounts") AS "total_accounts",
        (SELECT COUNT(*)::int FROM "alerts") AS "total_alerts"
    `),

    client.$queryRaw(Prisma.sql`
      SELECT
        COUNT(*)::int AS "transactions_in_range",
        COALESCE(SUM(t."amount"), 0) AS "value_in_range",
        COUNT(*) FILTER (WHERE a."risk_category" = 'HIGH')::int AS "high_risk_count",
        COALESCE(SUM(t."amount") FILTER (WHERE a."risk_category" = 'HIGH'), 0) AS "flagged_value",
        ROUND(AVG(a."risk_score")::numeric, 1)::float8 AS "average_risk_score"
      FROM "transactions" t
      ${LATEST_ASSESSMENT}
      WHERE t."occurred_at" >= ${from} AND t."occurred_at" <= ${to}
    `),

    client.$queryRaw(Prisma.sql`
      SELECT
        COUNT(*)::int AS "alerts_in_range",
        COUNT(*) FILTER (WHERE al."status" <> 'RESOLVED')::int AS "open_alerts",
        COUNT(*) FILTER (WHERE al."status" = 'IN_REVIEW')::int AS "in_review_alerts",
        COUNT(*) FILTER (WHERE al."status" = 'RESOLVED')::int AS "resolved_alerts",
        COUNT(*) FILTER (WHERE al."assigned_to_id" IS NULL AND al."status" = 'OPEN')::int AS "unassigned_alerts",
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (al."resolved_at" - al."created_at")) / 3600
        ) FILTER (WHERE al."resolved_at" IS NOT NULL)::float8 AS "median_hours_to_resolve"
      FROM "alerts" al
      WHERE al."created_at" >= ${from} AND al."created_at" <= ${to}
    `),

    // Confirmed fraud: human-recorded outcomes only.
    client.$queryRaw(Prisma.sql`
      SELECT
        COUNT(*)::int AS "confirmed_fraud_cases",
        COALESCE(SUM(t."amount"), 0) AS "confirmed_fraud_value",
        COUNT(*) FILTER (WHERE al."outcome" = 'LEGITIMATE')::int AS "legitimate_cases",
        COUNT(*) FILTER (WHERE al."outcome" = 'INCONCLUSIVE')::int AS "inconclusive_cases"
      FROM "alerts" al
      JOIN "transactions" t ON t."id" = al."transaction_id"
      WHERE al."created_at" >= ${from} AND al."created_at" <= ${to}
        AND al."outcome" <> 'PENDING'
    `),

    getActiveRuleset(),
  ]);

  const lifetime = totals[0] ?? {};
  const range = rangeStats[0] ?? {};
  const alerts = alertStats[0] ?? {};
  const fraud = fraudStats[0] ?? {};

  const confirmedFraudRow = await client.$queryRaw(Prisma.sql`
    SELECT COUNT(*)::int AS "cases", COALESCE(SUM(t."amount"), 0) AS "value"
    FROM "alerts" al
    JOIN "transactions" t ON t."id" = al."transaction_id"
    WHERE al."created_at" >= ${from} AND al."created_at" <= ${to}
      AND al."outcome" = 'CONFIRMED_FRAUD'
  `);
  const confirmed = confirmedFraudRow[0] ?? { cases: 0, value: 0 };

  const resolutionRate =
    (alerts.alerts_in_range ?? 0) > 0
      ? Math.round(((alerts.resolved_alerts ?? 0) / alerts.alerts_in_range) * 1000) / 10
      : null;

  return {
    range: { from, to },
    metrics: {
      totalTransactions: lifetime.total_transactions ?? 0,
      transactionsToday: lifetime.transactions_today ?? 0,
      transactionsInRange: range.transactions_in_range ?? 0,
      valueInRange: toAmountNumber(range.value_in_range ?? 0),
      highRiskTransactions: range.high_risk_count ?? 0,
      flaggedValue: toAmountNumber(range.flagged_value ?? 0),
      averageRiskScore: range.average_risk_score ?? null,
      openAlerts: alerts.open_alerts ?? 0,
      inReviewAlerts: alerts.in_review_alerts ?? 0,
      resolvedAlerts: alerts.resolved_alerts ?? 0,
      unassignedAlerts: alerts.unassigned_alerts ?? 0,
      alertsInRange: alerts.alerts_in_range ?? 0,
      alertResolutionRate: resolutionRate,
      medianTimeToResolve:
        alerts.median_hours_to_resolve === null || alerts.median_hours_to_resolve === undefined
          ? null
          : Math.round(alerts.median_hours_to_resolve * 10) / 10,
      confirmedFraudCases: confirmed.cases ?? 0,
      confirmedFraudValue: toAmountNumber(confirmed.value ?? 0),
      legitimateCases: fraud.legitimate_cases ?? 0,
      inconclusiveCases: fraud.inconclusive_cases ?? 0,
      totalAccounts: lifetime.total_accounts ?? 0,
      totalAlerts: lifetime.total_alerts ?? 0,
    },
    /** Shipped with the numbers so the UI never has to guess what a tile means. */
    definitions: METRIC_DEFINITIONS,
    thresholds: ruleset.riskSettings,
    rulesetVersion: ruleset.version,
  };
}

/**
 * Transaction volume and value over time, bucketed by hour, day or week.
 *
 * Empty buckets are emitted as zeros rather than omitted: a gap in a line chart
 * should mean "no activity", and leaving the bucket out instead makes the chart
 * silently compress time and misstate the trend.
 */
export async function getTransactionSeries(input, client = prisma) {
  const { from, to } = resolveRange(input, { defaultDays: 30 });
  const interval = input.interval ?? 'day';
  const spec = SERIES_INTERVALS[interval];

  const rows = await client.$queryRaw(Prisma.sql`
    SELECT DATE_TRUNC(${spec.sqlUnit}, t."occurred_at" AT TIME ZONE 'UTC') AS "bucket",
           COUNT(*)::int AS "count",
           COALESCE(SUM(t."amount"), 0) AS "value",
           COUNT(*) FILTER (WHERE a."risk_category" = 'HIGH')::int AS "high_risk",
           COUNT(*) FILTER (WHERE a."risk_category" = 'MEDIUM')::int AS "medium_risk",
           COUNT(*) FILTER (WHERE a."risk_category" = 'LOW')::int AS "low_risk",
           ROUND(AVG(a."risk_score")::numeric, 1)::float8 AS "average_risk_score"
    FROM "transactions" t
    ${LATEST_ASSESSMENT}
    WHERE t."occurred_at" >= ${from} AND t."occurred_at" <= ${to}
    GROUP BY 1
    ORDER BY 1
  `);

  const byBucket = new Map(rows.map((row) => [new Date(row.bucket).toISOString(), row]));

  return {
    range: { from, to },
    interval,
    points: enumerateBuckets(from, to, interval).map((bucket) => {
      const key = bucket.toISOString();
      const row = byBucket.get(key);
      return {
        bucket: key,
        count: row?.count ?? 0,
        value: toAmountNumber(row?.value ?? 0),
        highRisk: row?.high_risk ?? 0,
        mediumRisk: row?.medium_risk ?? 0,
        lowRisk: row?.low_risk ?? 0,
        averageRiskScore: row?.average_risk_score ?? null,
      };
    }),
  };
}

/** Count and value per risk category, for the distribution chart. */
export async function getRiskDistribution(input, client = prisma) {
  const { from, to } = resolveRange(input, { defaultDays: 30 });

  const rows = await client.$queryRaw(Prisma.sql`
    SELECT COALESCE(a."risk_category"::text, 'UNASSESSED') AS "category",
           COUNT(*)::int AS "count",
           COALESCE(SUM(t."amount"), 0) AS "value",
           ROUND(AVG(a."risk_score")::numeric, 1)::float8 AS "average_score"
    FROM "transactions" t
    ${LATEST_ASSESSMENT}
    WHERE t."occurred_at" >= ${from} AND t."occurred_at" <= ${to}
    GROUP BY 1
  `);

  const byCategory = new Map(rows.map((row) => [row.category, row]));
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  // Always return every category, including those with no transactions, so the
  // chart's legend and colours stay stable as the filter changes.
  const categories = [...RISK_CATEGORIES, 'UNASSESSED'].map((category) => {
    const row = byCategory.get(category);
    return {
      category,
      count: row?.count ?? 0,
      value: toAmountNumber(row?.value ?? 0),
      averageScore: row?.average_score ?? null,
      share: total > 0 ? Math.round(((row?.count ?? 0) / total) * 1000) / 10 : 0,
    };
  });

  const ruleset = await getActiveRuleset();
  return { range: { from, to }, total, categories, thresholds: ruleset.riskSettings };
}

/**
 * Most frequently triggered rules.
 *
 * Expands the JSONB `triggered_rules` array so each rule firing is one row,
 * then aggregates. This reports how often each rule fired and how much score it
 * contributed on average — which is what tells an operator whether a rule is
 * earning its weight or just adding noise.
 */
export async function getTopRules(input, client = prisma) {
  const { from, to } = resolveRange(input, { defaultDays: 30 });
  const limit = input.limit ?? 8;

  const rows = await client.$queryRaw(Prisma.sql`
    SELECT rule->>'ruleId' AS "rule_id",
           MAX(rule->>'name') AS "name",
           COUNT(*)::int AS "trigger_count",
           ROUND(AVG((rule->>'contribution')::numeric), 2)::float8 AS "average_contribution",
           ROUND(SUM((rule->>'contribution')::numeric), 2)::float8 AS "total_contribution",
           COUNT(*) FILTER (WHERE ra."risk_category" = 'HIGH')::int AS "high_risk_count",
           COUNT(DISTINCT al."id")::int AS "alert_count"
    FROM "risk_assessments" ra
    CROSS JOIN LATERAL jsonb_array_elements(ra."triggered_rules") AS rule
    LEFT JOIN "alerts" al ON al."risk_assessment_id" = ra."id"
    WHERE ra."assessed_at" >= ${from} AND ra."assessed_at" <= ${to}
    GROUP BY 1
    ORDER BY "trigger_count" DESC
    LIMIT ${limit}
  `);

  const assessmentCount = await client.riskAssessment.count({
    where: { assessedAt: { gte: from, lte: to } },
  });

  return {
    range: { from, to },
    assessmentCount,
    rules: rows.map((row) => ({
      ruleId: row.rule_id,
      name: row.name,
      triggerCount: row.trigger_count,
      triggerRate:
        assessmentCount > 0 ? Math.round((row.trigger_count / assessmentCount) * 1000) / 10 : 0,
      averageContribution: row.average_contribution,
      totalContribution: row.total_contribution,
      highRiskCount: row.high_risk_count,
      alertCount: row.alert_count,
    })),
  };
}

/** Most recent alerts, for the dashboard's alert panel. */
export async function getRecentAlerts(limit = 8, client = prisma) {
  const rows = await client.alert.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      transaction: {
        select: {
          id: true,
          externalId: true,
          amount: true,
          currency: true,
          occurredAt: true,
          sender: { select: { accountRef: true } },
          receiver: { select: { accountRef: true } },
        },
      },
      riskAssessment: { select: { riskScore: true, riskCategory: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  return rows.map((alert) => ({
    id: alert.id,
    severity: alert.severity,
    status: alert.status,
    outcome: alert.outcome,
    createdAt: alert.createdAt,
    riskScore: alert.riskAssessment.riskScore,
    riskCategory: alert.riskAssessment.riskCategory,
    assignedTo: alert.assignedTo,
    transaction: {
      id: alert.transaction.id,
      externalId: alert.transaction.externalId,
      amount: toAmountNumber(alert.transaction.amount),
      currency: alert.transaction.currency,
      occurredAt: alert.transaction.occurredAt,
      senderRef: alert.transaction.sender.accountRef,
      receiverRef: alert.transaction.receiver.accountRef,
    },
  }));
}

/** Most recent transactions with their latest score, for the activity panel. */
export async function getRecentTransactions(limit = 10, client = prisma) {
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT t."id", t."external_id", t."amount", t."currency", t."occurred_at",
           t."channel", t."status", t."is_new_device",
           s."account_ref" AS "sender_ref", r."account_ref" AS "receiver_ref",
           a."risk_score", a."risk_category"
    FROM "transactions" t
    JOIN "accounts" s ON s."id" = t."sender_id"
    JOIN "accounts" r ON r."id" = t."receiver_id"
    ${LATEST_ASSESSMENT}
    ORDER BY t."occurred_at" DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    id: row.id,
    externalId: row.external_id,
    senderRef: row.sender_ref,
    receiverRef: row.receiver_ref,
    amount: toAmountNumber(row.amount),
    currency: row.currency,
    occurredAt: row.occurred_at,
    channel: row.channel,
    status: row.status,
    isNewDevice: row.is_new_device,
    riskScore: row.risk_score,
    riskCategory: row.risk_category,
  }));
}

/**
 * Alert creation and resolution over time, which is the fraud-detection trend
 * panel. Resolution is counted in the bucket it was resolved in, not the one
 * the alert was created in, so the two lines answer different questions.
 */
export async function getAlertTrend(input, client = prisma) {
  const { from, to } = resolveRange(input, { defaultDays: 30 });
  const interval = input.interval ?? 'day';
  const spec = SERIES_INTERVALS[interval];

  const [created, resolved] = await Promise.all([
    client.$queryRaw(Prisma.sql`
      SELECT DATE_TRUNC(${spec.sqlUnit}, al."created_at" AT TIME ZONE 'UTC') AS "bucket",
             COUNT(*)::int AS "count",
             COUNT(*) FILTER (WHERE al."severity" IN ('HIGH', 'CRITICAL'))::int AS "severe_count"
      FROM "alerts" al
      WHERE al."created_at" >= ${from} AND al."created_at" <= ${to}
      GROUP BY 1 ORDER BY 1
    `),
    client.$queryRaw(Prisma.sql`
      SELECT DATE_TRUNC(${spec.sqlUnit}, al."resolved_at" AT TIME ZONE 'UTC') AS "bucket",
             COUNT(*)::int AS "count",
             COUNT(*) FILTER (WHERE al."outcome" = 'CONFIRMED_FRAUD')::int AS "confirmed_fraud",
             COUNT(*) FILTER (WHERE al."outcome" = 'LEGITIMATE')::int AS "legitimate"
      FROM "alerts" al
      WHERE al."resolved_at" IS NOT NULL
        AND al."resolved_at" >= ${from} AND al."resolved_at" <= ${to}
      GROUP BY 1 ORDER BY 1
    `),
  ]);

  const createdByBucket = new Map(created.map((r) => [new Date(r.bucket).toISOString(), r]));
  const resolvedByBucket = new Map(resolved.map((r) => [new Date(r.bucket).toISOString(), r]));

  return {
    range: { from, to },
    interval,
    points: enumerateBuckets(from, to, interval).map((bucket) => {
      const key = bucket.toISOString();
      const c = createdByBucket.get(key);
      const r = resolvedByBucket.get(key);
      return {
        bucket: key,
        created: c?.count ?? 0,
        severeCreated: c?.severe_count ?? 0,
        resolved: r?.count ?? 0,
        confirmedFraud: r?.confirmed_fraud ?? 0,
        legitimate: r?.legitimate ?? 0,
      };
    }),
  };
}
