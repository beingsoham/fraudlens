import { listAuditLogsQuerySchema } from '@fraudlens/shared/schemas';
import { PERMISSION } from '@fraudlens/shared/constants';
import { prisma } from '../../config/prisma.js';
import { asyncHandler, sendPage, toSkipTake } from '../../utils/http.js';
import { query } from '../../middleware/validate.js';

/** Maps the sanitised query into a Prisma `where` clause. */
function buildWhere(params) {
  const where = {};

  if (params.action?.length) where.action = { in: params.action };
  if (params.entityType) where.entityType = params.entityType;
  if (params.entityId) where.entityId = params.entityId;
  if (params.actorId) where.actorId = params.actorId;

  if (params.from || params.to) {
    where.createdAt = {};
    if (params.from) where.createdAt.gte = params.from;
    if (params.to) where.createdAt.lte = params.to;
  }

  if (params.search) {
    // Searches the action, entity type and the actor's name/email. Prisma
    // parameterises these, so the term never reaches SQL as text.
    where.OR = [
      { action: { contains: params.search, mode: 'insensitive' } },
      { entityType: { contains: params.search, mode: 'insensitive' } },
      { entityId: { contains: params.search, mode: 'insensitive' } },
      { requestId: { contains: params.search, mode: 'insensitive' } },
      { actor: { name: { contains: params.search, mode: 'insensitive' } } },
      { actor: { email: { contains: params.search, mode: 'insensitive' } } },
    ];
  }

  return where;
}

export const listAuditLogs = asyncHandler(async (req, res) => {
  const params = query(req);
  const where = buildWhere(params);
  const { skip, take } = toSkipTake(params);

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { [params.sortBy]: params.sortDir },
      skip,
      take,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        requestId: true,
        ipAddress: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  sendPage(res, { items: rows, total, page: params.page, pageSize: params.pageSize });
});

/** Distinct actions and entity types present in the log, for filter dropdowns. */
export const getAuditFacets = asyncHandler(async (_req, res) => {
  const [actions, entityTypes] = await Promise.all([
    prisma.auditLog.groupBy({ by: ['action'], _count: { action: true } }),
    prisma.auditLog.groupBy({ by: ['entityType'], _count: { entityType: true } }),
  ]);

  res.json({
    data: {
      actions: actions
        .map((row) => ({ value: row.action, count: row._count.action }))
        .sort((a, b) => b.count - a.count),
      entityTypes: entityTypes
        .map((row) => ({ value: row.entityType, count: row._count.entityType }))
        .sort((a, b) => b.count - a.count),
    },
  });
});

export const auditQuerySchema = listAuditLogsQuerySchema;
export const AUDIT_READ_PERMISSION = PERMISSION.AUDIT_READ;
