import {
  ALERT_SEVERITY_RANK,
  ALERT_STATUS,
  ASSIGNABLE_INVESTIGATOR_ROLES,
  INVESTIGATION_OUTCOME,
} from '@fraudlens/shared/constants';
import { AUDIT_ACTION, AUDIT_ENTITY_TYPE } from '@fraudlens/shared/schemas';
import { Prisma } from '../../generated/prisma/index.js';
import { prisma } from '../../config/prisma.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../utils/errors.js';
import { toAmountNumber } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { emitAlertUpdated } from '../../realtime/events.js';

/**
 * Alert and investigation workflow.
 *
 * Two pieces of state are tracked independently, and keeping them apart is the
 * central design decision of this module:
 *
 *  - `status` — where the alert is in the review process (OPEN, IN_REVIEW,
 *    RESOLVED). This is about *process*.
 *  - `outcome` — what a human concluded (PENDING, CONFIRMED_FRAUD, LEGITIMATE,
 *    INCONCLUSIVE). This is about *fact*.
 *
 * Collapsing them into one field is the usual mistake. It makes "closed"
 * ambiguous between "we decided it was fine" and "nobody is working on it", and
 * it makes it impossible to report confirmed fraud separately from alert
 * throughput. A database CHECK constraint enforces the valid combinations.
 */

const SORT_COLUMNS = {
  createdAt: Prisma.sql`al."created_at"`,
  updatedAt: Prisma.sql`al."updated_at"`,
  // Severity is an enum, so it is ordered by explicit rank rather than by its
  // alphabetical name, which would put CRITICAL below MEDIUM.
  severity: Prisma.sql`CASE al."severity"
    WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END`,
  riskScore: Prisma.sql`ra."risk_score"`,
  status: Prisma.sql`al."status"`,
};

function buildFilters(params, userId) {
  const clauses = [Prisma.sql`TRUE`];

  if (params.status?.length) {
    clauses.push(
      Prisma.sql`al."status"::text IN (${Prisma.join(params.status.map((v) => Prisma.sql`${v}`))})`,
    );
  }
  if (params.severity?.length) {
    clauses.push(
      Prisma.sql`al."severity"::text IN (${Prisma.join(params.severity.map((v) => Prisma.sql`${v}`))})`,
    );
  }
  if (params.outcome?.length) {
    clauses.push(
      Prisma.sql`al."outcome"::text IN (${Prisma.join(params.outcome.map((v) => Prisma.sql`${v}`))})`,
    );
  }
  if (params.assignedTo === 'unassigned') {
    clauses.push(Prisma.sql`al."assigned_to_id" IS NULL`);
  } else if (params.assignedTo === 'me') {
    clauses.push(Prisma.sql`al."assigned_to_id" = ${userId}::uuid`);
  } else if (params.assignedTo) {
    clauses.push(Prisma.sql`al."assigned_to_id" = ${params.assignedTo}::uuid`);
  }
  if (params.from) clauses.push(Prisma.sql`al."created_at" >= ${params.from}`);
  if (params.to) clauses.push(Prisma.sql`al."created_at" <= ${params.to}`);

  if (params.search) {
    const term = `%${params.search.toLowerCase()}%`;
    clauses.push(Prisma.sql`(
      LOWER(t."external_id") LIKE ${term}
      OR s."account_ref" LIKE ${term}
      OR r."account_ref" LIKE ${term}
      OR LOWER(COALESCE(al."resolution_summary", '')) LIKE ${term}
    )`);
  }

  return Prisma.join(clauses, ' AND ');
}

const FROM_BLOCK = Prisma.sql`
  FROM "alerts" al
  JOIN "transactions" t ON t."id" = al."transaction_id"
  JOIN "accounts" s ON s."id" = t."sender_id"
  JOIN "accounts" r ON r."id" = t."receiver_id"
  JOIN "risk_assessments" ra ON ra."id" = al."risk_assessment_id"
  LEFT JOIN "users" u ON u."id" = al."assigned_to_id"
`;

