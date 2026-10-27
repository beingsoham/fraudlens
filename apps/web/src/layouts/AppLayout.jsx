import { Outlet } from 'react-router-dom';
import { SOCKET_EVENT } from '@fraudlens/shared/constants';
import { useState } from 'react';
import { Sidebar } from '../components/layout/Sidebar.jsx';
import { useSocketEvent } from '../context/SocketContext.jsx';
import { useApi } from '../hooks/useApi.js';
import { dashboardApi } from '../services/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PERMISSION } from '@fraudlens/shared/constants';

/**
 * Authenticated application shell.
 *
 * Holds the open-alert count for the sidebar badge, kept current by the
 * `alert:created` event so a new alert appears in the navigation without the
 * operator reloading. The count is seeded from the API rather than from zero, so
 * the badge is correct on first paint.
 */
export function AppLayout() {
  const { can } = useAuth();
  const canReadDashboard = can(PERMISSION.DASHBOARD_READ);
  const [liveIncrement, setLiveIncrement] = useState(0);

  const { data: summary } = useApi((options) => dashboardApi.summary({}, options), [], {
    enabled: canReadDashboard,
  });

  // Incremented locally rather than refetching the whole summary on every
  // alert: at simulator rates that would be a request per transaction.
  useSocketEvent(SOCKET_EVENT.ALERT_CREATED, () => {
    setLiveIncrement((count) => count + 1);
  });

  const openAlertCount = (summary?.metrics?.openAlerts ?? 0) + liveIncrement;

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar openAlertCount={openAlertCount} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
