import { z } from 'zod';

/**
 * Password policy for locally provisioned accounts: at least 12 characters with
 * a lower-case letter, an upper-case letter and a digit. Long enough to resist
 * offline attack against the bcrypt hash, simple enough to explain in the UI.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lower-case letter')
  .regex(/[A-Z]/, 'Password must contain an upper-case letter')
  .regex(/[0-9]/, 'Password must contain a digit');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(EMAIL_PATTERN, 'Must be a valid email address')
  .max(254);

export const loginSchema = z.object({
  email: emailSchema,
  /**
   * Deliberately only length-checked: applying the full policy here would let
   * an attacker distinguish "wrong shape" from "wrong password".
   */
  password: z.string().min(1, 'Password is required').max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
