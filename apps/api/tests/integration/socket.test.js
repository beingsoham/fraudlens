import { createServer } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io as createClient } from 'socket.io-client';
import { SOCKET_EVENT, SOCKET_ROOM } from '@fraudlens/shared/constants';
import { prisma, seedBaseline } from '../helpers/database.js';
import { signIn } from '../helpers/request.js';
import { createSocketServer } from '../../src/realtime/socket.js';
import {
  clearSocketServer,
  emitAlertUpdated,
  emitTransactionCreated,
} from '../../src/realtime/events.js';

/**
 * Socket.IO authentication and room-based authorization.
 *
 * The property under test is that subscription is decided by the server from
 * the user's permissions, so a client cannot request a room it should not be
 * in, and a VIEWER never receives investigator-only payload fields.
 */

let httpServer;
let io;
let port;
let sessions;
const clients = [];

/** Connects a client with an explicit token and resolves on connect or error. */
function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = createClient(`http://127.0.0.1:${port}`, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: token ? { token } : {},
      reconnection: false,
      timeout: 5000,
    });
    clients.push(socket);

    socket.on('connection:ready', (payload) => resolve({ socket, ready: payload }));
    socket.on('connect_error', (error) => reject(error));
    setTimeout(() => reject(new Error('socket connect timed out')), 6000);
  });
}

/** Resolves with the next payload for `event`, or null if none arrives. */
function nextEvent(socket, event, timeoutMs = 600) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

beforeAll(async () => {
  await seedBaseline();
  sessions = {
    admin: await signIn('admin@test.local'),
    analyst: await signIn('analyst@test.local'),
    investigator: await signIn('investigator@test.local'),
    viewer: await signIn('viewer@test.local'),
  };

  httpServer = createServer();
  io = createSocketServer(httpServer);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  port = httpServer.address().port;
});

afterEach(() => {
  for (const socket of clients.splice(0)) socket.disconnect();
});

afterAll(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await new Promise((resolve) => io.close(resolve));
  await new Promise((resolve) => httpServer.close(resolve));
  clearSocketServer();
  await prisma.$disconnect();
});

describe('socket authentication', () => {
  it('refuses a connection with no credentials', async () => {
    await expect(connect(null)).rejects.toThrow();
  });

  it('refuses a forged token', async () => {
    await expect(connect('not.a.valid.token')).rejects.toThrow();
  });

  it('accepts a valid session token and reports the rooms joined', async () => {
    const { ready } = await connect(sessions.admin.accessToken);
    expect(ready.role).toBe('ADMIN');
    expect(ready.rooms).toEqual(
      expect.arrayContaining([
        SOCKET_ROOM.TRANSACTIONS,
        SOCKET_ROOM.ALERTS,
        SOCKET_ROOM.INVESTIGATORS,
        SOCKET_ROOM.SIMULATOR,
      ]),
    );
  });

  it('refuses a token belonging to a deactivated account', async () => {
    const user = await prisma.user.findUnique({ where: { email: 'viewer@test.local' } });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await expect(connect(sessions.viewer.accessToken)).rejects.toThrow();
    await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
  });
});

