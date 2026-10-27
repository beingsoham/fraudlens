import { Prisma } from '../../generated/prisma/index.js';
import { prisma } from '../../config/prisma.js';
import { toAmountNumber } from '../../utils/money.js';
import { NotFoundError } from '../../utils/errors.js';

/**
 * Account relationship analysis.
 *
 * Builds a directed graph in which nodes are synthetic accounts and edges are
 * aggregated transaction flows between them. Every node and edge is derived
 * from rows actually present in `transactions` — nothing is inferred, inverted
 * or synthesised for the sake of a prettier picture.
 *
 * Edges are aggregated per ordered pair rather than emitted per transaction:
 * a mule account receiving 300 payments would otherwise render as 300
 * overlapping lines, and the aggregate (count, total value, peak risk) is what
 * actually tells an investigator something.
 */

/** Builds the date / value filters shared by the node and edge queries. */
function graphFilters(params) {
  const clauses = [Prisma.sql`TRUE`];
  if (params.from) clauses.push(Prisma.sql`t."occurred_at" >= ${params.from}`);
  if (params.to) clauses.push(Prisma.sql`t."occurred_at" <= ${params.to}`);
  if (params.minAmount !== undefined) {
    clauses.push(Prisma.sql`t."amount" >= ${new Prisma.Decimal(params.minAmount)}`);
  }
  return Prisma.join(clauses, ' AND ');
}

/**
 * Builds the relationship graph.
 *
 * When `accountRef` is given the graph is the neighbourhood of that account,
 * expanded `depth` hops. Without it, the graph shows the most active accounts
 * in the window, which is the useful default view.
 */
