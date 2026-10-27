import { RULE_BY_ID, RULE_CORRELATION_GROUP, RULE_IDS } from '@fraudlens/shared/constants';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY_TYPE,
  parseRuleConfig,
  riskSettingsSchema,
} from '@fraudlens/shared/schemas';
import { prisma } from '../../config/prisma.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { getActiveRuleset, invalidateRulesetCache } from '../fraud/ruleset.service.js';

/**
 * Detection settings.
 *
 * Every write here is validated server-side against the rule's own schema,
 * applied inside a transaction together with its audit event, and followed by a
 * cache invalidation so the next assessment uses the new configuration.
 *
 * Validation is not a convenience: the scoring code assumes an ordered
 * configuration (threshold strictly below saturation, consistent category
 * boundaries). Storing a configuration that violates those orderings would
 * silently change what every score means.
 */

/** Current ruleset with catalogue metadata, for the settings page. */
export async function getRuleSettings() {
  const [rows, ruleset] = await Promise.all([
    prisma.fraudRule.findMany({
      include: { updatedBy: { select: { id: true, name: true, email: true } } },
    }),
    getActiveRuleset({ fresh: true }),
  ]);

  const byId = new Map(rows.map((row) => [row.ruleId, row]));

  return {
    rulesetVersion: ruleset.version,
    riskSettings: ruleset.riskSettings,
    riskSettingsValid: ruleset.riskSettingsValid,
    // Ordered by the catalogue, not the database, so the page order is stable.
    rules: RULE_IDS.map((ruleId) => {
      const row = byId.get(ruleId);
      const catalogue = RULE_BY_ID[ruleId];
      if (!row) {
        return {
          ruleId,
          name: catalogue.name,
          description: catalogue.description,
          configured: false,
          enabled: false,
          weight: catalogue.weight,
          config: catalogue.config,
          defaultWeight: catalogue.weight,
          defaultConfig: catalogue.config,
          correlationGroup: RULE_CORRELATION_GROUP[ruleId] ?? null,
        };
      }
      return {
        ruleId,
        name: row.name,
        description: row.description,
        configured: true,
        enabled: row.enabled,
        weight: Number(row.weight.toString()),
        config: row.config,
        configValid: ruleset.rules[ruleId]?.configValid ?? true,
        defaultWeight: catalogue.weight,
        defaultConfig: catalogue.config,
        /**
         * Rules sharing a group have their contributions dampened relative to
         * each other, so the UI can explain why enabling both adds less than
         * the sum of their weights.
         */
        correlationGroup: RULE_CORRELATION_GROUP[ruleId] ?? null,
        rulesetVersion: row.rulesetVersion,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      };
    }),
  };
}

/** Updates one rule's enabled flag, weight and/or configuration. */
export async function updateRule(ruleId, payload, context) {
  const existing = await prisma.fraudRule.findUnique({ where: { ruleId } });
  if (!existing) throw new NotFoundError(`Rule ${ruleId}`);

  const data = {};

  if (payload.enabled !== undefined) data.enabled = payload.enabled;
  if (payload.weight !== undefined) data.weight = payload.weight;

  if (payload.config !== undefined) {
    // The config is merged over the stored one and then validated as a whole,
    // so a partial update cannot produce an inconsistent combination (raising
    // a threshold above an unchanged saturation point, for instance).
    const merged = { ...existing.config, ...payload.config };
    const parsed = parseRuleConfig(ruleId, merged);
    if (!parsed.success) {
      const issues =
        typeof parsed.error === 'string'
          ? [{ field: 'config', message: parsed.error }]
          : parsed.error.issues.map((issue) => ({
              field: `config.${issue.path.join('.')}`,
              message: issue.message,
            }));
      throw new ValidationError(`Invalid configuration for rule ${ruleId}`, issues);
    }
    data.config = parsed.data;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.fraudRule.update({
      where: { ruleId },
      data: { ...data, updatedById: context.actorId },
      include: { updatedBy: { select: { id: true, name: true, email: true } } },
    });

    await recordAudit({
      actorId: context.actorId,
      action: AUDIT_ACTION.RULE_UPDATED,
      entityType: AUDIT_ENTITY_TYPE.FRAUD_RULE,
      entityId: ruleId,
      metadata: {
        ruleId,
        enabled: data.enabled,
        previousEnabled: payload.enabled !== undefined ? existing.enabled : undefined,
        weight: data.weight,
        previousWeight:
          payload.weight !== undefined ? Number(existing.weight.toString()) : undefined,
        // Only the changed key names are recorded, not the values, keeping the
        // audit row compact while still showing what was touched.
        configKeys: payload.config ? Object.keys(payload.config) : undefined,
      },
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      tx,
    });

    return row;
  });

  // The next transaction scored must use the new configuration, not a cached one.
  invalidateRulesetCache();

  return {
    ruleId: updated.ruleId,
    name: updated.name,
    description: updated.description,
    enabled: updated.enabled,
    weight: Number(updated.weight.toString()),
    config: updated.config,
    rulesetVersion: updated.rulesetVersion,
    updatedAt: updated.updatedAt,
    updatedBy: updated.updatedBy,
  };
}

/** Updates the risk-category boundaries and the alert threshold. */
export async function updateRiskSettings(payload, context) {
  const existing = await prisma.riskSettings.findFirst({ where: { singleton: true } });
  if (!existing) throw new NotFoundError('Risk settings');

  const merged = {
    mediumThreshold: payload.mediumThreshold ?? existing.mediumThreshold,
    highThreshold: payload.highThreshold ?? existing.highThreshold,
    alertThreshold: payload.alertThreshold ?? existing.alertThreshold,
  };

  // Validated as a complete set, so a single-field change cannot leave the
  // boundaries crossed. The database CHECK constraint enforces the same rule as
  // a second line of defence.
  const parsed = riskSettingsSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ValidationError(
      'The requested thresholds are inconsistent',
      parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.riskSettings.update({
      where: { id: existing.id },
      data: { ...parsed.data, updatedById: context.actorId },
      include: { updatedBy: { select: { id: true, name: true, email: true } } },
    });

    await recordAudit({
      actorId: context.actorId,
      action: AUDIT_ACTION.RISK_SETTINGS_UPDATED,
      entityType: AUDIT_ENTITY_TYPE.RISK_SETTINGS,
      entityId: row.id,
      metadata: {
        ...parsed.data,
        previousThresholds: {
          mediumThreshold: existing.mediumThreshold,
          highThreshold: existing.highThreshold,
          alertThreshold: existing.alertThreshold,
        },
      },
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      tx,
    });

    return row;
  });

  invalidateRulesetCache();

  return {
    mediumThreshold: updated.mediumThreshold,
    highThreshold: updated.highThreshold,
    alertThreshold: updated.alertThreshold,
    rulesetVersion: updated.rulesetVersion,
    updatedAt: updated.updatedAt,
    updatedBy: updated.updatedBy,
    /**
     * Changing a threshold affects *future* assessments only. Existing
     * assessments are immutable historical records, so the categories already
     * stored are not retroactively recomputed. Saying so explicitly here keeps
     * the UI from implying otherwise.
     */
    note: 'New thresholds apply to future assessments. Existing risk assessments are immutable historical records and are not recategorised.',
  };
}
