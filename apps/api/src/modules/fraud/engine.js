import { RULE_BY_ID, RULE_IDS } from '@fraudlens/shared/constants';
import { RULE_IMPLEMENTATIONS, RULE_STATUS } from './rules.js';
import {
  applyCorrelationDampening,
  categoriseRisk,
  computeRiskScore,
  severityForScore,
  shouldCreateAlert,
} from './scoring.js';

/**
 * The fraud detection engine.
 *
 * This module is deliberately free of HTTP and database concerns: it takes a
 * transaction, a pre-computed feature set and a ruleset, and returns an
 * assessment. That makes it exhaustively unit-testable, and it means the same
 * engine serves HTTP ingestion, the simulator and any future batch
 * re-assessment without a line of duplicated logic.
 *
 * FraudLens is an analytics and investigation system. An assessment is a signal
 * for human review — it never blocks a payment and is never, on its own,
 * evidence of criminal activity.
 */

/**
 * Assesses one transaction.
 *
 * @param {object} params
 * @param {{amount: number, occurredAt: Date, senderRef?: string, receiverRef?: string}} params.transaction
 * @param {object} params.features Output of `loadTransactionFeatures`.
 * @param {object} params.ruleset Output of `getActiveRuleset`.
 * @returns {{
 *   riskScore: number,
 *   riskCategory: string,
 *   rulesetVersion: string,
 *   triggeredRuleIds: string[],
 *   triggeredRules: object[],
 *   explanations: string[],
 *   ruleResults: object[],
 *   alert: {shouldCreate: boolean, severity: string|null},
 *   thresholds: object
 * }}
 */
