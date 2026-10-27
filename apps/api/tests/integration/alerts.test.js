import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seedBaseline } from '../helpers/database.js';
import { signIn, transactionPayload } from '../helpers/request.js';
import {
  INGESTION_SOURCE,
  ingestTransaction,
} from '../../src/modules/transactions/ingestion.service.js';

/**
 * Alert and investigation workflow, end to end.
 *
 * The central property under test is that workflow status and investigation
 * outcome stay independent, and that the combinations which would make the
 * data meaningless are rejected by both the API and the database.
 */

let investigator;
let alertId;
let transactionId;

/** Ingests a transaction and forces an alert by lowering the threshold. */
async function createAlertedTransaction() {
  // A threshold of 1 guarantees an alert without having to construct a
  // multi-indicator scenario, which belongs in the engine tests rather than here.
  await prisma.riskSettings.updateMany({
    data: { mediumThreshold: 1, highThreshold: 2, alertThreshold: 1 },
  });
  const { invalidateRulesetCache } = await import('../../src/modules/fraud/ruleset.service.js');
  invalidateRulesetCache();

  const result = await ingestTransaction(
    {
      ...transactionPayload({ amount: 500_000, deviceFingerprint: 'dev-alert-trigger' }),
      occurredAt: new Date(),
    },
    { actorId: null, requestId: 'test', source: INGESTION_SOURCE.API, emitEvents: false },
  );
  return result;
}

