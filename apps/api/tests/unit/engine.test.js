import { describe, expect, it } from 'vitest';
import { RISK_CATEGORY, RULE_ID } from '@fraudlens/shared/constants';
import { assessTransaction } from '../../src/modules/fraud/engine.js';
import { emptyFeatures } from '../../src/modules/fraud/features.js';
import { defaultRuleset } from '../../src/modules/fraud/ruleset.service.js';

/**
 * Engine-level tests.
 *
 * These exercise the whole scoring path — rule evaluation, correlation
 * dampening, categorisation, alert decision and explanation building — without
 * touching the database.
 */

const occurredAt = new Date('2026-06-15T14:00:00Z');

function assess({ transaction = {}, features = {}, ruleset = defaultRuleset() } = {}) {
  return assessTransaction({
    transaction: { amount: 1000, occurredAt, ...transaction },
    features: emptyFeatures(features),
    ruleset,
  });
}

/** Features describing a settled account with a routine. */
function settledSender(overrides = {}) {
  const histogram = Array.from({ length: 24 }, () => 0);
  histogram[14] = 60;
  return {
    sender: {
      historyCount: 60,
      amountHistory: Array.from({ length: 60 }, () => 1000),
      amountHistoryCount: 60,
      amountMedian: 1000,
      amountMad: 50,
      knownDevices: ['dev-known'],
      knownDeviceCount: 1,
      hourHistogram: histogram,
      hourHistoryCount: 60,
      baselineCount: 60,
      baselineValue: 60_000,
      recentCount: 4,
      recentValue: 4000,
      ...overrides.sender,
    },
    device: { fingerprint: 'dev-known', isKnown: true, ...overrides.device },
    pair: { transfersInWindow: 0, totalAmountInWindow: 0, ...overrides.pair },
    receiver: { distinctSendersInWindow: 1, isMerchant: false, ...overrides.receiver },
  };
}

