import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seedBaseline } from '../helpers/database.js';
import { signIn, transactionPayload } from '../helpers/request.js';
import {
  INGESTION_SOURCE,
  ingestTransaction,
} from '../../src/modules/transactions/ingestion.service.js';
import { shutdownSimulator } from '../../src/modules/simulator/simulator.service.js';
import { buildExport } from '../../src/modules/analytics/export.service.js';
import { deriveMetrics } from '../../src/modules/analytics/analytics.service.js';

/** Simulator lifecycle, analytics aggregation and CSV export. */

let analyst;
let admin;
let viewer;

beforeEach(async () => {
  await seedBaseline();
  analyst = await signIn('analyst@test.local');
  admin = await signIn('admin@test.local');
  viewer = await signIn('viewer@test.local');
});

afterEach(async () => {
  // Never leave a worker running between tests: it would keep writing rows
  // into the next test's freshly truncated database.
  await shutdownSimulator();
});

afterAll(async () => {
  await shutdownSimulator();
  await prisma.$disconnect();
});

describe('simulator lifecycle', () => {
  it('reports a stopped worker before anything starts it', async () => {
    const response = await analyst.get('/simulator/status').expect(200);
    expect(response.body.data.status).toBe('STOPPED');
    expect(response.body.data.running).toBe(false);
    expect(response.body.data.counters.ingested).toBe(0);
  });

  it('starts, generates transactions through the real pipeline, and stops', async () => {
    await analyst
      .write('post', '/simulator/start')
      .send({ ratePerSecond: 20, seed: 99, maxTransactions: 5 })
      .expect(200);

    const running = await analyst.get('/simulator/status').expect(200);
    expect(running.body.data.running).toBe(true);

    // Wait for it to reach its configured limit and auto-stop.
    const deadline = Date.now() + 15_000;
    let count = 0;
    while (Date.now() < deadline) {
      count = await prisma.transaction.count();
      if (count >= 5) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(count).toBeGreaterThanOrEqual(5);

    // Every generated transaction went through the real pipeline, so each has
    // an assessment — there is no separate "simulated" code path.
    const assessments = await prisma.riskAssessment.count();
    expect(assessments).toBe(await prisma.transaction.count());
  });

  it('continues its id sequence when the same seed is run again', async () => {
    const run = async () => {
      await analyst
        .write('post', '/simulator/start')
        .send({ ratePerSecond: 20, seed: 4242, maxTransactions: 5 })
        .expect(200);

      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const status = await analyst.get('/simulator/status').expect(200);
        if (!status.body.data.running) return status.body.data;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('the simulator never reached its transaction limit');
    };

    const first = await run();
    expect(first.counters.ingested).toBeGreaterThanOrEqual(5);
    expect(first.counters.duplicates).toBe(0);

    const second = await run();
    // Ingestion is idempotent on the external id, so a sequence that restarted
    // at 1 would have every transaction here skipped as a duplicate: a worker
    // reporting itself RUNNING while writing nothing at all.
    expect(second.counters.duplicates).toBe(0);
    expect(second.counters.ingested).toBeGreaterThanOrEqual(5);
    expect(await prisma.transaction.count()).toBeGreaterThanOrEqual(
      first.counters.ingested + second.counters.ingested,
    );
  });

  it('labels generated transactions with their scenario as ground truth', async () => {
    await analyst
      .write('post', '/simulator/start')
      .send({ ratePerSecond: 20, seed: 7, maxTransactions: 5 })
      .expect(200);

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if ((await prisma.transactionLabel.count()) >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const labels = await prisma.transactionLabel.findMany();
    expect(labels.length).toBeGreaterThan(0);
    // Labels live in their own table, never on the assessment.
    expect(labels.every((label) => label.source === 'SIMULATOR')).toBe(true);
  });

  it('refuses a second concurrent run', async () => {
    await analyst.write('post', '/simulator/start').send({ ratePerSecond: 1, seed: 1 }).expect(200);

    const response = await analyst
      .write('post', '/simulator/start')
      .send({ ratePerSecond: 1 })
      .expect(409);
    expect(response.body.error.code).toBe('CONFLICT');

    await analyst.write('post', '/simulator/stop').expect(200);
  });

  it('refuses to stop a worker that is not running', async () => {
    const response = await analyst.write('post', '/simulator/stop').expect(409);
    expect(response.body.error.message).toMatch(/not running/i);
  });

  it('refuses a rate above the configured maximum', async () => {
    const response = await analyst
      .write('post', '/simulator/start')
      .send({ ratePerSecond: 99 })
      .expect(422);
    expect(response.body.error.message).toMatch(/maximum/i);

    // A refused start must leave the worker stopped, not stuck in STARTING.
    const status = await analyst.get('/simulator/status').expect(200);
    expect(status.body.data.status).toBe('STOPPED');
  });

  it('rejects an invalid scenario distribution', async () => {
    await analyst
      .write('post', '/simulator/start')
      .send({ scenarioDistribution: { NORMAL: 0, HIGH_VALUE: 0 } })
      .expect(400);
    await analyst
      .write('post', '/simulator/start')
      .send({ scenarioDistribution: { NOT_A_SCENARIO: 10 } })
      .expect(400);
  });

  it('records start and stop in the audit log', async () => {
    await analyst.write('post', '/simulator/start').send({ ratePerSecond: 1, seed: 5 }).expect(200);
    await analyst.write('post', '/simulator/stop').expect(200);

    const actions = await prisma.auditLog.findMany({
      where: { action: { in: ['simulator.started', 'simulator.stopped'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(actions.map((entry) => entry.action)).toEqual([
      'simulator.started',
      'simulator.stopped',
    ]);
    expect(actions[0].metadata.seed).toBe(5);
  });

  it('lets a viewer neither read nor control the simulator', async () => {
    await viewer.get('/simulator/status').expect(403);
    await viewer.write('post', '/simulator/start').send({}).expect(403);
  });

  it('lets an investigator read the status but not control it', async () => {
    const investigator = await signIn('investigator@test.local');
    await investigator.get('/simulator/status').expect(200);
    await investigator.write('post', '/simulator/start').send({}).expect(403);
  });
});

describe('dashboard aggregation', () => {
  beforeEach(async () => {
    const base = Date.now();
    for (let index = 0; index < 8; index += 1) {
      await ingestTransaction(
        {
          ...transactionPayload({
            externalId: `DASH-${index}`,
            amount: 1000 * (index + 1),
          }),
          occurredAt: new Date(base - index * 3_600_000),
        },
        { actorId: null, requestId: 't', source: INGESTION_SOURCE.API, emitEvents: false },
      );
    }
  });

  it('computes every headline figure from persisted rows', async () => {
    const response = await admin.get('/dashboard/summary').expect(200);
    const { metrics } = response.body.data;

    expect(metrics.totalTransactions).toBe(8);
    expect(metrics.transactionsInRange).toBe(8);
    expect(metrics.valueInRange).toBe(36_000);
    expect(metrics.confirmedFraudCases).toBe(0);
  });

  it('ships the documented definition of every metric', async () => {
    const response = await admin.get('/dashboard/summary').expect(200);
    const { definitions, metrics } = response.body.data;
    for (const key of ['totalTransactions', 'highRiskTransactions', 'confirmedFraudCases']) {
      expect(metrics[key]).toBeDefined();
      expect(definitions[key].definition).toBeTruthy();
    }
    // The confirmed-fraud definition must say it reflects human judgement.
    expect(definitions.confirmedFraudCases.definition).toMatch(/investigator/i);
  });

  it('emits a bucket for every period, including empty ones', async () => {
    const response = await admin.get('/dashboard/transaction-series?interval=day').expect(200);
    const { points } = response.body.data;
    expect(points.length).toBeGreaterThan(20);
    expect(points.some((point) => point.count === 0)).toBe(true);
    expect(points.every((point) => typeof point.count === 'number')).toBe(true);
  });

  it('returns every risk category, including those with no transactions', async () => {
    const response = await admin.get('/dashboard/risk-distribution').expect(200);
    const categories = response.body.data.categories.map((entry) => entry.category);
    expect(categories).toEqual(expect.arrayContaining(['LOW', 'MEDIUM', 'HIGH', 'UNASSESSED']));
  });

  it('honours an explicit date range', async () => {
    const response = await admin
      .get(`/dashboard/summary?from=${new Date(Date.now() - 3_600_000).toISOString()}`)
      .expect(200);
    // Only the most recent transactions fall inside a one-hour window.
    expect(response.body.data.metrics.transactionsInRange).toBeLessThan(8);
    // The lifetime total is deliberately unaffected by the filter.
    expect(response.body.data.metrics.totalTransactions).toBe(8);
  });

  it('rejects an inverted date range', async () => {
    await admin
      .get('/dashboard/summary?from=2026-06-01T00:00:00Z&to=2026-01-01T00:00:00Z')
      .expect(400);
  });
});

describe('detection performance', () => {
  it('withholds metrics when the labelled sample is too small', async () => {
    const response = await admin.get('/analytics/detection-performance').expect(200);
    expect(response.body.data.kind).toBe('MODEL_EVALUATION_METRICS');
    expect(response.body.data.available).toBe(false);
    expect(response.body.data.metrics).toBeNull();
    expect(response.body.data.unavailableReason).toMatch(/at least/i);
  });

  it('returns the caveats alongside the data', async () => {
    const response = await admin
      .get('/analytics/detection-performance?source=INVESTIGATION')
      .expect(200);
    expect(response.body.data.caveats.length).toBeGreaterThan(0);
    // The investigation source is biased by construction, and must say so.
    expect(response.body.data.caveats.join(' ')).toMatch(/biased/i);
  });

  it('derives precision, recall and F1 correctly', () => {
    const metrics = deriveMetrics({
      truePositives: 80,
      falsePositives: 20,
      trueNegatives: 880,
      falseNegatives: 20,
    });
    expect(metrics.precision).toBe(0.8);
    expect(metrics.recall).toBe(0.8);
    expect(metrics.f1Score).toBeCloseTo(0.8, 4);
    expect(metrics.falsePositiveRate).toBeCloseTo(0.0222, 4);
  });

  it('reports null, not zero, for a metric whose denominator is zero', () => {
    // Nothing was flagged: precision is undefined, and reporting 0% would be a
    // false claim about the model rather than an absence of evidence.
    const nothingFlagged = deriveMetrics({
      truePositives: 0,
      falsePositives: 0,
      trueNegatives: 100,
      falseNegatives: 10,
    });
    expect(nothingFlagged.precision).toBeNull();
    expect(nothingFlagged.recall).toBe(0);

    const noActualPositives = deriveMetrics({
      truePositives: 0,
      falsePositives: 5,
      trueNegatives: 95,
      falseNegatives: 0,
    });
    expect(noActualPositives.recall).toBeNull();
    expect(noActualPositives.f1Score).toBeNull();
  });
});

describe('CSV export', () => {
  beforeEach(async () => {
    await ingestTransaction(
      {
        ...transactionPayload({ externalId: 'EXPORT-1', amount: 4321.5 }),
        occurredAt: new Date(),
      },
      { actorId: null, requestId: 't', source: INGESTION_SOURCE.API, emitEvents: false },
    );
  });

  it('returns a CSV attachment with a header row', async () => {
    const response = await analyst
      .get('/analytics/export?dataset=transactions')
      .expect(200)
      .expect('Content-Type', /text\/csv/);

    expect(response.headers['content-disposition']).toMatch(/attachment; filename="fraudlens-/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.text.split('\r\n')[0]).toContain('external_id');
    expect(response.text).toContain('EXPORT-1');
  });

  it('neutralises a formula planted in an account reference', async () => {
    // An account reference an attacker could influence, chosen to be a formula.
    await prisma.account.create({
      data: { accountRef: '=cmd@fraudlens', displayName: 'Formula Probe' },
    });
    const sender = await prisma.account.findUnique({ where: { accountRef: '=cmd@fraudlens' } });
    const receiver = await prisma.account.findFirst({ where: { accountRef: 'tester2@fraudlens' } });
    await prisma.transaction.create({
      data: {
        externalId: 'FORMULA-PROBE-1',
        senderId: sender.id,
        receiverId: receiver.id,
        amount: '100.00',
        occurredAt: new Date(),
        deviceFingerprint: 'dev-probe',
      },
    });

    const { csv } = await buildExport(
      { dataset: 'transactions', limit: 100 },
      { actorId: null, requestId: 'test' },
    );
    expect(csv).toContain("'=cmd@fraudlens");
    // No cell may begin with a bare formula character.
    for (const line of csv.trim().split('\r\n').slice(1)) {
      for (const cell of line.split(',')) {
        expect(cell.replace(/^"/, '')).not.toMatch(/^[=+@]/);
      }
    }
  });

  it('records the export in the audit log with its row count', async () => {
    await analyst.get('/analytics/export?dataset=alerts').expect(200);
    const entry = await prisma.auditLog.findFirst({ where: { action: 'analytics.exported' } });
    expect(entry.metadata.dataset).toBe('alerts');
    expect(typeof entry.metadata.rowCount).toBe('number');
  });

  it('requires audit:read for the audit-log dataset, beyond the export permission', async () => {
    const forbidden = await analyst.get('/analytics/export?dataset=audit-logs').expect(403);
    expect(forbidden.body.error.message).toMatch(/audit:read/);

    await admin.get('/analytics/export?dataset=audit-logs').expect(200);
  });

  it('hides the audit dataset from a caller who cannot read audit logs', async () => {
    const analystDatasets = await analyst.get('/analytics/export/datasets').expect(200);
    expect(analystDatasets.body.data.some((entry) => entry.dataset === 'audit-logs')).toBe(false);

    const adminDatasets = await admin.get('/analytics/export/datasets').expect(200);
    expect(adminDatasets.body.data.some((entry) => entry.dataset === 'audit-logs')).toBe(true);
  });

  it('rejects an unknown dataset', async () => {
    await analyst.get('/analytics/export?dataset=everything').expect(400);
  });

  it('refuses a viewer, who has no export permission', async () => {
    await viewer.get('/analytics/export?dataset=transactions').expect(403);
  });
});
