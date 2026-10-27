/**
 * Truncates every application table, leaving the Prisma migration history
 * intact. Local development helper: it gives a clean dataset without dropping
 * the database or re-running migrations.
 */
import { env } from '../apps/api/src/config/env.js';
import { prisma } from '../apps/api/src/config/prisma.js';

const TABLES = [
  'audit_logs',
  'investigation_notes',
  'alerts',
  'transaction_labels',
  'risk_assessments',
  'transactions',
  'accounts',
  'fraud_rules',
  'risk_settings',
  'users',
];

if (env.isProduction) {
  process.stderr.write('Refusing to truncate tables with NODE_ENV=production.\n');
  process.exit(1);
}

// RESTART IDENTITY is a no-op for UUID keys but keeps the statement correct if
// a serial column is ever added. CASCADE handles the foreign-key graph.
await prisma.$executeRawUnsafe(
  `TRUNCATE TABLE ${TABLES.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`,
);

process.stdout.write(`Truncated ${TABLES.length} tables in the application database.\n`);
await prisma.$disconnect();
