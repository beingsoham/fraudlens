import { createServer } from 'node:http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { checkDatabaseConnection, disconnectPrisma, getMigrationState } from './config/prisma.js';
import { createApp } from './app.js';
import { createSocketServer } from './realtime/socket.js';
import { clearSocketServer } from './realtime/events.js';
import { getActiveRuleset } from './modules/fraud/ruleset.service.js';
import { shutdownSimulator, startSimulator } from './modules/simulator/simulator.service.js';

/**
 * Process entry point.
 *
 * Startup verifies its dependencies before accepting traffic, and shutdown is
 * ordered so that no request or simulator tick is cut off mid-write:
 * stop accepting connections, stop the simulator, close sockets, then release
 * the database pool.
 */

const app = createApp();
const httpServer = createServer(app);
const io = createSocketServer(httpServer);

/**
 * Fails fast on a misconfigured or unmigrated database.
 *
 * Starting anyway would mean every request failing in a way that looks like an
 * application bug rather than a deployment one.
 */
async function verifyDependencies() {
  const { latencyMs } = await checkDatabaseConnection();
  logger.info({ latencyMs }, 'Database connection established');

  const migrations = await getMigrationState();
  if (!migrations.available) {
    throw new Error(
      'The database has no migration history. Run `npm run prisma:deploy` before starting the API.',
    );
  }
  if (migrations.pendingCount > 0) {
    throw new Error(
      `${migrations.pendingCount} database migration(s) are pending. Run \`npm run prisma:deploy\`.`,
    );
  }
  logger.info(
    { applied: migrations.appliedCount, latest: migrations.latestMigration },
    'Database migrations are current',
  );

  // Loading the ruleset at boot turns "the database was never seeded" into a
  // clear startup error rather than a confusing failure on the first ingestion.
  const ruleset = await getActiveRuleset({ fresh: true });
  logger.info(
    {
      rulesetVersion: ruleset.version,
      enabledRules: ruleset.enabledRuleIds.length,
      thresholds: ruleset.riskSettings,
    },
    'Fraud ruleset loaded',
  );
}

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  // Force-exit guard: if a connection refuses to close, the process must still
  // terminate rather than hang and be killed uncleanly by the orchestrator.
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  try {
    await new Promise((resolve) => httpServer.close(resolve));
    logger.info('HTTP server closed');

    await shutdownSimulator();

    await new Promise((resolve) => io.close(resolve));
    clearSocketServer();
    logger.info('Socket.IO server closed');

    await disconnectPrisma();
    logger.info('Database pool released');

    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Error during shutdown');
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  // An uncaught exception leaves the process in an undefined state, so the only
  // safe response is to log it and let the supervisor restart cleanly.
  logger.fatal({ err: error }, 'Uncaught exception; shutting down');
  void shutdown('uncaughtException');
});

async function main() {
  await verifyDependencies();

  await new Promise((resolve) => {
    httpServer.listen(env.PORT, resolve);
  });

  logger.info(
    { port: env.PORT, nodeEnv: env.NODE_ENV, origins: env.allowedOrigins },
    `FraudLens API listening on port ${env.PORT}`,
  );

  if (env.SIMULATOR_AUTOSTART && !env.isProduction) {
    try {
      await startSimulator({}, { actorId: null, requestId: 'startup-autostart' });
      logger.info('Simulator auto-started (SIMULATOR_AUTOSTART=true)');
    } catch (error) {
      logger.warn({ err: error }, 'Simulator auto-start failed');
    }
  }
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start the API');
  process.exit(1);
});

export { app, httpServer, io };
