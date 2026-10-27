/**
 * Helpers for the NUMERIC(14,2) amounts the database stores.
 *
 * Prisma returns `Decimal` instances for NUMERIC columns. Those are exact, so
 * all summing and comparison happens on the database side or on Decimal
 * values; JavaScript numbers are used only at the serialisation boundary,
 * where two decimal places always round-trip safely.
 */

/** Converts a Prisma Decimal, string or number to a JS number for JSON output. */
export function toAmountNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return roundToCents(value);
  // Prisma Decimal and pg numeric strings both stringify exactly.
  return roundToCents(Number(value.toString()));
}

/** Rounds to two decimal places, avoiding binary float drift in the output. */
export function roundToCents(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Formats an amount as a fixed-point string suitable for a NUMERIC(14,2)
 * column. Used when writing amounts so the value sent to PostgreSQL is exact.
 */
export function toDecimalString(value) {
  return roundToCents(value).toFixed(2);
}

/** Sums an iterable of Decimal/number/string amounts exactly, in cents. */
export function sumAmounts(values) {
  let cents = 0;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    cents += Math.round(Number(value.toString()) * 100);
  }
  return cents / 100;
}
