import {
  ALERT_SEVERITY,
  ALERT_STATUS,
  INVESTIGATION_OUTCOME,
  RISK_CATEGORY,
} from '@fraudlens/shared/constants';

/**
 * Display formatting.
 *
 * The status-colour maps live here rather than in components so that a risk
 * category looks identical in a table, a chart and a graph node. Divergent
 * colour for the same meaning is the fastest way to make a monitoring tool
 * untrustworthy.
 */

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactCurrency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const numberFormatter = new Intl.NumberFormat('en-IN');

export function formatCurrency(value) {
  if (value === null || value === undefined) return '—';
  return currencyFormatter.format(value);
}

/** Compact currency for stat tiles, where the exact paise are noise. */
export function formatCurrencyCompact(value) {
  if (value === null || value === undefined) return '—';
  return compactCurrency.format(value);
}

export function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  return numberFormatter.format(value);
}

export function formatPercent(value, { decimals = 1 } = {}) {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toFixed(decimals)}%`;
}

/** Formats a 0..1 ratio as a percentage. For precision/recall/F1. */
export function formatRatioAsPercent(value, { decimals = 1 } = {}) {
  if (value === null || value === undefined) return 'not available';
  return `${(Number(value) * 100).toFixed(decimals)}%`;
}

/** Absolute UTC timestamp. Every timestamp in the system is UTC. */
export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

export function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

/** Relative time, for "when did this happen" at a glance. */
export function formatRelative(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffSeconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (Math.abs(diffSeconds) < 45) return 'just now';
  const units = [
    { limit: 3600, divisor: 60, unit: 'minute' },
    { limit: 86_400, divisor: 3600, unit: 'hour' },
    { limit: 2_592_000, divisor: 86_400, unit: 'day' },
    { limit: 31_536_000, divisor: 2_592_000, unit: 'month' },
    { limit: Infinity, divisor: 31_536_000, unit: 'year' },
  ];
  const { divisor, unit } = units.find((entry) => Math.abs(diffSeconds) < entry.limit);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  return formatter.format(-Math.round(diffSeconds / divisor), unit);
}

export function formatDuration(hours) {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

/** Turns an enum value into a readable label: `IN_REVIEW` -> `In review`. */
export function humanise(value) {
  if (!value) return '—';
  const text = String(value).replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Truncates an id for display while keeping it recognisable. */
export function shortId(value, length = 8) {
  if (!value) return '—';
  return String(value).slice(0, length);
}

// ---------------------------------------------------------------------------
// Status colour maps
// ---------------------------------------------------------------------------

export const RISK_STYLES = {
  [RISK_CATEGORY.LOW]: {
    label: 'Low',
    badge: 'bg-risk-low/15 text-risk-low border border-risk-low/30',
    text: 'text-risk-low',
    hex: '#059669',
  },
  [RISK_CATEGORY.MEDIUM]: {
    label: 'Medium',
    badge: 'bg-risk-medium/15 text-risk-medium border border-risk-medium/30',
    text: 'text-risk-medium',
    hex: '#d97706',
  },
  [RISK_CATEGORY.HIGH]: {
    label: 'High',
    badge: 'bg-risk-high/15 text-risk-high border border-risk-high/30',
    text: 'text-risk-high',
    hex: '#dc2626',
  },
  UNASSESSED: {
    label: 'Unassessed',
    badge: 'bg-surface-3/60 text-fg-faint border border-line-2',
    text: 'text-fg-faint',
    hex: '#6b7490',
  },
};

export const SEVERITY_STYLES = {
  [ALERT_SEVERITY.LOW]: {
    label: 'Low',
    badge: 'bg-risk-low/15 text-risk-low border border-risk-low/30',
    hex: '#059669',
  },
  [ALERT_SEVERITY.MEDIUM]: {
    label: 'Medium',
    badge: 'bg-risk-medium/15 text-risk-medium border border-risk-medium/30',
    hex: '#d97706',
  },
  [ALERT_SEVERITY.HIGH]: {
    label: 'High',
    badge: 'bg-risk-high/15 text-risk-high border border-risk-high/30',
    hex: '#dc2626',
  },
  [ALERT_SEVERITY.CRITICAL]: {
    label: 'Critical',
    badge: 'bg-risk-critical/20 text-risk-critical border border-risk-critical/40',
    hex: '#9f1239',
  },
};

export const ALERT_STATUS_STYLES = {
  [ALERT_STATUS.OPEN]: {
    label: 'Open',
    badge: 'bg-accent/15 text-accent border border-accent/30',
  },
  [ALERT_STATUS.IN_REVIEW]: {
    label: 'In review',
    badge: 'bg-risk-medium/15 text-risk-medium border border-risk-medium/30',
  },
  [ALERT_STATUS.RESOLVED]: {
    label: 'Resolved',
    badge: 'bg-surface-3/60 text-fg-muted border border-line-2',
  },
};

export const OUTCOME_STYLES = {
  [INVESTIGATION_OUTCOME.PENDING]: {
    label: 'No conclusion yet',
    badge: 'bg-surface-3/60 text-fg-faint border border-line-2',
  },
  [INVESTIGATION_OUTCOME.CONFIRMED_FRAUD]: {
    label: 'Confirmed fraud',
    badge: 'bg-risk-critical/20 text-risk-critical border border-risk-critical/40',
  },
  [INVESTIGATION_OUTCOME.LEGITIMATE]: {
    label: 'Legitimate activity',
    badge: 'bg-risk-low/15 text-risk-low border border-risk-low/30',
  },
  [INVESTIGATION_OUTCOME.INCONCLUSIVE]: {
    label: 'Inconclusive',
    badge: 'bg-risk-medium/15 text-risk-medium border border-risk-medium/30',
  },
};

export function riskStyle(category) {
  return RISK_STYLES[category] ?? RISK_STYLES.UNASSESSED;
}

export function severityStyle(severity) {
  return SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.LOW;
}

export function alertStatusStyle(status) {
  return ALERT_STATUS_STYLES[status] ?? ALERT_STATUS_STYLES.OPEN;
}

export function outcomeStyle(outcome) {
  return OUTCOME_STYLES[outcome] ?? OUTCOME_STYLES.PENDING;
}

/**
 * The chart palette, matching the status colours above.
 *
 * These are the light-theme values: the pastel greens and ambers that work on
 * a dark canvas fail contrast against glass, so each is a step or two darker.
 * Grid lines are kept very light so they sit behind the data rather than
 * competing with it.
 */
export const CHART_COLORS = {
  accent: '#5b5bd6',
  accentSoft: '#7b7bf0',
  low: '#059669',
  medium: '#d97706',
  high: '#dc2626',
  critical: '#9f1239',
  muted: '#6b7490',
  grid: '#d6dcec',
  axis: '#767f9c',
};

/** Ordered categorical series colours for multi-series charts. */
export const SERIES_COLORS = [
  '#5b5bd6',
  '#0891b2',
  '#059669',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#db2777',
  '#0d9488',
];
