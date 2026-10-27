import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, Search, ShieldCheck, X } from 'lucide-react';
import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  INVESTIGATION_OUTCOMES,
  PAGE_SIZE_OPTIONS,
  PERMISSION,
  SOCKET_EVENT,
} from '@fraudlens/shared/constants';
import { TopBar } from '../components/layout/TopBar.jsx';
import { PageBody } from '../components/layout/PageBody.jsx';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  Pagination,
  Panel,
  Select,
  SortableHeader,
} from '../components/ui/index.jsx';
import {
  AlertStatusBadge,
  OutcomeBadge,
  RiskBadge,
  SeverityBadge,
} from '../components/ui/StatusBadges.jsx';
import { useApi, useDebounced } from '../hooks/useApi.js';
import { useSocketEvent } from '../context/SocketContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { alertsApi } from '../services/endpoints.js';
import { formatCurrency, formatNumber, formatRelative, humanise } from '../utils/format.js';

const EMPTY_FILTERS = { search: '', status: '', severity: '', outcome: '', assignedTo: '' };

/**
 * Alert queue.
 *
 * Workflow status and investigation outcome are filtered independently, because
 * they answer different questions: "what is nobody working on?" is a status
 * query, while "what did we conclude was fraud?" is an outcome query.
 *
 * The default view is unresolved alerts, since that is the working queue.
 */
