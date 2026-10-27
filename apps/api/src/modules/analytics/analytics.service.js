import {
  DETECTION_METRIC_DEFINITIONS,
  FRAUDULENT_SCENARIO_LABELS,
  GROUND_TRUTH_SOURCE,
  METRIC_DEFINITIONS,
  MIN_LABELLED_SAMPLE_FOR_METRICS,
} from '@fraudlens/shared/constants';
import { Prisma } from '../../generated/prisma/index.js';
import { prisma } from '../../config/prisma.js';
import { toAmountNumber } from '../../utils/money.js';
import { resolveRange } from '../../utils/time.js';
import { getActiveRuleset } from '../fraud/ruleset.service.js';

/**
 * Analytics and model evaluation.
 *
 * This module keeps two very different kinds of number strictly apart:
 *
 *  - **Observed application statistics** — counts, sums and rates measured from
 *    the rows in this database. Always available, always factual about *this
 *    deployment*.
 *  - **Detection-performance metrics** — precision, recall, F1 and
 *    false-positive rate. These are *model evaluation* figures. They are only
 *    meaningful against reliable ground truth, so they are computed only where
 *    ground truth exists, reported with the size and source of the labelled
 *    sample, and withheld entirely when the sample is too small to support a
 *    conclusion.
 *
 * No performance number in this application is invented, assumed or carried
 * over from anywhere else.
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

/** Observed statistics across transactions, alerts and outcomes. */
export async function getAnalyticsOverview(input, client = prisma) {
  const { from, to } = resolveRange(input, { defaultDays: 30 });

  const [transactions, alerts, outcomes, channels, ruleset] = await Promise.all([
    client.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS "count",
             COALESCE(SUM(t."amount"), 0) AS "value",
             ROUND(AVG(t."amount")::numeric, 2)::float8 AS "average_amount",
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t."amount")::float8 AS "median_amount",
             COUNT(*) FILTER (WHERE t."is_new_device")::int AS "new_device_count",
             ROUND(AVG(a."risk_score")::numeric, 1)::float8 AS "average_risk_score"
      FROM "transactions" t
      ${LATEST_ASSESSMENT}
      WHERE t."occurred_at" >= ${from} AND t."occurred_at" <= ${to}
    `),
    client.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS "created",
             COUNT(*) FILTER (WHERE al."status" = 'OPEN')::int AS "open",
             COUNT(*) FILTER (WHERE al."status" = 'IN_REVIEW')::int AS "in_review",
             COUNT(*) FILTER (WHERE al."status" = 'RESOLVED')::int AS "resolved",
             COUNT(*) FILTER (WHERE al."reopen_count" > 0)::int AS "reopened",
             PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (al."resolved_at" - al."created_at")) / 3600
             ) FILTER (WHERE al."resolved_at" IS NOT NULL)::float8 AS "median_hours_to_resolve"
      FROM "alerts" al
      WHERE al."created_at" >= ${from} AND al."created_at" <= ${to}
    `),
    client.$queryRaw(Prisma.sql`
      SELECT al."outcome"::text AS "outcome", COUNT(*)::int AS "count",
             COALESCE(SUM(t."amount"), 0) AS "value"
      FROM "alerts" al
      JOIN "transactions" t ON t."id" = al."transaction_id"
      WHERE al."created_at" >= ${from} AND al."created_at" <= ${to}
      GROUP BY 1
    `),
    client.$queryRaw(Prisma.sql`
      SELECT t."channel"::text AS "channel", COUNT(*)::int AS "count",
             COALESCE(SUM(t."amount"), 0) AS "value",
             ROUND(AVG(a."risk_score")::numeric, 1)::float8 AS "average_risk_score"
      FROM "transactions" t
      ${LATEST_ASSESSMENT}
      WHERE t."occurred_at" >= ${from} AND t."occurred_at" <= ${to}
      GROUP BY 1 ORDER BY 2 DESC
    `),
    getActiveRuleset(),
  ]);

  const t = transactions[0] ?? {};
  const a = alerts[0] ?? {};

  return {
    range: { from, to },
    kind: 'OBSERVED_APPLICATION_STATISTICS',
    note: 'These are counts measured from this database. They describe observed activity, not model accuracy.',
    transactions: {
      count: t.count ?? 0,
      value: toAmountNumber(t.value ?? 0),
      averageAmount: t.average_amount ?? null,
      medianAmount:
        t.median_amount === null || t.median_amount === undefined
          ? null
          : Math.round(t.median_amount * 100) / 100,
      newDeviceCount: t.new_device_count ?? 0,
      averageRiskScore: t.average_risk_score ?? null,
    },
    alerts: {
      created: a.created ?? 0,
      open: a.open ?? 0,
      inReview: a.in_review ?? 0,
      resolved: a.resolved ?? 0,
      reopened: a.reopened ?? 0,
      medianHoursToResolve:
        a.median_hours_to_resolve === null || a.median_hours_to_resolve === undefined
          ? null
          : Math.round(a.median_hours_to_resolve * 10) / 10,
    },
    outcomes: outcomes.map((row) => ({
      outcome: row.outcome,
      count: row.count,
      value: toAmountNumber(row.value),
    })),
    channels: channels.map((row) => ({
      channel: row.channel,
      count: row.count,
      value: toAmountNumber(row.value),
      averageRiskScore: row.average_risk_score,
    })),
    definitions: METRIC_DEFINITIONS,
    thresholds: ruleset.riskSettings,
  };
}

