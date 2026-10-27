import { Router } from 'express';
import { z } from 'zod';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  uuidSchema,
} from '@fraudlens/shared/schemas';
import { PERMISSION } from '@fraudlens/shared/constants';
import { requirePermission } from '../../middleware/authorize.js';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js';
import { create, detail, list, patch } from './users.controller.js';

const router = Router();
const idParams = z.object({ id: uuidSchema });

router.get(
  '/',
  requirePermission(PERMISSION.USERS_READ),
  validateQuery(listUsersQuerySchema),
  list,
);

router.post('/', requirePermission(PERMISSION.USERS_WRITE), validateBody(createUserSchema), create);

router.get('/:id', requirePermission(PERMISSION.USERS_READ), validateParams(idParams), detail);

router.patch(
  '/:id',
  requirePermission(PERMISSION.USERS_WRITE),
  validateParams(idParams),
  validateBody(updateUserSchema),
  patch,
);

export default router;
