import { loginSchema } from '@fraudlens/shared/schemas';
import { AUDIT_ACTION, AUDIT_ENTITY_TYPE } from '@fraudlens/shared/schemas';
import { env } from '../../config/env.js';
import { asyncHandler, clientIp, sendData } from '../../utils/http.js';
import { AuthenticationError } from '../../utils/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { authenticateCredentials, toPublicUser, touchLastLogin } from './auth.service.js';
import {
  CSRF_COOKIE_NAME,
  csrfCookieOptions,
  csrfTokenForSession,
  sessionCookieOptions,
  signSessionToken,
  verifySessionToken,
} from './token.service.js';

/**
 * `POST /api/v1/auth/login`
 *
 * On success the response sets two cookies: the httpOnly session cookie that
 * carries the JWT, and a readable CSRF cookie the client echoes back in the
 * `X-CSRF-Token` header. The token is also returned in the body so that
 * non-browser clients can use `Authorization: Bearer`.
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  let user;
  try {
    user = await authenticateCredentials(email, password);
  } catch (error) {
    await recordAudit({
      actorId: null,
      action: AUDIT_ACTION.USER_LOGIN_FAILED,
      entityType: AUDIT_ENTITY_TYPE.USER,
      // The submitted address is recorded so repeated attempts against one
      // account are visible; the password never is.
      metadata: { email, reason: error instanceof AuthenticationError ? error.message : 'error' },
      requestId: req.requestId,
      ipAddress: clientIp(req),
    });
    throw error;
  }

  const token = signSessionToken(user);
  const payload = verifySessionToken(token);
  const csrfToken = csrfTokenForSession(payload.jti);

  res.cookie(env.AUTH_COOKIE_NAME, token, sessionCookieOptions());
  res.cookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions());

  await touchLastLogin(user.id);
  await recordAudit({
    actorId: user.id,
    action: AUDIT_ACTION.USER_LOGIN,
    entityType: AUDIT_ENTITY_TYPE.USER,
    entityId: user.id,
    metadata: { email: user.email, role: user.role },
    requestId: req.requestId,
    ipAddress: clientIp(req),
  });

  sendData(res, {
    user: toPublicUser(user),
    csrfToken,
    // Returned for API clients. Browser clients ignore it and rely on cookies.
    accessToken: token,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  });
});

/**
 * `POST /api/v1/auth/logout`
 *
 * Clears both cookies. The JWT itself remains cryptographically valid until it
 * expires — a deliberate, documented limitation of stateless tokens. The
 * mitigation is a short lifetime plus the per-request `isActive` check in
 * `authenticate`, which revokes a disabled account immediately.
 */
export const logout = asyncHandler(async (req, res) => {
  const cookieOptions = { ...sessionCookieOptions(), maxAge: undefined };
  res.clearCookie(env.AUTH_COOKIE_NAME, cookieOptions);
  res.clearCookie(CSRF_COOKIE_NAME, { ...csrfCookieOptions(), maxAge: undefined });

  if (req.user) {
    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTION.USER_LOGOUT,
      entityType: AUDIT_ENTITY_TYPE.USER,
      entityId: req.user.id,
      requestId: req.requestId,
      ipAddress: clientIp(req),
    });
  }

  sendData(res, { success: true });
});

/**
 * `GET /api/v1/auth/me`
 *
 * Used by the frontend to restore a session on page load. Returns the current
 * user plus a freshly derived CSRF token, so a reloaded tab can issue writes
 * without signing in again.
 */
export const getCurrentUser = asyncHandler(async (req, res) => {
  sendData(res, {
    user: toPublicUser(req.user),
    csrfToken: req.auth?.jwtId ? csrfTokenForSession(req.auth.jwtId) : null,
    expiresAt: req.auth?.expiresAt?.toISOString() ?? null,
  });
});

export { loginSchema };
