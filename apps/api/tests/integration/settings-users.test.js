import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seedBaseline } from '../helpers/database.js';
import { signIn, transactionPayload } from '../helpers/request.js';
import {
  INGESTION_SOURCE,
  ingestTransaction,
} from '../../src/modules/transactions/ingestion.service.js';
import { getActiveRuleset } from '../../src/modules/fraud/ruleset.service.js';

/** Detection settings and user administration. */

let admin;
let analyst;
let users;

beforeEach(async () => {
  ({ users } = await seedBaseline());
  admin = await signIn('admin@test.local');
  analyst = await signIn('analyst@test.local');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /settings/rules', () => {
  it('returns every catalogue rule with its config and defaults', async () => {
    const response = await admin.get('/settings/rules').expect(200);
    expect(response.body.data.rules).toHaveLength(8);
    const rule = response.body.data.rules.find((entry) => entry.ruleId === 'HIGH_AMOUNT');
    expect(rule.enabled).toBe(true);
    expect(rule.weight).toBe(20);
    expect(rule.config.thresholdAmount).toBe(50_000);
    expect(rule.defaultConfig.thresholdAmount).toBe(50_000);
  });

  it('reports which rules share a correlation group', async () => {
    const response = await admin.get('/settings/rules').expect(200);
    const amountRules = response.body.data.rules.filter(
      (entry) => entry.correlationGroup === 'amount',
    );
    expect(amountRules.map((entry) => entry.ruleId).sort()).toEqual([
      'HIGH_AMOUNT',
      'HISTORICAL_AMOUNT_ANOMALY',
    ]);
  });
});

describe('PATCH /settings/rules/:ruleId', () => {
  it('disables a rule and takes effect on the next assessment', async () => {
    const before = await ingestTransaction(
      {
        ...transactionPayload({ externalId: 'RULE-BEFORE', amount: 500_000 }),
        occurredAt: new Date(),
      },
      { actorId: null, requestId: 't', source: INGESTION_SOURCE.API, emitEvents: false },
    );
    expect(before.assessment.triggeredRuleIds).toContain('HIGH_AMOUNT');

    await admin.write('patch', '/settings/rules/HIGH_AMOUNT').send({ enabled: false }).expect(200);

    const after = await ingestTransaction(
      {
        ...transactionPayload({ externalId: 'RULE-AFTER', amount: 500_000 }),
        occurredAt: new Date(),
      },
      { actorId: null, requestId: 't', source: INGESTION_SOURCE.API, emitEvents: false },
    );
    // The cache was invalidated by the write, so the change applies at once.
    expect(after.assessment.triggeredRuleIds).not.toContain('HIGH_AMOUNT');
  });

  it('merges a partial config change over the stored one', async () => {
    await admin
      .write('patch', '/settings/rules/HIGH_AMOUNT')
      .send({ config: { thresholdAmount: 10_000 } })
      .expect(200);

    const ruleset = await getActiveRuleset({ fresh: true });
    expect(ruleset.rules.HIGH_AMOUNT.config.thresholdAmount).toBe(10_000);
    // The untouched key keeps its previous value rather than being dropped.
    expect(ruleset.rules.HIGH_AMOUNT.config.saturationAmount).toBe(200_000);
  });

  it('rejects a config whose thresholds are the wrong way round', async () => {
    const response = await admin
      .write('patch', '/settings/rules/HIGH_AMOUNT')
      .send({ config: { thresholdAmount: 500_000 } })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].field).toMatch(/thresholdAmount/);
  });

  it('rejects an unknown config key', async () => {
    await admin
      .write('patch', '/settings/rules/HIGH_AMOUNT')
      .send({ config: { madeUpSetting: 1 } })
      .expect(400);
  });

  it('rejects a weight outside 0..100', async () => {
    await admin.write('patch', '/settings/rules/HIGH_AMOUNT').send({ weight: 500 }).expect(400);
    await admin.write('patch', '/settings/rules/HIGH_AMOUNT').send({ weight: -1 }).expect(400);
  });

  it('rejects an unknown rule id', async () => {
    await admin.write('patch', '/settings/rules/NOT_A_RULE').send({ enabled: false }).expect(400);
  });

  it('records the change in the audit log without the config values', async () => {
    await admin
      .write('patch', '/settings/rules/HIGH_AMOUNT')
      .send({ enabled: false, weight: 25, config: { thresholdAmount: 20_000 } })
      .expect(200);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'rule.updated', entityId: 'HIGH_AMOUNT' },
    });
    expect(entry.metadata.enabled).toBe(false);
    expect(entry.metadata.previousEnabled).toBe(true);
    expect(entry.metadata.weight).toBe(25);
    expect(entry.metadata.configKeys).toEqual(['thresholdAmount']);
  });

  it('refuses a non-administrator', async () => {
    await analyst
      .write('patch', '/settings/rules/HIGH_AMOUNT')
      .send({ enabled: false })
      .expect(403);
  });
});

