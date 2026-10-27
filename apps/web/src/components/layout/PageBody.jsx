import clsx from 'clsx';

/** Scrolling content region below the top bar, with consistent page padding. */
export function PageBody({ className, children }) {
  return (
    <div className={clsx('flex-1 overflow-y-auto px-6 py-5', className)}>
      <div className="mx-auto max-w-[1600px] space-y-5">{children}</div>
    </div>
  );
}
