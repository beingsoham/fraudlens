import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ListFilter, Radio, Search, X } from 'lucide-react';
import {
  PAGE_SIZE_OPTIONS,
  RISK_CATEGORIES,
  SOCKET_EVENT,
  TRANSACTION_CHANNELS,
  TRANSACTION_STATUSES,
} from '@fraudlens/shared/constants';
import { TopBar } from '../components/layout/TopBar.jsx';
import { PageBody } from '../components/layout/PageBody.jsx';
import {
  Badge,
  Button,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Pagination,
  Panel,
  Select,
  SortableHeader,
} from '../components/ui/index.jsx';
import { RiskBadge } from '../components/ui/StatusBadges.jsx';
import { useApi, useDebounced } from '../hooks/useApi.js';
import { useSocketEvent } from '../context/SocketContext.jsx';
import { transactionsApi } from '../services/endpoints.js';
import { formatCurrency, formatDateTime, formatNumber, humanise } from '../utils/format.js';

const EMPTY_FILTERS = {
  search: '',
  riskCategory: '',
  status: '',
  channel: '',
  minAmount: '',
  maxAmount: '',
  minRiskScore: '',
  maxRiskScore: '',
  from: '',
  to: '',
};

/**
 * Live transaction monitor.
 *
 * Pagination, filtering and sorting are all server-side: the table never holds
 * more than one page, which is what lets it stay responsive against a table of
 * any size.
 *
 * Realtime behaviour is deliberately conservative. A new transaction does *not*
 * silently splice itself into the current page — that would shift rows under the
 * cursor of someone mid-read and would be wrong as soon as any filter or sort is
 * applied. Instead a "new transactions" banner appears and the operator chooses
 * when to refresh.
 */
