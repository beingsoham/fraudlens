import { DEFAULT_RISK_SETTINGS, RULE_CATALOGUE, RULE_IDS } from '@fraudlens/shared/constants';
import { parseRuleConfig, riskSettingsSchema } from '@fraudlens/shared/schemas';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { moduleLogger } from '../../config/logger.js';
import { ServiceUnavailableError } from '../../utils/errors.js';

const log = moduleLogger('fraud:ruleset');

/**
 * Active ruleset loading, with a short in-process cache.
 *
 * Every ingested transaction needs the full ruleset, so reading nine rows from
 * PostgreSQL per transaction would be wasteful at simulator rates. The cache is
 * held for `CACHE_TTL_MS` and invalidated explicitly whenever the settings
 * module writes a rule or a threshold, so an operator's change takes effect on
 * the next transaction rather than up to a TTL later.
 */
const CACHE_TTL_MS = 5_000;

let cache = null;

/** Drops the cached ruleset. Called after any settings write. */
export function invalidateRulesetCache() {
  cache = null;
}

/** Reads rules and risk settings from the database and shapes the ruleset. */
async function loadRulesetFromDatabase(client = prisma) {
  const [ruleRows, settingsRow] = await Promise.all([
    client.fraudRule.findMany(),
    client.riskSettings.findFirst({ where: { singleton: true } }),
  ]);

  if (ruleRows.length === 0) {
    throw new ServiceUnavailableError(
      'The fraud ruleset has not been initialised. Run the database seed before ingesting transactions.',
    );
  }

  const rules = {};
  for (const row of ruleRows) {
    if (!RULE_IDS.includes(row.ruleId)) {
      // A rule row the current code does not implement. Ignored rather than
      // trusted, so an older database cannot make the engine misbehave.
      log.warn({ ruleId: row.ruleId }, 'Ignoring unknown rule row');
      continue;
    }

    const parsed = parseRuleConfig(row.ruleId, row.config);
    if (!parsed.success) {
      // Stored configuration is validated on write, so this means the row was
      // changed outside the application. Fall back to the catalogue default and
      // record it loudly rather than scoring with an invalid configuration.
      log.error(
        { ruleId: row.ruleId, error: String(parsed.error) },
        'Stored rule config is invalid; falling back to the catalogue default',
      );
    }

    rules[row.ruleId] = {
      ruleId: row.ruleId,
      name: row.name,
      description: row.description,
      enabled: row.enabled,
      weight: Number(row.weight.toString()),
      config: parsed.success
        ? parsed.data
        : RULE_CATALOGUE.find((rule) => rule.ruleId === row.ruleId).config,
      configValid: parsed.success,
      rulesetVersion: row.rulesetVersion,
      updatedAt: row.updatedAt,
      updatedById: row.updatedById,
    };
  }

  const rawSettings = settingsRow
    ? {
        mediumThreshold: settingsRow.mediumThreshold,
        highThreshold: settingsRow.highThreshold,
        alertThreshold: settingsRow.alertThreshold,
      }
    : {
        mediumThreshold: env.RISK_MEDIUM_THRESHOLD,
        highThreshold: env.RISK_HIGH_THRESHOLD,
        alertThreshold: env.ALERT_THRESHOLD,
      };

  const settingsResult = riskSettingsSchema.safeParse(rawSettings);
  if (!settingsResult.success) {
    log.error(
      { issues: settingsResult.error.issues },
      'Stored risk settings are inconsistent; falling back to documented defaults',
    );
  }

  // The ruleset version reported on an assessment is the version recorded on
  // the rules themselves, so a stored assessment can always be tied back to the
  // configuration that produced it.
  const version = settingsRow?.rulesetVersion ?? ruleRows[0]?.rulesetVersion ?? env.RULESET_VERSION;

  return {
    version,
    riskSettings: settingsResult.success ? settingsResult.data : { ...DEFAULT_RISK_SETTINGS },
    riskSettingsValid: settingsResult.success,
    rules,
    enabledRuleIds: RULE_IDS.filter((ruleId) => rules[ruleId]?.enabled),
    loadedAt: new Date(),
  };
}

/**
 * Returns the active ruleset, from cache when fresh.
 *
 * @param {object} [options]
 * @param {boolean} [options.fresh] Bypass the cache.
 * @param {object} [options.client] Prisma client or transaction client.
 */
export async function getActiveRuleset({ fresh = false, client } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.ruleset;
  }
  const ruleset = await loadRulesetFromDatabase(client);
  // A ruleset read inside someone else's uncommitted transaction must not
  // become the process-wide cached value.
  if (!client) {
    cache = { at: Date.now(), ruleset };
  }
  return ruleset;
}

// Re-exported for convenience; defined in the pure `defaults.js` so that
// importing it does not drag in the database client.
export { defaultRuleset } from './defaults.js';

export { CACHE_TTL_MS };
