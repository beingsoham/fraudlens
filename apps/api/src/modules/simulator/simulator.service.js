import { AUDIT_ACTION, AUDIT_ENTITY_TYPE } from '@fraudlens/shared/schemas';
import { env } from '../../config/env.js';
import { moduleLogger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { ConflictError, UnprocessableError } from '../../utils/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { emitSimulatorStatus } from '../../realtime/events.js';
import { INGESTION_SOURCE, ingestTransaction } from '../transactions/ingestion.service.js';
import {
  DEFAULT_SCENARIO_DISTRIBUTION,
  buildAccountRoster,
  createTransactionGenerator,
} from './generator.js';

const log = moduleLogger('simulator');

/**
 * The transaction simulator.
 *
 * A single, process-wide worker that feeds synthetic transactions through the
 * *same* ingestion pipeline as the HTTP endpoint — same validation, same
 * feature computation, same engine, same atomic persistence, same real-time
 * events. There is no separate "simulated" code path, which is the only way the
 * simulator is actually useful as a test of the real system.
 *
 * ## Lifecycle
 *
 * `state` is the single source of truth and the start path checks it
 * synchronously before any `await`, so two concurrent start requests cannot both
 * pass the guard. Stop is cooperative: it clears the timer, marks the worker
 * stopping and waits for an in-flight tick to finish, so the process never exits
 * with a half-written transaction.
 *
 * ## Scope
 *
 * This is a single-process worker holding its state in memory. Two API replicas
 * would each run their own, which is noted as a limitation in the README; a
 * multi-replica deployment would need a database-backed lock or a dedicated
 * worker process.
 */

const STATUS = {
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  STOPPING: 'STOPPING',
};

const state = {
  status: STATUS.STOPPED,
  timer: null,
  generator: null,
  config: null,
  startedAt: null,
  stoppedAt: null,
  startedByUserId: null,
  /** Number of ticks currently executing. Stop waits for this to reach zero. */
  inFlight: 0,
  counters: {
    attempted: 0,
    ingested: 0,
    duplicates: 0,
    failed: 0,
    alertsCreated: 0,
    highRisk: 0,
  },
  lastTransaction: null,
  lastError: null,
};

/** Public status payload, shared by the REST endpoint and the socket event. */
export function getSimulatorStatus() {
  const runningForMs = state.startedAt ? Date.now() - state.startedAt.getTime() : 0;
  return {
    status: state.status,
    running: state.status === STATUS.RUNNING,
    startedAt: state.startedAt?.toISOString() ?? null,
    stoppedAt: state.stoppedAt?.toISOString() ?? null,
    startedByUserId: state.startedByUserId,
    runningForSeconds: state.startedAt ? Math.round(runningForMs / 1000) : 0,
    config: state.config
      ? {
          ratePerSecond: state.config.ratePerSecond,
          seed: state.config.seed,
          scenarioDistribution: state.config.scenarioDistribution,
          maxTransactions: state.config.maxTransactions ?? null,
          accountCount: state.config.accountCount,
        }
      : null,
    counters: { ...state.counters },
    /** Measured rate, which may trail the requested rate under database load. */
    effectiveRatePerSecond:
      runningForMs > 0
        ? Math.round((state.counters.ingested / (runningForMs / 1000)) * 100) / 100
        : 0,
    lastTransaction: state.lastTransaction,
    lastError: state.lastError,
    maxRatePerSecond: env.SIMULATOR_MAX_RATE,
    pendingScenarioTransactions: state.generator?.pendingCount() ?? 0,
  };
}

function broadcastStatus() {
  emitSimulatorStatus(getSimulatorStatus());
}

/**
 * Runs one generated transaction through the ingestion pipeline.
 *
 * Exceptions are counted and logged but never rethrown: a single failed
 * transaction — a duplicate id, a transient database error — must not take the
 * worker down. A persistent failure is visible through `counters.failed` and
 * `lastError` in the status endpoint.
 */
async function tick() {
  if (state.status !== STATUS.RUNNING) return;

  state.inFlight += 1;
  try {
    const { input, scenarioLabel } = state.generator.next(new Date());
    state.counters.attempted += 1;

    const result = await ingestTransaction(
      { ...input, scenarioLabel },
      {
        actorId: state.startedByUserId,
        requestId: `simulator-${state.counters.attempted}`,
        source: INGESTION_SOURCE.SIMULATOR,
      },
    );

    if (result.duplicate) {
      state.counters.duplicates += 1;
    } else {
      state.counters.ingested += 1;
      if (result.alert) state.counters.alertsCreated += 1;
      if (result.assessment.riskCategory === 'HIGH') state.counters.highRisk += 1;
      state.lastTransaction = {
        id: result.transaction.id,
        externalId: result.transaction.externalId,
        amount: result.transaction.amount,
        riskScore: result.assessment.riskScore,
        riskCategory: result.assessment.riskCategory,
        scenarioLabel,
        at: new Date().toISOString(),
      };
    }

    if (state.config.maxTransactions && state.counters.ingested >= state.config.maxTransactions) {
      log.info(
        { ingested: state.counters.ingested },
        'Simulator reached its transaction limit; stopping',
      );
      // Detached so the stop does not run inside this tick's own frame, which
      // would deadlock on the in-flight wait.
      setImmediate(() => {
        stopSimulator({
          actorId: state.startedByUserId,
          requestId: 'simulator-auto-stop',
          reason: 'Reached the configured transaction limit',
        }).catch((error) => log.error({ err: error }, 'Auto-stop failed'));
      });
    }
  } catch (error) {
    state.counters.failed += 1;
    state.lastError = {
      message: error.message?.slice(0, 300) ?? 'Unknown error',
      at: new Date().toISOString(),
    };
    log.warn({ err: error }, 'Simulator tick failed');
  } finally {
    state.inFlight -= 1;
  }
}

/**
 * Starts the simulator.
 *
 * @param {object} payload Validated `startSimulatorSchema` body.
 * @param {object} context Actor and request metadata for the audit event.
 */
export async function startSimulator(payload, context) {
  // Checked before any await, so two concurrent requests cannot both proceed.
  if (state.status !== STATUS.STOPPED) {
    throw new ConflictError(
      `The simulator is already ${state.status.toLowerCase()}. Stop it before starting a new run.`,
    );
  }
  state.status = STATUS.STARTING;

  try {
    const ratePerSecond = payload.ratePerSecond ?? env.SIMULATOR_DEFAULT_RATE;
    if (ratePerSecond > env.SIMULATOR_MAX_RATE) {
      throw new UnprocessableError(
        `The requested rate of ${ratePerSecond}/s exceeds the configured maximum of ${env.SIMULATOR_MAX_RATE}/s`,
      );
    }

    // Prefer the accounts already in the database so generated traffic builds on
    // the existing history rather than starting every account from scratch.
    const existing = await prisma.account.findMany({
      select: { accountRef: true, displayName: true, isMerchant: true },
      take: 500,
      orderBy: { createdAt: 'asc' },
    });

    const accounts =
      existing.length >= 8
        ? existing.map((account, index) => ({
            ...account,
            // Mark a deterministic slice of non-merchant accounts as mules, so
            // the collection scenario has somewhere to funnel money.
            isMule: !account.isMerchant && index % 11 === 0,
          }))
        : buildAccountRoster({ seed: payload.seed ?? env.SIMULATOR_DEFAULT_SEED, count: 40 });

    const scenarioDistribution = payload.scenarioDistribution
      ? { ...DEFAULT_SCENARIO_DISTRIBUTION, ...payload.scenarioDistribution }
      : DEFAULT_SCENARIO_DISTRIBUTION;

    state.config = {
      ratePerSecond,
      seed: payload.seed ?? env.SIMULATOR_DEFAULT_SEED,
      scenarioDistribution,
      maxTransactions: payload.maxTransactions ?? null,
      accountCount: accounts.length,
    };
    state.generator = createTransactionGenerator({
      seed: state.config.seed,
      accounts,
      scenarioDistribution,
    });
    state.counters = {
      attempted: 0,
      ingested: 0,
      duplicates: 0,
      failed: 0,
      alertsCreated: 0,
      highRisk: 0,
    };
    state.lastTransaction = null;
    state.lastError = null;
    state.startedAt = new Date();
    state.stoppedAt = null;
    state.startedByUserId = context.actorId ?? null;

    const intervalMs = Math.max(20, Math.round(1000 / ratePerSecond));
    state.status = STATUS.RUNNING;
    // `tick` is async and deliberately not awaited: a slow database must not
    // make the interval drift, and a tick that overlaps the next one is
    // harmless because ingestion is independently serialised per sender.
    state.timer = setInterval(() => {
      void tick();
    }, intervalMs);
    // Prevents the interval from keeping the process alive on shutdown.
    state.timer.unref?.();

    await recordAudit({
      actorId: context.actorId,
      action: AUDIT_ACTION.SIMULATOR_STARTED,
      entityType: AUDIT_ENTITY_TYPE.SIMULATOR,
      entityId: 'simulator',
      metadata: {
        ratePerSecond,
        seed: state.config.seed,
        maxTransactions: state.config.maxTransactions ?? undefined,
        scenarioDistribution,
      },
      requestId: context.requestId,
      ipAddress: context.ipAddress,
    });

    log.info({ ratePerSecond, seed: state.config.seed, intervalMs }, 'Simulator started');
    broadcastStatus();
    return getSimulatorStatus();
  } catch (error) {
    // Roll the state back so a failed start does not leave the simulator stuck
    // in STARTING, which would block every subsequent attempt.
    state.status = STATUS.STOPPED;
    state.timer = null;
    state.generator = null;
    throw error;
  }
}

/** Stops the simulator, waiting for any in-flight transaction to finish. */
export async function stopSimulator(context) {
  if (state.status === STATUS.STOPPED) {
    throw new ConflictError('The simulator is not running');
  }
  if (state.status === STATUS.STOPPING) {
    throw new ConflictError('The simulator is already stopping');
  }

  state.status = STATUS.STOPPING;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }

  // Wait for in-flight ticks so a transaction is never abandoned mid-write.
  const deadline = Date.now() + 10_000;
  while (state.inFlight > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (state.inFlight > 0) {
    log.warn({ inFlight: state.inFlight }, 'Simulator stopped with ticks still in flight');
  }

  const counters = { ...state.counters };
  state.status = STATUS.STOPPED;
  state.stoppedAt = new Date();
  state.generator = null;

  await recordAudit({
    actorId: context.actorId,
    action: AUDIT_ACTION.SIMULATOR_STOPPED,
    entityType: AUDIT_ENTITY_TYPE.SIMULATOR,
    entityId: 'simulator',
    metadata: {
      reason: context.reason ?? 'Stopped by operator',
      rowCount: counters.ingested,
    },
    requestId: context.requestId,
    ipAddress: context.ipAddress,
  });

  log.info({ counters }, 'Simulator stopped');
  broadcastStatus();
  return getSimulatorStatus();
}

/**
 * Stops the worker without writing an audit event or touching the database.
 * Used by the process shutdown handler, where the database may already be
 * closing and a failed audit write would mask the real shutdown reason.
 */
export async function shutdownSimulator() {
  if (state.status === STATUS.STOPPED) return;
  state.status = STATUS.STOPPING;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  const deadline = Date.now() + 5_000;
  while (state.inFlight > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  state.status = STATUS.STOPPED;
  state.generator = null;
  log.info('Simulator shut down');
}

/** True when the worker is running. Used by the health endpoint. */
export function isSimulatorRunning() {
  return state.status === STATUS.RUNNING;
}

export { STATUS as SIMULATOR_STATUS };
