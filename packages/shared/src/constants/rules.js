/**
 * Fraud detection rule catalogue.
 *
 * Each entry documents the rule's identifier, its default scoring weight, the
 * configuration parameters it accepts, and what evidence it records. These are
 * *initial engineering parameters chosen for a demonstration dataset* — they
 * are not validated financial risk thresholds and must be tuned against real
 * labelled data before any operational use.
 */

export const RULE_ID = {
  HIGH_AMOUNT: 'HIGH_AMOUNT',
  HISTORICAL_AMOUNT_ANOMALY: 'HISTORICAL_AMOUNT_ANOMALY',
  HIGH_VELOCITY: 'HIGH_VELOCITY',
  NEW_DEVICE: 'NEW_DEVICE',
  RAPID_REPEATED_TRANSFERS: 'RAPID_REPEATED_TRANSFERS',
  SUSPICIOUS_RECEIVER_FANIN: 'SUSPICIOUS_RECEIVER_FANIN',
  UNUSUAL_TRANSACTION_TIME: 'UNUSUAL_TRANSACTION_TIME',
  SUDDEN_ACTIVITY_INCREASE: 'SUDDEN_ACTIVITY_INCREASE',
};
export const RULE_IDS = Object.values(RULE_ID);

/**
 * The full rule catalogue. `config` holds the default, operator-editable
 * parameters; `weight` is the maximum risk contribution the rule can add.
 */
export const RULE_CATALOGUE = [
  {
    ruleId: RULE_ID.HIGH_AMOUNT,
    name: 'High transaction amount',
    description:
      'Triggers when a transaction exceeds an absolute amount threshold. Contribution scales ' +
      'linearly between the threshold and the saturation amount, so a payment far above the ' +
      'threshold scores higher than one just over it.',
    weight: 20,
    config: {
      /** Amount at or above which the rule begins to contribute. */
      thresholdAmount: 50000,
      /** Amount at which the rule contributes its full weight. */
      saturationAmount: 200000,
    },
    evidenceFields: ['amount', 'thresholdAmount', 'saturationAmount'],
  },
  {
    ruleId: RULE_ID.HISTORICAL_AMOUNT_ANOMALY,
    name: 'Unusual amount for this sender',
    description:
      "Compares the amount against the sender's own historical distribution using a robust " +
      'z-score (median and median absolute deviation). Requires a minimum number of prior ' +
      'transactions; otherwise the rule abstains instead of guessing.',
    weight: 20,
    config: {
      /** Minimum prior transactions required before the rule may trigger. */
      minHistoryCount: 5,
      /** Robust z-score at which the rule begins to contribute. */
      zScoreThreshold: 3,
      /** Robust z-score at which the rule contributes its full weight. */
      zScoreSaturation: 8,
      /** Lookback window, in days, used to build the sender's amount history. */
      lookbackDays: 30,
    },
    evidenceFields: ['amount', 'median', 'mad', 'robustZScore', 'historyCount'],
  },
  {
    ruleId: RULE_ID.HIGH_VELOCITY,
    name: 'Excessive transaction velocity',
    description:
      'Counts how many transactions the sender initiated inside a short rolling window ' +
      'immediately before this one. A high count in a short period is a classic indicator of ' +
      'automated or coerced activity.',
    weight: 25,
    config: {
      /** Rolling window length in minutes, ending at the transaction timestamp. */
      windowMinutes: 10,
      /** Count at or above which the rule begins to contribute. */
      countThreshold: 5,
      /** Count at which the rule contributes its full weight. */
      countSaturation: 15,
    },
    evidenceFields: ['windowMinutes', 'transactionsInWindow', 'countThreshold'],
  },
  {
    ruleId: RULE_ID.NEW_DEVICE,
    name: 'Previously unseen device',
    description:
      'Triggers when the device fingerprint has never been observed for the sender before. ' +
      'The contribution is reduced for brand-new accounts, where every device is necessarily ' +
      'unseen and the signal carries little information.',
    weight: 15,
    config: {
      /** Lookback window, in days, used to build the sender's known-device set. */
      lookbackDays: 90,
      /**
       * Below this many prior transactions the account is treated as new and the
       * contribution is multiplied by `newAccountDampening`.
       */
      minHistoryCount: 3,
      newAccountDampening: 0.4,
    },
    evidenceFields: ['deviceFingerprint', 'knownDeviceCount', 'historyCount', 'isNewAccount'],
  },
  {
    ruleId: RULE_ID.RAPID_REPEATED_TRANSFERS,
    name: 'Repeated rapid transfers between the same accounts',
    description:
      'Counts prior transfers on the same sender -> receiver pair inside a short rolling ' +
      'window. Structuring a large payment into several small ones is a common evasion ' +
      'pattern.',
    weight: 20,
    config: {
      windowMinutes: 30,
      /** Prior transfers on the same pair at or above which the rule contributes. */
      countThreshold: 3,
      countSaturation: 8,
    },
    evidenceFields: ['windowMinutes', 'pairTransfersInWindow', 'countThreshold', 'pairTotalAmount'],
  },
  {
    ruleId: RULE_ID.SUSPICIOUS_RECEIVER_FANIN,
    name: 'Receiver collecting from many distinct senders',
    description:
      'Counts how many distinct senders paid this receiver inside a rolling window. A high ' +
      'fan-in is characteristic of mule accounts aggregating proceeds.',
    weight: 25,
    config: {
      windowHours: 24,
      /** Distinct senders at or above which the rule begins to contribute. */
      distinctSenderThreshold: 8,
      distinctSenderSaturation: 20,
    },
    evidenceFields: ['windowHours', 'distinctSenders', 'distinctSenderThreshold'],
  },
  {
    ruleId: RULE_ID.UNUSUAL_TRANSACTION_TIME,
    name: 'Unusual transaction time for this sender',
    description:
      'Triggers when the transaction falls in an hour of day the sender has rarely used, and ' +
      'only when enough history exists to establish a normal pattern. Abstains for accounts ' +
      'without an established routine.',
    weight: 10,
    config: {
      /** Minimum prior transactions required before the rule may trigger. */
      minHistoryCount: 10,
      lookbackDays: 30,
      /**
       * Share of the sender's historical activity that must fall in this hour for
       * the hour to count as normal. Below this share, the rule contributes.
       */
      rareHourShare: 0.05,
      /** Hours always treated as elevated risk when history is sufficient. */
      quietHoursUtc: [0, 1, 2, 3, 4],
    },
    evidenceFields: ['hourUtc', 'hourShare', 'rareHourShare', 'historyCount', 'isQuietHour'],
  },
  {
    ruleId: RULE_ID.SUDDEN_ACTIVITY_INCREASE,
    name: 'Sudden increase in activity',
    description:
      "Compares the sender's transaction count and value over the last 24 hours against their " +
      'preceding baseline. A sharp jump against an established baseline indicates account ' +
      'takeover or a burst of coerced payments.',
    weight: 20,
    config: {
      /** Recent window, in hours, that is compared against the baseline. */
      recentWindowHours: 24,
      /** Baseline window, in days, immediately preceding the recent window. */
      baselineWindowDays: 14,
      /** Minimum baseline transactions required before the rule may trigger. */
      minBaselineCount: 7,
      /** Ratio of recent-to-baseline daily rate at which the rule contributes. */
      ratioThreshold: 3,
      ratioSaturation: 10,
    },
    evidenceFields: [
      'recentCount',
      'recentValue',
      'baselineDailyCount',
      'baselineDailyValue',
      'countRatio',
      'valueRatio',
    ],
  },
];

