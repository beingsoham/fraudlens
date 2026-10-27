import { Calendar } from 'lucide-react';
import clsx from 'clsx';
import { RANGE_PRESETS } from '../../utils/dateRanges.js';

/**
 * Date-range preset selector.
 *
 * Presets rather than a free date picker: every analytics question in this
 * application is "what happened recently", and a segmented control is faster to
 * operate than two date fields.
 */
export function RangeFilter({ value, onChange, className }) {
  return (
    <div
      className={clsx(
        'inline-flex items-center gap-1 rounded-lg border border-line bg-white/80 p-0.5',
        className,
      )}
      role="group"
      aria-label="Date range"
    >
      <Calendar className="ml-1.5 h-3.5 w-3.5 text-fg-faint" aria-hidden="true" />
      {RANGE_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => onChange(preset.id)}
          aria-pressed={value === preset.id}
          className={clsx(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            value === preset.id
              ? 'bg-accent/15 text-accent'
              : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
          )}
        >
          {preset.label.replace('Last ', '')}
        </button>
      ))}
    </div>
  );
}
