import { Navigate, useLocation } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { EmptyState, Spinner } from '../ui/index.jsx';
import { PageBody } from './PageBody.jsx';
import { TopBar } from './TopBar.jsx';

/**
 * Route guard.
 *
 * Three distinct outcomes, and conflating any two of them produces a confusing
 * app:
 *  - still restoring the session: show a spinner, decide nothing yet;
 *  - not signed in: redirect to the login page, remembering where they were
 *    headed so the redirect after sign-in lands correctly;
 *  - signed in but unauthorised: show an explicit "not permitted" page rather
 *    than redirecting, which would look like the link was broken.
 *
 * The server enforces the same permissions on every request; this guard only
 * decides what to render.
 */
export function RequirePermission({ permission, children }) {
  const { isRestoring, isAuthenticated, can } = useAuth();
  const location = useLocation();

  if (isRestoring) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner label="Restoring your session" />
          <p className="text-xs text-fg-muted">Restoring your session…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }

  if (permission && !can(permission)) {
    return (
      <>
        <TopBar title="Not permitted" />
        <PageBody>
          <div className="panel">
            <EmptyState
              icon={ShieldOff}
              title="You do not have permission to view this page"
              hint="Your role does not include the permission this page requires. Ask an administrator if you need access."
            />
          </div>
        </PageBody>
      </>
    );
  }

  return children;
}
