import { useEffect, useState } from 'react';
import { RotateCcw, Save, SlidersHorizontal } from 'lucide-react';
import { PERMISSION } from '@fraudlens/shared/constants';
import { TopBar } from '../components/layout/TopBar.jsx';
import { PageBody } from '../components/layout/PageBody.jsx';
import {
  Badge,
  Button,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Notice,
  Panel,
  PanelHeader,
} from '../components/ui/index.jsx';
import { useApi, useMutation } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { settingsApi } from '../services/endpoints.js';
import { formatDateTime, humanise } from '../utils/format.js';

/**
 * Detection rules and risk settings.
 *
 * Every change is validated server-side against the rule's own schema, applied
 * atomically with its audit event, and takes effect on the next assessment. The
 * page states plainly that a threshold change is not retroactive: existing
 * assessments are immutable records and are never recategorised.
 */
export function SettingsPage() {
  const { can } = useAuth();
  const canWrite = can(PERMISSION.SETTINGS_WRITE);
  const { data, error, isLoading, refetch } = useApi((options) => settingsApi.rules(options), []);
  const [notice, setNotice] = useState(null);

  return (
    <>
      <TopBar
        title="Detection rules and thresholds"
        subtitle={
          data
            ? `Ruleset ${data.rulesetVersion} · ${data.rules.filter((rule) => rule.enabled).length} of ${data.rules.length} rules enabled`
            : 'Loading…'
        }
      />

      <PageBody>
        {notice ? (
          <Notice tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        ) : null}
        {error ? <ErrorBlock error={error} onRetry={refetch} /> : null}

        {!canWrite ? (
          <Notice tone="info">
            Your role can view the ruleset but not change it. Only an administrator may modify
            detection rules or thresholds.
          </Notice>
        ) : null}

        {isLoading && !data ? <LoadingBlock rows={10} /> : null}

        {data ? (
          <>
            <RiskSettingsPanel
              settings={data.riskSettings}
              canWrite={canWrite}
              onSaved={(message) => {
                setNotice(message);
                refetch();
              }}
            />

            <Panel>
              <PanelHeader
                title="Scoring policy"
                info="How individual rule contributions combine into a single 0-100 score."
              />
              <div className="space-y-2.5 p-5 text-xs leading-relaxed text-fg-muted">
                <p>
                  Each triggered rule earns a share of its configured weight. A rule shaped by a
                  threshold earns half its weight the moment the threshold is crossed, rising to the
                  full weight at its saturation point — so crossing an operator-chosen threshold is
                  itself meaningful, and the remainder reflects severity.
                </p>
                <p>
                  Contributions are summed and capped at 100. Rules that measure the same underlying
                  phenomenon are grouped: within a group the strongest contribution counts in full,
                  the second at 50% and any further one at 25%. This stops one behaviour — a single
                  very large payment, say — from being counted by several amount-sensitive rules at
                  once.
                </p>
                <p className="rounded-md border border-risk-medium/20 bg-risk-medium/5 px-3 py-2 text-risk-medium">
                  These weights and thresholds are initial engineering parameters chosen for a
                  demonstration dataset. They are not validated financial risk thresholds and would
                  need tuning against real labelled data before any operational use.
                </p>
              </div>
            </Panel>

            <div className="space-y-4">
              {data.rules.map((rule) => (
                <RuleCard
                  key={rule.ruleId}
                  rule={rule}
                  canWrite={canWrite}
                  onSaved={(message) => {
                    setNotice(message);
                    refetch();
                  }}
                />
              ))}
            </div>
          </>
        ) : null}
      </PageBody>
    </>
  );
}

