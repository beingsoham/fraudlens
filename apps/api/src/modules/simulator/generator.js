import { SCENARIO_LABEL, TRANSACTION_CHANNEL } from '@fraudlens/shared/constants';
import { createRng } from '../../utils/random.js';
import { roundToCents } from '../../utils/money.js';

/**
 * Deterministic synthetic transaction generator.
 *
 * Shared by the database seed script and the live simulator so that both
 * produce the same kinds of behaviour and both feed the identical ingestion
 * pipeline. Given the same seed, account list and scenario distribution it
 * emits exactly the same stream, which is what makes a scenario reproducible
 * when investigating a defect or re-running an evaluation.
 *
 * Every identifier it produces is synthetic. Nothing here touches, resembles or
 * is derived from a real payment system.
 */

/**
 * Default scenario weights.
 *
 * These are weights per *scenario instance*, not per transaction. That
 * distinction matters because the scenarios differ enormously in size: a
 * `NORMAL` instance is one payment, while a `SUSPICIOUS_RECEIVER` instance is a
 * whole mule-collection event of thirty to fifty. Weighting the mule scenario
 * as highly as `NORMAL` would make it dominate the dataset several times over,
 * so the weights below are chosen for the transaction mix they produce rather
 * than for how they read.
 *
 * The resulting mix is deliberately far more fraudulent than any real payment
 * network: a realistic base rate would leave the alert queue, the investigation
 * workflow and the relationship graph with nothing to show on a fresh install.
 * Detection-performance figures measured on this dataset are therefore a
 * demonstration of the metric, not an estimate of production performance.
 */
export const DEFAULT_SCENARIO_DISTRIBUTION = {
  [SCENARIO_LABEL.NORMAL]: 120,
  [SCENARIO_LABEL.HIGH_VALUE]: 12,
  [SCENARIO_LABEL.NEW_DEVICE]: 12,
  [SCENARIO_LABEL.RAPID_TRANSFER]: 5,
  [SCENARIO_LABEL.SUSPICIOUS_RECEIVER]: 2,
  [SCENARIO_LABEL.VOLUME_SPIKE]: 3,
};

const FIRST_NAMES = [
  'aarav',
  'priya',
  'rohan',
  'ananya',
  'vikram',
  'meera',
  'kabir',
  'diya',
  'arjun',
  'isha',
  'nikhil',
  'sneha',
  'rahul',
  'kavya',
  'aditya',
  'tara',
  'siddharth',
  'nisha',
  'varun',
  'pooja',
  'manish',
  'ritu',
  'gaurav',
  'shreya',
];

const MERCHANT_NAMES = [
  'chaiwala-corner',
  'metro-mart',
  'greenleaf-grocers',
  'cityfuel-station',
  'swift-pharmacy',
  'bookbarn',
  'tiffin-express',
  'cycle-works',
];

const CHANNELS = [
  TRANSACTION_CHANNEL.UPI_P2P,
  TRANSACTION_CHANNEL.UPI_P2M,
  TRANSACTION_CHANNEL.QR_CODE,
  TRANSACTION_CHANNEL.COLLECT_REQUEST,
];

/**
 * Builds a synthetic account roster.
 *
 * A fixed share are marked as merchants: they legitimately collect from many
 * distinct senders, which is exactly the pattern the receiver fan-in rule looks
 * for, so the dataset has to contain both the benign and the suspicious form of
 * it or the rule could never be evaluated honestly.
 */
export function buildAccountRoster({ seed = 1, count = 40 } = {}) {
  const rng = createRng(seed);
  const accounts = [];
  const merchantCount = Math.max(2, Math.round(count * 0.18));

  for (let index = 0; index < count; index += 1) {
    const isMerchant = index < merchantCount;
    if (isMerchant) {
      const base = MERCHANT_NAMES[index % MERCHANT_NAMES.length];
      accounts.push({
        accountRef: `${base}-${index}@fraudlens`,
        displayName: base.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        isMerchant: true,
      });
    } else {
      const base = FIRST_NAMES[index % FIRST_NAMES.length];
      accounts.push({
        accountRef: `${base}.${index}@fraudlens`,
        displayName: `${base.charAt(0).toUpperCase()}${base.slice(1)} ${String.fromCharCode(
          65 + (index % 26),
        )}.`,
        isMerchant: false,
      });
    }
  }

  // Designate a small number of non-merchant accounts as mules: these are the
  // receivers the SUSPICIOUS_RECEIVER scenario funnels money into.
  const personal = accounts.filter((account) => !account.isMerchant);
  const muleCount = Math.max(1, Math.round(personal.length * 0.08));
  for (const account of rng.shuffle(personal).slice(0, muleCount)) {
    account.isMule = true;
  }

  return accounts;
}

