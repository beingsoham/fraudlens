import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PERMISSION } from '@fraudlens/shared/constants';
import { checkDatabaseConnection, getMigrationState, prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/http.js';
import { userHasPermission } from '../../middleware/authorize.js';
import { getSimulatorStatus } from '../simulator/simulator.service.js';
import { getSocketServer } from '../../realtime/events.js';

/**
 * Operational health.
 *
 * Two levels of detail, deliberately:
 *
 *  - **Anonymous** — overall status plus per-check pass/fail. Enough for a load
 *    balancer or container orchestrator to make a routing decision.
 *  - **Authenticated with `settings:read`** — latencies, migration names,
 *    counters and the simulator's state.
 *
 * Neither level ever exposes a credential, a connection string, a host name, a
 * file path or a stack trace. An unauthenticated health endpoint is a standard
 * reconnaissance target, so what it returns is decided by an allow-list rather
 * than by filtering a richer object.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** Reads the application version from the API's own package.json, once. */
const appVersion = (() => {
  try {
    const manifest = JSON.parse(readFileSync(path.resolve(here, '../../../package.json'), 'utf8'));
    return manifest.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

const startedAt = new Date();

export const health = asyncHandler(async (req, res) => {
  const detailed = userHasPermission(req.user, PERMISSION.SETTINGS_READ);

  // Database connectivity.
  let database = { ok: false };
  try {
    const result = await checkDatabaseConnection();
    database = { ok: true, latencyMs: result.latencyMs };
  } catch (error) {
    // The message would contain the host and database name, so only the fact
    // of the failure is reported.
    database = { ok: false, error: 'Database is unreachable' };
    req.log?.error({ err: error }, 'Health check: database unreachable');
  }

  const migrations = database.ok
    ? await getMigrationState()
    : { available: false, healthy: false, appliedCount: 0, pendingCount: 0, latestMigration: null };

  const simulator = getSimulatorStatus();
  const realtime = { ok: Boolean(getSocketServer()) };

  const checks = {
    api: { ok: true },
    database: { ok: database.ok },
    migrations: { ok: migrations.healthy },
    realtime,
    simulator: { ok: true, running: simulator.running },
  };

  // The simulator being stopped is a normal state, not a failure, so it is
  // reported but does not affect the overall verdict.
  const allOk = checks.api.ok && checks.database.ok && checks.migrations.ok && realtime.ok;
  const status = allOk ? 'ok' : checks.database.ok ? 'degraded' : 'unhealthy';

  const body = {
    status,
    version: appVersion,
    checks,
    timestamp: new Date().toISOString(),
  };

  if (detailed) {
    const [transactions, alerts, users] = database.ok
      ? await Promise.all([
          prisma.transaction.count(),
          prisma.alert.count(),
          prisma.user.count({ where: { isActive: true } }),
        ])
      : [null, null, null];

    body.detail = {
      nodeEnv: env.NODE_ENV,
      rulesetVersion: env.RULESET_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      startedAt: startedAt.toISOString(),
      database: {
        ok: database.ok,
        latencyMs: database.latencyMs ?? null,
        // The database name and host are deliberately omitted.
      },
      migrations: {
        available: migrations.available,
        healthy: migrations.healthy,
        appliedCount: migrations.appliedCount,
        pendingCount: migrations.pendingCount,
        rolledBackCount: migrations.rolledBackCount ?? 0,
        latestMigration: migrations.latestMigration,
      },
      simulator: {
        status: simulator.status,
        running: simulator.running,
        startedAt: simulator.startedAt,
        counters: simulator.counters,
        effectiveRatePerSecond: simulator.effectiveRatePerSecond,
      },
      counts: { transactions, alerts, activeUsers: users },
      process: {
        nodeVersion: process.version,
        // Resident set size only. No paths, no arguments, no environment.
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
    };
  }

  // 503 lets an orchestrator take the instance out of rotation.
  res.status(status === 'unhealthy' ? 503 : 200).json(body);
});

/** Minimal liveness probe: does the process respond at all? */
export const liveness = (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
};

/** Readiness probe: can the process actually serve traffic? */
export const readiness = asyncHandler(async (_req, res) => {
  try {
    await checkDatabaseConnection();
    const migrations = await getMigrationState();
    if (!migrations.healthy) {
      res.status(503).json({ status: 'not-ready', reason: 'Database migrations are not current' });
      return;
    }
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not-ready', reason: 'Database is unreachable' });
  }
});

export { appVersion };
