import { USER_ROLE, permissionsForRole } from '@fraudlens/shared/constants';
import { AuthenticationError, AuthorizationError } from '../utils/errors.js';

/**
 * Requires that the authenticated user holds every listed permission.
 *
 * This is the server-side authorization boundary. The frontend hides controls
 * the user cannot use, but that is presentation only — every protected route
 * passes through here regardless of what the client sent.
 */
export function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AuthenticationError());
      return;
    }
    const granted = req.user.permissions ?? permissionsForRole(req.user.role);
    const missing = permissions.filter((permission) => !granted.includes(permission));
    if (missing.length > 0) {
      next(
        new AuthorizationError('You do not have permission to perform this action', {
          required: permissions,
        }),
      );
      return;
    }
    next();
  };
}

/** Requires one of the listed roles. Prefer `requirePermission` where possible. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AuthenticationError());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AuthorizationError('This action requires a different role'));
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole(USER_ROLE.ADMIN);

/** True when the user holds the permission. For conditional response detail. */
export function userHasPermission(user, permission) {
  if (!user) return false;
  return (user.permissions ?? permissionsForRole(user.role)).includes(permission);
}
