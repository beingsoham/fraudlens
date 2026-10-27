import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { TEST_PASSWORD } from './database.js';

/**
 * Supertest helpers.
 *
 * The app is mounted directly, without opening a port or starting Socket.IO, so
 * the HTTP layer is exercised end to end — routing, validation, authentication,
 * CSRF, authorization and error handling — against the real database.
 */

export const app = createApp();
export const API = '/api/v1';

/**
 * Signs in and returns an agent that carries the session cookie, plus the CSRF
 * token the API issued. Writes must send that token in `X-CSRF-Token`.
 */
export async function signIn(email, password = TEST_PASSWORD) {
  const agent = supertest.agent(app);
  const response = await agent.post(`${API}/auth/login`).send({ email, password }).expect(200);

  return {
    agent,
    csrfToken: response.body.data.csrfToken,
    accessToken: response.body.data.accessToken,
    user: response.body.data.user,
    /** Issues an authenticated write with the CSRF header attached. */
    write(method, path) {
      return agent[method](`${API}${path}`).set('X-CSRF-Token', response.body.data.csrfToken);
    },
    get(path) {
      return agent.get(`${API}${path}`);
    },
  };
}

/** A valid ingestion payload, with overridable fields. */
export function transactionPayload(overrides = {}) {
  return {
    externalId: `TEST-${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
    senderRef: 'tester1@fraudlens',
    receiverRef: 'tester2@fraudlens',
    amount: 1500,
    currency: 'INR',
    occurredAt: new Date().toISOString(),
    deviceFingerprint: 'dev-integration-001',
    channel: 'UPI_P2P',
    status: 'COMPLETED',
    ...overrides,
  };
}
