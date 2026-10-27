import { z } from 'zod';
import { USER_ROLES } from '../constants/roles.js';
import { USER_SORT_FIELDS } from '../constants/pagination.js';
import { paginationSchema, searchSchema } from './common.js';
import { emailSchema, passwordSchema } from './auth.js';

export const nameSchema = z.string().trim().min(2, 'Name must be at least 2 characters').max(120);

/** Body of `POST /api/v1/users`. Only an administrator may call it. */
export const createUserSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    role: z.enum(USER_ROLES),
    isActive: z.boolean().default(true),
  })
  .strict();

/**
 * Body of `PATCH /api/v1/users/:id`.
 *
 * A password may be reset but never read back: there is no endpoint anywhere in
 * the application that returns a password or a password hash.
 */
export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
    password: passwordSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

export const listUsersQuerySchema = paginationSchema.extend({
  sortBy: z.enum(USER_SORT_FIELDS).default('createdAt'),
  search: searchSchema.optional(),
  role: z.enum(USER_ROLES).optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});
