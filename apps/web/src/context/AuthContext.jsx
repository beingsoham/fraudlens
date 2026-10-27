import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { permissionsForRole } from '@fraudlens/shared/constants';
import { ApiError, onUnauthenticated } from '../services/api.js';
import { authApi } from '../services/endpoints.js';

/**
 * Authentication state.
 *
 * The session lives in an httpOnly cookie the client cannot read, so "am I
 * signed in?" is answered by calling `/auth/me` on mount rather than by
 * inspecting local storage. No token is ever persisted in `localStorage`: a
 * token readable by script is a token stealable by script.
 */

const AuthContext = createContext(null);

const STATUS = {
  RESTORING: 'restoring',
  AUTHENTICATED: 'authenticated',
  ANONYMOUS: 'anonymous',
};

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(STATUS.RESTORING);
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  /** Restores the session from the cookie, if one is still valid. */
  const restore = useCallback(async (signal) => {
    try {
      const { data } = await authApi.me({ signal });
      setUser(data.user);
      setStatus(STATUS.AUTHENTICATED);
    } catch (restoreError) {
      if (restoreError?.name === 'AbortError') return;
      // A 401 here is the normal "not signed in" case, not a failure worth
      // showing the user an error for.
      setUser(null);
      setStatus(STATUS.ANONYMOUS);
      if (!(restoreError instanceof ApiError && restoreError.isUnauthenticated)) {
        setError(restoreError.message);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void restore(controller.signal);
    return () => controller.abort();
  }, [restore]);

  // Any 401 from any request, anywhere in the app, drops the session here.
  useEffect(
    () =>
      onUnauthenticated(() => {
        setUser(null);
        setStatus(STATUS.ANONYMOUS);
      }),
    [],
  );

  const login = useCallback(async (credentials) => {
    setError(null);
    const { data } = await authApi.login(credentials);
    setUser(data.user);
    setStatus(STATUS.AUTHENTICATED);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Local state is cleared even if the request fails, so the user is never
      // left looking at a signed-in UI they can no longer use.
      setUser(null);
      setStatus(STATUS.ANONYMOUS);
    }
  }, []);

  const value = useMemo(() => {
    const permissions = user?.permissions ?? (user ? permissionsForRole(user.role) : []);
    return {
      status,
      user,
      error,
      isRestoring: status === STATUS.RESTORING,
      isAuthenticated: status === STATUS.AUTHENTICATED,
      permissions,
      /**
       * Convenience check for conditional rendering only. The server enforces
       * authorization on every request regardless of what the UI shows.
       */
      can: (...required) => required.every((permission) => permissions.includes(permission)),
      hasRole: (...roles) => Boolean(user && roles.includes(user.role)),
      login,
      logout,
      refresh: () => restore(),
    };
  }, [status, user, error, login, logout, restore]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
}

export { AUTH_STATUS } from './authStatus.js';