export function AlertsPage() {
  const { can, user } = useAuth();
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, status: 'OPEN' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');
  const [pendingCount, setPendingCount] = useState(0);

  const debouncedSearch = useDebounced(filters.search, 350);

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy,
      sortDir,
      search: debouncedSearch || undefined,
      status: filters.status || undefined,
      severity: filters.severity || undefined,
      outcome: filters.outcome || undefined,
      assignedTo: filters.assignedTo || undefined,
    }),
    [page, pageSize, sortBy, sortDir, debouncedSearch, filters],
  );

  const { data, meta, error, isLoading, refetch } = useApi(
    (options) => alertsApi.list(params, options),
    [params],
  );

  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    filters.status,
    filters.severity,
    filters.outcome,
    filters.assignedTo,
    pageSize,
  ]);

  useSocketEvent(
    SOCKET_EVENT.ALERT_CREATED,
    useCallback(() => setPendingCount((count) => count + 1), []),
  );

  // An update to an alert already on screen is refetched directly: unlike a new
  // alert, it changes a row the operator is looking at rather than adding one,
  // so showing it immediately is the right behaviour.
  useSocketEvent(
    SOCKET_EVENT.ALERT_UPDATED,
    useCallback(
      (payload) => {
        if (data?.some((alert) => alert.id === payload.id)) refetch();
      },
      [data, refetch],
    ),
  );

  const onSort = (field) => {
    if (sortBy === field) {
      setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
    setPage(1);
  };

  const applyRefresh = () => {
    setPendingCount(0);
    refetch();
  };

  return (
    <>
      <TopBar
        title="Fraud alerts"
        subtitle={
          meta ? `${formatNumber(meta.total)} alerts match the current filters` : 'Loading…'
        }
        actions={
          <>
            {can(PERMISSION.ALERTS_UPDATE_STATUS) ? (
              <Button
                variant={filters.assignedTo === 'me' ? 'primary' : 'secondary'}
                className="text-xs"
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    assignedTo: current.assignedTo === 'me' ? '' : 'me',
                  }))
                }
              >
                Assigned to me
              </Button>
            ) : null}
            <Button variant="secondary" className="text-xs" onClick={applyRefresh}>
              Refresh
            </Button>
          </>
        }
      />

      <PageBody>
        {pendingCount > 0 ? (
          <button
            type="button"
            onClick={applyRefresh}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-risk-high/30 bg-risk-high/10 px-4 py-2.5 text-sm text-risk-high transition-colors hover:bg-risk-high/15"
          >
            <Radio className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
            {formatNumber(pendingCount)} new {pendingCount === 1 ? 'alert has' : 'alerts have'} been
            raised — refresh to include them
          </button>
        ) : null}

        <Panel>
          <div className="flex flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3.5">
            <div className="relative min-w-[240px] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="pl-9"
                placeholder="Search by transaction id, account or resolution summary…"
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, search: event.target.value }))
                }
                aria-label="Search alerts"
              />
            </div>

            <Select
              className="w-36"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({ ...current, status: event.target.value }))
              }
              aria-label="Filter by workflow status"
            >
              <option value="">All statuses</option>
              {ALERT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {humanise(status)}
                </option>
              ))}
            </Select>

            <Select
              className="w-36"
              value={filters.severity}
              onChange={(event) =>
                setFilters((current) => ({ ...current, severity: event.target.value }))
              }
              aria-label="Filter by severity"
            >
              <option value="">All severities</option>
              {ALERT_SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {humanise(severity)}
                </option>
              ))}
            </Select>

            <Select
              className="w-44"
              value={filters.outcome}
              onChange={(event) =>
                setFilters((current) => ({ ...current, outcome: event.target.value }))
              }
              aria-label="Filter by investigation outcome"
            >
              <option value="">Any outcome</option>
              {INVESTIGATION_OUTCOMES.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {humanise(outcome)}
                </option>
              ))}
            </Select>

            <Select
              className="w-40"
              value={filters.assignedTo}
              onChange={(event) =>
                setFilters((current) => ({ ...current, assignedTo: event.target.value }))
              }
              aria-label="Filter by assignment"
            >
              <option value="">Anyone</option>
              <option value="unassigned">Unassigned</option>
              {user ? <option value="me">Assigned to me</option> : null}
            </Select>

            <Select
              className="w-24"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </Select>

            {Object.values(filters).some(Boolean) ? (
              <Button variant="ghost" className="text-xs" onClick={() => setFilters(EMPTY_FILTERS)}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Clear
              </Button>
            ) : null}
          </div>

          {error ? (
            <div className="p-4">
              <ErrorBlock error={error} onRetry={refetch} />
            </div>
          ) : isLoading && !data ? (
            <LoadingBlock rows={8} />
          ) : data?.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No alerts match these filters"
              hint={
                filters.status === 'OPEN'
                  ? 'There is nothing in the open queue. Try clearing the status filter to see resolved alerts.'
                  : 'Try clearing the filters, or widen the search.'
              }
              action={
                <Button
                  variant="secondary"
                  className="mt-1 text-xs"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                >
                  Clear all filters
                </Button>
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="table-head">
                    <tr>
                      <SortableHeader
                        field="severity"
                        label="Severity"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                      <th scope="col" className="px-4 py-2.5">
                        Transaction
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right">
                        Amount
                      </th>
                      <SortableHeader
                        field="riskScore"
                        label="Risk"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                      <SortableHeader
                        field="status"
                        label="Workflow"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                      <th scope="col" className="px-4 py-2.5">
                        Outcome
                      </th>
                      <th scope="col" className="px-4 py-2.5">
                        Assigned to
                      </th>
                      <SortableHeader
                        field="createdAt"
                        label="Raised"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                    </tr>
                  </thead>
                  <tbody className={isLoading ? 'opacity-60 transition-opacity' : undefined}>
                    {data?.map((alert) => (
                      <tr key={alert.id} className="table-row">
                        <td className="px-4 py-2.5">
                          <SeverityBadge severity={alert.severity} />
                        </td>
                        <td className="px-4 py-2.5">
                          <Link to={`/alerts/${alert.id}`} className="link font-mono text-xs">
                            {alert.transaction.externalId}
                          </Link>
                          <p className="truncate font-mono text-2xs text-fg-faint">
                            {alert.transaction.senderRef} → {alert.transaction.receiverRef}
                          </p>
                        </td>
                        <td className="tabular px-4 py-2.5 text-right text-xs text-fg">
                          {formatCurrency(alert.transaction.amount)}
                        </td>
                        <td className="px-4 py-2.5">
                          <RiskBadge
                            category={alert.assessment.riskCategory}
                            score={alert.assessment.riskScore}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <AlertStatusBadge status={alert.status} />
                          {alert.reopenCount > 0 ? (
                            <p className="tabular mt-0.5 text-2xs text-risk-medium">
                              reopened {alert.reopenCount}×
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5">
                          <OutcomeBadge outcome={alert.outcome} withIcon={false} />
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {alert.assignedTo ? (
                            <>
                              <span className="text-fg">{alert.assignedTo.name}</span>
                              <p className="text-2xs text-fg-faint">{alert.assignedTo.role}</p>
                            </>
                          ) : (
                            <span className="text-fg-faint">Unassigned</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-fg-muted">
                          {formatRelative(alert.createdAt)}
                          {alert.noteCount > 0 ? (
                            <p className="tabular text-2xs text-fg-faint">
                              {alert.noteCount} note(s)
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination meta={meta} onPageChange={setPage} />
            </>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
