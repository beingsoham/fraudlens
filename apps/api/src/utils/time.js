/**
 * UTC time helpers.
 *
 * Every timestamp in FraudLens is UTC. Rolling windows are always
 * half-open — `(start, end]` — with `end` being the transaction's own
 * `occurredAt`, and the transaction under evaluation excluded from its own
 * features. Defining this once, here, is what makes the fraud engine's
 * windows consistent across rules.
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** Subtracts `minutes` from `date`, returning a new Date. */
export function minutesBefore(date, minutes) {
  return new Date(date.getTime() - minutes * MS_PER_MINUTE);
}

export function hoursBefore(date, hours) {
  return new Date(date.getTime() - hours * MS_PER_HOUR);
}

export function daysBefore(date, days) {
  return new Date(date.getTime() - days * MS_PER_DAY);
}

/** Start of the UTC day containing `date`. */
export function startOfUtcDay(date = new Date()) {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

/** Start of the UTC day after the one containing `date`. */
export function startOfNextUtcDay(date = new Date()) {
  const start = startOfUtcDay(date);
  return new Date(start.getTime() + MS_PER_DAY);
}

export function startOfUtcHour(date = new Date()) {
  const copy = new Date(date);
  copy.setUTCMinutes(0, 0, 0);
  return copy;
}

/** Start of the ISO week (Monday 00:00 UTC) containing `date`. */
export function startOfUtcWeek(date = new Date()) {
  const start = startOfUtcDay(date);
  // getUTCDay(): 0 = Sunday. Shift so Monday is the first day.
  const offset = (start.getUTCDay() + 6) % 7;
  return new Date(start.getTime() - offset * MS_PER_DAY);
}

/**
 * Resolves an optional `{ from, to }` filter into a concrete, inclusive-start /
 * exclusive-end range. Defaults to the last `defaultDays` days ending now, so
 * every analytics endpoint has a well-defined window even with no parameters.
 */
export function resolveRange({ from, to } = {}, { defaultDays = 30 } = {}) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - defaultDays * MS_PER_DAY);
  return { from: start, to: end };
}

/** Truncation granularity accepted by the time-series endpoints. */
export const SERIES_INTERVALS = {
  hour: { ms: MS_PER_HOUR, truncate: startOfUtcHour, sqlUnit: 'hour' },
  day: { ms: MS_PER_DAY, truncate: startOfUtcDay, sqlUnit: 'day' },
  week: { ms: 7 * MS_PER_DAY, truncate: startOfUtcWeek, sqlUnit: 'week' },
};

/**
 * Produces every bucket boundary in `[from, to]` at the given interval, so a
 * time series can report zero-valued buckets instead of silently omitting
 * periods with no activity.
 */
export function enumerateBuckets(from, to, interval) {
  const spec = SERIES_INTERVALS[interval];
  if (!spec) throw new Error(`Unsupported interval: ${interval}`);
  const buckets = [];
  let cursor = spec.truncate(from);
  const limit = to.getTime();
  // Hard cap so a wide range with an hourly interval cannot exhaust memory.
  const MAX_BUCKETS = 2000;
  while (cursor.getTime() <= limit && buckets.length < MAX_BUCKETS) {
    buckets.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + spec.ms);
    if (interval === 'week') cursor = spec.truncate(cursor);
  }
  return buckets;
}

/** Hours between two dates, to one decimal place. */
export function hoursBetween(start, end) {
  return Math.round(((end.getTime() - start.getTime()) / MS_PER_HOUR) * 10) / 10;
}
