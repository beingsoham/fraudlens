import { useCallback, useMemo, useState } from 'react';
import { Download, Play, Square } from 'lucide-react';
import { PERMISSION, SOCKET_EVENT } from '@fraudlens/shared/constants';
import { TopBar } from '../components/layout/TopBar.jsx';
import { PageBody } from '../components/layout/PageBody.jsx';
import { RangeFilter } from '../components/layout/RangeFilter.jsx';
import { StatTile } from '../components/layout/StatTile.jsx';
import {
  OutcomeChart,
  ScoreHistogramChart,
  TransactionValueChart,
} from '../components/charts/index.jsx';
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
  Select,
} from '../components/ui/index.jsx';
import { useApi, useMutation } from '../hooks/useApi.js';
import { useSocketEvent } from '../context/SocketContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { analyticsApi, dashboardApi, simulatorApi } from '../services/endpoints.js';
import { DEFAULT_RANGE_ID, resolvePreset } from '../utils/dateRanges.js';
import {
  formatCurrency,
  formatCurrencyCompact,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRatioAsPercent,
} from '../utils/format.js';

/**
 * Analytics and reporting.
 *
 * The page is split into two clearly labelled halves, and the split is the
 * whole point:
 *
 *  - **Observed statistics** — counts and sums measured from this database.
 *  - **Detection performance** — model evaluation metrics, shown only where
 *    reliable ground truth exists, always with their sample size, their source,
 *    and the caveats the API returns alongside them.
 *
 * Nothing here presents a measured number as a general claim about accuracy.
 */
