import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seedBaseline } from '../helpers/database.js';
import { API, app, signIn, transactionPayload } from '../helpers/request.js';
import {
  INGESTION_SOURCE,
  ingestTransaction,
} from '../../src/modules/transactions/ingestion.service.js';
import { invalidateRulesetCache } from '../../src/modules/fraud/ruleset.service.js';
import supertest from 'supertest';

/**
 * Transaction ingestion: atomicity, idempotency, concurrency and the
 * server-side derivation of everything a client must not be trusted with.
 */

let session;

beforeEach(async () => {
  await seedBaseline();
  session = await signIn('analyst@test.local');
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Ingests directly through the service, bypassing HTTP. */
function ingest(overrides = {}, context = {}) {
  return ingestTransaction(
    { ...transactionPayload(overrides), occurredAt: new Date(overrides.occurredAt ?? Date.now()) },
    {
      actorId: null,
      requestId: 'test',
      source: INGESTION_SOURCE.API,
      emitEvents: false,
      ...context,
    },
  );
}

describe('POST /transactions/ingest', () => {
  it('persists the transaction with its assessment and returns 201', async () => {
    const payload = transactionPayload({ amount: 2500 });
    const response = await session.write('post', '/transactions/ingest').send(payload).expect(201);

    expect(response.body.data.duplicate).toBe(false);
    expect(response.body.data.transaction.externalId).toBe(payload.externalId);
    expect(response.body.data.assessment.riskScore).toBeGreaterThanOrEqual(0);
    expect(response.body.data.assessment.riskCategory).toBeTruthy();
    expect(Array.isArray(response.body.data.assessment.explanations)).toBe(true);

    const stored = await prisma.transaction.findUnique({
      where: { externalId: payload.externalId },
      include: { riskAssessments: true },
    });
    expect(stored).toBeTruthy();
    expect(stored.riskAssessments).toHaveLength(1);
    expect(Number(stored.amount.toString())).toBe(2500);
  });

  it('stores the amount exactly, with no floating-point drift', async () => {
    const payload = transactionPayload({ amount: 1234.56 });
    await session.write('post', '/transactions/ingest').send(payload).expect(201);
    const stored = await prisma.transaction.findUnique({
      where: { externalId: payload.externalId },
    });
    expect(stored.amount.toString()).toBe('1234.56');
  });

  it('derives isNewDevice server-side, ignoring any client claim', async () => {
    const first = transactionPayload({ deviceFingerprint: 'dev-first-seen' });
    await session.write('post', '/transactions/ingest').send(first).expect(201);

    // A client asserting `isNewDevice: false` must not be believed — and the
    // schema is strict, so the unexpected field is rejected outright.
    const second = transactionPayload({
      deviceFingerprint: 'dev-second-unseen',
      isNewDevice: false,
    });
    const rejected = await session.write('post', '/transactions/ingest').send(second).expect(400);
    expect(rejected.body.error.code).toBe('VALIDATION_ERROR');

    const accepted = transactionPayload({ deviceFingerprint: 'dev-second-unseen' });
    await session.write('post', '/transactions/ingest').send(accepted).expect(201);
    const stored = await prisma.transaction.findUnique({
      where: { externalId: accepted.externalId },
    });
    expect(stored.isNewDevice).toBe(true);
  });

  it('ignores a client-supplied ground-truth scenario label', async () => {
    const payload = transactionPayload();
    await session
      .write('post', '/transactions/ingest')
      .send({ ...payload, scenarioLabel: 'NORMAL' })
      .expect(201);

    const stored = await prisma.transaction.findUnique({
      where: { externalId: payload.externalId },
      include: { label: true },
    });
    // The controller strips it, so an external caller cannot plant a label that
    // would contaminate the detection-performance metrics.
    expect(stored.label).toBeNull();
  });

  it('rejects an amount of zero or below', async () => {
    for (const amount of [0, -100]) {
      const response = await session
        .write('post', '/transactions/ingest')
        .send(transactionPayload({ amount }))
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects a self-transfer', async () => {
    const response = await session
      .write('post', '/transactions/ingest')
      .send(transactionPayload({ senderRef: 'same@fraudlens', receiverRef: 'same@fraudlens' }))
      .expect(400);
    expect(response.body.error.details.some((issue) => issue.field === 'receiverRef')).toBe(true);
  });

  it('rejects a timestamp far in the future', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await session
      .write('post', '/transactions/ingest')
      .send(transactionPayload({ occurredAt: future }))
      .expect(400);
  });

  it('rejects an unknown field rather than silently dropping it', async () => {
    await session
      .write('post', '/transactions/ingest')
      .send({ ...transactionPayload(), riskScore: 0, unexpected: true })
      .expect(400);
  });

  it('rejects a body larger than the configured limit', async () => {
    const response = await session
      .write('post', '/transactions/ingest')
      .send({ ...transactionPayload(), externalId: 'X'.repeat(600_000) });
    expect([400, 413]).toContain(response.status);
  });

  it('never leaks a stack trace or SQL in an error response', async () => {
    const response = await session
      .write('post', '/transactions/ingest')
      .send({ externalId: 'x' })
      .expect(400);
    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/at \w+ \(/);
    expect(body).not.toMatch(/SELECT|INSERT|prisma/i);
    expect(response.body.error.requestId).toBeTruthy();
  });
});

describe('idempotency', () => {
  it('returns the existing transaction for a repeated externalId, with 200', async () => {
    const payload = transactionPayload();
    const first = await session.write('post', '/transactions/ingest').send(payload).expect(201);
    const second = await session.write('post', '/transactions/ingest').send(payload).expect(200);

    expect(second.body.data.duplicate).toBe(true);
    expect(second.body.data.transaction.id).toBe(first.body.data.transaction.id);

    expect(await prisma.transaction.count({ where: { externalId: payload.externalId } })).toBe(1);
  });

  it('does not create a second assessment or alert for a duplicate', async () => {
    const payload = transactionPayload({ amount: 500_000 });
    await session.write('post', '/transactions/ingest').send(payload).expect(201);
    await session.write('post', '/transactions/ingest').send(payload).expect(200);

    const stored = await prisma.transaction.findUnique({
      where: { externalId: payload.externalId },
      include: { riskAssessments: true, alerts: true },
    });
    expect(stored.riskAssessments).toHaveLength(1);
    expect(stored.alerts.length).toBeLessThanOrEqual(1);
  });

  it('treats a repeated idempotencyKey as a duplicate even with a new externalId', async () => {
    const key = 'idem-key-shared-001';
    await session
      .write('post', '/transactions/ingest')
      .send(transactionPayload({ idempotencyKey: key }))
      .expect(201);

    const second = await session
      .write('post', '/transactions/ingest')
      .send(transactionPayload({ idempotencyKey: key }))
      .expect(200);
    expect(second.body.data.duplicate).toBe(true);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it('records the duplicate attempt in the audit log', async () => {
    const payload = transactionPayload();
    await session.write('post', '/transactions/ingest').send(payload).expect(201);
    await session.write('post', '/transactions/ingest').send(payload).expect(200);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'transaction.ingest_duplicate' },
    });
    expect(entry).toBeTruthy();
    expect(entry.metadata.externalId).toBe(payload.externalId);
  });

  it('persists exactly one row when the same transaction is sent concurrently', async () => {
    const payload = transactionPayload();
    // Ten simultaneous submissions of the same transaction. The unique
    // constraint plus the in-transaction re-check must leave exactly one row.
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        supertest(app)
          .post(`${API}/transactions/ingest`)
          .set('Authorization', `Bearer ${session.accessToken}`)
          .send(payload),
      ),
    );

    const created = responses.filter((response) => response.status === 201);
    const duplicates = responses.filter((response) => response.status === 200);
    expect(created).toHaveLength(1);
    expect(duplicates).toHaveLength(9);
    expect(await prisma.transaction.count({ where: { externalId: payload.externalId } })).toBe(1);
    expect(await prisma.riskAssessment.count()).toBe(1);
  });
});

