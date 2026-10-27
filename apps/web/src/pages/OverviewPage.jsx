import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  BanknoteArrowDown,
  CalendarClock,
  Gauge,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { SOCKET_EVENT } from '@fraudlens/shared/constants';
import { TopBar } from '../components/layout/TopBar.jsx';
import { PageBody } from '../components/layout/PageBody.jsx';
import { RangeFilter } from '../components/layout/RangeFilter.jsx';
import { StatTile } from '../components/layout/StatTile.jsx';
import {
  AlertTrendChart,
  RiskDistributionChart,
  TopRulesChart,
  TransactionVolumeChart,
} from '../components/charts/index.jsx';
import { Badge, ErrorBlock, LoadingBlock, Panel, PanelHeader } from '../components/ui/index.jsx';
import {
  AlertStatusBadge,
  OutcomeBadge,
  RiskBadge,
  SeverityBadge,
} from '../components/ui/StatusBadges.jsx';
import { useApi } from '../hooks/useApi.js';
import { useSocketEvent } from '../context/SocketContext.jsx';
import { dashboardApi } from '../services/endpoints.js';
import { DEFAULT_RANGE_ID, resolvePreset } from '../utils/dateRanges.js';
import {
  formatCurrency,
  formatCurrencyCompact,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelative,
} from '../utils/format.js';

/** Keeps the live activity feed bounded; older entries are of no interest. */
const MAX_FEED_ENTRIES = 25;

/**
 * Overview dashboard.
 *
 * Every tile and chart on this page is computed by the API from persisted rows,
 * and each tile carries the server-supplied definition of the figure it shows.
 *
 * Note the deliberate separation in the tile row: "High risk" and "Flagged
 * value" describe what the *engine* scored, while "Confirmed fraud" describes
 * what a *human investigator* concluded. They are never summed or presented as
 * the same measure.
 */
