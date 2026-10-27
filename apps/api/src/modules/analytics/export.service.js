import { AUDIT_ACTION, AUDIT_ENTITY_TYPE } from '@fraudlens/shared/schemas';
import { Prisma } from '../../generated/prisma/index.js';
import { prisma } from '../../config/prisma.js';
import { buildCsv, exportFilename } from '../../utils/csv.js';
import { toAmountNumber } from '../../utils/money.js';
import { resolveRange } from '../../utils/time.js';
import { recordAudit } from '../audit/audit.service.js';
import { getRulePerformance } from './analytics.service.js';

/**
 * CSV report generation.
 *
 * Every cell is written through `escapeCsvCell`, which neutralises values a
 * spreadsheet would interpret as a formula. That matters here specifically
 * because exports carry text an attacker can influence — account references,
 * resolution summaries, audit metadata — and a `=HYPERLINK(...)` in a cell that
 * someone opens in Excel is a real exfiltration path.
 *
 * Each export is recorded in the audit log with the dataset, range and row
 * count, so there is a trail of who extracted what.
 */

const DATASETS = {
  transactions: {
    columns: [
      { key: 'externalId', header: 'external_id' },
      { key: 'occurredAt', header: 'occurred_at_utc' },
      { key: 'senderRef', header: 'sender_ref' },
      { key: 'receiverRef', header: 'receiver_ref' },
      { key: 'amount', header: 'amount' },
      { key: 'currency', header: 'currency' },
      { key: 'channel', header: 'channel' },
      { key: 'status', header: 'status' },
      { key: 'isNewDevice', header: 'is_new_device' },
      { key: 'riskScore', header: 'risk_score' },
      { key: 'riskCategory', header: 'risk_category' },
      { key: 'rulesetVersion', header: 'ruleset_version' },
      { key: 'triggeredRules', header: 'triggered_rules' },
      { key: 'alertStatus', header: 'alert_status' },
      { key: 'investigationOutcome', header: 'investigation_outcome' },
    ],
    async load({ from, to, limit }, client) {
      const rows = await client.$queryRaw(Prisma.sql`
        SELECT t."external_id", t."occurred_at", t."amount", t."currency", t."channel",
               t."status"::text, t."is_new_device",
               s."account_ref" AS "sender_ref", r."account_ref" AS "receiver_ref",
               a."risk_score", a."risk_category"::text, a."ruleset_version", a."triggered_rules",
               al."status"::text AS "alert_status", al."outcome"::text AS "investigation_outcome"
        FROM "transactions" t
        JOIN "accounts" s ON s."id" = t."sender_id"
        JOIN "accounts" r ON r."id" = t."receiver_id"
        LEFT JOIN LATERAL (
          SELECT ra."risk_score", ra."risk_category", ra."ruleset_version", ra."triggered_rules"
          FROM "risk_assessments" ra WHERE ra."transaction_id" = t."id"
          ORDER BY ra."assessed_at" DESC LIMIT 1
        ) a ON TRUE
        LEFT JOIN LATERAL (
          SELECT inner_al."status", inner_al."outcome" FROM "alerts" inner_al
          WHERE inner_al."transaction_id" = t."id"
          ORDER BY inner_al."created_at" DESC LIMIT 1
        ) al ON TRUE
        WHERE t."occurred_at" >= ${from} AND t."occurred_at" <= ${to}
        ORDER BY t."occurred_at" DESC
        LIMIT ${limit}
      `);

      return rows.map((row) => ({
        externalId: row.external_id,
        occurredAt: row.occurred_at,
        senderRef: row.sender_ref,
        receiverRef: row.receiver_ref,
        amount: toAmountNumber(row.amount),
        currency: row.currency,
        channel: row.channel,
        status: row.status,
        isNewDevice: row.is_new_device,
        riskScore: row.risk_score,
        riskCategory: row.risk_category,
        rulesetVersion: row.ruleset_version,
        triggeredRules: Array.isArray(row.triggered_rules)
          ? row.triggered_rules.map((rule) => rule.ruleId).join(' ')
          : '',
        alertStatus: row.alert_status ?? '',
        investigationOutcome: row.investigation_outcome ?? '',
      }));
    },
  },

  alerts: {
    columns: [
      { key: 'alertId', header: 'alert_id' },
      { key: 'createdAt', header: 'created_at_utc' },
      { key: 'severity', header: 'severity' },
      { key: 'status', header: 'workflow_status' },
      { key: 'outcome', header: 'investigation_outcome' },
      { key: 'riskScore', header: 'risk_score' },
      { key: 'externalId', header: 'transaction_external_id' },
      { key: 'amount', header: 'amount' },
      { key: 'senderRef', header: 'sender_ref' },
      { key: 'receiverRef', header: 'receiver_ref' },
      { key: 'assignedTo', header: 'assigned_to' },
      { key: 'resolvedBy', header: 'resolved_by' },
      { key: 'resolvedAt', header: 'resolved_at_utc' },
      { key: 'hoursToResolve', header: 'hours_to_resolve' },
      { key: 'reopenCount', header: 'reopen_count' },
      { key: 'noteCount', header: 'note_count' },
      { key: 'resolutionSummary', header: 'resolution_summary' },
    ],
    async load({ from, to, limit }, client) {
      const rows = await client.$queryRaw(Prisma.sql`
        SELECT al."id", al."created_at", al."severity"::text, al."status"::text,
               al."outcome"::text, al."resolved_at", al."reopen_count", al."resolution_summary",
               ra."risk_score",
               t."external_id", t."amount",
               s."account_ref" AS "sender_ref", r."account_ref" AS "receiver_ref",
               assignee."name" AS "assigned_to", resolver."name" AS "resolved_by",
               ROUND(EXTRACT(EPOCH FROM (al."resolved_at" - al."created_at")) / 3600, 2)::float8 AS "hours_to_resolve",
               (SELECT COUNT(*)::int FROM "investigation_notes" n WHERE n."alert_id" = al."id") AS "note_count"
        FROM "alerts" al
        JOIN "transactions" t ON t."id" = al."transaction_id"
        JOIN "accounts" s ON s."id" = t."sender_id"
        JOIN "accounts" r ON r."id" = t."receiver_id"
        JOIN "risk_assessments" ra ON ra."id" = al."risk_assessment_id"
        LEFT JOIN "users" assignee ON assignee."id" = al."assigned_to_id"
        LEFT JOIN "users" resolver ON resolver."id" = al."resolved_by_id"
        WHERE al."created_at" >= ${from} AND al."created_at" <= ${to}
        ORDER BY al."created_at" DESC
        LIMIT ${limit}
      `);

      return rows.map((row) => ({
        alertId: row.id,
        createdAt: row.created_at,
        severity: row.severity,
        status: row.status,
        outcome: row.outcome,
        riskScore: row.risk_score,
        externalId: row.external_id,
        amount: toAmountNumber(row.amount),
        senderRef: row.sender_ref,
        receiverRef: row.receiver_ref,
        assignedTo: row.assigned_to ?? '',
        resolvedBy: row.resolved_by ?? '',
        resolvedAt: row.resolved_at ?? '',
        hoursToResolve: row.hours_to_resolve ?? '',
        reopenCount: row.reopen_count,
        noteCount: row.note_count,
        resolutionSummary: row.resolution_summary ?? '',
      }));
    },
  },

  'rule-performance': {
    columns: [
      { key: 'ruleId', header: 'rule_id' },
      { key: 'name', header: 'name' },
      { key: 'triggerCount', header: 'trigger_count' },
      { key: 'triggerRate', header: 'trigger_rate_percent' },
      { key: 'averageContribution', header: 'average_contribution' },
      { key: 'alertCount', header: 'alert_count' },
      { key: 'confirmedFraudCount', header: 'confirmed_fraud_count' },
      { key: 'legitimateCount', header: 'legitimate_count' },
      { key: 'judgedCount', header: 'conclusively_judged_count' },
      { key: 'precisionOnJudgedAlerts', header: 'precision_on_judged_alerts_percent' },
    ],
    async load({ from, to }, client) {
      const result = await getRulePerformance({ from, to }, client);
      return result.rules.map((rule) => ({
        ...rule,
        precisionOnJudgedAlerts: rule.precisionOnJudgedAlerts ?? 'insufficient sample',
      }));
    },
  },

  'audit-logs': {
    columns: [
      { key: 'createdAt', header: 'created_at_utc' },
      { key: 'actor', header: 'actor' },
      { key: 'actorRole', header: 'actor_role' },
      { key: 'action', header: 'action' },
      { key: 'entityType', header: 'entity_type' },
      { key: 'entityId', header: 'entity_id' },
      { key: 'requestId', header: 'request_id' },
      { key: 'metadata', header: 'metadata' },
    ],
    /** Restricted to callers holding `audit:read` — enforced in the controller. */
    requiresAuditPermission: true,
    async load({ from, to, limit }, client) {
      const rows = await client.auditLog.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { actor: { select: { email: true, role: true } } },
      });
      return rows.map((row) => ({
        createdAt: row.createdAt,
        actor: row.actor?.email ?? 'system',
        actorRole: row.actor?.role ?? '',
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId ?? '',
        requestId: row.requestId,
        metadata: row.metadata ? JSON.stringify(row.metadata) : '',
      }));
    },
  },
};