export function assessTransaction({ transaction, features, ruleset }) {
  if (!transaction || typeof transaction.amount !== 'number') {
    throw new TypeError('assessTransaction requires a transaction with a numeric amount');
  }
  if (!(transaction.occurredAt instanceof Date) || Number.isNaN(transaction.occurredAt.getTime())) {
    throw new TypeError('assessTransaction requires a valid `occurredAt` Date');
  }
  if (!features || !ruleset) {
    throw new TypeError('assessTransaction requires both `features` and `ruleset`');
  }

  const ruleResults = [];
  const rawContributions = [];

  // Iterate the catalogue in a fixed order so the output is deterministic
  // regardless of the order rules happen to come back from the database.
  for (const ruleId of RULE_IDS) {
    const definition = ruleset.rules[ruleId];
    const catalogue = RULE_BY_ID[ruleId];

    if (!definition) {
      // A rule in the catalogue but absent from the database: record it as
      // unavailable rather than silently scoring zero.
      ruleResults.push({
        ruleId,
        name: catalogue?.name ?? ruleId,
        status: 'UNAVAILABLE',
        weight: 0,
        rawContribution: 0,
        contribution: 0,
        evidence: null,
        explanation: null,
        reason: 'Rule is not configured in this database',
      });
      continue;
    }

    if (!definition.enabled) {
      ruleResults.push({
        ruleId,
        name: definition.name,
        status: 'DISABLED',
        weight: definition.weight,
        rawContribution: 0,
        contribution: 0,
        evidence: null,
        explanation: null,
        reason: 'Rule is disabled in the active ruleset',
      });
      continue;
    }

    const implementation = RULE_IMPLEMENTATIONS[ruleId];
    const result = implementation({
      transaction,
      features,
      config: definition.config,
      weight: definition.weight,
    });

    const rawContribution =
      result.status === RULE_STATUS.TRIGGERED ? result.fraction * definition.weight : 0;

    ruleResults.push({
      ruleId,
      name: definition.name,
      status: result.status,
      weight: definition.weight,
      fraction: Math.round(result.fraction * 1000) / 1000,
      rawContribution: Math.round(rawContribution * 100) / 100,
      contribution: 0, // filled in after dampening
      evidence: result.evidence ?? null,
      explanation: result.explanation ?? null,
      reason: result.reason ?? null,
    });

    if (result.status === RULE_STATUS.TRIGGERED) {
      rawContributions.push({ ruleId, rawContribution });
    }
  }

  const dampened = applyCorrelationDampening(rawContributions);
  const dampenedByRule = new Map(dampened.map((entry) => [entry.ruleId, entry]));

  for (const result of ruleResults) {
    const entry = dampenedByRule.get(result.ruleId);
    if (entry) {
      result.contribution = Math.round(entry.contribution * 100) / 100;
      result.dampeningFactor = entry.dampeningFactor;
      if (entry.correlationGroup) {
        result.correlationGroup = entry.correlationGroup;
        result.correlationRank = entry.correlationRank;
      }
    }
  }

  const riskScore = computeRiskScore(dampened);
  const riskCategory = categoriseRisk(riskScore, ruleset.riskSettings);

  const triggered = ruleResults.filter((result) => result.status === RULE_STATUS.TRIGGERED);
  // Highest contribution first: the explanation should lead with the reason
  // that actually drove the score.
  const triggeredByImpact = [...triggered].sort((a, b) => b.contribution - a.contribution);

  const explanations = buildExplanations({
    riskScore,
    riskCategory,
    triggered: triggeredByImpact,
    abstained: ruleResults.filter((result) => result.status === RULE_STATUS.ABSTAINED),
    ruleset,
  });

  const createAlert = shouldCreateAlert(riskScore, ruleset.riskSettings);

  return {
    riskScore,
    riskCategory,
    rulesetVersion: ruleset.version,
    triggeredRuleIds: triggeredByImpact.map((result) => result.ruleId),
    /** Per-rule evidence persisted to `risk_assessments.triggered_rules`. */
    triggeredRules: triggeredByImpact.map((result) => ({
      ruleId: result.ruleId,
      name: result.name,
      weight: result.weight,
      fraction: result.fraction,
      rawContribution: result.rawContribution,
      contribution: result.contribution,
      dampeningFactor: result.dampeningFactor ?? 1,
      correlationGroup: result.correlationGroup ?? null,
      evidence: result.evidence,
      explanation: result.explanation,
    })),
    explanations,
    /** Every rule's outcome, including those that did not fire or abstained. */
    ruleResults,
    alert: {
      shouldCreate: createAlert,
      severity: createAlert ? severityForScore(riskScore, ruleset.riskSettings) : null,
    },
    thresholds: { ...ruleset.riskSettings },
  };
}

/**
 * Builds the ordered, human-readable explanation of a score.
 *
 * The first sentence states the score and what it does and does not mean; the
 * rest give each triggered rule's reasoning, then note any rule that could not
 * judge for lack of history — because "we could not evaluate this" is part of
 * an honest explanation.
 */
function buildExplanations({ riskScore, riskCategory, triggered, abstained, ruleset }) {
  const lines = [];

  if (triggered.length === 0) {
    lines.push(
      `Risk score ${riskScore} of 100 (${riskCategory}). No detection rule was triggered by this transaction.`,
    );
  } else {
    lines.push(
      `Risk score ${riskScore} of 100 (${riskCategory}), from ${triggered.length} triggered ${
        triggered.length === 1 ? 'rule' : 'rules'
      } under ruleset ${ruleset.version}. A risk score indicates characteristics warranting review; it is not a finding of fraud.`,
    );

    for (const result of triggered) {
      const dampening =
        result.dampeningFactor !== undefined && result.dampeningFactor < 1
          ? ` Contribution reduced to ${result.contribution} of ${result.rawContribution} because it overlaps with another ${result.correlationGroup} indicator already counted.`
          : '';
      lines.push(`${result.name}: ${result.explanation} (+${result.contribution})${dampening}`);
    }
  }

  for (const result of abstained) {
    lines.push(`${result.name}: not evaluated. ${result.reason}`);
  }

  return lines;
}

export { buildExplanations };
