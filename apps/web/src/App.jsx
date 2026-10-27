import { Navigate, Route, Routes } from 'react-router-dom';
import { PERMISSION } from '@fraudlens/shared/constants';
import { AuthProvider } from './context/AuthContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import { AppLayout } from './layouts/AppLayout.jsx';
import { RequirePermission } from './components/layout/RequirePermission.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { OverviewPage } from './pages/OverviewPage.jsx';
import { TransactionsPage } from './pages/TransactionsPage.jsx';
import { TransactionDetailPage } from './pages/TransactionDetailPage.jsx';
import { AlertsPage } from './pages/AlertsPage.jsx';
import { AlertDetailPage } from './pages/AlertDetailPage.jsx';
import { AnalyticsPage } from './pages/AnalyticsPage.jsx';
import { AccountsPage } from './pages/AccountsPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { UsersPage } from './pages/UsersPage.jsx';
import { AuditPage } from './pages/AuditPage.jsx';
import { HealthPage } from './pages/HealthPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';

/**
 * Route table.
 *
 * Every authenticated route is wrapped in `RequirePermission` with the same
 * permission the corresponding API endpoints require, so the UI and the server
 * agree on who may see what.
 */
export function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <RequirePermission>
                <AppLayout />
              </RequirePermission>
            }
          >
            <Route
              index
              element={
                <RequirePermission permission={PERMISSION.DASHBOARD_READ}>
                  <OverviewPage />
                </RequirePermission>
              }
            />
            <Route
              path="transactions"
              element={
                <RequirePermission permission={PERMISSION.TRANSACTIONS_READ}>
                  <TransactionsPage />
                </RequirePermission>
              }
            />
            <Route
              path="transactions/:id"
              element={
                <RequirePermission permission={PERMISSION.TRANSACTIONS_READ}>
                  <TransactionDetailPage />
                </RequirePermission>
              }
            />
            <Route
              path="alerts"
              element={
                <RequirePermission permission={PERMISSION.ALERTS_READ}>
                  <AlertsPage />
                </RequirePermission>
              }
            />
            <Route
              path="alerts/:id"
              element={
                <RequirePermission permission={PERMISSION.ALERTS_READ}>
                  <AlertDetailPage />
                </RequirePermission>
              }
            />
            <Route
              path="analytics"
              element={
                <RequirePermission permission={PERMISSION.ANALYTICS_READ}>
                  <AnalyticsPage />
                </RequirePermission>
              }
            />
            <Route
              path="accounts"
              element={
                <RequirePermission permission={PERMISSION.ACCOUNTS_READ}>
                  <AccountsPage />
                </RequirePermission>
              }
            />
            <Route
              path="settings"
              element={
                <RequirePermission permission={PERMISSION.SETTINGS_READ}>
                  <SettingsPage />
                </RequirePermission>
              }
            />
            <Route
              path="users"
              element={
                <RequirePermission permission={PERMISSION.USERS_READ}>
                  <UsersPage />
                </RequirePermission>
              }
            />
            <Route
              path="audit"
              element={
                <RequirePermission permission={PERMISSION.AUDIT_READ}>
                  <AuditPage />
                </RequirePermission>
              }
            />
            <Route
              path="health"
              element={
                <RequirePermission permission={PERMISSION.DASHBOARD_READ}>
                  <HealthPage />
                </RequirePermission>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SocketProvider>
    </AuthProvider>
  );
}

export default App;