/** Datasets available to export, for the UI's dropdown. */
export const EXPORTABLE_DATASETS = Object.entries(DATASETS).map(([key, value]) => ({
  dataset: key,
  columns: value.columns.map((column) => column.header),
  requiresAuditPermission: Boolean(value.requiresAuditPermission),
}));

/**
 * Builds a CSV export and records the extraction in the audit log.
 *
 * @returns {{filename: string, csv: string, rowCount: number}}
 */
export async function buildExport(params, context, client = prisma) {
  const { from, to } = resolveRange(params, { defaultDays: 30 });
  const definition = DATASETS[params.dataset];
  if (!definition) {
    throw new Error(`Unknown export dataset: ${params.dataset}`);
  }

  const rows = await definition.load({ from, to, limit: params.limit }, client);
  const csv = buildCsv(definition.columns, rows);

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTION.ANALYTICS_EXPORTED,
    entityType: AUDIT_ENTITY_TYPE.EXPORT,
    entityId: params.dataset,
    metadata: {
      dataset: params.dataset,
      rowCount: rows.length,
      from: from.toISOString(),
      to: to.toISOString(),
    },
    requestId: context.requestId,
    ipAddress: context.ipAddress,
  });

  return {
    filename: exportFilename(params.dataset, from, to),
    csv,
    rowCount: rows.length,
  };
}

export function datasetRequiresAuditPermission(dataset) {
  return Boolean(DATASETS[dataset]?.requiresAuditPermission);
}

export { DATASETS };
