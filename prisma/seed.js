/**
 * Database seed.
 *
 * Creates the fraud ruleset, the risk settings singleton, local development
 * accounts, and — when `SEED_DEMO_DATA` is true — a synthetic transaction
 * history so the dashboards have real data to display on a fresh checkout.
 *
 * The synthetic history is pushed through the *actual* ingestion pipeline:
 * every risk score, explanation and alert in a seeded database was produced by
 * the real fraud engine, not written in by this script. That is slower than a
 * bulk insert, and deliberately so — it means a seeded database is a faithful
 * sample of how the application behaves rather than a decorative fixture.
 *
 * Idempotent: running it twice updates the ruleset and users in place and skips
 * transaction generation if the database already holds transactions.
 */

import { env } from '../apps/api/src/config/env.js';
import { prisma } from '../apps/api/src/config/prisma.js';
import { hashPassword } from '../apps/api/src/modules/auth/auth.service.js';
import {
  ingestTransaction,
  INGESTION_SOURCE,
} from '../apps/api/src/modules/transactions/ingestion.service.js';
import { invalidateRulesetCache } from '../apps/api/src/modules/fraud/ruleset.service.js';
import {
  buildAccountRoster,
  createTransactionGenerator,
  DEFAULT_SCENARIO_DISTRIBUTION,
} from '../apps/api/src/modules/simulator/generator.js';
import { RULE_CATALOGUE, USER_ROLE } from '@fraudlens/shared/constants';
import { MS_PER_DAY } from '../apps/api/src/utils/time.js';

const log = (message, extra = '') => process.stdout.write(`  ${message}${extra}\n`);

/** Upserts the risk-category boundaries and the alert threshold. */
async function seedRiskSettings() {
  const existing = await prisma.riskSettings.findFirst({ where: { singleton: true } });
  const data = {
    mediumThreshold: env.RISK_MEDIUM_THRESHOLD,
    highThreshold: env.RISK_HIGH_THRESHOLD,
    alertThreshold: env.ALERT_THRESHOLD,
    rulesetVersion: env.RULESET_VERSION,
  };

  if (existing) {
    // Preserve any thresholds an operator has tuned; only refresh the version.
    await prisma.riskSettings.update({
      where: { id: existing.id },
      data: { rulesetVersion: env.RULESET_VERSION },
    });
    log('risk settings: kept existing thresholds, refreshed ruleset version');
    return;
  }

  await prisma.riskSettings.create({ data: { singleton: true, ...data } });
  log(
    'risk settings: created ',
    `medium>=${data.mediumThreshold}, high>=${data.highThreshold}, alert>=${data.alertThreshold}`,
  );
}

/**
 * Upserts the rule catalogue.
 *
 * An operator's `enabled` flag, weight and config are preserved on re-seed: the
 * seed must not silently undo tuning. Only the name, description and ruleset
 * version — which are code-owned — are refreshed.
 */
async function seedFraudRules() {
  let created = 0;
  let refreshed = 0;

  for (const rule of RULE_CATALOGUE) {
    const existing = await prisma.fraudRule.findUnique({ where: { ruleId: rule.ruleId } });
    if (existing) {
      await prisma.fraudRule.update({
        where: { ruleId: rule.ruleId },
        data: {
          name: rule.name,
          description: rule.description,
          rulesetVersion: env.RULESET_VERSION,
        },
      });
      refreshed += 1;
    } else {
      await prisma.fraudRule.create({
        data: {
          ruleId: rule.ruleId,
          name: rule.name,
          description: rule.description,
          enabled: true,
          weight: rule.weight,
          config: rule.config,
          rulesetVersion: env.RULESET_VERSION,
        },
      });
      created += 1;
    }
  }

  invalidateRulesetCache();
  log('fraud rules: ', `${created} created, ${refreshed} refreshed`);
}

/** Creates the four local development accounts, one per role. */
async function seedUsers() {
  const definitions = [
    {
      name: 'Avery Admin',
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
      role: USER_ROLE.ADMIN,
    },
    {
      name: 'Alex Analyst',
      email: env.SEED_ANALYST_EMAIL,
      password: env.SEED_ANALYST_PASSWORD,
      role: USER_ROLE.ANALYST,
    },
    {
      name: 'Ira Investigator',
      email: env.SEED_INVESTIGATOR_EMAIL,
      password: env.SEED_INVESTIGATOR_PASSWORD,
      role: USER_ROLE.INVESTIGATOR,
    },
    {
      name: 'Vee Viewer',
      email: env.SEED_VIEWER_EMAIL,
      password: env.SEED_VIEWER_PASSWORD,
      role: USER_ROLE.VIEWER,
    },
  ];

  const users = [];
  for (const definition of definitions) {
    const email = definition.email.toLowerCase();
    const passwordHash = await hashPassword(definition.password);
    const user = await prisma.user.upsert({
      where: { email },
      // Resetting the password on re-seed keeps the documented development
      // credentials working even after someone changes one locally.
      update: { name: definition.name, role: definition.role, isActive: true, passwordHash },
      create: { name: definition.name, email, role: definition.role, passwordHash },
      select: { id: true, email: true, role: true },
    });
    users.push(user);
  }

  log('users: ', users.map((user) => `${user.email} (${user.role})`).join(', '));
  return users;
}

