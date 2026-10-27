import { useState } from 'react';
import { ChevronDown, LogOut, RefreshCw } from 'lucide-react';
import { ROLE_DESCRIPTIONS } from '@fraudlens/shared/constants';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { Button } from '../ui/index.jsx';
import { ConnectionDot } from '../ui/StatusBadges.jsx';

/**
 * Top bar: page title, realtime connection state, and the account menu.
 *
 * The connection indicator is shown on every page because almost every page has
 * a live component, and a silently dead socket showing stale data is worse than
 * an obvious "reconnecting" label.
 */
export function TopBar({ title, subtitle, actions }) {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="glass-chrome z-20 flex shrink-0 items-center gap-4 border-b px-6 py-3.5">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle ? <p className="mt-0.5 truncate text-xs text-fg-muted">{subtitle}</p> : null}
      </div>

      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}

      <ConnectionDot connected={connected} />

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="flex items-center gap-2 rounded-lg border border-line bg-white/80 px-2.5 py-1.5 text-left transition-colors hover:border-line-2"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/15 text-2xs font-semibold text-accent">
            {user?.name?.charAt(0)?.toUpperCase() ?? '?'}
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-xs font-medium text-fg">{user?.name}</span>
            <span className="block text-2xs text-fg-faint">{user?.role}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-fg-faint" aria-hidden="true" />
        </button>

        {menuOpen ? (
          <>
            {/* Click-away layer, so the menu closes without a document listener. */}
            <div
              className="fixed inset-0 z-30"
              aria-hidden="true"
              onClick={() => setMenuOpen(false)}
            />
            <div role="menu" className="panel absolute right-0 z-40 mt-2 w-72 animate-slide-in p-4">
              <p className="text-sm font-medium text-fg">{user?.name}</p>
              <p className="truncate text-xs text-fg-muted">{user?.email}</p>
              <p className="mt-2.5 rounded-md bg-white/80 px-2.5 py-2 text-2xs leading-relaxed text-fg-muted">
                <span className="font-semibold text-accent">{user?.role}</span>
                {' — '}
                {ROLE_DESCRIPTIONS[user?.role] ?? ''}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1 text-xs"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reload
                </Button>
                <Button variant="danger" className="flex-1 text-xs" onClick={() => void logout()}>
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  Sign out
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}
