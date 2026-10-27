import { describe, expect, it } from 'vitest';
import { RULE_ID } from '@fraudlens/shared/constants';
import { RULE_STATUS, RULE_IMPLEMENTATIONS } from '../../src/modules/fraud/rules.js';
import { emptyFeatures } from '../../src/modules/fraud/features.js';
import { defaultRuleset } from '../../src/modules/fraud/ruleset.service.js';

/**
 * Unit tests for every detection rule.
 *
 * Each rule is exercised directly with hand-built features, so the tests pin
 * the rule's own logic rather than the pipeline around it. Three things are
 * checked for each: that it fires when it should, that it stays silent when it
 * should, and — where it depends on history — that it *abstains* rather than
 * guessing when there is not enough history to judge.
 */

const ruleset = defaultRuleset();

/** Runs one rule against a feature set, using the catalogue default config. */
function run(ruleId, { transaction = {}, features = {} } = {}) {
  const definition = ruleset.rules[ruleId];
  return RULE_IMPLEMENTATIONS[ruleId]({
    transaction: {
      amount: 1000,
      occurredAt: new Date('2026-06-15T12:00:00Z'),
      ...transaction,
    },
    features: emptyFeatures(features),
    config: definition.config,
    weight: definition.weight,
  });
}

describe('HIGH_AMOUNT', () => {
  it('does not trigger below the threshold', () => {
    const result = run(RULE_ID.HIGH_AMOUNT, { transaction: { amount: 49_999 } });
    expect(result.status).toBe(RULE_STATUS.NOT_TRIGGERED);
    expect(result.fraction).toBe(0);
  });

  it('triggers at the threshold and earns half the weight', () => {
    const result = run(RULE_ID.HIGH_AMOUNT, { transaction: { amount: 50_000 } });
    expect(result.status).toBe(RULE_STATUS.TRIGGERED);
    // Crossing the threshold is itself the signal, so it earns the 0.5 floor.
    expect(result.fraction).toBeCloseTo(0.5, 5);
  });

  it('earns the full weight at the saturation amount', () => {
    const result = run(RULE_ID.HIGH_AMOUNT, { transaction: { amount: 200_000 } });
    expect(result.fraction).toBeCloseTo(1, 5);
  });

  it('does not exceed the full weight above saturation', () => {
    const result = run(RULE_ID.HIGH_AMOUNT, { transaction: { amount: 10_000_000 } });
    expect(result.fraction).toBe(1);
  });

  it('records the amount and thresholds as evidence', () => {
    const result = run(RULE_ID.HIGH_AMOUNT, { transaction: { amount: 125_000 } });
    expect(result.evidence).toMatchObject({
      amount: 125_000,
      thresholdAmount: 50_000,
      saturationAmount: 200_000,
    });
    expect(result.explanation).toContain('high-amount threshold');
  });
});

describe('HISTORICAL_AMOUNT_ANOMALY', () => {
  const settledHistory = Array.from({ length: 20 }, () => 1000);

  it('abstains when the sender has too little history', () => {
    const result = run(RULE_ID.HISTORICAL_AMOUNT_ANOMALY, {
      transaction: { amount: 500_000 },
      features: { sender: { amountHistory: [100, 200], amountHistoryCount: 2 } },
    });
    expect(result.status).toBe(RULE_STATUS.ABSTAINED);
    expect(result.reason).toMatch(/prior transactions/);
  });

  it('abstains rather than scoring zero, which would look like "normal"', () => {
    const result = run(RULE_ID.HISTORICAL_AMOUNT_ANOMALY, {
      features: { sender: { amountHistory: [], amountHistoryCount: 0 } },
    });
    expect(result.status).not.toBe(RULE_STATUS.NOT_TRIGGERED);
    expect(result.status).toBe(RULE_STATUS.ABSTAINED);
  });

  it('does not trigger for an amount in line with history', () => {
    const result = run(RULE_ID.HISTORICAL_AMOUNT_ANOMALY, {
      transaction: { amount: 1050 },
      features: {
        sender: {
          amountHistory: settledHistory,
          amountHistoryCount: settledHistory.length,
          amountMedian: 1000,
          amountMad: 50,
        },
      },
    });
    expect(result.status).toBe(RULE_STATUS.NOT_TRIGGERED);
  });

  it('triggers for an amount far above the sender median', () => {
    const result = run(RULE_ID.HISTORICAL_AMOUNT_ANOMALY, {
      transaction: { amount: 50_000 },
      features: {
        sender: {
          amountHistory: settledHistory,
          amountHistoryCount: settledHistory.length,
          amountMedian: 1000,
          amountMad: 50,
        },
      },
    });
    expect(result.status).toBe(RULE_STATUS.TRIGGERED);
    expect(result.evidence.robustZScore).toBeGreaterThan(3);
  });

  it('ignores downward deviations: a small payment is not a fraud signal', () => {
    const result = run(RULE_ID.HISTORICAL_AMOUNT_ANOMALY, {
      transaction: { amount: 1 },
      features: {
        sender: {
          amountHistory: settledHistory,
          amountHistoryCount: settledHistory.length,
          amountMedian: 1000,
          amountMad: 50,
        },
      },
    });
    expect(result.status).toBe(RULE_STATUS.NOT_TRIGGERED);
  });
});

