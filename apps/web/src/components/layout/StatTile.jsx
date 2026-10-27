import clsx from 'clsx';
import { InfoTip } from '../ui/index.jsx';

/**
 * A single headline figure.
 *
 * `definition` is required by convention: no number appears on a dashboard
 * without the documented definition reachable from it. `tone` is used sparingly
 * — colouring every tile makes none of them stand out.
 */
export function StatTile({
  label,
  value,
  definition,
  sublabel,
  icon: Icon,
  tone = 'default',
  isLoading,
  className,
}) {
  const tones = {
    default: 'text-fg',
    accent: 'text-accent',
    low: 'text-risk-low',
    medium: 'text-risk-medium',
    high: 'text-risk-high',
    critical: 'text-risk-critical',
  };

  return (
    <div className={clsx('panel p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="text-2xs font-semibold uppercase tracking-wider text-fg-muted">{label}</p>
          {definition ? <InfoTip text={definition} /> : null}
        </div>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden="true" /> : null}
      </div>
      {isLoading ? (
        <div className="skeleton mt-2.5 h-7 w-24" />
      ) : (
        <p className={clsx('tabular mt-1.5 text-2xl font-semibold tracking-tight', tones[tone])}>
          {value}
        </p>
      )}
      {sublabel ? <p className="mt-0.5 text-xs text-fg-muted">{sublabel}</p> : null}
    </div>
  );
}
