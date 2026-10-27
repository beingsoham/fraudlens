import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRightLeft } from 'lucide-react';
import { TopBar } from '../components/layout/TopBar.jsx';
import { PageBody } from '../components/layout/PageBody.jsx';
import { Badge, ErrorBlock, LoadingBlock, Panel, PanelHeader } from '../components/ui/index.jsx';
import {
  AccountRef,
  AlertStatusBadge,
  OutcomeBadge,
  RiskBadge,
  RiskScoreBar,
  SeverityBadge,
} from '../components/ui/StatusBadges.jsx';
import { useApi } from '../hooks/useApi.js';
import { dashboardApi, transactionsApi } from '../services/endpoints.js';
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatRelative,
  humanise,
} from '../utils/format.js';

/** One labelled key/value row in the metadata panels. */
function DetailRow({ label, children, mono }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/60 px-5 py-2.5 last:border-0">
      <dt className="shrink-0 text-xs text-fg-muted">{label}</dt>
      <dd className={`min-w-0 text-right text-xs text-fg ${mono ? 'font-mono' : ''}`}>
        {children}
      </dd>
    </div>
  );
}

/**
 * Renders one triggered rule with the evidence that triggered it.
 *
 * The evidence is shown as the raw feature values the rule looked at, because
 * "velocity was high" is an assertion while "9 transactions in the preceding 10
 * minutes, threshold 5" is something an investigator can verify and disagree
 * with.
 */
