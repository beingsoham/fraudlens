import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Network, Search } from 'lucide-react';
import { TopBar } from '../components/layout/TopBar.jsx';
import { PageBody } from '../components/layout/PageBody.jsx';
import { RangeFilter } from '../components/layout/RangeFilter.jsx';
import { AccountGraph, GraphLegend } from '../components/graph/AccountGraph.jsx';
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
import { RiskBadge } from '../components/ui/StatusBadges.jsx';
import { useApi, useDebounced } from '../hooks/useApi.js';
import { accountsApi } from '../services/endpoints.js';
import { DEFAULT_RANGE_ID, resolvePreset } from '../utils/dateRanges.js';
import { formatCurrency, formatNumber, formatRelative, humanise } from '../utils/format.js';

/**
 * Account relationship analysis.
 *
 * The focus account is held in the URL (`?account=…`) so a view can be shared
 * with a colleague or linked from a transaction detail page and reopen exactly
 * as it was.
 */
export function AccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusRef = searchParams.get('account') ?? '';

  const [rangeId, setRangeId] = useState(DEFAULT_RANGE_ID);
  const range = useMemo(() => resolvePreset(rangeId), [rangeId]);
  const [depth, setDepth] = useState(1);
  const [limit, setLimit] = useState(14);
  const [minAmount, setMinAmount] = useState('');
  const [minTransferCount, setMinTransferCount] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounced(searchTerm, 300);

  const graphParams = useMemo(
    () => ({
      accountRef: focusRef || undefined,
      depth,
      limit,
      minAmount: minAmount || undefined,
      minTransferCount,
      from: range.from,
      to: range.to,
    }),
    [focusRef, depth, limit, minAmount, minTransferCount, range],
  );

  const graph = useApi((options) => accountsApi.graph(graphParams, options), [graphParams]);

  const accountSearch = useApi(
    (options) => accountsApi.search({ search: debouncedSearch, limit: 10 }, options),
    [debouncedSearch],
    { enabled: debouncedSearch.length >= 2 },
  );

  const [selectedRef, setSelectedRef] = useState(focusRef || null);
  useEffect(() => {
    if (focusRef) setSelectedRef(focusRef);
  }, [focusRef]);

  const summaryParams = useMemo(
    () => ({ from: range.from, to: range.to, minAmount: minAmount || undefined }),
    [range, minAmount],
  );
  const summary = useApi(
    (options) => accountsApi.summary(selectedRef, summaryParams, options),
    [selectedRef, summaryParams],
    { enabled: Boolean(selectedRef) },
  );

  const setFocus = (accountRef) => {
    const next = new URLSearchParams(searchParams);
    if (accountRef) next.set('account', accountRef);
    else next.delete('account');
    setSearchParams(next, { replace: true });
    setSelectedRef(accountRef || null);
    setSearchTerm('');
  };

  return (
    <>
      <TopBar
        title="Account relationships"
        subtitle={
          graph.data
            ? `${formatNumber(graph.data.nodes.length)} accounts · ${formatNumber(graph.data.edges.length)} relationships`
            : 'Loading graph…'
        }
        actions={<RangeFilter value={rangeId} onChange={setRangeId} />}
      />

      <PageBody>
        <Panel>
          <div className="flex flex-wrap items-end gap-3 px-5 py-4">
            <Field label="Focus account" className="relative min-w-[280px] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-[2.1rem] h-3.5 w-3.5 text-fg-faint"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="pl-9"
                placeholder={focusRef || 'Search for an account reference…'}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                aria-label="Search accounts"
              />
              {debouncedSearch.length >= 2 && accountSearch.data?.length ? (
                <ul className="panel absolute z-20 mt-1 max-h-64 w-full overflow-y-auto p-1">
                  {accountSearch.data.map((account) => (
                    <li key={account.id}>
                      <button
                        type="button"
                        onClick={() => setFocus(account.accountRef)}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-xs text-fg">
                            {account.accountRef}
                          </span>
                          <span className="block truncate text-2xs text-fg-faint">
                            {account.displayName}
                          </span>
                        </span>
                        {account.isMerchant ? (
                          <Badge className="border border-line-2 bg-surface-2 text-fg-muted">
                            Merchant
                          </Badge>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Field>

            <Field label="Hops from focus" className="w-28">
              <Select value={depth} onChange={(event) => setDepth(Number(event.target.value))}>
                <option value={1}>1 hop</option>
                <option value={2}>2 hops</option>
                <option value={3}>3 hops</option>
              </Select>
            </Field>

            <Field label="Max accounts" className="w-28" hint="Fewer is clearer">
              <Select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
                {[8, 14, 24, 40, 70].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Min transfer value" className="w-40">
              <Input
                type="number"
                min="0"
                step="100"
                placeholder="Any"
                value={minAmount}
                onChange={(event) => setMinAmount(event.target.value)}
              />
            </Field>

            <Field label="Min transfers per edge" className="w-40">
              <Input
                type="number"
                min="1"
                max="100"
                value={minTransferCount}
                onChange={(event) => setMinTransferCount(Number(event.target.value) || 1)}
              />
            </Field>

            {focusRef ? (
              <Button variant="ghost" className="text-xs" onClick={() => setFocus('')}>
                Clear focus
              </Button>
            ) : null}
          </div>
        </Panel>

        {graph.data?.truncated ? (
          <Notice tone="warning">
            The graph was truncated to keep it readable. Narrow the date range, raise the minimum
            transfer value, or focus on a single account to see the full picture.
          </Notice>
        ) : null}

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Panel className="xl:col-span-2">
            <PanelHeader
              title={focusRef ? `Neighbourhood of ${focusRef}` : 'Most active relationships'}
              subtitle="Click an account to inspect its flows"
              info="Nodes are synthetic accounts and edges are aggregated transaction flows between them. Both are derived only from transactions stored in the database."
            />
            <div className="h-[min(72vh,760px)] border-t border-line/70">
              {graph.error ? (
                <div className="p-4">
                  <ErrorBlock error={graph.error} onRetry={graph.refetch} />
                </div>
              ) : graph.isLoading && !graph.data ? (
                <LoadingBlock rows={8} />
              ) : (
                <AccountGraph
                  graph={graph.data}
                  selectedRef={selectedRef}
                  onSelect={setSelectedRef}
                />
              )}
            </div>
            <div className="border-t border-line/70 px-5 py-3">
              <GraphLegend />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title={selectedRef ? 'Selected account' : 'No account selected'}
              subtitle={selectedRef ?? 'Click a node in the graph'}
              actions={
                selectedRef && selectedRef !== focusRef ? (
                  <Button
                    variant="secondary"
                    className="text-xs"
                    onClick={() => setFocus(selectedRef)}
                  >
                    Focus here
                  </Button>
                ) : null
              }
            />

            {!selectedRef ? (
              <div className="grid place-items-center px-5 py-16 text-center">
                <div>
                  <Network className="mx-auto h-6 w-6 text-fg-faint" aria-hidden="true" />
                  <p className="mt-2 text-sm text-fg">Select an account</p>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-fg-muted">
                    Click a node to see its incoming and outgoing transactions, its frequent
                    counterparties, and any alerts it is associated with.
                  </p>
                </div>
              </div>
            ) : summary.isLoading ? (
              <LoadingBlock rows={6} />
            ) : summary.error ? (
              <div className="p-4">
                <ErrorBlock error={summary.error} onRetry={summary.refetch} />
              </div>
            ) : summary.data ? (
              <>
                <div className="grid grid-cols-2 gap-3 border-b border-line/70 p-5">
                  {[
                    [
                      'Sent',
                      formatNumber(summary.data.totals.sentCount),
                      formatCurrency(summary.data.totals.sentTotal),
                    ],
                    [
                      'Received',
                      formatNumber(summary.data.totals.receivedCount),
                      formatCurrency(summary.data.totals.receivedTotal),
                    ],
                    [
                      'Distinct senders',
                      formatNumber(summary.data.totals.distinctSenders),
                      'paid this account',
                    ],
                    [
                      'Distinct receivers',
                      formatNumber(summary.data.totals.distinctReceivers),
                      'were paid',
                    ],
                  ].map(([label, value, sub]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-line bg-surface-2/70 px-3 py-2"
                    >
                      <p className="text-2xs uppercase tracking-wider text-fg-muted">{label}</p>
                      <p className="tabular mt-0.5 text-sm font-semibold text-fg">{value}</p>
                      <p className="tabular truncate text-2xs text-fg-faint">{sub}</p>
                    </div>
                  ))}
                </div>

                {summary.data.alerts.alert_count > 0 ? (
                  <div className="border-b border-line/70 px-5 py-3">
                    <p className="text-xs text-fg">
                      Associated with{' '}
                      <span className="font-semibold text-risk-high">
                        {summary.data.alerts.alert_count}
                      </span>{' '}
                      alert(s),{' '}
                      <span className="font-semibold text-risk-medium">
                        {summary.data.alerts.open_alert_count}
                      </span>{' '}
                      still open
                      {summary.data.alerts.confirmed_fraud_count > 0 ? (
                        <>
                          , of which{' '}
                          <span className="font-semibold text-risk-critical">
                            {summary.data.alerts.confirmed_fraud_count}
                          </span>{' '}
                          were confirmed as fraud by an investigator
                        </>
                      ) : null}
                      .
                    </p>
                  </div>
                ) : null}

                <div className="border-b border-line/70 px-5 py-3">
                  <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-fg-muted">
                    Frequent counterparties
                  </p>
                  {summary.data.topCounterparties.length === 0 ? (
                    <p className="text-xs text-fg-muted">No counterparties in this range.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {summary.data.topCounterparties.map((party) => (
                        <li
                          key={`${party.accountRef}-${party.direction}`}
                          className="flex items-center gap-2"
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedRef(party.accountRef)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block truncate font-mono text-2xs text-accent hover:underline">
                              {party.accountRef}
                            </span>
                          </button>
                          <span className="tabular shrink-0 text-2xs text-fg-muted">
                            {party.direction === 'OUTGOING' ? '↑' : '↓'} {party.transferCount}× ·{' '}
                            {formatCurrency(party.totalAmount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="px-5 py-3">
                  <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-fg-muted">
                    Recent transactions
                  </p>
                  {summary.data.recentTransactions.length === 0 ? (
                    <p className="text-xs text-fg-muted">No transactions in this range.</p>
                  ) : (
                    <ul className="max-h-72 space-y-2 overflow-y-auto">
                      {summary.data.recentTransactions.map((transaction) => (
                        <li key={transaction.id} className="flex items-center gap-2">
                          <span
                            className={`shrink-0 text-2xs ${
                              transaction.direction === 'OUTGOING'
                                ? 'text-risk-medium'
                                : 'text-risk-low'
                            }`}
                          >
                            {transaction.direction === 'OUTGOING' ? '↑' : '↓'}
                          </span>
                          <Link
                            to={`/transactions/${transaction.id}`}
                            className="min-w-0 flex-1 truncate font-mono text-2xs text-accent hover:underline"
                          >
                            {transaction.externalId}
                          </Link>
                          <span className="tabular shrink-0 text-2xs text-fg-muted">
                            {formatCurrency(transaction.amount)}
                          </span>
                          <RiskBadge
                            category={transaction.riskCategory}
                            score={transaction.riskScore}
                            showScore={false}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="border-t border-line/70 px-5 py-2.5">
                  <p className="text-2xs text-fg-faint">
                    {humanise(summary.data.account.status)} ·{' '}
                    {summary.data.account.isMerchant ? 'merchant account' : 'personal account'} ·
                    created {formatRelative(summary.data.account.createdAt)}
                  </p>
                </div>
              </>
            ) : null}
          </Panel>
        </div>
      </PageBody>
    </>
  );
}