describe('PATCH /settings/risk', () => {
  it('updates the thresholds and reports that the change is not retroactive', async () => {
    const response = await admin
      .write('patch', '/settings/risk')
      .send({ mediumThreshold: 20, highThreshold: 50, alertThreshold: 50 })
      .expect(200);
    expect(response.body.data.highThreshold).toBe(50);
    expect(response.body.data.note).toMatch(/not recategorised/i);
  });

  it('validates a single-field change against the stored values', async () => {
    // A medium threshold above the stored high threshold must be rejected.
    const response = await admin
      .write('patch', '/settings/risk')
      .send({ mediumThreshold: 90 })
      .expect(400);
    expect(response.body.error.details[0].field).toMatch(/mediumThreshold/);
  });

  it('rejects an alert threshold below the medium threshold', async () => {
    await admin.write('patch', '/settings/risk').send({ alertThreshold: 5 }).expect(400);
  });

  it('leaves existing assessments untouched when thresholds change', async () => {
    const result = await ingestTransaction(
      { ...transactionPayload({ externalId: 'RETRO-1', amount: 60_000 }), occurredAt: new Date() },
      { actorId: null, requestId: 't', source: INGESTION_SOURCE.API, emitEvents: false },
    );
    const before = await prisma.riskAssessment.findFirst({
      where: { transactionId: result.transaction.id },
    });

    await admin
      .write('patch', '/settings/risk')
      .send({ mediumThreshold: 1, highThreshold: 2, alertThreshold: 2 })
      .expect(200);

    const after = await prisma.riskAssessment.findUnique({ where: { id: before.id } });
    // Assessments are immutable historical records.
    expect(after.riskCategory).toBe(before.riskCategory);
    expect(after.riskScore).toBe(before.riskScore);
  });

  it('is rejected by the database if the API were bypassed', async () => {
    await expect(
      prisma.$executeRaw`UPDATE "risk_settings" SET "medium_threshold" = 90, "high_threshold" = 10`,
    ).rejects.toThrow();
  });
});

