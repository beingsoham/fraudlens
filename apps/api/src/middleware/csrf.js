import { env } from '../config/env.js';
import { AuthorizationError } from '../utils/errors.js';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  csrfTokenForSession,
  csrfTokenMatches,
} from '../modules/auth/token.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated, state-changing requests.
 *
 * Only cookie sessions need it: a `Bearer` token is not sent automatically by
 * the browser, so a cross-site request cannot carry one. The expected token is
 * recomputed from the session's JWT id, so it is bound to this session and
 * cannot be replayed from another.
 *
 * Must run after `authenticate`, which populates `req.auth`.
 */
export function csrfProtection(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  // Token-authenticated API clients are not exposed to CSRF.
  if (req.auth?.source !== 'cookie') {
    next();
    return;
  }
  if (!req.auth?.jwtId) {
    next(new AuthorizationError('Session is missing a CSRF binding; sign in again'));
    return;
  }

  const expected = csrfTokenForSession(req.auth.jwtId);
  // Read from the header ONLY. Falling back to the cookie would defeat the
  // entire mechanism: the browser attaches cookies to cross-site requests
  // automatically, so a cookie-sourced token proves nothing. The protection
  // comes precisely from the fact that script on another origin cannot read
  // this value and cannot set a custom header on a simple cross-site form post.
  const provided = req.get(CSRF_HEADER_NAME);

  if (!provided || !csrfTokenMatches(expected, provided)) {
    next(
      new AuthorizationError('CSRF validation failed. Refresh the page and try again.', {
        header: CSRF_HEADER_NAME,
      }),
    );
    return;
  }
  next();
}

/** Exposed for the integration tests and the auth controller. */
export { CSRF_COOKIE_NAME, CSRF_HEADER_NAME };
export const csrfCookieName = CSRF_COOKIE_NAME;
export const authCookieName = env.AUTH_COOKIE_NAME;