/** Paginated, filtered alert list with its transaction and assessment context. */
export async function listAlerts(params, userId, client = prisma) {
  const where = buildFilters(params, userId);
  const sortColumn = SORT_COLUMNS[params.sortBy] ?? SORT_COLUMNS.createdAt;
  const direction = params.sortDir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const offset = (params.page - 1) * params.pageSize;

  const [rows, countRows] = await Promise.all([
    client.$queryRaw(Prisma.sql`
      SELECT al."id", al."severity"::text, al."status"::text, al."outcome"::text,
             al."resolution_summary", al."reopen_count", al."created_at",
             al."updated_at", al."resolved_at",
             t."id" AS "transaction_id", t."external_id", t."amount", t."currency",
             t."occurred_at", t."channel",
             s."account_ref" AS "sender_ref", r."account_ref" AS "receiver_ref",
             ra."risk_score", ra."risk_category"::text, ra."triggered_rules",
             u."id" AS "assignee_id", u."name" AS "assignee_name", u."role"::text AS "assignee_role",
             (SELECT COUNT(*)::int FROM "investigation_notes" n WHERE n."alert_id" = al."id") AS "note_count"
      ${FROM_BLOCK}
      WHERE ${where}
      ORDER BY ${sortColumn} ${direction}, al."id" DESC
      LIMIT ${params.pageSize} OFFSET ${offset}
    `),
    client.$queryRaw(Prisma.sql`SELECT COUNT(*)::int AS "total" ${FROM_BLOCK} WHERE ${where}`),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      severity: row.severity,
      severityRank: ALERT_SEVERITY_RANK[row.severity] ?? 0,
      status: row.status,
      outcome: row.outcome,
      resolutionSummary: row.resolution_summary,
      reopenCount: row.reopen_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at,
      noteCount: row.note_count,
      transaction: {
        id: row.transaction_id,
        externalId: row.external_id,
        amount: toAmountNumber(row.amount),
        currency: row.currency,
        occurredAt: row.occurred_at,
        channel: row.channel,
        senderRef: row.sender_ref,
        receiverRef: row.receiver_ref,
      },
      assessment: {
        riskScore: row.risk_score,
        riskCategory: row.risk_category,
        triggeredRuleIds: Array.isArray(row.triggered_rules)
          ? row.triggered_rules.map((rule) => rule.ruleId)
          : [],
      },
      assignedTo: row.assignee_id
        ? { id: row.assignee_id, name: row.assignee_name, role: row.assignee_role }
        : null,
    })),
    total: countRows[0]?.total ?? 0,
  };
}

const ALERT_DETAIL_INCLUDE = {
  transaction: {
    include: {
      sender: { select: { id: true, accountRef: true, displayName: true, isMerchant: true } },
      receiver: { select: { id: true, accountRef: true, displayName: true, isMerchant: true } },
    },
  },
  riskAssessment: true,
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
  resolvedBy: { select: { id: true, name: true, email: true, role: true } },
  notes: {
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { id: true, name: true, role: true } } },
  },
};

function toAlertDetail(alert) {
  return {
    id: alert.id,
    severity: alert.severity,
    status: alert.status,
    outcome: alert.outcome,
    resolutionSummary: alert.resolutionSummary,
    reopenCount: alert.reopenCount,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
    resolvedAt: alert.resolvedAt,
    assignedTo: alert.assignedTo,
    resolvedBy: alert.resolvedBy,
    transaction: {
      id: alert.transaction.id,
      externalId: alert.transaction.externalId,
      amount: toAmountNumber(alert.transaction.amount),
      currency: alert.transaction.currency,
      occurredAt: alert.transaction.occurredAt,
      channel: alert.transaction.channel,
      status: alert.transaction.status,
      isNewDevice: alert.transaction.isNewDevice,
      deviceFingerprint: alert.transaction.deviceFingerprint,
      sender: alert.transaction.sender,
      receiver: alert.transaction.receiver,
    },
    /**
     * The assessment the alert was raised on — not the transaction's latest.
     * An alert must always be explainable by the evidence that actually
     * triggered it, even after the transaction has been re-assessed.
     */
    assessment: {
      id: alert.riskAssessment.id,
      riskScore: alert.riskAssessment.riskScore,
      riskCategory: alert.riskAssessment.riskCategory,
      rulesetVersion: alert.riskAssessment.rulesetVersion,
      triggeredRules: alert.riskAssessment.triggeredRules,
      explanations: alert.riskAssessment.explanations,
      features: alert.riskAssessment.features,
      assessedAt: alert.riskAssessment.assessedAt,
    },
    notes: alert.notes.map((note) => ({
      id: note.id,
      body: note.body,
      author: note.author,
      createdAt: note.createdAt,
    })),
  };
}

