import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from '@fraudlens/shared/constants';

/**
 * Wraps an async route handler so a rejected promise reaches Express's error
 * pipeline instead of becoming an unhandled rejection.
 */
export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/** Standard success envelope. Every 2xx body in the API has this shape. */
export function sendData(res, data, status = 200) {
  return res.status(status).json({ data });
}

/** Standard paginated envelope: `{ data, meta }`. */
export function sendPage(res, { items, total, page = DEFAULT_PAGE, pageSize = DEFAULT_PAGE_SIZE }) {
  return res.status(200).json({
    data: items,
    meta: {
      page,
      pageSize,
      total,
      totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
      hasNextPage: page * pageSize < total,
      hasPreviousPage: page > 1,
    },
  });
}

/** Converts page/pageSize into Prisma's `skip`/`take`. */
export function toSkipTake({ page, pageSize }) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Best-effort client IP. Trusts `X-Forwarded-For` only because the app sets
 * `trust proxy` in production, where it sits behind a known reverse proxy.
 */
export function clientIp(req) {
  return req.ip ?? req.socket?.remoteAddress ?? null;
}
