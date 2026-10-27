import { RULE_CATALOGUE, USER_ROLE } from '@fraudlens/shared/constants';
import { prisma } from '../../src/config/prisma.js';
import { env } from '../../src/config/env.js';
import { hashPassword } from '../../src/modules/auth/auth.service.js';
import { invalidateRulesetCache } from '../../src/modules/fraud/ruleset.service.js';

/**
 * Integration-test database helpers.
 *
 * The suite runs against a real PostgreSQL database so that constraints,
 * triggers, transactions and the LATERAL queries are all genuinely exercised —
 * a mocked client would test the mock, not the schema that actually enforces
 * the application's invariants.
 */

/**
 * Refuses to run unless the test database is configured and distinct from the
 * development one. Without this, a careless `npm test` would truncate real work.
 */
export function assertTestDatabase() {
  if (env.NODE_ENV !== 'test') {
    throw new Error('Integration tests must run with NODE_ENV=test');
  }
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests need their own database — see README.',
    );
  }
  if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL must differ from DATABASE_URL: the suite truncates every table it uses.',
    );
  }
}

/** Tables truncated between tests, ordered so CASCADE has nothing to chase. */
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

/** Empties every application table. */
export async function resetDatabase() {
  assertTestDatabase();
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  invalidateRulesetCache();
}

/** Installs the default ruleset and risk settings. */
export async function seedRuleset(overrides = {}) {
  await prisma.riskSettings.create({
    data: {
      singleton: true,
      mediumThreshold: overrides.mediumThreshold ?? 30,
      highThreshold: overrides.highThreshold ?? 70,
      alertThreshold: overrides.alertThreshold ?? 70,
      rulesetVersion: 'test-ruleset',
    },
  });

  for (const rule of RULE_CATALOGUE) {
    await prisma.fraudRule.create({
      data: {
        ruleId: rule.ruleId,
        name: rule.name,
        description: rule.description,
        enabled: true,
        weight: rule.weight,
        config: rule.config,
        rulesetVersion: 'test-ruleset',
      },
    });
  }
  invalidateRulesetCache();
}

export const TEST_PASSWORD = 'IntegrationTest1';

/** Creates one user per role and returns them keyed by role. */
export async function seedUsers() {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const definitions = [
    { name: 'Test Admin', email: 'admin@test.local', role: USER_ROLE.ADMIN },
    { name: 'Test Analyst', email: 'analyst@test.local', role: USER_ROLE.ANALYST },
    { name: 'Test Investigator', email: 'investigator@test.local', role: USER_ROLE.INVESTIGATOR },
    { name: 'Test Viewer', email: 'viewer@test.local', role: USER_ROLE.VIEWER },
  ];

  const users = {};
  for (const definition of definitions) {
    users[definition.role] = await prisma.user.create({
      data: { ...definition, passwordHash },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
  }
  return users;
}

/** Creates a pair of synthetic accounts. */
export async function seedAccounts(count = 4) {
  const accounts = [];
  for (let index = 0; index < count; index += 1) {
    accounts.push(
      await prisma.account.create({
        data: {
          accountRef: `tester${index}@fraudlens`,
          displayName: `Tester ${index}`,
          isMerchant: index === 0,
        },
      }),
    );
  }
  return accounts;
}

/** Full fixture: ruleset, users and accounts, in one call. */
export async function seedBaseline() {
  await resetDatabase();
  await seedRuleset();
  const users = await seedUsers();
  const accounts = await seedAccounts();
  return { users, accounts };
}

export { prisma, TABLES };