export async function getAlert(id, client = prisma) {
  const alert = await client.alert.findUnique({ where: { id }, include: ALERT_DETAIL_INCLUDE });
  if (!alert) throw new NotFoundError('Alert');
  return toAlertDetail(alert);
}

/**
 * Assigns or unassigns an investigator.
 *
 * The assignee must hold a role that can actually act on an alert: assigning a
 * VIEWER would create a queue item nobody is able to progress.
 */
export async function assignAlert(id, assignedToId, context) {
  const existing = await prisma.alert.findUnique({
    where: { id },
    select: { id: true, assignedToId: true, status: true, severity: true, transactionId: true },
  });
  if (!existing) throw new NotFoundError('Alert');

  if (assignedToId) {
    const assignee = await prisma.user.findUnique({
      where: { id: assignedToId },
      select: { id: true, name: true, role: true, isActive: true },
    });
    if (!assignee) throw new UnprocessableError('The specified user does not exist');
    if (!assignee.isActive) {
      throw new UnprocessableError('Cannot assign an alert to a deactivated account');
    }
    if (!ASSIGNABLE_INVESTIGATOR_ROLES.includes(assignee.role)) {
      throw new UnprocessableError(
        `A user with the ${assignee.role} role cannot be assigned alerts, because that role cannot act on them`,
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const alert = await tx.alert.update({
      where: { id },
      data: { assignedToId },
      include: ALERT_DETAIL_INCLUDE,
    });

    await recordAudit({
      actorId: context.actorId,
      action: assignedToId ? AUDIT_ACTION.ALERT_ASSIGNED : AUDIT_ACTION.ALERT_UNASSIGNED,
      entityType: AUDIT_ENTITY_TYPE.ALERT,
      entityId: id,
      metadata: {
        assignedToId: assignedToId ?? undefined,
        previousAssignedToId: existing.assignedToId ?? undefined,
      },
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      tx,
    });

    return alert;
  });

  emitAlertUpdated(updated, {
    assignedToId: updated.assignedToId,
    assignedToName: updated.assignedTo?.name ?? null,
  });

  return toAlertDetail(updated);
}

/**
 * Moves an alert through the workflow and, on resolution, records the outcome.
 *
 * Reopening a resolved alert is explicitly supported: it clears the outcome
 * back to PENDING, increments `reopenCount`, and writes a dedicated audit event
 * carrying the reason. The investigation notes are untouched, so the full
 * history of a reopened case stays intact — which is the point of making notes
 * append-only.
 */
export async function updateAlertStatus(id, payload, context) {
  const existing = await prisma.alert.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      outcome: true,
      reopenCount: true,
      assignedToId: true,
      transactionId: true,
    },
  });
  if (!existing) throw new NotFoundError('Alert');

  const { status, outcome, resolutionSummary, reopenReason } = payload;
  const isReopening = existing.status === ALERT_STATUS.RESOLVED && status !== ALERT_STATUS.RESOLVED;

  if (isReopening && !reopenReason) {
    throw new UnprocessableError('Reopening a resolved alert requires `reopenReason`');
  }
  if (existing.status === status && status !== ALERT_STATUS.RESOLVED) {
    throw new ConflictError(`The alert is already ${status}`);
  }

  const data = { status };

  if (status === ALERT_STATUS.RESOLVED) {
    data.outcome = outcome;
    data.resolutionSummary = resolutionSummary;
    data.resolvedAt = new Date();
    data.resolvedById = context.actorId;
    // Resolving an unassigned alert assigns it to the resolver, so every
    // resolution has an accountable owner.
    if (!existing.assignedToId) data.assignedToId = context.actorId;
  } else {
    // Leaving RESOLVED clears the conclusion: the case is open again, so there
    // is no current outcome. The CHECK constraint requires this.
    data.outcome = INVESTIGATION_OUTCOME.PENDING;
    data.resolutionSummary = null;
    data.resolvedAt = null;
    data.resolvedById = null;
    if (isReopening) data.reopenCount = existing.reopenCount + 1;
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.alert.update({ where: { id }, data });

    // A reopen is recorded both as a status change and as its own event, so an
    // auditor can find reopens without scanning every status transition.
    await recordAudit({
      actorId: context.actorId,
      action:
        status === ALERT_STATUS.RESOLVED
          ? AUDIT_ACTION.ALERT_RESOLVED
          : AUDIT_ACTION.ALERT_STATUS_CHANGED,
      entityType: AUDIT_ENTITY_TYPE.ALERT,
      entityId: id,
      metadata: {
        status,
        previousStatus: existing.status,
        outcome: data.outcome,
        previousOutcome: existing.outcome,
        transactionId: existing.transactionId,
      },
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      tx,
    });

    if (isReopening) {
      await recordAudit({
        actorId: context.actorId,
        action: AUDIT_ACTION.ALERT_REOPENED,
        entityType: AUDIT_ENTITY_TYPE.ALERT,
        entityId: id,
        metadata: {
          reopenReason,
          reopenCount: data.reopenCount,
          previousOutcome: existing.outcome,
        },
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        tx,
      });

      // The reason is also written as an investigation note so it appears in
      // the case history an investigator actually reads.
      await tx.investigationNote.create({
        data: {
          alertId: id,
          authorId: context.actorId,
          body: `Alert reopened. Reason: ${reopenReason}`,
        },
      });
    }

    // Read the alert back at the end of the transaction so the response
    // includes the reopen note written above, rather than a snapshot taken
    // before it existed.
    return tx.alert.findUniqueOrThrow({ where: { id }, include: ALERT_DETAIL_INCLUDE });
  });

  emitAlertUpdated(updated, {
    assignedToId: updated.assignedToId,
    assignedToName: updated.assignedTo?.name ?? null,
  });

  return toAlertDetail(updated);
}

