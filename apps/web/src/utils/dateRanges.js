/**
 * Preset date ranges for the filter controls.
 *
 * Ranges are computed fresh each call rather than at module load, so a tab left
 * open overnight does not keep filtering against yesterday's "today".
 */

const MS_PER_DAY = 86_400_000;

export const RANGE_PRESETS = [
  { id: '24h', label: 'Last 24 hours', days: 1, interval: 'hour' },
  { id: '7d', label: 'Last 7 days', days: 7, interval: 'day' },
  { id: '30d', label: 'Last 30 days', days: 30, interval: 'day' },
  { id: '90d', label: 'Last 90 days', days: 90, interval: 'week' },
  { id: 'all', label: 'All time', days: 3650, interval: 'week' },
];

export const DEFAULT_RANGE_ID = '30d';

/** Resolves a preset id into concrete `{ from, to, interval }` ISO strings. */
export function resolvePreset(id = DEFAULT_RANGE_ID) {
  const preset = RANGE_PRESETS.find((entry) => entry.id === id) ?? RANGE_PRESETS[2];
  const to = new Date();
  const from = new Date(to.getTime() - preset.days * MS_PER_DAY);
  return {
    id: preset.id,
    label: preset.label,
    interval: preset.interval,
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

/** Formats a bucket boundary for a chart axis, given the interval. */
export function formatBucketLabel(iso, interval) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (interval === 'hour') {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(date);
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}