export function OverviewPage() {
  const [rangeId, setRangeId] = useState(DEFAULT_RANGE_ID);
  const range = useMemo(() => resolvePreset(rangeId), [rangeId]);
  const rangeParams = useMemo(() => ({ from: range.from, to: range.to }), [range]);

  const summary = useApi((options) => dashboardApi.summary(rangeParams, options), [rangeParams]);
  const series = useApi(
    (options) =>
      dashboardApi.transactionSeries({ ...rangeParams, interval: range.interval }, options),
    [rangeParams, range.interval],
  );
  const distribution = useApi(
    (options) => dashboardApi.riskDistribution(rangeParams, options),
    [rangeParams],
  );
  const topRules = useApi(
    (options) => dashboardApi.topRules({ ...rangeParams, limit: 8 }, options),
    [rangeParams],
  );
  const alertTrend = useApi(
    (options) => dashboardApi.alertTrend({ ...rangeParams, interval: range.interval }, options),
    [rangeParams, range.interval],
  );
  const recentAlerts = useApi((options) => dashboardApi.recentAlerts({ limit: 6 }, options), []);
  const recentTransactions = useApi(
    (options) => dashboardApi.recentTransactions({ limit: 8 }, options),
    [],
  );

  const [feed, setFeed] = useState([]);

  // The live feed is append-only in the UI and bounded, so a running simulator
  // cannot grow this array without limit.
  useSocketEvent(
    SOCKET_EVENT.TRANSACTION_ASSESSED,
    useCallback((payload) => {
      setFeed((entries) =>
        [
          {
            kind: 'transaction',
            id: payload.transactionId,
            externalId: payload.externalId,
            riskScore: payload.riskScore,
            riskCategory: payload.riskCategory,
            at: payload.assessedAt,
          },
          ...entries,
        ].slice(0, MAX_FEED_ENTRIES),
      );
    }, []),
  );

  useSocketEvent(
    SOCKET_EVENT.ALERT_CREATED,
    useCallback((payload) => {
      setFeed((entries) =>
        [
          {
            kind: 'alert',
            id: payload.id,
            severity: payload.severity,
            riskScore: payload.riskScore,
            amount: payload.amount,
            senderRef: payload.senderRef,
            receiverRef: payload.receiverRef,
            at: payload.createdAt,
          },
          ...entries,
        ].slice(0, MAX_FEED_ENTRIES),
      );
    }, []),
  );

  const metrics = summary.data?.metrics;
  const definitions = summary.data?.definitions ?? {};
  const thresholds = summary.data?.thresholds;

  return (
    <>
      <TopBar
        title="Overview"
        subtitle={
          summary.data
            ? `Ruleset ${summary.data.rulesetVersion} · alert threshold ${thresholds?.alertThreshold ?? '—'}`
            : 'Loading dashboard…'
        }
        actions={<RangeFilter value={rangeId} onChange={setRangeId} />}
      />

      <PageBody>
        {summary.error ? <ErrorBlock error={summary.error} onRetry={summary.refetch} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label="Total transactions"
            value={formatNumber(metrics?.totalTransactions)}
            definition={definitions.totalTransactions?.definition}
            sublabel="All time"
            icon={Activity}
            isLoading={summary.isLoading}
          />
          <StatTile
            label="Received today"
            value={formatNumber(metrics?.transactionsToday)}
            definition={definitions.transactionsToday?.definition}
            sublabel="Current UTC day"
            icon={CalendarClock}
            isLoading={summary.isLoading}
          />
          <StatTile
            label="High risk"
            value={formatNumber(metrics?.highRiskTransactions)}
            definition={definitions.highRiskTransactions?.definition}
            sublabel={`In ${range.label.toLowerCase()}`}
            icon={Gauge}
            tone="high"
            isLoading={summary.isLoading}
          />
          <StatTile
            label="Open alerts"
            value={formatNumber(metrics?.openAlerts)}
            definition={definitions.openAlerts?.definition}
            sublabel={`${formatNumber(metrics?.unassignedAlerts)} unassigned`}
            icon={ShieldAlert}
            tone="accent"
            isLoading={summary.isLoading}
          />
          <StatTile
            label="Flagged value"
            value={formatCurrencyCompact(metrics?.flaggedValue)}
            definition={definitions.flaggedValue?.definition}
            sublabel="Under review, not confirmed loss"
            icon={BanknoteArrowDown}
            tone="medium"
            isLoading={summary.isLoading}
          />
          <StatTile
            label="Confirmed fraud"
            value={formatNumber(metrics?.confirmedFraudCases)}
            definition={definitions.confirmedFraudCases?.definition}
            sublabel={`${formatCurrencyCompact(metrics?.confirmedFraudValue)} · investigator-confirmed`}
            icon={ShieldCheck}
            tone="critical"
            isLoading={summary.isLoading}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Panel className="xl:col-span-2">
            <PanelHeader
              title="Transaction volume"
              subtitle={`${formatNumber(metrics?.transactionsInRange)} transactions · ${formatCurrency(metrics?.valueInRange)}`}
              info="Transactions per time bucket, split by the risk category of each transaction's latest assessment. Buckets with no activity are shown as zero."
            />
            <div className="p-4">
              {series.isLoading ? (
                <LoadingBlock rows={5} />
              ) : series.error ? (
                <ErrorBlock error={series.error} onRetry={series.refetch} />
              ) : (
                <TransactionVolumeChart points={series.data?.points} interval={range.interval} />
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Risk distribution"
              subtitle={
                thresholds
                  ? `Low < ${thresholds.mediumThreshold} · Medium < ${thresholds.highThreshold} · High ≥ ${thresholds.highThreshold}`
                  : undefined
              }
              info="Share of transactions in range by the risk category of their latest assessment. A category is a review signal, not a finding of fraud."
            />
            <div className="p-4">
              {distribution.isLoading ? (
                <LoadingBlock rows={4} />
              ) : distribution.error ? (
                <ErrorBlock error={distribution.error} onRetry={distribution.refetch} />
              ) : (
                <RiskDistributionChart categories={distribution.data?.categories} />
              )}
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Panel>
            <PanelHeader
              title="Fraud detection trend"
              subtitle="Alerts created, resolved, and confirmed as fraud"
              info="Alerts are counted in the bucket they were created in; resolutions in the bucket they were resolved in. Confirmed fraud counts only alerts an investigator resolved as CONFIRMED_FRAUD."
            />
            <div className="p-4">
              {alertTrend.isLoading ? (
                <LoadingBlock rows={4} />
              ) : alertTrend.error ? (
                <ErrorBlock error={alertTrend.error} onRetry={alertTrend.refetch} />
              ) : (
                <AlertTrendChart points={alertTrend.data?.points} interval={range.interval} />
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Top triggered rules"
              subtitle={`Across ${formatNumber(topRules.data?.assessmentCount)} assessments`}
              info="How often each detection rule fired in range. Bars are coloured by the share of that rule's firings that landed on a HIGH-risk assessment: red above 25%, amber above 10%."
            />
            <div className="p-4">
              {topRules.isLoading ? (
                <LoadingBlock rows={5} />
              ) : topRules.error ? (
                <ErrorBlock error={topRules.error} onRetry={topRules.refetch} />
              ) : (
                <TopRulesChart rules={topRules.data?.rules} />
              )}
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Panel className="xl:col-span-2">
            <PanelHeader
              title="Recent alerts"
              actions={
                <Link to="/alerts" className="link text-xs">
                  View all
                </Link>
              }
            />
            {recentAlerts.isLoading ? (
              <LoadingBlock rows={4} />
            ) : recentAlerts.error ? (
              <div className="p-4">
                <ErrorBlock error={recentAlerts.error} onRetry={recentAlerts.refetch} />
              </div>
            ) : recentAlerts.data?.length ? (
              <ul className="divide-y divide-line/60">
                {recentAlerts.data.map((alert) => (
                  <li key={alert.id}>
                    <Link
                      to={`/alerts/${alert.id}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/60"
                    >
                      <SeverityBadge severity={alert.severity} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs text-fg">
                          {alert.transaction.senderRef} → {alert.transaction.receiverRef}
                        </p>
                        <p className="tabular text-2xs text-fg-muted">
                          {formatCurrency(alert.transaction.amount)} · score {alert.riskScore} ·{' '}
                          {formatRelative(alert.createdAt)}
                        </p>
                      </div>
                      <AlertStatusBadge status={alert.status} />
                      {alert.outcome !== 'PENDING' ? (
                        <OutcomeBadge outcome={alert.outcome} withIcon={false} />
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-fg-muted">
                No alerts have been raised yet.
              </p>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="Live activity"
              subtitle={feed.length ? `${feed.length} events this session` : 'Waiting for events'}
              info="Real-time events delivered over the authenticated socket. The feed starts empty on page load and is not a history — use the transaction list for that."
            />
            {feed.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs leading-relaxed text-fg-muted">
                No live events yet. Start the simulator from the Analytics page, or ingest a
                transaction, to see activity appear here in real time.
              </p>
            ) : (
              <ul className="max-h-80 divide-y divide-line/60 overflow-y-auto">
                {feed.map((entry, index) => (
                  <li
                    key={`${entry.kind}-${entry.id}-${index}`}
                    className="flex items-center gap-2.5 px-4 py-2.5 animate-fade-in"
                  >
                    {entry.kind === 'alert' ? (
                      <AlertCircle
                        className="h-3.5 w-3.5 shrink-0 text-risk-high"
                        aria-hidden="true"
                      />
                    ) : (
                      <TrendingUp
                        className="h-3.5 w-3.5 shrink-0 text-fg-faint"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      {entry.kind === 'alert' ? (
                        <>
                          <p className="truncate text-xs text-fg">Alert raised</p>
                          <p className="truncate font-mono text-2xs text-fg-faint">
                            {entry.senderRef} → {entry.receiverRef}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="truncate font-mono text-xs text-fg">{entry.externalId}</p>
                          <p className="text-2xs text-fg-faint">{formatRelative(entry.at)}</p>
                        </>
                      )}
                    </div>
                    {entry.kind === 'alert' ? (
                      <SeverityBadge severity={entry.severity} />
                    ) : (
                      <RiskBadge category={entry.riskCategory} score={entry.riskScore} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel>
          <PanelHeader
            title="Recent transactions"
            subtitle={
              metrics
                ? `Average risk score ${metrics.averageRiskScore ?? '—'} · resolution rate ${formatPercent(metrics.alertResolutionRate)} · median time to resolve ${formatDuration(metrics.medianTimeToResolve)}`
                : undefined
            }
            actions={
              <Link to="/transactions" className="link text-xs">
                Open the monitor
              </Link>
            }
          />
          {recentTransactions.isLoading ? (
            <LoadingBlock rows={5} />
          ) : recentTransactions.error ? (
            <div className="p-4">
              <ErrorBlock error={recentTransactions.error} onRetry={recentTransactions.refetch} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="table-head">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">
                      Transaction
                    </th>
                    <th scope="col" className="px-4 py-2.5">
                      Sender
                    </th>
                    <th scope="col" className="px-4 py-2.5">
                      Receiver
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right">
                      Amount
                    </th>
                    <th scope="col" className="px-4 py-2.5">
                      When
                    </th>
                    <th scope="col" className="px-4 py-2.5">
                      Risk
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentTransactions.data?.map((transaction) => (
                    <tr key={transaction.id} className="table-row">
                      <td className="px-4 py-2.5">
                        <Link
                          to={`/transactions/${transaction.id}`}
                          className="link font-mono text-xs"
                        >
                          {transaction.externalId}
                        </Link>
                        {transaction.isNewDevice ? (
                          <Badge className="ml-2 border border-risk-medium/30 bg-risk-medium/10 text-risk-medium">
                            New device
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">
                        {transaction.senderRef}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">
                        {transaction.receiverRef}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-xs text-fg">
                        {formatCurrency(transaction.amount)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-fg-muted">
                        {formatRelative(transaction.occurredAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <RiskBadge
                          category={transaction.riskCategory}
                          score={transaction.riskScore}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
