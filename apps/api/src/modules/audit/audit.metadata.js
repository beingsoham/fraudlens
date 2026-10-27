/**
 * Audit metadata sanitisation.
 *
 * Kept in its own module, free of any database import, so it can be tested and
 * reasoned about on its own. It is the single place that decides what is safe
 * to persist in the audit trail, which is too important to be reachable only
 * through a module that needs a live database connection to load.
 */

/**
 * Metadata keys that may be persisted on an audit event.
 *
 * Audit rows are retained indefinitely and visible to administrators, so the
 * allow-list is explicit: anything not named here is dropped rather than
 * stored. This is what stops a password, a token or a whole request body from
 * being written into the audit trail by a careless call site.
 */
const ALLOWED_METADATA_KEYS = new Set([
  'email',
  'role',
  'previousRole',
  'isActive',
  'previousIsActive',
  'name',
  'targetUserId',
  'targetUserEmail',
  'externalId',
  'transactionId',
  'amount',
  'currency',
  'riskScore',
  'riskCategory',
  'rulesetVersion',
  'triggeredRuleIds',
  'alertId',
  'severity',
  'status',
  'previousStatus',
  'outcome',
  'previousOutcome',
  'assignedToId',
  'previousAssignedToId',
  'noteId',
  'noteLength',
  'ruleId',
  'enabled',
  'previousEnabled',
  'weight',
  'previousWeight',
  'configKeys',
  'mediumThreshold',
  'highThreshold',
  'alertThreshold',
  'previousThresholds',
  'reopenReason',
  'reopenCount',
  'dataset',
  'rowCount',
  'from',
  'to',
  'ratePerSecond',
  'seed',
  'scenarioDistribution',
  'maxTransactions',
  'reason',
  'source',
  'duplicateOf',
]);

/** Values longer than this are truncated; audit metadata is not a text store. */
const MAX_STRING_LENGTH = 500;

/**
 * Filters a metadata object down to the allow-listed keys and coerces the
 * values into JSON-safe primitives.
 */
export function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;

  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;

    if (value instanceof Date) {
      safe[key] = value.toISOString();
    } else if (typeof value === 'string') {
      safe[key] = value.slice(0, MAX_STRING_LENGTH);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value;
    } else if (Array.isArray(value)) {
      safe[key] = value
        .slice(0, 50)
        .map((item) => (typeof item === 'string' ? item.slice(0, 120) : item))
        .filter((item) => ['string', 'number', 'boolean'].includes(typeof item));
    } else if (typeof value === 'object') {
      // One level of nesting only, so an accidental deep object cannot bloat
      // the row or smuggle in a disallowed key deeper down.
      const nested = {};
      for (const [nestedKey, nestedValue] of Object.entries(value).slice(0, 20)) {
        if (['string', 'number', 'boolean'].includes(typeof nestedValue)) {
          nested[nestedKey] =
            typeof nestedValue === 'string' ? nestedValue.slice(0, 120) : nestedValue;
        }
      }
      safe[key] = nested;
    }
  }
  return Object.keys(safe).length > 0 ? safe : null;
}
