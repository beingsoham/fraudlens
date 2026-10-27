/**
 * Enumerations shared between the API and the web client.
 *
 * These values mirror the PostgreSQL enums declared in `prisma/schema.prisma`.
 * Keeping them in one place prevents the frontend and backend from drifting.
 */

/** Risk category assigned to a transaction by the fraud engine. */
export const RISK_CATEGORY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
};
export const RISK_CATEGORIES = Object.values(RISK_CATEGORY);

/**
 * Alert workflow status. This tracks *where the alert is in the review
 * process* and is stored separately from the investigation outcome.
 */
export const ALERT_STATUS = {
  OPEN: 'OPEN',
  IN_REVIEW: 'IN_REVIEW',
  RESOLVED: 'RESOLVED',
};
export const ALERT_STATUSES = Object.values(ALERT_STATUS);

/**
 * Investigation outcome. This records *what a human concluded* and is
 * deliberately independent of the workflow status above. An alert only has a
 * conclusive outcome once an investigator resolves it.
 */
export const INVESTIGATION_OUTCOME = {
  PENDING: 'PENDING',
  CONFIRMED_FRAUD: 'CONFIRMED_FRAUD',
  LEGITIMATE: 'LEGITIMATE',
  INCONCLUSIVE: 'INCONCLUSIVE',
};
export const INVESTIGATION_OUTCOMES = Object.values(INVESTIGATION_OUTCOME);

/** Alert severity, derived from the risk score at alert-creation time. */
export const ALERT_SEVERITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};
export const ALERT_SEVERITIES = Object.values(ALERT_SEVERITY);

/** Ordering weight used when sorting alerts by severity. */
export const ALERT_SEVERITY_RANK = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

/** Synthetic payment channel of a transaction. */
export const TRANSACTION_CHANNEL = {
  UPI_P2P: 'UPI_P2P',
  UPI_P2M: 'UPI_P2M',
  QR_CODE: 'QR_CODE',
  COLLECT_REQUEST: 'COLLECT_REQUEST',
  AUTOPAY_MANDATE: 'AUTOPAY_MANDATE',
};
export const TRANSACTION_CHANNELS = Object.values(TRANSACTION_CHANNEL);

/** Processing status of a transaction record. */
export const TRANSACTION_STATUS = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
};
export const TRANSACTION_STATUSES = Object.values(TRANSACTION_STATUS);

/** Lifecycle status of a synthetic payment account. */
export const ACCOUNT_STATUS = {
  ACTIVE: 'ACTIVE',
  DORMANT: 'DORMANT',
  SUSPENDED: 'SUSPENDED',
  CLOSED: 'CLOSED',
};
export const ACCOUNT_STATUSES = Object.values(ACCOUNT_STATUS);

/**
 * Ground-truth scenario labels produced by the transaction simulator.
 *
 * These describe the behaviour the generator *intended* to emit. They are
 * stored in `transaction_labels`, never in `risk_assessments`, so that model
 * evaluation can compare predictions against labels without contamination.
 */
export const SCENARIO_LABEL = {
  NORMAL: 'NORMAL',
  HIGH_VALUE: 'HIGH_VALUE',
  RAPID_TRANSFER: 'RAPID_TRANSFER',
  NEW_DEVICE: 'NEW_DEVICE',
  SUSPICIOUS_RECEIVER: 'SUSPICIOUS_RECEIVER',
  VOLUME_SPIKE: 'VOLUME_SPIKE',
};
export const SCENARIO_LABELS = Object.values(SCENARIO_LABEL);

/**
 * Scenario labels that are considered fraudulent ground truth when computing
 * detection-performance metrics. `NORMAL` is the negative class.
 */
export const FRAUDULENT_SCENARIO_LABELS = [
  SCENARIO_LABEL.HIGH_VALUE,
  SCENARIO_LABEL.RAPID_TRANSFER,
  SCENARIO_LABEL.NEW_DEVICE,
  SCENARIO_LABEL.SUSPICIOUS_RECEIVER,
  SCENARIO_LABEL.VOLUME_SPIKE,
];

/** Where a label came from — the simulator, or a human investigation. */
export const LABEL_SOURCE = {
  SIMULATOR: 'SIMULATOR',
  INVESTIGATION: 'INVESTIGATION',
};
export const LABEL_SOURCES = Object.values(LABEL_SOURCE);

export const CURRENCIES = ['INR'];
export const DEFAULT_CURRENCY = 'INR';