export async function getAccountGraph(params, client = prisma) {
  const where = graphFilters(params);

  let focusAccount = null;
  let accountIds = null;

  if (params.accountRef) {
    focusAccount = await client.account.findUnique({
      where: { accountRef: params.accountRef.toLowerCase() },
      select: { id: true, accountRef: true, displayName: true, isMerchant: true, status: true },
    });
    if (!focusAccount) throw new NotFoundError('Account');

    // Expand the neighbourhood one hop at a time. `depth` is capped at 3 by the
    // request schema and the node count by `limit`, so this cannot run away.
    let frontier = [focusAccount.id];
    const seen = new Set(frontier);

    for (let hop = 0; hop < params.depth; hop += 1) {
      const neighbourRows = await client.$queryRaw(Prisma.sql`
        SELECT DISTINCT neighbour FROM (
          SELECT t."receiver_id" AS neighbour
          FROM "transactions" t
          WHERE t."sender_id" IN (${Prisma.join(frontier.map((id) => Prisma.sql`${id}::uuid`))})
            AND ${where}
          UNION
          SELECT t."sender_id" AS neighbour
          FROM "transactions" t
          WHERE t."receiver_id" IN (${Prisma.join(frontier.map((id) => Prisma.sql`${id}::uuid`))})
            AND ${where}
        ) neighbours
        LIMIT ${params.limit}
      `);

      const next = neighbourRows.map((row) => row.neighbour).filter((id) => !seen.has(id));
      if (next.length === 0) break;
      for (const id of next) {
        if (seen.size >= params.limit) break;
        seen.add(id);
      }
      frontier = next;
      if (seen.size >= params.limit) break;
    }

    accountIds = [...seen];
  }

  // Aggregate the edges. `HAVING` applies the minimum-transfer-count filter to
  // the aggregate, which is the only level at which it is meaningful.
  const scopeClause = accountIds
    ? Prisma.sql`AND t."sender_id" IN (${Prisma.join(accountIds.map((id) => Prisma.sql`${id}::uuid`))})
                 AND t."receiver_id" IN (${Prisma.join(accountIds.map((id) => Prisma.sql`${id}::uuid`))})`
    : Prisma.empty;

  const edgeRows = await client.$queryRaw(Prisma.sql`
    SELECT t."sender_id", t."receiver_id",
           COUNT(*)::int AS "transfer_count",
           SUM(t."amount") AS "total_amount",
           MAX(a."risk_score")::int AS "max_risk_score",
           MAX(t."occurred_at") AS "last_transfer_at",
           COUNT(al."id")::int AS "alert_count"
    FROM "transactions" t
    LEFT JOIN LATERAL (
      SELECT ra."risk_score"
      FROM "risk_assessments" ra
      WHERE ra."transaction_id" = t."id"
      ORDER BY ra."assessed_at" DESC
      LIMIT 1
    ) a ON TRUE
    LEFT JOIN "alerts" al ON al."transaction_id" = t."id"
    WHERE ${where} ${scopeClause}
    GROUP BY t."sender_id", t."receiver_id"
    HAVING COUNT(*) >= ${params.minTransferCount}
    ORDER BY SUM(t."amount") DESC
    LIMIT ${params.limit * 4}
  `);

  // Node set is exactly the endpoints of the edges that survived filtering, so
  // the graph never shows an isolated node with no visible relationship.
  const nodeIds = [...new Set(edgeRows.flatMap((row) => [row.sender_id, row.receiver_id]))];
  if (focusAccount && !nodeIds.includes(focusAccount.id)) {
    nodeIds.push(focusAccount.id);
  }

  if (nodeIds.length === 0) {
    return {
      focusAccountRef: focusAccount?.accountRef ?? null,
      nodes: [],
      edges: [],
      truncated: false,
    };
  }

  const nodeRows = await client.$queryRaw(Prisma.sql`
    SELECT acc."id", acc."account_ref", acc."display_name", acc."is_merchant", acc."status"::text,
           COALESCE(sent."count", 0)::int AS "sent_count",
           COALESCE(sent."total", 0) AS "sent_total",
           COALESCE(recv."count", 0)::int AS "received_count",
           COALESCE(recv."total", 0) AS "received_total",
           COALESCE(recv."distinct_senders", 0)::int AS "distinct_senders",
           COALESCE(alerts."alert_count", 0)::int AS "alert_count",
           COALESCE(alerts."open_alert_count", 0)::int AS "open_alert_count",
           COALESCE(alerts."max_risk_score", 0)::int AS "max_risk_score"
    FROM "accounts" acc
    LEFT JOIN (
      SELECT t."sender_id" AS id, COUNT(*)::int AS "count", SUM(t."amount") AS "total"
      FROM "transactions" t WHERE ${where} GROUP BY 1
    ) sent ON sent."id" = acc."id"
    LEFT JOIN (
      SELECT t."receiver_id" AS id, COUNT(*)::int AS "count", SUM(t."amount") AS "total",
             COUNT(DISTINCT t."sender_id")::int AS "distinct_senders"
      FROM "transactions" t WHERE ${where} GROUP BY 1
    ) recv ON recv."id" = acc."id"
    LEFT JOIN (
      -- An account is "associated with" an alert when it is either side of the
      -- alerted transaction, which is what an investigator means by the phrase.
      SELECT acct AS id, COUNT(*)::int AS "alert_count",
             COUNT(*) FILTER (WHERE al."status" <> 'RESOLVED')::int AS "open_alert_count",
             MAX(ra."risk_score")::int AS "max_risk_score"
      FROM "alerts" al
      JOIN "transactions" t ON t."id" = al."transaction_id"
      JOIN "risk_assessments" ra ON ra."id" = al."risk_assessment_id"
      CROSS JOIN LATERAL (VALUES (t."sender_id"), (t."receiver_id")) AS sides(acct)
      WHERE ${where}
      GROUP BY 1
    ) alerts ON alerts."id" = acc."id"
    WHERE acc."id" IN (${Prisma.join(nodeIds.map((id) => Prisma.sql`${id}::uuid`))})
  `);

  const refById = new Map(nodeRows.map((row) => [row.id, row.account_ref]));

  return {
    focusAccountRef: focusAccount?.accountRef ?? null,
    nodes: nodeRows.map((row) => ({
      id: row.id,
      accountRef: row.account_ref,
      displayName: row.display_name,
      isMerchant: row.is_merchant,
      status: row.status,
      isFocus: focusAccount?.id === row.id,
      sentCount: row.sent_count,
      sentTotal: toAmountNumber(row.sent_total),
      receivedCount: row.received_count,
      receivedTotal: toAmountNumber(row.received_total),
      distinctSenders: row.distinct_senders,
      alertCount: row.alert_count,
      openAlertCount: row.open_alert_count,
      maxRiskScore: row.max_risk_score,
    })),
    edges: edgeRows
      // Drop edges whose endpoints fell outside the node set.
      .filter((row) => refById.has(row.sender_id) && refById.has(row.receiver_id))
      .map((row) => ({
        id: `${row.sender_id}->${row.receiver_id}`,
        source: row.sender_id,
        target: row.receiver_id,
        sourceRef: refById.get(row.sender_id),
        targetRef: refById.get(row.receiver_id),
        transferCount: row.transfer_count,
        totalAmount: toAmountNumber(row.total_amount),
        maxRiskScore: row.max_risk_score ?? 0,
        alertCount: row.alert_count,
        lastTransferAt: row.last_transfer_at,
      })),
    truncated: edgeRows.length >= params.limit * 4,
  };
}

