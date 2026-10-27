import { Prisma } from '../../generated/prisma/index.js';
import { prisma } from '../../config/prisma.js';
import { toAmountNumber } from '../../utils/money.js';
import { NotFoundError } from '../../utils/errors.js';

/**
 * Transaction read model.
 *
 * Listing transactions means filtering and sorting on each transaction's
 * *latest* risk assessment. Assessments are immutable and a transaction may
 * have several, so "latest" is a per-row lookup that the ORM cannot express
 * while also supporting `ORDER BY risk_score` and server-side pagination.
 *
 * The list query below therefore uses a `LEFT JOIN LATERAL ... LIMIT 1`, which
 * PostgreSQL resolves with the `risk_assessments (transaction_id, assessed_at
 * DESC, risk_score)` index. Every value the client supplies is passed as a bind
 * parameter through `Prisma.sql`, and the sort column and direction are mapped
 * through an allow-list, so no caller input is ever concatenated into SQL.
 */

/** Allow-listed sort columns. Keys come from `TRANSACTION_SORT_FIELDS`. */
const SORT_COLUMNS = {
  occurredAt: Prisma.sql`t."occurred_at"`,
  amount: Prisma.sql`t."amount"`,
  riskScore: Prisma.sql`a."risk_score"`,
  createdAt: Prisma.sql`t."created_at"`,
  status: Prisma.sql`t."status"`,
};

/** Builds the shared WHERE fragment for the list and count queries. */
function buildFilters(params) {
  const clauses = [Prisma.sql`TRUE`];

  if (params.from) clauses.push(Prisma.sql`t."occurred_at" >= ${params.from}`);
  if (params.to) clauses.push(Prisma.sql`t."occurred_at" <= ${params.to}`);
  if (params.minAmount !== undefined) {
    clauses.push(Prisma.sql`t."amount" >= ${new Prisma.Decimal(params.minAmount)}`);
  }
  if (params.maxAmount !== undefined) {
    clauses.push(Prisma.sql`t."amount" <= ${new Prisma.Decimal(params.maxAmount)}`);
  }
  if (params.status?.length) {
    clauses.push(
      Prisma.sql`t."status"::text IN (${Prisma.join(params.status.map((value) => Prisma.sql`${value}`))})`,
    );
  }
  if (params.channel?.length) {
    clauses.push(
      Prisma.sql`t."channel"::text IN (${Prisma.join(params.channel.map((value) => Prisma.sql`${value}`))})`,
    );
  }
  if (params.riskCategory?.length) {
    clauses.push(
      Prisma.sql`a."risk_category"::text IN (${Prisma.join(params.riskCategory.map((value) => Prisma.sql`${value}`))})`,
    );
  }
  if (params.minRiskScore !== undefined) {
    clauses.push(Prisma.sql`a."risk_score" >= ${params.minRiskScore}`);
  }
  if (params.maxRiskScore !== undefined) {
    clauses.push(Prisma.sql`a."risk_score" <= ${params.maxRiskScore}`);
  }
  if (params.accountRef) {
    const ref = params.accountRef.toLowerCase();
    clauses.push(Prisma.sql`(s."account_ref" = ${ref} OR r."account_ref" = ${ref})`);
  }
  if (params.search) {
    // Matches the external id or either account reference. `ILIKE` with a
    // trailing wildcard keeps the account_ref index usable for prefix searches.
    const term = `%${params.search.toLowerCase()}%`;
    clauses.push(
      Prisma.sql`(
        LOWER(t."external_id") LIKE ${term}
        OR s."account_ref" LIKE ${term}
        OR r."account_ref" LIKE ${term}
        OR LOWER(s."display_name") LIKE ${term}
        OR LOWER(r."display_name") LIKE ${term}
      )`,
    );
  }

  return Prisma.join(clauses, ' AND ');
}

/** The FROM/JOIN block shared by the list and count queries. */
const FROM_BLOCK = Prisma.sql`
  FROM "transactions" t
  JOIN "accounts" s ON s."id" = t."sender_id"
  JOIN "accounts" r ON r."id" = t."receiver_id"
  LEFT JOIN LATERAL (
    SELECT ra."id", ra."risk_score", ra."risk_category", ra."ruleset_version",
           ra."assessed_at", ra."triggered_rules"
    FROM "risk_assessments" ra
    WHERE ra."transaction_id" = t."id"
    ORDER BY ra."assessed_at" DESC
    LIMIT 1
  ) a ON TRUE
`;