describe('room-based authorization', () => {
  it('puts a VIEWER only in the rooms their permissions allow', async () => {
    const { ready } = await connect(sessions.viewer.accessToken);
    expect(ready.rooms).toContain(SOCKET_ROOM.TRANSACTIONS);
    expect(ready.rooms).toContain(SOCKET_ROOM.ALERTS);
    // A VIEWER cannot act on alerts or read the simulator.
    expect(ready.rooms).not.toContain(SOCKET_ROOM.INVESTIGATORS);
    expect(ready.rooms).not.toContain(SOCKET_ROOM.SIMULATOR);
  });

  it('puts an INVESTIGATOR in the investigator room', async () => {
    const { ready } = await connect(sessions.investigator.accessToken);
    expect(ready.rooms).toContain(SOCKET_ROOM.INVESTIGATORS);
  });

  it('ignores a client that tries to join a room itself', async () => {
    const { socket } = await connect(sessions.viewer.accessToken);
    // There is no join handler: subscription is server-decided, so emitting a
    // join request must have no effect.
    socket.emit('join', SOCKET_ROOM.INVESTIGATORS);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const received = nextEvent(socket, SOCKET_EVENT.ALERT_UPDATED, 400);
    emitAlertUpdated(
      { id: 'a1', transactionId: 't1', severity: 'HIGH', status: 'IN_REVIEW', outcome: 'PENDING' },
      { assignedToId: 'secret-user-id', assignedToName: 'Secret Investigator' },
    );
    const payload = await received;

    // The VIEWER is in the alerts room, so it gets exactly one base event...
    expect(payload).toBeTruthy();
    // ...but never the investigator-only fields.
    expect(payload.assignedToId).toBeUndefined();
    expect(payload.assignedToName).toBeUndefined();
    expect(payload.resolutionSummary).toBeUndefined();
  });

  it('delivers the investigator-only payload to the investigator room', async () => {
    const { socket } = await connect(sessions.investigator.accessToken);
    const received = nextEvent(socket, SOCKET_EVENT.ALERT_UPDATED, 800);

    emitAlertUpdated(
      {
        id: 'a2',
        transactionId: 't2',
        severity: 'HIGH',
        status: 'RESOLVED',
        outcome: 'CONFIRMED_FRAUD',
        resolutionSummary: 'Confirmed.',
      },
      { assignedToId: 'user-1', assignedToName: 'Ira Investigator' },
    );

    const payload = await received;
    expect(payload).toBeTruthy();
    expect(payload.assignedToName).toBe('Ira Investigator');
    expect(payload.resolutionSummary).toBe('Confirmed.');
  });

  it('delivers exactly one alert:updated to an investigator, not two', async () => {
    const { socket } = await connect(sessions.investigator.accessToken);
    const received = [];
    socket.on(SOCKET_EVENT.ALERT_UPDATED, (payload) => received.push(payload));

    emitAlertUpdated(
      { id: 'a3', transactionId: 't3', severity: 'LOW', status: 'OPEN', outcome: 'PENDING' },
      { assignedToId: 'user-1', assignedToName: 'Ira Investigator' },
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    // An investigator is in both the alerts and investigator rooms; the
    // emitter excludes them from the redacted broadcast so they get one event.
    expect(received).toHaveLength(1);
    expect(received[0].assignedToName).toBe('Ira Investigator');
  });

  it('delivers transaction events to anyone who may read transactions', async () => {
    const { socket } = await connect(sessions.viewer.accessToken);
    const received = nextEvent(socket, SOCKET_EVENT.TRANSACTION_CREATED, 800);

    emitTransactionCreated(
      {
        id: 'tx-1',
        externalId: 'EVENT-TX-1',
        senderRef: 'a@fraudlens',
        receiverRef: 'b@fraudlens',
        amount: 100,
        currency: 'INR',
        occurredAt: new Date(),
        channel: 'UPI_P2P',
        status: 'COMPLETED',
        isNewDevice: false,
      },
      { riskScore: 12, riskCategory: 'LOW' },
    );

    const payload = await received;
    expect(payload.externalId).toBe('EVENT-TX-1');
    expect(payload.riskScore).toBe(12);
    // The device fingerprint is not part of the broadcast payload.
    expect(payload.deviceFingerprint).toBeUndefined();
  });

  it('answers a resync request so a reconnected client can refetch', async () => {
    const { socket } = await connect(sessions.analyst.accessToken);
    const received = nextEvent(socket, 'server:resync', 800);
    socket.emit('client:resync');
    const payload = await received;
    expect(payload.serverTime).toBeTruthy();
    expect(Array.isArray(payload.rooms)).toBe(true);
  });
});
