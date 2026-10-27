import clsx from 'clsx';
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { Badge, InfoTip } from './index.jsx';
import { alertStatusStyle, outcomeStyle, riskStyle, severityStyle } from '../../utils/format.js';

/**
 * Status display components.
 *
 * The wording here is load-bearing. A risk category is a *signal for review*,
 * and the badges say so: the risk badge's tooltip states explicitly that a high
 * score is not a finding of fraud, and only the investigation-outcome badge
 * ever uses the word "fraud" in a confirmed sense.
 */

const RISK_TOOLTIP =
  'Risk category assigned by the detection engine from the transaction and the ' +
  "sender's history. It indicates characteristics warranting review — it is not a " +
  'finding of fraud.';

export function RiskBadge({ category, score, showScore = true, withTooltip = false, className }) {
  const style = riskStyle(category);
  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)}>
      <Badge className={style.badge}>
        {style.label}
        {showScore && score !== null && score !== undefined ? (
          <span className="tabular font-mono font-normal opacity-80">{score}</span>
        ) : null}
      </Badge>
      {withTooltip ? <InfoTip text={RISK_TOOLTIP} /> : null}
    </span>
  );
}

/**
 * A 0..100 risk score rendered as a bar.
 *
 * The threshold markers show where the medium and high boundaries sit, so the
 * score is readable against the configuration that produced it rather than as
 * an abstract number.
 */
export function RiskScoreBar({ score, thresholds, className }) {
  if (score === null || score === undefined) {
    return <span className={clsx('text-xs text-fg-faint', className)}>Not assessed</span>;
  }
  const category =
    score >= (thresholds?.highThreshold ?? 70)
      ? 'HIGH'
      : score >= (thresholds?.mediumThreshold ?? 30)
        ? 'MEDIUM'
        : 'LOW';
  const style = riskStyle(category);

  return (
    <div className={clsx('w-full', className)}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className={clsx('tabular font-mono text-lg font-semibold', style.text)}>
          {score}
          <span className="text-xs font-normal text-fg-faint">/100</span>
        </span>
        <Badge className={style.badge}>{style.label}</Badge>
      </div>
      <div
        className="relative h-2 overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Risk score ${score} of 100, category ${style.label}`}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: style.hex }}
        />
        {thresholds ? (
          <>
            <span
              className="absolute top-0 h-full w-px bg-fg/30"
              style={{ left: `${thresholds.mediumThreshold}%` }}
              aria-hidden="true"
            />
            <span
              className="absolute top-0 h-full w-px bg-fg/30"
              style={{ left: `${thresholds.highThreshold}%` }}
              aria-hidden="true"
            />
          </>
        ) : null}
      </div>
      {thresholds ? (
        <p className="tabular mt-1 text-2xs text-fg-faint">
          Medium at {thresholds.mediumThreshold} · High at {thresholds.highThreshold} · Alert at{' '}
          {thresholds.alertThreshold}
        </p>
      ) : null}
    </div>
  );
}

export function SeverityBadge({ severity, className }) {
  const style = severityStyle(severity);
  return <Badge className={clsx(style.badge, className)}>{style.label}</Badge>;
}

/** Workflow status: where the alert sits in the review process. */
export function AlertStatusBadge({ status, className }) {
  const style = alertStatusStyle(status);
  return <Badge className={clsx(style.badge, className)}>{style.label}</Badge>;
}

/**
 * Investigation outcome: what a human concluded.
 *
 * Shown with its own icon and never merged with the workflow badge, so an
 * operator cannot mistake "nobody has looked at this" for "we decided it was
 * fine".
 */
export function OutcomeBadge({ outcome, className, withIcon = true }) {
  const style = outcomeStyle(outcome);
  const Icon =
    outcome === 'CONFIRMED_FRAUD'
      ? ShieldAlert
      : outcome === 'LEGITIMATE'
        ? ShieldCheck
        : ShieldQuestion;
  return (
    <Badge className={clsx(style.badge, className)}>
      {withIcon ? <Icon className="h-3 w-3" aria-hidden="true" /> : null}
      {style.label}
    </Badge>
  );
}

/** A synthetic account reference, in monospace so handles line up. */
export function AccountRef({ accountRef, displayName, isMerchant, className }) {
  if (!accountRef) return <span className="text-fg-faint">—</span>;
  return (
    <span className={clsx('inline-flex min-w-0 flex-col', className)}>
      <span className="truncate font-mono text-xs text-fg">{accountRef}</span>
      {displayName ? (
        <span className="truncate text-2xs text-fg-faint">
          {displayName}
          {isMerchant ? ' · merchant' : ''}
        </span>
      ) : null}
    </span>
  );
}

/** Connection indicator for the realtime socket. */
export function ConnectionDot({ connected, label, className }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)}>
      <span
        className={clsx('h-1.5 w-1.5 rounded-full', connected ? 'bg-risk-low' : 'bg-risk-medium')}
        aria-hidden="true"
      />
      <span className="text-2xs text-fg-muted">
        {label ?? (connected ? 'Live' : 'Reconnecting')}
      </span>
    </span>
  );
}
