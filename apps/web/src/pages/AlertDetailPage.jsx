import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, MessageSquarePlus, RotateCcw, UserCog } from 'lucide-react';
import { ALERT_STATUS, INVESTIGATION_OUTCOME, PERMISSION } from '@fraudlens/shared/constants';
import { TopBar } from '../components/layout/TopBar.jsx';
import { PageBody } from '../components/layout/PageBody.jsx';
import {
  Button,
  ErrorBlock,
  Field,
  LoadingBlock,
  Modal,
  Notice,
  Panel,
  PanelHeader,
  Select,
  Textarea,
} from '../components/ui/index.jsx';
import {
  AccountRef,
  AlertStatusBadge,
  OutcomeBadge,
  RiskScoreBar,
  SeverityBadge,
} from '../components/ui/StatusBadges.jsx';
import { useApi, useMutation } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { alertsApi } from '../services/endpoints.js';
import { formatCurrency, formatDateTime, formatRelative, humanise } from '../utils/format.js';

/**
 * Investigation workspace for one alert.
 *
 * The two state dimensions are presented as two separate controls, never one:
 * an investigator moves the alert through the *workflow*, and separately records
 * the *outcome* when resolving. Resolving requires both a conclusive outcome and
 * a written summary — the API enforces this too, and a resolved case with no
 * stated reasoning is useless to whoever reads it next.
 */
