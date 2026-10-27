import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seedBaseline, TEST_PASSWORD } from '../helpers/database.js';
import { API, app, signIn } from '../helpers/request.js';
import supertest from 'supertest';

/**
 * Authentication, CSRF and role-based authorization, against the real
 * database and the real middleware chain.
 */

let users;

beforeAll(async () => {
  ({ users } = await seedBaseline());
});

beforeEach(async () => {
  // Reinstate any account a test deactivated.
  await prisma.user.updateMany({ data: { isActive: true } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /auth/login', () => {
  it('signs in a valid user and sets both cookies', async () => {
    const response = await supertest(app)
      .post(`${API}/auth/login`)
      .send({ email: 'admin@test.local', password: TEST_PASSWORD })
      .expect(200);

    expect(response.body.data.user.email).toBe('admin@test.local');
    expect(response.body.data.user.role).toBe('ADMIN');
    expect(response.body.data.csrfToken).toBeTruthy();

    const cookies = response.headers['set-cookie'].join(';');
    expect(cookies).toContain('fraudlens_session=');
    expect(cookies).toContain('fraudlens_csrf=');
    // The session cookie must be httpOnly; the CSRF cookie must not be.
    const sessionCookie = response.headers['set-cookie'].find((c) =>
      c.startsWith('fraudlens_session='),
    );
    expect(sessionCookie).toContain('HttpOnly');
    const csrfCookie = response.headers['set-cookie'].find((c) => c.startsWith('fraudlens_csrf='));
    expect(csrfCookie).not.toContain('HttpOnly');
  });

  it('never returns the password hash', async () => {
    const response = await supertest(app)
      .post(`${API}/auth/login`)
      .send({ email: 'admin@test.local', password: TEST_PASSWORD })
      .expect(200);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('$2b$');
  });

  it('rejects a wrong password', async () => {
    const response = await supertest(app)
      .post(`${API}/auth/login`)
      .send({ email: 'admin@test.local', password: 'WrongPassword123' })
      .expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('gives the same message for an unknown address as for a wrong password', async () => {
    const unknown = await supertest(app)
      .post(`${API}/auth/login`)
      .send({ email: 'nobody@test.local', password: TEST_PASSWORD })
      .expect(401);
    const wrong = await supertest(app)
      .post(`${API}/auth/login`)
      .send({ email: 'admin@test.local', password: 'WrongPassword123' })
      .expect(401);
    // Identical wording, so the response does not disclose which addresses exist.
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('records a failed attempt in the audit log without the password', async () => {
    await supertest(app)
      .post(`${API}/auth/login`)
      .send({ email: 'admin@test.local', password: 'WrongPassword123' })
      .expect(401);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'user.login_failed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).toBeTruthy();
    expect(entry.metadata.email).toBe('admin@test.local');
    expect(JSON.stringify(entry.metadata)).not.toContain('WrongPassword123');
  });

  it('rejects a malformed payload with field-level detail', async () => {
    const response = await supertest(app)
      .post(`${API}/auth/login`)
      .send({ email: 'not-an-email' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.some((issue) => issue.field === 'email')).toBe(true);
  });

  it('refuses a deactivated account', async () => {
    await prisma.user.update({ where: { id: users.VIEWER.id }, data: { isActive: false } });
    const response = await supertest(app)
      .post(`${API}/auth/login`)
      .send({ email: 'viewer@test.local', password: TEST_PASSWORD })
      .expect(401);
    expect(response.body.error.message).toMatch(/deactivated/i);
  });
});

describe('GET /auth/me', () => {
  it('restores a session from the cookie', async () => {
    const session = await signIn('analyst@test.local');
    const response = await session.get('/auth/me').expect(200);
    expect(response.body.data.user.email).toBe('analyst@test.local');
    expect(response.body.data.csrfToken).toBeTruthy();
  });

  it('rejects an anonymous request', async () => {
    await supertest(app).get(`${API}/auth/me`).expect(401);
  });

  it('rejects a forged token', async () => {
    await supertest(app)
      .get(`${API}/auth/me`)
      .set('Authorization', 'Bearer not.a.real.token')
      .expect(401);
  });

  it('stops working the moment the account is deactivated', async () => {
    const session = await signIn('viewer@test.local');
    await session.get('/auth/me').expect(200);

    // The token is still cryptographically valid, but the per-request lookup
    // sees the account is disabled.
    await prisma.user.update({ where: { id: users.VIEWER.id }, data: { isActive: false } });
    const response = await session.get('/auth/me').expect(401);
    expect(response.body.error.message).toMatch(/deactivated/i);
  });

  it('reflects a role change immediately, without re-issuing the token', async () => {
    const session = await signIn('viewer@test.local');
    await prisma.user.update({ where: { id: users.VIEWER.id }, data: { role: 'ANALYST' } });
    const response = await session.get('/auth/me').expect(200);
    expect(response.body.data.user.role).toBe('ANALYST');
    await prisma.user.update({ where: { id: users.VIEWER.id }, data: { role: 'VIEWER' } });
  });
});

describe('CSRF protection', () => {
  it('rejects a cookie-authenticated write with no CSRF header', async () => {
    const session = await signIn('analyst@test.local');
    const response = await session.agent
      .post(`${API}/transactions/ingest`)
      .send({ externalId: 'CSRFTEST1', senderRef: 'a@b', receiverRef: 'c@d', amount: 1 })
      .expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toMatch(/CSRF/i);
  });

  it('rejects a write carrying the wrong CSRF token', async () => {
    const session = await signIn('analyst@test.local');
    await session.agent
      .post(`${API}/transactions/ingest`)
      .set('X-CSRF-Token', 'a-token-of-the-wrong-value-entirely')
      .send({ externalId: 'CSRFTEST2' })
      .expect(403);
  });

  it('rejects a CSRF token minted for a different session', async () => {
    const first = await signIn('analyst@test.local');
    const second = await signIn('admin@test.local');
    // The token is bound to its own session's id, so it cannot be replayed.
    await first.agent
      .post(`${API}/transactions/ingest`)
      .set('X-CSRF-Token', second.csrfToken)
      .send({ externalId: 'CSRFTEST3' })
      .expect(403);
  });

  it('does not require a CSRF token for a bearer-authenticated client', async () => {
    const session = await signIn('analyst@test.local');
    // A bearer token is never attached automatically by a browser, so a
    // cross-site request cannot carry one and CSRF does not apply.
    const response = await supertest(app)
      .post(`${API}/transactions/ingest`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ externalId: 'BEARERTEST1', senderRef: 'bad' })
      .expect(400);
    // 400, not 403: it got past CSRF and was rejected by validation instead.
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not require a CSRF token for a safe method', async () => {
    const session = await signIn('viewer@test.local');
    await session.agent.get(`${API}/transactions`).expect(200);
  });
});

describe('role-based authorization', () => {
  const cases = [
    [
      'VIEWER',
      'viewer@test.local',
      [
        ['get', '/transactions', 200],
        ['get', '/alerts', 200],
        ['get', '/users', 403],
        ['get', '/audit-logs', 403],
        ['get', '/settings/rules', 403],
        ['get', '/simulator/status', 403],
      ],
    ],
    [
      'INVESTIGATOR',
      'investigator@test.local',
      [
        ['get', '/alerts', 200],
        ['get', '/settings/rules', 200],
        ['get', '/users', 403],
        ['get', '/audit-logs', 403],
      ],
    ],
    [
      'ANALYST',
      'analyst@test.local',
      [
        ['get', '/simulator/status', 200],
        ['get', '/settings/rules', 200],
        ['get', '/users', 403],
      ],
    ],
    [
      'ADMIN',
      'admin@test.local',
      [
        ['get', '/users', 200],
        ['get', '/audit-logs', 200],
        ['get', '/settings/rules', 200],
        ['get', '/simulator/status', 200],
      ],
    ],
  ];

  for (const [role, email, expectations] of cases) {
    it(`enforces the ${role} permission set`, async () => {
      const session = await signIn(email);
      for (const [method, path, status] of expectations) {
        const response = await session.agent[method](`${API}${path}`);
        expect(
          response.status,
          `${role} ${method.toUpperCase()} ${path} expected ${status}, got ${response.status}`,
        ).toBe(status);
      }
    });
  }

  it('refuses a VIEWER attempting to ingest a transaction', async () => {
    const session = await signIn('viewer@test.local');
    const response = await session
      .write('post', '/transactions/ingest')
      .send({ externalId: 'VIEWERBLOCK1' })
      .expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses an INVESTIGATOR attempting to change a detection rule', async () => {
    const session = await signIn('investigator@test.local');
    await session
      .write('patch', '/settings/rules/HIGH_AMOUNT')
      .send({ enabled: false })
      .expect(403);
  });
});

describe('POST /auth/logout', () => {
  it('clears the session cookies', async () => {
    const session = await signIn('admin@test.local');
    const response = await session.write('post', '/auth/logout').expect(200);
    const cookies = (response.headers['set-cookie'] ?? []).join(';');
    expect(cookies).toContain('fraudlens_session=;');
  });

  it('tolerates a request with no session, so a stale tab can still clear', async () => {
    await supertest(app).post(`${API}/auth/logout`).expect(200);
  });
});
