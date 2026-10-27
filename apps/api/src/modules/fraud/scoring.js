import {
  CORRELATION_DAMPENING,
  MAX_RISK_SCORE,
  RISK_CATEGORY,
  RULE_CORRELATION_GROUP,
  ALERT_SEVERITY,
} from '@fraudlens/shared/constants';

/**
 * The scoring policy.
 *
 * ## Additive, dampened, capped
 *
 * Each triggered rule earns `fraction x weight`, where `fraction` is in `[0,1]`
 * and `weight` is the rule's configured maximum contribution. Contributions are
 * summed and the total is capped at 100.
 *
 * For the rules shaped by a threshold, `fraction` starts at 0.5 the moment the
 * threshold is crossed and ramps to 1.0 at the configured saturation point (see
 * `thresholdFraction`). Crossing an operator-chosen threshold is itself the
 * signal, so it earns half the weight; the rest reflects how far past it the
 * value sits.
 *
 * Pure addition would double-count: one very large payment satisfies both
 * `HIGH_AMOUNT` and `HISTORICAL_AMOUNT_ANOMALY`, and a burst of payments
 * satisfies all three velocity rules, so a single underlying behaviour could
 * contribute 40 or 65 points on its own. To prevent that, rules are grouped by
 * the phenomenon they measure (see `CORRELATION_GROUPS`). Within a group the
 * strongest contribution counts in full, the second at 50%, and any further one
 * at 25%. Rules outside any group are never dampened.
 *
 * The result is deterministic: the same inputs, features and ruleset version
 * always produce the same score.
 *
 * These weights and thresholds are initial engineering parameters, not
 * validated financial risk thresholds.
 */

/**
 * Applies correlation dampening to a list of raw contributions.
 *
 * @param {{ruleId: string, rawContribution: number}[]} contributions
 * @returns {{ruleId: string, rawContribution: number, dampeningFactor: number, contribution: number}[]}
 */
export function applyCorrelationDampening(contributions) {
  /** group name -> how many contributions from that group have been seen. */
  const seenPerGroup = new Map();

  // Strongest first, so the rule that contributed most within a group keeps its
  // full value and the weaker, correlated ones are the ones discounted.
  const ordered = [...contributions].sort((a, b) => b.rawContribution - a.rawContribution);

  const dampened = ordered.map((entry) => {
    const group = RULE_CORRELATION_GROUP[entry.ruleId];
    if (!group) {
      return { ...entry, dampeningFactor: 1, contribution: entry.rawContribution };
    }
    const rank = seenPerGroup.get(group) ?? 0;
    seenPerGroup.set(group, rank + 1);
    const factor = CORRELATION_DAMPENING[Math.min(rank, CORRELATION_DAMPENING.length - 1)];
    return {
      ...entry,
      correlationGroup: group,
      correlationRank: rank,
      dampeningFactor: factor,
      contribution: entry.rawContribution * factor,
    };
  });

  // Restore the caller's order so the output is stable and comparable.
  const indexOf = new Map(contributions.map((entry, index) => [entry.ruleId, index]));
  return dampened.sort((a, b) => indexOf.get(a.ruleId) - indexOf.get(b.ruleId));
}

/** Sums dampened contributions into a final integer score in `[0, 100]`. */
export function computeRiskScore(dampenedContributions) {
  const total = dampenedContributions.reduce((sum, entry) => sum + entry.contribution, 0);
  return Math.min(MAX_RISK_SCORE, Math.max(0, Math.round(total)));
}

/**
 * Maps a score to a risk category using the configured boundaries.
 *
 * Boundaries are inclusive lower bounds: with the defaults (30, 70), 0-29 is
 * LOW, 30-69 is MEDIUM and 70-100 is HIGH.
 */
export function categoriseRisk(score, { mediumThreshold, highThreshold }) {
  if (score >= highThreshold) return RISK_CATEGORY.HIGH;
  if (score >= mediumThreshold) return RISK_CATEGORY.MEDIUM;
  return RISK_CATEGORY.LOW;
}

/**
 * Severity for an alert raised at `score`.
 *
 * Severity is a property of the alert, assigned once at creation from the score
 * that triggered it, and never recomputed — so the urgency an investigator saw
 * in their queue stays reconstructable even if thresholds are later retuned.
 */
export function severityForScore(score, { alertThreshold }) {
  const headroom = MAX_RISK_SCORE - alertThreshold;
  if (headroom <= 0) return ALERT_SEVERITY.CRITICAL;
  const position = (score - alertThreshold) / headroom;
  if (position >= 0.75) return ALERT_SEVERITY.CRITICAL;
  if (position >= 0.4) return ALERT_SEVERITY.HIGH;
  if (position >= 0.15) return ALERT_SEVERITY.MEDIUM;
  return ALERT_SEVERITY.LOW;
}

/** True when a score warrants creating an alert. */
export function shouldCreateAlert(score, { alertThreshold }) {
  return score >= alertThreshold;
}