/** Computes precision/recall/F1/FPR from a confusion matrix. */
export function deriveMetrics({ truePositives, falsePositives, trueNegatives, falseNegatives }) {
  const predictedPositive = truePositives + falsePositives;
  const actualPositive = truePositives + falseNegatives;
  const actualNegative = trueNegatives + falsePositives;

  // Each metric is null — not zero — when its denominator is zero. Reporting
  // zero precision for "nothing was flagged" would be a false statement about
  // the model rather than an honest "not defined on this sample".
  const precision = predictedPositive > 0 ? truePositives / predictedPositive : null;
  const recall = actualPositive > 0 ? truePositives / actualPositive : null;
  const falsePositiveRate = actualNegative > 0 ? falsePositives / actualNegative : null;
  const f1Score =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;

  const round = (value) => (value === null ? null : Math.round(value * 10000) / 10000);

  return {
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    precision: round(precision),
    recall: round(recall),
    f1Score: round(f1Score),
    falsePositiveRate: round(falsePositiveRate),
  };
}

/**
 * Detection performance against ground truth.
 *
 * Two independent sources of truth are supported, and they answer different
 * questions:
 *
 *  - `SIMULATOR` — the scenario label the generator recorded. Complete and
 *    unbiased over generated data, but it only describes synthetic behaviour.
 *  - `INVESTIGATION` — the outcome a human recorded on a resolved alert. Real
 *    judgement, but **systematically biased**: only alerted transactions are
 *    ever investigated, so this sample contains almost no true negatives and
 *    its recall is not interpretable. That caveat is returned with the data.
 *
 * A "positive prediction" means the engine scored the transaction at or above
 * the configured alert threshold.
 */