describe('HIGH_VELOCITY', () => {
  it('does not trigger below the count threshold', () => {
    const result = run(RULE_ID.HIGH_VELOCITY, {
      features: { sender: { transactionsInVelocityWindow: 4 } },
    });
    expect(result.status).toBe(RULE_STATUS.NOT_TRIGGERED);
  });

  it('triggers at the count threshold', () => {
    const result = run(RULE_ID.HIGH_VELOCITY, {
      features: { sender: { transactionsInVelocityWindow: 5 } },
    });
    expect(result.status).toBe(RULE_STATUS.TRIGGERED);
    expect(result.fraction).toBeCloseTo(0.5, 5);
    expect(result.evidence).toMatchObject({ transactionsInWindow: 5, windowMinutes: 10 });
  });

  it('earns the full weight at the saturation count', () => {
    const result = run(RULE_ID.HIGH_VELOCITY, {
      features: { sender: { transactionsInVelocityWindow: 15 } },
    });
    expect(result.fraction).toBeCloseTo(1, 5);
  });
});

describe('NEW_DEVICE', () => {
  it('does not trigger for a device the sender has used before', () => {
    const result = run(RULE_ID.NEW_DEVICE, {
      features: {
        sender: { historyCount: 40, knownDeviceCount: 2 },
        device: { fingerprint: 'dev-known', isKnown: true },
      },
    });
    expect(result.status).toBe(RULE_STATUS.NOT_TRIGGERED);
  });

  it('triggers at full weight for an unseen device on an established account', () => {
    const result = run(RULE_ID.NEW_DEVICE, {
      features: {
        sender: { historyCount: 40, knownDeviceCount: 2 },
        device: { fingerprint: 'dev-new', isKnown: false },
      },
    });
    expect(result.status).toBe(RULE_STATUS.TRIGGERED);
    expect(result.fraction).toBe(1);
  });

  it('dampens the signal for an account with barely any history', () => {
    const result = run(RULE_ID.NEW_DEVICE, {
      features: {
        sender: { historyCount: 1, knownDeviceCount: 1 },
        device: { fingerprint: 'dev-new', isKnown: false },
      },
    });
    expect(result.status).toBe(RULE_STATUS.TRIGGERED);
    expect(result.fraction).toBe(0.4);
    expect(result.evidence.isNewAccount).toBe(true);
  });

  it('abstains entirely for an account with no history at all', () => {
    const result = run(RULE_ID.NEW_DEVICE, {
      features: {
        sender: { historyCount: 0, knownDeviceCount: 0 },
        device: { fingerprint: 'dev-new', isKnown: false },
      },
    });
    // Every device is necessarily unseen for a brand-new account, so the
    // signal carries no information and must not be scored.
    expect(result.status).toBe(RULE_STATUS.ABSTAINED);
  });
});

describe('RAPID_REPEATED_TRANSFERS', () => {
  it('does not trigger below the threshold', () => {
    const result = run(RULE_ID.RAPID_REPEATED_TRANSFERS, {
      features: { pair: { transfersInWindow: 2, totalAmountInWindow: 5000 } },
    });
    expect(result.status).toBe(RULE_STATUS.NOT_TRIGGERED);
  });

  it('triggers once the same pair repeats inside the window', () => {
    const result = run(RULE_ID.RAPID_REPEATED_TRANSFERS, {
      features: { pair: { transfersInWindow: 3, totalAmountInWindow: 30_000 } },
    });
    expect(result.status).toBe(RULE_STATUS.TRIGGERED);
    expect(result.evidence.pairTransfersInWindow).toBe(3);
    expect(result.explanation).toContain('splitting one large payment');
  });
});

describe('SUSPICIOUS_RECEIVER_FANIN', () => {
  it('abstains for a merchant, where high fan-in is expected', () => {
    const result = run(RULE_ID.SUSPICIOUS_RECEIVER_FANIN, {
      features: { receiver: { distinctSendersInWindow: 50, isMerchant: true } },
    });
    expect(result.status).toBe(RULE_STATUS.ABSTAINED);
    expect(result.reason).toMatch(/merchant/);
  });

  it('does not trigger below the distinct-sender threshold', () => {
    const result = run(RULE_ID.SUSPICIOUS_RECEIVER_FANIN, {
      features: { receiver: { distinctSendersInWindow: 7, isMerchant: false } },
    });
    expect(result.status).toBe(RULE_STATUS.NOT_TRIGGERED);
  });

  it('triggers for a personal account collecting from many senders', () => {
    const result = run(RULE_ID.SUSPICIOUS_RECEIVER_FANIN, {
      features: { receiver: { distinctSendersInWindow: 20, isMerchant: false } },
    });
    expect(result.status).toBe(RULE_STATUS.TRIGGERED);
    expect(result.fraction).toBeCloseTo(1, 5);
  });
});