/** Appends an investigation note. Notes are never updated or deleted. */
export async function addInvestigationNote(id, body, context) {
  const alert = await prisma.alert.findUnique({ where: { id }, select: { id: true } });
  if (!alert) throw new NotFoundError('Alert');

  const note = await prisma.$transaction(async (tx) => {
    const created = await tx.investigationNote.create({
      data: { alertId: id, authorId: context.actorId, body },
      include: { author: { select: { id: true, name: true, role: true } } },
    });

    // Touch the alert so its `updatedAt` reflects investigation activity and
    // the "least recently touched" queue ordering stays meaningful.
    await tx.alert.update({ where: { id }, data: { updatedAt: new Date() } });

    await recordAudit({
      actorId: context.actorId,
      action: AUDIT_ACTION.ALERT_NOTE_ADDED,
      entityType: AUDIT_ENTITY_TYPE.INVESTIGATION_NOTE,
      entityId: created.id,
      // The note's text is not copied into the audit log: the note itself is
      // already an immutable record, and duplicating free text invites leaking
      // sensitive detail into a second, more widely readable place.
      metadata: { alertId: id, noteId: created.id, noteLength: body.length },
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      tx,
    });

    return created;
  });

  return {
    id: note.id,
    body: note.body,
    author: note.author,
    createdAt: note.createdAt,
  };
}

/** Paginated note history for one alert. */
export async function listInvestigationNotes(id, params, client = prisma) {
  const alert = await client.alert.findUnique({ where: { id }, select: { id: true } });
  if (!alert) throw new NotFoundError('Alert');

  const [notes, total] = await Promise.all([
    client.investigationNote.findMany({
      where: { alertId: id },
      orderBy: { createdAt: params.sortDir },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: { author: { select: { id: true, name: true, role: true } } },
    }),
    client.investigationNote.count({ where: { alertId: id } }),
  ]);

  return {
    items: notes.map((note) => ({
      id: note.id,
      body: note.body,
      author: note.author,
      createdAt: note.createdAt,
    })),
    total,
  };
}

/** Users who may be assigned alerts, for the assignment dropdown. */
export async function listAssignableInvestigators(client = prisma) {
  return client.user.findMany({
    where: { isActive: true, role: { in: ASSIGNABLE_INVESTIGATOR_ROLES } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });
}

export { toAlertDetail, buildFilters as buildAlertFilters };
