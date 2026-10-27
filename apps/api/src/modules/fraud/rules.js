import { RULE_ID } from '@fraudlens/shared/constants';
import { robustZScore, thresholdFraction } from '../../utils/stats.js';

/**
 * The eight detection rules, as pure functions.
 *
 * A rule receives `{ transaction, features, config, weight }` and returns a
 * result; it performs no I/O and reads no clock, so the same inputs always
 * produce the same output and each rule is testable in isolation.
 *
 * ## Result contract
 *
 * ```
 * {
 *   status: 'TRIGGERED' | 'NOT_TRIGGERED' | 'ABSTAINED',
 *   fraction: 0..1,        // share of the rule's weight that was earned
 *   evidence: object,      // the feature values the rule actually looked at
 *   explanation: string,   // one human-readable sentence
 *   reason?: string,       // why the rule abstained
 * }
 * ```
 *
 * `ABSTAINED` is deliberately distinct from `NOT_TRIGGERED`. "This account has
 * no history, so I cannot judge" is different information from "I looked and
 * this is normal", and conflating the two would quietly make every new account
 * look safe.
 */

const TRIGGERED = 'TRIGGERED';
const NOT_TRIGGERED = 'NOT_TRIGGERED';
const ABSTAINED = 'ABSTAINED';

export const RULE_STATUS = { TRIGGERED, NOT_TRIGGERED, ABSTAINED };

const triggered = (fraction, evidence, explanation) => ({
  status: TRIGGERED,
  fraction,
  evidence,
  explanation,
});

const notTriggered = (evidence, explanation) => ({
  status: NOT_TRIGGERED,
  fraction: 0,
  evidence,
  explanation,
});

const abstained = (reason, evidence) => ({
  status: ABSTAINED,
  fraction: 0,
  evidence,
  reason,
  explanation: null,
});