describe('user administration', () => {
  it('creates a user without ever echoing the password', async () => {
    const response = await admin
      .write('post', '/users')
      .send({
        name: 'New Analyst',
        email: 'new.analyst@test.local',
        password: 'ValidPassw0rdHere',
        role: 'ANALYST',
      })
      .expect(201);

    expect(response.body.data.email).toBe('new.analyst@test.local');
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('ValidPassw0rdHere');
    expect(body).not.toContain('passwordHash');
  });

  it('enforces the password policy', async () => {
    for (const password of ['short', 'alllowercase123', 'ALLUPPERCASE123', 'NoDigitsAtAllHere']) {
      const response = await admin
        .write('post', '/users')
        .send({ name: 'Test', email: `p${Math.random()}@test.local`, password, role: 'VIEWER' })
        .expect(400);
      expect(response.body.error.details.some((issue) => issue.field === 'password')).toBe(true);
    }
  });

  it('rejects a duplicate email address', async () => {
    const response = await admin
      .write('post', '/users')
      .send({
        name: 'Clash',
        email: 'admin@test.local',
        password: 'ValidPassw0rdHere',
        role: 'VIEWER',
      })
      .expect(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('never returns a password hash from any user endpoint', async () => {
    const list = await admin.get('/users').expect(200);
    const detail = await admin.get(`/users/${users.VIEWER.id}`).expect(200);
    expect(JSON.stringify(list.body)).not.toContain('passwordHash');
    expect(JSON.stringify(detail.body)).not.toContain('passwordHash');
    expect(JSON.stringify(detail.body)).not.toContain('$2b$');
  });

  it('refuses to let an administrator change their own role', async () => {
    const response = await admin
      .write('patch', `/users/${admin.user.id}`)
      .send({ role: 'VIEWER' })
      .expect(422);
    expect(response.body.error.message).toMatch(/your own role/i);
  });

  it('refuses to let an administrator deactivate themselves', async () => {
    const response = await admin
      .write('patch', `/users/${admin.user.id}`)
      .send({ isActive: false })
      .expect(422);
    expect(response.body.error.message).toMatch(/your own account/i);
  });

  it('allows demoting an administrator while another one remains', async () => {
    await admin.write('patch', `/users/${users.ANALYST.id}`).send({ role: 'ADMIN' }).expect(200);
    const secondAdmin = await signIn('analyst@test.local');
    // Two administrators exist, so demoting one leaves the installation
    // manageable and the guard does not fire.
    await secondAdmin
      .write('patch', `/users/${users.ADMIN.id}`)
      .send({ role: 'VIEWER' })
      .expect(200);

    const remaining = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
    expect(remaining).toBe(1);
  });

  it('refuses to remove the last active administrator', async () => {
    // Over HTTP this path is unreachable: an administrator can only be the
    // last one when they are also the actor, and the self-guard rejects that
    // first. The last-admin check is defence in depth for exactly that case —
    // a future caller, or a misconfigured route — so it is exercised at the
    // service level, where such a caller would enter.
    const { updateUser } = await import('../../src/modules/users/users.service.js');
    const context = { actorId: users.ANALYST.id, requestId: 'test' };

    await expect(updateUser(users.ADMIN.id, { role: 'VIEWER' }, context)).rejects.toThrow(
      /last active administrator/i,
    );

    await expect(updateUser(users.ADMIN.id, { isActive: false }, context)).rejects.toThrow(
      /last active administrator/i,
    );

    // The account is untouched by the refused attempts.
    const unchanged = await prisma.user.findUnique({ where: { id: users.ADMIN.id } });
    expect(unchanged.role).toBe('ADMIN');
    expect(unchanged.isActive).toBe(true);
  });

  it('writes a dedicated audit event for a role change', async () => {
    await admin.write('patch', `/users/${users.VIEWER.id}`).send({ role: 'ANALYST' }).expect(200);
    const entry = await prisma.auditLog.findFirst({
      where: { action: 'user.role_changed', entityId: users.VIEWER.id },
    });
    expect(entry.metadata.role).toBe('ANALYST');
    expect(entry.metadata.previousRole).toBe('VIEWER');
  });

  it('writes a password-reset audit event with no password detail', async () => {
    await admin
      .write('patch', `/users/${users.VIEWER.id}`)
      .send({ password: 'ANewValidPassw0rd' })
      .expect(200);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'user.password_reset', entityId: users.VIEWER.id },
    });
    expect(entry).toBeTruthy();
    expect(JSON.stringify(entry.metadata)).not.toContain('ANewValidPassw0rd');
  });

  it('lets a user sign in with a reset password, and not the old one', async () => {
    await admin
      .write('patch', `/users/${users.VIEWER.id}`)
      .send({ password: 'ANewValidPassw0rd' })
      .expect(200);

    await expect(signIn('viewer@test.local', 'IntegrationTest1')).rejects.toThrow();
    const session = await signIn('viewer@test.local', 'ANewValidPassw0rd');
    expect(session.user.email).toBe('viewer@test.local');
  });

  it('refuses a non-administrator', async () => {
    await analyst.get('/users').expect(403);
    await analyst
      .write('post', '/users')
      .send({ name: 'X', email: 'x@test.local', password: 'ValidPassw0rdHere', role: 'VIEWER' })
      .expect(403);
  });
});

describe('audit log', () => {
  it('refuses an UPDATE or DELETE at the database level', async () => {
    await admin.write('patch', '/settings/rules/HIGH_AMOUNT').send({ enabled: false }).expect(200);
    const entry = await prisma.auditLog.findFirst();

    await expect(
      prisma.$executeRaw`UPDATE "audit_logs" SET "action" = 'tampered' WHERE "id" = ${entry.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "id" = ${entry.id}::uuid`,
    ).rejects.toThrow();
  });

  it('exposes no write route', async () => {
    await admin.write('post', '/audit-logs').send({ action: 'forged' }).expect(404);
    await admin.write('delete', '/audit-logs').expect(404);
  });

  it('filters by action, entity and actor', async () => {
    await admin.write('patch', '/settings/rules/HIGH_AMOUNT').send({ enabled: false }).expect(200);

    const byAction = await admin.get('/audit-logs?action=rule.updated').expect(200);
    expect(byAction.body.data.length).toBeGreaterThan(0);
    expect(byAction.body.data.every((entry) => entry.action === 'rule.updated')).toBe(true);

    const byActor = await admin.get(`/audit-logs?actorId=${admin.user.id}`).expect(200);
    expect(byActor.body.data.every((entry) => entry.actor?.id === admin.user.id)).toBe(true);
  });

  it('ties an audit event to the request that produced it', async () => {
    const response = await admin
      .write('patch', '/settings/rules/HIGH_AMOUNT')
      .send({ enabled: false })
      .expect(200);
    const requestId = response.headers['x-request-id'];
    expect(requestId).toBeTruthy();

    const entry = await prisma.auditLog.findFirst({ where: { requestId } });
    expect(entry).toBeTruthy();
  });
});
