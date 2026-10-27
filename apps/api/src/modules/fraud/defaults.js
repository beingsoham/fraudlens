import { DEFAULT_RISK_SETTINGS, RULE_CATALOGUE, RULE_IDS } from '@fraudlens/shared/constants';

/**
 * Default shapes for the fraud engine's inputs.
 *
 * These live apart from `features.js` and `ruleset.service.js` deliberately.
 * Both of those modules import the Prisma client, which imports the validated
 * configuration, which refuses to load without a database URL and signing
 * secrets. That is correct for a running server and wrong for these two
 * helpers, which perform no I/O and exist precisely so the engine can be
 * exercised without a database.
 *
 * Keeping them here is what lets the unit suite import them in an environment
 * that has no configuration at all — and keeps the engine honestly free of
 * database concerns rather than only nearly so.
 */

/**
 * Feature set for an account with no history at all.
 *
 * Used by the unit tests and as the documented shape of the contract between
 * `loadTransactionFeatures` and the pure engine.
 */
export function emptyFeatures(overrides = {}) {
  return {
    windows: {
      amountLookbackDays: 30,
      deviceLookbackDays: 90,
      timeLookbackDays: 30,
      velocityWindowMinutes: 10,
      pairWindowMinutes: 30,
      fanInWindowHours: 24,
      surgeRecentHours: 24,
      surgeBaselineDays: 14,
      convention: '(start, end] on occurredAt, excluding the assessed transaction',
    },
    sender: {
      historyCount: 0,
      amountHistory: [],
      amountHistoryCount: 0,
      amountMedian: null,
      amountMad: null,
      knownDevices: [],
      knownDeviceCount: 0,
      transactionsInVelocityWindow: 0,
      hourHistogram: Array.from({ length: 24 }, () => 0),
      hourHistoryCount: 0,
      firstSeenAt: null,
      recentCount: 0,
      recentValue: 0,
      baselineCount: 0,
      baselineValue: 0,
      ...(overrides.sender ?? {}),
    },
    pair: { transfersInWindow: 0, totalAmountInWindow: 0, ...(overrides.pair ?? {}) },
    receiver: {
      distinctSendersInWindow: 0,
      transactionsInWindow: 0,
      isMerchant: false,
      status: 'ACTIVE',
      ...(overrides.receiver ?? {}),
    },
    device: { fingerprint: 'device-unknown', isKnown: false, ...(overrides.device ?? {}) },
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([key]) => !['sender', 'pair', 'receiver', 'device'].includes(key),
      ),
    ),
  };
}

/**
 * Builds a ruleset from the catalogue defaults, without touching the database.
 * Used by the unit tests so engine behaviour is pinned to documented defaults
 * rather than to whatever happens to be configured locally.
 */
export function defaultRuleset(overrides = {}) {
  const rules = {};
  for (const rule of RULE_CATALOGUE) {
    rules[rule.ruleId] = {
      ruleId: rule.ruleId,
      name: rule.name,
      description: rule.description,
      enabled: true,
      weight: rule.weight,
      config: structuredClone(rule.config),
      configValid: true,
      rulesetVersion: 'test',
    };
  }

  const ruleset = {
    version: 'test',
    riskSettings: { ...DEFAULT_RISK_SETTINGS },
    riskSettingsValid: true,
    rules,
    enabledRuleIds: RULE_IDS,
    loadedAt: new Date(0),
  };

  // Shallow-merge overrides, then deep-merge the two nested objects callers
  // most often want to adjust.
  const merged = { ...ruleset, ...overrides };
  if (overrides.riskSettings) {
    merged.riskSettings = { ...ruleset.riskSettings, ...overrides.riskSettings };
  }
  if (overrides.rules) {
    merged.rules = { ...ruleset.rules };
    for (const [ruleId, patch] of Object.entries(overrides.rules)) {
      merged.rules[ruleId] = {
        ...(ruleset.rules[ruleId] ?? {}),
        ...patch,
        config: { ...(ruleset.rules[ruleId]?.config ?? {}), ...(patch.config ?? {}) },
      };
    }
    merged.enabledRuleIds = RULE_IDS.filter((ruleId) => merged.rules[ruleId]?.enabled);
  }
  return merged;
}