export function TransactionsPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState('occurredAt');
  const [sortDir, setSortDir] = useState('desc');
  const [showFilters, setShowFilters] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const debouncedSearch = useDebounced(filters.search, 350);

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy,
      sortDir,
      search: debouncedSearch || undefined,
      riskCategory: filters.riskCategory || undefined,
      status: filters.status || undefined,
      channel: filters.channel || undefined,
      minAmount: filters.minAmount || undefined,
      maxAmount: filters.maxAmount || undefined,
      minRiskScore: filters.minRiskScore || undefined,
      maxRiskScore: filters.maxRiskScore || undefined,
      from: filters.from ? new Date(filters.from).toISOString() : undefined,
      to: filters.to ? new Date(filters.to).toISOString() : undefined,
    }),
    [page, pageSize, sortBy, sortDir, debouncedSearch, filters],
  );

  const { data, meta, error, isLoading, refetch } = useApi(
    (options) => transactionsApi.list(params, options),
    [params],
  );

  // Any filter change invalidates the current page number.
  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    filters.riskCategory,
    filters.status,
    filters.channel,
    filters.minAmount,
    filters.maxAmount,
    filters.minRiskScore,
    filters.maxRiskScore,
    filters.from,
    filters.to,
    pageSize,
  ]);

  useSocketEvent(
    SOCKET_EVENT.TRANSACTION_CREATED,
    useCallback(() => {
      setPendingCount((count) => count + 1);
    }, []),
  );

  const applyRefresh = () => {
    setPendingCount(0);
    refetch();
  };

  const onSort = (field) => {
    if (sortBy === field) {
      setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
    setPage(1);
  };

  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) => key !== 'search' && value !== '',
  ).length;

  return (
    <>
      <TopBar
        title="Transaction monitor"
        subtitle={
          meta ? `${formatNumber(meta.total)} transactions match the current filters` : 'Loading…'
        }
        actions={
          <>
            <Button
              variant={showFilters ? 'primary' : 'secondary'}
              className="text-xs"
              onClick={() => setShowFilters((open) => !open)}
            >
              <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
              Filters
              {activeFilterCount > 0 ? (
                <span className="tabular rounded-full bg-fg/10 px-1.5 text-2xs">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>
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
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm text-accent transition-colors hover:bg-accent/15"
          >
            <Radio className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
            {formatNumber(pendingCount)} new{' '}
            {pendingCount === 1 ? 'transaction has' : 'transactions have'} arrived — refresh to
            include them
          </button>
        ) : null}

        <Panel>
          <div className="flex flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3.5">
            <div className="relative min-w-[260px] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="pl-9"
                placeholder="Search by transaction id or account reference…"
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, search: event.target.value }))
                }
                aria-label="Search transactions"
              />
            </div>

            <Select
              className="w-36"
              value={filters.riskCategory}
              onChange={(event) =>
                setFilters((current) => ({ ...current, riskCategory: event.target.value }))
              }
              aria-label="Filter by risk category"
            >
              <option value="">All risk levels</option>
              {RISK_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {humanise(category)} risk
                </option>
              ))}
            </Select>

            <Select
              className="w-36"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({ ...current, status: event.target.value }))
              }
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {TRANSACTION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {humanise(status)}
                </option>
              ))}
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

            {activeFilterCount > 0 || filters.search ? (
              <Button variant="ghost" className="text-xs" onClick={() => setFilters(EMPTY_FILTERS)}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Clear
              </Button>
            ) : null}
          </div>

          {showFilters ? (
            <div className="grid grid-cols-1 gap-3 border-b border-line/70 bg-surface-2/50 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Minimum amount (INR)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  value={filters.minAmount}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, minAmount: event.target.value }))
                  }
                />
              </Field>
              <Field label="Maximum amount (INR)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="No limit"
                  value={filters.maxAmount}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, maxAmount: event.target.value }))
                  }
                />
              </Field>
              <Field label="Minimum risk score">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="0"
                  value={filters.minRiskScore}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, minRiskScore: event.target.value }))
                  }
                />
              </Field>
              <Field label="Maximum risk score">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="100"
                  value={filters.maxRiskScore}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, maxRiskScore: event.target.value }))
                  }
                />
              </Field>
              <Field label="From (UTC)">
                <Input
                  type="datetime-local"
                  value={filters.from}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, from: event.target.value }))
                  }
                />
              </Field>
              <Field label="To (UTC)">
                <Input
                  type="datetime-local"
                  value={filters.to}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, to: event.target.value }))
                  }
                />
              </Field>
              <Field label="Channel">
                <Select
                  value={filters.channel}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, channel: event.target.value }))
                  }
                >
                  <option value="">All channels</option>
                  {TRANSACTION_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {humanise(channel)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}

          {error ? (
            <div className="p-4">
              <ErrorBlock error={error} onRetry={refetch} />
            </div>
          ) : isLoading && !data ? (
            <LoadingBlock rows={8} />
          ) : data?.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No transactions match these filters"
              hint="Try widening the date range or clearing the risk and amount filters."
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
                      <th scope="col" className="px-4 py-2.5">
                        Transaction
                      </th>
                      <th scope="col" className="px-4 py-2.5">
                        Sender
                      </th>
                      <th scope="col" className="px-4 py-2.5">
                        Receiver
                      </th>
                      <SortableHeader
                        field="amount"
                        label="Amount"
                        align="right"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                      <SortableHeader
                        field="occurredAt"
                        label="Occurred (UTC)"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                      <SortableHeader
                        field="status"
                        label="Status"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                      <SortableHeader
                        field="riskScore"
                        label="Risk"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                      <th scope="col" className="px-4 py-2.5">
                        Rules
                      </th>
                    </tr>
                  </thead>
                  <tbody className={isLoading ? 'opacity-60 transition-opacity' : undefined}>
                    {data?.map((transaction) => (
                      <tr key={transaction.id} className="table-row">
                        <td className="px-4 py-2.5">
                          <Link
                            to={`/transactions/${transaction.id}`}
                            className="link font-mono text-xs"
                          >
                            {transaction.externalId}
                          </Link>
                          <div className="mt-0.5 flex gap-1">
                            {transaction.isNewDevice ? (
                              <Badge className="border border-risk-medium/30 bg-risk-medium/10 text-risk-medium">
                                New device
                              </Badge>
                            ) : null}
                            {transaction.alertId ? (
                              <Link to={`/alerts/${transaction.alertId}`}>
                                <Badge className="border border-risk-high/30 bg-risk-high/10 text-risk-high">
                                  Alert
                                </Badge>
                              </Link>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-mono text-xs text-fg">{transaction.senderRef}</p>
                          <p className="truncate text-2xs text-fg-faint">
                            {transaction.senderName}
                          </p>
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-mono text-xs text-fg">{transaction.receiverRef}</p>
                          <p className="truncate text-2xs text-fg-faint">
                            {transaction.receiverName}
                          </p>
                        </td>
                        <td className="tabular px-4 py-2.5 text-right text-xs text-fg">
                          {formatCurrency(transaction.amount)}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-fg-muted">
                          {formatDateTime(transaction.occurredAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge className="border border-line-2 bg-surface-2 text-fg-muted">
                            {humanise(transaction.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <RiskBadge
                            category={transaction.riskCategory}
                            score={transaction.riskScore}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="tabular text-xs text-fg-muted">
                            {transaction.triggeredRuleIds.length > 0
                              ? `${transaction.triggeredRuleIds.length} triggered`
                              : '—'}
                          </span>
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
