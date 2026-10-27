import { describe, expect, it } from 'vitest';
import { ALERT_SEVERITY, RISK_CATEGORY, RULE_ID } from '@fraudlens/shared/constants';
import {
  applyCorrelationDampening,
  categoriseRisk,
  computeRiskScore,
  severityForScore,
  shouldCreateAlert,
} from '../../src/modules/fraud/scoring.js';

const thresholds = { mediumThreshold: 30, highThreshold: 70, alertThreshold: 70 };

describe('categoriseRisk', () => {
  it('places scores below the medium threshold in LOW', () => {
    expect(categoriseRisk(0, thresholds)).toBe(RISK_CATEGORY.LOW);
    expect(categoriseRisk(29, thresholds)).toBe(RISK_CATEGORY.LOW);
  });

  it('treats the boundaries as inclusive lower bounds', () => {
    expect(categoriseRisk(30, thresholds)).toBe(RISK_CATEGORY.MEDIUM);
    expect(categoriseRisk(69, thresholds)).toBe(RISK_CATEGORY.MEDIUM);
    expect(categoriseRisk(70, thresholds)).toBe(RISK_CATEGORY.HIGH);
    expect(categoriseRisk(100, thresholds)).toBe(RISK_CATEGORY.HIGH);
  });

  it('follows reconfigured boundaries', () => {
    const custom = { mediumThreshold: 10, highThreshold: 20, alertThreshold: 20 };
    expect(categoriseRisk(9, custom)).toBe(RISK_CATEGORY.LOW);
    expect(categoriseRisk(10, custom)).toBe(RISK_CATEGORY.MEDIUM);
    expect(categoriseRisk(20, custom)).toBe(RISK_CATEGORY.HIGH);
  });
});

describe('computeRiskScore', () => {
  it('sums contributions and rounds to an integer', () => {
    expect(computeRiskScore([{ contribution: 20.4 }, { contribution: 15.2 }])).toBe(36);
  });

  it('caps the total at 100', () => {
    expect(computeRiskScore([{ contribution: 90 }, { contribution: 80 }])).toBe(100);
  });

  it('returns 0 for no contributions', () => {
    expect(computeRiskScore([])).toBe(0);
  });

  it('never returns a negative score', () => {
    expect(computeRiskScore([{ contribution: -50 }])).toBe(0);
  });
});

describe('applyCorrelationDampening', () => {
  it('leaves an independent rule at its full contribution', () => {
    const [result] = applyCorrelationDampening([
      { ruleId: RULE_ID.NEW_DEVICE, rawContribution: 15 },
    ]);
    expect(result.dampeningFactor).toBe(1);
    expect(result.contribution).toBe(15);
  });

  it('counts the strongest contribution in a group in full and halves the next', () => {
    const results = applyCorrelationDampening([
      { ruleId: RULE_ID.HIGH_AMOUNT, rawContribution: 10 },
      { ruleId: RULE_ID.HISTORICAL_AMOUNT_ANOMALY, rawContribution: 20 },
    ]);
    const byRule = Object.fromEntries(results.map((entry) => [entry.ruleId, entry]));

    // The anomaly rule contributed more, so it keeps its full value.
    expect(byRule[RULE_ID.HISTORICAL_AMOUNT_ANOMALY].contribution).toBe(20);
    expect(byRule[RULE_ID.HIGH_AMOUNT].contribution).toBe(5);
    expect(byRule[RULE_ID.HIGH_AMOUNT].correlationGroup).toBe('amount');
  });

  it('does not dampen rules that sit in different groups', () => {
    const results = applyCorrelationDampening([
      { ruleId: RULE_ID.HIGH_AMOUNT, rawContribution: 20 },
      { ruleId: RULE_ID.HIGH_VELOCITY, rawContribution: 25 },
      { ruleId: RULE_ID.NEW_DEVICE, rawContribution: 15 },
    ]);
    for (const entry of results) {
      expect(entry.dampeningFactor).toBe(1);
    }
  });

  it('keeps RAPID_REPEATED_TRANSFERS independent of the account-activity group', () => {
    // Receiver concentration is different information from "this account is
    // busy", so structuring must not be discounted as redundant.
    const results = applyCorrelationDampening([
      { ruleId: RULE_ID.HIGH_VELOCITY, rawContribution: 25 },
      { ruleId: RULE_ID.SUDDEN_ACTIVITY_INCREASE, rawContribution: 20 },
      { ruleId: RULE_ID.RAPID_REPEATED_TRANSFERS, rawContribution: 20 },
    ]);
    const byRule = Object.fromEntries(results.map((entry) => [entry.ruleId, entry]));

    expect(byRule[RULE_ID.HIGH_VELOCITY].contribution).toBe(25);
    expect(byRule[RULE_ID.SUDDEN_ACTIVITY_INCREASE].contribution).toBe(10);
    expect(byRule[RULE_ID.RAPID_REPEATED_TRANSFERS].contribution).toBe(20);
    expect(byRule[RULE_ID.RAPID_REPEATED_TRANSFERS].dampeningFactor).toBe(1);
  });

  it('preserves the input order in its output', () => {
    const input = [
      { ruleId: RULE_ID.HIGH_AMOUNT, rawContribution: 5 },
      { ruleId: RULE_ID.NEW_DEVICE, rawContribution: 15 },
      { ruleId: RULE_ID.HISTORICAL_AMOUNT_ANOMALY, rawContribution: 20 },
    ];
    const results = applyCorrelationDampening(input);
    expect(results.map((entry) => entry.ruleId)).toEqual(input.map((entry) => entry.ruleId));
  });
});

describe('severityForScore', () => {
  it('scales severity with how far past the alert threshold the score sits', () => {
    expect(severityForScore(70, thresholds)).toBe(ALERT_SEVERITY.LOW);
    expect(severityForScore(75, thresholds)).toBe(ALERT_SEVERITY.MEDIUM);
    expect(severityForScore(85, thresholds)).toBe(ALERT_SEVERITY.HIGH);
    expect(severityForScore(100, thresholds)).toBe(ALERT_SEVERITY.CRITICAL);
  });

  it('reports CRITICAL when the threshold leaves no headroom', () => {
    expect(severityForScore(100, { alertThreshold: 100 })).toBe(ALERT_SEVERITY.CRITICAL);
  });
});

describe('shouldCreateAlert', () => {
  it('creates an alert at or above the threshold, and not below', () => {
    expect(shouldCreateAlert(69, thresholds)).toBe(false);
    expect(shouldCreateAlert(70, thresholds)).toBe(true);
    expect(shouldCreateAlert(100, thresholds)).toBe(true);
  });
});