/** The prefix shared by every external id generated for `seed`. */
export function simulatorExternalIdPrefix(seed) {
  return `SIMTX-${seed}-`;
}

/**
 * The sequence number encoded in a simulator external id, or 0 when the id was
 * not produced by this generator.
 */
export function parseSimulatorExternalIdSequence(externalId) {
  const match = /^SIMTX-\d+-(\d+)$/.exec(externalId ?? '');
  return match ? Number(match[1]) : 0;
}

/**
 * Creates a generator.
 *
 * @param {object} options
 * @param {number} options.seed Deterministic RNG seed.
 * @param {{accountRef: string, isMerchant?: boolean, isMule?: boolean}[]} options.accounts
 * @param {object} [options.scenarioDistribution] Relative scenario weights.
 * @param {number} [options.sequenceStart] Continue external ids after this
 *   sequence number, so a repeated run does not reissue ids already persisted.
 */
export function createTransactionGenerator({
  seed = 1,
  accounts,
  scenarioDistribution = DEFAULT_SCENARIO_DISTRIBUTION,
  sequenceStart = 0,
} = {}) {
  if (!Array.isArray(accounts) || accounts.length < 4) {
    throw new Error('The generator needs at least 4 accounts');
  }

  const rng = createRng(seed);
  const personal = accounts.filter((account) => !account.isMerchant);
  const merchants = accounts.filter((account) => account.isMerchant);
  const mules = personal.filter((account) => account.isMule);
  const muleTargets = mules.length > 0 ? mules : personal.slice(0, 1);

  /** Devices each account is "known" to use, so normal activity looks settled. */
  const deviceRegistry = new Map();
  for (const account of accounts) {
    const deviceCount = rng.int(1, 2);
    deviceRegistry.set(
      account.accountRef,
      Array.from({ length: deviceCount }, (_, i) => `dev-${hash(account.accountRef)}-${i}`),
    );
  }

  let sequence = sequenceStart;
  /** Queued transactions from multi-transaction scenarios, in emission order. */
  const pending = [];

  function hash(text) {
    let value = 0;
    for (let i = 0; i < text.length; i += 1) {
      value = (value * 31 + text.charCodeAt(i)) & 0x7fffffff;
    }
    return value.toString(36);
  }

  function nextExternalId() {
    sequence += 1;
    // Includes the seed so two generators with different seeds never collide in
    // the same database. `sequenceStart` carries the count past ids an earlier
    // run with this seed already persisted: ingestion is idempotent on the
    // external id, so restarting at 1 would make every transaction of a
    // repeated run a duplicate that is skipped without any error.
    return `${simulatorExternalIdPrefix(seed)}${String(sequence).padStart(8, '0')}`;
  }

  function knownDevice(accountRef) {
    const devices = deviceRegistry.get(accountRef) ?? [`dev-${hash(accountRef)}-0`];
    return rng.pick(devices);
  }

  function unseenDevice(accountRef) {
    const fingerprint = `dev-${hash(accountRef)}-new-${rng.int(100000, 999999)}`;
    // Registered afterwards, so a second payment from the same device is
    // correctly *not* flagged as new.
    deviceRegistry.get(accountRef)?.push(fingerprint);
    return fingerprint;
  }

  /** Ordinary payment amount: log-normal, median around INR 1,800. */
  function normalAmount() {
    return roundToCents(Math.min(45_000, Math.max(10, rng.logNormal(7.5, 0.9))));
  }

  function pickSender() {
    return rng.pick(personal);
  }

  function pickReceiver(sender) {
    // Most ordinary payments go to a merchant; the rest are person-to-person.
    const pool = rng.chance(0.55) && merchants.length > 0 ? merchants : personal;
    let receiver = rng.pick(pool);
    let guard = 0;
    while (receiver.accountRef === sender.accountRef && guard < 10) {
      receiver = rng.pick(pool);
      guard += 1;
    }
    return receiver;
  }

  function baseTransaction({ sender, receiver, amount, deviceFingerprint, offsetMs = 0 }) {
    return {
      externalId: nextExternalId(),
      senderRef: sender.accountRef,
      receiverRef: receiver.accountRef,
      amount,
      currency: 'INR',
      deviceFingerprint,
      channel: receiver.isMerchant
        ? rng.pick([TRANSACTION_CHANNEL.UPI_P2M, TRANSACTION_CHANNEL.QR_CODE])
        : rng.pick(CHANNELS),
      status: 'COMPLETED',
      offsetMs,
    };
  }

  // -------------------------------------------------------------------------
  // Scenarios. Each returns one or more transactions with relative time
  // offsets; the caller turns offsets into absolute timestamps.
  // -------------------------------------------------------------------------

  const scenarios = {
    [SCENARIO_LABEL.NORMAL]() {
      const sender = pickSender();
      const receiver = pickReceiver(sender);
      return [
        baseTransaction({
          sender,
          receiver,
          amount: normalAmount(),
          deviceFingerprint: knownDevice(sender.accountRef),
        }),
      ];
    },

    [SCENARIO_LABEL.HIGH_VALUE]() {
      // An unusually large payment. Where it is also from an unfamiliar device
      // it takes on the shape of an account takeover rather than a one-off
      // large legitimate payment.
      const sender = pickSender();
      const receiver = pickReceiver(sender);
      return [
        baseTransaction({
          sender,
          receiver,
          // Comfortably above the 50,000 high-amount threshold.
          amount: roundToCents(rng.float(60_000, 400_000)),
          deviceFingerprint: rng.chance(0.45)
            ? unseenDevice(sender.accountRef)
            : knownDevice(sender.accountRef),
        }),
      ];
    },

    [SCENARIO_LABEL.RAPID_TRANSFER]() {
      // One payment structured into several, to the same receiver, within a few
      // minutes. Real structuring is rarely the only indicator present, so the
      // burst is sent to a mule account and, often, from an unfamiliar device —
      // which is what makes it score as more than a single mild anomaly.
      const sender = pickSender();
      const receiver =
        rng.pick(muleTargets.filter((account) => account.accountRef !== sender.accountRef)) ??
        pickReceiver(sender);
      const count = rng.int(6, 10);
      const device = rng.chance(0.6)
        ? unseenDevice(sender.accountRef)
        : knownDevice(sender.accountRef);
      const perTransfer = roundToCents(rng.float(6_000, 18_000));
      return Array.from({ length: count }, (_, index) =>
        baseTransaction({
          sender,
          receiver,
          amount: roundToCents(perTransfer * rng.float(0.85, 1.15)),
          deviceFingerprint: device,
          // 30-90s apart: comfortably inside the 10-minute velocity window.
          offsetMs: index * rng.int(30_000, 90_000),
        }),
      );
    },

    [SCENARIO_LABEL.NEW_DEVICE]() {
      const sender = pickSender();
      const receiver = pickReceiver(sender);
      return [
        baseTransaction({
          sender,
          receiver,
          amount: roundToCents(normalAmount() * rng.float(1.5, 4)),
          deviceFingerprint: unseenDevice(sender.accountRef),
        }),
      ];
    },

    [SCENARIO_LABEL.SUSPICIOUS_RECEIVER]() {
      // Many distinct senders paying one non-merchant account inside a couple
      // of hours: the mule-collection shape the fan-in rule looks for.
      const receiver = rng.pick(muleTargets);
      const senders = rng
        .shuffle(personal.filter((account) => account.accountRef !== receiver.accountRef))
        .slice(0, rng.int(10, 16));

      // Mule collection is not a single clean indicator. Victims are phished
      // onto an attacker-controlled handset and drained over several transfers
      // in quick succession, at larger-than-usual amounts. Modelling only the
      // fan-in would leave the dataset without the compound pattern that a
      // conservative alert threshold exists to catch, so each victim here
      // makes a short run of transfers rather than one payment.
      const transactions = [];
      senders.forEach((sender, senderIndex) => {
        const device = rng.chance(0.7)
          ? unseenDevice(sender.accountRef)
          : knownDevice(sender.accountRef);
        const transferCount = rng.int(3, 4);
        // Victims are approached one after another over roughly two hours.
        const victimStartMs = senderIndex * rng.int(240_000, 600_000);
        for (let transfer = 0; transfer < transferCount; transfer += 1) {
          transactions.push(
            baseTransaction({
              sender,
              receiver,
              amount: roundToCents(rng.float(20_000, 90_000)),
              deviceFingerprint: device,
              offsetMs: victimStartMs + transfer * rng.int(45_000, 150_000),
            }),
          );
        }
      });
      return transactions;
    },

    [SCENARIO_LABEL.VOLUME_SPIKE]() {
      // A single account's activity jumping well above its own baseline, inside
      // the 24-hour window the surge rule compares against that baseline.
      const sender = pickSender();
      const count = rng.int(12, 20);
      const device = knownDevice(sender.accountRef);
      const spanMs = rng.int(6, 20) * 3_600_000;
      return Array.from({ length: count }, (_, index) => {
        const receiver = pickReceiver(sender);
        return baseTransaction({
          sender,
          receiver,
          amount: roundToCents(normalAmount() * rng.float(1.5, 4)),
          deviceFingerprint: device,
          offsetMs: Math.round((spanMs * index) / count),
        });
      });
    },
  };

  /**
   * Returns the next transaction, with `occurredAt` set from `baseTime` plus
   * the scenario's relative offset.
   *
   * @param {Date} baseTime Wall-clock anchor for the next scenario.
   * @returns {{input: object, scenarioLabel: string}}
   */
  function next(baseTime = new Date()) {
    if (pending.length === 0) {
      const label = rng.weighted(scenarioDistribution) ?? SCENARIO_LABEL.NORMAL;
      const produced = scenarios[label]?.() ?? scenarios[SCENARIO_LABEL.NORMAL]();
      // The anchor is captured once, when the scenario is created, and every
      // transaction in it is offset from that anchor. Re-anchoring on each
      // dequeue would smear a burst across however long the caller takes to
      // drain the queue, which would destroy the very clustering in time that
      // makes the scenario a burst.
      for (const item of produced) {
        pending.push({ item, label, anchor: baseTime });
      }
    }

    const { item, label, anchor } = pending.shift();
    const { offsetMs, ...input } = item;
    return {
      input: { ...input, occurredAt: new Date(anchor.getTime() + offsetMs) },
      scenarioLabel: label,
    };
  }

  /**
   * Builds one pronounced mule-collection incident.
   *
   * The ordinary scenario mix above produces a realistic spread in which most
   * anomalies are single-indicator and therefore score LOW or MEDIUM — which is
   * the correct outcome for a deliberately conservative alert threshold, but
   * leaves a freshly seeded database with almost nothing in the alert queue.
   *
   * A real investigation tool is demonstrated against its worst day, not its
   * median one, so the seed composes background activity plus a small number of
   * these incidents. Note what this does *not* do: it changes no rule weight and
   * no threshold. It emits the compound behaviour — many victims, each drained
   * over several large transfers from a fresh device during quiet hours — that
   * a high score is supposed to describe, and lets the unmodified engine score
   * it on its merits.
   *
   * @param {Date} startAt When the incident begins.
   * @returns {{input: object, scenarioLabel: string}[]}
   */
  function severeIncident(startAt) {
    const receiver = rng.pick(muleTargets);
    const victims = rng
      .shuffle(personal.filter((account) => account.accountRef !== receiver.accountRef))
      .slice(0, rng.int(16, 22));

    // Anchor the incident in the quiet hours, when a victim is least likely to
    // notice and an operations team is least likely to be watching.
    const anchor = new Date(startAt);
    anchor.setUTCHours(rng.int(1, 4), rng.int(0, 59), 0, 0);

    const emitted = [];
    victims.forEach((victim, victimIndex) => {
      const device = unseenDevice(victim.accountRef);
      const transferCount = rng.int(5, 8);
      const victimStartMs = victimIndex * rng.int(90_000, 240_000);
      for (let transfer = 0; transfer < transferCount; transfer += 1) {
        const item = baseTransaction({
          sender: victim,
          receiver,
          amount: roundToCents(rng.float(80_000, 300_000)),
          deviceFingerprint: device,
          // 60-110s apart, so several land inside the 10-minute velocity window.
          offsetMs: victimStartMs + transfer * rng.int(60_000, 110_000),
        });
        const { offsetMs, ...input } = item;
        emitted.push({
          input: { ...input, occurredAt: new Date(anchor.getTime() + offsetMs) },
          scenarioLabel: SCENARIO_LABEL.SUSPICIOUS_RECEIVER,
        });
      }
    });

    return emitted;
  }

  return {
    next,
    severeIncident,
    /** Transactions still queued from an in-flight multi-step scenario. */
    pendingCount: () => pending.length,
    /** Current RNG state, reported in the simulator status. */
    rngState: () => rng.state(),
    emittedCount: () => sequence,
    accounts,
  };
}
