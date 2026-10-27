import { USER_ROLE } from '@fraudlens/shared/constants';
import { AUDIT_ACTION, AUDIT_ENTITY_TYPE } from '@fraudlens/shared/schemas';
import { prisma } from '../../config/prisma.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../utils/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { SAFE_USER_SELECT, hashPassword, toPublicUser } from '../auth/auth.service.js';

/**
 * User administration.
 *
 * Three invariants are enforced here, each guarding against a specific way the
 * access-control model could be undermined:
 *
 *  1. **No plaintext password is ever readable.** `SAFE_USER_SELECT` omits
 *     `passwordHash`, and no endpoint returns it or the password. A password can
 *     only be *set*.
 *  2. **An administrator cannot escalate or lock themselves out.** They may not
 *     change their own role or deactivate their own account, which prevents both
 *     an accidental lockout and a self-grant that leaves no accountable actor.
 *  3. **The last active administrator cannot be removed.** Demoting or
 *     deactivating them would leave the installation with no one able to manage
 *     users or settings.
 */

/** Guards against leaving the system with no active administrator. */
async function assertNotLastAdmin(userId, { client = prisma } = {}) {
  const activeAdmins = await client.user.count({
    where: { role: USER_ROLE.ADMIN, isActive: true, id: { not: userId } },
  });
  if (activeAdmins === 0) {
    throw new UnprocessableError(
      'This is the last active administrator. Promote another user to administrator first.',
    );
  }
}

export async function listUsers(params, client = prisma) {
  const where = {};
  if (params.role) where.role = params.role;
  if (params.isActive !== undefined) where.isActive = params.isActive;
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: 'insensitive' } },
      { email: { contains: params.search, mode: 'insensitive' } },
    ];
  }

  const [rows, total] = await Promise.all([
    client.user.findMany({
      where,
      orderBy: { [params.sortBy]: params.sortDir },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: {
        ...SAFE_USER_SELECT,
        _count: { select: { assignedAlerts: true, investigationNotes: true } },
      },
    }),
    client.user.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      ...toPublicUser(row),
      activity: {
        assignedAlerts: row._count.assignedAlerts,
        investigationNotes: row._count.investigationNotes,
      },
    })),
    total,
  };
}

/** One user with their recent activity, for the administration detail view. */
export async function getUser(id, client = prisma) {
  const user = await client.user.findUnique({
    where: { id },
    select: {
      ...SAFE_USER_SELECT,
      _count: { select: { assignedAlerts: true, investigationNotes: true, resolvedAlerts: true } },
    },
  });
  if (!user) throw new NotFoundError('User');

  const recentActivity = await client.auditLog.findMany({
    where: { actorId: id },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      createdAt: true,
      requestId: true,
    },
  });

  return {
    ...toPublicUser(user),
    activity: {
      assignedAlerts: user._count.assignedAlerts,
      resolvedAlerts: user._count.resolvedAlerts,
      investigationNotes: user._count.investigationNotes,
    },
    recentActivity,
  };
}

export async function createUser(payload, context) {
  const email = payload.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new ConflictError('A user with this email address already exists');
  }

  const passwordHash = await hashPassword(payload.password);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: payload.name,
        email,
        passwordHash,
        role: payload.role,
        isActive: payload.isActive,
      },
      select: SAFE_USER_SELECT,
    });

    await recordAudit({
      actorId: context.actorId,
      action: AUDIT_ACTION.USER_CREATED,
      entityType: AUDIT_ENTITY_TYPE.USER,
      entityId: user.id,
      // The password is not recorded in any form, not even its length.
      metadata: { email: user.email, role: user.role, isActive: user.isActive, name: user.name },
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      tx,
    });

    return user;
  });

  return toPublicUser(created);
}

export async function updateUser(id, payload, context) {
  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
  if (!existing) throw new NotFoundError('User');

  const isSelf = id === context.actorId;

  // An administrator changing their own role is the classic privilege-escalation
  // and self-lockout hazard, so it is refused outright rather than guarded by a
  // condition that could be reasoned around.
  if (isSelf && payload.role !== undefined && payload.role !== existing.role) {
    throw new UnprocessableError(
      'You cannot change your own role. Ask another administrator to do it.',
    );
  }
  if (isSelf && payload.isActive === false) {
    throw new UnprocessableError('You cannot deactivate your own account.');
  }

  const losesAdmin =
    existing.role === USER_ROLE.ADMIN &&
    ((payload.role !== undefined && payload.role !== USER_ROLE.ADMIN) ||
      payload.isActive === false);
  if (losesAdmin) {
    await assertNotLastAdmin(id);
  }

  if (payload.email) {
    const email = payload.email.toLowerCase();
    if (email !== existing.email) {
      const clash = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (clash) throw new ConflictError('A user with this email address already exists');
    }
  }

  const data = {};
  if (payload.name !== undefined) data.name = payload.name;
  if (payload.email !== undefined) data.email = payload.email.toLowerCase();
  if (payload.role !== undefined) data.role = payload.role;
  if (payload.isActive !== undefined) data.isActive = payload.isActive;
  if (payload.password !== undefined) data.passwordHash = await hashPassword(payload.password);

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id }, data, select: SAFE_USER_SELECT });

    await recordAudit({
      actorId: context.actorId,
      action: AUDIT_ACTION.USER_UPDATED,
      entityType: AUDIT_ENTITY_TYPE.USER,
      entityId: id,
      metadata: {
        targetUserId: id,
        targetUserEmail: user.email,
        name: data.name,
        role: data.role,
        isActive: data.isActive,
      },
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      tx,
    });

    // Role changes, activation changes and password resets each get their own
    // audit event so they can be found without parsing a generic update's
    // metadata.
    if (data.role !== undefined && data.role !== existing.role) {
      await recordAudit({
        actorId: context.actorId,
        action: AUDIT_ACTION.USER_ROLE_CHANGED,
        entityType: AUDIT_ENTITY_TYPE.USER,
        entityId: id,
        metadata: { targetUserEmail: user.email, role: data.role, previousRole: existing.role },
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        tx,
      });
    }
    if (data.isActive !== undefined && data.isActive !== existing.isActive) {
      await recordAudit({
        actorId: context.actorId,
        action: data.isActive ? AUDIT_ACTION.USER_ACTIVATED : AUDIT_ACTION.USER_DEACTIVATED,
        entityType: AUDIT_ENTITY_TYPE.USER,
        entityId: id,
        metadata: {
          targetUserEmail: user.email,
          isActive: data.isActive,
          previousIsActive: existing.isActive,
        },
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        tx,
      });
    }
    if (data.passwordHash !== undefined) {
      await recordAudit({
        actorId: context.actorId,
        action: AUDIT_ACTION.USER_PASSWORD_RESET,
        entityType: AUDIT_ENTITY_TYPE.USER,
        entityId: id,
        metadata: { targetUserEmail: user.email },
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        tx,
      });
    }

    return user;
  });

  return toPublicUser(updated);
}

export { assertNotLastAdmin };