/** Shapes one list row for the API response. */
function toListItem(row) {
  return {
    id: row.id,
    externalId: row.external_id,
    senderRef: row.sender_ref,
    senderName: row.sender_name,
    receiverRef: row.receiver_ref,
    receiverName: row.receiver_name,
    amount: toAmountNumber(row.amount),
    currency: row.currency,
    occurredAt: row.occurred_at,
    channel: row.channel,
    status: row.status,
    isNewDevice: row.is_new_device,
    createdAt: row.created_at,
    riskScore: row.risk_score,
    riskCategory: row.risk_category,
    rulesetVersion: row.ruleset_version,
    assessmentId: row.assessment_id,
    triggeredRuleIds: Array.isArray(row.triggered_rules)
      ? row.triggered_rules.map((rule) => rule.ruleId)
      : [],
    alertId: row.alert_id,
    alertStatus: row.alert_status,
    alertSeverity: row.alert_severity,
  };
}

/** Paginated, filtered, sorted transaction list. */
export async function listTransactions(params, client = prisma) {
  const where = buildFilters(params);
  const sortColumn = SORT_COLUMNS[params.sortBy] ?? SORT_COLUMNS.occurredAt;
  const direction = params.sortDir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const offset = (params.page - 1) * params.pageSize;

  const [rows, countRows] = await Promise.all([
    client.$queryRaw(Prisma.sql`
      SELECT t."id", t."external_id", t."amount", t."currency", t."occurred_at",
             t."channel", t."status", t."is_new_device", t."created_at",
             s."account_ref" AS "sender_ref", s."display_name" AS "sender_name",
             r."account_ref" AS "receiver_ref", r."display_name" AS "receiver_name",
             a."id" AS "assessment_id", a."risk_score", a."risk_category",
             a."ruleset_version", a."triggered_rules",
             al."id" AS "alert_id", al."status"::text AS "alert_status",
             al."severity"::text AS "alert_severity"
      ${FROM_BLOCK}
      LEFT JOIN LATERAL (
        SELECT inner_al."id", inner_al."status", inner_al."severity"
        FROM "alerts" inner_al
        WHERE inner_al."transaction_id" = t."id"
        ORDER BY inner_al."created_at" DESC
        LIMIT 1
      ) al ON TRUE
      WHERE ${where}
      -- The id is the tiebreaker, so pagination stays stable when the sort column ties.
      ORDER BY ${sortColumn} ${direction} NULLS LAST, t."id" DESC
      LIMIT ${params.pageSize} OFFSET ${offset}
    `),
    client.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS "total"
      ${FROM_BLOCK}
      WHERE ${where}
    `),
  ]);

  return { items: rows.map(toListItem), total: countRows[0]?.total ?? 0 };
}

/**
 * Full transaction detail: participants, device metadata, the latest
 * assessment with its per-rule evidence, every historical assessment, and any
 * linked alerts with their investigation history.
 */
export async function getTransactionDetail(id, client = prisma) {
  const transaction = await client.transaction.findUnique({
    where: { id },
    include: {
      sender: {
        select: { id: true, accountRef: true, displayName: true, isMerchant: true, status: true },
      },
      receiver: {
        select: { id: true, accountRef: true, displayName: true, isMerchant: true, status: true },
      },
      label: { select: { label: true, source: true, createdAt: true } },
      riskAssessments: { orderBy: { assessedAt: 'desc' } },
      alerts: {
        orderBy: { createdAt: 'desc' },
        include: {
          assignedTo: { select: { id: true, name: true, email: true, role: true } },
          resolvedBy: { select: { id: true, name: true, email: true, role: true } },
          notes: {
            orderBy: { createdAt: 'desc' },
            include: { author: { select: { id: true, name: true, role: true } } },
          },
        },
      },
    },
  });

  if (!transaction) throw new NotFoundError('Transaction');

  const latest = transaction.riskAssessments[0] ?? null;

  return {
    id: transaction.id,
    externalId: transaction.externalId,
    amount: toAmountNumber(transaction.amount),
    currency: transaction.currency,
    occurredAt: transaction.occurredAt,
    createdAt: transaction.createdAt,
    channel: transaction.channel,
    status: transaction.status,
    device: {
      // The synthetic fingerprint is shown in full here: this is the
      // investigation surface, and the whole value is what an investigator
      // compares against other transactions.
      fingerprint: transaction.deviceFingerprint,
      isNewDevice: transaction.isNewDevice,
    },
    sender: transaction.sender,
    receiver: transaction.receiver,
    /**
     * Ground-truth scenario label, where one exists. Exposed separately from
     * the assessment and clearly named, so it is never mistaken for a
     * prediction.
     */
    groundTruthLabel: transaction.label,
    latestAssessment: latest
      ? {
          id: latest.id,
          riskScore: latest.riskScore,
          riskCategory: latest.riskCategory,
          rulesetVersion: latest.rulesetVersion,
          triggeredRules: latest.triggeredRules,
          explanations: latest.explanations,
          features: latest.features,
          assessedAt: latest.assessedAt,
        }
      : null,
    assessmentHistory: transaction.riskAssessments.map((assessment) => ({
      id: assessment.id,
      riskScore: assessment.riskScore,
      riskCategory: assessment.riskCategory,
      rulesetVersion: assessment.rulesetVersion,
      assessedAt: assessment.assessedAt,
      triggeredRuleIds: Array.isArray(assessment.triggeredRules)
        ? assessment.triggeredRules.map((rule) => rule.ruleId)
        : [],
    })),
    alerts: transaction.alerts.map((alert) => ({
      id: alert.id,
      severity: alert.severity,
      status: alert.status,
      outcome: alert.outcome,
      assignedTo: alert.assignedTo,
      resolvedBy: alert.resolvedBy,
      resolutionSummary: alert.resolutionSummary,
      reopenCount: alert.reopenCount,
      createdAt: alert.createdAt,
      updatedAt: alert.updatedAt,
      resolvedAt: alert.resolvedAt,
      notes: alert.notes.map((note) => ({
        id: note.id,
        body: note.body,
        author: note.author,
        createdAt: note.createdAt,
      })),
    })),
  };
}

/**
 * Transactions related to a given one.
 *
 * "Related" means sharing a participant, the device fingerprint, or the exact
 * sender -> receiver pair, ranked so the most directly connected appear first.
 * This is what an investigator reaches for: the other transactions that the
 * same actor, device or channel produced around the same time.
 */
export async function getRelatedTransactions(id, limit = 10, client = prisma) {
  const base = await client.transaction.findUnique({
    where: { id },
    select: {
      id: true,
      senderId: true,
      receiverId: true,
      deviceFingerprint: true,
      occurredAt: true,
    },
  });
  if (!base) throw new NotFoundError('Transaction');

  const rows = await client.$queryRaw(Prisma.sql`
    SELECT t."id", t."external_id", t."amount", t."currency", t."occurred_at",
           t."channel", t."status", t."device_fingerprint",
           s."account_ref" AS "sender_ref", r."account_ref" AS "receiver_ref",
           a."risk_score", a."risk_category",
           CASE
             WHEN t."sender_id" = ${base.senderId}::uuid
              AND t."receiver_id" = ${base.receiverId}::uuid THEN 'SAME_PAIR'
             WHEN t."device_fingerprint" = ${base.deviceFingerprint} THEN 'SAME_DEVICE'
             WHEN t."sender_id" = ${base.senderId}::uuid THEN 'SAME_SENDER'
             WHEN t."receiver_id" = ${base.receiverId}::uuid THEN 'SAME_RECEIVER'
             ELSE 'OTHER'
           END AS "relation"
    FROM "transactions" t
    JOIN "accounts" s ON s."id" = t."sender_id"
    JOIN "accounts" r ON r."id" = t."receiver_id"
    LEFT JOIN LATERAL (
      SELECT ra."risk_score", ra."risk_category"
      FROM "risk_assessments" ra
      WHERE ra."transaction_id" = t."id"
      ORDER BY ra."assessed_at" DESC
      LIMIT 1
    ) a ON TRUE
    WHERE t."id" <> ${base.id}::uuid
      AND (
        t."sender_id" = ${base.senderId}::uuid
        OR t."receiver_id" = ${base.receiverId}::uuid
        OR t."receiver_id" = ${base.senderId}::uuid
        OR t."sender_id" = ${base.receiverId}::uuid
        OR t."device_fingerprint" = ${base.deviceFingerprint}
      )
    ORDER BY
      CASE
        WHEN t."sender_id" = ${base.senderId}::uuid
         AND t."receiver_id" = ${base.receiverId}::uuid THEN 0
        WHEN t."device_fingerprint" = ${base.deviceFingerprint} THEN 1
        ELSE 2
      END,
      -- Then by closeness in time to the transaction under investigation.
      ABS(EXTRACT(EPOCH FROM (t."occurred_at" - ${base.occurredAt}::timestamptz))) ASC
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
    riskScore: row.risk_score,
    riskCategory: row.risk_category,
    relation: row.relation,
    sharesDevice: row.device_fingerprint === base.deviceFingerprint,
  }));
}

export { buildFilters, SORT_COLUMNS, toListItem };
