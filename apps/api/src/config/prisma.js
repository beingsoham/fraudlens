import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/index.js';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Single PrismaClient for the process.
 *
 * Prisma 7 connects through a driver adapter, so the underlying `pg` pool is
 * configured here. One client (and therefore one pool) per process keeps the
 * connection count predictable under load.
 */
const adapter = new PrismaPg({
  connectionString: env.activeDatabaseUrl,
  max: env.isTest ? 5 : 20,
  // Fail fast rather than queueing forever when the database is unreachable.
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

export const prisma = new PrismaClient({
  adapter,
  log: env.isDevelopment
    ? [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ]
    : [{ emit: 'event', level: 'error' }],
});

prisma.$on('error', (event) => {
  logger.error({ prisma: event }, 'Prisma error');
});

if (env.isDevelopment) {
  prisma.$on('warn', (event) => {
    logger.warn({ prisma: event }, 'Prisma warning');
  });
}

/** Verifies the database is reachable. Used by the health endpoint and startup. */
export async function checkDatabaseConnection() {
  const startedAt = process.hrtime.bigint();
  await prisma.$queryRaw`SELECT 1`;
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  return { ok: true, latencyMs: Math.round(latencyMs * 100) / 100 };
}

/**
 * Reads the Prisma migration history table to report whether the database is
 * fully migrated. Returns `applied: null` when the table does not exist yet,
 * which means migrations have never been run against this database.
 */
export async function getMigrationState() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT "migration_name", "finished_at", "rolled_back_at"
      FROM "_prisma_migrations"
      ORDER BY "started_at" ASC
    `;
    const applied = rows.filter((row) => row.finished_at && !row.rolled_back_at);
    const pending = rows.filter((row) => !row.finished_at && !row.rolled_back_at);
    const rolledBack = rows.filter((row) => row.rolled_back_at);
    return {
      available: true,
      appliedCount: applied.length,
      pendingCount: pending.length,
      rolledBackCount: rolledBack.length,
      latestMigration: applied.at(-1)?.migration_name ?? null,
      healthy: pending.length === 0 && rolledBack.length === 0 && applied.length > 0,
    };
  } catch {
    // The migrations table is absent, so no migration has ever been applied.
    return {
      available: false,
      appliedCount: 0,
      pendingCount: 0,
      rolledBackCount: 0,
      latestMigration: null,
      healthy: false,
    };
  }
}

export async function disconnectPrisma() {
  await prisma.$disconnect();
}