/** Formats an amount for an explanation sentence. */
function money(value) {
  return `INR ${Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---------------------------------------------------------------------------
// 1. High transaction amount
// ---------------------------------------------------------------------------

function highAmount({ transaction, config }) {
  const { amount } = transaction;
  const { thresholdAmount, saturationAmount } = config;
  const evidence = { amount, thresholdAmount, saturationAmount };

  if (amount < thresholdAmount) {
    return notTriggered(
      evidence,
      `Amount ${money(amount)} is below the ${money(thresholdAmount)} high-amount threshold.`,
    );
  }

  const fraction = thresholdFraction(amount, thresholdAmount, saturationAmount);
  return triggered(
    fraction,
    evidence,
    `Amount ${money(amount)} is at or above the ${money(thresholdAmount)} high-amount threshold.`,
  );
}

// ---------------------------------------------------------------------------
// 2. Unusual amount compared with the sender's own history
// ---------------------------------------------------------------------------

function historicalAmountAnomaly({ transaction, features, config }) {
  const { amount } = transaction;
  const { amountHistory, amountMedian, amountMad, amountHistoryCount } = features.sender;
  const { minHistoryCount, zScoreThreshold, zScoreSaturation } = config;

  if (amountHistoryCount < minHistoryCount) {
    return abstained(
      `Only ${amountHistoryCount} prior transactions in the lookback window; ${minHistoryCount} are needed to judge whether this amount is unusual.`,
      { historyCount: amountHistoryCount, minHistoryCount },
    );
  }

  const zScore = robustZScore(amount, amountHistory, {
    median: amountMedian,
    mad: amountMad,
  });

  const evidence = {
    amount,
    median: amountMedian,
    mad: amountMad,
    robustZScore: zScore === null ? null : Math.round(zScore * 100) / 100,
    historyCount: amountHistoryCount,
    zScoreThreshold,
  };

  // Only upward deviations matter: an unusually *small* payment is not a fraud
  // indicator on its own.
  if (zScore === null || zScore < zScoreThreshold) {
    return notTriggered(
      evidence,
      `Amount ${money(amount)} is consistent with this sender's usual range (median ${money(
        amountMedian ?? 0,
      )}).`,
    );
  }

  const fraction = thresholdFraction(zScore, zScoreThreshold, zScoreSaturation);
  return triggered(
    fraction,
    evidence,
    `Amount ${money(amount)} is ${evidence.robustZScore} robust standard deviations above this sender's median of ${money(
      amountMedian,
    )} over ${amountHistoryCount} prior transactions.`,
  );
}

// ---------------------------------------------------------------------------
// 3. Excessive transaction velocity
// ---------------------------------------------------------------------------

function highVelocity({ features, config }) {
  const count = features.sender.transactionsInVelocityWindow;
  const { windowMinutes, countThreshold, countSaturation } = config;
  const evidence = {
    windowMinutes,
    transactionsInWindow: count,
    countThreshold,
  };

  if (count < countThreshold) {
    return notTriggered(
      evidence,
      `${count} prior transactions in the preceding ${windowMinutes} minutes, below the threshold of ${countThreshold}.`,
    );
  }

  const fraction = thresholdFraction(count, countThreshold, countSaturation);
  return triggered(
    fraction,
    evidence,
    `Sender made ${count} transactions in the preceding ${windowMinutes} minutes (threshold ${countThreshold}).`,
  );
}

// ---------------------------------------------------------------------------
// 4. Previously unseen device
// ---------------------------------------------------------------------------

function newDevice({ features, config }) {
  const { fingerprint, isKnown } = features.device;
  const { historyCount, knownDeviceCount } = features.sender;
  const { minHistoryCount, newAccountDampening } = config;

  const isNewAccount = historyCount < minHistoryCount;
  const evidence = {
    // Truncated: the full synthetic fingerprint adds nothing to an explanation.
    deviceFingerprint: `${String(fingerprint).slice(0, 12)}...`,
    knownDeviceCount,
    historyCount,
    isNewAccount,
  };

  if (isKnown) {
    return notTriggered(
      evidence,
      `Device has been seen before for this sender (${knownDeviceCount} known devices).`,
    );
  }

  if (historyCount === 0) {
    return abstained(
      'Sender has no prior transactions, so every device is necessarily unseen and the signal carries no information.',
      evidence,
    );
  }

  // For an account with little history the "new device" signal is weak, because
  // the known-device set has barely been established yet.
  const fraction = isNewAccount ? newAccountDampening : 1;
  return triggered(
    fraction,
    evidence,
    isNewAccount
      ? `Device not seen before, though this sender has only ${historyCount} prior transactions, so the signal is weak.`
      : `Device has never been used by this sender before (${knownDeviceCount} known devices over ${historyCount} prior transactions).`,
  );
}

// ---------------------------------------------------------------------------
// 5. Repeated rapid transfers between the same two accounts
// ---------------------------------------------------------------------------

function rapidRepeatedTransfers({ features, config }) {
  const { transfersInWindow, totalAmountInWindow } = features.pair;
  const { windowMinutes, countThreshold, countSaturation } = config;
  const evidence = {
    windowMinutes,
    pairTransfersInWindow: transfersInWindow,
    countThreshold,
    pairTotalAmount: totalAmountInWindow,
  };

  if (transfersInWindow < countThreshold) {
    return notTriggered(
      evidence,
      `${transfersInWindow} prior transfers to this receiver in the preceding ${windowMinutes} minutes, below the threshold of ${countThreshold}.`,
    );
  }

  const fraction = thresholdFraction(transfersInWindow, countThreshold, countSaturation);
  return triggered(
    fraction,
    evidence,
    `${transfersInWindow} transfers to the same receiver in the preceding ${windowMinutes} minutes, totalling ${money(
      totalAmountInWindow,
    )} — consistent with splitting one large payment.`,
  );
}

// ---------------------------------------------------------------------------
// 6. Receiver collecting from an unusually large number of distinct senders
// ---------------------------------------------------------------------------

function suspiciousReceiverFanIn({ features, config }) {
  const { distinctSendersInWindow, isMerchant } = features.receiver;
  const { windowHours, distinctSenderThreshold, distinctSenderSaturation } = config;
  const evidence = {
    windowHours,
    distinctSenders: distinctSendersInWindow,
    distinctSenderThreshold,
    isMerchant,
  };

  if (isMerchant) {
    return abstained(
      'Receiver is a registered merchant account, for which collecting from many senders is expected behaviour.',
      evidence,
    );
  }

  if (distinctSendersInWindow < distinctSenderThreshold) {
    return notTriggered(
      evidence,
      `${distinctSendersInWindow} distinct senders paid this receiver in the preceding ${windowHours} hours, below the threshold of ${distinctSenderThreshold}.`,
    );
  }

  const fraction = thresholdFraction(
    distinctSendersInWindow,
    distinctSenderThreshold,
    distinctSenderSaturation,
  );
  return triggered(
    fraction,
    evidence,
    `Receiver collected from ${distinctSendersInWindow} distinct senders in the preceding ${windowHours} hours (threshold ${distinctSenderThreshold}) and is not a merchant account.`,
  );
}

// ---------------------------------------------------------------------------
// 7. Unusual transaction time for this sender
// ---------------------------------------------------------------------------

function unusualTransactionTime({ transaction, features, config }) {
  const { hourHistogram, hourHistoryCount } = features.sender;
  const { minHistoryCount, rareHourShare, quietHoursUtc } = config;

  const hourUtc = transaction.occurredAt.getUTCHours();
  const isQuietHour = quietHoursUtc.includes(hourUtc);

  if (hourHistoryCount < minHistoryCount) {
    return abstained(
      `Only ${hourHistoryCount} prior transactions in the lookback window; ${minHistoryCount} are needed to establish a normal activity pattern.`,
      { hourUtc, historyCount: hourHistoryCount, minHistoryCount, isQuietHour },
    );
  }

  const hourShare = hourHistogram[hourUtc] / hourHistoryCount;
  const evidence = {
    hourUtc,
    hourShare: Math.round(hourShare * 1000) / 1000,
    rareHourShare,
    historyCount: hourHistoryCount,
    isQuietHour,
  };

  if (hourShare >= rareHourShare) {
    return notTriggered(
      evidence,
      `Sender regularly transacts around ${hourUtc}:00 UTC (${Math.round(hourShare * 100)}% of their activity).`,
    );
  }

  // A rare hour alone earns most of the weight; a rare hour that is also one of
  // the configured quiet hours earns all of it.
  const fraction = isQuietHour ? 1 : 0.7;
  return triggered(
    fraction,
    evidence,
    `Sender rarely transacts around ${hourUtc}:00 UTC (${Math.round(
      hourShare * 100,
    )}% of ${hourHistoryCount} prior transactions)${isQuietHour ? ', which is also a configured quiet hour' : ''}.`,
  );
}

// ---------------------------------------------------------------------------
// 8. Sudden increase in transaction volume or value
// ---------------------------------------------------------------------------

function suddenActivityIncrease({ features, config }) {
  const { recentCount, recentValue, baselineCount, baselineValue } = features.sender;
  const {
    recentWindowHours,
    baselineWindowDays,
    minBaselineCount,
    ratioThreshold,
    ratioSaturation,
  } = config;

  if (baselineCount < minBaselineCount) {
    return abstained(
      `Baseline window holds only ${baselineCount} transactions; ${minBaselineCount} are needed before a change in activity is meaningful.`,
      { baselineCount, minBaselineCount, baselineWindowDays },
    );
  }

  // Both windows are normalised to a per-day rate so windows of different
  // lengths are directly comparable.
  const recentDays = recentWindowHours / 24;
  const recentDailyCount = recentCount / recentDays;
  const recentDailyValue = recentValue / recentDays;
  const baselineDailyCount = baselineCount / baselineWindowDays;
  const baselineDailyValue = baselineValue / baselineWindowDays;

  const countRatio = baselineDailyCount > 0 ? recentDailyCount / baselineDailyCount : 0;
  const valueRatio = baselineDailyValue > 0 ? recentDailyValue / baselineDailyValue : 0;
  const worstRatio = Math.max(countRatio, valueRatio);

  const evidence = {
    recentCount,
    recentValue,
    baselineDailyCount: Math.round(baselineDailyCount * 100) / 100,
    baselineDailyValue: Math.round(baselineDailyValue * 100) / 100,
    countRatio: Math.round(countRatio * 100) / 100,
    valueRatio: Math.round(valueRatio * 100) / 100,
    ratioThreshold,
  };

  if (worstRatio < ratioThreshold) {
    return notTriggered(
      evidence,
      `Activity in the last ${recentWindowHours} hours is in line with this sender's ${baselineWindowDays}-day baseline.`,
    );
  }

  const fraction = thresholdFraction(worstRatio, ratioThreshold, ratioSaturation);
  const driver = countRatio >= valueRatio ? 'transaction count' : 'transaction value';
  return triggered(
    fraction,
    evidence,
    `Sender's ${driver} over the last ${recentWindowHours} hours is ${
      Math.round(worstRatio * 10) / 10
    }x their ${baselineWindowDays}-day baseline (threshold ${ratioThreshold}x).`,
  );
}

/** Rule id -> implementation. */
export const RULE_IMPLEMENTATIONS = {
  [RULE_ID.HIGH_AMOUNT]: highAmount,
  [RULE_ID.HISTORICAL_AMOUNT_ANOMALY]: historicalAmountAnomaly,
  [RULE_ID.HIGH_VELOCITY]: highVelocity,
  [RULE_ID.NEW_DEVICE]: newDevice,
  [RULE_ID.RAPID_REPEATED_TRANSFERS]: rapidRepeatedTransfers,
  [RULE_ID.SUSPICIOUS_RECEIVER_FANIN]: suspiciousReceiverFanIn,
  [RULE_ID.UNUSUAL_TRANSACTION_TIME]: unusualTransactionTime,
  [RULE_ID.SUDDEN_ACTIVITY_INCREASE]: suddenActivityIncrease,
};

export {
  highAmount,
  historicalAmountAnomaly,
  highVelocity,
  newDevice,
  rapidRepeatedTransfers,
  suspiciousReceiverFanIn,
  unusualTransactionTime,
  suddenActivityIncrease,
};
