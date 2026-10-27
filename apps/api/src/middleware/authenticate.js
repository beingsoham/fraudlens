import { permissionsForRole } from '@fraudlens/shared/constants';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AuthenticationError } from '../utils/errors.js';
import { verifySessionToken } from '../modules/auth/token.service.js';

/** Extracts the raw token from the session cookie, or an Authorization header. */
function extractToken(req) {
  const cookieToken = req.cookies?.[env.AUTH_COOKIE_NAME];
  if (cookieToken) return { token: cookieToken, source: 'cookie' };

  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) {
    return { token: header.slice(7).trim(), source: 'bearer' };
  }
  return { token: null, source: null };
}

/**
 * Authenticates the request and attaches `req.user`.
 *
 * The token is only the claim of identity; the authoritative record is read
 * from the database on every request. A deactivated account or a changed role
 * therefore takes effect at once, and a stolen token stops working as soon as
 * the account is disabled.
 */
export async function authenticate(req, _res, next) {
  try {
    const { token, source } = extractToken(req);
    if (!token) {
      throw new AuthenticationError('Authentication is required');
    }

    const payload = verifySessionToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    if (!user) {
      throw new AuthenticationError('Your account no longer exists');
    }
    if (!user.isActive) {
      throw new AuthenticationError('Your account has been deactivated');
    }

    req.user = { ...user, permissions: permissionsForRole(user.role) };
    req.auth = { jwtId: payload.jti, source, expiresAt: new Date(payload.exp * 1000) };
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Authenticates when credentials are present but does not require them.
 * Used by endpoints whose response detail depends on the caller, such as
 * `/health`, which reports more to an administrator than to an anonymous probe.
 */
export async function authenticateOptional(req, res, next) {
  const { token } = extractToken(req);
  if (!token) {
    next();
    return;
  }
  // `authenticate` reports failures through `next(error)`, so an intercepting
  // callback is what turns a rejected credential into "simply anonymous" here.
  await authenticate(req, res, (error) => {
    if (error) {
      req.user = undefined;
      req.auth = undefined;
    }
    next();
  });
}