/** Rule id -> catalogue entry. */
export const RULE_BY_ID = Object.fromEntries(RULE_CATALOGUE.map((rule) => [rule.ruleId, rule]));

/** Default weights, as specified in the product requirements. */
export const DEFAULT_RULE_WEIGHTS = Object.fromEntries(
  RULE_CATALOGUE.map((rule) => [rule.ruleId, rule.weight]),
);

/**
 * Groups of rules that measure correlated phenomena.
 *
 * Within a group the strongest contribution counts in full and each subsequent
 * one is dampened (see `CORRELATION_DAMPENING`). This stops a single underlying
 * behaviour — one very large payment, say — from being counted three times by
 * three amount-sensitive rules.
 */
export const CORRELATION_GROUPS = {
  /**
   * Both rules fire on the same scalar — this payment's amount — so a single
   * large payment would otherwise be counted twice.
   */
  amount: [RULE_ID.HIGH_AMOUNT, RULE_ID.HISTORICAL_AMOUNT_ANOMALY],
  /**
   * Both rules say "this account is transacting more than it usually does",
   * one over ten minutes and one over a day against a fortnight's baseline.
   *
   * `RAPID_REPEATED_TRANSFERS` is deliberately *not* in this group. It measures
   * concentration on a single sender -> receiver edge, which is different
   * information: a sender can have high velocity spread across ten
   * counterparties with no repetition at all, or repeat to one counterparty
   * without crossing the velocity threshold. Discounting it as redundant would
   * systematically under-score structuring, which is the one pattern it exists
   * to catch.
   */
  accountActivity: [RULE_ID.HIGH_VELOCITY, RULE_ID.SUDDEN_ACTIVITY_INCREASE],
};

/**
 * Multiplier applied to the Nth strongest contribution within a correlation
 * group (index 0 = strongest). Contributions beyond the list use the last value.
 */
export const CORRELATION_DAMPENING = [1, 0.5, 0.25];

/** Rule id -> correlation group name, or undefined when the rule is independent. */
export const RULE_CORRELATION_GROUP = Object.fromEntries(
  Object.entries(CORRELATION_GROUPS).flatMap(([group, ruleIds]) =>
    ruleIds.map((ruleId) => [ruleId, group]),
  ),
);

/** Maximum achievable risk score. The additive policy is capped here. */
export const MAX_RISK_SCORE = 100;

/** Default risk-category boundaries and alert threshold. */
export const DEFAULT_RISK_SETTINGS = {
  mediumThreshold: 30,
  highThreshold: 70,
  alertThreshold: 70,
};