export async function getDetectionPerformance(input, client = prisma) {
  const { from, to } = resolveRange(input, { defaultDays: 30 });
  const source = input.source ?? GROUND_TRUTH_SOURCE.SIMULATOR;
  const ruleset = await getActiveRuleset();
  const threshold = ruleset.riskSettings.alertThreshold;

  let matrix;
  let caveats = [];

  if (source === GROUND_TRUTH_SOURCE.SIMULATOR) {
    const rows = await client.$queryRaw(Prisma.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE l."label"::text <> 'NORMAL' AND a."risk_score" >= ${threshold}
        )::int AS "true_positives",
        COUNT(*) FILTER (
          WHERE l."label"::text = 'NORMAL' AND a."risk_score" >= ${threshold}
        )::int AS "false_positives",
        COUNT(*) FILTER (
          WHERE l."label"::text = 'NORMAL' AND a."risk_score" < ${threshold}
        )::int AS "true_negatives",
        COUNT(*) FILTER (
          WHERE l."label"::text <> 'NORMAL' AND a."risk_score" < ${threshold}
        )::int AS "false_negatives",
        COUNT(*)::int AS "labelled_count"
      FROM "transactions" t
      JOIN "transaction_labels" l ON l."transaction_id" = t."id"
      ${LATEST_ASSESSMENT}
      WHERE t."occurred_at" >= ${from} AND t."occurred_at" <= ${to}
        AND l."source" = 'SIMULATOR'
        AND a."risk_score" IS NOT NULL
    `);
    const row = rows[0] ?? {};
    matrix = {
      truePositives: row.true_positives ?? 0,
      falsePositives: row.false_positives ?? 0,
      trueNegatives: row.true_negatives ?? 0,
      falseNegatives: row.false_negatives ?? 0,
      labelledCount: row.labelled_count ?? 0,
    };
    caveats = [
      'Ground truth is the scenario label recorded by the transaction simulator. It describes synthetic behaviour only.',
      'The simulated fraud rate is far higher than any real payment network, so precision here is not comparable to a production figure.',
    ];
  } else {
    const rows = await client.$queryRaw(Prisma.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE al."outcome" = 'CONFIRMED_FRAUD' AND ra."risk_score" >= ${threshold}
        )::int AS "true_positives",
        COUNT(*) FILTER (
          WHERE al."outcome" = 'LEGITIMATE' AND ra."risk_score" >= ${threshold}
        )::int AS "false_positives",
        COUNT(*) FILTER (
          WHERE al."outcome" = 'LEGITIMATE' AND ra."risk_score" < ${threshold}
        )::int AS "true_negatives",
        COUNT(*) FILTER (
          WHERE al."outcome" = 'CONFIRMED_FRAUD' AND ra."risk_score" < ${threshold}
        )::int AS "false_negatives",
        COUNT(*)::int AS "labelled_count",
        COUNT(*) FILTER (WHERE al."outcome" = 'INCONCLUSIVE')::int AS "inconclusive_count"
      FROM "alerts" al
      JOIN "risk_assessments" ra ON ra."id" = al."risk_assessment_id"
      WHERE al."created_at" >= ${from} AND al."created_at" <= ${to}
        AND al."outcome" IN ('CONFIRMED_FRAUD', 'LEGITIMATE')
    `);
    const row = rows[0] ?? {};
    matrix = {
      truePositives: row.true_positives ?? 0,
      falsePositives: row.false_positives ?? 0,
      trueNegatives: row.true_negatives ?? 0,
      falseNegatives: row.false_negatives ?? 0,
      labelledCount: row.labelled_count ?? 0,
      inconclusiveCount: row.inconclusive_count ?? 0,
    };
    caveats = [
      'Ground truth is the outcome a human investigator recorded on a resolved alert.',
      'This sample is biased by construction: only transactions that already generated an alert are ever investigated, so it contains almost no true negatives.',
      'Recall against this source is therefore not interpretable, and the false-positive rate reflects only the alerted population.',
      'Alerts resolved as INCONCLUSIVE are excluded entirely, because they are not evidence either way.',
    ];
  }

  const available = matrix.labelledCount >= MIN_LABELLED_SAMPLE_FOR_METRICS;

  return {
    range: { from, to },
    kind: 'MODEL_EVALUATION_METRICS',
    source,
    alertThreshold: threshold,
    rulesetVersion: ruleset.version,
    labelledSampleSize: matrix.labelledCount,
    minimumSampleSize: MIN_LABELLED_SAMPLE_FOR_METRICS,
    /**
     * False when the labelled sample is below the minimum. The confusion matrix
     * is still returned so an operator can see how much data exists, but the
     * derived metrics are withheld rather than published at a sample size that
     * would invite over-interpretation.
     */
    available,
    confusionMatrix: {
      truePositives: matrix.truePositives,
      falsePositives: matrix.falsePositives,
      trueNegatives: matrix.trueNegatives,
      falseNegatives: matrix.falseNegatives,
    },
    metrics: available ? deriveMetrics(matrix) : null,
    unavailableReason: available
      ? null
      : `Only ${matrix.labelledCount} labelled transactions in range; at least ${MIN_LABELLED_SAMPLE_FOR_METRICS} are required before these metrics are reported.`,
    caveats,
    definitions: DETECTION_METRIC_DEFINITIONS,
  };
}

