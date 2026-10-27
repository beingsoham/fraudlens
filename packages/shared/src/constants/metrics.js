/**
 * Documented definitions for every figure the dashboard and analytics pages
 * display. The API returns these alongside the numbers so the UI can show the
 * exact definition in a tooltip, and so nobody has to guess what a tile means.
 *
 * Every value is computed from persisted application data. None is hardcoded.
 */

export const METRIC_DEFINITIONS = {
  totalTransactions: {
    label: 'Total transactions',
    definition:
      'Count of all transaction rows persisted in the database, ignoring any date filter.',
  },
  transactionsToday: {
    label: 'Received today',
    definition:
      'Count of transactions whose `occurredAt` timestamp falls within the current UTC day.',
  },
  transactionsInRange: {
    label: 'Transactions in range',
    definition:
      'Count of transactions whose `occurredAt` timestamp falls inside the selected date range.',
  },
  highRiskTransactions: {
    label: 'High-risk transactions',
    definition:
      'Transactions in range whose latest risk assessment has category HIGH. A high risk score ' +
      'indicates suspicious characteristics; it is not a finding of fraud.',
  },
  openAlerts: {
    label: 'Open alerts',
    definition:
      'Alerts in range whose workflow status is OPEN or IN_REVIEW — that is, not yet resolved.',
  },
  flaggedValue: {
    label: 'Flagged transaction value',
    definition:
      'Sum of the amounts of transactions in range whose latest risk assessment has category ' +
      'HIGH. Flagged value is value under review, not confirmed loss.',
  },
  confirmedFraudCases: {
    label: 'Confirmed fraud cases',
    definition:
      'Alerts in range that a human investigator resolved with the outcome CONFIRMED_FRAUD. ' +
      'This is the only figure on the dashboard that represents confirmed fraud.',
  },
  confirmedFraudValue: {
    label: 'Confirmed fraud value',
    definition:
      'Sum of the transaction amounts behind alerts resolved as CONFIRMED_FRAUD within range.',
  },
  averageRiskScore: {
    label: 'Average risk score',
    definition:
      'Mean of the latest risk score across transactions in range, rounded to one decimal.',
  },
  alertResolutionRate: {
    label: 'Resolution rate',
    definition:
      'Alerts in range with status RESOLVED divided by all alerts created in range, as a ' +
      'percentage.',
  },
  medianTimeToResolve: {
    label: 'Median time to resolve',
    definition: 'Median of (`resolvedAt` - `createdAt`) across alerts resolved in range, in hours.',
  },
};

/**
 * Definitions for detection-performance metrics.
 *
 * These are *model evaluation* metrics, not observed application statistics.
 * They are only meaningful where reliable ground truth exists, which in this
 * application means transactions carrying a simulator scenario label or an
 * alert resolved by a human investigator. The API reports the size of the
 * labelled sample alongside every metric and withholds the metrics entirely
 * when the sample is too small to be meaningful.
 */
export const DETECTION_METRIC_DEFINITIONS = {
  truePositives: {
    label: 'True positives',
    definition:
      'Labelled-fraudulent transactions the engine scored at or above the alert threshold.',
  },
  falsePositives: {
    label: 'False positives',
    definition:
      'Labelled-legitimate transactions the engine scored at or above the alert threshold.',
  },
  trueNegatives: {
    label: 'True negatives',
    definition: 'Labelled-legitimate transactions the engine scored below the alert threshold.',
  },
  falseNegatives: {
    label: 'False negatives',
    definition: 'Labelled-fraudulent transactions the engine scored below the alert threshold.',
  },
  precision: {
    label: 'Precision',
    definition: 'truePositives / (truePositives + falsePositives). Undefined with no positives.',
  },
  recall: {
    label: 'Recall',
    definition:
      'truePositives / (truePositives + falseNegatives). Undefined with no actual positives.',
  },
  f1Score: {
    label: 'F1 score',
    definition: 'Harmonic mean of precision and recall: 2PR / (P + R).',
  },
  falsePositiveRate: {
    label: 'False-positive rate',
    definition: 'falsePositives / (falsePositives + trueNegatives).',
  },
};

/**
 * Minimum number of labelled transactions required before detection-performance
 * metrics are reported at all. Below this the API returns `available: false`
 * rather than a number that would invite over-interpretation.
 */
export const MIN_LABELLED_SAMPLE_FOR_METRICS = 50;

/** Ground-truth sources the detection-performance endpoint can evaluate against. */
export const GROUND_TRUTH_SOURCE = {
  SIMULATOR: 'SIMULATOR',
  INVESTIGATION: 'INVESTIGATION',
};
