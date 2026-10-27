import bcrypt from 'bcryptjs';
import { permissionsForRole } from '@fraudlens/shared/constants';
import { prisma } from '../../config/prisma.js';
import { AuthenticationError } from '../../utils/errors.js';

/**
 * bcrypt cost factor. 12 is a deliberate trade-off: roughly 250 ms per hash on
 * commodity hardware, slow enough to make offline cracking expensive and fast
 * enough that a login does not feel sluggish.
 */
export const BCRYPT_ROUNDS = 12;

/**
 * A bcrypt hash of a throwaway value, used to equalise timing on the
 * "unknown email" path. Without it, a missing account would return noticeably
 * faster than a wrong password and so leak which addresses are registered.
 */
const TIMING_EQUALISER_HASH = bcrypt.hashSync('fraudlens-timing-equaliser', BCRYPT_ROUNDS);

export async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

export async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

/** Fields safe to return to a client. Note the absence of `passwordHash`. */
export const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

/** Shapes a user record for an API response, adding its effective permissions. */
export function toPublicUser(user) {
  if (!user) return null;
  const { passwordHash: _ignored, ...rest } = user;
  return { ...rest, permissions: permissionsForRole(user.role) };
}

/**
 * Authenticates an email/password pair.
 *
 * Every failure path — unknown address, wrong password, deactivated account —
 * returns the same message and does comparable work, so the response reveals
 * nothing beyond "these credentials did not work".
 */
export async function authenticateCredentials(email, password) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { ...SAFE_USER_SELECT, passwordHash: true },
  });

  if (!user) {
    await bcrypt.compare(password, TIMING_EQUALISER_HASH);
    throw new AuthenticationError('Invalid email or password');
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    throw new AuthenticationError('Invalid email or password');
  }
  if (!user.isActive) {
    throw new AuthenticationError('This account has been deactivated');
  }

  return user;
}

/** Records the successful sign-in time. Failures here never block the login. */
export async function touchLastLogin(userId) {
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}