beforeEach(async () => {
  await seedBaseline();
  investigator = await signIn('investigator@test.local');
  const result = await createAlertedTransaction();
  alertId = result.alert.id;
  transactionId = result.transaction.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /alerts', () => {
  it('lists alerts with their transaction and assessment context', async () => {
    const response = await investigator.get('/alerts').expect(200);
    expect(response.body.data).toHaveLength(1);

    const [alert] = response.body.data;
    expect(alert.status).toBe('OPEN');
    expect(alert.outcome).toBe('PENDING');
    expect(alert.transaction.id).toBe(transactionId);
    expect(alert.assessment.riskScore).toBeGreaterThan(0);
    expect(response.body.meta.total).toBe(1);
  });

  it('filters by workflow status and investigation outcome independently', async () => {
    const byStatus = await investigator.get('/alerts?status=OPEN').expect(200);
    expect(byStatus.body.data).toHaveLength(1);

    const byOutcome = await investigator.get('/alerts?outcome=CONFIRMED_FRAUD').expect(200);
    expect(byOutcome.body.data).toHaveLength(0);

    const resolved = await investigator.get('/alerts?status=RESOLVED').expect(200);
    expect(resolved.body.data).toHaveLength(0);
  });

  it('rejects an unknown sort column instead of passing it to SQL', async () => {
    const response = await investigator.get('/alerts?sortBy=id;DROP TABLE alerts').expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('paginates server-side', async () => {
    const response = await investigator.get('/alerts?page=1&pageSize=1').expect(200);
    expect(response.body.meta).toMatchObject({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
  });
});

describe('assignment', () => {
  it('assigns and unassigns an investigator, auditing both', async () => {
    const assigned = await investigator
      .write('patch', `/alerts/${alertId}/assignment`)
      .send({ assignedToId: investigator.user.id })
      .expect(200);
    expect(assigned.body.data.assignedTo.id).toBe(investigator.user.id);

    const unassigned = await investigator
      .write('patch', `/alerts/${alertId}/assignment`)
      .send({ assignedToId: null })
      .expect(200);
    expect(unassigned.body.data.assignedTo).toBeNull();

    const actions = await prisma.auditLog.findMany({
      where: { entityId: alertId, action: { in: ['alert.assigned', 'alert.unassigned'] } },
    });
    expect(actions).toHaveLength(2);
  });

  it('refuses to assign an alert to a VIEWER, who could not act on it', async () => {
    const viewer = await prisma.user.findUnique({ where: { email: 'viewer@test.local' } });
    const response = await investigator
      .write('patch', `/alerts/${alertId}/assignment`)
      .send({ assignedToId: viewer.id })
      .expect(422);
    expect(response.body.error.message).toMatch(/VIEWER/);
  });

  it('refuses to assign an alert to a deactivated account', async () => {
    const analyst = await prisma.user.findUnique({ where: { email: 'analyst@test.local' } });
    await prisma.user.update({ where: { id: analyst.id }, data: { isActive: false } });
    await investigator
      .write('patch', `/alerts/${alertId}/assignment`)
      .send({ assignedToId: analyst.id })
      .expect(422);
  });

  it('returns 404 for an alert that does not exist', async () => {
    await investigator
      .write('patch', '/alerts/00000000-0000-4000-8000-000000000000/assignment')
      .send({ assignedToId: null })
      .expect(404);
  });
});

describe('workflow status and investigation outcome', () => {
  it('moves an alert to IN_REVIEW without recording any outcome', async () => {
    const response = await investigator
      .write('patch', `/alerts/${alertId}/status`)
      .send({ status: 'IN_REVIEW' })
      .expect(200);
    expect(response.body.data.status).toBe('IN_REVIEW');
    // Being under review is not a conclusion.
    expect(response.body.data.outcome).toBe('PENDING');
  });

  it('refuses to resolve without a conclusive outcome', async () => {
    const response = await investigator
      .write('patch', `/alerts/${alertId}/status`)
      .send({ status: 'RESOLVED' })
      .expect(400);
    expect(response.body.error.details.some((issue) => issue.field === 'outcome')).toBe(true);
  });

  it('refuses to resolve with a PENDING outcome', async () => {
    await investigator
      .write('patch', `/alerts/${alertId}/status`)
      .send({ status: 'RESOLVED', outcome: 'PENDING', resolutionSummary: 'Long enough summary' })
      .expect(400);
  });

  it('refuses to resolve without a resolution summary', async () => {
    const response = await investigator
      .write('patch', `/alerts/${alertId}/status`)
      .send({ status: 'RESOLVED', outcome: 'LEGITIMATE' })
      .expect(400);
    expect(response.body.error.details.some((issue) => issue.field === 'resolutionSummary')).toBe(
      true,
    );
  });

  it('refuses to attach a conclusive outcome to an unresolved alert', async () => {
    await investigator
      .write('patch', `/alerts/${alertId}/status`)
      .send({ status: 'IN_REVIEW', outcome: 'CONFIRMED_FRAUD' })
      .expect(400);
  });

  it('resolves with an outcome, a summary and an accountable resolver', async () => {
    const response = await investigator
      .write('patch', `/alerts/${alertId}/status`)
      .send({
        status: 'RESOLVED',
        outcome: 'CONFIRMED_FRAUD',
        resolutionSummary: 'Confirmed: mule collection pattern across multiple senders.',
      })
      .expect(200);

    expect(response.body.data.status).toBe('RESOLVED');
    expect(response.body.data.outcome).toBe('CONFIRMED_FRAUD');
    expect(response.body.data.resolvedBy.id).toBe(investigator.user.id);
    expect(response.body.data.resolvedAt).toBeTruthy();
    // An unassigned alert is assigned to its resolver, so every resolution has
    // an owner.
    expect(response.body.data.assignedTo.id).toBe(investigator.user.id);
  });

  it('records a dedicated audit event on resolution', async () => {
    await investigator
      .write('patch', `/alerts/${alertId}/status`)
      .send({
        status: 'RESOLVED',
        outcome: 'LEGITIMATE',
        resolutionSummary: 'Verified against the account holder usual pattern.',
      })
      .expect(200);

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: alertId, action: 'alert.resolved' },
    });
    expect(entry.metadata.outcome).toBe('LEGITIMATE');
    expect(entry.metadata.previousStatus).toBe('OPEN');
  });
});

describe('reopening', () => {
  async function resolve() {
    await investigator
      .write('patch', `/alerts/${alertId}/status`)
      .send({
        status: 'RESOLVED',
        outcome: 'CONFIRMED_FRAUD',
        resolutionSummary: 'Initial conclusion: confirmed fraudulent.',
      })
      .expect(200);
  }

  it('requires a reason to reopen', async () => {
    await resolve();
    const response = await investigator
      .write('patch', `/alerts/${alertId}/status`)
      .send({ status: 'IN_REVIEW' })
      .expect(422);
    expect(response.body.error.message).toMatch(/reopenReason/);
  });

  it('clears the outcome, increments the reopen count and preserves history', async () => {
    await resolve();
    await investigator
      .write('post', `/alerts/${alertId}/notes`)
      .send({ body: 'Note recorded before the alert was reopened.' })
      .expect(201);

    const response = await investigator
      .write('patch', `/alerts/${alertId}/status`)
      .send({ status: 'IN_REVIEW', reopenReason: 'Counterparty disputed the finding.' })
      .expect(200);

    expect(response.body.data.status).toBe('IN_REVIEW');
    expect(response.body.data.outcome).toBe('PENDING');
    expect(response.body.data.resolutionSummary).toBeNull();
    expect(response.body.data.reopenCount).toBe(1);
    // The earlier note survives, plus the reopen note.
    expect(response.body.data.notes.length).toBe(2);
  });

  it('writes a dedicated audit record carrying the reason', async () => {
    await resolve();
    await investigator
      .write('patch', `/alerts/${alertId}/status`)
      .send({ status: 'IN_REVIEW', reopenReason: 'New evidence came to light today.' })
      .expect(200);

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: alertId, action: 'alert.reopened' },
    });
    expect(entry.metadata.reopenReason).toMatch(/New evidence/);
    expect(entry.metadata.reopenCount).toBe(1);
  });

  it('adds the reopen reason to the case notes', async () => {
    await resolve();
    await investigator
      .write('patch', `/alerts/${alertId}/status`)
      .send({ status: 'OPEN', reopenReason: 'Escalated by the compliance team.' })
      .expect(200);

    const notes = await prisma.investigationNote.findMany({ where: { alertId } });
    expect(notes.some((note) => note.body.includes('Escalated by the compliance team'))).toBe(true);
  });
});