describe('assessTransaction', () => {
  it('scores an unremarkable transaction as LOW with no alert', () => {
    const result = assess({ features: settledSender() });
    expect(result.riskScore).toBe(0);
    expect(result.riskCategory).toBe(RISK_CATEGORY.LOW);
    expect(result.triggeredRuleIds).toEqual([]);
    expect(result.alert.shouldCreate).toBe(false);
    expect(result.alert.severity).toBeNull();
  });

  it('is deterministic: identical inputs produce an identical assessment', () => {
    const inputs = { transaction: { amount: 150_000 }, features: settledSender() };
    const first = assess(inputs);
    const second = assess(inputs);
    expect(second.riskScore).toBe(first.riskScore);
    expect(second.triggeredRuleIds).toEqual(first.triggeredRuleIds);
    expect(second.explanations).toEqual(first.explanations);
  });

  it('records the ruleset version on every assessment', () => {
    const result = assess({ features: settledSender() });
    expect(result.rulesetVersion).toBe('test');
  });

  it('reports every rule, including those that did not fire or abstained', () => {
    const result = assess({ features: settledSender() });
    expect(result.ruleResults).toHaveLength(Object.keys(RULE_ID).length);
    const statuses = new Set(result.ruleResults.map((entry) => entry.status));
    expect(statuses.has('NOT_TRIGGERED')).toBe(true);
  });

  it('orders triggered rules by their contribution, strongest first', () => {
    const result = assess({
      transaction: { amount: 300_000 },
      features: settledSender({
        device: { fingerprint: 'dev-new', isKnown: false },
        sender: { transactionsInVelocityWindow: 12 },
      }),
    });
    const contributions = result.triggeredRules.map((rule) => rule.contribution);
    expect(contributions).toEqual([...contributions].sort((a, b) => b - a));
  });

  it('raises an alert once the score reaches the configured threshold', () => {
    const result = assess({
      transaction: { amount: 300_000, occurredAt: new Date('2026-06-15T03:00:00Z') },
      features: settledSender({
        device: { fingerprint: 'dev-new', isKnown: false },
        sender: { transactionsInVelocityWindow: 15, recentCount: 30, recentValue: 900_000 },
        receiver: { distinctSendersInWindow: 20, isMerchant: false },
        pair: { transfersInWindow: 8, totalAmountInWindow: 500_000 },
      }),
    });
    expect(result.riskScore).toBeGreaterThanOrEqual(70);
    expect(result.riskCategory).toBe(RISK_CATEGORY.HIGH);
    expect(result.alert.shouldCreate).toBe(true);
    expect(result.alert.severity).toBeTruthy();
  });

  it('never exceeds a score of 100 however many rules fire', () => {
    const result = assess({
      transaction: { amount: 10_000_000, occurredAt: new Date('2026-06-15T03:00:00Z') },
      features: settledSender({
        device: { fingerprint: 'dev-new', isKnown: false },
        sender: { transactionsInVelocityWindow: 100, recentCount: 500, recentValue: 9_000_000 },
        receiver: { distinctSendersInWindow: 100, isMerchant: false },
        pair: { transfersInWindow: 50, totalAmountInWindow: 5_000_000 },
      }),
    });
    expect(result.riskScore).toBe(100);
  });

  it('skips a disabled rule and records why', () => {
    const ruleset = defaultRuleset({ rules: { [RULE_ID.HIGH_AMOUNT]: { enabled: false } } });
    const result = assess({
      transaction: { amount: 500_000 },
      features: settledSender(),
      ruleset,
    });
    const highAmount = result.ruleResults.find((entry) => entry.ruleId === RULE_ID.HIGH_AMOUNT);
    expect(highAmount.status).toBe('DISABLED');
    expect(highAmount.contribution).toBe(0);
    expect(result.triggeredRuleIds).not.toContain(RULE_ID.HIGH_AMOUNT);
  });

  it('respects a reconfigured rule weight', () => {
    const ruleset = defaultRuleset({ rules: { [RULE_ID.HIGH_AMOUNT]: { weight: 40 } } });
    const withDefault = assess({ transaction: { amount: 200_000 }, features: settledSender() });
    const withHigher = assess({
      transaction: { amount: 200_000 },
      features: settledSender(),
      ruleset,
    });
    expect(withHigher.riskScore).toBeGreaterThan(withDefault.riskScore);
  });

  it('respects reconfigured category boundaries', () => {
    const ruleset = defaultRuleset({
      riskSettings: { mediumThreshold: 5, highThreshold: 10, alertThreshold: 10 },
    });
    const result = assess({ transaction: { amount: 60_000 }, features: settledSender(), ruleset });
    expect(result.riskCategory).toBe(RISK_CATEGORY.HIGH);
    expect(result.alert.shouldCreate).toBe(true);
  });

  it('dampens correlated amount rules instead of counting them twice', () => {
    const result = assess({
      transaction: { amount: 300_000 },
      features: settledSender(),
    });
    const amountRules = result.triggeredRules.filter((rule) =>
      [RULE_ID.HIGH_AMOUNT, RULE_ID.HISTORICAL_AMOUNT_ANOMALY].includes(rule.ruleId),
    );
    expect(amountRules).toHaveLength(2);
    // The weaker of the two is discounted, so the pair contributes less than
    // the sum of their weights.
    const total = amountRules.reduce((sum, rule) => sum + rule.contribution, 0);
    expect(total).toBeLessThan(40);
    expect(amountRules.some((rule) => rule.dampeningFactor < 1)).toBe(true);
  });

  it('explains the score, leading with what it does and does not mean', () => {
    const result = assess({ transaction: { amount: 300_000 }, features: settledSender() });
    expect(result.explanations[0]).toMatch(/Risk score \d+ of 100/);
    expect(result.explanations[0]).toMatch(/not a finding of fraud/i);
    expect(result.explanations.length).toBeGreaterThan(1);
  });

  it('states in the explanation when a rule could not be evaluated', () => {
    const result = assess({
      transaction: { amount: 1000 },
      // A brand-new account: several rules must abstain.
      features: {},
    });
    const abstentions = result.ruleResults.filter((entry) => entry.status === 'ABSTAINED');
    expect(abstentions.length).toBeGreaterThan(0);
    expect(result.explanations.some((line) => line.includes('not evaluated'))).toBe(true);
  });

  it('records per-rule evidence for every triggered rule', () => {
    const result = assess({ transaction: { amount: 300_000 }, features: settledSender() });
    for (const rule of result.triggeredRules) {
      expect(rule.evidence).toBeTruthy();
      expect(rule.explanation).toBeTruthy();
      expect(rule.ruleId).toBeTruthy();
      expect(typeof rule.contribution).toBe('number');
    }
  });

  it('rejects malformed input rather than scoring it', () => {
    expect(() => assessTransaction({})).toThrow(TypeError);
    expect(() =>
      assessTransaction({
        transaction: { amount: 'lots', occurredAt },
        features: emptyFeatures(),
        ruleset: defaultRuleset(),
      }),
    ).toThrow(TypeError);
    expect(() =>
      assessTransaction({
        transaction: { amount: 100, occurredAt: 'yesterday' },
        features: emptyFeatures(),
        ruleset: defaultRuleset(),
      }),
    ).toThrow(TypeError);
  });

  it('scores a brand-new account conservatively rather than as safe', () => {
    // With no history, the history-dependent rules abstain. The result should
    // be a low score with explicit abstentions, not a confident "all clear".
    const result = assess({ transaction: { amount: 1000 }, features: {} });
    expect(result.riskScore).toBeLessThan(30);
    expect(
      result.ruleResults.filter((entry) => entry.status === 'ABSTAINED').length,
    ).toBeGreaterThanOrEqual(3);
  });
});