/**
 * Per-account summary: totals, frequent counterparties and alert association.
 * Shown in the side panel when an account is selected in the graph.
 */
export async function getAccountSummary(accountRef, params, client = prisma) {
  const account = await client.account.findUnique({
    where: { accountRef: accountRef.toLowerCase() },
  });
  if (!account) throw new NotFoundError('Account');

  const where = graphFilters(params);

  const [totals, topCounterparties, recent, alertStats] = await Promise.all([
    client.$queryRaw(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE t."sender_id" = ${account.id}::uuid)::int AS "sent_count",
        COALESCE(SUM(t."amount") FILTER (WHERE t."sender_id" = ${account.id}::uuid), 0) AS "sent_total",
        COUNT(*) FILTER (WHERE t."receiver_id" = ${account.id}::uuid)::int AS "received_count",
        COALESCE(SUM(t."amount") FILTER (WHERE t."receiver_id" = ${account.id}::uuid), 0) AS "received_total",
        COUNT(DISTINCT t."sender_id") FILTER (WHERE t."receiver_id" = ${account.id}::uuid)::int AS "distinct_senders",
        COUNT(DISTINCT t."receiver_id") FILTER (WHERE t."sender_id" = ${account.id}::uuid)::int AS "distinct_receivers"
      FROM "transactions" t
      WHERE (t."sender_id" = ${account.id}::uuid OR t."receiver_id" = ${account.id}::uuid)
        AND ${where}
    `),
    client.$queryRaw(Prisma.sql`
      SELECT other."account_ref", other."display_name", other."is_merchant",
             SUM(flows."count")::int AS "transfer_count",
             SUM(flows."total") AS "total_amount",
             MAX(flows."direction") AS "direction"
      FROM (
        SELECT t."receiver_id" AS other_id, COUNT(*) AS "count", SUM(t."amount") AS "total",
               'OUTGOING' AS "direction"
        FROM "transactions" t
        WHERE t."sender_id" = ${account.id}::uuid AND ${where}
        GROUP BY 1
        UNION ALL
        SELECT t."sender_id" AS other_id, COUNT(*) AS "count", SUM(t."amount") AS "total",
               'INCOMING' AS "direction"
        FROM "transactions" t
        WHERE t."receiver_id" = ${account.id}::uuid AND ${where}
        GROUP BY 1
      ) flows
      JOIN "accounts" other ON other."id" = flows."other_id"
      GROUP BY other."account_ref", other."display_name", other."is_merchant"
      ORDER BY SUM(flows."total") DESC
      LIMIT 10
    `),
    client.$queryRaw(Prisma.sql`
      SELECT t."id", t."external_id", t."amount", t."occurred_at", t."status",
             s."account_ref" AS "sender_ref", r."account_ref" AS "receiver_ref",
             a."risk_score", a."risk_category",
             CASE WHEN t."sender_id" = ${account.id}::uuid THEN 'OUTGOING' ELSE 'INCOMING' END AS "direction"
      FROM "transactions" t
      JOIN "accounts" s ON s."id" = t."sender_id"
      JOIN "accounts" r ON r."id" = t."receiver_id"
      LEFT JOIN LATERAL (
        SELECT ra."risk_score", ra."risk_category" FROM "risk_assessments" ra
        WHERE ra."transaction_id" = t."id" ORDER BY ra."assessed_at" DESC LIMIT 1
      ) a ON TRUE
      WHERE (t."sender_id" = ${account.id}::uuid OR t."receiver_id" = ${account.id}::uuid)
        AND ${where}
      ORDER BY t."occurred_at" DESC
      LIMIT 20
    `),
    client.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS "alert_count",
             COUNT(*) FILTER (WHERE al."status" <> 'RESOLVED')::int AS "open_alert_count",
             COUNT(*) FILTER (WHERE al."outcome" = 'CONFIRMED_FRAUD')::int AS "confirmed_fraud_count"
      FROM "alerts" al
      JOIN "transactions" t ON t."id" = al."transaction_id"
      WHERE (t."sender_id" = ${account.id}::uuid OR t."receiver_id" = ${account.id}::uuid)
        AND ${where}
    `),
  ]);

  const t = totals[0] ?? {};
  return {
    account: {
      id: account.id,
      accountRef: account.accountRef,
      displayName: account.displayName,
      status: account.status,
      isMerchant: account.isMerchant,
      createdAt: account.createdAt,
    },
    totals: {
      sentCount: t.sent_count ?? 0,
      sentTotal: toAmountNumber(t.sent_total ?? 0),
      receivedCount: t.received_count ?? 0,
      receivedTotal: toAmountNumber(t.received_total ?? 0),
      distinctSenders: t.distinct_senders ?? 0,
      distinctReceivers: t.distinct_receivers ?? 0,
    },
    alerts: alertStats[0] ?? { alert_count: 0, open_alert_count: 0, confirmed_fraud_count: 0 },
    topCounterparties: topCounterparties.map((row) => ({
      accountRef: row.account_ref,
      displayName: row.display_name,
      isMerchant: row.is_merchant,
      transferCount: row.transfer_count,
      totalAmount: toAmountNumber(row.total_amount),
      direction: row.direction,
    })),
    recentTransactions: recent.map((row) => ({
      id: row.id,
      externalId: row.external_id,
      amount: toAmountNumber(row.amount),
      occurredAt: row.occurred_at,
      status: row.status,
      senderRef: row.sender_ref,
      receiverRef: row.receiver_ref,
      riskScore: row.risk_score,
      riskCategory: row.risk_category,
      direction: row.direction,
    })),
  };
}

/** Account reference lookup for the graph's search box. */
export async function searchAccounts(term, limit = 20, client = prisma) {
  const needle = `%${term.toLowerCase()}%`;
  const rows = await client.account.findMany({
    where: {
      OR: [
        { accountRef: { contains: needle.replaceAll('%', ''), mode: 'insensitive' } },
        { displayName: { contains: needle.replaceAll('%', ''), mode: 'insensitive' } },
      ],
    },
    select: { id: true, accountRef: true, displayName: true, isMerchant: true, status: true },
    orderBy: { accountRef: 'asc' },
    take: limit,
  });
  return rows;
}