describe('UNUSUAL_TRANSACTION_TIME', () => {
  /** A sender who always transacts at 14:00 UTC. */
  const routine = () => {
    const histogram = Array.from({ length: 24 }, () => 0);
    histogram[14] = 40;
    return { sender: { hourHistogram: histogram, hourHistoryCount: 40 } };
  };

  it('abstains when there is no established routine', () => {
    const histogram = Array.from({ length: 24 }, () => 0);
    histogram[14] = 3;
    const result = run(RULE_ID.UNUSUAL_TRANSACTION_TIME, {
      transaction: { occurredAt: new Date('2026-06-15T03:00:00Z') },
      features: { sender: { hourHistogram: histogram, hourHistoryCount: 3 } },
    });
    expect(result.status).toBe(RULE_STATUS.ABSTAINED);
  });

  it("does not trigger at the sender's usual hour", () => {
    const result = run(RULE_ID.UNUSUAL_TRANSACTION_TIME, {
      transaction: { occurredAt: new Date('2026-06-15T14:30:00Z') },
      features: routine(),
    });
    expect(result.status).toBe(RULE_STATUS.NOT_TRIGGERED);
  });

  it('triggers at a rare hour, and fully at a configured quiet hour', () => {
    const quiet = run(RULE_ID.UNUSUAL_TRANSACTION_TIME, {
      transaction: { occurredAt: new Date('2026-06-15T03:00:00Z') },
      features: routine(),
    });
    expect(quiet.status).toBe(RULE_STATUS.TRIGGERED);
    expect(quiet.fraction).toBe(1);
    expect(quiet.evidence.isQuietHour).toBe(true);

    const rareButNotQuiet = run(RULE_ID.UNUSUAL_TRANSACTION_TIME, {
      transaction: { occurredAt: new Date('2026-06-15T19:00:00Z') },
      features: routine(),
    });
    expect(rareButNotQuiet.status).toBe(RULE_STATUS.TRIGGERED);
    expect(rareButNotQuiet.fraction).toBe(0.7);
  });

  it('reads the hour in UTC, not the host timezone', () => {
    const result = run(RULE_ID.UNUSUAL_TRANSACTION_TIME, {
      transaction: { occurredAt: new Date('2026-06-15T02:00:00Z') },
      features: routine(),
    });
    expect(result.evidence.hourUtc).toBe(2);
  });
});

describe('SUDDEN_ACTIVITY_INCREASE', () => {
  it('abstains without an established baseline', () => {
    const result = run(RULE_ID.SUDDEN_ACTIVITY_INCREASE, {
      features: { sender: { baselineCount: 3, recentCount: 50 } },
    });
    expect(result.status).toBe(RULE_STATUS.ABSTAINED);
    expect(result.reason).toMatch(/baseline/i);
  });

  it('does not trigger when recent activity matches the baseline', () => {
    const result = run(RULE_ID.SUDDEN_ACTIVITY_INCREASE, {
      features: {
        sender: {
          // 14 over 14 days is 1/day; 1 in the last 24h is the same rate.
          baselineCount: 14,
          baselineValue: 14_000,
          recentCount: 1,
          recentValue: 1000,
        },
      },
    });
    expect(result.status).toBe(RULE_STATUS.NOT_TRIGGERED);
  });

  it('triggers on a sharp jump in count against the baseline', () => {
    const result = run(RULE_ID.SUDDEN_ACTIVITY_INCREASE, {
      features: {
        sender: {
          baselineCount: 14,
          baselineValue: 14_000,
          recentCount: 10,
          recentValue: 10_000,
        },
      },
    });
    expect(result.status).toBe(RULE_STATUS.TRIGGERED);
    expect(result.evidence.countRatio).toBeCloseTo(10, 1);
  });

  it('triggers on a jump in value even when the count is unchanged', () => {
    const result = run(RULE_ID.SUDDEN_ACTIVITY_INCREASE, {
      features: {
        sender: {
          baselineCount: 14,
          baselineValue: 14_000,
          recentCount: 1,
          recentValue: 80_000,
        },
      },
    });
    expect(result.status).toBe(RULE_STATUS.TRIGGERED);
    expect(result.evidence.valueRatio).toBeGreaterThan(result.evidence.countRatio);
  });

  it('normalises both windows to a per-day rate before comparing', () => {
    // 28 over 14 days is 2/day. 2 in the last 24h is the same rate, so a naive
    // count comparison (28 vs 2) must not be what drives this.
    const result = run(RULE_ID.SUDDEN_ACTIVITY_INCREASE, {
      features: {
        sender: { baselineCount: 28, baselineValue: 28_000, recentCount: 2, recentValue: 2000 },
      },
    });
    expect(result.status).toBe(RULE_STATUS.NOT_TRIGGERED);
    expect(result.evidence.countRatio).toBeCloseTo(1, 2);
  });
});
