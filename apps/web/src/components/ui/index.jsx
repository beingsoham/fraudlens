import { forwardRef } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Info, Loader2, RefreshCw, X } from 'lucide-react';

/**
 * Shared primitives.
 *
 * Collected in one module because they are small, used everywhere, and belong
 * to the same visual vocabulary — keeping them together is what stops a second,
 * slightly different card or badge appearing elsewhere in the app.
 */

export function Panel({ className, children, ...rest }) {
  return (
    <section className={clsx('panel', className)} {...rest}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, subtitle, actions, info }) {
  return (
    <header className="panel-header">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h2 className="panel-title truncate">{title}</h2>
          {info ? <InfoTip text={info} /> : null}
        </div>
        {subtitle ? <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A hover/focus tooltip carrying a metric's definition.
 *
 * Every figure on the dashboard has a documented definition, and this is how it
 * reaches the person reading the number. Focusable, so the definition is
 * available by keyboard too.
 */
export function InfoTip({ text, className }) {
  return (
    <span className={clsx('group relative inline-flex', className)}>
      <button
        type="button"
        aria-label={`Definition: ${text}`}
        className="rounded text-fg-faint transition-colors hover:text-accent focus-visible:text-accent"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-72 -translate-x-1/2
          rounded-lg border border-line-2 bg-white/80 px-3 py-2 text-xs leading-relaxed text-fg-muted
          opacity-0 shadow-glass transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

export function Badge({ className, children, ...rest }) {
  return (
    <span className={clsx('badge', className)} {...rest}>
      {children}
    </span>
  );
}

export const Button = forwardRef(function Button(
  { variant = 'secondary', isLoading = false, className, children, disabled, ...rest },
  ref,
) {
  const variants = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
  };
  return (
    <button
      ref={ref}
      className={clsx(variants[variant] ?? variants.secondary, className)}
      disabled={disabled || isLoading}
      {...rest}
    >
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});

export function Spinner({ className, label = 'Loading' }) {
  return (
    <span role="status" aria-label={label} className={clsx('inline-flex', className)}>
      <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
    </span>
  );
}

/** Full-panel loading state sized to the content it replaces. */
export function LoadingBlock({ rows = 4, className }) {
  return (
    <div className={clsx('space-y-2.5 p-5', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton h-4" style={{ width: `${100 - index * 12}%` }} />
      ))}
    </div>
  );
}

/**
 * Error state with a retry affordance.
 *
 * Shows the request id when the API supplied one: that is the value that ties a
 * user's report back to a specific log entry and audit row.
 */
export function ErrorBlock({ error, onRetry, className }) {
  if (!error) return null;
  const isForbidden = error.status === 403;
  return (
    <div
      className={clsx(
        'flex flex-col items-start gap-3 rounded-lg border p-5',
        isForbidden
          ? 'border-risk-medium/30 bg-risk-medium/5'
          : 'border-risk-high/30 bg-risk-high/5',
        className,
      )}
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          className={clsx(
            'mt-0.5 h-4 w-4 shrink-0',
            isForbidden ? 'text-risk-medium' : 'text-risk-high',
          )}
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-medium text-fg">
            {isForbidden ? 'Not permitted' : 'Something went wrong'}
          </p>
          <p className="mt-0.5 text-sm text-fg-muted">{error.message}</p>
          {error.requestId ? (
            <p className="mt-1.5 font-mono text-2xs text-fg-faint">Request {error.requestId}</p>
          ) : null}
        </div>
      </div>
      {onRetry && !isForbidden ? (
        <Button variant="secondary" onClick={onRetry} className="text-xs">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Empty state. `hint` should say what would make rows appear. */
export function EmptyState({ icon: Icon, title, hint, action, className }) {
  return (
    <div className={clsx('flex flex-col items-center gap-2 px-6 py-12 text-center', className)}>
      {Icon ? <Icon className="h-7 w-7 text-fg-faint" aria-hidden="true" /> : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint ? <p className="max-w-md text-xs leading-relaxed text-fg-muted">{hint}</p> : null}
      {action}
    </div>
  );
}

export function Field({ label, error, hint, htmlFor, children, className }) {
  return (
    <div className={className}>
      {label ? (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1 text-xs text-risk-high" role="alert">
          {error}
        </p>
      ) : null}
      {!error && hint ? <p className="mt-1 text-xs text-fg-faint">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx('input', invalid && 'border-risk-high/60', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx('select', className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea(
  { className, invalid, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={clsx('input resize-y', invalid && 'border-risk-high/60', className)}
      {...rest}
    />
  );
});

/**
 * A modal dialog.
 *
 * Closes on Escape and on backdrop click, and traps nothing — deliberately
 * simple, because every dialog in this application is a short form rather than
 * a nested workspace.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-canvas-deep/70 p-4 pt-[8vh] backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose?.();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className={clsx('panel w-full animate-slide-in', widths[size])}>
        <header className="panel-header">
          <div>
            <h2 className="panel-title">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="btn-ghost -mr-1.5 p-1.5"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-line/70 px-5 py-3.5">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Server-side pagination control.
 *
 * Reports the row window as well as the page number, because "showing 51-75 of
 * 1,447" is the information an operator actually needs when working a queue.
 */
export function Pagination({ meta, onPageChange, className }) {
  if (!meta || meta.total === 0) return null;
  const { page, pageSize, total, totalPages, hasNextPage, hasPreviousPage } = meta;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div
      className={clsx(
        'flex flex-wrap items-center justify-between gap-3 border-t border-line/70 px-5 py-3',
        className,
      )}
    >
      <p className="tabular text-xs text-fg-muted">
        Showing <span className="text-fg">{first.toLocaleString('en-IN')}</span>–
        <span className="text-fg">{last.toLocaleString('en-IN')}</span> of{' '}
        <span className="text-fg">{total.toLocaleString('en-IN')}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          className="px-2.5 py-1.5 text-xs"
          disabled={!hasPreviousPage}
          onClick={() => onPageChange(1)}
        >
          First
        </Button>
        <Button
          variant="secondary"
          className="px-2.5 py-1.5 text-xs"
          disabled={!hasPreviousPage}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className="tabular px-2 text-xs text-fg-muted">
          {page} / {Math.max(totalPages, 1)}
        </span>
        <Button
          variant="secondary"
          className="px-2.5 py-1.5 text-xs"
          disabled={!hasNextPage}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
        <Button
          variant="ghost"
          className="px-2.5 py-1.5 text-xs"
          disabled={!hasNextPage}
          onClick={() => onPageChange(totalPages)}
        >
          Last
        </Button>
      </div>
    </div>
  );
}

/** A column header that toggles sort direction. */
export function SortableHeader({ field, label, sortBy, sortDir, onSort, className, align }) {
  const active = sortBy === field;
  return (
    <th scope="col" className={clsx('px-4 py-2.5', align === 'right' && 'text-right', className)}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={clsx(
          'inline-flex items-center gap-1 rounded transition-colors hover:text-fg',
          active && 'text-accent',
        )}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <span aria-hidden="true" className="text-[9px]">
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </button>
    </th>
  );
}

/** A toast-style inline notice. */
export function Notice({ tone = 'info', children, onDismiss, className }) {
  const tones = {
    info: 'border-accent/30 bg-accent/5 text-fg',
    success: 'border-risk-low/30 bg-risk-low/5 text-fg',
    warning: 'border-risk-medium/30 bg-risk-medium/5 text-fg',
    error: 'border-risk-high/30 bg-risk-high/5 text-fg',
  };
  return (
    <div
      className={clsx(
        'flex items-start justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm',
        tones[tone],
        className,
      )}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <div className="min-w-0">{children}</div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-fg-faint hover:text-fg"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