/** Risk-category boundaries and the alert threshold. */
function RiskSettingsPanel({ settings, canWrite, onSaved }) {
  const [draft, setDraft] = useState(settings);
  const save = useMutation((payload) => settingsApi.updateRisk(payload));

  useEffect(() => setDraft(settings), [settings]);

  const dirty =
    draft.mediumThreshold !== settings.mediumThreshold ||
    draft.highThreshold !== settings.highThreshold ||
    draft.alertThreshold !== settings.alertThreshold;

  const onSave = async (event) => {
    event.preventDefault();
    const result = await save.mutate({
      mediumThreshold: Number(draft.mediumThreshold),
      highThreshold: Number(draft.highThreshold),
      alertThreshold: Number(draft.alertThreshold),
    });
    onSaved(result.data?.note ?? 'Risk thresholds updated.');
  };

  return (
    <Panel>
      <PanelHeader
        title="Risk categories and alert threshold"
        subtitle="Applies to future assessments only"
        info="Boundaries are inclusive lower bounds. A score below the medium threshold is Low, below the high threshold is Medium, and at or above it is High. An alert is created at or above the alert threshold."
      />
      {save.error ? (
        <div className="p-4">
          <ErrorBlock error={save.error} />
        </div>
      ) : null}
      <form onSubmit={onSave} className="p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Medium risk from" hint={`Scores 0–${draft.mediumThreshold - 1} are Low`}>
            <Input
              type="number"
              min="1"
              max="100"
              value={draft.mediumThreshold}
              onChange={(event) =>
                setDraft((current) => ({ ...current, mediumThreshold: event.target.value }))
              }
              disabled={!canWrite}
            />
          </Field>
          <Field
            label="High risk from"
            hint={`Scores ${draft.mediumThreshold}–${draft.highThreshold - 1} are Medium`}
          >
            <Input
              type="number"
              min="2"
              max="100"
              value={draft.highThreshold}
              onChange={(event) =>
                setDraft((current) => ({ ...current, highThreshold: event.target.value }))
              }
              disabled={!canWrite}
            />
          </Field>
          <Field label="Create an alert from" hint="Must be at or above the medium threshold">
            <Input
              type="number"
              min="1"
              max="100"
              value={draft.alertThreshold}
              onChange={(event) =>
                setDraft((current) => ({ ...current, alertThreshold: event.target.value }))
              }
              disabled={!canWrite}
            />
          </Field>
        </div>

        <p className="mt-3 text-2xs leading-relaxed text-fg-faint">
          Changing a threshold affects only assessments made afterwards. Risk assessments are
          immutable historical records, so transactions already scored keep the category they were
          given — which is what lets an alert stay explainable by the evidence that raised it.
        </p>

        {canWrite ? (
          <div className="mt-4 flex items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              className="text-xs"
              disabled={!dirty}
              isLoading={save.isPending}
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              Save thresholds
            </Button>
            {dirty ? (
              <Button variant="ghost" className="text-xs" onClick={() => setDraft(settings)}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Discard
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>
    </Panel>
  );
}

/** One rule: enable/disable, weight, and its own configuration parameters. */
function RuleCard({ rule, canWrite, onSaved }) {
  const [draft, setDraft] = useState({
    enabled: rule.enabled,
    weight: rule.weight,
    config: { ...rule.config },
  });
  const save = useMutation((payload) => settingsApi.updateRule(rule.ruleId, payload));

  useEffect(() => {
    setDraft({ enabled: rule.enabled, weight: rule.weight, config: { ...rule.config } });
  }, [rule]);

  const dirty =
    draft.enabled !== rule.enabled ||
    Number(draft.weight) !== rule.weight ||
    JSON.stringify(draft.config) !== JSON.stringify(rule.config);

  const onSave = async (event) => {
    event.preventDefault();
    const config = Object.fromEntries(
      Object.entries(draft.config).map(([key, value]) => [
        key,
        // Arrays (such as quietHoursUtc) are kept as-is; scalars are coerced so
        // a text input does not send a numeric threshold as a string.
        Array.isArray(value) ? value : Number.isNaN(Number(value)) ? value : Number(value),
      ]),
    );
    await save.mutate({ enabled: draft.enabled, weight: Number(draft.weight), config });
    onSaved(`Rule “${rule.name}” updated. The change applies to the next assessment.`);
  };

  const onReset = () => {
    setDraft({ enabled: true, weight: rule.defaultWeight, config: { ...rule.defaultConfig } });
  };

  return (
    <Panel>
      <PanelHeader
        title={rule.name}
        subtitle={rule.ruleId}
        actions={
          <>
            {rule.correlationGroup ? (
              <Badge
                className="border border-line-2 bg-surface-2 text-fg-muted"
                title={`Dampened against other rules in the "${rule.correlationGroup}" group`}
              >
                {rule.correlationGroup}
              </Badge>
            ) : null}
            {rule.enabled ? (
              <Badge className="border border-risk-low/30 bg-risk-low/10 text-risk-low">
                Enabled
              </Badge>
            ) : (
              <Badge className="border border-line-2 bg-surface-2 text-fg-faint">Disabled</Badge>
            )}
          </>
        }
      />

      {save.error ? (
        <div className="p-4">
          <ErrorBlock error={save.error} />
        </div>
      ) : null}

      <form onSubmit={onSave} className="p-5">
        <p className="mb-4 text-xs leading-relaxed text-fg-muted">{rule.description}</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Enabled">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-white/80 px-3 py-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-accent"
                checked={draft.enabled}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, enabled: event.target.checked }))
                }
                disabled={!canWrite}
              />
              <span className="text-xs text-fg">
                {draft.enabled ? 'Rule contributes to scores' : 'Rule is skipped'}
              </span>
            </label>
          </Field>

          <Field label="Weight (max contribution)" hint={`Default ${rule.defaultWeight}`}>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={draft.weight}
              onChange={(event) =>
                setDraft((current) => ({ ...current, weight: event.target.value }))
              }
              disabled={!canWrite}
            />
          </Field>

          {Object.entries(draft.config).map(([key, value]) => (
            <Field
              key={key}
              label={key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}
              hint={`Default ${JSON.stringify(rule.defaultConfig[key])}`}
            >
              {Array.isArray(value) ? (
                <Input
                  type="text"
                  value={value.join(', ')}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      config: {
                        ...current.config,
                        [key]: event.target.value
                          .split(',')
                          .map((part) => Number(part.trim()))
                          .filter((part) => Number.isInteger(part)),
                      },
                    }))
                  }
                  disabled={!canWrite}
                />
              ) : (
                <Input
                  type="number"
                  step="any"
                  value={value}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      config: { ...current.config, [key]: event.target.value },
                    }))
                  }
                  disabled={!canWrite}
                />
              )}
            </Field>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canWrite ? (
            <>
              <Button
                type="submit"
                variant="primary"
                className="text-xs"
                disabled={!dirty}
                isLoading={save.isPending}
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                Save rule
              </Button>
              {dirty ? (
                <Button
                  variant="ghost"
                  className="text-xs"
                  onClick={() =>
                    setDraft({
                      enabled: rule.enabled,
                      weight: rule.weight,
                      config: { ...rule.config },
                    })
                  }
                >
                  Discard changes
                </Button>
              ) : null}
              <Button variant="ghost" className="text-xs" onClick={onReset}>
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                Load defaults
              </Button>
            </>
          ) : null}
          <p className="ml-auto text-2xs text-fg-faint">
            {rule.updatedBy
              ? `Last changed by ${rule.updatedBy.name} on ${formatDateTime(rule.updatedAt)}`
              : `Unchanged since seeding · ruleset ${humanise(rule.rulesetVersion ?? '')}`}
          </p>
        </div>
      </form>
    </Panel>
  );
}