export function AnalyticsPage() {
  const { can } = useAuth();
  const [rangeId, setRangeId] = useState(DEFAULT_RANGE_ID);
  const range = useMemo(() => resolvePreset(rangeId), [rangeId]);
  const rangeParams = useMemo(() => ({ from: range.from, to: range.to }), [range]);
  const [groundTruthSource, setGroundTruthSource] = useState('SIMULATOR');
  const [notice, setNotice] = useState(null);

  const overview = useApi((options) => analyticsApi.overview(rangeParams, options), [rangeParams]);
  const detection = useApi(
    (options) =>
      analyticsApi.detectionPerformance({ ...rangeParams, source: groundTruthSource }, options),
    [rangeParams, groundTruthSource],
  );
  const histogram = useApi(
    (options) => analyticsApi.scoreHistogram(rangeParams, options),
    [rangeParams],
  );
  const rulePerformance = useApi(
    (options) => analyticsApi.rulePerformance(rangeParams, options),
    [rangeParams],
  );
  const series = useApi(
    (options) =>
      dashboardApi.transactionSeries({ ...rangeParams, interval: range.interval }, options),
    [rangeParams, range.interval],
  );

  const metrics = detection.data?.metrics;
  const observed = overview.data;

  return (
    <>
      <TopBar
        title="Analytics and reports"
        subtitle={range.label}
        actions={<RangeFilter value={rangeId} onChange={setRangeId} />}
      />

      <PageBody>
        {notice ? (
          <Notice tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        ) : null}

        {can(PERMISSION.SIMULATOR_READ) ? <SimulatorPanel onNotice={setNotice} /> : null}

        {/* ---- Observed application statistics ---- */}
        <div>
          <div className="mb-3 flex items-baseline gap-2.5">
            <h2 className="text-sm font-semibold tracking-tight text-fg">
              Observed application statistics
            </h2>
            <Badge className="border border-accent/30 bg-accent/10 text-accent">Measured</Badge>
          </div>
          <p className="mb-3 max-w-3xl text-xs leading-relaxed text-fg-muted">
            Counts and sums measured from the rows in this database. They describe the activity this
            deployment has processed. They are not estimates of model accuracy.
          </p>

          {overview.error ? <ErrorBlock error={overview.error} onRetry={overview.refetch} /> : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatTile
              label="Transactions"
              value={formatNumber(observed?.transactions.count)}
              definition={observed?.definitions?.transactionsInRange?.definition}
              isLoading={overview.isLoading}
            />
            <StatTile
              label="Total value"
              value={formatCurrencyCompact(observed?.transactions.value)}
              definition="Sum of the amounts of all transactions whose occurredAt falls inside the selected range."
              isLoading={overview.isLoading}
            />
            <StatTile
              label="Median amount"
              value={formatCurrency(observed?.transactions.medianAmount)}
              definition="The 50th percentile transaction amount in range, which is less distorted by a few very large payments than the mean."
              isLoading={overview.isLoading}
            />
            <StatTile
              label="Average risk score"
              value={observed?.transactions.averageRiskScore ?? '—'}
              definition={observed?.definitions?.averageRiskScore?.definition}
              isLoading={overview.isLoading}
            />
            <StatTile
              label="Alerts created"
              value={formatNumber(observed?.alerts.created)}
              definition="Alerts whose createdAt falls inside the selected range."
              sublabel={`${formatNumber(observed?.alerts.resolved)} resolved`}
              tone="accent"
              isLoading={overview.isLoading}
            />
            <StatTile
              label="Median time to resolve"
              value={formatDuration(observed?.alerts.medianHoursToResolve)}
              definition={observed?.definitions?.medianTimeToResolve?.definition}
              sublabel={`${formatNumber(observed?.alerts.reopened)} reopened`}
              isLoading={overview.isLoading}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Panel>
            <PanelHeader
              title="Transaction value over time"
              info="Sum of transaction amounts per time bucket, from persisted rows."
            />
            <div className="p-4">
              {series.isLoading ? (
                <LoadingBlock rows={4} />
              ) : (
                <TransactionValueChart points={series.data?.points} interval={range.interval} />
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Investigation outcomes"
              subtitle="What human investigators concluded"
              info="Alerts grouped by the outcome an investigator recorded. 'No conclusion yet' means the alert has not been resolved — it is not a judgement either way."
            />
            <div className="p-4">
              {overview.isLoading ? (
                <LoadingBlock rows={4} />
              ) : (
                <OutcomeChart outcomes={observed?.outcomes} />
              )}
            </div>
          </Panel>
        </div>

        <Panel>
          <PanelHeader
            title="Risk score distribution"
            subtitle={
              histogram.data?.thresholds
                ? `Thresholds: medium ≥ ${histogram.data.thresholds.mediumThreshold}, high ≥ ${histogram.data.thresholds.highThreshold}, alert ≥ ${histogram.data.thresholds.alertThreshold}`
                : undefined
            }
            info="Count of transactions in each ten-point score band. Bars are coloured by the risk category the current thresholds assign to that band."
          />
          <div className="p-4">
            {histogram.isLoading ? (
              <LoadingBlock rows={4} />
            ) : (
              <ScoreHistogramChart
                bands={histogram.data?.bands}
                thresholds={histogram.data?.thresholds}
              />
            )}
          </div>
        </Panel>

        {/* ---- Model evaluation ---- */}
        <div>
          <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
            <h2 className="text-sm font-semibold tracking-tight text-fg">Detection performance</h2>
            <Badge className="border border-risk-medium/30 bg-risk-medium/10 text-risk-medium">
              Model evaluation
            </Badge>
            <Select
              className="ml-auto w-56 py-1.5 text-xs"
              value={groundTruthSource}
              onChange={(event) => setGroundTruthSource(event.target.value)}
              aria-label="Ground truth source"
            >
              <option value="SIMULATOR">Ground truth: simulator labels</option>
              <option value="INVESTIGATION">Ground truth: investigator outcomes</option>
            </Select>
          </div>

          {detection.error ? (
            <ErrorBlock error={detection.error} onRetry={detection.refetch} />
          ) : detection.isLoading ? (
            <Panel>
              <LoadingBlock rows={5} />
            </Panel>
          ) : (
            <Panel>
              <div className="border-b border-line/70 px-5 py-4">
                <p className="text-xs leading-relaxed text-fg-muted">
                  Evaluated against{' '}
                  <span className="font-medium text-fg">
                    {formatNumber(detection.data?.labelledSampleSize)}
                  </span>{' '}
                  labelled transactions, at alert threshold{' '}
                  <span className="tabular font-medium text-fg">
                    {detection.data?.alertThreshold}
                  </span>
                  , under ruleset{' '}
                  <span className="font-mono text-fg">{detection.data?.rulesetVersion}</span>.
                </p>
                {detection.data?.caveats?.length ? (
                  <ul className="mt-2.5 space-y-1">
                    {detection.data.caveats.map((caveat, index) => (
                      <li
                        key={index}
                        className="flex gap-2 text-2xs leading-relaxed text-risk-medium"
                      >
                        <span aria-hidden="true">•</span>
                        <span>{caveat}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {!detection.data?.available ? (
                <div className="px-5 py-6">
                  <Notice tone="warning">
                    <p className="font-medium">Metrics withheld</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                      {detection.data?.unavailableReason}
                    </p>
                  </Notice>
                  <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {Object.entries(detection.data?.confusionMatrix ?? {}).map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-line bg-surface-2/70 p-3">
                        <dt className="text-2xs uppercase tracking-wider text-fg-muted">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </dt>
                        <dd className="tabular mt-1 text-lg font-semibold text-fg">
                          {formatNumber(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
                    <StatTile
                      label="Precision"
                      value={formatRatioAsPercent(metrics?.precision)}
                      definition={detection.data?.definitions?.precision?.definition}
                      sublabel="Of the transactions flagged, the share that were labelled fraudulent"
                      tone="accent"
                    />
                    <StatTile
                      label="Recall"
                      value={formatRatioAsPercent(metrics?.recall)}
                      definition={detection.data?.definitions?.recall?.definition}
                      sublabel="Of the labelled-fraudulent transactions, the share that were flagged"
                      tone="medium"
                    />
                    <StatTile
                      label="F1 score"
                      value={formatRatioAsPercent(metrics?.f1Score)}
                      definition={detection.data?.definitions?.f1Score?.definition}
                      sublabel="Harmonic mean of precision and recall"
                    />
                    <StatTile
                      label="False-positive rate"
                      value={formatRatioAsPercent(metrics?.falsePositiveRate)}
                      definition={detection.data?.definitions?.falsePositiveRate?.definition}
                      sublabel="Of the labelled-legitimate transactions, the share that were flagged"
                      tone="high"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 border-t border-line/70 p-5 sm:grid-cols-4">
                    {[
                      ['True positives', metrics?.truePositives, 'low'],
                      ['False positives', metrics?.falsePositives, 'high'],
                      ['True negatives', metrics?.trueNegatives, 'low'],
                      ['False negatives', metrics?.falseNegatives, 'high'],
                    ].map(([label, value, tone]) => (
                      <div
                        key={label}
                        className="rounded-lg border border-line bg-surface-2/70 p-3"
                      >
                        <p className="text-2xs uppercase tracking-wider text-fg-muted">{label}</p>
                        <p
                          className={`tabular mt-1 text-lg font-semibold ${
                            tone === 'high' ? 'text-risk-high' : 'text-risk-low'
                          }`}
                        >
                          {formatNumber(value)}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Panel>
          )}
        </div>

        <Panel>
          <PanelHeader
            title="Detection rule frequency"
            subtitle={`Across ${formatNumber(rulePerformance.data?.assessmentCount)} assessments`}
            info={rulePerformance.data?.note}
          />
          {rulePerformance.isLoading ? (
            <LoadingBlock rows={6} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="table-head">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">
                      Rule
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right">
                      Triggered
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right">
                      Trigger rate
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right">
                      Avg contribution
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right">
                      On alerts
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right">
                      Confirmed fraud
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right">
                      Legitimate
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right">
                      Precision on judged alerts
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rulePerformance.data?.rules?.map((rule) => (
                    <tr key={rule.ruleId} className="table-row">
                      <td className="px-4 py-2.5">
                        <p className="text-xs text-fg">{rule.name}</p>
                        <p className="font-mono text-2xs text-fg-faint">{rule.ruleId}</p>
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-xs">
                        {formatNumber(rule.triggerCount)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-xs text-fg-muted">
                        {formatPercent(rule.triggerRate)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-xs text-fg-muted">
                        {rule.averageContribution ?? '—'}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-xs">
                        {formatNumber(rule.alertCount)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-xs text-risk-critical">
                        {formatNumber(rule.confirmedFraudCount)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-xs text-risk-low">
                        {formatNumber(rule.legitimateCount)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-xs">
                        {rule.precisionOnJudgedAlerts === null ? (
                          <span
                            className="text-fg-faint"
                            title="Fewer than 10 conclusively judged alerts"
                          >
                            insufficient sample
                          </span>
                        ) : (
                          formatPercent(rule.precisionOnJudgedAlerts)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {can(PERMISSION.ANALYTICS_EXPORT) ? (
          <ExportPanel range={range} onNotice={setNotice} />
        ) : null}
      </PageBody>
    </>
  );
}

/**
 * Simulator controls.
 *
 * The status is seeded from the REST endpoint and then kept current by the
 * `simulator:status` socket event, so the counters tick without polling.
 */
function SimulatorPanel({ onNotice }) {
  const { can } = useAuth();
  const canManage = can(PERMISSION.SIMULATOR_MANAGE);
  const { data, refetch, isLoading } = useApi((options) => simulatorApi.status(options), []);
  const [live, setLive] = useState(null);
  const [rate, setRate] = useState(2);
  const [seed, setSeed] = useState(424242);
  const [maxTransactions, setMaxTransactions] = useState('');

  useSocketEvent(
    SOCKET_EVENT.SIMULATOR_STATUS,
    useCallback((payload) => setLive(payload), []),
  );

  const start = useMutation((payload) => simulatorApi.start(payload));
  const stop = useMutation(() => simulatorApi.stop());

  const status = live ?? data;
  const running = status?.running;

  const onStart = async () => {
    await start.mutate({
      ratePerSecond: Number(rate),
      seed: Number(seed),
      maxTransactions: maxTransactions ? Number(maxTransactions) : undefined,
    });
    onNotice(
      'Simulator started. Transactions flow through the same ingestion pipeline as the API.',
    );
    refetch();
  };

  const onStop = async () => {
    await stop.mutate();
    onNotice('Simulator stopped.');
    refetch();
  };

  return (
    <Panel>
      <PanelHeader
        title="Transaction simulator"
        subtitle={
          status
            ? `${status.status} · ${formatNumber(status.counters?.ingested ?? 0)} ingested · ${formatNumber(status.counters?.alertsCreated ?? 0)} alerts`
            : 'Loading…'
        }
        info="The simulator feeds generated transactions through the same ingestion, scoring and persistence pipeline as the HTTP endpoint. Runs are reproducible: the same seed and scenario mix produce the same stream."
        actions={
          canManage ? (
            running ? (
              <Button
                variant="danger"
                className="text-xs"
                onClick={onStop}
                isLoading={stop.isPending}
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
                Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                className="text-xs"
                onClick={onStart}
                isLoading={start.isPending}
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                Start
              </Button>
            )
          ) : null
        }
      />

      {start.error ? (
        <div className="p-4">
          <ErrorBlock error={start.error} />
        </div>
      ) : null}
      {stop.error ? (
        <div className="p-4">
          <ErrorBlock error={stop.error} />
        </div>
      ) : null}

      {isLoading && !status ? (
        <LoadingBlock rows={3} />
      ) : (
        <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-2">
          {canManage ? (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Rate (per second)" hint={`Max ${status?.maxRatePerSecond ?? 25}`}>
                <Input
                  type="number"
                  min="0.1"
                  max={status?.maxRatePerSecond ?? 25}
                  step="0.1"
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                  disabled={running}
                />
              </Field>
              <Field label="RNG seed" hint="Same seed, same stream">
                <Input
                  type="number"
                  min="0"
                  value={seed}
                  onChange={(event) => setSeed(event.target.value)}
                  disabled={running}
                />
              </Field>
              <Field label="Stop after" hint="Blank to run until stopped">
                <Input
                  type="number"
                  min="1"
                  placeholder="∞"
                  value={maxTransactions}
                  onChange={(event) => setMaxTransactions(event.target.value)}
                  disabled={running}
                />
              </Field>
            </div>
          ) : (
            <p className="text-xs text-fg-muted">
              Your role can view the simulator status but not start or stop it.
            </p>
          )}

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ['Status', status?.status ?? '—'],
              ['Ingested', formatNumber(status?.counters?.ingested ?? 0)],
              ['Alerts raised', formatNumber(status?.counters?.alertsCreated ?? 0)],
              ['High risk', formatNumber(status?.counters?.highRisk ?? 0)],
              ['Duplicates', formatNumber(status?.counters?.duplicates ?? 0)],
              ['Failed', formatNumber(status?.counters?.failed ?? 0)],
              ['Effective rate', `${status?.effectiveRatePerSecond ?? 0}/s`],
              ['Running for', `${status?.runningForSeconds ?? 0}s`],
              ['Queued in scenario', formatNumber(status?.pendingScenarioTransactions ?? 0)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-line bg-surface-2/70 px-3 py-2">
                <dt className="text-2xs uppercase tracking-wider text-fg-muted">{label}</dt>
                <dd className="tabular mt-0.5 text-sm font-medium text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {status?.lastError ? (
        <div className="border-t border-line/70 px-5 py-3">
          <p className="text-2xs text-risk-high">
            Last error: {status.lastError.message} ({status.lastError.at})
          </p>
        </div>
      ) : null}
    </Panel>
  );
}

/** CSV export panel. Each export is recorded in the audit log. */
function ExportPanel({ range, onNotice }) {
  const { data: datasets } = useApi((options) => analyticsApi.exportDatasets(options), []);
  const [dataset, setDataset] = useState('transactions');
  const download = useMutation((params) => analyticsApi.download(params));

  const onDownload = async () => {
    const result = await download.mutate({
      dataset,
      from: range.from,
      to: range.to,
      limit: 10_000,
    });
    onNotice(`Exported ${formatNumber(result.rowCount)} rows to ${result.filename}.`);
  };

  return (
    <Panel>
      <PanelHeader
        title="CSV reports"
        subtitle="Every export is recorded in the audit log"
        info="Exported cells that would be interpreted as a spreadsheet formula are neutralised before download, so a value such as =HYPERLINK(...) cannot execute when the file is opened."
      />
      {download.error ? (
        <div className="p-4">
          <ErrorBlock error={download.error} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3 p-5">
        <Field label="Dataset" className="min-w-[220px]">
          <Select value={dataset} onChange={(event) => setDataset(event.target.value)}>
            {(datasets ?? [{ dataset: 'transactions' }]).map((entry) => (
              <option key={entry.dataset} value={entry.dataset}>
                {entry.dataset.replace(/-/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Range">
          <p className="rounded-lg border border-line bg-white/80 px-3 py-2 text-xs text-fg-muted">
            {range.label}
          </p>
        </Field>
        <Button
          variant="primary"
          className="text-xs"
          onClick={onDownload}
          isLoading={download.isPending}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Download CSV
        </Button>
      </div>
    </Panel>
  );
}
