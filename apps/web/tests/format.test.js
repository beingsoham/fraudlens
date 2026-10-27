import { describe, expect, it } from 'vitest';
import {
  alertStatusStyle,
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRatioAsPercent,
  humanise,
  outcomeStyle,
  riskStyle,
  severityStyle,
} from '../src/utils/format.js';
import { formatBucketLabel, resolvePreset } from '../src/utils/dateRanges.js';

describe('value formatting', () => {
  it('renders an em dash for a missing value rather than "0" or "NaN"', () => {
    expect(formatCurrency(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    expect(formatPercent(null)).toBe('—');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDuration(null)).toBe('—');
  });

  it('formats an amount as Indian rupees with two decimals', () => {
    expect(formatCurrency(1234.5)).toMatch(/₹/);
    expect(formatCurrency(1234.5)).toMatch(/1,234\.50/);
  });

  it('formats a timestamp in UTC, not the host timezone', () => {
    // Asserting on UTC output is the point: every timestamp in FraudLens is
    // UTC, and a test that passed only in one timezone would be worthless.
    expect(formatDateTime('2026-06-15T14:30:00Z')).toMatch(/15 Jun 2026/);
    expect(formatDateTime('2026-06-15T14:30:00Z')).toMatch(/14:30/);
  });

  it('rejects an unparseable date instead of rendering "Invalid Date"', () => {
    expect(formatDateTime('not a date')).toBe('—');
  });

  it('reports an unavailable model metric as text, never as zero', () => {
    // A null precision means "not defined on this sample". Rendering it as
    // 0.0% would be a false claim about the model.
    expect(formatRatioAsPercent(null)).toBe('not available');
    expect(formatRatioAsPercent(0.8532)).toBe('85.3%');
  });

  it('scales a duration to a readable unit', () => {
    expect(formatDuration(0.5)).toBe('30 min');
    expect(formatDuration(4.25)).toBe('4.3 h');
    expect(formatDuration(72)).toBe('3.0 d');
  });

  it('turns an enum value into a readable label', () => {
    expect(humanise('IN_REVIEW')).toBe('In review');
    expect(humanise('CONFIRMED_FRAUD')).toBe('Confirmed fraud');
    expect(humanise(null)).toBe('—');
  });
});

describe('status styling', () => {
  it('gives every risk category a distinct colour', () => {
    const hexes = ['LOW', 'MEDIUM', 'HIGH'].map((category) => riskStyle(category).hex);
    expect(new Set(hexes).size).toBe(3);
  });

  it('falls back to the unassessed style for an unknown category', () => {
    expect(riskStyle(undefined).label).toBe('Unassessed');
    expect(riskStyle('NONSENSE').label).toBe('Unassessed');
  });

  it('labels a pending outcome as "no conclusion", never as a judgement', () => {
    // "Pending" must not read as either innocence or guilt.
    expect(outcomeStyle('PENDING').label).toBe('No conclusion yet');
    expect(outcomeStyle('CONFIRMED_FRAUD').label).toBe('Confirmed fraud');
    expect(outcomeStyle('LEGITIMATE').label).toBe('Legitimate activity');
  });

  it('distinguishes workflow status from investigation outcome', () => {
    // Resolved is a process state; confirmed fraud is a conclusion. They must
    // never share a label.
    expect(alertStatusStyle('RESOLVED').label).toBe('Resolved');
    expect(outcomeStyle('CONFIRMED_FRAUD').label).not.toBe('Resolved');
  });

  it('gives each severity its own style', () => {
    for (const severity of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) {
      expect(severityStyle(severity).badge).toBeTruthy();
    }
  });
});

describe('date ranges', () => {
  it('resolves a preset into a concrete range with an interval', () => {
    const range = resolvePreset('7d');
    expect(new Date(range.to) - new Date(range.from)).toBeCloseTo(7 * 86_400_000, -4);
    expect(range.interval).toBe('day');
  });

  it('falls back to the 30-day preset for an unknown id', () => {
    expect(resolvePreset('nonsense').id).toBe('30d');
  });

  it('uses an hour-resolution label for an hourly interval', () => {
    expect(formatBucketLabel('2026-06-15T14:00:00Z', 'hour')).toMatch(/14:00/);
    expect(formatBucketLabel('2026-06-15T14:00:00Z', 'day')).toMatch(/15 Jun/);
  });
});