export function AlertDetailPage() {
  const { id } = useParams();
  const { can, user } = useAuth();

  const { data, error, isLoading, refetch } = useApi(
    (options) => alertsApi.detail(id, options),
    [id],
  );
  const { data: investigators } = useApi((options) => alertsApi.investigators(options), [], {
    enabled: can(PERMISSION.ALERTS_ASSIGN),
  });

  const [noteBody, setNoteBody] = useState('');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [outcome, setOutcome] = useState(INVESTIGATION_OUTCOME.CONFIRMED_FRAUD);
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [notice, setNotice] = useState(null);

  const addNote = useMutation((body) => alertsApi.addNote(id, body));
  const assign = useMutation((assignedToId) => alertsApi.assign(id, assignedToId));
  const updateStatus = useMutation((payload) => alertsApi.updateStatus(id, payload));

  const afterWrite = (message) => {
    setNotice(message);
    refetch();
  };

  const onAddNote = async (event) => {
    event.preventDefault();
    if (noteBody.trim().length < 3) return;
    await addNote.mutate(noteBody.trim());
    setNoteBody('');
    afterWrite('Investigation note added.');
  };

  const onAssign = async (value) => {
    await assign.mutate(value === '' ? null : value);
    afterWrite(value === '' ? 'Alert unassigned.' : 'Alert assigned.');
  };

  const onMoveToReview = async () => {
    await updateStatus.mutate({ status: ALERT_STATUS.IN_REVIEW });
    afterWrite('Alert moved to In review.');
  };

  const onResolve = async (event) => {
    event.preventDefault();
    await updateStatus.mutate({
      status: ALERT_STATUS.RESOLVED,
      outcome,
      resolutionSummary: resolutionSummary.trim(),
    });
    setResolveOpen(false);
    setResolutionSummary('');
    afterWrite('Alert resolved and the outcome recorded.');
  };

  const onReopen = async (event) => {
    event.preventDefault();
    await updateStatus.mutate({
      status: ALERT_STATUS.IN_REVIEW,
      reopenReason: reopenReason.trim(),
    });
    setReopenOpen(false);
    setReopenReason('');
    afterWrite('Alert reopened. The reason has been recorded in the audit log and case notes.');
  };

  const canAct = can(PERMISSION.ALERTS_UPDATE_STATUS);
  const canNote = can(PERMISSION.ALERTS_NOTE_CREATE);
  const isResolved = data?.status === ALERT_STATUS.RESOLVED;
  const writeError = addNote.error ?? assign.error ?? updateStatus.error;

  return (
    <>
      <TopBar
        title={data ? `Alert on ${data.transaction.externalId}` : 'Alert'}
        subtitle={
          data
            ? `Raised ${formatRelative(data.createdAt)} · ${formatCurrency(data.transaction.amount)}`
            : undefined
        }
        actions={
          <Link to="/alerts" className="btn-secondary text-xs">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to queue
          </Link>
        }
      />

      <PageBody>
        {error ? <ErrorBlock error={error} onRetry={refetch} /> : null}
        {isLoading && !data ? <LoadingBlock rows={10} /> : null}
        {notice ? (
          <Notice tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        ) : null}
        {writeError ? <ErrorBlock error={writeError} /> : null}

        {data ? (
          <>
            <Panel>
              <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                <SeverityBadge severity={data.severity} />
                <AlertStatusBadge status={data.status} />
                <OutcomeBadge outcome={data.outcome} />
                {data.reopenCount > 0 ? (
                  <span className="tabular text-2xs text-risk-medium">
                    reopened {data.reopenCount}×
                  </span>
                ) : null}

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {can(PERMISSION.ALERTS_ASSIGN) ? (
                    <div className="flex items-center gap-1.5">
                      <UserCog className="h-3.5 w-3.5 text-fg-faint" aria-hidden="true" />
                      <Select
                        className="w-48 py-1.5 text-xs"
                        value={data.assignedTo?.id ?? ''}
                        onChange={(event) => void onAssign(event.target.value)}
                        disabled={assign.isPending}
                        aria-label="Assign investigator"
                      >
                        <option value="">Unassigned</option>
                        {(investigators ?? []).map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name} ({person.role})
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : (
                    <span className="text-xs text-fg-muted">
                      {data.assignedTo ? `Assigned to ${data.assignedTo.name}` : 'Unassigned'}
                    </span>
                  )}

                  {canAct && data.status === ALERT_STATUS.OPEN ? (
                    <Button
                      variant="secondary"
                      className="text-xs"
                      onClick={() => void onMoveToReview()}
                      isLoading={updateStatus.isPending}
                    >
                      Start review
                    </Button>
                  ) : null}

                  {canAct && !isResolved ? (
                    <Button
                      variant="primary"
                      className="text-xs"
                      onClick={() => setResolveOpen(true)}
                    >
                      Resolve…
                    </Button>
                  ) : null}

                  {canAct && isResolved ? (
                    <Button
                      variant="danger"
                      className="text-xs"
                      onClick={() => setReopenOpen(true)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Reopen…
                    </Button>
                  ) : null}
                </div>
              </div>

              {isResolved ? (
                <div className="border-t border-line/70 bg-surface-2/50 px-5 py-4">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-fg-muted">
                    Resolution
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg">{data.resolutionSummary}</p>
                  <p className="mt-1.5 text-2xs text-fg-faint">
                    Resolved by {data.resolvedBy?.name ?? 'unknown'} on{' '}
                    {formatDateTime(data.resolvedAt)}
                  </p>
                </div>
              ) : null}
            </Panel>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              <Panel className="xl:col-span-2">
                <PanelHeader
                  title="Why this alert was raised"
                  subtitle={`Ruleset ${data.assessment.rulesetVersion} · assessed ${formatDateTime(data.assessment.assessedAt)}`}
                  info="This is the assessment the alert was raised on, not the transaction's latest. An alert must stay explainable by the evidence that actually triggered it."
                />
                <div className="border-b border-line/70 p-5">
                  <RiskScoreBar score={data.assessment.riskScore} />
                </div>
                <ol className="divide-y divide-line/60">
                  {data.assessment.explanations?.map((line, index) => (
                    <li key={index} className="flex gap-2.5 px-5 py-2.5">
                      <span className="tabular shrink-0 text-xs text-fg-faint">{index + 1}.</span>
                      <span className="text-xs leading-relaxed text-fg-muted">{line}</span>
                    </li>
                  ))}
                </ol>
                <div className="border-t border-line/70 px-5 py-3">
                  <Link to={`/transactions/${data.transaction.id}`} className="link text-xs">
                    Open the full transaction detail, including per-rule evidence →
                  </Link>
                </div>
              </Panel>

              <Panel>
                <PanelHeader title="Transaction" />
                <div className="space-y-3 p-5">
                  <div>
                    <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-fg-muted">
                      Sender
                    </p>
                    <AccountRef
                      accountRef={data.transaction.sender.accountRef}
                      displayName={data.transaction.sender.displayName}
                      isMerchant={data.transaction.sender.isMerchant}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-fg-muted">
                      Receiver
                    </p>
                    <AccountRef
                      accountRef={data.transaction.receiver.accountRef}
                      displayName={data.transaction.receiver.displayName}
                      isMerchant={data.transaction.receiver.isMerchant}
                    />
                  </div>
                  <dl className="space-y-1.5 border-t border-line/60 pt-3 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-fg-muted">Amount</dt>
                      <dd className="tabular text-fg">{formatCurrency(data.transaction.amount)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-fg-muted">Occurred (UTC)</dt>
                      <dd className="text-fg">{formatDateTime(data.transaction.occurredAt)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-fg-muted">Channel</dt>
                      <dd className="text-fg">{humanise(data.transaction.channel)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-fg-muted">New device</dt>
                      <dd className="text-fg">{data.transaction.isNewDevice ? 'Yes' : 'No'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="shrink-0 text-fg-muted">Device</dt>
                      <dd className="truncate font-mono text-2xs text-fg">
                        {data.transaction.deviceFingerprint}
                      </dd>
                    </div>
                  </dl>
                </div>
              </Panel>
            </div>

            <Panel>
              <PanelHeader
                title="Investigation history"
                subtitle={`${data.notes.length} note(s)`}
                info="Notes are append-only: they can be added but never edited or deleted, and a database trigger enforces that. Reopening an alert preserves the whole prior history."
              />

              {canNote && (
                <form onSubmit={onAddNote} className="border-b border-line/70 p-5">
                  <Field
                    label="Add an investigation note"
                    htmlFor="note"
                    hint="Notes cannot be edited or deleted once added."
                  >
                    <Textarea
                      id="note"
                      rows={3}
                      value={noteBody}
                      onChange={(event) => setNoteBody(event.target.value)}
                      placeholder="What did you check, and what did you find?"
                      maxLength={4000}
                    />
                  </Field>
                  <div className="mt-2.5 flex items-center justify-between gap-3">
                    <span className="tabular text-2xs text-fg-faint">{noteBody.length} / 4000</span>
                    <Button
                      type="submit"
                      variant="primary"
                      className="text-xs"
                      disabled={noteBody.trim().length < 3}
                      isLoading={addNote.isPending}
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
                      Add note
                    </Button>
                  </div>
                </form>
              )}

              {data.notes.length === 0 ? (
                <p className="px-5 py-8 text-center text-xs text-fg-muted">
                  No investigation notes yet.
                </p>
              ) : (
                <ul className="divide-y divide-line/60">
                  {data.notes.map((note) => (
                    <li key={note.id} className="px-5 py-3.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-xs font-medium text-fg">
                          {note.author.name}
                          <span className="ml-1.5 font-normal text-fg-faint">
                            {note.author.role}
                            {note.author.id === user?.id ? ' · you' : ''}
                          </span>
                        </p>
                        <p className="shrink-0 text-2xs text-fg-faint">
                          {formatDateTime(note.createdAt)}
                        </p>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                        {note.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        ) : null}
      </PageBody>

      <Modal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        title="Resolve this alert"
        description="Record what you concluded. The outcome is stored separately from the workflow status and feeds the confirmed-fraud figures."
        footer={
          <>
            <Button variant="ghost" className="text-xs" onClick={() => setResolveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="text-xs"
              form="resolve-form"
              type="submit"
              disabled={resolutionSummary.trim().length < 10}
              isLoading={updateStatus.isPending}
            >
              Resolve alert
            </Button>
          </>
        }
      >
        <form id="resolve-form" onSubmit={onResolve} className="space-y-4">
          <Field
            label="Investigation outcome"
            htmlFor="outcome"
            hint="Choose Inconclusive if the evidence does not support a decision either way."
          >
            <Select
              id="outcome"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
            >
              <option value={INVESTIGATION_OUTCOME.CONFIRMED_FRAUD}>Confirmed fraud</option>
              <option value={INVESTIGATION_OUTCOME.LEGITIMATE}>Legitimate activity</option>
              <option value={INVESTIGATION_OUTCOME.INCONCLUSIVE}>Inconclusive</option>
            </Select>
          </Field>
          <Field
            label="Resolution summary"
            htmlFor="summary"
            hint={`At least 10 characters. ${resolutionSummary.trim().length} entered.`}
          >
            <Textarea
              id="summary"
              rows={4}
              value={resolutionSummary}
              onChange={(event) => setResolutionSummary(event.target.value)}
              placeholder="Summarise the evidence and the reasoning behind this conclusion."
              maxLength={2000}
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={reopenOpen}
        onClose={() => setReopenOpen(false)}
        title="Reopen this alert"
        description="Reopening clears the recorded outcome and returns the alert to review. The existing notes and resolution history are preserved."
        footer={
          <>
            <Button variant="ghost" className="text-xs" onClick={() => setReopenOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="text-xs"
              form="reopen-form"
              type="submit"
              disabled={reopenReason.trim().length < 10}
              isLoading={updateStatus.isPending}
            >
              Reopen alert
            </Button>
          </>
        }
      >
        <form id="reopen-form" onSubmit={onReopen}>
          <Field
            label="Reason for reopening"
            htmlFor="reopen-reason"
            hint={`Recorded in the audit log and added as a case note. At least 10 characters. ${reopenReason.trim().length} entered.`}
          >
            <Textarea
              id="reopen-reason"
              rows={3}
              value={reopenReason}
              onChange={(event) => setReopenReason(event.target.value)}
              placeholder="Why is this case being reopened?"
              maxLength={500}
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}