describe('investigation notes', () => {
  it('appends a note and returns it with its author', async () => {
    const response = await investigator
      .write('post', `/alerts/${alertId}/notes`)
      .send({ body: 'Checked the device history for this sender.' })
      .expect(201);
    expect(response.body.data.author.id).toBe(investigator.user.id);
    expect(response.body.data.body).toMatch(/device history/);
  });

  it('rejects an empty or over-long note', async () => {
    await investigator.write('post', `/alerts/${alertId}/notes`).send({ body: 'x' }).expect(400);
    await investigator
      .write('post', `/alerts/${alertId}/notes`)
      .send({ body: 'x'.repeat(5000) })
      .expect(400);
  });

  it('does not copy the note text into the audit log', async () => {
    const secret = 'Sensitive detail that should not be duplicated into the audit trail.';
    await investigator.write('post', `/alerts/${alertId}/notes`).send({ body: secret }).expect(201);

    const entry = await prisma.auditLog.findFirst({ where: { action: 'alert.note_added' } });
    expect(entry.metadata.noteLength).toBe(secret.length);
    expect(JSON.stringify(entry.metadata)).not.toContain('Sensitive detail');
  });

  it('refuses an UPDATE or DELETE against a stored note', async () => {
    const response = await investigator
      .write('post', `/alerts/${alertId}/notes`)
      .send({ body: 'This note must be immutable once written.' })
      .expect(201);
    const noteId = response.body.data.id;

    await expect(
      prisma.$executeRaw`UPDATE "investigation_notes" SET "body" = 'tampered' WHERE "id" = ${noteId}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`DELETE FROM "investigation_notes" WHERE "id" = ${noteId}::uuid`,
    ).rejects.toThrow();

    const unchanged = await prisma.investigationNote.findUnique({ where: { id: noteId } });
    expect(unchanged.body).toMatch(/must be immutable/);
  });

  it('exposes no update or delete route for a note', async () => {
    const response = await investigator
      .write('post', `/alerts/${alertId}/notes`)
      .send({ body: 'A note to attempt to modify over HTTP.' })
      .expect(201);
    await investigator
      .write('patch', `/alerts/${alertId}/notes/${response.body.data.id}`)
      .expect(404);
    await investigator
      .write('delete', `/alerts/${alertId}/notes/${response.body.data.id}`)
      .expect(404);
  });

  it('lists notes newest first, paginated', async () => {
    for (let index = 0; index < 3; index += 1) {
      await investigator
        .write('post', `/alerts/${alertId}/notes`)
        .send({ body: `Investigation note number ${index}.` })
        .expect(201);
    }
    const response = await investigator.get(`/alerts/${alertId}/notes?pageSize=2`).expect(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(3);
  });
});

describe('database-level consistency', () => {
  it('rejects a resolved alert with no outcome, even via raw SQL', async () => {
    await expect(
      prisma.$executeRaw`UPDATE "alerts" SET "status" = 'RESOLVED' WHERE "id" = ${alertId}::uuid`,
    ).rejects.toThrow();
  });

  it('rejects a conclusive outcome on an unresolved alert, even via raw SQL', async () => {
    await expect(
      prisma.$executeRaw`UPDATE "alerts" SET "outcome" = 'CONFIRMED_FRAUD' WHERE "id" = ${alertId}::uuid`,
    ).rejects.toThrow();
  });

  it('prevents a duplicate alert for the same transaction and assessment', async () => {
    const alert = await prisma.alert.findUnique({ where: { id: alertId } });
    await expect(
      prisma.alert.create({
        data: {
          transactionId: alert.transactionId,
          riskAssessmentId: alert.riskAssessmentId,
          severity: 'HIGH',
        },
      }),
    ).rejects.toThrow();
  });
});
