import { describe, expect, it } from 'vitest';
import {
  buildAccountRoster,
  createTransactionGenerator,
  parseSimulatorExternalIdSequence,
  simulatorExternalIdPrefix,
} from '../../src/modules/simulator/generator.js';

/**
 * External-id allocation in the synthetic generator.
 *
 * Ingestion is idempotent on the external id, so an id the generator reissues
 * is silently skipped rather than rejected loudly. That makes id allocation
 * worth testing directly: a regression here does not fail anything, it just
 * quietly stops producing data.
 */

const accounts = buildAccountRoster({ seed: 11, count: 12 });

function idsFrom(generator, count) {
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(generator.next(new Date('2026-01-01T00:00:00Z')).input.externalId);
  }
  return ids;
}

describe('simulator external ids', () => {
  it('encodes the seed and a zero-padded sequence starting at 1', () => {
    const generator = createTransactionGenerator({ seed: 42, accounts });

    expect(idsFrom(generator, 3)).toEqual([
      'SIMTX-42-00000001',
      'SIMTX-42-00000002',
      'SIMTX-42-00000003',
    ]);
  });

  it('continues past a sequence an earlier run already persisted', () => {
    const generator = createTransactionGenerator({ seed: 42, accounts, sequenceStart: 660 });

    expect(idsFrom(generator, 2)).toEqual(['SIMTX-42-00000661', 'SIMTX-42-00000662']);
  });

  it('never reissues an id a previous run of the same seed produced', () => {
    const first = createTransactionGenerator({ seed: 42, accounts });
    const firstIds = idsFrom(first, 25);

    // What the service does on restart: resume from the highest id persisted.
    const resumed = createTransactionGenerator({
      seed: 42,
      accounts,
      sequenceStart: parseSimulatorExternalIdSequence(firstIds.at(-1)),
    });
    const resumedIds = idsFrom(resumed, 25);

    expect(resumedIds.some((id) => firstIds.includes(id))).toBe(false);
  });

  it('keeps the generated stream reproducible for a seed regardless of the offset', () => {
    const fresh = createTransactionGenerator({ seed: 7, accounts });
    const offset = createTransactionGenerator({ seed: 7, accounts, sequenceStart: 500 });

    const strip = ({ input, scenarioLabel }) => {
      const { externalId: _externalId, ...rest } = input;
      return { ...rest, scenarioLabel };
    };

    const at = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 20; i += 1) {
      // The offset shifts the ids and nothing else: amounts, participants,
      // devices and scenario order still come from the seeded RNG alone.
      expect(strip(offset.next(at))).toEqual(strip(fresh.next(at)));
    }
  });

  it('separates seeds by prefix, including seeds that share a leading digit', () => {
    expect(simulatorExternalIdPrefix(424_242)).toBe('SIMTX-424242-');
    expect('SIMTX-4242420-00000001'.startsWith(simulatorExternalIdPrefix(424_242))).toBe(false);
  });

  it('reads back a sequence number and ignores ids it did not produce', () => {
    expect(parseSimulatorExternalIdSequence('SIMTX-424242-00000660')).toBe(660);
    expect(parseSimulatorExternalIdSequence('SIMTX-1-99999999')).toBe(99_999_999);
    expect(parseSimulatorExternalIdSequence('TXN-EXTERNAL-001')).toBe(0);
    expect(parseSimulatorExternalIdSequence(undefined)).toBe(0);
    expect(parseSimulatorExternalIdSequence(null)).toBe(0);
  });
});
