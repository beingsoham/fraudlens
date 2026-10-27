import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AuthenticationError } from '../../utils/errors.js';

const JWT_ISSUER = 'fraudlens';
const JWT_AUDIENCE = 'fraudlens-api';

/**
 * Signs a session token.
 *
 * The payload carries only the user id and role. Everything else — whether the
 * account is still active, its current permissions — is read from the database
 * on each request, so deactivating a user or changing their role takes effect
 * immediately rather than when their token happens to expire.
 */
export function signSessionToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    jwtid: randomBytes(16).toString('hex'),
  });
}

/** Verifies a session token, raising AuthenticationError on any problem. */
export function verifySessionToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      throw new AuthenticationError('Your session has expired. Please sign in again.');
    }
    throw new AuthenticationError('Invalid session token');
  }
}

/** Seconds until a signed token expires, for the cookie `maxAge`. */
export function tokenLifetimeSeconds() {
  const match = /^(\d+)([smhd])$/.exec(env.JWT_EXPIRES_IN);
  if (!match) return 12 * 3600;
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
  return Number(match[1]) * multiplier;
}

/**
 * Builds the CSRF token for a session.
 *
 * This is the "signed double-submit cookie" pattern: the token is an HMAC of
 * the session's JWT id under a secret distinct from the JWT secret. Because it
 * is derived from the session, a token minted for one session cannot be
 * replayed against another, and because the server recomputes it there is no
 * server-side CSRF state to store.
 */
export function csrfTokenForSession(jwtId) {
  return createHmac('sha256', env.COOKIE_SECRET).update(`csrf:${jwtId}`).digest('base64url');
}

/** Constant-time comparison of two CSRF tokens. */
export function csrfTokenMatches(expected, provided) {
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

/** Cookie options for the session cookie. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    // `strict` would break a link opened from another site; `lax` still blocks
    // the cross-site POSTs that CSRF relies on, and the CSRF token covers the
    // remaining surface.
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge: tokenLifetimeSeconds() * 1000,
  };
}

/**
 * Cookie options for the CSRF cookie.
 *
 * Deliberately NOT httpOnly: the browser client has to read it to echo the
 * value in the `X-CSRF-Token` header. That is safe — the token is useless
 * without the httpOnly session cookie that accompanies it.
 */
export function csrfCookieOptions() {
  return {
    httpOnly: false,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge: tokenLifetimeSeconds() * 1000,
  };
}

export const CSRF_COOKIE_NAME = 'fraudlens_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';
export { JWT_ISSUER, JWT_AUDIENCE };