function TriggeredRule({ rule }) {
  return (
    <li className="border-b border-line/60 px-5 py-3.5 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">{rule.name}</p>
          <p className="font-mono text-2xs text-fg-faint">{rule.ruleId}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular font-mono text-sm font-semibold text-risk-high">
            +{rule.contribution}
          </p>
          <p className="tabular text-2xs text-fg-faint">of {rule.weight} max</p>
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-fg-muted">{rule.explanation}</p>

      {rule.dampeningFactor !== undefined && rule.dampeningFactor < 1 ? (
        <p className="mt-2 rounded-md border border-risk-medium/20 bg-risk-medium/5 px-2.5 py-1.5 text-2xs leading-relaxed text-risk-medium">
          Contribution reduced from {rule.rawContribution} to {rule.contribution} (factor{' '}
          {rule.dampeningFactor}) because it overlaps with another{' '}
          <span className="font-medium">{rule.correlationGroup}</span> indicator already counted.
        </p>
      ) : null}

      {rule.evidence ? (
        <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-surface-2/70 px-3 py-2 sm:grid-cols-3">
          {Object.entries(rule.evidence).map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="truncate text-2xs text-fg-faint">{key}</dt>
              <dd className="tabular truncate font-mono text-2xs text-fg">
                {value === null
                  ? '—'
                  : typeof value === 'number'
                    ? Number(value.toFixed(4))
                    : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

/**
 * Transaction detail.
 *
 * Shows the participants, device metadata, the historical features the engine
 * computed, the risk score with its per-rule evidence and explanations, related
 * transactions, and any linked alerts with their investigation history.
 */
export function TransactionDetailPage() {
  const { id } = useParams();

  const { data, error, isLoading, refetch } = useApi(
    (options) => transactionsApi.detail(id, options),
    [id],
  );
  const related = useApi((options) => transactionsApi.related(id, { limit: 10 }, options), [id]);
  // The configured category boundaries, so the score bar can mark where this
  // score sits relative to the thresholds that produced its category.
  const { data: summary } = useApi((options) => dashboardApi.summary({}, options), []);
  const thresholds = summary?.thresholds;

  const assessment = data?.latestAssessment;
  const features = assessment?.features;

  return (
    <>
      <TopBar
        title={data ? data.externalId : 'Transaction'}
        subtitle={
          data ? `${formatCurrency(data.amount)} · ${formatDateTime(data.occurredAt)}` : undefined
        }
        actions={
          <Link to="/transactions" className="btn-secondary text-xs">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to monitor
          </Link>
        }
      />

      <PageBody>
        {error ? <ErrorBlock error={error} onRetry={refetch} /> : null}
        {isLoading && !data ? <LoadingBlock rows={10} /> : null}

        {data ? (
          <>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              <Panel>
                <PanelHeader title="Participants" />
                <div className="space-y-3 p-5">
                  <div>
                    <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-fg-muted">
                      Sender
                    </p>
                    <Link to={`/accounts?account=${encodeURIComponent(data.sender.accountRef)}`}>
                      <AccountRef
                        accountRef={data.sender.accountRef}
                        displayName={data.sender.displayName}
                        isMerchant={data.sender.isMerchant}
                      />
                    </Link>
                  </div>
                  <div className="flex items-center gap-2 text-fg-faint">
                    <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="tabular text-sm font-semibold text-fg">
                      {formatCurrency(data.amount)}
                    </span>
                  </div>
                  <div>
                    <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-fg-muted">
                      Receiver
                    </p>
                    <Link to={`/accounts?account=${encodeURIComponent(data.receiver.accountRef)}`}>
                      <AccountRef
                        accountRef={data.receiver.accountRef}
                        displayName={data.receiver.displayName}
                        isMerchant={data.receiver.isMerchant}
                      />
                    </Link>
                  </div>
                </div>
              </Panel>

              <Panel>
                <PanelHeader title="Transaction" />
                <dl>
                  <DetailRow label="External id" mono>
                    {data.externalId}
                  </DetailRow>
                  <DetailRow label="Internal id" mono>
                    {data.id}
                  </DetailRow>
                  <DetailRow label="Amount">
                    <span className="tabular">{formatCurrency(data.amount)}</span>
                  </DetailRow>
                  <DetailRow label="Currency">{data.currency}</DetailRow>
                  <DetailRow label="Occurred (UTC)">{formatDateTime(data.occurredAt)}</DetailRow>
                  <DetailRow label="Ingested (UTC)">{formatDateTime(data.createdAt)}</DetailRow>
                  <DetailRow label="Channel">{humanise(data.channel)}</DetailRow>
                  <DetailRow label="Status">
                    <Badge className="border border-line-2 bg-surface-2 text-fg-muted">
                      {humanise(data.status)}
                    </Badge>
                  </DetailRow>
                </dl>
              </Panel>

              <Panel>
                <PanelHeader
                  title="Device"
                  info="A synthetic device fingerprint. FraudLens never stores a real device identifier."
                />
                <dl>
                  <DetailRow label="Fingerprint" mono>
                    <span className="break-all">{data.device.fingerprint}</span>
                  </DetailRow>
                  <DetailRow label="Previously unseen">
                    {data.device.isNewDevice ? (
                      <Badge className="border border-risk-medium/30 bg-risk-medium/10 text-risk-medium">
                        Yes — new to this sender
                      </Badge>
                    ) : (
                      <Badge className="border border-risk-low/30 bg-risk-low/10 text-risk-low">
                        No — known device
                      </Badge>
                    )}
                  </DetailRow>
                  {features?.sender ? (
                    <>
                      <DetailRow label="Known devices for sender">
                        <span className="tabular">
                          {formatNumber(features.sender.knownDeviceCount)}
                        </span>
                      </DetailRow>
                      <DetailRow label="Sender history at assessment">
                        <span className="tabular">
                          {formatNumber(features.sender.historyCount)} transactions
                        </span>
                      </DetailRow>
                    </>
                  ) : null}
                  {data.groundTruthLabel ? (
                    <DetailRow label="Simulator scenario label">
                      <Badge className="border border-line-2 bg-surface-2 text-fg-muted">
                        {humanise(data.groundTruthLabel.label)}
                      </Badge>
                    </DetailRow>
                  ) : null}
                </dl>
              </Panel>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              <Panel className="xl:col-span-2">
                <PanelHeader
                  title="Risk assessment"
                  subtitle={
                    assessment
                      ? `Ruleset ${assessment.rulesetVersion} · assessed ${formatRelative(assessment.assessedAt)}`
                      : undefined
                  }
                  info="The score is the sum of each triggered rule's contribution, capped at 100. Correlated rules are dampened so one underlying behaviour is not counted twice."
                />
                {assessment ? (
                  <>
                    <div className="border-b border-line/70 p-5">
                      <RiskScoreBar score={assessment.riskScore} thresholds={thresholds} />
                      <p className="mt-3 rounded-md border border-line bg-surface-2/70 px-3 py-2 text-2xs leading-relaxed text-fg-muted">
                        A risk score indicates characteristics that warrant human review. It is not
                        a finding of fraud, and FraudLens never blocks a payment on the basis of
                        one.
                      </p>
                    </div>

                    <div className="border-b border-line/70 px-5 py-4">
                      <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-fg-muted">
                        Explanation
                      </p>
                      <ol className="space-y-1.5">
                        {assessment.explanations?.map((line, index) => (
                          <li
                            key={index}
                            className="flex gap-2 text-xs leading-relaxed text-fg-muted"
                          >
                            <span className="tabular shrink-0 text-fg-faint">{index + 1}.</span>
                            <span>{line}</span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <p className="px-5 pt-4 text-2xs font-semibold uppercase tracking-wider text-fg-muted">
                      Triggered rules ({assessment.triggeredRules?.length ?? 0})
                    </p>
                    {assessment.triggeredRules?.length ? (
                      <ul className="mt-1">
                        {assessment.triggeredRules.map((rule) => (
                          <TriggeredRule key={rule.ruleId} rule={rule} />
                        ))}
                      </ul>
                    ) : (
                      <p className="px-5 py-5 text-xs text-fg-muted">
                        No detection rule was triggered by this transaction.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="px-5 py-8 text-sm text-fg-muted">
                    This transaction has not been assessed.
                  </p>
                )}
              </Panel>

              <div className="space-y-5">
                <Panel>
                  <PanelHeader
                    title="Historical features"
                    info="The values the engine computed from previously persisted transactions. The transaction being assessed is always excluded from its own features."
                  />
                  {features ? (
                    <dl>
                      <DetailRow label="Velocity window">
                        <span className="tabular">
                          {formatNumber(features.sender.transactionsInVelocityWindow)} in{' '}
                          {features.windows.velocityWindowMinutes} min
                        </span>
                      </DetailRow>
                      <DetailRow label="Median amount for sender">
                        <span className="tabular">
                          {features.sender.amountMedian === null
                            ? 'insufficient history'
                            : formatCurrency(features.sender.amountMedian)}
                        </span>
                      </DetailRow>
                      <DetailRow label="Same-pair transfers">
                        <span className="tabular">
                          {formatNumber(features.pair.transfersInWindow)} in{' '}
                          {features.windows.pairWindowMinutes} min
                        </span>
                      </DetailRow>
                      <DetailRow label="Receiver fan-in">
                        <span className="tabular">
                          {formatNumber(features.receiver.distinctSendersInWindow)} senders in{' '}
                          {features.windows.fanInWindowHours} h
                        </span>
                      </DetailRow>
                      <DetailRow label="Receiver is a merchant">
                        {features.receiver.isMerchant ? 'Yes' : 'No'}
                      </DetailRow>
                      <DetailRow label="Recent vs baseline">
                        <span className="tabular">
                          {formatNumber(features.sender.recentCount)} in{' '}
                          {features.windows.surgeRecentHours} h vs{' '}
                          {formatNumber(features.sender.baselineCount)} over{' '}
                          {features.windows.surgeBaselineDays} d
                        </span>
                      </DetailRow>
                      <DetailRow label="Window convention">
                        <span className="text-2xs">{features.windows.convention}</span>
                      </DetailRow>
                    </dl>
                  ) : (
                    <p className="px-5 py-6 text-xs text-fg-muted">
                      No feature snapshot was recorded for this transaction.
                    </p>
                  )}
                </Panel>

                <Panel>
                  <PanelHeader
                    title="Assessment history"
                    info="Assessments are immutable. A re-assessment inserts a new record, so the score an alert was raised on stays reconstructable."
                  />
                  {data.assessmentHistory?.length ? (
                    <ul className="divide-y divide-line/60">
                      {data.assessmentHistory.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-center justify-between gap-3 px-5 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-xs text-fg">{formatDateTime(entry.assessedAt)}</p>
                            <p className="font-mono text-2xs text-fg-faint">
                              ruleset {entry.rulesetVersion}
                            </p>
                          </div>
                          <RiskBadge category={entry.riskCategory} score={entry.riskScore} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Panel>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Panel>
                <PanelHeader
                  title="Linked alerts"
                  subtitle={`${data.alerts?.length ?? 0} alert(s) raised on this transaction`}
                />
                {data.alerts?.length ? (
                  <ul className="divide-y divide-line/60">
                    {data.alerts.map((alert) => (
                      <li key={alert.id} className="px-5 py-3.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <SeverityBadge severity={alert.severity} />
                          <AlertStatusBadge status={alert.status} />
                          <OutcomeBadge outcome={alert.outcome} />
                          <Link to={`/alerts/${alert.id}`} className="link ml-auto text-xs">
                            Open investigation
                          </Link>
                        </div>
                        <p className="mt-1.5 text-2xs text-fg-faint">
                          Raised {formatRelative(alert.createdAt)}
                          {alert.assignedTo
                            ? ` · assigned to ${alert.assignedTo.name}`
                            : ' · unassigned'}
                          {alert.reopenCount > 0 ? ` · reopened ${alert.reopenCount}×` : ''}
                        </p>
                        {alert.resolutionSummary ? (
                          <p className="mt-1.5 rounded-md bg-surface-2/70 px-2.5 py-1.5 text-xs leading-relaxed text-fg-muted">
                            {alert.resolutionSummary}
                          </p>
                        ) : null}
                        {alert.notes?.length ? (
                          <p className="mt-1.5 text-2xs text-fg-faint">
                            {alert.notes.length} investigation note(s)
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-5 py-6 text-xs text-fg-muted">
                    This transaction scored below the alert threshold, so no alert was raised.
                  </p>
                )}
              </Panel>

              <Panel>
                <PanelHeader
                  title="Related transactions"
                  info="Transactions sharing a participant, the device fingerprint, or the exact sender-to-receiver pair, ranked by how directly they relate and by closeness in time."
                />
                {related.isLoading ? (
                  <LoadingBlock rows={4} />
                ) : related.data?.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="table-head">
                        <tr>
                          <th scope="col" className="px-4 py-2">
                            Transaction
                          </th>
                          <th scope="col" className="px-4 py-2">
                            Relation
                          </th>
                          <th scope="col" className="px-4 py-2 text-right">
                            Amount
                          </th>
                          <th scope="col" className="px-4 py-2">
                            Risk
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {related.data.map((entry) => (
                          <tr key={entry.id} className="table-row">
                            <td className="px-4 py-2">
                              <Link
                                to={`/transactions/${entry.id}`}
                                className="link font-mono text-xs"
                              >
                                {entry.externalId}
                              </Link>
                              <p className="text-2xs text-fg-faint">
                                {formatRelative(entry.occurredAt)}
                              </p>
                            </td>
                            <td className="px-4 py-2">
                              <Badge className="border border-line-2 bg-surface-2 text-fg-muted">
                                {humanise(entry.relation)}
                              </Badge>
                            </td>
                            <td className="tabular px-4 py-2 text-right text-xs">
                              {formatCurrency(entry.amount)}
                            </td>
                            <td className="px-4 py-2">
                              <RiskBadge category={entry.riskCategory} score={entry.riskScore} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="px-5 py-6 text-xs text-fg-muted">
                    No other transaction shares a participant or device with this one.
                  </p>
                )}
              </Panel>
            </div>
          </>
        ) : null}
      </PageBody>
    </>
  );
}