/** Per-rule firing frequency and association with confirmed outcomes. */
export async function getRulePerformance(input, client = prisma) {
  const { from, to } = resolveRange(input, { defaultDays: 30 });

  const rows = await client.$queryRaw(Prisma.sql`
    SELECT rule->>'ruleId' AS "rule_id",
           MAX(rule->>'name') AS "name",
           COUNT(*)::int AS "trigger_count",
           ROUND(AVG((rule->>'contribution')::numeric), 2)::float8 AS "average_contribution",
           COUNT(DISTINCT al."id")::int AS "alert_count",
           COUNT(DISTINCT al."id") FILTER (WHERE al."outcome" = 'CONFIRMED_FRAUD')::int AS "confirmed_fraud_count",
           COUNT(DISTINCT al."id") FILTER (WHERE al."outcome" = 'LEGITIMATE')::int AS "legitimate_count"
    FROM "risk_assessments" ra
    CROSS JOIN LATERAL jsonb_array_elements(ra."triggered_rules") AS rule
    LEFT JOIN "alerts" al ON al."risk_assessment_id" = ra."id"
    WHERE ra."assessed_at" >= ${from} AND ra."assessed_at" <= ${to}
    GROUP BY 1
    ORDER BY "trigger_count" DESC
  `);

  const total = await client.riskAssessment.count({
    where: { assessedAt: { gte: from, lte: to } },
  });

  return {
    range: { from, to },
    assessmentCount: total,
    note:
      'Precision per rule is computed only over alerts a human resolved conclusively. ' +
      'A rule that rarely appears on resolved alerts has too small a sample to judge.',
    rules: rows.map((row) => {
      const judged = row.confirmed_fraud_count + row.legitimate_count;
      return {
        ruleId: row.rule_id,
        name: row.name,
        triggerCount: row.trigger_count,
        triggerRate: total > 0 ? Math.round((row.trigger_count / total) * 1000) / 10 : 0,
        averageContribution: row.average_contribution,
        alertCount: row.alert_count,
        confirmedFraudCount: row.confirmed_fraud_count,
        legitimateCount: row.legitimate_count,
        judgedCount: judged,
        // Null rather than a misleading 0% or 100% from a handful of cases.
        precisionOnJudgedAlerts:
          judged >= 10 ? Math.round((row.confirmed_fraud_count / judged) * 1000) / 10 : null,
      };
    }),
  };
}

/** Risk-score histogram in ten-point bands, for the distribution chart. */
export async function getScoreHistogram(input, client = prisma) {
  const { from, to } = resolveRange(input, { defaultDays: 30 });

  const rows = await client.$queryRaw(Prisma.sql`
    SELECT LEAST(FLOOR(a."risk_score" / 10)::int, 9) AS "band",
           COUNT(*)::int AS "count",
           COALESCE(SUM(t."amount"), 0) AS "value"
    FROM "transactions" t
    ${LATEST_ASSESSMENT}
    WHERE t."occurred_at" >= ${from} AND t."occurred_at" <= ${to}
      AND a."risk_score" IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `);

  const byBand = new Map(rows.map((row) => [row.band, row]));
  const ruleset = await getActiveRuleset();

  return {
    range: { from, to },
    thresholds: ruleset.riskSettings,
    bands: Array.from({ length: 10 }, (_, band) => {
      const row = byBand.get(band);
      return {
        band,
        label: `${band * 10}-${band * 10 + 9}`,
        min: band * 10,
        max: band * 10 + 9,
        count: row?.count ?? 0,
        value: toAmountNumber(row?.value ?? 0),
      };
    }),
  };
}

export { FRAUDULENT_SCENARIO_LABELS };
