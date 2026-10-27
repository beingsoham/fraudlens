/**
 * Small statistics helpers used by the fraud engine and the analytics module.
 *
 * The engine deliberately uses *robust* statistics — median and median absolute
 * deviation rather than mean and standard deviation. Payment amounts are
 * heavily skewed and a single large historical payment would inflate a standard
 * deviation enough to mask every subsequent anomaly.
 */

/** Median of a numeric array. Returns null for an empty array. */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Median absolute deviation: the median of |x - median(x)|.
 *
 * Scaled by 1.4826 so that for normally distributed data it estimates the
 * standard deviation, which keeps the resulting z-scores interpretable on the
 * familiar "how many sigma" scale.
 */
export function medianAbsoluteDeviation(values, precomputedMedian = null) {
  if (values.length === 0) return null;
  const centre = precomputedMedian ?? median(values);
  const deviations = values.map((value) => Math.abs(value - centre));
  const mad = median(deviations);
  return mad === null ? null : mad * 1.4826;
}

/**
 * Robust z-score of `value` against `history`.
 *
 * Returns null when the history is empty. When every historical value is
 * identical the MAD is zero, which would divide by zero; in that case a floor
 * of 1% of the median (or 1, for a zero median) is used so that a genuinely
 * different value still produces a finite, large score instead of Infinity.
 */
export function robustZScore(value, history, precomputed = {}) {
  if (history.length === 0) return null;
  const centre = precomputed.median ?? median(history);
  let spread = precomputed.mad ?? medianAbsoluteDeviation(history, centre);
  if (!spread || spread <= 0) {
    spread = Math.max(Math.abs(centre) * 0.01, 1);
  }
  return (value - centre) / spread;
}

export function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Linear ramp from 0 at `start` to 1 at `end`, clamped outside that interval.
 *
 * This is the single shaping function every rule uses to turn a raw feature
 * into a fraction of its weight, which is what keeps contributions comparable
 * across rules measuring quite different quantities.
 */
export function ramp(value, start, end) {
  if (!Number.isFinite(value)) return 0;
  if (end === start) return value >= end ? 1 : 0;
  const fraction = (value - start) / (end - start);
  return Math.min(1, Math.max(0, fraction));
}

/**
 * Shapes a feature value into the share of a rule's weight it has earned.
 *
 * Crossing a deliberately-configured threshold is itself the signal, so a value
 * exactly at the threshold earns `floor` of the weight (half, by default) and
 * the remainder ramps linearly to the full weight at `saturation`. A plain
 * `ramp` would award almost nothing for just crossing the line, which would
 * make a rule's configured threshold nearly meaningless.
 */
export function thresholdFraction(value, threshold, saturation, floor = 0.5) {
  return floor + (1 - floor) * ramp(value, threshold, saturation);
}

/** Clamps a number into `[min, max]`. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Percentile (0..100) of a numeric array using linear interpolation. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}