/** Creates the synthetic account roster, marking merchants. */
async function seedAccounts(roster) {
  for (const account of roster) {
    await prisma.account.upsert({
      where: { accountRef: account.accountRef },
      update: { displayName: account.displayName, isMerchant: account.isMerchant },
      create: {
        accountRef: account.accountRef,
        displayName: account.displayName,
        isMerchant: account.isMerchant,
      },
    });
  }
  log('accounts: ', `${roster.length} synthetic accounts`);
}

/**
 * Generates a synthetic transaction history through the real ingestion
 * pipeline, spread backwards over `historyDays` so that the time-series charts,
 * velocity features and baseline comparisons all have something to work with.
 */
async function seedTransactions(roster, { count, historyDays = 30 }) {
  const existing = await prisma.transaction.count();
  if (existing > 0) {
    log('transactions: ', `${existing} already present, skipping generation`);
    return { ingested: 0, alerts: 0 };
  }

  const generator = createTransactionGenerator({
    seed: env.SEED_RANDOM_SEED,
    accounts: roster,
    scenarioDistribution: DEFAULT_SCENARIO_DISTRIBUTION,
  });

  const now = Date.now();
  const startMs = now - historyDays * MS_PER_DAY;
  // Leave a small gap before "now" so freshly simulated transactions are
  // clearly the newest rows.
  const spanMs = now - startMs - 60_000;

  let ingested = 0;
  let alerts = 0;
  let failures = 0;
  const startedAt = Date.now();

  for (let index = 0; index < count; index += 1) {
    // Walk forward in time so each transaction's historical features see only
    // the transactions that genuinely preceded it.
    const baseTime = new Date(startMs + Math.floor((spanMs * index) / count));
    const { input, scenarioLabel } = generator.next(baseTime);

    try {
      const result = await ingestTransaction(
        { ...input, scenarioLabel },
        {
          actorId: null,
          requestId: `seed-${index}`,
          source: INGESTION_SOURCE.SEED,
          // No sockets are listening during a seed run.
          emitEvents: false,
        },
      );
      ingested += 1;
      if (result.alert) alerts += 1;
    } catch (error) {
      failures += 1;
      if (failures <= 3) {
        process.stderr.write(`    ingestion failed: ${error.message}\n`);
      }
    }

    if ((index + 1) % 100 === 0) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      log('transactions: ', `${index + 1}/${count} (${elapsed}s, ${alerts} alerts)`);
    }
  }

  log(
    'transactions: ',
    `${ingested} ingested, ${alerts} alerts raised, ${failures} failures, ${(
      (Date.now() - startedAt) /
      1000
    ).toFixed(1)}s`,
  );

  // Background activity alone produces mostly single-indicator anomalies, which
  // score LOW or MEDIUM. Two pronounced incidents give the alert queue, the
  // investigation workflow and the relationship graph something real to show.
  const incidentAlerts = await seedIncidents(generator, { now, historyDays });
  return { ingested, alerts: alerts + incidentAlerts };
}

/**
 * Injects a small number of pronounced mule-collection incidents, scored by the
 * unmodified engine like any other transaction.
 */
async function seedIncidents(generator, { now, historyDays, count = 2 }) {
  let ingested = 0;
  let alerts = 0;
  let failures = 0;

  for (let incident = 0; incident < count; incident += 1) {
    // Place the incidents a few days apart within the recent history, so the
    // time-series charts show them as distinct spikes.
    const daysAgo = Math.round((historyDays / (count + 1)) * (incident + 1));
    const startAt = new Date(now - daysAgo * MS_PER_DAY);
    const events = generator.severeIncident(startAt);

    for (const [index, { input, scenarioLabel }] of events.entries()) {
      try {
        const result = await ingestTransaction(
          { ...input, scenarioLabel },
          {
            actorId: null,
            requestId: `seed-incident-${incident}-${index}`,
            source: INGESTION_SOURCE.SEED,
            emitEvents: false,
          },
        );
        ingested += 1;
        if (result.alert) alerts += 1;
      } catch (error) {
        failures += 1;
        if (failures <= 3) {
          process.stderr.write(`    incident ingestion failed: ${error.message}\n`);
        }
      }
    }
  }

  log(
    'incidents: ',
    `${count} incidents, ${ingested} transactions, ${alerts} alerts, ${failures} failures`,
  );
  return alerts;
}

/**
 * Backdates seeded alerts to the time of the transaction that raised them.
 *
 * `alerts.created_at` defaults to the moment the row is inserted, which is
 * correct for live ingestion but wrong for a backfill: it would stamp a month
 * of generated history with a single timestamp, collapsing the alert trend
 * chart into one spike at "now" and making time-to-resolve meaningless.
 *
 * The transaction's `occurred_at` is when the alert would have been raised had
 * the system been running at the time, so that is what the backfill uses.
 */
