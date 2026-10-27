import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import {
  Activity,
  BarChart3,
  FileClock,
  HeartPulse,
  LayoutDashboard,
  Network,
  Settings,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { PERMISSION } from '@fraudlens/shared/constants';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * Primary navigation.
 *
 * Each item declares the permission it needs and is hidden when the signed-in
 * user lacks it. This is presentation only — the route guard and the server both
 * enforce the same permission, so hiding a link is a usability choice rather
 * than a security measure.
 */
const NAV_ITEMS = [
  {
    to: '/',
    label: 'Overview',
    icon: LayoutDashboard,
    permission: PERMISSION.DASHBOARD_READ,
    end: true,
  },
  {
    to: '/transactions',
    label: 'Transactions',
    icon: Activity,
    permission: PERMISSION.TRANSACTIONS_READ,
  },
  { to: '/alerts', label: 'Alerts', icon: ShieldAlert, permission: PERMISSION.ALERTS_READ },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, permission: PERMISSION.ANALYTICS_READ },
  { to: '/accounts', label: 'Relationships', icon: Network, permission: PERMISSION.ACCOUNTS_READ },
  {
    to: '/settings',
    label: 'Detection rules',
    icon: Settings,
    permission: PERMISSION.SETTINGS_READ,
  },
  { to: '/users', label: 'Users', icon: Users, permission: PERMISSION.USERS_READ },
  { to: '/audit', label: 'Audit log', icon: FileClock, permission: PERMISSION.AUDIT_READ },
  {
    to: '/health',
    label: 'System health',
    icon: HeartPulse,
    permission: PERMISSION.DASHBOARD_READ,
  },
];

export function Sidebar({ openAlertCount }) {
  const { can } = useAuth();
  const visible = NAV_ITEMS.filter((item) => can(item.permission));

  return (
    <nav
      className="glass-chrome flex h-full w-60 shrink-0 flex-col border-r"
      aria-label="Main navigation"
    >
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 ring-1 ring-accent/30">
          <ShieldAlert className="h-4 w-4 text-accent" aria-hidden="true" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight text-fg">FraudLens</p>
          <p className="text-2xs text-fg-faint">Risk monitoring</p>
        </div>
      </div>

      <ul className="flex-1 space-y-0.5 px-2.5 py-2">
        {visible.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-accent/10 font-medium text-accent ring-1 ring-accent/20'
                    : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
              {item.to === '/alerts' && openAlertCount > 0 ? (
                <span className="tabular ml-auto rounded-full bg-risk-high/20 px-1.5 py-0.5 text-2xs font-semibold text-risk-high">
                  {openAlertCount > 99 ? '99+' : openAlertCount}
                </span>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="border-t border-white/50 px-5 py-3">
        <p className="text-2xs leading-relaxed text-fg-faint">
          Analytics and investigation only. FraudLens does not block payments.
        </p>
      </div>
    </nav>
  );
}