describe('atomicity', () => {
  it('writes the transaction, assessment and alert in one unit', async () => {
    // A score high enough to alert, built from several indicators.
    const base = Date.now();
    for (let index = 0; index < 12; index += 1) {
      await ingest({
        externalId: `ATOMIC-SETUP-${index}`,
        amount: 1000,
        occurredAt: base - (14 - index) * 86_400_000,
      });
    }

    const result = await ingest({
      externalId: 'ATOMIC-TARGET',
      amount: 900_000,
      deviceFingerprint: 'dev-brand-new-atomic',
      occurredAt: base,
    });

    const stored = await prisma.transaction.findUnique({
      where: { externalId: 'ATOMIC-TARGET' },
      include: { riskAssessments: true, alerts: true },
    });
    expect(stored.riskAssessments).toHaveLength(1);
    if (result.alert) {
      expect(stored.alerts).toHaveLength(1);
      expect(stored.alerts[0].riskAssessmentId).toBe(stored.riskAssessments[0].id);
    }
  });

  it('persists nothing when the ruleset is missing', async () => {
    await prisma.fraudRule.deleteMany();
    invalidateRulesetCache();

    await expect(ingest({ externalId: 'NO-RULESET-1' })).rejects.toThrow(/ruleset/i);
    // The whole unit rolled back, so no orphaned transaction row remains.
    expect(
      await prisma.transaction.findUnique({ where: { externalId: 'NO-RULESET-1' } }),
    ).toBeNull();
  });

  it('leaves no transaction without an assessment, ever', async () => {
    for (let index = 0; index < 15; index += 1) {
      await ingest({ externalId: `PAIRED-${index}`, amount: 1000 + index * 100 });
    }
    const orphans = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n
      FROM "transactions" t
      LEFT JOIN "risk_assessments" ra ON ra."transaction_id" = t."id"
      WHERE ra."id" IS NULL
    `;
    expect(orphans[0].n).toBe(0);
  });

  it('creates the audit event in the same unit as the transaction', async () => {
    const result = await ingest({ externalId: 'AUDIT-PAIRED-1' });
    const entry = await prisma.auditLog.findFirst({
      where: { action: 'transaction.ingested', entityId: result.transaction.id },
    });
    expect(entry).toBeTruthy();
    expect(entry.metadata.riskScore).toBe(result.assessment.riskScore);
  });
});

describe('historical features', () => {
  it('excludes the transaction being assessed from its own features', async () => {
    const base = Date.now();
    const first = await ingest({ externalId: 'SELF-EXCL-1', amount: 1000, occurredAt: base });
    const assessment = await prisma.riskAssessment.findFirst({
      where: { transactionId: first.transaction.id },
    });
    // The very first transaction for this sender must see an empty history.
    expect(assessment.features.sender.historyCount).toBe(0);
    expect(assessment.features.sender.amountHistoryCount).toBe(0);
  });

  it('counts only genuinely prior transactions in the velocity window', async () => {
    const base = Date.now();
    for (let index = 0; index < 6; index += 1) {
      await ingest({
        externalId: `VELOCITY-${index}`,
        amount: 1000,
        // One per minute, all inside the 10-minute window.
        occurredAt: base + index * 60_000,
      });
    }
    const last = await prisma.transaction.findUnique({
      where: { externalId: 'VELOCITY-5' },
      include: { riskAssessments: true },
    });
    expect(last.riskAssessments[0].features.sender.transactionsInVelocityWindow).toBe(5);
  });

  it('computes features from persisted rows, not from the request', async () => {
    const base = Date.now();
    await ingest({ externalId: 'FEAT-1', amount: 1000, occurredAt: base - 120_000 });
    const second = await ingest({ externalId: 'FEAT-2', amount: 1000, occurredAt: base });

    const assessment = await prisma.riskAssessment.findFirst({
      where: { transactionId: second.transaction.id },
    });
    expect(assessment.features.sender.historyCount).toBe(1);
    expect(assessment.features.windows.convention).toContain('excluding the assessed transaction');
  });
});

describe('assessment immutability', () => {
  it('refuses an UPDATE against a stored assessment', async () => {
    const result = await ingest({ externalId: 'IMMUTABLE-1' });
    const assessment = await prisma.riskAssessment.findFirst({
      where: { transactionId: result.transaction.id },
    });

    await expect(
      prisma.$executeRaw`UPDATE "risk_assessments" SET "risk_score" = 99 WHERE "id" = ${assessment.id}::uuid`,
    ).rejects.toThrow();

    const unchanged = await prisma.riskAssessment.findUnique({ where: { id: assessment.id } });
    expect(unchanged.riskScore).toBe(assessment.riskScore);
  });
});