async function backdateSeededAlerts() {
  const updated = await prisma.$executeRaw`
    UPDATE "alerts" a
    SET "created_at" = t."occurred_at",
        "updated_at" = t."occurred_at"
    FROM "transactions" t
    WHERE t."id" = a."transaction_id"
  `;
  log('alerts: ', `${updated} backdated to their transaction's timestamp`);
}

/**
 * Walks a handful of alerts through the investigation workflow so that the
 * analytics page has resolved outcomes — and therefore investigation ground
 * truth — on a freshly seeded database.
 */
async function seedInvestigations(users) {
  const investigator = users.find((user) => user.role === USER_ROLE.INVESTIGATOR) ?? users[0];
  const analyst = users.find((user) => user.role === USER_ROLE.ANALYST) ?? users[0];

  const alreadyResolved = await prisma.alert.count({ where: { status: 'RESOLVED' } });
  if (alreadyResolved > 0) {
    log('investigations: ', `${alreadyResolved} alerts already resolved, skipping`);
    return;
  }

  const open = await prisma.alert.findMany({
    orderBy: { createdAt: 'desc' },
    take: 24,
    include: { transaction: { include: { label: true } } },
  });

  let resolved = 0;
  let inReview = 0;

  for (const [index, alert] of open.entries()) {
    // Leave a third of them open so the alert queue is not empty.
    if (index % 3 === 2) continue;

    if (index % 3 === 1) {
      await prisma.alert.update({
        where: { id: alert.id },
        data: { status: 'IN_REVIEW', assignedToId: investigator.id },
      });
      await prisma.investigationNote.create({
        data: {
          alertId: alert.id,
          authorId: investigator.id,
          body: "Picked up for review. Checking the sender's recent device history and counterparty pattern.",
        },
      });
      inReview += 1;
      continue;
    }

    // Resolve using the simulator's ground-truth label where one exists, so the
    // seeded investigation outcomes are consistent with the generated scenario
    // rather than arbitrary.
    const label = alert.transaction.label?.label ?? null;
    const isFraudScenario = label !== null && label !== 'NORMAL';
    const outcome = isFraudScenario ? 'CONFIRMED_FRAUD' : 'LEGITIMATE';

    await prisma.investigationNote.create({
      data: {
        alertId: alert.id,
        authorId: investigator.id,
        body: isFraudScenario
          ? 'Counterparty and velocity pattern match a known mule-collection shape. Escalating as confirmed.'
          : "Reviewed with the account holder's usual pattern in mind. Amount is high but consistent with a known recurring payment.",
      },
    });

    // Spread the resolutions over 1 to 20 hours after the alert was raised, so
    // the median-time-to-resolve figure reflects a plausible working pattern
    // rather than the instant at which the seed happened to run.
    const resolvedAt = new Date(
      alert.createdAt.getTime() + (1 + ((index * 7) % 20)) * 60 * 60 * 1000,
    );

    await prisma.alert.update({
      where: { id: alert.id },
      data: {
        status: 'RESOLVED',
        outcome,
        assignedToId: investigator.id,
        resolvedById: investigator.id,
        resolvedAt,
        resolutionSummary: isFraudScenario
          ? 'Confirmed fraudulent: structuring into a mule account across multiple senders.'
          : "Legitimate activity: verified against the account holder's established payment pattern.",
      },
    });
    resolved += 1;
  }

  // One alert assigned to the analyst but left open, so the assignment filter
  // has something to show.
  const unassigned = await prisma.alert.findFirst({
    where: { status: 'OPEN', assignedToId: null },
  });
  if (unassigned) {
    await prisma.alert.update({
      where: { id: unassigned.id },
      data: { assignedToId: analyst.id },
    });
  }

  log('investigations: ', `${resolved} resolved, ${inReview} in review`);
}

async function main() {
  process.stdout.write('\nSeeding FraudLens\n');
  process.stdout.write('-----------------\n');

  await seedRiskSettings();
  await seedFraudRules();
  const users = await seedUsers();

  if (!env.SEED_DEMO_DATA) {
    log('demo data: ', 'SEED_DEMO_DATA=false, skipping synthetic transactions');
    process.stdout.write('\nSeed complete (ruleset and users only).\n\n');
    return;
  }

  const roster = buildAccountRoster({
    seed: env.SEED_RANDOM_SEED,
    count: env.SEED_ACCOUNT_COUNT,
  });
  await seedAccounts(roster);
  await seedTransactions(roster, { count: env.SEED_TRANSACTION_COUNT });
  await backdateSeededAlerts();
  await seedInvestigations(users);

  const [transactions, assessments, alertCount] = await Promise.all([
    prisma.transaction.count(),
    prisma.riskAssessment.count(),
    prisma.alert.count(),
  ]);

  process.stdout.write(
    `\nSeed complete: ${transactions} transactions, ${assessments} assessments, ${alertCount} alerts.\n\n`,
  );
}

main()
  .catch((error) => {
    process.stderr.write(`\nSeed failed: ${error.stack ?? error.message}\n\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
