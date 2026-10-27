import { useEffect, useMemo, useState } from 'react';
import { FileClock, Search, X } from 'lucide-react';
import { PAGE_SIZE_OPTIONS } from '@fraudlens/shared/constants';
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
  Notice,
  Pagination,
  Panel,
  Select,
} from '../components/ui/index.jsx';
import { useApi, useDebounced } from '../hooks/useApi.js';
import { auditApi } from '../services/endpoints.js';
import { formatDateTime, formatNumber, formatRelative } from '../utils/format.js';

/** Colour-codes an action by what kind of change it represents. */
function actionTone(action) {
  if (action.startsWith('alert.')) return 'border-risk-high/30 bg-risk-high/10 text-risk-high';
  if (action.startsWith('user.')) return 'border-accent/30 bg-accent/10 text-accent';
  if (action.startsWith('rule.') || action.startsWith('risk_settings.')) {
    return 'border-risk-medium/30 bg-risk-medium/10 text-risk-medium';
  }
  if (action.startsWith('simulator.')) return 'border-line-3 bg-surface-3/60 text-fg-muted';
  return 'border-line-2 bg-surface-2 text-fg-muted';
}

const EMPTY = { search: '', action: '', entityType: '', from: '', to: '' };

/**
 * Audit log viewer.
 *
 * Read-only by construction: the API exposes no write, update or delete route
 * for audit events, and a database trigger blocks UPDATE and DELETE outright.
 * The page says so, because an audit trail that could be edited would be worth
 * nothing.
 */
export function AuditPage() {
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const debouncedSearch = useDebounced(filters.search, 300);
  const { data: facets } = useApi((options) => auditApi.facets(options), []);

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: 'createdAt',
      sortDir: 'desc',
      search: debouncedSearch || undefined,
      action: filters.action || undefined,
      entityType: filters.entityType || undefined,
      from: filters.from ? new Date(filters.from).toISOString() : undefined,
      to: filters.to ? new Date(filters.to).toISOString() : undefined,
    }),
    [page, pageSize, debouncedSearch, filters],
  );

  const { data, meta, error, isLoading, refetch } = useApi(
    (options) => auditApi.list(params, options),
    [params],
  );

  useEffect(
    () => setPage(1),
    [debouncedSearch, filters.action, filters.entityType, filters.from, filters.to, pageSize],
  );

  return (
    <>
      <TopBar
        title="Audit log"
        subtitle={meta ? `${formatNumber(meta.total)} recorded events` : 'Loading…'}
        actions={
          <Button variant="secondary" className="text-xs" onClick={refetch}>
            Refresh
          </Button>
        }
      />

      <PageBody>
        <Notice tone="info">
          Audit events are append-only. No endpoint in this application updates or deletes them, and
          a database trigger rejects any <code className="font-mono">UPDATE</code> or{' '}
          <code className="font-mono">DELETE</code> against this table. Metadata is restricted to an
          explicit allow-list, so no password, token or raw request body is ever recorded here.
        </Notice>

        <Panel>
          <div className="flex flex-wrap items-end gap-3 border-b border-line/70 px-5 py-3.5">
            <Field label="Search" className="relative min-w-[240px] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-[2.1rem] h-3.5 w-3.5 text-fg-faint"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="pl-9"
                placeholder="Action, entity, request id, or actor…"
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, search: event.target.value }))
                }
              />
            </Field>

            <Field label="Action" className="w-56">
              <Select
                value={filters.action}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, action: event.target.value }))
                }
              >
                <option value="">All actions</option>
                {(facets?.actions ?? []).map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.value} ({entry.count})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Entity type" className="w-44">
              <Select
                value={filters.entityType}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, entityType: event.target.value }))
                }
              >
                <option value="">All entities</option>
                {(facets?.entityTypes ?? []).map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.value} ({entry.count})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="From (UTC)" className="w-48">
              <Input
                type="datetime-local"
                value={filters.from}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, from: event.target.value }))
                }
              />
            </Field>

            <Field label="To (UTC)" className="w-48">
              <Input
                type="datetime-local"
                value={filters.to}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, to: event.target.value }))
                }
              />
            </Field>

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
              <Button variant="ghost" className="text-xs" onClick={() => setFilters(EMPTY)}>
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
            <LoadingBlock rows={10} />
          ) : data?.length === 0 ? (
            <EmptyState
              icon={FileClock}
              title="No audit events match these filters"
              hint="Try clearing the action or date filters."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="table-head">
                    <tr>
                      <th scope="col" className="px-4 py-2.5">
                        When (UTC)
                      </th>
                      <th scope="col" className="px-4 py-2.5">
                        Actor
                      </th>
                      <th scope="col" className="px-4 py-2.5">
                        Action
                      </th>
                      <th scope="col" className="px-4 py-2.5">
                        Entity
                      </th>
                      <th scope="col" className="px-4 py-2.5">
                        Metadata
                      </th>
                      <th scope="col" className="px-4 py-2.5">
                        Request
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.map((entry) => (
                      <tr key={entry.id} className="table-row align-top">
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-fg-muted">
                          {formatDateTime(entry.createdAt)}
                          <p className="text-2xs text-fg-faint">
                            {formatRelative(entry.createdAt)}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {entry.actor ? (
                            <>
                              <span className="text-fg">{entry.actor.name}</span>
                              <p className="font-mono text-2xs text-fg-faint">
                                {entry.actor.email}
                              </p>
                            </>
                          ) : (
                            <span className="text-fg-faint">system / anonymous</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge className={actionTone(entry.action)}>{entry.action}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className="text-fg-muted">{entry.entityType}</span>
                          {entry.entityId ? (
                            <p className="font-mono text-2xs text-fg-faint">
                              {entry.entityId.slice(0, 18)}
                              {entry.entityId.length > 18 ? '…' : ''}
                            </p>
                          ) : null}
                        </td>
                        <td className="max-w-md px-4 py-2.5">
                          {entry.metadata ? (
                            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                              {Object.entries(entry.metadata).map(([key, value]) => (
                                <div key={key} className="col-span-2 flex gap-2">
                                  <dt className="shrink-0 text-2xs text-fg-faint">{key}</dt>
                                  <dd className="tabular min-w-0 truncate font-mono text-2xs text-fg-muted">
                                    {typeof value === 'object'
                                      ? JSON.stringify(value)
                                      : String(value)}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ) : (
                            <span className="text-2xs text-fg-faint">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-mono text-2xs text-fg-faint" title={entry.requestId}>
                            {entry.requestId.slice(0, 12)}
                          </p>
                          {entry.ipAddress ? (
                            <p className="font-mono text-2xs text-fg-faint">{entry.ipAddress}</p>
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
