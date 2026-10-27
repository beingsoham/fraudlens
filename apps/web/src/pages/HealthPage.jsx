import { useEffect, useState } from 'react';
import { Check, Database, Radio, Server, X } from 'lucide-react';
import { TopBar } from '../components/layout/TopBar.jsx';
import { PageBody } from '../components/layout/PageBody.jsx';
import {
  Badge,
  Button,
  ErrorBlock,
  LoadingBlock,
  Notice,
  Panel,
  PanelHeader,
} from '../components/ui/index.jsx';
import { useApi } from '../hooks/useApi.js';
import { useSocket } from '../context/SocketContext.jsx';
import { healthApi } from '../services/endpoints.js';
import { formatDateTime, formatDuration, formatNumber, humanise } from '../utils/format.js';

function CheckRow({ label, ok, detail, icon: Icon }) {
  return (
    <div className="flex items-center gap-3 border-b border-line/60 px-5 py-3 last:border-0">
      <span
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
          ok ? 'bg-risk-low/15 text-risk-low' : 'bg-risk-high/15 text-risk-high'
        }`}
      >
        {ok ? (
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </span>
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden="true" /> : null}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg">{label}</p>
        {detail ? <p className="text-2xs text-fg-muted">{detail}</p> : null}
      </div>
      <Badge
        className={
          ok
            ? 'border border-risk-low/30 bg-risk-low/10 text-risk-low'
            : 'border border-risk-high/30 bg-risk-high/10 text-risk-high'
        }
      >
        {ok ? 'OK' : 'Failing'}
      </Badge>
    </div>
  );
}

/**
 * Operational health.
 *
 * Reports API availability, database connectivity, migration state, the
 * simulator worker and the application version. The endpoint deliberately
 * exposes no connection string, host name, file path or credential — an
 * operator needs to know *whether* the database is reachable, not where it is.
 */
export function HealthPage() {
  const { connected, lastError } = useSocket();
  const { data, error, isLoading, refetch } = useApi((options) => healthApi.status(options), []);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = setInterval(refetch, 15_000);
    return () => clearInterval(timer);
  }, [autoRefresh, refetch]);

  const checks = data?.checks ?? {};
  const detail = data?.detail;

  return (
    <>
      <TopBar
        title="System health"
        subtitle={data ? `Status: ${data.status} · version ${data.version}` : 'Checking…'}
        actions={
          <>
            <Button
              variant={autoRefresh ? 'primary' : 'secondary'}
              className="text-xs"
              onClick={() => setAutoRefresh((value) => !value)}
            >
              {autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
            </Button>
            <Button variant="secondary" className="text-xs" onClick={refetch}>
              Check now
            </Button>
          </>
        }
      />

      <PageBody>
        {error ? <ErrorBlock error={error} onRetry={refetch} /> : null}
        {isLoading && !data ? <LoadingBlock rows={6} /> : null}

        {data ? (
          <>
            {data.status !== 'ok' ? (
              <Notice tone={data.status === 'unhealthy' ? 'error' : 'warning'}>
                The API reports status <strong>{data.status}</strong>. Check the failing components
                below.
              </Notice>
            ) : null}

            <Panel>
              <PanelHeader
                title="Component checks"
                subtitle={`Last checked ${formatDateTime(data.timestamp)}`}
              />
              <CheckRow
                label="API availability"
                ok={checks.api?.ok}
                icon={Server}
                detail="The process is responding to requests"
              />
              <CheckRow
                label="PostgreSQL connectivity"
                ok={checks.database?.ok}
                icon={Database}
                detail={
                  detail?.database?.latencyMs !== undefined && detail?.database?.latencyMs !== null
                    ? `Round-trip latency ${detail.database.latencyMs} ms`
                    : 'Connection to the primary application database'
                }
              />
              <CheckRow
                label="Database migration state"
                ok={checks.migrations?.ok}
                icon={Database}
                detail={
                  detail?.migrations
                    ? `${detail.migrations.appliedCount} applied, ${detail.migrations.pendingCount} pending · latest ${detail.migrations.latestMigration ?? 'none'}`
                    : 'Whether every migration has been applied'
                }
              />
              <CheckRow
                label="Real-time event server"
                ok={checks.realtime?.ok}
                icon={Radio}
                detail={
                  connected
                    ? 'This browser holds a live authenticated socket'
                    : (lastError ?? 'This browser is not currently connected')
                }
              />
              <CheckRow
                label="Simulator worker"
                ok={checks.simulator?.ok}
                icon={Radio}
                detail={
                  checks.simulator?.running
                    ? 'Running and generating transactions'
                    : 'Stopped — this is a normal idle state, not a failure'
                }
              />
            </Panel>

            {detail ? (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <Panel>
                  <PanelHeader title="Application" />
                  <dl className="divide-y divide-line/60">
                    {[
                      [
                        'Version',
                        detail.nodeEnv ? `${data.version} (${detail.nodeEnv})` : data.version,
                      ],
                      ['Ruleset version', detail.rulesetVersion],
                      ['Node.js', detail.process?.nodeVersion],
                      ['Uptime', formatDuration(detail.uptimeSeconds / 3600)],
                      ['Started at', formatDateTime(detail.startedAt)],
                      ['Resident memory', `${detail.process?.memoryMb} MB`],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between gap-4 px-5 py-2.5"
                      >
                        <dt className="text-xs text-fg-muted">{label}</dt>
                        <dd className="tabular text-xs text-fg">{value ?? '—'}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="border-t border-line/70 px-5 py-2.5 text-2xs leading-relaxed text-fg-faint">
                    No connection string, host name or credential is exposed by this endpoint.
                  </p>
                </Panel>

                <Panel>
                  <PanelHeader title="Data and simulator" />
                  <dl className="divide-y divide-line/60">
                    {[
                      ['Transactions', formatNumber(detail.counts?.transactions)],
                      ['Alerts', formatNumber(detail.counts?.alerts)],
                      ['Active users', formatNumber(detail.counts?.activeUsers)],
                      ['Simulator status', humanise(detail.simulator?.status)],
                      [
                        'Simulator ingested',
                        formatNumber(detail.simulator?.counters?.ingested ?? 0),
                      ],
                      [
                        'Simulator alerts',
                        formatNumber(detail.simulator?.counters?.alertsCreated ?? 0),
                      ],
                      ['Simulator failures', formatNumber(detail.simulator?.counters?.failed ?? 0)],
                      ['Effective rate', `${detail.simulator?.effectiveRatePerSecond ?? 0}/s`],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between gap-4 px-5 py-2.5"
                      >
                        <dt className="text-xs text-fg-muted">{label}</dt>
                        <dd className="tabular text-xs text-fg">{value ?? '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </Panel>
              </div>
            ) : (
              <Notice tone="info">
                Additional detail — latencies, migration names and counters — is shown to users with
                the <code className="font-mono">settings:read</code> permission.
              </Notice>
            )}
          </>
        ) : null}
      </PageBody>
    </>
  );
}
